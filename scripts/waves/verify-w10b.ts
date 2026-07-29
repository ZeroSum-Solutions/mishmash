// verify-w10b.ts -- wave mishmash-w10b-voicebox (VoiceBox MCP registration)
// completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w10b.ts [--repo <path>]
// Exit 0 only when C10B-1 through C10B-5 all pass AND the tree is clean
// (treeDirty: false). The commit-bound proof manifest is written to the
// wave's goal-state proof directory either way, per
// docs/plans/waves/W10b-voicebox-registration.md's "Definition of green".
//
// Scope note: docs/plans/waves/W10b-voicebox-registration.md registers
// exactly one apps/daemon/src/mcp-config.ts MCP_TEMPLATES entry (NM-25,
// founder-ruled registration-only -- no voiceover-workflow scoping). This
// verifier therefore never imports daemon source as a live ES module --
// apps/daemon/src/mcp-config.ts's own dependency graph, or a future change
// to it, is not this script's concern to keep resolvable across --repo. It
// reads that file as TEXT at specific commits (git show) and parses it with
// the TypeScript compiler API, exactly like scripts/waves/verify-w9-ingest.ts
// does for its own AST-based structural checks. This keeps the verifier
// fully portable under --repo and decoupled from apps/daemon's own module
// resolution.
//
// PORTABILITY: repoRoot comes from `process.cwd()`/`--repo`, never
// `import.meta.url`.
//
// RUNTIME SAFETY: this verifier spawns no daemon and binds no port -- every
// criterion below is answered from `git show`/`git diff`/`git status`
// output plus in-process TypeScript AST parsing. It never touches a
// default-namespace daemon (ports 7456/51012) because it never starts one.
// Git context is resolved from local refs only (no fetch/push).

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type TypeScriptModule from 'typescript';
import type {
  ArrayLiteralExpression,
  Node as TsNode,
  ObjectLiteralExpression,
  SourceFile,
} from 'typescript';

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

const WAVE_SLUG = 'mishmash-w10b-voicebox';
const TEMPLATE_FILE = 'apps/daemon/src/mcp-config.ts';

function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W10b',
      commit: 'unknown',
      treeDirty: true,
      baseCommit: 'unknown',
      toolchain: { node: process.version, pnpm: 'unknown' },
      criteria: [
        {
          id: 'INIT-FAILURE',
          command: 'module init',
          assertion: 'the verifier can initialize before any criterion runs',
          artifact: null,
          artifactSha256: null,
          exitCode: 1,
          status: 'fail',
          durationMs: 0,
          detail: errorMessage,
        },
      ],
    };
    fs.writeFileSync(
      path.join(os.tmpdir(), 'verify-w10b-emergency-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  } catch {
    /* truly nothing more we can do */
  }
  console.error(`verify-w10b: FATAL during init: ${errorMessage}`);
  process.exit(1);
}

let repoRoot: string;
let proofDir: string;
let ts: typeof TypeScriptModule;
try {
  repoRoot = path.resolve(argValue('--repo') ?? process.cwd());
  proofDir = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'proof');
  fs.mkdirSync(proofDir, { recursive: true });
  ts = createRequire(path.join(repoRoot, 'package.json'))('typescript');
} catch (err) {
  emergencyExit(`init failed: ${String((err as Error)?.stack ?? err)}`);
}

function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 30_000,
  });
  if (result.error) {
    return {
      status: 1,
      stdout: result.stdout ?? '',
      stderr: `${result.stderr ?? ''}\n${String(result.error)}`,
    };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function sha256Bytes(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

interface CriterionResult {
  id: string;
  command: string;
  assertion: string;
  artifact: string | null;
  artifactSha256: string | null;
  exitCode: number;
  status: 'pass' | 'fail';
  durationMs: number;
  detail?: string | undefined;
}

const results: CriterionResult[] = [];

function artifactFor(
  id: string,
  content: string,
): { artifact: string | null; artifactSha256: string | null } {
  const primary = path.join(proofDir, `${id}.txt`);
  const tryWrite = (target: string): { artifact: string; artifactSha256: string } | null => {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      return { artifact: target, artifactSha256: sha256Bytes(fs.readFileSync(target)) };
    } catch {
      return null;
    }
  };
  const primaryResult = tryWrite(primary);
  if (primaryResult) return primaryResult;
  const fallbackResult = tryWrite(
    path.join(os.tmpdir(), 'verify-w10b-fallback-proof', `${id}.txt`),
  );
  if (fallbackResult) return fallbackResult;
  console.error(`verify-w10b: artifact write failed for ${id} on both primary and fallback paths`);
  return { artifact: null, artifactSha256: null };
}

function record(
  id: string,
  command: string,
  assertion: string,
  ok: boolean,
  evidence: string,
  opts: { detail?: string | undefined; durationMs?: number } = {},
): void {
  try {
    const { artifact, artifactSha256 } = artifactFor(
      id,
      `# ${id}\n# assertion: ${assertion}\n# verdict: ${ok ? 'pass' : 'fail'}\n${
        opts.detail ? `# detail: ${opts.detail}\n` : ''
      }\n${evidence}\n`,
    );
    const effectiveOk = ok && artifact !== null;
    results.push({
      id,
      command,
      assertion,
      artifact,
      artifactSha256,
      exitCode: effectiveOk ? 0 : 1,
      status: effectiveOk ? 'pass' : 'fail',
      durationMs: opts.durationMs ?? 0,
      detail:
        artifact === null
          ? `${opts.detail ? `${opts.detail}; ` : ''}artifact write failed -- forced fail`
          : opts.detail,
    });
  } catch (err) {
    results.push({
      id,
      command,
      assertion,
      artifact: null,
      artifactSha256: null,
      exitCode: 1,
      status: 'fail',
      durationMs: opts.durationMs ?? 0,
      detail: `record() itself failed: ${String(err)}`,
    });
  }
}

async function checkCriterion(id: string, fn: () => Promise<void> | void): Promise<void> {
  const startedAt = Date.now();
  const startIndex = results.length;
  try {
    await fn();
    const durationMs = Date.now() - startedAt;
    for (let i = startIndex; i < results.length; i++) {
      const r = results[i];
      if (r) r.durationMs = durationMs;
    }
  } catch (err) {
    record(id, '', '', false, String((err as Error)?.stack ?? err), {
      detail: `criterion check crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
    });
  }
}

// ---------------------------------------------------------------------
// Git context -- local refs only, no fetch/push.
// ---------------------------------------------------------------------
function gitOrFail(args: string[], why: string): string {
  const r = sh('git', args);
  if (r.status !== 0 || r.stdout.trim().length === 0) {
    throw new Error(
      `git ${args.join(' ')} failed (${why}): exit=${r.status} stdout=${
        r.stdout.trim().slice(0, 200) || '<empty>'
      }`,
    );
  }
  return r.stdout.trim();
}
function resolveMainRefLocal(): string {
  for (const ref of ['origin/main', 'main']) {
    const verify = sh('git', ['rev-parse', '--verify', ref]);
    if (verify.status === 0 && verify.stdout.trim()) return ref;
  }
  throw new Error(
    'could not resolve "origin/main" or "main" locally (no network ref-check -- this verifier never fetches)',
  );
}
function writeEmergencyManifest(errorMessage: string, partialResults: CriterionResult[] = []): void {
  const manifest = {
    wave: 'W10b',
    commit: 'unknown',
    treeDirty: true,
    baseCommit: 'unknown',
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: [
      ...partialResults,
      {
        id: 'GIT-RESOLUTION',
        command: 'git rev-parse HEAD / git merge-base',
        assertion: 'HEAD and baseCommit resolve to real, non-empty commits before any criterion runs',
        artifact: null,
        artifactSha256: null,
        exitCode: 1,
        status: 'fail',
        durationMs: 0,
        detail: errorMessage,
      },
    ],
  };
  let wrote = false;
  try {
    fs.mkdirSync(proofDir, { recursive: true });
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, path.join(proofDir, 'manifest.json'));
    wrote = true;
  } catch {
    /* fall through to guarded fallback */
  }
  if (!wrote) {
    try {
      fs.writeFileSync(
        path.join(os.tmpdir(), 'verify-w10b-emergency-manifest.json'),
        JSON.stringify(manifest, null, 2),
      );
    } catch {
      /* last resort: stderr only */
    }
  }
  console.error(`verify-w10b: FATAL, emergency manifest written=${wrote}: ${errorMessage}`);
}
function resolveGitContextOrExit(): { headSha: string; baseCommit: string } {
  try {
    const resolvedHeadSha = gitOrFail(['rev-parse', 'HEAD'], 'resolving HEAD commit');
    const mainRef = resolveMainRefLocal();
    const mainSha = gitOrFail(['rev-parse', mainRef], 'resolving main ref');
    const resolvedBaseCommit = gitOrFail(['merge-base', mainSha, resolvedHeadSha], 'computing baseCommit');
    return { headSha: resolvedHeadSha, baseCommit: resolvedBaseCommit };
  } catch (err) {
    writeEmergencyManifest(String((err as Error)?.stack ?? err));
    process.exit(1);
  }
}
const { headSha, baseCommit } = resolveGitContextOrExit();

function readFileAtCommit(commit: string, relPath: string): string | null {
  const r = sh('git', ['show', `${commit}:${relPath}`]);
  if (r.status !== 0) return null;
  return r.stdout;
}

// ---------------------------------------------------------------------
// AST helpers over apps/daemon/src/mcp-config.ts's MCP_TEMPLATES array.
// Read-as-text + TypeScript compiler API -- never a live import of daemon
// source (see header note).
// ---------------------------------------------------------------------
interface TemplateBlock {
  id: string;
  rawText: string; // exact source text of the object literal, trimmed
  node: ObjectLiteralExpression;
}

function parseTemplateBlocks(
  sourceText: string,
  syntheticFileName: string,
): { file: SourceFile; blocks: Map<string, TemplateBlock> } | null {
  const sourceFile = ts.createSourceFile(syntheticFileName, sourceText, ts.ScriptTarget.Latest, true);
  let arrayLiteral: ArrayLiteralExpression | null = null;
  const visit = (node: TsNode): void => {
    if (arrayLiteral) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'MCP_TEMPLATES' &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      arrayLiteral = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!arrayLiteral) return null;
  // Explicit assertion, not a narrowed read: `arrayLiteral` is assigned
  // inside the `visit` closure above, and TS does not reliably narrow a
  // `let` binding's type across a closure boundary. `visit(sourceFile)` has
  // already returned synchronously by this point, so the null check just
  // above is a real runtime guarantee even though TS can't see it that way.
  const resolvedArray = arrayLiteral as ArrayLiteralExpression;

  const blocks = new Map<string, TemplateBlock>();
  for (const element of resolvedArray.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue;
    const id = findStringProp(element, sourceFile, 'id');
    if (id === undefined) continue;
    blocks.set(id, { id, rawText: element.getText(sourceFile).trim(), node: element });
  }
  return { file: sourceFile, blocks };
}

function findStringProp(
  obj: ObjectLiteralExpression,
  sourceFile: SourceFile,
  name: string,
): string | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!ts.isIdentifier(prop.name) || prop.name.text !== name) continue;
    const init = prop.initializer;
    if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
    return undefined; // present but not a plain string literal -- caller treats as absent
  }
  return undefined;
}

const FORBIDDEN_SCOPE_PATTERN =
  /voiceover|storyboard|timeline|merge.{0,20}(video|project)|script.{0,20}track|elevenlabs|fishaudio|senseaudio/i;

async function main(): Promise<void> {
  // Two-phase manifest write: a dirty placeholder goes down IMMEDIATELY,
  // before any criterion runs, so a crash/interruption mid-run can never
  // leave a stale-but-complete-looking prior green manifest on disk.
  const placeholder = {
    wave: 'W10b',
    commit: headSha,
    treeDirty: true,
    baseCommit,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: [] as CriterionResult[],
  };
  try {
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(placeholder, null, 2));
    fs.renameSync(tmp, path.join(proofDir, 'manifest.json'));
  } catch (err) {
    writeEmergencyManifest(`could not write placeholder manifest: ${String(err)}`);
    process.exit(1);
  }

  // -----------------------------------------------------------------
  // C10B-1 -- registration present.
  // -----------------------------------------------------------------
  let voiceboxBlock: TemplateBlock | undefined;
  let headSourceFile: SourceFile | undefined;
  let headBlockCount = 0;
  let headBlockIds: string[] = [];

  await checkCriterion('C10B-1', () => {
    const headText = readFileAtCommit(headSha, TEMPLATE_FILE);
    if (headText === null) {
      record(
        'C10B-1',
        `git show ${headSha}:${TEMPLATE_FILE}`,
        "a 'voicebox' entry exists in MCP_TEMPLATES with non-empty label and homepage",
        false,
        '',
        { detail: `${TEMPLATE_FILE} does not exist at HEAD` },
      );
      return;
    }
    const parsed = parseTemplateBlocks(headText, TEMPLATE_FILE);
    if (!parsed) {
      record(
        'C10B-1',
        `parse ${TEMPLATE_FILE}@HEAD`,
        'MCP_TEMPLATES array literal is found and parseable',
        false,
        '',
        { detail: 'could not locate `const MCP_TEMPLATES: McpTemplate[] = [...]` in the file' },
      );
      return;
    }
    headSourceFile = parsed.file;
    headBlockCount = parsed.blocks.size;
    headBlockIds = [...parsed.blocks.keys()];
    voiceboxBlock = parsed.blocks.get('voicebox');
    if (!voiceboxBlock) {
      record(
        'C10B-1',
        `parse ${TEMPLATE_FILE}@HEAD, search MCP_TEMPLATES for id==='voicebox'`,
        "exactly one MCP_TEMPLATES object has id: 'voicebox', with non-empty label and homepage",
        false,
        `MCP_TEMPLATES has ${headBlockCount} entries; ids: ${headBlockIds.join(', ')}`,
        { detail: "no object with id 'voicebox' present -- VoiceBox is not registered yet" },
      );
      return;
    }
    const label = findStringProp(voiceboxBlock.node, parsed.file, 'label');
    const homepage = findStringProp(voiceboxBlock.node, parsed.file, 'homepage');
    const ok = Boolean(label && label.trim()) && Boolean(homepage && homepage.trim());
    record(
      'C10B-1',
      `parse ${TEMPLATE_FILE}@HEAD, inspect the id==='voicebox' object`,
      "exactly one MCP_TEMPLATES object has id: 'voicebox', with non-empty label and homepage",
      ok,
      `label=${JSON.stringify(label)} homepage=${JSON.stringify(homepage)}\n\n${voiceboxBlock.rawText}`,
      { detail: ok ? undefined : 'label and/or homepage missing or empty' },
    );
  });

  // -----------------------------------------------------------------
  // C10B-2 -- correct transport/config shape.
  // -----------------------------------------------------------------
  await checkCriterion('C10B-2', () => {
    if (!voiceboxBlock || !headSourceFile) {
      record(
        'C10B-2',
        '',
        "transport/url/category/authMode match VoiceBox's documented HTTP MCP mount",
        false,
        '',
        { detail: 'C10B-1 did not locate a voicebox entry to inspect -- see C10B-1' },
      );
      return;
    }
    const sf = headSourceFile;
    const block = voiceboxBlock;
    const transport = findStringProp(block.node, sf, 'transport');
    const url = findStringProp(block.node, sf, 'url');
    const category = findStringProp(block.node, sf, 'category');
    const authMode = findStringProp(block.node, sf, 'authMode');

    const problems: string[] = [];
    if (transport !== 'http') problems.push(`transport=${JSON.stringify(transport)}, want 'http'`);
    let parsedUrl: URL | null = null;
    if (url === undefined) {
      problems.push('url is missing');
    } else {
      try {
        parsedUrl = new URL(url);
      } catch {
        problems.push(`url ${JSON.stringify(url)} does not parse as a URL`);
      }
    }
    if (parsedUrl) {
      if (parsedUrl.protocol !== 'http:') problems.push(`url protocol=${parsedUrl.protocol}, want http:`);
      if (parsedUrl.hostname !== '127.0.0.1')
        problems.push(`url hostname=${parsedUrl.hostname}, want 127.0.0.1`);
      if (parsedUrl.port !== '17493') problems.push(`url port=${JSON.stringify(parsedUrl.port)}, want 17493`);
      if (parsedUrl.pathname !== '/mcp') problems.push(`url pathname=${parsedUrl.pathname}, want /mcp`);
    }
    if (category !== 'utilities') problems.push(`category=${JSON.stringify(category)}, want 'utilities'`);
    if (authMode !== undefined && authMode !== 'none')
      problems.push(`authMode=${JSON.stringify(authMode)}, want absent or 'none'`);

    record(
      'C10B-2',
      `parse ${TEMPLATE_FILE}@HEAD, inspect the id==='voicebox' object's transport/url/category/authMode`,
      "transport==='http', url parses to http://127.0.0.1:17493/mcp exactly, category==='utilities', authMode is absent or 'none'",
      problems.length === 0,
      problems.join('\n') ||
        `transport=${transport} url=${url} category=${category} authMode=${authMode ?? '<absent>'}`,
      { detail: problems.length === 0 ? undefined : problems.join('; ') },
    );
  });

  // -----------------------------------------------------------------
  // C10B-3 -- no extra surface added: lease-glob diff subset check (read
  // mechanically from leases.json, never hand-approved) + additive-only
  // check on MCP_TEMPLATES itself (every pre-existing entry byte-identical,
  // exactly one net-new entry, and it is 'voicebox').
  // -----------------------------------------------------------------
  function globToRegExp(glob: string): RegExp {
    let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    re = re.replace(/\*\*/g, ' GLOBSTAR ');
    re = re.replace(/\*/g, '[^/]*');
    re = re.replace(/ GLOBSTAR /g, '.*');
    return new RegExp(`^${re}$`);
  }

  await checkCriterion('C10B-3', () => {
    const problems: string[] = [];

    const leasesText = readFileAtCommit(baseCommit, 'docs/plans/waves/leases.json');
    let lease: { allow: string[]; deny?: string[] } | undefined;
    if (leasesText === null) {
      problems.push(`could not read docs/plans/waves/leases.json at baseCommit ${baseCommit}`);
    } else {
      try {
        const parsedLeases = JSON.parse(leasesText) as {
          waves: Record<string, { allow: string[]; deny?: string[] }>;
        };
        lease = parsedLeases.waves['W10b'];
      } catch (err) {
        problems.push(`leases.json@baseCommit did not parse: ${String(err)}`);
      }
      if (!lease) {
        problems.push(
          'no "W10b" entry in leases.json@baseCommit -- expected until the orchestrator adds the entry proposed in docs/plans/waves/W10b-voicebox-registration.md\'s "Proposed write lease" section (fails closed by design; see that PRD\'s "Verified baseline" section)',
        );
      }
    }

    const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
    const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
    if (diffResult.status !== 0) problems.push(`git diff exited ${diffResult.status}: ${diffResult.stderr}`);
    if (lease) {
      const allowRe = lease.allow.map(globToRegExp);
      const denyRe = (lease.deny ?? []).map(globToRegExp);
      const violations = diffNames.filter(
        (f) => !allowRe.some((re) => re.test(f)) || denyRe.some((re) => re.test(f)),
      );
      if (violations.length > 0) problems.push(`outside W10b lease: ${violations.join(', ')}`);
    }

    const baseText = readFileAtCommit(baseCommit, TEMPLATE_FILE);
    const headText = readFileAtCommit(headSha, TEMPLATE_FILE);
    if (baseText === null || headText === null) {
      problems.push(`could not read ${TEMPLATE_FILE} at baseCommit and/or HEAD`);
    } else {
      const baseParsed = parseTemplateBlocks(baseText, `${TEMPLATE_FILE}@base`);
      const headParsed = parseTemplateBlocks(headText, `${TEMPLATE_FILE}@head`);
      if (!baseParsed || !headParsed) {
        problems.push('could not locate/parse MCP_TEMPLATES at baseCommit and/or HEAD');
      } else {
        for (const [id, baseBlock] of baseParsed.blocks) {
          const headBlock = headParsed.blocks.get(id);
          if (!headBlock) {
            problems.push(`pre-existing template '${id}' was removed`);
          } else if (headBlock.rawText !== baseBlock.rawText) {
            problems.push(`pre-existing template '${id}' was modified (not byte-identical)`);
          }
        }
        const newIds = [...headParsed.blocks.keys()].filter((id) => !baseParsed.blocks.has(id));
        if (newIds.length !== 1) {
          problems.push(
            `expected exactly 1 new MCP_TEMPLATES entry, found ${newIds.length}: ${
              newIds.join(', ') || '<none>'
            }`,
          );
        } else if (newIds[0] !== 'voicebox') {
          problems.push(`the one new entry is '${newIds[0]}', expected 'voicebox'`);
        }
      }
    }

    record(
      'C10B-3',
      `git diff --name-only ${baseCommit}...HEAD subset-of leases.json@baseCommit["W10b"]; MCP_TEMPLATES additive-only diff`,
      'diff is within the W10b lease; every pre-existing MCP_TEMPLATES entry is byte-identical; exactly one new entry, id voicebox',
      problems.length === 0,
      problems.join('\n') ||
        (diffNames.length === 0 ? 'no diff between baseCommit and HEAD' : `changed files: ${diffNames.join(', ')}`),
      { detail: problems.length === 0 ? undefined : problems.join('; ') },
    );
  });

  // -----------------------------------------------------------------
  // C10B-4 -- no voiceover-workflow scope creep. Scoped to the voicebox
  // object literal's OWN source text (its declared fields), never the
  // whole diff -- a citation comment explaining the ruling necessarily
  // discusses the thing that was refused, and proving that citation
  // exists is C10B-5's job, not this one's.
  // -----------------------------------------------------------------
  await checkCriterion('C10B-4', () => {
    const headText = readFileAtCommit(headSha, TEMPLATE_FILE);
    const parsed = headText === null ? null : parseTemplateBlocks(headText, `${TEMPLATE_FILE}@head-c4`);
    const block = parsed?.blocks.get('voicebox');
    if (!block) {
      record(
        'C10B-4',
        `parse ${TEMPLATE_FILE}@HEAD, scan the id==='voicebox' object's own source text`,
        `the voicebox object literal's own text matches none of ${FORBIDDEN_SCOPE_PATTERN}`,
        false,
        '',
        { detail: 'no voicebox entry to scan -- see C10B-1' },
      );
      return;
    }
    const hit = FORBIDDEN_SCOPE_PATTERN.exec(block.rawText);
    record(
      'C10B-4',
      `parse ${TEMPLATE_FILE}@HEAD, scan the id==='voicebox' object's own source text`,
      `the voicebox object literal's own text matches none of ${FORBIDDEN_SCOPE_PATTERN}`,
      hit === null,
      hit ? `matched: ${JSON.stringify(hit[0])}\n\n${block.rawText}` : block.rawText,
      { detail: hit ? `forbidden-scope pattern matched: ${JSON.stringify(hit[0])}` : undefined },
    );
  });

  // -----------------------------------------------------------------
  // C10B-5 -- documentation record: an NM-25 citation was added alongside
  // the registration. Whole-diff scan is correct here (unlike C10B-4) --
  // the citation legitimately lives outside the object literal itself, as
  // a trailing/leading comment.
  // -----------------------------------------------------------------
  function addedLines(fromCommit: string, toCommit: string, relPath: string): string[] {
    const r = sh('git', ['diff', `${fromCommit}...${toCommit}`, '--', relPath]);
    if (r.status !== 0) return [];
    return r.stdout
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .map((line) => line.slice(1));
  }

  await checkCriterion('C10B-5', () => {
    const added = addedLines(baseCommit, 'HEAD', TEMPLATE_FILE);
    const hasCitation = added.some((line) => line.includes('NM-25'));
    record(
      'C10B-5',
      `git diff ${baseCommit}...HEAD -- ${TEMPLATE_FILE}, scan added lines`,
      `at least one line added to ${TEMPLATE_FILE} contains the literal substring 'NM-25'`,
      hasCitation,
      added.join('\n') || '<no added lines>',
      { detail: hasCitation ? undefined : 'no NM-25 citation found in the diff' },
    );
  });

  // -----------------------------------------------------------------
  // HEAD-DRIFT -- infra check, not a PRD criterion (mirrors the pattern in
  // scripts/waves/verify-w9-ingest.ts).
  // -----------------------------------------------------------------
  const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  await checkCriterion('HEAD-DRIFT', () => {
    record(
      'HEAD-DRIFT',
      'git rev-parse HEAD (re-resolved at end)',
      'HEAD must not move during the run',
      headShaFinal === headSha,
      `initial=${headSha} final=${headShaFinal}`,
      { detail: headShaFinal === headSha ? undefined : 'HEAD moved during the run' },
    );
  });

  // -----------------------------------------------------------------
  // Final manifest.
  // -----------------------------------------------------------------
  const treeDirtyResult = sh('git', ['status', '--porcelain=v1']);
  const treeDirty = treeDirtyResult.status !== 0 || treeDirtyResult.stdout.trim().length > 0;
  const finalManifest = {
    wave: 'W10b',
    commit: headSha,
    treeDirty,
    baseCommit,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: results,
  };
  let manifestWritten = false;
  let manifestSha256 = '';
  try {
    const manifestJson = JSON.stringify(finalManifest, null, 2);
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, manifestJson);
    fs.renameSync(tmp, path.join(proofDir, 'manifest.json'));
    manifestSha256 = sha256Bytes(manifestJson);
    manifestWritten = true;
  } catch (err) {
    console.error(`verify-w10b: FAILED to write final manifest: ${String(err)}`);
  }

  const failures = results.filter((r) => r.status === 'fail');
  console.log(
    `\nverify-w10b: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty})`,
  );
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md §2)');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  console.log(`MANIFEST_PATH=${path.join(proofDir, 'manifest.json')}`);
  process.exit(failures.length === 0 && !treeDirty && manifestWritten ? 0 : 1);
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
