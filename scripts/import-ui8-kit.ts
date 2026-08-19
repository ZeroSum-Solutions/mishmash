#!/usr/bin/env node
// F010 Phase 1 — the repeatable driver (PRD §5.2 P1c) over the 19 unwired
// UI8 kits on Devin's Desktop. Maintainer tooling over `mishmash-assets/`, a
// non-git personal reference library outside this repository — same class
// as scripts/import-claude-directory.ts and scripts/vendor-fonts.ts. No
// daemon route, no web surface, no `od` CLI subcommand (see NOTES.md for why
// the dual-track rule does not apply here).
//
// Phase 1 / Phase 2 boundary (do not cross without re-reading NOTES.md):
//   - This script only ever runs `.catalog/file_drop.py propose` (read-only
//     classification). It NEVER runs `file_drop.py file` — that step writes
//     the private rights record and is gated on an unresolved licensing
//     decision (F010 §5.1 decision 1: does an account-token match alone
//     authorize `licensed-source-review`, or does each of the 19 collections
//     need Devin's individual confirmation?). Do not add a `file` mode to
//     this script without that decision being made by Devin first.
//   - `--render-check` (off by default) runs `npm ci`/`pnpm install`/`yarn
//     install` then a build inside the extracted kit. That executes
//     third-party lifecycle scripts from an unvetted paid kit archive. It is
//     opt-in and scoped to a throwaway scratch directory; it is never run
//     automatically.
//   - A code kit that passes --render-check gets a *draft* JSON stub
//     recorded in receipts (never a real design-templates/<id>/SKILL.md,
//     never committed) — turning a full Next.js/React app into a shippable
//     design-templates entry is a separate, underspecified piece of work
//     (see NOTES.md) and committing a UI8-licensed kit into this git-tracked
//     public catalogue is itself gated on F010 §5.1 decision 2.
//
// Usage:
//   npx tsx scripts/import-ui8-kit.ts <zip-path> [options]
//     --library-dir <path>          override OD_DESIGN_LIBRARY_DIR
//     --render-check                opt-in P1b render-check for code kits
//     --render-check-timeout-ms <n> default 300000 (5 minutes) per install/build step
//     --json                        print the machine-readable report to stdout
//     --dry-run                     extract + classify + propose, but never move into _inbox/
//
// Idempotent: re-running against the same zip when `_inbox/<kitId>` already
// exists skips extraction and reports `alreadyStaged: true` instead of
// creating a duplicate entry.
import { fileURLToPath } from 'node:url';
import { execFile as execFileCb } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  availableDiskBytes,
  locateKitSignal,
  deriveKitId,
  evaluateDiskSpace,
  extractFigThumbnail,
  extractZip,
  findNestedZips,
  isAlreadyStaged,
  listZipEntryNames,
  renderCheckKit,
  stripCruftTree,
  validateZipEntryNames,
  type KitShape,
  type ProposeFn,
  type ProposeReport,
  type RenderCheckResult,
  type RunFn,
} from './import-ui8-kit-lib.ts';

const execFileAsync = promisify(execFileCb);

export interface ImportUi8KitOptions {
  libraryDir: string;
  renderCheck: boolean;
  renderCheckTimeoutMs: number;
  dryRun: boolean;
  scratchRoot?: string;
}

export interface ImportUi8KitReport {
  kitId: string;
  sourceZip: string;
  alreadyStaged: boolean;
  dryRun: boolean;
  stagedDir: string | null;
  shape: KitShape;
  /** Relative path from stagedDir to the directory holding package.json (empty string = the staged root itself). Only meaningful when shape === 'code'. */
  codeRootRelative: string;
  removedCruftPaths: string[];
  removedSymlinkPaths: string[];
  nestedArchivesExpanded: string[];
  figThumbnailsExtracted: string[];
  propose: ProposeReport | null;
  renderCheck: RenderCheckResult | null;
  draftPrepared: boolean;
  notes: string[];
}

interface Deps {
  propose: ProposeFn;
  run: RunFn;
}

const realRun: RunFn = async (cmd, args, { cwd, timeoutMs }) => {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr, timedOut: false };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; signal?: string };
    const timedOut = err.killed === true && err.signal === 'SIGKILL';
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? String(err.message ?? err),
      timedOut,
    };
  }
};

/** Real `file_drop.py propose` — shells out; never calls `file`. */
function realPropose(libraryDir: string): ProposeFn {
  return async (stagedDir: string) => {
    const { stdout } = await execFileAsync(
      'python3',
      ['.catalog/file_drop.py', 'propose', stagedDir, '--json'],
      { cwd: libraryDir, maxBuffer: 16 * 1024 * 1024 },
    );
    return JSON.parse(stdout) as ProposeReport;
  };
}

const DESIGN_SOURCE_EXTENSIONS = new Set(['.fig']); // only .fig has a known embedded-thumbnail extractor

async function attemptFigThumbnails(dir: string, notes: string[]): Promise<string[]> {
  const extracted: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!entry.isFile() || !DESIGN_SOURCE_EXTENSIONS.has(ext)) continue;
      const destPngPath = `${abs}.thumbnail.png`;
      const found = await extractFigThumbnail(abs, destPngPath);
      if (found) extracted.push(path.relative(dir, destPngPath));
    }
  }

  await walk(dir);
  if (extracted.length === 0) {
    notes.push('no .fig files carried an extractable embedded thumbnail.png (or this kit has no .fig files)');
  }
  return extracted;
}

async function extractAndClean(
  zipPath: string,
  scratchExtractDir: string,
  notes: string[],
): Promise<{ removedCruftPaths: string[]; removedSymlinkPaths: string[]; nestedArchivesExpanded: string[] }> {
  const names = await listZipEntryNames(zipPath);
  const safety = validateZipEntryNames(names);
  if (!safety.ok) throw new Error(`unsafe zip listing for ${zipPath}: ${safety.reason}`);

  const zipStat = await fs.stat(zipPath);
  const available = await availableDiskBytes(path.dirname(scratchExtractDir));
  const diskCheck = evaluateDiskSpace(zipStat.size, available);
  if (!diskCheck.ok) throw new Error(`insufficient scratch disk space for ${zipPath}: ${diskCheck.reason}`);

  await fs.mkdir(scratchExtractDir, { recursive: true });
  await extractZip(zipPath, scratchExtractDir);
  const { removedCruftPaths, removedSymlinkPaths } = await stripCruftTree(scratchExtractDir);

  const nestedArchivesExpanded: string[] = [];
  const nested = await findNestedZips(scratchExtractDir);
  for (const nestedZipPath of nested) {
    const nestedDest = nestedZipPath.replace(/\.zip$/i, '');
    const nestedNames = await listZipEntryNames(nestedZipPath);
    const nestedSafety = validateZipEntryNames(nestedNames);
    if (!nestedSafety.ok) {
      notes.push(`skipped nested archive ${path.basename(nestedZipPath)}: ${nestedSafety.reason}`);
      continue;
    }
    const nestedZipStat = await fs.stat(nestedZipPath);
    const nestedAvailable = await availableDiskBytes(path.dirname(nestedDest));
    const nestedDiskCheck = evaluateDiskSpace(nestedZipStat.size, nestedAvailable);
    if (!nestedDiskCheck.ok) {
      notes.push(`skipped nested archive ${path.basename(nestedZipPath)}: ${nestedDiskCheck.reason}`);
      continue;
    }
    await fs.mkdir(nestedDest, { recursive: true });
    await extractZip(nestedZipPath, nestedDest);
    const nestedStrip = await stripCruftTree(nestedDest);
    removedCruftPaths.push(...nestedStrip.removedCruftPaths.map((p) => path.join(path.relative(scratchExtractDir, nestedDest), p)));
    removedSymlinkPaths.push(...nestedStrip.removedSymlinkPaths.map((p) => path.join(path.relative(scratchExtractDir, nestedDest), p)));
    await fs.rm(nestedZipPath, { force: true });
    nestedArchivesExpanded.push(path.relative(scratchExtractDir, nestedDest));
  }

  return { removedCruftPaths, removedSymlinkPaths, nestedArchivesExpanded };
}

export async function importUi8Kit(
  zipPath: string,
  options: ImportUi8KitOptions,
  deps: Deps = { propose: realPropose(options.libraryDir), run: realRun },
): Promise<ImportUi8KitReport> {
  const absZipPath = path.resolve(zipPath);
  const kitId = deriveKitId(path.basename(absZipPath));
  const inboxDir = path.join(options.libraryDir, '_inbox');
  const stagedDir = path.join(inboxDir, kitId);
  const notes: string[] = [];

  const alreadyStaged = await isAlreadyStaged(inboxDir, kitId);

  let shape: KitShape = 'unknown';
  let removedCruftPaths: string[] = [];
  let removedSymlinkPaths: string[] = [];
  let nestedArchivesExpanded: string[] = [];
  let figThumbnailsExtracted: string[] = [];
  let effectiveStagedDir: string | null = null;
  // Relative path (from the staged kit root) to the directory that actually
  // contains package.json — may be nested several levels down (real
  // "main-file" shape). Empty string means the staged root itself.
  let codeRootRelative = '';

  if (alreadyStaged) {
    notes.push(`_inbox/${kitId} already exists — skipped re-extraction (idempotent)`);
    effectiveStagedDir = stagedDir;
    const signal = await locateKitSignal(stagedDir);
    shape = signal.shape;
    if (signal.signalDir) codeRootRelative = path.relative(stagedDir, signal.signalDir);
  } else {
    const scratchRoot = options.scratchRoot ?? await fs.mkdtemp(path.join(os.tmpdir(), 'import-ui8-kit-'));
    const scratchExtractDir = path.join(scratchRoot, kitId);
    const extraction = await extractAndClean(absZipPath, scratchExtractDir, notes);
    removedCruftPaths = extraction.removedCruftPaths;
    removedSymlinkPaths = extraction.removedSymlinkPaths;
    nestedArchivesExpanded = extraction.nestedArchivesExpanded;

    const signal = await locateKitSignal(scratchExtractDir);
    shape = signal.shape;
    if (signal.signalDir) codeRootRelative = path.relative(scratchExtractDir, signal.signalDir);
    if (shape === 'design-source') {
      figThumbnailsExtracted = await attemptFigThumbnails(scratchExtractDir, notes);
    }

    if (options.dryRun) {
      notes.push('dry-run: staged tree left in scratch, never moved into _inbox/');
      effectiveStagedDir = scratchExtractDir;
    } else {
      await fs.mkdir(inboxDir, { recursive: true, mode: 0o700 });
      await fs.rename(scratchExtractDir, stagedDir);
      effectiveStagedDir = stagedDir;
    }
  }

  let propose: ProposeReport | null = null;
  if (!options.dryRun || alreadyStaged) {
    propose = await deps.propose(effectiveStagedDir!);
  } else {
    notes.push('dry-run: file_drop.py propose skipped (nothing staged in _inbox/ to point it at)');
  }

  let renderCheck: RenderCheckResult | null = null;
  let draftPrepared = false;
  if (options.renderCheck && shape === 'code' && effectiveStagedDir) {
    const codeRoot = codeRootRelative ? path.join(effectiveStagedDir, codeRootRelative) : effectiveStagedDir;
    renderCheck = await renderCheckKit(codeRoot, kitId, deps.run, options.renderCheckTimeoutMs);
    if (renderCheck.pass) {
      await writeDraftStub(options.libraryDir, kitId, renderCheck);
      draftPrepared = true;
      notes.push(`draft stub written to .catalog/import-ui8-kit-receipts/${kitId}/draft-template.json (not committed; Phase 2 decision-gated)`);
    }
  } else if (shape === 'code' && !options.renderCheck) {
    notes.push('code kit detected but --render-check was not passed — no render-check result recorded for this run');
  }

  if (propose) await persistReceipt(options.libraryDir, kitId, 'propose.json', propose);
  if (renderCheck) await persistReceipt(options.libraryDir, kitId, 'render-check.json', renderCheck);

  return {
    kitId,
    sourceZip: absZipPath,
    alreadyStaged,
    dryRun: options.dryRun,
    stagedDir: options.dryRun && !alreadyStaged ? null : effectiveStagedDir,
    shape,
    codeRootRelative,
    removedCruftPaths,
    removedSymlinkPaths,
    nestedArchivesExpanded,
    figThumbnailsExtracted,
    propose,
    renderCheck,
    draftPrepared,
    notes,
  };
}

// Suggested-only taxonomy for the draft stub (design-taxonomy.ts CATEGORIES).
// F010 P1f: populate the facets that exist today; leave section/style/theme/
// mood out entirely rather than fabricate values against a vocabulary F007
// has not ratified yet (a `// TODO(F007)` JS-style comment is not valid YAML
// frontmatter, per the audit — so this stub carries no such marker at all,
// it simply omits the undefined fields).
function suggestCategoryAndScenario(renderCheck: RenderCheckResult): { category: string; scenario: string } {
  return { category: 'web-app', scenario: 'product' };
}

async function writeDraftStub(libraryDir: string, kitId: string, renderCheck: RenderCheckResult): Promise<void> {
  const { category, scenario } = suggestCategoryAndScenario(renderCheck);
  const stub = {
    kitId,
    status: 'draft-not-committed',
    blockedOn: 'F010 §5.1 decision 2 (code-kit redistribution legality)',
    suggestedOdCategory: category,
    suggestedOdScenario: scenario,
    todoFacets: ['section', 'style', 'theme', 'mood'],
    todoFacetsReason: 'F007 has not ratified this vocabulary yet (CROSS-CUTTING-CORRECTIONS.md decision 15)',
    renderCheck,
  };
  await persistReceipt(libraryDir, kitId, 'draft-template.json', stub);
}

async function persistReceipt(libraryDir: string, kitId: string, fileName: string, value: unknown): Promise<void> {
  const receiptsDir = path.join(libraryDir, '.catalog', 'import-ui8-kit-receipts', kitId);
  await fs.mkdir(receiptsDir, { recursive: true, mode: 0o700 });
  const target = path.join(receiptsDir, fileName);
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { zipPath: string; options: ImportUi8KitOptions; json: boolean } {
  const positional: string[] = [];
  let libraryDir = process.env.OD_DESIGN_LIBRARY_DIR ?? path.join(os.homedir(), 'Desktop', 'Design Assets');
  let renderCheck = false;
  let renderCheckTimeoutMs = 300_000;
  let json = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--library-dir') { libraryDir = argv[++i] ?? libraryDir; }
    else if (arg === '--render-check') { renderCheck = true; }
    else if (arg === '--render-check-timeout-ms') { renderCheckTimeoutMs = Number(argv[++i]); }
    else if (arg === '--json') { json = true; }
    else if (arg === '--dry-run') { dryRun = true; }
    else if (arg && !arg.startsWith('--')) { positional.push(arg); }
  }

  const zipPath = positional[0];
  if (!zipPath) {
    throw new Error('usage: import-ui8-kit.ts <zip-path> [--library-dir <path>] [--render-check] [--render-check-timeout-ms <n>] [--json] [--dry-run]');
  }

  return { zipPath, options: { libraryDir: path.resolve(libraryDir), renderCheck, renderCheckTimeoutMs, dryRun }, json };
}

async function main(): Promise<void> {
  const { zipPath, options, json } = parseArgs(process.argv.slice(2));
  const report = await importUi8Kit(zipPath, options);
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`kitId=${report.kitId} shape=${report.shape} alreadyStaged=${report.alreadyStaged} propose.route=${report.propose?.route ?? 'null'}`);
    for (const note of report.notes) console.log(`  note: ${note}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
