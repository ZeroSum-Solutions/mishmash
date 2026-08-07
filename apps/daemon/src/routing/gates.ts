// L3 deterministic gate runner + cascade classification (WR wave, P2
// tranche -- plan docs/plans/2026-08-05-model-routing-system.md §3.2 L3).
//
// Two gate classes (plan §3.2 L3, resolves Grok F9/F13, Sol #12):
//   - DETERMINISTIC (cascade triggers): TS compile, ESLint, design.md lint,
//     tokens-schema, link/form smoke, axe accessibility, Lighthouse CI
//     budgets, screenshot SSIM vs per-build baselines, Supabase migration
//     dry-run for app builds. `runGates` executes these; a FAIL feeds
//     `classifyCascadeTrigger`'s cheap->mid->frontier escalation ladder.
//   - STOCHASTIC (advisory ship-report): vision-model DESIGN.md conformance,
//     review-panel prose findings. DEFINITIONS ONLY below -- no `run()` at
//     all, by construction: this module never executes a stochastic gate,
//     so there is no code path that could accidentally treat one as a
//     cascade trigger. `classifyCascadeTrigger` additionally enforces this
//     at RUNTIME (not just via the type system) by throwing on any gate
//     result whose `class !== 'deterministic'`, per this task's brief.
//
// Discipline (WR t8, mirrors admission.ts/reliability.ts's own scope
// notes): deterministic gates only; no vision-model calls anywhere in this
// file; no craft gates (plan §4b.5 is P2.5 scope, explicitly out of this
// wave's contract per WR-routing.md's "Explicitly out of scope"); no
// dispatch wiring -- `classifyCascadeTrigger`'s output is read by a FUTURE
// tranche's dispatch loop (t9), never called from here.
//
// "Unavailable" over reimplementation (this task's brief, restated because
// it is the single rule most of this file's branches exist to honor): a
// gate whose underlying tool is not installed/configured in this workspace
// reports `'unavailable'` with evidence explaining why, NEVER a silent or
// fabricated `'pass'`. Verified per tool at the time this tranche was
// written (grep across the repo's package.json files): ESLint is not a
// dependency anywhere in this monorepo (this repo's own static checks run
// through `scripts/guard.ts` instead); `@google/design.md` and `@lhci/cli`
// are not dependencies either. `axe-core` + `playwright` ARE real
// `apps/daemon` dependencies. `sharp` is a real `apps/daemon` dependency,
// LAZILY imported (t8 fix-round, Sol MED-7: a broken native binding must
// not crash this module's own load, only fail the one gate that needs it)
// and reused for the screenshot-SSIM gate's real windowed-SSIM comparison
// (see that gate's own doc comment for the algorithm reference).
// `typescript` is a real repo devDependency, reused directly (no `npx`, no
// network) for the TS-compile gate.
//
// t8 fix-round (Sol review HIGH-2): the axe gate does NOT reuse
// `apps/daemon/src/plugins/atoms/a11y-audit-playwright.ts` -- that harness
// is out of this wave's lease (cannot be edited here) and its network/
// file: confinement predates this gate's untrusted-artifact threat model
// (no root confinement on file: URLs, no WebSocket blocking, no
// hang-is-a-failure classification). This file launches its own
// tightly-scoped Playwright context instead; see `runAxeGate`'s own doc
// comment for the full threat model.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';
import { chromium, type Browser, type Route } from 'playwright';
import {
  getAllSchemaNames,
  getBSlotNames,
  getRequiredA1Names,
  getRequiredA2Names,
  type RoutingGateOutcome,
  type RoutingPolicyDocument,
} from '@open-design/contracts';
import { admitsUnderCap } from './admission.js';
import { updateGateOutcomes } from './telemetry.js';

const require_ = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Gate identity + result types
// ---------------------------------------------------------------------------

export type DeterministicGateId =
  | 'ts-compile'
  | 'eslint'
  | 'design-md-lint'
  | 'tokens-schema'
  | 'link-smoke'
  | 'form-smoke'
  | 'axe'
  | 'lighthouse-ci'
  | 'screenshot-ssim'
  | 'supabase-migration-dry-run';

/** plan §3.2 L3: advisory ship-report gates -- never cascade triggers. No
 * `run()` exists for these anywhere in this module (see this file's own
 * header comment). */
export type StochasticGateId = 'vision-conformance' | 'review-panel-prose';

export type GateId = DeterministicGateId | StochasticGateId;

export type GateClass = 'deterministic' | 'stochastic';

/**
 * `'unavailable'` (tool not installed/configured -- never a fake pass) and
 * `'skipped-not-applicable'` (the gate genuinely does not apply to this
 * artifact, e.g. no TS files to type-check) are distinct typed statuses,
 * per this task's brief -- neither is a `'pass'`, and `classifyCascadeTrigger`
 * treats both identically as "never trigger escalation" while still
 * recording them honestly (see `RoutingGateOutcome`'s own doc comment in
 * packages/contracts/src/api/routing-telemetry.ts, which this type is a
 * strict subset of).
 */
export type GateExecutionStatus = 'pass' | 'fail' | 'unavailable' | 'skipped-not-applicable';

interface GateResultBase {
  evidence: string[];
  durationMs: number;
  status: GateExecutionStatus;
}

export interface DeterministicGateResult extends GateResultBase {
  id: DeterministicGateId;
  class: 'deterministic';
}

export interface StochasticGateResult extends GateResultBase {
  id: StochasticGateId;
  class: 'stochastic';
}

export type GateResult = DeterministicGateResult | StochasticGateResult;

/** Context every deterministic gate's `run()` receives. `db`/`ssim` are
 * optional (mirrors admission.ts's "arrives as a plain argument" style):
 * most gates never touch either; only `screenshot-ssim` needs both. */
export interface GateContext {
  artifactDir: string;
  buildId: string | null;
  db?: Database.Database;
  ssim?: {
    /** Absolute path to THIS render's screenshot. */
    screenshotPath: string;
    /** Current token-freeze version (plan §3.3) -- see `baselineState`'s
     * own doc comment for the freeze-revision invalidation this drives. */
    tokenFreezeVersion?: string;
    /** Overrides `DEFAULT_SSIM_FLOOR` for this comparison. */
    floorOverride?: number;
  };
  timeoutMs: number;
}

export interface DeterministicGateDefinition {
  id: DeterministicGateId;
  class: 'deterministic';
  label: string;
  description: string;
  run: (ctx: GateContext) => Promise<DeterministicGateResult>;
}

/** Stochastic gates are DEFINITIONS ONLY -- advisory, never executed by
 * `runGates` (there is nothing to run here by construction: no `run` field
 * exists on this shape at all). A future ship-report surface (out of this
 * tranche's scope) is what would eventually invoke a vision model / review
 * panel and attach its findings as prose, never as a `GateResult`. */
export interface StochasticGateDefinition {
  id: StochasticGateId;
  class: 'stochastic';
  label: string;
  description: string;
}

export type GateDefinition = DeterministicGateDefinition | StochasticGateDefinition;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GateRunnerInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GateRunnerInputError';
  }
}

export class GateSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GateSelectionError';
  }
}

/** Thrown by `classifyCascadeTrigger` on a runtime (not just type-level)
 * violation of "only deterministic results may feed the escalation
 * decision." */
export class GateClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GateClassificationError';
  }
}

export class SsimLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsimLifecycleError';
  }
}

// ---------------------------------------------------------------------------
// Small internal helpers
// ---------------------------------------------------------------------------

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function finishDeterministic(
  id: DeterministicGateId,
  status: GateExecutionStatus,
  evidence: string[],
  startedAtMs: number,
): DeterministicGateResult {
  return { id, class: 'deterministic', status, evidence, durationMs: Math.max(0, Math.round(performance.now() - startedAtMs)) };
}

const DEFAULT_MAX_WALK_FILES = 5000;
const SKIPPED_WALK_DIR_NAMES = new Set(['node_modules', '.git', 'dist', '.next', '.cache']);

/** Bounded recursive file listing, skipping common non-artifact
 * directories. Used by the applicability checks below (e.g. "are there any
 * .ts files at all") -- never used to feed an unbounded-size operation. */
function listFilesRecursive(dir: string, opts: { extensions: readonly string[] }): string[] {
  const results: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0 && results.length < DEFAULT_MAX_WALK_FILES) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIPPED_WALK_DIR_NAMES.has(entry.name)) stack.push(path.join(current, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (opts.extensions.some((ext) => lower.endsWith(ext))) {
        results.push(path.join(current, entry.name));
      }
      if (results.length >= DEFAULT_MAX_WALK_FILES) break;
    }
  }
  return results;
}

function findEntryHtmlFile(artifactDir: string): string | null {
  const indexPath = path.join(artifactDir, 'index.html');
  if (fs.existsSync(indexPath)) return indexPath;
  try {
    const topLevelHtml = fs
      .readdirSync(artifactDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
      .map((entry) => entry.name)
      .sort();
    return topLevelHtml.length > 0 ? path.join(artifactDir, topLevelHtml[0] as string) : null;
  } catch {
    return null;
  }
}

interface RunNodeScriptResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Spawns `node <scriptPath> ...args` with a hard timeout -- used to invoke
 * an already-installed CLI's entry script directly (tsc, design.md's bin)
 * without shelling through `npx` (no network dependency, no ambient PATH
 * assumption). */
function runNodeScript(scriptPath: string, args: string[], opts: { cwd: string; timeoutMs: number }): Promise<RunNodeScriptResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { cwd: opts.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      stderr += errorMessage(err);
      resolve({ code: null, stdout, stderr, timedOut });
    });
  });
}

function nonEmptyLines(text: string, max: number): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, max);
}

/**
 * t8 fix-round (Sol HIGH-1): resolves `dir` to its REAL (symlink-followed)
 * path. Used everywhere a gate needs to confine subsequent path checks to
 * "actually inside this directory on disk" rather than "lexically looks
 * like it's inside this directory" -- a symlinked intermediate directory
 * (or the artifact directory itself being a symlink) defeats a purely
 * lexical `path.relative`/`startsWith` check, since the LEXICAL path can
 * stay under the expected prefix while the REAL path it resolves to does
 * not.
 */
function resolveCanonicalDir(dir: string): string {
  return fs.realpathSync(dir);
}

/** `true` when canonical path `target` is `canonicalRoot` itself or
 * strictly nested under it. Both arguments MUST already be
 * realpath-resolved (see `resolveCanonicalDir`) -- this function does no
 * symlink resolution of its own, only the lexical containment comparison
 * over already-canonical inputs. */
function isWithinCanonicalRoot(canonicalRoot: string, target: string): boolean {
  const rel = path.relative(canonicalRoot, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * t8 fix-round (Sol HIGH-1 residue): realpath-based containment check that
 * tolerates a candidate path (or some SUFFIX of it) not existing on disk
 * yet -- a plain `fs.realpathSync` throws ENOENT on a glob's literal prefix
 * when nothing has been generated at that path yet, which the earlier
 * fix-round's LEXICAL check papered over (and which is exactly the gap Sol
 * flagged: a lexical comparison never catches an existing INTERMEDIATE
 * directory that is itself a symlink pointing elsewhere).
 *
 * Walks up from `candidatePath` to the longest EXISTING ancestor,
 * realpath-resolves THAT ancestor (resolving any symlink in it), then
 * reconstructs the full path by re-appending the (still nonexistent, so
 * lexical is fine there) remainder, and checks containment on the
 * reconstructed result. A path with no resolvable ancestor at all (walked
 * all the way to the filesystem root) is treated as NOT contained --
 * fail closed.
 */
function isPathWithinCanonicalRootTolerant(candidatePath: string, canonicalRoot: string): boolean {
  let current = candidatePath;
  const suffixSegments: string[] = [];
  for (;;) {
    let real: string;
    try {
      real = fs.realpathSync(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return false;
      suffixSegments.unshift(path.basename(current));
      current = parent;
      continue;
    }
    const rebuilt = suffixSegments.length > 0 ? path.join(real, ...suffixSegments) : real;
    return isWithinCanonicalRoot(canonicalRoot, rebuilt);
  }
}

/**
 * Minimal string-aware JSONC (JSON-with-comments) stripper -- tsconfig.json
 * commonly carries `//`/`/* *\/` comments that `JSON.parse` rejects. Not a
 * full JSONC grammar (no trailing-comma handling), just enough to avoid
 * treating an ordinary commented tsconfig as unparseable. A string literal
 * containing something that looks like a comment start is left untouched
 * (the quote-tracking state machine below never strips inside a string).
 */
function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  let stringQuote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i++;
        continue;
      }
      if (ch === stringQuote) inString = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

interface TsconfigEscapeCheck {
  escaped: boolean;
  reason?: string;
}

/**
 * t8 fix-round (Sol HIGH-1): an artifact's OWN tsconfig.json can name
 * `extends`, `include`/`files`, and `references[].path` entries that
 * resolve OUTSIDE the artifact directory (e.g. `"extends": "../../"`),
 * which would make `tsc` read/execute configuration the operator never
 * intended to expose to a gate run against untrusted, generated content.
 * This performs a LEXICAL containment check (glob segments are truncated
 * at their first `*` before resolving, since globs are not filesystem-
 * resolved here) against `canonicalRoot` for every such path -- failing
 * CLOSED (an escape) on anything that cannot be safely parsed/checked,
 * per this task's "never a fake pass" discipline extended to "never
 * silently trust what we could not verify."
 */
function checkTsconfigForEscapes(tsconfigPath: string, canonicalRoot: string): TsconfigEscapeCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonComments(fs.readFileSync(tsconfigPath, 'utf8')));
  } catch (err) {
    return { escaped: true, reason: `tsconfig.json could not be parsed for the path-escape safety check: ${errorMessage(err)}` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { escaped: false };
  const obj = raw as Record<string, unknown>;
  // Resolve relative include/extends/references entries against the
  // CANONICAL root, not `path.dirname(tsconfigPath)` -- `tsconfigPath` is
  // built from the caller's (possibly symlinked, e.g. macOS `/tmp` ->
  // `/private/tmp`) `ctx.artifactDir` string, while `canonicalRoot` is
  // already realpath-resolved. Mixing the two would compare a symlinked
  // path against its own realpath and see a spurious ".." relative
  // segment between two strings that name the SAME real directory --
  // exactly the false-positive this fix's own bug-fix commit found via a
  // real test failure (`**/*.ts` flagged as an "escape" purely because
  // `/tmp/...` and `/private/tmp/...` differ lexically on macOS).
  const baseDir = canonicalRoot;
  const candidates: string[] = [];
  if (typeof obj.extends === 'string') candidates.push(obj.extends);
  if (Array.isArray(obj.extends)) candidates.push(...obj.extends.filter((v): v is string => typeof v === 'string'));
  for (const key of ['include', 'files'] as const) {
    const value = obj[key];
    if (Array.isArray(value)) candidates.push(...value.filter((v): v is string => typeof v === 'string'));
  }
  if (Array.isArray(obj.references)) {
    for (const ref of obj.references) {
      if (ref && typeof ref === 'object' && typeof (ref as { path?: unknown }).path === 'string') {
        candidates.push((ref as { path: string }).path);
      }
    }
  }
  for (const rawPath of candidates) {
    if (path.isAbsolute(rawPath)) {
      return { escaped: true, reason: `tsconfig.json references an absolute path outside the artifact directory: "${rawPath}"` };
    }
    // Globs are checked up to their first wildcard segment only -- a glob
    // pattern like "src/**/*.ts" cannot itself walk upward past a literal
    // ".." segment that precedes the wildcard, so truncating there is
    // sufficient; the REALPATH containment check below (not a lexical one)
    // is what actually catches a symlinked intermediate directory.
    const literalPrefix = rawPath.split('*')[0] ?? rawPath;
    const lexicallyResolved = path.resolve(baseDir, literalPrefix);
    if (!isPathWithinCanonicalRootTolerant(lexicallyResolved, canonicalRoot)) {
      return { escaped: true, reason: `tsconfig.json references a path outside the artifact directory: "${rawPath}"` };
    }
  }
  return { escaped: false };
}

// ---------------------------------------------------------------------------
// Gate: ts-compile
// ---------------------------------------------------------------------------

async function runTsCompileGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const tsFiles = listFilesRecursive(ctx.artifactDir, { extensions: ['.ts', '.tsx'] });
  if (tsFiles.length === 0) {
    return finishDeterministic(
      'ts-compile',
      'skipped-not-applicable',
      [`no .ts/.tsx files found under ${ctx.artifactDir} -- lane-A artifacts are typically HTML/CSS/JS.`],
      start,
    );
  }
  const tsconfigPath = path.join(ctx.artifactDir, 'tsconfig.json');
  if (!fs.existsSync(tsconfigPath)) {
    return finishDeterministic(
      'ts-compile',
      'unavailable',
      [`${tsFiles.length} TS file(s) found but no tsconfig.json at ${tsconfigPath} -- cannot type-check without a project config; reusing tsc requires one rather than inventing compiler options here.`],
      start,
    );
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = resolveCanonicalDir(ctx.artifactDir);
  } catch (err) {
    return finishDeterministic('ts-compile', 'unavailable', [`artifact directory is not resolvable: ${errorMessage(err)}`], start);
  }
  const escapeCheck = checkTsconfigForEscapes(tsconfigPath, canonicalRoot);
  if (escapeCheck.escaped) {
    return finishDeterministic('ts-compile', 'fail', [`tsconfig.json path-escape safety check failed: ${escapeCheck.reason}`], start);
  }

  let tscBinPath: string;
  try {
    tscBinPath = require_.resolve('typescript/bin/tsc');
  } catch (err) {
    return finishDeterministic('ts-compile', 'unavailable', [`typescript is not resolvable from this workspace: ${errorMessage(err)}`], start);
  }
  const { code, stdout, stderr, timedOut } = await runNodeScript(tscBinPath, ['--noEmit', '-p', tsconfigPath], {
    cwd: ctx.artifactDir,
    timeoutMs: ctx.timeoutMs,
  });
  if (timedOut) {
    return finishDeterministic('ts-compile', 'unavailable', [`tsc --noEmit timed out after ${ctx.timeoutMs}ms.`], start);
  }
  if (code === 0) {
    return finishDeterministic(
      'ts-compile',
      'pass',
      [`tsc --noEmit -p ${path.relative(ctx.artifactDir, tsconfigPath)} exited 0 across ${tsFiles.length} TS file(s).`],
      start,
    );
  }
  const evidence = nonEmptyLines(stdout + stderr, 20);
  return finishDeterministic('ts-compile', 'fail', evidence.length > 0 ? evidence : [`tsc exited ${code}`], start);
}

// ---------------------------------------------------------------------------
// Gate: eslint
// ---------------------------------------------------------------------------

const ESLINT_CONFIG_NAMES = ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs'];

async function runEslintGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const lintableFiles = listFilesRecursive(ctx.artifactDir, { extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'] });
  if (lintableFiles.length === 0) {
    return finishDeterministic('eslint', 'skipped-not-applicable', [`no lintable JS/TS files found under ${ctx.artifactDir}.`], start);
  }
  let eslintBinPath: string;
  try {
    eslintBinPath = require_.resolve('eslint/bin/eslint.js');
  } catch (err) {
    return finishDeterministic(
      'eslint',
      'unavailable',
      [
        `ESLint is not installed anywhere in this monorepo (${errorMessage(err)}) -- this repo's own static checks run through scripts/guard.ts instead. Reusing eslint means installing it, not reimplementing lint rules here.`,
      ],
      start,
    );
  }
  const hasConfig = ESLINT_CONFIG_NAMES.some((name) => fs.existsSync(path.join(ctx.artifactDir, name)));
  if (!hasConfig) {
    return finishDeterministic(
      'eslint',
      'unavailable',
      [`${lintableFiles.length} lintable file(s) found but no ESLint config under ${ctx.artifactDir}.`],
      start,
    );
  }
  const { code, stdout, stderr, timedOut } = await runNodeScript(eslintBinPath, ['.', '--format', 'json'], {
    cwd: ctx.artifactDir,
    timeoutMs: ctx.timeoutMs,
  });
  if (timedOut) {
    return finishDeterministic('eslint', 'unavailable', [`eslint timed out after ${ctx.timeoutMs}ms.`], start);
  }
  if (code === 0) {
    return finishDeterministic('eslint', 'pass', [`eslint exited 0 across ${lintableFiles.length} lintable file(s).`], start);
  }
  try {
    const parsed = JSON.parse(stdout) as Array<{ filePath: string; messages: Array<{ ruleId: string | null; message: string; severity: number }> }>;
    const evidence = parsed
      .flatMap((file) => file.messages.filter((m) => m.severity >= 2).map((m) => `${path.relative(ctx.artifactDir, file.filePath)}: ${m.ruleId ?? 'error'} -- ${m.message}`))
      .slice(0, 20);
    return finishDeterministic('eslint', 'fail', evidence.length > 0 ? evidence : [`eslint exited ${code}`], start);
  } catch {
    return finishDeterministic('eslint', 'fail', nonEmptyLines(stdout + stderr, 20) || [`eslint exited ${code}`], start);
  }
}

// ---------------------------------------------------------------------------
// Gate: design-md-lint
// ---------------------------------------------------------------------------

async function runDesignMdLintGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const designMdPath = path.join(ctx.artifactDir, 'DESIGN.md');
  if (!fs.existsSync(designMdPath)) {
    return finishDeterministic(
      'design-md-lint',
      'skipped-not-applicable',
      [`no DESIGN.md found under ${ctx.artifactDir} -- not every lane-A artifact ships a design contract.`],
      start,
    );
  }
  let pkgJsonPath: string;
  try {
    pkgJsonPath = require_.resolve('@google/design.md/package.json');
  } catch (err) {
    return finishDeterministic(
      'design-md-lint',
      'unavailable',
      [`@google/design.md is not installed in this workspace (${errorMessage(err)}) -- this gate reuses that tool rather than reimplementing a design-token linter.`],
      start,
    );
  }
  let bin: string | undefined;
  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as { name?: string; bin?: string | Record<string, string> };
    bin = typeof pkgJson.bin === 'string' ? pkgJson.bin : (pkgJson.bin?.['design.md'] ?? (pkgJson.name ? pkgJson.bin?.[pkgJson.name] : undefined));
  } catch (err) {
    return finishDeterministic('design-md-lint', 'unavailable', [`could not read @google/design.md's package.json: ${errorMessage(err)}`], start);
  }
  if (!bin) {
    return finishDeterministic('design-md-lint', 'unavailable', ['@google/design.md package.json declares no resolvable bin entry.'], start);
  }
  const binPath = path.join(path.dirname(pkgJsonPath), bin);
  const { code, stdout, stderr, timedOut } = await runNodeScript(binPath, ['lint', '--format', 'json', 'DESIGN.md'], {
    cwd: ctx.artifactDir,
    timeoutMs: ctx.timeoutMs,
  });
  if (timedOut) {
    return finishDeterministic('design-md-lint', 'unavailable', [`design.md lint timed out after ${ctx.timeoutMs}ms.`], start);
  }
  if (code === 0) {
    return finishDeterministic('design-md-lint', 'pass', [`design.md lint exited 0 for ${designMdPath}.`], start);
  }
  const evidence = nonEmptyLines(stdout + stderr, 20);
  return finishDeterministic('design-md-lint', 'fail', evidence.length > 0 ? evidence : [`design.md lint exited ${code}`], start);
}

// ---------------------------------------------------------------------------
// Gate: tokens-schema
// ---------------------------------------------------------------------------

/**
 * t8 fix-round (Sol MED-6, residue-hardened): full structural validation of
 * design-tokens.json against the CANONICAL envelope this repo's own
 * generator produces -- `packages/contracts/src/design-systems/
 * derived-token-outputs.ts`'s `renderDesignTokensJson`, whose literal
 * return shape is:
 *
 *   { schemaVersion: 1, format: 'od-design-tokens/v1', contract:
 *     'TOKEN_SCHEMA', generatedAt: string, source: { tokensCss: string,
 *     tokenContractReport: string }, summary: <DerivedDesignTokenReport
 *     .summary, typed `unknown` in the contract itself -- required to be
 *     PRESENT, its shape deliberately unconstrained>, tokens: [{ name,
 *     value, type, layer, confidence, reason, sources, sourceName? }] }
 *
 * (`DerivedDesignTokenBinding`, same file: `name`/`layer`/`value`/
 * `confidence`/`reason`/`sources`/optional `sourceName`; `type` is
 * computed at render time, not part of the binding's own input shape, but
 * IS always present on the rendered output.) The earlier fix-round's
 * validator checked only `schemaVersion`/`format`/`tokens[].{name,value,
 * layer,sources}` -- this checks every field the canonical shape declares,
 * plus DUPLICATE name detection, so a document that names every required
 * token but is otherwise malformed (missing `contract`, missing
 * `generatedAt`, a per-token `type`/`confidence`/`reason` absent, a
 * non-string `sources` element, a wrongly-typed `sourceName`) FAILS here
 * rather than slipping through on name-presence alone.
 */
function validateDesignTokensJsonStructure(parsed: unknown): { ok: true; names: Set<string> } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, issues: ['design-tokens.json root must be a JSON object.'] };
  }
  const envelope = parsed as Record<string, unknown>;

  if (envelope.format !== 'od-design-tokens/v1') {
    issues.push(`envelope "format" must be "od-design-tokens/v1", got ${JSON.stringify(envelope.format)}.`);
  }
  if (envelope.schemaVersion !== 1) {
    issues.push('envelope "schemaVersion" must be exactly 1 (the only canonical version).');
  }
  if (envelope.contract !== 'TOKEN_SCHEMA') {
    issues.push(`envelope "contract" must be "TOKEN_SCHEMA", got ${JSON.stringify(envelope.contract)}.`);
  }
  if (typeof envelope.generatedAt !== 'string' || envelope.generatedAt.length === 0) {
    issues.push(`envelope "generatedAt" must be a nonempty string, got ${JSON.stringify(envelope.generatedAt)}.`);
  }
  if (!envelope.source || typeof envelope.source !== 'object' || Array.isArray(envelope.source)) {
    issues.push('envelope "source" must be an object.');
  } else {
    const source = envelope.source as Record<string, unknown>;
    if (typeof source.tokensCss !== 'string' || source.tokensCss.length === 0) {
      issues.push(`envelope "source.tokensCss" must be a nonempty string, got ${JSON.stringify(source.tokensCss)}.`);
    }
    if (typeof source.tokenContractReport !== 'string' || source.tokenContractReport.length === 0) {
      issues.push(`envelope "source.tokenContractReport" must be a nonempty string, got ${JSON.stringify(source.tokenContractReport)}.`);
    }
  }
  // `DerivedDesignTokenReport#summary` is typed `unknown` in the canonical
  // contract itself -- deliberately unconstrained shape, but the KEY must
  // exist (an omitted `summary` is not a valid render of this envelope).
  if (!('summary' in envelope)) {
    issues.push('envelope is missing required key "summary".');
  }

  if (!Array.isArray(envelope.tokens)) {
    issues.push('envelope "tokens" must be an array.');
    return { ok: false, issues };
  }

  const names = new Set<string>();
  const seen = new Set<string>();
  envelope.tokens.forEach((token, index) => {
    if (!token || typeof token !== 'object' || Array.isArray(token)) {
      issues.push(`tokens[${index}] must be an object.`);
      return;
    }
    const t = token as Record<string, unknown>;
    if (typeof t.name !== 'string' || t.name.length === 0 || !t.name.startsWith('--')) {
      issues.push(`tokens[${index}].name must be a nonempty string starting with "--", got ${JSON.stringify(t.name)}.`);
      return;
    }
    if (seen.has(t.name)) {
      issues.push(`duplicate token name "${t.name}" at tokens[${index}].`);
    }
    seen.add(t.name);
    if (typeof t.value !== 'string' || t.value.length === 0) {
      issues.push(`tokens[${index}] ("${t.name}").value must be a nonempty string, got ${JSON.stringify(t.value)}.`);
    }
    if (typeof t.type !== 'string' || t.type.length === 0) {
      issues.push(`tokens[${index}] ("${t.name}").type must be a nonempty string, got ${JSON.stringify(t.type)}.`);
    }
    if (typeof t.layer !== 'string' || t.layer.length === 0) {
      issues.push(`tokens[${index}] ("${t.name}").layer must be a nonempty string, got ${JSON.stringify(t.layer)}.`);
    }
    if (typeof t.confidence !== 'string' || t.confidence.length === 0) {
      issues.push(`tokens[${index}] ("${t.name}").confidence must be a nonempty string, got ${JSON.stringify(t.confidence)}.`);
    }
    if (typeof t.reason !== 'string' || t.reason.length === 0) {
      issues.push(`tokens[${index}] ("${t.name}").reason must be a nonempty string, got ${JSON.stringify(t.reason)}.`);
    }
    if (!Array.isArray(t.sources) || !t.sources.every((s) => typeof s === 'string')) {
      issues.push(`tokens[${index}] ("${t.name}").sources must be an array of strings.`);
    }
    if (t.sourceName !== undefined && typeof t.sourceName !== 'string') {
      issues.push(`tokens[${index}] ("${t.name}").sourceName, when present, must be a string, got ${JSON.stringify(t.sourceName)}.`);
    }
    names.add(t.name);
  });

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, names };
}

async function runTokensSchemaGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const tokensPath = path.join(ctx.artifactDir, 'design-tokens.json');
  if (!fs.existsSync(tokensPath)) {
    return finishDeterministic(
      'tokens-schema',
      'skipped-not-applicable',
      [`no design-tokens.json found at ${tokensPath} -- not every lane-A artifact ships one.`],
      start,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
  } catch (err) {
    return finishDeterministic('tokens-schema', 'fail', [`design-tokens.json is not valid JSON: ${errorMessage(err)}`], start);
  }

  const structure = validateDesignTokensJsonStructure(parsed);
  if (!structure.ok) {
    return finishDeterministic('tokens-schema', 'fail', structure.issues.slice(0, 20), start);
  }
  const { names } = structure;

  const missingA1 = getRequiredA1Names().filter((name) => !names.has(name));
  const missingA2 = getRequiredA2Names().filter((name) => !names.has(name));
  const missingBSlot = getBSlotNames().filter((name) => !names.has(name));
  if (missingA1.length > 0 || missingA2.length > 0 || missingBSlot.length > 0) {
    return finishDeterministic(
      'tokens-schema',
      'fail',
      [
        ...(missingA1.length > 0 ? [`missing required A1 token(s): ${missingA1.join(', ')}`] : []),
        ...(missingA2.length > 0 ? [`missing required A2 token(s): ${missingA2.join(', ')}`] : []),
        ...(missingBSlot.length > 0 ? [`missing required B-slot token(s): ${missingBSlot.join(', ')}`] : []),
      ],
      start,
    );
  }
  return finishDeterministic(
    'tokens-schema',
    'pass',
    [
      `${names.size} token(s) declared, structurally valid (envelope, shapes, no duplicates); every required A1/A2/B-slot schema name is present (${getAllSchemaNames().length} schema names known).`,
    ],
    start,
  );
}

// ---------------------------------------------------------------------------
// Gate: link-smoke
// ---------------------------------------------------------------------------

const HREF_REGEX = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

function extractHrefs(html: string): string[] {
  const hrefs: string[] = [];
  HREF_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HREF_REGEX.exec(html)) !== null) {
    hrefs.push(match[1] ?? match[2] ?? '');
  }
  return hrefs;
}

function isExternalOrSpecialHref(href: string): boolean {
  if (href.length === 0) return true;
  if (href.startsWith('#')) return true;
  if (href.startsWith('//')) return true;
  return /^(?:https?|mailto|tel|data|javascript):/i.test(href);
}

/**
 * t8 fix-round (Sol HIGH-1 residue): walks every path SEGMENT from `root`
 * down to `target` (both absolute; `target` assumed already confirmed
 * lexically under `root`) and returns true if ANY segment along the way --
 * including `target` itself -- is a symlink. `lstat` on the final
 * component alone (the earlier fix-round's version) misses a symlinked
 * INTERMEDIATE directory, e.g. `href="linked-dir/nested/page.html"` where
 * `linked-dir` is the symlink, not `page.html`.
 */
function hasSymlinkInChain(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (relative === '') return false;
  const segments = relative.split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    } catch {
      return false; // does not exist -- the caller's own existence check handles this.
    }
  }
  return false;
}

async function runLinkSmokeGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const htmlFiles = listFilesRecursive(ctx.artifactDir, { extensions: ['.html', '.htm'] });
  if (htmlFiles.length === 0) {
    return finishDeterministic('link-smoke', 'skipped-not-applicable', [`no HTML files found under ${ctx.artifactDir}.`], start);
  }
  const broken: string[] = [];
  const skippedSymlinks: string[] = [];
  let checked = 0;
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    for (const href of extractHrefs(html)) {
      if (isExternalOrSpecialHref(href)) continue;
      checked++;
      const targetPath = (href.split('#')[0] ?? '').split('?')[0] ?? '';
      let resolved: string;
      try {
        resolved = path.resolve(path.dirname(file), decodeURIComponent(targetPath));
      } catch {
        broken.push(`${path.relative(ctx.artifactDir, file)}: href "${href}" is not a decodable path.`);
        continue;
      }
      const relativeToRoot = path.relative(ctx.artifactDir, resolved);
      if (relativeToRoot.startsWith('..')) {
        broken.push(`${path.relative(ctx.artifactDir, file)}: href "${href}" escapes the artifact directory.`);
        continue;
      }
      // t8 fix-round (Sol HIGH-1 residue): lstat on the FINAL path
      // component alone misses a symlink in an INTERMEDIATE directory
      // (e.g. href="linked-dir/nested/page.html" where "linked-dir" itself
      // is a symlink) -- walk every segment from the artifact root down to
      // the target and skip if ANY of them is a symlink, never just the
      // last one. Neither pass nor fail on a symlinked chain: skip it from
      // this gate's checked/broken accounting entirely, since "does the
      // symlink's own dirent exist" says nothing trustworthy about what it
      // (or an ancestor) points to.
      if (hasSymlinkInChain(ctx.artifactDir, resolved)) {
        skippedSymlinks.push(href);
        continue;
      }
      if (!fs.existsSync(resolved)) {
        broken.push(`${path.relative(ctx.artifactDir, file)}: href "${href}" -> missing target "${relativeToRoot}".`);
        continue;
      }
    }
  }
  if (broken.length > 0) {
    return finishDeterministic('link-smoke', 'fail', broken, start);
  }
  const symlinkNote = skippedSymlinks.length > 0 ? ` (${skippedSymlinks.length} symlinked target(s) skipped, neither checked nor followed)` : '';
  return finishDeterministic('link-smoke', 'pass', [`${checked} local href(s) across ${htmlFiles.length} HTML file(s) all resolve${symlinkNote}.`], start);
}

// ---------------------------------------------------------------------------
// Gate: form-smoke
// ---------------------------------------------------------------------------

const FORM_TAG_REGEX = /<form\b([^>]*)>/gi;
const ATTR_REGEX = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseTagAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_REGEX.exec(attrString)) !== null) {
    const name = (match[1] ?? '').toLowerCase();
    attrs[name] = match[2] ?? match[3] ?? '';
  }
  return attrs;
}

/** Heuristic "does anything handle submit" check across every JS file in
 * the artifact (inline `<script>` blocks are covered by the caller passing
 * the raw HTML text in too) -- deliberately NOT scoped per-form-id: a smoke
 * test's job is to catch the common bug of a totally handler-less form, not
 * to prove which script binds to which form. */
function hasSubmitJsHandler(text: string): boolean {
  return /addEventListener\(\s*['"]submit['"]/i.test(text) || /\.onsubmit\s*=/i.test(text);
}

async function runFormSmokeGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const htmlFiles = listFilesRecursive(ctx.artifactDir, { extensions: ['.html', '.htm'] });
  if (htmlFiles.length === 0) {
    return finishDeterministic('form-smoke', 'skipped-not-applicable', [`no HTML files found under ${ctx.artifactDir}.`], start);
  }
  const jsFiles = listFilesRecursive(ctx.artifactDir, { extensions: ['.js'] });
  const jsContent = jsFiles.map((file) => {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  });

  let formCount = 0;
  const problems: string[] = [];
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8');
    const combinedText = [html, ...jsContent].join('\n');
    FORM_TAG_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FORM_TAG_REGEX.exec(html)) !== null) {
      formCount++;
      const attrs = parseTagAttrs(match[1] ?? '');
      const hasActionAndMethod = attrs.action !== undefined && attrs.action.length > 0 && attrs.method !== undefined && attrs.method.length > 0;
      const hasInlineHandler = attrs.onsubmit !== undefined && attrs.onsubmit.length > 0;
      if (!hasActionAndMethod && !hasInlineHandler && !hasSubmitJsHandler(combinedText)) {
        const idAttr = attrs.id ? ` id="${attrs.id}"` : '';
        problems.push(`${path.relative(ctx.artifactDir, file)}: <form${idAttr}> has neither action+method nor an onsubmit/JS submit handler.`);
      }
    }
  }
  if (formCount === 0) {
    return finishDeterministic('form-smoke', 'skipped-not-applicable', [`no <form> elements found under ${ctx.artifactDir}.`], start);
  }
  if (problems.length > 0) {
    return finishDeterministic('form-smoke', 'fail', problems, start);
  }
  return finishDeterministic('form-smoke', 'pass', [`${formCount} form(s) each have action+method or a submit handler.`], start);
}

// ---------------------------------------------------------------------------
// Gate: axe
//
// t8 fix-round (Sol review HIGH-2): the artifact under audit is UNTRUSTED
// code (generated content, potentially attacker-influenced) executing
// inside a real Chromium the privileged daemon owns. Threat model this
// gate defends against, all inside ONE tightly-scoped BrowserContext:
//   1. Network egress -- the artifact must not reach the network at all.
//      `context.route('**/*', ...)` aborts everything except file:/data:/
//      blob:/about: URLs.
//   2. Filesystem read outside the artifact -- a `file://` reference
//      (absolute, or a relative `../` escape resolved by the browser) must
//      not read content outside the CANONICAL (symlink-resolved) artifact
//      root. Every file: request is realpath-checked before being allowed
//      through.
//   3. WebSockets -- `context.route()` does not intercept the WebSocket
//      handshake; `context.routeWebSocket('**', ...)` is registered
//      separately and closes every attempted connection immediately
//      (an unhandled registration already mocks the connection rather than
//      reaching a real server -- explicit `close()` denies even that).
//   4. WebRTC/STUN UDP egress (Sol review MED-3, fix-round): `context.
//      route()`/`routeWebSocket()` only intercept HTTP(S)/WS(S) requests --
//      an `RTCPeerConnection`'s ICE gathering opens raw UDP sockets to
//      STUN/TURN servers that never go through Playwright's request-routing
//      layer at all, so #1's network-egress block does not cover it. Closed
//      at the browser boundary instead: the single combined launch arg
//      `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`
//      (`AXE_GATE_WEBRTC_LAUNCH_ARGS` below -- see its own doc comment for
//      why this is ONE flag with the policy value attached, not two
//      separate flags) suppresses every non-proxied UDP candidate (STUN
//      reflexive and TURN relay both require exactly that), plus an
//      explicit empty `permissions: []` on the context (defense in depth;
//      does not by itself block ICE, which needs no permission grant).
//   5. Process sandbox (Sol review HIGH-2, fix-round): launched WITHOUT
//      `--no-sandbox` and with `chromiumSandbox: true` explicit -- the
//      artifact executes inside Chromium's OS-level renderer sandbox, not
//      merely behind request interception (which was never a process
//      isolation boundary; #1-#4 stop network/data access, not a renderer
//      exploit escaping to the host). A sandboxed launch failure reports
//      the gate 'unavailable' with the launch error -- it NEVER retries
//      unsandboxed; see the launch try/catch below.
//   6. Hangs -- "a page that hangs is a failing artifact," not a harness
//      problem: a navigation or `axe.run()` timeout is classified as a
//      gate FAILURE (with evidence naming the likely cause), never
//      'unavailable'. 'unavailable' is reserved for HARNESS problems only
//      (axe-core/playwright unresolvable, chromium failing to launch).
// ---------------------------------------------------------------------------

const AXE_WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

interface AxeInPageResult {
  violations: Array<{ id: string; impact: string | null; help: string; nodes: unknown[] }>;
}

/** Runs inside the page (serialized across the Playwright isolated-world
 * boundary by `page.evaluate`) -- must stay a standalone function, never a
 * closure over anything in this module. */
function runAxeInPage(tags: string[]): Promise<AxeInPageResult> {
  const w = globalThis as unknown as {
    axe: { run: (doc: unknown, opts: unknown) => Promise<AxeInPageResult> };
    document: unknown;
  };
  return w.axe.run(w.document, { runOnly: { type: 'tag', values: tags } });
}

function isLocalSafeNonFileUrl(rawUrl: string): boolean {
  return rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl.startsWith('about:');
}

/**
 * t8 fix-round (Sol HIGH-2 residue): races `promise` against a hard
 * `setTimeout` of `ms` -- unlike `page.setDefaultTimeout`, this actually
 * bounds calls (like `page.evaluate`/`page.addScriptTag`) that Playwright
 * itself never applies its default timeout to. The dangling underlying
 * promise (still resolving/rejecting later against a possibly-hung page)
 * is left to be garbage-collected once its context/browser closes; nothing
 * awaits it further after this function returns.
 */
function withHardTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`operation exceeded ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Sol review MED-3 (fix-round): exported (not an inline literal in
 * `runAxeGate`) so the egress regression test can launch Chromium with the
 * SAME hardened args this gate actually uses in production and prove
 * WebRTC/STUN ICE gathering is really blocked, instead of asserting against
 * a hand-retyped copy of the flags that could silently drift from what
 * `runAxeGate` itself passes to `chromium.launch()`.
 *
 * `--force-webrtc-ip-handling-policy` takes the policy value directly
 * (`=disable_non_proxied_udp`), NOT as a separate boolean flag alongside a
 * plain `--webrtc-ip-handling-policy=...` -- empirically verified against
 * this repo's actual installed Chromium build (a real `RTCPeerConnection`
 * against a live STUN server produced a `srflx` candidate, i.e. a real
 * network round trip, with the two-separate-flags form; the combined single
 * flag below produces none).
 */
export const AXE_GATE_WEBRTC_LAUNCH_ARGS = ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] as const;

async function runAxeGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const entryHtml = findEntryHtmlFile(ctx.artifactDir);
  if (!entryHtml) {
    return finishDeterministic(
      'axe',
      'unavailable',
      [`no HTML entry file found under ${ctx.artifactDir} -- axe requires a renderable HTML document (looked for index.html, then the first *.html file).`],
      start,
    );
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = resolveCanonicalDir(ctx.artifactDir);
  } catch (err) {
    return finishDeterministic('axe', 'unavailable', [`artifact directory is not resolvable: ${errorMessage(err)}`], start);
  }

  let axeSource: string;
  try {
    axeSource = fs.readFileSync(require_.resolve('axe-core/axe.min.js'), 'utf8');
  } catch (err) {
    return finishDeterministic('axe', 'unavailable', [`axe-core is not resolvable in this environment: ${errorMessage(err)}`], start);
  }

  let browser: Browser;
  try {
    // Sol review HIGH-2 (fix-round): NO `--no-sandbox` -- that flag disables
    // Chromium's OS-level renderer sandbox entirely, and request
    // interception (this gate's #1-#4 defenses) is not a substitute for
    // process isolation against a compromised renderer. `chromiumSandbox:
    // true` is explicit (not merely the absence of the disabling flag) so a
    // future edit can never silently reintroduce `--no-sandbox` without
    // also having to remove this line. A launch failure here (some sandboxed
    // environments genuinely cannot support the Chromium sandbox, e.g.
    // certain unprivileged containers) reports the gate 'unavailable' with
    // the real launch error -- it never falls back to an unsandboxed
    // relaunch, which would silently trade this gate's entire process-
    // isolation guarantee for availability.
    //
    // Sol review MED-3 (fix-round): AXE_GATE_WEBRTC_LAUNCH_ARGS closes the
    // WebRTC/STUN UDP egress path -- see this gate's threat-model comment
    // above (point 4) for why `context.route()` cannot see it at all (ICE
    // gathering is raw UDP, never an HTTP(S)/WS(S) request), and that
    // constant's own doc comment for why it is one combined flag.
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
      args: [...AXE_GATE_WEBRTC_LAUNCH_ARGS],
    });
  } catch (err) {
    return finishDeterministic('axe', 'unavailable', [`chromium failed to launch: ${errorMessage(err)}`], start);
  }

  try {
    // Sol review MED-3 (fix-round): `permissions: []` is explicit defense
    // in depth alongside the launch-arg WebRTC restriction above -- it does
    // not by itself stop ICE gathering (which needs no permission grant),
    // but it does ensure this context can never be handed a camera/
    // microphone/other capability an artifact could otherwise combine with
    // WebRTC, and documents the intent for any future reader/editor of this
    // context's configuration.
    const context = await browser.newContext({ permissions: [] });

    await context.route('**/*', (route: Route) => {
      const reqUrl = route.request().url();
      if (reqUrl.startsWith('file:')) {
        let realTarget: string;
        try {
          realTarget = fs.realpathSync(fileURLToPath(reqUrl));
        } catch {
          return route.abort();
        }
        return isWithinCanonicalRoot(canonicalRoot, realTarget) ? route.continue() : route.abort();
      }
      if (isLocalSafeNonFileUrl(reqUrl)) return route.continue();
      return route.abort();
    });

    // context.route() above does not intercept the WebSocket handshake --
    // block it separately. Not calling connectToServer() inside the
    // handler already means the connection is mocked, never reaching a
    // real server; closing it immediately denies the artifact even that
    // mocked channel.
    await context.routeWebSocket('**', (ws) => {
      void ws.close();
    });

    const page = await context.newPage();
    page.setDefaultTimeout(ctx.timeoutMs);

    try {
      await page.goto(pathToFileURL(entryHtml).href, { timeout: ctx.timeoutMs, waitUntil: 'load' });
    } catch (err) {
      return finishDeterministic(
        'axe',
        'fail',
        [`the artifact did not finish loading within ${ctx.timeoutMs}ms -- a hang or infinite loop in the artifact's own script is the most likely cause (a harness/launch problem would have failed earlier, as 'unavailable'): ${errorMessage(err)}`],
        start,
      );
    }

    // t8 fix-round (Sol HIGH-2 residue): `page.setDefaultTimeout` above
    // does NOT bound `page.evaluate`/`page.addScriptTag` -- Playwright's
    // "default timeout" only applies to actions with a documented
    // `timeout` option (navigation, waiting, locator actions); an
    // in-page script that starts busy-looping AFTER `page.goto` already
    // resolved (so the earlier fix-round's goto-timeout branch never
    // fires) can otherwise hang `evaluate` forever. Both calls are raced
    // against the gate's own timeout budget; a race-loss explicitly
    // closes the CONTEXT (not just relying on the outer `finally`'s
    // `browser.close()`) before classifying the result as a gate FAILURE
    // -- an artifact-induced hang, never 'unavailable'.
    try {
      await withHardTimeout(page.addScriptTag({ content: axeSource }), ctx.timeoutMs);
    } catch (err) {
      await context.close().catch(() => {});
      return finishDeterministic(
        'axe',
        'fail',
        [`the artifact's script blocked axe-core injection for longer than ${ctx.timeoutMs}ms -- a hang or infinite loop in the artifact's own script is the most likely cause: ${errorMessage(err)}`],
        start,
      );
    }

    let result: AxeInPageResult;
    try {
      result = await withHardTimeout(page.evaluate(runAxeInPage, [...AXE_WCAG_AA_TAGS]), ctx.timeoutMs);
    } catch (err) {
      await context.close().catch(() => {});
      return finishDeterministic(
        'axe',
        'fail',
        [`axe.run() did not complete within ${ctx.timeoutMs}ms -- a hang or infinite loop in the artifact's own script is the most likely cause: ${errorMessage(err)}`],
        start,
      );
    }

    const violations = result.violations ?? [];
    if (violations.length > 0) {
      const evidence = violations.slice(0, 10).map((v) => `${v.id} (impact=${v.impact ?? 'unknown'}): ${v.help} -- ${v.nodes.length} node(s)`);
      return finishDeterministic('axe', 'fail', evidence, start);
    }
    return finishDeterministic(
      'axe',
      'pass',
      [`0 accessibility violations scanning ${entryHtml} (WCAG 2.1 AA; network egress blocked, file: access confined to the canonical artifact root, WebSockets blocked).`],
      start,
    );
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Gate: lighthouse-ci ('unavailable' -- @lhci/cli is not a dependency of
// this workspace and no lighthouserc config exists anywhere in the repo,
// verified at the time this tranche was written).
// ---------------------------------------------------------------------------

const LIGHTHOUSE_CONFIG_NAMES = ['lighthouserc.js', 'lighthouserc.json', 'lighthouserc.cjs', '.lighthouserc.js', '.lighthouserc.json'];

async function runLighthouseCiGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  let lhciResolvable = true;
  try {
    require_.resolve('@lhci/cli/package.json');
  } catch {
    lhciResolvable = false;
  }
  const hasConfig = LIGHTHOUSE_CONFIG_NAMES.some((name) => fs.existsSync(path.join(ctx.artifactDir, name)));
  if (!lhciResolvable || !hasConfig) {
    return finishDeterministic(
      'lighthouse-ci',
      'unavailable',
      [
        !lhciResolvable
          ? '@lhci/cli is not installed anywhere in this workspace.'
          : `@lhci/cli is installed but no Lighthouse CI config was found under ${ctx.artifactDir}.`,
      ],
      start,
    );
  }
  // Reached only once BOTH the dependency and a config exist -- neither is
  // true in this repo today (see this gate's own header note), so this
  // branch is intentionally not implemented further: a future tranche that
  // adds @lhci/cli as a real dependency replaces this with a real
  // `lhci autorun` invocation without changing this gate's id/contract.
  return finishDeterministic('lighthouse-ci', 'unavailable', ['Lighthouse CI is configured but this gate has no runner wired yet.'], start);
}

// ---------------------------------------------------------------------------
// Gate: supabase-migration-dry-run
// ---------------------------------------------------------------------------

async function runSupabaseMigrationDryRunGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  const migrationsDir = path.join(ctx.artifactDir, 'supabase', 'migrations');
  let migrationFiles: string[] = [];
  try {
    migrationFiles = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
  } catch {
    migrationFiles = [];
  }
  if (migrationFiles.length === 0) {
    return finishDeterministic(
      'supabase-migration-dry-run',
      'skipped-not-applicable',
      [`no supabase/migrations/*.sql found under ${ctx.artifactDir} -- this gate applies to app builds with Supabase migrations only.`],
      start,
    );
  }
  // Deliberately never executes a live dry-run: doing so needs a linked/
  // live Supabase project (network) and could carry side effects a
  // deterministic, side-effect-free gate must not risk -- plan §3.2 L3
  // frames this class as cascade-trigger-safe precisely because it is
  // otherwise side-effect-free. A future tranche that wires an
  // offline-safe dry-run harness (e.g. a local Postgres via
  // `supabase start`) can replace this 'unavailable' with a real pass/fail
  // without changing this gate's id or calling contract.
  return finishDeterministic(
    'supabase-migration-dry-run',
    'unavailable',
    [
      `${migrationFiles.length} migration file(s) found, but this gate does not attempt a live/linked dry-run (would require network access and a project link) -- wire an offline-safe dry-run harness before promoting this gate beyond 'unavailable'.`,
    ],
    start,
  );
}

// ---------------------------------------------------------------------------
// Gate: screenshot-ssim (see the SSIM baseline lifecycle section below for
// the lifecycle store this gate reads).
// ---------------------------------------------------------------------------

async function runScreenshotSsimGate(ctx: GateContext): Promise<DeterministicGateResult> {
  const start = performance.now();
  if (ctx.buildId === null) {
    return finishDeterministic(
      'screenshot-ssim',
      'skipped-not-applicable',
      ['no buildId supplied -- SSIM baselines are scoped per build; non-build-scoped work has nothing to baseline against.'],
      start,
    );
  }
  if (!ctx.db) {
    return finishDeterministic('screenshot-ssim', 'unavailable', ['no database handle supplied -- cannot read/write the SSIM baseline lifecycle table.'], start);
  }
  if (!ctx.ssim?.screenshotPath) {
    return finishDeterministic('screenshot-ssim', 'unavailable', ['no screenshot supplied for this render -- SSIM comparison requires a rendered screenshot path.'], start);
  }
  const state = baselineState(ctx.db, ctx.buildId, ctx.ssim.tokenFreezeVersion);
  if (state === 'no-baseline-bootstrap') {
    return finishDeterministic(
      'screenshot-ssim',
      'unavailable',
      [
        `lifecycle state: no-baseline-bootstrap for build "${ctx.buildId}" -- this is the first render (or the token freeze revised); every OTHER deterministic gate must pass before this render can bootstrap a baseline (WR-routing.md Screenshot-baseline rules, step 1).`,
      ],
      start,
    );
  }
  if (state === 'negative-control-pending') {
    return finishDeterministic(
      'screenshot-ssim',
      'unavailable',
      [
        `lifecycle state: negative-control-pending for build "${ctx.buildId}" -- a candidate baseline is awaiting negative-control calibration (step 2); the SSIM gate stays inactive until a perturbed variant scores below the floor.`,
      ],
      start,
    );
  }
  const record = getSsimBaselineRow(ctx.db, ctx.buildId);
  if (!record?.baseline_screenshot_path) {
    return finishDeterministic(
      'screenshot-ssim',
      'unavailable',
      ['baseline marked active but no baseline screenshot path is recorded -- storage-contract violation, treated as unavailable rather than fabricating a comparison.'],
      start,
    );
  }
  const floor = ctx.ssim.floorOverride ?? DEFAULT_SSIM_FLOOR;
  let similarity: number;
  try {
    similarity = await compareScreenshotsSimilarity(record.baseline_screenshot_path, ctx.ssim.screenshotPath);
  } catch (err) {
    return finishDeterministic('screenshot-ssim', 'unavailable', [`screenshot comparison failed: ${errorMessage(err)}`], start);
  }
  const pass = similarity >= floor;
  return finishDeterministic(
    'screenshot-ssim',
    pass ? 'pass' : 'fail',
    [`similarity ${similarity.toFixed(4)} ${pass ? '>=' : '<'} floor ${floor} against baseline "${record.baseline_screenshot_path}".`],
    start,
  );
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const DETERMINISTIC_GATE_DEFINITIONS: Record<DeterministicGateId, DeterministicGateDefinition> = {
  'ts-compile': {
    id: 'ts-compile',
    class: 'deterministic',
    label: 'TypeScript compile',
    description: 'tsc --noEmit against the artifact\'s own tsconfig.json. skipped-not-applicable when the artifact has no .ts/.tsx files.',
    run: runTsCompileGate,
  },
  eslint: {
    id: 'eslint',
    class: 'deterministic',
    label: 'ESLint',
    description: 'eslint . --format json. unavailable in this repo today (ESLint is not installed anywhere in this monorepo).',
    run: runEslintGate,
  },
  'design-md-lint': {
    id: 'design-md-lint',
    class: 'deterministic',
    label: 'design.md lint',
    description: '@google/design.md lint --format json DESIGN.md. skipped-not-applicable when no DESIGN.md is present; unavailable when the tool is not installed.',
    run: runDesignMdLintGate,
  },
  'tokens-schema': {
    id: 'tokens-schema',
    class: 'deterministic',
    label: 'Design tokens schema',
    description: 'Validates design-tokens.json against @open-design/contracts\' TOKEN_SCHEMA (required A1/A2 names).',
    run: runTokensSchemaGate,
  },
  'link-smoke': {
    id: 'link-smoke',
    class: 'deterministic',
    label: 'Link smoke',
    description: 'Parses every local href across the artifact\'s HTML files and checks the target exists on disk.',
    run: runLinkSmokeGate,
  },
  'form-smoke': {
    id: 'form-smoke',
    class: 'deterministic',
    label: 'Form smoke',
    description: 'Every <form> has action+method or a submit JS handler.',
    run: runFormSmokeGate,
  },
  axe: {
    id: 'axe',
    class: 'deterministic',
    label: 'Accessibility (axe)',
    description: 'WCAG 2.1 AA scan via the daemon\'s existing Playwright/axe-core harness.',
    run: runAxeGate,
  },
  'lighthouse-ci': {
    id: 'lighthouse-ci',
    class: 'deterministic',
    label: 'Lighthouse CI budgets',
    description: 'Core Web Vitals budget check via @lhci/cli. unavailable in this repo today (not a dependency, no config).',
    run: runLighthouseCiGate,
  },
  'screenshot-ssim': {
    id: 'screenshot-ssim',
    class: 'deterministic',
    label: 'Screenshot SSIM vs baseline',
    description: 'Per-build screenshot similarity vs the active baseline, per WR-routing.md\'s bootstrap -> negative-control -> promotion -> steady-state lifecycle.',
    run: runScreenshotSsimGate,
  },
  'supabase-migration-dry-run': {
    id: 'supabase-migration-dry-run',
    class: 'deterministic',
    label: 'Supabase migration dry-run',
    description: 'For app builds carrying supabase/migrations. unavailable by design today -- a live dry-run needs a linked project (network + side-effect risk a deterministic gate must not assume).',
    run: runSupabaseMigrationDryRunGate,
  },
};

export const STOCHASTIC_GATE_DEFINITIONS: Record<StochasticGateId, StochasticGateDefinition> = {
  'vision-conformance': {
    id: 'vision-conformance',
    class: 'stochastic',
    label: 'Vision-model DESIGN.md conformance',
    description: 'Advisory vision-model comparison of a render against DESIGN.md. Reported to the human ship gate; never auto-escalates (plan §3.2 L3).',
  },
  'review-panel-prose': {
    id: 'review-panel-prose',
    class: 'stochastic',
    label: 'Review-panel prose findings',
    description: 'Advisory human/model review-panel prose findings. Reported to the human ship gate; never auto-escalates (plan §3.2 L3).',
  },
};

export const DETERMINISTIC_GATE_IDS: readonly DeterministicGateId[] = Object.keys(DETERMINISTIC_GATE_DEFINITIONS) as DeterministicGateId[];
export const STOCHASTIC_GATE_IDS: readonly StochasticGateId[] = Object.keys(STOCHASTIC_GATE_DEFINITIONS) as StochasticGateId[];

export const GATE_REGISTRY: readonly GateDefinition[] = [
  ...Object.values(DETERMINISTIC_GATE_DEFINITIONS),
  ...Object.values(STOCHASTIC_GATE_DEFINITIONS),
];

// ---------------------------------------------------------------------------
// runGates
// ---------------------------------------------------------------------------

const DEFAULT_GATE_TIMEOUT_MS = 30_000;

export interface RunGatesOptions {
  buildId?: string | null;
  db?: Database.Database;
  ssim?: GateContext['ssim'];
  timeoutMs?: number;
}

/**
 * Executes the SELECTED deterministic gates, in order, against a lane-A
 * artifact directory. Only deterministic gate ids are accepted -- a
 * stochastic id (or any unknown id) is a `GateSelectionError`, never
 * silently skipped, per this task's "definitions only for stochastic"
 * discipline (there is no `run()` to call for one in the first place).
 */
export async function runGates(
  artifactDir: string,
  gateSelection: readonly DeterministicGateId[] | 'all',
  opts: RunGatesOptions = {},
): Promise<DeterministicGateResult[]> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(artifactDir);
  } catch (err) {
    throw new GateRunnerInputError(`artifactDir "${artifactDir}" does not exist or is not accessible: ${errorMessage(err)}`);
  }
  if (!stat.isDirectory()) {
    throw new GateRunnerInputError(`artifactDir "${artifactDir}" is not a directory.`);
  }

  const ids = gateSelection === 'all' ? DETERMINISTIC_GATE_IDS : gateSelection;
  if (ids.length === 0) {
    throw new GateRunnerInputError('gateSelection must name at least one deterministic gate id.');
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new GateSelectionError(`duplicate gate id "${id}" in gateSelection.`);
    seen.add(id);
    if (!(id in DETERMINISTIC_GATE_DEFINITIONS)) {
      throw new GateSelectionError(
        `"${id}" is not a deterministic gate id -- stochastic gates (${STOCHASTIC_GATE_IDS.join(', ')}) have no run() and cannot be executed by runGates.`,
      );
    }
  }

  const ctx: GateContext = {
    artifactDir,
    buildId: opts.buildId ?? null,
    timeoutMs: opts.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS,
    ...(opts.db ? { db: opts.db } : {}),
    ...(opts.ssim ? { ssim: opts.ssim } : {}),
  };

  const results: DeterministicGateResult[] = [];
  for (const id of ids) {
    results.push(await DETERMINISTIC_GATE_DEFINITIONS[id].run(ctx));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Cascade classification (plan §3.2 L3: cheap -> mid -> frontier escalation
// ONLY on deterministic failures)
// ---------------------------------------------------------------------------

export type EscalationTier = 'cheap' | 'mid' | 'frontier';

/** Exported (t8 fix-round, Sol HIGH-5 residue): `apps/daemon/src/routes/
 * routing.ts` needs this SAME ladder-stepping logic to compute, server-
 * side, which tier's verification cost to price NEXT -- duplicating it at
 * the route layer would risk the two falling out of sync with
 * `classifyCascadeTrigger`'s own stepping. */
export function nextEscalationTier(tier: EscalationTier): EscalationTier {
  if (tier === 'cheap') return 'mid';
  return 'frontier';
}

/**
 * t8 fix-round (Sol HIGH-5 residue): the SERVER-DERIVED price of one
 * model-based re-verification attempt at `tier`, read from
 * `policy.budgetCeilings.verificationCostPerTierUsd` when configured, else
 * a conservative hardcoded default -- replaces the earlier client-supplied
 * `nextEstimatedVerificationCostUsd`, which defaulted to `0` and let a
 * caller understate (or entirely skip) persisted gate-tax spend. Only
 * `apps/daemon/src/routes/routing.ts`'s HTTP route calls this; the pure
 * `classifyCascadeTrigger` below still accepts a plain
 * `nextEstimatedVerificationCostUsd` number so it stays table-testable
 * without a policy object in scope.
 */
const DEFAULT_VERIFICATION_COST_PER_TIER_USD: Record<EscalationTier, number> = {
  cheap: 0.05,
  mid: 0.25,
  frontier: 1.5,
};

export function verificationCostForTierUsd(policy: RoutingPolicyDocument, tier: EscalationTier): number {
  const configured = policy.budgetCeilings.verificationCostPerTierUsd;
  if (configured && isFiniteNonNegative(configured[tier])) {
    return configured[tier];
  }
  return DEFAULT_VERIFICATION_COST_PER_TIER_USD[tier];
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export interface CascadeClassification {
  escalate: boolean;
  tier: EscalationTier;
  triggeringGates: DeterministicGateId[];
  reason: string;
  /** Gate-tax cap surfaced explicitly (this task's brief: "over cap -> no
   * further model-based verification, surfaced explicitly") -- `capUsd:
   * null` means no cap was supplied (gate-tax not evaluated), never an
   * implicit zero cap. */
  gateTax: { capUsd: number | null; spentUsd: number; overCap: boolean };
}

export interface ClassifyCascadeTriggerInput {
  gateResults: readonly DeterministicGateResult[];
  /** The tier the CURRENT attempt already ran at. Defaults to `'cheap'`
   * (the first attempt on the ladder).
   *
   * Sol HIGH-5 (t8 fix-round): this pure function still ACCEPTS a caller-
   * supplied tier/spend (keeps it table-testable, no I/O) -- what changed
   * is that `apps/daemon/src/routes/routing.ts`'s HTTP route no longer
   * SOURCES these two fields from client request-body input. The route
   * reads them from server-persisted state (`getGateCascadeState`, keyed
   * by `buildId`) instead, so a caller can no longer evade the frontier
   * ceiling or the gate-tax cap by simply asserting "I'm still at cheap"
   * or "I haven't spent anything yet" on every request. */
  currentTier?: EscalationTier;
  /** `RoutingPolicyBudgetCeilings#gateTaxCapUsd` -- `null`/`undefined` means
   * no cap configured. */
  gateTaxCapUsd?: number | null;
  /** Cumulative gate-triggered verifier spend for this build so far. */
  gateSpendSoFarUsd?: number;
  /**
   * t8 fix-round (Sol HIGH-5): an estimate of what the NEXT escalation
   * tier's model-based re-verification would cost, checked against the
   * remaining gate-tax budget the same way `admission.ts` checks a
   * dispatch's estimated cost against its caps. Defaults to `0` (checks
   * only whether spend-so-far already exceeds the cap).
   */
  nextEstimatedVerificationCostUsd?: number;
  /** Reuses `RoutingPolicyBudgetCeilings#headroomFraction` (t6's
   * convention, `admission.ts`'s `headroomFractionOf`) -- defaults to `0`
   * (no margin) when omitted. */
  headroomFraction?: number;
}

/**
 * `spent + nextEstimate <= cap * (1 - headroomFraction)` -- reuses
 * `admission.ts`'s `admitsUnderCap` formula verbatim (Sol HIGH-5:
 * "consistent with t6's convention"), rather than a bespoke `spent > cap`
 * comparison. With `nextEstimatedVerificationCostUsd` and
 * `headroomFraction` both omitted (their `0` defaults), this reduces to
 * exactly the pre-fix-round check (`spent <= cap`), so every pre-existing
 * gate-tax boundary test keeps its original meaning.
 */
function evaluateGateTax(
  capUsd: number | null | undefined,
  spentUsd: number,
  nextEstimateUsd: number,
  headroomFraction: number,
): CascadeClassification['gateTax'] {
  if (capUsd === undefined || capUsd === null) {
    return { capUsd: null, spentUsd, overCap: false };
  }
  return { capUsd, spentUsd, overCap: !admitsUnderCap(capUsd, spentUsd, headroomFraction, nextEstimateUsd) };
}

/**
 * Classifies whether a set of deterministic gate results should trigger a
 * cheap->mid->frontier escalation.
 *
 * Runtime + type-level enforcement (this task's brief): every element of
 * `gateResults` is verified at RUNTIME to carry `class === 'deterministic'`
 * -- not merely trusted from the parameter's declared TS type, which a
 * caller could defeat with a cast. A stochastic result reaching this
 * function is a `GateClassificationError`, always, because stochastic gate
 * outcomes are advisory-only per plan §3.2 L3 ("never auto-escalate").
 *
 * `'unavailable'`/`'skipped-not-applicable'` never trigger escalation --
 * only `'fail'` does. Gate-tax is checked BEFORE the tier steps: an
 * over-cap build reports `escalate: false` even with real failing gates,
 * because "no further model-based verification" is exactly what the cap
 * means (the failures are still surfaced in `triggeringGates`, never
 * silently dropped). At the `'frontier'` tier, a failure still reports
 * `escalate: false` (there is nowhere higher to go) but keeps
 * `tier: 'frontier'` and lists the triggering gates, so a caller can tell
 * "gates failed and we're already at the ceiling" apart from "gates
 * passed."
 */
export function classifyCascadeTrigger(input: ClassifyCascadeTriggerInput): CascadeClassification {
  const currentTier = input.currentTier ?? 'cheap';

  for (const result of input.gateResults) {
    const cls: unknown = (result as { class: unknown }).class;
    if (cls !== 'deterministic') {
      throw new GateClassificationError(
        `classifyCascadeTrigger received a non-deterministic gate result (id="${result.id}", class="${String(cls)}") -- stochastic gate outcomes are advisory-only and must never feed the escalation decision (plan §3.2 L3).`,
      );
    }
  }

  const gateTax = evaluateGateTax(
    input.gateTaxCapUsd,
    input.gateSpendSoFarUsd ?? 0,
    input.nextEstimatedVerificationCostUsd ?? 0,
    input.headroomFraction ?? 0,
  );
  const failing = input.gateResults.filter((r) => r.status === 'fail');
  const triggeringGates = failing.map((r) => r.id);

  if (failing.length === 0) {
    return { escalate: false, tier: currentTier, triggeringGates: [], reason: 'no deterministic gate failures -- no cascade trigger.', gateTax };
  }

  if (gateTax.overCap) {
    return {
      escalate: false,
      tier: currentTier,
      triggeringGates,
      reason: `gate-tax cap ($${gateTax.capUsd}) already exceeded (spent $${gateTax.spentUsd}) -- no further model-based verification is permitted despite ${triggeringGates.length} failing deterministic gate(s): ${triggeringGates.join(', ')}.`,
      gateTax,
    };
  }

  const atCeiling = currentTier === 'frontier';
  const nextTier = nextEscalationTier(currentTier);
  return {
    escalate: !atCeiling,
    tier: atCeiling ? currentTier : nextTier,
    triggeringGates,
    reason: atCeiling
      ? `${triggeringGates.length} deterministic gate(s) failed at the frontier tier (${triggeringGates.join(', ')}) -- already at the top of the cheap->mid->frontier ladder, no higher tier to escalate to.`
      : `${triggeringGates.length} deterministic gate(s) failed (${triggeringGates.join(', ')}) -- escalating ${currentTier} -> ${nextTier}.`,
    gateTax,
  };
}

// ---------------------------------------------------------------------------
// Cascade state persistence (t8 fix-round, Sol HIGH-5): "current tier +
// cumulative gate spend live in the daemon," per build. The HTTP route
// takes ONLY a `buildId` for authorization purposes -- it reads this table
// to resolve `currentTier`/`gateSpendSoFarUsd` server-side rather than
// trusting a client-supplied value, closing the frontier-ceiling/gate-tax
// evasion HIGH-5 describes (a caller could otherwise always claim "cheap"
// and "$0 spent" on every request).
// ---------------------------------------------------------------------------

const ROUTING_GATE_CASCADE_STATE_DDL = `
    CREATE TABLE IF NOT EXISTS routing_gate_cascade_state (
      build_id TEXT PRIMARY KEY,
      tier TEXT NOT NULL,
      spent_usd REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
`;

export function ensureGateCascadeStateTable(db: Database.Database): void {
  db.exec(ROUTING_GATE_CASCADE_STATE_DDL);
}

export interface GateCascadeState {
  tier: EscalationTier;
  spentUsd: number;
}

function isEscalationTierValue(value: string): value is EscalationTier {
  return value === 'cheap' || value === 'mid' || value === 'frontier';
}

/** Defaults to `{ tier: 'cheap', spentUsd: 0 }` for a build with no
 * recorded state -- the first-ever cascade classification for a build
 * always starts at the bottom of the ladder with nothing spent. */
export function getGateCascadeState(db: Database.Database, buildId: string): GateCascadeState {
  ensureGateCascadeStateTable(db);
  const row = db.prepare(`SELECT tier, spent_usd FROM routing_gate_cascade_state WHERE build_id = ?`).get(buildId) as
    | { tier: string; spent_usd: number }
    | undefined;
  if (!row) return { tier: 'cheap', spentUsd: 0 };
  return { tier: isEscalationTierValue(row.tier) ? row.tier : 'cheap', spentUsd: row.spent_usd };
}

/**
 * Persists a cascade advance: sets the tier to `newTier` and ADDS
 * `spentDeltaUsd` (never subtracts -- spend is monotonic) to the running
 * total. The caller (the HTTP route) calls this ONLY when
 * `classifyCascadeTrigger` actually returned `escalate: true` for this
 * build -- an over-cap or already-at-ceiling classification must never
 * advance the persisted tier or add to spend, since nothing was actually
 * escalated in that case.
 */
export function advanceGateCascadeState(
  db: Database.Database,
  buildId: string,
  newTier: EscalationTier,
  spentDeltaUsd: number,
  now: Date = new Date(),
): GateCascadeState {
  ensureGateCascadeStateTable(db);
  const current = getGateCascadeState(db, buildId);
  const nextSpentUsd = current.spentUsd + Math.max(0, spentDeltaUsd);
  db.prepare(
    `INSERT INTO routing_gate_cascade_state (build_id, tier, spent_usd, updated_at)
     VALUES (@buildId, @tier, @spentUsd, @now)
     ON CONFLICT(build_id) DO UPDATE SET tier = excluded.tier, spent_usd = excluded.spent_usd, updated_at = excluded.updated_at`,
  ).run({ buildId, tier: newTier, spentUsd: nextSpentUsd, now: now.toISOString() });
  return { tier: newTier, spentUsd: nextSpentUsd };
}

// ---------------------------------------------------------------------------
// Telemetry recording
// ---------------------------------------------------------------------------

/**
 * Maps a run's `GateResult[]` (deterministic AND stochastic -- recording is
 * pure persistence, not escalation, so both classes may be recorded here
 * even though only deterministic results may ever reach
 * `classifyCascadeTrigger`) onto the telemetry row's `gateOutcomes` map and
 * persists it, together with whether THIS cascade classification escalated,
 * via `telemetry.ts`'s `updateGateOutcomes` (Sol review MED-4: escalated
 * must reach the row atomically alongside gateOutcomes, or an attached
 * run's real gate-driven escalations never surface in the rates the
 * telemetry table exists to report).
 */
export function recordGateOutcomes(
  db: Database.Database,
  runId: string,
  attempt: number,
  results: readonly GateResult[],
  escalated: boolean,
): void {
  const outcomes: Record<string, RoutingGateOutcome> = {};
  for (const result of results) {
    outcomes[result.id] = result.status;
  }
  updateGateOutcomes(db, runId, attempt, outcomes, escalated);
}

// ---------------------------------------------------------------------------
// SSIM baseline lifecycle (WR-routing.md "Screenshot-baseline rules",
// frozen at the P0 tranche): bootstrap -> negative-control-pending ->
// active. A token-freeze revision invalidates an active/pending baseline
// and re-enters bootstrap.
// ---------------------------------------------------------------------------

export type SsimLifecycleState = 'no-baseline-bootstrap' | 'negative-control-pending' | 'active';

export const DEFAULT_SSIM_FLOOR = 0.98;

const ROUTING_SSIM_BASELINES_DDL = `
    CREATE TABLE IF NOT EXISTS routing_ssim_baselines (
      build_id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      baseline_screenshot_path TEXT,
      token_freeze_version TEXT,
      negative_control_passed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
`;

export function ensureSsimBaselinesTable(db: Database.Database): void {
  db.exec(ROUTING_SSIM_BASELINES_DDL);
}

interface SsimBaselineDbRow {
  build_id: string;
  state: string;
  baseline_screenshot_path: string | null;
  token_freeze_version: string | null;
  negative_control_passed: number;
  updated_at: string;
}

function getSsimBaselineRow(db: Database.Database, buildId: string): SsimBaselineDbRow | null {
  ensureSsimBaselinesTable(db);
  return (db.prepare(`SELECT * FROM routing_ssim_baselines WHERE build_id = ?`).get(buildId) as SsimBaselineDbRow | undefined) ?? null;
}

function isSsimLifecycleState(value: string): value is SsimLifecycleState {
  return value === 'no-baseline-bootstrap' || value === 'negative-control-pending' || value === 'active';
}

/**
 * Reads a build's current SSIM lifecycle state. Defaults to
 * `'no-baseline-bootstrap'` for a build with no row at all.
 *
 * `currentTokenFreezeVersion`, when supplied and DIFFERENT from the stored
 * baseline's freeze version, auto-invalidates the baseline (deletes the
 * row) and reports `'no-baseline-bootstrap'` -- this is WR-routing.md step
 * 3's "a token-freeze revision invalidates its baseline; the next render
 * under the revised freeze re-enters bootstrap at step 1," applied at READ
 * time so no separate explicit "invalidate" call is required on every
 * freeze bump (a caller that wants to force invalidation without knowing
 * the new version can still call `invalidateSsimBaseline` directly).
 */
export function baselineState(db: Database.Database, buildId: string, currentTokenFreezeVersion?: string): SsimLifecycleState {
  const row = getSsimBaselineRow(db, buildId);
  if (!row) return 'no-baseline-bootstrap';
  if (currentTokenFreezeVersion !== undefined && row.token_freeze_version !== null && row.token_freeze_version !== currentTokenFreezeVersion) {
    invalidateSsimBaseline(db, buildId);
    return 'no-baseline-bootstrap';
  }
  return isSsimLifecycleState(row.state) ? row.state : 'no-baseline-bootstrap';
}

export function invalidateSsimBaseline(db: Database.Database, buildId: string): void {
  ensureSsimBaselinesTable(db);
  db.prepare(`DELETE FROM routing_ssim_baselines WHERE build_id = ?`).run(buildId);
}

export interface RecordBootstrapBaselineInput {
  buildId: string;
  screenshotPath: string;
  tokenFreezeVersion: string;
  /**
   * t8 fix-round (Sol HIGH-4b): SERVER-SIDE proof that "every OTHER
   * deterministic L3 gate cleared" (WR-routing.md step 1) -- every
   * `DeterministicGateResult` from the SAME candidate render, other than
   * `screenshot-ssim` itself. This function verifies EVERY entry is
   * `'pass'` before ever writing a row; a caller cannot assert "the other
   * gates passed" with a bare boolean, it must supply the actual computed
   * results (typically the same array `runGates` just returned for this
   * render) so the check is against what was ACTUALLY measured, never a
   * client-declared claim.
   */
  siblingGateResults: readonly DeterministicGateResult[];
  now?: Date;
}

/**
 * Step 1 -> 2: promotion out of bootstrap is SERVER-ENFORCED (Sol
 * HIGH-4b), not trusted -- every `siblingGateResults` entry (excluding
 * `screenshot-ssim` itself, which has nothing to compare against yet) must
 * be `'pass'`; anything else (a real failure, an 'unavailable', a
 * 'skipped-not-applicable') refuses bootstrap and reports exactly which
 * gate(s) blocked it, per WR-routing.md step 1 ("a render that fails any
 * of those is not eligible to become a baseline"). Also throws if a
 * baseline record already exists for this build: bootstrap is a one-time
 * no-baseline -> negative-control-pending transition, not an overwrite --
 * a deliberate re-baseline goes through `invalidateSsimBaseline` first.
 *
 * Scope note: this function (and `runNegativeControlCheck` below) is
 * PROGRAMMATIC-ONLY -- neither is reachable from `POST
 * /api/routing/gates/run`. The HTTP route runs gates and reports the
 * current lifecycle state, but never drives a bootstrap/calibration
 * transition itself (see that route's own doc comment for why: an HTTP
 * request has no trustworthy way to assert "this is genuinely the
 * designated first render of this build," and race conditions between
 * concurrent requests for the same buildId would need dedicated
 * concurrency control this tranche does not add). A future t9 orchestrator
 * calls these directly once it owns that context.
 */
function tryResolveSpecifier(specifier: string): boolean {
  try {
    require_.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

let cachedSupabaseCliAvailable: boolean | undefined;

/** Cached per-process (a CLI presence probe is expensive relative to
 * everything else in this module, and cannot change mid-process). */
function isSupabaseCliAvailable(): boolean {
  if (cachedSupabaseCliAvailable !== undefined) return cachedSupabaseCliAvailable;
  try {
    const result = spawnSync('supabase', ['--version'], { timeout: 3_000, stdio: 'ignore' });
    cachedSupabaseCliAvailable = result.error === undefined && result.status === 0;
  } catch {
    cachedSupabaseCliAvailable = false;
  }
  return cachedSupabaseCliAvailable;
}

/**
 * t8 fix-round (Sol HIGH-3 residue): an INDEPENDENT, non-caller-controlled
 * probe of whether a deterministic gate's underlying TOOL is resolvable/
 * present in this environment -- deliberately SEPARATE from whether the
 * gate's own `run()` reported `'unavailable'` for one particular render
 * (which can be a CONTENT/config reason, e.g. `ts-compile` with TS files
 * but no `tsconfig.json`, not a tooling-absence reason).
 * `recordBootstrapBaseline` uses this to decide whether a sibling's
 * `'unavailable'` status is a LEGITIMATE reason to still bootstrap (the
 * tool genuinely isn't installed/configured anywhere in this workspace) or
 * a red flag that should block it (the tool IS available, so an
 * 'unavailable' render is anomalous and should not be silently trusted).
 * Deliberately a STATIC resolvability check (package/binary presence), not
 * a full runtime capability probe (e.g. does NOT launch a browser for
 * `axe`) -- cheap, deterministic, and exactly what "the registry's
 * availability probe" can mean without re-running (and re-costing) the
 * gate itself.
 */
function isDeterministicGateToolAvailable(id: DeterministicGateId): boolean {
  switch (id) {
    case 'ts-compile':
      return tryResolveSpecifier('typescript/bin/tsc');
    case 'eslint':
      return tryResolveSpecifier('eslint/bin/eslint.js');
    case 'design-md-lint':
      return tryResolveSpecifier('@google/design.md/package.json');
    case 'lighthouse-ci':
      return tryResolveSpecifier('@lhci/cli/package.json');
    case 'axe':
      return tryResolveSpecifier('axe-core/axe.min.js') && tryResolveSpecifier('playwright');
    case 'supabase-migration-dry-run':
      return isSupabaseCliAvailable();
    case 'tokens-schema':
    case 'link-smoke':
    case 'form-smoke':
      // Built-in, in-process logic with no external tool dependency --
      // these gates never report 'unavailable' in the first place, so
      // this branch is never actually consulted for them, but `true` is
      // the honest answer to "is the tool present" regardless.
      return true;
    default:
      return false;
  }
}

/**
 * t8 fix-round (Sol HIGH-3 residue): the previous fix-round's check passed
 * VACUOUSLY on an empty or partial `siblingGateResults` array -- a caller
 * could omit an inconvenient gate entirely and bootstrap would never even
 * see it. `siblingGateResults` must now contain EXACTLY one result per
 * `DETERMINISTIC_GATE_IDS` entry other than `'screenshot-ssim'` (the
 * COMPLETE registry-derived set); a missing id is rejected outright,
 * before any status is even inspected.
 */
function findMissingSiblingGateIds(siblingGateResults: readonly DeterministicGateResult[]): DeterministicGateId[] {
  const expected = DETERMINISTIC_GATE_IDS.filter((id) => id !== 'screenshot-ssim');
  const supplied = new Set(siblingGateResults.map((r) => r.id));
  return expected.filter((id) => !supplied.has(id));
}

/**
 * Sol t8 verdict-pass residue: EXACTLY one result per expected id. A
 * duplicated id (e.g. a `fail` followed by a `pass` for the same gate) or an
 * id outside the expected set must reject -- last-duplicate-wins would let a
 * caller launder a failing gate behind a duplicate passing entry.
 */
function findDuplicateOrUnexpectedSiblingGateIds(
  siblingGateResults: readonly DeterministicGateResult[],
): string[] {
  const expected = new Set<string>(DETERMINISTIC_GATE_IDS.filter((id) => id !== 'screenshot-ssim'));
  const seen = new Set<string>();
  const bad: string[] = [];
  for (const result of siblingGateResults) {
    if (!expected.has(result.id) || seen.has(result.id)) bad.push(result.id);
    seen.add(result.id);
  }
  return bad;
}

export function recordBootstrapBaseline(db: Database.Database, input: RecordBootstrapBaselineInput): void {
  ensureSsimBaselinesTable(db);
  const existing = getSsimBaselineRow(db, input.buildId);
  if (existing) {
    throw new SsimLifecycleError(
      `build "${input.buildId}" already has an SSIM baseline record in state "${existing.state}" -- recordBootstrapBaseline is a one-time transition, not an overwrite. Call invalidateSsimBaseline first for a deliberate re-baseline.`,
    );
  }

  const missingIds = findMissingSiblingGateIds(input.siblingGateResults);
  if (missingIds.length > 0) {
    throw new SsimLifecycleError(
      `cannot bootstrap an SSIM baseline for build "${input.buildId}": siblingGateResults is missing result(s) for: ${missingIds.join(', ')} -- the COMPLETE deterministic gate id set (every id other than screenshot-ssim) must be represented; a subset is not accepted.`,
    );
  }
  const duplicateOrUnexpectedIds = findDuplicateOrUnexpectedSiblingGateIds(input.siblingGateResults);
  if (duplicateOrUnexpectedIds.length > 0) {
    throw new SsimLifecycleError(
      `cannot bootstrap an SSIM baseline for build "${input.buildId}": siblingGateResults contains duplicate or unexpected gate id(s): ${duplicateOrUnexpectedIds.join(', ')} -- exactly one result per deterministic gate is required.`,
    );
  }

  const byId = new Map(input.siblingGateResults.filter((r) => r.id !== 'screenshot-ssim').map((r) => [r.id, r] as const));
  const problems: string[] = [];
  for (const id of DETERMINISTIC_GATE_IDS) {
    if (id === 'screenshot-ssim') continue;
    const result = byId.get(id);
    if (!result) continue; // already reported via missingIds above
    if (result.status === 'pass' || result.status === 'skipped-not-applicable') continue;
    if (result.status === 'unavailable' && !isDeterministicGateToolAvailable(id)) continue; // legitimate: tooling genuinely absent
    const reason = result.status === 'unavailable' ? `${id}=unavailable (but the tool IS resolvable in this environment per the registry probe -- not accepted)` : `${id}=${result.status}`;
    problems.push(reason);
  }
  if (problems.length > 0) {
    throw new SsimLifecycleError(
      `cannot bootstrap an SSIM baseline for build "${input.buildId}": ${problems.length} sibling deterministic gate(s) blocked bootstrap -- ${problems.join(', ')}. WR-routing.md step 1 requires every OTHER deterministic gate to clear (pass, genuinely not-applicable, or unavailable ONLY because its tool is absent) before this render is eligible to become a baseline.`,
    );
  }

  const now = (input.now ?? new Date()).toISOString();
  db.prepare(
    `INSERT INTO routing_ssim_baselines (build_id, state, baseline_screenshot_path, token_freeze_version, negative_control_passed, updated_at)
     VALUES (@buildId, 'negative-control-pending', @screenshotPath, @tokenFreezeVersion, 0, @now)`,
  ).run({ buildId: input.buildId, screenshotPath: input.screenshotPath, tokenFreezeVersion: input.tokenFreezeVersion, now });
}

export interface RunNegativeControlCheckInput {
  buildId: string;
  /** A DELIBERATELY perturbed variant of the candidate baseline render
   * (e.g. a swapped color token or a shifted layout, per WR-routing.md
   * step 2). */
  perturbedScreenshotPath: string;
  floor?: number;
  now?: Date;
}

export interface NegativeControlCheckResult {
  /** `true` when the perturbed variant scored BELOW the floor -- the proof
   * the comparison discriminates at all. */
  discriminates: boolean;
  similarity: number;
  floor: number;
  state: SsimLifecycleState;
}

/**
 * Step 2: scores a deliberately perturbed variant against the candidate
 * baseline. Promotes to `'active'` (step 3) ONLY when `discriminates` is
 * true; a non-discriminating comparison leaves the build in
 * `'negative-control-pending'` so a caller can fix the perturbation and
 * retry -- this function never promotes on a failed check. Throws if the
 * build is not currently awaiting calibration.
 */
export async function runNegativeControlCheck(db: Database.Database, input: RunNegativeControlCheckInput): Promise<NegativeControlCheckResult> {
  ensureSsimBaselinesTable(db);
  const row = getSsimBaselineRow(db, input.buildId);
  if (!row || row.state !== 'negative-control-pending' || !row.baseline_screenshot_path) {
    throw new SsimLifecycleError(
      `build "${input.buildId}" is not awaiting negative-control calibration (state: ${row?.state ?? 'no-baseline-bootstrap'}) -- call recordBootstrapBaseline first.`,
    );
  }
  const floor = input.floor ?? DEFAULT_SSIM_FLOOR;
  const similarity = await compareScreenshotsSimilarity(row.baseline_screenshot_path, input.perturbedScreenshotPath);
  const discriminates = similarity < floor;
  if (discriminates) {
    const now = (input.now ?? new Date()).toISOString();
    db.prepare(`UPDATE routing_ssim_baselines SET state = 'active', negative_control_passed = 1, updated_at = @now WHERE build_id = @buildId`).run({
      buildId: input.buildId,
      now,
    });
  }
  return { discriminates, similarity, floor, state: discriminates ? 'active' : 'negative-control-pending' };
}

/**
 * t8 fix-round (Sol HIGH-3a): REAL windowed SSIM (Structural SIMilarity),
 * not a pixel-difference proxy. Reference: Wang, Bovik, Sheikh & Simoncelli,
 * "Image Quality Assessment: From Error Visibility to Structural
 * Similarity," IEEE Trans. Image Processing, 2004 -- the standard per-
 * window formula:
 *
 *   SSIM(x,y) = [(2*mu_x*mu_y + C1)(2*sigma_xy + C2)]
 *               / [(mu_x^2 + mu_y^2 + C1)(sigma_x^2 + sigma_y^2 + C2)]
 *
 * where `mu` is the window mean, `sigma^2` the window variance, `sigma_xy`
 * the window covariance between the two images, and `C1 = (K1*L)^2`,
 * `C2 = (K2*L)^2` are stabilizers avoiding division-by-zero (`K1=0.01`,
 * `K2=0.03`, `L=255` the 8-bit dynamic range -- the paper's own defaults).
 * This implementation uses 8x8 NON-OVERLAPPING windows (a documented
 * simplification of the paper's 11x11 Gaussian-weighted sliding window --
 * deterministic, no new dependencies, and precise enough to threshold
 * against a floor) over `sharp`-decoded GRAYSCALE raw buffers, and reports
 * the mean SSIM across every window (MSSIM). A trailing partial window at
 * the image's right/bottom edge is still scored over its actual (smaller)
 * pixel count, never padded.
 *
 * `sharp` is imported LAZILY here (Sol MED-7): a broken native binding
 * must fail only THIS comparison (surfaces as 'unavailable' at the calling
 * gate/negative-control check), never crash this module's own load --
 * every gate id that doesn't touch screenshot-ssim must stay usable even
 * when `sharp`'s native addon is broken in a given environment.
 *
 * Throws on a dimension mismatch rather than resizing -- silently resizing
 * one render to match the other would compare two different images and
 * call it a similarity score, which is exactly the kind of fabricated
 * comparison this whole module exists to avoid.
 */
const SSIM_WINDOW_SIZE = 8;
const SSIM_K1 = 0.01;
const SSIM_K2 = 0.03;
const SSIM_DYNAMIC_RANGE = 255;
const SSIM_C1 = (SSIM_K1 * SSIM_DYNAMIC_RANGE) ** 2;
const SSIM_C2 = (SSIM_K2 * SSIM_DYNAMIC_RANGE) ** 2;

function windowSsim(a: Buffer, b: Buffer, width: number, wx: number, wy: number, winW: number, winH: number): number {
  const n = winW * winH;
  let sumA = 0;
  let sumB = 0;
  for (let y = 0; y < winH; y++) {
    for (let x = 0; x < winW; x++) {
      const idx = (wy + y) * width + (wx + x);
      sumA += a[idx] as number;
      sumB += b[idx] as number;
    }
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let varA = 0;
  let varB = 0;
  let covAB = 0;
  for (let y = 0; y < winH; y++) {
    for (let x = 0; x < winW; x++) {
      const idx = (wy + y) * width + (wx + x);
      const da = (a[idx] as number) - meanA;
      const db_ = (b[idx] as number) - meanB;
      varA += da * da;
      varB += db_ * db_;
      covAB += da * db_;
    }
  }
  varA /= n;
  varB /= n;
  covAB /= n;

  const numerator = (2 * meanA * meanB + SSIM_C1) * (2 * covAB + SSIM_C2);
  const denominator = (meanA * meanA + meanB * meanB + SSIM_C1) * (varA + varB + SSIM_C2);
  return denominator === 0 ? 1 : numerator / denominator;
}

async function compareScreenshotsSimilarity(baselinePath: string, candidatePath: string): Promise<number> {
  const sharpModule = (await import('sharp')).default;
  const [baseline, candidate] = await Promise.all([
    sharpModule(baselinePath).grayscale().raw().toBuffer({ resolveWithObject: true }),
    sharpModule(candidatePath).grayscale().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (baseline.info.width !== candidate.info.width || baseline.info.height !== candidate.info.height) {
    throw new Error(
      `image dimension mismatch: baseline ${baseline.info.width}x${baseline.info.height} vs candidate ${candidate.info.width}x${candidate.info.height}`,
    );
  }
  const { width, height } = baseline.info;
  const a = baseline.data;
  const b = candidate.data;

  let sumSsim = 0;
  let windowCount = 0;
  for (let wy = 0; wy < height; wy += SSIM_WINDOW_SIZE) {
    const winH = Math.min(SSIM_WINDOW_SIZE, height - wy);
    for (let wx = 0; wx < width; wx += SSIM_WINDOW_SIZE) {
      const winW = Math.min(SSIM_WINDOW_SIZE, width - wx);
      if (winW === 0 || winH === 0) continue;
      sumSsim += windowSsim(a, b, width, wx, wy, winW, winH);
      windowCount++;
    }
  }
  return windowCount === 0 ? 1 : sumSsim / windowCount;
}
