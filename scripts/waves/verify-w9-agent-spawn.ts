// verify-w9-agent-spawn.ts -- wave mishmash-w9-agent-spawn-tranche (agent-spawn
// route hardening, first/highest-risk of the rolling W9 tranches) completion
// verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w9-agent-spawn.ts [--repo <path>]
// Exit 0 only when every mechanical criterion passes, LEASE/HEAD-DRIFT pass,
// the tree is clean, and archival succeeds.
//
// ROUND 3 (founder-authorized FINAL round, 2026-07-28) -- closes the 9 named
// residuals from the round-2 adversarial verdict. See
// W9-agent-spawn-tranche.md's "AUTHOR-FLAGGED / DISPOSITIONS" for the full
// disposition list. Structural changes vs round 2:
//
//   1. COVERAGE: routes/daemon.ts (oauth-launch) added as a 5th owned file;
//      routes/media.ts's path filter widened to also cover both
//      media/generate routes (codexBin spawn). 20 routes, 5 files.
//   2. CLASSIFIER: isGenuinelyBoundFromCtx replaces isShadowedBeforeUse --
//      exposure 0/2 now require POSITIVE proof of a direct ctx.auth/ctx.http
//      destructure binding (not merely absence of a shadow), with broader
//      shadow detection (later assignments, later function declarations, not
//      only later const/let/var redeclarations). findFunctionBody now
//      requires exactly one TOP-LEVEL (never nested) match -- a decoy
//      registrar nested inside another function is invisible, and duplicate
//      top-level declarations hard-fail. The route collector recognizes
//      app['post'](...)-shaped element-access registrations, not only
//      app.post(...).
//   3. DETACHED WORKTREE: every trusted read from the detached HEAD worktree
//      is now gated by a blob-hash check (git hash-object vs. git rev-parse
//      headSha:path) immediately before that read is trusted; the daemon
//      boot and test-suite run are additionally bracketed by a post-step
//      re-verification of the same blobs. The replay's HEAD-test overlay now
//      writes git blob content directly (git show), never a worktree file
//      copy.
//   4. C9S-4/5: bodyAssertsStatusCode is a real AST check (expect(x.status)
//      .toBe(code)-shaped), not a text window; both under- and over-limit
//      bodies are checked; corpus coverage requires >1 distinct satisfying
//      test declaration; the skip-marker scanner is AST-based.
//   5. C9S-6: exact backtick-token route-identity equality replaces
//      substring `includes()`.
//   6. C9S-7: reviewedCommit must match /^[0-9a-f]{40}$/i before any git
//      resolution; jobId is now required and non-placeholder;
//      reviewedCommit === headSha is now accepted (the strict-ancestor rule
//      was vestigial once the record moved out-of-repo in round 2).
//   7. C9S-8: REDESIGNED per founder ruling 2026-07-28 (MishMash accepts the
//      single-user shared-local namespace for run-id/session access as
//      ground truth). Checks ONLY the founder-signed accepted-risk record;
//      the "real control" alternative is removed (would contradict the
//      ruling). The blocked-on-founder status and its recording machinery
//      are deleted entirely -- this was their only consumer.
//   8. PROTECTED PORTS: the boot script now reports its actual bound
//      address; validateIsolatedDaemonAddress refuses 7456/51012 and
//      non-loopback hosts before anything else is trusted, followed by an
//      active redirect:'manual' reachability probe against the validated
//      address only.
//   9. server.ts's "exactly two call-site lines" bound is now mechanical:
//      LEASE runs `git diff --numstat` on server.ts specifically and hard-
//      fails past 2 added / 0 removed lines.
//
// ISOLATION (hard rule, unchanged): every daemon boot uses port 0 (OS-
// assigned) and a fresh mkdtemp OD_DATA_DIR, torn down by its own exact child
// PID. This verifier never touches ports 7456/51012 and never issues a `git
// fetch`/`git push`. The detached-worktree machinery is git-local (`git
// worktree add --detach`) and offline (`pnpm install --offline
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
// Detached HEAD worktree (round 2) + blob-hash verification (round 3,
// residual 3). Every HEAD-dependent read is sourced from ONE detached
// temporary git worktree pinned to headSha, AND gated by a blob-hash check
// immediately before that read is trusted -- neither alone was sufficient
// (a checkout being separate from the primary worktree does not stop
// pnpm install / daemon init / the test suite from mutating ITS OWN files).
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
/** BLOCKER (round 3, residual 3): verifies the worktree's on-disk content
 * for `relPath` still matches the KNOWN git blob for that path at headSha --
 * immune to whatever the worktree's own working copy has been through since
 * checkout (pnpm install, daemon init, a test run). Absence on both sides is
 * consistent (nothing to verify yet, pre-implementation); a mismatch or a
 * one-sided absence is a hard fail. */
function blobHashMatchesHead(worktreeDir: string, relPath: string): { ok: boolean; detail: string } {
  const worktreeFileAbs = path.join(worktreeDir, relPath);
  const existsOnDisk = fs.existsSync(worktreeFileAbs);
  const blobResult = sh('git', ['rev-parse', `${headSha}:${relPath}`]);
  const existsAtHead = blobResult.status === 0;
  if (!existsOnDisk && !existsAtHead) return { ok: true, detail: `${relPath}: absent both on-disk and at headSha (consistent)` };
  if (existsOnDisk !== existsAtHead) return { ok: false, detail: `${relPath}: existence mismatch (on-disk=${existsOnDisk} at-headSha=${existsAtHead})` };
  const onDisk = sh('git', ['hash-object', worktreeFileAbs]);
  if (onDisk.status !== 0) return { ok: false, detail: `${relPath}: git hash-object failed` };
  const onDiskHash = onDisk.stdout.trim();
  const blobHash = blobResult.stdout.trim();
  return onDiskHash === blobHash
    ? { ok: true, detail: `${relPath}: blob hash matches (${blobHash})` }
    : { ok: false, detail: `${relPath}: blob hash MISMATCH on-disk=${onDiskHash} expected=${blobHash} -- worktree mutated after checkout` };
}
/** Read wrapper: blob-verifies THEN reads. Every "trust this HEAD content"
 * call site in this file goes through this, never a bare fs.readFileSync
 * against headWorktreeDir. */
function readVerifiedFromHeadWorktree(relPath: string): { content: string | null; error: string | null } {
  const check = blobHashMatchesHead(headWorktreeDir, relPath);
  if (!check.ok) return { content: null, error: check.detail };
  const abs = path.join(headWorktreeDir, relPath);
  if (!fs.existsSync(abs)) return { content: null, error: `${relPath}: does not exist` };
  try {
    return { content: fs.readFileSync(abs, 'utf8'), error: null };
  } catch (err) {
    return { content: null, error: `${relPath}: read failed: ${String(err)}` };
  }
}
function reverifyBlobs(worktreeDir: string, relPaths: readonly string[]): string[] {
  return relPaths.map((p) => blobHashMatchesHead(worktreeDir, p)).filter((r) => !r.ok).map((r) => r.detail);
}

// =========================================================================
// Route collector -- AST-scoped to a named registrar function's own body.
// BLOCKER (round 3, residual 2c): findFunctionBody now only matches function
// declarations that are DIRECT TOP-LEVEL statements of the source file
// (never nested), and requires exactly one such match -- a decoy registrar
// nested inside another function is invisible, and duplicate top-level
// declarations hard-fail rather than silently picking the first.
// BLOCKER (residual 2d): the collector also recognizes app['post'](...)-
// shaped element-access registrations, not only app.post(...).
// BLOCKER (residual 2a from round 1): separately counts every recognized
// app-call (any first argument) vs. the subset with a STATIC string/no-
// substitution-template first argument -- fully-frozen files hard-fail on
// any difference; path-filtered files report it as informational.
// =========================================================================
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options']);

interface RouteRegistration {
  method: string;
  routePath: string;
  middlewareArgs: TsNode[];
  finalHandler: TsNode | null;
}
interface CollectResult {
  registrations: RouteRegistration[];
  duplicates: string[];
  totalCallCount: number;
  staticCallCount: number;
}
interface FunctionBodyLookup {
  body: TsNode | null;
  count: number;
}
function findFunctionBody(sourceFile: TypeScriptModule.SourceFile, fnName: string): FunctionBodyLookup {
  const matches: TsNode[] = [];
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === fnName && stmt.body) {
      matches.push(stmt.body);
    }
  }
  return { body: matches[0] ?? null, count: matches.length };
}

function collectScopedRouteRegistrations(
  sourceText: string,
  label: string,
  fnName: string,
  pathFilter: readonly string[] | null,
): CollectResult {
  const sourceFile = ts.createSourceFile(label, sourceText, ts.ScriptTarget.Latest, true);
  const lookup = findFunctionBody(sourceFile, fnName);
  if (lookup.count !== 1 || !lookup.body) {
    throw new Error(`${fnName}: expected exactly 1 top-level function declaration in ${label}, found ${lookup.count} (decoy-registrar guard)`);
  }
  const fnBody = lookup.body;
  const registrations: RouteRegistration[] = [];
  const counts = new Map<string, number>();
  let totalCallCount = 0;
  let staticCallCount = 0;
  const visit = (node: TsNode) => {
    let methodNameRaw: string | null = null;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'app' &&
      ts.isIdentifier(node.expression.name)
    ) {
      methodNameRaw = node.expression.name.text;
    } else if (
      ts.isCallExpression(node) &&
      ts.isElementAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'app' &&
      node.expression.argumentExpression &&
      (ts.isStringLiteral(node.expression.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(node.expression.argumentExpression))
    ) {
      methodNameRaw = (node.expression.argumentExpression as TypeScriptModule.StringLiteralLike).text;
    }
    if (methodNameRaw && HTTP_METHODS.has(methodNameRaw.toLowerCase()) && ts.isCallExpression(node)) {
      totalCallCount += 1;
      const method = methodNameRaw.toUpperCase();
      const args = [...node.arguments];
      const pathArg = args[0];
      const isStaticPath = Boolean(pathArg) && (ts.isStringLiteral(pathArg!) || ts.isNoSubstitutionTemplateLiteral(pathArg!));
      if (args.length >= 2 && isStaticPath) {
        staticCallCount += 1;
        const routePath = (pathArg as TypeScriptModule.StringLiteralLike).text;
        if (!pathFilter || pathFilter.includes(routePath)) {
          const finalHandler = args[args.length - 1] ?? null;
          const middlewareArgs = args.slice(1, -1);
          registrations.push({ method, routePath, middlewareArgs, finalHandler });
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
// Exposure classifier -- 4-valued (0/1/2/3). BLOCKER (round 3, residual 2a/
// 2b): isGenuinelyBoundFromCtx replaces round 2's isShadowedBeforeUse.
// Exposure 0/2 now require POSITIVE proof of a direct, single-step
// destructure of the guard identifier from the EXPECTED ctx sub-object
// (ctx.auth for authorizeToolRequest; ctx.http for
// requireLocalDaemonRequest/isLocalSameOrigin) before the guard's use, with
// no later plain-identifier redeclaration, later assignment, or later
// function declaration of the same name intervening -- an unbound bare
// identifier (round 2's "real" probe accepted one with nothing shadowing it)
// no longer classifies as 0/2.
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
function isCtxSubObjectAccess(expr: TsNode, expectedSubObject: string): boolean {
  return (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === 'ctx' &&
    ts.isIdentifier(expr.name) &&
    expr.name.text === expectedSubObject
  );
}
/** Positive-proof + broadened-shadow check (residual 2a/2b). Scans the
 * registrar function's own TOP-LEVEL statements, in order, for: (a) a real
 * destructure binding of `name` from `ctx.<expectedSubObject>` -- sets
 * `bound=true`; (b) ANY later plain-identifier redeclaration
 * (const/let/var), later assignment expression (`name = ...`), or later
 * top-level function declaration named `name` -- each un-sets `bound` again
 * (a fresh genuine ctx-destructure re-affirms it). Only statements strictly
 * before `beforeNode` are considered. Returns true only if a genuine binding
 * exists and nothing after it (but still before use) shadows it. */
function isGenuinelyBoundFromCtx(fnBody: TsNode, name: string, expectedSubObject: string, beforeNode: TsNode): boolean {
  if (!ts.isBlock(fnBody)) return false;
  let bound = false;
  for (const stmt of fnBody.statements) {
    if (stmt.getStart() >= beforeNode.getStart()) break;
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === name) {
      bound = false;
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) {
          bound = false; // plain rebind, never a genuine ctx-destructure of this shape
        }
        if (ts.isObjectBindingPattern(decl.name)) {
          for (const el of decl.name.elements) {
            if (!ts.isBindingElement(el)) continue;
            const bindingName = el.name;
            if (!ts.isIdentifier(bindingName) || bindingName.text !== name) continue;
            if (decl.initializer && isCtxSubObjectAccess(decl.initializer, expectedSubObject)) {
              bound = true;
            } else {
              bound = false;
            }
          }
        }
      }
      continue;
    }
    if (ts.isExpressionStatement(stmt) && ts.isBinaryExpression(stmt.expression) && stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isIdentifier(stmt.expression.left) && stmt.expression.left.text === name) {
        bound = false; // a later assignment to the same name shadows the genuine binding
      }
    }
  }
  return bound;
}

/** Exposure 0: direct top-level `const grant = authorizeToolRequest(...)`
 * immediately followed by an unconditional-exit `if (!grant)`, bare
 * identifier, genuinely ctx.auth-bound. Position-anchored: must be
 * statements[0]/[1] of the handler's own body. */
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
  if (!isGenuinelyBoundFromCtx(fnBody, 'authorizeToolRequest', 'auth', handler)) return false;
  if (!ts.isIfStatement(second)) return false;
  if (!isNegationOfIdentifier(second.expression, 'grant')) return false;
  if (!second.thenStatement) return false;
  return consequentUnconditionallyExits(second.thenStatement);
}
/** Exposure 2(a): `requireLocalDaemonRequest` as a literal, genuinely
 * ctx.http-bound bare-identifier middleware argument. */
function hasRequireLocalDaemonRequestMiddleware(reg: RouteRegistration, fnBody: TsNode): boolean {
  return reg.middlewareArgs.some((arg) => {
    if (!ts.isIdentifier(arg) || arg.text !== 'requireLocalDaemonRequest') return false;
    return isGenuinelyBoundFromCtx(fnBody, 'requireLocalDaemonRequest', 'http', arg);
  });
}
/** Exposure 2(b): the handler's first direct top-level statement is
 * `if (!isLocalSameOrigin(req, ...)) { <unconditional exit> }`, genuinely
 * ctx.http-bound. */
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
  if (!isGenuinelyBoundFromCtx(fnBody, 'isLocalSameOrigin', 'http', handler)) return false;
  if (!first.thenStatement) return false;
  return consequentUnconditionallyExits(first.thenStatement);
}

function classifyExposure(reg: RouteRegistration, fnBody: TsNode): number {
  if (hasDirectAuthorizeToolRequestGuard(reg, fnBody)) return 0;
  if (hasRequireLocalDaemonRequestMiddleware(reg, fnBody) || hasDirectIsLocalSameOriginGuard(reg, fnBody)) return 2;
  return 3;
}

// -------------------------------------------------------------------------
// Frozen route set + impact floors -- S9S-1/S9S-2, 20 routes across 5 files
// (round 3, residual 1: routes/daemon.ts added; routes/media.ts's filter
// widened to cover both media/generate routes).
// -------------------------------------------------------------------------
interface OwnedFile {
  relPath: string;
  fnName: string;
  pathFilter: readonly string[] | null; // null = whole function frozen
  fullFreeze: boolean;
  livePathPrefixes: readonly string[];
  liveSiblingExclusions: readonly string[];
}
const OWNED_FILES: OwnedFile[] = [
  {
    relPath: 'apps/daemon/src/routes/runs.ts',
    fnName: 'registerRunRoutes',
    pathFilter: null,
    fullFreeze: true,
    livePathPrefixes: ['/api/runs', '/api/chat'],
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
    pathFilter: ['/api/orbit/run', '/api/projects/:id/media/generate', '/api/tools/media/generate'],
    fullFreeze: false,
    livePathPrefixes: ['/api/orbit/run', '/api/projects/:id/media/generate', '/api/tools/media/generate'],
    liveSiblingExclusions: [],
  },
  {
    relPath: 'apps/daemon/src/routes/daemon.ts',
    fnName: 'registerDaemonRoutes',
    pathFilter: ['/api/agents/:agentId/oauth-launch'],
    fullFreeze: false,
    livePathPrefixes: ['/api/agents/:agentId/oauth-launch'],
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
  { key: 'GET /api/runs/:id', impactFloor: 1, impactRationale: 'statusBody returns process/error/workspace/tool detail, not bare ids' },
  { key: 'GET /api/runs/:id/events', impactFloor: 1, impactRationale: 'streams live stdout/stderr/tool-result content; no ownership check' },
  { key: 'GET /api/runs/:id/agui', impactFloor: 1, impactRationale: 'same content, AGUI envelope; no ownership check' },
  { key: 'GET /api/runs/:id/result-package', impactFloor: 1, impactRationale: 'workspace file listing + artifact manifests; no ownership check' },
  { key: 'POST /api/runs/:id/cancel', impactFloor: 2, impactRationale: "terminates another caller's in-flight child by id; no ownership check" },
  { key: 'POST /api/chat', impactFloor: 3, impactRationale: 'same spawn path as POST /api/runs, via startChatRun' },
  { key: 'POST /api/projects/:id/terminals', impactFloor: 3, impactRationale: 'spawns a new interactive PTY shell rooted at the project cwd' },
  { key: 'GET /api/projects/:id/terminals', impactFloor: 1, impactRationale: 'lists live terminal sessions for a project' },
  { key: 'GET /api/projects/:id/terminals/:tid/stream', impactFloor: 1, impactRationale: 'streams live shell output' },
  { key: 'POST /api/projects/:id/terminals/:tid/stdin', impactFloor: 3, impactRationale: 'injects arbitrary keystrokes into a live shell' },
  { key: 'POST /api/projects/:id/terminals/:tid/resize', impactFloor: 0, impactRationale: 'UI geometry only' },
  { key: 'POST /api/projects/:id/terminals/:tid/kill', impactFloor: 2, impactRationale: "terminates another caller's shell session; no ownership check" },
  { key: 'DELETE /api/projects/:id/terminals/:tid', impactFloor: 2, impactRationale: 'kill alias, same as POST .../kill' },
  { key: 'POST /api/routines/:id/run', impactFloor: 3, impactRationale: 'triggers the shared agent runner on demand' },
  { key: 'POST /api/orbit/run', impactFloor: 3, impactRationale: 'triggers the shared agent runner (Orbit)' },
  { key: 'POST /api/projects/:id/media/generate', impactFloor: 3, impactRationale: 'can reach spawn(codexBin,...); caller controls model (spawn trigger) and cwd' },
  { key: 'POST /api/tools/media/generate', impactFloor: 3, impactRationale: 'same spawn path as media/generate, tool-token-gated entry point' },
  { key: 'POST /api/agents/:agentId/oauth-launch', impactFloor: 3, impactRationale: 'spawns a system terminal window running a hard-coded agy binary' },
];
const FROZEN_ROUTE_KEYS = new Set(FROZEN_IMPACT_FLOORS.map((r) => r.key));
const IMPACT_FLOOR_BY_KEY = new Map(FROZEN_IMPACT_FLOORS.map((r) => [r.key, r.impactFloor]));

function tierFor(score: number): 'P0' | 'P1' | 'P2' {
  if (score >= 5) return 'P0';
  if (score === 4) return 'P1';
  return 'P2';
}

// -------------------------------------------------------------------------
// Self-probes -- 19 fixtures (up from round 2's 14). Each is run through the
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
    const lookup = findFunctionBody(sourceFile, 'registerRunRoutes');
    if (lookup.count !== 1 || !lookup.body) return { name, ok: false, detail: `could not locate exactly 1 registerRunRoutes body (found ${lookup.count})` };
    const actual = classifyExposure(reg, lookup.body);
    return actual === expected
      ? { name, ok: true, detail: `exposure=${actual} (expected ${expected})` }
      : { name, ok: false, detail: `exposure=${actual}, expected ${expected}` };
  } catch (err) {
    return { name, ok: false, detail: `probe crashed: ${String(err)}` };
  }
}
function probeComputedPath(name: string, source: string): SelfProbeOutcome {
  try {
    const collected = collectScopedRouteRegistrations(source, `self-probe:${name}`, 'registerRunRoutes', null);
    return collected.totalCallCount !== collected.staticCallCount
      ? { name, ok: true, detail: `totalCallCount=${collected.totalCallCount} staticCallCount=${collected.staticCallCount} (mismatch correctly detected)` }
      : { name, ok: false, detail: `totalCallCount=${collected.totalCallCount} staticCallCount=${collected.staticCallCount} (computed path NOT detected)` };
  } catch (err) {
    return { name, ok: false, detail: `probe crashed: ${String(err)}` };
  }
}
/** residual 2c: the collector must reject ambiguous/duplicate top-level
 * registrar declarations rather than silently using the first. */
function probeCollectorThrows(name: string, source: string, fnName: string): SelfProbeOutcome {
  try {
    collectScopedRouteRegistrations(source, `self-probe:${name}`, fnName, null);
    return { name, ok: false, detail: 'expected collectScopedRouteRegistrations to throw, but it succeeded' };
  } catch (err) {
    return { name, ok: true, detail: `correctly threw: ${String((err as Error)?.message ?? err)}` };
  }
}
function runExposureSelfProbes(): SelfProbeOutcome[] {
  const wrap = (body: string) => `function registerRunRoutes(app, ctx) {\n${body}\n}`;
  return [
    probeFixture(
      'real-requireLocalDaemonRequest-middleware-ctx-bound',
      `function registerRunRoutes(app, ctx) {\n  const { requireLocalDaemonRequest } = ctx.http;\n  app.post('/api/runs', requireLocalDaemonRequest, async (req, res) => {\n    res.json({ ok: true });\n  });\n}`,
      2,
    ),
    probeFixture(
      'real-authorizeToolRequest-direct-guard-ctx-bound',
      `function registerRunRoutes(app, ctx) {\n  const { authorizeToolRequest } = ctx.auth;\n  app.post('/api/runs', async (req, res) => {\n    const grant = authorizeToolRequest(req);\n    if (!grant) {\n      return res.status(401).json({ error: 'unauthorized' });\n    }\n    res.json({ ok: true });\n  });\n}`,
      0,
    ),
    probeFixture(
      'real-isLocalSameOrigin-inline-guard-ctx-bound',
      `function registerRunRoutes(app, ctx) {\n  const { isLocalSameOrigin } = ctx.http;\n  app.post('/api/orbit/run', async (req, res) => {\n    if (!isLocalSameOrigin(req, ctx.port)) {\n      return res.status(403).json({ error: 'cross-origin request rejected' });\n    }\n    res.json({ ok: true });\n  });\n}`,
      2,
    ),
    probeFixture(
      'guard-inside-dead-if-false-branch',
      `function registerRunRoutes(app, ctx) {\n  const { authorizeToolRequest } = ctx.auth;\n  app.post('/api/runs', async (req, res) => {\n    if (false) {\n      const grant = authorizeToolRequest(req);\n      if (!grant) {\n        return res.status(401).json({ error: 'unauthorized' });\n      }\n    }\n    res.json({ ok: true });\n  });\n}`,
      3,
    ),
    probeFixture(
      'guard-result-never-checked',
      `function registerRunRoutes(app, ctx) {\n  const { authorizeToolRequest } = ctx.auth;\n  app.post('/api/runs', async (req, res) => {\n    const grant = authorizeToolRequest(req);\n    res.json({ ok: true });\n  });\n}`,
      3,
    ),
    probeFixture(
      'guard-after-response-write',
      `function registerRunRoutes(app, ctx) {\n  const { authorizeToolRequest } = ctx.auth;\n  app.post('/api/runs', async (req, res) => {\n    res.json({ ok: true });\n    const grant = authorizeToolRequest(req);\n    if (!grant) {\n      return;\n    }\n  });\n}`,
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
      `function registerRunRoutes(app, ctx) {\n  const { authorizeToolRequest } = ctx.auth;\n  app.post('/api/runs', async (req, res) => {\n    if (req.query.strict) {\n      const grant = authorizeToolRequest(req);\n      if (!grant) {\n        return res.status(401).json({ error: 'unauthorized' });\n      }\n    }\n    res.json({ ok: true });\n  });\n}`,
      3,
    ),
    probeFixture(
      'property-access-alias-not-bare-identifier',
      `function registerRunRoutes(app, ctx) {\n  const { authorizeToolRequest } = ctx.auth;\n  app.post('/api/runs', async (req, res) => {\n    const grant = fake.authorizeToolRequest(req);\n    if (!grant) {\n      return res.status(401).json({ error: 'unauthorized' });\n    }\n    res.json({ ok: true });\n  });\n}`,
      3,
    ),
    probeFixture(
      'locally-shadowed-authorizeToolRequest-fake-const',
      `function registerRunRoutes(app, ctx) {\n  const { authorizeToolRequest: realAuthorizeToolRequest } = ctx.auth;\n  const authorizeToolRequest = () => true;\n  app.post('/api/runs', async (req, res) => {\n    const grant = authorizeToolRequest(req);\n    if (!grant) {\n      return res.status(401).json({ error: 'unauthorized' });\n    }\n    res.json({ ok: true });\n  });\n}`,
      3,
    ),
    probeFixture(
      'locally-shadowed-requireLocalDaemonRequest-fake',
      `function registerRunRoutes(app, ctx) {\n  const requireLocalDaemonRequest = (req, res, next) => next();\n  app.post('/api/runs', requireLocalDaemonRequest, async (req, res) => {\n    res.json({ ok: true });\n  });\n}`,
      3,
    ),
    // residual 2a: an UNBOUND bare identifier -- nothing shadows it, but
    // nothing genuinely binds it from ctx.auth either. Round 2's classifier
    // would have wrongly accepted this as exposure 0.
    probeFixture(
      'unbound-authorizeToolRequest-no-ctx-binding-anywhere',
      wrap(`  app.post('/api/runs', async (req, res) => {\n    const grant = authorizeToolRequest(req);\n    if (!grant) {\n      return res.status(401).json({ error: 'unauthorized' });\n    }\n    res.json({ ok: true });\n  });`),
      3,
    ),
    // residual 2b: a genuine ctx.auth binding, then reassigned before use --
    // the assignment-expression shadow vector round 2's shadow check missed.
    probeFixture(
      'genuine-binding-reassigned-before-use',
      `function registerRunRoutes(app, ctx) {\n  let { authorizeToolRequest } = ctx.auth;\n  authorizeToolRequest = () => true;\n  app.post('/api/runs', async (req, res) => {\n    const grant = authorizeToolRequest(req);\n    if (!grant) {\n      return res.status(401).json({ error: 'unauthorized' });\n    }\n    res.json({ ok: true });\n  });\n}`,
      3,
    ),
    // residual 2d: element-access route registration must be RECOGNIZED (not
    // silently invisible) and classified correctly.
    probeFixture(
      'element-access-route-registration-recognized',
      `function registerRunRoutes(app, ctx) {\n  app['post']('/api/runs', async (req, res) => {\n    res.json({ ok: true });\n  });\n}`,
      3,
    ),
    // residual 2c: a decoy registrar nested inside another function, placed
    // BEFORE the real top-level one in file order, must be ignored -- only
    // the real top-level registrar is used.
    probeFixture(
      'decoy-nested-registrar-ignored-real-one-used',
      `function wrapperDecoyHolder(app, ctx) {\n  function registerRunRoutes(app, ctx) {\n    app.post('/api/runs', requireLocalDaemonRequest, async (req, res) => { res.json({ ok: true }); });\n  }\n}\nfunction registerRunRoutes(app, ctx) {\n  app.post('/api/runs', async (req, res) => {\n    res.json({ ok: true });\n  });\n}`,
      3,
    ),
    // residual 2c: duplicate TOP-LEVEL registrar declarations must hard-fail
    // the collector, not silently pick the first.
    probeCollectorThrows(
      'duplicate-top-level-registrars-rejected',
      `function registerRunRoutes(app, ctx) {\n  app.post('/api/runs', async (req, res) => { res.json({ ok: true }); });\n}\nfunction registerRunRoutes(app, ctx) {\n  app.post('/api/runs', requireLocalDaemonRequest, async (req, res) => { res.json({ ok: true }); });\n}`,
      'registerRunRoutes',
    ),
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
// BLOCKER (round 3, residual 8): the boot script now also reports the
// actual bound {address, port} (from the started server's own .address()),
// validated by validateIsolatedDaemonAddress before anything else about the
// boot is trusted.
// -------------------------------------------------------------------------
// residual 8, boot/probe ordering bug fix: the boot script MUST stay alive
// after printing its ready marker -- the active reachability probe (below)
// has to hit a still-running daemon. It only shuts itself down on SIGTERM,
// and the caller is responsible for sending that SIGTERM (via the returned
// `teardown()`) only AFTER the probe has run. An earlier draft called
// `started.shutdown(); process.exit(0)` immediately after printing the
// marker and then also blocked on SIGTERM/exit inside the same boot
// function before returning -- the daemon was provably dead by the time
// any caller code ran, which surfaced as `fetch failed` on every run.
async function bootDaemonForAgentSpawnRouteInventory(
  worktreeDir: string,
): Promise<{ routes: { method: string; path: string }[]; address: unknown; teardown: () => Promise<void> }> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w9as-verify-'));
  const bootScript = `
import { pathToFileURL } from 'node:url';
process.env.OD_DATA_DIR = ${JSON.stringify(dataDir)};
const mod = await import(pathToFileURL(${JSON.stringify(path.join(worktreeDir, 'apps/daemon/src/server.ts'))}).href);
const started = await mod.startServer({ port: 0, host: '127.0.0.1', returnServer: true });
const addr = started.server && typeof started.server.address === 'function' ? started.server.address() : null;
console.log('OD_W9AS_VERIFIER_READY ' + JSON.stringify({ routeInventory: started.routeInventory, address: addr }));
let shuttingDown = false;
process.on('SIGTERM', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  Promise.resolve(started.shutdown()).finally(() => process.exit(0));
});
await new Promise(() => {});
`;
  const scriptPath = path.join(proofDir, `.boot-daemon.${process.pid}.${crypto.randomBytes(3).toString('hex')}.mjs`);
  fs.writeFileSync(scriptPath, bootScript);
  const child = spawn('pnpm', ['exec', 'tsx', scriptPath], { cwd: worktreeDir, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffered = '';
  const parsed = await new Promise<{ routeInventory: { method: string; path: string }[]; address: unknown } | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 60_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const line = buffered.split('\n').find((l) => l.startsWith('OD_W9AS_VERIFIER_READY '));
      if (line) {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(line.slice('OD_W9AS_VERIFIER_READY '.length)));
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
  let torndown = false;
  const teardown = async (): Promise<void> => {
    if (torndown) return;
    torndown = true;
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
  };
  if (!parsed) {
    await teardown();
    throw new Error(`daemon failed to boot / report routeInventory within 60s (stdout tail: ${buffered.slice(-2000)})`);
  }
  return { routes: parsed.routeInventory, address: parsed.address, teardown };
}

const PROTECTED_PORTS = new Set([7456, 51012]);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);
/** residual 8: fail-closed URL validation on the boot's SELF-REPORTED bind
 * address -- absence of the field, a protected port, or a non-loopback host
 * are all hard fails before anything else about the boot is trusted. */
function validateIsolatedDaemonAddress(addr: unknown): { ok: boolean; problems: string[]; url: string | null } {
  if (!addr || typeof addr !== 'object') {
    return { ok: false, problems: ['boot script reported no server address (started.server.address() unavailable) -- cannot independently verify port isolation, fail-closed'], url: null };
  }
  const a = addr as { address?: unknown; port?: unknown };
  const problems: string[] = [];
  const port = typeof a.port === 'number' ? a.port : NaN;
  const host = typeof a.address === 'string' ? a.address : '';
  if (!Number.isInteger(port) || port <= 0 || port > 65535) problems.push(`reported port "${String(a.port)}" is not a valid port number`);
  if (PROTECTED_PORTS.has(port)) problems.push(`reported port ${port} is a PROTECTED port (7456/51012) -- refusing to trust this boot`);
  if (!LOOPBACK_HOSTS.has(host)) problems.push(`reported host "${host}" is not an allowed loopback address`);
  if (problems.length > 0) return { ok: false, problems, url: null };
  const urlHost = host === '::1' || host === '::ffff:127.0.0.1' ? '[::1]' : host;
  return { ok: true, problems: [], url: `http://${urlHost}:${port}` };
}
/** residual 8: active reachability confirmation with redirect:'manual' --
 * never follows a redirect, and re-validates the resolved target's own
 * host/port against the already-validated base before issuing the request. */
async function activelyConfirmIsolatedDaemonReachable(validatedBaseUrl: string, knownLiveGetPath: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const base = new URL(validatedBaseUrl);
    const target = new URL(knownLiveGetPath, base);
    if (target.hostname !== base.hostname || target.port !== base.port) {
      return { ok: false, detail: `resolved probe URL host/port (${target.host}) diverges from the validated base (${base.host})` };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    let res: Response;
    try {
      res = await fetch(target.toString(), { redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
      return { ok: false, detail: `probe to ${target.toString()} returned a redirect (status=${res.status}, type=${res.type}) -- refusing to follow` };
    }
    return { ok: true, detail: `probe to ${target.toString()} returned status=${res.status} (no redirect)` };
  } catch (err) {
    return { ok: false, detail: `probe request failed: ${String(err)}` };
  }
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
function loadAttributionMatrix(): { rows: AttributionRow[] } | { error: string } {
  const { content, error } = readVerifiedFromHeadWorktree(ATTRIBUTION_PATH_REL);
  if (error || content === null) return { error: error ?? `${ATTRIBUTION_PATH_REL}: unknown read error` };
  try {
    const parsed = JSON.parse(content);
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
function matchesUnderLimitAssertion(fullName: string, routeTerms: readonly string[], limit: number): boolean {
  const hasTerm = routeTerms.some((t) => fullName.toLowerCase().includes(t));
  return hasTerm && POSITIVE_SIGNAL_RE.test(fullName) && containsExactNumericToken(fullName, limit);
}
function matchesOverLimitAssertion(fullName: string, routeTerms: readonly string[], limit: number, overflowStatus: number): boolean {
  const hasTerm = routeTerms.some((t) => fullName.toLowerCase().includes(t));
  return hasTerm && NEGATIVE_SIGNAL_RE.test(fullName) && containsExactNumericToken(fullName, limit) && containsExactNumericToken(fullName, overflowStatus);
}
function hasDistinctSignalPair(candidates: readonly { fullName: string }[]): boolean {
  const positives = candidates.filter((c) => POSITIVE_SIGNAL_RE.test(c.fullName) && !NEGATIVE_SIGNAL_RE.test(c.fullName));
  const negatives = candidates.filter((c) => NEGATIVE_SIGNAL_RE.test(c.fullName) && !POSITIVE_SIGNAL_RE.test(c.fullName));
  if (positives.length === 0 || negatives.length === 0) return false;
  return positives.some((p) => negatives.some((n) => n.fullName !== p.fullName));
}
/** residual 4a: real AST check for expect(<expr>.status).toBe(<code>)-shaped
 * assertions -- comments and string literals containing the code as text no
 * longer satisfy this. Re-parses the test body's own captured source as a
 * standalone fragment (a top-level arrow/function expression statement, or
 * its own statement list, both parse fine on their own). */
function bodyAssertsStatusCodeAst(bodyText: string, code: number): boolean {
  let sourceFile: TypeScriptModule.SourceFile;
  try {
    sourceFile = ts.createSourceFile('assertion-probe.ts', bodyText, ts.ScriptTarget.Latest, true);
  } catch {
    return false;
  }
  let found = false;
  const containsStatusAccess = (node: TsNode): boolean => {
    let hit = false;
    const walk = (n: TsNode) => {
      if (hit) return;
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.name) && n.name.text === 'status') {
        hit = true;
        return;
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return hit;
  };
  const ASSERT_METHODS = new Set(['toBe', 'toEqual', 'toStrictEqual']);
  const visit = (node: TsNode) => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.name) &&
      ASSERT_METHODS.has(node.expression.name.text)
    ) {
      const receiver = node.expression.expression;
      const arg0 = node.arguments[0];
      const codeMatches = arg0 && ts.isNumericLiteral(arg0) && Number(arg0.text) === code;
      if (codeMatches && ts.isCallExpression(receiver) && calleeIsBareIdentifier(receiver.expression, 'expect')) {
        const expectArg = receiver.arguments[0];
        if (expectArg && containsStatusAccess(expectArg)) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

// -------------------------------------------------------------------------
// Test declaration extraction (AST) -- titles AND body source text.
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
/** residual 4d: AST-based skip-marker scan -- a real CallExpression chain
 * rooted at `it`/`test` with a `.skip`/`.only`/`.todo`/`.concurrent.skip`/
 * `.skipIf` property somewhere in the chain. A template literal or string
 * constant containing skip-marker-shaped TEXT no longer trips this. */
function findSkipMarkersAst(sourceText: string, label: string): string[] {
  const hits: string[] = [];
  let sourceFile: TypeScriptModule.SourceFile;
  try {
    sourceFile = ts.createSourceFile(label, sourceText, ts.ScriptTarget.Latest, true);
  } catch {
    return hits;
  }
  const SKIP_PROPS = new Set(['skip', 'only', 'todo', 'skipIf']);
  const visit = (node: TsNode) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const props: string[] = [];
      let cur: TsNode = node.expression;
      while (ts.isPropertyAccessExpression(cur)) {
        props.unshift(cur.name.text);
        cur = cur.expression;
      }
      if (ts.isIdentifier(cur) && (cur.text === 'it' || cur.text === 'test') && props.some((p) => SKIP_PROPS.has(p))) {
        hits.push(`${cur.text}.${props.join('.')}(...)`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hits;
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
// Full detached-worktree Vitest-Node-API replay, ported from
// verify-w9-ingest.ts. BLOCKER (round 3, residual 3): the HEAD test overlay
// now writes the git BLOB content directly (git show), never a
// fs.copyFileSync from the (checkable-but-still-worktree-sourced) detached
// checkout.
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

    // residual 3: write the git BLOB content directly, never a worktree file
    // copy -- the blob is the only content this replay is entitled to trust.
    const targetFileAbs = path.join(tempDir, 'apps/daemon', containingFileRel);
    let blobContent: string;
    try {
      blobContent = readFileAtCommit(headSha, `apps/daemon/${containingFileRel}`);
    } catch (err) {
      problems.push(`could not read HEAD blob for overlay: ${String(err)}`);
      return { ok: false, problems, evidenceLines };
    }
    try {
      fs.mkdirSync(path.dirname(targetFileAbs), { recursive: true });
      fs.writeFileSync(targetFileAbs, blobContent);
    } catch (err) {
      problems.push(`could not write HEAD blob overlay: ${String(err)}`);
      return { ok: false, problems, evidenceLines };
    }
    evidenceLines.push(`overlay: git blob HEAD:apps/daemon/${containingFileRel} -> ${targetFileAbs} (blob content, not a worktree copy)`);

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
// worktree, blob-verified before each file's content is trusted.
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
// DECISIONS.md accepted-risk resolution.
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

// -------------------------------------------------------------------------
// Threat-model doc, bounded-section/fence-aware machinery.
// BLOCKER (round 3, residual 5): route-identity matching is now EXACT
// backtick-token equality, never substring `includes()`.
// -------------------------------------------------------------------------
function checkThreatModelSection(
  worktreeDir: string,
  p0Keys: readonly string[],
  expectedRefByKey: Map<string, string>,
  associatedRoutesByRef: Map<string, Set<string>>,
  passedTestNames: Set<string>,
): { ok: boolean; evidence: string } {
  const blobCheck = blobHashMatchesHead(worktreeDir, 'docs/security/daemon-threat-model.md');
  if (!blobCheck.ok) return { ok: false, evidence: `blob verification failed: ${blobCheck.detail}` };
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
    // residual 5: exact-token route matching. Extract every backtick-quoted
    // "METHOD /path" candidate on the line and compare EACH by exact string
    // equality against every P0 key -- containment/substring never counts.
    const routeTokenCandidates = backtickMatches.filter((t) => /^[A-Z]+\s+\/\S*$/.test(t));
    const p0KeysInLine = p0Keys.filter((k) => routeTokenCandidates.includes(k));
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

  const OWNED_REL_PATHS = OWNED_FILES.map((f) => f.relPath);

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
      const { content, error } = readVerifiedFromHeadWorktree(file.relPath);
      if (error || content === null) {
        headError = error ?? 'unknown read error';
      } else {
        try {
          headCollect = collectScopedRouteRegistrations(content, `HEAD:${file.relPath}`, file.fnName, file.pathFilter);
        } catch (err) {
          headError = String((err as Error)?.stack ?? err);
        }
      }
    } else {
      headError = 'detached HEAD worktree unavailable';
    }
    return { file, baseCommitCollect, baseCommitError, headCollect, headError };
  });

  const headExposureByKey = new Map<string, number>();
  for (const fState of fileStates) {
    if (!fState.headCollect || !headWorktreeDir) continue;
    const { content } = readVerifiedFromHeadWorktree(fState.file.relPath);
    if (content === null) continue;
    try {
      const sourceFile = ts.createSourceFile(`HEAD:${fState.file.relPath}`, content, ts.ScriptTarget.Latest, true);
      const lookup = findFunctionBody(sourceFile, fState.file.fnName);
      if (lookup.count !== 1 || !lookup.body) continue;
      for (const reg of fState.headCollect.registrations) {
        headExposureByKey.set(`${reg.method} ${reg.routePath}`, classifyExposure(reg, lookup.body));
      }
    } catch {
      /* leave unset; downstream checks report missing entries */
    }
  }

  // C9S-1: route snapshot frozen across 5 files, self-probe-gated, protected-
  // port validated, blob-verified before AND after the daemon boot.
  await checkCriterion('C9S-1', async () => {
    if (!headWorktreeDir) return; // already recorded above
    if (selfProbeFailures.length > 0) {
      record(
        'C9S-1',
        'exposure-classifier self-probes (19 fixtures) run through the real collector/classifier pipeline',
        'every self-probe fixture classifies at its expected exposure (or, for computed-path/decoy probes, is correctly flagged)',
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
    if (problems.length > 0) {
      record('C9S-1', 'per-file baseCommit/HEAD AST self-consistency', '20-route frozen snapshot matches all 5 owned files at both baseCommit and HEAD', false, problems.join('\n'));
      return;
    }

    let bootResult: { routes: { method: string; path: string }[]; address: unknown; teardown: () => Promise<void> };
    try {
      bootResult = await bootDaemonForAgentSpawnRouteInventory(headWorktreeDir);
    } catch (err) {
      record('C9S-1', 'isolated daemon boot from the detached HEAD worktree (port 0, mkdtemp OD_DATA_DIR) -> routeInventory', 'a live daemon boots and reports its own route registrations', false, '', {
        detail: `daemon boot failed: ${String((err as Error)?.stack ?? err)}`,
      });
      return;
    }
    try {
      // residual 8: protected-port validation BEFORE trusting anything else.
      const addrCheck = validateIsolatedDaemonAddress(bootResult.address);
      if (!addrCheck.ok) {
        record('C9S-1', 'validateIsolatedDaemonAddress(reportedAddress)', 'the boot reports a real, loopback, non-protected bind address before routeInventory is trusted', false, '', {
          detail: `protected-port validation failed: ${addrCheck.problems.join('; ')}`,
        });
        return;
      }
      // The daemon is kept alive by bootDaemonForAgentSpawnRouteInventory
      // specifically so this active probe can hit a genuinely live server --
      // teardown() below is deferred to the `finally` block.
      const reachability = await activelyConfirmIsolatedDaemonReachable(addrCheck.url!, '/api/runs');
      if (!reachability.ok) {
        record('C9S-1', `active reachability probe (redirect:'manual') against ${addrCheck.url}`, 'the validated address is genuinely reachable and does not silently redirect', false, '', {
          detail: reachability.detail,
        });
        return;
      }

      // residual 3: re-verify blobs immediately AFTER the daemon boot -- pnpm
      // install / daemon init must not have mutated any owned route file.
      const postBootBlobProblems = reverifyBlobs(headWorktreeDir, OWNED_REL_PATHS);
      if (postBootBlobProblems.length > 0) {
        record('C9S-1', 'post-boot blob re-verification', 'no owned route file was mutated by pnpm install / daemon init', false, postBootBlobProblems.join('\n'));
        return;
      }

      const liveCounts = new Map<string, number>();
      for (const r of bootResult.routes) {
        if (r.method === 'USE' || r.method === 'ALL') continue;
        const k = `${r.method} ${r.path}`;
        liveCounts.set(k, (liveCounts.get(k) ?? 0) + 1);
      }
      const drift: string[] = [];
      for (const key of FROZEN_ROUTE_KEYS) {
        const count = liveCounts.get(key) ?? 0;
        if (count !== 1) drift.push(`${key}: live count ${count} (expected exactly 1)`);
      }
      for (const file of OWNED_FILES.filter((f) => f.fullFreeze)) {
        const ownedFrozenKeys = new Set([...FROZEN_ROUTE_KEYS].filter((k) => file.livePathPrefixes.some((p) => k.split(' ')[1]?.startsWith(p))));
        const liveAtPrefix = [...liveCounts.keys()].filter((k) => file.livePathPrefixes.some((p) => k.split(' ')[1]?.startsWith(p)));
        for (const liveKey of liveAtPrefix) {
          if (ownedFrozenKeys.has(liveKey)) continue;
          if (file.liveSiblingExclusions.includes(liveKey)) continue;
          drift.push(`${file.relPath}: unaccounted live route at owned prefix, neither frozen nor a named sibling exclusion: ${liveKey}`);
        }
      }
      const exposureLines = [...headExposureByKey.entries()].map(([k, v]) => `${k} => exposure ${v}`).join('\n');
      record(
        'C9S-1',
        '19 self-probes + per-file baseCommit/HEAD AST self-consistency + protected-port-validated + actively-reachability-confirmed isolated daemon boot -> allowlist-checked live route presence + post-boot blob re-verification',
        '20-route frozen snapshot matches all 5 owned files at baseCommit and HEAD, each frozen route appears exactly once live at a validated non-protected loopback address, and no owned file was mutated by the boot',
        drift.length === 0,
        `${drift.join('\n') || 'no problems'}\n\nboot address: ${JSON.stringify(bootResult.address)}\nlive-derived exposure (HEAD):\n${exposureLines}`,
      );
    } finally {
      await bootResult.teardown();
    }
  });

  const attribution = headWorktreeDir ? loadAttributionMatrix() : { error: 'detached HEAD worktree unavailable' };

  await checkCriterion('C9S-2', () => {
    if ('error' in attribution) {
      record('C9S-2', `read ${ATTRIBUTION_PATH_REL} (HEAD worktree, blob-verified)`, "every row's riskScore is integer-bounded [0,3] impact, formula-consistent, and exposure exactly matches the live-derived value", false, '', { detail: attribution.error });
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
    record('C9S-2', `read ${ATTRIBUTION_PATH_REL}; cross-check against FROZEN_IMPACT_FLOORS + integer bounds + live HEAD-derived exposure`, "every row's riskScore is integer-bounded, formula-consistent, and impact never claims below its frozen floor", problems.length === 0, problems.join('\n') || `${attribution.rows.length} rows checked, all formula-consistent`);
  });

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
  const testFilesRel = testFiles.map((f) => `apps/daemon/${f}`);
  const suiteResult = testFiles.length > 0 && headWorktreeDir ? runAgentSpawnSuite(headWorktreeDir, testFiles) : { suite: { status: 1 }, data: null };
  // residual 3: re-verify test-file blobs immediately AFTER the test suite
  // run -- the suite executing must not have rewritten its own source.
  const postSuiteBlobProblems = headWorktreeDir && testFiles.length > 0 ? reverifyBlobs(headWorktreeDir, testFilesRel) : [];
  const passedAssertionsByFile = new Map<string, AssertionResult[]>();
  if (suiteResult.data) {
    for (const fileResult of suiteResult.data.testResults) {
      passedAssertionsByFile.set(fileResult.name, fileResult.assertionResults.filter((a) => a.status === 'passed'));
    }
  }
  const allPassedFullNames = new Set<string>();
  for (const list of passedAssertionsByFile.values()) for (const a of list) allPassedFullNames.add(a.fullName);
  const testDeclarationsByFile = new Map<string, TestDeclaration[]>();
  const skipMarkersByFile = new Map<string, string[]>();
  if (headWorktreeDir) {
    for (const rel of testFiles) {
      const { content } = readVerifiedFromHeadWorktree(`apps/daemon/${rel}`);
      if (content === null) continue;
      testDeclarationsByFile.set(rel, extractTestDeclarations(content, rel));
      skipMarkersByFile.set(rel, findSkipMarkersAst(content, rel));
    }
  }
  const allTestDeclarations = [...testDeclarationsByFile.values()].flat();
  const globalCitationOwner = new Map<string, string>();
  const associatedRoutesByRef = new Map<string, Set<string>>();

  await checkCriterion('C9S-3', () => {
    if ('error' in attribution) {
      record('C9S-3', `read ${ATTRIBUTION_PATH_REL}`, 'exactly 20 rows, six required fields non-placeholder, every exposure>=2 row attributed via exactly one of control/acceptedRisk', false, '', { detail: attribution.error });
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
      if (typeof row.testRef === 'string' && row.testRef.trim() && !isPlaceholderText(row.testRef)) {
        resolveTestRef(row.testRef.trim(), key, false);
      }
      if (liveExposure === undefined || liveExposure < 2) continue;

      const control = row.control;
      const acceptedRisk = row.acceptedRisk;
      const hasControl = control != null && typeof control === 'object';
      const hasAcceptedRisk = acceptedRisk != null && typeof acceptedRisk === 'object';
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
    record('C9S-3', `read ${ATTRIBUTION_PATH_REL}; structural check + primary testRef validation + per-exposure>=2-row true-XOR control/acceptedRisk resolution`, 'exactly 20 rows, six fields non-placeholder, authn names its live exposure class, primary testRef globally unique when present, every exposure>=2 row attributed via exactly one mechanism (unattributed===0)', ok, `attributed=${attributed} unattributed=${unattributed} known-vulnerable=${knownVulnerable}\n${[...structuralProblems, ...rowDetails].join('\n') || 'no problems'}`);
  });

  await checkCriterion('C9S-4', () => {
    if ('error' in attribution) {
      record('C9S-4', `read ${ATTRIBUTION_PATH_REL}`, "every matrix-derived P0 row's sizeRateLimit resolves via the ENFORCED grammar, bound by both limit and overflow tokens, with real AST status-code assertions on BOTH bodies", false, '', { detail: attribution.error });
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
      // residual 4b: BOTH bodies checked, not only the over-limit one.
      const underDecl = allTestDeclarations.find((d) => d.title === underMatches[0]!.title);
      const overDecl = allTestDeclarations.find((d) => d.title === overMatches[0]!.title);
      const underOk = underDecl ? bodyAssertsStatusCodeAst(underDecl.bodyText, 200) || bodyAssertsStatusCodeAst(underDecl.bodyText, 202) : false;
      const overOk = overDecl ? bodyAssertsStatusCodeAst(overDecl.bodyText, overflowStatus) : false;
      if (!underOk) problems.push(`${key}: under-limit assertion "${underMatches[0]!.title}" body does not contain a real AST status-code assertion for 200/202`);
      if (!overOk) problems.push(`${key}: over-limit assertion "${overMatches[0]!.title}" body does not contain a real AST status-code assertion for ${overflowStatus}`);
    }
    record('C9S-4', "parse each matrix-derived P0 row's sizeRateLimit against the ENFORCED grammar; verify a limit+overflow-bound paired under/over-limit passing assertion AND real AST status-code assertions on BOTH bodies", 'every matrix-derived P0-tier row resolves size/rate-limit via a real, bound, currently-passing, body-verified control', problems.length === 0 && checked === p0RouteKeysFromMatrix.size, `P0 rows checked (matrix-derived): ${checked}/${p0RouteKeysFromMatrix.size} (${[...p0RouteKeysFromMatrix].join(', ')})\n${problems.join('\n') || 'no problems'}`);
  });

  await checkCriterion('C9S-5', () => {
    if (!headWorktreeDir) {
      record('C9S-5', '', 'the dedicated test file set exists, boots a real daemon, passes, zero skip/only/todo/pending, implements all 8 named corpus cases across >1 distinct test, new tests independently replayed', false, '', { detail: 'detached HEAD worktree unavailable' });
      return;
    }
    if (testFiles.length === 0) {
      record('C9S-5', 'glob apps/daemon/tests/agent-spawn-*.test.ts (HEAD worktree, blob-verified)', 'the dedicated test file set exists, boots a real daemon, passes, zero skip/only/todo/pending, implements all 8 named corpus cases across >1 distinct test, new tests independently replayed', false, '', {
        detail: 'no files matching agent-spawn-*.test.ts found',
      });
      return;
    }
    if (postSuiteBlobProblems.length > 0) {
      record('C9S-5', 'post-suite blob re-verification', 'no discovered test file was mutated by the suite run itself', false, postSuiteBlobProblems.join('\n'));
      return;
    }
    const markerHits: string[] = [];
    for (const rel of testFiles) {
      const hits = skipMarkersByFile.get(rel) ?? [];
      if (hits.length > 0) markerHits.push(`${rel}: ${hits.join(', ')}`);
    }
    const pendingCount = suiteResult.data?.numPendingTests ?? 0;
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
    const satisfyingDecls = new Set<TestDeclaration>();
    const missingCases = CORPUS_CASE_HINTS.filter((re) => {
      const hit = allTestDeclarations.find((d) => re.test(d.title) || re.test(d.bodyText));
      if (hit) satisfyingDecls.add(hit);
      return !hit;
    });
    // residual 4c: >1 DISTINCT test declaration required across the corpus.
    const distinctCoverageOk = satisfyingDecls.size > 1;
    const suitePassed = suiteResult.suite.status === 0 && (suiteResult.data?.numFailedTests ?? 1) === 0 && suiteResult.data !== null;

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
      if (existedAtBase) continue;
      const { content: redContent, error: redError } = readVerifiedFromHeadWorktree(`docs/security/agent-spawn-red/${slugify(ref)}.txt`);
      if (redError || redContent === null) {
        replayProblems.push(`new test "${ref}" (${owningRel}) has no red-evidence artifact at docs/security/agent-spawn-red/${slugify(ref)}.txt (${redError ?? 'not found'})`);
        continue;
      }
      const parsedTranscript = parseRedTranscript(redContent);
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

    const ok = markerHits.length === 0 && pendingCount === 0 && missingCases.length === 0 && distinctCoverageOk && suitePassed && replayProblems.length === 0;
    record('C9S-5', `glob apps/daemon/tests/agent-spawn-*.test.ts (${testFiles.length} file(s), HEAD worktree, blob-verified pre/post-suite); AST skip scan; independent detached-worktree replay for every genuinely-new cited test`, "suite exists, is green, zero AST-detected skip/only/todo/pending, textually implements all 8 named corpus cases across >1 distinct test declaration, and every new citation independently replays red", ok, `files: ${testFiles.join(', ')}\nsuite status=${suiteResult.suite.status} numFailedTests=${suiteResult.data?.numFailedTests ?? 'n/a'} numPassedTests=${suiteResult.data?.numPassedTests ?? 'n/a'} numPendingTests=${pendingCount}\nAST skip markers: ${markerHits.join(', ') || 'none'}\nmissing corpus case hints: ${missingCases.length}\ndistinct satisfying declarations: ${satisfyingDecls.size}\n${replayProblems.join('\n')}\n\n${replayEvidenceLog.join('\n\n') || '(no new-test replays triggered this run)'}`);
  });

  await checkCriterion('C9S-6', () => {
    if (!headWorktreeDir) {
      record('C9S-6', '', 'threat-model doc extended with a bounded Wave 9 section; each matrix-derived P0 route has its own exact-token bullet', false, '', { detail: 'detached HEAD worktree unavailable' });
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
    record('C9S-6', 'read docs/security/daemon-threat-model.md (blob-verified); bounded section; exact-token route-identity matching (never substring)', 'every matrix-derived P0 route has its own bullet naming exactly that route and citing exactly its expected reference', result.ok, result.evidence);
  });

  await checkCriterion('C9S-7', () => {
    const reviewPath = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'reviews', 'implementation-review.json');
    if (!fs.existsSync(reviewPath)) {
      record('C9S-7', `read ${reviewPath}`, 'reviewedCommit is a real 40-hex commit, ancestor-or-equal to HEAD, with an empty owned-path diff; reviewer distinct from every author; jobId non-empty; verdict APPROVE', false, '', {
        detail: `no record at ${reviewPath} -- orchestrator-owned, out-of-repo, W7 disposition-record trust model`,
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
    const jobId = typeof review.jobId === 'string' ? review.jobId.trim() : '';
    if (!reviewer) problems.push('reviewer missing/empty');
    if (!review.model) problems.push('model missing/empty');
    // residual 6: 40-hex required BEFORE any git resolution -- HEAD~1 and
    // other revision expressions are rejected outright, not resolved.
    if (!/^[0-9a-f]{40}$/i.test(reviewedCommit)) {
      problems.push(`reviewedCommit "${reviewedCommit}" is not a literal 40-hex commit sha (revision expressions like HEAD~1 are rejected outright)`);
    } else if (!resolveCommit(reviewedCommit)) {
      problems.push(`reviewedCommit "${reviewedCommit}" does not resolve to a real commit`);
    } else {
      // residual 6: reviewedCommit === headSha is now ACCEPTED (the strict-
      // ancestor rule was vestigial once the record moved out-of-repo).
      const validRelation = reviewedCommit === headSha || isAncestor(reviewedCommit, headSha);
      if (!validRelation) {
        problems.push('reviewedCommit is neither HEAD nor an ancestor of HEAD');
      } else {
        const allowGlobs = (loadLeaseAllowGlobs() ?? []).map(globToRegExp);
        const diffResult = sh('git', ['diff', '--name-only', `${reviewedCommit}..${headSha}`]);
        const changed = diffResult.stdout.trim().split('\n').filter(Boolean);
        const ownedChanged = changed.filter((f) => allowGlobs.some((re) => re.test(f)));
        if (ownedChanged.length > 0) problems.push(`owned-path diff from reviewedCommit to HEAD is non-empty: ${ownedChanged.join(', ')}`);
      }
      const authorsInRange = commitAuthorsBetween(baseCommit, reviewedCommit === headSha ? headSha : reviewedCommit);
      if (reviewer && authorsInRange.has(reviewer.toLowerCase())) problems.push(`reviewer "${reviewer}" matches a commit author -- reviewer must be distinct from author`);
    }
    // residual 6: jobId is now REQUIRED and non-placeholder.
    if (!jobId || isPlaceholderText(jobId)) problems.push('jobId missing, empty, or placeholder-shaped -- a real receipt is required');
    if (review.verdict !== 'APPROVE') problems.push(`verdict "${String(review.verdict)}" !== "APPROVE"`);
    record('C9S-7', `read ${reviewPath} (out-of-repo, orchestrator-owned, W7 disposition-record trust model)`, 'reviewedCommit is a real 40-hex commit (HEAD or a real ancestor) whose owned-path diff to HEAD is empty; reviewer distinct from every author; jobId non-empty; verdict is APPROVE', problems.length === 0, problems.join('\n') || `reviewer=${reviewer} model=${String(review.model)} reviewedCommit=${reviewedCommit} jobId=${jobId} verdict=${String(review.verdict)}`);
  });

  // C9S-8: REDESIGNED per founder ruling 2026-07-28 (residual 7). Checks
  // ONLY the founder-signed accepted-risk record -- the real-control
  // alternative is removed (would contradict the ruling). Ordinary
  // pass/fail; the blocked-on-founder mechanism is deleted entirely.
  await checkCriterion('C9S-8', () => {
    const NON_FOUNDER_DENYLIST = new Set(['orchestrator', 'implementer', 'verifier', 'claude', 'codex', 'sol', 'grok', 'ai', 'agent']);
    const namespaceBlocks = acceptedRiskBlocks.get('shared-local-namespace') ?? [];
    if (namespaceBlocks.length !== 1) {
      record('C9S-8', 'read DECISIONS.md@baseCommit for ### W9AS-ACCEPT-shared-local-namespace', 'a single founder-signed accepted-risk record exists, per founder decision 2026-07-28 (run-ID single-user shared-local namespace accepted)', false, '', {
        detail: `found ${namespaceBlocks.length} matching block(s) in DECISIONS.md@baseCommit (need exactly 1) -- expected to self-resolve once the orchestrator lands the founder-signed entry at freeze-landing; this tranche never edits DECISIONS.md itself`,
      });
      return;
    }
    const block = namespaceBlocks[0]!;
    const problems: string[] = [];
    if (!block.accepter || isPlaceholderText(block.accepter)) problems.push('Accepter missing or placeholder-shaped');
    else if (NON_FOUNDER_DENYLIST.has(block.accepter.trim().toLowerCase())) problems.push(`Accepter "${block.accepter}" matches a known non-founder identity`);
    if (!block.date) problems.push('Date missing');
    if (!block.rationale || isPlaceholderText(block.rationale)) problems.push('Rationale missing or placeholder-shaped');
    const authorsInRange = commitAuthorsBetween(baseCommit, headSha);
    if (block.accepter && authorsInRange.has(block.accepter.trim().toLowerCase())) problems.push(`Accepter "${block.accepter}" matches a commit author between baseCommit and HEAD -- cannot self-accept`);
    record('C9S-8', 'read DECISIONS.md@baseCommit for ### W9AS-ACCEPT-shared-local-namespace; Accepter/Date/Rationale + anti-self-accept + non-founder-identity denylist checks', 'the founder-signed accepted-risk record exists and is structurally sound', problems.length === 0, problems.join('\n') || `accepter=${block.accepter}, date=${block.date}, rationale=${block.rationale}`);
  });

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
      record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', true, `sha256: ${selfSha256}\nUNPINNED -- no approved-gate.sha256 present.`);
      return;
    }
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === selfSha256;
    record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', gateOk, `sha256: ${selfSha256}\napproved: ${approved}\nPINNED`, {
      detail: gateOk ? undefined : 'verify-w9-agent-spawn.ts modified since orchestrator approval',
    });
  });

  // LEASE: path-membership check + (residual 9) mechanical server.ts bound.
  await checkCriterion('LEASE', () => {
    let leasesRaw: { waves: Record<string, { allow: string[]; deny?: string[] }> };
    try {
      const leasesText = readFileAtCommit(baseCommit, 'docs/plans/waves/leases.json');
      leasesRaw = JSON.parse(leasesText) as typeof leasesRaw;
    } catch (err) {
      record('LEASE', `git show ${baseCommit}:docs/plans/waves/leases.json`, `no writes outside the ${LEASE_KEY} lease, read from baseCommit; server.ts additions bounded to <=2 added/0 removed lines`, false, '', {
        detail: `could not read/parse leases.json at baseCommit: ${String(err)}`,
      });
      return;
    }
    const lease = leasesRaw.waves[LEASE_KEY];
    if (!lease) {
      record('LEASE', '', '', false, '', { detail: `no "${LEASE_KEY}" entry in leases.json@baseCommit -- expected to self-resolve once this PRD lands on main and an implementation branch's baseCommit includes the applied lease row` });
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

    // residual 9: mechanical server.ts bound.
    const serverTsProblems: string[] = [];
    if (diffNames.includes('apps/daemon/src/server.ts')) {
      const numstat = sh('git', ['diff', '--numstat', `${baseCommit}...HEAD`, '--', 'apps/daemon/src/server.ts']);
      const line = numstat.stdout.trim().split('\n')[0] ?? '';
      const m = /^(\d+)\s+(\d+)\s+/.exec(line);
      const added = m?.[1] ? Number(m[1]) : NaN;
      const removed = m?.[2] ? Number(m[2]) : NaN;
      if (!(Number.isInteger(added) && Number.isInteger(removed) && added <= 2 && removed === 0)) {
        serverTsProblems.push(`server.ts diff exceeds the mechanical bound (<=2 added, 0 removed): numstat="${line}" added=${added} removed=${removed}`);
      }
    }

    const ok = violations.length === 0 && serverTsProblems.length === 0;
    record('LEASE', `git diff --name-only ${baseCommit}...HEAD subset-of leases.json[${LEASE_KEY}]; git diff --numstat on server.ts specifically when present`, `no writes outside the ${LEASE_KEY} lease, read from baseCommit; server.ts bounded to <=2 added/0 removed lines`, ok, [...violations, ...serverTsProblems].join('\n') || (diffNames.length === 0 ? 'no diff between baseCommit and HEAD' : `all ${diffNames.length} changed files inside the lease; server.ts bound satisfied or not present in diff`));
  });

  const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  await checkCriterion('HEAD-DRIFT', () => {
    record('HEAD-DRIFT', 'git rev-parse HEAD (re-resolved at end)', 'HEAD must not move during the run (secondary check -- the detached HEAD worktree + blob verification is the primary defense)', headShaFinal === headSha, `initial=${headSha} final=${headShaFinal}`, {
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

  const failures = results.filter((r) => r.status === 'fail');
  console.log(`\nverify-w9-agent-spawn: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty}, wroteOk=true, gateIntegrityPinned=${gateIntegrityPinned}, archiveOk=${archiveResult.ok})`);
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
