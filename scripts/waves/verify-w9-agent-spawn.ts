// verify-w9-agent-spawn.ts -- wave mishmash-w9-agent-spawn-tranche (agent-spawn
// route hardening, first/highest-risk of the rolling W9 tranches) completion
// verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w9-agent-spawn.ts [--repo <path>]
// Exit 0 only when every mechanical criterion passes (C9S-8 may legitimately
// be "blocked-on-founder", a non-failing terminal state), LEASE/HEAD-DRIFT
// pass, the tree is clean, and archival succeeds.
//
// ROUND 2 (fix round 1 of the program's 2-round cap) -- applies all eight
// round-1 adversarial blockers verbatim. See W9-agent-spawn-tranche.md's
// "AUTHOR-FLAGGED / DISPOSITIONS" for the full disposition list. Summary of
// what changed structurally in this file vs round 1:
//
//   1. SCOPE: four files now frozen (routes/runs.ts, routes/terminal.ts, one
//      route each from routes/routine.ts and routes/media.ts), not one.
//   2. EXPOSURE SCALE: 4-valued (0=authorizeToolRequest genuine auth,
//      1=reserved/unused, 2=requireLocalDaemonRequest|isLocalSameOrigin
//      loopback-only, 3=none) -- corrected from round 1's scale, which
//      wrongly treated loopback-only as the SAFEST tier under this tranche's
//      own local-process attacker model.
//   3. ANTI-GAMING: bare-identifier-only guard matching with explicit local-
//      shadowing detection (closes the "fake.authorizeToolRequest" and
//      "locally shadowed real guard" gaming vectors the round-1 review
//      demonstrated); a computed/dynamic route path is now a hard fail for
//      the two fully-frozen files, never a silent skip; every HEAD-dependent
//      read (route source, daemon-boot import, attribution matrix, threat-
//      model doc, test suite) is sourced from ONE detached temporary git
//      worktree pinned to headSha, created once near the start of the run --
//      not the mutable primary worktree -- closing the round-1 "mutate,
//      read favorably, restore before treeDirty checks" gap structurally
//      rather than by bracketed hashing.
//   4. MATRIX SEMANTICS: impact is integer-bounded [0,3]; control/acceptedRisk
//      is a true XOR (round 1 silently accepted both); the primary testRef is
//      fully validated and globally unique, not merely non-placeholder;
//      acceptedRisk.decisionRef requires the EXACT W9AS-ACCEPT- prefix; the
//      P0 set used by C9S-4/C9S-6 is derived live from the matrix's own
//      validated riskScore, never a hardcoded table.
//   5. RATE-LIMIT PROOF: the over-limit matcher now binds the declared
//      `limit` value (round 1 had it as a dead parameter -- a real bug);
//      every cited transport assertion's own BODY text (not just its name)
//      must contain a real status-code assertion; corpus-case matching is
//      AST-scoped to test titles/bodies (comment-immune); the full detached-
//      worktree Vitest-Node-API replay is REQUIRED now (ported from
//      verify-w9-ingest.ts), not deferred; corpus grows from 5 to 8 cases.
//   6. THREAT-MODEL DOC: the bounded-section/fence-aware/exact-citation
//      machinery is ported verbatim from verify-w9-ingest.ts's own six-round-
//      hardened version rather than reinvented loosely.
//   7. IMPLEMENTATION REVIEW: relocated OUT OF THE REPO to
//      ~/.claude/goal-state/mishmash-w9-agent-spawn-tranche/reviews/
//      implementation-review.json -- the W7 disposition-record trust model
//      (orchestrator-only-writable, outside every lease, so an implementer
//      cannot forge it) -- replacing an in-repo, implementer-authored,
//      structurally-unsatisfiable record.
//   8. RUN-ID OWNERSHIP: a dedicated criterion (C9S-8) that resolves to a
//      normal pass (real control, or a founder-signed accepted-risk record)
//      or the legal `blocked-on-founder` terminal state (VERIFICATION-
//      CONTRACT.md §2 rule 3) when neither exists yet -- never silently
//      assumed either way, never counted as a plain failure on its own.
//
// ISOLATION (hard rule, unchanged): every daemon boot uses port 0 (OS-
// assigned) and a fresh mkdtemp OD_DATA_DIR, torn down by its own exact child
// PID. This verifier never touches ports 7456/51012 and never issues a `git
// fetch`/`git push`. The new detached-worktree machinery is git-local
// (`git worktree add --detach`) and offline (`pnpm install --offline
// --frozen-lockfile` against the already-warm shared pnpm store).

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type TypeScriptModule from 'typescript';
import type { Node as TsNode } from 'typescript';

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

const WAVE_SLUG = 'mishmash-w9-agent-spawn-tranche';
const LEASE_KEY = 'W9-agent-spawn';

function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W9-agent-spawn',
      commit: 'unknown',
      treeDirty: true,
      baseCommit: 'unknown',
      wroteOk: false,
      gateIntegrityPinned: false,
      archiveOk: false,
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
      path.join(os.tmpdir(), 'verify-w9-agent-spawn-emergency-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  } catch {
    /* truly nothing more we can do */
  }
  console.error(`verify-w9-agent-spawn: FATAL during init: ${errorMessage}`);
  process.exit(1);
}

let repoRoot: string;
let proofDir: string;
let ts: typeof TypeScriptModule;
try {
  repoRoot = path.resolve(argValue('--repo') ?? process.cwd());
  proofDir = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'proof');
  fs.mkdirSync(proofDir, { recursive: true });
  fs.mkdirSync(path.join(proofDir, 'runs'), { recursive: true });
  ts = createRequire(path.join(repoRoot, 'package.json'))('typescript');
} catch (err) {
  emergencyExit(`init failed: ${String((err as Error)?.stack ?? err)}`);
}

function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): { status: number; stdout: string; stderr: string; processError: boolean } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repoRoot,
    timeout: opts.timeoutMs,
    env: opts.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const processError = Boolean(result.error) || result.signal !== null;
  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    processError,
  };
}

function sha256Bytes(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function sha256File(absPath: string): string {
  return sha256Bytes(fs.readFileSync(absPath));
}
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'unnamed'
  );
}

type CriterionStatus = 'pass' | 'fail' | 'blocked-on-founder';
interface CriterionResult {
  id: string;
  command: string;
  assertion: string;
  artifact: string | null;
  artifactSha256: string | null;
  exitCode: number;
  status: CriterionStatus;
  durationMs: number;
  detail?: string | undefined;
}

function artifactFor(id: string, content: string): { artifact: string | null; artifactSha256: string | null } {
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
  const fallbackResult = tryWrite(path.join(os.tmpdir(), 'verify-w9-agent-spawn-fallback-proof', `${id}.txt`));
  if (fallbackResult) return fallbackResult;
  console.error(`verify-w9-agent-spawn: artifact write failed for ${id} on both primary and fallback paths`);
  return { artifact: null, artifactSha256: null };
}

const results: CriterionResult[] = [];
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
      `# ${id}\n# assertion: ${assertion}\n# verdict: ${ok ? 'pass' : 'fail'}\n${opts.detail ? `# detail: ${opts.detail}\n` : ''}\n${evidence}\n`,
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
      detail: artifact === null ? `${opts.detail ? `${opts.detail}; ` : ''}artifact write failed -- forced fail` : opts.detail,
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
/** C9S-8's legal third state (VERIFICATION-CONTRACT.md §2 rule 3): a real,
 * mechanically-decided "not yet resolved by the implementer or the founder"
 * state -- never a plain failure, never a silent assumption either way. */
function recordBlockedOnFounder(id: string, command: string, assertion: string, evidence: string, detail?: string): void {
  try {
    const { artifact, artifactSha256 } = artifactFor(
      id,
      `# ${id}\n# assertion: ${assertion}\n# verdict: blocked-on-founder\n${detail ? `# detail: ${detail}\n` : ''}\n${evidence}\n`,
    );
    results.push({
      id,
      command,
      assertion,
      artifact,
      artifactSha256,
      exitCode: 2,
      status: 'blocked-on-founder',
      durationMs: 0,
      detail,
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
      durationMs: 0,
      detail: `recordBlockedOnFounder() itself failed: ${String(err)}`,
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

// -----------------------------------------------------------------------
// Git context -- local refs only, no fetch/push (hard constraint).
// -----------------------------------------------------------------------
function gitOrFail(args: string[], why: string): string {
  const r = sh('git', args);
  if (r.status !== 0 || r.stdout.trim().length === 0) {
    throw new Error(`git ${args.join(' ')} failed (${why}): exit=${r.status} stdout=${r.stdout.trim().slice(0, 200) || '<empty>'}`);
  }
  return r.stdout.trim();
}
function resolveMainRefLocal(): string {
  for (const ref of ['origin/main', 'main']) {
    const verify = sh('git', ['rev-parse', '--verify', ref]);
    if (verify.status === 0 && verify.stdout.trim()) return ref;
  }
  throw new Error('could not resolve "origin/main" or "main" locally (no network ref-check -- this verifier never fetches)');
}
function writeEmergencyManifest(errorMessage: string, partialResults: CriterionResult[] = []): void {
  const manifest = {
    wave: 'W9-agent-spawn',
    commit: 'unknown',
    treeDirty: true,
    baseCommit: 'unknown',
    wroteOk: false,
    gateIntegrityPinned: false,
    archiveOk: false,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: [
      ...partialResults,
      {
        id: 'GIT-RESOLUTION',
        command: 'git rev-parse HEAD / git merge-base',
        assertion: 'HEAD and baseCommit resolve to real, non-empty, non-equal commits before any criterion runs',
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
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w9-agent-spawn-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
    } catch {
      /* last resort: stderr only */
    }
  }
  console.error(`verify-w9-agent-spawn: FATAL, emergency manifest written=${wrote}: ${errorMessage}`);
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
function readFileAtCommit(commit: string, relPath: string): string {
  const r = sh('git', ['show', `${commit}:${relPath}`]);
  if (r.status !== 0) throw new Error(`git show ${commit}:${relPath} failed (exit=${r.status}): ${r.stdout.slice(0, 300)}`);
  return r.stdout;
}
function resolveCommit(sha: string): boolean {
  return sh('git', ['cat-file', '-e', `${sha}^{commit}`]).status === 0;
}
function isAncestor(ancestor: string, descendant: string): boolean {
  return sh('git', ['merge-base', '--is-ancestor', ancestor, descendant]).status === 0;
}
function commitAuthorsBetween(fromExclusive: string, toInclusive: string): Set<string> {
  const r = sh('git', ['log', '--format=%an%x00%ae', `${fromExclusive}..${toInclusive}`]);
  const out = new Set<string>();
  if (r.status !== 0) return out;
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\x00');
    if (parts[0]) out.add(parts[0].trim().toLowerCase());
    if (parts[1]) out.add(parts[1].trim().toLowerCase());
  }
  return out;
}

const gateIntegrityPinned = fs.existsSync(path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256'));

interface ManifestShape {
  wave: string;
  commit: string;
  treeDirty: boolean;
  baseCommit: string;
  wroteOk: boolean;
  gateIntegrityPinned: boolean;
  archiveOk: boolean;
  toolchain: { node: string; pnpm: string };
  criteria: CriterionResult[];
}
function buildManifest(wroteOk: boolean, treeDirty: boolean, archiveOk: boolean): ManifestShape {
  return {
    wave: 'W9-agent-spawn',
    commit: headSha,
    treeDirty,
    baseCommit,
    wroteOk,
    gateIntegrityPinned,
    archiveOk,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: results,
  };
}
function writeManifestFile(manifest: ManifestShape): { written: boolean; sha256: string } {
  const manifestPath = path.join(proofDir, 'manifest.json');
  try {
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, manifestPath);
    const sha256 = sha256File(manifestPath);
    fs.writeFileSync(path.join(proofDir, 'manifest.sha256.txt'), `${sha256}\n`);
    return { written: true, sha256 };
  } catch (err) {
    try {
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w9-agent-spawn-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
      console.error(`verify-w9-agent-spawn: primary manifest write failed (${String(err)}); wrote fallback`);
    } catch (err2) {
      console.error(`verify-w9-agent-spawn: manifest write failed everywhere (${String(err)} / ${String(err2)})`);
    }
    return { written: false, sha256: 'unavailable' };
  }
}
function archiveRunArtifacts(manifest: ManifestShape): { runDir: string; ok: boolean } {
  const runDir = path.join(proofDir, 'runs', `${manifest.commit}-${Date.now()}-${process.pid}`);
  try {
    fs.mkdirSync(runDir, { recursive: true });
    const rewrittenCriteria: CriterionResult[] = [];
    for (const r of manifest.criteria) {
      if (!r.artifact || !fs.existsSync(r.artifact)) {
        rewrittenCriteria.push(r);
        continue;
      }
      const dest = path.join(runDir, path.basename(r.artifact));
      fs.copyFileSync(r.artifact, dest);
      rewrittenCriteria.push({ ...r, artifact: dest });
    }
    const selfContainedManifest: ManifestShape = { ...manifest, archiveOk: true, criteria: rewrittenCriteria };
    const manifestJsonPath = path.join(runDir, 'manifest.json');
    const tmpPath = path.join(runDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmpPath, JSON.stringify(selfContainedManifest, null, 2));
    fs.renameSync(tmpPath, manifestJsonPath);
    const computedSha = sha256File(manifestJsonPath);
    fs.writeFileSync(path.join(runDir, 'manifest.sha256.txt'), `${computedSha}\n`);

    const rereadRaw = fs.readFileSync(manifestJsonPath, 'utf8');
    const reread = JSON.parse(rereadRaw) as ManifestShape;
    if (reread.archiveOk !== true) return { runDir, ok: false };
    const rereadHash = sha256Bytes(rereadRaw);
    const recordedHash = fs.readFileSync(path.join(runDir, 'manifest.sha256.txt'), 'utf8').trim();
    if (rereadHash !== recordedHash) return { runDir, ok: false };
    for (const r of reread.criteria) {
      if (!r.artifact) continue;
      if (!fs.existsSync(r.artifact)) return { runDir, ok: false };
      if (!r.artifactSha256 || sha256File(r.artifact) !== r.artifactSha256) return { runDir, ok: false };
    }
    return { runDir, ok: true };
  } catch (err) {
    console.error(`verify-w9-agent-spawn: run-archive FAILED (this fails the run, no catch may restore ok:true): ${String(err)}`);
    return { runDir, ok: false };
  }
}

// =========================================================================
// BLOCKER 3e FIX -- detached HEAD worktree. Every HEAD-dependent read (route
// source, the isolated daemon boot's imported files, the attribution matrix,
// the threat-model doc, the dedicated test suite) is sourced from ONE
// detached temporary git worktree pinned to headSha, created once here and
// removed at the very end of main(). This structurally closes the "mutate a
// HEAD file, let the verifier read it favorably, restore it before the
// end-of-run treeDirty check" gap: the detached worktree is a separate
// checkout the primary (mutable) worktree cannot write into, no matter what
// happens there mid-run.
// =========================================================================
let headWorktreeDir = '';
function createDetachedHeadWorktree(): { ok: true; dir: string } | { ok: false; error: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w9as-head-'));
  fs.rmdirSync(dir); // `git worktree add` wants the target path to not exist yet.
  const add = sh('git', ['worktree', 'add', '--detach', dir, headSha], { timeoutMs: 5 * 60_000 });
  if (add.status !== 0) return { ok: false, error: `git worktree add --detach ${dir} ${headSha} failed (exit=${add.status}): ${add.stdout.slice(-500)}` };
  sh('mise', ['trust'], { cwd: dir, timeoutMs: 30_000 });
  const install = sh('pnpm', ['install', '--offline', '--frozen-lockfile'], { cwd: dir, timeoutMs: 5 * 60_000 });
  if (install.status !== 0) {
    sh('git', ['worktree', 'remove', '--force', dir], { timeoutMs: 60_000 });
    return { ok: false, error: `pnpm install --offline --frozen-lockfile in detached HEAD worktree failed (exit=${install.status}): ${install.stdout.slice(-1000)}` };
  }
  return { ok: true, dir };
}
function removeDetachedHeadWorktree(dir: string): void {
  if (!dir) return;
  sh('git', ['worktree', 'remove', '--force', dir], { timeoutMs: 60_000 });
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

// =========================================================================
// Route collector -- AST-scoped to a named registrar function's own body.
// Recursive ts.forEachChild walk (never a whole-file text scan, so an
// identifier inside a comment cannot leak in). BLOCKER 3a FIX: separately
// counts every app.<method>(...) call found (any first argument) vs. the
// subset with a STATIC string/no-substitution-template first argument --
// callers that require full-function freezing (runs.ts, terminal.ts) treat
// any difference as a hard fail; callers that only scope to a named subset
// of routes within a much larger file (routine.ts, media.ts) report the
// difference as informational only, since those files' other routes are out
// of this tranche's scope entirely (see PRD "Scoping note on rows 16-17").
// =========================================================================
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options']);

interface RouteRegistration {
  method: string;
  routePath: string;
  middlewareArgs: TsNode[];
  finalHandler: TsNode | null;
  handlerParamNames: (string | null)[];
}
interface CollectResult {
  registrations: RouteRegistration[];
  duplicates: string[];
  totalCallCount: number;
  staticCallCount: number;
}

function findFunctionBody(sourceFile: TypeScriptModule.SourceFile, fnName: string): TsNode | null {
  let found: TsNode | null = null;
  const visit = (node: TsNode) => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === fnName && node.body) {
      found = node.body;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function paramNamesOf(handler: TsNode | null): (string | null)[] {
  if (!handler) return [];
  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) return [];
  return handler.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : null));
}

function collectScopedRouteRegistrations(
  sourceText: string,
  label: string,
  fnName: string,
  pathFilter: readonly string[] | null,
): CollectResult {
  const sourceFile = ts.createSourceFile(label, sourceText, ts.ScriptTarget.Latest, true);
  const fnBody = findFunctionBody(sourceFile, fnName);
  if (!fnBody) throw new Error(`${fnName} function body not found in ${label}`);
  const registrations: RouteRegistration[] = [];
  const counts = new Map<string, number>();
  let totalCallCount = 0;
  let staticCallCount = 0;
  const visit = (node: TsNode) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'app' &&
      ts.isIdentifier(node.expression.name) &&
      HTTP_METHODS.has(node.expression.name.text)
    ) {
      totalCallCount += 1;
      const method = node.expression.name.text.toUpperCase();
      const args = [...node.arguments];
      const pathArg = args[0];
      const isStaticPath = Boolean(pathArg) && (ts.isStringLiteral(pathArg!) || ts.isNoSubstitutionTemplateLiteral(pathArg!));
      if (args.length >= 2 && isStaticPath) {
        staticCallCount += 1;
        const routePath = (pathArg as TypeScriptModule.StringLiteralLike).text;
        if (!pathFilter || pathFilter.includes(routePath)) {
          const finalHandler = args[args.length - 1] ?? null;
          const middlewareArgs = args.slice(1, -1);
          registrations.push({
            method,
            routePath,
            middlewareArgs,
            finalHandler,
            handlerParamNames: paramNamesOf(finalHandler),
          });
          const key = `${method} ${routePath}`;
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fnBody, visit);
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  return { registrations, duplicates, totalCallCount, staticCallCount };
}

// -------------------------------------------------------------------------
// Exposure classifier -- 4-valued (0/1/2/3), corrected ordering per the
// round-1 ruling. BLOCKER 3c FIX: both guard primitives must be BARE
// identifiers (never a property access on an arbitrary object -- closes the
// "fake.authorizeToolRequest" gaming vector) AND must not be locally
// shadowed between the registrar function's own top-level bindings and the
// guard's call site (closes the "locally shadowed real guard" vector).
// -------------------------------------------------------------------------
function isNegationOfIdentifier(expr: TsNode, varName: string): boolean {
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
    return ts.isIdentifier(expr.operand) && expr.operand.text === varName;
  }
  return false;
}
function consequentUnconditionallyExits(stmt: TsNode): boolean {
  if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true;
  if (ts.isBlock(stmt)) {
    const last = stmt.statements[stmt.statements.length - 1];
    return last !== undefined && (ts.isReturnStatement(last) || ts.isThrowStatement(last));
  }
  return false;
}
function calleeIsBareIdentifier(expr: TsNode, name: string): boolean {
  return ts.isIdentifier(expr) && expr.text === name;
}
/** Walks the registrar function's own top-level statements (never a nested
 * scope) for any `const`/`let`/`var` declaration of `name` that appears
 * BEFORE `beforeNode` -- i.e. any local rebinding that would shadow an
 * outer/imported identifier of the same name at the point of use. A fake
 * local `const authorizeToolRequest = () => true` declared earlier in the
 * same function shadows the real one; this returns true for that case. */
function isShadowedBeforeUse(fnBody: TsNode, name: string, beforeNode: TsNode): boolean {
  if (!ts.isBlock(fnBody)) return false;
  let shadowed = false;
  for (const stmt of fnBody.statements) {
    if (stmt === beforeNode || stmt.getStart() >= beforeNode.getStart()) break;
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) {
          // A real ctx-destructure binding (`const { authorizeToolRequest } =
          // ctx.auth`) is NOT shadowing -- it IS the real binding. Only a
          // plain identifier declaration (`const authorizeToolRequest = ...`)
          // that is not itself destructuring from `ctx` counts as a shadow.
          shadowed = true;
        }
        if (ts.isObjectBindingPattern(decl.name)) {
          for (const el of decl.name.elements) {
            if (ts.isBindingElement(el) && ts.isIdentifier(el.name) && el.name.text === name) {
              const isCtxDestructure =
                decl.initializer &&
                ts.isPropertyAccessExpression(decl.initializer) &&
                ts.isIdentifier(decl.initializer.expression) &&
                decl.initializer.expression.text === 'ctx';
              if (!isCtxDestructure) shadowed = true;
              else shadowed = false; // a genuine ctx-destructure re-affirms the real binding
            }
          }
        }
      }
    }
  }
  return shadowed;
}

/** Exposure 0: direct top-level `const grant = authorizeToolRequest(...)`
 * immediately followed by an unconditional-exit `if (!grant)`, bare
 * identifier, not locally shadowed. Position-anchored: must be
 * statements[0]/[1] of the handler's own body (a guard appearing after any
 * other statement, e.g. a response write, is not a real gate). */
function hasDirectAuthorizeToolRequestGuard(reg: RouteRegistration, fnBody: TsNode): boolean {
  const handler = reg.finalHandler;
  if (!handler) return false;
  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) return false;
  if (!ts.isBlock(handler.body)) return false;
  const statements = handler.body.statements;
  const first = statements[0];
  const second = statements[1];
  if (!first || !second) return false;
  if (!ts.isVariableStatement(first)) return false;
  const decl = first.declarationList.declarations[0];
  if (!decl || first.declarationList.declarations.length !== 1) return false;
  if (!ts.isIdentifier(decl.name) || decl.name.text !== 'grant') return false;
  if (!decl.initializer || !ts.isCallExpression(decl.initializer)) return false;
  if (!calleeIsBareIdentifier(decl.initializer.expression, 'authorizeToolRequest')) return false;
  if (isShadowedBeforeUse(fnBody, 'authorizeToolRequest', handler)) return false;
  if (!ts.isIfStatement(second)) return false;
  if (!isNegationOfIdentifier(second.expression, 'grant')) return false;
  if (!second.thenStatement) return false;
  return consequentUnconditionallyExits(second.thenStatement);
}

/** Exposure 2(a): `requireLocalDaemonRequest` as a literal, non-shadowed
 * bare-identifier middleware argument. */
function hasRequireLocalDaemonRequestMiddleware(reg: RouteRegistration, fnBody: TsNode): boolean {
  return reg.middlewareArgs.some((arg) => {
    if (!ts.isIdentifier(arg) || arg.text !== 'requireLocalDaemonRequest') return false;
    return !isShadowedBeforeUse(fnBody, 'requireLocalDaemonRequest', arg);
  });
}
/** Exposure 2(b): the handler's first direct top-level statement is
 * `if (!isLocalSameOrigin(req, ...)) { <unconditional exit> }` -- the real
 * shape used by POST /api/orbit/run. Bare identifier, not shadowed,
 * position-anchored to statement[0]. */
function hasDirectIsLocalSameOriginGuard(reg: RouteRegistration, fnBody: TsNode): boolean {
  const handler = reg.finalHandler;
  if (!handler) return false;
  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) return false;
  if (!ts.isBlock(handler.body)) return false;
  const first = handler.body.statements[0];
  if (!first || !ts.isIfStatement(first)) return false;
  const cond = first.expression;
  if (!ts.isPrefixUnaryExpression(cond) || cond.operator !== ts.SyntaxKind.ExclamationToken) return false;
  if (!ts.isCallExpression(cond.operand)) return false;
  if (!calleeIsBareIdentifier(cond.operand.expression, 'isLocalSameOrigin')) return false;
  if (isShadowedBeforeUse(fnBody, 'isLocalSameOrigin', handler)) return false;
  if (!first.thenStatement) return false;
  return consequentUnconditionallyExits(first.thenStatement);
}

function classifyExposure(reg: RouteRegistration, fnBody: TsNode): number {
  if (hasDirectAuthorizeToolRequestGuard(reg, fnBody)) return 0;
  if (hasRequireLocalDaemonRequestMiddleware(reg, fnBody) || hasDirectIsLocalSameOriginGuard(reg, fnBody)) return 2;
  return 3;
}

// -------------------------------------------------------------------------
// Frozen route set + impact floors -- S9S-1/S9S-2, 17 routes across 4 files.
// -------------------------------------------------------------------------
interface OwnedFile {
  relPath: string;
  fnName: string;
  pathFilter: readonly string[] | null; // null = whole function frozen
  fullFreeze: boolean; // whether totalCallCount === staticCallCount is enforced
  livePathPrefixes: readonly string[];
  liveSiblingExclusions: readonly string[]; // {method} {path} pairs known-adjacent but out of scope
}
const OWNED_FILES: OwnedFile[] = [
  {
    relPath: 'apps/daemon/src/routes/runs.ts',
    fnName: 'registerRunRoutes',
    pathFilter: null,
    fullFreeze: true,
    livePathPrefixes: ['/api/runs', '/api/chat'],
    // Two sibling files register routes under the same /api/runs prefix.
    // routes/chat.ts owns the feedback route; routes/genui.ts owns the
    // GenUI surface + devloop-iterations + replay routes (5). Both are
    // empirically discovered, out-of-scope-for-this-tranche siblings, named
    // explicitly here so the exclusion is auditable rather than silently
    // baked into a regex (mirrors S9S-1's own stated design).
    liveSiblingExclusions: [
      'POST /api/runs/:id/feedback',
      'GET /api/runs/:runId/genui',
      'POST /api/runs/:runId/genui/:surfaceId/respond',
      'GET /api/runs/:runId/genui/:surfaceId',
      'GET /api/runs/:runId/devloop-iterations',
      'POST /api/runs/:runId/replay',
    ],
  },
  {
    relPath: 'apps/daemon/src/routes/terminal.ts',
    fnName: 'registerTerminalRoutes',
    pathFilter: null,
    fullFreeze: true,
    livePathPrefixes: ['/api/projects/:id/terminals'],
    liveSiblingExclusions: [],
  },
  {
    relPath: 'apps/daemon/src/routes/routine.ts',
    fnName: 'registerRoutineRoutes',
    pathFilter: ['/api/routines/:id/run'],
    fullFreeze: false,
    livePathPrefixes: ['/api/routines/:id/run'],
    liveSiblingExclusions: [],
  },
  {
    relPath: 'apps/daemon/src/routes/media.ts',
    fnName: 'registerMediaRoutes',
    pathFilter: ['/api/orbit/run'],
    fullFreeze: false,
    livePathPrefixes: ['/api/orbit/run'],
    liveSiblingExclusions: [],
  },
];

interface ImpactFloorRow {
  key: string;
  impactFloor: number;
  impactRationale: string;
}
const FROZEN_IMPACT_FLOORS: ImpactFloorRow[] = [
  { key: 'POST /api/runs', impactFloor: 3, impactRationale: 'spawns a new OS child process; caller-selected agent/prompt/model/tool-bundle' },
  { key: 'GET /api/runs', impactFloor: 1, impactRationale: 'lists status/metadata (incl. childPid, error detail, workspace provenance) for every run system-wide' },
  { key: 'GET /api/runs/:id', impactFloor: 1, impactRationale: "statusBody returns process/error/workspace/tool detail, not bare ids (corrected round 2)" },
  { key: 'GET /api/runs/:id/events', impactFloor: 1, impactRationale: 'streams live stdout/stderr/tool-result content; no ownership check' },
  { key: 'GET /api/runs/:id/agui', impactFloor: 1, impactRationale: 'same content, AGUI envelope; no ownership check' },
  { key: 'GET /api/runs/:id/result-package', impactFloor: 1, impactRationale: 'workspace file listing + artifact manifests; no ownership check' },
  { key: 'POST /api/runs/:id/cancel', impactFloor: 2, impactRationale: "terminates another caller's in-flight child by id; no ownership check" },
  { key: 'POST /api/chat', impactFloor: 3, impactRationale: 'same spawn path as POST /api/runs, via startChatRun' },
  { key: 'POST /api/projects/:id/terminals', impactFloor: 3, impactRationale: 'spawns a new interactive PTY shell rooted at the project cwd' },
  { key: 'GET /api/projects/:id/terminals', impactFloor: 1, impactRationale: 'lists live terminal sessions for a project' },
  { key: 'GET /api/projects/:id/terminals/:tid/stream', impactFloor: 1, impactRationale: 'streams live shell output' },
  { key: 'POST /api/projects/:id/terminals/:tid/stdin', impactFloor: 3, impactRationale: 'injects arbitrary keystrokes into a live shell -- equivalent to remote command execution once a session exists' },
  { key: 'POST /api/projects/:id/terminals/:tid/resize', impactFloor: 0, impactRationale: 'UI geometry only' },
  { key: 'POST /api/projects/:id/terminals/:tid/kill', impactFloor: 2, impactRationale: "terminates another caller's shell session; no ownership check" },
  { key: 'DELETE /api/projects/:id/terminals/:tid', impactFloor: 2, impactRationale: 'kill alias, same as POST .../kill' },
  { key: 'POST /api/routines/:id/run', impactFloor: 3, impactRationale: 'triggers the shared agent runner on demand; caller does not control prompt content, only trigger timing' },
  { key: 'POST /api/orbit/run', impactFloor: 3, impactRationale: 'triggers the shared agent runner (Orbit); exposure is 2 (loopback-gated) today' },
];
const FROZEN_ROUTE_KEYS = new Set(FROZEN_IMPACT_FLOORS.map((r) => r.key));
const IMPACT_FLOOR_BY_KEY = new Map(FROZEN_IMPACT_FLOORS.map((r) => [r.key, r.impactFloor]));

function tierFor(score: number): 'P0' | 'P1' | 'P2' {
  if (score >= 5) return 'P0';
  if (score === 4) return 'P1';
  return 'P2';
}

// -------------------------------------------------------------------------
// Self-probes -- 14 fixtures (up from round 1's 8). Each is run through the
// exact collectScopedRouteRegistrations/classifyExposure pipeline the real
// criteria use, never a separate mock.
// -------------------------------------------------------------------------
interface SelfProbeOutcome {
  name: string;
  ok: boolean;
  detail: string;
}
function probeFixture(name: string, source: string, expected: number): SelfProbeOutcome {
  try {
    const collected = collectScopedRouteRegistrations(source, `self-probe:${name}`, 'registerRunRoutes', null);
    const reg = collected.registrations[0];
    if (!reg || collected.registrations.length !== 1) {
      return { name, ok: false, detail: `expected exactly 1 registration, found ${collected.registrations.length}` };
    }
    const sourceFile = ts.createSourceFile(`self-probe:${name}`, source, ts.ScriptTarget.Latest, true);
    const fnBody = findFunctionBody(sourceFile, 'registerRunRoutes');
    if (!fnBody) return { name, ok: false, detail: 'could not locate registerRunRoutes body in fixture' };
    const actual = classifyExposure(reg, fnBody);
    return actual === expected
      ? { name, ok: true, detail: `exposure=${actual} (expected ${expected})` }
      : { name, ok: false, detail: `exposure=${actual}, expected ${expected}` };
  } catch (err) {
    return { name, ok: false, detail: `probe crashed: ${String(err)}` };
  }
}
/** Computed-path fixtures assert the COLLECTOR's hard-fail behavior, not the
 * classifier -- expected is the required (totalCallCount, staticCallCount)
 * pair, which must differ for the probe to pass. */
function probeComputedPath(name: string, source: string): SelfProbeOutcome {
  try {
    const collected = collectScopedRouteRegistrations(source, `self-probe:${name}`, 'registerRunRoutes', null);
    return collected.totalCallCount !== collected.staticCallCount
      ? { name, ok: true, detail: `totalCallCount=${collected.totalCallCount} staticCallCount=${collected.staticCallCount} (mismatch correctly detected)` }
      : { name, ok: false, detail: `totalCallCount=${collected.totalCallCount} staticCallCount=${collected.staticCallCount} (computed path NOT detected -- gaming vector open)` };
  } catch (err) {
    return { name, ok: false, detail: `probe crashed: ${String(err)}` };
  }
}
function runExposureSelfProbes(): SelfProbeOutcome[] {
  const wrap = (body: string) => `function registerRunRoutes(app, ctx) {\n${body}\n}`;
  return [
    probeFixture(
      'real-requireLocalDaemonRequest-middleware',
      wrap(`  app.post('/api/runs', requireLocalDaemonRequest, async (req, res) => {\n    res.json({ ok: true });\n  });`),
      2,
    ),
    probeFixture(
      'real-authorizeToolRequest-direct-guard-bare',
      wrap(`  app.post('/api/runs', async (req, res) => {\n    const grant = authorizeToolRequest(req);\n    if (!grant) {\n      return res.status(401).json({ error: 'unauthorized' });\n    }\n    res.json({ ok: true });\n  });`),
      0,
    ),
    probeFixture(
      'real-authorizeToolRequest-bound-via-ctx-destructure-no-shadow',
      wrap(`  const { authorizeToolRequest } = ctx.auth;\n  app.post('/api/runs', async (req, res) => {\n    const grant = authorizeToolRequest(req);\n    if (!grant) {\n      return res.status(401).json({ error: 'unauthorized' });\n    }\n    res.json({ ok: true });\n  });`),
      0,
    ),
    probeFixture(
      'real-isLocalSameOrigin-inline-guard',
      wrap(`  app.post('/api/orbit/run', async (req, res) => {\n    if (!isLocalSameOrigin(req, ctx.port)) {\n      return res.status(403).json({ error: 'cross-origin request rejected' });\n    }\n    res.json({ ok: true });\n  });`),
      2,
    ),
    probeFixture(
      'guard-inside-dead-if-false-branch',
      wrap(`  app.post('/api/runs', async (req, res) => {\n    if (false) {\n      const grant = authorizeToolRequest(req);\n      if (!grant) {\n        return res.status(401).json({ error: 'unauthorized' });\n      }\n    }\n    res.json({ ok: true });\n  });`),
      3,
    ),
    probeFixture(
      'guard-result-never-checked',
      wrap(`  app.post('/api/runs', async (req, res) => {\n    const grant = authorizeToolRequest(req);\n    res.json({ ok: true });\n  });`),
      3,
    ),
    probeFixture(
      'guard-after-response-write',
      wrap(`  app.post('/api/runs', async (req, res) => {\n    res.json({ ok: true });\n    const grant = authorizeToolRequest(req);\n    if (!grant) {\n      return;\n    }\n  });`),
      3,
    ),
    probeFixture(
      'no-guard-todays-real-shape',
      wrap(`  app.post('/api/runs', async (req, res) => {\n    res.json({ ok: true });\n  });`),
      3,
    ),
    probeFixture(
      'requireLocalDaemonRequest-mentioned-only-in-comment',
      wrap(`  // requireLocalDaemonRequest should probably gate this\n  app.post('/api/runs', async (req, res) => {\n    res.json({ ok: true });\n  });`),
      3,
    ),
    probeFixture(
      'authorizeToolRequest-nested-inside-if-branch',
      wrap(`  app.post('/api/runs', async (req, res) => {\n    if (req.query.strict) {\n      const grant = authorizeToolRequest(req);\n      if (!grant) {\n        return res.status(401).json({ error: 'unauthorized' });\n      }\n    }\n    res.json({ ok: true });\n  });`),
      3,
    ),
    // BLOCKER 3c: property-access alias on an arbitrary object no longer
    // counts -- this is exactly the round-1 gaming vector the reviewer
    // demonstrated ("a fake/shadowed fake.authorizeToolRequest passed as
    // exposure 1").
    probeFixture(
      'property-access-alias-not-bare-identifier',
      wrap(`  app.post('/api/runs', async (req, res) => {\n    const grant = fake.authorizeToolRequest(req);\n    if (!grant) {\n      return res.status(401).json({ error: 'unauthorized' });\n    }\n    res.json({ ok: true });\n  });`),
      3,
    ),
    // BLOCKER 3c: a locally-shadowed fake overriding the real ctx-bound
    // identifier before the guard call.
    probeFixture(
      'locally-shadowed-authorizeToolRequest-fake',
      wrap(`  const { authorizeToolRequest: realAuthorizeToolRequest } = ctx.auth;\n  const authorizeToolRequest = () => true;\n  app.post('/api/runs', async (req, res) => {\n    const grant = authorizeToolRequest(req);\n    if (!grant) {\n      return res.status(401).json({ error: 'unauthorized' });\n    }\n    res.json({ ok: true });\n  });`),
      3,
    ),
    probeFixture(
      'locally-shadowed-requireLocalDaemonRequest-fake',
      wrap(`  const requireLocalDaemonRequest = (req, res, next) => next();\n  app.post('/api/runs', requireLocalDaemonRequest, async (req, res) => {\n    res.json({ ok: true });\n  });`),
      3,
    ),
    // BLOCKER 3a: computed/dynamic route paths must hard-fail the collector,
    // never silently vanish from the frozen count.
    probeComputedPath(
      'computed-path-constant-identifier',
      wrap(`  const RUNS_PATH = '/api/runs';\n  app.post('/api/runs', async (req, res) => { res.json({ ok: true }); });\n  app.post(RUNS_PATH, async (req, res) => { res.json({ ok: true }); });`),
    ),
    probeComputedPath(
      'computed-path-template-with-substitution',
      wrap(`  const base = '/api';\n  app.post('/api/runs', async (req, res) => { res.json({ ok: true }); });\n  app.post(\`\${base}/runs2\`, async (req, res) => { res.json({ ok: true }); });`),
    ),
  ];
}

// -------------------------------------------------------------------------
// Isolated daemon boot for live route-inventory introspection (C9S-1).
// Sourced from the DETACHED HEAD WORKTREE, not the primary worktree. Port 0
// (OS-assigned, never 7456/51012), fresh mkdtemp OD_DATA_DIR, killed only by
// this function's own exact child PID.
// -------------------------------------------------------------------------
async function bootDaemonForAgentSpawnRouteInventory(worktreeDir: string): Promise<{ method: string; path: string }[]> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w9as-verify-'));
  const bootScript = `
import { pathToFileURL } from 'node:url';
process.env.OD_DATA_DIR = ${JSON.stringify(dataDir)};
const mod = await import(pathToFileURL(${JSON.stringify(path.join(worktreeDir, 'apps/daemon/src/server.ts'))}).href);
const started = await mod.startServer({ port: 0, host: '127.0.0.1', returnServer: true });
console.log('OD_W9AS_VERIFIER_READY ' + JSON.stringify({ routeInventory: started.routeInventory }));
await started.shutdown();
process.exit(0);
`;
  const scriptPath = path.join(proofDir, `.boot-daemon.${process.pid}.${crypto.randomBytes(3).toString('hex')}.mjs`);
  fs.writeFileSync(scriptPath, bootScript);
  const child = spawn('pnpm', ['exec', 'tsx', scriptPath], { cwd: worktreeDir, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffered = '';
  const routes = await new Promise<{ method: string; path: string }[] | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 60_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const line = buffered.split('\n').find((l) => l.startsWith('OD_W9AS_VERIFIER_READY '));
      if (line) {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(line.slice('OD_W9AS_VERIFIER_READY '.length)) as {
            routeInventory: { method: string; path: string }[];
          };
          resolve(parsed.routeInventory);
        } catch {
          resolve(null);
        }
      }
    });
    child.on('exit', () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      resolve();
    }, 5_000);
    child.kill('SIGTERM');
    child.on('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
  try {
    fs.unlinkSync(scriptPath);
  } catch {
    /* best effort */
  }
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  if (!routes) throw new Error(`daemon failed to boot / report routeInventory within 60s (stdout tail: ${buffered.slice(-2000)})`);
  return routes;
}

// -------------------------------------------------------------------------
// Attribution matrix -- S9S-3/S9S-4.
// -------------------------------------------------------------------------
interface AttributionRow {
  route?: unknown;
  owner?: unknown;
  authn?: unknown;
  authz?: unknown;
  inputValidation?: unknown;
  sizeRateLimit?: unknown;
  testRef?: unknown;
  riskScore?: { exposure?: unknown; impact?: unknown; score?: unknown; tier?: unknown };
  control?: { mechanism?: unknown; testRef?: unknown };
  acceptedRisk?: { decisionRef?: unknown };
}
const ATTRIBUTION_PATH_REL = 'docs/security/agent-spawn-attribution.json';
function loadAttributionMatrix(worktreeDir: string): { rows: AttributionRow[] } | { error: string } {
  const abs = path.join(worktreeDir, ATTRIBUTION_PATH_REL);
  if (!fs.existsSync(abs)) return { error: `${ATTRIBUTION_PATH_REL} does not exist (HEAD worktree)` };
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (!Array.isArray(parsed)) return { error: `${ATTRIBUTION_PATH_REL} does not parse to a JSON array` };
    return { rows: parsed as AttributionRow[] };
  } catch (err) {
    return { error: `${ATTRIBUTION_PATH_REL} failed to parse: ${String(err)}` };
  }
}
const PLACEHOLDER_DENYLIST = /^(x+|n\/?a|tbd|none|unknown|placeholder|todo|xxx+|-+|\.+)$/i;
function isPlaceholderText(raw: unknown): boolean {
  if (typeof raw !== 'string') return true;
  const trimmed = raw.trim();
  if (trimmed.length < 12) return true;
  if (PLACEHOLDER_DENYLIST.test(trimmed)) return true;
  if (/^(.)\1*$/.test(trimmed.replace(/\s+/g, ''))) return true;
  return false;
}
function routeAssociationTerms(routeKey: string): string[] {
  const path2 = routeKey.split(' ')[1] ?? '';
  return path2
    .split('/')
    .map((seg) => seg.trim().toLowerCase())
    .filter((seg) => seg.length > 0 && seg !== 'api' && !seg.startsWith(':'));
}
const EXPOSURE_KEYWORDS: Record<number, RegExp> = {
  0: /authorizetoolrequest|tool token|capability grant/i,
  2: /requirelocaldaemonrequest|islocalsameorigin|loopback/i,
  3: /\bnone\b|no gate|zero-config/i,
};

interface EnforcedDeclaration {
  kind: 'request-rate' | 'byte-volume';
  scope: 'token-hash' | 'origin';
  limit: number;
  windowMs: number | null;
  overflow: 'reject-429' | 'reject-413';
}
function parseEnforcedDeclaration(mechanism: string): EnforcedDeclaration | null {
  const m = /^ENFORCED kind=(request-rate|byte-volume) scope=(token-hash|origin) limit=(\d+) windowMs=(\d+|none) overflow=(reject-429|reject-413)$/.exec(
    mechanism.trim(),
  );
  if (!m) return null;
  const [, kind, scope, limitStr, windowStr, overflow] = m as unknown as [string, EnforcedDeclaration['kind'], EnforcedDeclaration['scope'], string, string, EnforcedDeclaration['overflow']];
  const limit = Number(limitStr);
  if (limit <= 0) return null;
  const windowMs = windowStr === 'none' ? null : Number(windowStr);
  if (kind === 'request-rate' && (windowMs === null || windowMs <= 0)) return null;
  if (kind === 'byte-volume' && windowMs !== null) return null;
  return { kind, scope, limit, windowMs, overflow };
}
function containsExactNumericToken(text: string, n: number): boolean {
  return new RegExp(`(?<!\\d)${n}(?!\\d)`).test(text);
}
const POSITIVE_SIGNAL_RE = /accept|allow|succeed|within|under.?limit|ok\b/i;
const NEGATIVE_SIGNAL_RE = /reject|deny|block|refuse|over.?limit|exceed/i;
// BLOCKER 5 FIX: the over-limit matcher now binds `limit` too, not only the
// overflow status -- round 1's version accepted a `limit` parameter it never
// checked.
function matchesUnderLimitAssertion(fullName: string, routeTerms: readonly string[], limit: number): boolean {
  const hasTerm = routeTerms.some((t) => fullName.toLowerCase().includes(t));
  return hasTerm && POSITIVE_SIGNAL_RE.test(fullName) && containsExactNumericToken(fullName, limit);
}
function matchesOverLimitAssertion(fullName: string, routeTerms: readonly string[], limit: number, overflowStatus: number): boolean {
  const hasTerm = routeTerms.some((t) => fullName.toLowerCase().includes(t));
  return (
    hasTerm &&
    NEGATIVE_SIGNAL_RE.test(fullName) &&
    containsExactNumericToken(fullName, limit) &&
    containsExactNumericToken(fullName, overflowStatus)
  );
}
function hasDistinctSignalPair(candidates: readonly { fullName: string }[]): boolean {
  const positives = candidates.filter((c) => POSITIVE_SIGNAL_RE.test(c.fullName) && !NEGATIVE_SIGNAL_RE.test(c.fullName));
  const negatives = candidates.filter((c) => NEGATIVE_SIGNAL_RE.test(c.fullName) && !POSITIVE_SIGNAL_RE.test(c.fullName));
  if (positives.length === 0 || negatives.length === 0) return false;
  return positives.some((p) => negatives.some((n) => n.fullName !== p.fullName));
}
// BLOCKER 5 FIX: body-text status-code assertion. Requires the cited test's
// own source body (captured verbatim during AST extraction) to contain a
// real status-code check naming the exact expected code, within a short
// token window of the word "status" -- closes "examines test names only".
function bodyAssertsStatusCode(bodyText: string, code: number): boolean {
  const windows: string[] = [];
  let idx = bodyText.toLowerCase().indexOf('status');
  while (idx !== -1) {
    windows.push(bodyText.slice(Math.max(0, idx - 20), idx + 80));
    idx = bodyText.toLowerCase().indexOf('status', idx + 1);
  }
  return windows.some((w) => containsExactNumericToken(w, code));
}

// -------------------------------------------------------------------------
// Test declaration extraction (AST) -- titles AND body source text, so
// corpus-case matching and body-text assertion checks are scoped to real
// test declarations, never combined raw source text including comments
// (BLOCKER 5 FIX: "one comment satisfies all five" regex-over-whole-file
// gap).
// -------------------------------------------------------------------------
interface TestDeclaration {
  title: string;
  bodyText: string;
}
function extractTestDeclarations(sourceText: string, label: string): TestDeclaration[] {
  const out: TestDeclaration[] = [];
  let sourceFile: TypeScriptModule.SourceFile;
  try {
    sourceFile = ts.createSourceFile(label, sourceText, ts.ScriptTarget.Latest, true);
  } catch {
    return out;
  }
  const isItOrTestRoot = (expr: TsNode): boolean => {
    if (ts.isIdentifier(expr)) return expr.text === 'it' || expr.text === 'test';
    if (ts.isPropertyAccessExpression(expr)) return isItOrTestRoot(expr.expression);
    if (ts.isCallExpression(expr)) return isItOrTestRoot(expr.expression);
    return false;
  };
  const visit = (node: TsNode) => {
    if (ts.isCallExpression(node) && isItOrTestRoot(node.expression)) {
      const first = node.arguments[0];
      const second = node.arguments[1];
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
        const bodyText = second ? second.getFullText(sourceFile) : '';
        out.push({ title: first.text, bodyText });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}
function extractStaticTestTitlesFromSource(sourceText: string, label: string): Set<string> {
  return new Set(extractTestDeclarations(sourceText, label).map((d) => d.title));
}

function findIntroductionCommit(relPath: string, leafTitle: string): { introducedAt: string; parentOfIntroduction: string } | null {
  const logResult = sh('git', ['log', '--reverse', '--format=%H', `${baseCommit}..${headSha}`, '--', relPath]);
  if (logResult.status !== 0) return null;
  const commits = logResult.stdout.trim().split('\n').filter(Boolean);
  for (const commit of commits) {
    let content: string;
    try {
      content = readFileAtCommit(commit, relPath);
    } catch {
      continue;
    }
    if (extractStaticTestTitlesFromSource(content, `${commit}:${relPath}`).has(leafTitle)) {
      const parentResult = sh('git', ['rev-parse', `${commit}^`]);
      if (parentResult.status !== 0) return null;
      return { introducedAt: commit, parentOfIntroduction: parentResult.stdout.trim() };
    }
  }
  return null;
}

// =========================================================================
// BLOCKER 5 FIX -- full detached-worktree Vitest-Node-API replay, ported
// from verify-w9-ingest.ts (required now, per the ruling: "its six-round
// hardening cost is a reason to reuse it, not defer it"). Bypasses the JSON
// reporter entirely; walks the real reported task forest via vitest/node's
// public API. See verify-w9-ingest.ts for the full forensic justification;
// reproduced here only where the mechanism itself needs it.
// =========================================================================
interface SerializedTaskNode {
  type: 'module' | 'suite' | 'test';
  name: string;
  fullName: string;
  state: string;
  errors: string[];
  children?: SerializedTaskNode[];
}
interface SerializedReplayForest {
  moduleCount: number;
  modules: SerializedTaskNode[];
  unhandledErrors: string[];
}
function generateReplayMarker(): string {
  return `W9AS_REPLAY_RESULT_JSON_${crypto.randomBytes(16).toString('hex')}:`;
}
function buildReplayRunnerScript(marker: string): string {
  return [
    "import { startVitest } from 'vitest/node';",
    '',
    'function serializeErrors(errors) {',
    "  return (errors || []).map((e) => (e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e)));",
    '}',
    'function serializeNode(node) {',
    "  if (node.type === 'test') {",
    '    const result = node.result();',
    "    return { type: 'test', name: node.name, fullName: node.fullName, state: result.state, errors: serializeErrors(result.errors) };",
    '  }',
    '  const children = [...node.children].map(serializeNode);',
    '  return {',
    '    type: node.type,',
    "    name: node.type === 'module' ? node.relativeModuleId : node.name,",
    "    fullName: node.type === 'module' ? node.moduleId : node.fullName,",
    '    state: node.state(),',
    '    errors: serializeErrors(node.errors()),',
    '    children,',
    '  };',
    '}',
    '',
    'const targetFile = process.argv[2];',
    "const ctx = await startVitest('test', [targetFile], { root: process.cwd(), watch: false, reporters: [], config: 'vitest.config.ts' });",
    'const testModules = ctx.state.getTestModules();',
    'const unhandledErrors = ctx.state.getUnhandledErrors();',
    'const serialized = { moduleCount: testModules.length, modules: testModules.map(serializeNode), unhandledErrors: serializeErrors(unhandledErrors) };',
    `console.log(${JSON.stringify(marker)} + JSON.stringify(serialized));`,
    'await ctx.close();',
    'process.exit(process.exitCode ?? 0);',
    '',
  ].join('\n');
}
function evaluateTaskForestConsistency(forest: SerializedReplayForest, targetFullName: string, controlFullName: string): string[] {
  const problems: string[] = [];
  if (forest.moduleCount !== 1 || forest.modules.length !== 1) {
    problems.push(`expected exactly 1 module task, got moduleCount=${forest.moduleCount} modules.length=${forest.modules.length}`);
  }
  const moduleNode = forest.modules[0];
  if (!moduleNode) {
    problems.push('no module task found in the serialized forest');
    return problems;
  }
  let targetState: string | null = null;
  let controlState: string | null = null;
  let failedLeafCount = 0;
  let soleFailedLeafFullName: string | null = null;
  const disallowedErrorNodes: string[] = [];
  function walk(node: SerializedTaskNode): void {
    const isTargetTestNode = node.type === 'test' && node.fullName === targetFullName;
    if (node.errors.length > 0 && !isTargetTestNode) {
      disallowedErrorNodes.push(`${node.type} "${node.fullName}": ${JSON.stringify(node.errors)}`);
    }
    if (node.type === 'test') {
      if (node.state === 'failed') {
        failedLeafCount += 1;
        soleFailedLeafFullName = node.fullName;
      }
      if (node.fullName === targetFullName) targetState = node.state;
      if (node.fullName === controlFullName) controlState = node.state;
      return;
    }
    for (const child of node.children ?? []) walk(child);
  }
  walk(moduleNode);

  if (forest.unhandledErrors.length > 0) problems.push(`run-level unhandled errors present: ${JSON.stringify(forest.unhandledErrors)}`);
  if (disallowedErrorNodes.length > 0) problems.push(`errors present outside the target test's own assertion failure: ${disallowedErrorNodes.join('; ')}`);
  if (failedLeafCount !== 1) problems.push(`expected exactly 1 failed test leaf in the entire tree, found ${failedLeafCount}`);
  else if (soleFailedLeafFullName !== targetFullName) problems.push(`the one failed test leaf is "${soleFailedLeafFullName}", expected the target "${targetFullName}"`);
  if (targetState === null) problems.push(`target test "${targetFullName}" not found in the serialized forest`);
  else if (targetState !== 'failed') problems.push(`target test state is "${targetState}", expected "failed"`);
  if (controlState === null) problems.push(`CONTROL_TEST "${controlFullName}" not found in the serialized forest`);
  else if (controlState !== 'passed') problems.push(`CONTROL_TEST state is "${controlState}", expected "passed"`);
  return problems;
}
interface ReplayOutcome {
  ok: boolean;
  problems: string[];
  evidenceLines: string[];
}
function replayRedEvidence(parentSha: string, containingFileRel: string, targetFullName: string, controlTestFullName: string): ReplayOutcome {
  const problems: string[] = [];
  const evidenceLines: string[] = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w9as-replay-'));
  let worktreeAdded = false;
  try {
    const addResult = sh('git', ['worktree', 'add', '--detach', tempDir, parentSha], { timeoutMs: 5 * 60_000 });
    evidenceLines.push(`git worktree add --detach ${tempDir} ${parentSha} => exit=${addResult.status}`);
    if (addResult.status !== 0) {
      problems.push(`git worktree add failed (exit=${addResult.status}): ${addResult.stdout.slice(-500)}`);
      return { ok: false, problems, evidenceLines };
    }
    worktreeAdded = true;

    sh('mise', ['trust'], { cwd: tempDir, timeoutMs: 30_000 });
    const installResult = sh('pnpm', ['install', '--offline', '--frozen-lockfile'], { cwd: tempDir, timeoutMs: 5 * 60_000 });
    evidenceLines.push(`pnpm install --offline --frozen-lockfile => exit=${installResult.status}`);
    if (installResult.status !== 0) {
      problems.push(`frozen offline install failed (exit=${installResult.status}): ${installResult.stdout.slice(-1000)}`);
      return { ok: false, problems, evidenceLines };
    }

    const headFileAbs = path.join(headWorktreeDir || repoRoot, 'apps/daemon', containingFileRel);
    const targetFileAbs = path.join(tempDir, 'apps/daemon', containingFileRel);
    try {
      fs.mkdirSync(path.dirname(targetFileAbs), { recursive: true });
      fs.copyFileSync(headFileAbs, targetFileAbs);
    } catch (err) {
      problems.push(`could not overlay HEAD test file: ${String(err)}`);
      return { ok: false, problems, evidenceLines };
    }
    evidenceLines.push(`overlay: HEAD:apps/daemon/${containingFileRel} -> ${targetFileAbs}`);

    const marker = generateReplayMarker();
    const runnerScriptAbs = path.join(tempDir, 'apps/daemon', '.w9as-replay-runner.mjs');
    fs.writeFileSync(runnerScriptAbs, buildReplayRunnerScript(marker));
    const targetFileArg = `tests/${path.basename(containingFileRel)}`;
    const argvList = ['--filter', '@open-design/daemon', 'exec', 'node', '.w9as-replay-runner.mjs', targetFileArg];
    evidenceLines.push(`argv: pnpm ${argvList.join(' ')} (cwd=${path.join(tempDir, 'apps/daemon')})`);
    const runResult = sh('pnpm', argvList, { cwd: path.join(tempDir, 'apps/daemon'), timeoutMs: 3 * 60_000 });

    if (runResult.processError) {
      const outputHash = sha256Bytes(`--- stdout ---\n${runResult.stdout}\n--- stderr ---\n${runResult.stderr}`);
      evidenceLines.push(`exit=${runResult.status} processError=true stdout+stderr sha256=${outputHash}`);
      problems.push('replay child process reported a spawn error or was killed (timeout/signal) -- not a genuine test-driven red exit');
      return { ok: false, problems, evidenceLines };
    }

    const markerLines = runResult.stdout.split('\n').filter((l) => l.startsWith(marker));
    const outputHash = sha256Bytes(`--- runner output ---\n${markerLines[0] ?? ''}\n--- stdout ---\n${runResult.stdout}\n--- stderr ---\n${runResult.stderr}`);
    evidenceLines.push(`exit=${runResult.status} processError=false stdout+stderr+runnerOutput sha256=${outputHash}`);
    if (markerLines.length !== 1) {
      problems.push(`replay runner produced ${markerLines.length} marker-prefixed line(s) on stdout, expected exactly 1`);
      return { ok: false, problems, evidenceLines };
    }
    const markerLine = markerLines[0]!;

    let forest: SerializedReplayForest | null = null;
    try {
      forest = JSON.parse(markerLine.slice(marker.length)) as SerializedReplayForest;
    } catch (err) {
      problems.push(`replay runner's serialized forest could not be parsed: ${String(err)}`);
      return { ok: false, problems, evidenceLines };
    }
    evidenceLines.push(`forest: moduleCount=${forest.moduleCount} unhandledErrors=${JSON.stringify(forest.unhandledErrors)}`);

    const forestProblems = evaluateTaskForestConsistency(forest, targetFullName, controlTestFullName);
    problems.push(...forestProblems);
    if (runResult.status === 0) problems.push('replay child process exited 0 (expected nonzero for a genuine red state)');

    return { ok: problems.length === 0, problems, evidenceLines };
  } catch (err) {
    problems.push(`replay crashed: ${String(err)}`);
    return { ok: false, problems, evidenceLines };
  } finally {
    if (worktreeAdded) sh('git', ['worktree', 'remove', '--force', tempDir], { timeoutMs: 60_000 });
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
function parseRedTranscript(content: string): { parentSha?: string; command?: string; test?: string; controlTest?: string } {
  const out: { parentSha?: string; command?: string; test?: string; controlTest?: string } = {};
  for (const line of content.split('\n')) {
    const m = /^([A-Z_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, valueRaw] = m as unknown as [string, string, string];
    const value = valueRaw.trim();
    if (key === 'PARENT_SHA') out.parentSha = value;
    else if (key === 'COMMAND') out.command = value;
    else if (key === 'TEST') out.test = value;
    else if (key === 'CONTROL_TEST') out.controlTest = value;
  }
  return out;
}

// -------------------------------------------------------------------------
// Dedicated test suite discovery + run -- sourced from the detached HEAD
// worktree.
// -------------------------------------------------------------------------
interface AssertionResult {
  fullName: string;
  title: string;
  status: string;
}
interface FileTestResult {
  name: string;
  status: string;
  message: string;
  assertionResults: AssertionResult[];
}
interface SuiteJson {
  success: boolean;
  numTotalTestSuites: number;
  numFailedTestSuites: number;
  numFailedTests: number;
  numPassedTests: number;
  numPendingTests?: number;
  testResults: FileTestResult[];
}
function discoverAgentSpawnTestFiles(worktreeDir: string): string[] {
  const testsDir = path.join(worktreeDir, 'apps/daemon/tests');
  if (!fs.existsSync(testsDir)) return [];
  return fs
    .readdirSync(testsDir)
    .filter((f) => /^agent-spawn-.*\.test\.ts$/.test(f))
    .sort()
    .map((f) => `tests/${f}`);
}
function runAgentSpawnSuite(worktreeDir: string, testFiles: string[]): { suite: { status: number }; data: SuiteJson | null } {
  const jsonPath = path.join(proofDir, `suite-run.${process.pid}.json`);
  const suite = sh(
    'pnpm',
    ['--filter', '@open-design/daemon', 'exec', 'vitest', 'run', '-c', 'vitest.config.ts', '--reporter=json', `--outputFile=${jsonPath}`, ...testFiles],
    { cwd: worktreeDir, timeoutMs: 3 * 60_000 },
  );
  let data: SuiteJson | null = null;
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as SuiteJson;
  } catch {
    data = null;
  }
  return { suite, data };
}

// -------------------------------------------------------------------------
// DECISIONS.md accepted-risk resolution -- W9AS-ACCEPT-<slug> headings, read
// at baseCommit (git object store, immune to worktree mutation already).
// -------------------------------------------------------------------------
interface AcceptedRiskBlock {
  slug: string;
  route: string;
  accepter: string;
  date: string;
  rationale: string;
}
function parseAcceptedRiskBlocks(decisionsText: string): { blocks: Map<string, AcceptedRiskBlock[]> } {
  const blocks = new Map<string, AcceptedRiskBlock[]>();
  const headingRe = /^### W9AS-ACCEPT-([a-z0-9-]+)\s*$/gim;
  const matches = [...decisionsText.matchAll(headingRe)];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (!match) continue;
    const slug = match[1] ?? '';
    const start = (match.index ?? 0) + match[0].length;
    const nextMatch = matches[i + 1];
    const end = nextMatch ? nextMatch.index ?? decisionsText.length : decisionsText.length;
    const body = decisionsText.slice(start, end);
    const route = /-\s*Route:\s*`([^`]+)`/i.exec(body)?.[1]?.trim() ?? '';
    const accepter = /-\s*Accepter:\s*(.+)/i.exec(body)?.[1]?.trim() ?? '';
    const date = /-\s*Date:\s*(\S+)/i.exec(body)?.[1]?.trim() ?? '';
    const rationale = /-\s*Rationale:\s*(.+)/i.exec(body)?.[1]?.trim() ?? '';
    const block: AcceptedRiskBlock = { slug, route, accepter, date, rationale };
    const existing = blocks.get(slug) ?? [];
    existing.push(block);
    blocks.set(slug, existing);
  }
  return { blocks };
}

// -------------------------------------------------------------------------
// Lease helpers.
// -------------------------------------------------------------------------
function globToRegExp(glob: string): RegExp {
  let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  re = re.replace(/\*\*/g, ' GLOBSTAR ');
  re = re.replace(/\*/g, '[^/]*');
  re = re.replace(/ GLOBSTAR /g, '.*');
  return new RegExp(`^${re}$`);
}
function loadLeaseAllowGlobs(): string[] | null {
  try {
    const leasesText = readFileAtCommit(baseCommit, 'docs/plans/waves/leases.json');
    const parsed = JSON.parse(leasesText) as { waves: Record<string, { allow: string[] }> };
    return parsed.waves[LEASE_KEY]?.allow ?? null;
  } catch {
    return null;
  }
}

// =========================================================================
// BLOCKER 6 FIX -- threat-model doc bounded-section/fence-aware/exact-
// citation machinery, ported VERBATIM from verify-w9-ingest.ts's own
// six-round-hardened C9-7 (there; C9S-6 here), adapted for this tranche's
// tag/section names.
// =========================================================================
function checkThreatModelSection(
  worktreeDir: string,
  p0Keys: readonly string[],
  expectedRefByKey: Map<string, string>,
  associatedRoutesByRef: Map<string, Set<string>>,
  passedTestNames: Set<string>,
): { ok: boolean; evidence: string } {
  const threatModelPath = path.join(worktreeDir, 'docs/security/daemon-threat-model.md');
  if (!fs.existsSync(threatModelPath)) {
    return { ok: false, evidence: 'docs/security/daemon-threat-model.md does not exist (HEAD worktree)' };
  }
  const text = fs.readFileSync(threatModelPath, 'utf8');
  const afterHeading = text.split(/^##\s+Wave 9\b.*$/m)[1];
  const waveSection = afterHeading?.split(/\n##\s+/)[0];
  if (!waveSection) {
    return { ok: false, evidence: `no "## Wave 9" heading found; head of file: ${text.slice(0, 300)}` };
  }
  const MARKDOWN_BULLET_LINE = /^\s*(?:[-*+]|\d+\.)\s+/;
  const FENCE_MARKER_LINE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
  const INDENTED_CODE_LINE = /^ {4,}/;
  const bulletLines: string[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const line of waveSection.split('\n')) {
    const fenceMatch = FENCE_MARKER_LINE.exec(line);
    if (fenceMatch) {
      const run = fenceMatch[2]!;
      const rest = fenceMatch[3]!;
      const char = run[0]!;
      const length = run.length;
      if (!fence) {
        const invalidBacktickOpener = char === '`' && rest.includes('`');
        if (!invalidBacktickOpener) {
          fence = { char, length };
          continue;
        }
      } else {
        if (char === fence.char && length >= fence.length && rest.trim() === '') fence = null;
        continue;
      }
    }
    if (fence) continue;
    if (INDENTED_CODE_LINE.test(line)) continue;
    if (MARKDOWN_BULLET_LINE.test(line) && /\[C9S-\d+\]/.test(line)) bulletLines.push(line);
  }
  const problems: string[] = [];
  const bulletsCoveringP0 = new Set<string>();
  for (const line of bulletLines) {
    const backtickMatches = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
    const cited = backtickMatches.find((t) => t.length > 20);
    if (!cited) {
      problems.push(`no backtick-quoted test name found: ${line.slice(0, 120)}`);
      continue;
    }
    if (!passedTestNames.has(cited)) {
      problems.push(`cited test not an exact PASSED match: "${cited.slice(0, 160)}"`);
      continue;
    }
    const lineLower = line.toLowerCase();
    const p0KeysInLine = p0Keys.filter((k) => lineLower.includes(k.toLowerCase()));
    if (p0KeysInLine.length === 0) continue;
    if (p0KeysInLine.length > 1) {
      problems.push(`bullet names ${p0KeysInLine.length} P0 route keys in one line (must be exactly one): ${line.slice(0, 160)}`);
      continue;
    }
    const routeKey = p0KeysInLine[0]!;
    const expectedRef = expectedRefByKey.get(routeKey) ?? '';
    if (cited !== expectedRef) {
      problems.push(`bullet for ${routeKey} cites "${cited}", expected exactly "${expectedRef}"`);
      continue;
    }
    const associatedRoutes = associatedRoutesByRef.get(cited);
    if (!associatedRoutes || associatedRoutes.size !== 1 || !associatedRoutes.has(routeKey)) {
      problems.push(`bullet for ${routeKey} cites "${cited}", which is not globally associated with exactly this route`);
      continue;
    }
    bulletsCoveringP0.add(routeKey);
  }
  const uncoveredP0 = p0Keys.filter((k) => !bulletsCoveringP0.has(k));
  const ok = bulletLines.length > 0 && problems.length === 0 && uncoveredP0.length === 0;
  return {
    ok,
    evidence: `[C9S-N] bullets found: ${bulletLines.length}\nP0 routes: ${p0Keys.join(', ') || 'none'}\nuncovered P0 routes: ${uncoveredP0.join(', ') || 'none'}\n${problems.join('\n') || 'all citations matched'}`,
  };
}

// =========================================================================
// main()
// =========================================================================
async function main(): Promise<void> {
  const placeholderWrite = writeManifestFile(buildManifest(false, true, false));
  if (!placeholderWrite.written) {
    console.error('verify-w9-agent-spawn: FATAL: could not write the initial wroteOk:false placeholder manifest -- aborting.');
    process.exit(1);
  }

  const selfProbeResults = runExposureSelfProbes();
  const selfProbeFailures = selfProbeResults.filter((p) => !p.ok);

  const worktree = createDetachedHeadWorktree();
  if (!worktree.ok) {
    record('C9S-1', 'git worktree add --detach <tmp> <headSha>', 'a detached HEAD worktree can be created for HEAD-state-integrity reads', false, '', {
      detail: `detached HEAD worktree creation failed: ${worktree.error}`,
    });
  } else {
    headWorktreeDir = worktree.dir;
  }

  // -----------------------------------------------------------------------
  // Per-owned-file AST collection (baseCommit + HEAD-from-detached-worktree).
  // -----------------------------------------------------------------------
  interface FileCollectState {
    file: OwnedFile;
    baseCommitCollect: CollectResult | null;
    baseCommitError: string;
    headCollect: CollectResult | null;
    headError: string;
  }
  const fileStates: FileCollectState[] = OWNED_FILES.map((file) => {
    let baseCommitCollect: CollectResult | null = null;
    let baseCommitError = '';
    try {
      const baseText = readFileAtCommit(baseCommit, file.relPath);
      baseCommitCollect = collectScopedRouteRegistrations(baseText, `${baseCommit}:${file.relPath}`, file.fnName, file.pathFilter);
    } catch (err) {
      baseCommitError = String((err as Error)?.stack ?? err);
    }
    let headCollect: CollectResult | null = null;
    let headError = '';
    if (headWorktreeDir) {
      try {
        const headText = fs.readFileSync(path.join(headWorktreeDir, file.relPath), 'utf8');
        headCollect = collectScopedRouteRegistrations(headText, `HEAD:${file.relPath}`, file.fnName, file.pathFilter);
      } catch (err) {
        headError = String((err as Error)?.stack ?? err);
      }
    } else {
      headError = 'detached HEAD worktree unavailable';
    }
    return { file, baseCommitCollect, baseCommitError, headCollect, headError };
  });

  const headExposureByKey = new Map<string, number>();
  for (const fState of fileStates) {
    if (!fState.headCollect || !headWorktreeDir) continue;
    try {
      const headText = fs.readFileSync(path.join(headWorktreeDir, fState.file.relPath), 'utf8');
      const sourceFile = ts.createSourceFile(`HEAD:${fState.file.relPath}`, headText, ts.ScriptTarget.Latest, true);
      const fnBody = findFunctionBody(sourceFile, fState.file.fnName);
      if (!fnBody) continue;
      for (const reg of fState.headCollect.registrations) {
        headExposureByKey.set(`${reg.method} ${reg.routePath}`, classifyExposure(reg, fnBody));
      }
    } catch {
      /* leave unset; downstream checks report missing entries */
    }
  }

  // C9S-1: route snapshot frozen across 4 files, self-probe-gated.
  await checkCriterion('C9S-1', async () => {
    if (!headWorktreeDir) return; // already recorded above
    if (selfProbeFailures.length > 0) {
      record(
        'C9S-1',
        'exposure-classifier self-probes (14 fixtures) run through the real collector/classifier pipeline',
        'every self-probe fixture classifies at its expected exposure (or, for computed-path probes, is correctly flagged)',
        false,
        selfProbeResults.map((p) => `[${p.ok ? 'PASS' : 'FAIL'}] ${p.name}: ${p.detail}`).join('\n'),
        { detail: `${selfProbeFailures.length}/${selfProbeResults.length} self-probes failed -- classifier/collector is not trustworthy this run` },
      );
      return;
    }
    const problems: string[] = [];
    for (const fState of fileStates) {
      const { file, baseCommitCollect, baseCommitError, headCollect, headError } = fState;
      if (!baseCommitCollect) {
        problems.push(`${file.relPath}: could not derive baseCommit route set: ${baseCommitError}`);
        continue;
      }
      if (!headCollect) {
        problems.push(`${file.relPath}: could not derive HEAD route set: ${headError}`);
        continue;
      }
      if (file.fullFreeze && baseCommitCollect.totalCallCount !== baseCommitCollect.staticCallCount) {
        problems.push(`${file.relPath}@baseCommit: ${baseCommitCollect.totalCallCount - baseCommitCollect.staticCallCount} computed/dynamic route path(s) detected in a fully-frozen function -- hard fail`);
      }
      if (file.fullFreeze && headCollect.totalCallCount !== headCollect.staticCallCount) {
        problems.push(`${file.relPath}@HEAD: ${headCollect.totalCallCount - headCollect.staticCallCount} computed/dynamic route path(s) detected in a fully-frozen function -- hard fail`);
      }
      const baseKeys = new Set(baseCommitCollect.registrations.map((r) => `${r.method} ${r.routePath}`));
      const headKeys = new Set(headCollect.registrations.map((r) => `${r.method} ${r.routePath}`));
      const relevantFrozenKeys = [...FROZEN_ROUTE_KEYS].filter((k) => file.livePathPrefixes.some((p) => k.split(' ')[1] === p || k.split(' ')[1]?.startsWith(p)));
      for (const key of relevantFrozenKeys) {
        if (!baseKeys.has(key)) problems.push(`${file.relPath}@baseCommit: missing frozen route ${key}`);
        if (!headKeys.has(key)) problems.push(`${file.relPath}@HEAD: missing frozen route ${key}`);
      }
      if (baseCommitCollect.duplicates.length > 0) problems.push(`${file.relPath}@baseCommit: duplicate registrations: ${baseCommitCollect.duplicates.join(', ')}`);
      if (headCollect.duplicates.length > 0) problems.push(`${file.relPath}@HEAD: duplicate registrations: ${headCollect.duplicates.join(', ')}`);
    }

    let liveRoutesRaw: { method: string; path: string }[];
    try {
      liveRoutesRaw = await bootDaemonForAgentSpawnRouteInventory(headWorktreeDir);
    } catch (err) {
      record('C9S-1', 'isolated daemon boot from the detached HEAD worktree (port 0, mkdtemp OD_DATA_DIR) -> routeInventory', 'a live daemon boots and reports its own route registrations', false, '', {
        detail: `daemon boot failed: ${String((err as Error)?.stack ?? err)}`,
      });
      return;
    }
    const liveCounts = new Map<string, number>();
    for (const r of liveRoutesRaw) {
      if (r.method === 'USE' || r.method === 'ALL') continue;
      const k = `${r.method} ${r.path}`;
      liveCounts.set(k, (liveCounts.get(k) ?? 0) + 1);
    }
    for (const key of FROZEN_ROUTE_KEYS) {
      const count = liveCounts.get(key) ?? 0;
      if (count !== 1) problems.push(`${key}: live count ${count} (expected exactly 1)`);
    }
    // BLOCKER 3b FIX: allowlist-based drift check for the two fully-frozen
    // files' owned prefixes -- anything present live at an owned prefix that
    // is neither a frozen key nor a named sibling exclusion is a hard fail.
    for (const file of OWNED_FILES.filter((f) => f.fullFreeze)) {
      const ownedFrozenKeys = new Set([...FROZEN_ROUTE_KEYS].filter((k) => file.livePathPrefixes.some((p) => k.split(' ')[1]?.startsWith(p))));
      const liveAtPrefix = [...liveCounts.keys()].filter((k) => file.livePathPrefixes.some((p) => k.split(' ')[1]?.startsWith(p)));
      for (const liveKey of liveAtPrefix) {
        if (ownedFrozenKeys.has(liveKey)) continue;
        if (file.liveSiblingExclusions.includes(liveKey)) continue;
        problems.push(`${file.relPath}: unaccounted live route at owned prefix, neither frozen nor a named sibling exclusion: ${liveKey}`);
      }
    }
    const exposureLines = [...headExposureByKey.entries()].map(([k, v]) => `${k} => exposure ${v}`).join('\n');
    record(
      'C9S-1',
      '14 self-probes + per-file baseCommit/HEAD AST self-consistency (computed-path hard-fail for fully-frozen files) + isolated daemon boot from the detached HEAD worktree -> allowlist-checked live route presence',
      '17-route frozen snapshot matches routes/runs.ts, routes/terminal.ts, routes/routine.ts (1 route), and routes/media.ts (1 route) at both baseCommit and HEAD, and each frozen route appears exactly once live, with no unaccounted sibling registrations at owned prefixes',
      problems.length === 0,
      `${problems.join('\n') || 'no problems'}\n\nlive-derived exposure (HEAD):\n${exposureLines}`,
    );
  });

  // Load the attribution matrix once, from the detached HEAD worktree.
  const attribution = headWorktreeDir ? loadAttributionMatrix(headWorktreeDir) : { error: 'detached HEAD worktree unavailable' };

  // C9S-2: riskScore formula, integer-bounded impact.
  await checkCriterion('C9S-2', () => {
    if ('error' in attribution) {
      record('C9S-2', `read ${ATTRIBUTION_PATH_REL} (HEAD worktree)`, "every row's riskScore is integer-bounded [0,3] impact, formula-consistent, and exposure exactly matches the live-derived value", false, '', { detail: attribution.error });
      return;
    }
    const problems: string[] = [];
    for (const row of attribution.rows) {
      const key = typeof row.route === 'string' ? row.route : '<missing route>';
      const floor = IMPACT_FLOOR_BY_KEY.get(key);
      if (floor === undefined) {
        problems.push(`${key}: not a frozen route key`);
        continue;
      }
      const liveExposure = headExposureByKey.get(key);
      if (liveExposure === undefined) {
        problems.push(`${key}: could not re-derive live exposure from HEAD`);
        continue;
      }
      const rs = row.riskScore;
      const declaredExposure = typeof rs?.exposure === 'number' ? rs.exposure : NaN;
      const declaredImpact = typeof rs?.impact === 'number' ? rs.impact : NaN;
      const declaredScore = typeof rs?.score === 'number' ? rs.score : NaN;
      const declaredTier = typeof rs?.tier === 'string' ? rs.tier : '';
      if (!Number.isInteger(declaredImpact) || declaredImpact < 0 || declaredImpact > 3) {
        problems.push(`${key}: declared impact ${declaredImpact} is not an integer in [0,3]`);
      }
      if (declaredExposure !== liveExposure) problems.push(`${key}: declared exposure ${declaredExposure} !== live-derived ${liveExposure}`);
      if (!(declaredImpact >= floor)) problems.push(`${key}: declared impact ${declaredImpact} < frozen floor ${floor}`);
      const expectedScore = liveExposure + declaredImpact;
      if (declaredScore !== expectedScore) problems.push(`${key}: declared score ${declaredScore} !== exposure+impact ${expectedScore}`);
      if (declaredTier !== tierFor(expectedScore)) problems.push(`${key}: declared tier ${declaredTier} !== tierFor(score) ${tierFor(expectedScore)}`);
    }
    record(
      'C9S-2',
      `read ${ATTRIBUTION_PATH_REL} (HEAD worktree); cross-check against FROZEN_IMPACT_FLOORS + integer bounds + live HEAD-derived exposure`,
      "every row's riskScore is integer-bounded, formula-consistent, and impact never claims below its frozen floor",
      problems.length === 0,
      problems.join('\n') || `${attribution.rows.length} rows checked, all formula-consistent`,
    );
  });

  // Compute matrix-derived P0 keys (used by C9S-4/C9S-6) -- from the SAME
  // live exposure + declared (already-validated) impact, never a static
  // table (BLOCKER 4 FIX).
  const p0RouteKeysFromMatrix = new Set<string>();
  if (!('error' in attribution)) {
    for (const row of attribution.rows) {
      const key = typeof row.route === 'string' ? row.route : '';
      const liveExposure = headExposureByKey.get(key);
      const declaredImpact = typeof row.riskScore?.impact === 'number' ? row.riskScore.impact : undefined;
      if (liveExposure !== undefined && declaredImpact !== undefined && tierFor(liveExposure + declaredImpact) === 'P0') {
        p0RouteKeysFromMatrix.add(key);
      }
    }
  }

  let decisionsAtBase = '';
  let decisionsError = '';
  try {
    decisionsAtBase = readFileAtCommit(baseCommit, 'docs/plans/waves/DECISIONS.md');
  } catch (err) {
    decisionsError = String((err as Error)?.stack ?? err);
  }
  const acceptedRiskBlocks = decisionsAtBase ? parseAcceptedRiskBlocks(decisionsAtBase).blocks : new Map<string, AcceptedRiskBlock[]>();
  const testFiles = headWorktreeDir ? discoverAgentSpawnTestFiles(headWorktreeDir) : [];
  const suiteResult = testFiles.length > 0 && headWorktreeDir ? runAgentSpawnSuite(headWorktreeDir, testFiles) : { suite: { status: 1 }, data: null };
  const passedAssertionsByFile = new Map<string, AssertionResult[]>();
  if (suiteResult.data) {
    for (const fileResult of suiteResult.data.testResults) {
      passedAssertionsByFile.set(fileResult.name, fileResult.assertionResults.filter((a) => a.status === 'passed'));
    }
  }
  const allPassedFullNames = new Set<string>();
  for (const list of passedAssertionsByFile.values()) for (const a of list) allPassedFullNames.add(a.fullName);
  const testDeclarationsByFile = new Map<string, TestDeclaration[]>();
  if (headWorktreeDir) {
    for (const rel of testFiles) {
      try {
        const text = fs.readFileSync(path.join(headWorktreeDir, 'apps/daemon', rel), 'utf8');
        testDeclarationsByFile.set(rel, extractTestDeclarations(text, rel));
      } catch {
        /* leave unset */
      }
    }
  }
  const allTestDeclarations = [...testDeclarationsByFile.values()].flat();
  const globalCitationOwner = new Map<string, string>(); // fullName -> routeKey
  const associatedRoutesByRef = new Map<string, Set<string>>();

  await checkCriterion('C9S-3', () => {
    if ('error' in attribution) {
      record('C9S-3', `read ${ATTRIBUTION_PATH_REL} (HEAD worktree)`, 'exactly 17 rows, six required fields non-placeholder, every exposure>=2 row attributed via exactly one of control/acceptedRisk', false, '', { detail: attribution.error });
      return;
    }
    const rows = attribution.rows;
    const routeKeys = rows.map((r) => (typeof r.route === 'string' ? r.route : null)).filter((k): k is string => k !== null);
    const dupes = routeKeys.filter((k, i) => routeKeys.indexOf(k) !== i);
    const missing = [...FROZEN_ROUTE_KEYS].filter((k) => !routeKeys.includes(k));
    const extra = routeKeys.filter((k) => !FROZEN_ROUTE_KEYS.has(k));
    const structuralProblems: string[] = [];
    if (rows.length !== FROZEN_ROUTE_KEYS.size) structuralProblems.push(`expected exactly ${FROZEN_ROUTE_KEYS.size} rows, found ${rows.length}`);
    if (dupes.length > 0) structuralProblems.push(`duplicate route keys: ${dupes.join(', ')}`);
    if (missing.length > 0) structuralProblems.push(`missing routes: ${missing.join(', ')}`);
    if (extra.length > 0) structuralProblems.push(`unexpected routes: ${extra.join(', ')}`);

    let attributed = 0;
    let unattributed = 0;
    let knownVulnerable = 0;
    const rowDetails: string[] = [];

    function resolveTestRef(ref: string, routeKey: string, requirePair: boolean): boolean {
      if (!allPassedFullNames.has(ref)) {
        rowDetails.push(`${routeKey}: testRef "${ref}" is not a currently-passing test in the discovered suite`);
        return false;
      }
      const terms = routeAssociationTerms(routeKey);
      const hasTermMatch = terms.some((t) => ref.toLowerCase().includes(t));
      const existingOwner = globalCitationOwner.get(ref);
      if (existingOwner && existingOwner !== routeKey) {
        rowDetails.push(`${routeKey}: testRef "${ref}" already cited by ${existingOwner} -- global citation uniqueness violated`);
        return false;
      }
      if (!hasTermMatch) {
        rowDetails.push(`${routeKey}: testRef "${ref}" does not contain a path-derived association term (${terms.join('/')})`);
        return false;
      }
      const owningFile = [...passedAssertionsByFile.entries()].find(([, list]) => list.some((a) => a.fullName === ref))?.[0];
      if (requirePair) {
        if (!owningFile || !hasDistinctSignalPair(passedAssertionsByFile.get(owningFile) ?? [])) {
          rowDetails.push(`${routeKey}: cited file (control) does not contain a distinct paired positive+negative passing assertion`);
          return false;
        }
      }
      globalCitationOwner.set(ref, routeKey);
      const set = associatedRoutesByRef.get(ref) ?? new Set<string>();
      set.add(routeKey);
      associatedRoutesByRef.set(ref, set);
      return true;
    }

    for (const row of rows) {
      const key = typeof row.route === 'string' ? row.route : '<missing>';
      const REQUIRED_FIELDS: (keyof AttributionRow)[] = ['owner', 'authn', 'authz', 'inputValidation', 'sizeRateLimit', 'testRef'];
      const placeholderFields = REQUIRED_FIELDS.filter((f) => isPlaceholderText(row[f]));
      if (placeholderFields.length > 0) structuralProblems.push(`${key}: placeholder/missing fields: ${placeholderFields.join(', ')}`);
      const liveExposure = headExposureByKey.get(key);
      const authnText = typeof row.authn === 'string' ? row.authn : '';
      if (liveExposure !== undefined) {
        const keywordRe = EXPOSURE_KEYWORDS[liveExposure];
        if (keywordRe && !keywordRe.test(authnText)) structuralProblems.push(`${key}: authn field does not name its live-derived exposure class (${liveExposure})`);
      }
      // Primary testRef, when present, must ALSO resolve fully (BLOCKER 4 FIX).
      if (typeof row.testRef === 'string' && row.testRef.trim() && !isPlaceholderText(row.testRef)) {
        resolveTestRef(row.testRef.trim(), key, false);
      }
      if (liveExposure === undefined || liveExposure < 2) continue; // attribution required only for exposure>=2 rows

      const control = row.control;
      const acceptedRisk = row.acceptedRisk;
      const hasControl = control != null && typeof control === 'object';
      const hasAcceptedRisk = acceptedRisk != null && typeof acceptedRisk === 'object';
      // BLOCKER 4 FIX: true XOR, not if/else-if.
      if (hasControl && hasAcceptedRisk) {
        rowDetails.push(`${key}: exposure>=2 row carries BOTH control and acceptedRisk -- exactly one is required`);
        unattributed++;
        continue;
      }
      let rowAttributed = false;
      let rowKnownVulnerable = false;
      if (hasControl) {
        const testRef = typeof control!.testRef === 'string' ? control!.testRef : '';
        const mechanism = typeof control!.mechanism === 'string' ? control!.mechanism : '';
        if (!testRef || !mechanism) {
          rowDetails.push(`${key}: control missing testRef/mechanism`);
        } else if (resolveTestRef(testRef, key, true)) {
          rowAttributed = true;
        }
      } else if (hasAcceptedRisk) {
        const decisionRef = typeof acceptedRisk!.decisionRef === 'string' ? acceptedRisk!.decisionRef : '';
        // BLOCKER 4 FIX: exact prefix required, not strip-then-match.
        if (!/^W9AS-ACCEPT-[a-z0-9-]+$/.test(decisionRef)) {
          rowDetails.push(`${key}: acceptedRisk.decisionRef "${decisionRef}" does not carry the exact W9AS-ACCEPT-<slug> prefix`);
        } else {
          const slug = decisionRef.replace(/^W9AS-ACCEPT-/, '');
          const blocks = acceptedRiskBlocks.get(slug) ?? [];
          if (decisionsError) {
            rowDetails.push(`${key}: could not read DECISIONS.md at baseCommit: ${decisionsError}`);
          } else if (blocks.length !== 1) {
            rowDetails.push(`${key}: decisionRef "${decisionRef}" resolves to ${blocks.length} blocks in DECISIONS.md@baseCommit (need exactly 1)`);
          } else {
            const block = blocks[0]!;
            const authorsInRange = commitAuthorsBetween(baseCommit, headSha);
            if (block.route !== key) {
              rowDetails.push(`${key}: accepted-risk block's Route "${block.route}" !== row key "${key}"`);
            } else if (!block.accepter || !block.date || !block.rationale) {
              rowDetails.push(`${key}: accepted-risk block missing Accepter/Date/Rationale`);
            } else if (authorsInRange.has(block.accepter.trim().toLowerCase())) {
              rowDetails.push(`${key}: Accepter "${block.accepter}" matches a commit author between baseCommit and HEAD -- cannot self-accept`);
            } else {
              rowAttributed = true;
              rowKnownVulnerable = true;
            }
          }
        }
      } else {
        rowDetails.push(`${key}: exposure>=2 but neither control nor acceptedRisk present`);
      }
      if (rowAttributed) attributed++;
      else unattributed++;
      if (rowKnownVulnerable) knownVulnerable++;
    }

    const ok = structuralProblems.length === 0 && unattributed === 0;
    record(
      'C9S-3',
      `read ${ATTRIBUTION_PATH_REL} (HEAD worktree); structural check + primary testRef validation + per-exposure>=2-row true-XOR control/acceptedRisk resolution`,
      'exactly 17 rows, six fields non-placeholder, authn names its live exposure class, primary testRef globally unique when present, every exposure>=2 row attributed via exactly one mechanism (unattributed===0)',
      ok,
      `attributed=${attributed} unattributed=${unattributed} known-vulnerable=${knownVulnerable}\n${[...structuralProblems, ...rowDetails].join('\n') || 'no problems'}`,
    );
  });

  // C9S-4: matrix-derived P0-row size/rate-limit resolution, transport-proven.
  await checkCriterion('C9S-4', () => {
    if ('error' in attribution) {
      record('C9S-4', `read ${ATTRIBUTION_PATH_REL} (HEAD worktree)`, "every matrix-derived P0 row's sizeRateLimit resolves via the ENFORCED grammar, bound by both limit and overflow tokens, with body-text status assertions", false, '', { detail: attribution.error });
      return;
    }
    const problems: string[] = [];
    let checked = 0;
    for (const row of attribution.rows) {
      const key = typeof row.route === 'string' ? row.route : '<missing>';
      if (!p0RouteKeysFromMatrix.has(key)) continue;
      checked++;
      const mechanism = typeof row.sizeRateLimit === 'string' ? row.sizeRateLimit : '';
      const parsed = parseEnforcedDeclaration(mechanism);
      if (!parsed) {
        problems.push(`${key}: sizeRateLimit "${mechanism}" does not match the ENFORCED grammar`);
        continue;
      }
      const testRef = typeof row.control?.testRef === 'string' ? row.control.testRef : null;
      if (!testRef || !allPassedFullNames.has(testRef)) {
        problems.push(`${key}: control.testRef missing or not currently passing`);
        continue;
      }
      const owningFile = [...passedAssertionsByFile.entries()].find(([, list]) => list.some((a) => a.fullName === testRef))?.[0];
      const siblingAssertions = owningFile ? passedAssertionsByFile.get(owningFile) ?? [] : [];
      const terms = routeAssociationTerms(key);
      const overflowStatus = parsed.overflow === 'reject-429' ? 429 : 413;
      const underMatches = siblingAssertions.filter((a) => matchesUnderLimitAssertion(a.fullName, terms, parsed.limit));
      const overMatches = siblingAssertions.filter((a) => matchesOverLimitAssertion(a.fullName, terms, parsed.limit, overflowStatus));
      if (underMatches.length === 0 || overMatches.length === 0) {
        problems.push(`${key}: same-file suite missing a bound under-limit-accepted (${underMatches.length}) and/or over-limit-rejected (${overMatches.length}) assertion for limit=${parsed.limit} overflow=${overflowStatus}`);
        continue;
      }
      // BLOCKER 5 FIX: body-text status-code assertion, not name-matching alone.
      const overDecl = allTestDeclarations.find((d) => d.title === overMatches[0]!.title);
      if (!overDecl || !bodyAssertsStatusCode(overDecl.bodyText, overflowStatus)) {
        problems.push(`${key}: over-limit assertion "${overMatches[0]!.title}" body does not contain a real status-code assertion for ${overflowStatus}`);
      }
    }
    record(
      'C9S-4',
      "parse each matrix-derived P0 row's sizeRateLimit against the ENFORCED grammar; verify a limit+overflow-bound paired under/over-limit passing assertion AND a body-text status-code assertion in the cited control file",
      'every matrix-derived P0-tier row resolves size/rate-limit via a real, bound, currently-passing, body-verified control',
      problems.length === 0 && checked === p0RouteKeysFromMatrix.size,
      `P0 rows checked (matrix-derived): ${checked}/${p0RouteKeysFromMatrix.size} (${[...p0RouteKeysFromMatrix].join(', ')})\n${problems.join('\n') || 'no problems'}`,
    );
  });

  // C9S-5: dedicated red-team corpus (8 cases), full replay for new tests.
  await checkCriterion('C9S-5', () => {
    if (!headWorktreeDir) {
      record('C9S-5', '', 'the dedicated test file set exists, boots a real daemon, passes, zero skip/only/todo/pending, implements all 8 named corpus cases, new tests independently replayed', false, '', { detail: 'detached HEAD worktree unavailable' });
      return;
    }
    if (testFiles.length === 0) {
      record('C9S-5', 'glob apps/daemon/tests/agent-spawn-*.test.ts (HEAD worktree)', 'the dedicated test file set exists, boots a real daemon, passes, zero skip/only/todo/pending, implements all 8 named corpus cases, new tests independently replayed', false, '', {
        detail: 'no files matching agent-spawn-*.test.ts found',
      });
      return;
    }
    const bannedMarker = /\b(?:it|describe|test)\s*(?:\.\s*(?:skip|only|todo|concurrent\.skip)\s*\(|\[\s*['"](?:skip|only|todo)['"]\s*\]\s*\(|\.\s*skipIf\s*\()/;
    const markerHits: string[] = [];
    for (const rel of testFiles) {
      const text = fs.readFileSync(path.join(headWorktreeDir, 'apps/daemon', rel), 'utf8');
      if (bannedMarker.test(text)) markerHits.push(rel);
    }
    const pendingCount = suiteResult.data?.numPendingTests ?? 0;
    // BLOCKER 5 FIX: corpus-case matching is scoped to extracted test
    // titles/bodies, never combined raw source text including comments.
    const CORPUS_CASE_HINTS: RegExp[] = [
      /unknown.?agent.?id/i,
      /(oversized|too large|413|max.?body)/i,
      /(rate.?limit|429|spawn.?storm|rapid)/i,
      /(cross.?caller|foreign|another caller|other caller)/i,
      /(sandbox|escape|imported.?project|traversal)/i,
      /(denied|unauthorized).*(spawn|before.*start)/i,
      /(concurren|child.*budget|process count)/i,
      /(capability|scope|binding).*(agent|model|prompt|tool.?bundle)/i,
    ];
    const missingCases = CORPUS_CASE_HINTS.filter(
      (re) => !allTestDeclarations.some((d) => re.test(d.title) || re.test(d.bodyText)),
    );
    const suitePassed = suiteResult.suite.status === 0 && (suiteResult.data?.numFailedTests ?? 1) === 0 && suiteResult.data !== null;

    // Independent-replay requirement for every genuinely-new cited test
    // (BLOCKER 5 FIX: required now, not deferred).
    const replayProblems: string[] = [];
    const replayEvidenceLog: string[] = [];
    for (const [ref] of globalCitationOwner) {
      const owningRel = [...testDeclarationsByFile.entries()].find(([, decls]) => decls.some((d) => d.title === ref))?.[0];
      if (!owningRel) continue;
      let existedAtBase = false;
      try {
        const baseText = readFileAtCommit(baseCommit, `apps/daemon/${owningRel}`);
        existedAtBase = extractStaticTestTitlesFromSource(baseText, `${baseCommit}:${owningRel}`).has(ref);
      } catch {
        existedAtBase = false;
      }
      if (existedAtBase) continue; // pre-existing coverage cited directly -- no replay required
      const redPath = path.join(headWorktreeDir, 'docs/security/agent-spawn-red', `${slugify(ref)}.txt`);
      if (!fs.existsSync(redPath)) {
        replayProblems.push(`new test "${ref}" (${owningRel}) has no red-evidence artifact at docs/security/agent-spawn-red/${slugify(ref)}.txt`);
        continue;
      }
      const parsedTranscript = parseRedTranscript(fs.readFileSync(redPath, 'utf8'));
      if (!parsedTranscript.parentSha || !/^[0-9a-f]{40}$/i.test(parsedTranscript.parentSha)) {
        replayProblems.push(`red evidence for "${ref}": PARENT_SHA missing or not a full 40-hex commit`);
        continue;
      }
      if (!resolveCommit(parsedTranscript.parentSha) || parsedTranscript.parentSha === headSha || !isAncestor(baseCommit, parsedTranscript.parentSha) || !isAncestor(parsedTranscript.parentSha, headSha)) {
        replayProblems.push(`red evidence for "${ref}": PARENT_SHA does not satisfy baseCommit <= PARENT_SHA < HEAD`);
        continue;
      }
      if (!parsedTranscript.test || parsedTranscript.test !== ref) {
        replayProblems.push(`red evidence for "${ref}": TEST field does not exactly match testRef`);
        continue;
      }
      if (!parsedTranscript.controlTest) {
        replayProblems.push(`red evidence for "${ref}": CONTROL_TEST field missing`);
        continue;
      }
      const introduction = findIntroductionCommit(`apps/daemon/${owningRel}`, ref);
      if (!introduction) {
        replayProblems.push(`red evidence for "${ref}": could not independently determine the introduction commit`);
        continue;
      }
      if (introduction.parentOfIntroduction !== parsedTranscript.parentSha) {
        replayProblems.push(`red evidence for "${ref}": PARENT_SHA does not equal the introduction commit's first parent`);
        continue;
      }
      const replay = replayRedEvidence(parsedTranscript.parentSha, owningRel, ref, parsedTranscript.controlTest);
      if (!replay.ok) replayProblems.push(`red-evidence replay failed for "${ref}": ${replay.problems.join('; ')}`);
      replayEvidenceLog.push(`--- replay for "${ref}" ---\n${replay.evidenceLines.join('\n')}\n${replay.ok ? 'REPLAY OK' : `REPLAY FAILED: ${replay.problems.join('; ')}`}`);
    }

    const ok = markerHits.length === 0 && pendingCount === 0 && missingCases.length === 0 && suitePassed && replayProblems.length === 0;
    record(
      'C9S-5',
      `glob apps/daemon/tests/agent-spawn-*.test.ts (${testFiles.length} file(s), HEAD worktree); pnpm --filter @open-design/daemon exec vitest run --reporter=json; independent detached-worktree replay for every genuinely-new cited test`,
      'suite exists, is green, zero skip/only/todo/pending, textually implements all 8 named corpus cases (title/body-scoped), and every new citation independently replays red at its introduction commit\'s parent',
      ok,
      `files: ${testFiles.join(', ')}\nsuite status=${suiteResult.suite.status} numFailedTests=${suiteResult.data?.numFailedTests ?? 'n/a'} numPassedTests=${suiteResult.data?.numPassedTests ?? 'n/a'} numPendingTests=${pendingCount}\nskip/only/todo/pending markers: ${markerHits.join(', ') || 'none'}\nmissing corpus case hints: ${missingCases.length}\n${replayProblems.join('\n')}\n\n${replayEvidenceLog.join('\n\n') || '(no new-test replays triggered this run)'}`,
    );
  });

  // C9S-6: threat-model doc, ported bounded-section machinery.
  await checkCriterion('C9S-6', () => {
    if (!headWorktreeDir) {
      record('C9S-6', '', 'threat-model doc extended with a bounded Wave 9 section; each matrix-derived P0 route has its own bullet', false, '', { detail: 'detached HEAD worktree unavailable' });
      return;
    }
    const expectedRefByKey = new Map<string, string>();
    if (!('error' in attribution)) {
      for (const row of attribution.rows) {
        const key = typeof row.route === 'string' ? row.route : '';
        if (!p0RouteKeysFromMatrix.has(key)) continue;
        const hasControl = row.control != null && typeof row.control.testRef === 'string';
        const expectedRef = hasControl ? (row.control!.testRef as string).trim() : typeof row.testRef === 'string' ? row.testRef.trim() : '';
        expectedRefByKey.set(key, expectedRef);
      }
    }
    const result = checkThreatModelSection(headWorktreeDir, [...p0RouteKeysFromMatrix], expectedRefByKey, associatedRoutesByRef, allPassedFullNames);
    record(
      'C9S-6',
      'read docs/security/daemon-threat-model.md (HEAD worktree); bounded to the next "## " heading; CommonMark-aware fence tracker excludes code; one-P0-key-per-bullet + exact-expected-citation check',
      'every matrix-derived P0 route has its own bullet naming exactly that route and citing exactly its expected reference',
      result.ok,
      result.evidence,
    );
  });

  // C9S-7: out-of-repo, orchestrator-owned implementation review (W7 pattern).
  await checkCriterion('C9S-7', () => {
    const reviewPath = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'reviews', 'implementation-review.json');
    if (!fs.existsSync(reviewPath)) {
      record('C9S-7', `read ${reviewPath}`, 'reviewedCommit is a real strict ancestor of HEAD with an empty owned-path diff to HEAD; reviewer distinct from every baseCommit..reviewedCommit author; verdict APPROVE', false, '', {
        detail: `no record at ${reviewPath} -- this is an orchestrator-owned, out-of-repo location no implementer lease grants write access to (W7 disposition-record trust model)`,
      });
      return;
    }
    let review: { reviewer?: unknown; model?: unknown; reviewedCommit?: unknown; verdict?: unknown; jobId?: unknown };
    try {
      review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
    } catch (err) {
      record('C9S-7', `parse ${reviewPath}`, 'file parses as JSON with the required fields', false, '', { detail: String(err) });
      return;
    }
    const problems: string[] = [];
    const reviewer = typeof review.reviewer === 'string' ? review.reviewer.trim() : '';
    const reviewedCommit = typeof review.reviewedCommit === 'string' ? review.reviewedCommit.trim() : '';
    if (!reviewer) problems.push('reviewer missing/empty');
    if (!review.model) problems.push('model missing/empty');
    if (!reviewedCommit || !resolveCommit(reviewedCommit)) {
      problems.push(`reviewedCommit "${reviewedCommit}" does not resolve to a real commit`);
    } else {
      if (reviewedCommit === headSha || !isAncestor(reviewedCommit, headSha)) {
        problems.push('reviewedCommit is not a strict ancestor of HEAD');
      } else {
        const allowGlobs = (loadLeaseAllowGlobs() ?? []).map(globToRegExp);
        const diffResult = sh('git', ['diff', '--name-only', `${reviewedCommit}..${headSha}`]);
        const changed = diffResult.stdout.trim().split('\n').filter(Boolean);
        const ownedChanged = changed.filter((f) => allowGlobs.some((re) => re.test(f)));
        if (ownedChanged.length > 0) problems.push(`owned-path diff from reviewedCommit to HEAD is non-empty: ${ownedChanged.join(', ')}`);
      }
      const authorsInRange = commitAuthorsBetween(baseCommit, reviewedCommit);
      if (reviewer && authorsInRange.has(reviewer.toLowerCase())) problems.push(`reviewer "${reviewer}" matches a commit author between baseCommit and reviewedCommit -- reviewer must be distinct from author`);
    }
    if (review.verdict !== 'APPROVE') problems.push(`verdict "${String(review.verdict)}" !== "APPROVE"`);
    record(
      'C9S-7',
      `read ${reviewPath} (out-of-repo, orchestrator-owned, W7 disposition-record trust model); reviewedCommit resolvability/ancestry + owned-path diff + author-distinctness checks`,
      'reviewedCommit is a real strict ancestor of HEAD whose owned-path diff to HEAD is empty; reviewer distinct from every baseCommit..reviewedCommit author; verdict is APPROVE',
      problems.length === 0,
      problems.join('\n') || `reviewer=${reviewer} model=${String(review.model)} reviewedCommit=${reviewedCommit} verdict=${String(review.verdict)} jobId=${String(review.jobId ?? '')}`,
    );
  });

  // C9S-8: run-id/session ownership -- founder-blockable, per the ruling.
  await checkCriterion('C9S-8', () => {
    // Variant (b): a founder-signed shared-namespace acceptance.
    const namespaceBlocks = acceptedRiskBlocks.get('shared-local-namespace') ?? [];
    if (namespaceBlocks.length === 1) {
      const block = namespaceBlocks[0]!;
      const authorsInRange = commitAuthorsBetween(baseCommit, headSha);
      if (block.accepter && block.date && block.rationale && !authorsInRange.has(block.accepter.trim().toLowerCase())) {
        record(
          'C9S-8',
          'read DECISIONS.md@baseCommit for ### W9AS-ACCEPT-shared-local-namespace',
          'run-id/session ownership resolves to a real control or a founder-signed accepted-risk record',
          true,
          `variant (b): founder-signed acceptance found -- accepter=${block.accepter}, date=${block.date}, rationale=${block.rationale}`,
        );
        return;
      }
    }
    // Variant (a): a real, tested, route-associated ownership control cited
    // by name in the attribution matrix (informal convention: any row's
    // control.mechanism mentioning "ownership" or "per-caller").
    if (!('error' in attribution)) {
      const ownershipRow = attribution.rows.find((r) => {
        const mech = typeof r.control?.mechanism === 'string' ? r.control.mechanism : '';
        return /ownership|per-caller|caller-scoped/i.test(mech);
      });
      if (ownershipRow) {
        const testRef = typeof ownershipRow.control?.testRef === 'string' ? ownershipRow.control.testRef : '';
        if (testRef && allPassedFullNames.has(testRef)) {
          record(
            'C9S-8',
            'scan attribution matrix rows for a control.mechanism naming real ownership/per-caller scoping, cross-checked against a currently-passing testRef',
            'run-id/session ownership resolves to a real control or a founder-signed accepted-risk record',
            true,
            `variant (a): real ownership control found on route ${String(ownershipRow.route)}, testRef "${testRef}" currently passing`,
          );
          return;
        }
      }
    }
    recordBlockedOnFounder(
      'C9S-8',
      'read DECISIONS.md@baseCommit for ### W9AS-ACCEPT-shared-local-namespace; scan attribution matrix for a real ownership control',
      'run-id/session ownership resolves to a real control or a founder-signed accepted-risk record, or is explicitly parked pending a founder decision',
      'Neither variant (a) a real, tested ownership/capability-scoping control, nor variant (b) a founder-signed ### W9AS-ACCEPT-shared-local-namespace DECISIONS.md record exists yet. This is the legal blocked-on-founder terminal state (VERIFICATION-CONTRACT.md §2 rule 3) -- it does not block the autonomous implementation loop, only landing.',
    );
  });

  // =======================================================================
  // GATE-INTEGRITY / LEASE / HEAD-DRIFT
  // =======================================================================
  await checkCriterion('GATE-INTEGRITY', () => {
    const selfPath = process.argv[1] ? path.resolve(process.argv[1]) : path.join(repoRoot, 'scripts/waves/verify-w9-agent-spawn.ts');
    let selfSha256: string;
    try {
      selfSha256 = sha256File(selfPath);
    } catch (err) {
      record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check; the PRIMARY control is baseCommit-derived route/lease/decision truth, not this pin', false, '', {
        detail: `could not hash self at ${selfPath}: ${String(err)}`,
      });
      return;
    }
    const approvedHashPath = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256');
    if (!gateIntegrityPinned) {
      record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', true, `sha256: ${selfSha256}\nUNPINNED -- no approved-gate.sha256 present. Not tamper-protected by this check until an orchestrator pins one post-approval; see manifest.gateIntegrityPinned=false.`);
      return;
    }
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === selfSha256;
    record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', gateOk, `sha256: ${selfSha256}\napproved: ${approved}\nPINNED`, {
      detail: gateOk ? undefined : 'verify-w9-agent-spawn.ts modified since orchestrator approval',
    });
  });

  await checkCriterion('LEASE', () => {
    let leasesRaw: { waves: Record<string, { allow: string[]; deny?: string[] }> };
    try {
      const leasesText = readFileAtCommit(baseCommit, 'docs/plans/waves/leases.json');
      leasesRaw = JSON.parse(leasesText) as typeof leasesRaw;
    } catch (err) {
      record('LEASE', `git show ${baseCommit}:docs/plans/waves/leases.json`, `no writes outside the ${LEASE_KEY} lease, read from baseCommit`, false, '', {
        detail: `could not read/parse leases.json at baseCommit: ${String(err)}`,
      });
      return;
    }
    const lease = leasesRaw.waves[LEASE_KEY];
    if (!lease) {
      record('LEASE', '', '', false, '', {
        detail: `no "${LEASE_KEY}" entry in leases.json@baseCommit -- expected to self-resolve once this PRD lands on main and an implementation branch's baseCommit includes the applied lease row`,
      });
      return;
    }
    const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
    const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
    if (diffResult.status !== 0) {
      record('LEASE', '', '', false, diffResult.stdout, { detail: `git diff exited ${diffResult.status}` });
      return;
    }
    const allowRe = lease.allow.map(globToRegExp);
    const denyRe = (lease.deny ?? []).map(globToRegExp);
    const violations = diffNames.filter((f) => !allowRe.some((re) => re.test(f)) || denyRe.some((re) => re.test(f)));
    record(
      'LEASE',
      `git diff --name-only ${baseCommit}...HEAD subset-of leases.json[${LEASE_KEY}] read via git show ${baseCommit}:docs/plans/waves/leases.json`,
      `no writes outside the ${LEASE_KEY} lease, read from baseCommit`,
      violations.length === 0,
      violations.join('\n') || (diffNames.length === 0 ? 'no diff between baseCommit and HEAD' : `all ${diffNames.length} changed files inside the lease`),
    );
  });

  const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  await checkCriterion('HEAD-DRIFT', () => {
    record('HEAD-DRIFT', 'git rev-parse HEAD (re-resolved at end)', 'HEAD must not move during the run (secondary check -- the detached HEAD worktree is the primary defense against HEAD-state mutation)', headShaFinal === headSha, `initial=${headSha} final=${headShaFinal}`, {
      detail: headShaFinal === headSha ? undefined : 'HEAD moved during the run',
    });
  });

  removeDetachedHeadWorktree(headWorktreeDir);

  for (const r of results) {
    if (!r.artifact || !r.artifactSha256) continue;
    try {
      const currentHash = sha256File(r.artifact);
      if (currentHash !== r.artifactSha256) {
        r.status = 'fail';
        r.detail = `${r.detail ? `${r.detail}; ` : ''}TAMPER DETECTED`;
      }
    } catch {
      r.status = 'fail';
      r.detail = `${r.detail ? `${r.detail}; ` : ''}artifact disappeared before final integrity re-check`;
    }
  }

  const treeDirtyResult = sh('git', ['status', '--porcelain=v1']);
  const treeDirty = treeDirtyResult.status !== 0 || treeDirtyResult.stdout.trim().length > 0;
  const preArchiveManifest = buildManifest(true, treeDirty, false);
  const archiveResult = archiveRunArtifacts(preArchiveManifest);
  const finalManifest: ManifestShape = { ...preArchiveManifest, archiveOk: archiveResult.ok };
  const { written: manifestWritten, sha256: manifestSha256 } = writeManifestFile(finalManifest);

  // Only a genuine "fail" blocks the run; "blocked-on-founder" is a legal
  // terminal state that does not block the autonomous loop (VERIFICATION-
  // CONTRACT.md §2 rule 3) -- only landing, which is an orchestrator/human
  // decision outside this script's exit code.
  const failures = results.filter((r) => r.status === 'fail');
  const blockedOnFounder = results.filter((r) => r.status === 'blocked-on-founder');
  console.log(`\nverify-w9-agent-spawn: ${results.length - failures.length - blockedOnFounder.length}/${results.length} criteria pass, ${blockedOnFounder.length} blocked-on-founder (treeDirty=${treeDirty}, wroteOk=true, gateIntegrityPinned=${gateIntegrityPinned}, archiveOk=${archiveResult.ok})`);
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md §2)');
  if (!archiveResult.ok) console.log('  ⚠ per-run archival FAILED (construct-then-reread-verify) -- this fails the run');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  console.log(`RUN_ARCHIVE=${archiveResult.runDir}`);
  process.exit(failures.length === 0 && !treeDirty && manifestWritten && archiveResult.ok ? 0 : 1);
}

main().catch((err) => {
  removeDetachedHeadWorktree(headWorktreeDir);
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
