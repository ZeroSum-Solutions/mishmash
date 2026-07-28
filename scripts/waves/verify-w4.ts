// verify-w4.ts -- wave W4 (local project covers & scale) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w4.ts [--repo <path>]
// Exit 0 only when every C4 criterion passes and the tree is clean; the
// commit-bound proof manifest is written to the wave's goal-state proof
// directory either way. The manifest's own sha256 is printed as the LAST
// stdout line (`MANIFEST_SHA256=...`).
//
// VERIFIER-FIRST (VERIFICATION-CONTRACT.md S1): authored BEFORE
// apps/daemon/src/covers/** exists. Every criterion below either (a) probes
// behavior that already exists today (C4-7's live iframe, C4-8's sandbox
// contract, C4-9's DesignsTab fan-out -- these must show a REAL, substantive
// pre-implementation RED, not a "surface missing" skip), or (b) gates on a
// PRODUCT-SURFACE existence check first and fails cleanly with "product
// surface missing" when apps/daemon/src/covers/** and
// apps/daemon/src/routes/covers*.ts do not exist yet (matching the
// verify-w0.ts C0-1..C0-4 "product-surface gate" precedent) -- nothing in
// class (b) assumes the surface exists; the full behavioral logic runs the
// first time it does.
//
// CONTRACT THIS VERIFIER DEFINES -- FROZEN EXACTLY (Sol r1 ruling 4/finding
// 10: fuzzy route discovery was REJECTED as admitting decoy routes with no
// authoritative DTO; the implementation builds to these exact literal paths
// and schemas, no fallback, no route-inventory sniffing):
//
//   POST /api/projects/:id/cover/generate  -- SYNCHRONOUS: blocks until the
//     render job finishes (success, failure, or internal timeout) and
//     returns the final result in the response body.
//     Success (2xx): `{ ok: true, cover: { path: string (non-empty),
//       generatedAt: string (parseable date), sourceHash: string (>=8
//       chars -- the TRANSITIVE source hash per C4-3, not just index.html),
//       width: number (positive integer), height: number (positive
//       integer) } }`. Every field is validated, not just ok:true.
//     Failure (non-2xx): `{ ok: false, error: { code: 'RENDER_TIMEOUT' |
//       'RENDER_MEMORY_LIMIT' | string, message: string } }` -- the typed
//       code distinguishes a proven-enforced bound from an incidental
//       crash; C4-5's timeout/memory checks require the SPECIFIC typed
//       code, not just "any failure".
//   GET  /api/projects/:id/cover            -- raw image bytes, 200 if a
//     cover has been generated, 404 otherwise.
//
// od CLI subcommand key is frozen as exactly `cover` (SUBCOMMAND_MAP['cover'],
// exact match -- not /^cover/i, which would admit a decoy key like
// "coverage"). Per AGENTS.md "Capability exposure": the CLI calls the SAME
// HTTP endpoints above, it does not import daemon source directly -- C4-12
// grades CLI<->HTTP behavioral parity through those endpoints, never import-
// closure reachability (that check false-reds a correct HTTP-only CLI and
// was REMOVED per Sol r1 finding 8).
//
// Switching to an async 202/job-status design, or renaming any route/field/
// error code above, requires a reviewed gate amendment -- this file is the
// authority once approved, not the implementation.
//
// GATE-INTEGRITY / LEASE / HEAD-DRIFT follow the verify-w0.ts precedent
// exactly, including reading leases.json AT baseCommit via `git show`
// (never the working tree) -- a working-tree read was REJECTED in W2's
// review as a defect class this file must not repeat. The W4 lease was
// amended (Sol r1 rulings 1-3) to add apps/daemon/package.json,
// pnpm-lock.yaml, nix/pnpm-deps.nix, apps/daemon/src/server.ts,
// apps/daemon/src/backup/manifest.ts, apps/daemon/src/backup/create.ts, and
// scripts/waves/capability-manifest.json -- LEASE reads this from
// leases.json@baseCommit exactly as before; no code change was needed here,
// the amendment lands on main and becomes visible once merged into baseCommit.

import { execFile, execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type TypeScriptModule from 'typescript';
import type { Node as TsNode } from 'typescript';

const execFileAsync = promisify(execFile);
void execFileAsync;

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W4', commit: 'unknown', treeDirty: true, baseCommit: 'unknown',
      toolchain: { node: process.version, pnpm: 'unknown' },
      criteria: [{ id: 'INIT-FAILURE', command: 'module init', assertion: 'the verifier can initialize before any criterion runs', artifact: null, artifactSha256: null, exitCode: 1, status: 'fail', durationMs: 0, detail: errorMessage }],
    };
    fs.writeFileSync(path.join(os.tmpdir(), 'verify-w4-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
  } catch {
    /* truly nothing more we can do */
  }
  console.error(`verify-w4: FATAL during init: ${errorMessage}`);
  process.exit(1);
}

let repoRoot: string;
let proofDir: string;
let ts: typeof TypeScriptModule;
try {
  repoRoot = path.resolve(argValue('--repo') ?? process.cwd());
  proofDir = path.join(os.homedir(), '.claude', 'goal-state', 'mishmash-w4-project-covers', 'proof');
  fs.mkdirSync(proofDir, { recursive: true });
  ts = createRequire(path.join(repoRoot, 'package.json'))('typescript');
} catch (err) {
  emergencyExit(`init failed: ${String((err as Error)?.stack ?? err)}`);
}

// -----------------------------------------------------------------------
// Small shared utilities
// -----------------------------------------------------------------------
function sh(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: opts.cwd ?? repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      timeout: opts.timeoutMs ?? 15 * 60_000,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
function sha256Bytes(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function sha256File(absPath: string): string {
  return sha256Bytes(fs.readFileSync(absPath));
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------
// Result bookkeeping (house wroteOk pattern, matching verify-w0.ts /
// verify-w7.ts: an artifact write failure forces the criterion to fail --
// a criterion can never be recorded "pass" without proof surviving on disk).
// -----------------------------------------------------------------------
interface CriterionResult {
  id: string; command: string; assertion: string; artifact: string | null; artifactSha256: string | null;
  exitCode: number; status: 'pass' | 'fail' | 'blocked-on-founder';
  durationMs: number; detail?: string | undefined;
}
const results: CriterionResult[] = [];

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
  const fallbackResult = tryWrite(path.join(os.tmpdir(), 'verify-w4-fallback-proof', `${id}.txt`));
  if (fallbackResult) return fallbackResult;
  console.error(`verify-w4: artifact write failed for ${id} on both primary and fallback paths`);
  return { artifact: null, artifactSha256: null };
}

function record(id: string, command: string, assertion: string, ok: boolean, evidence: string, opts: { detail?: string | undefined; durationMs?: number; exitCode?: number } = {}): void {
  try {
    const { artifact, artifactSha256 } = artifactFor(id, `# ${id}\n# assertion: ${assertion}\n# verdict: ${ok ? 'pass' : 'fail'}\n${opts.detail ? `# detail: ${opts.detail}\n` : ''}\n${evidence}\n`);
    const effectiveOk = ok && artifact !== null;
    results.push({
      id, command, assertion, artifact, artifactSha256,
      exitCode: opts.exitCode ?? (effectiveOk ? 0 : 1),
      status: effectiveOk ? 'pass' : 'fail',
      durationMs: opts.durationMs ?? 0,
      detail: artifact === null ? `${opts.detail ? `${opts.detail}; ` : ''}artifact write failed -- forced fail` : opts.detail,
    });
  } catch (err) {
    results.push({ id, command, assertion, artifact: null, artifactSha256: null, exitCode: 1, status: 'fail', durationMs: opts.durationMs ?? 0, detail: `record() itself failed: ${String(err)}` });
  }
}

// Every criterion body runs through this. A thrown error inside fn() is
// caught HERE and recorded as a clean fail -- it can never crash the
// process. This is what makes "ZERO crashes" safe to promise even for
// class-(b) logic that cannot be executed against a real implementation
// yet: a latent bug in an unreached branch degrades to an honest fail, not
// a process exit.
async function runCriterion(
  id: string,
  command: string,
  assertion: string,
  fn: () => Promise<{ ok: boolean; evidence: string; detail?: string | undefined }>,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const { ok, evidence, detail } = await fn();
    record(id, command, assertion, ok, evidence, { detail, durationMs: Date.now() - startedAt });
  } catch (err) {
    record(id, command, assertion, false, String((err as Error)?.stack ?? err), {
      detail: `criterion crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
      exitCode: 1,
    });
  }
}

// -----------------------------------------------------------------------
// Hardened git plumbing (verify-w0.ts precedent)
// -----------------------------------------------------------------------
function gitOrFail(args: string[], why: string): string {
  const r = sh('git', args);
  if (r.status !== 0 || r.stdout.trim().length === 0) throw new Error(`git ${args.join(' ')} failed (${why}): exit=${r.status} stdout=${r.stdout.trim().slice(0, 200) || '<empty>'} stderr=${r.stderr.trim().slice(0, 200)}`);
  return r.stdout.trim();
}
function resolveMainRef(): { ref: string; sha: string } {
  const remoteHead = sh('git', ['ls-remote', 'origin', 'main']);
  if (remoteHead.status !== 0 || !remoteHead.stdout.trim()) throw new Error(`"git ls-remote origin main" failed (exit=${remoteHead.status}); cannot validate origin/main freshness`);
  const remoteSha = remoteHead.stdout.trim().split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{40}$/.test(remoteSha)) throw new Error('"git ls-remote origin main" returned an unparseable sha');
  for (const ref of ['origin/main', 'main']) {
    const verify = sh('git', ['rev-parse', '--verify', ref]);
    if (verify.status === 0 && verify.stdout.trim()) {
      const sha = verify.stdout.trim();
      if (sha !== remoteSha) throw new Error(`local ref "${ref}" (${sha.slice(0, 12)}) does not match live origin/main tip (${remoteSha.slice(0, 12)}) -- this verifier never fetches; re-run after syncing`);
      return { ref, sha };
    }
  }
  throw new Error('could not resolve "origin/main" or "main" locally to compute baseCommit');
}
function writeEmergencyManifest(errorMessage: string, partialResults: CriterionResult[] = []): void {
  const manifest = {
    wave: 'W4', commit: 'unknown', treeDirty: true, baseCommit: 'unknown',
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: [...partialResults, { id: 'GIT-RESOLUTION', command: 'git rev-parse HEAD / git ls-remote origin main / git merge-base', assertion: 'HEAD and baseCommit resolve to real, non-empty, non-equal, non-stale commits before any criterion runs', artifact: null, artifactSha256: null, exitCode: 1, status: 'fail', durationMs: 0, detail: errorMessage }],
  };
  let wrote = false;
  try {
    fs.mkdirSync(proofDir, { recursive: true });
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, path.join(proofDir, 'manifest.json'));
    wrote = true;
  } catch {
    /* fall through */
  }
  if (!wrote) {
    try {
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w4-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
    } catch {
      /* last resort */
    }
  }
  console.error(`verify-w4: FATAL, emergency manifest written=${wrote}: ${errorMessage}`);
}
function resolveGitContextOrExit(): { headSha: string; baseCommit: string } {
  try {
    const resolvedHeadSha = gitOrFail(['rev-parse', 'HEAD'], 'resolving HEAD commit');
    const mainRef = resolveMainRef();
    const resolvedBaseCommit = gitOrFail(['merge-base', mainRef.sha, resolvedHeadSha], 'computing baseCommit');
    if (resolvedBaseCommit === resolvedHeadSha) throw new Error(`HEAD (${resolvedHeadSha.slice(0, 12)}) equals baseCommit -- nothing committed yet on this branch, or already landed`);
    return { headSha: resolvedHeadSha, baseCommit: resolvedBaseCommit };
  } catch (err) {
    writeEmergencyManifest(String(err));
    process.exit(1);
  }
}
const { headSha, baseCommit } = resolveGitContextOrExit();
function readFileAtCommit(commit: string, relPath: string): string {
  const r = sh('git', ['show', `${commit}:${relPath}`]);
  if (r.status !== 0) throw new Error(`git show ${commit}:${relPath} failed (exit=${r.status}): ${r.stderr}`);
  return r.stdout;
}

// -----------------------------------------------------------------------
// AST helpers (TypeScript compiler API -- ground truth from real source,
// never a self-report)
// -----------------------------------------------------------------------
function parseTs(absPath: string): { sourceFile: TypeScriptModule.SourceFile; text: string } {
  const text = fs.readFileSync(absPath, 'utf8');
  return { sourceFile: ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true), text };
}
function extractSubcommandMapKeys(): string[] {
  const cliPath = path.join(repoRoot, 'apps/daemon/src/cli.ts');
  if (!fs.existsSync(cliPath)) return [];
  const { sourceFile } = parseTs(cliPath);
  const keys = new Set<string>();
  function visit(node: TsNode): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'SUBCOMMAND_MAP' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const prop of node.initializer.properties) {
        if (ts.isPropertyAssignment(prop)) {
          if (ts.isIdentifier(prop.name)) keys.add(prop.name.text);
          else if (ts.isStringLiteral(prop.name)) keys.add(prop.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return [...keys];
}
function findJsxIframeElements(absPath: string): { line: number; sandboxLiteral: string | null; hasSrc: boolean }[] {
  if (!fs.existsSync(absPath)) return [];
  const { sourceFile } = parseTs(absPath);
  const found: { line: number; sandboxLiteral: string | null; hasSrc: boolean }[] = [];
  function attrLiteral(el: TsNode, attrName: string): string | null {
    let out: string | null = null;
    function visit(n: TsNode): void {
      if (out !== null) return;
      if (ts.isJsxAttribute(n) && n.name.getText(sourceFile) === attrName) {
        if (n.initializer && ts.isStringLiteral(n.initializer)) out = n.initializer.text;
        else if (n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression && ts.isStringLiteral(n.initializer.expression)) out = n.initializer.expression.text;
      }
      ts.forEachChild(n, visit);
    }
    visit(el);
    return out;
  }
  function hasAttr(el: TsNode, attrName: string): boolean {
    let out = false;
    function visit(n: TsNode): void {
      if (out) return;
      if (ts.isJsxAttribute(n) && n.name.getText(sourceFile) === attrName) out = true;
      ts.forEachChild(n, visit);
    }
    visit(el);
    return out;
  }
  function tagName(el: TsNode): string {
    if (ts.isJsxSelfClosingElement(el)) return el.tagName.getText(sourceFile);
    if (ts.isJsxOpeningElement(el)) return el.tagName.getText(sourceFile);
    return '';
  }
  function visit(node: TsNode): void {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && tagName(node) === 'iframe') {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      found.push({ line: line + 1, sandboxLiteral: attrLiteral(node, 'sandbox'), hasSrc: hasAttr(node, 'src') });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

// -----------------------------------------------------------------------
// Process-tree helpers (macOS/BSD `ps`) -- used by C4-5's concurrency and
// memory-ceiling probes.
// -----------------------------------------------------------------------
interface PsRow { pid: number; ppid: number; rssKb: number; comm: string }
function psSnapshot(): PsRow[] {
  const r = sh('ps', ['-A', '-o', 'pid=,ppid=,rss=,comm=']);
  if (r.status !== 0) return [];
  const rows: PsRow[] = [];
  for (const line of r.stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    if (m && m[1] && m[2] && m[3] && m[4] !== undefined) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), comm: m[4] });
  }
  return rows;
}
function descendantsOf(rootPid: number, rows: PsRow[]): Set<number> {
  const byParent = new Map<number, number[]>();
  for (const r of rows) {
    const list = byParent.get(r.ppid) ?? [];
    list.push(r.pid);
    byParent.set(r.ppid, list);
  }
  const out = new Set<number>();
  const queue: number[] = [rootPid];
  while (queue.length > 0) {
    const p = queue.shift();
    if (p === undefined) continue;
    for (const c of byParent.get(p) ?? []) {
      if (!out.has(c)) { out.add(c); queue.push(c); }
    }
  }
  return out;
}

// -----------------------------------------------------------------------
// Canary network sentinel -- a REAL local TCP/HTTP listener. Used to prove
// (or disprove) real outbound egress at the process/browser level, never a
// mocked fetch/EventSource at the boundary under test (VERIFICATION-
// CONTRACT R2).
// -----------------------------------------------------------------------
interface CanaryHit { method: string; url: string; at: number }
interface CanaryServer { url: string; port: number; hits: CanaryHit[]; close: () => Promise<void> }
async function startCanaryServer(): Promise<CanaryServer> {
  const hits: CanaryHit[] = [];
  const server = http.createServer((req, res) => {
    hits.push({ method: req.method ?? 'GET', url: req.url ?? '', at: Date.now() });
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('canary-ok');
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('canary server failed to bind a loopback port');
  return {
    url: `http://127.0.0.1:${addr.port}`,
    port: addr.port,
    hits,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); }),
  };
}
// Self-test: proves the canary mechanism itself actually detects a hit
// before its "zero hits" result is trusted anywhere (R4 negative control --
// otherwise a broken canary trivially "passes" every network-denial check).
async function canarySelfTest(canary: CanaryServer): Promise<{ ok: boolean; evidence: string }> {
  const before = canary.hits.length;
  try {
    const resp = await fetch(`${canary.url}/self-test-${crypto.randomBytes(4).toString('hex')}`, { signal: AbortSignal.timeout(5000) });
    await resp.text().catch(() => undefined);
  } catch (err) {
    return { ok: false, evidence: `canary self-test fetch threw: ${String(err)}` };
  }
  const after = canary.hits.length;
  return { ok: after === before + 1, evidence: `canary hits before=${before} after=${after} (expected exactly +1)` };
}

// -----------------------------------------------------------------------
// Real daemon boot for direct HTTP probing / fixture seeding. Mirrors
// verify-w0.ts's bootDaemonForProbing: imports apps/daemon/src/server.ts
// directly via tsx (no dist build needed), boots on port 0 against a
// verifier-owned temp OD_DATA_DIR -- never the default namespace
// (ports 7456/51012), never a pid we did not spawn ourselves.
// -----------------------------------------------------------------------
interface RouteRegistration { method: string; path: string }
interface BootedDaemon { url: string; pid: number | undefined; dataDir: string; routeInventory: RouteRegistration[]; kill: () => Promise<void> }
async function bootDaemonForProbing(dataDir?: string, rootOverride?: string): Promise<BootedDaemon> {
  const root = rootOverride ?? repoRoot;
  const useDataDir = dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-verify-'));
  const bootScript = `
import path from 'node:path';
import { pathToFileURL } from 'node:url';
process.env.OD_DATA_DIR = ${JSON.stringify(useDataDir)};
process.env.OD_DAEMON_CLI_PATH = ${JSON.stringify(path.join(root, 'apps/daemon/dist/cli.js'))};
const mod = await import(pathToFileURL(${JSON.stringify(path.join(root, 'apps/daemon/src/server.ts'))}).href);
const started = await mod.startServer({ port: 0, returnServer: true });
console.log('OD_W4_VERIFIER_READY ' + JSON.stringify({ url: started.url, routeInventory: started.routeInventory }));
process.on('SIGTERM', async () => { await started.shutdown(); process.exit(0); });
`;
  const scriptPath = path.join(proofDir, `.boot-daemon.${process.pid}.${crypto.randomBytes(3).toString('hex')}.mjs`);
  fs.writeFileSync(scriptPath, bootScript);
  const child = spawn('pnpm', ['exec', 'tsx', scriptPath], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffered = '';
  const ready = await new Promise<{ url: string; routeInventory: RouteRegistration[] } | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 45_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const line = buffered.split('\n').find((l) => l.startsWith('OD_W4_VERIFIER_READY '));
      if (line) {
        clearTimeout(timeout);
        try { resolve(JSON.parse(line.slice('OD_W4_VERIFIER_READY '.length))); } catch { resolve(null); }
      }
    });
    child.on('exit', () => { clearTimeout(timeout); resolve(null); });
  });
  const kill = async (): Promise<void> => {
    if (child.pid) {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { try { if (child.pid) child.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 5_000);
      child.on('exit', () => { clearTimeout(t); resolve(); });
    });
    try { fs.unlinkSync(scriptPath); } catch { /* best effort */ }
  };
  if (!ready) {
    await kill();
    throw new Error(`daemon failed to boot within 45s (stdout tail: ${buffered.slice(-2000)})`);
  }
  return { url: ready.url, pid: child.pid, dataDir: useDataDir, routeInventory: ready.routeInventory, kill };
}

const odBinPath = path.join(repoRoot, 'apps/daemon/bin/od.mjs');
function odCli(args: string[], env: NodeJS.ProcessEnv, timeoutMs = 3 * 60_000): { status: number; stdout: string; stderr: string } {
  return sh('node', [odBinPath, ...args], { env, timeoutMs });
}
function odDataEnv(dataDir: string): NodeJS.ProcessEnv {
  return { ...process.env, OD_DATA_DIR: dataDir, OD_DAEMON_CLI_PATH: path.join(repoRoot, 'apps/daemon/dist/cli.js') };
}

// -----------------------------------------------------------------------
// Daemon HTTP fixture helpers (verify-w0.ts seeding pattern: real projects
// through the real HTTP API, never a synthetic fixture format).
// -----------------------------------------------------------------------
async function createProject(daemonUrl: string, id: string, name: string): Promise<void> {
  const resp = await fetch(`${daemonUrl}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) });
  if (!resp.ok) throw new Error(`create project ${id} failed: ${resp.status} ${await resp.text().catch(() => '')}`);
}
async function uploadProjectFile(daemonUrl: string, projectId: string, fileName: string, content: string | Buffer, mime = 'text/html'): Promise<void> {
  const form = new FormData();
  form.append('files', new Blob([content], { type: mime }), fileName);
  const resp = await fetch(`${daemonUrl}/api/projects/${encodeURIComponent(projectId)}/upload`, { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`upload ${fileName} into ${projectId} failed: ${resp.status} ${await resp.text().catch(() => '')}`);
}

// -----------------------------------------------------------------------
// Directory tree diffing -- used to discover the on-disk cover artifact
// this verifier does not know the exact filename/directory convention for
// ahead of time (implementation-agnostic by design).
// -----------------------------------------------------------------------
interface FileStat { mtimeMs: number; size: number; sha256: string }
function walkDataDir(dir: string): Map<string, FileStat> {
  const out = new Map<string, FileStat>();
  if (!fs.existsSync(dir)) return out;
  (function walk(d: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try {
          const st = fs.statSync(full);
          out.set(full, { mtimeMs: st.mtimeMs, size: st.size, sha256: sha256File(full) });
        } catch { /* file disappeared mid-walk, e.g. sqlite wal churn -- skip */ }
      }
    }
  })(dir);
  return out;
}
function newFilesSince(before: Map<string, FileStat>, after: Map<string, FileStat>): string[] {
  const out: string[] = [];
  for (const k of after.keys()) if (!before.has(k)) out.push(k);
  return out;
}

// -----------------------------------------------------------------------
// Product-surface gate: apps/daemon/src/covers/** and
// apps/daemon/src/routes/covers*.ts do not exist pre-implementation. Every
// backend-dependent criterion fails FAST and cleanly on this, matching the
// verify-w0.ts C0-1..C0-4 precedent ("today this fails 'product surface
// missing', which is the correct, honest result pre-implementation").
// -----------------------------------------------------------------------
function coverBackendSurface(): { coversDirExists: boolean; coverRoutesFiles: string[]; present: boolean } {
  const coversDir = path.join(repoRoot, 'apps/daemon/src/covers');
  const coversDirExists = fs.existsSync(coversDir) && fs.statSync(coversDir).isDirectory() && fs.readdirSync(coversDir).some((f) => f.endsWith('.ts'));
  const routesDir = path.join(repoRoot, 'apps/daemon/src/routes');
  const coverRoutesFiles = fs.existsSync(routesDir) ? fs.readdirSync(routesDir).filter((f) => /^covers.*\.ts$/i.test(f)) : [];
  return { coversDirExists, coverRoutesFiles, present: coversDirExists && coverRoutesFiles.length > 0 };
}
function backendGateFailure(): { ok: false; evidence: string; detail: string } {
  const surface = coverBackendSurface();
  return {
    ok: false,
    evidence: `apps/daemon/src/covers/ exists-with-.ts-files=${surface.coversDirExists}\napps/daemon/src/routes/covers*.ts matches=${JSON.stringify(surface.coverRoutesFiles)}`,
    detail: 'product surface missing: apps/daemon/src/covers/** and/or apps/daemon/src/routes/covers*.ts are not implemented yet -- correct, honest pre-implementation result',
  };
}

// -----------------------------------------------------------------------
// FROZEN routes (Sol r1 ruling 4 / finding 10 -- fuzzy discovery removed
// entirely). Exact literal paths, no route-inventory sniffing, no fallback.
// -----------------------------------------------------------------------
function coverGeneratePath(id: string): string {
  return `/api/projects/${encodeURIComponent(id)}/cover/generate`;
}
function coverFetchPath(id: string): string {
  return `/api/projects/${encodeURIComponent(id)}/cover`;
}

// -----------------------------------------------------------------------
// Frozen response-record validation (Sol r1 finding 1/finding 7): a POST
// success is only trusted once the FULL contract record validates -- path,
// generatedAt, sourceHash, width, height -- never just an `ok:true`
// envelope. A failure is only trusted as a PROVEN enforcement (timeout vs
// memory) when it carries the matching typed error code, distinguishing a
// real bound from an incidental crash below some arbitrary threshold.
// -----------------------------------------------------------------------
interface CoverRecord { path: string; generatedAt: string; sourceHash: string; width: number; height: number }
function validateCoverSuccessBody(body: unknown): { ok: boolean; record?: CoverRecord; reason?: string } {
  if (!isRecord(body) || body.ok !== true || !isRecord(body.cover)) return { ok: false, reason: 'missing ok:true / cover object' };
  const c = body.cover;
  if (typeof c.path !== 'string' || c.path.length === 0) return { ok: false, reason: 'cover.path missing/empty' };
  if (typeof c.generatedAt !== 'string' || Number.isNaN(Date.parse(c.generatedAt))) return { ok: false, reason: 'cover.generatedAt missing/unparseable' };
  if (typeof c.sourceHash !== 'string' || c.sourceHash.length < 8) return { ok: false, reason: 'cover.sourceHash missing/too short (must be the TRANSITIVE source hash, C4-3)' };
  if (typeof c.width !== 'number' || !Number.isInteger(c.width) || c.width <= 0) return { ok: false, reason: 'cover.width missing/not a positive integer' };
  if (typeof c.height !== 'number' || !Number.isInteger(c.height) || c.height <= 0) return { ok: false, reason: 'cover.height missing/not a positive integer' };
  return { ok: true, record: { path: c.path, generatedAt: c.generatedAt, sourceHash: c.sourceHash, width: c.width, height: c.height } };
}
type CoverErrorCode = 'RENDER_TIMEOUT' | 'RENDER_MEMORY_LIMIT';
function validateCoverErrorBody(body: unknown, expectedCode: CoverErrorCode): { ok: boolean; reason?: string } {
  if (!isRecord(body) || body.ok !== false || !isRecord(body.error)) return { ok: false, reason: 'missing ok:false / error object' };
  if (body.error.code !== expectedCode) return { ok: false, reason: `error.code=${JSON.stringify(body.error.code)}, expected ${expectedCode}` };
  if (typeof body.error.message !== 'string' || body.error.message.length === 0) return { ok: false, reason: 'error.message missing/empty' };
  return { ok: true };
}
interface GenerateResult { status: number; body: unknown; text: string }
async function postGenerate(daemonUrl: string, id: string, timeoutMs = 30_000): Promise<GenerateResult> {
  const resp = await fetch(`${daemonUrl}${coverGeneratePath(id)}`, { method: 'POST', signal: AbortSignal.timeout(timeoutMs) });
  const text = await resp.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: resp.status, body, text };
}
interface GetCoverResult { status: number; ok: boolean; bytes: Buffer | null }
async function getCover(daemonUrl: string, id: string, timeoutMs = 15_000): Promise<GetCoverResult> {
  const resp = await fetch(`${daemonUrl}${coverFetchPath(id)}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) return { status: resp.status, ok: false, bytes: null };
  return { status: resp.status, ok: true, bytes: Buffer.from(await resp.arrayBuffer()) };
}

// -----------------------------------------------------------------------
// Git worktree at an arbitrary commit (mirrors verify-w0.ts's
// verifyRedAtParent pattern) -- used by C4-10's parent-vs-head comparison
// (Sol r1 ruling 5). `git worktree add` alone gives a full standalone
// checkout of the whole repo at that commit (unlike W0, which only needed
// specific test files copied in); a real `pnpm install --offline` is still
// required because the parent commit's own package.json/lockfile may
// legitimately differ (e.g. before a renderer dependency was added).
// -----------------------------------------------------------------------
interface WorktreeHandle { dir: string; cleanup: () => void }
function createWorktreeAt(commit: string, label: string): WorktreeHandle | { error: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `od-w4-worktree-${label}-`));
  fs.rmSync(dir, { recursive: true, force: true });
  const add = sh('git', ['worktree', 'add', '--detach', dir, commit]);
  if (add.status !== 0) return { error: `git worktree add failed: ${add.stdout}\n${add.stderr}` };
  sh('mise', ['trust', dir], { timeoutMs: 30_000 });
  const install = sh('pnpm', ['install', '--offline'], { cwd: dir, timeoutMs: 5 * 60_000 });
  if (install.status !== 0) {
    sh('git', ['worktree', 'remove', '--force', dir]);
    fs.rmSync(dir, { recursive: true, force: true });
    return { error: `pnpm install --offline failed in ${label} worktree (exit=${install.status}): ${install.stdout.slice(-2000)}` };
  }
  return {
    dir,
    cleanup: () => {
      sh('git', ['worktree', 'remove', '--force', dir]);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Scratch copy of a corpus directory -- C4-10 must NEVER boot a daemon
// directly against a frozen baseline corpus (Sol r1 finding 2: daemon boots
// mutate the corpus's SQLite files, which is exactly what
// scale-baseline-2026-07.md's own "standing caveat" documents and what its
// R8 protocol implicitly assumes never happens to the FROZEN copy again
// once recorded).
function scratchCopyCorpus(corpusPath: string): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-corpus-scratch-'));
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(corpusPath, dest, { recursive: true });
  return dest;
}

// =========================================================================
// C4-1 -- covers persist and survive restart
// =========================================================================
// Frontend-uses-cover check (Sol r1 finding 7: C4-1's PRD text literally
// says "card renders the stored cover", not just "backend bytes persist").
// Pre-implementation there is no such rendering path to find (correct,
// honest gate), so this is folded into the SAME product-surface gate as the
// rest of C4-1 rather than invented against an unknown future prop shape.
// Structural, not behavioral: an <img> JSX element whose `src` binding
// source text references "cover" case-insensitively, in any of the three
// known cover-rendering surfaces.
// Sol r2 finding (C4-1, MEDIUM): the prior check accepted ANY <img> whose
// src text contained "cover" anywhere in the file, including a hidden
// decoy unrelated to a real card. Scoped: the <img> must have a JSX
// ANCESTOR (walking .parent, available because parseTs sets
// setParentNodes=true) whose className references "card" or "thumb" --
// the real card-container convention in all three known surfaces
// (design-card, design-card-thumb, recent-projects__card-thumb).
function jsxAncestorHasCardClassName(node: TsNode, sourceFile: TypeScriptModule.SourceFile): boolean {
  let current: TsNode | undefined = node.parent;
  while (current) {
    if (ts.isJsxOpeningElement(current) || ts.isJsxSelfClosingElement(current)) {
      for (const attr of current.attributes.properties) {
        if (ts.isJsxAttribute(attr) && attr.name.getText(sourceFile) === 'className' && attr.initializer) {
          if (/\b(card|thumb)\b/i.test(attr.initializer.getText(sourceFile))) return true;
        }
      }
    }
    current = current.parent;
  }
  return false;
}
function frontendRendersCoverImg(): { found: boolean; evidence: string } {
  const surfaces = ['apps/web/src/components/project-cover.tsx', 'apps/web/src/components/DesignsTab.tsx', 'apps/web/src/components/RecentProjectsStrip.tsx'];
  const rows: string[] = [];
  let found = false;
  for (const rel of surfaces) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) { rows.push(`${rel}: absent`); continue; }
    const { sourceFile, text } = parseTs(abs);
    let hit: number | null = null;
    let unscopedDecoyLine: number | null = null;
    function visit(node: TsNode): void {
      if (hit !== null) return;
      const isImg = (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === 'img')
        || (ts.isJsxOpeningElement(node) && node.tagName.getText(sourceFile) === 'img');
      if (isImg) {
        const attrs = ts.isJsxSelfClosingElement(node) ? node.attributes : (node as TypeScriptModule.JsxOpeningElement).attributes;
        for (const attr of attrs.properties) {
          if (ts.isJsxAttribute(attr) && attr.name.getText(sourceFile) === 'src' && attr.initializer) {
            const srcText = attr.initializer.getText(sourceFile);
            if (/cover/i.test(srcText)) {
              const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
              if (jsxAncestorHasCardClassName(node, sourceFile)) hit = line + 1;
              else unscopedDecoyLine = line + 1;
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    void text;
    rows.push(`${rel}: <img src=...cover...> inside a card/thumb-classed ancestor: ${hit !== null ? `found at line ${hit}` : 'NOT found'}${unscopedDecoyLine !== null ? ` (an UNSCOPED match outside any card/thumb ancestor exists at line ${unscopedDecoyLine} -- correctly ignored)` : ''}`);
    if (hit !== null) found = true;
  }
  return { found, evidence: rows.join('\n') };
}

async function checkC41(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  if (!coverBackendSurface().present) return backendGateFailure();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c41-'));
  let daemonA: BootedDaemon | undefined;
  let daemonB: BootedDaemon | undefined;
  try {
    daemonA = await bootDaemonForProbing(dataDir);
    const projectId = `w4-c41-${crypto.randomBytes(6).toString('hex')}`;
    await createProject(daemonA.url, projectId, projectId);
    await uploadProjectFile(daemonA.url, projectId, 'index.html', '<!doctype html><html><body><h1 style="background:#4477ff;width:100%;height:400px">Hero</h1></body></html>');

    const beforeTree = walkDataDir(dataDir);
    const gen = await postGenerate(daemonA.url, projectId);
    const genValidation = validateCoverSuccessBody(gen.body);
    if (gen.status < 200 || gen.status >= 300 || !genValidation.ok) {
      return { ok: false, evidence: `generate call: status=${gen.status} body=${gen.text.slice(0, 500)}\nrecord validation: ${genValidation.reason ?? 'ok'}`, detail: 'cover generation did not succeed with a full, valid S4-1 record on a valid fixture' };
    }
    const afterTree = walkDataDir(dataDir);
    const newFiles = newFilesSince(beforeTree, afterTree).filter((f) => path.resolve(f).startsWith(path.resolve(dataDir)));
    if (newFiles.length === 0) return { ok: false, evidence: 'no new file appeared under OD_DATA_DIR after cover generation', detail: 'cannot locate the on-disk cover artifact' };

    const frontend = frontendRendersCoverImg();

    const getResp1 = await getCover(daemonA.url, projectId);
    if (!getResp1.ok || !getResp1.bytes) return { ok: false, evidence: `GET cover before restart failed: ${getResp1.status}`, detail: 'cover route did not serve the just-generated cover' };
    const shaBefore = sha256Bytes(getResp1.bytes);
    const artifactStatsBefore = newFiles.map((f) => ({ f, stat: fs.statSync(f), sha: sha256File(f) }));

    await daemonA.kill();
    daemonA = undefined;

    daemonB = await bootDaemonForProbing(dataDir);
    const getResp2 = await getCover(daemonB.url, projectId);
    if (!getResp2.ok || !getResp2.bytes) return { ok: false, evidence: `GET cover after restart failed: ${getResp2.status}`, detail: 'stored cover did not survive restart' };
    const shaAfter = sha256Bytes(getResp2.bytes);

    const artifactStatsAfter = artifactStatsBefore.map(({ f }) => ({ f, stat: fs.statSync(f), sha: sha256File(f) }));
    const noRewrite = artifactStatsBefore.every((b, i) => {
      const a = artifactStatsAfter[i];
      return a && a.stat.mtimeMs === b.stat.mtimeMs && a.sha === b.sha;
    });

    const ok = shaBefore === shaAfter && noRewrite && frontend.found;
    return {
      ok,
      evidence: `POST generate record valid: ${JSON.stringify(genValidation.record)}\nnewFilesDiscovered=${JSON.stringify(newFiles)}\nshaBefore=${shaBefore}\nshaAfter=${shaAfter}\nonDiskMtimeUnchanged=${noRewrite}\n(artifact mtimes before: ${JSON.stringify(artifactStatsBefore.map((s) => s.stat.mtimeMs))}, after: ${JSON.stringify(artifactStatsAfter.map((s) => s.stat.mtimeMs))})\nfrontend renders an <img> against a cover URL:\n${frontend.evidence}`,
      detail: ok ? undefined : !frontend.found ? 'no card-rendering surface renders an <img> against a cover URL -- the PRD text is "card renders the stored cover", not just backend byte persistence' : 'card must render the stored cover after restart WITHOUT re-rendering -- either bytes changed or the on-disk artifact was rewritten',
    };
  } finally {
    if (daemonA) await daemonA.kill().catch(() => undefined);
    if (daemonB) await daemonB.kill().catch(() => undefined);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// -----------------------------------------------------------------------
// sharp resolution -- shared by C4-2 (decoding the cover PNG to raw pixels
// for the stripe-barcode reconstruction) and C4-3 (synthesizing REAL,
// decodable, visually-distinct PNGs for the image-invalidation leg -- Sol
// r1 finding 4: a signature-plus-four-bytes "PNG" is not real image
// content, so a correct renderer showing an identical broken-image result
// before and after could false-red). No @types/sharp is reachable from
// scripts/tsconfig.json (sharp is only a transitive dependency, resolved by
// directory scan) -- a minimal structural interface covering the calls
// this file makes, including sharp's `create` constructor form for
// synthesizing new images from raw pixel values.
// -----------------------------------------------------------------------
interface MinimalSharpInstance {
  ensureAlpha(): MinimalSharpInstance;
  raw(): MinimalSharpInstance;
  png(): MinimalSharpInstance;
  toBuffer(opts: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number; channels: number } }>;
  toBuffer(): Promise<Buffer>;
}
type MinimalSharpInput = Buffer | { create: { width: number; height: number; channels: number; background: { r: number; g: number; b: number; alpha: number } } };
type MinimalSharpFactory = (input: MinimalSharpInput) => MinimalSharpInstance;
function resolveSharp(): MinimalSharpFactory {
  const pnpmDir = path.join(repoRoot, 'node_modules/.pnpm');
  const dirName = fs.readdirSync(pnpmDir).filter((d) => d.startsWith('sharp@')).sort()[0];
  if (!dirName) throw new Error('sharp not found under node_modules/.pnpm -- expected as a transitive dependency (S4-3)');
  return createRequire(path.join(repoRoot, 'package.json'))(path.join(pnpmDir, dirName, 'node_modules/sharp')) as MinimalSharpFactory;
}
async function makeSolidPng(rgb: [number, number, number]): Promise<Buffer> {
  const sharp = resolveSharp();
  return sharp({ create: { width: 8, height: 8, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 } } }).png().toBuffer();
}

// =========================================================================
// C4-2 -- crop favors the hero on adversarial fixtures, graded with a REAL
// IoU oracle (Sol r1 ruling 6 / finding 3: the prior fixed six-color-palette
// design let a renderer that returns the SAME stock image for every input
// score a perfect "marker fraction" without ever rendering or cropping
// anything -- a fixed-template oracle).
//
// FROZEN CONTRACT, confirmed exactly by Sol r2 ruling 2: source viewport is
// SOURCE_WIDTH x SOURCE_HEIGHT (1280x1600), target cover is TARGET_WIDTH x
// TARGET_HEIGHT (1280x800), IoU threshold 0.45, fills-frame recall
// threshold 0.95. Every fixture now validates BOTH the POST response
// record's width/height AND the decoded PNG's actual pixel dimensions
// against the fixed target before any geometry/IoU scoring runs -- Sol r2
// finding 3: the prior oracle derived its "ideal window" height from the
// OBSERVED reconstructed window, so a renderer that returned the complete
// uncropped 1280x1600 source (never cropping at all) reconstructed a
// [0,1600] window, computed an "ideal" window of that same 1600px height
// (which clamps to exactly [0,1600] since SOURCE_HEIGHT-1600=0), and scored
// a spurious IoU of 1.0 -- passing every fixture without ever cropping.
// Now: (a) a dimension mismatch is a hard FAIL before scoring, so the
// uncropped case is caught immediately (height 1600 != 800), and (b) the
// ideal window is always computed against the FIXED TARGET_HEIGHT, never
// the observed window height, so IoU can no longer be gamed by matching a
// renderer's own (wrong) output size.
//
// Technique: the fixture page is a stack of STRIPE_COUNT horizontal, full-
// width stripes. Every run, "hero" stripes get freshly randomized, mutually
// distinct, high-contrast colors (crypto.randomInt, held out per run -- a
// cached/fixed-template renderer cannot special-case them), while "filler"
// stripes get a near-uniform low-contrast fillerBase color that ALSO
// encodes its own stripe index exactly in one channel (fillerBase + index),
// invisible to a human/entropy heuristic but exactly recoverable by this
// verifier. Sampling the OUTPUT PNG's pixels top-to-bottom and matching
// each against the known per-run color->index registry reconstructs the
// OBSERVED crop window in SOURCE Y-coordinates with pixel precision --
// no assumption about sharp's internal algorithm is needed, only that a
// crop-then-possibly-resize pipeline preserves stripe ORDER (index order
// can never be reshuffled by a crop+resize).
//
// A renderer that returns unrelated/stub content matches NO registered
// color anywhere in the output and is scored a hard FAIL (no stripes
// recognized), closing exactly the fixed-template gap Sol found.
const SOURCE_WIDTH = 1280;
const SOURCE_HEIGHT = 1600;
const TARGET_WIDTH = 1280;
const TARGET_HEIGHT = 800;
const STRIPE_HEIGHT = 40;
const STRIPE_COUNT = SOURCE_HEIGHT / STRIPE_HEIGHT; // 40
const MIN_DETECTED_STRIPES = 5; // below this, geometry reconstruction is not trustworthy

interface StripeSpec { index: number; rgb: [number, number, number] }

function randomVividColor(usedColors: [number, number, number][], avoidBase: number): [number, number, number] {
  for (let attempt = 0; attempt < 400; attempt++) {
    const r = crypto.randomInt(0, 256);
    const g = crypto.randomInt(0, 256);
    const b = crypto.randomInt(0, 256);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (spread < 70) continue; // reject near-gray colors (must be visually "colorful")
    if (Math.abs(r - avoidBase) + Math.abs(g - avoidBase) + Math.abs(b - avoidBase) < 90) continue; // far from filler base
    const farEnough = usedColors.every(([ur, ug, ub]) => Math.abs(ur - r) + Math.abs(ug - g) + Math.abs(ub - b) > 90);
    if (!farEnough) continue;
    return [r, g, b];
  }
  // Exhausted attempts (extremely unlikely with <40 stripes needed): fall
  // back to a deterministic distinct color rather than throwing.
  const fallback: [number, number, number] = [220, (usedColors.length * 37) % 256, (usedColors.length * 91) % 256];
  return fallback;
}

function buildStripes(heroRanges: { start: number; end: number }[], fillerBase: number): StripeSpec[] {
  const heroIndices = new Set<number>();
  for (const r of heroRanges) for (let i = r.start; i <= r.end; i++) heroIndices.add(i);
  const usedColors: [number, number, number][] = [];
  const stripes: StripeSpec[] = [];
  for (let i = 0; i < STRIPE_COUNT; i++) {
    if (heroIndices.has(i)) {
      const rgb = randomVividColor(usedColors, fillerBase);
      usedColors.push(rgb);
      stripes.push({ index: i, rgb });
    } else {
      stripes.push({ index: i, rgb: [fillerBase, fillerBase, fillerBase + i] });
    }
  }
  return stripes;
}
function stripesHtml(stripes: StripeSpec[]): string {
  const divs = stripes.map((s) => `<div style="width:100%;height:${STRIPE_HEIGHT}px;background:rgb(${s.rgb[0]},${s.rgb[1]},${s.rgb[2]});margin:0;padding:0;line-height:0"></div>`).join('');
  return `<!doctype html><html><body style="margin:0;padding:0;width:${SOURCE_WIDTH}px;height:${SOURCE_HEIGHT}px;overflow:hidden">${divs}</body></html>`;
}
function classifyPixel(r: number, g: number, b: number, heroStripes: StripeSpec[], fillerBase: number): number | null {
  if (Math.abs(r - fillerBase) <= 20 && Math.abs(g - fillerBase) <= 20 && b >= fillerBase - 5 && b <= fillerBase + STRIPE_COUNT + 5) {
    const idx = Math.round(b - fillerBase);
    if (idx >= 0 && idx < STRIPE_COUNT) return idx;
  }
  let best: { index: number; dist: number } | null = null;
  for (const h of heroStripes) {
    const dist = Math.abs(r - h.rgb[0]) + Math.abs(g - h.rgb[1]) + Math.abs(b - h.rgb[2]);
    if (!best || dist < best.dist) best = { index: h.index, dist };
  }
  return best && best.dist <= 90 ? best.index : null;
}
function reconstructObservedWindow(png: { data: Buffer; info: { width: number; height: number; channels: number } }, heroStripes: StripeSpec[], fillerBase: number): { window: [number, number]; matchedIndices: number[] } | { error: string } {
  const { data, info } = png;
  const centerX = Math.floor(info.width / 2);
  const matched: number[] = [];
  for (let y = 0; y < info.height; y++) {
    const offset = (y * info.width + centerX) * info.channels;
    const r = data[offset] ?? 0, g = data[offset + 1] ?? 0, b = data[offset + 2] ?? 0;
    const idx = classifyPixel(r, g, b, heroStripes, fillerBase);
    if (idx !== null) matched.push(idx);
  }
  const distinct = [...new Set(matched)];
  if (distinct.length < MIN_DETECTED_STRIPES) return { error: `only ${distinct.length} distinct stripe indices recognized in the output (need >=${MIN_DETECTED_STRIPES}) -- output does not resemble a crop of the fixture (stub/unrelated content?)` };
  const minIdx = Math.min(...distinct);
  const maxIdx = Math.max(...distinct);
  return { window: [minIdx * STRIPE_HEIGHT, (maxIdx + 1) * STRIPE_HEIGHT], matchedIndices: distinct.sort((a, b) => a - b) };
}
function idealWindowFor(heroY0: number, heroY1: number, windowHeight: number): [number, number] {
  const center = (heroY0 + heroY1) / 2;
  const y0 = Math.max(0, Math.min(center - windowHeight / 2, SOURCE_HEIGHT - windowHeight));
  return [y0, y0 + windowHeight];
}
function iou1d(a: [number, number], b: [number, number]): number {
  const overlap = Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
  const union = (a[1] - a[0]) + (b[1] - b[0]) - overlap;
  return union <= 0 ? 0 : overlap / union;
}

interface C42Fixture {
  name: string;
  heroRanges: { start: number; end: number }[];
  scoredHeroRange: { start: number; end: number }; // which hero range IoU is graded against (carousel has a distractor + a true hero)
  fillerBase: number;
  mode: 'iou' | 'recall'; // 'recall' for the trivial fills-frame control (see rationale below)
  threshold: number;
}
async function generateCoverAndReconstruct(daemon: BootedDaemon, projectId: string, html: string): Promise<{ png: { data: Buffer; info: { width: number; height: number; channels: number } }; record: CoverRecord } | { error: string }> {
  await createProject(daemon.url, projectId, projectId);
  await uploadProjectFile(daemon.url, projectId, 'index.html', html);
  const gen = await postGenerate(daemon.url, projectId);
  const genValidation = validateCoverSuccessBody(gen.body);
  if (gen.status < 200 || gen.status >= 300 || !genValidation.ok || !genValidation.record) return { error: `generate failed: status=${gen.status} record=${genValidation.reason ?? 'ok'}` };
  const got = await getCover(daemon.url, projectId);
  if (!got.ok || !got.bytes) return { error: `fetch cover failed: ${got.status}` };
  const sharp = resolveSharp();
  const { data, info } = await sharp(got.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { png: { data, info: { width: info.width, height: info.height, channels: info.channels } }, record: genValidation.record };
}
async function checkC42(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  if (!coverBackendSurface().present) return backendGateFailure();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c42-'));
  let daemon: BootedDaemon | undefined;
  try {
    daemon = await bootDaemonForProbing(dataDir);
    // left-nav-hero: hero sits well below the top of the page, simulating
    // content below a persistent nav/header -- a naive top-anchored crop
    // would score ~0 IoU here.
    // carousel: a SMALL distractor span near the top plus a BIGGER true
    // hero span lower down; IoU is graded against the true hero only.
    // dark-hero: near-black filler base -- tests that low luminance alone
    // does not suppress the heuristic.
    // fills-frame (trivial control): hero occupies nearly the entire
    // source. Graded by RECALL (fraction of the observed crop window that
    // falls inside the hero), not IoU-vs-ideal-window: when the hero is
    // much larger than any single crop window, EVERY reasonable crop
    // position is equally valid, so IoU-vs-one-ideal-window would wrongly
    // penalize a correct implementation for picking a different (still
    // fully-hero) offset than this verifier's arbitrary "centered" choice.
    const fixtures: C42Fixture[] = [
      { name: 'left-nav-hero', heroRanges: [{ start: 30, end: 34 }], scoredHeroRange: { start: 30, end: 34 }, fillerBase: 128, mode: 'iou', threshold: 0.45 },
      { name: 'carousel', heroRanges: [{ start: 2, end: 3 }, { start: 20, end: 25 }], scoredHeroRange: { start: 20, end: 25 }, fillerBase: 128, mode: 'iou', threshold: 0.45 },
      { name: 'dark-hero', heroRanges: [{ start: 12, end: 16 }], scoredHeroRange: { start: 12, end: 16 }, fillerBase: 20, mode: 'iou', threshold: 0.45 },
      { name: 'fills-frame', heroRanges: [{ start: 1, end: 38 }], scoredHeroRange: { start: 1, end: 38 }, fillerBase: 128, mode: 'recall', threshold: 0.95 },
    ];
    const outcomes: string[] = [];
    let allPass = true;
    for (const fixture of fixtures) {
      const stripes = buildStripes(fixture.heroRanges, fixture.fillerBase);
      const heroStripes = stripes.filter((s) => fixture.heroRanges.some((r) => s.index >= r.start && s.index <= r.end));
      const projectId = `w4-c42-${fixture.name}-${crypto.randomBytes(4).toString('hex')}`;
      const result = await generateCoverAndReconstruct(daemon, projectId, stripesHtml(stripes));
      if ('error' in result) { allPass = false; outcomes.push(`${fixture.name}: FAIL (${result.error})`); continue; }
      // Sol r2 finding 3 / ruling 2: dimension gate BEFORE any geometry
      // scoring. A renderer that skips cropping entirely (e.g. returns the
      // full 1280x1600 source untouched) must fail here, not slip through
      // to IoU scoring where an observed-height-derived "ideal" window
      // would trivially match its own output.
      const { record, png } = result;
      const dimsOk = record.width === TARGET_WIDTH && record.height === TARGET_HEIGHT && png.info.width === TARGET_WIDTH && png.info.height === TARGET_HEIGHT;
      if (!dimsOk) {
        allPass = false;
        outcomes.push(`${fixture.name}: FAIL (dimension mismatch -- expected ${TARGET_WIDTH}x${TARGET_HEIGHT}, got record=${record.width}x${record.height} decodedPng=${png.info.width}x${png.info.height})`);
        continue;
      }
      const recon = reconstructObservedWindow(png, heroStripes, fixture.fillerBase);
      if ('error' in recon) { allPass = false; outcomes.push(`${fixture.name}: FAIL (${recon.error})`); continue; }
      const scoredHeroY0 = fixture.scoredHeroRange.start * STRIPE_HEIGHT;
      const scoredHeroY1 = (fixture.scoredHeroRange.end + 1) * STRIPE_HEIGHT;
      let score: number;
      let scoreLabel: string;
      if (fixture.mode === 'recall') {
        const overlap = Math.max(0, Math.min(recon.window[1], scoredHeroY1) - Math.max(recon.window[0], scoredHeroY0));
        const observedSize = recon.window[1] - recon.window[0];
        score = observedSize <= 0 ? 0 : overlap / observedSize;
        scoreLabel = 'recall(observed-in-hero)';
      } else {
        // Fixed 800px source window, never the observed output height
        // (Sol r2 ruling 2) -- grading against TARGET_HEIGHT means IoU can
        // only reward a crop that both has the right size AND favors the
        // hero, not merely a window shaped like whatever the renderer
        // happened to emit.
        const ideal = idealWindowFor(scoredHeroY0, scoredHeroY1, TARGET_HEIGHT);
        score = iou1d(recon.window, ideal);
        scoreLabel = `IoU(observed,ideal=[${ideal[0]},${ideal[1]}])`;
      }
      const pass = score >= fixture.threshold;
      if (!pass) allPass = false;
      outcomes.push(`${fixture.name}: observedWindow=[${recon.window[0]},${recon.window[1]}] matchedIndices=${JSON.stringify(recon.matchedIndices)} scoredHero=[${scoredHeroY0},${scoredHeroY1}] ${scoreLabel}=${score.toFixed(3)} threshold=${fixture.threshold} -> ${pass ? 'PASS' : 'FAIL'}`);
    }
    return { ok: allPass, evidence: outcomes.join('\n'), detail: allPass ? undefined : 'crop did not favor the (per-run randomized, held-out) hero stripes on one or more adversarial fixtures, per a real IoU/recall oracle against frozen expected geometry' };
  } finally {
    if (daemon) await daemon.kill().catch(() => undefined);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// =========================================================================
// C4-3 / C4-4 -- invalidation: transitive render graph (CSS, image, AND
// font -- Sol r1 finding 4), content-hash-driven not mtime-driven,
// including the "bytes changed while mtime stays fixed" direction (finding
// 4) via DIRECT filesystem manipulation of the daemon's own on-disk copy
// (discovered through walkDataDir, never assumed) -- HTTP alone cannot pin
// an mtime after a byte change, since every upload naturally touches it.
//
// Grading signal: the POST /cover/generate response's validated
// `cover.sourceHash` field (frozen contract), NOT a byte-diff of the
// rendered cover image. Sol r1 finding 4: comparing rendered PIXELS is
// false-red-prone for the image/font legs specifically, because a
// correctly-invalidated-and-regenerated cover can still render IDENTICAL
// pixels by coincidence (e.g. the same broken-image icon before and after
// an undecodable image edit) even though invalidation worked perfectly.
// sourceHash is defined as spanning the transitive render graph regardless
// of whether the edit is visually perceptible, so it is immune to that
// class of false-red. The image leg additionally uses REAL, decodable,
// visually-DISTINCT PNGs (via sharp) as a second, corroborating signal.
// =========================================================================
function findProjectFileOnDisk(dataDir: string, projectId: string, fileName: string): string | null {
  for (const p of walkDataDir(dataDir).keys()) {
    if (path.basename(p) === fileName && p.includes(projectId)) return p;
  }
  return null;
}
interface GenerateOutcome { sourceHash: string; coverBytesSha: string }
async function generateAndCapture(daemon: BootedDaemon, projectId: string): Promise<GenerateOutcome | { error: string }> {
  const gen = await postGenerate(daemon.url, projectId);
  const v = validateCoverSuccessBody(gen.body);
  if (gen.status < 200 || gen.status >= 300 || !v.ok || !v.record) return { error: `generate failed or invalid record: status=${gen.status} ${v.reason ?? ''} body=${gen.text.slice(0, 300)}` };
  const got = await getCover(daemon.url, projectId);
  if (!got.ok || !got.bytes) return { error: `GET cover failed after generate: ${got.status}` };
  return { sourceHash: v.record.sourceHash, coverBytesSha: sha256Bytes(got.bytes) };
}

interface C43C44Result { ok43: boolean; ok44: boolean; evidence: string; gated: boolean }
async function probeC43C44(): Promise<C43C44Result> {
  if (!coverBackendSurface().present) {
    const gate = backendGateFailure();
    return { ok43: false, ok44: false, evidence: gate.evidence, gated: true };
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c34-'));
  let daemon: BootedDaemon | undefined;
  const rows: string[] = [];
  try {
    daemon = await bootDaemonForProbing(dataDir);
    const projectId = `w4-c34-${crypto.randomBytes(6).toString('hex')}`;
    const htmlV1 = '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><div class="hero">v1</div></body></html>';
    const cssV1 = '.hero{background:#101010;width:100%;height:300px}';
    await createProject(daemon.url, projectId, projectId);
    await uploadProjectFile(daemon.url, projectId, 'index.html', htmlV1);
    await uploadProjectFile(daemon.url, projectId, 'styles.css', cssV1, 'text/css');

    const gen1 = await generateAndCapture(daemon, projectId);
    if ('error' in gen1) return { ok43: false, ok44: false, evidence: `baseline generate failed: ${gen1.error}`, gated: false };
    rows.push(`baseline: sourceHash=${gen1.sourceHash} coverBytesSha=${gen1.coverBytesSha}`);

    // --- C4-4a: mtime touch WITHOUT byte change must NOT regenerate.
    // DIRECT filesystem mtime bump on the daemon's own on-disk copy (bytes
    // untouched byte-for-byte) -- the strongest form of this negative
    // control, not inferable by touching the HTTP layer alone.
    const indexAbs = findProjectFileOnDisk(dataDir, projectId, 'index.html');
    if (!indexAbs) return { ok43: false, ok44: false, evidence: `${rows.join('\n')}\ncould not locate index.html on disk under OD_DATA_DIR for project ${projectId}`, gated: false };
    const bumpedMtime = new Date(Date.now() + 60_000);
    fs.utimesSync(indexAbs, bumpedMtime, bumpedMtime);
    const gen2 = await generateAndCapture(daemon, projectId);
    if ('error' in gen2) return { ok43: false, ok44: false, evidence: `${rows.join('\n')}\nmtime-touch-only generate failed: ${gen2.error}`, gated: false };
    const c44a = gen2.sourceHash === gen1.sourceHash;
    rows.push(`C4-4a mtime-touch-only (fs.utimesSync, bytes untouched): sourceHash=${gen2.sourceHash} unchanged=${c44a}`);

    // --- C4-4b: byte change WITH mtime PINNED to its original value must
    // regenerate. Direct fs write + fs.utimesSync restoring the ORIGINAL
    // mtime -- proves invalidation is driven by content, not mtime, from
    // the direction mtime literally lies.
    const statBeforeB = fs.statSync(indexAbs);
    const htmlV2 = htmlV1.replace('v1', 'v2-content-changed-mtime-pinned');
    fs.writeFileSync(indexAbs, htmlV2);
    fs.utimesSync(indexAbs, statBeforeB.atime, statBeforeB.mtime);
    const gen3 = await generateAndCapture(daemon, projectId);
    if ('error' in gen3) return { ok43: false, ok44: false, evidence: `${rows.join('\n')}\nbyte-change-mtime-pinned generate failed: ${gen3.error}`, gated: false };
    const c44b = gen3.sourceHash !== gen2.sourceHash;
    rows.push(`C4-4b byte-change-mtime-PINNED (fs.writeFileSync + fs.utimesSync restoring the OLD mtime): sourceHash=${gen3.sourceHash} changed=${c44b}`);

    // --- C4-4c: byte change via the normal HTTP upload path (mtime moves
    // naturally too) must ALSO regenerate -- an ordinary positive control
    // alongside the two filesystem-level directional proofs above.
    const htmlV3 = htmlV2.replace('v2-content-changed-mtime-pinned', 'v3-http-reupload');
    await uploadProjectFile(daemon.url, projectId, 'index.html', htmlV3);
    const gen4 = await generateAndCapture(daemon, projectId);
    if ('error' in gen4) return { ok43: false, ok44: false, evidence: `${rows.join('\n')}\nhttp-reupload generate failed: ${gen4.error}`, gated: false };
    const c44c = gen4.sourceHash !== gen3.sourceHash;
    rows.push(`C4-4c http-reupload (ordinary positive control): sourceHash=${gen4.sourceHash} changed=${c44c}`);

    // --- C4-3 (CSS leg): edit ONLY the linked CSS, leave index.html
    // untouched. Must still regenerate -- the exact S4-5 "entry-hash-only
    // serves stale covers" failure mode.
    const cssV2 = cssV1.replace('#101010', '#e00000');
    await uploadProjectFile(daemon.url, projectId, 'styles.css', cssV2, 'text/css');
    const gen5 = await generateAndCapture(daemon, projectId);
    if ('error' in gen5) return { ok43: false, ok44: false, evidence: `${rows.join('\n')}\ncss-only-edit generate failed: ${gen5.error}`, gated: false };
    const c43css = gen5.sourceHash !== gen4.sourceHash;
    rows.push(`C4-3 css-only-edit: sourceHash=${gen5.sourceHash} changed=${c43css}`);

    // --- C4-3 (image leg): a REAL, decodable, visually-distinct PNG (via
    // sharp) -- not a signature-plus-arbitrary-bytes blob, so a
    // correctly-regenerated cover cannot coincidentally hash the same by
    // rendering the same broken-image icon both times.
    const htmlV4 = htmlV3.replace('</body>', '<img src="hero.png" width="8" height="8"></body>');
    await uploadProjectFile(daemon.url, projectId, 'index.html', htmlV4);
    await uploadProjectFile(daemon.url, projectId, 'hero.png', await makeSolidPng([220, 20, 20]), 'image/png');
    const gen6 = await generateAndCapture(daemon, projectId);
    if ('error' in gen6) return { ok43: false, ok44: false, evidence: `${rows.join('\n')}\nbefore-image-edit generate failed: ${gen6.error}`, gated: false };
    await uploadProjectFile(daemon.url, projectId, 'hero.png', await makeSolidPng([20, 20, 220]), 'image/png');
    const gen7 = await generateAndCapture(daemon, projectId);
    if ('error' in gen7) return { ok43: false, ok44: false, evidence: `${rows.join('\n')}\nafter-image-edit generate failed: ${gen7.error}`, gated: false };
    const c43img = gen7.sourceHash !== gen6.sourceHash;
    rows.push(`C4-3 image-edit (real decodable 8x8 solid PNG, red->blue): before sourceHash=${gen6.sourceHash} after=${gen7.sourceHash} changed=${c43img}`);

    // --- C4-3 (font leg): a locally-linked @font-face file, edited in
    // place -- Sol r1 finding 4 explicitly requires this leg (the PRD names
    // "CSS, images, AND fonts"). Grading via sourceHash (not rendered
    // pixels) means the font bytes do not need to be a parseable font --
    // invalidation must still see the byte change in the transitive graph
    // regardless of whether an unparseable font visually renders any
    // differently (the exact false-red class this rewrite closes).
    const cssV3 = `${cssV2}\n@font-face{font-family:'W4Probe';src:url('probe.woff2') format('woff2');}\n.hero{font-family:'W4Probe';}`;
    await uploadProjectFile(daemon.url, projectId, 'styles.css', cssV3, 'text/css');
    await uploadProjectFile(daemon.url, projectId, 'probe.woff2', Buffer.from(`w4-font-v1-${crypto.randomBytes(8).toString('hex')}`), 'font/woff2');
    const gen8 = await generateAndCapture(daemon, projectId);
    if ('error' in gen8) return { ok43: false, ok44: false, evidence: `${rows.join('\n')}\nbefore-font-edit generate failed: ${gen8.error}`, gated: false };
    await uploadProjectFile(daemon.url, projectId, 'probe.woff2', Buffer.from(`w4-font-v2-${crypto.randomBytes(8).toString('hex')}`), 'font/woff2');
    const gen9 = await generateAndCapture(daemon, projectId);
    if ('error' in gen9) return { ok43: false, ok44: false, evidence: `${rows.join('\n')}\nafter-font-edit generate failed: ${gen9.error}`, gated: false };
    const c43font = gen9.sourceHash !== gen8.sourceHash;
    rows.push(`C4-3 font-edit (linked @font-face file, bytes changed): before sourceHash=${gen8.sourceHash} after=${gen9.sourceHash} changed=${c43font}`);

    return {
      ok43: c43css && c43img && c43font,
      ok44: c44a && c44b && c44c,
      evidence: rows.join('\n'),
      gated: false,
    };
  } finally {
    if (daemon) await daemon.kill().catch(() => undefined);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function runC43C44(): Promise<void> {
  const startedAt = Date.now();
  const command = 'generate -> fs.utimesSync mtime-only bump / fs.writeFileSync+utimesSync byte-change-mtime-pinned / HTTP re-upload / CSS-only edit / real-PNG image edit / font-file edit -> compare POST-response cover.sourceHash (one shared probe run, graded as two criteria)';
  try {
    const result = await probeC43C44();
    const durationMs = Date.now() - startedAt;
    record(
      'C4-3', command,
      'invalidation spans the TRANSITIVE render graph: editing ONLY linked local CSS, a linked local image (real decodable PNG), or a linked local font regenerates the cover (sourceHash changes) even when index.html itself is byte-identical',
      result.ok43, result.evidence,
      { durationMs, detail: result.ok43 ? undefined : result.gated ? 'product surface missing: apps/daemon/src/covers/** and/or apps/daemon/src/routes/covers*.ts are not implemented yet -- correct, honest pre-implementation result' : 'entry-hash-only invalidation serves a stale cover after a CSS, image, or font edit' },
    );
    record(
      'C4-4', command,
      'invalidation is content-hash-driven, not mtime-driven: a filesystem-level mtime bump with byte-identical content never changes sourceHash, and a real byte change with mtime PINNED to its original value always does',
      result.ok44, result.evidence,
      { durationMs, detail: result.ok44 ? undefined : result.gated ? 'product surface missing: apps/daemon/src/covers/** and/or apps/daemon/src/routes/covers*.ts are not implemented yet -- correct, honest pre-implementation result' : 'invalidation is not purely content-driven in both directions' },
    );
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const evidence = String((err as Error)?.stack ?? err);
    const detail = `criterion crashed: ${String(err)}`;
    record('C4-3', command, 'invalidation spans the TRANSITIVE render graph', false, evidence, { detail, durationMs, exitCode: 1 });
    record('C4-4', command, 'invalidation is content-hash-driven, not mtime-driven', false, evidence, { detail, durationMs, exitCode: 1 });
  }
}

// =========================================================================
// C4-5 -- renderer is bounded (concurrency cap, per-job timeout, memory
// ceiling), including a deliberately pathological project.
//
// Ceremony ruling item 1 (2026-07-28): a prior round's report and this
// comment block described this design, but the EXECUTABLE code below still
// had the old round1Bounded/1.6x/no-RSS-baseline logic -- the code below is
// the actual, re-verified fix; do not trust this comment on its own.
//
// Sol r2 fixes (round-1 finding 1 was still broken):
//  (a) timeout + successful-slow-job control unchanged (already correct).
//  (b) the plateau oracle had two boundary bugs: `round1Bounded` compared
//      round1 against `M*0.9`, which false-reds a genuinely correct cap
//      EQUAL to M (ideal concurrency 8 at M=8 is NOT <7.2). And the 1.6x
//      plateau tolerance was loose enough that an uncapped renderer merely
//      slowed by CPU saturation (observed 7.1 then 10.65 across M/2M) still
//      passed (10.65 <= 7.1*1.6=11.36). Fix: DROP the round1-vs-M
//      comparison entirely -- boundedness is proven ONLY by the plateau
//      ratio between round1 and round2, tightened to 1.25x (10.65 >
//      7.1*1.25=8.875 now correctly fails; a real fixed cap of 8, round1
//      ~8 round2 ~8, ratio ~1.0, correctly passes). Every job in both
//      rounds must ALSO return a full VALIDATED cover record, not merely
//      2xx (a stub returning empty 200s could otherwise pass).
//  (c) memory now additionally requires OBSERVED RSS GROWTH (peak minus a
//      pre-submission baseline sample) before trusting the typed error --
//      an immediate RENDER_MEMORY_LIMIT with zero observed allocation
//      proves nothing about a real ceiling being exercised.
// =========================================================================
function blockingScriptHtml(blockMs: number): string {
  return `<!doctype html><html><body><script>const s=Date.now();while(Date.now()-s<${blockMs}){}</script><div>blocked ${blockMs}ms</div></body></html>`;
}
const INFINITE_LOOP_HTML = '<!doctype html><html><body><script>while(true){}</script></body></html>';
const MEMORY_HOG_HTML = '<!doctype html><html><body><script>let a=[];while(true){a.push(new Array(2000000).fill(7));}</script></body></html>';

async function measureThroughputConcurrency(daemon: BootedDaemon, m: number, blockMs: number): Promise<{ effectiveConcurrency: number; wallClockMs: number; successCount: number; invalidRecordCount: number }> {
  const ids = Array.from({ length: m }, (_, i) => `w4-c45-conc-${m}-${i}-${crypto.randomBytes(3).toString('hex')}`);
  for (const id of ids) {
    await createProject(daemon.url, id, id);
    await uploadProjectFile(daemon.url, id, 'index.html', blockingScriptHtml(blockMs));
  }
  const t0 = Date.now();
  const outcomes = await Promise.all(ids.map((id) => postGenerate(daemon.url, id, 60_000).catch(() => null)));
  const wallClockMs = Date.now() - t0;
  let successCount = 0;
  let invalidRecordCount = 0;
  for (const o of outcomes) {
    if (!o || o.status < 200 || o.status >= 300) continue;
    if (validateCoverSuccessBody(o.body).ok) successCount++;
    else invalidRecordCount++;
  }
  const effectiveConcurrency = wallClockMs <= 0 ? m : (m * blockMs) / wallClockMs;
  return { effectiveConcurrency, wallClockMs, successCount, invalidRecordCount };
}

async function checkC45(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  if (!coverBackendSurface().present) return backendGateFailure();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c45-'));
  let daemon: BootedDaemon | undefined;
  try {
    daemon = await bootDaemonForProbing(dataDir);
    const rows: string[] = [];

    // --- (a) per-job timeout, PAIRED with a successful-slow-job control. ---
    const slowOkProjectId = `w4-c45-slowok-${crypto.randomBytes(4).toString('hex')}`;
    await createProject(daemon.url, slowOkProjectId, slowOkProjectId);
    await uploadProjectFile(daemon.url, slowOkProjectId, 'index.html', blockingScriptHtml(3000));
    const slowOk = await postGenerate(daemon.url, slowOkProjectId, 60_000);
    const slowOkValidation = validateCoverSuccessBody(slowOk.body);
    const slowOkPass = slowOk.status >= 200 && slowOk.status < 300 && slowOkValidation.ok;
    rows.push(`successful-slow-job control (3s block, well within timeout): status=${slowOk.status} recordValid=${slowOkValidation.ok} (${slowOkValidation.reason ?? 'ok'}) -> ${slowOkPass ? 'PASS' : 'FAIL'}`);

    const timeoutProjectId = `w4-c45-timeout-${crypto.randomBytes(4).toString('hex')}`;
    await createProject(daemon.url, timeoutProjectId, timeoutProjectId);
    await uploadProjectFile(daemon.url, timeoutProjectId, 'index.html', INFINITE_LOOP_HTML);
    const timeoutStart = Date.now();
    const timeoutResp = await postGenerate(daemon.url, timeoutProjectId, 90_000).catch((err) => ({ status: -1, body: null, text: String(err) }));
    const timeoutElapsed = Date.now() - timeoutStart;
    const timeoutValidation = validateCoverErrorBody(timeoutResp.body, 'RENDER_TIMEOUT');
    const perJobTimeoutOk = timeoutResp.status >= 400 && timeoutValidation.ok && timeoutElapsed < 90_000;
    rows.push(`per-job-timeout (infinite loop): status=${timeoutResp.status} elapsedMs=${timeoutElapsed} typedError=${timeoutValidation.ok} (${timeoutValidation.reason ?? 'ok'}) -> ${perJobTimeoutOk ? 'PASS' : 'FAIL'}`);

    // --- (b) concurrency cap via throughput inference at M and 2M. ---
    // Ceremony ruling item 1: round1Bounded (an absolute round-one-vs-M
    // predicate) is DELETED ENTIRELY, with NO replacement absolute
    // predicate -- it false-red a genuinely correct cap equal to M. The
    // SOLE plateau predicate is round2.effectiveConcurrency <=
    // round1.effectiveConcurrency * 1.25. concurrencyOk additionally
    // requires that round one produced EXACTLY M fully-validated success
    // records and round two produced EXACTLY 2M, with zero invalid
    // records in either round (a stub returning empty/malformed 200s
    // must not pass).
    const M = 8;
    const BLOCK_MS = 1500;
    const round1 = await measureThroughputConcurrency(daemon, M, BLOCK_MS);
    const round2 = await measureThroughputConcurrency(daemon, M * 2, BLOCK_MS);
    const plateauRatio = round1.effectiveConcurrency > 0 ? round2.effectiveConcurrency / round1.effectiveConcurrency : Infinity;
    const plateaus = round2.effectiveConcurrency <= round1.effectiveConcurrency * 1.25;
    const round1FullyValid = round1.successCount === M && round1.invalidRecordCount === 0;
    const round2FullyValid = round2.successCount === M * 2 && round2.invalidRecordCount === 0;
    const concurrencyOk = plateaus && round1FullyValid && round2FullyValid;
    rows.push(`concurrency (throughput-inferred, NO round1Bounded predicate): M=${M} blockMs=${BLOCK_MS}\nround1: wallClockMs=${round1.wallClockMs} effectiveConcurrency=${round1.effectiveConcurrency.toFixed(4)} successCount=${round1.successCount}/${M} invalidRecordCount=${round1.invalidRecordCount} fullyValid=${round1FullyValid}\nround2(2M=${M * 2}): wallClockMs=${round2.wallClockMs} effectiveConcurrency=${round2.effectiveConcurrency.toFixed(4)} successCount=${round2.successCount}/${M * 2} invalidRecordCount=${round2.invalidRecordCount} fullyValid=${round2FullyValid}\nplateauRatio(round2/round1)=${plateauRatio.toFixed(4)} threshold<=1.25 plateaus=${plateaus}\n-> ${concurrencyOk ? 'PASS' : 'FAIL'}`);

    // --- (c) memory ceiling: AGGREGATE (summed) RSS across all daemon-
    // descendant processes, requiring the TYPED RENDER_MEMORY_LIMIT error
    // AND observed RSS growth over a pre-submission baseline (ceremony
    // ruling item 1c) -- an immediate typed error at zero observed growth
    // proves nothing about a real ceiling being exercised.
    const memProjectId = `w4-c45-mem-${crypto.randomBytes(4).toString('hex')}`;
    await createProject(daemon.url, memProjectId, memProjectId);
    await uploadProjectFile(daemon.url, memProjectId, 'index.html', MEMORY_HOG_HTML);
    const MEMORY_CEILING_KB = 3 * 1024 * 1024; // 3 GB outer sane bound on the AGGREGATE
    const rootPid = daemon.pid;
    // Confirmation-round bypass fix (C4-5): psSnapshot() silently converts a
    // failed `ps` invocation into `[]`, and the old aggregator then silently
    // converted THAT into `0` -- indistinguishable from "genuinely zero
    // descendant RSS". `ps -A` lists the WHOLE system process table; a
    // truly successful call can never return zero total rows (there are
    // always hundreds of unrelated system processes), so an empty snapshot
    // is a reliable signal that `ps` itself failed, not that RSS is zero.
    // Each sample now carries an explicit validity flag instead of
    // collapsing failure into a number indistinguishable from a real zero.
    function aggregateDescendantRssKbChecked(pid: number | undefined): { rssKb: number; valid: boolean } {
      if (!pid) return { rssKb: 0, valid: false };
      const snap = psSnapshot();
      if (snap.length === 0) return { rssKb: 0, valid: false };
      const desc = descendantsOf(pid, snap);
      return { rssKb: snap.filter((r) => desc.has(r.pid)).reduce((sum, r) => sum + r.rssKb, 0), valid: true };
    }
    // Baseline taken IMMEDIATELY before submission, via the SAME
    // process-tree aggregation the poller uses below -- polling (and peak
    // tracking) starts before the job is submitted.
    const baselineSample = aggregateDescendantRssKbChecked(rootPid);
    const baselineValid = baselineSample.valid;
    const baselineAggregateRssKb = baselineSample.rssKb;
    let peakAggregateRssKb = baselineAggregateRssKb;
    let pollValidSamples = 0;
    let pollTotalSamples = 0;
    const pollAbort = new AbortController();
    const poller = (async () => {
      while (!pollAbort.signal.aborted) {
        pollTotalSamples++;
        const sample = aggregateDescendantRssKbChecked(rootPid);
        if (sample.valid) {
          pollValidSamples++;
          if (sample.rssKb > peakAggregateRssKb) peakAggregateRssKb = sample.rssKb;
        }
        await sleep(400);
      }
    })();
    let memResp: GenerateResult;
    try {
      memResp = await postGenerate(daemon.url, memProjectId, 60_000);
    } catch (err) {
      memResp = { status: -1, body: null, text: String(err) };
    } finally {
      pollAbort.abort();
      await poller;
    }
    const memValidation = validateCoverErrorBody(memResp.body, 'RENDER_MEMORY_LIMIT');
    const rssGrowthKb = peakAggregateRssKb - baselineAggregateRssKb;
    // Confirmation-round bypass fix (C4-5): memoryOk now requires the
    // BASELINE sample itself to be valid (never a `ps` failure silently
    // read as a zero baseline that any later real reading would appear to
    // "grow" from) AND the poller to have obtained at least one valid
    // sample (a wholly failed polling window cannot pass either).
    const pollerHealthy = pollValidSamples > 0;
    const memoryOk = memResp.status >= 400 && memValidation.ok && baselineValid && pollerHealthy && rssGrowthKb > 0 && peakAggregateRssKb < MEMORY_CEILING_KB;
    rows.push(`memory-ceiling (aggregate descendant RSS): status=${memResp.status} typedError=${memValidation.ok} (${memValidation.reason ?? 'ok'}) baselineValid=${baselineValid} baselineAggregateRssKb=${baselineAggregateRssKb} pollerHealthy=${pollerHealthy} (validSamples=${pollValidSamples}/${pollTotalSamples}) peakAggregateRssKb=${peakAggregateRssKb} rssGrowthKb=${rssGrowthKb} (must be >0) outerCeilingKb=${MEMORY_CEILING_KB} -> ${memoryOk ? 'PASS' : 'FAIL'}`);

    const ok = slowOkPass && perJobTimeoutOk && concurrencyOk && memoryOk;
    return { ok, evidence: rows.join('\n'), detail: ok ? undefined : 'renderer is not fully bounded (successful-slow-job control / typed timeout / throughput-inferred concurrency cap / typed aggregate memory ceiling)' };
  } finally {
    if (daemon) await daemon.kill().catch(() => undefined);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// =========================================================================
// C4-6 -- renderer cannot reach the network (process-level denial).
// =========================================================================
async function checkC46(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  const canary = await startCanaryServer();
  try {
    const selfTest = await canarySelfTest(canary);
    if (!selfTest.ok) return { ok: false, evidence: `canary self-test failed: ${selfTest.evidence}`, detail: 'canary infrastructure is broken -- a zero-hit result cannot be trusted' };

    if (!coverBackendSurface().present) {
      const gate = backendGateFailure();
      return { ok: false, evidence: `${gate.evidence}\ncanary self-test: ${selfTest.evidence}`, detail: gate.detail };
    }

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c46-'));
    let daemon: BootedDaemon | undefined;
    try {
      daemon = await bootDaemonForProbing(dataDir);
      const projectId = `w4-c46-${crypto.randomBytes(6).toString('hex')}`;
      const trackerHtml = `<!doctype html><html><head>
<link rel="stylesheet" href="${canary.url}/tracker.css">
</head><body>
<img src="${canary.url}/pixel.gif">
<script src="${canary.url}/tracker.js"></script>
<script>fetch(${JSON.stringify(canary.url)} + '/xhr-tracker').catch(()=>{});</script>
</body></html>`;
      await createProject(daemon.url, projectId, projectId);
      await uploadProjectFile(daemon.url, projectId, 'index.html', trackerHtml);

      const hitsBefore = canary.hits.length;
      const gen = await postGenerate(daemon.url, projectId, 60_000).catch((err) => {
        throw new Error(`generate call errored: ${String(err)}`);
      });
      await sleep(3000); // grace period for delayed/async egress attempts
      const hitsAfter = canary.hits.length;
      // Sol r1 finding 5: a 404/500 (renderer never actually ran) previously
      // counted as proof of "zero hits" -- require a SUCCESSFUL render with
      // the full valid contract record before trusting the zero-hit result
      // at all; a job that never ran cannot prove network denial.
      const validation = validateCoverSuccessBody(gen.body);
      const jobSucceeded = gen.status >= 200 && gen.status < 300 && validation.ok;
      const ok = jobSucceeded && hitsAfter === hitsBefore;
      return {
        ok,
        evidence: `render job: status=${gen.status} recordValid=${validation.ok} (${validation.reason ?? 'ok'})\ncanary hits before=${hitsBefore} after=${hitsAfter}\nhits detail=${JSON.stringify(canary.hits.slice(hitsBefore))}`,
        detail: ok ? undefined : !jobSucceeded ? 'the renderer did not successfully render (non-2xx or invalid record) -- a job that never ran proves nothing about network denial' : 'the renderer reached the canary -- process-level network denial is not proven',
      };
    } finally {
      if (daemon) await daemon.kill().catch(() => undefined);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  } finally {
    await canary.close();
  }
}

// =========================================================================
// C4-7 -- the not-yet-rendered fallback is not network-capable. THIS
// CRITERION RUNS TODAY (project-cover.tsx already exists) and is expected
// to FAIL: today's HtmlProjectCoverFrame unconditionally mounts a live
// sandboxed iframe once the file's existence is HEAD-verified, regardless
// of whether a real rendered cover exists yet.
// =========================================================================
// No @types/esbuild or @types/playwright are reachable from
// scripts/tsconfig.json either -- both packages are resolved dynamically
// (esbuild is a transitive dependency; @playwright/test is scoped to the
// e2e/ workspace package). Minimal structural interfaces cover the calls
// this file actually makes.
interface MinimalEsbuildBuildResult { outputFiles?: { text: string }[] }
interface MinimalEsbuild { build(options: Record<string, unknown>): Promise<MinimalEsbuildBuildResult> }
function resolveEsbuild(): MinimalEsbuild {
  const pnpmDir = path.join(repoRoot, 'node_modules/.pnpm');
  const dirName = fs.readdirSync(pnpmDir).filter((d) => d.startsWith('esbuild@')).sort()[0];
  if (!dirName) throw new Error('esbuild not found under node_modules/.pnpm');
  return createRequire(path.join(repoRoot, 'package.json'))(path.join(pnpmDir, dirName, 'node_modules/esbuild')) as MinimalEsbuild;
}
interface MinimalPwLocator { count(): Promise<number> }
interface MinimalPwRequest { url(): string }
interface MinimalPwPage {
  on(event: 'pageerror', cb: (err: Error) => void): void;
  on(event: 'console', cb: (msg: { type(): string; text(): string }) => void): void;
  on(event: 'request' | 'requestfinished' | 'requestfailed', cb: (req: MinimalPwRequest) => void): void;
  goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  setContent(html: string, opts?: Record<string, unknown>): Promise<void>;
  evaluate<T>(fn: (...args: never[]) => T, arg?: unknown): Promise<T>;
  addScriptTag(opts: { content: string }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  locator(selector: string): MinimalPwLocator;
  close(): Promise<void>;
}
interface MinimalPwBrowser { newPage(): Promise<MinimalPwPage>; close(): Promise<void>; process(): { pid: number } | null }
interface MinimalPwBrowserType { launch(opts?: Record<string, unknown>): Promise<MinimalPwBrowser> }
function resolvePlaywright(): { chromium: MinimalPwBrowserType } {
  return createRequire(path.join(repoRoot, 'e2e/package.json'))('@playwright/test') as { chromium: MinimalPwBrowserType };
}

// -----------------------------------------------------------------------
// Isolated daemon boot with a live Node IPC channel, used ONLY by C4-7's
// live-artifact surface (kept separate from the shared bootDaemonForProbing()
// every other criterion relies on). Sol r2 ruling 1: the daemon child mints
// a REAL token from its own in-process toolTokenRegistry singleton (the
// SAME module instance server.ts wires into authorizeToolRequest, since
// both are dynamically imported by the same child process) and reports it
// back over IPC -- never stdout, never a proof file.
//
// IPC does NOT propagate through `pnpm exec tsx` (verified empirically:
// `process.send` is undefined inside a child spawned that way). Bypassing
// pnpm and spawning tsx's own CLI entry directly DOES work -- confirmed
// both in isolated experimentation and end-to-end against a real
// /api/tools/live-artifacts/create call before wiring this in.
// -----------------------------------------------------------------------
interface BootedDaemonWithIpc extends BootedDaemon {
  mintToken(opts: { runId: string; projectId: string }): Promise<string>;
  revokeToken(token: string): Promise<void>;
}
async function bootDaemonForProbingWithIpc(dataDir: string): Promise<BootedDaemonWithIpc> {
  const bootScript = `
import { pathToFileURL } from 'node:url';
process.env.OD_DATA_DIR = ${JSON.stringify(dataDir)};
process.env.OD_DAEMON_CLI_PATH = ${JSON.stringify(path.join(repoRoot, 'apps/daemon/dist/cli.js'))};
const serverMod = await import(pathToFileURL(${JSON.stringify(path.join(repoRoot, 'apps/daemon/src/server.ts'))}).href);
const tokensMod = await import(pathToFileURL(${JSON.stringify(path.join(repoRoot, 'apps/daemon/src/tool-tokens.ts'))}).href);
const started = await serverMod.startServer({ port: 0, returnServer: true });
process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'mint') {
    try {
      const grant = tokensMod.toolTokenRegistry.mint({ runId: msg.runId, projectId: msg.projectId });
      process.send({ type: 'minted', id: msg.id, token: grant.token });
    } catch (err) {
      process.send({ type: 'mint-error', id: msg.id, error: String(err) });
    }
  } else if (msg.type === 'revoke') {
    tokensMod.toolTokenRegistry.revokeToken(msg.token);
    process.send({ type: 'revoked', id: msg.id });
  }
});
console.log('OD_W4_VERIFIER_READY ' + JSON.stringify({ url: started.url }));
process.on('SIGTERM', async () => { await started.shutdown(); process.exit(0); });
`;
  const scriptPath = path.join(proofDir, `.boot-daemon-ipc.${process.pid}.${crypto.randomBytes(3).toString('hex')}.mjs`);
  fs.writeFileSync(scriptPath, bootScript);
  const tsxCliPath = createRequire(path.join(repoRoot, 'package.json')).resolve('tsx/cli');
  const child = spawn(process.execPath, [tsxCliPath, scriptPath], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let buffered = '';
  const ready = await new Promise<{ url: string } | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 45_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const line = buffered.split('\n').find((l) => l.startsWith('OD_W4_VERIFIER_READY '));
      if (line) {
        clearTimeout(timeout);
        try { resolve(JSON.parse(line.slice('OD_W4_VERIFIER_READY '.length))); } catch { resolve(null); }
      }
    });
    child.on('exit', () => { clearTimeout(timeout); resolve(null); });
  });
  const kill = async (): Promise<void> => {
    if (child.pid) { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { try { if (child.pid) child.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 5_000);
      child.on('exit', () => { clearTimeout(t); resolve(); });
    });
    try { fs.unlinkSync(scriptPath); } catch { /* best effort */ }
  };
  if (!ready) {
    await kill();
    throw new Error(`daemon (IPC variant) failed to boot within 45s (stdout tail: ${buffered.slice(-2000)})`);
  }
  let msgSeq = 0;
  function sendAndAwait(msg: Record<string, unknown>, matchType: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = ++msgSeq;
      const timeout = setTimeout(() => { child.off('message', onMessage); reject(new Error(`IPC ${String(msg.type)} timed out`)); }, 15_000);
      const onMessage = (m: unknown): void => {
        if (!m || typeof m !== 'object') return;
        const rec = m as Record<string, unknown>;
        if (rec.id !== id) return;
        if (rec.type === matchType || rec.type === `${String(msg.type)}-error`) {
          clearTimeout(timeout);
          child.off('message', onMessage);
          if (String(rec.type).endsWith('-error')) reject(new Error(String(rec.error ?? 'IPC error')));
          else resolve(rec);
        }
      };
      child.on('message', onMessage);
      child.send({ ...msg, id });
    });
  }
  return {
    url: ready.url, pid: child.pid, dataDir, routeInventory: [], kill,
    mintToken: async ({ runId, projectId }) => {
      const res = await sendAndAwait({ type: 'mint', runId, projectId }, 'minted');
      return String(res.token);
    },
    revokeToken: async (token: string) => {
      await sendAndAwait({ type: 'revoke', token }, 'revoked');
    },
  };
}

// Sol r2 ruling 1: a synthetic-injected-iframe proxy for this surface is
// REJECTED -- final round must exercise the ACTUAL live-artifact route
// end-to-end. This mints a REAL tool token from the isolated daemon
// child's own toolTokenRegistry (over IPC, via bootDaemonForProbingWithIpc
// above), POSTs the SAME tracker content used for surface 1 to the real
// POST /api/tools/live-artifacts/create, revokes the token immediately,
// then mounts the REAL (unmocked) DesignsTab.tsx so it performs its OWN
// real fetchLiveArtifacts() call, discovers the artifact, and renders ITS
// OWN live-artifact <iframe> pointed at the real liveArtifactPreviewUrl()
// -- not a hand-built stand-in. AGENTS.md's app-boundary rule bars
// apps/web/** from importing apps/daemon/src/** -- it does not bar a
// verifier CHILD PROCESS (this script, under scripts/waves/) from using
// daemon test infrastructure like the token registry; no paid agent turn
// is required to mint a tool token.
async function probeLiveArtifactSurface(browser: MinimalPwBrowser, daemon: BootedDaemonWithIpc, canary: CanaryServer): Promise<{ ok: boolean; evidence: string }> {
  const projectId = `w4-c47-live-${crypto.randomBytes(6).toString('hex')}`;
  await createProject(daemon.url, projectId, projectId);
  // Live-artifact templates reject <script>/<iframe>/srcdoc=/on*=/javascript:
  // outright (apps/daemon/src/live-artifacts/render.ts
  // validateHtmlTemplateV1Security) -- unlike surface 1's raw-HTML tracker,
  // this one can only use a plain <img> egress vector. That is still a
  // genuine test: the real CSP's `img-src 'self' data: blob:` (no remote
  // origin) must block it client-side before it ever reaches the canary.
  const trackerHtml = `<!doctype html><html><body><img src="${canary.url}/pixel.gif"></body></html>`;

  const token = await daemon.mintToken({ runId: `w4-c47-run-${crypto.randomBytes(4).toString('hex')}`, projectId });
  const createResp = await fetch(`${daemon.url}/api/tools/live-artifacts/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      input: {
        title: 'w4-c47-probe',
        preview: { type: 'html', entry: 'index.html' },
        document: {
          format: 'html_template_v1',
          templatePath: 'template.html',
          generatedPreviewPath: 'index.html',
          dataPath: 'data.json',
          dataJson: {},
        },
      },
      templateHtml: trackerHtml,
    }),
  });
  const createStatus = createResp.status;
  const createBody: unknown = await createResp.json().catch(() => null);
  // Ceremony ruling item 2: the IPC revoke acknowledgement failure must
  // NOT be swallowed -- a revoke call that itself errors (IPC timeout,
  // registry error) is tracked and folds into revokeConfirmedDead below,
  // not silently discarded.
  let revokeAckOk = true;
  try {
    await daemon.revokeToken(token);
  } catch (err) {
    revokeAckOk = false;
    void err;
  }
  const artifactId = isRecord(createBody) && isRecord(createBody.artifact) && typeof createBody.artifact.id === 'string' ? createBody.artifact.id : null;
  if (createStatus < 200 || createStatus >= 300 || !artifactId) {
    return { ok: false, evidence: `POST /api/tools/live-artifacts/create failed: status=${createStatus} body=${JSON.stringify(createBody)} revokeAckOk=${revokeAckOk} -- cannot seed a real live artifact for this probe` };
  }

  // Ceremony ruling item 2: replay the SAME revoked token against the
  // protected create route and require an ACTUAL HTTP 401 -- network
  // failure, a null response, any other status, or a failed revoke
  // acknowledgement all count as failure here (no swallowing).
  const postRevokeProbe = await fetch(`${daemon.url}/api/tools/live-artifacts/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ input: { title: 'post-revoke-probe', preview: { type: 'html', entry: 'index.html' }, document: { format: 'html_template_v1', templatePath: 'template.html', generatedPreviewPath: 'index.html', dataPath: 'data.json', dataJson: {} } } }),
  }).catch(() => null);
  const revokeConfirmedDead = revokeAckOk && postRevokeProbe !== null && postRevokeProbe.status === 401;

  const harnessPath = path.join(repoRoot, 'apps/web/src/.verify-w4-c47-live-harness.tsx');
  const page = await browser.newPage();
  try {
    // Bundles the REAL DesignsTab with the REAL (unmocked) registry.ts --
    // same pattern as C4-9/C4-10's harnesses -- so it makes a genuine
    // fetchLiveArtifacts() call against this daemon and renders whatever
    // it actually finds, not a synthetic stand-in.
    const harnessSource = `import { createRoot } from 'react-dom/client';
import React from 'react';
import { DesignsTab } from './components/DesignsTab';
const el = document.getElementById('root');
if (el) {
  const root = createRoot(el);
  const projects = (globalThis as any).__C47_LIVE_PROJECTS__ || [];
  root.render(React.createElement(DesignsTab, {
    projects, skills: [], designSystems: [],
    onOpen: () => {}, onOpenLiveArtifact: () => {},
    onDelete: async () => true, onRename: async () => {},
  }));
}
`;
    fs.writeFileSync(harnessPath, harnessSource);
    const esbuild = resolveEsbuild();
    const built = await esbuild.build({
      entryPoints: [harnessPath], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
      loader: { '.tsx': 'tsx', '.ts': 'ts' }, absWorkingDir: path.join(repoRoot, 'apps/web'),
      define: { 'process.env.NODE_ENV': JSON.stringify('production') }, logLevel: 'silent',
    });
    const bundledJs = built.outputFiles?.[0]?.text;
    if (!bundledJs) return { ok: false, evidence: 'esbuild produced no output for the DesignsTab live-artifact harness' };

    const project = { id: projectId, name: projectId, skillId: null, designSystemId: null, createdAt: 0, updatedAt: 0, status: { value: 'not_started' } };
    await page.goto(`${daemon.url}/api/projects`, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => undefined);
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>', { waitUntil: 'domcontentloaded' });
    await page.evaluate((p: unknown) => { (globalThis as unknown as { __C47_LIVE_PROJECTS__: unknown[] }).__C47_LIVE_PROJECTS__ = [p]; }, project);

    const hitsBefore = canary.hits.length;
    await page.addScriptTag({ content: bundledJs });

    // DesignsTab's OWN class (`thumb-iframe`) on an iframe whose src
    // contains THIS artifact's real id -- proves DesignsTab genuinely
    // discovered and rendered the artifact created via the tool API
    // above, not a coincidental match.
    const selector = `iframe.thumb-iframe[src*="${artifactId}"]`;
    let iframeCount = 0;
    for (let poll = 0; poll < 80; poll++) { // up to 8s for the real fetch + render
      iframeCount = await page.locator(selector).count();
      if (iframeCount >= 1) break;
      await sleep(100);
    }
    await sleep(1500); // grace period for any delayed subresource loads inside the mounted iframe
    const hitsAfter = canary.hits.length;

    // Ceremony ruling item 2: revokeConfirmedDead is now LOAD-BEARING --
    // joined into `ok` alongside real iframe discovery and zero new
    // canary hits, so a failed revoke (or a revoke whose token still
    // works) fails this probe, not just the evidence text.
    const ok = iframeCount >= 1 && hitsAfter === hitsBefore && revokeConfirmedDead;
    return {
      ok,
      evidence: `real live artifact created via POST /api/tools/live-artifacts/create: id=${artifactId} status=${createStatus}\nrevokeAckOk=${revokeAckOk} tool token revoked-and-confirmed-dead(load-bearing)=${revokeConfirmedDead} (post-revoke replay status=${postRevokeProbe?.status ?? 'n/a (network failure/null response)'}, required exactly 401)\nDesignsTab (real, unmocked registry.ts) rendered iframe matching ${selector}: count=${iframeCount}\ncanary hits before=${hitsBefore} after=${hitsAfter}\n-> ${ok ? 'contained AND revoke confirmed dead' : 'FAILED: DesignsTab did not render the real artifact iframe, it leaked to the canary, or the revoked token was not confirmed dead'}`,
    };
  } finally {
    try { fs.unlinkSync(harnessPath); } catch { /* already clean */ }
    await page.close().catch(() => undefined);
  }
}

async function checkC47(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  const canary = await startCanaryServer();
  const harnessPath = path.join(repoRoot, 'apps/web/src/.verify-w4-c47-harness.tsx');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c47-'));
  let daemon: BootedDaemonWithIpc | undefined;
  let browser: MinimalPwBrowser | undefined;
  try {
    const selfTest = await canarySelfTest(canary);
    if (!selfTest.ok) return { ok: false, evidence: `canary self-test failed: ${selfTest.evidence}`, detail: 'canary infrastructure is broken -- a zero-hit result cannot be trusted' };

    // IPC variant (not the shared bootDaemonForProbing()) -- surface 2
    // below needs the isolated daemon child's own toolTokenRegistry.
    daemon = await bootDaemonForProbingWithIpc(dataDir);
    const projectId = `w4-c47-${crypto.randomBytes(6).toString('hex')}`;
    const trackerHtml = `<!doctype html><html><body>
<img src="${canary.url}/pixel.gif">
<script>fetch(${JSON.stringify(canary.url)} + '/xhr-tracker').catch(()=>{});</script>
</body></html>`;
    await createProject(daemon.url, projectId, projectId);
    await uploadProjectFile(daemon.url, projectId, 'index.html', trackerHtml);
    const rawUrl = `/api/projects/${encodeURIComponent(projectId)}/raw/index.html`;

    // Bundle the REAL, currently-shipping component (project-cover.tsx) --
    // not a reimplementation -- so a future correct fix (static
    // glyph/skeleton, or a CSP-hardened iframe) is graded on its actual
    // source, and today's live-iframe bug is caught for what it really is.
    const harnessSource = `import { createRoot } from 'react-dom/client';
import React from 'react';
import { HtmlProjectCoverFrame } from './components/project-cover';
declare global { interface Window { __C47_SRC__?: string; __C47_MOUNTED__?: boolean } }
const el = document.getElementById('root');
if (el) {
  const root = createRoot(el);
  root.render(React.createElement(HtmlProjectCoverFrame, {
    src: window.__C47_SRC__,
    initial: 'P',
    iframeClassName: 'c47-iframe',
    glyphClassName: 'c47-glyph',
    diagnostic: 'c4-7-probe',
  }));
  window.__C47_MOUNTED__ = true;
}
`;
    fs.writeFileSync(harnessPath, harnessSource);

    const esbuild = resolveEsbuild();
    const built = await esbuild.build({
      entryPoints: [harnessPath],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      jsx: 'automatic',
      loader: { '.tsx': 'tsx', '.ts': 'ts' },
      absWorkingDir: path.join(repoRoot, 'apps/web'),
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      logLevel: 'silent',
    });
    const bundledJs = built.outputFiles?.[0]?.text;
    if (!bundledJs) return { ok: false, evidence: 'esbuild produced no output', detail: 'harness bundling failed' };

    const pw = resolvePlaywright();
    browser = await pw.chromium.launch();
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e: Error) => pageErrors.push(String(e)));
    // Navigate to the daemon's own origin FIRST so the harness's relative
    // src resolves same-origin (matching production's own relative
    // projectFileUrl()/projectRawUrl() usage) -- avoids an unrelated
    // cross-origin CORS failure masquerading as "network denied". Root `/`
    // 404s with `Content-Security-Policy: default-src 'none'` (verified via
    // direct curl against a booted daemon), which blocks the later inline
    // addScriptTag injection; a real 2xx API route carries no CSP header,
    // so navigate there instead -- same origin, no inherited restriction.
    await page.goto(`${daemon.url}/api/projects`, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => undefined);
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>', { waitUntil: 'domcontentloaded' });
    await page.evaluate((src: string) => { (globalThis as unknown as { __C47_SRC__: string }).__C47_SRC__ = src; }, rawUrl);

    const hitsBefore = canary.hits.length;
    await page.addScriptTag({ content: bundledJs });
    await page.waitForTimeout(4000); // allow the HEAD-verify effect + iframe mount + iframe subresource loads to settle
    const hitsAfter = canary.hits.length;

    const glyphCount = await page.locator('.c47-glyph').count();
    const iframeCount = await page.locator('.c47-iframe').count();
    const mounted = await page.evaluate(() => Boolean((globalThis as unknown as { __C47_MOUNTED__?: boolean }).__C47_MOUNTED__));
    // Sol r1 finding 5: an EMPTY render (neither glyph nor iframe, e.g. a
    // crash) previously passed trivially because it also shows zero canary
    // hits. A real static-placeholder fix must render SOMETHING.
    const surface1Ok = mounted && glyphCount >= 1 && hitsAfter === hitsBefore;

    const surface2 = await probeLiveArtifactSurface(browser, daemon, canary);

    const ok = surface1Ok && surface2.ok;
    return {
      ok,
      evidence: `[surface 1: HtmlProjectCoverFrame] mounted=${mounted}\nglyphRendered(count)=${glyphCount}\nliveIframeRendered(count)=${iframeCount}\ncanary hits before=${hitsBefore} after=${hitsAfter}\npageErrors=${JSON.stringify(pageErrors.slice(0, 5))}\n[surface 2: DesignsTab real end-to-end live-artifact flow]\n${surface2.evidence}`,
      detail: ok
        ? undefined
        : !surface1Ok
          ? (iframeCount > 0
            ? 'surface 1: a live network-capable iframe is present for the not-yet-rendered state and it reached the canary -- S4-5 requires a static glyph/skeleton'
            : 'surface 1: no glyph was actually rendered (empty/crashed render trivially shows zero canary hits and must not pass)')
          : 'surface 2 (real live-artifact flow through DesignsTab): the tool-created artifact leaked to the canary, or DesignsTab never rendered its own iframe for it -- see evidence',
    };
  } finally {
    try { fs.unlinkSync(harnessPath); } catch { /* already clean */ }
    if (browser) await browser.close().catch(() => undefined);
    if (daemon) await daemon.kill().catch(() => undefined);
    fs.rmSync(dataDir, { recursive: true, force: true });
    await canary.close();
  }
}

// =========================================================================
// C4-8 -- sandbox contract frozen and documented (NM-35C).
// =========================================================================
// Sol r1 finding 5: C4-8 previously checked sandbox literals but not CSP,
// and its doc check accepted any file containing BOTH substrings "NM-35C"
// and "allow-same-origin" anywhere -- including a doc asserting the
// OPPOSITE policy (e.g. "allow-same-origin is required"). Two fixes below:
// a route-level CSP header check (AST-scoped to the specific handler, not
// the whole file), and a negation-aware proximity regex for the doc check.
//
// Sol r2 finding 5: that route-level check was itself both HELPER-BLIND
// (only recognized a LITERAL `res.setHeader('Content-Security-Policy', ...)`
// inline in the matched route handler -- the real live-artifact route
// instead calls a named helper, `setLiveArtifactPreviewHeaders(res)`,
// injected via `ctx.liveArtifacts` DI destructuring rather than a
// traceable static import, so the old check false-red the real,
// already-correct route) and VALUE-BLIND (never inspected what CSP was
// actually being set, so a route that set a USELESS/wide-open CSP would
// still false-green). Both are fixed below: `findCspSetHeaderInBody`
// follows bare-identifier helper calls by NAME across the daemon's
// route/live-artifact helper directories (full DI-graph resolution is not
// practical to trace via AST alone) and resolves the CSP VALUE through
// string literals, `[...].join('; ')` arrays, and local variable
// references; `cspIsRestrictive` then checks that resolved value for
// actual restrictiveness, matching the real `setLiveArtifactPreviewHeaders`
// policy in apps/daemon/src/live-artifacts/http-helpers.ts.
function stringLiteralArrayJoinValue(expr: TsNode): string | null {
  // Matches `[ "a", "b", ... ].join('; ')`.
  if (!ts.isCallExpression(expr)) return null;
  if (!ts.isPropertyAccessExpression(expr.expression) || expr.expression.name.text !== 'join') return null;
  const arr = expr.expression.expression;
  if (!ts.isArrayLiteralExpression(arr)) return null;
  const sepArg = expr.arguments[0];
  const sep = sepArg && ts.isStringLiteral(sepArg) ? sepArg.text : ', ';
  const parts: string[] = [];
  for (const el of arr.elements) {
    if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) parts.push(el.text);
    else return null; // a non-literal element -- cannot statically resolve, give up rather than guess
  }
  return parts.join(sep);
}
function resolveCspValueFromExpr(expr: TsNode, scopeChain: TsNode[]): string | null {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  const joined = stringLiteralArrayJoinValue(expr);
  if (joined !== null) return joined;
  if (ts.isIdentifier(expr)) {
    // A variable reference (e.g. `res.setHeader('Content-Security-Policy',
    // projectPreviewCsp)`) -- search each enclosing scope, innermost
    // first, for `const <name> = <initializer>`.
    for (const scope of scopeChain) {
      let found: string | null = null;
      const visit = (node: TsNode): void => {
        if (found !== null) return;
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === expr.text && node.initializer) {
          found = resolveCspValueFromExpr(node.initializer, []);
        }
        ts.forEachChild(node, visit);
      };
      visit(scope);
      if (found !== null) return found;
    }
  }
  return null;
}
const CSP_HELPER_SEARCH_DIRS = ['apps/daemon/src/live-artifacts', 'apps/daemon/src/routes', 'apps/daemon/src/routes/project', 'apps/daemon/src/http'];
function findNamedHelperFunctionBody(name: string): { body: TsNode; sourceFile: TypeScriptModule.SourceFile } | null {
  for (const dir of CSP_HELPER_SEARCH_DIRS) {
    const absDir = path.join(repoRoot, dir);
    if (!fs.existsSync(absDir)) continue;
    for (const f of fs.readdirSync(absDir)) {
      if (!f.endsWith('.ts')) continue;
      const abs = path.join(absDir, f);
      if (!fs.statSync(abs).isFile()) continue;
      const { sourceFile } = parseTs(abs);
      let result: { body: TsNode; sourceFile: TypeScriptModule.SourceFile } | null = null;
      const findFn = (node: TsNode): void => {
        if (result) return;
        if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) { result = { body: node.body, sourceFile }; return; }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
          result = { body: node.initializer.body as TsNode, sourceFile };
          return;
        }
        ts.forEachChild(node, findFn);
      };
      findFn(sourceFile);
      if (result) return result;
    }
  }
  return null;
}
function findCspSetHeaderInBody(body: TsNode, scopeChain: TsNode[], sourceFile: TypeScriptModule.SourceFile, depth = 0): { value: string; line: number; via: string } | null {
  let result: { value: string; line: number; via: string } | null = null;
  const helperCandidates: string[] = [];
  const visit = (node: TsNode): void => {
    if (result) return;
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        const m = node.expression.name.text;
        const arg0 = node.arguments[0];
        if ((m === 'setHeader' || m === 'header') && arg0 && ts.isStringLiteral(arg0) && arg0.text === 'Content-Security-Policy') {
          const arg1 = node.arguments[1];
          const value = arg1 ? resolveCspValueFromExpr(arg1, [body, ...scopeChain]) : null;
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          if (value !== null) { result = { value, line, via: 'literal' }; return; }
        }
      } else if (ts.isIdentifier(node.expression)) {
        helperCandidates.push(node.expression.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  if (result) return result;
  if (depth >= 3) return null; // bound recursion into followed helpers
  for (const name of helperCandidates) {
    const helper = findNamedHelperFunctionBody(name);
    if (!helper) continue;
    const nested = findCspSetHeaderInBody(helper.body, [helper.sourceFile], helper.sourceFile, depth + 1);
    if (nested) return { ...nested, via: `helper:${name}` };
  }
  return null;
}
function parseCspDirectives(csp: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of csp.split(';')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const spaceIdx = trimmed.indexOf(' ');
    const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const value = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
    map.set(name, value);
  }
  return map;
}
// Restrictiveness, not mere presence: `connect-src 'none'` is the
// directive that actually denies remote fetch/xhr/websocket/EventSource
// egress from framed content (the same threat C4-6/C4-7's network canary
// probes at the process level; this is the policy-level backstop), and no
// directive may carry a bare wildcard or a bare http(s): scheme source
// (either of which would allow loading from literally any remote origin
// regardless of how restrictive the rest of the policy looks).
function cspIsRestrictive(csp: string): { ok: boolean; reason: string } {
  const directives = parseCspDirectives(csp);
  const connectSrc = directives.get('connect-src');
  if (connectSrc !== "'none'") return { ok: false, reason: `connect-src must be 'none' to deny remote fetch/xhr/websocket egress (got ${JSON.stringify(connectSrc ?? null)})` };
  for (const [name, value] of directives) {
    if (name === 'sandbox') continue; // CSP-level sandbox directive, not a source list
    if (/(^|\s)\*(\s|$)/.test(value)) return { ok: false, reason: `${name} carries a bare wildcard source ("${value}")` };
    if (/\bhttps?:(\s|\/\/|$)/.test(value)) return { ok: false, reason: `${name} allows a bare http(s): scheme source ("${value}")` };
  }
  return { ok: true, reason: "connect-src is 'none' and no directive carries a wildcard or bare scheme source" };
}
function routeHandlerHasCspHeader(routeFile: string, pathMatcher: RegExp): { found: boolean; restrictive: boolean; evidence: string } {
  const abs = path.join(repoRoot, routeFile);
  if (!fs.existsSync(abs)) return { found: false, restrictive: false, evidence: `${routeFile}: absent` };
  const { sourceFile } = parseTs(abs);
  let handlerBody: TsNode | null = null;
  function findHandler(node: TsNode): void {
    if (handlerBody) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'get') {
      const pathArg = node.arguments[0];
      const isMatch = (pathArg && ts.isRegularExpressionLiteral(pathArg) && pathMatcher.test(pathArg.text))
        || (pathArg && ts.isStringLiteral(pathArg) && pathMatcher.test(pathArg.text));
      if (isMatch) {
        const cb = node.arguments[node.arguments.length - 1];
        if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) handlerBody = cb.body;
      }
    }
    ts.forEachChild(node, findHandler);
  }
  findHandler(sourceFile);
  if (!handlerBody) return { found: false, restrictive: false, evidence: `${routeFile}: no app.get() handler matched ${pathMatcher}` };
  const csp = findCspSetHeaderInBody(handlerBody, [sourceFile], sourceFile);
  if (!csp) return { found: false, restrictive: false, evidence: `${routeFile} (handler matching ${pathMatcher}): no Content-Security-Policy header set (checked the handler body and any bare-identifier helper functions it calls)` };
  const restrictiveness = cspIsRestrictive(csp.value);
  return {
    found: true,
    restrictive: restrictiveness.ok,
    evidence: `${routeFile} (handler matching ${pathMatcher}): Content-Security-Policy set via ${csp.via} (line ${csp.line}) = "${csp.value}" -> restrictive=${restrictiveness.ok} (${restrictiveness.reason})`,
  };
}
// Negation-aware: requires a negation/omission word within ~80 chars of
// "allow-same-origin" on EITHER side, inside a window around each NM-35C
// mention -- a doc asserting the opposite ("must add allow-same-origin")
// has no such negation pattern nearby and correctly does not match. This
// is a heuristic proximity regex, not full semantic parsing (flagged as a
// known limitation in the authoring report).
const NEGATION_NEAR_ALLOW_SAME_ORIGIN = /\b(no|not|without|omit(?:s|ting|ted)?|never|excludes?|deliberately\s+(?:omit\w*|absent|excluded))\b[^.]{0,80}allow-same-origin|allow-same-origin[^.]{0,80}\b(?:is\s+)?(?:omitted|excluded|not\s+(?:set|granted|included|present)|deliberately\s+absent)\b/i;
function findNm35cThreatNote(): { found: boolean; evidence: string } {
  const securityDir = path.join(repoRoot, 'docs/security');
  if (!fs.existsSync(securityDir)) return { found: false, evidence: 'docs/security/ does not exist' };
  for (const f of fs.readdirSync(securityDir, { recursive: true } as unknown as fs.ObjectEncodingOptions & { recursive: boolean })) {
    const rel = String(f);
    if (!rel.endsWith('.md') && !rel.endsWith('.json')) continue;
    const abs = path.join(securityDir, rel);
    if (!fs.statSync(abs).isFile()) continue;
    const content = fs.readFileSync(abs, 'utf8');
    let searchIdx = 0;
    for (;;) {
      const idx = content.indexOf('NM-35C', searchIdx);
      if (idx === -1) break;
      const windowText = content.slice(Math.max(0, idx - 600), Math.min(content.length, idx + 600));
      if (NEGATION_NEAR_ALLOW_SAME_ORIGIN.test(windowText)) return { found: true, evidence: `docs/security/${rel}: NM-35C mention with a negation-pattern near "allow-same-origin" found` };
      searchIdx = idx + 6;
    }
  }
  return { found: false, evidence: 'no docs/security/*.md|*.json mentions NM-35C with a recognizable deliberate-omission phrasing near "allow-same-origin"' };
}
// Ceremony ruling item 3: static name-based helper resolution is no longer
// PASS AUTHORITY for the CSP half of C4-8 (kept below as diagnostic-only
// evidence). The actual pass authority is now runtime HTTP evidence from a
// freshly booted isolated daemon: seed real content, GET the two real
// iframe-serving routes, read each response's ACTUAL Content-Security-
// Policy header, and grade it against the exact tokenized-directive rules
// the ruling specifies -- connect-src must be exactly 'none', default-src
// must be present, and every effective fetch directive's source list must
// contain no '*', no network scheme source, and no host-source form.
// Quoted keyword/nonce/hash tokens (`'self'`, `'none'`, `'nonce-...'`,
// `'sha256-...'`, etc.) and the non-network `data:`/`blob:` schemes are the
// ONLY tokens treated as safe; anything else -- bare DNS names, wildcard
// hosts, scheme-qualified or protocol-relative hosts, IP/localhost forms,
// port/path-qualified hosts, bare `http:`/`https:`/`ws:`/`wss:`, or any
// other unrecognized unquoted token -- fails closed.
const CSP_EFFECTIVE_FETCH_DIRECTIVES = [
  'default-src', 'child-src', 'connect-src', 'font-src', 'frame-src', 'img-src',
  'manifest-src', 'media-src', 'object-src', 'prefetch-src', 'script-src',
  'script-src-elem', 'script-src-attr', 'style-src', 'style-src-elem',
  'style-src-attr', 'worker-src',
];
function classifyCspSourceToken(token: string): { safe: boolean; reason: string } {
  if (token === '*') return { safe: false, reason: 'wildcard-all source (*)' };
  // Per CSP grammar, a quoted token ('...') is always a keyword, nonce, or
  // hash -- never a host source -- so it cannot carry any of the remote-
  // egress risk this check exists to catch.
  if (token.length >= 2 && token.startsWith("'") && token.endsWith("'")) {
    return { safe: true, reason: 'quoted keyword/nonce/hash token' };
  }
  const lower = token.toLowerCase();
  if (lower === 'data:' || lower === 'blob:') return { safe: true, reason: 'non-network data:/blob: scheme source' };
  // Everything else: bare network schemes (http:/https:/ws:/wss:), bare DNS
  // names, wildcard hosts, scheme-qualified/protocol-relative hosts,
  // IP/localhost forms, port/path-qualified hosts, or any other
  // unclassifiable unquoted token -- fail closed.
  return { safe: false, reason: 'network scheme, host-source form, or unclassifiable unquoted token' };
}
function parseCspIntoDirectives(csp: string): Map<string, string[]> | null {
  const map = new Map<string, string[]>();
  const rawDirectives = csp.split(';').map((d) => d.trim()).filter((d) => d.length > 0);
  if (rawDirectives.length === 0) return null;
  for (const raw of rawDirectives) {
    const parts = raw.split(/\s+/).filter((p) => p.length > 0);
    const first = parts[0];
    if (parts.length === 0 || first === undefined) continue;
    const name = first.toLowerCase();
    if (map.has(name)) return null; // duplicate directive -- ambiguous, fail closed
    map.set(name, parts.slice(1));
  }
  return map;
}
function gradeCspForRemoteDenial(cspHeaderValue: string | null): { ok: boolean; reason: string } {
  if (!cspHeaderValue || cspHeaderValue.trim().length === 0) {
    return { ok: false, reason: 'Content-Security-Policy header missing or empty' };
  }
  const directives = parseCspIntoDirectives(cspHeaderValue);
  if (!directives) return { ok: false, reason: 'unparsable or ambiguous CSP (duplicate directive or empty policy)' };
  const connectSrc = directives.get('connect-src');
  if (!connectSrc || connectSrc.length !== 1 || connectSrc[0] !== "'none'") {
    return { ok: false, reason: `connect-src must be present with EXACTLY the single token 'none' (got ${JSON.stringify(connectSrc ?? null)})` };
  }
  if (!directives.has('default-src')) {
    return { ok: false, reason: 'default-src is required so omitted fetch directives inherit a restrictive source list' };
  }
  const violations: string[] = [];
  for (const dirName of CSP_EFFECTIVE_FETCH_DIRECTIVES) {
    const values = directives.get(dirName);
    if (values === undefined) continue; // absent -- inherits the already-checked default-src
    if (values.length === 0) { violations.push(`${dirName}: present but empty (ambiguous)`); continue; }
    for (const tok of values) {
      const cls = classifyCspSourceToken(tok);
      if (!cls.safe) violations.push(`${dirName}: unsafe source "${tok}" (${cls.reason})`);
    }
  }
  if (violations.length > 0) return { ok: false, reason: violations.join('; ') };
  return { ok: true, reason: "connect-src is exactly 'none', default-src present, every effective fetch directive source is safe" };
}
// Boots an isolated daemon, seeds a REAL project (for the /raw/ route) and
// a REAL live artifact (for the /preview route, via the same real tool-
// token mint/create/revoke flow C4-7 uses), then GETs both actual iframe-
// serving routes and grades their ACTUAL response CSP headers. This is the
// runtime evidence that is now C4-8's CSP pass authority.
async function probeCspRuntimeEvidence(): Promise<{ ok: boolean; evidence: string }> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c48-'));
  let daemon: BootedDaemonWithIpc | undefined;
  try {
    daemon = await bootDaemonForProbingWithIpc(dataDir);
    const projectId = `w4-c48-${crypto.randomBytes(6).toString('hex')}`;
    await createProject(daemon.url, projectId, projectId);
    await uploadProjectFile(daemon.url, projectId, 'index.html', '<!doctype html><html><body>c4-8 csp probe</body></html>');

    const rawUrl = `${daemon.url}/api/projects/${encodeURIComponent(projectId)}/raw/index.html`;
    const rawResp = await fetch(rawUrl).catch(() => null);
    const rawStatus = rawResp?.status ?? -1;
    const rawCspHeader = rawResp?.headers.get('content-security-policy') ?? null;
    const raw2xx = rawResp !== null && rawResp.status >= 200 && rawResp.status < 300;
    const rawGrade = raw2xx ? gradeCspForRemoteDenial(rawCspHeader) : { ok: false, reason: `non-2xx or failed fetch (status=${rawStatus})` };

    const token = await daemon.mintToken({ runId: `w4-c48-run-${crypto.randomBytes(4).toString('hex')}`, projectId });
    const createResp = await fetch(`${daemon.url}/api/tools/live-artifacts/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        input: {
          title: 'w4-c48-probe',
          preview: { type: 'html', entry: 'index.html' },
          document: { format: 'html_template_v1', templatePath: 'template.html', generatedPreviewPath: 'index.html', dataPath: 'data.json', dataJson: {} },
        },
        templateHtml: '<!doctype html><html><body>c4-8 live artifact csp probe</body></html>',
      }),
    });
    const createBody: unknown = await createResp.json().catch(() => null);
    await daemon.revokeToken(token).catch(() => undefined);
    const artifactId = isRecord(createBody) && isRecord(createBody.artifact) && typeof createBody.artifact.id === 'string' ? createBody.artifact.id : null;

    let liveGrade: { ok: boolean; reason: string };
    let liveStatus = -1;
    let liveCspHeader: string | null = null;
    let previewUrl = '(not reached -- live artifact seeding failed)';
    if (createResp.status < 200 || createResp.status >= 300 || !artifactId) {
      liveGrade = { ok: false, reason: `failed to seed a live artifact: create status=${createResp.status} body=${JSON.stringify(createBody)}` };
    } else {
      previewUrl = `${daemon.url}/api/live-artifacts/${encodeURIComponent(artifactId)}/preview?projectId=${encodeURIComponent(projectId)}`;
      const liveResp = await fetch(previewUrl).catch(() => null);
      liveStatus = liveResp?.status ?? -1;
      liveCspHeader = liveResp?.headers.get('content-security-policy') ?? null;
      const live2xx = liveResp !== null && liveResp.status >= 200 && liveResp.status < 300;
      liveGrade = live2xx ? gradeCspForRemoteDenial(liveCspHeader) : { ok: false, reason: `non-2xx or failed fetch (status=${liveStatus})` };
    }

    const ok = rawGrade.ok && liveGrade.ok;
    return {
      ok,
      evidence: `GET ${rawUrl}\n  status=${rawStatus} Content-Security-Policy=${JSON.stringify(rawCspHeader)} -> ${rawGrade.ok ? 'PASS' : `FAIL (${rawGrade.reason})`}\nPOST /api/tools/live-artifacts/create: status=${createResp.status} artifactId=${artifactId ?? 'n/a'}\nGET ${previewUrl}\n  status=${liveStatus} Content-Security-Policy=${JSON.stringify(liveCspHeader)} -> ${liveGrade.ok ? 'PASS' : `FAIL (${liveGrade.reason})`}`,
    };
  } finally {
    if (daemon) await daemon.kill().catch(() => undefined);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function checkC48(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  const surfaces = [
    'apps/web/src/components/project-cover.tsx',
    'apps/web/src/components/RecentProjectsStrip.tsx',
    'apps/web/src/components/DesignsTab.tsx',
  ];
  const rows: string[] = [];
  let anyLiveFrame = false;
  let allFramesCorrect = true;
  for (const rel of surfaces) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) { rows.push(`${rel}: absent`); continue; }
    const frames = findJsxIframeElements(abs);
    if (frames.length === 0) { rows.push(`${rel}: no <iframe>`); continue; }
    for (const f of frames) {
      anyLiveFrame = true;
      const correct = f.sandboxLiteral === 'allow-scripts';
      if (!correct) allFramesCorrect = false;
      rows.push(`${rel}:${f.line}: sandbox=${JSON.stringify(f.sandboxLiteral)} hasSrc=${f.hasSrc} -> ${correct ? 'matches frozen contract (allow-scripts, no allow-same-origin)' : 'DOES NOT match frozen contract'}`);
    }
  }
  // Static helper resolution: DIAGNOSTIC-ONLY per ceremony ruling item 3,
  // never pass authority.
  const rawRouteCspStatic = routeHandlerHasCspHeader('apps/daemon/src/routes/project/index.ts', /raw/);
  const liveArtifactRouteCspStatic = routeHandlerHasCspHeader('apps/daemon/src/routes/live-artifact.ts', /preview/);
  // Runtime HTTP evidence: THE pass authority for cspOk.
  const runtimeCsp = await probeCspRuntimeEvidence();
  const cspOk = runtimeCsp.ok;
  const nm35c = findNm35cThreatNote();
  // Confirmation-round bypass fix (C4-8): cspOk is now UNCONDITIONALLY
  // load-bearing -- previously `!anyLiveFrame` short-circuited the whole
  // `(!anyLiveFrame || (allFramesCorrect && cspOk))` clause to true
  // whenever no <iframe> was found in the scanned UI files, meaning the
  // mandated runtime CSP result never had to pass at all in that case.
  // The routes this probes (/raw/index.html,
  // /live-artifacts/:id/preview) are reachable directly over HTTP
  // regardless of whether the CURRENT frontend happens to render an
  // iframe pointed at them, so their CSP correctness must hold
  // unconditionally, not only when a live frame is presently detected.
  const ok = nm35c.found && cspOk && (!anyLiveFrame || allFramesCorrect);
  return {
    ok,
    evidence: `${rows.join('\n')}\nanyLiveFrame=${anyLiveFrame}\n[diagnostic-only, NOT pass authority] ${rawRouteCspStatic.evidence}\n[diagnostic-only, NOT pass authority] ${liveArtifactRouteCspStatic.evidence}\n[RUNTIME HTTP EVIDENCE -- pass authority for cspOk, UNCONDITIONALLY required]\n${runtimeCsp.evidence}\n${nm35c.evidence}`,
    detail: ok ? undefined : !nm35c.found ? 'no docs/security/*.md documents NM-35C with a recognizable deliberate allow-same-origin omission' : !cspOk ? 'the real iframe-serving routes do not carry a genuinely restrictive Content-Security-Policy on their actual HTTP responses (unconditionally required, regardless of current iframe presence)' : 'a live iframe exists whose sandbox attribute does not match the frozen contract',
  };
}

// =========================================================================
// C4-9 -- DesignsTab fan-out is bounded. RUNS TODAY against the real
// component via a TEMPORARY vitest spec (deleted before this run's
// treeDirty check, mirroring the temp-worktree teardown pattern in
// verify-w0.ts).
// =========================================================================
// Sol r1 finding 6 fixes, all applied below:
//  - peak counters (and call logs) reset between tests via afterEach.
//  - test 2 waits on peakLiveArtifacts (where the injected failure lives),
//    not peakFiles.
//  - test 2 explicitly proves the failing call fired AND that every OTHER
//    project's call completed (a call-log Set, not just a DOM-text proxy).
//  - isActive is OMITTED (defaults to true) on both mounts -- forcing
//    isActive={false} would false-red (or, worse, trivially false-GREEN) a
//    correct "fetch only when visible" implementation that gates the
//    initial fetch on visibility.
//  - project counts, the per-call delay, and which project fails are all
//    randomized per run (crypto.randomInt) -- de-fixturized so no
//    recognizable constant (40, 5, 'project-2', 30ms) survives to be
//    special-cased.
//  - observed peaks/call-log outcomes are written to a side-channel JSON
//    file (C49_RESULTS_PATH) this verifier reads afterward and folds into
//    the C4-9 evidence text, not just a pass/fail summary.
//  - a large-N pagination/virtualization check (Sol r1 finding 7): with a
//    project count far above any plausible page size, the DOM must NOT
//    render a `.design-card` for every project -- proving S4-6's
//    pagination/virtualization requirement, not just bounded fetch
//    concurrency.
async function checkC49(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  const specPath = path.join(repoRoot, `apps/web/tests/components/.verify-w4-c4-9-fanout.${process.pid}.test.tsx`);
  const outFile = path.join(proofDir, `c4-9-vitest-run.${process.pid}.json`);
  const resultsPath = path.join(proofDir, `c4-9-results.${process.pid}.json`);
  const n1 = crypto.randomInt(25, 46);
  const delayMs = crypto.randomInt(20, 51);
  const n2 = crypto.randomInt(4, 9);
  const failIndex2 = crypto.randomInt(0, n2);
  const n3 = crypto.randomInt(150, 251); // large-N pagination/virtualization check
  const specSource = `// TEMPORARY -- written and deleted by scripts/waves/verify-w4.ts (C4-9).
// Not a committed test file; if you are reading this in the repo, the
// verifier crashed before cleanup -- safe to delete.
// @vitest-environment jsdom
import fs from 'node:fs';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignsTab } from '../../src/components/DesignsTab';
import type { Project } from '../../src/types';

const RESULTS_PATH = ${JSON.stringify(resultsPath)};
const DELAY_MS = ${delayMs};
let concurrentLiveArtifacts = 0;
let peakLiveArtifacts = 0;
let concurrentFiles = 0;
let peakFiles = 0;
let liveArtifactCallLog: { projectId: string; failed: boolean }[] = [];
let FAIL_PROJECT_ID = '__none__'; // set per-test; '__none__' never matches a real project id
// Confirmation-round bypass fix (C4-9): a quiescence timeout must halt the
// WHOLE file, not just fail the one test it occurred in -- Vitest's
// afterEach runs unconditionally regardless of a thrown test, and later
// it() blocks in this describe() run by default with no bail behavior.
// Once set, this is checked by afterEach (skips resetCounters()) and by
// every remaining it() body (throws immediately, before any assertion).
let quiescenceTimedOut = false;

vi.mock('../../src/providers/registry', () => ({
  deleteLiveArtifact: vi.fn(),
  fetchLiveArtifacts: vi.fn(async (projectId: string) => {
    concurrentLiveArtifacts++;
    peakLiveArtifacts = Math.max(peakLiveArtifacts, concurrentLiveArtifacts);
    await new Promise((r) => setTimeout(r, DELAY_MS));
    concurrentLiveArtifacts--;
    if (projectId === FAIL_PROJECT_ID) {
      liveArtifactCallLog.push({ projectId, failed: true });
      throw new Error('simulated mid-page failure');
    }
    liveArtifactCallLog.push({ projectId, failed: false });
    return [];
  }),
  fetchProjectFiles: vi.fn(async (projectId: string) => {
    concurrentFiles++;
    peakFiles = Math.max(peakFiles, concurrentFiles);
    await new Promise((r) => setTimeout(r, DELAY_MS));
    concurrentFiles--;
    return [];
  }),
  liveArtifactPreviewUrl: (projectId: string, artifactId: string) => \`/api/projects/\${projectId}/live-artifacts/\${artifactId}/preview\`,
  projectFileUrl: (projectId: string, fileName: string) => \`/api/projects/\${projectId}/files/\${fileName}\`,
}));

function makeProjects(n: number): Project[] {
  return Array.from({ length: n }, (_, i) => ({
    id: \`project-\${i}\`,
    name: \`Project \${i}\`,
    skillId: null,
    designSystemId: null,
    createdAt: i,
    updatedAt: i,
    status: { value: 'not_started' as const },
  }));
}
function resetCounters(): void {
  concurrentLiveArtifacts = 0; peakLiveArtifacts = 0;
  concurrentFiles = 0; peakFiles = 0;
  liveArtifactCallLog = [];
  FAIL_PROJECT_ID = '__none__';
}
function appendResult(key: string, value: unknown): void {
  let all: Record<string, unknown> = {};
  try { all = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8')); } catch { all = {}; }
  all[key] = value;
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(all, null, 2));
}
// Sol r2 finding 6: a fixed Math.max(500, DELAY_MS*4) wait before afterEach's
// counter reset could leave a correct bounded implementation (e.g. cap=1)
// still processing a long remaining queue -- afterEach then zeroed the
// SHARED counters out from under that still-running work, corrupting the
// next test's peaks. Wait for actual quiescence (in-flight concurrency
// observed at 0 for several consecutive polls) instead of a fixed sleep.
//
// The counters this polls are decremented INSIDE each individual mocked
// fetch call, but DesignsTab's own state update runs one level up, in the
// Promise.all(...).then callback that calls setLiveArtifactsByProject --
// so "all counters are back to 0" is necessarily a beat EARLIER than
// "React has committed the resulting re-render". An empirical dump of a
// real run confirmed this: with a short stability window the container's
// rendered text was consistently missing entries that were unambiguously
// present a few hundred ms later. A longer confirmed-idle window (not a
// size-proportional fixed sleep -- a small constant number of 60ms polls
// once concurrency is ALREADY at zero) covers that gap.
// Ceremony ruling item 4: on timeout this THROWS (carrying the remaining
// counters and stable streak) instead of silently returning -- the throw
// propagates out of the awaiting \`it()\` callback and fails that Vitest
// test directly, so no result recording, counter reset, subsequent
// assertion, or passing outcome can occur after a quiescence timeout.
async function waitForQuiescence(timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  let stableStreak = 0;
  while (Date.now() - start < timeoutMs) {
    if (concurrentLiveArtifacts === 0 && concurrentFiles === 0) {
      stableStreak++;
      if (stableStreak >= 20) return;
    } else {
      stableStreak = 0;
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  quiescenceTimedOut = true;
  throw new Error(\`waitForQuiescence timed out after \${timeoutMs}ms without reaching the required stable-zero streak of 20 (remaining: concurrentLiveArtifacts=\${concurrentLiveArtifacts} concurrentFiles=\${concurrentFiles} stableStreak=\${stableStreak}/20)\`);
}

const CONCURRENCY_CEILING = 12;
const N1 = ${n1};
const N2 = ${n2};
const FAIL_INDEX_2 = ${failIndex2};
const N3 = ${n3};

describe('C4-9 DesignsTab fan-out bound', () => {
  afterEach(() => {
    cleanup();
    // Confirmation-round bypass fix (C4-9): once a quiescence timeout has
    // occurred (in this test or an earlier one), NO further counter reset
    // may occur -- resetCounters() is skipped permanently for the rest of
    // this file's execution, not just for the test that timed out.
    if (!quiescenceTimedOut) resetCounters();
  });

  it('bounds concurrent fetchLiveArtifacts/fetchProjectFiles calls regardless of project count', async () => {
    // Confirmation-round bypass fix (C4-9): halt before any assertion runs
    // if an earlier test in this file already hit a quiescence timeout.
    if (quiescenceTimedOut) throw new Error('halted: a prior quiescence timeout forbids any further test in this file from running');
    render(
      <DesignsTab
        projects={makeProjects(N1)}
        skills={[]}
        designSystems={[]}
        onOpen={vi.fn()}
        onOpenLiveArtifact={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(peakLiveArtifacts).toBeGreaterThan(0);
      expect(peakFiles).toBeGreaterThan(0);
    }, { timeout: 8000 });

    await waitForQuiescence();

    appendResult('test1', { n1: N1, delayMs: DELAY_MS, peakLiveArtifacts, peakFiles, ceiling: CONCURRENCY_CEILING });

    expect(peakLiveArtifacts, 'fetchLiveArtifacts fan-out must be bounded, not one-shot-per-project').toBeLessThanOrEqual(CONCURRENCY_CEILING);
    expect(peakFiles, 'fetchProjectFiles fan-out must be bounded, not one-shot-per-project').toBeLessThanOrEqual(CONCURRENCY_CEILING);
    expect(peakLiveArtifacts, 'peak concurrency must not equal the full project count (that is the unbounded-fan-out bug)').not.toBe(N1);
  });

  it('does not blank the whole grid when a single project mid-page request fails, and proves the other requests completed', async () => {
    // Confirmation-round bypass fix (C4-9): halt before any assertion runs
    // if an earlier test in this file already hit a quiescence timeout.
    if (quiescenceTimedOut) throw new Error('halted: a prior quiescence timeout forbids any further test in this file from running');
    const projects2 = makeProjects(N2);
    FAIL_PROJECT_ID = projects2[FAIL_INDEX_2].id;
    render(
      <DesignsTab
        projects={projects2}
        skills={[]}
        designSystems={[]}
        onOpen={vi.fn()}
        onOpenLiveArtifact={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(peakLiveArtifacts).toBeGreaterThan(0);
    }, { timeout: 8000 });
    await waitForQuiescence();

    const failingEntry = liveArtifactCallLog.find((e) => e.projectId === FAIL_PROJECT_ID);
    const otherIds = projects2.map((p) => p.id).filter((id) => id !== FAIL_PROJECT_ID);
    const completedOthers = otherIds.filter((id) => liveArtifactCallLog.some((e) => e.projectId === id && !e.failed));

    appendResult('test2', {
      n2: N2, failIndex2: FAIL_INDEX_2, failProjectId: FAIL_PROJECT_ID,
      failingCallFired: Boolean(failingEntry),
      failingCallActuallyFailed: failingEntry ? failingEntry.failed : null,
      otherIdsCount: otherIds.length, completedOthersCount: completedOthers.length,
      callLog: liveArtifactCallLog,
    });

    expect(failingEntry, 'the injected failure must actually have fired for the designated project').toBeTruthy();
    expect(failingEntry && failingEntry.failed, 'the designated project call must have failed').toBe(true);
    expect(completedOthers.length, 'every OTHER project must have completed its fetchLiveArtifacts call despite the one failure').toBe(otherIds.length);
    for (const id of otherIds) {
      const name = projects2.find((p) => p.id === id).name;
      expect(document.body.textContent).toContain(name);
    }
  });

  it('pagination/virtualization: a large project count does not render a card per project', async () => {
    // Confirmation-round bypass fix (C4-9): halt before any assertion runs
    // if an earlier test in this file already hit a quiescence timeout.
    if (quiescenceTimedOut) throw new Error('halted: a prior quiescence timeout forbids any further test in this file from running');
    const projects3 = makeProjects(N3);
    const { container } = render(
      <DesignsTab
        projects={projects3}
        skills={[]}
        designSystems={[]}
        onOpen={vi.fn()}
        onOpenLiveArtifact={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(peakLiveArtifacts).toBeGreaterThan(0);
    }, { timeout: 8000 });
    await waitForQuiescence();
    // Sol r2 finding 7: counting the CSS class '.design-card' is bound to a
    // renameable implementation detail -- deleting or CSS-Modulizing that
    // class would pass this check even while rendering every project. Bind
    // to rendered PROJECT IDENTITY instead: count how many of the actual
    // (unique) project names appear as text anywhere in the rendered tree.
    // A plain word-boundary regex (\\bProject N\\b) does NOT work here: an
    // empirical dump of the real rendered container.textContent showed
    // sibling elements' text concatenated with ZERO inserted whitespace
    // (e.g. "...PPrototypeProject 224freeform..."), so there is no word
    // boundary on EITHER side of the name and \\b\\bProject 224\\b\\b never
    // matches, silently making the whole check pass vacuously (0 < N) on
    // every run regardless of whether pagination exists. Instead: find
    // every "Project <digits>" occurrence with a GREEDY digit capture --
    // greedy \\d+ always consumes the full number at that position, so
    // "Project 1" can never be spuriously extracted from inside
    // "Project 100"/"Project 199" the way a plain substring search could,
    // with no boundary assertion needed on either side.
    const text = container.textContent ?? '';
    const foundIndices = new Set([...text.matchAll(/Project (\\d+)/g)].map((m) => Number(m[1])));
    const renderedNames = projects3.filter((_project, i) => foundIndices.has(i)).length;
    appendResult('test3', { n3: N3, renderedNames });
    expect(renderedNames, 'a large project list must be paginated/virtualized, not render every project identity into the DOM at once').toBeLessThan(N3);
  });
});
`;
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, specSource);
  try { fs.unlinkSync(resultsPath); } catch { /* fresh run */ }
  try {
    const run = sh('pnpm', ['--filter', '@open-design/web', 'exec', 'vitest', 'run', '-c', 'vitest.config.ts', '--reporter=json', `--outputFile=${outFile}`, path.relative(path.join(repoRoot, 'apps/web'), specPath)], { timeoutMs: 3 * 60_000 });
    let parsed: { numFailedTests?: number; numPassedTests?: number; testResults?: unknown } | null = null;
    try { parsed = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { parsed = null; }
    let observedResults: unknown = null;
    try { observedResults = JSON.parse(fs.readFileSync(resultsPath, 'utf8')); } catch { observedResults = null; }
    const ok = run.status === 0 && parsed !== null && (parsed.numFailedTests ?? 1) === 0 && (parsed.numPassedTests ?? 0) >= 3;
    return {
      ok,
      evidence: `randomized fixture: n1=${n1} delayMs=${delayMs} n2=${n2} failIndex2=${failIndex2} n3=${n3}\nvitest exit=${run.status}\nparsed summary: numPassed=${parsed?.numPassedTests} numFailed=${parsed?.numFailedTests}\nobserved (from side-channel results file, written by the test itself):\n${JSON.stringify(observedResults, null, 2)}\nstdout tail:\n${run.stdout.slice(-3000)}\nstderr tail:\n${run.stderr.slice(-2000)}`,
      detail: ok ? undefined : "DesignsTab's fan-out is not bounded (today's known unbounded Promise.all), per-item failure isolation is broken, or the grid is not paginated/virtualized at scale",
    };
  } finally {
    try { fs.unlinkSync(specPath); } catch { /* already clean */ }
    try { fs.unlinkSync(outFile); } catch { /* best effort */ }
    try { fs.unlinkSync(resultsPath); } catch { /* best effort */ }
  }
}

// =========================================================================
// C4-10 -- measurably better under the R8 protocol. COMPLETELY REDESIGNED
// per Sol r1 ruling 5 / finding 2:
//  - NEVER boots a daemon directly against the frozen baseline corpus
//    (finding 2: daemon boots mutate its SQLite files -- exactly what
//    scale-baseline-2026-07.md's own "standing caveat" documents; a gate
//    that boots against corpus.path repeats that destructive-benchmark
//    mistake). Always a scratchCopyCorpus() first.
//  - Replaces the single `GET /files` request-timing proxy (which a
//    client-side concurrency/virtualization fix need not change at all)
//    with a genuine PARENT-VERSUS-HEAD comparison: the SAME real browser
//    activation scenario (real DesignsTab mount, real unmocked
//    fetchLiveArtifacts/fetchProjectFiles calls against a real daemon) is
//    measured against baseCommit (checked out via createWorktreeAt,
//    mirroring verify-w0.ts's parent-red pattern) and against HEAD, on
//    their OWN independent scratch corpus copies.
//  - Measures readiness p50+p95 (>=5 reps + 1 warmup), request count, peak
//    concurrent requests, and combined daemon+browser peak RSS -- not p50
//    alone, and gates on stated improvement/non-regression thresholds
//    across all axes, per R8.
//  - Binds the .md+.json baseline pair (ruling 7) rather than parsing any
//    metric out of the .md prose -- the .json remains the sole machine-
//    readable source; the .md is only checked for existence and cross-
//    reference.
// =========================================================================
interface BaselineJson {
  corpus: { path: string; sha256: string };
  machine: { fingerprint: string };
  nonRegressionCeiling: number;
  minimumImprovementThreshold: number;
  scenarios: { name: string; p50: number; p95: number; toleranceBandPct: number }[];
}
function machineFingerprint(): string {
  return `${os.hostname()}-${os.platform()}-${os.arch()}-${os.cpus().length}cpu`;
}
function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

interface DesignsTabActivationMeasurement {
  readinessMsSamples: number[];
  peakConcurrentRequests: number;
  peakCombinedRssKb: number;
  projectCount: number;
}
async function measureDesignsTabActivation(rootDir: string, scratchCorpusDir: string, reps: number): Promise<DesignsTabActivationMeasurement | { error: string }> {
  let daemon: BootedDaemon | undefined;
  let browser: MinimalPwBrowser | undefined;
  const harnessPath = path.join(rootDir, 'apps/web/src/.verify-w4-c410-harness.tsx');
  try {
    daemon = await bootDaemonForProbing(scratchCorpusDir, rootDir);
    const listResp = await fetch(`${daemon.url}/api/projects`, { signal: AbortSignal.timeout(30_000) });
    if (!listResp.ok) return { error: `GET /api/projects failed: ${listResp.status}` };
    const listJson = (await listResp.json()) as { projects?: { id?: unknown }[] };
    const sample = (listJson.projects ?? []).filter((p) => typeof p.id === 'string').slice(0, 30);
    if (sample.length === 0) return { error: 'no projects with a string id found in the scratch corpus' };
    const sampleIds = new Set(sample.map((p) => String(p.id)));
    // Ceremony ruling item 5: a timed mount is proven ONLY by a subsequent
    // EXACT DesignsTab data request for a sampled project -- the real
    // client (apps/web/src/providers/registry.ts) issues exactly
    // `GET /api/live-artifacts?projectId=<id>` (fetchLiveArtifacts) and
    // `GET /api/projects/<id>/files` (fetchProjectFiles) per project.
    // Preparatory `GET /api/projects` traffic must never satisfy this.
    function isQualifyingMountRequestUrl(url: string, origin: string): boolean {
      if (!url.startsWith(origin)) return false;
      const pathAndQuery = url.slice(origin.length);
      const liveArtifactsMatch = /^\/api\/live-artifacts\?projectId=([^&]+)$/.exec(pathAndQuery);
      if (liveArtifactsMatch?.[1] && sampleIds.has(decodeURIComponent(liveArtifactsMatch[1]))) return true;
      const filesMatch = /^\/api\/projects\/([^/]+)\/files$/.exec(pathAndQuery);
      if (filesMatch?.[1] && sampleIds.has(decodeURIComponent(filesMatch[1]))) return true;
      return false;
    }

    // Bundle THIS root's REAL DesignsTab with a harness that mounts it
    // using the REAL (unmocked) registry.ts -- a genuine integration
    // measurement of real requests against a real daemon, not a unit test.
    // Sol r2 finding 2: no `root` reuse across reps -- each rep below gets
    // a genuinely fresh Playwright page (fresh document), so `createRoot`
    // is always creating a first-ever root on that page.
    const harnessSource = `import { createRoot } from 'react-dom/client';
import React from 'react';
import { DesignsTab } from './components/DesignsTab';
(globalThis as any).__C410_MOUNT__ = () => {
  const el = document.getElementById('root');
  if (!el) return;
  const root = createRoot(el);
  const projects = (globalThis as any).__C410_PROJECTS__ || [];
  root.render(React.createElement(DesignsTab, {
    projects, skills: [], designSystems: [],
    onOpen: () => {}, onOpenLiveArtifact: () => {},
    onDelete: async () => true, onRename: async () => {},
  }));
};
`;
    fs.writeFileSync(harnessPath, harnessSource);
    const esbuild = resolveEsbuild();
    const built = await esbuild.build({
      entryPoints: [harnessPath], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
      loader: { '.tsx': 'tsx', '.ts': 'ts' }, absWorkingDir: path.join(rootDir, 'apps/web'),
      define: { 'process.env.NODE_ENV': JSON.stringify('production') }, logLevel: 'silent',
    });
    const bundledJs = built.outputFiles?.[0]?.text;
    if (!bundledJs) return { error: 'esbuild produced no output for the DesignsTab activation harness' };

    const pw = resolvePlaywright();
    browser = await pw.chromium.launch();
    const daemonOrigin = daemon.url;

    let peakConcurrentRequests = 0;
    let peakCombinedRssKb = 0;
    const rootPid = daemon.pid;
    const pollAbort = new AbortController();
    const poller = (async () => {
      while (!pollAbort.signal.aborted) {
        const snap = psSnapshot();
        let daemonRssKb = 0;
        if (rootPid) { const desc = descendantsOf(rootPid, snap); daemonRssKb = snap.filter((r) => desc.has(r.pid)).reduce((s, r) => s + r.rssKb, 0); }
        let browserRssKb = 0;
        const bpid = browser?.process()?.pid;
        if (bpid) { const desc = descendantsOf(bpid, snap); desc.add(bpid); browserRssKb = snap.filter((r) => desc.has(r.pid)).reduce((s, r) => s + r.rssKb, 0); }
        const combined = daemonRssKb + browserRssKb;
        if (combined > peakCombinedRssKb) peakCombinedRssKb = combined;
        await sleep(300);
      }
    })();

    // Ceremony ruling item 5: every timed repetition gets a genuinely
    // FRESH page (`browser.newPage()`), not the same page/React root
    // remounted. ALL preparatory work (navigation, setContent, project-
    // data injection) completes BEFORE any measurement listener is armed,
    // so the preparatory `GET /api/projects` can never be visible to (or
    // satisfy) the listeners that later prove a timed mount fired. `t0` is
    // set immediately before script injection/mount. A timed mount is
    // proven ONLY by a subsequent qualifying DesignsTab data request
    // (isQualifyingMountRequestUrl, above) -- if none appears within the
    // start timeout, or the in-flight count never drains to a stable zero
    // within the drain deadline, the repetition FAILS and records NO
    // sample (never a partial/degraded reading).
    const readinessMsSamples: number[] = [];
    const repFailures: string[] = [];
    // Confirmation-round bypass fix (C4-10): the warmup (i===-1) must be
    // load-bearing, not merely discarded-if-successful. Previously a
    // failed warmup only pushed to repFailures with no other effect --
    // since readinessMsSamples never receives an i===-1 entry regardless
    // of outcome, five later valid timed reps alone satisfied the gate
    // below even when the required warmup itself never started or never
    // drained. warmupValid now tracks the warmup's own outcome explicitly
    // and is required alongside the five timed samples.
    let warmupValid = false;
    for (let i = -1; i < reps; i++) { // i===-1 is a discarded warmup (R8: warmup + >=5 timed reps)
      const page = await browser.newPage();
      try {
        await page.goto(`${daemonOrigin}/api/projects`, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => undefined);
        await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>', { waitUntil: 'domcontentloaded' });
        await page.evaluate((projects: unknown[]) => { (globalThis as unknown as { __C410_PROJECTS__: unknown[] }).__C410_PROJECTS__ = projects; }, sample);

        // Listeners armed only now -- after every preparatory step above.
        let inFlight = 0;
        let sawQualifyingMountRequest = false;
        page.on('request', (req) => {
          const url = req.url();
          if (!url.startsWith(daemonOrigin)) return;
          inFlight++;
          if (inFlight > peakConcurrentRequests) peakConcurrentRequests = inFlight;
          if (isQualifyingMountRequestUrl(url, daemonOrigin)) sawQualifyingMountRequest = true;
        });
        page.on('requestfinished', (req) => { if (req.url().startsWith(daemonOrigin)) inFlight = Math.max(0, inFlight - 1); });
        page.on('requestfailed', (req) => { if (req.url().startsWith(daemonOrigin)) inFlight = Math.max(0, inFlight - 1); });

        const t0 = Date.now();
        await page.addScriptTag({ content: bundledJs });
        await page.evaluate(() => { (globalThis as unknown as { __C410_MOUNT__: () => void }).__C410_MOUNT__(); });

        let started = false;
        for (let poll = 0; poll < 50; poll++) { // up to 1s for a qualifying mount request to appear
          if (sawQualifyingMountRequest) { started = true; break; }
          await sleep(20);
        }
        if (!started) {
          repFailures.push(`rep(i=${i}): FAILED -- no qualifying mount request (GET /api/live-artifacts?projectId=<sample-id> or GET /api/projects/<sample-id>/files) observed within the start timeout; no sample recorded`);
          continue;
        }

        let drained = false;
        let stableStreak = 0;
        for (let poll = 0; poll < 300; poll++) { // up to 15s to drain to quiescence
          if (inFlight === 0) { stableStreak++; if (stableStreak >= 5) { drained = true; break; } } else { stableStreak = 0; }
          await sleep(50);
        }
        if (!drained) {
          repFailures.push(`rep(i=${i}): FAILED -- drain-streak expiry (in-flight=${inFlight}, stableStreak=${stableStreak}/5); no sample recorded`);
          continue;
        }

        const elapsed = Date.now() - t0;
        if (i >= 0) readinessMsSamples.push(elapsed);
        else warmupValid = true; // i === -1 reached here only via a started+drained warmup
      } finally {
        await page.close().catch(() => undefined);
      }
    }

    pollAbort.abort();
    await poller;
    // Ceremony ruling item 5: R8 statistics only after warmup PLUS five
    // valid, started, and proven-quiescent timed repetitions -- a run with
    // any failed repetition (including the warmup itself) is an error,
    // never a partial result.
    if (!warmupValid || readinessMsSamples.length < reps) {
      return { error: `warmupValid=${warmupValid}, ${readinessMsSamples.length}/${reps} timed repetitions were valid (started + proven-quiescent) -- R8 statistics require a valid discarded warmup PLUS all ${reps} timed repetitions\n${repFailures.join('\n')}` };
    }
    return { readinessMsSamples, peakConcurrentRequests, peakCombinedRssKb, projectCount: sample.length };
  } finally {
    try { fs.unlinkSync(harnessPath); } catch { /* best effort */ }
    if (browser) await browser.close().catch(() => undefined);
    if (daemon) await daemon.kill().catch(() => undefined);
  }
}

// Ceremony ruling item 5: recompute the corpus digest using the SAME
// canonical walk W0 uses (scripts/waves/verify-w0.ts C0-9) -- deterministic
// relative-path sort, `relativePath:fileSha256` pairs joined by newline and
// hashed -- BEFORE any scratch copy or daemon boot. MAX_HASHED_FILES
// mirrors W0's cap exactly; for the present 2,849-file corpus (well under
// the 3000 cap) this hashes every single file, matching the ruling's
// explicit requirement.
function recomputeCorpusDigest(corpusPath: string): { sha256: string; fileCount: number } | { error: string } {
  const MAX_HASHED_FILES = 3000;
  const allFiles: { rel: string; abs: string }[] = [];
  try {
    (function walk(dir: string, base: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, base);
        else allFiles.push({ rel: path.relative(base, full), abs: full });
      }
    })(corpusPath, corpusPath);
  } catch (err) {
    return { error: `corpus walk failed: ${String(err)}` };
  }
  if (allFiles.length === 0) return { error: 'corpus walk found zero files' };
  allFiles.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const sampled = allFiles.length <= MAX_HASHED_FILES ? allFiles : allFiles.filter((_, i) => i % Math.ceil(allFiles.length / MAX_HASHED_FILES) === 0);
  try {
    const contentPairs = sampled.map((f) => `${f.rel}:${sha256File(f.abs)}`);
    return { sha256: sha256Bytes(contentPairs.join('\n')), fileCount: allFiles.length };
  } catch (err) {
    return { error: `corpus file read/hash failed: ${String(err)}` };
  }
}

async function checkC410(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  const baselineJsonPath = path.join(repoRoot, 'docs/testing/scale-baseline-2026-07.json');
  const baselineMdPath = path.join(repoRoot, 'docs/testing/scale-baseline-2026-07.md');
  if (!fs.existsSync(baselineJsonPath)) return { ok: false, evidence: 'docs/testing/scale-baseline-2026-07.json not found', detail: 'no committed baseline corpus reference' };
  if (!fs.existsSync(baselineMdPath)) return { ok: false, evidence: 'docs/testing/scale-baseline-2026-07.md not found', detail: 'the .md+.json baseline pair must both be bound, not just the .json' };
  const mdContent = fs.readFileSync(baselineMdPath, 'utf8');
  if (!mdContent.includes('scale-baseline-2026-07.json')) return { ok: false, evidence: 'scale-baseline-2026-07.md does not reference scale-baseline-2026-07.json', detail: '.md and .json are not cross-bound' };
  const baseline = JSON.parse(fs.readFileSync(baselineJsonPath, 'utf8')) as BaselineJson;

  if (!coverBackendSurface().present) {
    return {
      ok: false,
      evidence: `baseline .md+.json bound and present (corpus=${baseline.corpus.path}, machine=${baseline.machine.fingerprint})\n${backendGateFailure().evidence}`,
      detail: 'product surface missing: nothing to measure yet -- the parent-vs-head R8 harness below is real and runs once apps/daemon/src/covers/** exists',
    };
  }
  if (!fs.existsSync(baseline.corpus.path)) return { ok: false, evidence: `corpus path from baseline JSON does not exist on this machine: ${baseline.corpus.path}`, detail: 'cannot run the R8 comparison without the frozen corpus' };
  const thisMachine = machineFingerprint();
  if (thisMachine !== baseline.machine.fingerprint) return { ok: false, evidence: `machine fingerprint mismatch: baseline=${baseline.machine.fingerprint} this run=${thisMachine}`, detail: 'R8 baselines are machine-local by design' };

  // Ceremony ruling item 5: recompute the corpus digest BEFORE any scratch
  // copy or daemon boot. A malformed declaration, walk/read error, or
  // mismatch fails right here, before any copying or measurement.
  if (!baseline.corpus.sha256 || typeof baseline.corpus.sha256 !== 'string') {
    return { ok: false, evidence: `baseline.corpus.sha256 is missing or malformed: ${JSON.stringify(baseline.corpus.sha256)}`, detail: 'cannot verify the frozen corpus matches a malformed baseline declaration' };
  }
  const corpusDigest = recomputeCorpusDigest(baseline.corpus.path);
  if ('error' in corpusDigest) {
    return { ok: false, evidence: `corpus digest recomputation FAILED before any scratch copy/daemon boot: ${corpusDigest.error}\nstated baseline.corpus.sha256=${baseline.corpus.sha256}`, detail: 'cannot verify the frozen corpus matches the declared baseline -- refusing to measure against a possibly-different corpus' };
  }
  if (corpusDigest.sha256 !== baseline.corpus.sha256) {
    return { ok: false, evidence: `corpus digest MISMATCH before any scratch copy/daemon boot: stated=${baseline.corpus.sha256} computed=${corpusDigest.sha256} (hashed ${corpusDigest.fileCount} files, same canonical walk as W0)`, detail: 'the on-disk corpus does not match the declared baseline.corpus.sha256 -- refusing to measure against a possibly-different corpus' };
  }

  const REPS = 5;
  let parentScratch: string | undefined;
  let headScratch: string | undefined;
  let parentWorktree: WorktreeHandle | undefined;
  try {
    const parentAt = createWorktreeAt(baseCommit, 'c410-parent');
    if ('error' in parentAt) return { ok: false, evidence: parentAt.error, detail: 'could not check out the parent commit for the parent-vs-head comparison' };
    parentWorktree = parentAt;

    // Sol r1 ruling 5: NEVER boot directly against baseline.corpus.path.
    parentScratch = scratchCopyCorpus(baseline.corpus.path);
    headScratch = scratchCopyCorpus(baseline.corpus.path);

    const parentResult = await measureDesignsTabActivation(parentWorktree.dir, parentScratch, REPS);
    const headResult = await measureDesignsTabActivation(repoRoot, headScratch, REPS);
    if ('error' in parentResult) return { ok: false, evidence: `parent(${baseCommit.slice(0, 12)}) measurement failed: ${parentResult.error}`, detail: 'could not establish a parent baseline for comparison' };
    if ('error' in headResult) return { ok: false, evidence: `head(${headSha.slice(0, 12)}) measurement failed: ${headResult.error}`, detail: 'could not measure HEAD' };

    const parentP50 = percentile(parentResult.readinessMsSamples, 50);
    const parentP95 = percentile(parentResult.readinessMsSamples, 95);
    const headP50 = percentile(headResult.readinessMsSamples, 50);
    const headP95 = percentile(headResult.readinessMsSamples, 95);

    // Sol r2 ruling 2 / finding 2: use the AUTHORITATIVE baseline JSON
    // fields (docs/testing/scale-baseline-2026-07.json:22-23), not locally
    // hardcoded percentages that had drifted from them (15%/10%/25%/50% vs
    // the real 10%/25%) -- and GATE p95, not just record it.
    const minImprovementPct = baseline.minimumImprovementThreshold;
    const nonRegressionCeilingPct = baseline.nonRegressionCeiling;
    const improvementTargetMs = parentP50 * (1 - minImprovementPct / 100);
    const p50RegressionCeilingMs = parentP50 * (1 + nonRegressionCeilingPct / 100);
    const p95RegressionCeilingMs = parentP95 * (1 + nonRegressionCeilingPct / 100);
    const readinessImproved = headP50 <= improvementTargetMs;
    const p50NotRegressed = headP50 <= p50RegressionCeilingMs;
    const p95NotRegressed = headP95 <= p95RegressionCeilingMs;
    const rssNotRegressed = headResult.peakCombinedRssKb <= parentResult.peakCombinedRssKb * (1 + nonRegressionCeilingPct / 100);
    const requestCountNotRegressed = headResult.peakConcurrentRequests <= parentResult.peakConcurrentRequests * (1 + nonRegressionCeilingPct / 100);
    const ok = readinessImproved && p50NotRegressed && p95NotRegressed && rssNotRegressed && requestCountNotRegressed;

    return {
      ok,
      evidence: `corpus digest (recomputed BEFORE any scratch copy/daemon boot, same canonical walk as W0): stated=${baseline.corpus.sha256} computed=${corpusDigest.sha256} filesHashed=${corpusDigest.fileCount} -> MATCH\nparent(${baseCommit.slice(0, 12)}, scratch corpus): readinessSamples=${JSON.stringify(parentResult.readinessMsSamples)} p50=${parentP50}ms p95=${parentP95}ms peakConcurrentRequests=${parentResult.peakConcurrentRequests} peakCombinedRssKb=${parentResult.peakCombinedRssKb} projectCount=${parentResult.projectCount}\nhead(${headSha.slice(0, 12)}, scratch corpus): readinessSamples=${JSON.stringify(headResult.readinessMsSamples)} p50=${headP50}ms p95=${headP95}ms peakConcurrentRequests=${headResult.peakConcurrentRequests} peakCombinedRssKb=${headResult.peakCombinedRssKb} projectCount=${headResult.projectCount}\nbaseline authoritative fields: minimumImprovementThreshold=${minImprovementPct}% nonRegressionCeiling=${nonRegressionCeilingPct}%\np50: target<=${improvementTargetMs.toFixed(1)}ms -> improved=${readinessImproved}; ceiling<=${p50RegressionCeilingMs.toFixed(1)}ms -> notRegressed=${p50NotRegressed}\np95: ceiling<=${p95RegressionCeilingMs.toFixed(1)}ms -> notRegressed=${p95NotRegressed}\npeak combined RSS non-regression (<=+${nonRegressionCeilingPct}%): ${rssNotRegressed}\npeak concurrent requests non-regression (<=+${nonRegressionCeilingPct}%): ${requestCountNotRegressed}`,
      detail: ok ? undefined : 'does not beat the parent commit by the baseline minimum p50 improvement threshold, or regresses p95/RSS/request-concurrency past the baseline non-regression ceiling',
    };
  } finally {
    if (parentWorktree) parentWorktree.cleanup();
    if (parentScratch) fs.rmSync(parentScratch, { recursive: true, force: true });
    if (headScratch) fs.rmSync(headScratch, { recursive: true, force: true });
  }
}

// =========================================================================
// C4-11 -- covers join the backup set (extends W0's C0-1 inventory).
// =========================================================================
async function checkC411(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  if (!coverBackendSurface().present) return backendGateFailure();
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c411-src-'));
  const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c411-restore-'));
  const archivePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c411-archive-')), 'archive');
  let sourceDaemon: BootedDaemon | undefined;
  let restoreDaemon: BootedDaemon | undefined;
  try {
    sourceDaemon = await bootDaemonForProbing(sourceDir);
    const projectId = `w4-c411-${crypto.randomBytes(6).toString('hex')}`;
    await createProject(sourceDaemon.url, projectId, projectId);
    await uploadProjectFile(sourceDaemon.url, projectId, 'index.html', '<!doctype html><html><body>cover backup test</body></html>');
    const gen = await postGenerate(sourceDaemon.url, projectId);
    const genValidation = validateCoverSuccessBody(gen.body);
    if (gen.status < 200 || gen.status >= 300 || !genValidation.ok) return { ok: false, evidence: `generate failed or invalid record: status=${gen.status} ${genValidation.reason ?? ''}`, detail: 'cannot establish a cover to back up' };
    const got = await getCover(sourceDaemon.url, projectId);
    if (!got.ok || !got.bytes) return { ok: false, evidence: `GET cover failed: ${got.status}` };
    const originalSha = sha256Bytes(got.bytes);
    await sourceDaemon.kill();
    sourceDaemon = undefined;

    const backupRun = odCli(['backup', 'create', '--out', archivePath, '--json'], odDataEnv(sourceDir));
    if (backupRun.status !== 0) return { ok: false, evidence: `od backup create failed: exit=${backupRun.status}\n${backupRun.stdout}\n${backupRun.stderr}`, detail: 'backup CLI surface unavailable or errored' };
    const manifestPath = path.join(archivePath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return { ok: false, evidence: `archive manifest.json not found at ${manifestPath}`, detail: 'backup did not produce the expected archive layout' };
    const manifestEntries = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { class?: string; relPath?: string; sha256?: string; checksumsRelPath?: string }[];
    const coverEntry = manifestEntries.find((e) => /cover/i.test(String(e.class ?? '')) || /cover/i.test(String(e.relPath ?? '')));
    if (!coverEntry) return { ok: false, evidence: `manifest.json entries: ${JSON.stringify(manifestEntries.map((e) => ({ class: e.class, relPath: e.relPath })))}`, detail: 'no cover-related class found in the archive manifest -- covers have not joined the backup set' };

    let archivedBytesMatch = false;
    if (coverEntry.relPath) {
      const coverArchivedAbs = path.join(archivePath, coverEntry.relPath);
      if (fs.statSync(coverArchivedAbs).isDirectory()) {
        // Directory class: locate a file inside matching the original sha.
        const all = walkDataDir(coverArchivedAbs);
        archivedBytesMatch = [...all.values()].some((f) => f.sha256 === originalSha);
      } else {
        archivedBytesMatch = sha256File(coverArchivedAbs) === originalSha;
      }
    }

    const restoreRun = odCli(['restore', '--archive', archivePath, '--json'], odDataEnv(restoreDir));
    if (restoreRun.status !== 0) return { ok: false, evidence: `od restore failed: exit=${restoreRun.status}\n${restoreRun.stdout}\n${restoreRun.stderr}`, detail: 'restore CLI surface unavailable or errored' };

    restoreDaemon = await bootDaemonForProbing(restoreDir);
    const restoredGet = await getCover(restoreDaemon.url, projectId);
    const restoredRenders = restoredGet.ok && restoredGet.bytes !== null && sha256Bytes(restoredGet.bytes) === originalSha;

    const ok = archivedBytesMatch && restoredRenders;
    return {
      ok,
      evidence: `coverEntry=${JSON.stringify(coverEntry)}\narchivedBytesMatchOriginal=${archivedBytesMatch}\nrestoredCoverRenders(bytes match)=${restoredRenders}`,
      detail: ok ? undefined : 'covers are not both archived byte-faithfully AND restored to a renderable state',
    };
  } finally {
    if (sourceDaemon) await sourceDaemon.kill().catch(() => undefined);
    if (restoreDaemon) await restoreDaemon.kill().catch(() => undefined);
    fs.rmSync(sourceDir, { recursive: true, force: true });
    fs.rmSync(restoreDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(archivePath), { recursive: true, force: true });
  }
}

// =========================================================================
// C4-12 -- parity + gates. Sol r1 finding 8 fixes:
//  - EXACT SUBCOMMAND_MAP key match (`=== 'cover'`), not /^cover/i, which
//    admitted decoy keys like "coverage".
//  - The import-closure reachability requirement is REMOVED entirely.
//    AGENTS.md "Capability exposure" mandates CLI<->HTTP parity (the CLI
//    calls the same /api/* endpoint the UI does), not CLI-imports-daemon-
//    source -- the old check false-red a correct HTTP-only CLI, and (per
//    the same finding) a resolver bug made an UNRELATED covers import
//    anywhere in cli.ts satisfy it vacuously when the handler was local.
//  - Loads and VALIDATES the AUTHORITATIVE scripts/waves/capability-
//    manifest.json for an exact `cover` row (Sol r1 ruling 3, same
//    treatment as W1's C1-8) -- the bespoke behavioral probe below
//    SUPPLEMENTS this, it never replaces it.
//  - The CLI is exercised for BOTH verbs the frozen HTTP contract defines:
//    `generate` (POST .../cover/generate) and `show` (GET .../cover).
//
// Sol r2 ruling 3/4 / finding 8: the manifest check only required
// httpPath to CONTAIN "cover" (a decoy path like "/api/uncover" would
// pass), and the behavioral probe's sole proof was "CLI JSON output
// contains the project id" -- explicitly called out as fabricatable by
// any CLI that prints a plausible-looking response without ever calling
// the daemon. Both are fixed below: the manifest now requires an EXACT
// httpMethod/httpPath match against the frozen generate route, and the
// behavioral probe proves each verb ACTUALLY issued a request to its
// frozen endpoint by instrumenting the isolated daemon's raw
// http.Server 'request' event (native Node infrastructure, not an
// apps/daemon source modification) and reading back the resulting
// request log -- CLI JSON content is no longer trusted as proof by
// itself, only as supplementary evidence.
// =========================================================================
interface CapabilityManifestRow { capability?: unknown; uiEntryPoint?: unknown; httpMethod?: unknown; httpPath?: unknown; outputSchema?: unknown; cliArgs?: unknown; parityApplicable?: unknown; knownNamespaceRoutes?: unknown }
const FROZEN_MANIFEST_HTTP_METHOD = 'POST';
const FROZEN_MANIFEST_HTTP_PATH = '/api/projects/:id/cover/generate';
function validateCapabilityManifestCoverRow(): { ok: boolean; evidence: string } {
  const manifestPath = path.join(repoRoot, 'scripts/waves/capability-manifest.json');
  if (!fs.existsSync(manifestPath)) return { ok: false, evidence: `${manifestPath}: absent` };
  let rows: CapabilityManifestRow[];
  try { rows = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (err) { return { ok: false, evidence: `capability-manifest.json is not valid JSON: ${String(err)}` }; }
  const row = rows.find((r) => r.capability === 'cover');
  if (!row) return { ok: false, evidence: `no row with capability === 'cover' in capability-manifest.json (capabilities present: ${JSON.stringify(rows.map((r) => r.capability))})` };
  const violations: string[] = [];
  for (const field of ['capability', 'uiEntryPoint', 'httpMethod', 'httpPath', 'outputSchema'] as const) {
    if (typeof row[field] !== 'string' || row[field] === '') violations.push(`${field} must be a non-empty string`);
  }
  if (!Array.isArray(row.cliArgs) || row.cliArgs.length === 0 || !row.cliArgs.every((a) => typeof a === 'string')) violations.push('cliArgs must be a non-empty string array');
  if (typeof row.parityApplicable !== 'boolean') violations.push('parityApplicable must be a boolean');
  if (!Array.isArray(row.knownNamespaceRoutes) || !row.knownNamespaceRoutes.every((a) => typeof a === 'string')) violations.push('knownNamespaceRoutes must be a string array');
  if (row.httpMethod !== FROZEN_MANIFEST_HTTP_METHOD || row.httpPath !== FROZEN_MANIFEST_HTTP_PATH) {
    violations.push(`httpMethod/httpPath must EXACTLY match the frozen generate route ${FROZEN_MANIFEST_HTTP_METHOD} ${FROZEN_MANIFEST_HTTP_PATH} -- got ${JSON.stringify(row.httpMethod)} ${JSON.stringify(row.httpPath)}`);
  }
  return { ok: violations.length === 0, evidence: `capability-manifest.json 'cover' row: ${JSON.stringify(row)}\nviolations: ${violations.join('; ') || 'none'}` };
}

// Isolated daemon boot + a raw request log, used ONLY by C4-12's
// behavioral probe (kept separate from the shared bootDaemonForProbing()
// every other criterion relies on, to avoid any risk to those
// already-working paths). Attaches to the Node http.Server's own
// 'request' event -- fires for every inbound request before Express
// routing runs, so this observes real requests without touching
// apps/daemon source.
interface BootedDaemonWithRequestLog extends BootedDaemon { requestLogPath: string }
async function bootDaemonForProbingWithRequestLog(dataDir: string): Promise<BootedDaemonWithRequestLog> {
  const requestLogPath = path.join(proofDir, `.c4-12-request-log.${process.pid}.${crypto.randomBytes(3).toString('hex')}.jsonl`);
  fs.writeFileSync(requestLogPath, '');
  const bootScript = `
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
process.env.OD_DATA_DIR = ${JSON.stringify(dataDir)};
process.env.OD_DAEMON_CLI_PATH = ${JSON.stringify(path.join(repoRoot, 'apps/daemon/dist/cli.js'))};
const mod = await import(pathToFileURL(${JSON.stringify(path.join(repoRoot, 'apps/daemon/src/server.ts'))}).href);
const started = await mod.startServer({ port: 0, returnServer: true });
started.server.on('request', (req) => {
  try { fs.appendFileSync(${JSON.stringify(requestLogPath)}, JSON.stringify({ method: req.method, url: req.url }) + '\\n'); } catch {}
});
console.log('OD_W4_VERIFIER_READY ' + JSON.stringify({ url: started.url }));
process.on('SIGTERM', async () => { await started.shutdown(); process.exit(0); });
`;
  const scriptPath = path.join(proofDir, `.boot-daemon-reqlog.${process.pid}.${crypto.randomBytes(3).toString('hex')}.mjs`);
  fs.writeFileSync(scriptPath, bootScript);
  const child = spawn('pnpm', ['exec', 'tsx', scriptPath], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffered = '';
  const ready = await new Promise<{ url: string } | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 45_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const line = buffered.split('\n').find((l) => l.startsWith('OD_W4_VERIFIER_READY '));
      if (line) {
        clearTimeout(timeout);
        try { resolve(JSON.parse(line.slice('OD_W4_VERIFIER_READY '.length))); } catch { resolve(null); }
      }
    });
    child.on('exit', () => { clearTimeout(timeout); resolve(null); });
  });
  const kill = async (): Promise<void> => {
    if (child.pid) { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { try { if (child.pid) child.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 5_000);
      child.on('exit', () => { clearTimeout(t); resolve(); });
    });
    try { fs.unlinkSync(scriptPath); } catch { /* best effort */ }
    try { fs.unlinkSync(requestLogPath); } catch { /* best effort */ }
  };
  if (!ready) {
    await kill();
    throw new Error(`daemon (request-log variant) failed to boot within 45s (stdout tail: ${buffered.slice(-2000)})`);
  }
  return { url: ready.url, pid: child.pid, dataDir, routeInventory: [], kill, requestLogPath };
}
function readRequestLog(logPath: string): { method: string; url: string }[] {
  try {
    return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { method: string; url: string });
  } catch { return []; }
}

async function checkC412(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  const rows: string[] = [];
  const keys = extractSubcommandMapKeys();
  const coverKeyPresent = keys.includes('cover');
  rows.push(`SUBCOMMAND_MAP keys: ${JSON.stringify(keys)}\nexact 'cover' key present: ${coverKeyPresent}`);

  const manifestRow = validateCapabilityManifestCoverRow();
  rows.push(manifestRow.evidence);

  let cliHttpParityOk = false;
  if (coverKeyPresent && coverBackendSurface().present) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c412-'));
    let daemon: BootedDaemonWithRequestLog | undefined;
    try {
      daemon = await bootDaemonForProbingWithRequestLog(dataDir);
      const projectId = `w4-c412-${crypto.randomBytes(6).toString('hex')}`;
      await createProject(daemon.url, projectId, projectId);
      await uploadProjectFile(daemon.url, projectId, 'index.html', '<!doctype html><html><body>cli parity</body></html>');

      // Pin the CLI at THIS isolated daemon explicitly. resolveDaemonUrl()
      // (apps/daemon/src/daemon-url.ts) otherwise falls through to sidecar
      // IPC discovery or `tools-dev status --json`, either of which could
      // resolve to a DIFFERENT daemon (including the default namespace) --
      // an explicit OD_DAEMON_URL removes that ambiguity and is required
      // for the request-log proof below to mean anything.
      const cliEnv: NodeJS.ProcessEnv = { ...odDataEnv(dataDir), OD_DAEMON_URL: daemon.url };
      const expectedGeneratePath = coverGeneratePath(projectId);
      const expectedFetchPath = coverFetchPath(projectId);

      // Verb 1: generate, through the CLI. Sol r2 finding 8: "CLI JSON
      // contains the project id" is fabricatable proof on its own (a CLI
      // could print a plausible response without ever calling the
      // daemon) -- the real proof is a REQUEST-LOG entry showing the CLI
      // actually issued POST to the frozen generate endpoint.
      const logBeforeGenerate = readRequestLog(daemon.requestLogPath).length;
      const cliGenerate = odCli(['cover', 'generate', '--project', projectId, '--json'], cliEnv, 60_000);
      const generateRequests = readRequestLog(daemon.requestLogPath).slice(logBeforeGenerate);
      const generateHitFrozenEndpoint = generateRequests.some((r) => r.method === 'POST' && r.url.split('?')[0] === expectedGeneratePath);
      let cliGenerateParsed: unknown = null;
      try { const lines = cliGenerate.stdout.trim().split('\n').filter(Boolean); cliGenerateParsed = lines.length ? JSON.parse(lines[lines.length - 1] ?? '{}') : null; } catch { cliGenerateParsed = null; }
      const cliGenerateMentionsProject = isRecord(cliGenerateParsed) && JSON.stringify(cliGenerateParsed).includes(projectId);

      // Independent HTTP-surface confirmation that a cover now exists.
      const httpGet = await getCover(daemon.url, projectId);

      // Verb 2: show/inspect, through the CLI -- same request-log proof,
      // bound to the frozen GET fetch endpoint.
      const logBeforeShow = readRequestLog(daemon.requestLogPath).length;
      const cliShow = odCli(['cover', 'show', '--project', projectId, '--json'], cliEnv, 60_000);
      const showRequests = readRequestLog(daemon.requestLogPath).slice(logBeforeShow);
      const showHitFrozenEndpoint = showRequests.some((r) => r.method === 'GET' && r.url.split('?')[0] === expectedFetchPath);
      let cliShowParsed: unknown = null;
      try { const lines = cliShow.stdout.trim().split('\n').filter(Boolean); cliShowParsed = lines.length ? JSON.parse(lines[lines.length - 1] ?? '{}') : null; } catch { cliShowParsed = null; }
      const cliShowMentionsProject = isRecord(cliShowParsed) && JSON.stringify(cliShowParsed).includes(projectId);

      cliHttpParityOk = cliGenerate.status === 0 && cliShow.status === 0 && generateHitFrozenEndpoint && showHitFrozenEndpoint && httpGet.ok && httpGet.bytes !== null && httpGet.bytes.length > 0;
      rows.push(`frozen endpoints: generate=POST ${expectedGeneratePath} show=GET ${expectedFetchPath}\nod cover generate --project <id> --json: exit=${cliGenerate.status} calledFrozenEndpoint=${generateHitFrozenEndpoint} (observed requests: ${JSON.stringify(generateRequests)}) mentionsProjectId(supplementary)=${cliGenerateMentionsProject}\nod cover show --project <id> --json: exit=${cliShow.status} calledFrozenEndpoint=${showHitFrozenEndpoint} (observed requests: ${JSON.stringify(showRequests)}) mentionsProjectId(supplementary)=${cliShowMentionsProject}\nHTTP GET cover: ok=${httpGet.ok} bytes=${httpGet.bytes?.length ?? 0}\nparity=${cliHttpParityOk}`);
    } finally {
      if (daemon) await daemon.kill().catch(() => undefined);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  } else {
    rows.push(`cli<->http behavioral parity probe skipped: coverKeyPresent=${coverKeyPresent} backendPresent=${coverBackendSurface().present}`);
  }

  const guardRun = sh('pnpm', ['guard'], { timeoutMs: 10 * 60_000 });
  const typecheckRun = sh('pnpm', ['typecheck'], { timeoutMs: 10 * 60_000 });
  rows.push(`pnpm guard exit=${guardRun.status}\npnpm typecheck exit=${typecheckRun.status}`);
  if (guardRun.status !== 0) rows.push(`guard tail:\n${guardRun.stdout.slice(-3000)}\n${guardRun.stderr.slice(-1500)}`);
  if (typecheckRun.status !== 0) rows.push(`typecheck tail:\n${typecheckRun.stdout.slice(-3000)}\n${typecheckRun.stderr.slice(-1500)}`);

  const ok = coverKeyPresent && manifestRow.ok && cliHttpParityOk && guardRun.status === 0 && typecheckRun.status === 0;
  return {
    ok,
    evidence: rows.join('\n\n'),
    detail: ok ? undefined : 'od cover subcommand missing, capability-manifest.json cover row missing/invalid, CLI<->HTTP behavioral parity unproven, or pnpm guard/typecheck failed',
  };
}

// =========================================================================
// main
// =========================================================================
async function main(): Promise<void> {
  // Defensive sweep: remove any stale temp artifacts a previous crashed run
  // left behind (e.g. a temp vitest spec or esbuild harness) so this run's
  // treeDirty check is not poisoned by prior failures.
  for (const stale of [
    ...fs.readdirSync(path.join(repoRoot, 'apps/web/tests/components')).filter((f) => f.startsWith('.verify-w4-')),
  ]) {
    try { fs.unlinkSync(path.join(repoRoot, 'apps/web/tests/components', stale)); } catch { /* best effort */ }
  }
  try { fs.unlinkSync(path.join(repoRoot, 'apps/web/src/.verify-w4-c47-harness.tsx')); } catch { /* best effort */ }
  try { fs.unlinkSync(path.join(repoRoot, 'apps/web/src/.verify-w4-c410-harness.tsx')); } catch { /* best effort */ }

  await runCriterion(
    'C4-1', 'POST /api/projects/:id/cover/generate (frozen route, full record validated) -> kill daemon -> reboot on same OD_DATA_DIR -> GET /api/projects/:id/cover -> AST-check a card surface renders an <img> against a cover URL',
    'covers persist under RUNTIME_DATA_DIR and survive daemon restart: identical bytes served, the on-disk artifact is neither rewritten nor re-mtime-stamped, and a card-rendering surface actually renders the stored cover (not just backend byte persistence)',
    checkC41,
  );
  await runCriterion(
    'C4-2', '4 adversarial per-run-randomized stripe-barcode fixtures (left-nav, carousel, dark-hero, fills-frame) -> generate cover -> decode PNG -> reconstruct the observed crop window pixel-precisely -> real 1D IoU/recall against frozen expected geometry',
    'crop favors the hero region, graded by a real IoU (or, for the trivial fills-frame control, recall) oracle against frozen expected geometry using per-run randomized, held-out hero colors -- not a fixed-template palette a stub could match without rendering anything',
    checkC42,
  );
  // C4-3 and C4-4 share one probe run (same fixture, same trigger) but are
  // recorded as two separate manifest rows -- VERIFICATION-CONTRACT S2
  // requires every PRD criterion ID to appear individually.
  await runC43C44();
  await runCriterion(
    'C4-5', 'successful-slow-job control (3s) / infinite-loop project (typed RENDER_TIMEOUT) / throughput-inferred concurrency at M and 2M / memory-hog project (typed RENDER_MEMORY_LIMIT, aggregate descendant RSS), each against a live daemon',
    'the renderer enforces a per-job timeout (typed error, paired with a successful-slow-job negative control), a concurrency cap that plateaus under 2x load (throughput-inferred, not raw request-interval overlap), and a real aggregate memory ceiling (typed error, not a generic crash below an arbitrary observed RSS)',
    checkC45,
  );
  await runCriterion(
    'C4-6', 'real canary TCP listener (self-tested) + a project referencing it via img/script/link/fetch -> trigger render -> require a SUCCESSFUL render with a full valid record before trusting zero canary hits',
    'the renderer is PROCESS-LEVEL network-denied: zero outbound connections reach a real external listener, PROVEN ONLY when the render job actually succeeded (a 404/500 job that never ran proves nothing)',
    checkC46,
  );
  await runCriterion(
    'C4-7', 'esbuild-bundle the REAL HtmlProjectCoverFrame from project-cover.tsx -> mount in a real Playwright Chromium page against a real daemon-served project referencing a real canary -> require an actual glyph render + assert zero canary hits; ALSO mint a real tool token over Node IPC from the isolated daemon child\'s own toolTokenRegistry -> POST the same tracker content to the real /api/tools/live-artifacts/create -> revoke the token -> mount the REAL (unmocked) DesignsTab.tsx so it fetches and renders its own live-artifact iframe end-to-end',
    'the not-yet-rendered fallback is not network-capable on BOTH live-preview surfaces in the grid: a project HTML referencing a remote tracker produces NO outbound request on first card view, an empty/crashed render (no glyph) does not trivially pass (today: FAILS, HtmlProjectCoverFrame unconditionally mounts a live network-capable iframe once the file HEAD-verifies), AND a real end-to-end live artifact (created via the real tool endpoint, discovered and rendered by the real DesignsTab) does not leak to the canary either',
    checkC47,
  );
  await runCriterion(
    'C4-8', 'AST scan of project-cover.tsx / RecentProjectsStrip.tsx / DesignsTab.tsx for <iframe> sandbox literals + AST-scoped CSP-header check on the routes those iframes load + negation-aware docs/security/*.md search for an NM-35C threat note',
    'any remaining live iframe carries exactly sandbox="allow-scripts" (frozen contract) AND its route sets a Content-Security-Policy header, and the threat model is recorded in a docs/security NM-35C note with a genuine deliberate-omission phrasing near "allow-same-origin" (not just substring co-occurrence, which would also match the opposite policy)',
    checkC48,
  );
  await runCriterion(
    'C4-9', 'temporary vitest+jsdom spec mounting the REAL, unmocked-isActive DesignsTab with randomized (per-run) project counts, delay, and failing-project index; instrumented fetchLiveArtifacts/fetchProjectFiles mocks tracking peak concurrency + a call log proving the failure fired and others completed; a large-N pagination/virtualization check',
    "DesignsTab issues a bounded number of concurrent fetchLiveArtifacts/fetchProjectFiles calls regardless of (randomized) project count, a mid-page failure is proven to have fired without blanking or stalling the other projects' completions, and a large project list is paginated/virtualized rather than rendering one .design-card per project",
    checkC49,
  );
  await runCriterion(
    'C4-10', 'parent(baseCommit, git worktree)-versus-head DesignsTab activation scenario, each against its OWN SCRATCH COPY of the corpus (never the frozen corpus.path directly): real unmocked browser mount, readiness p50/p95 over 1 warmup + 5 reps, peak concurrent requests, combined daemon+browser peak RSS',
    'HEAD beats the parent commit by the stated minimum readiness-p50 margin without regressing readiness/RSS/request-concurrency past their ceilings (R8: same corpus content, same machine, warmup, >=5 reps, multiple axes) -- never measured by booting directly against the frozen baseline corpus',
    checkC410,
  );
  await runCriterion(
    'C4-11', 'generate a cover (full record validated) -> od backup create --json -> read archive manifest.json directly -> od restore --json into a fresh data dir -> GET the restored cover',
    "covers join the backup set: the archive manifest names a cover-related class whose archived bytes match the original sha256, and a restored daemon's GET .../cover returns those same bytes (\"a restored cover renders\")",
    checkC411,
  );
  await runCriterion(
    'C4-12', "SUBCOMMAND_MAP AST scan for the EXACT 'cover' key -> load+validate the AUTHORITATIVE scripts/waves/capability-manifest.json 'cover' row against the EXACT frozen POST generate route -> instrument an isolated daemon's raw http.Server request stream -> run od cover generate/show and prove each verb's request log shows it hit its OWN frozen endpoint -> pnpm guard -> pnpm typecheck",
    "od cover subcommand exists (exact key, not a decoy like 'coverage'), the authoritative capability manifest binds the exact frozen POST /api/projects/:id/cover/generate route (not merely a path containing \"cover\"), the CLI's generate AND show verbs are PROVEN (via a live request log, not just CLI JSON content) to call their respective frozen HTTP endpoints, and pnpm guard + pnpm typecheck both exit 0",
    checkC412,
  );

  // =======================================================================
  // GATE-INTEGRITY / LEASE / HEAD-DRIFT (verify-w0.ts precedent)
  // =======================================================================
  await runCriterion('GATE-INTEGRITY', 'sha256(this file) vs an orchestrator-approved hash, if one exists', 'defense-in-depth self-hash check; the PRIMARY control is running this file from an orchestrator-approved copy', async (): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> => {
    const selfPath = path.resolve(process.argv[1] ?? path.join(repoRoot, 'scripts/waves/verify-w4.ts'));
    const selfSha256 = fs.existsSync(selfPath) ? sha256File(selfPath) : 'unresolvable-self-path';
    const approvedHashPath = path.join(os.homedir(), '.claude', 'goal-state', 'mishmash-w4-project-covers', 'approved-gate.sha256');
    if (!fs.existsSync(approvedHashPath)) return { ok: true, evidence: `sha256: ${selfSha256}\nno approved-gate.sha256 present -- advisory only` };
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === selfSha256;
    return { ok: gateOk, evidence: `sha256: ${selfSha256}\napproved: ${approved}`, detail: gateOk ? undefined : 'verify-w4.ts modified since orchestrator approval' };
  });

  function globToRegExp(glob: string): RegExp {
    let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    re = re.replace(/\*\*/g, ' GLOBSTAR ');
    re = re.replace(/\*/g, '[^/]*');
    re = re.replace(/ GLOBSTAR /g, '.*');
    return new RegExp(`^${re}$`);
  }
  await runCriterion(
    'LEASE',
    `git diff --name-only ${baseCommit}...HEAD subset-of leases.json[W4] read via git show ${baseCommit}:docs/plans/waves/leases.json`,
    'no writes outside the W4 lease, read from baseCommit so the wave cannot widen its own lease by editing leases.json on its own branch (this exact defect -- reading the working tree instead -- was REJECTED in W2 review)',
    async () => {
      const leasesText = readFileAtCommit(baseCommit, 'docs/plans/waves/leases.json');
      const leasesRaw = JSON.parse(leasesText) as { waves: Record<string, { allow: string[]; deny?: string[] }> };
      const w4Lease = leasesRaw.waves.W4;
      if (!w4Lease) return { ok: false, evidence: '', detail: 'no "W4" entry in leases.json@baseCommit' };
      const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
      if (diffResult.status !== 0) return { ok: false, evidence: diffResult.stdout, detail: `git diff exited ${diffResult.status}` };
      const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
      if (diffNames.length === 0) return { ok: false, evidence: '', detail: `baseCommit=${baseCommit} headSha=${headSha} differ but git diff reported zero changed files` };
      const allowRe = w4Lease.allow.map(globToRegExp);
      const denyRe = (w4Lease.deny ?? []).map(globToRegExp);
      const violations = diffNames.filter((f) => !allowRe.some((re) => re.test(f)) || denyRe.some((re) => re.test(f)));
      return { ok: violations.length === 0, evidence: violations.join('\n') || `all ${diffNames.length} changed files inside the lease:\n${diffNames.join('\n')}` };
    },
  );

  const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  record('HEAD-DRIFT', 'git rev-parse HEAD (re-resolved at end)', 'HEAD must not move during the run', headShaFinal === headSha, `initial=${headSha} final=${headShaFinal}`, { detail: headShaFinal === headSha ? undefined : 'HEAD moved during the run' });

  const statusResult = sh('git', ['-c', 'status.showUntrackedFiles=normal', 'status', '--porcelain=v1']);
  const treeDirty = statusResult.status !== 0 || statusResult.stdout.trim().length > 0;

  for (const r of results) {
    if (!r.artifact || !r.artifactSha256) continue;
    try {
      const currentHash = sha256File(r.artifact);
      if (currentHash !== r.artifactSha256) { r.status = 'fail'; r.detail = `${r.detail ? `${r.detail}; ` : ''}TAMPER DETECTED`; }
    } catch { r.status = 'fail'; r.detail = `${r.detail ? `${r.detail}; ` : ''}artifact disappeared before final integrity re-check`; }
  }

  const manifestPreHash = {
    wave: 'W4', commit: headSha, treeDirty, baseCommit,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    machineFingerprint: machineFingerprint(),
    criteria: results,
  };
  let manifestWritten = false;
  const manifestPath = path.join(proofDir, 'manifest.json');
  try {
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(manifestPreHash, null, 2));
    fs.renameSync(tmp, manifestPath);
    manifestWritten = true;
  } catch (err) {
    try {
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w4-emergency-manifest.json'), JSON.stringify(manifestPreHash, null, 2));
      console.error(`verify-w4: primary manifest write failed (${String(err)}); wrote fallback`);
    } catch (err2) { console.error(`verify-w4: manifest write failed everywhere (${String(err)} / ${String(err2)})`); }
  }
  let manifestSha256 = 'unavailable';
  if (manifestWritten) {
    try { manifestSha256 = sha256File(manifestPath); fs.writeFileSync(path.join(proofDir, 'manifest.sha256.txt'), `${manifestSha256}\n`); } catch { manifestSha256 = 'unavailable'; }
  }

  // Sol r1 finding 11 (non-blocking): retain THIS run's manifest + every
  // criterion artifact under a per-run subdirectory, independent of the
  // canonical proof/manifest.json this run just overwrote -- so two
  // consecutive runs are each independently auditable afterward, not just
  // "the last one wins".
  if (manifestWritten) {
    try {
      const runDir = path.join(proofDir, 'runs', `${headSha}-${Date.now()}-${process.pid}`);
      fs.mkdirSync(runDir, { recursive: true });
      fs.copyFileSync(manifestPath, path.join(runDir, 'manifest.json'));
      for (const r of results) {
        if (r.artifact && fs.existsSync(r.artifact)) {
          try { fs.copyFileSync(r.artifact, path.join(runDir, path.basename(r.artifact))); } catch { /* best effort per-artifact */ }
        }
      }
    } catch (err) {
      console.error(`verify-w4: per-run artifact retention failed (advisory only): ${String(err)}`);
    }
  }

  const failures = results.filter((r) => r.status === 'fail');
  const blocked = results.filter((r) => r.status === 'blocked-on-founder');
  console.log(`\nverify-w4: ${results.length - failures.length - blocked.length}/${results.length} criteria pass (${failures.length} fail, ${blocked.length} blocked-on-founder), treeDirty=${treeDirty}`);
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  if (treeDirty) console.log('  ⚠ tree is dirty: advisory only');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  process.exit(failures.length === 0 && !treeDirty && manifestWritten ? 0 : 1);
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
