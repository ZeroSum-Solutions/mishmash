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
// ROUND 1 FIX (Sol REJECT, 9 blocking/non-blocking findings, verbatim record
// at ~/.claude/goal-state/mishmash-w9-ingest-tranche/reviews/sol-r1-findings.md):
//   F1/F5 -- risk score was implementer-gameable (impact never validated,
//     exposure regexed from raw text so a COMMENT could match, collection
//     scanned the whole file admitting duplicate/decoy registrations whose
//     last-seen value silently won). Fixed: impact floors are now frozen,
//     reviewer-owned literals (FROZEN_IMPACT_FLOORS) enforced as a floor;
//     exposure is derived from real AST CallExpression nodes scoped strictly
//     to registerLibraryRoutes's own body (comments are trivia -- a proper
//     ts.forEachChild walk never visits them); any duplicate {method,path}
//     registration is a hard fail, never a last-write-wins silent pick.
//   F2 -- matrix was self-attested free text; C9-4's control/acceptedRisk
//     trigger is no longer a text-parse of the "authn"/"inputValidation"
//     strings (trivially evaded by "none (global middleware)") -- it is
//     driven by the SAME mechanically re-derived exposure===3 classification
//     C9-8 already computes. acceptedRisk is no longer implementer-authored
//     JSON; it must reference a decision entry that actually appears in
//     docs/plans/waves/DECISIONS.md AS OF baseCommit (git show, never the
//     working tree) -- an implementation-branch edit cannot author its own
//     accepted risk (Sol ruling 2; leases.json amended on main to grant this
//     exact file, verified independently below, never assumed).
//   F3 -- C9-5's test binding used two-sided substring matching ("e" matched
//     anything); now exact fullName equality. New tests (files that did not
//     exist at baseCommit) require a companion red-transcript artifact under
//     docs/security/library-ingest-red/ (R1: both transcripts recorded) plus
//     >=2 passing assertions in the same file as a mechanical proxy for R4's
//     negative-control pairing. C9-6 now applies to every row whose
//     mechanically-verified tier is P0 (not just ingest) and requires a real
//     rate/volume-control test reference, not mere control-object presence.
//   F4 -- the frozen route set is no longer a HEAD literal compared to HEAD
//     behavior; it is derived from baseCommit's own routes/library.ts via
//     `git show`, so co-editing routes + the frozen set + this verifier in
//     one implementation branch cannot fabricate "no drift."
//   F5(vacuous green) -- W3's consumption contract is fully specified in the
//     PRD's "Definition of green"; this manifest now carries `wroteOk`
//     (two-phase write: a wroteOk:false placeholder is written BEFORE any
//     criterion runs, so a crash/interruption leaves visibly-incomplete
//     evidence, never a stale prior green) and the exact criterion-ID set.
//   F6 -- new criterion C9-10 requires a commit-bound, reviewer!=author
//     adversarial implementation-review record.
//   F7/F9 -- C9-2 now globs apps/daemon/tests/library-*.test.ts (never a
//     fixed list), checks pending/skipped reporter counts, and the
//     skip-marker regex covers spaced/bracket-alias forms. Every post-commit
//     run additionally preserves an independent, timestamped copy under
//     proof/runs/ -- the canonical proof/manifest.json is never the only
//     surviving evidence of a given run.
//   F8 -- ground-fact corrections carried in the PRD, not this file: the
//     daemon has a per-run CONNECTOR tool-call limiter (apps/daemon/src/
//     connectors/service.ts) and express-rate-limit@8.4.1 is a transitive
//     dependency of @modelcontextprotocol/sdk -- neither applies to any
//     /api/library/* route; the correct claim is narrower (no request/byte-
//     volume control on Library ingest), and this file's own AST scan
//     confirms 6 requireLocalDaemonRequest routes / 2 self-service-bearer
//     routes in this file, not 9/4.
//
// PORTABILITY: repoRoot comes from `process.cwd()`/`--repo`, never
// `import.meta.url` -- matches the verify-w0.ts / verify-w7.ts convention so
// this file can be copied to an orchestrator-approved out-of-repo location
// and still run correctly with cwd set to the target worktree.
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

function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W9-ingest',
      commit: 'unknown',
      treeDirty: true,
      baseCommit: 'unknown',
      wroteOk: false,
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

// =========================================================================
// F5 fix: two-phase manifest write. A wroteOk:false placeholder is written
// IMMEDIATELY (before any criterion runs), overwriting whatever manifest.json
// a PRIOR run left behind, so a crash/interruption after this point can never
// leave a stale-but-complete-looking prior green manifest on disk. Only the
// FINAL write at the end of main() sets wroteOk:true.
// =========================================================================
interface ManifestShape {
  wave: string;
  commit: string;
  treeDirty: boolean;
  baseCommit: string;
  wroteOk: boolean;
  toolchain: { node: string; pnpm: string };
  criteria: CriterionResult[];
}
function buildManifest(wroteOk: boolean, treeDirty: boolean): ManifestShape {
  return {
    wave: 'W9-ingest',
    commit: headSha,
    treeDirty,
    baseCommit,
    wroteOk,
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
// F9 fix: an independently preserved copy per run, so two post-commit runs
// can each be verified without one clobbering the other. Copy, never move --
// the canonical proof/manifest.json (what W3 reads) is always the latest.
function archiveRunArtifacts(manifest: ManifestShape): string {
  const runDir = path.join(proofDir, 'runs', `${manifest.commit}-${Date.now()}-${process.pid}`);
  try {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const canonicalSha = path.join(proofDir, 'manifest.sha256.txt');
    if (fs.existsSync(canonicalSha)) fs.copyFileSync(canonicalSha, path.join(runDir, 'manifest.sha256.txt'));
    for (const r of manifest.criteria) {
      if (r.artifact && fs.existsSync(r.artifact)) {
        try {
          fs.copyFileSync(r.artifact, path.join(runDir, path.basename(r.artifact)));
        } catch {
          /* best effort per-criterion artifact copy */
        }
      }
    }
  } catch (err) {
    console.error(`verify-w9-ingest: run-archive copy failed (non-fatal, canonical manifest still authoritative): ${String(err)}`);
  }
  return runDir;
}

// -----------------------------------------------------------------------
// F1/F4/F5 fix: AST route-registration collector, scoped strictly to
// registerLibraryRoutes's own body (never the whole file, so a decoy
// registration or a matching comment elsewhere in the module cannot leak
// in), duplicate-registration-aware, and comment-blind by construction --
// ts.forEachChild only visits real syntax nodes, never trivia.
// -----------------------------------------------------------------------
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

/** Real AST search (not text/regex) for a CallExpression `name(...)` anywhere under `root`. */
function containsCallTo(root: TsNode, name: string): boolean {
  let found = false;
  function visit(node: TsNode): void {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
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
        const hasAuthorizeToolRequest = containsCallTo(finalHandler, 'authorizeToolRequest');
        const hasSelfServiceBearerPattern =
          containsCallTo(finalHandler, 'bearerToken') && containsCallTo(finalHandler, 'validateLibraryToken');
        const key = `${method.toUpperCase()} ${pathArg.text}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        registrations.push({
          method: method.toUpperCase(),
          routePath: pathArg.text,
          hasRequireLocalDaemonRequest,
          hasAuthorizeToolRequest,
          hasSelfServiceBearerPattern,
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
// F1/ruling-5 fix: reviewer-owned, frozen impact FLOORS -- one literal entry
// per route this expansion round classified by hand against the route's
// actual behavior (see W9-ingest-tranche.md S9-2 for the per-row rationale).
// A row may claim impact >= its floor (an implementer who finds a route does
// something WORSE than this floor assumed may raise it) but never below.
// Changing a floor requires a reviewed gate amendment, not an
// implementation-branch edit -- this literal is the amendment surface, and
// its key set is ALSO the canonical frozen route set (single source of
// truth; C9-1 verifies baseCommit's real routes match these keys exactly).
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
  'GET /api/library/assets': 0,
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
// F7 fix: glob apps/daemon/tests/library-*.test.ts at run time -- never a
// fixed list an implementer could route new coverage around.
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
  status: string;
}
interface FileTestResult {
  name: string; // absolute path to the test file, per vitest's json reporter
  assertionResults: AssertionResult[];
}
interface SuiteJson {
  numFailedTests: number;
  numPassedTests: number;
  numPendingTests?: number;
  testResults: FileTestResult[];
}
function runLibrarySuite(testFiles: string[], attempt: number): { suite: { status: number }; data: SuiteJson | null } {
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
    ...testFiles,
  ]);
  let data: SuiteJson | null = null;
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as SuiteJson;
  } catch {
    data = null;
  }
  return { suite, data };
}

async function main(): Promise<void> {
  // F5: placeholder write BEFORE any criterion runs -- invalidates any prior
  // green manifest immediately, so a crash below never leaves stale evidence.
  writeManifestFile(buildManifest(false, true));

  // -----------------------------------------------------------------------
  // Shared, computed once: baseCommit-derived route registrations (the
  // frozen ground truth, F4 fix) and HEAD-derived route registrations (what
  // the matrix, built during implementation, actually describes).
  // -----------------------------------------------------------------------
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

  // C9-1: route snapshot frozen at baseCommit, drift-checked against a real
  // daemon boot's live registration -- never a HEAD literal compared to HEAD.
  await checkCriterion('C9-1', async () => {
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
    const ok = liveDuplicates.length === 0 && added.length === 0 && removed.length === 0;
    record(
      'C9-1',
      'baseCommit AST self-consistency + boot real daemon (port 0, isolated data dir) -> routeInventory filtered to /api/library/* + /api/tools/library/*',
      '23-route frozen snapshot (derived from baseCommit, self-consistent with the reviewer-frozen impact table) matches the live daemon\'s own route registration, zero drift, zero duplicate registrations',
      ok,
      `frozen=${FROZEN_ROUTE_KEYS.size} live(scoped)=${liveKeys.size} liveRaw=${scopedLive.length}\nlive duplicates: ${liveDuplicates.join(', ') || 'none'}\nadded (drift, not in frozen set): ${added.join(', ') || 'none'}\nremoved (frozen route missing from live daemon): ${removed.join(', ') || 'none'}`,
    );
  });

  // C9-2: existing suite green over a GLOBBED file set, pending/skipped
  // reporter counts checked, broadened skip-marker regex.
  const testFiles = discoverLibraryTestFiles();
  let suiteRun = runLibrarySuite(testFiles, 1);
  let suiteAttempts = 1;
  if (suiteRun.suite.status !== 0 || (suiteRun.data?.numFailedTests ?? 1) !== 0) {
    suiteRun = runLibrarySuite(testFiles, 2);
    suiteAttempts = 2;
  }
  // Covers `it.skip(`, `it .skip (` (whitespace variants), and bracket-access
  // aliasing (`it['skip'](`, `describe["only"](`) -- the prior regex only
  // matched the single dot-call spelling.
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

  // File-existence-at-baseCommit index, used by C9-5 to decide whether a
  // cited test is pre-existing coverage (no red artifact required, per
  // W9-ingest-tranche.md S9-3's "may cite directly" allowance) or new
  // (requires a red transcript, R1).
  const fileExistsAtBase = new Map<string, boolean>();
  for (const t of suiteRun.data?.testResults ?? []) {
    const rel = path.relative(path.join(repoRoot, 'apps/daemon'), t.name);
    if (!fileExistsAtBase.has(rel)) fileExistsAtBase.set(rel, fileExistsAtCommit(baseCommit, `apps/daemon/${rel}`));
  }
  function findContainingFile(fullName: string): { rel: string; passedInFile: number } | null {
    for (const t of suiteRun.data?.testResults ?? []) {
      if (t.assertionResults.some((a) => a.fullName === fullName)) {
        const rel = path.relative(path.join(repoRoot, 'apps/daemon'), t.name);
        const passedInFile = t.assertionResults.filter((a) => a.status === 'passed').length;
        return { rel, passedInFile };
      }
    }
    return null;
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

  // C9-4: full attribution per S6 -- control/acceptedRisk trigger is now
  // MECHANICAL (exposure===3 at HEAD, never a text parse of authn/
  // inputValidation strings), acceptedRisk is a DECISIONS.md-at-baseCommit
  // reference (never implementer-authored JSON alone), and the evidence
  // reports attributed / unattributed / known-vulnerable counts explicitly.
  let decisionsAtBase = '';
  let decisionsAtBaseError = '';
  try {
    decisionsAtBase = readFileAtCommit(baseCommit, 'docs/plans/waves/DECISIONS.md');
  } catch (err) {
    decisionsAtBaseError = String(err);
  }
  await checkCriterion('C9-4', () => {
    if (!matrixRows) {
      record('C9-4', '', 'every row carries all six required fields; exposure===3 rows carry control XOR a DECISIONS.md-at-baseCommit acceptedRisk reference', false, '', {
        detail: 'no matrix to check',
      });
      return;
    }
    const requiredFields = ['owner', 'authn', 'authz', 'inputValidation', 'sizeRateLimit', 'testRef'] as const;
    const problems: string[] = [];
    let attributed = 0;
    let unattributed = 0;
    let knownVulnerable = 0;
    for (const row of matrixRows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      let fieldsOk = true;
      for (const field of requiredFields) {
        const v = row[field];
        if (typeof v !== 'string' || v.trim().length === 0) {
          problems.push(`${key}: missing/empty "${field}"`);
          fieldsOk = false;
        }
      }
      const mechanicalExposure = headExposureByKey.get(key);
      const noGateMechanically = mechanicalExposure === 3;
      const hasControl = row.control != null;
      const hasAcceptedRisk = row.acceptedRisk != null;
      if (noGateMechanically) {
        if (hasControl === hasAcceptedRisk) {
          problems.push(`${key}: exposure===3 (mechanically no route-level gate) requires exactly one of control/acceptedRisk (control=${hasControl}, acceptedRisk=${hasAcceptedRisk})`);
        } else if (hasAcceptedRisk) {
          const ar = row.acceptedRisk as { decisionRef?: unknown };
          const ref = typeof ar.decisionRef === 'string' ? ar.decisionRef.trim() : '';
          if (!ref) {
            problems.push(`${key}: acceptedRisk.decisionRef missing/empty`);
          } else if (decisionsAtBaseError) {
            problems.push(`${key}: could not read DECISIONS.md at baseCommit to verify decisionRef: ${decisionsAtBaseError}`);
          } else if (!decisionsAtBase.includes(ref)) {
            problems.push(`${key}: acceptedRisk.decisionRef "${ref}" not found in docs/plans/waves/DECISIONS.md AS OF baseCommit (${baseCommit.slice(0, 12)}) -- an implementation-branch edit cannot author its own accepted risk`);
          } else {
            knownVulnerable += 1;
          }
        } else if (hasControl) {
          attributed += 1; // control validity itself is checked by C9-5/C9-6
        }
      } else {
        attributed += 1;
      }
      if (noGateMechanically && !hasControl && !hasAcceptedRisk) unattributed += 1;
      if (!fieldsOk) problems.push(`${key}: incomplete required fields`);
    }
    const ok = problems.length === 0;
    record(
      'C9-4',
      'exposure===3 at HEAD (same AST classification as C9-8) drives the control/acceptedRisk requirement -- not a text parse of authn/inputValidation',
      'owner/authn/authz/inputValidation/sizeRateLimit/testRef non-empty per row; every mechanically-ungated row carries control XOR a DECISIONS.md-at-baseCommit acceptedRisk reference',
      ok,
      `attributed=${attributed} unattributed(no control, no accepted risk)=${unattributed} known-vulnerable(accepted risk on file)=${knownVulnerable} total=${matrixRows.length}\n${problems.join('\n') || 'all rows fully attributed'}`,
    );
  });

  // C9-5: exact-fullName test binding (never substring); new-file testRefs
  // require a companion red-transcript artifact (R1) plus >=2 passing
  // assertions in the same file as an R4 negative-control proxy.
  const redDir = path.join(repoRoot, 'docs/security/library-ingest-red');
  function checkTestRef(ref: string): string[] {
    const problems: string[] = [];
    if (!passedTestNames.has(ref)) {
      problems.push(`testRef does not exactly match any PASSED test fullName this run: "${ref}"`);
      return problems;
    }
    const containing = findContainingFile(ref);
    if (!containing) {
      problems.push(`testRef matched a passed test but its containing file could not be resolved: "${ref}"`);
      return problems;
    }
    const existedAtBase = fileExistsAtBase.get(containing.rel) ?? false;
    if (!existedAtBase) {
      const artifactPath = path.join(redDir, `${slugify(ref)}.txt`);
      if (!fs.existsSync(artifactPath)) {
        problems.push(`new test file (${containing.rel} did not exist at baseCommit) cited by testRef "${ref}" has no red-transcript artifact at docs/security/library-ingest-red/${slugify(ref)}.txt (R1: both transcripts must be recorded)`);
      } else {
        const content = fs.readFileSync(artifactPath, 'utf8');
        if (content.trim().length < 100 || !/\b(RED|FAIL(?:ED)?)\b/i.test(content)) {
          problems.push(`red-transcript artifact for "${ref}" exists but is too short or lacks a RED/FAIL marker`);
        }
      }
      if (containing.passedInFile < 2) {
        problems.push(`new-control testRef "${ref}"'s file has only ${containing.passedInFile} passing assertion(s) -- R4 requires a paired negative control (>=2)`);
      }
    }
    return problems;
  }
  await checkCriterion('C9-5', () => {
    if (!matrixRows) {
      record('C9-5', '', 'every testRef exactly matches a passed test; new tests carry a red-transcript artifact + a paired negative control', false, '', {
        detail: 'no matrix to check',
      });
      return;
    }
    const refs: string[] = [];
    for (const row of matrixRows) {
      if (typeof row.testRef === 'string' && row.testRef.trim()) refs.push(row.testRef.trim());
      if (row.control && typeof row.control.testRef === 'string' && row.control.testRef.trim()) refs.push(row.control.testRef.trim());
    }
    const problems = refs.flatMap(checkTestRef);
    record(
      'C9-5',
      'exact fullName match against the C9-2 vitest JSON reporter run\'s passed assertionResults; new-file testRefs cross-checked against docs/security/library-ingest-red/',
      'every cited testRef exactly matches a real PASSED test; new controls carry a red transcript and >=2 passing assertions in-file',
      problems.length === 0 && refs.length > 0,
      `cited refs=${refs.length}\n${problems.join('\n') || 'all citations matched and (where new) carried valid red evidence'}`,
    );
  });

  // C9-6: every row whose mechanically-verified tier is P0 must resolve its
  // sizeRateLimit dimension with a REAL, passing volume/rate-control test
  // reference (checked with the same rigor as C9-5), not mere object
  // presence, or a DECISIONS.md-at-baseCommit acceptedRisk reference.
  await checkCriterion('C9-6', () => {
    if (!matrixRows) {
      record('C9-6', '', 'every P0-tier row resolves sizeRateLimit with a real control test or acceptedRisk, not bare object presence', false, '', {
        detail: 'no matrix to check',
      });
      return;
    }
    const problems: string[] = [];
    let p0Count = 0;
    for (const row of matrixRows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      const tier = row.riskScore?.tier;
      if (tier !== 'P0') continue;
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
        if (!/\b(rate|volume|throttle|limit|cap)\b/i.test(mechanism)) {
          problems.push(`${key} (P0): control.mechanism "${mechanism}" does not read as a rate/volume/throttle control`);
        }
        const ref = typeof c.testRef === 'string' ? c.testRef.trim() : '';
        if (!ref) {
          problems.push(`${key} (P0): control.testRef missing`);
        } else {
          const testProblems = checkTestRef(ref);
          if (testProblems.length > 0) problems.push(`${key} (P0) control.testRef: ${testProblems.join('; ')}`);
        }
      } else if (hasAcceptedRisk) {
        const ar = row.acceptedRisk as { decisionRef?: unknown };
        const ref = typeof ar.decisionRef === 'string' ? ar.decisionRef.trim() : '';
        if (!ref || decisionsAtBaseError || !decisionsAtBase.includes(ref)) {
          problems.push(`${key} (P0): acceptedRisk.decisionRef "${ref}" not verifiable in DECISIONS.md at baseCommit`);
        }
      }
    }
    record(
      'C9-6',
      "every row with riskScore.tier === 'P0' resolves sizeRateLimit with a real, passing rate/volume-control test or a DECISIONS.md-verified acceptedRisk",
      'no P0 row may resolve its rate/volume gap with a bare control object or unverifiable accepted risk',
      problems.length === 0 && p0Count > 0,
      `P0 rows found: ${p0Count}\n${problems.join('\n') || 'all P0 rows resolved'}`,
    );
  });

  // C9-7: threat-model doc extended, section boundary correctly extracted
  // (stops at the NEXT "## " heading), exact fullName citations, and every
  // P0 route gets its own bullet -- not merely "at least one bullet exists."
  await checkCriterion('C9-7', () => {
    const threatModelPath = path.join(repoRoot, 'docs/security/daemon-threat-model.md');
    if (!fs.existsSync(threatModelPath)) {
      record('C9-7', '', 'daemon-threat-model.md carries a bounded Wave 9 section whose [C9-N] bullets exactly cite real passing tests, one per P0 route', false, '', {
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
    const bulletLines = waveSection.split('\n').filter((l) => /\[C9-\d+\]/.test(l));
    const problems: string[] = [];
    for (const line of bulletLines) {
      const backtickMatches = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
      const cited = backtickMatches.find((t) => t.length > 20);
      if (!cited) {
        problems.push(`no backtick-quoted test name found: ${line.slice(0, 120)}`);
        continue;
      }
      if (!passedTestNames.has(cited)) problems.push(`cited test is not an exact match to any PASSED test this run: "${cited.slice(0, 160)}"`);
    }
    const p0Keys = matrixRows ? matrixRows.filter((r) => r.riskScore?.tier === 'P0').map((r) => `${String(r.method)} ${String(r.path)}`) : [];
    const sectionLower = waveSection.toLowerCase();
    const uncoveredP0 = p0Keys.filter((k) => !sectionLower.includes(k.toLowerCase()));
    const ok = bulletLines.length > 0 && problems.length === 0 && (p0Keys.length === 0 || uncoveredP0.length === 0);
    record(
      'C9-7',
      `read ${path.relative(repoRoot, threatModelPath)}, section bounded to the next "## " heading, cross-check bullets against C9-2's vitest run`,
      'every [C9-N] bullet cites an exact PASSED test; every P0-tier route named at least once in the section',
      ok,
      `[C9-N] bullets found: ${bulletLines.length}\nP0 routes: ${p0Keys.join(', ') || 'none'}\nuncovered P0 routes: ${uncoveredP0.join(', ') || 'none'}\n${problems.join('\n') || 'all citations matched'}`,
    );
  });

  // C9-8: full risk-score formula enforcement -- exposure exact (AST,
  // scoped+dedup'd, comment-blind), impact >= frozen floor, score ===
  // exposure+impact exactly, tier === tierFor(score) exactly.
  await checkCriterion('C9-8', () => {
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
      'AST scan of registerLibraryRoutes at HEAD (scoped, comment-blind, duplicate-checked) cross-checked against FROZEN_IMPACT_FLOORS',
      'every row: exposure exact match, impact >= frozen floor, score === exposure+impact, tier === tierFor(score)',
      problems.length === 0,
      problems.join('\n') || `all ${matrixRows.length} rows' exposure/impact/score/tier independently confirmed`,
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

  // C9-10 (new, F6 fix): commit-bound adversarial implementation review,
  // reviewer != author, machine-readable APPROVE verdict. G-14 / W5-W11-
  // gated.md:155's "adversarial verification per tranche" requirement.
  await checkCriterion('C9-10', () => {
    const reviewPath = path.join(repoRoot, 'docs/security/library-ingest-implementation-review.json');
    if (!fs.existsSync(reviewPath)) {
      record('C9-10', `read ${path.relative(repoRoot, reviewPath)}`, 'a commit-bound, reviewer!=author, machine-readable APPROVE review record exists', false, '', {
        detail: 'no implementation review record on disk',
      });
      return;
    }
    let review: { reviewer?: unknown; model?: unknown; commit?: unknown; verdict?: unknown };
    try {
      review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
    } catch (err) {
      record('C9-10', '', 'review record parses as JSON', false, '', { detail: `parse failed: ${String(err)}` });
      return;
    }
    const authorName = sh('git', ['log', '-1', '--format=%an', headSha]).stdout.trim().toLowerCase();
    const authorEmail = sh('git', ['log', '-1', '--format=%ae', headSha]).stdout.trim().toLowerCase();
    const reviewer = typeof review.reviewer === 'string' ? review.reviewer.trim() : '';
    const problems: string[] = [];
    if (!reviewer) problems.push('reviewer field missing/empty');
    else if (reviewer.toLowerCase() === authorName || reviewer.toLowerCase() === authorEmail) problems.push(`reviewer ("${reviewer}") matches the HEAD commit's own author identity`);
    if (typeof review.model !== 'string' || !review.model.trim()) problems.push('model field missing/empty');
    if (review.commit !== headSha) problems.push(`commit field ("${String(review.commit)}") does not equal current HEAD (${headSha}) -- review is stale`);
    if (review.verdict !== 'APPROVE') problems.push(`verdict is "${String(review.verdict)}", not APPROVE`);
    record(
      'C9-10',
      `read ${path.relative(repoRoot, reviewPath)}; git log -1 --format=%an/%ae ${headSha}`,
      'reviewer identity differs from HEAD\'s commit author, commit field equals current HEAD exactly, verdict is APPROVE',
      problems.length === 0,
      problems.join('\n') || `reviewer=${reviewer} model=${String(review.model)} commit=${String(review.commit)} verdict=${String(review.verdict)}`,
    );
  });

  // =======================================================================
  // GATE-INTEGRITY / LEASE / HEAD-DRIFT
  // =======================================================================
  await checkCriterion('GATE-INTEGRITY', () => {
    // Advisory-when-absent by the same two-phase design every other wave
    // verifier uses (verify-w0.ts, verify-w7.ts): an orchestrator pins
    // approved-gate.sha256 only AFTER this expansion is approved, which
    // cannot have happened before the approval this run is part of. The F4
    // collusion Sol found (editing routes + the frozen set + this verifier
    // together) is now independently closed by C9-1/C9-8 deriving the
    // frozen route set from baseCommit via git show, not from a HEAD
    // literal -- so this check's advisory posture pre-pin no longer leaves
    // that specific hole open regardless of pin timing.
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
    if (!fs.existsSync(approvedHashPath)) {
      record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', true, `sha256: ${selfSha256}\nno approved-gate.sha256 present -- advisory only, pinned by the orchestrator post-approval`);
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
            : "see W9-ingest-tranche.md AUTHOR-FLAGGED (round 1 disposition, ruling 3): docs/plans/waves/W9-ingest-tranche.md itself is outside leases.json's W9-ingest.allow at THIS branch's baseCommit -- expected to self-resolve once this PRD lands on main and a later implementation branch's baseCommit includes it",
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
  // Commit-bound manifest. Tamper re-check, then the FINAL write
  // (wroteOk:true) + an independently preserved per-run archival copy
  // (F9 fix).
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
  const finalManifest = buildManifest(true, treeDirty);
  const { written: manifestWritten, sha256: manifestSha256 } = writeManifestFile(finalManifest);
  const runArchiveDir = archiveRunArtifacts(finalManifest);

  const failures = results.filter((r) => r.status === 'fail');
  console.log(`\nverify-w9-ingest: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty}, wroteOk=true)`);
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md §2)');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  console.log(`RUN_ARCHIVE=${runArchiveDir}`);
  process.exit(failures.length === 0 && !treeDirty && manifestWritten ? 0 : 1);
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
