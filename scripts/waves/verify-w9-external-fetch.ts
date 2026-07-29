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
// profile, ROUTE_TARGET_FILES) and the GUARDED declaration grammar. Both are
// first-draft mechanisms that have not been through adversarial review --
// see W9-external-fetch-tranche.md's "Adversarial review" residuals section.
//
// PORTABILITY: repoRoot comes from `process.cwd()`/`--repo`, never
// `import.meta.url`. Isolation: every daemon/worktree this verifier creates
// is isolated (port 0, fresh mkdtemp data dirs, detached temp worktrees) and
// torn down by its own exact handle. This verifier never touches a
// default-namespace daemon and never issues a `git fetch`/`git push` -- git
// context is resolved from local refs only.

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
/** Straight-line prefix check: 0/1/2/3 per S9XF-2. Same semantics as verify-w9-ingest.ts's classifyExposure. */
function classifyRouteExposure(handler: TsNode): number {
  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) return 3;
  const body = handler.body;
  if (!ts.isBlock(body)) return 3;
  const stmts = body.statements;
  const paramNames = handler.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : null));
  let idx = 0;
  if (stmts[0] && isCorsPrelude(stmts[0], paramNames)) idx = 1;
  if (matchToolTokenGuard(stmts, idx)) return 1;
  if (matchBearerGuard(stmts, idx)) {
    return isLocalSameOriginReachable(body) ? 3 : 2;
  }
  return isLocalSameOriginReachable(body) ? 3 : 3;
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
};

// Frozen, reviewer-owned caller-influence (impact) floors, per S9XF-2. Keys
// MUST equal ROUTE_TARGET_FILES' keys exactly (checked, CXF-1).
const FROZEN_CALLER_INFLUENCE_FLOORS: Record<string, number> = {
  'POST /api/mcp/oauth/start': 3,
  'POST /api/projects/:id/deployments/:deploymentId/check-link': 3,
  'POST /api/projects/:id/media/generate': 3,
  'POST /api/tools/media/generate': 3,
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
  'POST /api/live-artifacts/:artifactId/refresh': 3,
  'POST /api/tools/live-artifacts/refresh': 3,
  'POST /api/provider/models': 2,
  'POST /api/test/connection': 2,
  'POST /api/proxy/anthropic/stream': 2,
  'POST /api/proxy/openai/stream': 2,
  'POST /api/proxy/azure/stream': 2,
  'POST /api/proxy/google/stream': 2,
  'POST /api/proxy/ollama/stream': 2,
  'POST /api/proxy/senseaudio/stream': 2,
  'POST /api/proxy/aihubmix/stream': 2,
};
const FROZEN_ROUTE_KEYS = new Set(Object.keys(FROZEN_CALLER_INFLUENCE_FLOORS));
function tierFor(score: number): 'P0' | 'P1' | 'P2' {
  if (score >= 5) return 'P0';
  if (score === 4) return 'P1';
  return 'P2';
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
function routeAssociationTerms(routeKey: string): string[] {
  const pathPart = routeKey.split(' ')[1] ?? routeKey;
  return pathPart
    .split('/')
    .map((seg) => seg.replace(/[:{}]/g, ''))
    .filter((seg) => seg.length > 1 && !/^[a-z]{1,2}$/.test(seg));
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
const SSRF_TEST_FILE_GLOB_PREFIXES = [
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
];
function discoverSsrfTestFiles(): string[] {
  const testsDir = path.join(repoRoot, 'apps/daemon/tests');
  if (!fs.existsSync(testsDir)) return [];
  return fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith('.test.ts') && SSRF_TEST_FILE_GLOB_PREFIXES.some((p) => f === `${p}.test.ts`))
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
  const results: FileTestResult[] = parsed.testResults.map((tr) => ({
    file: tr.name,
    assertions: tr.assertionResults.map((a) => ({ fullName: a.fullName, state: a.status })),
    hasSkipOrOnlyOrTodo: tr.assertionResults.some((a) => a.status === 'pending' || a.status === 'todo'),
  }));
  const allPassed = results.every((f) => f.assertions.every((a) => a.state === 'passed') && !f.hasSkipOrOnlyOrTodo);
  return { ok: allPassed && r.status === 0, results, raw };
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
function replayRedEvidence(parentSha: string, containingFileRel: string, targetFullName: string, controlFullName: string): ReplayOutcome {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-w9xf-replay-'));
  const worktreeDir = path.join(tmpBase, 'wt');
  try {
    const addR = sh('git', ['worktree', 'add', '--detach', worktreeDir, parentSha]);
    if (addR.status !== 0) return { ok: false, detail: `git worktree add failed: ${addR.stderr}` };
    try {
      sh('mise', ['trust'], { cwd: worktreeDir, timeoutMs: 60_000 });
      const install = sh('pnpm', ['install', '--offline', '--frozen-lockfile'], { cwd: worktreeDir, timeoutMs: 5 * 60_000 });
      if (install.status !== 0) return { ok: false, detail: `frozen offline install failed: ${install.stderr.slice(0, 2000)}` };
      const headFileAbs = path.join(repoRoot, containingFileRel);
      const worktreeFileAbs = path.join(worktreeDir, containingFileRel);
      fs.mkdirSync(path.dirname(worktreeFileAbs), { recursive: true });
      fs.copyFileSync(headFileAbs, worktreeFileAbs);
      const marker = generateReplayMarker();
      const daemonRoot = path.join(worktreeDir, 'apps/daemon');
      const runnerScript = buildReplayRunnerScript(marker, worktreeFileAbs, daemonRoot);
      const runnerPath = path.join(tmpBase, 'runner.mjs');
      fs.writeFileSync(runnerPath, runnerScript);
      const run = sh('node', [runnerPath], { cwd: daemonRoot, timeoutMs: 3 * 60_000 });
      const startTag = `REPLAY_${marker}_START`;
      const endTag = `REPLAY_${marker}_END`;
      const startIdx = run.stdout.indexOf(startTag);
      const endIdx = run.stdout.indexOf(endTag);
      const occurrences = run.stdout.split(startTag).length - 1;
      if (occurrences !== 1 || startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
        return { ok: false, detail: `marker did not appear exactly once (occurrences=${occurrences})` };
      }
      const jsonLine = run.stdout.slice(startIdx + startTag.length, endIdx).trim();
      let forest: SerializedReplayForest;
      try {
        forest = JSON.parse(jsonLine) as SerializedReplayForest;
      } catch {
        return { ok: false, detail: 'could not parse serialized replay forest' };
      }
      if (run.status === 0) return { ok: false, detail: 'replay process exited 0 -- no red evidence' };
      const consistency = evaluateTaskForestConsistency(forest, targetFullName, controlFullName);
      if (!consistency.ok) return { ok: false, detail: consistency.reason };
      return { ok: true, detail: `replay consistent, parentSha=${parentSha}, exit=${run.status}` };
    } finally {
      sh('git', ['worktree', 'remove', '--force', worktreeDir]);
    }
  } finally {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
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
    const dupCheck = new Map<string, string>();
    let dupError: string | null = null;
    for (const target of FROZEN_REGISTRATION_TARGETS) {
      if (!fileExistsAtCommit(baseCommit, target.file)) continue;
      const text = readFileAtCommit(baseCommit, target.file);
      const regs = collectRouteRegistrationsFromFunction(text, target.file, target.fn, `${target.file}@${baseCommit}`);
      for (const reg of regs) {
        const key = `${reg.method} ${reg.path}`;
        if (!FROZEN_ROUTE_KEYS.has(key)) continue;
        if (dupCheck.has(key) && dupCheck.get(key) !== target.file) {
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
        if (headDupCheck.has(key) && headDupCheck.get(key) !== target.file) {
          headDupError = `duplicate registration ${key} in ${headDupCheck.get(key)} and ${target.file}`;
        }
        headDupCheck.set(key, target.file);
      }
    }

    const ok =
      failedProbes.length === 0 &&
      dupError === null &&
      headDupError === null &&
      missingFromBase.length === 0 &&
      extraInBase.length === 0 &&
      missingAtHead.length === 0;

    record(
      'CXF-1',
      `AST scan of ${FROZEN_REGISTRATION_TARGETS.length} frozen registration functions at baseCommit=${baseCommit} and HEAD`,
      'frozen route set self-consistent with FROZEN_CALLER_INFLUENCE_FLOORS; no duplicates at baseCommit or HEAD; no drift between baseCommit and HEAD; all self-probes pass',
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
      ].join('\n'),
      { detail: ok ? undefined : 'see evidence for the specific self-consistency/drift/duplicate failure' },
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

  // Per-route mechanical guard-tier + risk score, computed once, reused by CXF-3..CXF-8.
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

  await checkCriterion('CXF-8', () => {
    const lines: string[] = [];
    let ok = true;
    for (const [key, v] of routeVerdicts) {
      const expectedScore = v.exposure + v.impactFloor;
      const expectedTier = tierFor(expectedScore);
      const rowOk = v.score === expectedScore && v.tier === expectedTier && v.impactFloor >= (FROZEN_CALLER_INFLUENCE_FLOORS[key] ?? 0);
      if (!rowOk) ok = false;
      lines.push(`${key}: exposure=${v.exposure} impact=${v.impactFloor} score=${v.score} tier=${v.tier} guardTier=${v.guardTier} [${rowOk ? 'OK' : 'MISMATCH'}]`);
    }
    record('CXF-8', '', 'exposure+impact=score, tier=tierFor(score), impact>=floor for every frozen route', ok, lines.join('\n'), {
      detail: ok ? undefined : 'one or more rows failed the formula check',
    });
  });

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
      'attribution matrix covers exactly the 30 frozen routes, no orphans/gaps/duplicates',
      ok,
      `rows=${keys.length} frozen=${FROZEN_ROUTE_KEYS.size}\ndupes=${dupes.join(',')}\norphans=${orphans.join(',')}\ngaps=${gaps.join(',')}`,
      { detail: ok ? undefined : 'row-set mismatch' },
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
    const acceptHeadings = [...decisionsText.matchAll(/^### (W9XF-ACCEPT-[A-Za-z0-9-]+)\s*$/gm)].map((m) => m[1]!);
    const headingCounts = new Map<string, number>();
    for (const h of acceptHeadings) headingCounts.set(h, (headingCounts.get(h) ?? 0) + 1);
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
        const count = headingCounts.get(ref) ?? 0;
        if (count !== 1) {
          problems.push(`${key}: acceptedRisk.decisionRef "${ref}" is not a unique heading in DECISIONS.md@baseCommit (count=${count})`);
          unattributed += 1;
          continue;
        }
        const block = decisionsText.slice(decisionsText.indexOf(`### ${ref}`));
        const routeM = /^- Route:\s*`(.+)`/m.exec(block);
        const accepterM = /^- Accepter:\s*(.+)$/m.exec(block);
        const dateM = /^- Date:\s*(\d{4}-\d{2}-\d{2})/m.exec(block);
        const rationaleM = /^- Rationale:\s*(.+)$/m.exec(block);
        const riskM = /^- Accepted risk:\s*(.+)$/m.exec(block);
        if (!routeM || !accepterM || !dateM || !rationaleM || !riskM) {
          problems.push(`${key}: acceptedRisk block "${ref}" missing a required field`);
          unattributed += 1;
          continue;
        }
        if (routeM[1] !== key) {
          problems.push(`${key}: acceptedRisk block "${ref}" Route field "${routeM[1]}" does not match row key`);
          unattributed += 1;
          continue;
        }
        if (commitAuthors.has((accepterM[1] ?? '').trim().toLowerCase())) {
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
        const containingFile = suiteRun.results.find((f) => f.assertions.some((a) => a.fullName === control.testRef))?.file;
        if (containingFile && fileExistsAtCommit(baseCommit, containingFile)) {
          const baseTitles = extractStaticTestTitlesFromSource(readFileAtCommit(baseCommit, containingFile), `${containingFile}@base`);
          const leafTitle = control.testRef.split(' > ').pop() ?? control.testRef;
          const isNew = !baseTitles.has(leafTitle);
          if (isNew) {
            const redArtifactPath = path.join(repoRoot, 'docs/security/external-fetch-red', `${slugify(control.testRef)}.txt`);
            if (!fs.existsSync(redArtifactPath)) {
              problems.push(`${key}: control.testRef "${control.testRef}" is new (no baseCommit title match) but has no red transcript at ${redArtifactPath}`);
            } else {
              const transcript = parseRedTranscript(fs.readFileSync(redArtifactPath, 'utf8'));
              if (!transcript) {
                problems.push(`${key}: red transcript for "${control.testRef}" is malformed`);
              } else {
                const introduction = containingFile ? findIntroductionCommit(containingFile, leafTitle) : null;
                if (!introduction) {
                  problems.push(`${key}: could not independently determine introduction commit for "${leafTitle}"`);
                } else if (transcript.parentSha !== introduction.firstParent) {
                  problems.push(`${key}: transcript PARENT_SHA does not equal introduction commit's first parent`);
                } else {
                  const replay = replayRedEvidence(transcript.parentSha, containingFile, control.testRef, transcript.controlTest);
                  if (!replay.ok) problems.push(`${key}: replay failed for "${control.testRef}": ${replay.detail}`);
                }
              }
            }
          }
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

  await checkCriterion('CXF-6', () => {
    if (!attribution) {
      record('CXF-6', '', 'every P0 row has a real, mechanically-matched GUARDED control or accepted risk', false, 'no attribution matrix', {
        detail: 'depends on CXF-3',
      });
      return;
    }
    const p0Keys = [...routeVerdicts.values()].filter((v) => v.tier === 'P0').map((v) => v.routeKey);
    const problems: string[] = [];
    for (const key of p0Keys) {
      const row = attribution.find((r) => `${String(r.method)} ${String(r.path)}` === key);
      const verdict = routeVerdicts.get(key)!;
      if (!row) {
        problems.push(`${key}: P0 route missing from attribution matrix entirely`);
        continue;
      }
      const control = row.control as { mechanism?: string; testRef?: string } | undefined;
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
      }
    }
    const ok = problems.length === 0;
    record(
      'CXF-6',
      '',
      'every P0-tier row resolves its guard via the anchored GUARDED grammar, bound to the mechanically-found guard function, or a verified accepted risk',
      ok,
      `P0 routes: ${p0Keys.length}\n${problems.join('\n') || 'no problems found'}`,
      { detail: ok ? undefined : `${problems.length} problem(s)` },
    );
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
      const matching = bullets.filter((b) => b.includes(key));
      if (matching.length !== 1) {
        problems.push(`P0 route ${key}: expected exactly 1 dedicated bullet naming it, found ${matching.length}`);
        continue;
      }
      const otherP0Named = p0Keys.filter((k) => k !== key && matching[0]!.includes(k));
      if (otherP0Named.length > 0) problems.push(`P0 route ${key}'s bullet also names other P0 routes: ${otherP0Named.join(',')}`);
    }
    const ok = problems.length === 0;
    record('CXF-7', '', 'each P0-tier route has exactly one dedicated, exact-match bullet', ok, problems.join('\n') || 'no problems found', {
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
    const { reviewer, reviewedCommit, verdict } = parsed;
    const problems: string[] = [];
    if (!reviewedCommit || !resolveCommit(reviewedCommit)) problems.push('reviewedCommit does not resolve to a real commit');
    else if (!isAncestor(reviewedCommit, headSha) || reviewedCommit === headSha) problems.push('reviewedCommit is not a strict ancestor of HEAD');
    if (verdict !== 'APPROVE') problems.push(`verdict is "${verdict}", expected "APPROVE"`);
    if (reviewedCommit && resolveCommit(reviewedCommit)) {
      const OWNED_PATHS = [
        'apps/daemon/src/mcp-oauth.ts',
        'apps/daemon/src/deploy.ts',
        'apps/daemon/src/media/index.ts',
        'apps/daemon/src/integrations/elevenlabs-voices.ts',
        'apps/daemon/src/byok-tools.ts',
        'apps/daemon/src/design-systems/shadcn-import.ts',
        attribJsonRel,
        threatModelRel,
      ];
      const diff = sh('git', ['diff', '--name-only', reviewedCommit, headSha, '--', ...OWNED_PATHS]);
      if (diff.stdout.trim().length > 0) problems.push(`owned-path diff between reviewedCommit and HEAD is non-empty: ${diff.stdout.trim()}`);
      const authors = commitAuthorsBetween(baseCommit, reviewedCommit);
      if (reviewer && authors.has(reviewer.trim().toLowerCase())) problems.push('reviewer matches a commit author in baseCommit..reviewedCommit');
      if (!reviewer) problems.push('reviewer field missing');
    }
    const ok = problems.length === 0;
    record('CXF-10', '', 'reviewedCommit strict ancestor of HEAD, owned-path diff empty, reviewer distinct, verdict APPROVE', ok, problems.join('\n') || 'no problems found', {
      detail: ok ? undefined : `${problems.length} problem(s)`,
    });
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
