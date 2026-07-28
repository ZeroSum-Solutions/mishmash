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
// CONTRACT THIS VERIFIER DEFINES (class (b) criteria probe against these;
// the implementation builds to them -- see AUTHOR-FLAGGED AMBIGUITIES in the
// authoring report for what a reviewer should confirm or amend):
//   POST /api/projects/:id/cover/generate  -- SYNCHRONOUS: blocks until the
//     render job finishes (success, failure, or internal timeout) and
//     returns the final result in the response body. 2xx on success with
//     JSON body `{ ok: true, cover: { path, sha256, width, height } }`
//     (all optional beyond an ok:true envelope -- this verifier discovers
//     the real on-disk artifact by diffing RUNTIME_DATA_DIR rather than
//     trusting response fields, per VERIFICATION-CONTRACT R2's "observe,
//     never trust" spirit). Non-2xx on failure/timeout/OOM.
//   GET  /api/projects/:id/cover            -- raw image bytes, 200 if a
//     cover has been generated, 404 otherwise.
// Route discovery prefers whatever the booted daemon's routeInventory
// actually reports (any GET/POST path containing "cover" under
// /api/projects/:id/...) and falls back to the literal paths above only
// when nothing matches -- the daemon's OWN route-registration guard is the
// ground truth wherever it can see it (string-literal Express paths only;
// regex-registered routes, like the existing /raw/ file route, are invisible
// to it, matching the existing daemon's own pattern for that route).
//
// GATE-INTEGRITY / LEASE / HEAD-DRIFT follow the verify-w0.ts precedent
// exactly, including reading leases.json AT baseCommit via `git show`
// (never the working tree) -- a working-tree read was REJECTED in W2's
// review as a defect class this file must not repeat.

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
function localImportSpecifiers(absPath: string): string[] {
  const { sourceFile } = parseTs(absPath);
  const specs: string[] = [];
  function visit(node: TsNode): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (spec.startsWith('.')) specs.push(spec);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specs;
}
function resolveLocalImport(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) if (fs.existsSync(candidate)) return candidate;
  return null;
}
function transitiveLocalImportClosure(entry: string): string[] {
  const reachable = new Set<string>([entry]);
  const queue: string[] = [entry];
  const MAX_FILES = 300;
  while (queue.length > 0 && reachable.size < MAX_FILES) {
    const current = queue.shift()!;
    for (const spec of localImportSpecifiers(current)) {
      const resolved = resolveLocalImport(current, spec);
      if (resolved && !reachable.has(resolved)) {
        reachable.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return [...reachable];
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
// Mirrors verify-w0.ts's findSubcommandHandlerEntryPoint, generalized to any
// SUBCOMMAND_MAP key pattern.
function findSubcommandHandlerEntryPoint(cliPath: string, subcommandNamePattern: RegExp): string | null {
  if (!fs.existsSync(cliPath)) return null;
  const { sourceFile } = parseTs(cliPath);
  let handlerIdentifier: string | null = null;
  function visitMap(node: TsNode): void {
    if (handlerIdentifier) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'SUBCOMMAND_MAP' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const prop of node.initializer.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer)) {
          const key = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : '';
          if (subcommandNamePattern.test(key)) { handlerIdentifier = prop.initializer.text; return; }
        }
      }
    }
    ts.forEachChild(node, visitMap);
  }
  visitMap(sourceFile);
  if (!handlerIdentifier) return null;
  let importedFrom: string | null = null;
  function visitImports(node: TsNode): void {
    if (importedFrom) return;
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && ts.isStringLiteral(node.moduleSpecifier)) {
      for (const el of node.importClause.namedBindings.elements) {
        if (el.name.text === handlerIdentifier) { importedFrom = node.moduleSpecifier.text; return; }
      }
    }
    ts.forEachChild(node, visitImports);
  }
  visitImports(sourceFile);
  const resolvedImportedFrom = importedFrom as string | null;
  if (resolvedImportedFrom && resolvedImportedFrom.startsWith('.')) return resolveLocalImport(cliPath, resolvedImportedFrom);
  return cliPath;
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
async function bootDaemonForProbing(dataDir?: string): Promise<BootedDaemon> {
  const useDataDir = dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-verify-'));
  const bootScript = `
import path from 'node:path';
import { pathToFileURL } from 'node:url';
process.env.OD_DATA_DIR = ${JSON.stringify(useDataDir)};
process.env.OD_DAEMON_CLI_PATH = ${JSON.stringify(path.join(repoRoot, 'apps/daemon/dist/cli.js'))};
const mod = await import(pathToFileURL(${JSON.stringify(path.join(repoRoot, 'apps/daemon/src/server.ts'))}).href);
const started = await mod.startServer({ port: 0, returnServer: true });
console.log('OD_W4_VERIFIER_READY ' + JSON.stringify({ url: started.url, routeInventory: started.routeInventory }));
process.on('SIGTERM', async () => { await started.shutdown(); process.exit(0); });
`;
  const scriptPath = path.join(proofDir, `.boot-daemon.${process.pid}.${crypto.randomBytes(3).toString('hex')}.mjs`);
  fs.writeFileSync(scriptPath, bootScript);
  const child = spawn('pnpm', ['exec', 'tsx', scriptPath], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
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

// Discover the generate/fetch cover routes from a live daemon's own route
// inventory (string-literal Express paths only), falling back to this
// verifier's documented contract when nothing is discoverable.
function discoverCoverRoutes(routeInventory: RouteRegistration[]): { generatePath: string; fetchPath: string; discovered: boolean } {
  const coverRoutes = routeInventory.filter((r) => /cover/i.test(r.path) && /projects/i.test(r.path));
  const generate = coverRoutes.find((r) => r.method === 'POST' && /generate/i.test(r.path));
  const fetchRoute = coverRoutes.find((r) => r.method === 'GET' && !/generate|status/i.test(r.path));
  return {
    generatePath: generate ? generate.path : '/api/projects/:id/cover/generate',
    fetchPath: fetchRoute ? fetchRoute.path : '/api/projects/:id/cover',
    discovered: Boolean(generate && fetchRoute),
  };
}
function fillPath(template: string, id: string): string {
  return template.replace(':id', encodeURIComponent(id)).replace(':param', encodeURIComponent(id));
}

// =========================================================================
// C4-1 -- covers persist and survive restart
// =========================================================================
async function checkC41(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  if (!coverBackendSurface().present) return backendGateFailure();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c41-'));
  let daemonA: BootedDaemon | undefined;
  let daemonB: BootedDaemon | undefined;
  try {
    daemonA = await bootDaemonForProbing(dataDir);
    const routes = discoverCoverRoutes(daemonA.routeInventory);
    const projectId = `w4-c41-${crypto.randomBytes(6).toString('hex')}`;
    await createProject(daemonA.url, projectId, projectId);
    await uploadProjectFile(daemonA.url, projectId, 'index.html', '<!doctype html><html><body><h1 style="background:#4477ff;width:100%;height:400px">Hero</h1></body></html>');

    const beforeTree = walkDataDir(dataDir);
    const genResp = await fetch(`${daemonA.url}${fillPath(routes.generatePath, projectId)}`, { method: 'POST', signal: AbortSignal.timeout(30_000) });
    if (!genResp.ok) return { ok: false, evidence: `generate call failed: ${genResp.status} ${await genResp.text().catch(() => '')}`, detail: 'cover generation did not succeed on a valid fixture' };
    const afterTree = walkDataDir(dataDir);
    const newFiles = newFilesSince(beforeTree, afterTree).filter((f) => path.resolve(f).startsWith(path.resolve(dataDir)));
    if (newFiles.length === 0) return { ok: false, evidence: 'no new file appeared under OD_DATA_DIR after cover generation', detail: 'cannot locate the on-disk cover artifact' };

    const getResp1 = await fetch(`${daemonA.url}${fillPath(routes.fetchPath, projectId)}`, { signal: AbortSignal.timeout(15_000) });
    if (!getResp1.ok) return { ok: false, evidence: `GET cover before restart failed: ${getResp1.status}`, detail: 'cover route did not serve the just-generated cover' };
    const bytesBefore = Buffer.from(await getResp1.arrayBuffer());
    const shaBefore = sha256Bytes(bytesBefore);
    const artifactStatsBefore = newFiles.map((f) => ({ f, stat: fs.statSync(f), sha: sha256File(f) }));

    await daemonA.kill();
    daemonA = undefined;

    daemonB = await bootDaemonForProbing(dataDir);
    const getResp2 = await fetch(`${daemonB.url}${fillPath(routes.fetchPath, projectId)}`, { signal: AbortSignal.timeout(15_000) });
    if (!getResp2.ok) return { ok: false, evidence: `GET cover after restart failed: ${getResp2.status}`, detail: 'stored cover did not survive restart' };
    const bytesAfter = Buffer.from(await getResp2.arrayBuffer());
    const shaAfter = sha256Bytes(bytesAfter);

    const artifactStatsAfter = artifactStatsBefore.map(({ f }) => ({ f, stat: fs.statSync(f), sha: sha256File(f) }));
    const noRewrite = artifactStatsBefore.every((b, i) => {
      const a = artifactStatsAfter[i];
      return a && a.stat.mtimeMs === b.stat.mtimeMs && a.sha === b.sha;
    });

    const ok = shaBefore === shaAfter && noRewrite;
    return {
      ok,
      evidence: `newFilesDiscovered=${JSON.stringify(newFiles)}\nshaBefore=${shaBefore}\nshaAfter=${shaAfter}\nonDiskMtimeUnchanged=${noRewrite}\n(artifact mtimes before: ${JSON.stringify(artifactStatsBefore.map((s) => s.stat.mtimeMs))}, after: ${JSON.stringify(artifactStatsAfter.map((s) => s.stat.mtimeMs))})`,
      detail: ok ? undefined : 'card must render the stored cover after restart WITHOUT re-rendering -- either bytes changed or the on-disk artifact was rewritten',
    };
  } finally {
    if (daemonA) await daemonA.kill().catch(() => undefined);
    if (daemonB) await daemonB.kill().catch(() => undefined);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// =========================================================================
// C4-2 -- crop favors the hero on adversarial fixtures
// =========================================================================
// No @types/sharp is reachable from scripts/tsconfig.json (sharp is only a
// transitive dependency, resolved by directory scan below) -- a minimal
// structural interface covering the handful of calls this file makes.
interface MinimalSharpInstance {
  ensureAlpha(): MinimalSharpInstance;
  raw(): MinimalSharpInstance;
  toBuffer(opts: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number; channels: number } }>;
}
type MinimalSharpFactory = (input: Buffer) => MinimalSharpInstance;
function resolveSharp(): MinimalSharpFactory {
  const pnpmDir = path.join(repoRoot, 'node_modules/.pnpm');
  const dirName = fs.readdirSync(pnpmDir).filter((d) => d.startsWith('sharp@')).sort()[0];
  if (!dirName) throw new Error('sharp not found under node_modules/.pnpm -- expected as a transitive dependency (S4-3)');
  return createRequire(path.join(repoRoot, 'package.json'))(path.join(pnpmDir, dirName, 'node_modules/sharp')) as MinimalSharpFactory;
}
const MARKER_PALETTE = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
const BACKGROUND_COLOR = '#808080';
function heroGridHtml(heroLeftPct: number, heroTopPct: number, heroWidthPct: number, heroHeightPct: number, cellPx = 8): string {
  const cells: string[] = [];
  for (let i = 0; i < 400; i++) {
    const color = MARKER_PALETTE[i % MARKER_PALETTE.length];
    cells.push(`<div style="width:${cellPx}px;height:${cellPx}px;background:${color};display:inline-block"></div>`);
  }
  return `<!doctype html><html><body style="margin:0;padding:0;background:${BACKGROUND_COLOR};width:100vw;height:100vh;overflow:hidden">
<div style="position:absolute;left:${heroLeftPct}%;top:${heroTopPct}%;width:${heroWidthPct}%;height:${heroHeightPct}%;overflow:hidden;line-height:0">${cells.join('')}</div>
</body></html>`;
}
function fractionMarkerPixels(png: { data: Buffer; info: { width: number; height: number; channels: number } }): number {
  const { data, info } = png;
  let markerCount = 0;
  let total = 0;
  const markerRgb = MARKER_PALETTE.map((hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
  for (let i = 0; i + info.channels <= data.length; i += info.channels) {
    total++;
    const r = data[i] ?? 0, g = data[i + 1] ?? 0, b = data[i + 2] ?? 0;
    if (markerRgb.some(([mr, mg, mb]) => Math.abs(r - (mr ?? 0)) < 30 && Math.abs(g - (mg ?? 0)) < 30 && Math.abs(b - (mb ?? 0)) < 30)) markerCount++;
  }
  return total === 0 ? 0 : markerCount / total;
}
async function generateCoverAndDecode(daemon: BootedDaemon, routes: { generatePath: string; fetchPath: string }, projectId: string, html: string): Promise<{ fraction: number } | { error: string }> {
  await createProject(daemon.url, projectId, projectId);
  await uploadProjectFile(daemon.url, projectId, 'index.html', html);
  const genResp = await fetch(`${daemon.url}${fillPath(routes.generatePath, projectId)}`, { method: 'POST', signal: AbortSignal.timeout(30_000) });
  if (!genResp.ok) return { error: `generate failed: ${genResp.status}` };
  const getResp = await fetch(`${daemon.url}${fillPath(routes.fetchPath, projectId)}`, { signal: AbortSignal.timeout(15_000) });
  if (!getResp.ok) return { error: `fetch cover failed: ${getResp.status}` };
  const bytes = Buffer.from(await getResp.arrayBuffer());
  const sharp = resolveSharp();
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { fraction: fractionMarkerPixels({ data, info: { width: info.width, height: info.height, channels: info.channels } }) };
}
async function checkC42(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  if (!coverBackendSurface().present) return backendGateFailure();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c42-'));
  let daemon: BootedDaemon | undefined;
  try {
    daemon = await bootDaemonForProbing(dataDir);
    const routes = discoverCoverRoutes(daemon.routeInventory);
    // Fixtures: small off-center hero ("basic"), hero behind a left-nav
    // strip, dark-background hero, and a trivial hero-fills-frame control.
    const fixtures = [
      { name: 'off-center-small-hero', html: heroGridHtml(60, 60, 30, 30), minFraction: 0.35 },
      { name: 'left-nav-hero', html: `<!doctype html><html><body style="margin:0;background:#222;width:100vw;height:100vh"><div style="position:absolute;left:0;top:0;width:20%;height:100%;background:#333"></div>${heroGridHtml(55, 45, 35, 40).replace(/<html><body[^>]*>/, '').replace('</body></html>', '')}</body></html>`, minFraction: 0.3 },
      { name: 'dark-hero', html: `<!doctype html><html><body style="margin:0;background:#050505;width:100vw;height:100vh">${heroGridHtml(50, 55, 35, 35).replace(/<html><body[^>]*>/, '').replace('</body></html>', '')}</body></html>`, minFraction: 0.3 },
      { name: 'hero-fills-frame', html: heroGridHtml(0, 0, 100, 100), minFraction: 0.6 },
    ];
    const outcomes: string[] = [];
    let allPass = true;
    for (const fixture of fixtures) {
      const projectId = `w4-c42-${fixture.name}-${crypto.randomBytes(4).toString('hex')}`;
      const result = await generateCoverAndDecode(daemon, routes, projectId, fixture.html);
      if ('error' in result) {
        allPass = false;
        outcomes.push(`${fixture.name}: FAIL (${result.error})`);
        continue;
      }
      const pass = result.fraction >= fixture.minFraction;
      if (!pass) allPass = false;
      outcomes.push(`${fixture.name}: markerFraction=${result.fraction.toFixed(3)} minRequired=${fixture.minFraction} -> ${pass ? 'PASS' : 'FAIL'}`);
    }
    return { ok: allPass, evidence: outcomes.join('\n'), detail: allPass ? undefined : 'crop did not favor the marker-grid hero region on one or more adversarial fixtures' };
  } finally {
    if (daemon) await daemon.kill().catch(() => undefined);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// =========================================================================
// C4-3 / C4-4 -- invalidation: transitive render graph, content-driven not
// mtime-driven.
// =========================================================================
async function pollCoverHash(daemon: BootedDaemon, fetchPathTemplate: string, projectId: string, attempts: number, delayMs: number): Promise<string | null> {
  let last: string | null = null;
  for (let i = 0; i < attempts; i++) {
    const resp = await fetch(`${daemon.url}${fillPath(fetchPathTemplate, projectId)}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (resp?.ok) last = sha256Bytes(Buffer.from(await resp.arrayBuffer()));
    if (i < attempts - 1) await sleep(delayMs);
  }
  return last;
}
async function triggerRegeneration(daemon: BootedDaemon, routes: { generatePath: string; fetchPath: string }, projectId: string): Promise<string | null> {
  // Accommodate both "regenerate-on-view" (GET alone reflects new content
  // after a short poll) and "explicit regenerate" designs (an extra POST is
  // required) -- S4-4 explicitly allows either.
  const viewHash = await pollCoverHash(daemon, routes.fetchPath, projectId, 3, 800);
  const genResp = await fetch(`${daemon.url}${fillPath(routes.generatePath, projectId)}`, { method: 'POST', signal: AbortSignal.timeout(30_000) }).catch(() => null);
  void genResp;
  return pollCoverHash(daemon, routes.fetchPath, projectId, 3, 500) ?? viewHash;
}
async function checkC43and44(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  if (!coverBackendSurface().present) return backendGateFailure();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c34-'));
  let daemon: BootedDaemon | undefined;
  try {
    daemon = await bootDaemonForProbing(dataDir);
    const routes = discoverCoverRoutes(daemon.routeInventory);
    const projectId = `w4-c34-${crypto.randomBytes(6).toString('hex')}`;
    const htmlV1 = '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><div class="hero">v1</div></body></html>';
    const cssV1 = '.hero{background:#101010;width:100%;height:300px}';
    await createProject(daemon.url, projectId, projectId);
    await uploadProjectFile(daemon.url, projectId, 'index.html', htmlV1);
    await uploadProjectFile(daemon.url, projectId, 'styles.css', cssV1, 'text/css');

    const genResp = await fetch(`${daemon.url}${fillPath(routes.generatePath, projectId)}`, { method: 'POST', signal: AbortSignal.timeout(30_000) });
    if (!genResp.ok) return { ok: false, evidence: `initial generate failed: ${genResp.status}`, detail: 'cannot establish a baseline cover to invalidate' };
    const h1 = await pollCoverHash(daemon, routes.fetchPath, projectId, 1, 0);
    if (!h1) return { ok: false, evidence: 'no baseline cover hash obtained', detail: 'GET cover failed after generation' };

    const indexAbs = (() => {
      const before = walkDataDir(dataDir);
      void before;
      return null;
    })();
    void indexAbs;

    // --- C4-4a: mtime touch WITHOUT byte change must NOT regenerate. ---
    // We cannot directly touch the daemon's on-disk copy without knowing its
    // storage layout, so we exercise this at the API layer the daemon
    // actually accepts: re-uploading byte-identical content. A correct
    // content-hash design must treat this as unchanged regardless of the
    // resulting mtime.
    await uploadProjectFile(daemon.url, projectId, 'index.html', htmlV1);
    const h2 = await triggerRegeneration(daemon, routes, projectId);
    const c44a = h2 === h1;

    // --- C4-4b: byte change must regenerate (paired positive control). ---
    const htmlV2 = htmlV1.replace('v1', 'v2-content-changed');
    await uploadProjectFile(daemon.url, projectId, 'index.html', htmlV2);
    const h3 = await triggerRegeneration(daemon, routes, projectId);
    const c44b = h3 !== null && h3 !== h2;

    // --- C4-3: TRANSITIVE invalidation -- edit ONLY the linked CSS, leave
    // index.html completely untouched. Must still regenerate. This is the
    // exact S4-5 "entry-hash-only serves stale covers" failure mode.
    const cssV2 = cssV1.replace('#101010', '#e00000');
    await uploadProjectFile(daemon.url, projectId, 'styles.css', cssV2, 'text/css');
    const h4 = await triggerRegeneration(daemon, routes, projectId);
    const c43css = h4 !== null && h4 !== h3;

    // --- C4-3 (image leg): edit a linked local image, leave HTML+CSS alone.
    const htmlV3 = htmlV2.replace('</body>', '<img src="hero.png"></body>');
    await uploadProjectFile(daemon.url, projectId, 'index.html', htmlV3);
    await uploadProjectFile(daemon.url, projectId, 'hero.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]), 'image/png');
    const h5 = await triggerRegeneration(daemon, routes, projectId);
    await uploadProjectFile(daemon.url, projectId, 'hero.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]), 'image/png');
    const h6 = await triggerRegeneration(daemon, routes, projectId);
    const c43img = h6 !== null && h6 !== h5;

    const ok = c44a && c44b && c43css && c43img;
    return {
      ok,
      evidence: `h1=${h1} h2(mtime-touch-no-byte-change)=${h2} h3(byte-change)=${h3} h4(css-only-edit)=${h4} h5(before-img-edit)=${h5} h6(after-img-edit)=${h6}\nC4-4a(mtime-only-must-NOT-regen)=${c44a}\nC4-4b(byte-change-must-regen)=${c44b}\nC4-3-css(transitive-css-must-regen)=${c43css}\nC4-3-img(transitive-image-must-regen)=${c43img}`,
      detail: ok ? undefined : 'invalidation is not both transitive (CSS/image edits regenerate) and content-driven (byte-identical re-upload does not regenerate, real byte changes do)',
    };
  } finally {
    if (daemon) await daemon.kill().catch(() => undefined);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// =========================================================================
// C4-5 -- renderer is bounded (concurrency cap, per-job timeout, memory
// ceiling), including a deliberately pathological project.
// =========================================================================
function blockingScriptHtml(blockMs: number): string {
  return `<!doctype html><html><body><script>const s=Date.now();while(Date.now()-s<${blockMs}){}</script><div>blocked ${blockMs}ms</div></body></html>`;
}
const INFINITE_LOOP_HTML = '<!doctype html><html><body><script>while(true){}</script></body></html>';
const MEMORY_HOG_HTML = '<!doctype html><html><body><script>let a=[];while(true){a.push(new Array(2000000).fill(7));}</script></body></html>';

async function checkC45(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  if (!coverBackendSurface().present) return backendGateFailure();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c45-'));
  let daemon: BootedDaemon | undefined;
  try {
    daemon = await bootDaemonForProbing(dataDir);
    const routes = discoverCoverRoutes(daemon.routeInventory);
    const rows: string[] = [];

    // --- (a) per-job timeout: an infinite-loop project must not hang the
    // generate call forever; it must resolve (fail/timeout) within a
    // generous bound. ---
    const timeoutProjectId = `w4-c45-timeout-${crypto.randomBytes(4).toString('hex')}`;
    await createProject(daemon.url, timeoutProjectId, timeoutProjectId);
    await uploadProjectFile(daemon.url, timeoutProjectId, 'index.html', INFINITE_LOOP_HTML);
    const timeoutStart = Date.now();
    let timeoutResolved = false;
    let timeoutStatus = -1;
    try {
      const resp = await fetch(`${daemon.url}${fillPath(routes.generatePath, timeoutProjectId)}`, { method: 'POST', signal: AbortSignal.timeout(90_000) });
      timeoutResolved = true;
      timeoutStatus = resp.status;
    } catch (err) {
      rows.push(`timeout-probe fetch aborted/errored: ${String(err)}`);
    }
    const timeoutElapsed = Date.now() - timeoutStart;
    const perJobTimeoutOk = timeoutResolved && timeoutStatus >= 400 && timeoutElapsed < 90_000;
    rows.push(`per-job-timeout: resolved=${timeoutResolved} status=${timeoutStatus} elapsedMs=${timeoutElapsed} -> ${perJobTimeoutOk ? 'PASS' : 'FAIL'}`);

    // --- (b) concurrency cap: submit M jobs concurrently, each artificially
    // slow; the observed max overlap must be strictly less than M (proving
    // SOME cap exists, implementation-agnostic about its exact value). ---
    const M = 8;
    const BLOCK_MS = 1200;
    const concProjectIds = Array.from({ length: M }, (_, i) => `w4-c45-conc-${i}-${crypto.randomBytes(3).toString('hex')}`);
    for (const id of concProjectIds) {
      await createProject(daemon.url, id, id);
      await uploadProjectFile(daemon.url, id, 'index.html', blockingScriptHtml(BLOCK_MS));
    }
    const intervals: { start: number; end: number }[] = [];
    await Promise.all(concProjectIds.map(async (id) => {
      const start = Date.now();
      await fetch(`${daemon!.url}${fillPath(routes.generatePath, id)}`, { method: 'POST', signal: AbortSignal.timeout(60_000) }).catch(() => undefined);
      intervals.push({ start, end: Date.now() });
    }));
    let maxOverlap = 0;
    for (const a of intervals) {
      const overlapping = intervals.filter((b) => a.start < b.end && b.start < a.end).length;
      if (overlapping > maxOverlap) maxOverlap = overlapping;
    }
    const concurrencyOk = maxOverlap > 0 && maxOverlap < M;
    rows.push(`concurrency-cap: M=${M} maxObservedOverlap=${maxOverlap} intervals=${JSON.stringify(intervals)} -> ${concurrencyOk ? 'PASS' : 'FAIL'}`);

    // --- (c) memory ceiling: a memory-hog project must not be allowed to
    // grow unbounded; the job must ultimately fail, and peak sampled RSS of
    // any daemon-descendant process must stay under a generous outer
    // ceiling (proving SOME ceiling is enforced, not the exact number). ---
    const memProjectId = `w4-c45-mem-${crypto.randomBytes(4).toString('hex')}`;
    await createProject(daemon.url, memProjectId, memProjectId);
    await uploadProjectFile(daemon.url, memProjectId, 'index.html', MEMORY_HOG_HTML);
    const MEMORY_CEILING_KB = 3 * 1024 * 1024; // 3 GB outer sane bound
    let peakRssKb = 0;
    let memResolved = false;
    let memStatus = -1;
    const rootPid = daemon.pid;
    const pollAbort = new AbortController();
    const poller = (async () => {
      while (!pollAbort.signal.aborted) {
        if (rootPid) {
          const rows2 = psSnapshot();
          const desc = descendantsOf(rootPid, rows2);
          for (const r of rows2) if (desc.has(r.pid) && r.rssKb > peakRssKb) peakRssKb = r.rssKb;
        }
        await sleep(500);
      }
    })();
    try {
      const resp = await fetch(`${daemon.url}${fillPath(routes.generatePath, memProjectId)}`, { method: 'POST', signal: AbortSignal.timeout(60_000) });
      memResolved = true;
      memStatus = resp.status;
    } catch (err) {
      rows.push(`memory-probe fetch aborted/errored: ${String(err)}`);
    } finally {
      pollAbort.abort();
      await poller;
    }
    const memoryOk = memResolved && memStatus >= 400 && peakRssKb < MEMORY_CEILING_KB;
    rows.push(`memory-ceiling: resolved=${memResolved} status=${memStatus} peakDescendantRssKb=${peakRssKb} ceilingKb=${MEMORY_CEILING_KB} -> ${memoryOk ? 'PASS' : 'FAIL'}`);

    const ok = perJobTimeoutOk && concurrencyOk && memoryOk;
    return { ok, evidence: rows.join('\n'), detail: ok ? undefined : 'renderer is not fully bounded (timeout / concurrency cap / memory ceiling)' };
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
      const routes = discoverCoverRoutes(daemon.routeInventory);
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
      const genResp = await fetch(`${daemon.url}${fillPath(routes.generatePath, projectId)}`, { method: 'POST', signal: AbortSignal.timeout(60_000) }).catch((err) => {
        throw new Error(`generate call errored: ${String(err)}`);
      });
      await sleep(3000); // grace period for delayed/async egress attempts
      const hitsAfter = canary.hits.length;
      const jobRan = genResp !== undefined;
      const ok = jobRan && hitsAfter === hitsBefore;
      return {
        ok,
        evidence: `render job responded: status=${genResp?.status}\ncanary hits before=${hitsBefore} after=${hitsAfter}\nhits detail=${JSON.stringify(canary.hits.slice(hitsBefore))}`,
        detail: ok ? undefined : 'the renderer reached the canary (or never ran at all) -- process-level network denial is not proven',
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
interface MinimalPwPage {
  on(event: 'pageerror', cb: (err: Error) => void): void;
  on(event: 'console', cb: (msg: { type(): string; text(): string }) => void): void;
  goto(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  setContent(html: string, opts?: Record<string, unknown>): Promise<void>;
  evaluate<T>(fn: (...args: never[]) => T, arg?: unknown): Promise<T>;
  addScriptTag(opts: { content: string }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  locator(selector: string): MinimalPwLocator;
}
interface MinimalPwBrowser { newPage(): Promise<MinimalPwPage>; close(): Promise<void> }
interface MinimalPwBrowserType { launch(opts?: Record<string, unknown>): Promise<MinimalPwBrowser> }
function resolvePlaywright(): { chromium: MinimalPwBrowserType } {
  return createRequire(path.join(repoRoot, 'e2e/package.json'))('@playwright/test') as { chromium: MinimalPwBrowserType };
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

    const ok = mounted && hitsAfter === hitsBefore;
    return {
      ok,
      evidence: `mounted=${mounted}\nglyphRendered(count)=${glyphCount}\nliveIframeRendered(count)=${iframeCount}\ncanary hits before=${hitsBefore} after=${hitsAfter}\npageErrors=${JSON.stringify(pageErrors.slice(0, 5))}`,
      detail: ok
        ? undefined
        : iframeCount > 0
          ? 'a live network-capable iframe is present for the not-yet-rendered state and it reached the canary -- S4-5 requires a static glyph/skeleton (or a CSP-hardened frame proven not to leak, see C4-8)'
          : 'component did not mount as expected, or canary was reached through an unexpected path',
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
  // NM-35C threat note: search docs/security for the frozen contract
  // documentation (mirrors how other NM-*C notes live under docs/security
  // per the repo's existing convention).
  const securityDir = path.join(repoRoot, 'docs/security');
  let nm35cDocFound = false;
  let nm35cDocPath = '';
  if (fs.existsSync(securityDir)) {
    for (const f of fs.readdirSync(securityDir, { recursive: true } as unknown as fs.ObjectEncodingOptions & { recursive: boolean })) {
      const rel = String(f);
      if (!rel.endsWith('.md') && !rel.endsWith('.json')) continue;
      const abs = path.join(securityDir, rel);
      if (!fs.statSync(abs).isFile()) continue;
      const content = fs.readFileSync(abs, 'utf8');
      if (/NM-35C/.test(content) && /allow-same-origin/.test(content)) { nm35cDocFound = true; nm35cDocPath = rel; break; }
    }
  }
  const ok = nm35cDocFound && (!anyLiveFrame || allFramesCorrect);
  return {
    ok,
    evidence: `${rows.join('\n')}\nanyLiveFrame=${anyLiveFrame}\nNM-35C threat note found=${nm35cDocFound}${nm35cDocPath ? ` (docs/security/${nm35cDocPath})` : ''}`,
    detail: ok ? undefined : !nm35cDocFound ? 'no docs/security/*.md documents NM-35C with the deliberate allow-same-origin omission' : 'a live iframe exists whose sandbox attribute does not match the frozen contract',
  };
}

// =========================================================================
// C4-9 -- DesignsTab fan-out is bounded. RUNS TODAY against the real
// component via a TEMPORARY vitest spec (deleted before this run's
// treeDirty check, mirroring the temp-worktree teardown pattern in
// verify-w0.ts).
// =========================================================================
async function checkC49(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  const specPath = path.join(repoRoot, `apps/web/tests/components/.verify-w4-c4-9-fanout.${process.pid}.test.tsx`);
  const outFile = path.join(proofDir, `c4-9-vitest-run.${process.pid}.json`);
  const specSource = `// TEMPORARY -- written and deleted by scripts/waves/verify-w4.ts (C4-9).
// Not a committed test file; if you are reading this in the repo, the
// verifier crashed before cleanup -- safe to delete.
// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignsTab } from '../../src/components/DesignsTab';
import type { Project } from '../../src/types';

let concurrentLiveArtifacts = 0;
let peakLiveArtifacts = 0;
let concurrentFiles = 0;
let peakFiles = 0;
const FAIL_PROJECT_ID = 'project-2';

vi.mock('../../src/providers/registry', () => ({
  deleteLiveArtifact: vi.fn(),
  fetchLiveArtifacts: vi.fn(async (projectId: string) => {
    concurrentLiveArtifacts++;
    peakLiveArtifacts = Math.max(peakLiveArtifacts, concurrentLiveArtifacts);
    await new Promise((r) => setTimeout(r, 30));
    concurrentLiveArtifacts--;
    if (projectId === FAIL_PROJECT_ID) throw new Error('simulated mid-page failure');
    return [];
  }),
  fetchProjectFiles: vi.fn(async (projectId: string) => {
    concurrentFiles++;
    peakFiles = Math.max(peakFiles, concurrentFiles);
    await new Promise((r) => setTimeout(r, 30));
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

describe('C4-9 DesignsTab fan-out bound', () => {
  afterEach(() => { cleanup(); concurrentLiveArtifacts = 0; concurrentFiles = 0; });

  it('bounds concurrent fetchLiveArtifacts/fetchProjectFiles calls regardless of project count, and isolates a mid-page failure', async () => {
    const CONCURRENCY_CEILING = 12;
    render(
      <DesignsTab
        projects={makeProjects(40)}
        skills={[]}
        designSystems={[]}
        onOpen={vi.fn()}
        onOpenLiveArtifact={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        isActive={false}
      />,
    );

    await waitFor(() => {
      expect(peakLiveArtifacts).toBeGreaterThan(0);
      expect(peakFiles).toBeGreaterThan(0);
    }, { timeout: 5000 });

    await new Promise((r) => setTimeout(r, 500));

    expect(peakLiveArtifacts, 'fetchLiveArtifacts fan-out must be bounded, not one-shot-per-project').toBeLessThanOrEqual(CONCURRENCY_CEILING);
    expect(peakFiles, 'fetchProjectFiles fan-out must be bounded, not one-shot-per-project').toBeLessThanOrEqual(CONCURRENCY_CEILING);
    expect(peakLiveArtifacts, 'peak concurrency must not equal the full project count (that is the unbounded-fan-out bug)').not.toBe(40);
  });

  it('does not blank the whole grid when a single project mid-page request fails', async () => {
    const onOpen = vi.fn();
    render(
      <DesignsTab
        projects={makeProjects(5)}
        skills={[]}
        designSystems={[]}
        onOpen={onOpen}
        onOpenLiveArtifact={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
        isActive={false}
      />,
    );
    await waitFor(() => {
      expect(peakFiles).toBeGreaterThan(0);
    }, { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 500));
    // FAIL_PROJECT_ID ('project-2') genuinely exists in this 5-project set,
    // so fetchLiveArtifacts really does reject mid-batch here. The other 4
    // (non-failing) projects' names must still render -- proving a single
    // rejection does not tear down the whole render tree. document.body
    // having content for every project name is the closest DOM-observable
    // proxy available without reaching into component internals.
    for (let i = 0; i < 5; i++) {
      expect(document.body.textContent).toContain(\`Project \${i}\`);
    }
  });
});
`;
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, specSource);
  try {
    const run = sh('pnpm', ['--filter', '@open-design/web', 'exec', 'vitest', 'run', '-c', 'vitest.config.ts', '--reporter=json', `--outputFile=${outFile}`, path.relative(path.join(repoRoot, 'apps/web'), specPath)], { timeoutMs: 3 * 60_000 });
    let parsed: { numFailedTests?: number; numPassedTests?: number; testResults?: unknown } | null = null;
    try { parsed = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { parsed = null; }
    const ok = run.status === 0 && parsed !== null && (parsed.numFailedTests ?? 1) === 0 && (parsed.numPassedTests ?? 0) >= 2;
    return {
      ok,
      evidence: `vitest exit=${run.status}\nparsed summary: numPassed=${parsed?.numPassedTests} numFailed=${parsed?.numFailedTests}\nstdout tail:\n${run.stdout.slice(-3000)}\nstderr tail:\n${run.stderr.slice(-2000)}`,
      detail: ok ? undefined : "DesignsTab's fan-out is not bounded (today's known unbounded Promise.all), or per-item failure isolation is broken",
    };
  } finally {
    try { fs.unlinkSync(specPath); } catch { /* already clean */ }
    try { fs.unlinkSync(outFile); } catch { /* best effort */ }
  }
}

// =========================================================================
// C4-10 -- measurably better under the R8 protocol, same corpus/machine as
// scale-baseline-2026-07. Gated fast on the backend surface today (nothing
// to measure pre-implementation); the full R8 harness below is real and
// runs the first time a cover backend exists.
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
async function checkC410(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  const baselinePath = path.join(repoRoot, 'docs/testing/scale-baseline-2026-07.json');
  if (!fs.existsSync(baselinePath)) return { ok: false, evidence: 'docs/testing/scale-baseline-2026-07.json not found', detail: 'no committed baseline to beat' };
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as BaselineJson;

  if (!coverBackendSurface().present) {
    return {
      ok: false,
      evidence: `baseline present at docs/testing/scale-baseline-2026-07.json (corpus=${baseline.corpus.path}, machine=${baseline.machine.fingerprint})\n${backendGateFailure().evidence}`,
      detail: 'product surface missing: nothing to measure yet -- the R8 comparison harness below is real and will run once apps/daemon/src/covers/** exists',
    };
  }
  if (!fs.existsSync(baseline.corpus.path)) {
    return { ok: false, evidence: `corpus path from baseline JSON does not exist on this machine: ${baseline.corpus.path}`, detail: 'cannot run the R8 comparison without the frozen corpus' };
  }
  const thisMachine = machineFingerprint();
  if (thisMachine !== baseline.machine.fingerprint) {
    return { ok: false, evidence: `machine fingerprint mismatch: baseline=${baseline.machine.fingerprint} this run=${thisMachine}`, detail: 'R8 baselines are machine-local by design; cannot compare across hardware' };
  }

  // designs-tab-fan-out is the only baseline scenario textually tied to the
  // fan-out this wave fixes (NM-27C). Re-measure it under the identical R8
  // protocol (1 warmup + 5 timed reps) against the SAME corpus, booting the
  // daemon directly against corpus.path exactly like the baseline did.
  const scenario = baseline.scenarios.find((s) => s.name === 'designs-tab-fan-out');
  if (!scenario) return { ok: false, evidence: 'baseline JSON has no designs-tab-fan-out scenario', detail: 'nothing to compare against' };

  let daemon: BootedDaemon | undefined;
  try {
    daemon = await bootDaemonForProbing(baseline.corpus.path);
    const listResp = await fetch(`${daemon.url}/api/projects`, { signal: AbortSignal.timeout(30_000) });
    if (!listResp.ok) return { ok: false, evidence: `GET /api/projects failed: ${listResp.status}`, detail: 'cannot resolve a real project id from the corpus' };
    const listJson = (await listResp.json()) as { projects?: { id?: string }[] };
    const projectId = listJson.projects?.find((p) => typeof p.id === 'string')?.id;
    if (!projectId) return { ok: false, evidence: 'no project with a string id found in the corpus', detail: 'cannot pick a probe target' };

    // 1 discarded warmup + 5 timed reps, matching R8.
    await fetch(`${daemon.url}/api/projects/${encodeURIComponent(projectId)}/files`, { signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      await fetch(`${daemon.url}/api/projects/${encodeURIComponent(projectId)}/files`, { signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
      samples.push(Date.now() - t0);
    }
    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    const regressionCeilingMs = scenario.p50 * (1 + baseline.nonRegressionCeiling / 100);
    const improvementTargetMs = scenario.p50 * (1 - baseline.minimumImprovementThreshold / 100);
    const nonRegressed = p50 <= regressionCeilingMs;
    // "Measurably better" per the minimum improvement threshold. On a
    // scenario already at 1ms baseline this is close to noise-bound; that
    // tension is called out explicitly in the authoring report's
    // AUTHOR-FLAGGED AMBIGUITIES for reviewer ruling.
    const improved = p50 <= improvementTargetMs;
    const ok = nonRegressed && improved;
    return {
      ok,
      evidence: `baseline designs-tab-fan-out: p50=${scenario.p50}ms p95=${scenario.p95}ms\nthis run samples=${JSON.stringify(samples)} p50=${p50}ms p95=${p95}ms\nnonRegressionCeiling=${baseline.nonRegressionCeiling}% (max allowed p50=${regressionCeilingMs.toFixed(2)}ms) -> nonRegressed=${nonRegressed}\nminimumImprovementThreshold=${baseline.minimumImprovementThreshold}% (target p50<=${improvementTargetMs.toFixed(2)}ms) -> improved=${improved}`,
      detail: ok ? undefined : 'does not beat scale-baseline-2026-07 by the stated minimum margin without regressing past the ceiling',
    };
  } finally {
    if (daemon) await daemon.kill().catch(() => undefined);
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
    const routes = discoverCoverRoutes(sourceDaemon.routeInventory);
    const projectId = `w4-c411-${crypto.randomBytes(6).toString('hex')}`;
    await createProject(sourceDaemon.url, projectId, projectId);
    await uploadProjectFile(sourceDaemon.url, projectId, 'index.html', '<!doctype html><html><body>cover backup test</body></html>');
    const genResp = await fetch(`${sourceDaemon.url}${fillPath(routes.generatePath, projectId)}`, { method: 'POST', signal: AbortSignal.timeout(30_000) });
    if (!genResp.ok) return { ok: false, evidence: `generate failed: ${genResp.status}`, detail: 'cannot establish a cover to back up' };
    const getResp = await fetch(`${sourceDaemon.url}${fillPath(routes.fetchPath, projectId)}`, { signal: AbortSignal.timeout(15_000) });
    if (!getResp.ok) return { ok: false, evidence: `GET cover failed: ${getResp.status}` };
    const originalBytes = Buffer.from(await getResp.arrayBuffer());
    const originalSha = sha256Bytes(originalBytes);
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
    const restoredRoutes = discoverCoverRoutes(restoreDaemon.routeInventory);
    const restoredGet = await fetch(`${restoreDaemon.url}${fillPath(restoredRoutes.fetchPath, projectId)}`, { signal: AbortSignal.timeout(15_000) });
    const restoredRenders = restoredGet.ok && sha256Bytes(Buffer.from(await restoredGet.arrayBuffer())) === originalSha;

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
// C4-12 -- parity + gates. The `od cover` subcommand check runs today
// (cheap, and correctly fails: no such subcommand exists yet). `pnpm guard`
// / `pnpm typecheck` run today too and are informative regardless of the
// backend surface.
// =========================================================================
async function checkC412(): Promise<{ ok: boolean; evidence: string; detail?: string | undefined }> {
  const rows: string[] = [];
  const keys = extractSubcommandMapKeys();
  const coverKey = keys.find((k) => /^cover/i.test(k));
  rows.push(`SUBCOMMAND_MAP keys: ${JSON.stringify(keys)}\nmatching 'cover' key: ${coverKey ?? '(none)'}`);

  let cliReachesCoversSrc = false;
  if (coverKey) {
    const cliPath = path.join(repoRoot, 'apps/daemon/src/cli.ts');
    const entry = findSubcommandHandlerEntryPoint(cliPath, new RegExp(`^${coverKey}$`));
    if (entry) {
      const closure = transitiveLocalImportClosure(entry);
      cliReachesCoversSrc = closure.some((f) => f.includes(`${path.sep}covers${path.sep}`) || f.includes(`${path.sep}routes${path.sep}covers`));
      rows.push(`handler entry=${path.relative(repoRoot, entry)}\ntransitive closure reaches apps/daemon/src/covers or routes/covers*: ${cliReachesCoversSrc}`);
    } else {
      rows.push('could not resolve a handler entry point for the cover subcommand');
    }
  }

  let cliHttpParityOk = false;
  if (coverKey && cliReachesCoversSrc && coverBackendSurface().present) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w4-c412-'));
    let daemon: BootedDaemon | undefined;
    try {
      daemon = await bootDaemonForProbing(dataDir);
      const routes = discoverCoverRoutes(daemon.routeInventory);
      const projectId = `w4-c412-${crypto.randomBytes(6).toString('hex')}`;
      await createProject(daemon.url, projectId, projectId);
      await uploadProjectFile(daemon.url, projectId, 'index.html', '<!doctype html><html><body>cli parity</body></html>');
      await fetch(`${daemon.url}${fillPath(routes.generatePath, projectId)}`, { method: 'POST', signal: AbortSignal.timeout(30_000) });
      const httpGet = await fetch(`${daemon.url}${fillPath(routes.fetchPath, projectId)}`, { signal: AbortSignal.timeout(15_000) });
      const httpBytes = httpGet.ok ? Buffer.from(await httpGet.arrayBuffer()) : null;

      const cliRun = odCli([coverKey, 'show', '--project', projectId, '--json'], odDataEnv(dataDir));
      let cliParsed: unknown = null;
      try {
        const lines = cliRun.stdout.trim().split('\n').filter(Boolean);
        cliParsed = lines.length ? JSON.parse(lines[lines.length - 1] ?? '{}') : null;
      } catch { cliParsed = null; }
      // Value-level identity check (not a shape deep-equal -- CLI JSON and
      // HTTP body are legitimately different shapes, per the calibration
      // standard's known-defect list): the project id must appear
      // somewhere in the CLI's own JSON output, and the HTTP surface must
      // have served real bytes.
      const cliMentionsProject = cliRun.status === 0 && isRecord(cliParsed) && JSON.stringify(cliParsed).includes(projectId);
      cliHttpParityOk = cliMentionsProject && httpBytes !== null && httpBytes.length > 0;
      rows.push(`od ${coverKey} show --project <id> --json: exit=${cliRun.status} mentionsProjectId=${cliMentionsProject}\nHTTP GET cover: ok=${httpGet.ok} bytes=${httpBytes?.length ?? 0}\nparity=${cliHttpParityOk}`);
    } finally {
      if (daemon) await daemon.kill().catch(() => undefined);
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  } else {
    rows.push(`cli<->http parity probe skipped: coverKey=${Boolean(coverKey)} cliReachesCoversSrc=${cliReachesCoversSrc} backendPresent=${coverBackendSurface().present}`);
  }

  const guardRun = sh('pnpm', ['guard'], { timeoutMs: 10 * 60_000 });
  const typecheckRun = sh('pnpm', ['typecheck'], { timeoutMs: 10 * 60_000 });
  rows.push(`pnpm guard exit=${guardRun.status}\npnpm typecheck exit=${typecheckRun.status}`);
  if (guardRun.status !== 0) rows.push(`guard tail:\n${guardRun.stdout.slice(-3000)}\n${guardRun.stderr.slice(-1500)}`);
  if (typecheckRun.status !== 0) rows.push(`typecheck tail:\n${typecheckRun.stdout.slice(-3000)}\n${typecheckRun.stderr.slice(-1500)}`);

  const ok = Boolean(coverKey) && cliReachesCoversSrc && cliHttpParityOk && guardRun.status === 0 && typecheckRun.status === 0;
  return {
    ok,
    evidence: rows.join('\n\n'),
    detail: ok ? undefined : 'od cover subcommand missing/unwired, CLI<->HTTP parity unproven, or pnpm guard/typecheck failed',
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

  await runCriterion(
    'C4-1', 'POST .../cover/generate -> kill daemon -> reboot on same OD_DATA_DIR -> GET .../cover',
    'covers persist under RUNTIME_DATA_DIR and survive daemon restart: identical bytes served, and the on-disk artifact is neither rewritten nor re-mtime-stamped by the restart+view',
    checkC41,
  );
  await runCriterion(
    'C4-2', '4 adversarial marker-grid fixtures -> generate cover -> decode PNG -> measure marker-pixel fraction',
    'crop favors the hero region (measured as dominant marker-color pixel fraction in the final cover) on off-center, left-nav, and dark-background fixtures, plus a trivial hero-fills-frame control',
    checkC42,
  );
  await runCriterion(
    'C4-3/C4-4', 'generate -> byte-identical re-upload / mtime games / CSS-only edit / image-only edit -> re-check cover hash',
    'invalidation is content-hash-driven (byte-identical re-upload never regenerates, real byte changes always do) and spans the TRANSITIVE render graph (linked local CSS and image edits regenerate even when index.html itself is untouched)',
    checkC43and44,
  );
  await runCriterion(
    'C4-5', 'infinite-loop project (timeout) / 8 concurrent 1.2s-blocking projects (concurrency cap) / memory-hog project (ceiling), each against a live daemon with process-tree RSS sampling',
    'the renderer enforces a per-job timeout, a concurrency cap strictly below the submitted job count, and a real memory ceiling -- each proven against a deliberately pathological project, not a 1s timeout on a trivial fixture',
    checkC45,
  );
  await runCriterion(
    'C4-6', 'real canary TCP listener (self-tested) + a project referencing it via img/script/link/fetch -> trigger render -> assert zero canary hits',
    'the renderer is PROCESS-LEVEL network-denied: zero outbound connections reach a real external listener, not merely a mocked HTTP client while a real browser egresses freely',
    checkC46,
  );
  await runCriterion(
    'C4-7', 'esbuild-bundle the REAL HtmlProjectCoverFrame from project-cover.tsx -> mount in a real Playwright Chromium page against a real daemon-served project referencing a real canary -> assert zero canary hits',
    'the not-yet-rendered fallback is not network-capable: a project HTML referencing a remote tracker produces NO outbound request on first card view (today: FAILS, because HtmlProjectCoverFrame unconditionally mounts a live network-capable iframe once the file HEAD-verifies)',
    checkC47,
  );
  await runCriterion(
    'C4-8', 'AST scan of project-cover.tsx / RecentProjectsStrip.tsx / DesignsTab.tsx for <iframe> sandbox literals + docs/security/*.md search for an NM-35C threat note mentioning the deliberate allow-same-origin omission',
    'any remaining live iframe carries exactly sandbox="allow-scripts" (frozen contract, no allow-same-origin) and the threat model is recorded in a docs/security NM-35C note',
    checkC48,
  );
  await runCriterion(
    'C4-9', 'temporary vitest+jsdom spec mounting the REAL DesignsTab with 40 synthetic projects, instrumented fetchLiveArtifacts/fetchProjectFiles mocks tracking peak concurrency + a mid-page rejection',
    "DesignsTab issues a bounded number of concurrent fetchLiveArtifacts/fetchProjectFiles calls regardless of project count (today: FAILS, peak concurrency equals project count via unbounded Promise.all), and a single project's failure does not blank the rest of the grid",
    checkC49,
  );
  await runCriterion(
    'C4-10', 're-measure the designs-tab-fan-out scenario (1 warmup + 5 timed reps) against the SAME W0 corpus/machine, compare p50 against scale-baseline-2026-07.json under its stated nonRegressionCeiling and minimumImprovementThreshold',
    'beats scale-baseline-2026-07 by the stated minimum margin (R8 protocol: same corpus, same machine, warmup, >=5 reps, p50+p95) with no regression past the ceiling',
    checkC410,
  );
  await runCriterion(
    'C4-11', 'generate a cover -> od backup create --json -> read archive manifest.json directly -> od restore --json into a fresh data dir -> GET the restored cover',
    "covers join the backup set: the archive manifest names a cover-related class whose archived bytes match the original sha256, and a restored daemon's GET .../cover returns those same bytes (\"a restored cover renders\")",
    checkC411,
  );
  await runCriterion(
    'C4-12', "SUBCOMMAND_MAP AST scan for a 'cover' key + transitive-import reachability into apps/daemon/src/covers -> CLI<->HTTP value-level parity probe -> pnpm guard -> pnpm typecheck",
    "od cover subcommand exists, is wired to real covers/ source (not a stub), --json output and the HTTP surface agree on project identity, and pnpm guard + pnpm typecheck both exit 0",
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
