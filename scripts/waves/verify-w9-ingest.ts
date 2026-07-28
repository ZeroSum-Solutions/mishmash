// verify-w9-ingest.ts -- wave mishmash-w9-ingest-tranche (Library ingest route
// hardening, first of the rolling W9 tranches) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w9-ingest.ts [--repo <path>]
// Exit 0 only when every C9 criterion passes, the tree is clean, and the
// three named infra checks (GATE-INTEGRITY / LEASE / HEAD-DRIFT) pass. The
// commit-bound proof manifest is written to the wave's goal-state proof
// directory either way -- W3's own verifier (criterion C3-4) reads that
// manifest directly per docs/plans/waves/W9-ingest-tranche.md's "Definition
// of green"; it must not re-run this tranche's checks itself.
//
// PORTABILITY: repoRoot comes from `process.cwd()`/`--repo`, never
// `import.meta.url` -- matches the verify-w0.ts / verify-w7.ts convention so
// this file can be copied to an orchestrator-approved out-of-repo location
// and still run correctly with cwd set to the target worktree.
//
// OBSERVE, NEVER TRUST: the route snapshot is read from a REAL daemon boot's
// own route-registration introspection (apps/daemon/src/
// route-registration-guard.ts), never a text grep of routes/library.ts; the
// existing-suite and testRef checks run a REAL vitest JSON-reporter pass and
// cross-check against ITS OWN output, never a claim in prose; the exposure
// axis of the attribution matrix's risk score is re-derived independently
// from the route registration's actual guard AST, never trusted from the
// matrix file alone.
//
// Isolation: every daemon this verifier boots binds to port 0 (OS-assigned
// ephemeral port) with a fresh mkdtemp OD_DATA_DIR, and is killed by its own
// exact child PID on teardown. This verifier never touches a default-
// namespace daemon (ports 7456/51012) and never issues a `git fetch`/`git
// push` -- git context is resolved from local refs only.

import { execFileSync, spawn } from 'node:child_process';
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

// F29-style guard: nothing before this point may throw uncaught. The
// emergency writer is dependency-free plain fs with an os.tmpdir() fallback,
// mirroring verify-w0.ts's discipline for the same reason -- a crash before
// any criterion runs must still leave a legible, non-empty manifest instead
// of silently producing nothing (which a lazy consumer could misread as "no
// manifest yet, must still be running" instead of "the gate itself broke").
function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W9-ingest',
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
  ts = createRequire(path.join(repoRoot, 'package.json'))('typescript');
} catch (err) {
  emergencyExit(`init failed: ${String((err as Error)?.stack ?? err)}`);
}

function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: opts.cwd ?? repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      timeout: opts.timeoutMs ?? 10 * 60_000,
      env: opts.env ?? process.env,
    });
    return { status: 0, stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '' };
  }
}

function sha256Bytes(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function sha256File(absPath: string): string {
  return sha256Bytes(fs.readFileSync(absPath));
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

// F27-style discipline: an artifact write failure forces the criterion to
// fail rather than silently recording a pass with no evidence behind it.
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

// -----------------------------------------------------------------------
// AST: independent exposure derivation for C9-8 (never trust the matrix's
// own claim -- recompute it from the route registration's actual guard
// code).
// -----------------------------------------------------------------------
function parseTs(absPath: string): { sourceFile: TypeScriptModule.SourceFile; text: string } {
  const text = fs.readFileSync(absPath, 'utf8');
  return { sourceFile: ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true), text };
}

interface RouteRegistrationNode {
  method: string;
  routePath: string;
  argsText: string[];
  handlerText: string;
}

/**
 * Walk registerLibraryRoutes's body and collect every `app.<method>(path,
 * ...handlers)` call: the route path (string literal only -- dynamic paths
 * are not used anywhere in this file, confirmed by inspection), the
 * remaining arguments' source text (to spot a named middleware identifier
 * like `requireLocalDaemonRequest` sitting between the path and the final
 * handler), and the final handler function's own body text (to spot
 * in-handler patterns like `authorizeToolRequest(` or the self-service
 * bearer-token shape).
 */
function collectRouteRegistrations(absPath: string): RouteRegistrationNode[] {
  const { sourceFile, text } = parseTs(absPath);
  const out: RouteRegistrationNode[] = [];
  const httpMethods = new Set(['get', 'post', 'delete', 'options', 'put', 'patch']);
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
        const finalHandler = rest[rest.length - 1];
        const middlewareArgs = rest.slice(0, -1);
        out.push({
          method: method.toUpperCase(),
          routePath: pathArg.text,
          argsText: middlewareArgs.map((a) => a.getText(sourceFile)),
          handlerText: finalHandler ? finalHandler.getText(sourceFile) : '',
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  void text;
  return out;
}

/**
 * Mechanical exposure classification (0-3), per W9-ingest-tranche.md S9-2 --
 * derived purely from the registration's own AST/text shape, never from a
 * human's read of "feels risky." Matches the four bands the PRD defines.
 */
function classifyExposure(reg: RouteRegistrationNode): number {
  const middleware = reg.argsText.join('\n');
  if (/\brequireLocalDaemonRequest\b/.test(middleware)) return 0;
  if (/\bauthorizeToolRequest\s*\(/.test(reg.handlerText)) return 1;
  // Self-service bearer: proof of possession of the caller's own token, no
  // requireLocalDaemonRequest anywhere in the registration.
  if (/\bbearerToken\s*\(\s*req\s*\)/.test(reg.handlerText) && /\bvalidateLibraryToken\s*\(/.test(reg.handlerText)) {
    return 2;
  }
  return 3;
}

// -----------------------------------------------------------------------
// Real daemon boot for route-inventory introspection (C9-1). Isolated:
// port 0, fresh mkdtemp OD_DATA_DIR, killed by its own exact PID.
// -----------------------------------------------------------------------
interface BootedRouteProbe {
  routes: { method: string; path: string }[];
}
async function bootDaemonForRouteInventory(): Promise<BootedRouteProbe> {
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
  // Kill this verifier's own spawned PID only, exactly as hard-constrained.
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
  return { routes };
}

// -----------------------------------------------------------------------
// Frozen route snapshot -- the 23 {method, path} pairs registered by
// registerLibraryRoutes under /api/library/* and /api/tools/library/*,
// verified today (baseCommit dd9e9996d, no implementation landed yet) by an
// actual daemon boot. See W9-ingest-tranche.md S9-1 for the exclusion
// rationale (registerBackupRoutes registers a different path prefix and is
// owned by W0).
// -----------------------------------------------------------------------
const FROZEN_ROUTES: { method: string; path: string }[] = [
  { method: 'POST', path: '/api/library/pair' },
  { method: 'OPTIONS', path: '/api/library/pair/confirm' },
  { method: 'POST', path: '/api/library/pair/confirm' },
  { method: 'GET', path: '/api/library/connection' },
  { method: 'POST', path: '/api/library/pair/revoke' },
  { method: 'OPTIONS', path: '/api/library/pair/revoke' },
  { method: 'POST', path: '/api/library/pair/rotate' },
  { method: 'OPTIONS', path: '/api/library/pair/rotate' },
  { method: 'OPTIONS', path: '/api/library/ingest' },
  { method: 'POST', path: '/api/library/ingest' },
  { method: 'GET', path: '/api/library/clipper-probe' },
  { method: 'GET', path: '/api/library/assets' },
  { method: 'POST', path: '/api/library/sync' },
  { method: 'GET', path: '/api/library/assets/:id' },
  { method: 'DELETE', path: '/api/library/assets/:id' },
  { method: 'GET', path: '/api/library/assets/:id/raw' },
  { method: 'GET', path: '/api/library/assets/:id/figma' },
  { method: 'GET', path: '/api/library/assets/:id/element' },
  { method: 'POST', path: '/api/library/assets/:id/apply' },
  { method: 'POST', path: '/api/library/assets/:id/edit-as-page' },
  { method: 'POST', path: '/api/tools/library/search' },
  { method: 'POST', path: '/api/tools/library/apply' },
  { method: 'GET', path: '/api/library/events' },
];

// -----------------------------------------------------------------------
// Vitest JSON-reporter run of the existing security suite (C9-2 / C9-5 /
// C9-6 / C9-7 all cross-check against THIS run's real pass/fail data, never
// a claim in the matrix or the threat-model doc's own prose).
// -----------------------------------------------------------------------
const LIBRARY_TEST_FILES = [
  'tests/library-asset-stream.test.ts',
  'tests/library-edit-as-page.test.ts',
  'tests/library-figma-sidecar.test.ts',
  'tests/library-ingest-concurrent-hash-race.test.ts',
  'tests/library-ingest-ssrf.test.ts',
  'tests/library-ingest-token-binding.test.ts',
  'tests/library-install.test.ts',
  'tests/library-sync.test.ts',
  'tests/library-token-revoke-rotate.test.ts',
];
interface AssertionResult {
  fullName: string;
  status: string;
}
interface SuiteJson {
  numFailedTests: number;
  numPassedTests: number;
  testResults: { assertionResults: AssertionResult[] }[];
}
function runLibrarySuite(attempt: number): { suite: { status: number }; data: SuiteJson | null; raw: string } {
  const jsonPath = path.join(proofDir, `suite-run.attempt-${attempt}.json`);
  const suite = sh('pnpm', [
    '--filter',
    '@open-design/daemon',
    'exec',
    'vitest',
    'run',
    '-c',
    'vitest.config.ts',
    '--reporter=json',
    `--outputFile=${jsonPath}`,
    ...LIBRARY_TEST_FILES,
  ]);
  let data: SuiteJson | null = null;
  let raw = '';
  try {
    raw = fs.readFileSync(jsonPath, 'utf8');
    data = JSON.parse(raw) as SuiteJson;
  } catch {
    data = null;
  }
  return { suite, data, raw };
}

async function main(): Promise<void> {
  // C9-1: route snapshot frozen, drift-checked against a real daemon boot.
  await checkCriterion('C9-1', async () => {
    const { routes } = await bootDaemonForRouteInventory();
    const live = routes.filter(
      (r) =>
        (r.path.startsWith('/api/library') || r.path.startsWith('/api/tools/library')) &&
        r.method !== 'USE' &&
        r.method !== 'ALL',
    );
    const liveKeys = new Set(live.map((r) => `${r.method} ${r.path}`));
    const frozenKeys = new Set(FROZEN_ROUTES.map((r) => `${r.method} ${r.path}`));
    const added = [...liveKeys].filter((k) => !frozenKeys.has(k));
    const removed = [...frozenKeys].filter((k) => !liveKeys.has(k));
    const ok = added.length === 0 && removed.length === 0;
    record(
      'C9-1',
      'boot real daemon (port 0, isolated data dir) -> routeInventory filtered to /api/library/* + /api/tools/library/*',
      '23-route frozen snapshot matches the live daemon\'s own route registration, zero drift',
      ok,
      `frozen=${frozenKeys.size} live=${liveKeys.size}\nadded (drift, not in frozen set): ${added.join(', ') || 'none'}\nremoved (frozen route missing from live daemon): ${removed.join(', ') || 'none'}`,
    );
  });

  // C9-2: existing ingest-security suite is green, zero banned markers.
  // Bounded single retry: a `--reporter=json` run was observed to flake once
  // during authoring (a beforeEach module-eval race unrelated to library
  // code) while the plain-reporter run of the same 9 files was 45/45 both
  // times it was tried. One retry distinguishes real regression from that
  // known infra flake class without becoming a "retry until green" loophole
  // -- the SECOND attempt's result is authoritative regardless of outcome,
  // and both transcripts are kept as evidence.
  let suiteRun = runLibrarySuite(1);
  let suiteAttempts = 1;
  if (suiteRun.suite.status !== 0 || (suiteRun.data?.numFailedTests ?? 1) !== 0) {
    const retry = runLibrarySuite(2);
    suiteAttempts = 2;
    suiteRun = retry;
  }
  const bannedMarker = /\b(?:it|describe|test)\.(?:skip|only|todo)\(/;
  const markerHits: string[] = [];
  for (const rel of LIBRARY_TEST_FILES) {
    const text = fs.readFileSync(path.join(repoRoot, 'apps/daemon', rel), 'utf8');
    if (bannedMarker.test(text)) markerHits.push(rel);
  }
  const allTests: AssertionResult[] = suiteRun.data ? suiteRun.data.testResults.flatMap((t) => t.assertionResults) : [];
  const passedTestNames = new Set(allTests.filter((t) => t.status === 'passed').map((t) => t.fullName));
  await checkCriterion('C9-2', () => {
    const ok = suiteRun.suite.status === 0 && (suiteRun.data?.numFailedTests ?? 1) === 0 && markerHits.length === 0 && allTests.length > 0;
    record(
      'C9-2',
      `vitest --reporter=json over ${LIBRARY_TEST_FILES.length} library-*.test.ts files (attempts=${suiteAttempts})`,
      'full existing ingest-security suite green, zero skip/only/todo markers',
      ok,
      `suite exit=${suiteRun.suite.status} failed=${suiteRun.data?.numFailedTests ?? 'unknown'} passed=${suiteRun.data?.numPassedTests ?? 'unknown'} totalAssertions=${allTests.length}\nbanned markers: ${markerHits.join(', ') || 'none'}\nattempts=${suiteAttempts}`,
    );
  });

  // Attribution matrix: parsed once, reused across C9-3..C9-6, C9-8.
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
    riskScore?: { exposure?: unknown; impact?: unknown; tier?: unknown };
    control?: { mechanism?: unknown; testRef?: unknown } | null;
    acceptedRisk?: { founder?: unknown; date?: unknown; rationale?: unknown } | null;
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
    const frozenKeySet = new Set(FROZEN_ROUTES.map((r) => `${r.method} ${r.path}`));
    const rowKeySet = new Set(rowKeys);
    const duplicates = rowKeys.filter((k, i) => rowKeys.indexOf(k) !== i);
    const orphans = [...rowKeySet].filter((k) => !frozenKeySet.has(k));
    const missing = [...frozenKeySet].filter((k) => !rowKeySet.has(k));
    const ok = orphans.length === 0 && missing.length === 0 && duplicates.length === 0 && rowKeys.length === FROZEN_ROUTES.length;
    record(
      'C9-3',
      `read ${path.relative(repoRoot, matrixPath)}`,
      'exactly one row per frozen route, no orphans, no gaps, no duplicates',
      ok,
      `rows=${matrixRows.length} frozen=${FROZEN_ROUTES.length}\nmissing: ${missing.join(', ') || 'none'}\norphans: ${orphans.join(', ') || 'none'}\nduplicates: ${duplicates.join(', ') || 'none'}`,
    );
  });

  // C9-4: every row fully attributed per VERIFICATION-CONTRACT.md S6.
  await checkCriterion('C9-4', () => {
    if (!matrixRows) {
      record('C9-4', '', 'every row carries all six required fields; "none"-shaped rows carry control XOR acceptedRisk', false, '', {
        detail: 'no matrix to check',
      });
      return;
    }
    const requiredFields = ['owner', 'authn', 'authz', 'inputValidation', 'sizeRateLimit', 'testRef'] as const;
    const problems: string[] = [];
    for (const row of matrixRows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      for (const field of requiredFields) {
        const v = row[field];
        if (typeof v !== 'string' || v.trim().length === 0) problems.push(`${key}: missing/empty "${field}"`);
      }
      const authnStr = typeof row.authn === 'string' ? row.authn.toLowerCase() : '';
      const validationStr = typeof row.inputValidation === 'string' ? row.inputValidation.toLowerCase() : '';
      const isNoneShaped = authnStr === 'none' || validationStr === 'none';
      const hasControl = row.control != null;
      const hasAcceptedRisk = row.acceptedRisk != null;
      if (isNoneShaped && hasControl === hasAcceptedRisk) {
        problems.push(`${key}: "none"-shaped row must carry exactly one of control/acceptedRisk (control=${hasControl}, acceptedRisk=${hasAcceptedRisk})`);
      }
      if (hasAcceptedRisk) {
        const ar = row.acceptedRisk as { founder?: unknown; date?: unknown; rationale?: unknown };
        if (typeof ar.founder !== 'string' || !ar.founder.trim()) problems.push(`${key}: acceptedRisk.founder missing`);
        if (typeof ar.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ar.date)) problems.push(`${key}: acceptedRisk.date missing/malformed`);
        if (typeof ar.rationale !== 'string' || !ar.rationale.trim()) problems.push(`${key}: acceptedRisk.rationale missing`);
      }
      if (hasControl) {
        const c = row.control as { mechanism?: unknown; testRef?: unknown };
        if (typeof c.mechanism !== 'string' || !c.mechanism.trim()) problems.push(`${key}: control.mechanism missing`);
        if (typeof c.testRef !== 'string' || !c.testRef.trim()) problems.push(`${key}: control.testRef missing`);
      }
    }
    record(
      'C9-4',
      '',
      'owner/authn/authz/inputValidation/sizeRateLimit/testRef non-empty per row; none-shaped rows carry control XOR acceptedRisk',
      problems.length === 0,
      problems.join('\n') || `all ${matrixRows.length} rows fully attributed`,
    );
  });

  // C9-5: every testRef (row-level and control.testRef) names a real,
  // currently-passing test from this run's own vitest output.
  await checkCriterion('C9-5', () => {
    if (!matrixRows) {
      record('C9-5', '', 'every testRef names a test that passed in this run\'s real vitest execution', false, '', { detail: 'no matrix to check' });
      return;
    }
    const refs: string[] = [];
    for (const row of matrixRows) {
      if (typeof row.testRef === 'string' && row.testRef.trim()) refs.push(row.testRef.trim());
      if (row.control && typeof row.control.testRef === 'string' && row.control.testRef.trim()) refs.push(row.control.testRef.trim());
    }
    const unmatched = refs.filter((ref) => ![...passedTestNames].some((full) => full.includes(ref) || ref.includes(full)));
    record(
      'C9-5',
      'cross-check against the C9-2 vitest JSON reporter run\'s passed assertionResults',
      'every cited testRef matches a real PASSED test fullName from this run',
      unmatched.length === 0 && refs.length > 0,
      `cited refs=${refs.length}\nunmatched: ${unmatched.join('\n') || 'none'}\n(${passedTestNames.size} tests passed this run)`,
    );
  });

  // C9-6: ingest's own size/rate-limit dimension explicitly resolved.
  await checkCriterion('C9-6', () => {
    const ingestRow = matrixRows?.find((r) => r.method === 'POST' && r.path === '/api/library/ingest');
    if (!ingestRow) {
      record('C9-6', '', 'POST /api/library/ingest carries a control or acceptedRisk on its sizeRateLimit decision, not a bare description', false, '', {
        detail: 'no ingest row in matrix',
      });
      return;
    }
    const hasControl = ingestRow.control != null;
    const hasAcceptedRisk = ingestRow.acceptedRisk != null;
    const ok = hasControl !== hasAcceptedRisk;
    record(
      'C9-6',
      '',
      'POST /api/library/ingest resolves the confirmed rate-limit gap (grep-verified absent repo-wide) with exactly one of control/acceptedRisk',
      ok,
      `control=${hasControl} acceptedRisk=${hasAcceptedRisk} sizeRateLimit="${String(ingestRow.sizeRateLimit ?? '')}"`,
    );
  });

  // C9-7: threat-model doc extended, mechanically cited.
  await checkCriterion('C9-7', () => {
    const threatModelPath = path.join(repoRoot, 'docs/security/daemon-threat-model.md');
    if (!fs.existsSync(threatModelPath)) {
      record('C9-7', '', 'daemon-threat-model.md carries a Wave 9 section whose [C9-N] bullets cite real passing tests', false, '', {
        detail: 'daemon-threat-model.md does not exist',
      });
      return;
    }
    const text = fs.readFileSync(threatModelPath, 'utf8');
    const waveSection = text.split(/^##\s+Wave 9\b/m)[1];
    if (!waveSection) {
      record('C9-7', `read ${path.relative(repoRoot, threatModelPath)}`, 'a "## Wave 9" section exists with [C9-N]-tagged, test-cited bullets', false, text.slice(0, 500), {
        detail: 'no "## Wave 9" heading found',
      });
      return;
    }
    const bulletLines = waveSection.split('\n').filter((l) => /\[C9-\d+\]/.test(l));
    const problems: string[] = [];
    for (const line of bulletLines) {
      const backtickMatches = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
      const cited = backtickMatches.find((t) => t.length > 20);
      if (!cited) {
        problems.push(`no backtick-quoted test name found: ${line.slice(0, 120)}`);
        continue;
      }
      const matched = [...passedTestNames].some((full) => full.includes(cited) || cited.includes(full));
      if (!matched) problems.push(`cited test not found among this run's PASSED tests: "${cited.slice(0, 160)}"`);
    }
    const ok = bulletLines.length > 0 && problems.length === 0;
    record(
      'C9-7',
      `read ${path.relative(repoRoot, threatModelPath)}, cross-check bullets against C9-2's vitest run`,
      'every [C9-N] bullet under "## Wave 9" cites a real, currently-passing test',
      ok,
      `[C9-N] bullets found: ${bulletLines.length}\n${problems.join('\n') || 'all citations matched'}`,
    );
  });

  // C9-8: matrix's exposure score matches the AST-derived exposure.
  await checkCriterion('C9-8', () => {
    if (!matrixRows) {
      record('C9-8', '', "matrix riskScore.exposure matches the verifier's own AST-derived exposure per route", false, '', { detail: 'no matrix to check' });
      return;
    }
    const libraryRoutesPath = path.join(repoRoot, 'apps/daemon/src/routes/library.ts');
    const registrations = collectRouteRegistrations(libraryRoutesPath);
    const derivedByKey = new Map<string, number>();
    for (const reg of registrations) {
      derivedByKey.set(`${reg.method} ${reg.routePath}`, classifyExposure(reg));
    }
    const problems: string[] = [];
    for (const row of matrixRows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      const derived = derivedByKey.get(key);
      const claimed = row.riskScore?.exposure;
      if (derived === undefined) {
        problems.push(`${key}: no matching AST registration found (route text/path mismatch)`);
        continue;
      }
      if (typeof claimed !== 'number' || claimed !== derived) {
        problems.push(`${key}: matrix claims exposure=${JSON.stringify(claimed)}, AST derives exposure=${derived}`);
      }
    }
    record(
      'C9-8',
      'AST scan of registerLibraryRoutes (which guard identifier wraps each app.<method> call)',
      "every row's riskScore.exposure equals the independently AST-derived value",
      problems.length === 0,
      problems.join('\n') || `all ${matrixRows.length} rows' exposure independently confirmed`,
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

  // =======================================================================
  // GATE-INTEGRITY / LEASE / HEAD-DRIFT
  // =======================================================================
  await checkCriterion('GATE-INTEGRITY', () => {
    const selfPath = process.argv[1] ? path.resolve(process.argv[1]) : path.join(repoRoot, 'scripts/waves/verify-w9-ingest.ts');
    let selfSha256: string;
    try {
      selfSha256 = sha256File(selfPath);
    } catch (err) {
      record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check; the PRIMARY control is the external-copy execution model', false, '', {
        detail: `could not hash self at ${selfPath}: ${String(err)}`,
      });
      return;
    }
    const approvedHashPath = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256');
    if (!fs.existsSync(approvedHashPath)) {
      record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check; the PRIMARY control is the external-copy execution model', true, `sha256: ${selfSha256}\nno approved-gate.sha256 present -- advisory only`);
      return;
    }
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === selfSha256;
    record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', gateOk, `sha256: ${selfSha256}\napproved: ${approved}`, {
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
            : 'see W9-ingest-tranche.md AUTHOR-FLAGGED §3: docs/plans/waves/W9-ingest-tranche.md itself is outside leases.json\'s W9-ingest.allow (unlike Burst-1 waves) -- expected until this PRD lands on main and becomes the base commit for the implementation-phase diff',
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
  // Commit-bound manifest. Tamper re-check + tmp/rename write, matching the
  // house pattern.
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
  const manifest = {
    wave: 'W9-ingest',
    commit: headSha,
    treeDirty,
    baseCommit,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: results,
  };
  let manifestWritten = false;
  const manifestPath = path.join(proofDir, 'manifest.json');
  try {
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, manifestPath);
    manifestWritten = true;
  } catch (err) {
    try {
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w9-ingest-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
      console.error(`verify-w9-ingest: primary manifest write failed (${String(err)}); wrote fallback`);
    } catch (err2) {
      console.error(`verify-w9-ingest: manifest write failed everywhere (${String(err)} / ${String(err2)})`);
    }
  }
  let manifestSha256 = 'unavailable';
  if (manifestWritten) {
    try {
      manifestSha256 = sha256File(manifestPath);
      fs.writeFileSync(path.join(proofDir, 'manifest.sha256.txt'), `${manifestSha256}\n`);
    } catch {
      manifestSha256 = 'unavailable';
    }
  }

  const failures = results.filter((r) => r.status === 'fail');
  console.log(`\nverify-w9-ingest: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty})`);
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md §2)');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  process.exit(failures.length === 0 && !treeDirty && manifestWritten ? 0 : 1);
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
