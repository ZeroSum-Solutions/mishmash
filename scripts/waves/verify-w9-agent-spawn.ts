// verify-w9-agent-spawn.ts -- wave mishmash-w9-agent-spawn-tranche (agent-spawn
// route hardening, first/highest-risk of the rolling W9 tranches per
// W5-W11-gated.md's "agent spawn -> filesystem -> deploy -> external fetch ->
// Library ingest -> imports -> long tail" ordering) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w9-agent-spawn.ts [--repo <path>]
// Exit 0 only when every C9S criterion passes, LEASE/HEAD-DRIFT pass, the
// tree is clean, the initial manifest placeholder wrote successfully, and
// archival succeeded (construct + reread-verify). The commit-bound proof
// manifest is written to the wave's goal-state proof directory either way.
//
// THIS IS A ROUND-0 (PRE-IMPLEMENTATION) VERIFIER, written and frozen per the
// NM-41C expansion gate (W5-W11-gated.md lines 8-24) BEFORE any implementation
// work on apps/daemon/src/routes/runs.ts exists. It is expected -- and
// correct, fail-closed behavior -- for every substantive C9S criterion except
// C9S-1 to report FAIL against the current tree: the attribution matrix, the
// new red-team test file, the threat-model doc extension, and the
// implementation-review record are all implementation deliverables this
// document specifies but does not itself create. C9S-1 (route-inventory
// freeze) is expected to PASS today, because it only asserts that this
// document's own frozen route table matches reality -- a property of the
// PRD's own accuracy, not of unfinished hardening work. Mirrors exactly how
// scripts/waves/verify-w9-ingest.ts's own criteria are structured (inventory
// freeze vs. substantive hardening are different kinds of claims).
//
// DELIBERATE SCOPE REDUCTIONS vs. the verify-w9-ingest.ts house precedent
// (each flagged as an open question in W9-agent-spawn-tranche.md for the
// adversarial reviewer to rule on, not silently decided here):
//   1. Exposure classifier is 3-valued (0/1/3), not 4-valued -- this
//      codebase has exactly two existing auth primitives that plausibly
//      apply to inbound run-creation auth (requireLocalDaemonRequest,
//      authorizeToolRequest); no third "self-service bearer" shape exists
//      yet to bind an intermediate value to.
//   2. The "is this cited test genuinely new, and did it fail on its
//      introduction commit's parent" check implements the introduction-
//      commit AST lookup (real, mechanical) and validates the checked-in
//      red-evidence transcript structurally, but does NOT implement
//      verify-w9-ingest.ts's full detached-worktree Vitest-Node-API replay.
//      That machinery is substantial (it took the ingest tranche multiple
//      adversarial rounds to harden) and nothing exists yet for it to
//      replay against in this tranche's current, pre-implementation tree.
//
// ISOLATION (hard rule, non-negotiable): every daemon boot this verifier
// performs uses port 0 (OS-assigned ephemeral -- strictly stronger than
// picking "a random high port", which can still collide) and a fresh
// fs.mkdtempSync OD_DATA_DIR, and is torn down by its own exact child PID
// (SIGTERM then a bounded SIGKILL fallback) -- never a process scan, never
// the default namespace (ports 7456 / 51012). This verifier never issues a
// `git fetch`/`git push` -- git context is resolved from local refs only.
//
// PORTABILITY: repoRoot comes from `process.cwd()`/`--repo`, never
// `import.meta.url`.

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

// Distinguishes a spawn failure / timeout-induced kill (spawnSync sets
// `.error` and/or a non-null `.signal` in those cases) from an ORDINARY
// nonzero exit code, so a caller checking only `status !== 0` cannot
// mistake "the process never really ran" for "the process ran and failed".
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
function fileExistsAtCommit(commit: string, relPath: string): boolean {
  return sh('git', ['cat-file', '-e', `${commit}:${relPath}`]).status === 0;
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
// Route collector -- AST-scoped to registerRunRoutes's own function body.
// Recursive ts.forEachChild walk (never a whole-file text scan, so an
// identifier inside a comment cannot leak in -- comments are lexer trivia a
// forEachChild walk never visits).
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

function collectRunRouteRegistrations(sourceText: string, label: string): CollectResult {
  const sourceFile = ts.createSourceFile(label, sourceText, ts.ScriptTarget.Latest, true);
  const fnBody = findFunctionBody(sourceFile, 'registerRunRoutes');
  if (!fnBody) throw new Error(`registerRunRoutes function body not found in ${label}`);
  const registrations: RouteRegistration[] = [];
  const counts = new Map<string, number>();
  const visit = (node: TsNode) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'app' &&
      ts.isIdentifier(node.expression.name) &&
      HTTP_METHODS.has(node.expression.name.text)
    ) {
      const method = node.expression.name.text.toUpperCase();
      const args = [...node.arguments];
      const pathArg = args[0];
      if (args.length >= 2 && pathArg && (ts.isStringLiteral(pathArg) || ts.isNoSubstitutionTemplateLiteral(pathArg))) {
        const routePath = pathArg.text;
        const finalHandler = args[args.length - 1] ?? null;
        const middlewareArgs = args.slice(1, -1);
        registrations.push({ method, routePath, middlewareArgs, finalHandler });
        const key = `${method} ${routePath}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fnBody, visit);
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  return { registrations, duplicates };
}

// -------------------------------------------------------------------------
// Exposure classifier -- 3-valued (0/1/3), position-anchored straight-line
// grammar. See W9-agent-spawn-tranche.md S9S-2 for the full prose spec and
// the rationale for dropping the ingest tranche's intermediate "2" value.
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
function calleeName(expr: TsNode): string | null {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) return expr.name.text;
  return null;
}

/** Exposure 0: `requireLocalDaemonRequest` is a literal identifier among the
 * route registration's own middleware arguments (real Express middleware,
 * always invoked -- no reachability ambiguity). */
function hasRequireLocalDaemonRequestMiddleware(reg: RouteRegistration): boolean {
  return reg.middlewareArgs.some((arg) => ts.isIdentifier(arg) && arg.text === 'requireLocalDaemonRequest');
}

/** Exposure 1: the handler's own direct body.statements begin (index 0, 1)
 * with `const grant = authorizeToolRequest(...)` immediately followed by a
 * top-level `if (!grant)` whose consequent unconditionally exits. Position-
 * anchored deliberately -- a guard appearing after any other statement
 * (e.g. after a response write) does not count, because by construction it
 * cannot be a real gate at that point. */
function hasDirectAuthorizeToolRequestGuard(reg: RouteRegistration): boolean {
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
  if (calleeName(decl.initializer.expression) !== 'authorizeToolRequest') return false;
  if (!ts.isIfStatement(second)) return false;
  if (!isNegationOfIdentifier(second.expression, 'grant')) return false;
  if (!second.thenStatement) return false;
  return consequentUnconditionallyExits(second.thenStatement);
}

function classifyExposure(reg: RouteRegistration): number {
  if (hasRequireLocalDaemonRequestMiddleware(reg)) return 0;
  if (hasDirectAuthorizeToolRequestGuard(reg)) return 1;
  return 3;
}

// -------------------------------------------------------------------------
// Frozen route set + impact floors -- S9S-1 / S9S-2. Impact is a
// reviewer-owned floor; a row may claim impact >= floor, never below.
// -------------------------------------------------------------------------
interface ImpactFloorRow {
  key: string;
  impactFloor: number;
  impactRationale: string;
}
const FROZEN_IMPACT_FLOORS: ImpactFloorRow[] = [
  { key: 'POST /api/runs', impactFloor: 3, impactRationale: 'spawns a new OS child process running a caller-selected registered agent CLI, with caller-supplied prompt/model/tool-bundle, inheriting daemon-constructed env' },
  { key: 'POST /api/chat', impactFloor: 3, impactRationale: 'same spawn path via startChatRun' },
  { key: 'POST /api/runs/:id/cancel', impactFloor: 2, impactRationale: "terminates another caller's in-flight child process by id; no ownership check" },
  { key: 'GET /api/runs/:id/events', impactFloor: 1, impactRationale: "streams the live run's stdout/stderr/tool-result content back to the caller; no ownership check" },
  { key: 'GET /api/runs/:id/agui', impactFloor: 1, impactRationale: 'same content, AGUI-mapped envelope; no ownership check' },
  { key: 'GET /api/runs/:id/result-package', impactFloor: 1, impactRationale: "returns workspace file listing + artifact manifests for the run's project; no ownership check" },
  { key: 'GET /api/runs', impactFloor: 1, impactRationale: 'lists status/metadata for every run system-wide; no per-caller scoping' },
  { key: 'GET /api/runs/:id', impactFloor: 0, impactRationale: 'status/timestamps/ids only, best-effort documented assumption -- see PRD open question 4' },
];
const FROZEN_ROUTE_KEYS = new Set(FROZEN_IMPACT_FLOORS.map((r) => r.key));
const IMPACT_FLOOR_BY_KEY = new Map(FROZEN_IMPACT_FLOORS.map((r) => [r.key, r.impactFloor]));

function tierFor(score: number): 'P0' | 'P1' | 'P2' {
  if (score >= 5) return 'P0';
  if (score === 4) return 'P1';
  return 'P2';
}
const P0_ROUTE_KEYS = new Set(
  FROZEN_IMPACT_FLOORS.filter((r) => tierFor(3 + r.impactFloor) === 'P0').map((r) => r.key),
);

// -------------------------------------------------------------------------
// Self-probes -- the classifier is not trusted for a route verdict in a run
// where it cannot classify its own known fixtures correctly. Each fixture is
// run through the exact collectRunRouteRegistrations/classifyExposure
// pipeline the real criteria use, never a separate mock.
// -------------------------------------------------------------------------
interface SelfProbeOutcome {
  name: string;
  ok: boolean;
  detail: string;
}
function probeFixture(name: string, source: string, expected: number): SelfProbeOutcome {
  try {
    const collected = collectRunRouteRegistrations(source, `self-probe:${name}`);
    const reg = collected.registrations[0];
    if (!reg || collected.registrations.length !== 1) {
      return { name, ok: false, detail: `expected exactly 1 registration, found ${collected.registrations.length}` };
    }
    const actual = classifyExposure(reg);
    return actual === expected
      ? { name, ok: true, detail: `exposure=${actual} (expected ${expected})` }
      : { name, ok: false, detail: `exposure=${actual}, expected ${expected}` };
  } catch (err) {
    return { name, ok: false, detail: `probe crashed: ${String(err)}` };
  }
}
function runExposureSelfProbes(): SelfProbeOutcome[] {
  return [
    probeFixture(
      'real-requireLocalDaemonRequest-middleware',
      `function registerRunRoutes(app, ctx) {
        app.post('/api/runs', requireLocalDaemonRequest, async (req, res) => {
          res.json({ ok: true });
        });
      }`,
      0,
    ),
    probeFixture(
      'real-authorizeToolRequest-direct-guard',
      `function registerRunRoutes(app, ctx) {
        app.post('/api/runs', async (req, res) => {
          const grant = authorizeToolRequest(req);
          if (!grant) {
            return res.status(401).json({ error: 'unauthorized' });
          }
          res.json({ ok: true });
        });
      }`,
      1,
    ),
    probeFixture(
      'guard-inside-dead-if-false-branch',
      `function registerRunRoutes(app, ctx) {
        app.post('/api/runs', async (req, res) => {
          if (false) {
            const grant = authorizeToolRequest(req);
            if (!grant) {
              return res.status(401).json({ error: 'unauthorized' });
            }
          }
          res.json({ ok: true });
        });
      }`,
      3,
    ),
    probeFixture(
      'guard-result-never-checked',
      `function registerRunRoutes(app, ctx) {
        app.post('/api/runs', async (req, res) => {
          const grant = authorizeToolRequest(req);
          res.json({ ok: true });
        });
      }`,
      3,
    ),
    probeFixture(
      'guard-after-response-write',
      `function registerRunRoutes(app, ctx) {
        app.post('/api/runs', async (req, res) => {
          res.json({ ok: true });
          const grant = authorizeToolRequest(req);
          if (!grant) {
            return;
          }
        });
      }`,
      3,
    ),
    probeFixture(
      'no-guard-todays-real-shape',
      `function registerRunRoutes(app, ctx) {
        app.post('/api/runs', async (req, res) => {
          res.json({ ok: true });
        });
      }`,
      3,
    ),
    probeFixture(
      'requireLocalDaemonRequest-mentioned-only-in-comment',
      `function registerRunRoutes(app, ctx) {
        // requireLocalDaemonRequest should probably gate this
        app.post('/api/runs', async (req, res) => {
          res.json({ ok: true });
        });
      }`,
      3,
    ),
    probeFixture(
      'authorizeToolRequest-nested-inside-if-branch',
      `function registerRunRoutes(app, ctx) {
        app.post('/api/runs', async (req, res) => {
          if (req.query.strict) {
            const grant = authorizeToolRequest(req);
            if (!grant) {
              return res.status(401).json({ error: 'unauthorized' });
            }
          }
          res.json({ ok: true });
        });
      }`,
      3,
    ),
  ];
}

// -------------------------------------------------------------------------
// Isolated daemon boot for live route-inventory introspection (C9S-1).
// Copied pattern from scripts/waves/verify-w9-ingest.ts's
// bootDaemonForRouteInventory: port 0 (OS-assigned, never 7456/51012), a
// fresh mkdtemp OD_DATA_DIR, killed only by this function's own exact child
// PID (SIGTERM, bounded SIGKILL fallback -- never a process scan).
// -------------------------------------------------------------------------
async function bootDaemonForAgentSpawnRouteInventory(): Promise<{ method: string; path: string }[]> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w9as-verify-'));
  const bootScript = `
import { pathToFileURL } from 'node:url';
process.env.OD_DATA_DIR = ${JSON.stringify(dataDir)};
const mod = await import(pathToFileURL(${JSON.stringify(path.join(repoRoot, 'apps/daemon/src/server.ts'))}).href);
const started = await mod.startServer({ port: 0, host: '127.0.0.1', returnServer: true });
console.log('OD_W9AS_VERIFIER_READY ' + JSON.stringify({ routeInventory: started.routeInventory }));
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
// Attribution matrix -- S9S-3/S9S-4. Shared load + field-quality helpers.
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
  const abs = path.join(repoRoot, ATTRIBUTION_PATH_REL);
  if (!fs.existsSync(abs)) return { error: `${ATTRIBUTION_PATH_REL} does not exist` };
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
  0: /requirelocaldaemonrequest|loopback/i,
  1: /authorizetoolrequest|tool token/i,
  3: /\bnone\b|no gate|zero-config/i,
};

interface EnforcedDeclaration {
  kind: 'request-rate' | 'byte-volume';
  scope: 'token-hash' | 'origin' | 'pairing-attempt';
  limit: number;
  windowMs: number | null;
  overflow: 'reject-429' | 'reject-413';
}
function parseEnforcedDeclaration(mechanism: string): EnforcedDeclaration | null {
  const m = /^ENFORCED kind=(request-rate|byte-volume) scope=(token-hash|origin|pairing-attempt) limit=(\d+) windowMs=(\d+|none) overflow=(reject-429|reject-413)$/.exec(
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
  return hasTerm && NEGATIVE_SIGNAL_RE.test(fullName) && containsExactNumericToken(fullName, overflowStatus);
}
function hasDistinctSignalPair(candidates: readonly { fullName: string }[]): boolean {
  const positives = candidates.filter((c) => POSITIVE_SIGNAL_RE.test(c.fullName) && !NEGATIVE_SIGNAL_RE.test(c.fullName));
  const negatives = candidates.filter((c) => NEGATIVE_SIGNAL_RE.test(c.fullName) && !POSITIVE_SIGNAL_RE.test(c.fullName));
  if (positives.length === 0 || negatives.length === 0) return false;
  return positives.some((p) => negatives.some((n) => n.fullName !== p.fullName));
}

// -------------------------------------------------------------------------
// Static test-title extraction (AST) -- whether a cited test existed at a
// given commit is decided by a real TS-AST parse, matching only the static
// first argument of an it/test declaration (including it.each(...)(...)'s
// outer title call) -- never a substring scan of the file text.
// -------------------------------------------------------------------------
function extractStaticTestTitlesFromSource(sourceText: string, label: string): Set<string> {
  const titles = new Set<string>();
  let sourceFile: TypeScriptModule.SourceFile;
  try {
    sourceFile = ts.createSourceFile(label, sourceText, ts.ScriptTarget.Latest, true);
  } catch {
    return titles;
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
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
        titles.add(first.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return titles;
}

function findIntroductionCommit(relPath: string): { introducedAt: string; parentSha: string } | null {
  const log = sh('git', ['log', '--reverse', '--format=%H', `${baseCommit}..${headSha}`, '--', relPath]);
  if (log.status !== 0) return null;
  const commits = log.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (commits.length === 0) return null;
  const first = commits[0];
  if (!first) return null;
  const parent = sh('git', ['rev-parse', `${first}^`]);
  if (parent.status !== 0) return null;
  return { introducedAt: first, parentSha: parent.stdout.trim() };
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
// Dedicated test suite discovery + run (glob, never a fixed list).
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
function discoverAgentSpawnTestFiles(): string[] {
  const testsDir = path.join(repoRoot, 'apps/daemon/tests');
  if (!fs.existsSync(testsDir)) return [];
  return fs
    .readdirSync(testsDir)
    .filter((f) => /^agent-spawn-.*\.test\.ts$/.test(f))
    .sort()
    .map((f) => `tests/${f}`);
}
function runAgentSpawnSuite(testFiles: string[]): { suite: { status: number }; data: SuiteJson | null } {
  const jsonPath = path.join(proofDir, `suite-run.${process.pid}.json`);
  const suite = sh(
    'pnpm',
    ['--filter', '@open-design/daemon', 'exec', 'vitest', 'run', '-c', 'vitest.config.ts', '--reporter=json', `--outputFile=${jsonPath}`, ...testFiles],
    { timeoutMs: 3 * 60_000 },
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
// DECISIONS.md accepted-risk resolution -- W9AS-ACCEPT-<slug> headings,
// read at baseCommit (never HEAD, mirroring the LEASE rule -- a branch
// cannot author its own accepted risk after the fact by editing the
// baseCommit view of the file).
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
// Lease helpers -- shared by LEASE and C9S-7 (owned-path diff check).
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
// main()
// =========================================================================
async function main(): Promise<void> {
  const placeholderWrite = writeManifestFile(buildManifest(false, true, false));
  if (!placeholderWrite.written) {
    console.error('verify-w9-agent-spawn: FATAL: could not write the initial wroteOk:false placeholder manifest -- aborting rather than risk leaving a stale prior manifest unflagged.');
    process.exit(1);
  }

  const selfProbeResults = runExposureSelfProbes();
  const selfProbeFailures = selfProbeResults.filter((p) => !p.ok);

  let baseCommitCollect: CollectResult | null = null;
  let baseCommitError = '';
  try {
    const baseText = readFileAtCommit(baseCommit, 'apps/daemon/src/routes/runs.ts');
    baseCommitCollect = collectRunRouteRegistrations(baseText, `${baseCommit}:routes/runs.ts`);
  } catch (err) {
    baseCommitError = String((err as Error)?.stack ?? err);
  }
  let headCollect: CollectResult | null = null;
  let headError = '';
  try {
    const headText = fs.readFileSync(path.join(repoRoot, 'apps/daemon/src/routes/runs.ts'), 'utf8');
    headCollect = collectRunRouteRegistrations(headText, 'HEAD:routes/runs.ts');
  } catch (err) {
    headError = String((err as Error)?.stack ?? err);
  }
  const headExposureByKey = new Map<string, number>();
  if (headCollect) {
    for (const reg of headCollect.registrations) {
      headExposureByKey.set(`${reg.method} ${reg.routePath}`, classifyExposure(reg));
    }
  }

  // C9S-1: route snapshot frozen at baseCommit, drift-checked, gated on the
  // exposure-classifier self-probes.
  await checkCriterion('C9S-1', async () => {
    if (selfProbeFailures.length > 0) {
      record(
        'C9S-1',
        'exposure-classifier self-probes (8 fixtures) run through the real collectRunRouteRegistrations/classifyExposure pipeline',
        'every self-probe fixture classifies at its expected exposure',
        false,
        selfProbeResults.map((p) => `[${p.ok ? 'PASS' : 'FAIL'}] ${p.name}: ${p.detail}`).join('\n'),
        { detail: `${selfProbeFailures.length}/${selfProbeResults.length} self-probes failed -- exposure classifier is not trustworthy this run` },
      );
      return;
    }
    if (!baseCommitCollect) {
      record('C9S-1', `git show ${baseCommit}:apps/daemon/src/routes/runs.ts`, 'frozen route set derives from baseCommit, not a HEAD literal', false, '', {
        detail: `could not derive baseCommit route set: ${baseCommitError}${headError ? ` | HEAD error: ${headError}` : ''}`,
      });
      return;
    }
    const baseKeys = new Set(baseCommitCollect.registrations.map((r) => `${r.method} ${r.routePath}`));
    const missing = [...FROZEN_ROUTE_KEYS].filter((k) => !baseKeys.has(k));
    const extra = [...baseKeys].filter((k) => !FROZEN_ROUTE_KEYS.has(k));
    if (baseCommitCollect.duplicates.length > 0 || missing.length > 0 || extra.length > 0) {
      record(
        'C9S-1',
        `AST-scan git show ${baseCommit}:apps/daemon/src/routes/runs.ts, scoped to registerRunRoutes`,
        'baseCommit route set matches the reviewer-frozen FROZEN_IMPACT_FLOORS key set exactly, with zero duplicate registrations',
        false,
        `baseCommit duplicates: ${baseCommitCollect.duplicates.join(', ') || 'none'}\nmissing from baseCommit vs frozen table: ${missing.join(', ') || 'none'}\nextra in baseCommit vs frozen table: ${extra.join(', ') || 'none'}`,
      );
      return;
    }
    // HEAD AST self-consistency: this is the mechanism that actually catches
    // drift (a route added to or removed from registerRunRoutes since
    // baseCommit), because it is scoped to the exact function via AST, not a
    // live-path heuristic. A path-prefix-based live comparison cannot serve
    // this role here: apps/daemon/src/routes/genui.ts independently registers
    // several genuinely different routes under the same /api/runs/:runId/*
    // prefix (discovered empirically -- an earlier draft of this verifier
    // flagged them as false-positive "added" drift), and routes/chat.ts adds
    // one more (POST /api/runs/:id/feedback). routeInventory carries no
    // source-file attribution, so no live-boot-based filter can reliably
    // distinguish "a 9th route landed inside registerRunRoutes" from "a
    // sibling file legitimately shares the path prefix" -- the AST scope is
    // the only sound way to answer that question.
    if (!headCollect) {
      record('C9S-1', 'AST-scan apps/daemon/src/routes/runs.ts (HEAD), scoped to registerRunRoutes', 'HEAD route set matches the frozen table exactly, with zero duplicate registrations', false, '', {
        detail: `could not derive HEAD route set: ${headError}`,
      });
      return;
    }
    const headKeys = new Set(headCollect.registrations.map((r) => `${r.method} ${r.routePath}`));
    const headMissing = [...FROZEN_ROUTE_KEYS].filter((k) => !headKeys.has(k));
    const headExtra = [...headKeys].filter((k) => !FROZEN_ROUTE_KEYS.has(k));
    if (headCollect.duplicates.length > 0 || headMissing.length > 0 || headExtra.length > 0) {
      record(
        'C9S-1',
        'AST-scan apps/daemon/src/routes/runs.ts (HEAD), scoped to registerRunRoutes',
        'HEAD route set matches the frozen table exactly, with zero duplicate registrations -- this is the drift signal (a route added to or removed from registerRunRoutes since baseCommit)',
        false,
        `HEAD duplicates: ${headCollect.duplicates.join(', ') || 'none'}\nmissing from HEAD vs frozen table: ${headMissing.join(', ') || 'none'}\nextra in HEAD vs frozen table (drift): ${headExtra.join(', ') || 'none'}`,
      );
      return;
    }
    // Live isolated daemon boot: confirms the file's declared routes really
    // wire into Express's real route table (catching a registration-time
    // integration bug the AST scan cannot see -- e.g. a thrown/caught error
    // during registerRunRoutes that silently drops a handler). Presence is
    // checked per exact frozen key (count === 1), never by diffing every
    // live route under a shared path prefix against the frozen set.
    let liveRoutesRaw: { method: string; path: string }[];
    try {
      liveRoutesRaw = await bootDaemonForAgentSpawnRouteInventory();
    } catch (err) {
      record('C9S-1', 'isolated daemon boot (port 0, mkdtemp OD_DATA_DIR) -> routeInventory', 'a live daemon boots and reports its own route registrations', false, '', {
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
    const liveProblems: string[] = [];
    for (const key of FROZEN_ROUTE_KEYS) {
      const count = liveCounts.get(key) ?? 0;
      if (count !== 1) liveProblems.push(`${key}: live count ${count} (expected exactly 1)`);
    }
    const exposureHistogram = baseCommitCollect.registrations
      .map((r) => `${r.method} ${r.routePath} => exposure ${classifyExposure(r)}`)
      .join('\n');
    const ok = liveProblems.length === 0;
    record(
      'C9S-1',
      'self-probes (8/8 pass) + baseCommit AST self-consistency + HEAD AST self-consistency (drift signal) + boot real isolated daemon -> per-key live presence count',
      "8-route frozen snapshot matches routes/runs.ts's own registerRunRoutes at both baseCommit and HEAD, and each of the 8 routes appears exactly once in a live daemon's real route table",
      ok,
      `self-probes: ${selfProbeResults.length}/${selfProbeResults.length} pass\nframe=${FROZEN_ROUTE_KEYS.size}\nlive presence problems: ${liveProblems.join(', ') || 'none -- all 8 frozen keys present exactly once live'}\n\nbaseCommit exposure histogram:\n${exposureHistogram}`,
    );
  });

  // Load the attribution matrix once, shared by C9S-2 / C9S-3 / C9S-4.
  const attribution = loadAttributionMatrix();

  // C9S-2: attribution matrix riskScore matches the frozen impact floors +
  // the classifier's own live re-derivation of exposure from HEAD.
  await checkCriterion('C9S-2', () => {
    if ('error' in attribution) {
      record('C9S-2', `read ${ATTRIBUTION_PATH_REL}`, 'every row\'s riskScore.tier exactly equals tierFor(exposure+impact), exposure live-derived from HEAD, impact >= the frozen floor', false, '', {
        detail: attribution.error,
      });
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
      if (declaredExposure !== liveExposure) problems.push(`${key}: declared exposure ${declaredExposure} !== live-derived ${liveExposure}`);
      if (!(declaredImpact >= floor)) problems.push(`${key}: declared impact ${declaredImpact} < frozen floor ${floor}`);
      const expectedScore = liveExposure + declaredImpact;
      if (declaredScore !== expectedScore) problems.push(`${key}: declared score ${declaredScore} !== exposure+impact ${expectedScore}`);
      if (declaredTier !== tierFor(expectedScore)) problems.push(`${key}: declared tier ${declaredTier} !== tierFor(score) ${tierFor(expectedScore)}`);
    }
    record(
      'C9S-2',
      `read ${ATTRIBUTION_PATH_REL}; cross-check against FROZEN_IMPACT_FLOORS and live HEAD-derived exposure`,
      'every row\'s riskScore is formula-consistent and impact never claims below its frozen floor',
      problems.length === 0,
      problems.join('\n') || `${attribution.rows.length} rows checked, all formula-consistent`,
    );
  });

  // C9S-3: structural completeness + exposure===3 attribution.
  let decisionsAtBase = '';
  let decisionsError = '';
  try {
    decisionsAtBase = readFileAtCommit(baseCommit, 'docs/plans/waves/DECISIONS.md');
  } catch (err) {
    decisionsError = String((err as Error)?.stack ?? err);
  }
  const acceptedRiskBlocks = decisionsAtBase ? parseAcceptedRiskBlocks(decisionsAtBase).blocks : new Map<string, AcceptedRiskBlock[]>();
  const testFiles = discoverAgentSpawnTestFiles();
  const suiteResult = testFiles.length > 0 ? runAgentSpawnSuite(testFiles) : { suite: { status: 1 }, data: null };
  const passedAssertionsByFile = new Map<string, AssertionResult[]>();
  if (suiteResult.data) {
    for (const fileResult of suiteResult.data.testResults) {
      passedAssertionsByFile.set(fileResult.name, fileResult.assertionResults.filter((a) => a.status === 'passed'));
    }
  }
  const allPassedFullNames = new Set<string>();
  for (const list of passedAssertionsByFile.values()) for (const a of list) allPassedFullNames.add(a.fullName);
  const globalCitationOwner = new Map<string, string>(); // fullName -> routeKey

  await checkCriterion('C9S-3', () => {
    if ('error' in attribution) {
      record('C9S-3', `read ${ATTRIBUTION_PATH_REL}`, 'exactly 8 rows (no orphans/gaps/duplicates), six required fields non-placeholder, every exposure===3 row attributed', false, '', {
        detail: attribution.error,
      });
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
    for (const row of rows) {
      const key = typeof row.route === 'string' ? row.route : '<missing>';
      const REQUIRED_FIELDS: (keyof AttributionRow)[] = ['owner', 'authn', 'authz', 'inputValidation', 'sizeRateLimit', 'testRef'];
      const placeholderFields = REQUIRED_FIELDS.filter((f) => isPlaceholderText(row[f]));
      if (placeholderFields.length > 0) {
        structuralProblems.push(`${key}: placeholder/missing fields: ${placeholderFields.join(', ')}`);
      }
      const liveExposure = headExposureByKey.get(key);
      const authnText = typeof row.authn === 'string' ? row.authn : '';
      if (liveExposure !== undefined) {
        const keywordRe = EXPOSURE_KEYWORDS[liveExposure];
        if (keywordRe && !keywordRe.test(authnText)) {
          structuralProblems.push(`${key}: authn field does not name its live-derived exposure class (${liveExposure})`);
        }
      }
      if (liveExposure !== 3) continue; // attribution requirement only applies to exposure===3 rows
      const terms = routeAssociationTerms(key);
      const control = row.control;
      const acceptedRisk = row.acceptedRisk;
      let rowAttributed = false;
      let rowKnownVulnerable = false;
      if (control && typeof control.testRef === 'string' && typeof control.mechanism === 'string') {
        const testRef = control.testRef;
        if (!allPassedFullNames.has(testRef)) {
          rowDetails.push(`${key}: control.testRef "${testRef}" is not a currently-passing test in the discovered suite`);
        } else {
          const owningFile = [...passedAssertionsByFile.entries()].find(([, list]) => list.some((a) => a.fullName === testRef))?.[0];
          const hasTermMatch = terms.some((t) => testRef.toLowerCase().includes(t));
          const existingOwner = globalCitationOwner.get(testRef);
          if (existingOwner && existingOwner !== key) {
            rowDetails.push(`${key}: control.testRef "${testRef}" already cited by ${existingOwner} -- global citation uniqueness violated`);
          } else if (!hasTermMatch) {
            rowDetails.push(`${key}: control.testRef "${testRef}" does not contain a path-derived association term (${terms.join('/')})`);
          } else if (!owningFile || !hasDistinctSignalPair(passedAssertionsByFile.get(owningFile) ?? [])) {
            rowDetails.push(`${key}: cited file does not contain a distinct paired positive+negative passing assertion`);
          } else {
            globalCitationOwner.set(testRef, key);
            rowAttributed = true;
          }
        }
      } else if (acceptedRisk && typeof acceptedRisk.decisionRef === 'string') {
        const slug = acceptedRisk.decisionRef.replace(/^W9AS-ACCEPT-/, '');
        const blocks = acceptedRiskBlocks.get(slug) ?? [];
        if (decisionsError) {
          rowDetails.push(`${key}: could not read DECISIONS.md at baseCommit: ${decisionsError}`);
        } else if (blocks.length !== 1) {
          rowDetails.push(`${key}: decisionRef "${acceptedRisk.decisionRef}" resolves to ${blocks.length} blocks in DECISIONS.md@baseCommit (need exactly 1, unambiguous)`);
        } else {
          const block = blocks[0];
          const authorsInRange = commitAuthorsBetween(baseCommit, headSha);
          if (!block) {
            rowDetails.push(`${key}: accepted-risk block resolution failed unexpectedly`);
          } else if (block.route !== key) {
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
      } else {
        rowDetails.push(`${key}: exposure===3 but neither control nor acceptedRisk present`);
      }
      if (rowAttributed) attributed++;
      else unattributed++;
      if (rowKnownVulnerable) knownVulnerable++;
    }

    const ok = structuralProblems.length === 0 && unattributed === 0;
    record(
      'C9S-3',
      `read ${ATTRIBUTION_PATH_REL}; structural check + per-exposure-3-row control/acceptedRisk resolution against the discovered agent-spawn-*.test.ts suite and DECISIONS.md@${baseCommit}`,
      'exactly 8 rows, no orphans/gaps/duplicates, six fields non-placeholder, authn names its live exposure class, every exposure===3 row attributed (unattributed===0)',
      ok,
      `attributed=${attributed} unattributed=${unattributed} known-vulnerable=${knownVulnerable}\n${[...structuralProblems, ...rowDetails].join('\n') || 'no problems'}`,
    );
  });

  // C9S-4: P0-row size/rate-limit resolution via the ENFORCED grammar.
  await checkCriterion('C9S-4', () => {
    if ('error' in attribution) {
      record('C9S-4', `read ${ATTRIBUTION_PATH_REL}`, 'every P0-tier row\'s sizeRateLimit resolves via the ENFORCED grammar, backed by a real paired under/over-limit control test', false, '', {
        detail: attribution.error,
      });
      return;
    }
    const problems: string[] = [];
    let checked = 0;
    for (const row of attribution.rows) {
      const key = typeof row.route === 'string' ? row.route : '<missing>';
      if (!P0_ROUTE_KEYS.has(key)) continue;
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
      const hasUnder = siblingAssertions.some((a) => matchesUnderLimitAssertion(a.fullName, terms, parsed.limit));
      const hasOver = siblingAssertions.some((a) => matchesOverLimitAssertion(a.fullName, terms, parsed.limit, overflowStatus));
      if (!hasUnder || !hasOver) {
        problems.push(`${key}: same-file suite missing a bound under-limit-accepted (${hasUnder}) and/or over-limit-rejected (${hasOver}) assertion for limit=${parsed.limit} overflow=${overflowStatus}`);
      }
    }
    record(
      'C9S-4',
      `parse each P0 row's sizeRateLimit against the ENFORCED grammar; verify a bound paired under/over-limit passing assertion in the cited control file`,
      'every P0-tier row resolves size/rate-limit via a real, bound, currently-passing control',
      problems.length === 0 && checked === P0_ROUTE_KEYS.size,
      `P0 rows checked: ${checked}/${P0_ROUTE_KEYS.size} (${[...P0_ROUTE_KEYS].join(', ')})\n${problems.join('\n') || 'no problems'}`,
    );
  });

  // C9S-5: dedicated red-team test file(s).
  await checkCriterion('C9S-5', () => {
    if (testFiles.length === 0) {
      record('C9S-5', 'glob apps/daemon/tests/agent-spawn-*.test.ts', 'the dedicated test file set exists, boots a real daemon, passes, zero skip/only/todo, implements the 5 named red-team corpus cases', false, '', {
        detail: 'no files matching agent-spawn-*.test.ts found in apps/daemon/tests/',
      });
      return;
    }
    const bannedMarker = /\b(?:it|describe|test)\s*(?:\.\s*(?:skip|only|todo)\s*\(|\[\s*['"](?:skip|only|todo)['"]\s*\]\s*\()/;
    const markerHits: string[] = [];
    for (const rel of testFiles) {
      const text = fs.readFileSync(path.join(repoRoot, 'apps/daemon', rel), 'utf8');
      if (bannedMarker.test(text)) markerHits.push(rel);
    }
    const REQUIRED_CASE_HINTS = [
      /unknown.?agent.?id/i,
      /(oversized|too large|413|max.?body)/i,
      /(rate.?limit|429|spawn.?storm|rapid)/i,
      /(cross.?caller|foreign|another caller|other caller)/i,
      /(sandbox|escape|imported.?project|traversal)/i,
    ];
    const combinedText = testFiles.map((rel) => fs.readFileSync(path.join(repoRoot, 'apps/daemon', rel), 'utf8')).join('\n');
    const missingCases = REQUIRED_CASE_HINTS.filter((re) => !re.test(combinedText));
    const suitePassed = suiteResult.suite.status === 0 && (suiteResult.data?.numFailedTests ?? 1) === 0 && suiteResult.data !== null;
    const ok = markerHits.length === 0 && missingCases.length === 0 && suitePassed;
    record(
      'C9S-5',
      `glob apps/daemon/tests/agent-spawn-*.test.ts (${testFiles.length} file(s)); pnpm --filter @open-design/daemon exec vitest run --reporter=json`,
      'suite exists, is green, zero skip/only/todo markers, and textually implements all 5 named red-team corpus cases',
      ok,
      `files: ${testFiles.join(', ')}\nsuite status=${suiteResult.suite.status} numFailedTests=${suiteResult.data?.numFailedTests ?? 'n/a'} numPassedTests=${suiteResult.data?.numPassedTests ?? 'n/a'}\nskip/only/todo markers: ${markerHits.join(', ') || 'none'}\nmissing corpus case hints: ${missingCases.length}`,
    );
  });

  // C9S-6: threat-model doc extension.
  await checkCriterion('C9S-6', () => {
    const threatModelPath = path.join(repoRoot, 'docs/security/daemon-threat-model.md');
    if (!fs.existsSync(threatModelPath)) {
      record('C9S-6', 'read docs/security/daemon-threat-model.md', 'a [C9S-N]-tagged "Wave 9 -- agent spawn" section exists with one bullet per P0 route', false, '', {
        detail: 'docs/security/daemon-threat-model.md does not exist',
      });
      return;
    }
    const text = fs.readFileSync(threatModelPath, 'utf8');
    const headingMatch = /^#{1,6}.*wave\s*9.*agent\s*spawn/im.exec(text);
    if (!headingMatch) {
      record('C9S-6', 'read docs/security/daemon-threat-model.md', 'a [C9S-N]-tagged "Wave 9 -- agent spawn" section exists with one bullet per P0 route', false, '', {
        detail: 'no heading matching "Wave 9 ... agent spawn" found',
      });
      return;
    }
    const sectionText = text.slice(headingMatch.index);
    const bulletLines = sectionText.split('\n').filter((l) => /\[C9S-\d+\]/.test(l));
    const problems: string[] = [];
    for (const key of P0_ROUTE_KEYS) {
      const matching = bulletLines.filter((l) => l.includes(key));
      if (matching.length !== 1) {
        problems.push(`${key}: expected exactly 1 [C9S-N] bullet naming it, found ${matching.length}`);
        continue;
      }
      const bullet = matching[0] ?? '';
      const otherP0MentionedToo = [...P0_ROUTE_KEYS].some((other) => other !== key && bullet.includes(other));
      if (otherP0MentionedToo) problems.push(`${key}: its bullet also names a different P0 route (must name exactly one)`);
    }
    record(
      'C9S-6',
      'read docs/security/daemon-threat-model.md; locate the Wave 9 -- agent spawn section; check [C9S-N] bullet-per-P0-route association',
      'each P0 route has exactly one [C9S-N]-tagged bullet naming exactly that route',
      problems.length === 0,
      problems.join('\n') || `${P0_ROUTE_KEYS.size} P0 routes each have exactly one associated bullet`,
    );
  });

  // C9S-7: adversarial implementation-review record.
  await checkCriterion('C9S-7', () => {
    const reviewPath = path.join(repoRoot, 'docs/security/agent-spawn-implementation-review.json');
    if (!fs.existsSync(reviewPath)) {
      record('C9S-7', 'read docs/security/agent-spawn-implementation-review.json', 'reviewedCommit is a real strict ancestor of HEAD with an empty owned-path diff to HEAD; reviewer distinct from every baseCommit..reviewedCommit author; verdict APPROVE', false, '', {
        detail: 'docs/security/agent-spawn-implementation-review.json does not exist',
      });
      return;
    }
    let review: { reviewer?: unknown; model?: unknown; reviewedCommit?: unknown; verdict?: unknown };
    try {
      review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
    } catch (err) {
      record('C9S-7', 'parse docs/security/agent-spawn-implementation-review.json', 'file parses as JSON with the required fields', false, '', { detail: String(err) });
      return;
    }
    const problems: string[] = [];
    const reviewer = typeof review.reviewer === 'string' ? review.reviewer.trim() : '';
    const reviewedCommit = typeof review.reviewedCommit === 'string' ? review.reviewedCommit.trim() : '';
    if (!reviewer) problems.push('reviewer missing/empty');
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
        if (ownedChanged.length > 0) {
          problems.push(`owned-path diff from reviewedCommit to HEAD is non-empty: ${ownedChanged.join(', ')}`);
        }
      }
      const authorsInRange = commitAuthorsBetween(baseCommit, reviewedCommit);
      if (reviewer && authorsInRange.has(reviewer.toLowerCase())) {
        problems.push(`reviewer "${reviewer}" matches a commit author between baseCommit and reviewedCommit -- reviewer must be distinct from author`);
      }
    }
    if (review.verdict !== 'APPROVE') problems.push(`verdict "${String(review.verdict)}" !== "APPROVE"`);
    record(
      'C9S-7',
      'read docs/security/agent-spawn-implementation-review.json; reviewedCommit resolvability/ancestry + owned-path diff + author-distinctness checks',
      'reviewedCommit is a real strict ancestor of HEAD whose owned-path diff to HEAD is empty; reviewer distinct from every baseCommit..reviewedCommit author; verdict is APPROVE',
      problems.length === 0,
      problems.join('\n') || `reviewer=${reviewer} model=${String(review.model)} reviewedCommit=${reviewedCommit} verdict=${String(review.verdict)}`,
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
      record(
        'GATE-INTEGRITY',
        '',
        'defense-in-depth self-hash check',
        true,
        `sha256: ${selfSha256}\nUNPINNED -- no approved-gate.sha256 present. Not tamper-protected by this check until an orchestrator pins one post-approval; see manifest.gateIntegrityPinned=false.`,
      );
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
        detail: `no "${LEASE_KEY}" entry in leases.json@baseCommit -- expected to self-resolve once this PRD lands on main and an implementation branch's baseCommit includes the applied lease row (see W9-agent-spawn-tranche.md "PROPOSED write lease"); this document is not yet applied by an orchestrator`,
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
      `no writes outside the ${LEASE_KEY} lease, read from baseCommit so the wave cannot widen its own lease`,
      violations.length === 0,
      violations.join('\n') || (diffNames.length === 0 ? 'no diff between baseCommit and HEAD' : `all ${diffNames.length} changed files inside the lease`),
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
  console.log(`\nverify-w9-agent-spawn: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty}, wroteOk=true, gateIntegrityPinned=${gateIntegrityPinned}, archiveOk=${archiveResult.ok})`);
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
