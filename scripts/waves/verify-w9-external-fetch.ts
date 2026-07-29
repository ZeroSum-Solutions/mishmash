// verify-w9-external-fetch.ts -- wave mishmash-w9-external-fetch-tranche
// (External-fetch / SSRF route hardening) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w9-external-fetch.ts [--repo <path>]
// Exit 0 only when every CXF criterion passes, the tree is clean, the initial
// manifest placeholder wrote successfully, archival succeeded (construct +
// reread-verify), and the three named infra checks (GATE-INTEGRITY / LEASE /
// HEAD-DRIFT) pass. The commit-bound proof manifest is written to the wave's
// goal-state proof directory either way -- W6b's own verifier
// (docs/plans/waves/W5-W11-gated.md, Wave 6b) reads that manifest directly
// per docs/plans/waves/W9-external-fetch-tranche.md's "Definition of green";
// it must not re-run this tranche's checks itself.
//
// DESIGN NOTE (read before editing): this verifier deliberately PORTS the
// generic gate machinery (manifest shape, GATE-INTEGRITY/LEASE/HEAD-DRIFT,
// two-phase manifest write, construct-then-reread-verify archival, the
// straight-line-dominance exposure classifier, the AST-derived historical-
// test-title parser, and the detached-worktree red-evidence replay) from the
// canonical house pattern, scripts/waves/verify-w9-ingest.ts, rather than
// re-deriving it -- see docs/plans/waves/VERIFICATION-CONTRACT.md and
// docs/plans/waves/W9-external-fetch-tranche.md ("Ground facts" / "Scope").
// The NEW logic specific to this tranche is the outbound-fetch guard-tier
// classifier (KNOWN_SAFE_WRAPPERS / KNOWN_VALIDATING_GUARDS, per-file fetch
// profile, ROUTE_TARGET_FILES) and the GUARDED declaration grammar.
//
// ROUND 1 (REJECT, 7 blocking findings) fixed every finding in place; see
// docs/plans/waves/W9-external-fetch-tranche.md's "Round 1 dispositions" for
// the finding-by-finding record. The most structurally significant change:
// CXF-6's per-P0-row guard verification now BOOTS A REAL ISOLATED DAEMON and
// issues a live HTTP request that would escape to a loopback canary target
// if unguarded, asserting the canary sees zero connections -- per the
// program-wide binding rule recorded in DECISIONS.md (W9AS-PARK/W10A-PARK/
// W10B-PARK): "a criterion asserting runtime behavior must observe that
// behavior... structural checks are legitimate only for facts with no
// runtime observable." The isolated-daemon-boot and process-tree-confirmed
// teardown machinery below is PORTED from scripts/waves/verify-w10f.ts
// (`bootIsolatedDaemonSubprocess`/`stopIsolatedDaemonSubprocessTree`), the
// proven pattern the same DECISIONS.md record names as sound, using this
// repository's own `@open-design/platform` process-tree primitives rather
// than hand-rolled signal handling.
//
// PORTABILITY: repoRoot comes from `process.cwd()`/`--repo`, never
// `import.meta.url`. Isolation: every daemon/worktree this verifier creates
// is isolated (port 0, fresh mkdtemp data dirs, detached temp worktrees) and
// torn down by its own exact handle, confirmed via a full process-tree walk
// (never a single tracked PID). This verifier never touches a
// default-namespace daemon (ports 7456/51012 are hard-refused by
// assertSafeLoopbackUrl) and never issues a `git fetch`/`git push` -- git
// context is resolved from local refs only.

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type TypeScriptModule from 'typescript';
import type { Node as TsNode } from 'typescript';

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

const WAVE_SLUG = 'mishmash-w9-external-fetch-tranche';

function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W9-external-fetch',
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
      path.join(os.tmpdir(), 'verify-w9-external-fetch-emergency-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  } catch {
    /* truly nothing more we can do */
  }
  console.error(`verify-w9-external-fetch: FATAL during init: ${errorMessage}`);
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
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 10 * 60_000,
    env: opts.env ?? process.env,
  });
  const processError = !!result.error || !!result.signal;
  if (result.error) {
    return {
      status: 1,
      stdout: result.stdout ?? '',
      stderr: `${result.stderr ?? ''}\n${String(result.error)}`,
      processError: true,
    };
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
  const fallbackResult = tryWrite(path.join(os.tmpdir(), 'verify-w9-external-fetch-fallback-proof', `${id}.txt`));
  if (fallbackResult) return fallbackResult;
  console.error(`verify-w9-external-fetch: artifact write failed for ${id} on both primary and fallback paths`);
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
// Git context -- local refs only, no fetch/push.
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
    wave: 'W9-external-fetch',
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
      fs.writeFileSync(
        path.join(os.tmpdir(), 'verify-w9-external-fetch-emergency-manifest.json'),
        JSON.stringify(manifest, null, 2),
      );
    } catch {
      /* last resort: stderr only */
    }
  }
  console.error(`verify-w9-external-fetch: FATAL, emergency manifest written=${wrote}: ${errorMessage}`);
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
    wave: 'W9-external-fetch',
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
      fs.writeFileSync(
        path.join(os.tmpdir(), 'verify-w9-external-fetch-emergency-manifest.json'),
        JSON.stringify(manifest, null, 2),
      );
      console.error(`verify-w9-external-fetch: primary manifest write failed (${String(err)}); wrote fallback`);
    } catch (err2) {
      console.error(`verify-w9-external-fetch: manifest write failed everywhere (${String(err)} / ${String(err2)})`);
    }
    return { written: false, sha256: 'unavailable' };
  }
}

// IMMEDIATE two-phase-write placeholder: overwrites whatever manifest.json a
// PRIOR run left, before any criterion runs. Aborts if this itself fails.
{
  const placeholder = buildManifest(false, true, false);
  const { written } = writeManifestFile(placeholder);
  if (!written) {
    writeEmergencyManifest('could not write the wroteOk:false placeholder before running any criterion');
    process.exit(1);
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
    console.error(`verify-w9-external-fetch: run-archive FAILED (this fails the run): ${String(err)}`);
    return { runDir, ok: false };
  }
}

// =========================================================================
// PORTED exposure classifier (same guard vocabulary as verify-w9-ingest.ts;
// this codebase has one shared set of guard functions, not one per tranche).
// =========================================================================
function isCorsPrelude(stmt: TsNode, handlerParamNames: readonly (string | null)[]): boolean {
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
/** `!calleeName(...)` -- negation of a direct call, e.g. `!isLocalSameOrigin(req, port)`. Round-1 fix (finding 2b): this case did not exist at all -- classifyRouteExposure had no positive grammar for a route whose OWN straight-line prefix is an inline isLocalSameOrigin veto (as opposed to requireLocalDaemonRequest middleware), so real exposure-0 handlers like `POST /api/projects/:id/media/generate` (routes/media.ts:619) were misclassified as exposure 3. */
function isNegationOfCall(expr: TsNode, calleeName: string): boolean {
  return (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.ExclamationToken &&
    ts.isCallExpression(expr.operand) &&
    ts.isIdentifier(expr.operand.expression) &&
    expr.operand.expression.text === calleeName
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
function matchBearerGuard(statements: readonly TsNode[], startIdx: number): boolean {
  const s0 = statements[startIdx];
  if (!s0 || !ts.isVariableStatement(s0)) return false;
  const decl0 = s0.declarationList.declarations[0];
  if (!decl0 || !ts.isIdentifier(decl0.name) || !decl0.initializer || !ts.isCallExpression(decl0.initializer)) return false;
  if (!ts.isIdentifier(decl0.initializer.expression) || decl0.initializer.expression.text !== 'bearerToken') return false;
  const s1 = statements[startIdx + 1];
  if (!s1 || !ts.isVariableStatement(s1)) return false;
  const decl1 = s1.declarationList.declarations[0];
  if (!decl1 || !ts.isIdentifier(decl1.name) || !decl1.initializer || !ts.isCallExpression(decl1.initializer)) return false;
  const calleeName = ts.isIdentifier(decl1.initializer.expression) ? decl1.initializer.expression.text : '';
  if (!/validate.*token/i.test(calleeName)) return false;
  const checkVar = decl1.name.text;
  const s2 = statements[startIdx + 2];
  if (!s2 || !ts.isIfStatement(s2)) return false;
  if (!isFalsyOkPropertyCheck(s2.expression, checkVar)) return false;
  return consequentUnconditionallyExits(s2.thenStatement);
}
function staticBooleanValue(expr: TsNode): boolean | undefined {
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isParenthesizedExpression(expr)) return staticBooleanValue(expr.expression);
  if (ts.isPrefixUnaryExpression(expr) && expr.operator === ts.SyntaxKind.ExclamationToken) {
    const inner = staticBooleanValue(expr.operand);
    return inner === undefined ? undefined : !inner;
  }
  if (ts.isBinaryExpression(expr)) {
    if (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const l = staticBooleanValue(expr.left);
      const r = staticBooleanValue(expr.right);
      if (l === false) return false;
      if (l === true && r !== undefined) return r;
      return undefined;
    }
    if (expr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      const l = staticBooleanValue(expr.left);
      const r = staticBooleanValue(expr.right);
      if (l === true) return true;
      if (l === false && r !== undefined) return r;
      return undefined;
    }
  }
  return undefined;
}
function isLocalSameOriginReachable(root: TsNode): boolean {
  let found = false;
  const walk = (node: TsNode): void => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node)) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'isLocalSameOrigin'
    ) {
      found = true;
      return;
    }
    if (ts.isIfStatement(node)) {
      const staticVal = staticBooleanValue(node.expression);
      if (staticVal !== false) walk(node.thenStatement);
      if (node.elseStatement && staticVal !== true) walk(node.elseStatement);
      return;
    }
    if ((ts.isWhileStatement(node) || ts.isForStatement(node)) && 'expression' in node) {
      const cond = (node as { expression?: TsNode }).expression;
      if (cond && staticBooleanValue(cond) === false) return;
    }
    ts.forEachChild(node, walk);
  };
  walk(root);
  return found;
}
/** `const s0 = if (!isLocalSameOrigin(req, ...)) { <unconditional exit> }` as a DIRECT straight-line prefix statement -- the route's own inline loopback veto, distinct from `requireLocalDaemonRequest` middleware (checked separately, before body inspection) and from the bearer-guard's veto walk (which looks for a REACHABLE, not necessarily straight-line, isLocalSameOrigin as an ALTERNATIVE bypass -- the opposite polarity). Round-1 fix (finding 2b). */
function matchLocalSameOriginGuard(statements: readonly TsNode[], startIdx: number): boolean {
  const s0 = statements[startIdx];
  if (!s0 || !ts.isIfStatement(s0)) return false;
  if (!isNegationOfCall(s0.expression, 'isLocalSameOrigin')) return false;
  return consequentUnconditionallyExits(s0.thenStatement);
}
/** Straight-line prefix check: 0/1/2/3 per S9XF-2. Same semantics as verify-w9-ingest.ts's classifyExposure.
 * ROUND-1 FIX (finding 2b): two real bugs closed here, both confirmed against real handlers by
 * the reviewer, not merely theorized. (1) There was no positive grammar at all for a route whose
 * own straight-line prefix directly vetoes on `isLocalSameOrigin` (as opposed to going through
 * `requireLocalDaemonRequest` middleware) -- `POST /api/projects/:id/media/generate`
 * (routes/media.ts:619) and `POST /api/xai/search` (routes/xai.ts:253) both open with exactly
 * this shape and were misclassified as exposure 3. `matchLocalSameOriginGuard` above closes it.
 * (2) The final fallback literally read `isLocalSameOriginReachable(body) ? 3 : 3` -- both
 * branches returned the same value, so the call was dead code and every route falling through to
 * this line scored exposure 3 unconditionally, right or wrong, with no way for the reachability
 * check to ever change the outcome. Replaced with an unconditional `return 3` (the correct,
 * simplified behavior once matchLocalSameOriginGuard owns the one case that reachability check
 * was trying, incompletely, to catch) -- not a new AST condition layered on top of a gameable
 * check, but the removal of dead, self-contradicting code the previous draft never exercised. */
function classifyRouteExposure(handler: TsNode): number {
  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) return 3;
  const body = handler.body;
  if (!ts.isBlock(body)) return 3;
  const stmts = body.statements;
  const paramNames = handler.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : null));
  let idx = 0;
  if (stmts[0] && isCorsPrelude(stmts[0], paramNames)) idx = 1;
  if (matchToolTokenGuard(stmts, idx)) return 1;
  if (matchLocalSameOriginGuard(stmts, idx)) return 0;
  if (matchBearerGuard(stmts, idx)) {
    return isLocalSameOriginReachable(body) ? 3 : 2;
  }
  return 3;
}
/** `requireLocalDaemonRequest` as a literal middleware argument -> exposure 0, checked before body inspection. */
function hasRequireLocalDaemonRequestMiddleware(args: readonly TsNode[]): boolean {
  return args.some((a) => ts.isIdentifier(a) && a.text === 'requireLocalDaemonRequest');
}

// =========================================================================
// NEW: outbound-fetch guard-tier classification (S9XF-2/S9XF-3/S9XF-4).
// =========================================================================
const KNOWN_SAFE_WRAPPERS = ['fetchExternalBrandAsset', 'safeExternalFetch', 'assertAndFetchExternalAsset'] as const;
const KNOWN_VALIDATING_GUARDS = [
  'assertExternalAssetUrl',
  'validateBaseUrlResolved',
  'validateUserProviderBaseUrl',
  'validateBaseUrl',
  'classifyHost',
  'assertPublicBrandUrl',
  'assertSafePublicUrl',
  // apps/daemon/src/routes/chat.ts defines this as a local closure wrapping
  // validateUserProviderBaseUrl (verified directly, line ~413); every BYOK
  // proxy/connection-test route calls it under its own name, not the wrapped
  // name, so it must be listed explicitly or every call site under it would
  // be misclassified as unguarded.
  'validateExternalApiBaseUrl',
] as const;

/** Collect every bare-identifier CallExpression callee name reachable in a subtree, not crossing into a nested named function/class declaration (arrow/function EXPRESSIONS used as inline callbacks are still walked, since that is the common async/await shape in this codebase). */
function collectReachableCallNames(root: TsNode): Set<string> {
  const names = new Set<string>();
  const walk = (node: TsNode): void => {
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      names.add(node.expression.text);
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(root, walk);
  return names;
}
/** True if `root`'s subtree contains a raw `fetch(...)` call (bare identifier callee, never a property access). */
function containsRawFetchCall(root: TsNode): boolean {
  let found = false;
  const walk = (node: TsNode): void => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
      found = true;
      return;
    }
    ts.forEachChild(node, walk);
  };
  walk(root);
  return found;
}
interface FetchGuardVerdict {
  guardTier: 0 | 1 | 2;
  wrapperName: string | null;
  guardFnName: string | null;
}
/** guard-tier for the enclosing function of a raw fetch call, per S9XF-2. */
function classifyFetchGuard(enclosingFn: TsNode, moduleConstNames: ReadonlySet<string>, urlArgIsModuleConst: boolean): FetchGuardVerdict {
  if (urlArgIsModuleConst) return { guardTier: 0, wrapperName: null, guardFnName: null };
  const called = collectReachableCallNames(enclosingFn);
  for (const wrapper of KNOWN_SAFE_WRAPPERS) {
    if (called.has(wrapper)) return { guardTier: 0, wrapperName: wrapper, guardFnName: null };
  }
  for (const guard of KNOWN_VALIDATING_GUARDS) {
    if (called.has(guard)) return { guardTier: 1, wrapperName: null, guardFnName: guard };
  }
  return { guardTier: 2, wrapperName: null, guardFnName: null };
}
interface FetchSite {
  file: string;
  enclosingFn: string;
  guardTier: 0 | 1 | 2;
  mechanism: string;
}
interface FileFetchProfile {
  file: string;
  rawFetchSites: FetchSite[];
  safeWrapperSites: FetchSite[];
  worstGuardTier: 0 | 1 | 2 | null;
}
/** Find the nearest enclosing named-or-anonymous function-like ancestor and a stable name for it. */
function nearestFunctionAncestor(node: TsNode): { fn: TsNode; name: string } | null {
  let cur: TsNode | undefined = node.parent as TsNode | undefined;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return { fn: cur, name: cur.name.text };
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) return { fn: cur, name: cur.name.text };
    if ((ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) && ts.isVariableDeclaration(cur.parent) && ts.isIdentifier(cur.parent.name)) {
      return { fn: cur, name: cur.parent.name.text };
    }
    if (ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) {
      return { fn: cur, name: '<anonymous>' };
    }
    cur = cur.parent as TsNode | undefined;
  }
  return null;
}
/** Module-scope `const X = '<string literal>'` names, for hardcoded-host detection. */
function collectModuleStringConstNames(sourceFile: TsNode): Set<string> {
  const names = new Set<string>();
  for (const stmt of (sourceFile as unknown as { statements: readonly TsNode[] }).statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    if ((stmt.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.initializer &&
        (ts.isStringLiteral(decl.initializer) || ts.isNoSubstitutionTemplateLiteral(decl.initializer))
      ) {
        names.add(decl.name.text);
      }
    }
  }
  return names;
}
/** Does this fetch call's first argument resolve to a module-scope hardcoded string constant (directly, or as the root identifier of a template-literal/property-access expression)? */
function fetchUrlArgIsModuleConst(callExpr: TsNode, moduleConstNames: ReadonlySet<string>): boolean {
  if (!ts.isCallExpression(callExpr)) return false;
  const arg = callExpr.arguments[0];
  if (!arg) return false;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return true;
  if (ts.isIdentifier(arg)) return moduleConstNames.has(arg.text);
  if (ts.isTemplateExpression(arg)) {
    // `${BASE}/path...` -- root identifier of the first substitution span.
    const firstSpanExpr = arg.templateSpans[0]?.expression;
    if (firstSpanExpr && ts.isIdentifier(firstSpanExpr)) return moduleConstNames.has(firstSpanExpr.text);
    return false;
  }
  if (ts.isBinaryExpression(arg) && ts.isIdentifier(arg.left)) return moduleConstNames.has(arg.left.text);
  return false;
}
function scanFileFetchProfile(sourceText: string, relPath: string, label: string): FileFetchProfile {
  const sourceFile = ts.createSourceFile(label, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const moduleConstNames = collectModuleStringConstNames(sourceFile);
  const rawFetchSites: FetchSite[] = [];
  const safeWrapperSites: FetchSite[] = [];
  const walk = (node: TsNode): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const calleeName = node.expression.text;
      const ancestor = nearestFunctionAncestor(node);
      const fnName = ancestor?.name ?? '<module-scope>';
      const fnNode = ancestor?.fn ?? sourceFile;
      if (calleeName === 'fetch') {
        const isConst = fetchUrlArgIsModuleConst(node, moduleConstNames);
        const verdict = classifyFetchGuard(fnNode, moduleConstNames, isConst);
        rawFetchSites.push({
          file: relPath,
          enclosingFn: fnName,
          guardTier: verdict.guardTier,
          mechanism: verdict.wrapperName ?? verdict.guardFnName ?? (isConst ? 'hardcoded-host' : 'none'),
        });
      } else if ((KNOWN_SAFE_WRAPPERS as readonly string[]).includes(calleeName)) {
        safeWrapperSites.push({ file: relPath, enclosingFn: fnName, guardTier: 0, mechanism: calleeName });
      }
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sourceFile, walk);
  let worstGuardTier: 0 | 1 | 2 | null = null;
  if (rawFetchSites.length > 0) {
    worstGuardTier = rawFetchSites.reduce<0 | 1 | 2>((max, s) => (s.guardTier > max ? s.guardTier : max), 0);
  } else if (safeWrapperSites.length > 0) {
    worstGuardTier = 0;
  }
  return { file: relPath, rawFetchSites, safeWrapperSites, worstGuardTier };
}

// =========================================================================
// Route registration collection, generalized across multiple registration
// functions/files (S9XF-1). Ported concept from verify-w9-ingest.ts's
// collectRouteRegistrations, scoped per named function instead of one.
// =========================================================================
interface RouteRegistration {
  method: string;
  path: string;
  file: string;
  exposure: number;
}
function findFunctionBody(sourceFile: TsNode, fnName: string): TsNode | null {
  let found: TsNode | null = null;
  const walk = (node: TsNode): void => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === fnName && node.body) {
      found = node.body;
      return;
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sourceFile, walk);
  return found;
}
function collectRouteRegistrationsFromFunction(sourceText: string, relPath: string, fnName: string, label: string): RouteRegistration[] {
  const sourceFile = ts.createSourceFile(label, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fnBody = findFunctionBody(sourceFile, fnName);
  if (!fnBody) return [];
  const out: RouteRegistration[] = [];
  const METHODS = new Set(['get', 'post', 'put', 'delete', 'options', 'patch']);
  // Route-registration ALIASES: local factory functions defined inside a frozen
  // registration function that themselves call `app.post(routePath, ...)` with a
  // non-literal parameter, so the generic app.METHOD(literal, ...) scan below
  // cannot see the real path. Each entry is hand-verified this round to register
  // exactly one POST route per literal first argument, with an inline handler
  // that validates BYOK request fields but performs no route-level origin/
  // tool-token gate of its own (apps/daemon/src/routes/chat.ts's
  // `registerByokToolChatProxy`, verified directly against its source) --
  // exposure is hardcoded to match that verified behavior, the same
  // reviewer-owned-floor principle FROZEN_CALLER_INFLUENCE_FLOORS uses, rather
  // than re-derived from an AST shape this scanner cannot see.
  const ROUTE_REGISTRATION_ALIASES: Record<string, { exposure: number }> = {
    registerByokToolChatProxy: { exposure: 3 },
  };
  const walk = (node: TsNode): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'app' &&
      METHODS.has(node.expression.name.text)
    ) {
      const method = node.expression.name.text.toUpperCase();
      const pathArg = node.arguments[0];
      if (pathArg && (ts.isStringLiteral(pathArg) || ts.isNoSubstitutionTemplateLiteral(pathArg))) {
        const handler = node.arguments[node.arguments.length - 1];
        const hasLocalMiddleware = hasRequireLocalDaemonRequestMiddleware(node.arguments);
        let exposure = 3;
        if (hasLocalMiddleware) {
          exposure = 0;
        } else if (handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
          exposure = classifyRouteExposure(handler);
        }
        out.push({ method, path: pathArg.text, file: relPath, exposure });
      }
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text in ROUTE_REGISTRATION_ALIASES) {
      const pathArg = node.arguments[0];
      if (pathArg && (ts.isStringLiteral(pathArg) || ts.isNoSubstitutionTemplateLiteral(pathArg))) {
        const alias = ROUTE_REGISTRATION_ALIASES[node.expression.text]!;
        out.push({ method: 'POST', path: pathArg.text, file: relPath, exposure: alias.exposure });
      }
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(fnBody, walk);
  return out;
}

// Frozen registration-function scope (S9XF-1).
const FROZEN_REGISTRATION_TARGETS: Array<{ file: string; fn: string }> = [
  { file: 'apps/daemon/src/mcp-routes.ts', fn: 'registerMcpRoutes' },
  { file: 'apps/daemon/src/routes/deploy.ts', fn: 'registerDeploymentCheckRoutes' },
  { file: 'apps/daemon/src/routes/media.ts', fn: 'registerMediaRoutes' },
  { file: 'apps/daemon/src/brand-routes.ts', fn: 'registerBrandRoutes' },
  { file: 'apps/daemon/src/routes/plugins/marketplaces.ts', fn: 'registerPluginMarketplaceRoutes' },
  { file: 'apps/daemon/src/routes/plugins/index.ts', fn: 'registerPluginRoutes' },
  { file: 'apps/daemon/src/connectors/routes.ts', fn: 'registerConnectorRoutes' },
  { file: 'apps/daemon/src/routes/static-resource.ts', fn: 'registerStaticResourceRoutes' },
  { file: 'apps/daemon/src/routes/live-artifact.ts', fn: 'registerLiveArtifactRoutes' },
  { file: 'apps/daemon/src/routes/chat.ts', fn: 'registerChatRoutes' },
  // Round-1 fix (finding 1): apps/daemon/src/routes/xai.ts's registerXaiRoutes
  // was entirely absent from this list. `POST /api/xai/search` fetches
  // `${provider.baseUrl}/responses` (persisted, caller-editable config, same
  // shape as elevenlabs-voices.ts) with the stored bearer credential attached
  // -- confirmed by direct reading (routes/xai.ts:253-320), not merely by
  // the reviewer's citation. This one miss is why S9XF-1 below now ALSO runs
  // a mechanical whole-tree discovery pass rather than only self-consistency
  // against this hand-curated list -- see discoverAllRouteRegistrationFiles.
  { file: 'apps/daemon/src/routes/xai.ts', fn: 'registerXaiRoutes' },
];

// Frozen route -> target-file(s) mapping whose aggregate FileFetchProfile
// governs that route's guard-tier (S9XF-1's "traced same-file/1-hop-import
// edges"). Hand-verified this round; the LEASE/HEAD-DRIFT-adjacent drift
// check is: does each target file still exist and still contain at least
// one fetch-reaching site consistent with the frozen impact floor below.
const ROUTE_TARGET_FILES: Record<string, string[]> = {
  'POST /api/mcp/oauth/start': ['apps/daemon/src/mcp-oauth.ts'],
  'POST /api/projects/:id/deployments/:deploymentId/check-link': ['apps/daemon/src/deploy.ts'],
  'POST /api/projects/:id/media/generate': ['apps/daemon/src/media/index.ts'],
  'POST /api/tools/media/generate': ['apps/daemon/src/media/index.ts'],
  'GET /api/media/providers/elevenlabs/voices': ['apps/daemon/src/integrations/elevenlabs-voices.ts'],
  'GET /api/media/providers/aihubmix/models': ['apps/daemon/src/routes/media.ts'],
  // CORRECTION (found by running this verifier, not assumed from research alone): the shadcn/
  // GitHub design-system import entry points are registered in
  // apps/daemon/src/routes/static-resource.ts's registerStaticResourceRoutes, NOT in
  // apps/daemon/src/routes/design-systems.ts. `POST /api/design-systems/generation-jobs`
  // (design-systems.ts) only calls `designSystemGenerationJobs.start(...)`, an AI-generation job
  // queue with no traced outbound-fetch reachability -- it is correctly excluded from the frozen
  // set, not merely renamed.
  'POST /api/design-systems/import/github': ['apps/daemon/src/design-systems/github-import.ts'],
  'POST /api/design-systems/import/shadcn': [
    'apps/daemon/src/design-systems/shadcn-import.ts',
    'apps/daemon/src/design-systems/source-context.ts',
  ],
  'POST /api/brands': ['apps/daemon/src/brands/prefetch.ts', 'apps/daemon/src/brands/safe-fetch.ts'],
  'POST /api/brands/:id/continue-extraction': ['apps/daemon/src/brands/prefetch.ts', 'apps/daemon/src/brands/safe-fetch.ts'],
  'POST /api/brands/:id/preview': ['apps/daemon/src/brands/prefetch.ts', 'apps/daemon/src/brands/safe-fetch.ts'],
  'POST /api/brands/:id/finalize': ['apps/daemon/src/brands/prefetch.ts', 'apps/daemon/src/brands/safe-fetch.ts'],
  'POST /api/brands/:id/extract-from-html': ['apps/daemon/src/brands/prefetch.ts', 'apps/daemon/src/brands/safe-fetch.ts'],
  'POST /api/marketplaces': ['apps/daemon/src/plugins/marketplaces.ts', 'apps/daemon/src/plugins/plugin-asset-cache.ts'],
  'POST /api/plugins/install': ['apps/daemon/src/plugins/marketplaces.ts', 'apps/daemon/src/plugins/plugin-asset-cache.ts'],
  'GET /api/connectors/logos/:slug': ['apps/daemon/src/connectors/routes.ts'],
  'POST /api/tools/connectors/execute': ['apps/daemon/src/connectors/composio.ts'],
  'POST /api/connectors/:connectorId/connect': ['apps/daemon/src/connectors/composio.ts'],
  'POST /api/research/search': ['apps/daemon/src/research/tavily.ts'],
  'POST /api/codex-pets/sync': ['apps/daemon/src/community-pets-sync.ts'],
  'POST /api/live-artifacts/:artifactId/refresh': ['apps/daemon/src/live-artifacts/refresh.ts'],
  'POST /api/tools/live-artifacts/refresh': ['apps/daemon/src/live-artifacts/refresh.ts'],
  'POST /api/provider/models': ['apps/daemon/src/connectionTest.ts', 'apps/daemon/src/integrations/provider-models.ts'],
  'POST /api/test/connection': ['apps/daemon/src/connectionTest.ts'],
  'POST /api/proxy/anthropic/stream': ['apps/daemon/src/connectionTest.ts'],
  'POST /api/proxy/openai/stream': ['apps/daemon/src/connectionTest.ts'],
  'POST /api/proxy/azure/stream': ['apps/daemon/src/connectionTest.ts'],
  'POST /api/proxy/google/stream': ['apps/daemon/src/connectionTest.ts'],
  'POST /api/proxy/ollama/stream': ['apps/daemon/src/connectionTest.ts'],
  'POST /api/proxy/senseaudio/stream': ['apps/daemon/src/connectionTest.ts'],
  'POST /api/proxy/aihubmix/stream': ['apps/daemon/src/connectionTest.ts'],
  // Round-1 addition (finding 1): the fetch is in the SAME file as the route.
  'POST /api/xai/search': ['apps/daemon/src/routes/xai.ts'],
  // Round-1 addition, found by CXF-1's own new discovery pass (finding 1's
  // fix working as intended): `completeXAIAuth` -> `exchangeCodeForToken`
  // fetches `consumed.tokenEndpoint`, which traces to the hardcoded
  // `XAI_OAUTH_TOKEN_ENDPOINT` constant (apps/daemon/src/integrations/
  // xai-oauth.ts:101) set at the START of the OAuth flow, never caller
  // input at completion time -- confirmed by direct reading, impact 0.
  'POST /api/xai/oauth/complete': ['apps/daemon/src/routes/xai.ts', 'apps/daemon/src/integrations/xai-oauth.ts'],
};

// Frozen, reviewer-owned caller-influence (impact) floors, per S9XF-2. Keys
// MUST equal ROUTE_TARGET_FILES' keys exactly (checked, CXF-1).
//
// ROUND-1 FIX (finding 3): check-link and both media/generate routes were
// frozen at impact 3 while S9XF-2's own stated rule defines impact 2 as "the
// host comes from a persisted, caller-editable configuration field" -- which
// is exactly what each of these is (a stored deployment/custom-domain record
// for check-link; `credentials.baseUrl` set via a separate `PUT
// /api/media/config` call for media/generate), the same shape already scored
// 2 for elevenlabs/voices and the connectionTest.ts family. Corrected to 2 so
// the frozen table stops contradicting its own rule. Same correction applied
// to both live-artifacts/refresh rows below: the refresh URL is set on the
// artifact by an earlier, separate create call and only referenced by ID in
// the refresh request, which is the impact-2 shape, not impact-3's "supplied
// directly in the same request."
const FROZEN_CALLER_INFLUENCE_FLOORS: Record<string, number> = {
  'POST /api/mcp/oauth/start': 3,
  'POST /api/projects/:id/deployments/:deploymentId/check-link': 2,
  'POST /api/projects/:id/media/generate': 2,
  'POST /api/tools/media/generate': 2,
  'GET /api/media/providers/elevenlabs/voices': 2,
  'GET /api/media/providers/aihubmix/models': 0,
  'POST /api/design-systems/import/github': 1,
  'POST /api/design-systems/import/shadcn': 3,
  'POST /api/brands': 3,
  'POST /api/brands/:id/continue-extraction': 3,
  'POST /api/brands/:id/preview': 3,
  'POST /api/brands/:id/finalize': 3,
  'POST /api/brands/:id/extract-from-html': 3,
  'POST /api/marketplaces': 3,
  'POST /api/plugins/install': 3,
  'GET /api/connectors/logos/:slug': 1,
  'POST /api/tools/connectors/execute': 0,
  'POST /api/connectors/:connectorId/connect': 0,
  'POST /api/research/search': 2,
  'POST /api/codex-pets/sync': 0,
  'POST /api/live-artifacts/:artifactId/refresh': 2,
  'POST /api/tools/live-artifacts/refresh': 2,
  'POST /api/provider/models': 2,
  'POST /api/test/connection': 2,
  'POST /api/proxy/anthropic/stream': 2,
  'POST /api/proxy/openai/stream': 2,
  'POST /api/proxy/azure/stream': 2,
  'POST /api/proxy/google/stream': 2,
  'POST /api/proxy/ollama/stream': 2,
  'POST /api/proxy/senseaudio/stream': 2,
  'POST /api/proxy/aihubmix/stream': 2,
  'POST /api/xai/search': 2,
  'POST /api/xai/oauth/complete': 0,
};
const FROZEN_ROUTE_KEYS = new Set(Object.keys(FROZEN_CALLER_INFLUENCE_FLOORS));
function tierFor(score: number): 'P0' | 'P1' | 'P2' {
  if (score >= 5) return 'P0';
  if (score === 4) return 'P1';
  return 'P2';
}

// =========================================================================
// ROUND-1 addition (finding 1): mechanical whole-tree discovery. The prior
// draft's CXF-1 only checked whether the FROZEN_CALLER_INFLUENCE_FLOORS keys
// still existed in source -- self-consistency, never discovery. That is
// exactly how `POST /api/xai/search` (routes/xai.ts:253) escaped: it was
// never typed into the curated tables, and nothing would ever have noticed.
// This walks EVERY route-registration file under the daemon (glob, not a
// hand-typed list -- a new file is picked up automatically), extracts EVERY
// `app.METHOD('literal', ...)` call in the file (not scoped to one named
// function -- routes/deploy.ts alone defines two registration functions),
// and decides fetch-reachability with a bounded, generic algorithm that does
// NOT consult ROUTE_TARGET_FILES or any other hand-curated per-route table:
// (a) a same-file call-graph BFS from the handler through named
// function/const-arrow declarations in the SAME file, and (b) exactly one
// generic import hop -- for each relative import the file itself declares,
// if the handler's reachable call names include an imported binding AND
// that imported binding's own file shows any fetch reachability via the
// existing scanFileFetchProfile aggregate, the route counts as reaching
// fetch. Any route this discovers that is NOT in FROZEN_ROUTE_KEYS is a hard
// CXF-1 failure naming the exact route -- the frozen table can no longer
// silently drop a route the author forgot to type in.
// =========================================================================
const ROUTE_REGISTRATION_FILE_ROOTS = [
  'apps/daemon/src/routes',
  'apps/daemon/src/mcp-routes.ts',
  'apps/daemon/src/brand-routes.ts',
  'apps/daemon/src/connectors/routes.ts',
];
// Files entirely excluded from discovery, each with a stated reason -- NOT a
// blanket escape hatch; every entry names why. `library.ts` is owned and
// already attributed end-to-end by the LANDED mishmash-w9-ingest-tranche
// (see this PRD's "Explicitly out of scope"); re-discovering its routes here
// would duplicate ownership across two tranches' frozen sets for the same
// file.
const DISCOVERY_EXCLUDED_FILES = new Set(['apps/daemon/src/routes/library.ts']);
function discoverAllRouteRegistrationFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walkDir = (dirRel: string): void => {
    const dirAbs = path.join(rootDir, dirRel);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryRel = path.posix.join(dirRel, entry.name);
      if (entry.isDirectory()) {
        walkDir(entryRel);
        continue;
      }
      if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !DISCOVERY_EXCLUDED_FILES.has(entryRel)) out.push(entryRel);
    }
  };
  for (const rootRel of ROUTE_REGISTRATION_FILE_ROOTS) {
    const rootAbs = path.join(rootDir, rootRel);
    if (!fs.existsSync(rootAbs)) continue;
    if (fs.statSync(rootAbs).isDirectory()) {
      walkDir(rootRel);
    } else if (rootRel.endsWith('.ts') && !rootRel.endsWith('.test.ts') && !DISCOVERY_EXCLUDED_FILES.has(rootRel)) {
      out.push(rootRel);
    }
  }
  return [...new Set(out)].sort();
}
// Individual ROUTE-level discovery exclusions, each independently
// investigated and justified -- the discovery BFS's cross-file "one import
// hop, worst-case target-file aggregate" design (a deliberate, disclosed
// simplification, not full call-graph precision) can over-attribute fetch
// reachability when a route calls an imported helper from a file that ALSO
// happens to export some unrelated function containing a real fetch call.
// Both entries below were read directly, end to end, and neither reaches an
// outbound fetch in their own actual code path.
const DISCOVERY_FALSE_POSITIVE_ROUTES: Record<string, string> = {
  'GET /api/projects/:id/design-system-package-audit':
    'calls auditDesignSystemPackage(projectRoot), a local filesystem audit -- no outbound fetch in its reachable code; the cross-file aggregate over-attributes from an unrelated export in the same imported module.',
  'POST /api/projects/:id/files':
    'a local multipart/JSON file-upload handler (multer + fs.promises.readFile) -- no outbound fetch in its reachable code; same cross-file over-attribution as above.',
};
/** Named function declarations AND `const x = (..) => {}`/`function(){}` expressions at any depth, keyed by name -- the same-file call graph's node set. */
function buildIntraFileFunctionMap(sourceFile: TsNode): Map<string, TsNode> {
  const map = new Map<string, TsNode>();
  const walk = (node: TsNode): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      map.set(node.name.text, node.body);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        map.set(node.name.text, node.initializer);
      }
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sourceFile, walk);
  return map;
}
interface ImportEdge {
  importedNames: string[];
  targetFileRel: string | null;
}
/** Every RELATIVE import in the file (node_modules/workspace-package imports are not traced -- this tranche's guard/wrapper vocabulary lives in first-party relative-imported daemon source, never a package). `.js` specifiers resolve to `.ts` source per this codebase's ESM output convention (confirmed against real imports throughout apps/daemon/src). */
function collectRelativeImports(sourceFile: TsNode, ownFileRel: string, rootDir: string): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const stmts = (sourceFile as unknown as { statements: readonly TsNode[] }).statements;
  for (const stmt of stmts) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    if (!spec.startsWith('.')) continue;
    const importedNames: string[] = [];
    const clause = stmt.importClause;
    if (clause?.name) importedNames.push(clause.name.text);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) importedNames.push(el.name.text);
    }
    if (importedNames.length === 0) continue;
    const ownDirAbs = path.dirname(path.join(rootDir, ownFileRel));
    let resolvedAbs = path.normalize(path.join(ownDirAbs, spec));
    if (resolvedAbs.endsWith('.js')) resolvedAbs = `${resolvedAbs.slice(0, -3)}.ts`;
    else if (!resolvedAbs.endsWith('.ts')) resolvedAbs = `${resolvedAbs}.ts`;
    const exists = fs.existsSync(resolvedAbs);
    edges.push({ importedNames, targetFileRel: exists ? path.relative(rootDir, resolvedAbs) : null });
  }
  return edges;
}
/** Bounded BFS from a route handler: same-file named-function calls, plus exactly one generic import hop per collectRelativeImports edge. `fileProfileCache` is shared across routes/files in one discovery run so each imported file's own scanFileFetchProfile only runs once. */
function discoverRouteReachesFetch(
  startNode: TsNode,
  functionMap: ReadonlyMap<string, TsNode>,
  importEdges: readonly ImportEdge[],
  rootDir: string,
  fileProfileCache: Map<string, FileFetchProfile>,
): boolean {
  const visited = new Set<TsNode>();
  const queue: TsNode[] = [startNode];
  let hops = 0;
  while (queue.length > 0 && hops < 200) {
    const node = queue.shift();
    hops += 1;
    if (!node || visited.has(node)) continue;
    visited.add(node);
    if (containsRawFetchCall(node)) return true;
    const calledNames = collectReachableCallNames(node);
    for (const wrapper of KNOWN_SAFE_WRAPPERS) {
      if (calledNames.has(wrapper)) return true;
    }
    for (const name of calledNames) {
      const sameFileTarget = functionMap.get(name);
      if (sameFileTarget) {
        queue.push(sameFileTarget);
        continue;
      }
      for (const edge of importEdges) {
        if (!edge.targetFileRel || !edge.importedNames.includes(name)) continue;
        let profile = fileProfileCache.get(edge.targetFileRel);
        if (!profile) {
          const abs = path.join(rootDir, edge.targetFileRel);
          if (!fs.existsSync(abs)) continue;
          profile = scanFileFetchProfile(fs.readFileSync(abs, 'utf8'), edge.targetFileRel, `${edge.targetFileRel}@discovery`);
          fileProfileCache.set(edge.targetFileRel, profile);
        }
        if (profile.worstGuardTier !== null) return true;
      }
    }
  }
  return false;
}
interface DiscoveredRoute {
  key: string;
  file: string;
}
/** The mechanical discovery entry point. Runs against the live HEAD filesystem (fs.readdirSync/readFileSync, consistent with how this verifier's other HEAD-side checks already read the tree) -- not baseCommit, since discovery must run identically well against an in-progress implementation branch's own worktree, which is exactly when a new, not-yet-frozen route would appear. */
function discoverFetchReachingRoutes(rootDir: string): DiscoveredRoute[] {
  const files = discoverAllRouteRegistrationFiles(rootDir);
  const fileProfileCache = new Map<string, FileFetchProfile>();
  const found: DiscoveredRoute[] = [];
  const METHODS = new Set(['get', 'post', 'put', 'delete', 'options', 'patch']);
  for (const relPath of files) {
    const abs = path.join(rootDir, relPath);
    let text: string;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const sourceFile = ts.createSourceFile(`${relPath}@discovery`, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const functionMap = buildIntraFileFunctionMap(sourceFile);
    const importEdges = collectRelativeImports(sourceFile, relPath, rootDir);
    const walk = (node: TsNode): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'app' &&
        METHODS.has(node.expression.name.text)
      ) {
        const method = node.expression.name.text.toUpperCase();
        const pathArg = node.arguments[0];
        const handler = node.arguments[node.arguments.length - 1];
        if (pathArg && (ts.isStringLiteral(pathArg) || ts.isNoSubstitutionTemplateLiteral(pathArg)) && handler) {
          if (discoverRouteReachesFetch(handler, functionMap, importEdges, rootDir, fileProfileCache)) {
            found.push({ key: `${method} ${pathArg.text}`, file: relPath });
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(sourceFile, walk);
  }
  return found;
}

// =========================================================================
// Self-probe fixtures -- real shapes and decoy classes for BOTH classifiers.
// A failed probe fails CXF-1 and CXF-8 outright.
// =========================================================================
interface SelfProbe {
  name: string;
  kind: 'exposure' | 'guard';
  source: string;
  expected: number;
}
const EXPOSURE_PROBES: SelfProbe[] = [
  {
    name: 'real-tool-token-shape',
    kind: 'exposure',
    expected: 1,
    source: `app.post('/x', async (req, res) => {
      const grant = authorizeToolRequest(req, res, 'x:y');
      if (!grant) return;
      doWork();
    });`,
  },
  {
    // Round-1 self-probe (finding 2b): the real shape of routes/media.ts:619
    // and routes/xai.ts:253 -- a straight-line inline isLocalSameOrigin veto,
    // not requireLocalDaemonRequest middleware.
    name: 'real-inline-local-same-origin-veto-shape',
    kind: 'exposure',
    expected: 0,
    source: `app.post('/x', async (req, res) => {
      if (!isLocalSameOrigin(req, getResolvedPort())) {
        return res.status(403).json({ error: 'cross-origin request rejected' });
      }
      doWork();
    });`,
  },
  {
    name: 'inline-local-same-origin-veto-in-dead-branch',
    kind: 'exposure',
    expected: 3,
    source: `app.post('/x', async (req, res) => {
      if (false) {
        if (!isLocalSameOrigin(req, getResolvedPort())) { return res.status(403).end(); }
      }
      doWork();
    });`,
  },
  {
    name: 'real-bearer-shape',
    kind: 'exposure',
    expected: 2,
    source: `app.post('/x', async (req, res) => {
      const token = bearerToken(req);
      const check = validateLibraryToken(db, token);
      if (!check.ok) { res.status(401).end(); return; }
      doWork();
    });`,
  },
  {
    name: 'bearer-with-loopback-veto',
    kind: 'exposure',
    expected: 3,
    source: `app.post('/x', async (req, res) => {
      const token = bearerToken(req);
      const check = validateLibraryToken(db, token);
      if (!check.ok) {
        if (isLocalSameOrigin(req, port)) { doWork(); return; }
        res.status(401).end();
        return;
      }
      doWork();
    });`,
  },
  {
    name: 'guard-in-dead-branch',
    kind: 'exposure',
    expected: 3,
    source: `app.post('/x', async (req, res) => {
      if (false) {
        const grant = authorizeToolRequest(req, res, 'x:y');
        if (!grant) return;
      }
      doWork();
    });`,
  },
  {
    name: 'no-gate-at-all',
    kind: 'exposure',
    expected: 3,
    source: `app.post('/x', async (req, res) => {
      doWork();
    });`,
  },
];
const GUARD_PROBES: Array<{ name: string; source: string; expected: 0 | 1 | 2 }> = [
  {
    name: 'safe-wrapper-call',
    expected: 0,
    source: `async function f(url) {
      const res = await fetchExternalBrandAsset(url);
      return res;
    }`,
  },
  {
    name: 'hardcoded-host-const',
    expected: 0,
    source: `const VERCEL_API = 'https://api.vercel.com';
    async function f(id) {
      const res = await fetch(\`\${VERCEL_API}/v1/deployments/\${id}\`);
      return res;
    }`,
  },
  {
    name: 'validated-unpinned',
    expected: 1,
    source: `async function f(url) {
      const check = await assertExternalAssetUrl(url);
      if (!check.ok) throw new Error(check.error);
      const res = await fetch(url, { redirect: 'error' });
      return res;
    }`,
  },
  {
    name: 'raw-unguarded',
    expected: 2,
    source: `async function f(url) {
      const res = await fetch(url);
      return res;
    }`,
  },
];
function runSelfProbes(): { probeId: string; expected: number; actual: number; pass: boolean }[] {
  const out: { probeId: string; expected: number; actual: number; pass: boolean }[] = [];
  for (const probe of EXPOSURE_PROBES) {
    const regs = collectRouteRegistrationsFromFunction(
      `function registerProbeRoutes(app) {\n${probe.source}\n}`,
      '<self-probe>',
      'registerProbeRoutes',
      `probe-${probe.name}.ts`,
    );
    const actual = regs[0]?.exposure ?? -1;
    out.push({ probeId: `exposure:${probe.name}`, expected: probe.expected, actual, pass: actual === probe.expected });
  }
  for (const probe of GUARD_PROBES) {
    const profile = scanFileFetchProfile(probe.source, '<self-probe>', `probe-${probe.name}.ts`);
    const actual = profile.worstGuardTier ?? -1;
    out.push({ probeId: `guard:${probe.name}`, expected: probe.expected, actual, pass: actual === probe.expected });
  }
  return out;
}

// =========================================================================
// Structural helpers shared by CXF-3/CXF-4/CXF-6.
// =========================================================================
const PLACEHOLDER_DENYLIST = new Set(['x', 'n/a', 'na', 'tbd', 'none', 'unknown', 'todo', 'placeholder', '-', '--']);
function isPlaceholderText(raw: unknown): boolean {
  if (typeof raw !== 'string') return true;
  const trimmed = raw.trim();
  if (trimmed.length < 12) return true;
  if (PLACEHOLDER_DENYLIST.has(trimmed.toLowerCase())) return true;
  const uniqueChars = new Set(trimmed.replace(/\s/g, '').toLowerCase()).size;
  if (uniqueChars <= 2) return true;
  return false;
}
// Known non-founder identity strings a self-accepting implementer might type
// as `Accepter:` -- same denylist shape as the W9-agent-spawn reference
// implementation's C9S-8 (the one mechanism that round's reviewer found
// sound; ported here, not re-derived from scratch).
const NON_FOUNDER_DENYLIST = new Set(['orchestrator', 'implementer', 'verifier', 'claude', 'codex', 'sol', 'grok', 'ai', 'agent']);
interface AcceptedRiskBlock {
  heading: string;
  route: string;
  acceptedRisk: string;
  accepter: string;
  date: string;
  rationale: string;
}
// ROUND-1 FIX (finding 6a): the prior implementation located a block with
// `decisionsText.indexOf(\`### ${ref}\`)` and then SLICED TO THE END OF THE
// FILE, never to the next heading -- if this block's own body omitted a
// field (or the author simply wrote the fields in a different order across
// two adjacent blocks), the field regexes would happily match a LATER
// block's own field first, letting one accepted-risk record borrow another
// record's Route/Accepter/Rationale text. This finds every heading's exact
// span (matchAll + the NEXT match's index as the boundary, matching the
// verify-w9-agent-spawn.ts reference implementation's `parseAcceptedRiskBlocks`
// exactly) so a field can never leak across a heading boundary. A duplicate
// heading anywhere in the file makes every block under that heading name
// unresolvable (the caller must reject count!==1), not merely ambiguous at
// the second occurrence.
function parseAcceptedRiskBlocks(decisionsText: string): Map<string, AcceptedRiskBlock[]> {
  const blocks = new Map<string, AcceptedRiskBlock[]>();
  const headingRe = /^### (W9XF-ACCEPT-[A-Za-z0-9-]+)\s*$/gim;
  const matches = [...decisionsText.matchAll(headingRe)];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    if (!match) continue;
    const heading = match[1] ?? '';
    const start = (match.index ?? 0) + match[0].length;
    const nextMatch = matches[i + 1];
    const end = nextMatch ? (nextMatch.index ?? decisionsText.length) : decisionsText.length;
    const body = decisionsText.slice(start, end);
    const route = /^- Route:\s*`([^`]+)`/m.exec(body)?.[1]?.trim() ?? '';
    const acceptedRisk = /^- Accepted[\s-]+risk:\s*(.+)$/im.exec(body)?.[1]?.trim() ?? '';
    const accepter = /^- Accepter:\s*(.+)$/m.exec(body)?.[1]?.trim() ?? '';
    const date = /^- Date:\s*(\d{4}-\d{2}-\d{2})/m.exec(body)?.[1]?.trim() ?? '';
    const rationale = /^- Rationale:\s*(.+)$/m.exec(body)?.[1]?.trim() ?? '';
    const block: AcceptedRiskBlock = { heading, route, acceptedRisk, accepter, date, rationale };
    const existing = blocks.get(heading) ?? [];
    existing.push(block);
    blocks.set(heading, existing);
  }
  return blocks;
}
// ROUND-1 FIX (finding 4b): every route's path starts with `/api/`, and the
// old `length>1 && !/^[a-z]{1,2}$/` filter let "api" (3 chars) through as an
// "association term" for every single row -- any passing test whose name
// merely contained the substring "api" anywhere satisfied the association
// check for ANY route. This stoplist excludes segments that are structural
// path scaffolding, not identifying content, across this tranche's actual
// frozen routes (`api`, `tools`, `projects`, `assets`, `v1`, `v2`).
const GENERIC_PATH_SEGMENTS = new Set(['api', 'tools', 'projects', 'assets', 'v1', 'v2']);
/** Every backtick-delimited token in a piece of prose, used for EXACT route-key/testRef citation matching in CXF-7 -- never substring `.includes()`, which a prefix-shaped route key like `POST /api/brands` defeats against its own nested `POST /api/brands/:id/...` siblings. */
function extractBacktickTokens(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
}
function routeAssociationTerms(routeKey: string): string[] {
  const pathPart = routeKey.split(' ')[1] ?? routeKey;
  return pathPart
    .split('/')
    .map((seg) => seg.replace(/[:{}]/g, ''))
    .filter((seg) => seg.length > 1 && !/^[a-z]{1,2}$/.test(seg) && !GENERIC_PATH_SEGMENTS.has(seg.toLowerCase()));
}
function exposureKeywordOk(authn: string, exposure: number): boolean {
  const lower = authn.toLowerCase();
  if (exposure === 0) return /requirelocaldaemonrequest|loopback/.test(lower);
  if (exposure === 1) return /authorizetoolrequest|tool token|tool-token/.test(lower);
  if (exposure === 2) return /bearer|self-service|proof of possession/.test(lower);
  return /none|no gate|no-gate|global bypass|unauthenticated/.test(lower);
}
function guardKeywordOk(inputValidation: string, guardTier: 0 | 1 | 2): boolean {
  const lower = inputValidation.toLowerCase();
  if (guardTier === 0) return /fetchexternalbrandasset|safeexternalfetch|assertandfetchexternalasset|dns-pinned|hardcoded/.test(lower);
  if (guardTier === 1) {
    return /assertexternalasseturl|validatebaseurlresolved|validateuserproviderbaseurl|validatebaseurl|classifyhost|assertpublicbrandurl|assertsafepublicurl|validated-unpinned/.test(
      lower,
    );
  }
  return /none|unguarded|no validation/.test(lower);
}
interface GuardedDeclaration {
  mechanism: string;
  fn: string;
  pinsConnection: boolean;
}
function parseGuardedDeclaration(text: string): GuardedDeclaration | null {
  const m = /^GUARDED mechanism=(dns-pinned|validated-unpinned|hostname-allowlist|hardcoded-host) fn=([A-Za-z0-9_]+) pinsConnection=(true|false)$/.exec(
    text.trim(),
  );
  if (!m) return null;
  const [, mechanism, fn, pins] = m;
  if (!mechanism || !fn) return null;
  const pinsConnection = pins === 'true';
  if ((mechanism === 'dns-pinned' || mechanism === 'hostname-allowlist') && !pinsConnection) return null;
  if (mechanism === 'validated-unpinned' && pinsConnection) return null;
  return { mechanism, fn, pinsConnection };
}
function extractStaticTestTitlesFromSource(sourceText: string, label: string): Set<string> {
  const sourceFile = ts.createSourceFile(label, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const titles = new Set<string>();
  const titleFromArg = (arg: TsNode | undefined): string | null => {
    if (!arg) return null;
    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
    return null;
  };
  const isTestCallee = (expr: TsNode): boolean => {
    if (ts.isIdentifier(expr)) return expr.text === 'it' || expr.text === 'test';
    if (ts.isPropertyAccessExpression(expr)) return isTestCallee(expr.expression);
    if (ts.isCallExpression(expr)) return isTestCallee(expr.expression);
    return false;
  };
  const walk = (node: TsNode): void => {
    if (ts.isCallExpression(node) && isTestCallee(node.expression)) {
      const title = titleFromArg(node.arguments[0]);
      if (title) titles.add(title);
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(sourceFile, walk);
  return titles;
}

// =========================================================================
// Test suite execution (CXF-2) -- frozen glob, real vitest JSON reporter.
// =========================================================================
// ROUND-1 FIX (finding 4a): the PRD's proposed lease (see
// docs/plans/waves/W9-external-fetch-tranche.md, "Proposed lease") allows
// the implementer to ADD new test files matching `mcp-oauth-*.test.ts`,
// `deploy-check-link-*.test.ts`, `external-fetch-*.test.ts`, and several
// exact new filenames -- but discovery previously matched only the 11
// pre-existing EXACT filenames, so none of those new files could ever be
// discovered, run, or cited: the endpoint-test lane was unsatisfiable as
// leased. Discovery now matches BOTH the legacy exact names AND the leased
// prefix patterns, kept in sync with the PRD's lease text by hand (both
// files are frozen together once this round lands).
const SSRF_TEST_FILE_EXACT_NAMES = [
  'aihubmix-asset-ssrf',
  'marketplace-install-ssrf',
  'brand-safe-fetch',
  'brand-prefetch',
  'brands-prefetch-abort',
  'plugin-asset-cache',
  'deploy',
  'deploy-routes',
  'byok-tools',
  'connectors-routes',
  'connectors-service',
  'media-provider-baseurl-ssrf',
  'elevenlabs-voices-ssrf',
  'byok-proxy-baseurl-ssrf',
  'design-systems-import-ssrf',
];
const SSRF_TEST_FILE_PREFIXES = ['mcp-oauth-', 'deploy-check-link-', 'external-fetch-'];
/** ROUND-1 FIX (finding 4c): `.only(` is not a distinct vitest reporter status
 * (a file containing it just reports its OTHER tests as normal passes, with
 * the excluded ones simply absent from output), so it was invisible to the
 * old "hasSkipOrOnlyOrTodo" check despite the name -- a single `.only` could
 * silently exclude every other assertion in a file from a real run while the
 * suite still reported green. Source-scanned directly, comment-blind would
 * require a full AST pass; a literal token scan is intentionally used here
 * (cheap, and a `.only(` token appearing only inside a comment or string is
 * an extraordinarily unlikely false positive for a security-test file, and
 * fails safe -- i.e. toward MORE scrutiny, not less). */
function sourceHasOnlyMarker(absPath: string): boolean {
  let text: string;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch {
    return false;
  }
  return /\b(it|test|describe)\.only\s*\(/.test(text);
}
function discoverSsrfTestFiles(): string[] {
  const testsDir = path.join(repoRoot, 'apps/daemon/tests');
  if (!fs.existsSync(testsDir)) return [];
  return fs
    .readdirSync(testsDir)
    .filter((f) => {
      if (!f.endsWith('.test.ts')) return false;
      const stem = f.slice(0, -'.test.ts'.length);
      return SSRF_TEST_FILE_EXACT_NAMES.includes(stem) || SSRF_TEST_FILE_PREFIXES.some((p) => stem.startsWith(p));
    })
    .map((f) => path.join('apps/daemon/tests', f))
    .sort();
}
interface AssertionResult {
  fullName: string;
  state: string;
}
interface FileTestResult {
  file: string;
  assertions: AssertionResult[];
  hasSkipOrOnlyOrTodo: boolean;
}
interface SuiteJson {
  testResults: Array<{
    name: string;
    assertionResults: Array<{ fullName: string; status: string; title: string }>;
  }>;
}
function runSsrfSuite(testFiles: string[], attempt: number): { ok: boolean; results: FileTestResult[]; raw: string } {
  const outFile = path.join(os.tmpdir(), `verify-w9-external-fetch-suite-run.attempt-${attempt}.${process.pid}.json`);
  const r = sh(
    'pnpm',
    ['--filter', '@open-design/daemon', 'exec', 'vitest', 'run', '--reporter=json', `--outputFile=${outFile}`, ...testFiles.map((f) => path.relative(path.join(repoRoot, 'apps/daemon'), path.join(repoRoot, f)))],
    { timeoutMs: 10 * 60_000 },
  );
  let raw = '';
  try {
    raw = fs.readFileSync(outFile, 'utf8');
  } catch {
    return { ok: false, results: [], raw: `<no output file>\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}` };
  }
  let parsed: SuiteJson;
  try {
    parsed = JSON.parse(raw) as SuiteJson;
  } catch {
    return { ok: false, results: [], raw };
  }
  // ROUND-1 FIX (finding 4c): `.only(` source-scanned across the INPUT file
  // list directly (not derived from the reporter, which never surfaces it --
  // see sourceHasOnlyMarker's docblock).
  const anyOnlyMarker = testFiles.some((f) => sourceHasOnlyMarker(path.join(repoRoot, f)));
  const results: FileTestResult[] = parsed.testResults.map((tr) => ({
    file: tr.name,
    assertions: tr.assertionResults.map((a) => ({ fullName: a.fullName, state: a.status })),
    hasSkipOrOnlyOrTodo: tr.assertionResults.some((a) => a.status === 'pending' || a.status === 'todo') || anyOnlyMarker,
  }));
  // Vacuity guard: `.every()` over a possibly-empty collection vacuously
  // returns true, so a matched file with zero recorded assertions (or a
  // suite run that produced zero file results at all) must NOT silently
  // count as "passed" -- pair every `.every()` here with an explicit
  // `length > 0` check rather than trust the vacuous default.
  const allPassed =
    results.length > 0 &&
    results.every((f) => f.assertions.length > 0 && f.assertions.every((a) => a.state === 'passed') && !f.hasSkipOrOnlyOrTodo);
  return { ok: allPassed && r.status === 0 && !anyOnlyMarker, results, raw };
}

// =========================================================================
// ROUND-1 addition (findings 2a + 7): process-tree management, PORTED from
// scripts/waves/verify-w10f.ts (which DECISIONS.md's W9AS-PARK/W10A-PARK/
// W10B-PARK record names as the proven sound pattern), using this
// repository's own `@open-design/platform` process-tree primitives instead
// of hand-rolled process-group signaling. `stopProcesses` internally does
// SIGTERM-then-SIGKILL escalation with a poll-until-exit confirmation; the
// caller's job is only to hand it every PID that was EVER part of the tree.
// =========================================================================
interface PlatformProcessSnapshot {
  pid: number;
  ppid: number;
  command: string;
}
interface PlatformStopResult {
  stoppedPids: number[];
  remainingPids: number[];
  forcedPids: number[];
}
interface PlatformProcessApi {
  listProcessSnapshots: () => Promise<PlatformProcessSnapshot[]>;
  collectProcessTreePids: (processes: PlatformProcessSnapshot[], rootPids: Array<number | null | undefined>) => number[];
  stopProcesses: (pids: Array<number | null | undefined>) => Promise<PlatformStopResult>;
}
let platformCache: PlatformProcessApi | null = null;
async function loadPlatform(): Promise<PlatformProcessApi> {
  if (platformCache) return platformCache;
  const distPath = path.join(repoRoot, 'packages/platform/dist/index.mjs');
  if (!fs.existsSync(distPath)) throw new Error(`packages/platform is not built (missing ${distPath}) -- run pnpm install`);
  const mod = (await import(pathToFileURL(distPath).href)) as PlatformProcessApi;
  platformCache = { listProcessSnapshots: mod.listProcessSnapshots, collectProcessTreePids: mod.collectProcessTreePids, stopProcesses: mod.stopProcesses };
  return platformCache;
}
/** Refuses any URL that is not `127.0.0.1`, and hard-refuses the two protected default-namespace daemon ports (finding 2's binding safety requirement) -- this is the "validate origin" half of "every probe fetch must set redirect to manual and validate origin and status so a redirect cannot reach a forbidden port." */
function assertSafeLoopbackUrl(urlString: string): URL {
  const url = new URL(urlString);
  if (url.hostname !== '127.0.0.1') throw new Error(`refusing non-loopback URL: ${urlString}`);
  const port = Number(url.port);
  if (port === 7456 || port === 51012) throw new Error(`refusing to use reserved daemon port ${port} (url=${urlString})`);
  return url;
}
/** A spawned process's PID plus every descendant PID observed at ANY point while it ran (not merely a single snapshot taken after the fact, which would miss a grandchild that outlives an already-reaped intermediate parent). Polls every 150ms until the process exits or `timeoutMs` elapses. */
async function spawnWithProcessTreeTracking(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<{ status: number | null; stdout: string; stderr: string; timedOut: boolean; observedPids: Set<number> }> {
  const platform = await loadPlatform();
  const proc = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const observedPids = new Set<number>();
  if (proc.pid != null) observedPids.add(proc.pid);
  let stdout = '';
  let stderr = '';
  proc.stdout?.on('data', (c: Buffer) => {
    stdout += c.toString('utf8');
  });
  proc.stderr?.on('data', (c: Buffer) => {
    stderr += c.toString('utf8');
  });
  let timedOut = false;
  const startedAt = Date.now();
  const exitPromise = new Promise<number | null>((resolve) => {
    proc.once('exit', (code) => resolve(code));
    proc.once('error', () => resolve(null));
  });
  let exited = false;
  void exitPromise.then(() => {
    exited = true;
  });
  while (!exited && Date.now() - startedAt < opts.timeoutMs) {
    if (proc.pid != null) {
      const snapshots = await platform.listProcessSnapshots();
      for (const pid of platform.collectProcessTreePids(snapshots, [proc.pid])) observedPids.add(pid);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (!exited) {
    timedOut = true;
    if (proc.pid != null) {
      try {
        process.kill(proc.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
  const status = await exitPromise;
  // Final snapshot after exit/kill -- catches anything spawned in the last window before exit.
  if (proc.pid != null) {
    const snapshots = await platform.listProcessSnapshots();
    for (const pid of platform.collectProcessTreePids(snapshots, [proc.pid])) observedPids.add(pid);
  }
  return { status, stdout, stderr, timedOut, observedPids };
}
/** Stops every PID in `observedPids`, waits for confirmation, and returns ok:true ONLY when the platform's own stop result reports zero remaining. A failed or partial teardown must never be silently treated as success. */
async function confirmProcessTreeStopped(observedPids: ReadonlySet<number>): Promise<{ ok: boolean; detail: string }> {
  const platform = await loadPlatform();
  const result = await platform.stopProcesses([...observedPids]);
  return {
    ok: result.remainingPids.length === 0,
    detail: `observed=${JSON.stringify([...observedPids])} stopped=${JSON.stringify(result.stoppedPids)} forced=${JSON.stringify(result.forcedPids)} remaining=${JSON.stringify(result.remainingPids)}`,
  };
}

/** Mechanically extracts the production MAX_REMOTE_BYTES constant from
 * apps/daemon/src/routes/library.ts rather than hardcoding a copy that could
 * silently drift from the real value. Only matches the exact `N * N * N`
 * numeric-literal shape the source currently uses -- no eval, no arbitrary
 * expression parsing. */
function extractMaxRemoteBytesConstant(): number {
  const abs = path.join(repoRoot, 'apps/daemon/src/routes/library.ts');
  const text = fs.readFileSync(abs, 'utf8');
  const m = /const MAX_REMOTE_BYTES\s*=\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)\s*;/.exec(text);
  if (!m) {
    throw new Error(
      'could not mechanically extract MAX_REMOTE_BYTES from library.ts (expected `const MAX_REMOTE_BYTES = N * N * N;`) -- CXF-11 refuses to guess a bound that could drift from production',
    );
  }
  return Number(m[1]) * Number(m[2]) * Number(m[3]);
}

// CXF-11 / CXF-6-positive-control sentinel targets. 93.184.216.34 is a real,
// non-private public IPv4 literal (same fixture the codebase's own
// brand-safe-fetch.test.ts uses) so `assertPublicBrandUrl`'s IP-literal
// branch passes it with NO DNS lookup at all -- the SSRF pre-check that runs
// before these sentinels are ever reached is 100% real production logic.
// Nothing about these constants weakens or bypasses that check; they merely
// choose an address the check already treats as legitimately public.
const W9XF_ACCEPT_PROBE_HOST = '93.184.216.34';
const W9XF_ACCEPT_PROBE_PATH_PREFIX = '/__w9xf_accept_probe__/';
const W9XF_LEAK_PROBE_URL = `http://${W9XF_ACCEPT_PROBE_HOST}/__w9xf_leak_probe__`;
// CXF-11's POSITIVE CONTROL sentinel: an ordinary, genuinely in-bounds
// transfer (a few KB, also declaring no Content-Length -- the same code path
// as the leak probe) that must complete normally in the SAME run that proves
// the oversized leak probe is bounded/rejected. Without this, a broken
// measurement mechanism that always reports "unbounded" regardless of input
// -- or a fix that overzealously cancels every transfer -- would go
// undetected: the leak probe alone cannot distinguish "correctly bounds an
// oversized transfer" from "cancels everything, oversized or not."
const W9XF_OK_PROBE_URL = `http://${W9XF_ACCEPT_PROBE_HOST}/__w9xf_ok_probe__`;
function w9xfAcceptProbeUrl(key: string): string {
  return `http://${W9XF_ACCEPT_PROBE_HOST}${W9XF_ACCEPT_PROBE_PATH_PREFIX}${encodeURIComponent(key)}`;
}

// =========================================================================
// ROUND-1 addition (finding 2a): isolated daemon boot + loopback canary +
// live HTTP probe. This is the mechanism that lets CXF-6 OBSERVE a P0 row's
// guard actually firing, rather than inferring it from source shape. PORTED
// from verify-w10f.ts's bootIsolatedDaemonSubprocess/bootIsolatedDaemon.
//
// ROUND-2 addition (CXF-11 + Ruling 1/3): the runner ALSO installs a
// SELECTIVE globalThis.fetch stub and a loopback-only telemetry side-channel
// before importing server.ts. The stub is the ONLY deviation from real
// production code -- route dispatch, the SSRF guard's own pre-checks
// (assertPublicBrandUrl, createValidatingLookup), and fetchRemoteBytes all
// run for real. It intercepts exactly three sentinel URLs (a leak-probe
// target for CXF-11's negative-control transfer-bound measurement, an
// ok-probe target for CXF-11's OWN positive control -- an ordinary in-bounds
// transfer that must complete normally in the same run -- and an
// accept-probe target for CXF-6's positive control) and passes every other
// URL straight through to the real fetch unmodified -- so every EXISTING
// reject-path probe (which targets the loopback canary, a different address
// entirely) is completely
// unaffected by this change. Per Ruling 1 condition 1, interception is
// EMPIRICALLY PROVEN at the start of CXF-6 (see the stub-interception
// self-check below), never merely assumed from reading this source.
// =========================================================================
function buildIsolatedDaemonRunnerScript(serverTsUrl: string, maxRemoteBytes: number): string {
  const hardCap = maxRemoteBytes + 10 * 1024 * 1024;
  return [
    'import http from "node:http";',
    `const W9XF_LEAK_URL = ${JSON.stringify(W9XF_LEAK_PROBE_URL)};`,
    `const W9XF_OK_URL = ${JSON.stringify(W9XF_OK_PROBE_URL)};`,
    `const W9XF_ACCEPT_PREFIX = ${JSON.stringify(`http://${W9XF_ACCEPT_PROBE_HOST}${W9XF_ACCEPT_PROBE_PATH_PREFIX}`)};`,
    `const W9XF_HARD_CAP = ${hardCap};`,
    'const __blankTransferTelemetry = () => ({ bytesEnqueued: 0, sawCancel: false, cancelledAtBytes: null, streamClosed: false });',
    'const __telemetry = { acceptInvocations: {}, leak: __blankTransferTelemetry(), ok: __blankTransferTelemetry() };',
    'const __realFetch = globalThis.fetch;',
    'globalThis.fetch = async (input, init) => {',
    '  const urlStr = typeof input === "string" ? input : (input && typeof input === "object" && "url" in input) ? String(input.url) : String(input);',
    '  if (urlStr === W9XF_LEAK_URL) {',
    '    __telemetry.leak = __blankTransferTelemetry();',
    '    const chunk = new Uint8Array(65536).fill(65);',
    '    const stream = new ReadableStream({',
    '      pull(controller) {',
    '        if (__telemetry.leak.bytesEnqueued >= W9XF_HARD_CAP) { __telemetry.leak.streamClosed = true; controller.close(); return; }',
    '        controller.enqueue(chunk);',
    '        __telemetry.leak.bytesEnqueued += chunk.byteLength;',
    '      },',
    '      cancel(_reason) {',
    '        __telemetry.leak.sawCancel = true;',
    '        __telemetry.leak.cancelledAtBytes = __telemetry.leak.bytesEnqueued;',
    '      },',
    '    });',
    '    return new Response(stream, { status: 200, headers: { "content-type": "application/octet-stream" } });',
    '  }',
    '  if (urlStr === W9XF_OK_URL) {',
    '    __telemetry.ok = __blankTransferTelemetry();',
    '    const chunk = new Uint8Array(4096).fill(66);',
    '    const okTotal = 3 * chunk.byteLength;',
    '    const stream = new ReadableStream({',
    '      pull(controller) {',
    '        if (__telemetry.ok.bytesEnqueued >= okTotal) { __telemetry.ok.streamClosed = true; controller.close(); return; }',
    '        controller.enqueue(chunk);',
    '        __telemetry.ok.bytesEnqueued += chunk.byteLength;',
    '      },',
    '      cancel(_reason) {',
    '        __telemetry.ok.sawCancel = true;',
    '        __telemetry.ok.cancelledAtBytes = __telemetry.ok.bytesEnqueued;',
    '      },',
    '    });',
    '    return new Response(stream, { status: 200, headers: { "content-type": "text/plain" } });',
    '  }',
    '  if (urlStr.startsWith(W9XF_ACCEPT_PREFIX)) {',
    '    const key = decodeURIComponent(urlStr.slice(W9XF_ACCEPT_PREFIX.length));',
    '    __telemetry.acceptInvocations[key] = (__telemetry.acceptInvocations[key] || 0) + 1;',
    '    return new Response("w9xf-accept-probe-ok", { status: 200, headers: { "content-type": "text/plain" } });',
    '  }',
    '  return __realFetch(input, init);',
    '};',
    'const __telemetryServer = http.createServer((req, res) => {',
    '  const u = new URL(req.url ?? "/", "http://127.0.0.1");',
    '  if (u.pathname === "/telemetry") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(__telemetry)); return; }',
    '  if (u.pathname === "/reset" && req.method === "POST") {',
    '    __telemetry.acceptInvocations = {};',
    '    __telemetry.leak = __blankTransferTelemetry();',
    '    __telemetry.ok = __blankTransferTelemetry();',
    '    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true })); return;',
    '  }',
    '  res.writeHead(404); res.end();',
    '});',
    'await new Promise((resolve, reject) => { __telemetryServer.once("error", reject); __telemetryServer.listen(0, "127.0.0.1", resolve); });',
    'const __telemetryAddr = __telemetryServer.address();',
    'const __telemetryPort = __telemetryAddr && typeof __telemetryAddr === "object" ? __telemetryAddr.port : 0;',
    'const { startServer } = await import(process.env.W9XF_SERVER_URL);',
    'const started = await startServer({ port: 0, host: "127.0.0.1", returnServer: true });',
    'process.stdout.write(JSON.stringify({ ready: true, url: started.url, routeInventory: started.routeInventory ?? null, telemetryUrl: `http://127.0.0.1:${__telemetryPort}` }) + "\\n");',
    'process.on("SIGTERM", async () => { try { await started.shutdown?.(); } finally { process.exit(0); } });',
  ].join('\n');
}
interface IsolatedDaemonHandle {
  baseUrl: string;
  telemetryUrl: string;
  dataDir: string;
  routeInventory: unknown;
  observedPids: Set<number>;
  proc: ReturnType<typeof spawn>;
}
/** Spawns the real production daemon (dynamically imports apps/daemon/src/server.ts's own startServer -- never a reimplementation) in a fresh, isolated OD_DATA_DIR on an OS-assigned port. Never touches 7456/51012 by construction (port:0). Caller MUST eventually call stopIsolatedDaemon on the returned handle. */
async function bootIsolatedDaemon(): Promise<IsolatedDaemonHandle> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w9xf-daemon-data-'));
  const runnerPath = path.join(os.tmpdir(), `w9xf-daemon-runner-${process.pid}-${Date.now()}.mjs`);
  const serverTsUrl = pathToFileURL(path.join(repoRoot, 'apps/daemon/src/server.ts')).href;
  fs.writeFileSync(runnerPath, buildIsolatedDaemonRunnerScript(serverTsUrl, extractMaxRemoteBytesConstant()));
  const platform = await loadPlatform();
  const proc = spawn('pnpm', ['exec', 'tsx', runnerPath], {
    cwd: repoRoot,
    env: { ...process.env, OD_DATA_DIR: dataDir, W9XF_SERVER_URL: serverTsUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const observedPids = new Set<number>();
  if (proc.pid != null) observedPids.add(proc.pid);
  const trackTimer = setInterval(() => {
    void (async () => {
      if (proc.pid == null) return;
      const snapshots = await platform.listProcessSnapshots();
      for (const pid of platform.collectProcessTreePids(snapshots, [proc.pid])) observedPids.add(pid);
    })();
  }, 200);
  try {
    const ready = await new Promise<{ url: string; routeInventory: unknown; telemetryUrl: string }>((resolve, reject) => {
      let buffered = '';
      const timeout = setTimeout(() => reject(new Error('isolated daemon did not report ready within 30s')), 30_000);
      proc.stdout?.on('data', (chunk: Buffer) => {
        buffered += chunk.toString('utf8');
        const line = buffered.split('\n').find((l) => l.trim().startsWith('{'));
        if (line) {
          try {
            const parsed = JSON.parse(line.trim()) as { ready?: boolean; url?: string; routeInventory?: unknown; telemetryUrl?: string };
            if (parsed.ready && typeof parsed.url === 'string' && typeof parsed.telemetryUrl === 'string') {
              clearTimeout(timeout);
              resolve({ url: parsed.url, routeInventory: parsed.routeInventory ?? null, telemetryUrl: parsed.telemetryUrl });
            }
          } catch {
            /* keep buffering */
          }
        }
      });
      proc.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`isolated daemon exited early (code=${code}) before reporting ready`));
      });
      proc.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
    assertSafeLoopbackUrl(ready.url);
    assertSafeLoopbackUrl(ready.telemetryUrl);
    return { baseUrl: ready.url, telemetryUrl: ready.telemetryUrl, dataDir, routeInventory: ready.routeInventory, observedPids, proc };
  } catch (err) {
    clearInterval(trackTimer);
    await confirmProcessTreeStopped(observedPids).catch(() => {});
    try {
      fs.rmSync(runnerPath, { force: true });
    } catch {
      /* best effort */
    }
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    throw err;
  } finally {
    clearInterval(trackTimer);
  }
}
/** Stops the daemon's FULL process tree and confirms zero survivors before removing its data dir. A partial teardown returns ok:false and does NOT remove the data dir (evidence preserved for investigation) -- per the binding safety rule, a failed teardown must fail the run, never be silently swallowed. */
async function stopIsolatedDaemon(handle: IsolatedDaemonHandle): Promise<{ ok: boolean; detail: string }> {
  if (handle.proc.pid != null) {
    try {
      process.kill(handle.proc.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  const platform = await loadPlatform();
  const snapshots = await platform.listProcessSnapshots();
  if (handle.proc.pid != null) {
    for (const pid of platform.collectProcessTreePids(snapshots, [handle.proc.pid])) handle.observedPids.add(pid);
  }
  const stopResult = await confirmProcessTreeStopped(handle.observedPids);
  if (stopResult.ok) {
    try {
      fs.rmSync(handle.dataDir, { recursive: true, force: true });
    } catch {
      /* best effort, does not affect the teardown verdict */
    }
  }
  return stopResult;
}
interface CanaryServer {
  url: string;
  hitCount: () => number;
  reset: () => void;
  close: () => Promise<void>;
}
/** A loopback-only HTTP listener the probe points a route's caller-controlled URL/baseUrl field at. If the daemon actually attempts the outbound fetch (guard did not fire), this receives the request; if the guard fired, it receives nothing. This is the "assert it is refused" observable -- not merely a response status code, which a route could return by coincidence. */
async function startCanaryServer(): Promise<CanaryServer> {
  let hits = 0;
  const server = http.createServer((_req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('w9xf-canary');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  if (port === 0 || port === 7456 || port === 51012) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error(`canary server bound to an unsafe port (${port})`);
  }
  return {
    url: `http://127.0.0.1:${port}/w9xf-canary`,
    hitCount: () => hits,
    reset: () => {
      hits = 0;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
interface ProbeSpec {
  method: string;
  path: string;
  headers?: Record<string, string>;
  bodyTemplate?: unknown;
  rejectStatusIn: number[];
}
function isProbeSpec(value: unknown): value is ProbeSpec {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.method === 'string' &&
    typeof v.path === 'string' &&
    v.path.startsWith('/') &&
    Array.isArray(v.rejectStatusIn) &&
    v.rejectStatusIn.length > 0 &&
    v.rejectStatusIn.every((s) => typeof s === 'number')
  );
}
const PROBE_TARGET_PLACEHOLDER = '__W9XF_PROBE_TARGET__';
/** Executes one live SSRF probe: substitutes the canary URL into the declared body template wherever the placeholder appears, sends the REAL HTTP request to the isolated daemon with `redirect: 'manual'` (a 3xx from the daemon is never silently followed -- the "validate ... status so a redirect cannot reach a forbidden port" half of the binding safety rule), and asserts BOTH that the canary saw zero connections AND that the daemon's own response status is one the row declared as a refusal. Either one alone is insufficient: a coincidental error status without a canary check could pass for the wrong reason (R4, VERIFICATION-CONTRACT.md §3) and a canary check without a status check could pass on a request that never reached the intended code path at all. */
async function executeSsrfProbe(daemon: IsolatedDaemonHandle, canary: CanaryServer, spec: ProbeSpec): Promise<{ ok: boolean; detail: string }> {
  canary.reset();
  const url = assertSafeLoopbackUrl(new URL(spec.path, daemon.baseUrl).toString());
  const bodyText = spec.bodyTemplate !== undefined ? JSON.stringify(spec.bodyTemplate).split(PROBE_TARGET_PLACEHOLDER).join(canary.url) : undefined;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: spec.method,
      headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
      redirect: 'manual',
      ...(bodyText !== undefined ? { body: bodyText } : {}),
    });
  } catch (err) {
    return { ok: false, detail: `probe fetch threw: ${String(err)}` };
  }
  // Drain the body so the connection can close cleanly without holding the daemon open.
  try {
    await resp.arrayBuffer();
  } catch {
    /* best effort */
  }
  const canaryHits = canary.hitCount();
  const statusOk = spec.rejectStatusIn.includes(resp.status);
  const ok = canaryHits === 0 && statusOk;
  return { ok, detail: `status=${resp.status} canaryHits=${canaryHits} rejectStatusIn=${JSON.stringify(spec.rejectStatusIn)} url=${url.toString()}` };
}

interface W9xfTransferTelemetry {
  bytesEnqueued: number;
  sawCancel: boolean;
  cancelledAtBytes: number | null;
  streamClosed: boolean;
}
interface W9xfTelemetry {
  acceptInvocations: Record<string, number>;
  leak: W9xfTransferTelemetry;
  ok: W9xfTransferTelemetry;
}
/** Reads the isolated daemon's in-process fetch-stub telemetry (accept-probe invocation counts, leak-probe and ok-probe byte tracking) over the loopback-only telemetry side-channel started in the runner script. */
async function queryTelemetry(daemon: IsolatedDaemonHandle): Promise<W9xfTelemetry> {
  const url = assertSafeLoopbackUrl(new URL('/telemetry', daemon.telemetryUrl).toString());
  const resp = await fetch(url, { redirect: 'manual' });
  return (await resp.json()) as W9xfTelemetry;
}
async function resetTelemetry(daemon: IsolatedDaemonHandle): Promise<void> {
  const url = assertSafeLoopbackUrl(new URL('/reset', daemon.telemetryUrl).toString());
  await fetch(url, { method: 'POST', redirect: 'manual' });
}

// =========================================================================
// RULING 1/3 addition: positive-control probe. Points a row's caller-
// controlled field at a stubbed-but-legitimately-public sentinel target
// (globalThis.fetch intercepts only this one sentinel URL; the route, its
// guard's pre-checks, and the handler are unmodified production code) and
// asserts the stub was actually invoked -- proof the guard's own pre-check
// let a public target reach the real fetch call, discriminating a genuine
// control from a guard that would refuse ANY input (blanket denial), which
// the reject-only probe alone cannot rule out. Per Ruling 1 condition 4,
// the returned detail states the seam explicitly.
// =========================================================================
async function executeAcceptControlProbe(daemon: IsolatedDaemonHandle, spec: ProbeSpec, key: string): Promise<{ ok: boolean; detail: string }> {
  await resetTelemetry(daemon);
  const url = assertSafeLoopbackUrl(new URL(spec.path, daemon.baseUrl).toString());
  const target = w9xfAcceptProbeUrl(key);
  const bodyText = spec.bodyTemplate !== undefined ? JSON.stringify(spec.bodyTemplate).split(PROBE_TARGET_PLACEHOLDER).join(target) : undefined;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: spec.method,
      headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
      redirect: 'manual',
      ...(bodyText !== undefined ? { body: bodyText } : {}),
    });
  } catch (err) {
    return { ok: false, detail: `accept-control probe fetch threw: ${String(err)}` };
  }
  try {
    await resp.arrayBuffer();
  } catch {
    /* best effort */
  }
  const telemetry = await queryTelemetry(daemon);
  const invoked = (telemetry.acceptInvocations[key] ?? 0) >= 1;
  return {
    ok: invoked,
    detail: `status=${resp.status} stubInvoked=${invoked} [SEAM: transport is STUBBED for this one sentinel public-IP URL only -- route dispatch, the guard's own pre-check, and the handler are real production code; a stub invocation proves the guard's pre-check let a legitimate public target through, which a blanket-denial guard could never do] url=${url.toString()}`,
  };
}

// =========================================================================
// PORTED red-evidence replay (CXF-5/CXF-6's new-control requirement).
// Generic mechanism: not fetch/route-specific. Adapted paths/globs only.
// =========================================================================
function findIntroductionCommit(relPath: string, leafTitle: string): { introductionCommit: string; firstParent: string } | null {
  const log = sh('git', ['log', '--format=%H', '--reverse', `${baseCommit}..${headSha}`, '--', relPath]);
  if (log.status !== 0) return null;
  const commits = log.stdout.trim().split('\n').filter(Boolean);
  for (const commit of commits) {
    let text: string;
    try {
      text = readFileAtCommit(commit, relPath);
    } catch {
      continue;
    }
    const titles = extractStaticTestTitlesFromSource(text, `${relPath}@${commit}`);
    if (titles.has(leafTitle)) {
      const parentR = sh('git', ['rev-parse', `${commit}^`]);
      if (parentR.status !== 0) continue;
      return { introductionCommit: commit, firstParent: parentR.stdout.trim() };
    }
  }
  return null;
}
interface SerializedTaskNode {
  type: string;
  name: string;
  fullName: string;
  state: string;
  errors: unknown[];
}
interface SerializedReplayForest {
  modules: number;
  nodes: SerializedTaskNode[];
  unhandledErrors: unknown[];
}
function generateReplayMarker(): string {
  return crypto.randomBytes(16).toString('hex');
}
function buildReplayRunnerScript(marker: string, testFileAbs: string, daemonRoot: string): string {
  return `
import { startVitest } from ${JSON.stringify(path.join(daemonRoot, 'node_modules/vitest/dist/node.js'))};
async function main() {
  const ctx = await startVitest('test', [${JSON.stringify(testFileAbs)}], { watch: false, reporters: [] });
  await ctx?.close?.();
  const state = ctx?.state;
  const modules = state?.getTestModules?.() ?? [];
  const nodes = [];
  const walk = (n) => {
    nodes.push({ type: n.type, name: n.name ?? '', fullName: typeof n.fullName === 'function' ? n.fullName() : (n.fullName ?? n.name ?? ''), state: typeof n.result === 'function' ? n.result()?.state : (n.state ?? n.result?.state ?? 'unknown'), errors: n.errors?.() ?? n.result?.()?.errors ?? [] });
    for (const child of n.children ?? []) walk(child);
  };
  for (const m of modules) walk(m);
  const unhandled = state?.getUnhandledErrors?.() ?? [];
  process.stdout.write('${''}' + '${''}REPLAY_${'{'}${JSON.stringify(marker)}${'}'}_START\\n');
  process.stdout.write(JSON.stringify({ modules: modules.length, nodes, unhandledErrors: unhandled }) + '\\n');
  process.stdout.write('REPLAY_${'{'}${JSON.stringify(marker)}${'}'}_END\\n');
  process.exitCode = process.exitCode ?? 0;
}
main().catch((err) => { console.error(err); process.exitCode = process.exitCode || 1; });
`;
}
function evaluateTaskForestConsistency(
  forest: SerializedReplayForest,
  targetFullName: string,
  controlFullName: string,
): { ok: boolean; reason: string } {
  if (forest.modules !== 1) return { ok: false, reason: `expected exactly 1 module, got ${forest.modules}` };
  const leaves = forest.nodes.filter((n) => n.type === 'test');
  const failedLeaves = leaves.filter((n) => n.state === 'failed');
  if (failedLeaves.length !== 1) return { ok: false, reason: `expected exactly 1 failed leaf, got ${failedLeaves.length}` };
  if (failedLeaves[0]?.fullName !== targetFullName) {
    return { ok: false, reason: `failed leaf fullName mismatch: ${failedLeaves[0]?.fullName} !== ${targetFullName}` };
  }
  const anyOtherError = forest.nodes.some((n) => n.fullName !== targetFullName && Array.isArray(n.errors) && n.errors.length > 0);
  if (anyOtherError) return { ok: false, reason: 'an error exists outside the target leaf' };
  if (forest.unhandledErrors.length > 0) return { ok: false, reason: 'unhandled-errors collection is non-empty' };
  const control = leaves.find((n) => n.fullName === controlFullName);
  if (!control || control.state !== 'passed') return { ok: false, reason: 'control test did not pass' };
  return { ok: true, reason: 'consistent' };
}
interface ReplayOutcome {
  ok: boolean;
  detail: string;
}
// ROUND-1 FIX (finding 7): the replay runner used to be launched via the
// blocking `sh()` helper (plain spawnSync, no process-tree tracking) --
// vitest's own Node API can spawn worker processes/threads beneath it, and a
// timeout-triggered kill only ever signaled the ONE tracked PID, exactly the
// orphaned-descendant failure mode the program-wide DECISIONS.md ruling
// named (a SIGTERM-handling descendant surviving its parent's own exit). The
// runner is now launched via spawnWithProcessTreeTracking (which polls the
// FULL descendant tree while the process runs, not a single snapshot taken
// after the fact) and torn down via confirmProcessTreeStopped, which
// requires zero remaining PIDs -- a partial teardown now returns ok:false
// and PRESERVES tmpBase (never deletes evidence out from under a failure)
// instead of silently succeeding. The `git worktree remove` result is now
// checked, not discarded.
async function replayRedEvidence(parentSha: string, containingFileRel: string, targetFullName: string, controlFullName: string): Promise<ReplayOutcome> {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-w9xf-replay-'));
  const worktreeDir = path.join(tmpBase, 'wt');
  const addR = sh('git', ['worktree', 'add', '--detach', worktreeDir, parentSha]);
  if (addR.status !== 0) return { ok: false, detail: `git worktree add failed: ${addR.stderr}` };
  let outcome: ReplayOutcome;
  let teardownOk = true;
  let teardownDetail = '';
  try {
    sh('mise', ['trust'], { cwd: worktreeDir, timeoutMs: 60_000 });
    const install = sh('pnpm', ['install', '--offline', '--frozen-lockfile'], { cwd: worktreeDir, timeoutMs: 5 * 60_000 });
    if (install.status !== 0) {
      outcome = { ok: false, detail: `frozen offline install failed: ${install.stderr.slice(0, 2000)}` };
    } else {
      const headFileAbs = path.join(repoRoot, containingFileRel);
      const worktreeFileAbs = path.join(worktreeDir, containingFileRel);
      fs.mkdirSync(path.dirname(worktreeFileAbs), { recursive: true });
      fs.copyFileSync(headFileAbs, worktreeFileAbs);
      const marker = generateReplayMarker();
      const daemonRoot = path.join(worktreeDir, 'apps/daemon');
      const runnerScript = buildReplayRunnerScript(marker, worktreeFileAbs, daemonRoot);
      const runnerPath = path.join(tmpBase, 'runner.mjs');
      fs.writeFileSync(runnerPath, runnerScript);
      const run = await spawnWithProcessTreeTracking('node', [runnerPath], { cwd: daemonRoot, env: process.env, timeoutMs: 3 * 60_000 });
      const stopResult = await confirmProcessTreeStopped(run.observedPids);
      teardownOk = stopResult.ok;
      teardownDetail = stopResult.detail;
      if (run.timedOut) {
        outcome = { ok: false, detail: `replay process timed out (3min) -- observedPids=${JSON.stringify([...run.observedPids])}` };
      } else {
        const startTag = `REPLAY_${marker}_START`;
        const endTag = `REPLAY_${marker}_END`;
        const startIdx = run.stdout.indexOf(startTag);
        const endIdx = run.stdout.indexOf(endTag);
        const occurrences = run.stdout.split(startTag).length - 1;
        if (occurrences !== 1 || startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
          outcome = { ok: false, detail: `marker did not appear exactly once (occurrences=${occurrences})` };
        } else {
          const jsonLine = run.stdout.slice(startIdx + startTag.length, endIdx).trim();
          try {
            const forest = JSON.parse(jsonLine) as SerializedReplayForest;
            if (run.status === 0) {
              outcome = { ok: false, detail: 'replay process exited 0 -- no red evidence' };
            } else {
              const consistency = evaluateTaskForestConsistency(forest, targetFullName, controlFullName);
              outcome = consistency.ok
                ? { ok: true, detail: `replay consistent, parentSha=${parentSha}, exit=${String(run.status)}` }
                : { ok: false, detail: consistency.reason };
            }
          } catch {
            outcome = { ok: false, detail: 'could not parse serialized replay forest' };
          }
        }
      }
    }
  } catch (err) {
    outcome = { ok: false, detail: `replay threw: ${String(err)}` };
  }
  const worktreeRemove = sh('git', ['worktree', 'remove', '--force', worktreeDir]);
  const worktreeRemoveOk = worktreeRemove.status === 0;
  // A failed/partial process teardown OR a failed worktree removal fails the
  // replay outright, regardless of what the test-forest evidence said --
  // per the binding safety rule, this is never downgraded to advisory.
  const finalOk = outcome.ok && teardownOk && worktreeRemoveOk;
  const finalDetail = `${outcome.detail} | teardown: ok=${teardownOk} ${teardownDetail} | worktreeRemove: ok=${worktreeRemoveOk} ${worktreeRemoveOk ? '' : worktreeRemove.stderr}`;
  if (finalOk) {
    // Only remove the temp worktree root once teardown and worktree removal
    // are BOTH confirmed -- a failure preserves tmpBase for investigation
    // instead of deleting the evidence.
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* best effort; does not change the already-failing verdict */
    }
  }
  return { ok: finalOk, detail: finalDetail };
}
function parseRedTranscript(content: string): { parentSha: string; test: string; controlTest: string } | null {
  const parentM = /^PARENT_SHA:\s*(\S+)/m.exec(content);
  const testM = /^TEST:\s*(.+)$/m.exec(content);
  const controlM = /^CONTROL_TEST:\s*(.+)$/m.exec(content);
  if (!parentM || !testM || !controlM) return null;
  const parentSha = parentM[1];
  const test = testM[1]?.trim();
  const controlTest = controlM[1]?.trim();
  if (!parentSha || !test || !controlTest) return null;
  return { parentSha, test, controlTest };
}

// =========================================================================
// main()
// =========================================================================
async function main(): Promise<void> {
  const attribJsonRel = 'docs/security/external-fetch-attribution.json';
  const threatModelRel = 'docs/security/daemon-threat-model.md';
  const reviewJsonRel = 'docs/security/external-fetch-implementation-review.json';
  const decisionsRel = 'docs/plans/waves/DECISIONS.md';

  let selfProbeOutcomes: ReturnType<typeof runSelfProbes> = [];
  let liveRouteSet: RouteRegistration[] = [];
  let baseRouteSet: RouteRegistration[] = [];

  await checkCriterion('CXF-1', async () => {
    selfProbeOutcomes = runSelfProbes();
    const failedProbes = selfProbeOutcomes.filter((p) => !p.pass);

    // baseCommit AST scan across every frozen registration target. Duplicate
    // detection is scoped to FROZEN_ROUTE_KEYS only -- this codebase legitimately
    // registers the SAME {method,path} in two different files as a deliberate
    // Express next()-chained handler pair outside this tranche's row scope (e.g.
    // `DELETE /api/design-systems/:id` in both routes/design-systems.ts and
    // routes/static-resource.ts, confirmed by direct reading; static-resource.ts's
    // handler explicitly calls next() for one ID shape and falls through). That
    // pattern is real but irrelevant to THIS tranche (DELETE performs no outbound
    // fetch), so it must not fail CXF-1 -- only a duplicate among the 31 SSRF-
    // relevant frozen routes is a hard fail.
    //
    // ROUND-1 FIX (finding 1): the prior `dupCheck.get(key) !== target.file`
    // condition only flagged a duplicate when TWO DIFFERENT files registered
    // the same key -- a route registered twice inside the SAME file (e.g. a
    // copy-paste duplicate `app.post` call) was silently invisible. Now flags
    // on any second occurrence, same file or not.
    const dupCheck = new Map<string, string>();
    let dupError: string | null = null;
    for (const target of FROZEN_REGISTRATION_TARGETS) {
      if (!fileExistsAtCommit(baseCommit, target.file)) continue;
      const text = readFileAtCommit(baseCommit, target.file);
      const regs = collectRouteRegistrationsFromFunction(text, target.file, target.fn, `${target.file}@${baseCommit}`);
      for (const reg of regs) {
        const key = `${reg.method} ${reg.path}`;
        if (!FROZEN_ROUTE_KEYS.has(key)) continue;
        if (dupCheck.has(key)) {
          dupError = `duplicate registration ${key} in ${dupCheck.get(key)} and ${target.file}`;
        }
        dupCheck.set(key, target.file);
        baseRouteSet.push(reg);
      }
    }
    const baseFrozenSubset = baseRouteSet.filter((r) => FROZEN_ROUTE_KEYS.has(`${r.method} ${r.path}`));
    const baseFrozenKeys = new Set(baseFrozenSubset.map((r) => `${r.method} ${r.path}`));
    const missingFromBase = [...FROZEN_ROUTE_KEYS].filter((k) => !baseFrozenKeys.has(k));
    const extraInBase = [...baseFrozenKeys].filter((k) => !FROZEN_ROUTE_KEYS.has(k)); // never true by construction, kept for symmetry/documentation

    // HEAD scan for drift.
    const headRouteSet: RouteRegistration[] = [];
    for (const target of FROZEN_REGISTRATION_TARGETS) {
      const abs = path.join(repoRoot, target.file);
      if (!fs.existsSync(abs)) continue;
      const text = fs.readFileSync(abs, 'utf8');
      const regs = collectRouteRegistrationsFromFunction(text, target.file, target.fn, `${target.file}@HEAD`);
      headRouteSet.push(...regs);
    }
    liveRouteSet = headRouteSet;
    const headFrozenKeys = new Set(
      headRouteSet.filter((r) => FROZEN_ROUTE_KEYS.has(`${r.method} ${r.path}`)).map((r) => `${r.method} ${r.path}`),
    );
    const missingAtHead = [...FROZEN_ROUTE_KEYS].filter((k) => !headFrozenKeys.has(k));
    const newUnfrozenAtHead: string[] = [];
    const headDupCheck = new Map<string, string>();
    let headDupError: string | null = null;
    for (const target of FROZEN_REGISTRATION_TARGETS) {
      const abs = path.join(repoRoot, target.file);
      if (!fs.existsSync(abs)) continue;
      const text = fs.readFileSync(abs, 'utf8');
      const regs = collectRouteRegistrationsFromFunction(text, target.file, target.fn, `${target.file}@HEAD`);
      for (const reg of regs) {
        const key = `${reg.method} ${reg.path}`;
        if (!FROZEN_ROUTE_KEYS.has(key)) continue;
        if (headDupCheck.has(key)) {
          headDupError = `duplicate registration ${key} in ${headDupCheck.get(key)} and ${target.file}`;
        }
        headDupCheck.set(key, target.file);
      }
    }

    // ROUND-1 addition (finding 1): mechanical discovery, independent of the
    // curated tables. Any fetch-reaching route discoverFetchReachingRoutes
    // finds that is not already in FROZEN_ROUTE_KEYS is a hard fail naming
    // the exact route -- this is what would have caught `POST
    // /api/xai/search` before a reviewer had to.
    const discovered = discoverFetchReachingRoutes(repoRoot);
    const discoveredNotFrozen = discovered.filter((d) => !FROZEN_ROUTE_KEYS.has(d.key) && !(d.key in DISCOVERY_FALSE_POSITIVE_ROUTES));
    const excludedFalsePositives = discovered.filter((d) => !FROZEN_ROUTE_KEYS.has(d.key) && d.key in DISCOVERY_FALSE_POSITIVE_ROUTES);
    const undiscoveredButFrozen = [...FROZEN_ROUTE_KEYS].filter((k) => !discovered.some((d) => d.key === k));

    const ok =
      failedProbes.length === 0 &&
      dupError === null &&
      headDupError === null &&
      missingFromBase.length === 0 &&
      extraInBase.length === 0 &&
      missingAtHead.length === 0 &&
      discoveredNotFrozen.length === 0;

    record(
      'CXF-1',
      `AST scan of ${FROZEN_REGISTRATION_TARGETS.length} frozen registration functions at baseCommit=${baseCommit} and HEAD, PLUS a mechanical whole-tree discovery pass over every route-registration file under apps/daemon/src/routes/ + mcp-routes.ts + brand-routes.ts + connectors/routes.ts`,
      'frozen route set self-consistent with FROZEN_CALLER_INFLUENCE_FLOORS; no duplicates at baseCommit or HEAD; no drift between baseCommit and HEAD; all self-probes pass; discovery finds no fetch-reaching route outside the frozen set',
      ok,
      [
        `self-probes: ${selfProbeOutcomes.length - failedProbes.length}/${selfProbeOutcomes.length} pass`,
        ...failedProbes.map((p) => `FAILED PROBE ${p.probeId}: expected=${p.expected} actual=${p.actual}`),
        `frozen route count: ${FROZEN_ROUTE_KEYS.size}`,
        `baseCommit frozen-subset count: ${baseFrozenSubset.length}`,
        dupError ? `DUP@base: ${dupError}` : 'no duplicates at baseCommit',
        headDupError ? `DUP@head: ${headDupError}` : 'no duplicates at HEAD',
        missingFromBase.length ? `MISSING@base: ${missingFromBase.join(', ')}` : 'all frozen routes found at baseCommit',
        missingAtHead.length ? `MISSING@head (drift): ${missingAtHead.join(', ')}` : 'all frozen routes still present at HEAD',
        `discovery scanned ${discoverAllRouteRegistrationFiles(repoRoot).length} route-registration files, found ${discovered.length} fetch-reaching routes`,
        discoveredNotFrozen.length
          ? `DISCOVERED-NOT-FROZEN (hard fail): ${discoveredNotFrozen.map((d) => `${d.key} (${d.file})`).join(', ')}`
          : 'every discovered fetch-reaching route is in the frozen set',
        excludedFalsePositives.length
          ? `excluded as investigated false positives (DISCOVERY_FALSE_POSITIVE_ROUTES, does not fail CXF-1): ${excludedFalsePositives.map((d) => `${d.key} -- ${DISCOVERY_FALSE_POSITIVE_ROUTES[d.key]}`).join('; ')}`
          : 'no false-positive exclusions were needed this run',
        undiscoveredButFrozen.length
          ? `informational -- frozen routes discovery's bounded BFS/1-hop-import algorithm did not independently re-derive (does not fail CXF-1; these rely on reachability this tranche's research established by other means, e.g. a helper called indirectly through more than one import hop): ${undiscoveredButFrozen.join(', ')}`
          : 'discovery independently re-derived every frozen route too',
      ].join('\n'),
      { detail: ok ? undefined : 'see evidence for the specific self-consistency/drift/duplicate/discovery failure' },
    );
  });

  await checkCriterion('CXF-2', async () => {
    const testFiles = discoverSsrfTestFiles();
    if (testFiles.length === 0) {
      record('CXF-2', '', 'frozen SSRF-relevant test glob discovers at least one file', false, 'no matching test files found', {
        detail: 'discoverSsrfTestFiles() returned empty -- apps/daemon/tests layout may have changed',
      });
      return;
    }
    const run = runSsrfSuite(testFiles, 1);
    record(
      'CXF-2',
      `pnpm --filter @open-design/daemon exec vitest run --reporter=json ${testFiles.join(' ')}`,
      'every discovered SSRF-relevant test file passes, zero pending/todo markers',
      run.ok,
      `files: ${testFiles.join(', ')}\nresults: ${JSON.stringify(
        run.results.map((f) => ({ file: f.file, total: f.assertions.length, failed: f.assertions.filter((a) => a.state !== 'passed').length, hasSkipOrOnlyOrTodo: f.hasSkipOrOnlyOrTodo })),
        null,
        2,
      )}`,
      { detail: run.ok ? undefined : 'one or more SSRF-relevant tests failed or carried a skip/pending/todo marker' },
    );
  });

  // ROUND-1 REORDER (finding 3): CXF-3 (parse the attribution matrix) now
  // runs BEFORE the routeVerdicts computation and CXF-8, which need to read
  // the matrix's own declared riskScore per row -- CXF-8 used to run first,
  // before `attribution` existed for this pass, which is part of why it
  // never read it.
  let attribution: Array<Record<string, unknown>> | null = null;
  await checkCriterion('CXF-3', () => {
    const abs = path.join(repoRoot, attribJsonRel);
    if (!fs.existsSync(abs)) {
      record('CXF-3', '', `${attribJsonRel} exists and parses; exactly one row per frozen route`, false, 'file does not exist', {
        detail: 'expected pre-implementation: no attribution matrix yet',
      });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (err) {
      record('CXF-3', '', '', false, '', { detail: `JSON parse failed: ${String(err)}` });
      return;
    }
    if (!Array.isArray(parsed)) {
      record('CXF-3', '', '', false, '', { detail: 'attribution file is not a JSON array' });
      return;
    }
    attribution = parsed as Array<Record<string, unknown>>;
    const keys = attribution.map((r) => `${String(r.method)} ${String(r.path)}`);
    const keySet = new Set(keys);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    const orphans = keys.filter((k) => !FROZEN_ROUTE_KEYS.has(k));
    const gaps = [...FROZEN_ROUTE_KEYS].filter((k) => !keySet.has(k));
    const ok = dupes.length === 0 && orphans.length === 0 && gaps.length === 0 && keys.length === FROZEN_ROUTE_KEYS.size;
    record(
      'CXF-3',
      '',
      `attribution matrix covers exactly the ${FROZEN_ROUTE_KEYS.size} frozen routes, no orphans/gaps/duplicates`,
      ok,
      `rows=${keys.length} frozen=${FROZEN_ROUTE_KEYS.size}\ndupes=${dupes.join(',')}\norphans=${orphans.join(',')}\ngaps=${gaps.join(',')}`,
      { detail: ok ? undefined : 'row-set mismatch' },
    );
  });

  // Per-route mechanical guard-tier + risk score, computed once, reused by CXF-4..CXF-8.
  interface RouteVerdict {
    routeKey: string;
    exposure: number;
    impactFloor: number;
    score: number;
    tier: 'P0' | 'P1' | 'P2';
    guardTier: 0 | 1 | 2;
    mechanism: string;
    targetFiles: string[];
  }
  const routeVerdicts = new Map<string, RouteVerdict>();
  for (const key of FROZEN_ROUTE_KEYS) {
    const targetFiles = ROUTE_TARGET_FILES[key] ?? [];
    let worst: 0 | 1 | 2 | null = null;
    let mechanism = 'none';
    for (const tf of targetFiles) {
      const abs = path.join(repoRoot, tf);
      if (!fs.existsSync(abs)) continue;
      const text = fs.readFileSync(abs, 'utf8');
      const profile = scanFileFetchProfile(text, tf, `${tf}@HEAD`);
      if (profile.worstGuardTier === null) continue;
      if (worst === null || profile.worstGuardTier > worst) {
        worst = profile.worstGuardTier;
        const worstSite = profile.rawFetchSites.find((s) => s.guardTier === profile.worstGuardTier);
        mechanism = worstSite?.mechanism ?? profile.safeWrapperSites[0]?.mechanism ?? 'none';
      }
    }
    const guardTier: 0 | 1 | 2 = worst ?? 2;
    const found = liveRouteSet.find((r) => `${r.method} ${r.path}` === key);
    const exposure = found?.exposure ?? 3;
    const impactFloor = FROZEN_CALLER_INFLUENCE_FLOORS[key] ?? 0;
    const score = exposure + impactFloor;
    routeVerdicts.set(key, { routeKey: key, exposure, impactFloor, score, tier: tierFor(score), guardTier, mechanism, targetFiles });
  }

  // ROUND-1 FIX (finding 3): CXF-8 used to recompute score/tier from its OWN
  // internal routeVerdicts map and compare that computation against ITSELF
  // (`v.score === v.exposure + v.impactFloor`, both derived from the exact
  // same frozen constants) -- a tautology that could never fail regardless
  // of what the attribution matrix actually claimed, so a row could omit or
  // falsify its own `riskScore` entirely and CXF-8 would still report green.
  // It now reads each attribution ROW's own declared `riskScore` object and
  // checks it against the mechanically-computed verdict -- the matrix's
  // claim is what is being graded, not this file's internal bookkeeping.
  await checkCriterion('CXF-8', () => {
    if (!attribution) {
      record('CXF-8', '', "every attribution row's own declared riskScore matches the mechanically-computed exposure/impact/score/tier", false, 'no attribution matrix (see CXF-3)', {
        detail: 'depends on CXF-3',
      });
      return;
    }
    const lines: string[] = [];
    let ok = true;
    for (const row of attribution) {
      const key = `${String(row.method)} ${String(row.path)}`;
      const verdict = routeVerdicts.get(key);
      if (!verdict) {
        lines.push(`${key}: not a frozen route (see CXF-3)`);
        ok = false;
        continue;
      }
      const riskScore = row.riskScore as { exposure?: unknown; impact?: unknown; score?: unknown; tier?: unknown } | undefined;
      if (!riskScore || typeof riskScore !== 'object') {
        lines.push(`${key}: row has no riskScore object [MISMATCH]`);
        ok = false;
        continue;
      }
      const { exposure, impact, score, tier } = riskScore;
      const rowOk =
        exposure === verdict.exposure &&
        typeof impact === 'number' &&
        impact >= (FROZEN_CALLER_INFLUENCE_FLOORS[key] ?? 0) &&
        score === (exposure as number) + (impact as number) &&
        tier === tierFor(score as number) &&
        tier === verdict.tier;
      if (!rowOk) ok = false;
      lines.push(
        `${key}: row.riskScore={exposure=${String(exposure)} impact=${String(impact)} score=${String(score)} tier=${String(tier)}} mechanical={exposure=${verdict.exposure} impactFloor=${verdict.impactFloor} tier=${verdict.tier}} [${rowOk ? 'OK' : 'MISMATCH'}]`,
      );
    }
    record(
      'CXF-8',
      '',
      "every attribution row's own declared riskScore.exposure matches the mechanically-derived exposure exactly, riskScore.impact meets its frozen floor, riskScore.score/tier are formula-consistent with the row's own declared values AND match the mechanically-computed tier",
      ok,
      lines.join('\n'),
      { detail: ok ? undefined : 'one or more rows’ declared riskScore failed to match the mechanical verdict' },
    );
  });

  const REQUIRED_FIELDS = ['owner', 'authn', 'authz', 'inputValidation', 'sizeRateLimit', 'testRef'] as const;
  await checkCriterion('CXF-4', () => {
    if (!attribution) {
      record('CXF-4', '', 'every row fully structurally attributed', false, 'no attribution matrix (see CXF-3)', {
        detail: 'depends on CXF-3',
      });
      return;
    }
    const decisionsText = fileExistsAtCommit(baseCommit, decisionsRel) ? readFileAtCommit(baseCommit, decisionsRel) : '';
    const acceptedRiskBlocks = parseAcceptedRiskBlocks(decisionsText);
    const commitAuthors = commitAuthorsBetween(baseCommit, headSha);

    let attributed = 0;
    let unattributed = 0;
    let knownVulnerable = 0;
    const problems: string[] = [];
    for (const row of attribution) {
      const key = `${String(row.method)} ${String(row.path)}`;
      const verdict = routeVerdicts.get(key);
      for (const field of REQUIRED_FIELDS) {
        if (isPlaceholderText(row[field])) problems.push(`${key}: field ${field} is placeholder/empty`);
      }
      const authn = typeof row.authn === 'string' ? row.authn : '';
      if (verdict && !exposureKeywordOk(authn, verdict.exposure)) {
        problems.push(`${key}: authn does not name exposure class ${verdict.exposure}`);
      }
      const inputValidation = typeof row.inputValidation === 'string' ? row.inputValidation : '';
      if (verdict && !guardKeywordOk(inputValidation, verdict.guardTier)) {
        problems.push(`${key}: inputValidation does not name guard-tier ${verdict.guardTier} mechanism`);
      }
      const guardTier = verdict?.guardTier ?? 2;
      if (guardTier !== 2) {
        attributed += 1;
        continue;
      }
      const control = row.control as { mechanism?: string; testRef?: string } | undefined;
      const acceptedRisk = row.acceptedRisk as { decisionRef?: string } | undefined;
      if (control && typeof control.mechanism === 'string' && typeof control.testRef === 'string') {
        attributed += 1;
        continue;
      }
      if (acceptedRisk && typeof acceptedRisk.decisionRef === 'string') {
        const ref = acceptedRisk.decisionRef;
        const matchingBlocks = acceptedRiskBlocks.get(ref) ?? [];
        if (matchingBlocks.length !== 1) {
          problems.push(`${key}: acceptedRisk.decisionRef "${ref}" is not a unique heading in DECISIONS.md@baseCommit (count=${matchingBlocks.length})`);
          unattributed += 1;
          continue;
        }
        const block = matchingBlocks[0]!;
        // ROUND-1 FIX (finding 6a): every field is now placeholder-checked,
        // not merely "present" (a bare space or single character used to
        // pass `!accepterM` truthiness). The block is also bound to ITS OWN
        // heading span (parseAcceptedRiskBlocks), so these fields can no
        // longer be borrowed from a neighbouring block.
        if (!block.route) {
          problems.push(`${key}: acceptedRisk block "${ref}" missing Route field`);
          unattributed += 1;
          continue;
        }
        if (isPlaceholderText(block.accepter)) {
          problems.push(`${key}: acceptedRisk block "${ref}" Accepter is missing or placeholder-shaped`);
          unattributed += 1;
          continue;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(block.date)) {
          problems.push(`${key}: acceptedRisk block "${ref}" Date is missing or malformed`);
          unattributed += 1;
          continue;
        }
        if (isPlaceholderText(block.rationale)) {
          problems.push(`${key}: acceptedRisk block "${ref}" Rationale is missing or placeholder-shaped`);
          unattributed += 1;
          continue;
        }
        if (isPlaceholderText(block.acceptedRisk)) {
          problems.push(`${key}: acceptedRisk block "${ref}" Accepted risk is missing or placeholder-shaped`);
          unattributed += 1;
          continue;
        }
        if (block.route !== key) {
          problems.push(`${key}: acceptedRisk block "${ref}" Route field "${block.route}" does not match row key`);
          unattributed += 1;
          continue;
        }
        if (NON_FOUNDER_DENYLIST.has(block.accepter.trim().toLowerCase())) {
          problems.push(`${key}: acceptedRisk block "${ref}" Accepter "${block.accepter}" matches a known non-founder identity`);
          unattributed += 1;
          continue;
        }
        if (commitAuthors.has(block.accepter.trim().toLowerCase())) {
          problems.push(`${key}: acceptedRisk Accepter matches a commit author in baseCommit..HEAD (self-accepted)`);
          unattributed += 1;
          continue;
        }
        knownVulnerable += 1;
        continue;
      }
      unattributed += 1;
      problems.push(`${key}: guard-tier 2 with no control and no acceptedRisk -- UNATTRIBUTED`);
    }
    const ok = problems.length === 0;
    record(
      'CXF-4',
      '',
      'every row clears the placeholder floor, names its mechanical class, and every guard-tier-2 row has a control or a verified accepted risk',
      ok,
      `attributed=${attributed} unattributed=${unattributed} knownVulnerable=${knownVulnerable}\n${problems.join('\n')}`,
      { detail: ok ? undefined : `${problems.length} structural problem(s)` },
    );
  });

  // Global testRef citation map, spanning every row's primary testRef AND control.testRef.
  // NOTE: captured via a local const (rather than testing `attribution` truthiness directly)
  // because `attribution` is reassigned inside a checkCriterion() closure above, and TS's
  // control-flow narrowing across that closure boundary can otherwise collapse this block's
  // type to `never` -- confirmed with a minimal repro against this repo's own tsc.
  const attributionRows: Array<Record<string, unknown>> = attribution ?? [];
  const citationMap = new Map<string, string>(); // fullName -> routeKey
  let citationConflict: string | null = null;
  {
    for (const row of attributionRows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      const primaryRef = typeof row.testRef === 'string' ? row.testRef : null;
      const control = row.control as { testRef?: string } | undefined;
      const controlRef = control && typeof control.testRef === 'string' ? control.testRef : null;
      for (const ref of [primaryRef, controlRef]) {
        if (!ref) continue;
        if (citationMap.has(ref) && citationMap.get(ref) !== key) {
          citationConflict = `testRef "${ref}" cited by both ${citationMap.get(ref)} and ${key}`;
        }
        citationMap.set(ref, key);
      }
    }
  }

  await checkCriterion('CXF-5', async () => {
    if (!attribution) {
      record('CXF-5', '', 'every testRef/control.testRef real, unique, route-associated; new controls replay-verified', false, 'no attribution matrix', {
        detail: 'depends on CXF-3',
      });
      return;
    }
    const testFiles = discoverSsrfTestFiles();
    const suiteRun = runSsrfSuite(testFiles, 2);
    const passingFullNames = new Set(suiteRun.results.flatMap((f) => f.assertions.filter((a) => a.state === 'passed').map((a) => a.fullName)));
    const problems: string[] = [];
    if (citationConflict) problems.push(citationConflict);
    for (const row of attribution) {
      const key = `${String(row.method)} ${String(row.path)}`;
      const primaryRef = typeof row.testRef === 'string' ? row.testRef : null;
      if (primaryRef) {
        if (!passingFullNames.has(primaryRef)) problems.push(`${key}: testRef "${primaryRef}" not found passing in suite run`);
        const terms = routeAssociationTerms(key);
        if (!terms.some((t) => primaryRef.toLowerCase().includes(t.toLowerCase()))) {
          problems.push(`${key}: testRef "${primaryRef}" does not contain a path-derived association term (${terms.join(',')})`);
        }
      }
      const control = row.control as { testRef?: string; mechanism?: string } | undefined;
      if (control?.testRef) {
        if (!passingFullNames.has(control.testRef)) problems.push(`${key}: control.testRef "${control.testRef}" not found passing`);
        // "new" decision -- AST-derived title check at baseCommit across the containing file.
        // ROUND-1 FIX (finding 4d): the whole new-ness/replay check used to be
        // gated on `fileExistsAtCommit(baseCommit, containingFile)` -- for a
        // GENUINELY NEW test file (the exact case S9XF-3's replay requirement
        // exists for), that condition is false, so the entire block was
        // skipped and a brand-new file's tests were silently accepted with
        // zero red-evidence requirement -- the precise opposite of what "new
        // controls carry replayed red evidence" promises. The file-exists
        // check now only decides what `baseTitles` contains (empty set for a
        // file absent at baseCommit, correctly making every title in it
        // "new"); it never gates whether the check runs at all.
        const containingFile = suiteRun.results.find((f) => f.assertions.some((a) => a.fullName === control.testRef))?.file;
        if (containingFile) {
          const baseTitles = fileExistsAtCommit(baseCommit, containingFile)
            ? extractStaticTestTitlesFromSource(readFileAtCommit(baseCommit, containingFile), `${containingFile}@base`)
            : new Set<string>();
          const leafTitle = control.testRef.split(' > ').pop() ?? control.testRef;
          const isNew = !baseTitles.has(leafTitle);
          if (isNew) {
            const redArtifactPath = path.join(repoRoot, 'docs/security/external-fetch-red', `${slugify(control.testRef)}.txt`);
            if (!fs.existsSync(redArtifactPath)) {
              problems.push(`${key}: control.testRef "${control.testRef}" is new (no baseCommit title match, or containing file did not exist at baseCommit) but has no red transcript at ${redArtifactPath}`);
            } else {
              const transcript = parseRedTranscript(fs.readFileSync(redArtifactPath, 'utf8'));
              if (!transcript) {
                problems.push(`${key}: red transcript for "${control.testRef}" is malformed`);
              } else {
                const introduction = findIntroductionCommit(containingFile, leafTitle);
                if (!introduction) {
                  problems.push(`${key}: could not independently determine introduction commit for "${leafTitle}"`);
                } else if (transcript.parentSha !== introduction.firstParent) {
                  problems.push(`${key}: transcript PARENT_SHA does not equal introduction commit's first parent`);
                } else {
                  const replay = await replayRedEvidence(transcript.parentSha, containingFile, control.testRef, transcript.controlTest);
                  if (!replay.ok) problems.push(`${key}: replay failed for "${control.testRef}": ${replay.detail}`);
                }
              }
            }
          }
        } else {
          problems.push(`${key}: control.testRef "${control.testRef}" passed but its containing file could not be identified from the suite run`);
        }
      }
    }
    const ok = problems.length === 0;
    record(
      'CXF-5',
      'suite run + replay pipeline',
      'every testRef/control.testRef real/passing/unique/associated; new controls carry replayed red evidence',
      ok,
      problems.join('\n') || 'no problems found',
      { detail: ok ? undefined : `${problems.length} problem(s)` },
    );
  });

  // ROUND-1 REDESIGN (findings 2a + 5a): per the program-wide binding rule
  // (DECISIONS.md, W9AS-PARK: "a criterion asserting runtime behavior must
  // observe that behavior -- boot the daemon, issue the real request, assert
  // the response"), CXF-6 no longer treats the GUARDED grammar string plus a
  // function-name match as sufficient evidence that a P0 row's guard
  // actually fires. It now BOOTS a real, isolated instance of the actual
  // production daemon (bootIsolatedDaemon -- the same apps/daemon/src/
  // server.ts startServer(), never a reimplementation) and, for every P0 row
  // that claims a `control`, issues the REAL HTTP request the row's own
  // declared `control.probe` describes, with the caller-controlled URL/
  // baseUrl field pointed at a loopback canary listener, and asserts BOTH
  // that the canary received zero connections (the guard never attempted the
  // outbound fetch) and that the daemon's response status is one the row
  // declared as a refusal. `control.probe` is a REQUIRED structural
  // declaration for a P0 `control` row -- "how do I invoke this route" has
  // no proof mechanism besides declaring it (the same principle testRef file
  // paths already rest on) -- but the PROBE'S OUTCOME is never trusted from
  // the declaration; only from actually running it. Pairing: the ACCEPT-side
  // real-transport signal for a controlled row is CXF-5's own requirement
  // that `control.testRef` names a real, currently-passing test (proving the
  // guard's happy path is exercised for real, not just its rejection path);
  // this criterion supplies the REJECT-side signal that CXF-5 cannot (CXF-5
  // only proves a named test passes, never that a live, currently-unguarded
  // route actually refuses an escaping request). The GUARDED grammar + fn
  // binding from the prior draft are RETAINED as a cheap, still-useful
  // pre-check (a probe should never be run against a declaration that
  // doesn't even name the mechanically-found guard), but no longer treated
  // as sufficient on their own.
  await checkCriterion('CXF-6', async () => {
    let daemon: IsolatedDaemonHandle | null = null;
    let canary: CanaryServer | null = null;
    const infraNotes: string[] = [];
    try {
      daemon = await bootIsolatedDaemon();
      canary = await startCanaryServer();
      // Probe-infra self-check: runs even with no attribution matrix, so the
      // boot/probe/teardown pipeline's own soundness is demonstrated
      // regardless of implementation state -- a harmless, always-available
      // route (no auth, no side effect) confirms boot + real HTTP round-trip
      // work before any row-specific probe is trusted.
      const selfCheckUrl = assertSafeLoopbackUrl(new URL('/api/mcp/install-info', daemon.baseUrl).toString());
      const selfCheckResp = await fetch(selfCheckUrl, { redirect: 'manual' });
      infraNotes.push(`probe-infra self-check: GET /api/mcp/install-info -> status=${selfCheckResp.status} (boot+HTTP round-trip OK)`);
      try {
        await selfCheckResp.arrayBuffer();
      } catch {
        /* best effort */
      }

      // RULING 1 condition 1: prove the fetch stub is actually on the path
      // the handler takes -- never assume it from reading safe-fetch.ts's
      // source. POST /api/library/ingest -> fetchRemoteBytes ->
      // fetchExternalBrandAsset is the one call chain named in the finding,
      // and it needs no attribution matrix to exercise, so this runs
      // unconditionally, before any accept-probe result below is trusted.
      await resetTelemetry(daemon);
      const stubProveUrl = assertSafeLoopbackUrl(new URL('/api/library/ingest', daemon.baseUrl).toString());
      const stubProveResp = await fetch(stubProveUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        redirect: 'manual',
        body: JSON.stringify({ url: w9xfAcceptProbeUrl('boot-self-check') }),
      });
      try {
        await stubProveResp.arrayBuffer();
      } catch {
        /* best effort */
      }
      const stubProveTelemetry = await queryTelemetry(daemon);
      const stubInterceptionProven = (stubProveTelemetry.acceptInvocations['boot-self-check'] ?? 0) >= 1;
      infraNotes.push(
        `probe-infra self-check: fetch-stub interception proven=${stubInterceptionProven} (POST /api/library/ingest with a stub-sentinel url; status=${stubProveResp.status}) -- if false, no per-row accept-probe result below can be trusted`,
      );

      let ok: boolean;
      let evidenceBody: string;
      let failDetail: string | undefined;
      if (!stubInterceptionProven) {
        ok = false;
        evidenceBody = infraNotes.join('\n');
        failDetail = 'fetch-stub interception could not be empirically proven at boot -- treated as inconclusive, not silently passed';
      } else if (!attribution) {
        ok = false;
        evidenceBody = infraNotes.join('\n');
        failDetail = 'no attribution matrix (see CXF-3) -- probe infra itself is sound (see evidence), nothing to probe yet';
      } else {
        const p0Keys = [...routeVerdicts.values()].filter((v) => v.tier === 'P0').map((v) => v.routeKey);
        const problems: string[] = [];
        for (const key of p0Keys) {
          const row = attribution.find((r) => `${String(r.method)} ${String(r.path)}` === key);
          const verdict = routeVerdicts.get(key)!;
          if (!row) {
            problems.push(`${key}: P0 route missing from attribution matrix entirely`);
            continue;
          }
          const control = row.control as { mechanism?: string; testRef?: string; probe?: unknown } | undefined;
          const acceptedRisk = row.acceptedRisk as { decisionRef?: string } | undefined;
          if (acceptedRisk) continue; // resolved via accepted risk, already validated by CXF-4
          if (!control?.mechanism) {
            problems.push(`${key}: P0 row has neither control nor acceptedRisk`);
            continue;
          }
          const parsed = parseGuardedDeclaration(control.mechanism);
          if (!parsed) {
            problems.push(`${key}: control.mechanism does not match the GUARDED grammar exactly: "${control.mechanism}"`);
            continue;
          }
          if (parsed.fn !== verdict.mechanism) {
            problems.push(`${key}: declared fn="${parsed.fn}" does not match the mechanically-found mechanism "${verdict.mechanism}"`);
            continue;
          }
          if (!isProbeSpec(control.probe)) {
            problems.push(`${key}: control.probe is missing or not a valid ProbeSpec ({method, path, rejectStatusIn: number[]} required) -- a P0 control cannot be accepted on the GUARDED declaration alone, per the runtime-observation rule`);
            continue;
          }
          const probeResult = await executeSsrfProbe(daemon, canary, control.probe);
          // RULING 3: a reject-only probe cannot distinguish a genuine
          // control from a guard that blindly refuses everything. The
          // positive control below points the SAME field at a stubbed-but-
          // legitimately-public sentinel through the SAME route/guard/
          // handler code path and requires it to actually reach the stub --
          // proof the guard's pre-check discriminates rather than denying
          // blanket.
          const acceptResult = await executeAcceptControlProbe(daemon, control.probe, key);
          if (!probeResult.ok) {
            problems.push(`${key}: live SSRF probe FAILED (guard did not observably fire): ${probeResult.detail}`);
          } else if (!acceptResult.ok) {
            problems.push(`${key}: positive control FAILED (cannot rule out blanket denial): ${acceptResult.detail}`);
          } else {
            infraNotes.push(`${key}: reject probe passed (${probeResult.detail}); accept probe passed (${acceptResult.detail})`);
          }
        }
        ok = problems.length === 0;
        evidenceBody = `P0 routes: ${p0Keys.length}\n${infraNotes.join('\n')}\n${problems.join('\n') || 'no problems found'}`;
        failDetail = ok ? undefined : `${problems.length} problem(s)`;
      }

      // ROUND-1 FIX (finding 7, applied here too): teardown is confirmed
      // BEFORE record() is called, and factored into `ok` -- a failed or
      // partial teardown fails CXF-6 outright, it is never merely logged
      // after the fact once a passing verdict has already been recorded.
      let teardownOk = true;
      let teardownDetail = '';
      if (canary) await canary.close().catch(() => {});
      if (daemon) {
        const stopResult = await stopIsolatedDaemon(daemon);
        teardownOk = stopResult.ok;
        teardownDetail = stopResult.detail;
      }
      const finalOk = ok && teardownOk;
      record(
        'CXF-6',
        '',
        "every P0-tier row's GUARDED declaration is bound to the mechanically-found guard function AND its own declared control.probe is executed live against a real isolated daemon, refusing an escaping target with zero canary hits AND accepting a stubbed-but-legitimately-public positive-control target through the same code path (Ruling 3: rules out blanket denial) -- or a verified accepted risk; fetch-stub interception is empirically proven before any accept-probe result is trusted (Ruling 1); the isolated daemon's own process-tree teardown must also confirm zero survivors",
        finalOk,
        `${evidenceBody}\nteardown: ok=${teardownOk} ${teardownDetail}`,
        { detail: finalOk ? undefined : (failDetail ?? `isolated daemon teardown failed: ${teardownDetail}`) },
      );
    } catch (err) {
      let teardownDetail = 'not attempted (crashed before reaching teardown)';
      if (canary) await canary.close().catch(() => {});
      if (daemon) {
        const stopResult = await stopIsolatedDaemon(daemon).catch((e: unknown) => ({ ok: false, detail: `stop itself threw: ${String(e)}` }));
        teardownDetail = `ok=${stopResult.ok} ${stopResult.detail}`;
      }
      record('CXF-6', '', '', false, `${infraNotes.join('\n')}\nteardown: ${teardownDetail}`, { detail: `CXF-6 crashed: ${String(err)}` });
    }
  });

  await checkCriterion('CXF-7', () => {
    const abs = path.join(repoRoot, threatModelRel);
    if (!fs.existsSync(abs)) {
      record('CXF-7', '', 'threat-model doc extended with a cited, P0-complete "Wave 9 — External fetch" section', false, 'file does not exist', {});
      return;
    }
    const text = fs.readFileSync(abs, 'utf8');
    const sectionM = /## Wave 9 — External fetch\n([\s\S]*?)(?=\n## |\n?$)/.exec(text);
    if (!sectionM) {
      record('CXF-7', '', '', false, '', { detail: 'no "## Wave 9 — External fetch" section found' });
      return;
    }
    const section = sectionM[1] ?? '';
    const bullets = [...section.matchAll(/^- \[CXF-\d+\].*$/gm)].map((m) => m[0]!);
    const p0Keys = [...routeVerdicts.values()].filter((v) => v.tier === 'P0').map((v) => v.routeKey);
    const problems: string[] = [];
    for (const key of p0Keys) {
      // ROUND-1 FIX (finding 5b): exact backtick-token equality, never
      // substring `.includes()` -- `POST /api/brands` is a literal PREFIX of
      // every nested `POST /api/brands/:id/...` route key, so the old
      // substring check made "exactly one matching bullet" structurally
      // impossible to satisfy the moment more than one brand-family bullet
      // existed (this tranche freezes five). Bullets must quote the route
      // key in backticks, exactly, like every other exact-citation mechanism
      // in this file.
      const matching = bullets.filter((b) => extractBacktickTokens(b).includes(key));
      if (matching.length !== 1) {
        problems.push(`P0 route ${key}: expected exactly 1 dedicated bullet naming it as an exact backtick-quoted token, found ${matching.length}`);
        continue;
      }
      const bulletTokens = extractBacktickTokens(matching[0]!);
      const otherP0Named = p0Keys.filter((k) => k !== key && bulletTokens.includes(k));
      if (otherP0Named.length > 0) problems.push(`P0 route ${key}'s bullet also names other P0 routes: ${otherP0Named.join(',')}`);
      // ROUND-1 addition (finding 5b): the prior draft never checked
      // citations at all -- only that the route key's substring appeared
      // somewhere in a bullet's prose. S9XF-3/CXF-7 require the bullet to
      // cite exactly the row's expected reference (control.testRef when
      // controlled, else the primary testRef).
      const row = attribution?.find((r) => `${String(r.method)} ${String(r.path)}` === key);
      if (!row) {
        problems.push(`P0 route ${key}: no attribution row found to determine its expected citation`);
        continue;
      }
      const rowControl = row.control as { testRef?: string } | undefined;
      const expectedRef = typeof rowControl?.testRef === 'string' ? rowControl.testRef : typeof row.testRef === 'string' ? row.testRef : null;
      if (!expectedRef) {
        problems.push(`P0 route ${key}: attribution row has no testRef/control.testRef to cite`);
        continue;
      }
      if (!bulletTokens.includes(expectedRef)) {
        problems.push(`P0 route ${key}'s bullet does not cite its expected reference "${expectedRef}" as an exact backtick-quoted token`);
      }
    }
    const ok = problems.length === 0;
    record('CXF-7', '', 'each P0-tier route has exactly one dedicated, exact-match bullet citing its expected reference exactly', ok, problems.join('\n') || 'no problems found', {
      detail: ok ? undefined : `${problems.length} problem(s)`,
    });
  });

  await checkCriterion('CXF-9', () => {
    const guardR = sh('pnpm', ['guard'], { timeoutMs: 10 * 60_000 });
    const typecheckR = sh('pnpm', ['typecheck'], { timeoutMs: 10 * 60_000 });
    const ok = guardR.status === 0 && typecheckR.status === 0;
    record(
      'CXF-9',
      'pnpm guard && pnpm typecheck',
      'both exit 0 on the current tree',
      ok,
      `guard exit=${guardR.status}\n${guardR.stdout.slice(-4000)}\n${guardR.stderr.slice(-2000)}\n---\ntypecheck exit=${typecheckR.status}\n${typecheckR.stdout.slice(-4000)}\n${typecheckR.stderr.slice(-2000)}`,
      { detail: ok ? undefined : 'guard or typecheck failed' },
    );
  });

  await checkCriterion('CXF-10', () => {
    const abs = path.join(repoRoot, reviewJsonRel);
    if (!fs.existsSync(abs)) {
      record('CXF-10', '', 'adversarial implementation review on record, non-spoofable', false, 'file does not exist', {
        detail: 'expected pre-implementation',
      });
      return;
    }
    let parsed: { reviewer?: string; model?: string; reviewedCommit?: string; verdict?: string };
    try {
      parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (err) {
      record('CXF-10', '', '', false, '', { detail: `JSON parse failed: ${String(err)}` });
      return;
    }
    const { reviewer, model, reviewedCommit, verdict } = parsed;
    const problems: string[] = [];
    // ROUND-1 FIX (finding 6b): `reviewer` used to be checked only for
    // truthiness (`!reviewer`), which a single space or one-character string
    // satisfies -- `model` was destructured but never checked at all. Both
    // now go through the same placeholder floor every other structured field
    // in this file uses, plus the same non-founder-identity denylist accepted
    // risk uses (a self-review recorded as `"reviewer":"reviewer"` no longer
    // passes).
    if (isPlaceholderText(reviewer)) problems.push('reviewer field missing or placeholder-shaped');
    else if (NON_FOUNDER_DENYLIST.has((reviewer ?? '').trim().toLowerCase())) problems.push(`reviewer "${reviewer}" matches a known non-reviewer identity`);
    if (isPlaceholderText(model)) problems.push('model field missing or placeholder-shaped');
    if (!reviewedCommit || !resolveCommit(reviewedCommit)) problems.push('reviewedCommit does not resolve to a real commit');
    else if (!isAncestor(reviewedCommit, headSha) || reviewedCommit === headSha) problems.push('reviewedCommit is not a strict ancestor of HEAD');
    if (verdict !== 'APPROVE') problems.push(`verdict is "${verdict}", expected "APPROVE"`);
    if (reviewedCommit && resolveCommit(reviewedCommit)) {
      // ROUND-1 FIX (finding 6b): the owned-path list omitted
      // routes/chat.ts (the ninth connectionTest.ts-family route family's
      // own source, leased this round) and every test file, so a change to
      // either after the claimed review point would not be detected. The
      // glob pathspec matches this file's own "Definition of green" §9 list.
      const OWNED_PATHS = [
        'apps/daemon/src/mcp-oauth.ts',
        'apps/daemon/src/deploy.ts',
        'apps/daemon/src/media/index.ts',
        'apps/daemon/src/integrations/elevenlabs-voices.ts',
        'apps/daemon/src/byok-tools.ts',
        'apps/daemon/src/design-systems/shadcn-import.ts',
        'apps/daemon/src/routes/chat.ts',
        'apps/daemon/tests/*.test.ts',
        attribJsonRel,
        threatModelRel,
      ];
      const diff = sh('git', ['diff', '--name-only', reviewedCommit, headSha, '--', ...OWNED_PATHS]);
      if (diff.stdout.trim().length > 0) problems.push(`owned-path diff between reviewedCommit and HEAD is non-empty: ${diff.stdout.trim()}`);
      const authors = commitAuthorsBetween(baseCommit, reviewedCommit);
      if (reviewer && authors.has(reviewer.trim().toLowerCase())) problems.push('reviewer matches a commit author in baseCommit..reviewedCommit');
      // ROUND-1 addition (finding 6b): "the review record itself" was an
      // omitted check -- nothing previously proved the review record was
      // authored STRICTLY AFTER the commit it claims to review, so an
      // implementer could commit the implementation AND a self-authored,
      // internally-consistent review record together in one shot, timed so
      // `reviewedCommit` simply points at that same commit's own parent (or
      // any earlier ancestor) with an owned-path diff that happens to be
      // empty by construction. Requiring the review-record file to be ABSENT
      // at reviewedCommit proves the record was genuinely added afterward.
      if (fileExistsAtCommit(reviewedCommit, reviewJsonRel)) {
        problems.push('the review record already existed AT reviewedCommit -- it must be introduced strictly after, in a separate later commit, never bundled with the state it claims to review');
      }
    }
    const ok = problems.length === 0;
    record('CXF-10', '', 'reviewedCommit strict ancestor of HEAD, owned-path diff empty, reviewer+model non-placeholder and non-denylisted, review record absent at reviewedCommit, verdict APPROVE', ok, problems.join('\n') || 'no problems found', {
      detail: ok ? undefined : `${problems.length} problem(s)`,
    });
  });

  // =======================================================================
  // CXF-11 (routed finding, absorbed round 2): fetchRemoteBytes in
  // apps/daemon/src/routes/library.ts:112 checks the DECLARED Content-Length
  // (an attacker-controlled or absent header) before fetch, then fully
  // materializes the body via resp.arrayBuffer() BEFORE the real length is
  // ever checked -- a response that omits or lies about Content-Length is
  // buffered without bound. Independent of the attribution matrix: this
  // probes the actual production function's memory behavior directly, not a
  // PRD-declared claim about it, so it can genuinely pass or fail today.
  //
  // Per Ruling 1 (approved with conditions): the ONLY deviation from real
  // production code is the transport. Route dispatch, the SSRF pre-check
  // (assertPublicBrandUrl -- genuinely evaluated against a real public IP
  // literal, no DNS, no bypass), and fetchRemoteBytes itself all run for
  // real inside a real booted daemon. globalThis.fetch is stubbed to return
  // a genuine ReadableStream Response that streams past MAX_REMOTE_BYTES
  // while declaring no Content-Length -- the transport is the seam, the
  // buffering DECISION is what's under test (condition 4: stated here and
  // in the recorded evidence, never implied).
  //
  // POSITIVE CONTROL, in the SAME run as the negative control above: an
  // ordinary, genuinely in-bounds transfer (12 KiB, also declaring no
  // Content-Length -- same code path, same seam) must complete normally.
  // This is a vacuity guard, not decoration -- without it, a measurement
  // mechanism that always reports "unbounded" regardless of input (or a
  // fix that overzealously cancels every transfer, in-bounds or not) would
  // make the leak probe alone pass or fail for the wrong reason. The
  // criterion only PASSES when it can show BOTH discriminating outcomes in
  // one run: the oversized transfer bounded/rejected AND the ordinary
  // transfer completing untouched.
  // =======================================================================
  await checkCriterion('CXF-11', async () => {
    let daemon: IsolatedDaemonHandle | null = null;
    const infraNotes: string[] = [];
    try {
      daemon = await bootIsolatedDaemon();
      const maxRemoteBytes = extractMaxRemoteBytesConstant();
      const hardCap = maxRemoteBytes + 10 * 1024 * 1024;
      const slack = 4 * 1024 * 1024; // tolerance for reasonable chunked-read overshoot before an abort takes effect
      await resetTelemetry(daemon);
      const url = assertSafeLoopbackUrl(new URL('/api/library/ingest', daemon.baseUrl).toString());
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        redirect: 'manual',
        body: JSON.stringify({ url: W9XF_LEAK_PROBE_URL }),
      });
      try {
        await resp.arrayBuffer();
      } catch {
        /* best effort -- the daemon's own response body is not what we're measuring */
      }
      // Grace period: let any async reader.cancel()/abort still in flight
      // settle before reading the byte count it produced.
      await new Promise((resolve) => setTimeout(resolve, 400));
      const telemetry = await queryTelemetry(daemon);
      const leak = telemetry.leak;
      // RULING 1 condition 2: the assertion is the OBSERVABLE CONSEQUENCE
      // (how many bytes the stream actually delivered before the transfer
      // stopped growing), never "a streaming API was called". bytesEnqueued
      // only grows when the CONSUMER pulls more (ReadableStream's pull() is
      // demand-driven), so it is a direct measure of what fetchRemoteBytes
      // actually consumed, whether or not it called an explicit cancel().
      const bounded = leak.bytesEnqueued <= maxRemoteBytes + slack && leak.bytesEnqueued < hardCap;
      infraNotes.push(
        `[SEAM: transport stubbed for one sentinel leak-probe URL only -- route /api/library/ingest, its SSRF pre-check, and fetchRemoteBytes are real production code] ` +
          `MAX_REMOTE_BYTES=${maxRemoteBytes} slack=${slack} hardCap=${hardCap} bytesEnqueued=${leak.bytesEnqueued} sawCancel=${leak.sawCancel} cancelledAtBytes=${leak.cancelledAtBytes} streamClosedAtHardCap=${leak.streamClosed} daemonResponseStatus=${resp.status}`,
      );
      infraNotes.push(
        bounded
          ? 'bounded: the stream stopped being pulled at/near MAX_REMOTE_BYTES -- transfer-time enforcement, not a post-materialization re-check'
          : 'UNBOUNDED: the stream was pulled to (or past) the hard safety cap without the consumer stopping near MAX_REMOTE_BYTES -- this run, against the CURRENT unfixed production code, is the negative-control demonstration Ruling 1 condition 3 requires: a criterion that does not fail here would itself be broken',
      );

      // POSITIVE CONTROL: same call chain, a sentinel that streams a small,
      // genuinely in-bounds total (12 KiB, well under MAX_REMOTE_BYTES) and
      // closes on its own. Run in the SAME daemon instance, same probe run,
      // right after the negative control above.
      await resetTelemetry(daemon);
      const okResp = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        redirect: 'manual',
        body: JSON.stringify({ url: W9XF_OK_PROBE_URL }),
      });
      let okBody: unknown;
      try {
        okBody = await okResp.json();
      } catch {
        /* best effort */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      const okTelemetry = await queryTelemetry(daemon);
      const okLeak = okTelemetry.ok;
      const okExpectedBytes = 3 * 4096;
      const positiveControlPassed =
        okResp.status === 200 && okLeak.streamClosed && !okLeak.sawCancel && okLeak.bytesEnqueued === okExpectedBytes;
      infraNotes.push(
        `[SEAM: transport stubbed for one sentinel ok-probe URL only -- same route/guard/fetchRemoteBytes code path as the leak probe above] ` +
          `expectedBytes=${okExpectedBytes} bytesEnqueued=${okLeak.bytesEnqueued} sawCancel=${okLeak.sawCancel} streamClosed=${okLeak.streamClosed} daemonResponseStatus=${okResp.status} assetId=${okBody && typeof okBody === 'object' && 'asset' in okBody ? String((okBody as { asset?: { id?: unknown } }).asset?.id ?? '') : '(none)'}`,
      );
      infraNotes.push(
        positiveControlPassed
          ? 'POSITIVE CONTROL PASSED: the ordinary in-bounds transfer completed untouched (full expected byte count delivered, no cancellation, HTTP 200) in the same run as the negative control -- proves the mechanism discriminates rather than always reporting unbounded or cancelling everything'
          : 'POSITIVE CONTROL FAILED: an ordinary in-bounds transfer did NOT complete normally -- either the measurement mechanism itself is broken, or a fix is overzealously cancelling transfers that were never over the limit',
      );

      const ok = bounded && positiveControlPassed;
      let teardownOk = true;
      let teardownDetail = '';
      if (daemon) {
        const stopResult = await stopIsolatedDaemon(daemon);
        teardownOk = stopResult.ok;
        teardownDetail = stopResult.detail;
      }
      const finalOk = ok && teardownOk;
      record(
        'CXF-11',
        '',
        'fetchRemoteBytes bounds the TRANSFER as it streams (aborts once the running total crosses MAX_REMOTE_BYTES) rather than re-checking length only after resp.arrayBuffer() has already fully materialized the body -- asserted at runtime against a real booted daemon: a negative control (a response streaming past MAX_REMOTE_BYTES with no Content-Length) must be bounded/rejected, AND a positive control (an ordinary in-bounds transfer, same code path) must complete untouched in the same run -- by measuring bytes actually delivered, not by inspecting source for a streaming API call',
        finalOk,
        `${infraNotes.join('\n')}\nteardown: ok=${teardownOk} ${teardownDetail}`,
        {
          detail: finalOk
            ? undefined
            : !teardownOk
              ? `isolated daemon teardown failed: ${teardownDetail}`
              : !bounded
                ? 'fetchRemoteBytes buffered past MAX_REMOTE_BYTES + slack before ever checking length'
                : 'positive control failed -- an ordinary in-bounds transfer did not complete untouched (see evidence)',
        },
      );
    } catch (err) {
      let teardownDetail = 'not attempted (crashed before reaching teardown)';
      if (daemon) {
        const stopResult = await stopIsolatedDaemon(daemon).catch((e: unknown) => ({ ok: false, detail: `stop itself threw: ${String(e)}` }));
        teardownDetail = `ok=${stopResult.ok} ${stopResult.detail}`;
      }
      record('CXF-11', '', '', false, `${infraNotes.join('\n')}\nteardown: ${teardownDetail}`, { detail: `CXF-11 crashed: ${String(err)}` });
    }
  });

  // =======================================================================
  // GATE-INTEGRITY / LEASE / HEAD-DRIFT
  // =======================================================================
  await checkCriterion('GATE-INTEGRITY', () => {
    const selfPath = process.argv[1] ? path.resolve(process.argv[1]) : path.join(repoRoot, 'scripts/waves/verify-w9-external-fetch.ts');
    let selfSha256: string;
    try {
      selfSha256 = sha256File(selfPath);
    } catch (err) {
      record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', false, '', { detail: `could not hash self at ${selfPath}: ${String(err)}` });
      return;
    }
    const approvedHashPath = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256');
    if (!gateIntegrityPinned) {
      record(
        'GATE-INTEGRITY',
        '',
        'defense-in-depth self-hash check',
        true,
        `sha256: ${selfSha256}\nUNPINNED -- no approved-gate.sha256 present. See manifest.gateIntegrityPinned=false.`,
      );
      return;
    }
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === selfSha256;
    record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', gateOk, `sha256: ${selfSha256}\napproved: ${approved}\nPINNED`, {
      detail: gateOk ? undefined : 'verify-w9-external-fetch.ts modified since orchestrator approval',
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
      record('LEASE', `git show ${baseCommit}:docs/plans/waves/leases.json`, 'no writes outside the W9-external-fetch lease, read from baseCommit', false, '', {
        detail: `could not read/parse leases.json at baseCommit: ${String(err)}`,
      });
      return;
    }
    const lease = leasesRaw.waves['W9-external-fetch'];
    if (!lease) {
      record('LEASE', '', '', false, '', {
        detail: 'no "W9-external-fetch" entry in leases.json@baseCommit -- expected until this PRD lands and the proposed lease (see the PRD\'s "Proposed lease" section) is transcribed in',
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
      `git diff --name-only ${baseCommit}...HEAD subset-of leases.json[W9-external-fetch] read via git show`,
      'no writes outside the W9-external-fetch lease, read from baseCommit',
      violations.length === 0,
      violations.join('\n') || (diffNames.length === 0 ? 'no diff between baseCommit and HEAD' : `all ${diffNames.length} changed files inside the lease`),
      {
        detail:
          violations.length === 0
            ? undefined
            : "this document (docs/plans/waves/W9-external-fetch-tranche.md) and this verifier are DENIED to the implementer per the PRD's proposed lease -- expected to self-resolve once this PRD lands on main and a later implementation branch's baseCommit includes it with the proposed lease actually granted",
      },
    );
  });

  const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  await checkCriterion('HEAD-DRIFT', () => {
    record('HEAD-DRIFT', 'git rev-parse HEAD (re-resolved at end)', 'HEAD must not move during the run', headShaFinal === headSha, `initial=${headSha} final=${headShaFinal}`, {
      detail: headShaFinal === headSha ? undefined : 'HEAD moved during the run',
    });
  });

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
  console.log(
    `\nverify-w9-external-fetch: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty}, wroteOk=true, gateIntegrityPinned=${gateIntegrityPinned}, archiveOk=${archiveResult.ok})`,
  );
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
