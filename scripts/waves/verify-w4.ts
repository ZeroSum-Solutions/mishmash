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
function frontendRendersCoverImg(): { found: boolean; evidence: string } {
  const surfaces = ['apps/web/src/components/project-cover.tsx', 'apps/web/src/components/DesignsTab.tsx', 'apps/web/src/components/RecentProjectsStrip.tsx'];
  const rows: string[] = [];
  let found = false;
  for (const rel of surfaces) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) { rows.push(`${rel}: absent`); continue; }
    const { sourceFile, text } = parseTs(abs);
    let hit: number | null = null;
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
              hit = line + 1;
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    void text;
    rows.push(`${rel}: <img src=...cover...> ${hit !== null ? `found at line ${hit}` : 'NOT found'}`);
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
// FROZEN CONTRACT ASSUMPTION for this probe only (flagged for reviewer
// confirmation, per ruling 6's "any fixture recalibration requires an
// independently reviewed amendment"): the renderer captures at a FIXED
// viewport, SOURCE_WIDTH x SOURCE_HEIGHT, before attention/entropy-cropping
// to the cover's target dimensions. If the real implementation instead
// full-page-captures arbitrarily tall pages, this probe's geometry
// assumption needs a follow-up amendment; the underlying stripe-barcode
// TECHNIQUE (below) still applies unchanged.
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
async function generateCoverAndReconstruct(daemon: BootedDaemon, projectId: string, html: string): Promise<{ png: { data: Buffer; info: { width: number; height: number; channels: number } } } | { error: string }> {
  await createProject(daemon.url, projectId, projectId);
  await uploadProjectFile(daemon.url, projectId, 'index.html', html);
  const gen = await postGenerate(daemon.url, projectId);
  const genValidation = validateCoverSuccessBody(gen.body);
  if (gen.status < 200 || gen.status >= 300 || !genValidation.ok) return { error: `generate failed: status=${gen.status} record=${genValidation.reason ?? 'ok'}` };
  const got = await getCover(daemon.url, projectId);
  if (!got.ok || !got.bytes) return { error: `fetch cover failed: ${got.status}` };
  const sharp = resolveSharp();
  const { data, info } = await sharp(got.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { png: { data, info: { width: info.width, height: info.height, channels: info.channels } } };
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
      const recon = reconstructObservedWindow(result.png, heroStripes, fixture.fillerBase);
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
        const windowHeight = recon.window[1] - recon.window[0];
        const ideal = idealWindowFor(scoredHeroY0, scoredHeroY1, windowHeight);
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
// Sol r1 finding 1 fixes:
//  (a) timeout now requires the TYPED `RENDER_TIMEOUT` error code (not any
//      non-2xx), paired with a NEGATIVE CONTROL: a job that is slow but
//      well within the timeout must succeed with a full valid record --
//      otherwise "any failure" could pass a renderer that rejects
//      everything indiscriminately.
//  (b) concurrency is now measured by THROUGHPUT INFERENCE, not raw
//      request-interval overlap: under a synchronous, network-denied
//      contract, a client cannot observe "job dequeued and started" versus
//      "job still queued" from HTTP timing alone -- every request's
//      interval spans queue-wait PLUS actual work, so ALL of them overlap
//      for the full duration even under a correct single-worker queue,
//      which is exactly what made the prior overlap-based check false-red
//      a correct bounded implementation. Instead: submit M jobs that each
//      take a known, fixed BLOCK_MS of real work; total wall-clock T to
//      complete all M gives effectiveConcurrency = (M*BLOCK_MS)/T --
//      unbounded implies effectiveConcurrency ~= M, a real cap C implies
//      effectiveConcurrency ~= C regardless of M. Run TWICE at M and 2M and
//      require the inferred concurrency to plateau, not double.
//  (c) memory now sums (aggregates) RSS across ALL matched daemon-
//      descendant processes at each poll tick (not the single largest),
//      and requires the TYPED `RENDER_MEMORY_LIMIT` error code as the
//      pass condition -- a generic crash below some arbitrary observed
//      ceiling no longer counts as proof of an enforced bound.
// =========================================================================
function blockingScriptHtml(blockMs: number): string {
  return `<!doctype html><html><body><script>const s=Date.now();while(Date.now()-s<${blockMs}){}</script><div>blocked ${blockMs}ms</div></body></html>`;
}
const INFINITE_LOOP_HTML = '<!doctype html><html><body><script>while(true){}</script></body></html>';
const MEMORY_HOG_HTML = '<!doctype html><html><body><script>let a=[];while(true){a.push(new Array(2000000).fill(7));}</script></body></html>';

async function measureThroughputConcurrency(daemon: BootedDaemon, m: number, blockMs: number): Promise<{ effectiveConcurrency: number; wallClockMs: number; successCount: number }> {
  const ids = Array.from({ length: m }, (_, i) => `w4-c45-conc-${m}-${i}-${crypto.randomBytes(3).toString('hex')}`);
  for (const id of ids) {
    await createProject(daemon.url, id, id);
    await uploadProjectFile(daemon.url, id, 'index.html', blockingScriptHtml(blockMs));
  }
  const t0 = Date.now();
  const outcomes = await Promise.all(ids.map((id) => postGenerate(daemon.url, id, 60_000).catch(() => null)));
  const wallClockMs = Date.now() - t0;
  const successCount = outcomes.filter((o) => o && o.status >= 200 && o.status < 300).length;
  const effectiveConcurrency = wallClockMs <= 0 ? m : (m * blockMs) / wallClockMs;
  return { effectiveConcurrency, wallClockMs, successCount };
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
    const M = 8;
    const BLOCK_MS = 1500;
    const round1 = await measureThroughputConcurrency(daemon, M, BLOCK_MS);
    const round2 = await measureThroughputConcurrency(daemon, M * 2, BLOCK_MS);
    const round1Bounded = round1.effectiveConcurrency < M * 0.9; // meaningfully below M, not just noise under M
    // Plateau check: doubling submitted load must not double the inferred
    // concurrency (allow 60% headroom for measurement noise/scheduling
    // jitter, still far short of the ~2x an unbounded queue would show).
    const plateaus = round2.effectiveConcurrency <= round1.effectiveConcurrency * 1.6;
    const concurrencyOk = round1Bounded && plateaus && round1.successCount === M && round2.successCount === M * 2;
    rows.push(`concurrency (throughput-inferred): M=${M} blockMs=${BLOCK_MS} round1: wallClockMs=${round1.wallClockMs} effectiveConcurrency=${round1.effectiveConcurrency.toFixed(2)} successCount=${round1.successCount}/${M}; round2(M=${M * 2}): wallClockMs=${round2.wallClockMs} effectiveConcurrency=${round2.effectiveConcurrency.toFixed(2)} successCount=${round2.successCount}/${M * 2} -> boundedBelowM=${round1Bounded} plateaus(2x load did not ~2x concurrency)=${plateaus} -> ${concurrencyOk ? 'PASS' : 'FAIL'}`);

    // --- (c) memory ceiling: AGGREGATE (summed) RSS across all daemon-
    // descendant processes, requiring the TYPED RENDER_MEMORY_LIMIT error.
    const memProjectId = `w4-c45-mem-${crypto.randomBytes(4).toString('hex')}`;
    await createProject(daemon.url, memProjectId, memProjectId);
    await uploadProjectFile(daemon.url, memProjectId, 'index.html', MEMORY_HOG_HTML);
    const MEMORY_CEILING_KB = 3 * 1024 * 1024; // 3 GB outer sane bound on the AGGREGATE
    let peakAggregateRssKb = 0;
    const rootPid = daemon.pid;
    const pollAbort = new AbortController();
    const poller = (async () => {
      while (!pollAbort.signal.aborted) {
        if (rootPid) {
          const snap = psSnapshot();
          const desc = descendantsOf(rootPid, snap);
          const aggregate = snap.filter((r) => desc.has(r.pid)).reduce((sum, r) => sum + r.rssKb, 0);
          if (aggregate > peakAggregateRssKb) peakAggregateRssKb = aggregate;
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
    const memoryOk = memResp.status >= 400 && memValidation.ok && peakAggregateRssKb < MEMORY_CEILING_KB;
    rows.push(`memory-ceiling (aggregate descendant RSS): status=${memResp.status} typedError=${memValidation.ok} (${memValidation.reason ?? 'ok'}) peakAggregateRssKb=${peakAggregateRssKb} ceilingKb=${MEMORY_CEILING_KB} -> ${memoryOk ? 'PASS' : 'FAIL'}`);

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
}
interface MinimalPwBrowser { newPage(): Promise<MinimalPwPage>; close(): Promise<void>; process(): { pid: number } | null }
interface MinimalPwBrowserType { launch(opts?: Record<string, unknown>): Promise<MinimalPwBrowser> }
function resolvePlaywright(): { chromium: MinimalPwBrowserType } {
  return createRequire(path.join(repoRoot, 'e2e/package.json'))('@playwright/test') as { chromium: MinimalPwBrowserType };
}
// Sol r1 finding 5, second half: S4-5 applies to ANY live preview in the
// grid, not just HtmlProjectCoverFrame -- DesignsTab.tsx has its OWN
// separate live-artifact iframe (line ~740, `sandbox="allow-scripts"`,
// `src={liveArtifactPreviewUrl(...)}`). That route is tool-token-gated
// (`/api/tools/live-artifacts/create` requires `authorizeToolRequest`, only
// mintable from a live agent turn -- this verifier has no such turn and,
// per AGENTS.md's app-boundary rule, must not reach into daemon internals
// to forge one), so seeding a REAL live artifact end-to-end is not
// practical here. This sub-check instead reproduces the iframe's REAL,
// AST-extracted sandbox literal from DesignsTab.tsx's actual current
// source (not a hardcoded guess -- if a future fix changes or removes it,
// this check tracks that), pointed at the SAME real daemon-served tracker
// content used for surface 1, sharing the SAME canary. This is a
// mechanism-level proxy (does an iframe carrying this exact sandbox value,
// loading server-provided HTML, leak network) rather than an end-to-end
// live-artifact test -- flagged in the authoring report as a remaining
// round-2 ambiguity for the reviewer to weigh in on.
async function probeSecondIframeSurface(page: MinimalPwPage, daemonUrl: string, rawTrackerUrl: string, canary: CanaryServer): Promise<{ ok: boolean; evidence: string }> {
  const designsTabPath = path.join(repoRoot, 'apps/web/src/components/DesignsTab.tsx');
  const frames = findJsxIframeElements(designsTabPath);
  if (frames.length === 0) return { ok: true, evidence: 'DesignsTab.tsx has no <iframe> -- second surface already removed, nothing to leak' };
  const sandboxLiteral = frames[0]?.sandboxLiteral;
  if (!sandboxLiteral) return { ok: false, evidence: `DesignsTab.tsx has an <iframe> at line ${frames[0]?.line} with no static sandbox literal -- cannot verify its containment` };
  const hitsBefore = canary.hits.length;
  await page.evaluate((args: { sandboxAttr: string; src: string }) => {
    // No DOM lib in scripts/tsconfig.json -- `document` is reached via
    // globalThis (same pattern used elsewhere in this file for `window`);
    // this code only ever executes inside a real browser page, never here.
    const doc = (globalThis as unknown as { document: { createElement(tag: string): { setAttribute(k: string, v: string): void; className: string }; body: { appendChild(el: unknown): void } } }).document;
    const iframe = doc.createElement('iframe');
    iframe.setAttribute('sandbox', args.sandboxAttr);
    iframe.setAttribute('src', args.src);
    iframe.className = 'c47-surface2-iframe';
    doc.body.appendChild(iframe);
  }, { sandboxAttr: sandboxLiteral, src: rawTrackerUrl });
  await page.waitForTimeout(3000);
  const hitsAfter = canary.hits.length;
  const iframeCount = await page.locator('.c47-surface2-iframe').count();
  const ok = iframeCount === 1 && hitsAfter === hitsBefore;
  return { ok, evidence: `DesignsTab.tsx iframe sandbox="${sandboxLiteral}" (line ${frames[0]?.line}), mounted against daemon=${daemonUrl}: canary hits before=${hitsBefore} after=${hitsAfter} -> ${ok ? 'contained' : 'LEAKED or failed to mount'}` };
}

async function checkC47(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  const canary = await startCanaryServer();
  const harnessPath = path.join(repoRoot, 'apps/web/src/.verify-w4-c47-harness.tsx');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c47-'));
  let daemon: BootedDaemon | undefined;
  let browser: MinimalPwBrowser | undefined;
  try {
    const selfTest = await canarySelfTest(canary);
    if (!selfTest.ok) return { ok: false, evidence: `canary self-test failed: ${selfTest.evidence}`, detail: 'canary infrastructure is broken -- a zero-hit result cannot be trusted' };

    daemon = await bootDaemonForProbing(dataDir);
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

    const surface2 = await probeSecondIframeSurface(page, daemon.url, rawUrl, canary);

    const ok = surface1Ok && surface2.ok;
    return {
      ok,
      evidence: `[surface 1: HtmlProjectCoverFrame] mounted=${mounted}\nglyphRendered(count)=${glyphCount}\nliveIframeRendered(count)=${iframeCount}\ncanary hits before=${hitsBefore} after=${hitsAfter}\npageErrors=${JSON.stringify(pageErrors.slice(0, 5))}\n[surface 2: DesignsTab live-artifact iframe]\n${surface2.evidence}`,
      detail: ok
        ? undefined
        : !surface1Ok
          ? (iframeCount > 0
            ? 'surface 1: a live network-capable iframe is present for the not-yet-rendered state and it reached the canary -- S4-5 requires a static glyph/skeleton'
            : 'surface 1: no glyph was actually rendered (empty/crashed render trivially shows zero canary hits and must not pass)')
          : 'surface 2 (DesignsTab live-artifact iframe): leaked to the canary, or failed to mount -- see evidence',
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
function routeHandlerHasCspHeader(routeFile: string, pathMatcher: RegExp): { found: boolean; evidence: string } {
  const abs = path.join(repoRoot, routeFile);
  if (!fs.existsSync(abs)) return { found: false, evidence: `${routeFile}: absent` };
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
  if (!handlerBody) return { found: false, evidence: `${routeFile}: no app.get() handler matched ${pathMatcher}` };
  let found = false;
  let line = -1;
  function visit(node: TsNode): void {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const m = node.expression.name.text;
      const arg0 = node.arguments[0];
      if ((m === 'setHeader' || m === 'header') && arg0 && ts.isStringLiteral(arg0) && arg0.text === 'Content-Security-Policy') {
        found = true;
        line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(handlerBody);
  return { found, evidence: `${routeFile} (handler matching ${pathMatcher}): Content-Security-Policy header set=${found}${found ? ` (line ${line})` : ''}` };
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
  const rawRouteCsp = routeHandlerHasCspHeader('apps/daemon/src/routes/project/index.ts', /raw/);
  const liveArtifactRouteCsp = routeHandlerHasCspHeader('apps/daemon/src/routes/live-artifact.ts', /preview/);
  const cspOk = rawRouteCsp.found && liveArtifactRouteCsp.found;
  const nm35c = findNm35cThreatNote();
  const ok = nm35c.found && (!anyLiveFrame || (allFramesCorrect && cspOk));
  return {
    ok,
    evidence: `${rows.join('\n')}\nanyLiveFrame=${anyLiveFrame}\n${rawRouteCsp.evidence}\n${liveArtifactRouteCsp.evidence}\n${nm35c.evidence}`,
    detail: ok ? undefined : !nm35c.found ? 'no docs/security/*.md documents NM-35C with a recognizable deliberate allow-same-origin omission' : !allFramesCorrect ? 'a live iframe exists whose sandbox attribute does not match the frozen contract' : 'a live iframe is retained without the required Content-Security-Policy header on the route it loads',
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

const CONCURRENCY_CEILING = 12;
const N1 = ${n1};
const N2 = ${n2};
const FAIL_INDEX_2 = ${failIndex2};
const N3 = ${n3};

describe('C4-9 DesignsTab fan-out bound', () => {
  afterEach(() => { cleanup(); resetCounters(); });

  it('bounds concurrent fetchLiveArtifacts/fetchProjectFiles calls regardless of project count', async () => {
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

    await new Promise((r) => setTimeout(r, Math.max(500, DELAY_MS * 4)));

    appendResult('test1', { n1: N1, delayMs: DELAY_MS, peakLiveArtifacts, peakFiles, ceiling: CONCURRENCY_CEILING });

    expect(peakLiveArtifacts, 'fetchLiveArtifacts fan-out must be bounded, not one-shot-per-project').toBeLessThanOrEqual(CONCURRENCY_CEILING);
    expect(peakFiles, 'fetchProjectFiles fan-out must be bounded, not one-shot-per-project').toBeLessThanOrEqual(CONCURRENCY_CEILING);
    expect(peakLiveArtifacts, 'peak concurrency must not equal the full project count (that is the unbounded-fan-out bug)').not.toBe(N1);
  });

  it('does not blank the whole grid when a single project mid-page request fails, and proves the other requests completed', async () => {
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
    await new Promise((r) => setTimeout(r, Math.max(500, DELAY_MS * 4)));

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
    const { container } = render(
      <DesignsTab
        projects={makeProjects(N3)}
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
    await new Promise((r) => setTimeout(r, Math.max(500, DELAY_MS * 4)));
    const renderedCards = container.querySelectorAll('.design-card').length;
    appendResult('test3', { n3: N3, renderedCards });
    expect(renderedCards, 'a large project list must be paginated/virtualized, not render one .design-card per project').toBeLessThan(N3);
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

    // Bundle THIS root's REAL DesignsTab with a harness that mounts it
    // using the REAL (unmocked) registry.ts -- a genuine integration
    // measurement of real requests against a real daemon, not a unit test.
    const harnessSource = `import { createRoot } from 'react-dom/client';
import React from 'react';
import { DesignsTab } from './components/DesignsTab';
let root: ReturnType<typeof createRoot> | null = null;
(globalThis as any).__C410_MOUNT__ = () => {
  const el = document.getElementById('root');
  if (!el) return;
  if (!root) root = createRoot(el);
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
    const page = await browser.newPage();
    let inFlight = 0;
    let peakConcurrentRequests = 0;
    const daemonOrigin = daemon.url;
    page.on('request', (req) => { if (req.url().startsWith(daemonOrigin)) { inFlight++; if (inFlight > peakConcurrentRequests) peakConcurrentRequests = inFlight; } });
    page.on('requestfinished', (req) => { if (req.url().startsWith(daemonOrigin)) inFlight = Math.max(0, inFlight - 1); });
    page.on('requestfailed', (req) => { if (req.url().startsWith(daemonOrigin)) inFlight = Math.max(0, inFlight - 1); });

    await page.goto(`${daemon.url}/api/projects`, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => undefined);
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>', { waitUntil: 'domcontentloaded' });
    await page.evaluate((projects: unknown[]) => { (globalThis as unknown as { __C410_PROJECTS__: unknown[] }).__C410_PROJECTS__ = projects; }, sample);
    await page.addScriptTag({ content: bundledJs });

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

    const readinessMsSamples: number[] = [];
    // 1 discarded warmup + `reps` timed remounts (R8: warmup + >=5 reps).
    for (let i = -1; i < reps; i++) {
      const t0 = Date.now();
      await page.evaluate(() => { (globalThis as unknown as { __C410_MOUNT__: () => void }).__C410_MOUNT__(); });
      for (let poll = 0; poll < 60; poll++) {
        const count = await page.locator('.design-card').count();
        if (count >= sample.length) break;
        await sleep(100);
      }
      const elapsed = Date.now() - t0;
      if (i >= 0) readinessMsSamples.push(elapsed);
      await sleep(150);
    }

    pollAbort.abort();
    await poller;
    return { readinessMsSamples, peakConcurrentRequests, peakCombinedRssKb, projectCount: sample.length };
  } finally {
    try { fs.unlinkSync(harnessPath); } catch { /* best effort */ }
    if (browser) await browser.close().catch(() => undefined);
    if (daemon) await daemon.kill().catch(() => undefined);
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

    // Reviewed thresholds -- flagged in the authoring report for round-2
    // confirmation (same posture as C4-2's frozen geometry): readiness
    // must improve by >=15% at p50 and never regress past +10%; combined
    // RSS and peak concurrent requests (secondary axes here) must not
    // regress past +25%/+50% respectively.
    const MIN_IMPROVEMENT_PCT = 15;
    const REGRESSION_CEILING_PCT = 10;
    const improvementTargetMs = parentP50 * (1 - MIN_IMPROVEMENT_PCT / 100);
    const regressionCeilingMs = parentP50 * (1 + REGRESSION_CEILING_PCT / 100);
    const readinessImproved = headP50 <= improvementTargetMs;
    const readinessNotRegressed = headP50 <= regressionCeilingMs;
    const rssNotRegressed = headResult.peakCombinedRssKb <= parentResult.peakCombinedRssKb * 1.25;
    const requestCountNotRegressed = headResult.peakConcurrentRequests <= Math.max(parentResult.peakConcurrentRequests * 1.5, parentResult.peakConcurrentRequests + 5);
    const ok = readinessImproved && readinessNotRegressed && rssNotRegressed && requestCountNotRegressed;

    return {
      ok,
      evidence: `parent(${baseCommit.slice(0, 12)}, scratch corpus): readinessSamples=${JSON.stringify(parentResult.readinessMsSamples)} p50=${parentP50}ms p95=${parentP95}ms peakConcurrentRequests=${parentResult.peakConcurrentRequests} peakCombinedRssKb=${parentResult.peakCombinedRssKb} projectCount=${parentResult.projectCount}\nhead(${headSha.slice(0, 12)}, scratch corpus): readinessSamples=${JSON.stringify(headResult.readinessMsSamples)} p50=${headP50}ms p95=${headP95}ms peakConcurrentRequests=${headResult.peakConcurrentRequests} peakCombinedRssKb=${headResult.peakCombinedRssKb} projectCount=${headResult.projectCount}\nreadiness: minimumImprovementThreshold=${MIN_IMPROVEMENT_PCT}% (target<=${improvementTargetMs.toFixed(1)}ms) -> improved=${readinessImproved}; nonRegressionCeiling=${REGRESSION_CEILING_PCT}% (max<=${regressionCeilingMs.toFixed(1)}ms) -> notRegressed=${readinessNotRegressed}\npeak combined RSS non-regression (<=+25%): ${rssNotRegressed}\npeak concurrent requests non-regression: ${requestCountNotRegressed}`,
      detail: ok ? undefined : 'does not beat the parent commit by the stated minimum readiness margin without regressing RSS/request-concurrency past their ceilings',
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
// =========================================================================
interface CapabilityManifestRow { capability?: unknown; uiEntryPoint?: unknown; httpMethod?: unknown; httpPath?: unknown; outputSchema?: unknown; cliArgs?: unknown; parityApplicable?: unknown; knownNamespaceRoutes?: unknown }
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
  if (typeof row.httpPath === 'string' && !row.httpPath.includes('cover')) violations.push(`httpPath "${row.httpPath}" does not reference the frozen cover contract`);
  return { ok: violations.length === 0, evidence: `capability-manifest.json 'cover' row: ${JSON.stringify(row)}\nviolations: ${violations.join('; ') || 'none'}` };
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
    let daemon: BootedDaemon | undefined;
    try {
      daemon = await bootDaemonForProbing(dataDir);
      const projectId = `w4-c412-${crypto.randomBytes(6).toString('hex')}`;
      await createProject(daemon.url, projectId, projectId);
      await uploadProjectFile(daemon.url, projectId, 'index.html', '<!doctype html><html><body>cli parity</body></html>');

      // Verb 1: generate, through the CLI -- must drive the SAME
      // POST .../cover/generate the HTTP surface uses.
      const cliGenerate = odCli(['cover', 'generate', '--project', projectId, '--json'], odDataEnv(dataDir), 60_000);
      let cliGenerateParsed: unknown = null;
      try { const lines = cliGenerate.stdout.trim().split('\n').filter(Boolean); cliGenerateParsed = lines.length ? JSON.parse(lines[lines.length - 1] ?? '{}') : null; } catch { cliGenerateParsed = null; }
      const cliGenerateMentionsProject = cliGenerate.status === 0 && isRecord(cliGenerateParsed) && JSON.stringify(cliGenerateParsed).includes(projectId);

      // Verb 2: show/inspect, through the CLI -- must drive the SAME
      // GET .../cover the HTTP surface uses. Value-level identity check
      // (not a shape deep-equal -- CLI JSON and HTTP body are legitimately
      // different shapes): the project id must appear in the CLI's own
      // JSON output, and the HTTP surface must independently serve real
      // bytes for the same project.
      const httpGet = await getCover(daemon.url, projectId);
      const cliShow = odCli(['cover', 'show', '--project', projectId, '--json'], odDataEnv(dataDir), 60_000);
      let cliShowParsed: unknown = null;
      try { const lines = cliShow.stdout.trim().split('\n').filter(Boolean); cliShowParsed = lines.length ? JSON.parse(lines[lines.length - 1] ?? '{}') : null; } catch { cliShowParsed = null; }
      const cliShowMentionsProject = cliShow.status === 0 && isRecord(cliShowParsed) && JSON.stringify(cliShowParsed).includes(projectId);

      cliHttpParityOk = cliGenerateMentionsProject && cliShowMentionsProject && httpGet.ok && httpGet.bytes !== null && httpGet.bytes.length > 0;
      rows.push(`od cover generate --project <id> --json: exit=${cliGenerate.status} mentionsProjectId=${cliGenerateMentionsProject}\nod cover show --project <id> --json: exit=${cliShow.status} mentionsProjectId=${cliShowMentionsProject}\nHTTP GET cover: ok=${httpGet.ok} bytes=${httpGet.bytes?.length ?? 0}\nparity=${cliHttpParityOk}`);
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
    'C4-7', 'esbuild-bundle the REAL HtmlProjectCoverFrame from project-cover.tsx -> mount in a real Playwright Chromium page against a real daemon-served project referencing a real canary -> require an actual glyph render + assert zero canary hits; ALSO reproduce DesignsTab.tsx\'s separate live-artifact iframe (AST-extracted real sandbox literal) against the same tracker content',
    'the not-yet-rendered fallback is not network-capable on BOTH live-preview surfaces in the grid: a project HTML referencing a remote tracker produces NO outbound request on first card view, AND an empty/crashed render (no glyph) does not trivially pass (today: FAILS, HtmlProjectCoverFrame unconditionally mounts a live network-capable iframe once the file HEAD-verifies)',
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
    'C4-12', "SUBCOMMAND_MAP AST scan for the EXACT 'cover' key -> load+validate the AUTHORITATIVE scripts/waves/capability-manifest.json 'cover' row -> bespoke CLI<->HTTP behavioral parity probe exercising BOTH generate and show verbs -> pnpm guard -> pnpm typecheck",
    "od cover subcommand exists (exact key, not a decoy like 'coverage'), the authoritative capability manifest carries a valid 'cover' row, the CLI's generate AND show verbs agree on project identity with the HTTP surface (CLI calls the same endpoints, per AGENTS.md -- no import-closure reachability requirement), and pnpm guard + pnpm typecheck both exit 0",
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
