// verify-w9-ingest.ts -- wave mishmash-w9-ingest-tranche (Library ingest route
// hardening, first of the rolling W9 tranches) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w9-ingest.ts [--repo <path>]
// Exit 0 only when every C9 criterion passes, the tree is clean, the initial
// manifest placeholder wrote successfully, archival succeeded (construct +
// reread-verify), and the three named infra checks (GATE-INTEGRITY / LEASE /
// HEAD-DRIFT) pass. The commit-bound proof manifest is written to the wave's
// goal-state proof directory either way -- W3's own verifier (criterion
// C3-4) reads that manifest directly per docs/plans/waves/
// W9-ingest-tranche.md's "Definition of green"; it must not re-run this
// tranche's checks itself.
//
// CEREMONY FIX (founder-delegated escalation ruling, verbatim record at
// ~/.claude/goal-state/mishmash-w9-ingest-tranche/reviews/
// w9i-ceremony-ruling.md, after the stop rule fired on three consecutive
// non-APPROVEs). Six mechanical defects, ruled with exact fix semantics:
//
//   1. EXPOSURE CLASSIFIER. The old recursive `containsDirectCallToAny`
//      search let a guard call buried in dead/unreachable code (an
//      `if(false){...}` block, a branch that never dominates, code after an
//      unconditional return) still count as positive evidence. Replaced with
//      a straight-line dominance GRAMMAR: only two exact statement
//      sequences, as DIRECT children of the handler's own
//      `body.statements` (never a recursive descendant search), with at
//      most one `applyExtensionCors(req, res)` prelude statement before
//      them, count as positive exposure evidence. The `isLocalSameOrigin`
//      veto keeps a bounded recursive walk but now performs real dead-branch
//      elimination (statically-false `if`/`while`/`for` conditions are
//      skipped; `do...while` always executes once; unknown conditions keep
//      both branches). Nine self-probe fixtures (below) exercise both real
//      shapes and every named decoy class; a failed probe fails C9-1/C9-8.
//   2. RED EVIDENCE. Checked-in PARENT_SHA/COMMAND/TEST/output text is now
//      DESCRIPTIVE ONLY -- never executed, never trusted as proof. The
//      verifier independently determines the test's true introduction
//      commit (the first commit in baseCommit..HEAD whose AST contains the
//      exact new declaration) and requires the checked-in PARENT_SHA to
//      equal that commit's first parent, then REPLAYS: an isolated detached
//      temp worktree at PARENT_SHA, a frozen offline `pnpm install`, the
//      HEAD version of the containing file overlaid on top, run with a
//      verifier-constructed argv through vitest's JSON reporter. Passes only
//      on a nonzero exit, the cited test showing `failed`, and a named
//      CONTROL_TEST from the same file showing `passed`. The replay's own
//      argv/commits/statuses/output-hash/exit-code are captured in C9-5's
//      OWN artifact -- the implementer-authored transcript text can no
//      longer substitute as evidence.
//   3. HISTORICAL TITLE PARSING. Whether a cited test's title "existed at
//      baseCommit" is now AST-derived (TypeScript parse of the file at that
//      commit), matching only the static first argument of a real `it`/
//      `test` declaration (including modifier chains and `.each`'s outer
//      title call), string-literal or no-substitution-template only --
//      never a naive "this quoted string appears somewhere in the file"
//      scan, which let an ordinary route-path string falsely grant the
//      pre-existing-test exemption. Unavailable/dynamic titles fail closed
//      (treated as new, replay required).
//   4. CITATION UNIQUENESS / C9-7. One global fullName->routeKey map now
//      covers every row.testRef AND every row.control.testRef together
//      (round 2 only deduped primaries); cross-route reuse fails C9-5.
//      C9-7 now requires each P0 route's own bullet line to name EXACTLY
//      one P0 route key and cite EXACTLY that row's expected reference
//      (control.testRef for a controlled row, primary testRef for an
//      accepted-risk row) -- a bullet naming several P0 routes, or reusing
//      an unrelated passing citation, no longer counts.
//   5. C9-6 ENFORCEMENT GRAMMAR. The permissive rate/limit keyword regex
//      (which let "no rate limit exists" pass because it contains both
//      words) is replaced by a strict anchored declaration: `ENFORCED
//      kind=... scope=... limit=... windowMs=... overflow=...`, with
//      request-rate/pair-attempt requiring a positive windowMs and
//      byte-volume requiring windowMs=none. The declaration remains
//      descriptive; C9-6 passes only when the route-unique control.testRef
//      passes the full C9-5 bar (including replay for a new control) AND
//      the same file's real-transport (current HEAD suite) coverage shows
//      both an under-limit-accepted and an over-limit-rejected assertion.
//   6. ARCHIVE FINALIZATION. The prior round's post-success "best-effort
//      correction" (which could itself be silently swallowed) is removed.
//      `archiveRunArtifacts` now constructs the archived manifest with
//      `archiveOk:true` BEFORE writing, then rereads and verifies: the file
//      parses, `archiveOk===true`, the recorded hash matches, and every
//      archived artifact exists with a matching hash. Only after every
//      reread-verify step succeeds does it return `ok:true`; any failure
//      (copy, rewrite, parse, hash, or verify) returns `ok:false` with no
//      catch permitted to restore `true`. The canonical manifest is built
//      from that real result and a false result exits 1 regardless of
//      criterion outcomes.
//
// PORTABILITY: repoRoot comes from `process.cwd()`/`--repo`, never
// `import.meta.url`. Isolation: every daemon/worktree this verifier creates
// is isolated (port 0, fresh mkdtemp data dirs, detached temp worktrees) and
// torn down by its own exact handle. This verifier never touches a
// default-namespace daemon (ports 7456/51012) and never issues a `git
// fetch`/`git push` -- git context is resolved from local refs only.

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

const WAVE_SLUG = 'mishmash-w9-ingest-tranche';

function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W9-ingest',
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
      path.join(os.tmpdir(), 'verify-w9-ingest-emergency-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  } catch {
    /* truly nothing more we can do */
  }
  console.error(`verify-w9-ingest: FATAL during init: ${errorMessage}`);
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

// CEREMONY CONFIRMATION FIX: rewritten on spawnSync (rather than
// execFileSync's throw-on-nonzero-exit + try/catch dance) so stdout AND
// stderr are always captured on every exit path, success or failure --
// the prior execFileSync-based version only ever surfaced stdout (its catch
// block read e.stdout but never e.stderr), so any "stdout/stderr hash"
// claim built from it was false on the stderr half.
//
// CEREMONY CONFIRMATION FIX (round 3): `processError` distinguishes a
// spawn failure or a timeout-induced kill (spawnSync sets `.error` and/or
// `.signal` in those cases) from an ORDINARY nonzero exit code -- the two
// used to collapse into an indistinguishable `status:1`, so a caller
// checking only `status !== 0` could not tell a genuine red exit from a
// process that never ran a real test at all.
function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): { status: number; stdout: string; stderr: string; processError: boolean } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repoRoot,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 10 * 60_000,
    env: opts.env ?? process.env,
  });
  const processError = !!result.error || !!result.signal;
  if (result.error) {
    return { status: 1, stdout: result.stdout ?? '', stderr: `${result.stderr ?? ''}\n${String(result.error)}`, processError: true };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '', processError };
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
  const fallbackResult = tryWrite(path.join(os.tmpdir(), 'verify-w9-ingest-fallback-proof', `${id}.txt`));
  if (fallbackResult) return fallbackResult;
  console.error(`verify-w9-ingest: artifact write failed for ${id} on both primary and fallback paths`);
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
    wave: 'W9-ingest',
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
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w9-ingest-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
    } catch {
      /* last resort: stderr only */
    }
  }
  console.error(`verify-w9-ingest: FATAL, emergency manifest written=${wrote}: ${errorMessage}`);
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
function fileExistsAtCommit(commit: string, relPath: string): boolean {
  const r = sh('git', ['cat-file', '-e', `${commit}:${relPath}`]);
  return r.status === 0;
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

// =========================================================================
// F5 fix (round 2, unchanged by the ceremony): two-phase manifest write. A
// wroteOk:false placeholder is written IMMEDIATELY (before any criterion
// runs), overwriting whatever manifest.json a PRIOR run left behind, so a
// crash/interruption after this point can never leave a stale-but-complete-
// looking prior green manifest on disk. The write's own result is checked --
// if the placeholder itself cannot be written, this run aborts.
// =========================================================================
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
    wave: 'W9-ingest',
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
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w9-ingest-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
      console.error(`verify-w9-ingest: primary manifest write failed (${String(err)}); wrote fallback`);
    } catch (err2) {
      console.error(`verify-w9-ingest: manifest write failed everywhere (${String(err)} / ${String(err2)})`);
    }
    return { written: false, sha256: 'unavailable' };
  }
}

// =========================================================================
// CEREMONY ITEM 6 -- archive finalization. Constructs the archived manifest
// with archiveOk:true BEFORE writing, copies every criterion artifact into
// the run directory, rewrites artifact paths (self-contained), writes
// atomically, writes its SHA-256, then REREADS AND VERIFIES every one of
// those facts from disk. Returns ok:true only after every reread-verify
// step succeeds. No catch may preserve or restore `true` -- any exception or
// failed verification step returns ok:false. The prior round's post-success
// "best-effort correction" is REMOVED per the ruling; this function is now
// the single source of truth for its own result.
// =========================================================================
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
    // Constructed with archiveOk:true BEFORE writing, per the ruling.
    const selfContainedManifest: ManifestShape = { ...manifest, archiveOk: true, criteria: rewrittenCriteria };
    const manifestJsonPath = path.join(runDir, 'manifest.json');
    const tmpPath = path.join(runDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmpPath, JSON.stringify(selfContainedManifest, null, 2));
    fs.renameSync(tmpPath, manifestJsonPath);
    const computedSha = sha256File(manifestJsonPath);
    fs.writeFileSync(path.join(runDir, 'manifest.sha256.txt'), `${computedSha}\n`);

    // Reread and verify -- nothing here is assumed from the write above.
    const rereadRaw = fs.readFileSync(manifestJsonPath, 'utf8');
    const reread = JSON.parse(rereadRaw) as ManifestShape;
    if (reread.archiveOk !== true) return { runDir, ok: false };
    const rereadHash = sha256Bytes(rereadRaw);
    const recordedHash = fs.readFileSync(path.join(runDir, 'manifest.sha256.txt'), 'utf8').trim();
    if (rereadHash !== recordedHash) return { runDir, ok: false };
    for (const r of reread.criteria) {
      if (!r.artifact) continue; // a criterion with no artifact is already a criterion-level failure, not an archival one
      if (!fs.existsSync(r.artifact)) return { runDir, ok: false };
      if (!r.artifactSha256 || sha256File(r.artifact) !== r.artifactSha256) return { runDir, ok: false };
    }
    return { runDir, ok: true };
  } catch (err) {
    console.error(`verify-w9-ingest: run-archive FAILED (this fails the run, no catch may restore ok:true): ${String(err)}`);
    return { runDir, ok: false };
  }
}

// =========================================================================
// CEREMONY ITEM 1 -- exposure classifier: straight-line dominance grammar.
// Positive guard detection inspects ONLY direct children of the handler's
// own `body.statements` -- never a recursive descendant search. Only the
// two exact sequences below count; anything else (a call inside an `if`,
// loop, callback, nested function, or after an unconditional return) is not
// positive evidence. The `isLocalSameOrigin` veto keeps a bounded recursive
// walk with real dead-branch elimination.
// =========================================================================
/** `applyExtensionCors(req, res)` -- exactly two arguments, both identifiers, bound to the
 * enclosing handler's own first two parameter names. Arbitrary or absent arguments (a bare
 * `applyExtensionCors()`, or one bound to unrelated variables) no longer count as the prelude. */
function isApplyExtensionCorsPrelude(stmt: TsNode, handlerParamNames: readonly (string | null)[]): boolean {
  if (
    !ts.isExpressionStatement(stmt) ||
    !ts.isCallExpression(stmt.expression) ||
    !ts.isIdentifier(stmt.expression.expression) ||
    stmt.expression.expression.text !== 'applyExtensionCors'
  ) {
    return false;
  }
  const args = stmt.expression.arguments;
  if (args.length !== 2) return false;
  const [reqParam, resParam] = handlerParamNames;
  if (!reqParam || !resParam) return false;
  const [a0, a1] = args;
  return !!a0 && !!a1 && ts.isIdentifier(a0) && ts.isIdentifier(a1) && a0.text === reqParam && a1.text === resParam;
}
function isNegationOfIdentifier(expr: TsNode, varName: string): boolean {
  return (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isIdentifier(expr.operand) &&
    expr.operand.text === varName
  );
}
function isFalsyOkPropertyCheck(expr: TsNode, varName: string): boolean {
  const isCheckOkAccess = (n: TsNode): boolean =>
    ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === varName && n.name.text === 'ok';
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken && isCheckOkAccess(expr.operand)) {
    return true;
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
    const isFalseLiteral = (n: TsNode): boolean => n.kind === ts.SyntaxKind.FalseKeyword;
    if (isCheckOkAccess(expr.left) && isFalseLiteral(expr.right)) return true;
    if (isCheckOkAccess(expr.right) && isFalseLiteral(expr.left)) return true;
  }
  return false;
}
/** The consequent must, taken whole, unconditionally return or throw -- a bare statement or a block whose LAST statement is Return/Throw with no branch/loop/switch/try before it. */
function consequentUnconditionallyExits(stmt: TsNode): boolean {
  if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true;
  if (ts.isBlock(stmt)) {
    const stmts = stmt.statements;
    if (stmts.length === 0) return false;
    const last = stmts[stmts.length - 1]!;
    if (!(ts.isReturnStatement(last) || ts.isThrowStatement(last))) return false;
    for (let i = 0; i < stmts.length - 1; i++) {
      const s = stmts[i]!;
      if (
        ts.isIfStatement(s) ||
        ts.isForStatement(s) ||
        ts.isForInStatement(s) ||
        ts.isForOfStatement(s) ||
        ts.isWhileStatement(s) ||
        ts.isDoStatement(s) ||
        ts.isSwitchStatement(s) ||
        ts.isTryStatement(s)
      ) {
        return false;
      }
    }
    return true;
  }
  return false;
}
/** `const X = authorizeToolRequest(...)` at statements[startIdx], `if (!X) { unconditional exit }` at statements[startIdx+1]. */
function matchToolTokenGuard(statements: readonly TsNode[], startIdx: number): boolean {
  const s0 = statements[startIdx];
  if (!s0 || !ts.isVariableStatement(s0)) return false;
  if ((s0.declarationList.flags & ts.NodeFlags.Const) === 0) return false;
  const decls = s0.declarationList.declarations;
  if (decls.length !== 1) return false;
  const decl = decls[0]!;
  if (!ts.isIdentifier(decl.name) || !decl.initializer || !ts.isCallExpression(decl.initializer)) return false;
  if (!ts.isIdentifier(decl.initializer.expression) || decl.initializer.expression.text !== 'authorizeToolRequest') return false;
  const varName = decl.name.text;
  const s1 = statements[startIdx + 1];
  if (!s1 || !ts.isIfStatement(s1)) return false;
  if (!isNegationOfIdentifier(s1.expression, varName)) return false;
  return consequentUnconditionallyExits(s1.thenStatement);
}
/** `const token = bearerToken(req)`, `const check = validateLibraryToken(..., token)`, `if (!check.ok) { unconditional exit }`. */
function matchBearerGuard(statements: readonly TsNode[], startIdx: number): boolean {
  const s0 = statements[startIdx];
  if (!s0 || !ts.isVariableStatement(s0)) return false;
  if ((s0.declarationList.flags & ts.NodeFlags.Const) === 0) return false;
  const d0 = s0.declarationList.declarations;
  if (d0.length !== 1 || !ts.isIdentifier(d0[0]!.name)) return false;
  const tokenVar = d0[0]!.name.text;
  const init0 = d0[0]!.initializer;
  if (!init0 || !ts.isCallExpression(init0) || !ts.isIdentifier(init0.expression) || init0.expression.text !== 'bearerToken') return false;

  const s1 = statements[startIdx + 1];
  if (!s1 || !ts.isVariableStatement(s1)) return false;
  if ((s1.declarationList.flags & ts.NodeFlags.Const) === 0) return false;
  const d1 = s1.declarationList.declarations;
  if (d1.length !== 1 || !ts.isIdentifier(d1[0]!.name)) return false;
  const checkVar = d1[0]!.name.text;
  const init1 = d1[0]!.initializer;
  if (!init1 || !ts.isCallExpression(init1) || !ts.isIdentifier(init1.expression) || init1.expression.text !== 'validateLibraryToken') return false;
  const referencesToken = init1.arguments.some((a) => ts.isIdentifier(a) && a.text === tokenVar);
  if (!referencesToken) return false;

  const s2 = statements[startIdx + 2];
  if (!s2 || !ts.isIfStatement(s2)) return false;
  if (!isFalsyOkPropertyCheck(s2.expression, checkVar)) return false;
  return consequentUnconditionallyExits(s2.thenStatement);
}
function matchStraightLineGuards(
  statements: readonly TsNode[],
  handlerParamNames: readonly (string | null)[],
): { authorizeToolRequest: boolean; bearer: boolean } {
  const startIdx = statements.length > 0 && isApplyExtensionCorsPrelude(statements[0]!, handlerParamNames) ? 1 : 0;
  return {
    authorizeToolRequest: matchToolTokenGuard(statements, startIdx),
    bearer: matchBearerGuard(statements, startIdx),
  };
}

/** Compile-time-determinable boolean value of a condition expression, or undefined if not determinable. */
function staticBooleanValue(expr: TsNode): boolean | undefined {
  if (ts.isParenthesizedExpression(expr)) return staticBooleanValue(expr.expression);
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
    const v = staticBooleanValue(expr.operand);
    return v === undefined ? undefined : !v;
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const l = staticBooleanValue(expr.left);
      if (l === false) return false;
      const r = staticBooleanValue(expr.right);
      if (l === true && r !== undefined) return r;
      if (l !== undefined && r !== undefined) return l && r;
      return undefined;
    }
    if (op === ts.SyntaxKind.BarBarToken) {
      const l = staticBooleanValue(expr.left);
      if (l === true) return true;
      const r = staticBooleanValue(expr.right);
      if (l === false && r !== undefined) return r;
      if (l !== undefined && r !== undefined) return l || r;
      return undefined;
    }
  }
  // CEREMONY CONFIRMATION FIX (round 3): a ternary whose condition has a
  // static value is itself statically the corresponding branch's static
  // value (recursively) -- without this, `(true ? false : X) && Y` could
  // not be recognized as statically-false-on-the-left, so `visitExprSubtree`'s
  // `&&` handler (which calls staticBooleanValue to decide reachability of
  // the RHS) would treat the left operand as "unknown" and still visit Y,
  // even though the dead-arm-skipping walk itself never finds anything
  // inside the ternary's own (correctly-skipped) dead arm. Dead arms stay
  // skipped -- this only teaches the EVALUATOR what the WALKER already knew.
  if (ts.isConditionalExpression(expr)) {
    const condVal = staticBooleanValue(expr.condition);
    if (condVal === true) return staticBooleanValue(expr.whenTrue);
    if (condVal === false) return staticBooleanValue(expr.whenFalse);
    return undefined;
  }
  return undefined;
}
const NESTED_FUNCTION_KINDS = new Set([
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
  ts.SyntaxKind.MethodDeclaration,
]);
/** Bounded recursive reachability walk for the isLocalSameOrigin veto: never enters nested function/class bodies, stops after an unconditional top-level return/throw, and eliminates only statically-provable dead branches (if/while/for false conditions; do-while always runs once). */
function isLocalSameOriginReachable(root: TsNode): boolean {
  let found = false;
  // Short-circuit-aware: an operand that dead-expression evaluation proves
  // unreachable (the RHS of `false && ...`, the RHS of `true || ...`, the
  // untaken arm of a statically-resolved `cond ? a : b`) is never descended
  // into -- visiting the whole condition eagerly, before evaluating which
  // parts of it can even execute, is exactly what let an unreachable
  // short-circuited RHS such as `false && isLocalSameOrigin(...)` still veto.
  function visitExprSubtree(node: TsNode): void {
    if (found) return;
    if (NESTED_FUNCTION_KINDS.has(node.kind)) return;
    if (ts.isParenthesizedExpression(node)) {
      visitExprSubtree(node.expression);
      return;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'isLocalSameOrigin') {
      found = true;
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      visitExprSubtree(node.left);
      if (found) return;
      if (staticBooleanValue(node.left) === false) return; // RHS never evaluates
      visitExprSubtree(node.right);
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      visitExprSubtree(node.left);
      if (found) return;
      if (staticBooleanValue(node.left) === true) return; // RHS never evaluates
      visitExprSubtree(node.right);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      visitExprSubtree(node.condition);
      if (found) return;
      const condVal = staticBooleanValue(node.condition);
      if (condVal !== false) visitExprSubtree(node.whenTrue);
      if (found) return;
      if (condVal !== true) visitExprSubtree(node.whenFalse);
      return;
    }
    ts.forEachChild(node, visitExprSubtree);
  }
  function visitStatements(stmts: readonly TsNode[]): void {
    for (const s of stmts) {
      if (found) return;
      visitStatement(s);
      if (found) return;
      if (ts.isReturnStatement(s) || ts.isThrowStatement(s)) return; // rest of this sibling list is unreachable
    }
  }
  function visitStatement(s: TsNode): void {
    if (found) return;
    if (NESTED_FUNCTION_KINDS.has(s.kind)) return;
    if (ts.isBlock(s)) {
      visitStatements(s.statements);
      return;
    }
    if (ts.isIfStatement(s)) {
      visitExprSubtree(s.expression);
      if (found) return;
      const v = staticBooleanValue(s.expression);
      if (v !== false) visitStatement(s.thenStatement);
      if (found) return;
      if (s.elseStatement && v !== true) visitStatement(s.elseStatement);
      return;
    }
    if (ts.isWhileStatement(s)) {
      visitExprSubtree(s.expression);
      if (found) return;
      const v = staticBooleanValue(s.expression);
      if (v !== false) visitStatement(s.statement);
      return;
    }
    if (ts.isForStatement(s)) {
      if (s.condition) {
        visitExprSubtree(s.condition);
        if (found) return;
      }
      const v = s.condition ? staticBooleanValue(s.condition) : undefined;
      if (v !== false) visitStatement(s.statement);
      return;
    }
    if (ts.isDoStatement(s)) {
      // Always executes at least once, regardless of the condition.
      visitStatement(s.statement);
      if (found) return;
      visitExprSubtree(s.expression);
      return;
    }
    // Generic statement (ExpressionStatement, VariableStatement, SwitchStatement,
    // TryStatement, etc.) -- no elimination rule specified, so walk normally,
    // still respecting the nested-function-body exclusion throughout.
    visitExprSubtree(s);
  }
  if (ts.isBlock(root)) visitStatements(root.statements);
  else visitExprSubtree(root);
  return found;
}

interface RouteRegistration {
  method: string;
  routePath: string;
  hasRequireLocalDaemonRequest: boolean;
  hasAuthorizeToolRequest: boolean;
  hasSelfServiceBearerPattern: boolean;
}
interface CollectResult {
  registrations: RouteRegistration[];
  duplicates: string[]; // "METHOD path" keys seen more than once
}

function findFunctionBody(sourceFile: TypeScriptModule.SourceFile, fnName: string): TsNode | null {
  let found: TsNode | null = null;
  function visit(node: TsNode): void {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === fnName && node.body) {
      found = node.body;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

/** Only a block-bodied final handler is inspected at all; anything else supplies no positive evidence. */
function collectRouteGuardSignals(finalHandler: TsNode): { hasAuthorizeToolRequest: boolean; hasSelfServiceBearerPattern: boolean } {
  if (!(ts.isArrowFunction(finalHandler) || ts.isFunctionExpression(finalHandler)) || !finalHandler.body || !ts.isBlock(finalHandler.body)) {
    return { hasAuthorizeToolRequest: false, hasSelfServiceBearerPattern: false };
  }
  const fnBody = finalHandler.body;
  const handlerParamNames = finalHandler.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : null));
  const guards = matchStraightLineGuards(fnBody.statements, handlerParamNames);
  const vetoed = isLocalSameOriginReachable(fnBody);
  return {
    hasAuthorizeToolRequest: guards.authorizeToolRequest,
    hasSelfServiceBearerPattern: guards.bearer && !vetoed,
  };
}

function collectRouteRegistrations(sourceText: string, label: string): CollectResult {
  const sourceFile = ts.createSourceFile(label, sourceText, ts.ScriptTarget.Latest, true);
  const scopeRoot = findFunctionBody(sourceFile, 'registerLibraryRoutes');
  if (!scopeRoot) throw new Error(`registerLibraryRoutes function body not found in ${label}`);
  const httpMethods = new Set(['get', 'post', 'delete', 'options', 'put', 'patch']);
  const registrations: RouteRegistration[] = [];
  const seen = new Map<string, number>();
  function visit(node: TsNode): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'app' &&
      httpMethods.has(node.expression.name.text)
    ) {
      const method = node.expression.name.text;
      const [pathArg, ...rest] = node.arguments;
      if (pathArg && ts.isStringLiteral(pathArg) && rest.length > 0) {
        const finalHandler = rest[rest.length - 1]!;
        const middlewareArgs = rest.slice(0, -1);
        const hasRequireLocalDaemonRequest = middlewareArgs.some(
          (a) => ts.isIdentifier(a) && a.text === 'requireLocalDaemonRequest',
        );
        const signals = collectRouteGuardSignals(finalHandler);
        const key = `${method.toUpperCase()} ${pathArg.text}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        registrations.push({
          method: method.toUpperCase(),
          routePath: pathArg.text,
          hasRequireLocalDaemonRequest,
          hasAuthorizeToolRequest: signals.hasAuthorizeToolRequest,
          hasSelfServiceBearerPattern: signals.hasSelfServiceBearerPattern,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(scopeRoot);
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  return { registrations, duplicates };
}

/** Exposure per W9-ingest-tranche.md S9-2, mechanically derived, never trusted from the matrix. */
function classifyExposure(reg: RouteRegistration): number {
  if (reg.hasRequireLocalDaemonRequest) return 0;
  if (reg.hasAuthorizeToolRequest) return 1;
  if (reg.hasSelfServiceBearerPattern) return 2;
  return 3;
}

// -----------------------------------------------------------------------
// CEREMONY ITEM 1 (continued) -- self-probe fixtures. Sol's r3 review cited
// two dead-branch decoy examples (not reproduced verbatim in the ruling
// text available to this session); the fixtures below are representative
// constructions covering the same classes the ruling names explicitly --
// dead-if-false, dead-negated-boolean, branch-only (non-dominating but
// live), ignored result, post-response placement -- plus both real positive
// shapes and both isLocalSameOrigin-veto directions, run through the SAME
// collectRouteRegistrations/classifyExposure pipeline the real routes use
// (never a separate mock). A failed probe fails C9-1 and C9-8.
// -----------------------------------------------------------------------
interface SelfProbeFixture {
  name: string;
  source: string;
  route: string;
  expectedExposure: number;
}
const SELF_PROBE_FIXTURES: SelfProbeFixture[] = [
  {
    name: 'real-tool-token-shape',
    route: 'POST /probe/tool-token',
    expectedExposure: 1,
    source: `
export function registerLibraryRoutes(app, ctx) {
  app.post('/probe/tool-token', async (req, res) => {
    const grant = authorizeToolRequest(req, res, 'library:search');
    if (!grant) return;
    res.json({ ok: true });
  });
}`,
  },
  {
    name: 'real-bearer-shape-with-prelude',
    route: 'POST /probe/bearer',
    expectedExposure: 2,
    source: `
export function registerLibraryRoutes(app, ctx) {
  app.post('/probe/bearer', (req, res) => {
    applyExtensionCors(req, res);
    const token = bearerToken(req);
    const check = validateLibraryToken(db, token);
    if (!check.ok) {
      return sendApiError(res, 401, 'X', 'y');
    }
    res.json({ ok: true });
  });
}`,
  },
  {
    name: 'dead-branch-guard-if-false',
    route: 'POST /probe/dead-if-false',
    expectedExposure: 3,
    source: `
export function registerLibraryRoutes(app, ctx) {
  app.post('/probe/dead-if-false', (req, res) => {
    if (false) {
      const grant = authorizeToolRequest(req, res, 'library:search');
      if (!grant) return;
    }
    res.json({ ok: true });
  });
}`,
  },
  {
    name: 'dead-branch-guard-negated-true',
    route: 'POST /probe/dead-negated-true',
    expectedExposure: 3,
    source: `
export function registerLibraryRoutes(app, ctx) {
  app.post('/probe/dead-negated-true', (req, res) => {
    if (!true) {
      const token = bearerToken(req);
      const check = validateLibraryToken(db, token);
      if (!check.ok) return;
    }
    res.json({ ok: true });
  });
}`,
  },
  {
    name: 'branch-only-guard-live-conditional',
    route: 'POST /probe/branch-only',
    expectedExposure: 3,
    source: `
export function registerLibraryRoutes(app, ctx) {
  app.post('/probe/branch-only', (req, res) => {
    if (req.query.strict) {
      const grant = authorizeToolRequest(req, res, 'library:search');
      if (!grant) return;
    }
    res.json({ ok: true });
  });
}`,
  },
  {
    name: 'ignored-guard-result',
    route: 'POST /probe/ignored-result',
    expectedExposure: 3,
    source: `
export function registerLibraryRoutes(app, ctx) {
  app.post('/probe/ignored-result', (req, res) => {
    authorizeToolRequest(req, res, 'library:search');
    res.json({ ok: true });
  });
}`,
  },
  {
    name: 'guard-after-response-operation',
    route: 'POST /probe/after-response',
    expectedExposure: 3,
    source: `
export function registerLibraryRoutes(app, ctx) {
  app.post('/probe/after-response', (req, res) => {
    res.json({ ok: true });
    const grant = authorizeToolRequest(req, res, 'library:search');
    if (!grant) return;
  });
}`,
  },
  {
    name: 'isLocalSameOrigin-reachable-vetoes-bearer',
    route: 'POST /probe/veto-reachable',
    expectedExposure: 3,
    source: `
export function registerLibraryRoutes(app, ctx) {
  app.post('/probe/veto-reachable', (req, res) => {
    const token = bearerToken(req);
    const check = validateLibraryToken(db, token);
    const bound = check.ok && check.row.origin === req.get('origin');
    if (bound) {
      res.json({ ok: true });
    } else if (isLocalSameOrigin(req, port)) {
      res.json({ ok: true });
    } else {
      return sendApiError(res, 401, 'X', 'y');
    }
  });
}`,
  },
  {
    name: 'isLocalSameOrigin-dead-does-not-veto',
    route: 'POST /probe/veto-dead',
    expectedExposure: 2,
    source: `
export function registerLibraryRoutes(app, ctx) {
  app.post('/probe/veto-dead', (req, res) => {
    const token = bearerToken(req);
    const check = validateLibraryToken(db, token);
    if (!check.ok) {
      return sendApiError(res, 401, 'X', 'y');
    }
    if (false) {
      isLocalSameOrigin(req, port);
    }
    res.json({ ok: true });
  });
}`,
  },
];
interface SelfProbeOutcome {
  name: string;
  ok: boolean;
  detail: string;
}
function runExposureSelfProbes(): SelfProbeOutcome[] {
  return SELF_PROBE_FIXTURES.map((fixture) => {
    try {
      const collected = collectRouteRegistrations(fixture.source, `self-probe:${fixture.name}`);
      if (collected.duplicates.length > 0) {
        return { name: fixture.name, ok: false, detail: `unexpected duplicate registrations in fixture: ${collected.duplicates.join(', ')}` };
      }
      const reg = collected.registrations.find((r) => `${r.method} ${r.routePath}` === fixture.route);
      if (!reg) return { name: fixture.name, ok: false, detail: `route ${fixture.route} not found in probe fixture` };
      const actual = classifyExposure(reg);
      const ok = actual === fixture.expectedExposure;
      return { name: fixture.name, ok, detail: `expected exposure ${fixture.expectedExposure}, got ${actual}` };
    } catch (err) {
      return { name: fixture.name, ok: false, detail: `probe crashed: ${String(err)}` };
    }
  });
}

// -----------------------------------------------------------------------
// Reviewer-owned, frozen impact FLOORS (unchanged by the ceremony ruling --
// r3 confirmed the round-2 floor corrections and residuals as settled).
// -----------------------------------------------------------------------
const FROZEN_IMPACT_FLOORS: Record<string, number> = {
  'POST /api/library/pair': 0,
  'OPTIONS /api/library/pair/confirm': 0,
  'POST /api/library/pair/confirm': 2,
  'GET /api/library/connection': 0,
  'POST /api/library/pair/revoke': 2,
  'OPTIONS /api/library/pair/revoke': 0,
  'POST /api/library/pair/rotate': 2,
  'OPTIONS /api/library/pair/rotate': 0,
  'OPTIONS /api/library/ingest': 0,
  'POST /api/library/ingest': 3,
  'GET /api/library/clipper-probe': 0,
  'GET /api/library/assets': 2,
  'POST /api/library/sync': 2,
  'GET /api/library/assets/:id': 0,
  'DELETE /api/library/assets/:id': 2,
  'GET /api/library/assets/:id/raw': 1,
  'GET /api/library/assets/:id/figma': 1,
  'GET /api/library/assets/:id/element': 1,
  'POST /api/library/assets/:id/apply': 2,
  'POST /api/library/assets/:id/edit-as-page': 2,
  'POST /api/tools/library/search': 0,
  'POST /api/tools/library/apply': 2,
  'GET /api/library/events': 0,
};
const FROZEN_ROUTE_KEYS = new Set(Object.keys(FROZEN_IMPACT_FLOORS));
function tierFor(score: number): 'P0' | 'P1' | 'P2' {
  if (score >= 5) return 'P0';
  if (score === 4) return 'P1';
  return 'P2';
}

// -----------------------------------------------------------------------
// Attribution-field placeholder floor (round 2, unchanged by the ceremony).
// -----------------------------------------------------------------------
const PLACEHOLDER_DENYLIST = new Set([
  'x', 'xx', 'xxx', 'n/a', 'na', 'tbd', 'todo', 'none', 'unknown', 'owner',
  'test', 'foo', 'bar', '...', '-', 'fixme', 'placeholder', 'value', 'string',
  'description', 'field', 'tbd.', 'todo:',
]);
const MIN_FIELD_LENGTH = 12;
function isPlaceholderText(raw: unknown): boolean {
  if (typeof raw !== 'string') return true;
  const t = raw.trim().toLowerCase();
  if (t.length < MIN_FIELD_LENGTH) return true;
  if (PLACEHOLDER_DENYLIST.has(t)) return true;
  if (/^(.)\1*$/.test(t)) return true;
  return false;
}
const AUTHN_KEYWORD_BY_EXPOSURE: Record<number, RegExp> = {
  0: /requireLocalDaemonRequest|loopback/i,
  1: /authorizeToolRequest|tool[- ]token/i,
  2: /bearer|self-service|proof of possession/i,
  3: /\bnone\b|no gate|ungated|zero-config|pairing code/i,
};
function routeAssociationTerms(routeKey: string): string[] {
  const routePath = routeKey.split(' ').slice(1).join(' ');
  const stripped = routePath.replace(/^\/api\/(?:tools\/)?library\//, '').replace(/:id/g, '');
  return stripped
    .split(/[/-]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

// -----------------------------------------------------------------------
// CEREMONY ITEM 5 -- anchored ENFORCED declaration grammar, replacing the
// permissive keyword regex.
// -----------------------------------------------------------------------
interface EnforcedDeclaration {
  kind: 'request-rate' | 'byte-volume' | 'pair-attempt';
  scope: 'token-hash' | 'origin' | 'pairing-attempt';
  limit: number;
  windowMs: number | 'none';
  overflow: 'reject-429' | 'reject-413';
}
function parseEnforcedDeclaration(mechanism: string): EnforcedDeclaration | null {
  const m =
    /^ENFORCED kind=(request-rate|byte-volume|pair-attempt) scope=(token-hash|origin|pairing-attempt) limit=(\d+) windowMs=(\d+|none) overflow=(reject-429|reject-413)$/.exec(
      mechanism.trim(),
    );
  if (!m) return null;
  const kind = m[1] as EnforcedDeclaration['kind'];
  const scope = m[2] as EnforcedDeclaration['scope'];
  const limit = Number(m[3]);
  const windowMsStr = m[4]!;
  const overflow = m[5] as EnforcedDeclaration['overflow'];
  if (!Number.isInteger(limit) || limit <= 0) return null;
  if (windowMsStr === 'none') {
    if (kind !== 'byte-volume') return null; // only byte-volume may use windowMs=none
    return { kind, scope, limit, windowMs: 'none', overflow };
  }
  const windowMs = Number(windowMsStr);
  if (!Number.isInteger(windowMs) || windowMs <= 0) return null;
  if (kind === 'byte-volume') return null; // byte-volume MUST be windowMs=none
  return { kind, scope, limit, windowMs, overflow };
}
const UNDER_LIMIT_SIGNAL = /\b(accept|allow|within.?limit|under.?limit|below.?limit|not.?rate.?limited)\b/i;
const OVER_LIMIT_SIGNAL = /\b(reject|429|413|exceed|over.?limit|throttl\w*|rate.?limited|too.?many|too.?large)\b/i;

// CEREMONY CONFIRMATION FIX (regression + item 5): a signal "pair" requires
// TWO DISTINCT passing assertions, one matching each side -- a single
// assertion whose name happens to match both regexes (an omnibus name) no
// longer satisfies the pair, restoring the parent implementation's
// at-least-two-assertions requirement.
function hasDistinctSignalPair(candidates: readonly { fullName: string }[], matchA: (fullName: string) => boolean, matchB: (fullName: string) => boolean): boolean {
  const aMatches = candidates.filter((c) => matchA(c.fullName));
  const bMatches = candidates.filter((c) => matchB(c.fullName));
  return aMatches.some((a) => bMatches.some((b) => b.fullName !== a.fullName));
}
// CEREMONY CONFIRMATION FIX (item 5): transport coverage must bind the
// under/over-limit assertions to the SAME route (via the existing
// path-derived association terms), the parsed declaration's own numeric
// limit, and -- for the over-limit side -- the declared overflow status
// code. A bare "one assertion whose name matches an accept-shaped regex, a
// different one matching a reject-shaped regex" is no longer sufficient on
// its own; an unrelated or omnibus assertion name can no longer satisfy it.
//
// CEREMONY CONFIRMATION FIX (round 3): the numeric bindings were unbounded
// substring tests -- `fullName.includes('10')` matches inside "100", and
// `fullName.includes('429')` matches inside "1429" -- so a distinct,
// wrong-magnitude number could still satisfy the binding. Matching is now
// exact-token: the number must appear bounded by non-digit characters (or
// string start/end) on both sides, via `\b<n>\b` (digits are word
// characters, so a word boundary is exactly a digit boundary here).
function containsExactNumericToken(text: string, n: number): boolean {
  return new RegExp(`\\b${n}\\b`).test(text);
}
function matchesUnderLimitAssertion(fullName: string, routeTerms: readonly string[], parsed: EnforcedDeclaration): boolean {
  const nameLower = fullName.toLowerCase();
  const routeAssociated = routeTerms.length === 0 || routeTerms.some((t) => nameLower.includes(t.toLowerCase()));
  const mentionsLimit = containsExactNumericToken(fullName, parsed.limit);
  return routeAssociated && mentionsLimit && UNDER_LIMIT_SIGNAL.test(fullName);
}
function matchesOverLimitAssertion(fullName: string, routeTerms: readonly string[], parsed: EnforcedDeclaration): boolean {
  const nameLower = fullName.toLowerCase();
  const routeAssociated = routeTerms.length === 0 || routeTerms.some((t) => nameLower.includes(t.toLowerCase()));
  const mentionsLimit = containsExactNumericToken(fullName, parsed.limit);
  const overflowCode = parsed.overflow === 'reject-429' ? 429 : 413;
  const mentionsOverflow = containsExactNumericToken(fullName, overflowCode);
  return routeAssociated && mentionsLimit && mentionsOverflow && OVER_LIMIT_SIGNAL.test(fullName);
}

// -----------------------------------------------------------------------
// S9-3's generic paired positive/negative-control signal (round 2,
// UNCHANGED by the ceremony -- one of the three r3 accepted-LOW residuals
// ("a name-pattern proxy, not true semantic verification") the ceremony's
// coordinator message confirmed settled and must not change). Distinct
// from the item-5 rate/volume-specific UNDER_LIMIT_SIGNAL/OVER_LIMIT_SIGNAL
// pair above: this one applies to EVERY row's `control.testRef` (any
// exposure-3 attribution control, not just P0 rate-limit rows) and looks
// for generic accept-vs-reject naming, not rate-limit-specific language.
// -----------------------------------------------------------------------
const POSITIVE_SIGNAL = /\b(accept|allow|success|valid|authoriz\w*|grant\w*|permit\w*|200|passes?)\b/i;
const NEGATIVE_SIGNAL = /\b(reject|deny|denied|unauthoriz\w*|forbidden|invalid|401|403|429|error|fail\w*)\b/i;

// -----------------------------------------------------------------------
// CEREMONY ITEM 3 -- historical test-declaration parsing. A historical
// title exists ONLY as the static first argument of a syntactic Vitest
// `it`/`test` declaration (including modifier chains and `.each`'s outer
// title call), string-literal or no-substitution-template only.
//
// CEREMONY CONFIRMATION FIX (round 3): FACTORY modifiers (`each`, `for`,
// `runIf`, `skipIf`) return a FUNCTION that must be invoked AGAIN with a
// title to become a real declaration -- a call whose own direct callee
// chain terminates in one of these must NEVER contribute its own arguments
// as a title, in ANY context: standalone (`const factory =
// it.each('/api/library/ingest')`), assigned, or as an unrecognized inner
// link of a longer chain (`it.each('/api/library/ingest').helper('real
// title', fn)`, `.skip(...)`). `isFactoryCall` is a pure, context-free
// predicate on a call's own shape, so it rejects the SAME node identically
// no matter where in the tree it is encountered -- no suppression
// bookkeeping needed. TERMINAL modifiers (`concurrent`, `sequential`,
// `skip`, `only`, `todo`, `fails`) take the title directly. Only the OUTER
// invocation of a (possibly multi-level) factory chain's result -- i.e. a
// call whose OWN callee is itself a CallExpression resolving, through
// `isValidTestChainExpression`, back to a plain it/test-rooted chain of
// known modifiers -- may contribute a title.
// -----------------------------------------------------------------------
const FACTORY_TEST_MODIFIERS = new Set(['each', 'for', 'runIf', 'skipIf']);
const TERMINAL_TEST_MODIFIERS = new Set(['concurrent', 'sequential', 'skip', 'only', 'todo', 'fails']);
const KNOWN_TEST_MODIFIERS = new Set<string>([...FACTORY_TEST_MODIFIERS, ...TERMINAL_TEST_MODIFIERS]);
function extractStaticTestTitlesFromSource(sourceText: string, label: string): Set<string> {
  const sourceFile = ts.createSourceFile(label, sourceText, ts.ScriptTarget.Latest, true);
  const titles = new Set<string>();
  // Unwraps ONLY an identifier/property-access chain -- stops (returns
  // null) the moment it hits anything else, including a CallExpression.
  function directPropertyChain(expr: TsNode): { root: string; props: string[] } | null {
    let cur: TsNode = expr;
    const props: string[] = [];
    while (ts.isPropertyAccessExpression(cur)) {
      props.unshift(cur.name.text);
      cur = cur.expression;
    }
    if (!ts.isIdentifier(cur)) return null;
    if (cur.text !== 'it' && cur.text !== 'test') return null;
    return { root: cur.text, props };
  }
  // True iff this call's OWN direct callee (no nested calls) is a plain
  // it/test-rooted chain whose LAST modifier is a factory modifier -- this
  // call itself can never be a title-bearing declaration, full stop.
  function isFactoryCall(call: TsNode & { expression: TsNode }): boolean {
    const chain = directPropertyChain(call.expression);
    if (!chain || chain.props.length === 0) return false;
    return FACTORY_TEST_MODIFIERS.has(chain.props[chain.props.length - 1]!);
  }
  // Recursively validates that `expr` is a legitimate it/test declaration
  // chain -- unwrapping through any depth of CallExpression/
  // PropertyAccessExpression nesting, every modifier name known, rooted at
  // exactly it/test. Used to confirm an OUTER call is genuinely invoking
  // the result of a real (possibly multi-level) factory chain.
  function isValidTestChainExpression(expr: TsNode): boolean {
    if (ts.isCallExpression(expr)) return isValidTestChainExpression(expr.expression);
    if (ts.isPropertyAccessExpression(expr)) {
      if (!KNOWN_TEST_MODIFIERS.has(expr.name.text)) return false;
      return isValidTestChainExpression(expr.expression);
    }
    if (ts.isIdentifier(expr)) return expr.text === 'it' || expr.text === 'test';
    return false;
  }
  function addTitleFromFirstArg(args: readonly TsNode[]): void {
    const firstArg = args[0];
    if (firstArg && ts.isStringLiteral(firstArg)) titles.add(firstArg.text);
    else if (firstArg && ts.isNoSubstitutionTemplateLiteral(firstArg)) titles.add(firstArg.text);
  }
  function visit(node: TsNode): void {
    if (ts.isCallExpression(node) && !isFactoryCall(node)) {
      if (ts.isCallExpression(node.expression)) {
        // Outer invocation of a (possibly multi-level) factory chain's
        // result: it.each(arr)('title', fn), it.skipIf(x).each(arr)('t', fn).
        if (isValidTestChainExpression(node.expression)) {
          addTitleFromFirstArg(node.arguments);
        }
      } else {
        // Plain shape: it(...), it.concurrent(...), test.fails(...). Only a
        // property chain wholly composed of known modifiers, rooted at
        // exactly it/test, counts -- an unknown helper never does, and
        // isFactoryCall above has already excluded a bare factory call.
        const chain = directPropertyChain(node.expression);
        if (chain && chain.props.every((p) => KNOWN_TEST_MODIFIERS.has(p))) {
          addTitleFromFirstArg(node.arguments);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return titles;
}

// -----------------------------------------------------------------------
// Real daemon boot for route-inventory introspection (C9-1). Isolated:
// port 0, fresh mkdtemp OD_DATA_DIR, killed by its own exact PID.
// -----------------------------------------------------------------------
async function bootDaemonForRouteInventory(): Promise<{ method: string; path: string }[]> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w9-ingest-verify-'));
  const bootScript = `
import { pathToFileURL } from 'node:url';
process.env.OD_DATA_DIR = ${JSON.stringify(dataDir)};
const mod = await import(pathToFileURL(${JSON.stringify(path.join(repoRoot, 'apps/daemon/src/server.ts'))}).href);
const started = await mod.startServer({ port: 0, host: '127.0.0.1', returnServer: true });
console.log('OD_W9_INGEST_VERIFIER_READY ' + JSON.stringify({ routeInventory: started.routeInventory }));
await started.shutdown();
process.exit(0);
`;
  const scriptPath = path.join(proofDir, `.boot-daemon.${process.pid}.${crypto.randomBytes(3).toString('hex')}.mjs`);
  fs.writeFileSync(scriptPath, bootScript);
  const child = spawn('pnpm', ['exec', 'tsx', scriptPath], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffered = '';
  const routes = await new Promise<{ method: string; path: string }[] | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 60_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const line = buffered.split('\n').find((l) => l.startsWith('OD_W9_INGEST_VERIFIER_READY '));
      if (line) {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(line.slice('OD_W9_INGEST_VERIFIER_READY '.length)) as {
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

// -----------------------------------------------------------------------
// Glob apps/daemon/tests/library-*.test.ts at run time -- never a fixed
// list an implementer could route new coverage around.
// -----------------------------------------------------------------------
function discoverLibraryTestFiles(): string[] {
  const testsDir = path.join(repoRoot, 'apps/daemon/tests');
  return fs
    .readdirSync(testsDir)
    .filter((f) => /^library-.*\.test\.ts$/.test(f))
    .sort()
    .map((f) => `tests/${f}`);
}
interface AssertionResult {
  fullName: string;
  title: string;
  status: string;
}
interface FileTestResult {
  name: string; // absolute path to the test file, per vitest's json reporter
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
function runLibrarySuite(testFiles: string[], attempt: number, cwd?: string, outPath?: string): { suite: { status: number }; data: SuiteJson | null } {
  const jsonPath = outPath ?? path.join(proofDir, `suite-run.attempt-${attempt}.json`);
  const suite = sh(
    'pnpm',
    ['--filter', '@open-design/daemon', 'exec', 'vitest', 'run', '-c', 'vitest.config.ts', '--reporter=json', `--outputFile=${jsonPath}`, ...testFiles],
    cwd ? { cwd, timeoutMs: 3 * 60_000 } : {},
  );
  let data: SuiteJson | null = null;
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as SuiteJson;
  } catch {
    data = null;
  }
  return { suite, data };
}

// =========================================================================
// CEREMONY ITEM 2 -- red-evidence replay. Checked-in COMMAND/output text is
// descriptive only; the verifier determines the true introduction commit,
// requires PARENT_SHA to equal its first parent, then replays in an
// isolated detached temp worktree with a frozen offline install and the
// HEAD test file overlaid on top.
// =========================================================================
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
interface ReplayOutcome {
  ok: boolean;
  problems: string[];
  evidenceLines: string[];
}
function replayRedEvidence(parentSha: string, containingFileRel: string, targetFullName: string, controlTestFullName: string): ReplayOutcome {
  const problems: string[] = [];
  const evidenceLines: string[] = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w9-ingest-replay-'));
  let worktreeAdded = false;
  try {
    const addResult = sh('git', ['worktree', 'add', '--detach', tempDir, parentSha], { timeoutMs: 5 * 60_000 });
    evidenceLines.push(`git worktree add --detach ${tempDir} ${parentSha} => exit=${addResult.status}`);
    if (addResult.status !== 0) {
      problems.push(`git worktree add failed (exit=${addResult.status}): ${addResult.stdout.slice(-500)}`);
      return { ok: false, problems, evidenceLines };
    }
    worktreeAdded = true;

    // mise.toml trust is per-directory; the temp worktree is untrusted by
    // default and pnpm/vitest are mise-shimmed, so install/run would
    // otherwise fail closed with an unrelated "config not trusted" error.
    sh('mise', ['trust'], { cwd: tempDir, timeoutMs: 30_000 });

    const installResult = sh('pnpm', ['install', '--offline', '--frozen-lockfile'], { cwd: tempDir, timeoutMs: 5 * 60_000 });
    evidenceLines.push(`pnpm install --offline --frozen-lockfile => exit=${installResult.status}`);
    if (installResult.status !== 0) {
      problems.push(`frozen offline install failed (exit=${installResult.status}): ${installResult.stdout.slice(-1000)}`);
      return { ok: false, problems, evidenceLines };
    }

    const headFileAbs = path.join(repoRoot, 'apps/daemon', containingFileRel);
    const targetFileAbs = path.join(tempDir, 'apps/daemon', containingFileRel);
    try {
      fs.mkdirSync(path.dirname(targetFileAbs), { recursive: true });
      fs.copyFileSync(headFileAbs, targetFileAbs);
    } catch (err) {
      problems.push(`could not overlay HEAD test file: ${String(err)}`);
      return { ok: false, problems, evidenceLines };
    }
    evidenceLines.push(`overlay: HEAD:apps/daemon/${containingFileRel} -> ${targetFileAbs}`);

    const jsonOutPath = path.join(tempDir, '.replay-result.json');
    const argvList = [
      '--filter', '@open-design/daemon', 'exec', 'vitest', 'run', '-c', 'vitest.config.ts',
      '--reporter=json', `--outputFile=${jsonOutPath}`, `tests/${path.basename(containingFileRel)}`,
    ];
    evidenceLines.push(`argv: pnpm ${argvList.join(' ')} (cwd=${path.join(tempDir, 'apps/daemon')})`);
    const runResult = sh('pnpm', argvList, { cwd: path.join(tempDir, 'apps/daemon'), timeoutMs: 3 * 60_000 });
    // Both streams captured -- sh() now returns stderr too (ceremony
    // confirmation fix), so this hash is honestly what it claims to be.
    const outputHash = sha256Bytes(`${runResult.stdout}\n--- stderr ---\n${runResult.stderr}`);
    evidenceLines.push(`exit=${runResult.status} processError=${runResult.processError} stdout+stderr sha256=${outputHash}`);

    // CEREMONY CONFIRMATION FIX (round 3): a spawn error or a timeout-
    // induced kill is NOT the expected red exit -- it means no genuine test
    // run happened at all. Previously `sh()` collapsed this into an
    // ordinary status:1, indistinguishable from a real failing test run;
    // this must fail the replay outright, before even attempting to parse
    // whatever (if anything) the reporter wrote.
    if (runResult.processError) {
      problems.push('replay child process reported a spawn error or was killed (timeout/signal) -- not a genuine test-driven red exit');
      return { ok: false, problems, evidenceLines };
    }

    let replayData: SuiteJson | null = null;
    try {
      replayData = JSON.parse(fs.readFileSync(jsonOutPath, 'utf8')) as SuiteJson;
    } catch (err) {
      problems.push(`replay JSON reporter output could not be parsed: ${String(err)}`);
      return { ok: false, problems, evidenceLines };
    }
    const replayAssertions = replayData.testResults.flatMap((t) => t.assertionResults);
    const targetAssertion = replayAssertions.find((a) => a.fullName === targetFullName);
    const controlAssertion = replayAssertions.find((a) => a.fullName === controlTestFullName);
    evidenceLines.push(`target="${targetFullName}" status=${targetAssertion?.status ?? 'MISSING'}`);
    evidenceLines.push(`CONTROL_TEST="${controlTestFullName}" status=${controlAssertion?.status ?? 'MISSING'}`);

    // CEREMONY CONFIRMATION FIX: the target must be the ONLY failure --
    // an unrelated failed assertion or timeout (which also reports status
    // "failed" in the JSON reporter) can no longer coexist with the target
    // failure and passing control and still pass. Both the reporter's own
    // failed-test count and a direct scan of every OTHER assertion's status
    // must agree there is exactly one failure, and it must be the target.
    const otherFailed = replayAssertions.filter((a) => a.status === 'failed' && a.fullName !== targetFullName);
    evidenceLines.push(`numFailedTests=${replayData.numFailedTests} otherFailedAssertions=${otherFailed.length}`);
    if (otherFailed.length > 0) {
      problems.push(`replay produced ${otherFailed.length} unrelated failed assertion(s) besides the target: ${otherFailed.map((a) => a.fullName).join('; ')}`);
    }
    if (replayData.numFailedTests !== 1) {
      problems.push(`replay reporter numFailedTests is ${replayData.numFailedTests}, expected exactly 1 (the target only)`);
    }

    // CEREMONY CONFIRMATION FIX (round 3): reject reporter-level
    // inconsistencies and suite-level failures the assertion-level checks
    // above cannot see on their own -- a reporter claiming `success:true`
    // while a test failed is self-contradictory output, and a replay that
    // touches more than the one targeted file, or fails more than that one
    // file, means something beyond the target test itself went wrong.
    evidenceLines.push(`reporter success=${replayData.success} numTotalTestSuites=${replayData.numTotalTestSuites} numFailedTestSuites=${replayData.numFailedTestSuites}`);
    if (replayData.success !== false) {
      problems.push(`replay reporter's own "success" field is ${JSON.stringify(replayData.success)}, expected exactly false for a genuine failing run`);
    }
    if (replayData.numTotalTestSuites !== 1 || replayData.numFailedTestSuites !== 1) {
      problems.push(`replay reporter suite-level counts are inconsistent with a single failing file (numTotalTestSuites=${replayData.numTotalTestSuites}, numFailedTestSuites=${replayData.numFailedTestSuites}, expected 1/1)`);
    }

    if (runResult.status === 0) problems.push('replay child process exited 0 (expected nonzero for a genuine red state)');
    if (!targetAssertion) problems.push(`target test "${targetFullName}" not found in replay results`);
    else if (targetAssertion.status !== 'failed') problems.push(`target test status in replay is "${targetAssertion.status}", expected "failed"`);
    if (!controlAssertion) problems.push(`CONTROL_TEST "${controlTestFullName}" not found in replay results`);
    else if (controlAssertion.status !== 'passed') problems.push(`CONTROL_TEST status in replay is "${controlAssertion.status}", expected "passed"`);

    return { ok: problems.length === 0, problems, evidenceLines };
  } catch (err) {
    problems.push(`replay crashed: ${String(err)}`);
    return { ok: false, problems, evidenceLines };
  } finally {
    if (worktreeAdded) {
      sh('git', ['worktree', 'remove', '--force', tempDir], { timeoutMs: 60_000 });
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
/** Structured red-transcript header. COMMAND and the output body are descriptive only, per the ruling -- never executed, never trusted as proof; PARENT_SHA and TEST are validated, and TEST/CONTROL_TEST drive the actual replay. */
function parseRedTranscript(content: string): {
  parentSha: string | undefined;
  command: string | undefined;
  test: string | undefined;
  controlTest: string | undefined;
  body: string;
} {
  const lines = content.split('\n');
  let parentSha: string | undefined;
  let command: string | undefined;
  let test: string | undefined;
  let controlTest: string | undefined;
  let bodyStartIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^---+\s*$/.test(l)) {
      bodyStartIdx = i + 1;
      break;
    }
    const pm = /^PARENT_SHA:\s*(\S+)/.exec(l);
    if (pm) parentSha = pm[1];
    const cm = /^COMMAND:\s*(.+)$/.exec(l);
    if (cm) command = cm[1]!.trim();
    const tm = /^TEST:\s*(.+)$/.exec(l);
    if (tm) test = tm[1]!.trim();
    const ctm = /^CONTROL_TEST:\s*(.+)$/.exec(l);
    if (ctm) controlTest = ctm[1]!.trim();
  }
  return { parentSha, command, test, controlTest, body: lines.slice(bodyStartIdx).join('\n') };
}

async function main(): Promise<void> {
  const placeholderWrite = writeManifestFile(buildManifest(false, true, false));
  if (!placeholderWrite.written) {
    console.error('verify-w9-ingest: FATAL: could not write the initial wroteOk:false placeholder manifest -- aborting rather than risk leaving a stale prior manifest unflagged.');
    process.exit(1);
  }

  // Exposure-classifier self-probes (ceremony item 1) -- run once, gate
  // both C9-1 and C9-8.
  const selfProbeResults = runExposureSelfProbes();
  const selfProbeFailures = selfProbeResults.filter((p) => !p.ok);

  let baseCommitCollect: CollectResult | null = null;
  let baseCommitError = '';
  try {
    const baseCommitText = readFileAtCommit(baseCommit, 'apps/daemon/src/routes/library.ts');
    baseCommitCollect = collectRouteRegistrations(baseCommitText, `${baseCommit}:routes/library.ts`);
  } catch (err) {
    baseCommitError = String((err as Error)?.stack ?? err);
  }
  let headCollect: CollectResult | null = null;
  let headError = '';
  try {
    const headText = fs.readFileSync(path.join(repoRoot, 'apps/daemon/src/routes/library.ts'), 'utf8');
    headCollect = collectRouteRegistrations(headText, 'HEAD:routes/library.ts');
  } catch (err) {
    headError = String((err as Error)?.stack ?? err);
  }
  const headExposureByKey = new Map<string, number>();
  if (headCollect) {
    for (const reg of headCollect.registrations) {
      headExposureByKey.set(`${reg.method} ${reg.routePath}`, classifyExposure(reg));
    }
  }

  // C9-1: route snapshot frozen at baseCommit, drift-checked, gated on the
  // exposure-classifier self-probes.
  await checkCriterion('C9-1', async () => {
    if (selfProbeFailures.length > 0) {
      record(
        'C9-1',
        'exposure-classifier self-probes (9 fixtures) run through the real collectRouteRegistrations/classifyExposure pipeline',
        'every self-probe fixture classifies at its expected exposure',
        false,
        selfProbeResults.map((p) => `[${p.ok ? 'PASS' : 'FAIL'}] ${p.name}: ${p.detail}`).join('\n'),
        { detail: `${selfProbeFailures.length}/${selfProbeResults.length} self-probes failed -- exposure classifier is not trustworthy this run` },
      );
      return;
    }
    if (!baseCommitCollect) {
      record('C9-1', `git show ${baseCommit}:apps/daemon/src/routes/library.ts`, 'frozen route set derives from baseCommit, not a HEAD literal', false, '', {
        detail: `could not derive baseCommit route set: ${baseCommitError}`,
      });
      return;
    }
    const baseKeys = new Set(baseCommitCollect.registrations.map((r) => `${r.method} ${r.routePath}`));
    const baseVsFrozenTableMissing = [...FROZEN_ROUTE_KEYS].filter((k) => !baseKeys.has(k));
    const baseVsFrozenTableExtra = [...baseKeys].filter((k) => !FROZEN_ROUTE_KEYS.has(k));
    if (baseCommitCollect.duplicates.length > 0 || baseVsFrozenTableMissing.length > 0 || baseVsFrozenTableExtra.length > 0) {
      record(
        'C9-1',
        `AST-scan git show ${baseCommit}:apps/daemon/src/routes/library.ts, scoped to registerLibraryRoutes`,
        'baseCommit route set matches the reviewer-frozen FROZEN_IMPACT_FLOORS key set exactly, with zero duplicate registrations',
        false,
        `baseCommit duplicates: ${baseCommitCollect.duplicates.join(', ') || 'none'}\nmissing from baseCommit vs frozen table: ${baseVsFrozenTableMissing.join(', ') || 'none'}\nextra in baseCommit vs frozen table: ${baseVsFrozenTableExtra.join(', ') || 'none'}`,
      );
      return;
    }
    const liveRoutesRaw = await bootDaemonForRouteInventory();
    const scopedLive = liveRoutesRaw.filter(
      (r) => (r.path.startsWith('/api/library') || r.path.startsWith('/api/tools/library')) && r.method !== 'USE' && r.method !== 'ALL',
    );
    const liveDuplicateCounts = new Map<string, number>();
    for (const r of scopedLive) {
      const k = `${r.method} ${r.path}`;
      liveDuplicateCounts.set(k, (liveDuplicateCounts.get(k) ?? 0) + 1);
    }
    const liveDuplicates = [...liveDuplicateCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    const liveKeys = new Set(scopedLive.map((r) => `${r.method} ${r.path}`));
    const added = [...liveKeys].filter((k) => !FROZEN_ROUTE_KEYS.has(k));
    const removed = [...FROZEN_ROUTE_KEYS].filter((k) => !liveKeys.has(k));
    const exposureHistogram = baseCommitCollect.registrations
      .map((r) => `${r.method} ${r.routePath} => exposure ${classifyExposure(r)}`)
      .join('\n');
    const ok = liveDuplicates.length === 0 && added.length === 0 && removed.length === 0;
    record(
      'C9-1',
      'self-probes (9/9 pass) + baseCommit AST self-consistency + boot real daemon -> routeInventory filtered to /api/library/* + /api/tools/library/*',
      '23-route frozen snapshot matches the live daemon\'s own route registration, zero drift, zero duplicate registrations, exposure classifier self-verified',
      ok,
      `self-probes: ${selfProbeResults.length}/${selfProbeResults.length} pass\nfrozen=${FROZEN_ROUTE_KEYS.size} live(scoped)=${liveKeys.size} liveRaw=${scopedLive.length}\nlive duplicates: ${liveDuplicates.join(', ') || 'none'}\nadded (drift): ${added.join(', ') || 'none'}\nremoved: ${removed.join(', ') || 'none'}\n\nbaseCommit exposure histogram:\n${exposureHistogram}`,
    );
  });

  // C9-2: existing suite green over a GLOBBED file set.
  const testFiles = discoverLibraryTestFiles();
  let suiteRun = runLibrarySuite(testFiles, 1);
  let suiteAttempts = 1;
  if (suiteRun.suite.status !== 0 || (suiteRun.data?.numFailedTests ?? 1) !== 0) {
    suiteRun = runLibrarySuite(testFiles, 2);
    suiteAttempts = 2;
  }
  const bannedMarker = /\b(?:it|describe|test)\s*(?:\.\s*(?:skip|only|todo)\s*\(|\[\s*['"](?:skip|only|todo)['"]\s*\]\s*\()/;
  const markerHits: string[] = [];
  for (const rel of testFiles) {
    const text = fs.readFileSync(path.join(repoRoot, 'apps/daemon', rel), 'utf8');
    if (bannedMarker.test(text)) markerHits.push(rel);
  }
  const allTests: AssertionResult[] = suiteRun.data ? suiteRun.data.testResults.flatMap((t) => t.assertionResults) : [];
  const passedTestNames = new Set(allTests.filter((t) => t.status === 'passed').map((t) => t.fullName));
  const nonPassed = allTests.filter((t) => t.status !== 'passed');
  await checkCriterion('C9-2', () => {
    const ok =
      suiteRun.suite.status === 0 &&
      (suiteRun.data?.numFailedTests ?? 1) === 0 &&
      (suiteRun.data?.numPendingTests ?? 0) === 0 &&
      nonPassed.length === 0 &&
      markerHits.length === 0 &&
      allTests.length > 0 &&
      testFiles.length > 0;
    record(
      'C9-2',
      `vitest --reporter=json over ${testFiles.length} glob-discovered library-*.test.ts files (attempts=${suiteAttempts})`,
      'full existing ingest-security suite green (zero failed, zero pending/skipped), zero skip/only/todo markers, discovered by glob not a fixed list',
      ok,
      `discovered files: ${testFiles.join(', ')}\nsuite exit=${suiteRun.suite.status} failed=${suiteRun.data?.numFailedTests ?? 'unknown'} pending=${suiteRun.data?.numPendingTests ?? 'unknown'} passed=${suiteRun.data?.numPassedTests ?? 'unknown'} totalAssertions=${allTests.length}\nnon-passed: ${nonPassed.map((t) => `${t.status}:${t.fullName}`).join('\n') || 'none'}\nbanned markers: ${markerHits.join(', ') || 'none'}\nattempts=${suiteAttempts}`,
    );
  });

  function findAssertion(fullName: string): { rel: string; title: string } | null {
    for (const t of suiteRun.data?.testResults ?? []) {
      const a = t.assertionResults.find((x) => x.fullName === fullName);
      if (a) return { rel: path.relative(path.join(repoRoot, 'apps/daemon'), t.name), title: a.title };
    }
    return null;
  }
  const fileTextAtBaseCache = new Map<string, string | null>();
  function readFileAtCommitCached(commit: string, relPath: string): string | null {
    const cacheKey = `${commit}:${relPath}`;
    if (fileTextAtBaseCache.has(cacheKey)) return fileTextAtBaseCache.get(cacheKey)!;
    try {
      const text = readFileAtCommit(commit, relPath);
      fileTextAtBaseCache.set(cacheKey, text);
      return text;
    } catch {
      fileTextAtBaseCache.set(cacheKey, null);
      return null;
    }
  }
  // CEREMONY ITEM 3: exact test title existed at baseCommit, AST-derived.
  function titleExistedAtBaseCommit(rel: string, leafTitle: string): boolean {
    if (!leafTitle) return false;
    const baseContent = readFileAtCommitCached(baseCommit, `apps/daemon/${rel}`);
    if (baseContent === null) return false;
    return extractStaticTestTitlesFromSource(baseContent, `${baseCommit}:${rel}`).has(leafTitle);
  }

  // Attribution matrix: parsed once, reused across C9-3..C9-8.
  const matrixPath = path.join(repoRoot, 'docs/security/library-ingest-attribution.json');
  interface AttributionRow {
    method?: unknown;
    path?: unknown;
    owner?: unknown;
    authn?: unknown;
    authz?: unknown;
    inputValidation?: unknown;
    sizeRateLimit?: unknown;
    testRef?: unknown;
    riskScore?: { exposure?: unknown; impact?: unknown; score?: unknown; tier?: unknown };
    control?: { mechanism?: unknown; testRef?: unknown } | null;
    acceptedRisk?: { decisionRef?: unknown } | null;
  }
  let matrixRows: AttributionRow[] | null = null;
  let matrixParseError = '';
  if (fs.existsSync(matrixPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(matrixPath, 'utf8')) as { rows?: AttributionRow[] };
      matrixRows = Array.isArray(raw.rows) ? raw.rows : null;
      if (!matrixRows) matrixParseError = 'top-level "rows" is not an array';
    } catch (err) {
      matrixParseError = `JSON parse failed: ${String(err)}`;
    }
  } else {
    matrixParseError = `file does not exist: ${path.relative(repoRoot, matrixPath)}`;
  }

  // C9-3: matrix exists and covers exactly the frozen route set.
  await checkCriterion('C9-3', () => {
    if (!matrixRows) {
      record('C9-3', `read ${path.relative(repoRoot, matrixPath)}`, 'exactly one row per frozen route, no orphans, no gaps', false, '', {
        detail: matrixParseError,
      });
      return;
    }
    const rowKeys = matrixRows
      .filter((r) => typeof r.method === 'string' && typeof r.path === 'string')
      .map((r) => `${r.method} ${r.path}`);
    const duplicates = rowKeys.filter((k, i) => rowKeys.indexOf(k) !== i);
    const orphans = [...new Set(rowKeys)].filter((k) => !FROZEN_ROUTE_KEYS.has(k));
    const missing = [...FROZEN_ROUTE_KEYS].filter((k) => !rowKeys.includes(k));
    const ok = orphans.length === 0 && missing.length === 0 && duplicates.length === 0 && rowKeys.length === FROZEN_ROUTE_KEYS.size;
    record(
      'C9-3',
      `read ${path.relative(repoRoot, matrixPath)}`,
      'exactly one row per frozen route, no orphans, no gaps, no duplicates',
      ok,
      `rows=${matrixRows.length} frozen=${FROZEN_ROUTE_KEYS.size}\nmissing: ${missing.join(', ') || 'none'}\norphans: ${orphans.join(', ') || 'none'}\nduplicates: ${duplicates.join(', ') || 'none'}`,
    );
  });

  // DECISIONS.md@baseCommit, parsed once for both C9-4 and C9-6 (unchanged mechanism from round 2).
  interface DecisionEntry {
    id: string;
    route: string;
    acceptedRisk: string;
    accepter: string;
    date: string;
    rationale: string;
  }
  function parseDecisionEntries(text: string): { entries: Map<string, DecisionEntry>; duplicateIds: Set<string> } {
    const headingRe = /^###\s+(W9-ACCEPT-[A-Za-z0-9-]+)\s*$/gm;
    const matches = [...text.matchAll(headingRe)];
    const idCounts = new Map<string, number>();
    for (const m of matches) idCounts.set(m[1]!, (idCounts.get(m[1]!) ?? 0) + 1);
    const duplicateIds = new Set([...idCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id));
    const entries = new Map<string, DecisionEntry>();
    for (const m of matches) {
      const id = m[1]!;
      if (duplicateIds.has(id)) continue;
      const start = m.index! + m[0].length;
      const rest = text.slice(start);
      const nextHeadingRel = rest.search(/^#{2,3}\s+/m);
      const blockText = nextHeadingRel === -1 ? rest : rest.slice(0, nextHeadingRel);
      const routeM = /^-\s*Route:\s*`([^`]+)`\s*$/im.exec(blockText);
      const riskM = /^-\s*Accepted risk:\s*(.+)$/im.exec(blockText);
      const accepterM = /^-\s*Accepter:\s*(.+)$/im.exec(blockText);
      const dateM = /^-\s*Date:\s*(\d{4}-\d{2}-\d{2})/im.exec(blockText);
      const rationaleM = /^-\s*Rationale:\s*(.+)$/im.exec(blockText);
      if (routeM && riskM && accepterM && dateM && rationaleM) {
        entries.set(id, {
          id,
          route: routeM[1]!.trim(),
          acceptedRisk: riskM[1]!.trim(),
          accepter: accepterM[1]!.trim(),
          date: dateM[1]!,
          rationale: rationaleM[1]!.trim(),
        });
      }
    }
    return { entries, duplicateIds };
  }
  let decisionsAtBase = '';
  let decisionsAtBaseError = '';
  try {
    decisionsAtBase = readFileAtCommit(baseCommit, 'docs/plans/waves/DECISIONS.md');
  } catch (err) {
    decisionsAtBaseError = String(err);
  }
  const { entries: decisionEntries, duplicateIds: decisionDuplicateIds } = decisionsAtBaseError
    ? { entries: new Map<string, DecisionEntry>(), duplicateIds: new Set<string>() }
    : parseDecisionEntries(decisionsAtBase);
  const implAuthorsFullRange = commitAuthorsBetween(baseCommit, headSha);

  function checkAcceptedRisk(ref: string, routeKey: string): string[] {
    const problems: string[] = [];
    if (!ref) {
      problems.push(`acceptedRisk.decisionRef missing/empty`);
      return problems;
    }
    if (decisionsAtBaseError) {
      problems.push(`could not read DECISIONS.md at baseCommit: ${decisionsAtBaseError}`);
      return problems;
    }
    if (decisionDuplicateIds.has(ref)) {
      problems.push(`decisionRef "${ref}" is ambiguous -- appears more than once as a "### W9-ACCEPT-*" heading in DECISIONS.md@baseCommit`);
      return problems;
    }
    const entry = decisionEntries.get(ref);
    if (!entry) {
      problems.push(`decisionRef "${ref}" is not a valid, fully-structured "### W9-ACCEPT-*" entry (Route/Accepted risk/Accepter/Date/Rationale) in DECISIONS.md@baseCommit`);
      return problems;
    }
    if (entry.route !== routeKey) {
      problems.push(`decisionRef "${ref}" is bound to Route "${entry.route}", not this row's route "${routeKey}"`);
    }
    if (implAuthorsFullRange.has(entry.accepter.trim().toLowerCase())) {
      problems.push(`decisionRef "${ref}"'s Accepter ("${entry.accepter}") matches a commit author in baseCommit..HEAD -- cannot self-accept its own risk`);
    }
    return problems;
  }

  // C9-4: full attribution per S6.
  await checkCriterion('C9-4', () => {
    if (!matrixRows) {
      record('C9-4', '', 'every row carries all six structured fields; exposure===3 rows carry control XOR a structured DECISIONS.md-at-baseCommit acceptedRisk reference', false, '', {
        detail: 'no matrix to check',
      });
      return;
    }
    const problems: string[] = [];
    let attributed = 0;
    let unattributed = 0;
    let knownVulnerable = 0;
    for (const row of matrixRows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      const mechanicalExposure = headExposureByKey.get(key);
      let fieldsOk = true;
      for (const field of ['owner', 'authz', 'inputValidation', 'sizeRateLimit'] as const) {
        if (isPlaceholderText(row[field])) {
          problems.push(`${key}: "${field}" is empty, too short, or a recognized placeholder`);
          fieldsOk = false;
        }
      }
      if (isPlaceholderText(row.testRef)) {
        problems.push(`${key}: "testRef" is empty, too short, or a recognized placeholder`);
        fieldsOk = false;
      }
      if (isPlaceholderText(row.authn)) {
        problems.push(`${key}: "authn" is empty, too short, or a recognized placeholder`);
        fieldsOk = false;
      } else if (mechanicalExposure !== undefined) {
        const expectedKeyword = AUTHN_KEYWORD_BY_EXPOSURE[mechanicalExposure];
        if (expectedKeyword && !expectedKeyword.test(String(row.authn))) {
          problems.push(`${key}: "authn" does not name the mechanically-derived exposure-${mechanicalExposure} mechanism (expected to match ${expectedKeyword})`);
          fieldsOk = false;
        }
      }
      const noGateMechanically = mechanicalExposure === 3;
      const hasControl = row.control != null;
      const hasAcceptedRisk = row.acceptedRisk != null;
      if (noGateMechanically) {
        if (hasControl === hasAcceptedRisk) {
          problems.push(`${key}: exposure===3 requires exactly one of control/acceptedRisk (control=${hasControl}, acceptedRisk=${hasAcceptedRisk})`);
        } else if (hasAcceptedRisk) {
          const ar = row.acceptedRisk as { decisionRef?: unknown };
          const ref = typeof ar.decisionRef === 'string' ? ar.decisionRef.trim() : '';
          const arProblems = checkAcceptedRisk(ref, key);
          if (arProblems.length > 0) problems.push(...arProblems.map((p) => `${key}: ${p}`));
          else knownVulnerable += 1;
        } else if (hasControl) {
          attributed += 1; // control validity itself is checked by C9-5/C9-6
        }
        if (!hasControl && !hasAcceptedRisk) unattributed += 1;
      } else {
        attributed += 1;
      }
      if (!fieldsOk) problems.push(`${key}: incomplete/placeholder required fields`);
    }
    const ok = problems.length === 0;
    record(
      'C9-4',
      'placeholder-floor + authn-keyword-vs-exposure check per field; acceptedRisk resolved via a unique, structured, route-bound, non-self-accepted DECISIONS.md@baseCommit entry',
      'no field may be a bare placeholder; authn must name the real mechanical class; every mechanically-ungated row carries control XOR a verified accepted-risk decision',
      ok,
      `attributed=${attributed} unattributed(no control, no accepted risk)=${unattributed} known-vulnerable(accepted risk on file)=${knownVulnerable} total=${matrixRows.length}\n${problems.join('\n') || 'all rows fully attributed'}`,
    );
  });

  // CEREMONY ITEM 4: one global fullName->routeKey map over every
  // row.testRef AND row.control.testRef, built once and shared by C9-5
  // (cross-route reuse fails it) and C9-7 (bullet association).
  const globalCitationMap = new Map<string, Set<string>>();
  if (matrixRows) {
    for (const row of matrixRows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      if (typeof row.testRef === 'string' && row.testRef.trim()) {
        const ref = row.testRef.trim();
        if (!globalCitationMap.has(ref)) globalCitationMap.set(ref, new Set());
        globalCitationMap.get(ref)!.add(key);
      }
      if (row.control && typeof row.control.testRef === 'string' && row.control.testRef.trim()) {
        const ref = row.control.testRef.trim();
        if (!globalCitationMap.has(ref)) globalCitationMap.set(ref, new Set());
        globalCitationMap.get(ref)!.add(key);
      }
    }
  }

  // CEREMONY ITEM 2+3: full testRef validation -- exact match, route
  // association, GLOBAL cross-route-reuse (item 4), historical-title
  // determination (item 3), and replayed red evidence for new tests
  // (item 2). Every control reference gets the identical checks.
  const redDir = path.join(repoRoot, 'docs/security/library-ingest-red');
  function checkTestRef(ref: string, routeKey: string, opts: { isControl?: boolean } = {}): string[] {
    const problems: string[] = [];
    if (!passedTestNames.has(ref)) {
      problems.push(`testRef does not exactly match any PASSED test fullName this run: "${ref}"`);
      return problems;
    }
    const associatedRoutes = globalCitationMap.get(ref);
    if (!associatedRoutes || associatedRoutes.size !== 1 || !associatedRoutes.has(routeKey)) {
      problems.push(`testRef "${ref}" is cited by ${associatedRoutes?.size ?? 0} route(s) globally (must be exactly 1: this row's own route)`);
    }
    const terms = routeAssociationTerms(routeKey);
    const refLower = ref.toLowerCase();
    if (terms.length > 0 && !terms.some((t) => refLower.includes(t.toLowerCase()))) {
      problems.push(`testRef "${ref}" is not associated with route ${routeKey} by any path-derived term (${terms.join(', ')})`);
    }
    const assertion = findAssertion(ref);
    if (!assertion) {
      problems.push(`testRef matched a passed test but its containing file/title could not be resolved: "${ref}"`);
      return problems;
    }
    if (opts.isControl) {
      // Settled S9-3 requirement, unchanged by the ceremony: the SAME file
      // as the control's cited test must contain a genuine paired
      // positive+negative signal among its own passing assertions -- proof
      // that the mechanism accepts a right caller and rejects a wrong one,
      // not just a raw assertion count. CEREMONY CONFIRMATION FIX
      // (regression): this must be TWO DISTINCT assertions -- one passing
      // assertion whose name happens to match both regexes no longer
      // satisfies the pair on its own.
      const fileResult = (suiteRun.data?.testResults ?? []).find(
        (t) => path.relative(path.join(repoRoot, 'apps/daemon'), t.name) === assertion.rel,
      );
      const passedInFile = fileResult ? fileResult.assertionResults.filter((a) => a.status === 'passed') : [];
      const pairedOk = hasDistinctSignalPair(passedInFile, (n) => POSITIVE_SIGNAL.test(n), (n) => NEGATIVE_SIGNAL.test(n));
      if (!pairedOk) {
        problems.push(
          `control.testRef "${ref}": ${assertion.rel} must contain a genuine paired positive+negative control -- two DISTINCT passing assertions, one reading positive, one reading negative`,
        );
      }
    }
    const isNew = !titleExistedAtBaseCommit(assertion.rel, assertion.title);
    if (isNew) {
      const artifactPath = path.join(redDir, `${slugify(ref)}.txt`);
      if (!fs.existsSync(artifactPath)) {
        problems.push(`new test (title "${assertion.title}" not statically present at baseCommit in ${assertion.rel}) cited by testRef "${ref}" has no red-evidence artifact at docs/security/library-ingest-red/${slugify(ref)}.txt`);
        return problems;
      }
      const content = fs.readFileSync(artifactPath, 'utf8');
      const parsed = parseRedTranscript(content);
      if (!parsed.parentSha || !/^[0-9a-f]{40}$/i.test(parsed.parentSha)) {
        problems.push(`red evidence for "${ref}": PARENT_SHA missing or not a full 40-hex commit`);
        return problems;
      }
      if (!resolveCommit(parsed.parentSha)) {
        problems.push(`red evidence for "${ref}": PARENT_SHA "${parsed.parentSha}" does not resolve to a real commit`);
        return problems;
      }
      if (parsed.parentSha === headSha || !isAncestor(baseCommit, parsed.parentSha) || !isAncestor(parsed.parentSha, headSha)) {
        problems.push(`red evidence for "${ref}": PARENT_SHA must satisfy baseCommit <= PARENT_SHA < HEAD and differ from HEAD`);
        return problems;
      }
      if (!parsed.test || parsed.test !== ref) {
        problems.push(`red evidence for "${ref}": TEST field ("${parsed.test ?? ''}") does not exactly match this testRef`);
        return problems;
      }
      if (!parsed.controlTest) {
        problems.push(`red evidence for "${ref}": CONTROL_TEST field missing`);
        return problems;
      }
      const introduction = findIntroductionCommit(`apps/daemon/${assertion.rel}`, assertion.title);
      if (!introduction) {
        problems.push(`red evidence for "${ref}": could not independently determine the introduction commit for title "${assertion.title}" in baseCommit..HEAD`);
        return problems;
      }
      if (introduction.parentOfIntroduction !== parsed.parentSha) {
        problems.push(`red evidence for "${ref}": PARENT_SHA "${parsed.parentSha}" does not equal the introduction commit's first parent "${introduction.parentOfIntroduction}" (introduced at ${introduction.introducedAt})`);
        return problems;
      }
      // Checked-in COMMAND/output are descriptive only -- never executed,
      // never trusted. The verifier constructs its own argv and replays.
      const replay = replayRedEvidence(parsed.parentSha, assertion.rel, ref, parsed.controlTest);
      if (!replay.ok) {
        problems.push(`red-evidence replay failed for "${ref}": ${replay.problems.join('; ')}`);
      }
      replayEvidenceLog.push(`--- replay for "${ref}" ---\n${replay.evidenceLines.join('\n')}\n${replay.ok ? 'REPLAY OK' : `REPLAY FAILED: ${replay.problems.join('; ')}`}`);
    }
    return problems;
  }
  const replayEvidenceLog: string[] = [];

  await checkCriterion('C9-5', () => {
    if (!matrixRows) {
      record('C9-5', '', 'every testRef exactly matches a passed, route-associated, globally-unique-per-route test; new tests carry independently-replayed red evidence', false, '', {
        detail: 'no matrix to check',
      });
      return;
    }
    const problems: string[] = [];
    for (const [ref, routes] of globalCitationMap) {
      if (routes.size > 1) problems.push(`testRef "${ref}" is cited by ${routes.size} different routes (must be exactly 1): ${[...routes].join(', ')}`);
    }
    let citedCount = 0;
    for (const row of matrixRows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      if (typeof row.testRef === 'string' && row.testRef.trim()) {
        citedCount += 1;
        problems.push(...checkTestRef(row.testRef.trim(), key).map((p) => `${key} testRef: ${p}`));
      }
      if (row.control && typeof row.control.testRef === 'string' && row.control.testRef.trim()) {
        citedCount += 1;
        problems.push(...checkTestRef(row.control.testRef.trim(), key, { isControl: true }).map((p) => `${key} control.testRef: ${p}`));
      }
    }
    record(
      'C9-5',
      'exact fullName + global cross-route-uniqueness + route-association-term match; new-file testRefs independently replayed (isolated detached worktree at the AST-verified introduction parent, frozen offline install, HEAD test file overlay, vitest JSON reporter)',
      'every cited testRef exactly matches a real PASSED, uniquely-route-associated test; new controls pass an independent red-state replay proving the exact test failed and a named CONTROL_TEST passed at PARENT_SHA',
      problems.length === 0 && citedCount > 0,
      `citations checked=${citedCount}\n${problems.join('\n') || 'all citations matched and validated'}\n\n${replayEvidenceLog.join('\n\n') || '(no new-test replays triggered this run)'}`,
    );
  });

  // C9-6: every P0-tier row's sizeRateLimit resolved via the anchored
  // ENFORCED grammar + full C9-5-grade control.testRef validation + a
  // real-transport under/over-limit pairing in the same file, or a
  // verified acceptedRisk.
  await checkCriterion('C9-6', () => {
    if (!matrixRows) {
      record('C9-6', '', 'every P0-tier row resolves sizeRateLimit with a grammar-valid ENFORCED declaration, a fully-validated control.testRef, and real-transport under/over-limit coverage, or a verified acceptedRisk', false, '', {
        detail: 'no matrix to check',
      });
      return;
    }
    const problems: string[] = [];
    let p0Count = 0;
    for (const row of matrixRows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      if (row.riskScore?.tier !== 'P0') continue;
      p0Count += 1;
      const hasControl = row.control != null;
      const hasAcceptedRisk = row.acceptedRisk != null;
      if (hasControl === hasAcceptedRisk) {
        problems.push(`${key} (P0): sizeRateLimit must resolve with exactly one of control/acceptedRisk (control=${hasControl}, acceptedRisk=${hasAcceptedRisk})`);
        continue;
      }
      if (hasControl) {
        const c = row.control as { mechanism?: unknown; testRef?: unknown };
        const mechanism = typeof c.mechanism === 'string' ? c.mechanism : '';
        const parsed = parseEnforcedDeclaration(mechanism);
        if (!parsed) {
          problems.push(`${key} (P0): control.mechanism "${mechanism}" does not match the required grammar "ENFORCED kind=... scope=... limit=... windowMs=... overflow=..."`);
          continue; // no parsed limit/overflow to bind transport coverage to
        }
        const ref = typeof c.testRef === 'string' ? c.testRef.trim() : '';
        if (!ref) {
          problems.push(`${key} (P0): control.testRef missing`);
          continue;
        }
        const testProblems = checkTestRef(ref, key, { isControl: true });
        if (testProblems.length > 0) {
          problems.push(`${key} (P0) control.testRef: ${testProblems.join('; ')}`);
          continue;
        }
        // CEREMONY CONFIRMATION FIX: real-transport coverage now binds the
        // under/over-limit assertions to THIS route (path-derived terms),
        // the parsed declaration's own numeric limit, and -- for the
        // over-limit side -- the declared overflow status code, and
        // requires two DISTINCT passing assertions (an unrelated or
        // omnibus assertion name can no longer satisfy both sides at once).
        const assertion = findAssertion(ref);
        const fileResult = assertion ? (suiteRun.data?.testResults ?? []).find((t) => path.relative(path.join(repoRoot, 'apps/daemon'), t.name) === assertion.rel) : undefined;
        const passedInFile = fileResult ? fileResult.assertionResults.filter((a) => a.status === 'passed') : [];
        const routeTerms = routeAssociationTerms(key);
        const coverageOk = hasDistinctSignalPair(
          passedInFile,
          (n) => matchesUnderLimitAssertion(n, routeTerms, parsed),
          (n) => matchesOverLimitAssertion(n, routeTerms, parsed),
        );
        if (!coverageOk) {
          problems.push(
            `${key} (P0): real-transport coverage in ${assertion?.rel ?? '(unresolved file)'} must show two DISTINCT passing assertions -- one under-limit-accepted, one over-limit-rejected -- each associated with this route, naming limit=${parsed.limit} (the over-limit one also naming the declared overflow status ${parsed.overflow === 'reject-429' ? '429' : '413'})`,
          );
        }
      } else if (hasAcceptedRisk) {
        const ar = row.acceptedRisk as { decisionRef?: unknown };
        const ref = typeof ar.decisionRef === 'string' ? ar.decisionRef.trim() : '';
        const arProblems = checkAcceptedRisk(ref, key);
        if (arProblems.length > 0) problems.push(...arProblems.map((p) => `${key} (P0): ${p}`));
      }
    }
    record(
      'C9-6',
      "every row with riskScore.tier === 'P0': control.mechanism matches the anchored ENFORCED grammar, control.testRef passes full C9-5 validation (incl. replay), and real-transport under/over-limit coverage exists in the same file -- or a verified acceptedRisk",
      'a bare keyword match ("no rate limit exists") no longer passes; mechanism text is descriptive only, enforcement is proven by the associated test',
      problems.length === 0 && p0Count > 0,
      `P0 rows found: ${p0Count}\n${problems.join('\n') || 'all P0 rows resolved'}`,
    );
  });

  // C9-7: threat-model doc extended. CEREMONY ITEM 4: each P0 route's own
  // bullet must name EXACTLY one P0 route key and cite EXACTLY that row's
  // expected reference (control.testRef for a controlled row, primary
  // testRef for an accepted-risk row), already globally associated with
  // that same route.
  await checkCriterion('C9-7', () => {
    const threatModelPath = path.join(repoRoot, 'docs/security/daemon-threat-model.md');
    if (!fs.existsSync(threatModelPath)) {
      record('C9-7', '', 'daemon-threat-model.md carries a bounded Wave 9 section; each P0 route has its own bullet naming exactly that route and citing its exact expected reference', false, '', {
        detail: 'daemon-threat-model.md does not exist',
      });
      return;
    }
    const text = fs.readFileSync(threatModelPath, 'utf8');
    const afterHeading = text.split(/^##\s+Wave 9\b.*$/m)[1];
    const waveSection = afterHeading?.split(/\n##\s+/)[0];
    if (!waveSection) {
      record('C9-7', `read ${path.relative(repoRoot, threatModelPath)}`, 'a bounded "## Wave 9" section exists (up to the next "## " heading)', false, text.slice(0, 500), {
        detail: 'no "## Wave 9" heading found',
      });
      return;
    }
    // CEREMONY CONFIRMATION FIX: a line must actually BE a Markdown list
    // item (unordered `-`/`*`/`+` or ordered `1.`), not merely contain the
    // `[C9-N]` tag anywhere -- a plain paragraph mentioning a tag no longer
    // satisfies the ruled per-route "bullet line" requirement. Round 3
    // (confirmation #3): a line-regex match alone still accepted a bullet-
    // looking line sitting inside a fenced code block or a 4+-space-indented
    // code block -- neither is a rendered Markdown list item. Fence state is
    // tracked while scanning; the fence delimiter lines themselves and any
    // line between them are excluded, as is any line with 4+ leading spaces.
    const MARKDOWN_BULLET_LINE = /^\s*(?:[-*+]|\d+\.)\s+/;
    const FENCE_LINE = /^\s*```/;
    const INDENTED_CODE_LINE = /^ {4,}/;
    const bulletLines: string[] = [];
    let insideFence = false;
    for (const line of waveSection.split('\n')) {
      if (FENCE_LINE.test(line)) {
        insideFence = !insideFence;
        continue; // the fence delimiter line itself is never a bullet
      }
      if (insideFence) continue;
      if (INDENTED_CODE_LINE.test(line)) continue;
      if (MARKDOWN_BULLET_LINE.test(line) && /\[C9-\d+\]/.test(line)) bulletLines.push(line);
    }
    const problems: string[] = [];
    const p0Rows = matrixRows ? matrixRows.filter((r) => r.riskScore?.tier === 'P0') : [];
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
      const p0KeysInLine = p0Rows.map((r) => `${String(r.method)} ${String(r.path)}`).filter((k) => lineLower.includes(k.toLowerCase()));
      if (p0KeysInLine.length === 0) continue; // not a P0-covering bullet -- fine
      if (p0KeysInLine.length > 1) {
        problems.push(`bullet names ${p0KeysInLine.length} P0 route keys in one line (must be exactly one): ${line.slice(0, 160)}`);
        continue;
      }
      const routeKey = p0KeysInLine[0]!;
      const row = p0Rows.find((r) => `${String(r.method)} ${String(r.path)}` === routeKey)!;
      const hasControl = row.control != null;
      const expectedRef = hasControl
        ? typeof row.control?.testRef === 'string'
          ? row.control.testRef.trim()
          : ''
        : typeof row.testRef === 'string'
          ? row.testRef.trim()
          : '';
      if (cited !== expectedRef) {
        problems.push(`bullet for ${routeKey} cites "${cited}", expected exactly "${expectedRef}" (this row's ${hasControl ? 'control.testRef' : 'primary testRef'})`);
        continue;
      }
      const associatedRoutes = globalCitationMap.get(cited);
      if (!associatedRoutes || associatedRoutes.size !== 1 || !associatedRoutes.has(routeKey)) {
        problems.push(`bullet for ${routeKey} cites "${cited}", which is not globally associated with exactly this route`);
        continue;
      }
      bulletsCoveringP0.add(routeKey);
    }
    const p0Keys = p0Rows.map((r) => `${String(r.method)} ${String(r.path)}`);
    const uncoveredP0 = p0Keys.filter((k) => !bulletsCoveringP0.has(k));
    const ok = bulletLines.length > 0 && problems.length === 0 && uncoveredP0.length === 0;
    record(
      'C9-7',
      `read ${path.relative(repoRoot, threatModelPath)}, section bounded to the next "## " heading, one-P0-key-per-bullet + exact-expected-citation check`,
      'every P0 route has its own bullet naming exactly that route and citing exactly its expected reference, already globally associated with only that route',
      ok,
      `[C9-N] bullets found: ${bulletLines.length}\nP0 routes: ${p0Keys.join(', ') || 'none'}\nuncovered P0 routes: ${uncoveredP0.join(', ') || 'none'}\n${problems.join('\n') || 'all citations matched'}`,
    );
  });

  // C9-8: full risk-score formula enforcement, gated on the same
  // exposure-classifier self-probes as C9-1.
  await checkCriterion('C9-8', () => {
    if (selfProbeFailures.length > 0) {
      record(
        'C9-8',
        'exposure-classifier self-probes (shared with C9-1)',
        'every self-probe fixture classifies at its expected exposure',
        false,
        selfProbeResults.map((p) => `[${p.ok ? 'PASS' : 'FAIL'}] ${p.name}: ${p.detail}`).join('\n'),
        { detail: `${selfProbeFailures.length}/${selfProbeResults.length} self-probes failed -- exposure classifier is not trustworthy this run` },
      );
      return;
    }
    if (!matrixRows) {
      record('C9-8', '', 'exposure/impact/score/tier all mechanically enforced per row', false, '', { detail: 'no matrix to check' });
      return;
    }
    if (!headCollect) {
      record('C9-8', '', 'exposure/impact/score/tier all mechanically enforced per row', false, '', {
        detail: `could not derive HEAD route set: ${headError}`,
      });
      return;
    }
    if (headCollect.duplicates.length > 0) {
      record('C9-8', '', 'exposure/impact/score/tier all mechanically enforced per row', false, `duplicate registrations at HEAD: ${headCollect.duplicates.join(', ')}`, {
        detail: 'refusing to classify while duplicate route registrations exist -- see C9-1',
      });
      return;
    }
    const problems: string[] = [];
    for (const row of matrixRows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      const derivedExposure = headExposureByKey.get(key);
      const floor = FROZEN_IMPACT_FLOORS[key];
      const claimedExposure = row.riskScore?.exposure;
      const claimedImpact = row.riskScore?.impact;
      const claimedScore = row.riskScore?.score;
      const claimedTier = row.riskScore?.tier;
      if (derivedExposure === undefined) {
        problems.push(`${key}: no matching AST registration at HEAD`);
        continue;
      }
      if (floor === undefined) {
        problems.push(`${key}: not a frozen route (no impact floor defined)`);
        continue;
      }
      if (typeof claimedExposure !== 'number' || claimedExposure !== derivedExposure) {
        problems.push(`${key}: riskScore.exposure claims ${JSON.stringify(claimedExposure)}, AST derives ${derivedExposure}`);
      }
      if (typeof claimedImpact !== 'number' || claimedImpact < 0 || claimedImpact > 3 || !Number.isInteger(claimedImpact)) {
        problems.push(`${key}: riskScore.impact must be an integer 0-3, got ${JSON.stringify(claimedImpact)}`);
      } else if (claimedImpact < floor) {
        problems.push(`${key}: riskScore.impact (${claimedImpact}) is below the frozen floor (${floor})`);
      }
      if (typeof claimedExposure === 'number' && typeof claimedImpact === 'number') {
        const expectedScore = claimedExposure + claimedImpact;
        if (claimedScore !== expectedScore) {
          problems.push(`${key}: riskScore.score claims ${JSON.stringify(claimedScore)}, expected exposure+impact=${expectedScore}`);
        } else if (claimedTier !== tierFor(expectedScore)) {
          problems.push(`${key}: riskScore.tier claims ${JSON.stringify(claimedTier)}, expected ${tierFor(expectedScore)} for score=${expectedScore}`);
        }
      }
    }
    record(
      'C9-8',
      'AST scan of registerLibraryRoutes at HEAD (straight-line dominance grammar, self-probe-verified) cross-checked against FROZEN_IMPACT_FLOORS',
      'every row: exposure exact match, impact >= frozen floor, score === exposure+impact, tier === tierFor(score)',
      problems.length === 0,
      `self-probes: ${selfProbeResults.length}/${selfProbeResults.length} pass\n${problems.join('\n') || `all ${matrixRows.length} rows' exposure/impact/score/tier independently confirmed`}`,
    );
  });

  // C9-9: gates.
  await checkCriterion('C9-9', () => {
    const guard = sh('pnpm', ['guard']);
    const typecheck = sh('pnpm', ['typecheck']);
    const ok = guard.status === 0 && typecheck.status === 0;
    record(
      'C9-9',
      'pnpm guard && pnpm typecheck',
      'both exit 0 on the current tree',
      ok,
      `guard exit=${guard.status}\ntypecheck exit=${typecheck.status}\n\nguard tail:\n${guard.stdout.slice(-3000)}\n\ntypecheck tail:\n${typecheck.stdout.slice(-3000)}`,
    );
  });

  // C9-10: commit-bound adversarial implementation review (unchanged from
  // round 2's reviewedCommit redesign -- not part of this ceremony's six
  // ruled items; r3 confirmed the redesign FIXED).
  await checkCriterion('C9-10', () => {
    const reviewPath = path.join(repoRoot, 'docs/security/library-ingest-implementation-review.json');
    if (!fs.existsSync(reviewPath)) {
      record(
        'C9-10',
        `read ${path.relative(repoRoot, reviewPath)}`,
        'reviewedCommit is a real, strict ancestor of HEAD whose owned-path diff to HEAD is empty; reviewer distinct from every baseCommit..reviewedCommit author; verdict is APPROVE',
        false,
        '',
        { detail: 'no implementation review record on disk' },
      );
      return;
    }
    let review: { reviewer?: unknown; model?: unknown; reviewedCommit?: unknown; verdict?: unknown };
    try {
      review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
    } catch (err) {
      record('C9-10', '', 'review record parses as JSON', false, '', { detail: `parse failed: ${String(err)}` });
      return;
    }
    const problems: string[] = [];
    const reviewer = typeof review.reviewer === 'string' ? review.reviewer.trim() : '';
    const reviewedCommit = typeof review.reviewedCommit === 'string' ? review.reviewedCommit.trim() : '';
    if (!reviewer) problems.push('reviewer field missing/empty');
    if (typeof review.model !== 'string' || !review.model.trim()) problems.push('model field missing/empty');
    if (review.verdict !== 'APPROVE') problems.push(`verdict is "${String(review.verdict)}", not APPROVE`);
    if (!reviewedCommit || !/^[0-9a-f]{7,40}$/i.test(reviewedCommit)) {
      problems.push('reviewedCommit missing or not a plausible git SHA');
    } else if (!resolveCommit(reviewedCommit)) {
      problems.push(`reviewedCommit "${reviewedCommit}" does not resolve to a real commit`);
    } else if (reviewedCommit === headSha) {
      problems.push('reviewedCommit equals HEAD exactly -- a commit cannot review itself; reviewedCommit must be a STRICT ancestor of HEAD');
    } else if (!isAncestor(reviewedCommit, headSha)) {
      problems.push(`reviewedCommit "${reviewedCommit}" is not an ancestor of HEAD (${headSha})`);
    } else {
      const coveragePaths = [
        'apps/daemon/src/routes/library.ts',
        'apps/daemon/src/library-store.ts',
        'apps/daemon/tests/library-*.test.ts',
        'docs/security/library-ingest-attribution.json',
        'docs/security/daemon-threat-model.md',
      ];
      const diffResult = sh('git', ['diff', '--name-only', reviewedCommit, headSha, '--', ...coveragePaths]);
      if (diffResult.status !== 0) {
        problems.push(`git diff reviewedCommit..HEAD over coverage paths failed (exit=${diffResult.status})`);
      } else {
        const changedSinceReview = diffResult.stdout.trim().split('\n').filter(Boolean);
        if (changedSinceReview.length > 0) {
          problems.push(`implementation/evidence changed AFTER reviewedCommit -- review is stale for: ${changedSinceReview.join(', ')}`);
        }
      }
      if (reviewer) {
        const reviewedRangeAuthors = commitAuthorsBetween(baseCommit, reviewedCommit);
        if (reviewedRangeAuthors.has(reviewer.toLowerCase())) {
          problems.push(`reviewer ("${reviewer}") matches an author of a commit in baseCommit..reviewedCommit -- not distinguishable from the implementation`);
        }
      }
    }
    record(
      'C9-10',
      `read ${path.relative(repoRoot, reviewPath)}; reviewedCommit resolvability/ancestry + owned-path coverage-diff + author-distinctness checks`,
      'reviewedCommit is a real, strict ancestor of HEAD whose owned-path diff to HEAD is empty; reviewer distinct from every baseCommit..reviewedCommit author; verdict is APPROVE',
      problems.length === 0,
      problems.join('\n') || `reviewer=${reviewer} model=${String(review.model)} reviewedCommit=${reviewedCommit} verdict=${String(review.verdict)}`,
    );
  });

  // =======================================================================
  // GATE-INTEGRITY / LEASE / HEAD-DRIFT
  // =======================================================================
  await checkCriterion('GATE-INTEGRITY', () => {
    const selfPath = process.argv[1] ? path.resolve(process.argv[1]) : path.join(repoRoot, 'scripts/waves/verify-w9-ingest.ts');
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
      record(
        'GATE-INTEGRITY',
        '',
        'defense-in-depth self-hash check',
        true,
        `sha256: ${selfSha256}\nUNPINNED -- no approved-gate.sha256 present. Floor table and route collector are NOT tamper-protected by this check until the orchestrator pins one post-approval; see manifest.gateIntegrityPinned=false.`,
      );
      return;
    }
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === selfSha256;
    record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', gateOk, `sha256: ${selfSha256}\napproved: ${approved}\nPINNED`, {
      detail: gateOk ? undefined : 'verify-w9-ingest.ts modified since orchestrator approval',
    });
  });

  function globToRegExp(glob: string): RegExp {
    let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    re = re.replace(/\*\*/g, ' GLOBSTAR ');
    re = re.replace(/\*/g, '[^/]*');
    re = re.replace(/ GLOBSTAR /g, '.*');
    return new RegExp(`^${re}$`);
  }
  await checkCriterion('LEASE', () => {
    let leasesRaw: { waves: Record<string, { allow: string[]; deny?: string[] }> };
    try {
      const leasesText = readFileAtCommit(baseCommit, 'docs/plans/waves/leases.json');
      leasesRaw = JSON.parse(leasesText) as typeof leasesRaw;
    } catch (err) {
      record('LEASE', `git show ${baseCommit}:docs/plans/waves/leases.json`, 'no writes outside the W9-ingest lease, read from baseCommit', false, '', {
        detail: `could not read/parse leases.json at baseCommit: ${String(err)}`,
      });
      return;
    }
    const lease = leasesRaw.waves['W9-ingest'];
    if (!lease) {
      record('LEASE', '', '', false, '', { detail: 'no "W9-ingest" entry in leases.json@baseCommit' });
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
      `git diff --name-only ${baseCommit}...HEAD subset-of leases.json[W9-ingest] read via git show ${baseCommit}:docs/plans/waves/leases.json`,
      'no writes outside the W9-ingest lease, read from baseCommit so the wave cannot widen its own lease',
      violations.length === 0,
      violations.join('\n') ||
        (diffNames.length === 0
          ? 'no diff between baseCommit and HEAD'
          : `all ${diffNames.length} changed files inside the lease`),
      {
        detail:
          violations.length === 0
            ? undefined
            : "see W9-ingest-tranche.md AUTHOR-FLAGGED dispositions, ruling 3: docs/plans/waves/W9-ingest-tranche.md itself is outside leases.json's W9-ingest.allow at THIS branch's baseCommit -- expected to self-resolve once this PRD lands on main and a later implementation branch's baseCommit includes it",
      },
    );
  });

  const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  await checkCriterion('HEAD-DRIFT', () => {
    record('HEAD-DRIFT', 'git rev-parse HEAD (re-resolved at end)', 'HEAD must not move during the run', headShaFinal === headSha, `initial=${headSha} final=${headShaFinal}`, {
      detail: headShaFinal === headSha ? undefined : 'HEAD moved during the run',
    });
  });

  // -----------------------------------------------------------------------
  // Commit-bound manifest. Tamper re-check, then archival (ceremony item
  // 6: construct-then-reread-verify, no post-success correction), then the
  // FINAL canonical write built from the actual archival result.
  // -----------------------------------------------------------------------
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
  console.log(`\nverify-w9-ingest: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty}, wroteOk=true, gateIntegrityPinned=${gateIntegrityPinned}, archiveOk=${archiveResult.ok})`);
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md §2)');
  if (!archiveResult.ok) console.log('  ⚠ per-run archival FAILED (construct-then-reread-verify) -- this fails the run');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  console.log(`RUN_ARCHIVE=${archiveResult.runDir}`);
  process.exit(failures.length === 0 && !treeDirty && manifestWritten && archiveResult.ok ? 0 : 1);
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
