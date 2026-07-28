// verify-w0.ts -- wave W0 (substrate: recovery, boundary, baselines) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w0.ts [--repo <path>] [--reuse-suite-cache]
// Exit 0 only when every C0 criterion passes and the tree is clean; the
// commit-bound proof manifest is written to the wave's goal-state proof
// directory either way. The manifest's own sha256 is printed as the LAST
// stdout line (`MANIFEST_SHA256=...`) and written to `manifest.sha256.txt` --
// the ORCHESTRATOR anchors that hash out-of-band; this file only prints it.
//
// PORTABILITY / GATE-INTEGRITY (round-1 F21-F23): repoRoot comes from
// `process.cwd()`/`--repo`, never import.meta.url, so this file runs
// correctly as an orchestrator-approved out-of-repo copy. `typescript` is
// resolved via `createRequire` scoped to repoRoot. GATE-INTEGRITY below is
// defense in depth only -- the real control is the external-copy model.
//
// ROUND-3 RE-PLAN -- PRODUCT-SURFACE GATE (escalation-authorized, recorded in
// docs/plans/waves/DECISIONS.md "W0 gate escalation: product-surface gate"):
// after three non-APPROVE review rounds on the probe-intermediary design for
// C0-1..C0-4, every probe-script contract for backup/restore is DELETED.
// The gate now invokes the PRODUCT's own surfaces directly, which W0 must
// ship anyway under this repo's UI/CLI parity policy (AGENTS.md "Capability
// exposure"):
//
//   OD_DATA_DIR=<verifier-owned source root> node <od bin> backup create --out <archivePath> --json
//   OD_DATA_DIR=<verifier-owned fresh root>  node <od bin> restore --archive <archivePath> --json
//
// These are the EXPECTED subcommand shapes this gate defines -- the wave's
// implementation builds to them; nothing here assumes they exist yet. Today
// this fails "product surface missing: od backup" / "... od restore", which
// is the correct, honest result pre-implementation.
//
// The source/restore data roots are entirely verifier-owned: seeded with
// real projects and real uploaded files through the daemon's own HTTP API
// (POST /api/projects, POST /api/projects/:id/upload), never a synthetic
// fixture format invented for this gate. The archive's own on-disk
// `manifest.json` (a real file the backup command writes, read directly by
// the verifier -- never a probe stdout claim) is the sole source of archive
// contents. Corruption targets for C0-3 are selected by the verifier from
// that same real index. See the C0-1..C0-4 section below for the full
// design.
//
// OBSERVE, NEVER TRUST remains the standing principle for everything else:
// the verifier derives ground truth (capability universe, guarded-route
// baseline) from the repo's own source via the TypeScript compiler API, and
// issues its own HTTP requests against daemons it boots itself.

import { execFile, execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type TypeScriptModule from 'typescript';
import type { Node as TsNode } from 'typescript';

const execFileAsync = promisify(execFile);

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

// F29: nothing before this guard may throw uncaught -- dependency
// resolution and proof-dir creation are inside it, and the emergency writer
// is dependency-free plain fs with an os.tmpdir() fallback.
function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W0', commit: 'unknown', treeDirty: true, baseCommit: 'unknown',
      toolchain: { node: process.version, pnpm: 'unknown' },
      criteria: [{ id: 'INIT-FAILURE', command: 'module init', assertion: 'the verifier can initialize before any criterion runs', artifact: null, artifactSha256: null, exitCode: 1, status: 'fail', durationMs: 0, detail: errorMessage }],
    };
    fs.writeFileSync(path.join(os.tmpdir(), 'verify-w0-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
  } catch {
    /* truly nothing more we can do */
  }
  console.error(`verify-w0: FATAL during init: ${errorMessage}`);
  process.exit(1);
}

let repoRoot: string;
let reuseSuiteCache: boolean;
let proofDir: string;
let ts: typeof TypeScriptModule;
// Round-7 F7 closure (docs/plans/waves/DECISIONS.md "W0 gate F7 closure",
// Candidate B ADOPT-WITH-CHANGES): the orchestrator-owned unreachable
// allowlist path is supplied at gate run time, never hardcoded here. Flag
// wins over env; neither supplied is a valid, fail-closed configuration
// (the authorized-skip set is simply empty), not an init error.
let unreachableAllowlistPath: string | undefined;
try {
  repoRoot = path.resolve(argValue('--repo') ?? process.cwd());
  reuseSuiteCache = argv.includes('--reuse-suite-cache');
  unreachableAllowlistPath = argValue('--unreachable-allowlist') ?? process.env.W0_UNREACHABLE_ALLOWLIST;
  proofDir = path.join(os.homedir(), '.claude', 'goal-state', 'mishmash-w0-substrate', 'proof');
  fs.mkdirSync(proofDir, { recursive: true });
  ts = createRequire(path.join(repoRoot, 'package.json'))('typescript');
} catch (err) {
  emergencyExit(`init failed: ${String((err as Error)?.stack ?? err)}`);
}

function sh(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: opts.cwd ?? repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      timeout: opts.timeoutMs ?? 15 * 60_000,
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
  id: string; command: string; assertion: string; artifact: string | null; artifactSha256: string | null;
  exitCode: number; status: 'pass' | 'fail'; durationMs: number; detail?: string | undefined;
}

// F27: never silently swallow a write failure behind a passing criterion.
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
  const fallbackResult = tryWrite(path.join(os.tmpdir(), 'verify-w0-fallback-proof', `${id}.txt`));
  if (fallbackResult) return fallbackResult;
  console.error(`verify-w0: artifact write failed for ${id} on both primary and fallback paths`);
  return { artifact: null, artifactSha256: null };
}

const results: CriterionResult[] = [];
function record(id: string, command: string, assertion: string, ok: boolean, evidence: string, opts: { detail?: string | undefined; durationMs?: number; exitCode?: number } = {}): void {
  try {
    const { artifact, artifactSha256 } = artifactFor(id, `# ${id}\n# assertion: ${assertion}\n# verdict: ${ok ? 'pass' : 'fail'}\n${opts.detail ? `# detail: ${opts.detail}\n` : ''}\n${evidence}\n`);
    const effectiveOk = ok && artifact !== null;
    results.push({
      id, command, assertion, artifact, artifactSha256,
      exitCode: opts.exitCode ?? (effectiveOk ? 0 : 1),
      status: effectiveOk ? 'pass' : 'fail',
      durationMs: opts.durationMs ?? 0,
      detail: artifact === null ? `${opts.detail ? `${opts.detail}; ` : ''}artifact write failed -- forced fail (F27)` : opts.detail,
    });
  } catch (err) {
    results.push({ id, command, assertion, artifact: null, artifactSha256: null, exitCode: 1, status: 'fail', durationMs: opts.durationMs ?? 0, detail: `record() itself failed: ${String(err)}` });
  }
}

async function checkCriterion(id: string, command: string, assertion: string, fn: () => Promise<void> | void): Promise<void> {
  const startedAt = Date.now();
  const startIndex = results.length;
  try {
    await fn();
    const durationMs = Date.now() - startedAt;
    for (let i = startIndex; i < results.length; i++) {
      const r = results[i];
      if (!r) continue;
      r.durationMs = durationMs;
      if (!r.command) r.command = command;
      if (!r.assertion) r.assertion = assertion;
    }
  } catch (err) {
    record(id, command, assertion, false, String((err as Error)?.stack ?? err), { detail: `criterion check crashed: ${String(err)}`, durationMs: Date.now() - startedAt, exitCode: 1 });
  }
}

function fileExists(rel: string): boolean {
  return fs.existsSync(path.join(repoRoot, rel));
}
function readRepoFile(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function parseLastJsonLine(stdout: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines.length > 0 ? lines[lines.length - 1] : undefined;
  if (!last) return { ok: false, error: 'no stdout produced' };
  try {
    return { ok: true, value: JSON.parse(last) };
  } catch (err) {
    return { ok: false, error: `last stdout line is not valid JSON (${String(err)}): ${last.slice(0, 300)}` };
  }
}

// -----------------------------------------------------------------------
// Hardened git plumbing
// -----------------------------------------------------------------------
function gitOrFail(args: string[], why: string): string {
  const r = sh('git', args);
  if (r.status !== 0 || r.stdout.trim().length === 0) throw new Error(`git ${args.join(' ')} failed (${why}): exit=${r.status} stdout=${r.stdout.trim().slice(0, 200) || '<empty>'}`);
  return r.stdout.trim();
}
function resolveMainRef(): { ref: string; sha: string } {
  const remoteHead = sh('git', ['ls-remote', 'origin', 'main']);
  if (remoteHead.status !== 0 || !remoteHead.stdout.trim()) throw new Error(`"git ls-remote origin main" failed (exit=${remoteHead.status}); cannot validate origin/main freshness (F20)`);
  const remoteSha = remoteHead.stdout.trim().split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{40}$/.test(remoteSha)) throw new Error(`"git ls-remote origin main" returned an unparseable sha`);
  for (const ref of ['origin/main', 'main']) {
    const verify = sh('git', ['rev-parse', '--verify', ref]);
    if (verify.status === 0 && verify.stdout.trim()) {
      const sha = verify.stdout.trim();
      if (sha !== remoteSha) throw new Error(`local ref "${ref}" (${sha.slice(0, 12)}) does not match live origin/main tip (${remoteSha.slice(0, 12)}) -- fetch before verifying (F20)`);
      return { ref, sha };
    }
  }
  throw new Error('could not resolve "origin/main" or "main" locally to compute baseCommit');
}
// F29: mkdir INSIDE try; fallback write guarded by its own try/catch; the
// true last resort is stderr + a guaranteed nonzero exit, never an
// uncaught throw.
function writeEmergencyManifest(errorMessage: string, partialResults: CriterionResult[] = []): void {
  const manifest = {
    wave: 'W0', commit: 'unknown', treeDirty: true, baseCommit: 'unknown',
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
    /* fall through to guarded fallback */
  }
  if (!wrote) {
    try {
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w0-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
    } catch {
      /* last resort: stderr only, never throw */
    }
  }
  console.error(`verify-w0: FATAL, emergency manifest written=${wrote}: ${errorMessage}`);
}
function resolveGitContextOrExit(): { headSha: string; baseCommit: string } {
  try {
    const resolvedHeadSha = gitOrFail(['rev-parse', 'HEAD'], 'resolving HEAD commit');
    const mainRef = resolveMainRef();
    const resolvedBaseCommit = gitOrFail(['merge-base', mainRef.sha, resolvedHeadSha], 'computing baseCommit');
    if (resolvedBaseCommit === resolvedHeadSha) throw new Error(`HEAD (${resolvedHeadSha.slice(0, 12)}) equals baseCommit -- nothing left to verify pre-land, or already landed (F19)`);
    return { headSha: resolvedHeadSha, baseCommit: resolvedBaseCommit };
  } catch (err) {
    writeEmergencyManifest(String(err));
    process.exit(1);
  }
}
const { headSha, baseCommit } = resolveGitContextOrExit();
function readFileAtCommit(commit: string, relPath: string): string {
  const r = sh('git', ['show', `${commit}:${relPath}`]);
  if (r.status !== 0) throw new Error(`git show ${commit}:${relPath} failed (exit=${r.status})`);
  return r.stdout;
}

// -----------------------------------------------------------------------
// AST helpers
// -----------------------------------------------------------------------
function parseTs(absPath: string): { sourceFile: TypeScriptModule.SourceFile; text: string } {
  const text = fs.readFileSync(absPath, 'utf8');
  return { sourceFile: ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true), text };
}
function fileHasRealSqliteBackupCall(absPath: string): boolean {
  const { sourceFile } = parseTs(absPath);
  let found = false;
  const dbExecMethods = new Set(['exec', 'prepare', 'run', 'pragma']);
  function visit(node: TsNode): void {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text;
      if (methodName === 'backup') { found = true; return; }
      if (dbExecMethods.has(methodName)) {
        for (const arg of node.arguments) if (/VACUUM\s+INTO/i.test(arg.getText(sourceFile))) { found = true; return; }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
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
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) if (fs.existsSync(candidate)) return candidate;
  return null;
}
// Round-3 F2: reachability now starts from wherever cli.ts's SUBCOMMAND_MAP
// registers the backup handler (following its import), not a fixed
// index.ts -- so the check tracks whatever the implementer actually wires
// up for `od backup`.
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
  // Is it defined locally in cli.ts, or imported from elsewhere?
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
  // Defined locally in cli.ts itself.
  return cliPath;
}
// Round-4 F2: full transitive closure over local imports (BFS), not a
// one-hop check -- a real .backup()/VACUUM INTO call several modules deep
// in the actual import graph must count; a call in a file that merely
// happens to sit in the same directory but is never imported (directly or
// transitively) from the handler must not.
function backupCallReachableFrom(entry: string): { ok: boolean; reachableFiles: string[] } {
  const reachable = new Set<string>([entry]);
  const queue: string[] = [entry];
  const MAX_FILES = 200; // bounded traversal, generous for this repo's module sizes
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
  const reachableFiles = [...reachable];
  return { ok: reachableFiles.some((f) => fileHasRealSqliteBackupCall(f)), reachableFiles };
}

// -----------------------------------------------------------------------
// Real daemon boot for direct HTTP probing / fixture seeding.
// -----------------------------------------------------------------------
interface BootedDaemon { url: string; pid: number | undefined; dataDir: string; routeInventory: { method: string; path: string }[]; kill: () => Promise<void> }
async function bootDaemonForProbing(dataDir?: string): Promise<BootedDaemon> {
  const useDataDir = dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-verify-'));
  const bootScript = `
import path from 'node:path';
import { pathToFileURL } from 'node:url';
process.env.OD_DATA_DIR = ${JSON.stringify(useDataDir)};
process.env.OD_DAEMON_CLI_PATH = ${JSON.stringify(path.join(repoRoot, 'apps/daemon/dist/cli.js'))};
const mod = await import(pathToFileURL(${JSON.stringify(path.join(repoRoot, 'apps/daemon/src/server.ts'))}).href);
const started = await mod.startServer({ port: 0, returnServer: true });
console.log('OD_W0_VERIFIER_READY ' + JSON.stringify({ url: started.url, routeInventory: started.routeInventory }));
process.on('SIGTERM', async () => { await started.shutdown(); process.exit(0); });
`;
  const scriptPath = path.join(proofDir, `.boot-daemon.${process.pid}.${crypto.randomBytes(3).toString('hex')}.mjs`);
  fs.writeFileSync(scriptPath, bootScript);
  const child = spawn('pnpm', ['exec', 'tsx', scriptPath], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffered = '';
  const ready = await new Promise<{ url: string; routeInventory: { method: string; path: string }[] } | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 45_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const line = buffered.split('\n').find((l) => l.startsWith('OD_W0_VERIFIER_READY '));
      if (line) {
        clearTimeout(timeout);
        try { resolve(JSON.parse(line.slice('OD_W0_VERIFIER_READY '.length))); } catch { resolve(null); }
      }
    });
    child.on('exit', () => { clearTimeout(timeout); resolve(null); });
  });
  const kill = async (): Promise<void> => {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5_000);
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

function staticRequireLocalDaemonRequestRoutesAndDynamics(): { guarded: { method: string; path: string }[]; unresolvable: { file: string; line: number }[] } {
  const routesDir = path.join(repoRoot, 'apps/daemon/src');
  const candidateFiles: string[] = [];
  (function walk(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.endsWith('.test.ts')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) candidateFiles.push(full);
    }
  })(routesDir);
  const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options']);
  const guarded: { method: string; path: string }[] = [];
  const unresolvable: { file: string; line: number }[] = [];

  function endsWithGuard(node: TsNode): boolean {
    if (ts.isIdentifier(node)) return node.text === 'requireLocalDaemonRequest';
    if (ts.isPropertyAccessExpression(node)) return node.name.text === 'requireLocalDaemonRequest';
    return false;
  }

  for (const file of candidateFiles) {
    const { sourceFile, text } = parseTs(file);
    // Pass 1: local const/let aliases whose initializer ends in requireLocalDaemonRequest
    // (round-3 F7: `const guard = deps.http.requireLocalDaemonRequest`).
    const aliasNames = new Set<string>();
    const constPathValues = new Map<string, string>();
    function collectAliases(node: TsNode): void {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (endsWithGuard(node.initializer)) aliasNames.add(node.name.text);
        if (ts.isStringLiteral(node.initializer)) constPathValues.set(node.name.text, node.initializer.text);
      }
      ts.forEachChild(node, collectAliases);
    }
    collectAliases(sourceFile);
    function isGuardArg(arg: TsNode): boolean {
      if (endsWithGuard(arg)) return true;
      if (ts.isIdentifier(arg) && aliasNames.has(arg.text)) return true;
      if (ts.isArrayLiteralExpression(arg)) return arg.elements.some((el) => isGuardArg(el));
      return false;
    }
    function visit(node: TsNode): void {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const methodName = node.expression.name.text.toLowerCase();
        if (HTTP_METHODS.has(methodName) && node.arguments.length >= 2) {
          const pathArg = node.arguments[0];
          const middlewareArgs = node.arguments.slice(1);
          const isGuarded = pathArg ? middlewareArgs.some((a) => isGuardArg(a)) : false;
          if (isGuarded && pathArg) {
            let resolvedPath: string | null = null;
            if (ts.isStringLiteral(pathArg)) resolvedPath = pathArg.text;
            else if (ts.isIdentifier(pathArg) && constPathValues.has(pathArg.text)) resolvedPath = constPathValues.get(pathArg.text) ?? null;
            if (resolvedPath !== null) {
              guarded.push({ method: methodName.toUpperCase(), path: resolvedPath });
            } else {
              const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
              unresolvable.push({ file: path.relative(repoRoot, file), line: line + 1 });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    void text;
  }
  return { guarded, unresolvable };
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

// =========================================================================
// Shared expensive runs
// =========================================================================
interface AssertionResult { fullName: string; status: string; failureMessages?: string[] }
interface TestFileResult { name: string; assertionResults: AssertionResult[] }
interface SuiteJson { numFailedTests: number; numPassedTests: number; numTodoTests?: number; numPendingTests?: number; testResults: TestFileResult[] }

function runSuiteJson(cwd: string, filterArgs: string[], outFile: string): { runResult: ReturnType<typeof sh>; data: SuiteJson | null; all: AssertionResult[] } {
  const outPath = path.join(proofDir, outFile);
  if (reuseSuiteCache && fs.existsSync(outPath)) {
    let data: SuiteJson | null = null;
    try { data = JSON.parse(fs.readFileSync(outPath, 'utf8')) as SuiteJson; } catch { data = null; }
    const all: AssertionResult[] = data ? data.testResults.flatMap((t) => t.assertionResults) : [];
    return { runResult: { status: data ? 0 : 1, stdout: '' }, data, all };
  }
  const runResult = sh('pnpm', [...filterArgs, 'exec', 'vitest', 'run', '-c', 'vitest.config.ts', '--reporter=json', `--outputFile=${outPath}`, '--allowOnly=false'], { timeoutMs: 30 * 60_000, cwd });
  let data: SuiteJson | null = null;
  try { data = JSON.parse(fs.readFileSync(outPath, 'utf8')) as SuiteJson; } catch { data = null; }
  const all: AssertionResult[] = data ? data.testResults.flatMap((t) => t.assertionResults) : [];
  return { runResult, data, all };
}

let nextEnvSnapshot: Buffer | null = null;
function snapshotNextEnv(): void {
  const p = path.join(repoRoot, 'apps/web/next-env.d.ts');
  nextEnvSnapshot = fs.existsSync(p) ? fs.readFileSync(p) : null;
}
function restoreNextEnvIfChurned(): void {
  if (nextEnvSnapshot === null) return;
  const p = path.join(repoRoot, 'apps/web/next-env.d.ts');
  if (fs.existsSync(p) && !fs.readFileSync(p).equals(nextEnvSnapshot)) fs.writeFileSync(p, nextEnvSnapshot);
}

const odBinPath = path.join(repoRoot, 'apps/daemon/bin/od.mjs');
function odCli(args: string[], env: NodeJS.ProcessEnv, timeoutMs = 3 * 60_000): { status: number; stdout: string } {
  return sh('node', [odBinPath, ...args], { env, timeoutMs });
}

async function main(): Promise<void> {
  snapshotNextEnv();
  const daemonSuite = runSuiteJson(repoRoot, ['--filter', '@open-design/daemon'], 'daemon-suite-run.json');
  const webSuite = runSuiteJson(repoRoot, ['--filter', '@open-design/web'], 'web-suite-run.json');
  const integrationSuite = runSuiteJson(path.join(repoRoot, 'e2e'), ['--filter', 'e2e'], 'integration-suite-run.json');
  restoreNextEnvIfChurned();

  function daemonMatching(needle: string): AssertionResult[] {
    return daemonSuite.all.filter((t) => t.fullName.includes(needle));
  }
  function needleReport(needle: string, minimum: number): { ok: boolean; evidence: string } {
    const hits = daemonMatching(needle);
    const ok = hits.length >= minimum && hits.every((t) => t.status === 'passed');
    return { ok, evidence: hits.length ? hits.map((t) => `${t.status.toUpperCase()}  ${t.fullName}`).join('\n') : `NO TESTS MATCHED "${needle}" (want >=${minimum})` };
  }
  function fileContainingNeedle(needle: string): string | null {
    for (const tr of daemonSuite.data?.testResults ?? []) if (tr.assertionResults.some((a) => a.fullName.includes(needle))) return tr.name;
    return null;
  }

  // =======================================================================
  // Round-3 F5: red-before-green. JSON-reporter parsing, rejecting
  // module-resolution/SyntaxError failure classes as invalid red evidence;
  // workspace package symlinks (@open-design/*) are re-pointed at the
  // WORKTREE's own checked-out packages/apps (pinned to baseCommit),
  // closing the "resolves changed workspace code through the HEAD links"
  // hole; teardownVerified is computed BEFORE the return value and folded
  // into ok.
  // =======================================================================
  async function verifyRedAtParent(testFileAbsPaths: string[], needle: string, label: string): Promise<{ ok: boolean; evidence: string }> {
    const uniqueFiles = [...new Set(testFileAbsPaths)].filter(Boolean);
    if (uniqueFiles.length === 0) return { ok: false, evidence: `no test file discovered to red-check for ${label}` };
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-red-worktree-'));
    fs.rmSync(worktreeDir, { recursive: true, force: true });
    let teardownVerified = false;
    let runResult: { ok: boolean; evidence: string };
    try {
      const add = sh('git', ['worktree', 'add', '--detach', worktreeDir, baseCommit]);
      if (add.status !== 0) {
        runResult = { ok: false, evidence: `git worktree add failed: ${add.stdout}` };
      } else {
        // Round-4 F5 / Round-5 F5: a wholesale node_modules symlink lets
        // nested @open-design/* resolution walk back through the shared
        // node_modules into the LIVE (HEAD-state) packages/apps, defeating
        // parent-red at every nesting level below the root re-point. Run a
        // real, store-cached `pnpm install --offline` in the worktree so
        // every @open-design/* package resolves to baseCommit code at every
        // level. Round-5: NO fallback exists anymore -- a symlink fallback
        // could still let package resolution walk back to HEAD code at some
        // nesting level, which is exactly the isolation break this check
        // exists to prevent. "Red evidence unavailable" (offline install
        // failed, e.g. a store miss for a dependency added between
        // baseCommit and HEAD) is NOT "red evidence obtained" -- it is a
        // hard FAIL of this whole check, not a degraded-but-passable path.
        // A freshly created worktree carries its own untrusted mise.toml
        // (mise trust is a per-directory grant); without trusting it first,
        // the mise-shimmed `pnpm` binary refuses to run and the offline
        // install would silently no-op rather than genuinely installing.
        sh('mise', ['trust', worktreeDir], { timeoutMs: 30_000 });
        const install = sh('pnpm', ['install', '--offline'], { cwd: worktreeDir, timeoutMs: 5 * 60_000 });
        if (install.status !== 0) {
          runResult = { ok: false, evidence: `pnpm install --offline failed in the baseCommit worktree (exit=${install.status}) -- no fallback exists; baseCommit package isolation could not be established, so red-at-parent evidence is unavailable, which is a FAIL not a pass\n${install.stdout.slice(-2000)}` };
        } else {
          const relFiles: string[] = [];
          for (const abs of uniqueFiles) {
            const rel = path.relative(path.join(repoRoot, 'apps/daemon'), abs);
            const dst = path.join(worktreeDir, 'apps/daemon', rel);
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(abs, dst);
            relFiles.push(rel);
          }
          const redJsonPath = path.join(proofDir, `.red-parent-${label}-${process.pid}.json`);
          const run = sh('pnpm', ['--filter', '@open-design/daemon', 'exec', 'vitest', 'run', '-c', 'vitest.config.ts', '--reporter=json', `--outputFile=${redJsonPath}`, ...relFiles], { cwd: worktreeDir, timeoutMs: 5 * 60_000 });
          let redData: SuiteJson | null = null;
          try { redData = JSON.parse(fs.readFileSync(redJsonPath, 'utf8')) as SuiteJson; } catch { redData = null; }
          const namedHits = redData ? redData.testResults.flatMap((t) => t.assertionResults).filter((a) => a.fullName.includes(needle)) : [];
          const INVALID_FAILURE_CLASS = /Cannot find module|MODULE_NOT_FOUND|SyntaxError|Cannot use import statement/i;
          const genuineAssertionFailure =
            namedHits.length > 0 &&
            namedHits.every((a) => a.status === 'failed' && !(a.failureMessages ?? []).some((m) => INVALID_FAILURE_CLASS.test(m)));
          runResult = { ok: genuineAssertionFailure, evidence: `worktree=${worktreeDir}\noffline-install exit=${install.status}\nfiles=${relFiles.join(', ')}\nparent=${baseCommit}\nexit=${run.status}\nnamed hits: ${JSON.stringify(namedHits)}\ngenuineAssertionFailure=${genuineAssertionFailure}\n${run.stdout.slice(-3000)}` };
        }
      }
    } finally {
      sh('git', ['worktree', 'remove', '--force', worktreeDir]);
      fs.rmSync(worktreeDir, { recursive: true, force: true });
      teardownVerified = !sh('git', ['worktree', 'list']).stdout.includes(worktreeDir);
    }
    return { ok: runResult.ok && teardownVerified, evidence: `${runResult.evidence}\nteardownVerified=${teardownVerified}` };
  }

  // =======================================================================
  // C0-1 / C0-2 / C0-3 / C0-4 -- PRODUCT-SURFACE GATE (round-3 re-plan).
  // No probe intermediary. Real `od backup create` / `od restore` CLI
  // invocations against verifier-owned, verifier-seeded data roots.
  // =======================================================================

  const REQUIRED_ARCHIVE_CLASSES = ['sqlite-database', 'projects-dir', 'library-assets', 'memory-markdown', 'app-config', 'mcp-config-tokens', 'connector-credentials', 'byok-keys'];

  interface SeededFixture { sourceDir: string; projects: { id: string; files: { name: string; content: string }[] }[] }

  async function seedRealSourceFixture(): Promise<SeededFixture> {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-source-'));
    const daemon = await bootDaemonForProbing(sourceDir);
    const projects: SeededFixture['projects'] = [];
    try {
      for (let p = 0; p < 3; p++) {
        const id = `w0-fixture-${p}-${crypto.randomBytes(6).toString('hex')}`;
        await fetch(`${daemon.url}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: id }) });
        const files: { name: string; content: string }[] = [];
        const form = new FormData();
        for (let f = 0; f < 8; f++) {
          const name = `w0-file-${p}-${f}.txt`;
          const content = `w0-fixture-content-${p}-${f}-${crypto.randomBytes(8).toString('hex')}`;
          form.append('files', new Blob([content], { type: 'text/plain' }), name);
          files.push({ name, content });
        }
        await fetch(`${daemon.url}/api/projects/${id}/upload`, { method: 'POST', body: form });
        projects.push({ id, files });
      }
    } finally {
      await daemon.kill();
    }
    return { sourceDir, projects };
  }

  // Round-4 F1/F2: bytes-on-disk are not enough -- a restore that drops the
  // projects TABLE while leaving loose files intact must fail. Queries the
  // restored app.sqlite directly for every seeded project id, requires the
  // surviving-row count to be >= the seeded count (a vacuously-empty
  // restored table is a fail, not a pass), and only samples files that
  // belong to a row that actually survived.
  async function verifyProjectFilesViaHttp(dataDir: string, fixture: SeededFixture, sampleMin: number): Promise<{ ok: boolean; sampled: number; mismatches: string[]; problems: string[] }> {
    const problems: string[] = [];
    const dbPath = path.join(dataDir, 'app.sqlite');
    const survivingIds = new Set<string>();
    if (fs.existsSync(dbPath)) {
      for (const p of fixture.projects) {
        const row = sh('sqlite3', [dbPath, `SELECT id FROM projects WHERE id = '${p.id.replace(/'/g, "''")}';`]);
        if (row.status === 0 && row.stdout.trim() === p.id) survivingIds.add(p.id);
      }
    } else {
      problems.push(`restored app.sqlite not found at ${dbPath} -- cannot verify project row survival`);
    }
    if (survivingIds.size < fixture.projects.length) {
      problems.push(`restored project row count (${survivingIds.size}) is below the seeded count (${fixture.projects.length}) -- project records were lost`);
    }
    const allFiles = fixture.projects.filter((p) => survivingIds.has(p.id)).flatMap((p) => p.files.map((f) => ({ projectId: p.id, ...f })));
    const sample = allFiles.slice(0, Math.max(sampleMin, Math.min(allFiles.length, 50)));
    const mismatches: string[] = [];
    let daemon: BootedDaemon | null = null;
    try {
      daemon = await bootDaemonForProbing(dataDir);
      for (const f of sample) {
        try {
          const res = await fetch(`${daemon.url}/api/projects/${f.projectId}/raw/${encodeURIComponent(f.name)}`);
          const body = await res.text();
          if (res.status !== 200 || body !== f.content) mismatches.push(`${f.projectId}/${f.name}: status=${res.status} match=${body === f.content}`);
        } catch (err) {
          mismatches.push(`${f.projectId}/${f.name}: fetch threw ${String(err)}`);
        }
      }
    } catch (err) {
      problems.push(`could not boot daemon against ${dataDir}: ${String(err)}`);
    } finally {
      if (daemon) await daemon.kill();
    }
    if (sample.length < sampleMin) problems.push(`only ${sample.length} files bound to surviving project rows available to sample (need >=${sampleMin})`);
    if (mismatches.length > 0) problems.push(`${mismatches.length}/${sample.length} sampled files mismatched via HTTP raw fetch`);
    return { ok: problems.length === 0, sampled: sample.length, mismatches, problems };
  }

  // Reads the archive's own on-disk manifest.json directly -- the sole
  // source of archive contents (round-3 F4: archiveContents self-report
  // eliminated entirely). Rejects path escapes.
  function readArchiveIndex(archivePath: string): { ok: boolean; classes: { class: string; relPath: string; absPath: string | null; isDirectory: boolean }[]; problems: string[] } {
    const manifestPath = path.join(archivePath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return { ok: false, classes: [], problems: [`archive manifest missing: ${manifestPath}`] };
    let raw: { class: string; relPath: string }[];
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!Array.isArray(raw)) throw new Error('not an array');
    } catch (err) {
      return { ok: false, classes: [], problems: [`archive manifest invalid JSON: ${String(err)}`] };
    }
    const problems: string[] = [];
    const seen = new Set<string>();
    const archiveRootReal = fs.realpathSync(archivePath);
    const classes = raw.map((entry) => {
      if (seen.has(entry.class)) problems.push(`duplicate class row: ${entry.class}`);
      seen.add(entry.class);
      const normalized = typeof entry.relPath === 'string' ? path.normalize(entry.relPath) : '';
      const resolved = path.resolve(archivePath, normalized);
      // Round-4 F4: lstat the entry itself -- a symlink is rejected
      // outright, regardless of where it points. realpath (which fully
      // resolves every symlinked path SEGMENT, not just the leaf) is what
      // decides containment, since a lexical path.resolve never dereferences
      // a symlinked intermediate directory and would wrongly accept one that
      // escapes the archive root.
      let lst: fs.Stats | null = null;
      try { lst = fs.lstatSync(resolved); } catch { lst = null; }
      if (!lst) {
        problems.push(`class "${entry.class}" claims relPath "${entry.relPath}" but it does not exist inside the archive`);
        return { class: entry.class, relPath: entry.relPath, absPath: null, isDirectory: false };
      }
      if (lst.isSymbolicLink()) {
        problems.push(`class "${entry.class}" relPath "${entry.relPath}" is a symlink -- rejected outright`);
        return { class: entry.class, relPath: entry.relPath, absPath: null, isDirectory: false };
      }
      const realResolved = fs.realpathSync(resolved);
      const withinRoot = realResolved === archiveRootReal || realResolved.startsWith(`${archiveRootReal}${path.sep}`);
      if (!withinRoot) {
        problems.push(`class "${entry.class}" relPath "${entry.relPath}" escapes the archive root -- rejected`);
        return { class: entry.class, relPath: entry.relPath, absPath: null, isDirectory: false };
      }
      return { class: entry.class, relPath: entry.relPath, absPath: resolved, isDirectory: lst.isDirectory() };
    });
    return { ok: problems.length === 0, classes, problems };
  }

  function odDataEnv(dataDir: string): NodeJS.ProcessEnv {
    return { ...process.env, OD_DATA_DIR: dataDir, OD_DAEMON_CLI_PATH: path.join(repoRoot, 'apps/daemon/dist/cli.js') };
  }

  // Round-5 F32: the CLI chain and the HTTP chain must run through the
  // IDENTICAL independent verification path so they cannot silently
  // diverge (e.g. the HTTP surface being checked more leniently than the
  // CLI surface). Every backup/restore outcome -- CLI-produced or
  // HTTP-produced -- is graded by this one function.
  async function verifyBackupRestoreOutcome(archivePath: string, restoreDir: string, fixture: SeededFixture): Promise<{ ok: boolean; problems: string[]; evidence: unknown }> {
    const problems: string[] = [];
    const dbPath = path.join(restoreDir, 'app.sqlite');
    let integrityOutput = '';
    if (fs.existsSync(dbPath)) {
      const check = sh('sqlite3', [dbPath, 'PRAGMA integrity_check;']);
      integrityOutput = check.stdout.trim();
      if (check.status !== 0 || integrityOutput !== 'ok') problems.push(`integrity_check != ok (got: ${integrityOutput || `exit ${check.status}`})`);
    } else {
      problems.push(`restored app.sqlite not found at ${dbPath}`);
    }
    const httpCheck = await verifyProjectFilesViaHttp(restoreDir, fixture, 20);
    problems.push(...httpCheck.problems);
    const archiveIndex = readArchiveIndex(archivePath);
    problems.push(...archiveIndex.problems);
    return { ok: problems.length === 0, problems, evidence: { integrityOutput, httpCheck, archiveIndex } };
  }

  let c01Fixture: SeededFixture | null = null;
  let c01ArchivePath: string | null = null;

  await checkCriterion(
    'C0-1',
    `OD_DATA_DIR=<verifier-owned source> node ${odBinPath} backup create --out <archivePath> --json; OD_DATA_DIR=<verifier-owned fresh root> node ${odBinPath} restore --archive <archivePath> --json; independently, EXACTLY POST /api/backup {outPath} and POST /api/restore {archivePath} (the parity-mandated HTTP contract this gate defines) are called against daemons the verifier boots itself`,
    'verifier seeds real projects+files via the daemon\'s own HTTP API, invokes the real od backup/restore CLI, and separately drives the SAME full independent verification chain (PRAGMA integrity_check, >=20 file HTTP round-trip comparisons, archive-index re-read) through the exact HTTP contract routes -- fails "product surface missing: od backup"/"od restore" until those CLI subcommands exist, fails "HTTP surface missing: POST /api/backup"/"POST /api/restore" until those EXACT routes exist, and fails with a named reason if a route exists but does not actually perform backup/restore (checked by the identical verifyBackupRestoreOutcome function used for the CLI chain, not by status code alone)',
    async () => {
      const fixture = await seedRealSourceFixture();
      c01Fixture = fixture;
      const problems: string[] = [];

      // ---- CLI chain ----
      const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-archive-'));
      const archivePath = path.join(archiveDir, 'archive');
      const backupRun = odCli(['backup', 'create', '--out', archivePath, '--json'], odDataEnv(fixture.sourceDir));
      let cliOutcome: { ok: boolean; problems: string[]; evidence: unknown } | null = null;
      let restoreRunStatus = -1;
      if (backupRun.status !== 0) {
        problems.push('product surface missing: od backup');
      } else {
        c01ArchivePath = archivePath;
        const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-restore-'));
        const restoreRun = odCli(['restore', '--archive', archivePath, '--json'], odDataEnv(restoreDir));
        restoreRunStatus = restoreRun.status;
        if (restoreRun.status !== 0) {
          problems.push('product surface missing: od restore');
        } else {
          cliOutcome = await verifyBackupRestoreOutcome(archivePath, restoreDir, fixture);
          problems.push(...cliOutcome.problems);
        }
      }

      // ---- HTTP chain (round-5 F32) ----
      // The exact parity-mandated contract this gate defines: EXACTLY
      // `POST /api/backup` and `POST /api/restore` (no substring/status-code
      // leniency -- a route named /api/backup-status or /api/restore-preview
      // does not count). When both exist, the SAME verifyBackupRestoreOutcome
      // function used above grades the HTTP-produced archive/restore, so the
      // two chains cannot silently diverge in what "works" means. The daemon
      // always operates on its OWN resolved OD_DATA_DIR (AGENTS.md "Daemon
      // data directory contract") -- so the HTTP backup call runs against a
      // daemon booted on the fixture source, and the HTTP restore call runs
      // against a SEPARATE daemon booted on a verifier-owned fresh root, the
      // same shape as the CLI chain's --out/--archive split.
      let httpBackupRoute: { method: string; path: string } | undefined;
      let httpRestoreRoute: { method: string; path: string } | undefined;
      let httpArchivePath: string | null = null;
      let httpBackupResponseStatus = -1;
      let httpRestoreResponseStatus = -1;
      let httpOutcome: { ok: boolean; problems: string[]; evidence: unknown } | null = null;

      const backupDaemon = await bootDaemonForProbing(fixture.sourceDir);
      try {
        httpBackupRoute = backupDaemon.routeInventory.find((r) => r.method === 'POST' && r.path === '/api/backup');
        if (httpBackupRoute) {
          const httpArchiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-http-archive-'));
          const outPath = path.join(httpArchiveDir, 'archive');
          const res = await fetch(`${backupDaemon.url}/api/backup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outPath }) }).catch(() => null);
          httpBackupResponseStatus = res?.status ?? -1;
          const body = res ? await res.json().catch(() => null) as { archivePath?: string } | null : null;
          const returnedPath = body?.archivePath && typeof body.archivePath === 'string' ? body.archivePath : outPath;
          if (res?.ok && fs.existsSync(returnedPath)) {
            httpArchivePath = returnedPath;
          } else {
            problems.push(`HTTP backup route POST /api/backup did not produce a real archive (status=${httpBackupResponseStatus}, archiveExists=${fs.existsSync(returnedPath)})`);
          }
        }
      } finally {
        await backupDaemon.kill();
      }
      if (!httpBackupRoute) problems.push('HTTP surface missing: POST /api/backup');

      if (httpArchivePath) {
        const httpRestoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-http-restore-'));
        const restoreDaemon = await bootDaemonForProbing(httpRestoreDir);
        try {
          httpRestoreRoute = restoreDaemon.routeInventory.find((r) => r.method === 'POST' && r.path === '/api/restore');
          if (httpRestoreRoute) {
            const res = await fetch(`${restoreDaemon.url}/api/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archivePath: httpArchivePath }) }).catch(() => null);
            httpRestoreResponseStatus = res?.status ?? -1;
            if (!res?.ok) {
              problems.push(`HTTP restore route POST /api/restore returned an unsuccessful response (status=${httpRestoreResponseStatus})`);
            }
          }
        } finally {
          await restoreDaemon.kill();
        }
        if (!httpRestoreRoute) {
          problems.push('HTTP surface missing: POST /api/restore');
        } else if (httpRestoreResponseStatus >= 200 && httpRestoreResponseStatus < 300) {
          // Same independent verification function as the CLI chain -- the
          // HTTP-produced restore must satisfy the IDENTICAL check.
          httpOutcome = await verifyBackupRestoreOutcome(httpArchivePath, httpRestoreDir, fixture);
          problems.push(...httpOutcome.problems);
        }
      } else {
        // No usable HTTP-produced archive to restore from; still report the
        // restore route's own presence/absence so both missing-surface
        // classes can appear together even when backup already failed.
        const probeDaemon = await bootDaemonForProbing(fixture.sourceDir);
        try {
          httpRestoreRoute = probeDaemon.routeInventory.find((r) => r.method === 'POST' && r.path === '/api/restore');
        } finally {
          await probeDaemon.kill();
        }
        if (!httpRestoreRoute) problems.push('HTTP surface missing: POST /api/restore');
      }

      const ok = problems.length === 0;
      record('C0-1', '', '', ok, JSON.stringify({ cliOutcome, httpOutcome, httpBackupRoute, httpRestoreRoute, httpArchivePath, httpBackupResponseStatus, httpRestoreResponseStatus }, null, 2), {
        detail: ok ? undefined : problems.join('; '),
        exitCode: Math.max(backupRun.status, restoreRunStatus),
      });
    },
  );

  await checkCriterion(
    'C0-2',
    'verifier owns the source root and mutates it (DB rows + a real uploaded file) DURING `od backup create`; verifies row-to-file referential consistency on the restored output; AST reachability now follows from cli.ts\'s SUBCOMMAND_MAP "backup" registration',
    'a post-backup marker write must be ABSENT from the restored snapshot (no evidence newer than the snapshot); every restored project row must resolve to a real fetchable file; the online-backup call must be reachable from wherever cli.ts wires up the backup subcommand',
    async () => {
      const fixture = await seedRealSourceFixture();
      const dbPath = path.join(fixture.sourceDir, 'app.sqlite');
      const before = sh('sqlite3', [dbPath, 'SELECT COUNT(*) FROM projects;']).stdout.trim();
      const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-c02-archive-'));
      const archivePath = path.join(archiveDir, 'archive');

      // r2 amendment 2026-07-27 (first full-run evidence): the upload daemon
      // must be booted BEFORE the backup child is spawned. `od backup create`
      // completes in ~250ms while bootDaemonForProbing takes 1-3s, so booting
      // inside the loop guaranteed fileUploadsDuringBackup === 0 -- the
      // criterion was structurally unsatisfiable by ANY implementation.
      const uploadDaemon = await bootDaemonForProbing(fixture.sourceDir).catch(() => null);
      const childSpawnedAt = Date.now();
      const child = spawn('node', [odBinPath, 'backup', 'create', '--out', archivePath, '--json'], { cwd: repoRoot, env: odDataEnv(fixture.sourceDir) });
      let stdout = '';
      child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
      let writerWrites = 0;
      let fileUploadsDuringBackup = 0;
      const writerStart = Date.now();
      const writerInterval = setInterval(() => {
        const r = sh('sqlite3', [dbPath, `UPDATE projects SET updated_at = ${Date.now()} WHERE id = (SELECT id FROM projects LIMIT 1);`]);
        if (r.status === 0) writerWrites++;
      }, 10); // r2b: 10ms cadence -- a correct backup completes in ~250ms, so 25ms could not honestly yield 10 in-window writes
      // Round-4 F2: the writer loop must ALSO upload real project FILES
      // during the backup window, not just mutate SQLite rows, since
      // "atomic under concurrent mutation" covers the file store too.
      let backupChildRunning = true;
      const fileUploadLoop = (async () => {
        if (!uploadDaemon) return;
        try {
          const targetProject = fixture.projects[1] ?? fixture.projects[0]!;
          while (backupChildRunning) {
            const name = `w0-concurrent-upload-${fileUploadsDuringBackup}-${crypto.randomBytes(4).toString('hex')}.txt`;
            const form = new FormData();
            form.append('files', new Blob([`concurrent-write-${fileUploadsDuringBackup}`], { type: 'text/plain' }), name);
            const res = await fetch(`${uploadDaemon.url}/api/projects/${targetProject.id}/upload`, { method: 'POST', body: form }).catch(() => null);
            if (res?.status === 200) fileUploadsDuringBackup++;
            await new Promise((r) => setTimeout(r, 40));
          }
        } finally {
          await uploadDaemon.kill();
        }
      })();
      const exitCode: number = await new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
      // r2b amendment 2026-07-28 (Sol REJECT r2-1): freeze ALL concurrency
      // evidence at the moment the backup child exits -- writer ticks and
      // uploads that land during upload-loop drain or daemon cleanup are
      // post-window activity and must not count toward atomicity evidence.
      const childDurationMs = Date.now() - childSpawnedAt;
      clearInterval(writerInterval);
      const writerDurationMs = Date.now() - writerStart;
      const uploadsDuringWindow = fileUploadsDuringBackup;
      backupChildRunning = false;
      await fileUploadLoop;

      // Post-backup marker: a real new file, written to the source AFTER
      // the backup completed. It must NOT appear in the restored output.
      const markerProject = fixture.projects[0]!;
      const markerName = `w0-post-backup-marker-${crypto.randomBytes(6).toString('hex')}.txt`;
      const markerDaemon = await bootDaemonForProbing(fixture.sourceDir);
      try {
        const form = new FormData();
        form.append('files', new Blob(['post-backup-marker'], { type: 'text/plain' }), markerName);
        await fetch(`${markerDaemon.url}/api/projects/${markerProject.id}/upload`, { method: 'POST', body: form });
      } finally {
        await markerDaemon.kill();
      }

      const problems: string[] = [];
      if (exitCode !== 0) problems.push(`od backup create exited ${exitCode} -- product surface missing: od backup`);
      const after = sh('sqlite3', [dbPath, 'SELECT COUNT(*) FROM projects;']).stdout.trim();
      void after;

      if (exitCode === 0) {
        const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-c02-restore-'));
        const restoreRun = odCli(['restore', '--archive', archivePath, '--json'], odDataEnv(restoreDir));
        if (restoreRun.status !== 0) {
          problems.push('product surface missing: od restore');
        } else {
          const restoredDbPath = path.join(restoreDir, 'app.sqlite');
          if (fs.existsSync(restoredDbPath)) {
            const check = sh('sqlite3', [restoredDbPath, 'PRAGMA integrity_check;']);
            if (check.status !== 0 || check.stdout.trim() !== 'ok') problems.push('post-concurrent-mutation restored DB fails integrity_check');
            const journalMode = sh('sqlite3', [restoredDbPath, 'PRAGMA journal_mode;']).stdout.trim().toLowerCase();
            if (journalMode !== 'wal') problems.push(`journal_mode=${journalMode || 'unknown'} (WAL evidence expected of a real online backup)`);
          } else {
            problems.push('restored app.sqlite missing');
          }
          // Marker must be ABSENT (no evidence newer than the snapshot).
          const markerCheck = await verifyProjectFilesViaHttp(restoreDir, { sourceDir: fixture.sourceDir, projects: [{ id: markerProject.id, files: [{ name: markerName, content: 'post-backup-marker' }] }] }, 1);
          if (markerCheck.mismatches.length === 0) problems.push('post-backup marker file IS present in the restored snapshot -- restore includes writes newer than the backup');
          // Row-to-file referential consistency: every restored project row
          // must resolve to a real, fetchable file. Round-4 F2: a
          // vacuously-empty restored projects table must FAIL, not pass by
          // having nothing to iterate.
          const restoredProjectIds = sh('sqlite3', [restoredDbPath, 'SELECT id FROM projects;']).stdout.trim().split('\n').filter(Boolean);
          if (restoredProjectIds.length < fixture.projects.length) {
            problems.push(`restored project count (${restoredProjectIds.length}) is below the seeded count (${fixture.projects.length}) -- vacuous-empty restore is a fail, not a pass`);
          }
          let daemon: BootedDaemon | null = null;
          const orphanRows: string[] = [];
          try {
            daemon = await bootDaemonForProbing(restoreDir);
            for (const id of restoredProjectIds) {
              const original = fixture.projects.find((p) => p.id === id);
              if (!original || original.files.length === 0) continue;
              const f = original.files[0]!;
              const res = await fetch(`${daemon.url}/api/projects/${id}/raw/${encodeURIComponent(f.name)}`).catch(() => null);
              if (!res || res.status !== 200) orphanRows.push(id);
            }
          } finally {
            if (daemon) await daemon.kill();
          }
          if (orphanRows.length > 0) problems.push(`${orphanRows.length} restored project row(s) do not resolve to a real file: ${orphanRows.join(', ')}`);
        }
      }
      // r2b amendment 2026-07-28 (Sol REJECT r2-1): thresholds recalibrated to
      // what a CORRECT ~250ms backup can honestly produce inside its own
      // window (>=8 writes at 10ms cadence, snapshotted at child exit), and
      // the absolute 300ms floor -- which rejected a correct fast backup --
      // replaced by a coverage check that the writer window spanned the
      // child's entire lifetime (50ms start-jitter allowance).
      if (writerWrites < 8) problems.push(`writer loop only achieved ${writerWrites} real DB updates inside the backup window (want >=8 at 10ms cadence)`);
      if (writerDurationMs + 50 < childDurationMs) problems.push(`writer window (${writerDurationMs}ms) did not cover the backup child's lifetime (${childDurationMs}ms)`);
      if (uploadsDuringWindow < 1) problems.push('no real file uploads occurred during the backup window (want >=1)');

      const cliPath = path.join(repoRoot, 'apps/daemon/src/cli.ts');
      const entry = findSubcommandHandlerEntryPoint(cliPath, /^backup$/i);
      let reach: { ok: boolean; reachableFiles: string[] } = { ok: false, reachableFiles: [] };
      if (entry) reach = backupCallReachableFrom(entry);
      if (!entry) problems.push('no "backup" key found in cli.ts SUBCOMMAND_MAP -- product surface missing: od backup');
      else if (!reach.ok) problems.push(`no real .backup(...)/VACUUM INTO call reachable from the SUBCOMMAND_MAP "backup" handler (checked: ${reach.reachableFiles.join(', ')})`);

      const ok = problems.length === 0;
      record('C0-2', '', '', ok, JSON.stringify({ before, after, writerWrites, writerDurationMs, childDurationMs, uploadsDuringWindow, entry, reach }, null, 2), { detail: ok ? undefined : problems.join('; '), exitCode });
    },
  );

  await checkCriterion(
    'C0-3',
    'verifier selects 3 DISTINCT targets from the archive index it reads itself (sqlite-database entry, a projects-dir entry, manifest.json itself), flips a byte in each, and requires od restore to fail naming the corrupted class',
    'each corrupted restore attempt must exit non-zero with output containing the specific corrupted class name; a clean-copy control must pass the full C0-1 verification chain',
    async () => {
      if (!c01Fixture || !c01ArchivePath) {
        record('C0-3', '', '', false, '', { detail: 'C0-1 did not produce a real archive to corrupt (product surface missing upstream)' });
        return;
      }
      const fixture = c01Fixture;
      const archivePath = c01ArchivePath;
      const archiveIndex = readArchiveIndex(archivePath);
      if (!archiveIndex.ok) {
        record('C0-3', '', '', false, JSON.stringify(archiveIndex), { detail: `archive index unreadable: ${archiveIndex.problems.join('; ')}` });
        return;
      }
      const dbEntry = archiveIndex.classes.find((c) => c.class === 'sqlite-database' && c.absPath);
      const projectsEntry = archiveIndex.classes.find((c) => c.class === 'projects-dir' && c.absPath);
      const manifestPath = path.join(archivePath, 'manifest.json');
      // Round-4 F33: an archive-index entry may legitimately be a
      // directory (e.g. projects-dir). Select a real CONTAINED FILE to
      // byte-flip -- never fs.readFileSync a directory.
      function pickFileWithin(absPath: string, isDirectory: boolean): string | null {
        if (!isDirectory) return absPath;
        let found: string | null = null;
        (function walk(dir: string): void {
          if (found) return;
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (found) return;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) { found = full; return; }
          }
        })(absPath);
        return found;
      }
      const targets: { kind: string; absPath: string }[] = [
        ...(dbEntry?.absPath ? [{ kind: 'sqlite-database', absPath: pickFileWithin(dbEntry.absPath, dbEntry.isDirectory) }] : []),
        ...(projectsEntry?.absPath ? [{ kind: 'projects-dir', absPath: pickFileWithin(projectsEntry.absPath, projectsEntry.isDirectory) }] : []),
        { kind: 'manifest-entry', absPath: manifestPath },
      ].filter((t): t is { kind: string; absPath: string } => t.absPath !== null);
      const distinctPaths = new Set(targets.map((t) => t.absPath));
      const perTarget: { kind: string; ok: boolean; exit: number }[] = [];
      for (const { kind, absPath } of targets) {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `od-w0-corrupt-${kind}-`));
        try {
          const corruptedArchive = path.join(workDir, path.basename(archivePath));
          fs.cpSync(archivePath, corruptedArchive, { recursive: true });
          const relInArchive = path.relative(archivePath, absPath);
          const targetFile = path.join(corruptedArchive, relInArchive);
          // lstat before read -- never operate on a directory or a symlink.
          const targetLstat = fs.lstatSync(targetFile);
          if (targetLstat.isDirectory() || targetLstat.isSymbolicLink()) {
            perTarget.push({ kind, ok: false, exit: -1 });
            continue;
          }
          const buf = fs.readFileSync(targetFile);
          const offset = Math.floor(buf.length / 2);
          const before = buf[offset];
          buf[offset] = (buf[offset] ?? 0) ^ 0xff;
          fs.writeFileSync(targetFile, buf);
          const restoreTarget = fs.mkdtempSync(path.join(os.tmpdir(), `od-w0-corrupt-restore-${kind}-`));
          const run = odCli(['restore', '--archive', corruptedArchive, '--json'], odDataEnv(restoreTarget), 3 * 60_000);
          const combined = run.stdout;
          const namesCorruptionClass = combined.toLowerCase().includes(kind.toLowerCase()) || combined.toLowerCase().includes(kind.replace(/-/g, ' '));
          perTarget.push({ kind, ok: run.status !== 0 && before !== buf[offset] && namesCorruptionClass, exit: run.status });
          fs.rmSync(restoreTarget, { recursive: true, force: true });
        } finally {
          fs.rmSync(workDir, { recursive: true, force: true });
        }
      }
      // Clean control: must pass the FULL C0-1 chain, not just exit 0.
      const controlRestoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-c03-control-'));
      let controlOk = false;
      let controlEvidence = '';
      try {
        const controlRun = odCli(['restore', '--archive', archivePath, '--json'], odDataEnv(controlRestoreDir), 3 * 60_000);
        if (controlRun.status === 0) {
          const dbCheck = sh('sqlite3', [path.join(controlRestoreDir, 'app.sqlite'), 'PRAGMA integrity_check;']);
          const httpCheck = await verifyProjectFilesViaHttp(controlRestoreDir, fixture, 20);
          controlOk = dbCheck.status === 0 && dbCheck.stdout.trim() === 'ok' && httpCheck.ok;
          controlEvidence = JSON.stringify({ dbCheck: dbCheck.stdout.trim(), httpCheck });
        } else {
          controlEvidence = `control restore exited ${controlRun.status}: ${controlRun.stdout.slice(-500)}`;
        }
      } finally {
        fs.rmSync(controlRestoreDir, { recursive: true, force: true });
      }
      const ok = targets.length === 3 && distinctPaths.size === 3 && perTarget.every((t) => t.ok) && controlOk;
      record('C0-3', '', '', ok, JSON.stringify({ perTarget, distinctPaths: [...distinctPaths], controlOk, controlEvidence }, null, 2), {
        detail: ok ? undefined : `targets=${targets.length} distinct=${distinctPaths.size} failing=${perTarget.filter((t) => !t.ok).map((t) => t.kind).join(',')} controlOk=${controlOk}`,
      });
    },
  );

  await checkCriterion(
    'C0-4',
    'read the archive index directly (manifest.json inside the real archive); excluded classes must be ABSENT from the index, included classes PRESENT',
    'a class the doc marks excluded must NOT appear in the archive index (honest exclusion is now possible); a class marked included-flagged must appear; path escapes are rejected upstream by readArchiveIndex',
    () => {
      const rel = 'docs/security/backup-secret-inventory.json';
      interface SecretClassEntry { class: string; required: boolean; sensitive: boolean; policy: 'excluded' | 'included-flagged'; note?: string }
      const EXPECTED_SENSITIVE: Record<string, boolean> = { 'sqlite-database': false, 'projects-dir': false, 'library-assets': false, 'memory-markdown': false, 'app-config': false, 'mcp-config-tokens': true, 'connector-credentials': true, 'byok-keys': true };
      const MUST_BE_INCLUDED = ['sqlite-database', 'projects-dir', 'library-assets', 'memory-markdown', 'app-config'];
      if (!fileExists(rel)) {
        record('C0-4', '', '', false, '', { detail: `missing: ${rel}; required classes: ${REQUIRED_ARCHIVE_CLASSES.join(', ')}` });
        return;
      }
      let entries: SecretClassEntry[] = [];
      try {
        const raw = JSON.parse(readRepoFile(rel));
        if (!Array.isArray(raw)) throw new Error('top-level value must be an array');
        entries = raw as SecretClassEntry[];
      } catch (err) {
        record('C0-4', '', '', false, '', { detail: `invalid JSON: ${String(err)}` });
        return;
      }
      const byClass = new Map<string, SecretClassEntry>();
      for (const e of entries) byClass.set(e.class, e);
      const archiveIndex = c01ArchivePath ? readArchiveIndex(c01ArchivePath) : null;
      const problems: string[] = [];
      for (const cls of REQUIRED_ARCHIVE_CLASSES) {
        const row = byClass.get(cls);
        if (!row) { problems.push(`class "${cls}": missing from doc`); continue; }
        if (row.sensitive !== EXPECTED_SENSITIVE[cls]) problems.push(`class "${cls}": expected sensitive=${EXPECTED_SENSITIVE[cls]}, got ${row.sensitive}`);
        if (row.policy !== 'excluded' && row.policy !== 'included-flagged') problems.push(`class "${cls}": invalid policy ${String(row.policy)}`);
        if (MUST_BE_INCLUDED.includes(cls) && row.policy !== 'included-flagged') problems.push(`class "${cls}": required-for-restore data must be included-flagged`);
        if (row.policy === 'excluded' && (!row.note || row.note.trim().length < 10)) problems.push(`class "${cls}": policy=excluded requires a documented-gap note`);
        if (archiveIndex && archiveIndex.ok) {
          const presentInArchive = archiveIndex.classes.some((c) => c.class === cls && c.absPath);
          if (row.policy === 'included-flagged' && !presentInArchive) problems.push(`class "${cls}": doc says included-flagged but is ABSENT from the archive index`);
          if (row.policy === 'excluded' && presentInArchive) problems.push(`class "${cls}": doc says excluded but IS PRESENT in the archive index -- honest exclusion violated`);
        }
      }
      if (!archiveIndex) problems.push('C0-1 did not produce a readable archive to cross-check policy against');
      else if (!archiveIndex.ok) problems.push(...archiveIndex.problems);
      const ok = problems.length === 0;
      record('C0-4', '', '', ok, JSON.stringify({ entries, archiveIndex }, null, 2), { detail: ok ? undefined : problems.join('; ') });
    },
  );

  // =======================================================================
  // C0-5 / C0-6 / C0-7
  // =======================================================================
  await checkCriterion(
    'C0-5',
    'suite needles + JSON-verified red-at-parent worktree (workspace-symlink-corrected) + live HTTP against a verifier-booted daemon',
    'red spec verified via the parent run\'s own vitest JSON (genuine assertion FAILED, module-resolution/SyntaxError rejected) with verified worktree teardown, plus a live verifier-issued HTTP probe',
    async () => {
      const rejected = needleReport('(C0-5/reject)', 1);
      const accepted = needleReport('(C0-5/accept)', 1);
      const redFile = fileContainingNeedle('(C0-5/reject)');
      const red = await verifyRedAtParent(redFile ? [redFile] : [], '(C0-5/reject)', 'C0-5');
      let daemon: BootedDaemon | null = null;
      let liveRejectStatus = 0, liveAcceptStatus = 0;
      let liveError: string | undefined;
      try {
        daemon = await bootDaemonForProbing();
        const randomExtId = crypto.randomBytes(16).toString('hex');
        const rejectRes = await fetch(`${daemon.url}/api/library/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${randomExtId}` }, body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dzAtdmVyaWZpZXI=', filename: 'w0-verifier-reject-probe.txt' }) });
        liveRejectStatus = rejectRes.status;
        const pairRes = await fetch(`${daemon.url}/api/library/pair`, { method: 'POST', headers: { Host: '127.0.0.1' } });
        const pairBody = (await pairRes.json()) as { code?: string };
        const confirmExtId = crypto.randomBytes(16).toString('hex');
        const confirmRes = await fetch(`${daemon.url}/api/library/pair/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${confirmExtId}` }, body: JSON.stringify({ code: pairBody.code, extensionOrigin: `chrome-extension://${confirmExtId}` }) });
        const confirmBody = (await confirmRes.json()) as { token?: string };
        const acceptRes = await fetch(`${daemon.url}/api/library/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${confirmExtId}`, Authorization: confirmBody.token ? `Bearer ${confirmBody.token}` : '' }, body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dzAtdmVyaWZpZXI=', filename: 'w0-verifier-accept-probe.txt' }) });
        liveAcceptStatus = acceptRes.status;
      } catch (err) {
        liveError = String(err);
      } finally {
        if (daemon) await daemon.kill();
      }
      const finalOk = rejected.ok && accepted.ok && red.ok && (liveRejectStatus === 401 || liveRejectStatus === 403) && liveAcceptStatus === 200;
      record('C0-5', '', '', finalOk, `-- reject --\n${rejected.evidence}\n-- accept --\n${accepted.evidence}\n-- red --\n${red.evidence}\n-- live reject=${liveRejectStatus} accept=${liveAcceptStatus} --`, {
        detail: finalOk ? undefined : `suiteReject=${rejected.ok} suiteAccept=${accepted.ok} redAtParent=${red.ok} liveReject=${liveRejectStatus} liveAccept=${liveAcceptStatus}${liveError ? ` liveError=${liveError}` : ''}`,
      });
    },
  );

  // Round-3 F6: rotation/revocation must assert SEMANTICS, not status codes.
  await checkCriterion('C0-6', 'live HTTP: replay tested against the real pairing surface; revocation and rotation are tested on SEPARATE tokens from independent pairings (never chained on the same token); each must prove the OLD token is rejected and, for rotation, a NEW token is accepted -- a 204 no-op cannot pass', 'suite-title matches are never sufficient; endpoints fail with "endpoint missing: <which>" until they exist; once they exist, semantics are asserted per-token, not chained', async () => {
    let daemon: BootedDaemon | null = null;
    let replayOk = false, replayDetail = '';
    let revocationEndpoint: { method: string; path: string } | undefined;
    let rotationEndpoint: { method: string; path: string } | undefined;
    let revocationOk = false, rotationOk = false;
    // Round-4 F6: mint an INDEPENDENT token via its own pair/confirm flow.
    // Chaining revoke-then-rotate (or vice versa) on one token makes the two
    // semantics mutually exclusive for a CORRECT implementation.
    async function mintToken(url: string): Promise<{ token: string | undefined; ext: string }> {
      const pairRes = await fetch(`${url}/api/library/pair`, { method: 'POST', headers: { Host: '127.0.0.1' } });
      const pairBody = (await pairRes.json()) as { code?: string };
      const ext = crypto.randomBytes(16).toString('hex');
      const confirmRes = await fetch(`${url}/api/library/pair/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${ext}` }, body: JSON.stringify({ code: pairBody.code, extensionOrigin: `chrome-extension://${ext}` }) });
      const confirmBody = (await confirmRes.json()) as { token?: string };
      return { token: confirmBody.token, ext };
    }
    try {
      daemon = await bootDaemonForProbing();
      const replaySrc = await mintToken(daemon.url);
      const extB = crypto.randomBytes(16).toString('hex');
      const replayRes = await fetch(`${daemon.url}/api/library/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${extB}`, Authorization: replaySrc.token ? `Bearer ${replaySrc.token}` : '' }, body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dzAtdmVyaWZpZXI=', filename: 'w0-verifier-replay-probe.txt' }) });
      replayOk = replayRes.status === 401 || replayRes.status === 403;
      replayDetail = `replay status=${replayRes.status}`;

      revocationEndpoint = daemon.routeInventory.find((r) => /library/i.test(r.path) && (/revoke/i.test(r.path) || (r.method === 'DELETE' && /token/i.test(r.path))));
      rotationEndpoint = daemon.routeInventory.find((r) => /library/i.test(r.path) && /rotate/i.test(r.path));
      if (revocationEndpoint) {
        // Token B: used ONLY for the revocation lifecycle.
        const revokeSrc = await mintToken(daemon.url);
        await fetch(`${daemon.url}${revocationEndpoint.path}`, { method: revocationEndpoint.method, headers: { Authorization: revokeSrc.token ? `Bearer ${revokeSrc.token}` : '' } });
        const postRevokeRes = await fetch(`${daemon.url}/api/library/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${revokeSrc.ext}`, Authorization: revokeSrc.token ? `Bearer ${revokeSrc.token}` : '' }, body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dzAtdmVyaWZpZXI=', filename: 'w0-verifier-post-revoke.txt' }) });
        revocationOk = postRevokeRes.status === 401 || postRevokeRes.status === 403;
      }
      if (rotationEndpoint) {
        // Token C: an INDEPENDENT mint used ONLY for the rotation lifecycle
        // -- never the token that was just revoked above.
        const rotateSrc = await mintToken(daemon.url);
        const rotateRes = await fetch(`${daemon.url}${rotationEndpoint.path}`, { method: rotationEndpoint.method, headers: { Authorization: rotateSrc.token ? `Bearer ${rotateSrc.token}` : '' } });
        const rotateBody = (await rotateRes.json().catch(() => ({}))) as { token?: string };
        const oldTokenRes = await fetch(`${daemon.url}/api/library/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${rotateSrc.ext}`, Authorization: rotateSrc.token ? `Bearer ${rotateSrc.token}` : '' }, body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dzAtdmVyaWZpZXI=', filename: 'w0-verifier-old-token-post-rotate.txt' }) });
        const oldTokenRejected = oldTokenRes.status === 401 || oldTokenRes.status === 403;
        let newTokenAccepted = false;
        if (rotateBody.token) {
          const newTokenRes = await fetch(`${daemon.url}/api/library/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${rotateSrc.ext}`, Authorization: `Bearer ${rotateBody.token}` }, body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dzAtdmVyaWZpZXI=', filename: 'w0-verifier-new-token-post-rotate.txt' }) });
          newTokenAccepted = newTokenRes.status === 200;
        }
        rotationOk = oldTokenRejected && newTokenAccepted;
      }
    } finally {
      if (daemon) await daemon.kill();
    }
    const detail = [replayOk ? undefined : `replay: ${replayDetail}`, revocationEndpoint ? (revocationOk ? undefined : 'revocation endpoint found but semantic check failed (old token still accepted)') : 'endpoint missing: revocation', rotationEndpoint ? (rotationOk ? undefined : 'rotation endpoint found but semantic check failed (old-rejected + new-accepted not both true)') : 'endpoint missing: rotation'].filter(Boolean);
    const ok = replayOk && revocationOk && rotationOk;
    record('C0-6', '', '', ok, JSON.stringify({ replayOk, revocationEndpoint, revocationOk, rotationEndpoint, rotationOk }, null, 2), { detail: ok ? undefined : detail.join('; ') });
  });

  // Round-7 F7 closure (docs/plans/waves/DECISIONS.md "W0 gate F7 closure",
  // Candidate B ADOPT-WITH-CHANGES, binding): free text is evidence-only and
  // never authorizes a probing skip. The ONLY authorization mechanism is an
  // orchestrator-owned, out-of-repo allowlist supplied at gate run time via
  // --unreachable-allowlist or W0_UNREACHABLE_ALLOWLIST (flag wins). FAIL
  // CLOSED: absent/unreadable/unparsable/malformed => authorized-skip set is
  // EMPTY, never inferred or defaulted from anything in-repo.
  // Round-final coordinator ruling, items 2/3: the allowlist schema now
  // carries a typed entryClass. Existing entries (no entryClass in the raw
  // JSON) normalize to 'dynamic-row' at load time -- semantics unchanged,
  // exactly the pre-existing F7 mechanism. 'canary-unreachable' (item 2,
  // C0-7) binds to {method, path} like 'dynamic-row' but does NOT reuse
  // {file, line} as a row-matching key -- for this class file/line are the
  // entry's OWN fingerprint/commit-binding anchor (any source line the
  // orchestrator chooses, e.g. within privileged-routes.json), unrelated to
  // the row's AST site. 'sampling-excluded' (item 3, C0-10) binds to
  // {capability} instead of {method, path}. reason is free text,
  // evidence-only -- it never itself authorizes anything beyond what
  // entryClass + the binding fields grant.
  type AllowlistEntryClass = 'dynamic-row' | 'canary-unreachable' | 'sampling-excluded';
  const ALLOWLIST_ENTRY_CLASSES: readonly AllowlistEntryClass[] = ['dynamic-row', 'canary-unreachable', 'sampling-excluded'];
  interface UnreachableAllowlistEntry {
    file: string; line: number; sourceFingerprint: string; commit: string;
    entryClass: AllowlistEntryClass; // normalized at load time; absent in the raw JSON defaults to 'dynamic-row'
    method?: string; path?: string; // required (validated at load) for 'dynamic-row' and 'canary-unreachable'
    capability?: string; // required (validated at load) for 'sampling-excluded'
    reason?: string;
  }
  type AllowlistStatus = 'absent' | 'unreadable' | 'invalid' | `loaded:${number}`;
  function loadUnreachableAllowlist(): { entries: UnreachableAllowlistEntry[]; status: AllowlistStatus } {
    if (!unreachableAllowlistPath) return { entries: [], status: 'absent' };
    let raw: string;
    try {
      raw = fs.readFileSync(unreachableAllowlistPath, 'utf8');
    } catch {
      return { entries: [], status: 'unreadable' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { entries: [], status: 'invalid' };
    }
    if (!Array.isArray(parsed)) return { entries: [], status: 'invalid' };
    const entries: UnreachableAllowlistEntry[] = [];
    for (const e of parsed) {
      if (!isRecord(e)) return { entries: [], status: 'invalid' };
      const rawClass = e.entryClass;
      if (rawClass !== undefined && !(typeof rawClass === 'string' && (ALLOWLIST_ENTRY_CLASSES as readonly string[]).includes(rawClass))) {
        return { entries: [], status: 'invalid' };
      }
      const entryClass: AllowlistEntryClass = rawClass === undefined ? 'dynamic-row' : (rawClass as AllowlistEntryClass);
      const baseValid =
        typeof e.file === 'string' &&
        typeof e.line === 'number' &&
        typeof e.sourceFingerprint === 'string' &&
        typeof e.commit === 'string' &&
        (e.reason === undefined || typeof e.reason === 'string');
      const classValid =
        entryClass === 'sampling-excluded'
          ? typeof e.capability === 'string' && e.capability.trim().length > 0
          : typeof e.method === 'string' && typeof e.path === 'string'; // 'dynamic-row' and 'canary-unreachable'
      if (!baseValid || !classValid) return { entries: [], status: 'invalid' }; // any malformed entry invalidates the WHOLE file -- fail closed, not partial-trust
      entries.push({ ...(e as Record<string, unknown>), entryClass } as unknown as UnreachableAllowlistEntry);
    }
    return { entries, status: `loaded:${entries.length}` };
  }
  // sourceFingerprint binds an entry to the EXACT current-tree source line at
  // {file, line}: lowercase hex sha256 of the trimmed line text, recomputed
  // at gate run (never trusted from the entry or cached). File missing, line
  // out of range, or hash mismatch is a STALE entry -- a hard fail, since a
  // stale entry means the entry no longer describes what it claims to.
  function computeSourceLineFingerprint(relFile: string, line: number): { ok: boolean; hash: string | null; reason?: string } {
    const abs = path.join(repoRoot, relFile);
    if (!fs.existsSync(abs)) return { ok: false, hash: null, reason: 'file missing' };
    let text: string;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      return { ok: false, hash: null, reason: `unreadable: ${String(err)}` };
    }
    const lines = text.split('\n');
    if (!Number.isInteger(line) || line < 1 || line > lines.length) return { ok: false, hash: null, reason: `line ${line} out of range (file has ${lines.length} lines)` };
    const trimmed = (lines[line - 1] ?? '').trim();
    return { ok: true, hash: sha256Bytes(trimmed) };
  }

  // Round-8 F7 (R8-F1, docs/plans/waves/DECISIONS.md): `commit` is not
  // provenance-only -- it participates in authorization. An entry is valid
  // only when ALL THREE hold: (1) syntactically a full 40-char lowercase hex
  // sha; (2) resolves to a real commit object in THIS repo AND is an
  // ancestor-or-equal of the evaluated HEAD (rules out fabricated or
  // foreign/abandoned-branch shas); (3) the source line at entry.file:line
  // AS OF entry.commit hashes to entry.sourceFingerprint (proves the entry
  // was genuinely authored against real history, not just a syntactically
  // valid sha borrowed from somewhere unrelated). This is layered ON TOP of
  // computeSourceLineFingerprint's current-tree check -- both must pass.
  type CommitValidationStatus = 'ok' | 'not-hex' | 'unknown-commit' | 'not-ancestor' | 'fingerprint-mismatch-at-commit';
  function validateEntryCommitBinding(e: UnreachableAllowlistEntry): { status: CommitValidationStatus; detail?: string } {
    if (!/^[0-9a-f]{40}$/.test(e.commit)) return { status: 'not-hex', detail: `"${e.commit}" is not a full 40-char lowercase hex sha` };
    const catFile = sh('git', ['cat-file', '-e', `${e.commit}^{commit}`]);
    if (catFile.status !== 0) return { status: 'unknown-commit', detail: `"${e.commit}" does not resolve to a commit object in this repository` };
    const ancestorCheck = sh('git', ['merge-base', '--is-ancestor', e.commit, headSha]);
    if (ancestorCheck.status !== 0) return { status: 'not-ancestor', detail: `"${e.commit}" is not an ancestor-or-equal of the evaluated HEAD (${headSha})` };
    let textAtCommit: string;
    try {
      textAtCommit = readFileAtCommit(e.commit, e.file);
    } catch (err) {
      return { status: 'fingerprint-mismatch-at-commit', detail: `could not read ${e.file} at ${e.commit}: ${String(err)}` };
    }
    const linesAtCommit = textAtCommit.split('\n');
    if (!Number.isInteger(e.line) || e.line < 1 || e.line > linesAtCommit.length) {
      return { status: 'fingerprint-mismatch-at-commit', detail: `line ${e.line} out of range at ${e.commit} (file had ${linesAtCommit.length} lines)` };
    }
    const trimmedAtCommit = (linesAtCommit[e.line - 1] ?? '').trim();
    const hashAtCommit = sha256Bytes(trimmedAtCommit);
    if (hashAtCommit.toLowerCase() !== e.sourceFingerprint.toLowerCase()) {
      return { status: 'fingerprint-mismatch-at-commit', detail: `recomputed-at-commit ${hashAtCommit} != declared ${e.sourceFingerprint}` };
    }
    return { status: 'ok' };
  }

  await checkCriterion(
    'C0-7',
    'two-pass alias-aware AST extraction (local const aliases, property chains, constant paths) over apps/daemon/src/routes/** + server.ts; unresolvable-path guarded registrations must be explicitly acknowledged as dynamic in the inventory',
    'inventory row without a live route = fail; guarded live route missing from inventory = fail; an unresolvable-path guarded registration not explicitly marked dynamic in the inventory = fail; every row is probed TWICE -- once with an explicitly hostile browser Origin (https://evil.invalid), expecting rejection (401/403), and once with NO Origin header at all (the local CLI\'s own request shape), expecting an EXPLICIT success: 2xx by default, or the row\'s own declared expectedLocalStatus for routes whose genuine local success is legitimately non-2xx -- expectedLocalStatus may NEVER declare -1, 400, 401, 403, 404, or any 5xx (structurally forbidden, named, at validation time -- a lazy expectedLocalStatus: 403 can never bless the guard\'s own rejection as "success", and a lazy expectedLocalStatus: 404 can never bless a placeholder-ID 404 as "success"); a static row whose path is parameterized REQUIRES a declared probePath with a concrete value (a declared-but-STILL-parameterized probePath, e.g. one that still contains :id syntax, counts as missing exactly like no declaration), and any probed row with a body-bearing method REQUIRES a declared probeBody -- both support \'<nonceProjectId>\' SUBSTRING substitution (every occurrence within the string, including one embedded in a larger URL/token, not just an exact-match value) against a REAL project seeded fresh after every daemon boot (initial or reboot); ANY remaining unresolved <...> placeholder token after substitution is itself a named structural failure; probePath/probeBody resolution happens LAZILY per probe phase, strictly AFTER that phase\'s ensureDaemonAlive liveness check, so a reboot\'s freshly-seeded nonce is always the one actually used (never a stale nonce from the daemon instance that just died) -- every probe result records the daemon generation (boot count) its substitution resolved against; a row missing any declaration fails BY NAME; requireLocalDaemonRequest exists to stop a malicious web page, not a genuine local caller, so origin-LESS success and hostile-Origin rejection are both required, honestly, against the current product; every daemon reboot triggered mid-probe (e.g. a route with a genuine local side effect) is logged with the row/phase whose probe ACTUALLY PRECEDED the death (never the upcoming probe) and the new daemon generation it produced, and settles that preceding row\'s own result BEFORE the reboot -- a reboot can never retroactively convert a row\'s failure into a pass; a dynamic row without probePath may skip probing ONLY when authorized by an orchestrator-owned allowlist (--unreachable-allowlist / W0_UNREACHABLE_ALLOWLIST) -- absent/unreadable/invalid allowlist = zero authorized skips (fail-closed); each allowlist entry binds to {file, line, method, path}, a source-line sha256 fingerprint recomputed from the CURRENT tree, AND a commit that must be (1) a full 40-char lowercase hex sha, (2) a real commit object in this repository that is an ancestor-or-equal of the evaluated HEAD, and (3) the commit the source line was AUTHORED against -- the fingerprint must independently match both the current tree AND `git show <commit>:<file>` at that line; any of these failing makes the entry INVALID, same hard-fail bucket as stale; entries must match exactly one claiming row 1:1 (duplicate entries, unused entries, and unauthorized claiming rows are all hard fails); a row\'s free-text "unreachable" string is surfaced in evidence but never authorizes anything; hard-fail when authorizedUnreachable*2 >= totalDynamic (nonempty set, exactly-half included); a typed canary-unreachable allowlist entry (bound to {method, path} + a source fingerprint + commit, same rigor as the dynamic-row class) waives ONLY the origin-less success canary for its one exact row -- hostile-Origin rejection and every structural check remain fully mandatory for that row, and waived rows also count toward a strict less-than-half cap over the full route inventory',
    async () => {
      const rel = 'apps/daemon/src/security/privileged-routes.json';
      if (!fileExists(rel)) {
        record('C0-7', '', '', false, '', { detail: `missing: ${rel}` });
        return;
      }
      let routes: { method: string; path: string; dynamic?: boolean; file?: string; line?: number; probePath?: string; unreachable?: string; expectedLocalStatus?: number; probeBody?: unknown }[] = [];
      try {
        const raw = JSON.parse(readRepoFile(rel));
        if (!Array.isArray(raw)) throw new Error('top-level value must be an array');
        routes = raw as { method: string; path: string; dynamic?: boolean; file?: string; line?: number; probePath?: string; unreachable?: string; expectedLocalStatus?: number; probeBody?: unknown }[];
      } catch (err) {
        record('C0-7', '', '', false, '', { detail: `invalid JSON: ${String(err)}` });
        return;
      }
      const validRows = routes.filter((r) => isRecord(r) && typeof r.method === 'string' && typeof r.path === 'string');
      const dedupKeys = new Set(validRows.map((r) => `${r.method} ${r.path}`));
      const { guarded, unresolvable } = staticRequireLocalDaemonRequestRoutesAndDynamics();
      const baselineKeys = new Set(guarded.map((b) => `${b.method} ${b.path}`));
      // Round-4 F7: a dynamic row is no longer acknowledged by COUNT alone --
      // it must bind to a specific {file, line} unresolvable-guard site
      // discovered by the AST pass. Round-5 F7: the binding must be a
      // strict 1:1 BIJECTION (two rows on one site = fail, same as a site
      // with no row).
      const dynamicRows = validRows.filter((r) => r.dynamic === true);
      const siteKey = (s: { file: string; line: number }) => `${s.file}:${s.line}`;
      const unresolvableKeys = new Set(unresolvable.map(siteKey));
      const dynamicRowKeys = dynamicRows.map((r) => (typeof r.file === 'string' && typeof r.line === 'number' ? `${r.file}:${r.line}` : null));
      const dynamicRowsUnbound = dynamicRows.filter((r, i) => dynamicRowKeys[i] === null || !unresolvableKeys.has(dynamicRowKeys[i] as string));
      const keyCounts = new Map<string, number>();
      for (const k of dynamicRowKeys) if (k !== null) keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
      const dynamicRowsDuplicateBinding = dynamicRows.filter((r, i) => dynamicRowKeys[i] !== null && (keyCounts.get(dynamicRowKeys[i] as string) ?? 0) > 1);
      const boundRowKeys = new Set(dynamicRowKeys.filter((k): k is string => k !== null));
      const unresolvableSitesUnacknowledged = unresolvable.filter((s) => !boundRowKeys.has(siteKey(s)));

      // Round-7 F7: allowlist-based authorization. A "claiming" row is a
      // dynamic row with no probePath -- it needs authorization to skip
      // probing. probedDynamicRows (has probePath) never need the allowlist.
      const probedDynamicRows = dynamicRows.filter((r) => typeof r.probePath === 'string');
      const claimingRows = dynamicRows.filter((r) => typeof r.probePath !== 'string');
      const { entries: allowlistEntries, status: allowlistStatus } = loadUnreachableAllowlist();
      // Round-final coordinator ruling (Sol REJECT, finding 2): C0-7 must
      // judge ONLY its own entryClasses (dynamic-row, canary-unreachable) --
      // a sampling-excluded entry belongs to C0-10 exclusively, including
      // its OWN staleness/duplicate/unused validation. The shared allowlist
      // file is read once here (loadUnreachableAllowlist), but every check
      // below that inspects "every entry" is scoped to c07OwnedEntries, not
      // allowlistEntries, so a sampling-excluded entry -- stale, duplicate,
      // or otherwise -- can never fail C0-7. No entry escapes validation
      // entirely: C0-10 independently loads the same file and fully
      // validates entryClass === 'sampling-excluded' entries on its own.
      const c07OwnedEntries = allowlistEntries.filter((e) => e.entryClass === 'dynamic-row' || e.entryClass === 'canary-unreachable');

      // Duplicate entries: two entries on the same {file, line} are
      // ambiguous (which one governs the source fingerprint?) -- hard fail.
      const entryKey = (e: UnreachableAllowlistEntry) => `${e.file}:${e.line}`;
      const entryKeyCounts = new Map<string, number>();
      for (const e of c07OwnedEntries) entryKeyCounts.set(entryKey(e), (entryKeyCounts.get(entryKey(e)) ?? 0) + 1);
      const duplicateAllowlistEntriesByFileLine = c07OwnedEntries.filter((e) => (entryKeyCounts.get(entryKey(e)) ?? 0) > 1);

      // Staleness: every entry's fingerprint is recomputed from the CURRENT
      // tree, never trusted from the entry itself. Round-8 F7: commit
      // binding is validated too (syntactic + real/ancestor + authored-
      // against fingerprint match) and folded into the SAME hard-fail
      // bucket as staleness -- an entry with an empty, fabricated, or
      // foreign/prior-HEAD commit is exactly as invalid as one with a
      // mismatched current-tree hash.
      const staleAllowlistEntries: { entry: UnreachableAllowlistEntry; reason: string }[] = [];
      const commitValidationByEntry = new Map<UnreachableAllowlistEntry, { status: CommitValidationStatus; detail?: string }>();
      for (const e of c07OwnedEntries) {
        const fp = computeSourceLineFingerprint(e.file, e.line);
        if (!fp.ok) staleAllowlistEntries.push({ entry: e, reason: fp.reason ?? 'unresolvable' });
        else if (fp.hash?.toLowerCase() !== e.sourceFingerprint.toLowerCase()) staleAllowlistEntries.push({ entry: e, reason: `fingerprint mismatch: recomputed ${fp.hash} != declared ${e.sourceFingerprint}` });
        const commitValidation = validateEntryCommitBinding(e);
        commitValidationByEntry.set(e, commitValidation);
        if (commitValidation.status !== 'ok') staleAllowlistEntries.push({ entry: e, reason: `commit-binding invalid (${commitValidation.status}): ${commitValidation.detail ?? ''}` });
      }

      // 1:1 matching: an entry authorizes a row only when file+line+method+
      // path ALL match (row method+path is already globally unique via
      // dedupKeys, so at most one row can match a given entry this way).
      // Round-final coordinator ruling, item 2: scoped to entryClass ===
      // 'dynamic-row' entries only -- a 'canary-unreachable' or
      // 'sampling-excluded' entry's own {file, line} point at a DIFFERENT
      // thing (its own fingerprint/commit-binding anchor, not an AST call
      // site) and must never be judged "unused" from this class's
      // perspective, nor treated as authorizing a probing skip here.
      const rowMatchesEntry = (r: { file?: string; line?: number; method: string; path: string }, e: UnreachableAllowlistEntry) => r.file === e.file && r.line === e.line && r.method === e.method && r.path === e.path;
      const dynamicRowClassEntries = c07OwnedEntries.filter((e) => e.entryClass === 'dynamic-row');
      const authorizedRows = claimingRows.filter((r) => dynamicRowClassEntries.some((e) => rowMatchesEntry(r, e)));
      const unauthorizedClaimingRows = claimingRows.filter((r) => !dynamicRowClassEntries.some((e) => rowMatchesEntry(r, e)));
      const unusedDynamicRowEntries = dynamicRowClassEntries.filter((e) => !claimingRows.some((r) => rowMatchesEntry(r, e)));
      // An unauthorized claiming row is functionally the same failure class
      // as a row with neither probePath nor authorization -- it cannot be
      // probed and it is not allowlist-cleared, so it is "missing" either way.
      const dynamicRowsMissingProbePathOrReason = unauthorizedClaimingRows;

      // Round-7 F7: majority gate now counts AUTHORIZED-unreachable rows
      // only (free text carries no weight), and the ruling is >= not > --
      // exactly-half (e.g. 1 of 2) now also hard-fails.
      const majorityUnreachable = dynamicRows.length > 0 && authorizedRows.length * 2 >= dynamicRows.length;

      // Round-final coordinator ruling, item 2: typed allowlist class
      // 'canary-unreachable' -- waives ONLY the origin-less success canary
      // for one exact row (bound by {method, path}, NOT dynamic-row's
      // {file, line, method, path} -- this class's file/line are its own
      // fingerprint/commit-binding anchor). Hostile-Origin rejection and
      // every structural check (probePath/probeBody declarations,
      // forbidden expectedLocalStatus, live-route membership, etc.) remain
      // fully mandatory for a waived row -- unaffected, since none of those
      // checks consult this waiver. Applies to ANY row (static or dynamic),
      // not just the dynamic-row subset -- the two classes address
      // different problems (dynamic-row: the row's real path is
      // unresolvable, so it cannot be probed at all; canary-unreachable:
      // the row CAN be probed, but its origin-less canary cannot honestly
      // succeed in this gate's environment).
      const canaryUnreachableClassEntries = c07OwnedEntries.filter((e) => e.entryClass === 'canary-unreachable');
      const rowMatchesCanaryEntry = (r: { method: string; path: string }, e: UnreachableAllowlistEntry) => r.method === e.method && r.path === e.path;
      const unusedCanaryUnreachableEntries = canaryUnreachableClassEntries.filter((e) => !validRows.some((r) => rowMatchesCanaryEntry(r, e)));
      // Duplicate: two canary-unreachable entries claiming the SAME
      // {method, path} row are ambiguous even when their own {file, line}
      // binding anchors differ (so the generic file:line dup check above
      // would not catch this on its own).
      const canaryEntryRowKeyCounts = new Map<string, number>();
      for (const e of canaryUnreachableClassEntries) { const k = `${e.method} ${e.path}`; canaryEntryRowKeyCounts.set(k, (canaryEntryRowKeyCounts.get(k) ?? 0) + 1); }
      const duplicateCanaryUnreachableEntries = canaryUnreachableClassEntries.filter((e) => (canaryEntryRowKeyCounts.get(`${e.method} ${e.path}`) ?? 0) > 1);
      const unusedAllowlistEntries = [...unusedDynamicRowEntries, ...unusedCanaryUnreachableEntries];
      const duplicateAllowlistEntriesSet = new Set<UnreachableAllowlistEntry>([
        ...duplicateAllowlistEntriesByFileLine,
        ...duplicateCanaryUnreachableEntries,
      ]);
      const duplicateAllowlistEntries = [...duplicateAllowlistEntriesSet];
      // Fail-closed: only a VALID (non-stale, non-duplicate, non-unused)
      // canary-unreachable entry actually waives anything.
      const invalidCanaryUnreachableEntries = new Set<UnreachableAllowlistEntry>([
        ...staleAllowlistEntries.filter((s) => s.entry.entryClass === 'canary-unreachable').map((s) => s.entry),
        ...duplicateCanaryUnreachableEntries,
        ...unusedCanaryUnreachableEntries,
      ]);
      const validCanaryUnreachableEntries = canaryUnreachableClassEntries.filter((e) => !invalidCanaryUnreachableEntries.has(e));
      function findCanaryWaiver(row: { method: string; path: string }): UnreachableAllowlistEntry | undefined {
        return validCanaryUnreachableEntries.find((e) => rowMatchesCanaryEntry(row, e));
      }
      // Item 2: canary-unreachable waivers ALSO count toward a strict
      // less-than-half cap, but over the FULL route inventory (validRows,
      // "the 27 rows") -- not just the dynamic-row subset majorityUnreachable
      // already gates.
      const canaryWaivedRows = validRows.filter((r) => findCanaryWaiver(r) !== undefined);
      const canaryUnreachableMajorityExceeded = validRows.length > 0 && canaryWaivedRows.length * 2 >= validRows.length;

      // Round-9 C0-7 amendment (docs/plans/waves/DECISIONS.md "W0 gate
      // adjudication", GPT-5.6 Sol reviewer-of-record, GATE-DEFECT):
      // requireLocalDaemonRequest exists to reject a MALICIOUS WEB PAGE
      // (cross-origin browser fetch), not a genuine local caller -- an
      // origin-LESS request is exactly the CLI's own request shape (see
      // C0-5's origin-less /api/library/pair probe, which already succeeds
      // today). The old probe sent NO Origin header at all and demanded
      // 401/403, which is backwards: it was testing "does this route reject
      // the CLI's own shape", not "does this route reject a hostile page".
      // Two SEPARATE probes now run against the identical row set, honestly,
      // with no shared local-call middleware touched:
      //   (1) hostileOriginResults -- Origin: https://evil.invalid, expect
      //       401/403 (this IS the security property C0-7 verifies).
      //   (2) localSuccessCanaryResults -- no Origin header at all (the
      //       CLI's real shape), expect NOT 401/403 (the guard must not
      //       reject genuine local callers).
      const HOSTILE_ORIGIN = 'https://evil.invalid';
      let daemon: BootedDaemon | null = null;
      // Round-11 RULING A (docs/plans/waves/DECISIONS.md, adjudicator-
      // extended scope): the canary must be honestly satisfiable with REAL
      // data, not just "not rejected." A row's probePath (now usable for
      // BOTH static and dynamic rows, as a concrete override of row.path)
      // and probeBody (an equivalent JSON request body) both support the
      // '<nonceProjectId>' placeholder convention already used by C0-10's
      // manifest. A static row whose path is parameterized and supplies no
      // probePath, or any probed row with a body-bearing method and no
      // probeBody, is a MISSING DECLARATION -- named, hard fail -- rather
      // than being silently probed with fake placeholder data that produces
      // a meaningless 400/404 blessed away by expectedLocalStatus.
      const BODY_BEARING_METHODS = new Set(['POST', 'PUT', 'PATCH']);
      const probedRowSet = validRows.filter((r) => !r.dynamic || typeof r.probePath === 'string');
      // Round-13 (Sol confirmation, single surviving finding): the
      // parameterized-syntax check must apply to EVERY declared probePath,
      // UNCONDITIONALLY -- regardless of row kind (static/dynamic) and
      // regardless of whether the row's OWN path is parameterized. The
      // round-12 version only checked static rows whose own path already
      // had :param syntax, so (i) a static non-parameterized row with a
      // parameterized probePath override, and (ii) any dynamic row whose
      // declared probePath itself contains :param syntax, both bypassed
      // the check and were silently rewritten to the dummy probe id.
      // Simplified to two independent rules, one pass, no special-casing:
      //   1. MISSING declaration -- only meaningful for a static row whose
      //      own path is parameterized and supplies no probePath at all
      //      (dynamic rows have their own F7 allowlist-governed
      //      requirement for probePath, unrelated to this rule).
      //   2. INVALID declaration -- ANY row, static or dynamic, whose
      //      DECLARED probePath still contains :param syntax, independent
      //      of whether the row's own base path is parameterized.
      const rowsMissingProbePathDeclaration = probedRowSet.filter((r) => !r.dynamic && /:[a-zA-Z]+/.test(r.path) && typeof r.probePath !== 'string');
      const rowsWithParameterizedProbePath = validRows.filter((r) => typeof r.probePath === 'string' && /:[a-zA-Z]+/.test(r.probePath));
      const rowsMissingRealisticProbePath = [...rowsMissingProbePathDeclaration, ...rowsWithParameterizedProbePath];
      const rowsMissingProbeBody = probedRowSet.filter((r) => BODY_BEARING_METHODS.has(r.method) && r.probeBody === undefined);
      // Round-11 F1 / Round-12 (1d, C0-7-LOCAL-CANARY-FAILOPEN): a row can
      // no longer declare expectedLocalStatus in {-1, 400, 401, 403, 404} or
      // any 5xx. Ruling A's own text ("placeholder 400/404 responses cannot
      // count as success") extends the forbidden set beyond the guard-
      // rejection codes (401/403) to the placeholder-data codes (400/404)
      // too -- a lazy implementer could otherwise declare
      // expectedLocalStatus: 404 and have a fake-ID 404 count as success.
      // Forbidden structurally (validation-time, named), not just at runtime.
      function isForbiddenExpectedLocalStatus(status: number): boolean {
        return status === -1 || status === 400 || status === 401 || status === 403 || status === 404 || (status >= 500 && status < 600);
      }
      const rowsWithForbiddenExpectedLocalStatus = validRows.filter((r) => typeof r.expectedLocalStatus === 'number' && isForbiddenExpectedLocalStatus(r.expectedLocalStatus));
      const hostileOriginResults: { method: string; path: string; status: number; daemonGeneration: number }[] = [];
      const localSuccessCanaryResults: { method: string; path: string; status: number; expected: number | '2xx'; ok: boolean; daemonGeneration: number; waived: boolean; waivedReason?: string | undefined }[] = [];
      const rowsWithUnresolvedPlaceholder: { method: string; path: string; phase: 'hostile' | 'canary'; remaining: string[] }[] = [];
      let liveRouteKeys = new Set<string>();
      const rebootLog: { triggeringRow: string; phase: 'hostile' | 'canary'; newDaemonGeneration: number }[] = [];
      let currentNonceProjectId: string | null = null;
      // Round-12 C0-7-REBOOT-NONCE-STALE: daemonGeneration increments on
      // every FRESH boot (initial + every reboot). Recorded per probe result
      // so evidence shows exactly which daemon instance's seeded fixture
      // each row's substitution resolved against.
      let daemonGeneration = 0;
      // Round-11 F2 (C0-7 reboot attribution, second pass): the reboot
      // record must name the row/phase whose probe PRECEDED the death, not
      // the row about to be probed next. lastProbed tracks the most
      // recently COMPLETED probe attempt (updated immediately after each
      // fetch settles, success or failure); ensureDaemonAlive reads THAT --
      // never a caller-supplied "upcoming" label -- when it needs to log
      // who actually killed the daemon. A reboot only ever runs BEFORE the
      // NEXT probe attempt; it can never retroactively change a result
      // already pushed to hostileOriginResults/localSuccessCanaryResults.
      let lastProbed: { row: string; phase: 'hostile' | 'canary' } | null = null;
      async function ensureDaemonAlive(current: BootedDaemon | null): Promise<BootedDaemon> {
        const alive = current ? await fetch(`${current.url}/api/health`).then(() => true).catch(() => false) : false;
        if (alive) return current as BootedDaemon;
        daemonGeneration += 1;
        rebootLog.push({ triggeringRow: lastProbed ? lastProbed.row : '(initial boot)', phase: lastProbed ? lastProbed.phase : 'hostile', newDaemonGeneration: daemonGeneration });
        if (current) await current.kill().catch(() => undefined);
        const fresh = await bootDaemonForProbing();
        liveRouteKeys = new Set(fresh.routeInventory.map((r) => `${r.method} ${r.path}`));
        // Deterministic fixture setup after EVERY fresh boot (Ruling A) --
        // a fresh daemon has empty state, so '<nonceProjectId>' can only
        // resolve to something real if a project is seeded on THIS instance.
        const nonce = `w0-c07-fixture-${crypto.randomBytes(8).toString('hex')}`;
        await fetch(`${fresh.url}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: nonce, name: nonce }) }).catch(() => undefined);
        currentNonceProjectId = nonce;
        return fresh;
      }
      function isCanarySuccess(row: { expectedLocalStatus?: number }, status: number): boolean {
        if (isForbiddenExpectedLocalStatus(status)) return false;
        if (typeof row.expectedLocalStatus === 'number') return status === row.expectedLocalStatus;
        return status >= 200 && status < 300;
      }
      function buildProbeInit(method: string, hostileOrigin: string | null, body: unknown): RequestInit {
        const headers: Record<string, string> = { Host: '127.0.0.1' };
        if (hostileOrigin) headers.Origin = hostileOrigin;
        const init: RequestInit = { method, headers };
        if (body !== undefined && method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
          headers['Content-Type'] = 'application/json';
          init.body = JSON.stringify(body);
        }
        return init;
      }
      // Round-12 C0-7-REBOOT-NONCE-STALE: resolves the declared path/body
      // against whatever currentNonceProjectId is CURRENTLY set to. Callers
      // MUST call ensureDaemonAlive first, so a fresh boot's fixture project
      // (and its new currentNonceProjectId) is in place BEFORE resolution --
      // never resolved ahead of a liveness check that could reboot and
      // invalidate the very nonce just used.
      function resolveRowForProbe(row: { method: string; path: string; probePath?: string; probeBody?: unknown }): { declaredPath: string; resolvedPath: string; substitutedBody: unknown; unresolvedPlaceholders: string[] } {
        const declaredPath = typeof row.probePath === 'string' ? row.probePath : row.path;
        const substitutedPathRaw = currentNonceProjectId ? (substituteNoncePlaceholder(declaredPath, currentNonceProjectId) as string) : declaredPath;
        // Any remaining un-substituted :param segment (no declaration
        // supplied a real value) falls back to a placeholder id -- that gap
        // is separately caught by rowsMissingRealisticProbePath as a named
        // missing-declaration fail, not silently hidden here.
        const resolvedPath = substitutedPathRaw.replace(/:[a-zA-Z]+/g, 'w0-verifier-probe-id');
        const substitutedBody = row.probeBody !== undefined ? (currentNonceProjectId ? substituteNoncePlaceholder(row.probeBody, currentNonceProjectId) : row.probeBody) : undefined;
        const unresolvedPlaceholders = [...findRemainingPlaceholders(substitutedPathRaw), ...findRemainingPlaceholders(substitutedBody)];
        return { declaredPath, resolvedPath, substitutedBody, unresolvedPlaceholders };
      }
      try {
        daemon = await ensureDaemonAlive(daemon);
        // Static rows are probed by their declared path (or probePath
        // override). A dynamic row that supplies a concrete probePath (a
        // real, live-observed instance of the computed path) is probed the
        // SAME way as static rows -- acknowledgement alone is not enough if
        // the row also claims to know a real path. Only allowlist-
        // AUTHORIZED claiming rows are legitimately excluded from live
        // probing; unauthorized claiming rows are excluded from probing too
        // (there is no path to probe) but are caught by
        // dynamicRowsMissingProbePathOrReason above.
        for (const row of probedRowSet) {
          // Round-12 C0-7-REBOOT-NONCE-STALE: ensureDaemonAlive runs FIRST
          // for EACH phase, then resolution happens lazily against
          // whichever daemon (and whichever seeded nonce project) is
          // current at that moment -- never resolved against a nonce that a
          // reboot is about to invalidate.
          daemon = await ensureDaemonAlive(daemon);
          const hostileResolved = resolveRowForProbe(row);
          const hostileGeneration = daemonGeneration;
          const rowLabel = `${row.method} ${hostileResolved.declaredPath}`;
          if (hostileResolved.unresolvedPlaceholders.length > 0) {
            rowsWithUnresolvedPlaceholder.push({ method: row.method, path: hostileResolved.declaredPath, phase: 'hostile', remaining: hostileResolved.unresolvedPlaceholders });
          }
          try {
            const res = await fetch(`${daemon.url}${hostileResolved.resolvedPath}`, buildProbeInit(row.method, HOSTILE_ORIGIN, hostileResolved.substitutedBody));
            hostileOriginResults.push({ method: row.method, path: hostileResolved.declaredPath, status: res.status, daemonGeneration: hostileGeneration });
          } catch {
            hostileOriginResults.push({ method: row.method, path: hostileResolved.declaredPath, status: -1, daemonGeneration: hostileGeneration });
          }
          lastProbed = { row: rowLabel, phase: 'hostile' };

          daemon = await ensureDaemonAlive(daemon);
          const canaryResolved = resolveRowForProbe(row);
          const canaryGeneration = daemonGeneration;
          if (canaryResolved.unresolvedPlaceholders.length > 0) {
            rowsWithUnresolvedPlaceholder.push({ method: row.method, path: canaryResolved.declaredPath, phase: 'canary', remaining: canaryResolved.unresolvedPlaceholders });
          }
          // Round-final coordinator ruling, item 2: a valid canary-unreachable
          // entry waives ONLY this row's success expectation below -- the
          // probe still runs and its real result is still recorded (never
          // skipped), it is just excluded from the pass/fail gate.
          const canaryWaiver = findCanaryWaiver(row);
          try {
            const res = await fetch(`${daemon.url}${canaryResolved.resolvedPath}`, buildProbeInit(row.method, null, canaryResolved.substitutedBody));
            localSuccessCanaryResults.push({ method: row.method, path: canaryResolved.declaredPath, status: res.status, expected: typeof row.expectedLocalStatus === 'number' ? row.expectedLocalStatus : '2xx', ok: isCanarySuccess(row, res.status), daemonGeneration: canaryGeneration, waived: canaryWaiver !== undefined, waivedReason: canaryWaiver?.reason });
          } catch {
            // Transport failure (-1) is NEVER success -- this row fails,
            // full stop. It is recorded here, BEFORE the next row's
            // ensureDaemonAlive call can reboot, so the failure cannot be
            // masked by a subsequent fresh-daemon reboot.
            localSuccessCanaryResults.push({ method: row.method, path: canaryResolved.declaredPath, status: -1, expected: typeof row.expectedLocalStatus === 'number' ? row.expectedLocalStatus : '2xx', ok: false, daemonGeneration: canaryGeneration, waived: canaryWaiver !== undefined, waivedReason: canaryWaiver?.reason });
          }
          lastProbed = { row: rowLabel, phase: 'canary' };
        }
      } finally {
        const finalDaemon: BootedDaemon | null = daemon;
        if (finalDaemon) await finalDaemon.kill().catch(() => undefined);
      }
      // "Success" for the hostile probe means the origin guard DID reject
      // it (401/403). Probed honestly: if the CURRENT product does not
      // reject a hostile origin on some route, that specific row is named
      // in evidence as a real fail, not tuned away.
      const liveRejectedAll = hostileOriginResults.length > 0 && hostileOriginResults.every((r) => r.status === 401 || r.status === 403);
      const hostileOriginNotRejected = hostileOriginResults.filter((r) => r.status !== 401 && r.status !== 403);
      // Round-10/11: canary success is now the row's explicit `ok` flag
      // (2xx, or the row's declared expectedLocalStatus, itself now
      // structurally forbidden from being -1/401/403/5xx) -- placeholder
      // 400/404 from an undeclared realistic probePath/probeBody is caught
      // separately by rowsMissingRealisticProbePath/rowsMissingProbeBody,
      // never blessed by widening this check.
      // Round-final coordinator ruling, item 2: a row whose canary is
      // validly waived is excluded from the pass/fail gate (but its real
      // result is still fully recorded above, never skipped).
      const localSuccessCanaryOk = localSuccessCanaryResults.length > 0 && localSuccessCanaryResults.every((r) => r.ok || r.waived);
      const localSuccessCanaryRejected = localSuccessCanaryResults.filter((r) => !r.ok && !r.waived);
      const waivedCanaryResults = localSuccessCanaryResults.filter((r) => r.waived);
      const inventoryRowsNotLive = validRows.filter((r) => !r.dynamic && !liveRouteKeys.has(`${r.method} ${r.path}`));
      const guardedRoutesMissingFromInventory = guarded.filter((b) => !dedupKeys.has(`${b.method} ${b.path}`));
      const iteration = needleReport('(C0-7/route)', Math.max(validRows.length, 1));
      const control = needleReport('(C0-7/control)', 1);
      const ok =
        validRows.length >= 1 &&
        validRows.length === routes.length &&
        dedupKeys.size === validRows.length &&
        inventoryRowsNotLive.length === 0 &&
        guardedRoutesMissingFromInventory.length === 0 &&
        dynamicRowsMissingProbePathOrReason.length === 0 &&
        dynamicRowsUnbound.length === 0 &&
        dynamicRowsDuplicateBinding.length === 0 &&
        unresolvableSitesUnacknowledged.length === 0 &&
        duplicateAllowlistEntries.length === 0 &&
        staleAllowlistEntries.length === 0 &&
        unusedAllowlistEntries.length === 0 &&
        !majorityUnreachable &&
        !canaryUnreachableMajorityExceeded &&
        rowsWithForbiddenExpectedLocalStatus.length === 0 &&
        rowsMissingRealisticProbePath.length === 0 &&
        rowsMissingProbeBody.length === 0 &&
        rowsWithUnresolvedPlaceholder.length === 0 &&
        iteration.ok &&
        control.ok &&
        liveRejectedAll &&
        localSuccessCanaryOk;
      record('C0-7', '', '', ok,
        `inventory rows: ${routes.length}\nAST guarded baseline: ${guarded.length}; missing: ${JSON.stringify(guardedRoutesMissingFromInventory)}\n` +
          `unresolvable-path guarded registrations: ${JSON.stringify(unresolvable)}; dynamic rows: ${JSON.stringify(dynamicRows)}\n` +
          `dynamic rows missing probePath/authorization: ${JSON.stringify(dynamicRowsMissingProbePathOrReason)}; unbound dynamic rows: ${JSON.stringify(dynamicRowsUnbound)}; duplicate-binding dynamic rows: ${JSON.stringify(dynamicRowsDuplicateBinding)}; unacknowledged sites: ${JSON.stringify(unresolvableSitesUnacknowledged)}\n` +
          `allowlistStatus=${allowlistStatus} allowlistPath=${unreachableAllowlistPath ?? '(none)'}\n` +
          `duplicate allowlist entries: ${JSON.stringify(duplicateAllowlistEntries)}\nstale allowlist entries: ${JSON.stringify(staleAllowlistEntries)}\nunused allowlist entries: ${JSON.stringify(unusedAllowlistEntries)}\n` +
          `per-entry commit-validation status: ${JSON.stringify(c07OwnedEntries.map((e) => ({ file: e.file, line: e.line, commit: e.commit, ...commitValidationByEntry.get(e) })))}\n` +
          `dynamic row counts: total=${dynamicRows.length} probed=${probedDynamicRows.length} claiming=${claimingRows.length} authorized=${authorizedRows.length} unauthorized=${unauthorizedClaimingRows.length} majorityUnreachable(authorized*2>=total)=${majorityUnreachable}\n` +
          `authorized rows (allowlist-cleared, free text is evidence-only): ${JSON.stringify(authorizedRows.map((r) => ({ method: r.method, path: r.path, file: r.file, line: r.line, freeTextUnreachable: r.unreachable })))}\n` +
          `all claiming rows with free-text unreachable surfaced: ${JSON.stringify(claimingRows.map((r) => ({ method: r.method, path: r.path, file: r.file, line: r.line, freeTextUnreachable: r.unreachable, authorized: authorizedRows.includes(r) })))}\n` +
          `canary-unreachable entries (item 2 -- waives ONLY the origin-less success canary for one exact row; hostile-Origin rejection and every structural check remain mandatory): declared=${JSON.stringify(canaryUnreachableClassEntries.map((e) => ({ method: e.method, path: e.path, file: e.file, line: e.line, reason: e.reason })))} valid=${JSON.stringify(validCanaryUnreachableEntries.map((e) => ({ method: e.method, path: e.path })))} duplicate=${JSON.stringify(duplicateCanaryUnreachableEntries)} unused=${JSON.stringify(unusedCanaryUnreachableEntries)}\n` +
          `canary-waived rows (over ${validRows.length} total rows): ${JSON.stringify(waivedCanaryResults)}; majority cap (waived*2>=total)=${canaryUnreachableMajorityExceeded}\n` +
          `inventory rows without a live route: ${JSON.stringify(inventoryRowsNotLive)}\n` +
          `rows with a FORBIDDEN declared expectedLocalStatus (-1/400/401/403/404/5xx never count as success): ${JSON.stringify(rowsWithForbiddenExpectedLocalStatus.map((r) => ({ method: r.method, path: r.path, expectedLocalStatus: r.expectedLocalStatus })))}\n` +
          `rows missing a realistic probePath (parameterized static path, no declared override, OR a declared override that still contains :param syntax): ${JSON.stringify(rowsMissingRealisticProbePath.map((r) => ({ method: r.method, path: r.path, declaredProbePath: r.probePath })))}\n` +
          `rows missing a required probeBody (body-bearing method, no declaration): ${JSON.stringify(rowsMissingProbeBody.map((r) => ({ method: r.method, path: r.path })))}\n` +
          `rows whose resolved probePath/probeBody still contains an unresolved <...> placeholder token after substitution: ${JSON.stringify(rowsWithUnresolvedPlaceholder)}\n` +
          `hostile-Origin probe (Origin: ${HOSTILE_ORIGIN}, expect 401/403; each entry records the daemon generation its substitution resolved against): ${JSON.stringify(hostileOriginResults)}; NOT rejected (real fail if non-empty): ${JSON.stringify(hostileOriginNotRejected)}\n` +
          `origin-less local-success canary (no Origin header, CLI's own shape; expect 2xx or the row's declared expectedLocalStatus -- -1/400/401/403/404/5xx are all real fails now, and can never be declared as expected; each entry records the daemon generation its substitution resolved against): ${JSON.stringify(localSuccessCanaryResults)}; failed (real fail if non-empty): ${JSON.stringify(localSuccessCanaryRejected)}\n` +
          `daemon reboots during probing (each entry names the row/phase whose probe PRECEDED the death -- the actual trigger, not the upcoming probe -- and the new daemon generation it produced; a reboot settles the PRECEDING row's result first and never retroactively changes it): ${JSON.stringify(rebootLog)}\n` +
          `final daemon generation reached: ${daemonGeneration}\n` +
          `-- per-route --\n${iteration.evidence}\n-- control --\n${control.evidence}`,
        { detail: ok ? undefined : `rows=${validRows.length} unique=${dedupKeys.size} inventoryRowsNotLive=${inventoryRowsNotLive.length} guardedMissing=${guardedRoutesMissingFromInventory.length} dynamicRowsMissingProbePathOrReason=${dynamicRowsMissingProbePathOrReason.length} dynamicRowsUnbound=${dynamicRowsUnbound.length} dynamicRowsDuplicateBinding=${dynamicRowsDuplicateBinding.length} unresolvableSitesUnacknowledged=${unresolvableSitesUnacknowledged.length} allowlistStatus=${allowlistStatus} duplicateAllowlistEntries=${duplicateAllowlistEntries.length} staleAllowlistEntries=${staleAllowlistEntries.length} unusedAllowlistEntries=${unusedAllowlistEntries.length} dynamicRowCounts(total=${dynamicRows.length},probed=${probedDynamicRows.length},claiming=${claimingRows.length},authorized=${authorizedRows.length}) majorityUnreachable=${majorityUnreachable} canaryUnreachableMajorityExceeded=${canaryUnreachableMajorityExceeded} canaryWaivedRows=${canaryWaivedRows.length} rowsWithForbiddenExpectedLocalStatus=${rowsWithForbiddenExpectedLocalStatus.length} rowsMissingRealisticProbePath=${rowsMissingRealisticProbePath.length} rowsMissingProbeBody=${rowsMissingProbeBody.length} rowsWithUnresolvedPlaceholder=${rowsWithUnresolvedPlaceholder.length} iterationOk=${iteration.ok} controlOk=${control.ok} liveRejectedAll=${liveRejectedAll} localSuccessCanaryOk=${localSuccessCanaryOk} hostileOriginNotRejected=${JSON.stringify(hostileOriginNotRejected)} localSuccessCanaryRejected=${JSON.stringify(localSuccessCanaryRejected)} reboots=${rebootLog.length}` });
      void baselineKeys;
    },
  );

  // =======================================================================
  // C0-8
  // =======================================================================
  await checkCriterion('C0-8', 'read docs/security/daemon-threat-model.md; exact-fullName cross-check', 'structured caller-class headings; every defense bullet is tagged [C0-N] and cites the EXACT fullName of a PASSED test carrying that same tag; no test cited twice', () => {
    const rel = 'docs/security/daemon-threat-model.md';
    const CALLER_CLASSES = ['web UI', 'od CLI', 'clipper extension', 'external agent', 'malicious local process', 'malicious web page'];
    if (!fileExists(rel)) { record('C0-8', '', '', false, '', { detail: `missing: ${rel}` }); return; }
    const text = readRepoFile(rel);
    const headingLines = text.split('\n').filter((l) => /^#{1,6}\s/.test(l));
    const missingClasses = CALLER_CLASSES.filter((c) => !headingLines.some((h) => h.toLowerCase().includes(c.toLowerCase())));
    const sections = text.split(/^##\s+/m);
    const defenseSections = sections.filter((s) => /defense|mitigat/i.test(s.split('\n')[0] ?? ''));
    const defenseBullets = defenseSections.flatMap((s) => s.match(/^-\s.+$/gm) ?? []);
    const allByFullName = new Map<string, string>();
    for (const t of [...daemonSuite.all, ...webSuite.all]) allByFullName.set(t.fullName, t.status);
    const usedFullNames = new Set<string>();
    const problems: string[] = [];
    for (const bullet of defenseBullets) {
      const tagMatch = bullet.match(/\[(C0-\d{1,2})\]/);
      const citationMatch = bullet.match(/`([^`]+)`/);
      if (!tagMatch || !citationMatch) { problems.push(`bullet missing [C0-N] tag or citation: ${bullet.slice(0, 80)}`); continue; }
      const tag = tagMatch[1] as string;
      const fullName = citationMatch[1] as string;
      if (allByFullName.get(fullName) !== 'passed') { problems.push(`[${tag}] cites "${fullName}" not PASSED in current run`); continue; }
      if (!fullName.includes(tag)) { problems.push(`[${tag}] cites "${fullName}" which doesn't carry that tag`); continue; }
      if (usedFullNames.has(fullName)) { problems.push(`test "${fullName}" cited twice`); continue; }
      usedFullNames.add(fullName);
    }
    const ok = missingClasses.length === 0 && defenseBullets.length >= 5 && problems.length === 0;
    record('C0-8', '', '', ok, `missing classes: ${missingClasses.join(', ') || 'none'}\nbullets: ${defenseBullets.length}\nproblems: ${problems.join('; ') || 'none'}`, { detail: ok ? undefined : problems.join('; ') || 'see evidence' });
  });

  // =======================================================================
  // C0-9 -- round-3 F9: corpus binding, 2xx requirement, machine fingerprint
  // match, toleranceBandPct capped at 50.
  // =======================================================================
  await checkCriterion('C0-9', 'read docs/testing/scale-baseline-2026-07.md + .json; re-execute all 5 scenarios against the DECLARED corpus (not an empty store)', 'corpus content hash must match; corpus must be >=900MB on disk (the wave\'s real ~987MB store scale) AND explicitly declared in the JSON as a snapshot of the real store with a recorded fingerprint -- a content-hashed unrelated filler directory of any size does not satisfy this; HTTP scenarios require 2xx; machine fingerprint must match THIS machine; toleranceBandPct capped at 50 (larger declared bands fail); BOTH live p50 and live p95 (recomputed from >=5 real R8 repetitions) must fall within the committed band, not p50 alone', async () => {
    const mdRel = 'docs/testing/scale-baseline-2026-07.md';
    const jsonRel = 'docs/testing/scale-baseline-2026-07.json';
    if (!fileExists(mdRel) || !fileExists(jsonRel)) { record('C0-9', '', '', false, '', { detail: `missing: ${!fileExists(mdRel) ? mdRel : ''} ${!fileExists(jsonRel) ? jsonRel : ''}`.trim() }); return; }
    interface BaselineJson { corpus: { path: string; sha256: string; isRealStoreSnapshot?: boolean; realStoreFingerprint?: string }; machine: { fingerprint: string }; warmup: { iterations: number }; scenarios: { name: string; samplesMs: number[]; p50: number; p95: number; toleranceBandPct?: number }[]; searchProbe?: { projectId: string; needle: string; expectFile: string }; nonRegressionCeiling: number; minimumImprovementThreshold: number; version: string }
    let baseline: BaselineJson;
    try { baseline = JSON.parse(readRepoFile(jsonRel)) as BaselineJson; } catch (err) { record('C0-9', '', '', false, '', { detail: `invalid JSON: ${String(err)}` }); return; }
    const problems: string[] = [];
    if (!baseline.machine?.fingerprint) problems.push('missing machine.fingerprint');
    else {
      const liveFingerprint = `${os.hostname()}-${os.platform()}-${os.arch()}-${os.cpus().length}cpu`;
      if (baseline.machine.fingerprint !== liveFingerprint) problems.push(`machine fingerprint mismatch: baseline="${baseline.machine.fingerprint}" live="${liveFingerprint}"`);
    }
    if (typeof baseline.nonRegressionCeiling !== 'number') problems.push('missing nonRegressionCeiling');
    if (typeof baseline.minimumImprovementThreshold !== 'number') problems.push('missing minimumImprovementThreshold');
    if (!baseline.version) problems.push('missing version');
    if (!baseline.warmup || typeof baseline.warmup.iterations !== 'number') problems.push('missing warmup.iterations');
    const scenarioByName = new Map((baseline.scenarios ?? []).map((s) => [s.name, s]));
    for (const s of baseline.scenarios ?? []) {
      const band = s.toleranceBandPct ?? 50;
      if (band > 50) problems.push(`scenario "${s.name}": toleranceBandPct ${band} exceeds the 50% cap`);
      if (!Array.isArray(s.samplesMs) || s.samplesMs.length < 5) { problems.push(`scenario "${s.name}": fewer than 5 raw samples`); continue; }
      const sorted = [...s.samplesMs].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
      if (Math.abs(p50 - s.p50) > 0.01) problems.push(`scenario "${s.name}": stated p50 ${s.p50} != recomputed ${p50}`);
      if (Math.abs(p95 - s.p95) > 0.01) problems.push(`scenario "${s.name}": stated p95 ${s.p95} != recomputed ${p95}`);
    }
    // Round-4 F9: a path+size manifest can be satisfied by swapping in a
    // "tiny unrelated directory" whose own path/size list is then hashed and
    // declared -- self-consistent but unrepresentative. Round-5 F9: bind the
    // benchmark to the wave's REAL requirement -- the PRD's ~987MB store --
    // by (1) raising the size floor to 900MB (a content-hashed unrelated
    // filler directory of that scale is still not "the real store"), and
    // (2) requiring the doc to explicitly DECLARE the corpus as a snapshot
    // of the real store with its own recorded fingerprint, not just a
    // self-consistent hash of whatever happens to be on disk.
    const MIN_CORPUS_BYTES = 900_000_000; // 900MB floor -- the wave's real ~987MB store scale
    const MAX_HASHED_FILES = 3000; // deterministic sample cap for hashing runtime
    let corpusOk = false;
    let corpusTotalBytes = 0;
    if (!baseline.corpus?.path || !baseline.corpus?.sha256) {
      problems.push('missing corpus.path/corpus.sha256');
    } else if (baseline.corpus.isRealStoreSnapshot !== true || typeof baseline.corpus.realStoreFingerprint !== 'string' || !baseline.corpus.realStoreFingerprint.trim()) {
      problems.push('corpus is not declared as a snapshot of the real store: corpus.isRealStoreSnapshot must be true and corpus.realStoreFingerprint must be a recorded, non-empty fingerprint');
    } else if (fs.existsSync(baseline.corpus.path)) {
      const allFiles: { rel: string; abs: string; size: number }[] = [];
      (function walk(dir: string, base: string): void {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full, base);
          else {
            const size = fs.statSync(full).size;
            allFiles.push({ rel: path.relative(base, full), abs: full, size });
            corpusTotalBytes += size;
          }
        }
      })(baseline.corpus.path, baseline.corpus.path);
      if (allFiles.length === 0) problems.push('corpus.path is an empty store -- not declared/documented as intentionally empty');
      if (corpusTotalBytes < MIN_CORPUS_BYTES) problems.push(`corpus total size ${corpusTotalBytes} bytes is below the ${MIN_CORPUS_BYTES}-byte (900MB) scale floor -- not the real ~987MB scale-baseline store`);
      allFiles.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
      const sampled = allFiles.length <= MAX_HASHED_FILES ? allFiles : allFiles.filter((_, i) => i % Math.ceil(allFiles.length / MAX_HASHED_FILES) === 0);
      const contentPairs = sampled.map((f) => `${f.rel}:${sha256File(f.abs)}`);
      const recomputedCorpusHash = sha256Bytes(contentPairs.join('\n'));
      if (recomputedCorpusHash !== baseline.corpus.sha256) problems.push(`corpus fingerprint mismatch: recomputed ${recomputedCorpusHash.slice(0, 12)} != stated ${baseline.corpus.sha256.slice(0, 12)}`);
      else if (allFiles.length > 0 && corpusTotalBytes >= MIN_CORPUS_BYTES) corpusOk = true;
    } else {
      problems.push(`corpus.path "${baseline.corpus.path}" does not exist`);
    }

    // Round-4 F9: the required R8 protocol is a discarded warmup pass
    // followed by >=5 TIMED repetitions, with p50/p95 recomputed from those
    // live observations -- not a single unwarmed sample compared against
    // author-fabricated baseline samples.
    const R8_WARMUP_ITERATIONS = 1;
    const R8_REPETITIONS = 5;
    function percentile(sortedAsc: number[], frac: number): number {
      return sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * frac))] ?? 0;
    }
    const SCENARIOS = ['cold-start', 'project-list', 'designs-tab-fan-out', 'memory-high-water', 'search'];
    const smoke: Record<string, { samplesMs: number[]; p50: number; p95: number; httpOkAll: boolean }> = {};
    if (corpusOk) {
      try {
        // cold-start: each repetition is a genuinely fresh daemon process
        // (warmup boot discarded, priming OS/module caches; 5 timed boots).
        const coldSamples: number[] = [];
        let coldHttpOkAll = true;
        for (let i = 0; i < R8_WARMUP_ITERATIONS + R8_REPETITIONS; i++) {
          const t0 = Date.now();
          const d = await bootDaemonForProbing(baseline.corpus.path);
          const elapsed = Date.now() - t0;
          await d.kill();
          if (i >= R8_WARMUP_ITERATIONS) coldSamples.push(elapsed);
        }
        smoke['cold-start'] = { samplesMs: coldSamples, p50: percentile([...coldSamples].sort((a, b) => a - b), 0.5), p95: percentile([...coldSamples].sort((a, b) => a - b), 0.95), httpOkAll: coldHttpOkAll };

        // Remaining scenarios share one long-lived daemon; each does its own
        // warmup-then-5-reps loop against it.
        const daemon = await bootDaemonForProbing(baseline.corpus.path);
        try {
          const fanoutRoute = daemon.routeInventory.find((r) => r.method === 'GET' && /projects\/:[a-zA-Z]+\/files/i.test(r.path));
          // r2/r2b/r2c amendments 2026-07-27/28: the original /search/i
          // first-match picked POST /api/xai/search (external, 401 without
          // credentials); r2's library-search preference resolved to the
          // tool-token-gated agent route (401 by design); r2b's first-project
          // + expect-empty-200 was itself gameable (the route returns 200/[]
          // even for a missing directory, so a list-only/always-empty search
          // passes -- Sol r3 REJECT). The committed baseline now BINDS a
          // frozen probe target {projectId, needle, expectFile} whose needle
          // provably exists in the content-hash-bound corpus: the scenario
          // requires a POSITIVE hit (needle -> >=1 match naming expectFile)
          // and a NEGATIVE control (random nonce -> 2xx with zero matches),
          // both against the declared project. Timing measures the positive
          // probe -- the real search work.
          const searchProbe = baseline.searchProbe;
          let searchProbeUsable = false;
          if (!searchProbe || typeof searchProbe.projectId !== 'string' || !searchProbe.projectId || typeof searchProbe.needle !== 'string' || !searchProbe.needle || typeof searchProbe.expectFile !== 'string' || !searchProbe.expectFile) {
            problems.push('baseline.searchProbe {projectId, needle, expectFile} is required for the search scenario and is missing or invalid');
          } else {
            const pr = await fetch(`${daemon.url}/api/projects`).catch(() => null);
            const pj = pr && pr.ok ? ((await pr.json().catch(() => null)) as { projects?: { id?: unknown }[] } | null) : null;
            const listed = Array.isArray(pj?.projects) && pj.projects.some((p) => p?.id === searchProbe.projectId);
            if (!listed) problems.push(`searchProbe.projectId ${searchProbe.projectId} is not present in GET /api/projects on the booted corpus`);
            else searchProbeUsable = true;
          }

          async function timedRun(fn: () => Promise<boolean>): Promise<{ samplesMs: number[]; httpOkAll: boolean }> {
            for (let w = 0; w < R8_WARMUP_ITERATIONS; w++) await fn().catch(() => false);
            const samples: number[] = [];
            let okAll = true;
            for (let i = 0; i < R8_REPETITIONS; i++) {
              const t0 = Date.now();
              const ok = await fn().catch(() => false);
              samples.push(Date.now() - t0);
              if (!ok) okAll = false;
            }
            return { samplesMs: samples, httpOkAll: okAll };
          }

          const listRun = await timedRun(async () => { const r = await fetch(`${daemon.url}/api/projects`).catch(() => null); return !!r && r.ok; });
          smoke['project-list'] = { ...listRun, p50: percentile([...listRun.samplesMs].sort((a, b) => a - b), 0.5), p95: percentile([...listRun.samplesMs].sort((a, b) => a - b), 0.95) };

          if (fanoutRoute) {
            const fanoutRun = await timedRun(async () => { const r = await fetch(`${daemon.url}${fanoutRoute.path.replace(/:[a-zA-Z]+/g, 'w0-verifier-smoke-id')}`).catch(() => null); return !!r && r.ok; });
            smoke['designs-tab-fan-out'] = { ...fanoutRun, p50: percentile([...fanoutRun.samplesMs].sort((a, b) => a - b), 0.5), p95: percentile([...fanoutRun.samplesMs].sort((a, b) => a - b), 0.95) };
          } else smoke['designs-tab-fan-out'] = { samplesMs: [], p50: 0, p95: 0, httpOkAll: false };

          if (daemon.pid) {
            const rssSamples: number[] = [];
            for (let i = 0; i < R8_WARMUP_ITERATIONS + R8_REPETITIONS; i++) {
              const r = sh('ps', ['-o', 'rss=', '-p', String(daemon.pid)]);
              const n = Number(r.stdout.trim());
              if (Number.isFinite(n) && i >= R8_WARMUP_ITERATIONS) rssSamples.push(n);
              await fetch(`${daemon.url}/api/health`).catch(() => null);
            }
            const sortedRss = [...rssSamples].sort((a, b) => a - b);
            smoke['memory-high-water'] = { samplesMs: rssSamples, p50: percentile(sortedRss, 0.5), p95: percentile(sortedRss, 0.95), httpOkAll: rssSamples.length > 0 };
          } else smoke['memory-high-water'] = { samplesMs: [], p50: 0, p95: 0, httpOkAll: false };

          if (searchProbeUsable && searchProbe) {
            const searchUrl = (q: string) => `${daemon.url}/api/projects/${encodeURIComponent(searchProbe.projectId)}/search?q=${encodeURIComponent(q)}`;
            const searchRun = await timedRun(async () => {
              const r = await fetch(searchUrl(searchProbe.needle)).catch(() => null);
              if (!r || !r.ok) return false;
              const body = (await r.json().catch(() => null)) as { matches?: { file?: unknown }[] } | null;
              const matches = Array.isArray(body?.matches) ? body.matches : [];
              // A real search must FIND the frozen needle in the declared file;
              // matches.length alone is not enough (an always-match stub is
              // killed by the negative control below).
              return matches.length >= 1 && matches.some((m) => String(m?.file ?? '') === searchProbe.expectFile);
            });
            // Negative control (unmatched nonce): a genuine search returns 2xx
            // with ZERO matches; an always-match stub fails here.
            const negNonce = `w0-neg-${crypto.randomBytes(6).toString('hex')}`;
            const neg = await fetch(searchUrl(negNonce)).catch(() => null);
            const negBody = neg && neg.ok ? ((await neg.json().catch(() => null)) as { matches?: unknown[] } | null) : null;
            const negOk = !!neg && neg.ok && Array.isArray(negBody?.matches) && negBody.matches.length === 0;
            if (!negOk) problems.push('search negative control failed: an unmatched nonce query must return 2xx with zero matches');
            smoke['search'] = { ...searchRun, httpOkAll: searchRun.httpOkAll && negOk, p50: percentile([...searchRun.samplesMs].sort((a, b) => a - b), 0.5), p95: percentile([...searchRun.samplesMs].sort((a, b) => a - b), 0.95) };
          } else smoke['search'] = { samplesMs: [], p50: 0, p95: 0, httpOkAll: false };
        } finally {
          await daemon.kill();
        }
      } catch (err) {
        problems.push(`live scenario smoke run threw: ${String(err)}`);
      }
    } else {
      problems.push('scenarios not re-executed: corpus binding failed (missing scenario = fail)');
    }
    for (const name of SCENARIOS) {
      const observed = smoke[name];
      const baselineScenario = scenarioByName.get(name);
      if (!observed || observed.samplesMs.length < R8_REPETITIONS) { problems.push(`scenario "${name}": could not be re-executed with >=${R8_REPETITIONS} timed repetitions`); continue; }
      if (name !== 'memory-high-water' && !observed.httpOkAll) { problems.push(`scenario "${name}": at least one repetition's HTTP response was not 2xx`); continue; }
      if (!baselineScenario) { problems.push(`scenario "${name}": no committed baseline entry`); continue; }
      const band = Math.min(baselineScenario.toleranceBandPct ?? 50, 50);
      const lowerP50 = baselineScenario.p50 * (1 - band / 100);
      const upperP50 = baselineScenario.p50 * (1 + band / 100);
      if (!(observed.p50 >= lowerP50 && observed.p50 <= upperP50)) problems.push(`scenario "${name}": recomputed live p50 ${observed.p50}ms outside [${lowerP50.toFixed(1)}, ${upperP50.toFixed(1)}]`);
      // Round-5 F9: p95 was recomputed but never compared -- a live run with
      // a fast median and a severe tail regression could pass on p50 alone.
      // Both percentiles must fall within the committed band.
      const lowerP95 = baselineScenario.p95 * (1 - band / 100);
      const upperP95 = baselineScenario.p95 * (1 + band / 100);
      if (!(observed.p95 >= lowerP95 && observed.p95 <= upperP95)) problems.push(`scenario "${name}": recomputed live p95 ${observed.p95}ms outside [${lowerP95.toFixed(1)}, ${upperP95.toFixed(1)}]`);
    }
    const mdText = readRepoFile(mdRel);
    if (!/peak[\s\S]{0,20}RSS/i.test(mdText)) problems.push('markdown prose missing a peak RSS mention');
    const ok = problems.length === 0;
    record('C0-9', '', '', ok, JSON.stringify({ baseline, smoke, corpusOk }, null, 2), { detail: ok ? undefined : problems.join('; ') });
  });

  // =======================================================================
  // C0-10 / C0-11 -- round-3 F10/F11/F13.
  // =======================================================================
  const capabilityManifestRel = 'scripts/waves/capability-manifest.json';
  // Round-9 C0-10 amendment (docs/plans/waves/DECISIONS.md "W0 gate
  // adjudication", GPT-5.6 Sol reviewer-of-record, GATE-DEFECT): the old
  // schema sent no POST bodies, could not represent an Express `.all()`
  // registration (message-center), and byte-compared legitimately
  // reshaped/unordered output. Schema additions below; DATA population for
  // rows that need them is implementer duty, not this amendment -- a row
  // that needs a declaration and lacks one fails with the declaration named.
  interface ValueComparisonSpec {
    mode: 'exact' | 'unordered-array' | 'composite' | 'binary';
    sortKey?: string; // unordered-array: property to sort array-of-objects by (omitted => sort by JSON.stringify)
    fields?: string[]; // composite: REQUIRED non-empty set of top-level keys to compare; other keys ignored
    encoding?: 'base64' | 'hex'; // binary: how the string value is encoded (default base64); compared as decoded bytes (hex-canonicalized)
  }
  interface CapabilityManifestEntry {
    capability: string; uiEntryPoint: string; cliArgs: string[]; httpMethod: string; httpPath: string; outputSchema: string; parityApplicable: boolean; reason?: string;
    probeMethod?: string; // REQUIRED concrete verb (GET|POST|PUT|PATCH|DELETE|OPTIONS) when httpMethod === 'ALL' -- you cannot literally send an "ALL" HTTP request
    probePath?: string; // optional concrete path for the live sample fetch; defaults to httpPath when absent
    probeBody?: unknown; // optional equivalent HTTP request body for POST/PUT/PATCH capabilities; the string '<nonceProjectId>' anywhere in its structure is substituted with the run's nonce, mirroring cliArgs
    valueComparison?: ValueComparisonSpec; // optional per-row canonicalizer; defaults to exact/ordered (unrelaxed) when absent -- this is the preserved implementation duty
  }
  const VALID_HTTP_METHODS = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|ALL)$/;
  const VALID_CONCRETE_METHODS = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS)$/;
  const VALID_VALUE_COMPARISON_MODES = ['exact', 'unordered-array', 'composite', 'binary'];
  const isBodyBearingMethod = (m: string): boolean => m === 'POST' || m === 'PUT' || m === 'PATCH';
  // Nonce placeholder substitution for probeBody/probePath, mirroring the
  // existing '<nonceProjectId>' convention already used for cliArgs.
  // Round-12 C0-7-PROBEPATH-SUBSTITUTION (1a): a string leaf is substring-
  // replaced (every occurrence WITHIN the string), not just matched exactly
  // -- a declared value like "https://cb.example/x?project=<nonceProjectId>"
  // (an embedded URL token) previously stayed completely literal because
  // only `value === '<nonceProjectId>'` ever matched.
  function substituteNoncePlaceholder(value: unknown, nonce: string): unknown {
    if (typeof value === 'string') return value.split('<nonceProjectId>').join(nonce);
    if (Array.isArray(value)) return value.map((v) => substituteNoncePlaceholder(v, nonce));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, substituteNoncePlaceholder(v, nonce)]));
    return value;
  }
  // Round-12 C0-7-PROBEPATH-SUBSTITUTION (1b): after substitution, ANY
  // remaining `<...>` token (a placeholder this function does not know how
  // to resolve, e.g. a declared-but-unsupported `<connectorId>`) is a
  // structural failure -- named, not silently probed as a literal string.
  function findRemainingPlaceholders(value: unknown): string[] {
    const found: string[] = [];
    (function walk(v: unknown): void {
      if (typeof v === 'string') {
        const matches = v.match(/<[^<>]+>/g);
        if (matches) found.push(...matches);
      } else if (Array.isArray(v)) {
        v.forEach(walk);
      } else if (v && typeof v === 'object') {
        Object.values(v as object).forEach(walk);
      }
    })(value);
    return found;
  }
  // A "present, non-empty" value: rejects undefined/null/'' /empty array/
  // empty object, but accepts legitimate falsy-but-real values like 0/false.
  function isPresentNonEmpty(v: unknown): boolean {
    if (v === undefined || v === null || v === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    if (isRecord(v) && Object.keys(v).length === 0) return false;
    return true;
  }
  // Round-10 C0-10-BINARY-FAILOPEN (Sol confirmation review): Buffer.from
  // decodes permissively (invalid characters silently dropped, wrong
  // padding tolerated), so distinct malformed/truncated strings could
  // canonicalize to identical bytes. Validate the encoding STRICTLY before
  // ever decoding.
  function isValidStrictHex(s: string): boolean {
    return s.length > 0 && s.length % 2 === 0 && /^[0-9a-f]+$/i.test(s);
  }
  function isValidStrictBase64(s: string): boolean {
    if (s.length === 0 || s.length % 4 !== 0) return false;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return false;
    const padIndex = s.indexOf('=');
    if (padIndex !== -1 && padIndex < s.length - 2) return false; // '=' only allowed in the final 2 chars
    try {
      // Round-trip: strict base64 must re-encode to the EXACT same string.
      // Buffer.from's permissive decode can accept e.g. non-canonical
      // padding bits that Node still parses -- the round-trip check catches
      // those even though the charset/padding regex alone would not.
      return Buffer.from(s, 'base64').toString('base64') === s;
    } catch {
      return false;
    }
  }
  function validateAndDecodeBinary(v: unknown, encoding: 'base64' | 'hex'): { ok: boolean; hex: string | null; reason?: string } {
    if (typeof v !== 'string') return { ok: false, hex: null, reason: 'value is not a string' };
    if (encoding === 'hex') {
      if (!isValidStrictHex(v)) return { ok: false, hex: null, reason: 'not valid strict hex (must match /^[0-9a-f]+$/i with a nonzero even length)' };
      return { ok: true, hex: v.toLowerCase() };
    }
    if (!isValidStrictBase64(v)) return { ok: false, hex: null, reason: 'not valid strict base64 (charset/padding/round-trip re-encode check failed)' };
    return { ok: true, hex: Buffer.from(v, 'base64').toString('hex') };
  }
  // Structural PRECONDITIONS for a declared valueComparison mode, checked
  // BEFORE canonicalization+comparison. A failure here is a hard fail on
  // its own -- it is never silently absorbed into a passing comparison.
  //   - composite (round-10 C0-10-COMPOSITE-ESCAPE): every declared field
  //     must be PRESENT AND NON-EMPTY in BOTH payloads. A field missing
  //     from either payload can no longer canonicalize to an equal
  //     "undefined === undefined" projection.
  //   - binary (round-10 C0-10-BINARY-FAILOPEN): both payloads must be
  //     strictly valid encoded strings; malformed input is a structural
  //     fail, never permissively decoded.
  function validateValueComparisonPreconditions(cliValue: unknown, httpValue: unknown, spec: ValueComparisonSpec | undefined): { ok: boolean; problems: string[] } {
    if (!spec) return { ok: true, problems: [] };
    const problems: string[] = [];
    if (spec.mode === 'composite') {
      for (const f of spec.fields ?? []) {
        const cliVal = isRecord(cliValue) ? (cliValue as Record<string, unknown>)[f] : undefined;
        const httpVal = isRecord(httpValue) ? (httpValue as Record<string, unknown>)[f] : undefined;
        if (!isPresentNonEmpty(cliVal)) problems.push(`composite field "${f}" missing/empty in CLI payload`);
        if (!isPresentNonEmpty(httpVal)) problems.push(`composite field "${f}" missing/empty in HTTP payload`);
      }
    }
    if (spec.mode === 'binary') {
      const encoding = spec.encoding ?? 'base64';
      const cliCheck = validateAndDecodeBinary(cliValue, encoding);
      const httpCheck = validateAndDecodeBinary(httpValue, encoding);
      if (!cliCheck.ok) problems.push(`binary CLI value invalid: ${cliCheck.reason}`);
      if (!httpCheck.ok) problems.push(`binary HTTP value invalid: ${httpCheck.reason}`);
    }
    return { ok: problems.length === 0, problems };
  }
  // Canonicalizes a value per a row's DECLARED comparator before
  // deepValueEqual runs. Absent spec (or mode='exact') is a no-op --
  // value-parity stays a REAL, unrelaxed, ordered check by default. Only an
  // EXPLICIT declaration relaxes the comparison, and only in the declared way.
  // Callers MUST run validateValueComparisonPreconditions first -- this
  // function alone does not reject malformed/missing composite or binary
  // input (it degrades gracefully so it never throws), which is exactly why
  // the precondition gate exists as a separate, mandatory hard-fail check.
  function canonicalizeForComparison(v: unknown, spec: ValueComparisonSpec | undefined): unknown {
    if (!spec || spec.mode === 'exact') return v;
    if (spec.mode === 'unordered-array') {
      if (!Array.isArray(v)) return v; // not actually an array -- let deepValueEqual fail naturally
      const sortKeyOf = (item: unknown): string => (spec.sortKey && isRecord(item) ? String((item as Record<string, unknown>)[spec.sortKey as string]) : JSON.stringify(item));
      return [...v].sort((a, b) => { const ka = sortKeyOf(a), kb = sortKeyOf(b); return ka < kb ? -1 : ka > kb ? 1 : 0; });
    }
    if (spec.mode === 'composite') {
      if (!isRecord(v)) return v;
      const fields = spec.fields ?? [];
      return Object.fromEntries(fields.map((f) => [f, (v as Record<string, unknown>)[f]]));
    }
    if (spec.mode === 'binary') {
      const decoded = validateAndDecodeBinary(v, spec.encoding ?? 'base64');
      return decoded.ok ? decoded.hex : v;
    }
    return v;
  }
  function deepKeyStructure(v: unknown, prefix = ''): string[] {
    if (Array.isArray(v)) return v.length > 0 ? deepKeyStructure(v[0], `${prefix}[]`) : [`${prefix}[]`];
    if (v && typeof v === 'object') return Object.keys(v as object).sort().flatMap((k) => deepKeyStructure((v as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k));
    return [prefix];
  }
  // Round-4 F11: full recursive VALUE equality (not just key-shape) --
  // proves the CLI and HTTP surface reached the same handler/state rather
  // than two independently-shaped stubs that happen to share a key skeleton.
  function deepValueEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((v, i) => deepValueEqual(v, b[i]));
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const ak = Object.keys(a as object).sort();
      const bk = Object.keys(b as object).sort();
      if (JSON.stringify(ak) !== JSON.stringify(bk)) return false;
      return ak.every((k) => deepValueEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
    }
    return false;
  }
  function corruptValues(v: unknown): unknown {
    if (typeof v === 'string') return `${v}-w0-corrupted`;
    if (typeof v === 'number') return v + 1234567;
    if (typeof v === 'boolean') return !v;
    if (Array.isArray(v)) return v.map(corruptValues);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as object).map(([k, vv]) => [k, corruptValues(vv)]));
    return v;
  }
  function validateManifestRowShape(e: unknown): string[] {
    const problems: string[] = [];
    if (!isRecord(e)) return ['row is not an object'];
    if (typeof e.capability !== 'string' || !e.capability.trim()) problems.push('missing/empty capability');
    if (typeof e.uiEntryPoint !== 'string') problems.push('missing uiEntryPoint');
    if (!Array.isArray(e.cliArgs) || !e.cliArgs.every((a) => typeof a === 'string')) problems.push('cliArgs must be a string[]');
    if (typeof e.httpMethod !== 'string' || !VALID_HTTP_METHODS.test(e.httpMethod)) problems.push('invalid httpMethod');
    if (typeof e.httpPath !== 'string' || !e.httpPath.startsWith('/')) problems.push('httpPath must start with /');
    if (typeof e.outputSchema !== 'string') problems.push('missing outputSchema');
    if (typeof e.parityApplicable !== 'boolean') problems.push('parityApplicable must be boolean');
    if (e.parityApplicable === false && !(typeof e.reason === 'string' && e.reason.trim())) problems.push('parityApplicable=false requires a reason');
    // Round-9 C0-10 amendment: ALL-method rows need a concrete probeMethod
    // (you cannot literally issue an HTTP request with method "ALL"); this
    // is the missing declaration named when a row needs it and lacks it.
    if (e.httpMethod === 'ALL' && !(typeof e.probeMethod === 'string' && VALID_CONCRETE_METHODS.test(e.probeMethod))) {
      problems.push('httpMethod=ALL requires a concrete probeMethod (GET|POST|PUT|PATCH|DELETE|OPTIONS) declared for live probing');
    }
    // Round-10 C0-10-MISSING-DECLARATIONS-NONSTRUCTURAL (Sol confirmation
    // review): probePath was only type-checked when present, never REQUIRED
    // -- an ALL row could omit it entirely and escape detection until (or
    // unless) it happened to land in the random 3-row sample. This check
    // runs over every row in the manifest deterministically, independent of
    // sampling, and fails BY NAME.
    if (e.httpMethod === 'ALL' && !(typeof e.probePath === 'string' && e.probePath.startsWith('/'))) {
      problems.push('httpMethod=ALL requires a concrete probePath declared for live probing (the literal "ALL" registration pattern is not itself a probeable instance) -- missing declaration');
    }
    if (e.probeMethod !== undefined && !(typeof e.probeMethod === 'string' && VALID_CONCRETE_METHODS.test(e.probeMethod))) {
      problems.push('probeMethod must be a concrete HTTP method (GET|POST|PUT|PATCH|DELETE|OPTIONS) when present');
    }
    if (e.probePath !== undefined && !(typeof e.probePath === 'string' && e.probePath.startsWith('/'))) problems.push('probePath must start with / when present');
    // Round-10 C0-10-MISSING-DECLARATIONS-NONSTRUCTURAL: a body-bearing
    // effective method (POST/PUT/PATCH directly, or ALL whose declared
    // probeMethod is body-bearing) now REQUIRES probeBody -- deterministic
    // over every row, so a body-bearing capability can no longer silently
    // probe with an empty body just because it wasn't in the sample.
    {
      const effectiveMethodForBodyCheck = e.httpMethod === 'ALL' ? (typeof e.probeMethod === 'string' ? e.probeMethod : undefined) : (typeof e.httpMethod === 'string' ? e.httpMethod : undefined);
      if (typeof effectiveMethodForBodyCheck === 'string' && isBodyBearingMethod(effectiveMethodForBodyCheck) && e.probeBody === undefined) {
        problems.push(`body-bearing method (${effectiveMethodForBodyCheck}) requires a declared probeBody for live probing -- missing declaration`);
      }
    }
    if (e.valueComparison !== undefined) {
      if (!isRecord(e.valueComparison)) {
        problems.push('valueComparison must be an object when present');
      } else {
        const vc = e.valueComparison;
        if (typeof vc.mode !== 'string' || !VALID_VALUE_COMPARISON_MODES.includes(vc.mode)) {
          problems.push(`valueComparison.mode must be one of ${VALID_VALUE_COMPARISON_MODES.join('|')}`);
        }
        if (vc.mode === 'composite' && (!Array.isArray(vc.fields) || vc.fields.length === 0 || !vc.fields.every((f) => typeof f === 'string'))) {
          problems.push('valueComparison mode=composite requires a non-empty fields: string[] declaration (missing declaration)');
        }
        if (vc.sortKey !== undefined && typeof vc.sortKey !== 'string') problems.push('valueComparison.sortKey must be a string when present');
        if (vc.encoding !== undefined && vc.encoding !== 'base64' && vc.encoding !== 'hex') problems.push('valueComparison.encoding must be "base64" or "hex" when present');
      }
    }
    return problems;
  }

  // Sol REJECT round 2, finding 1: this sentinel and its matching END
  // comment below bound the scan span the identifier-scope audit (inside
  // this criterion) reads from this file's own current source -- see that
  // audit's comment for why the span exists and what it is checking.
  /* C0-10-CRITERION-BEGIN */
  await checkCriterion('C0-10', 'SUBCOMMAND_MAP capability ids must be SET-EQUAL (exact, no substring) to manifest capability names; full structural validation of ALL rows, deterministic and independent of the random 3-row sample; live sampled invocations use a nonce-bearing value check, not shape-only, with equivalent HTTP bodies and declared canonicalizers where needed', 'set-equal capability ids, unique rows, every row structurally valid; httpMethod may be a concrete verb or the literal "ALL" (Express .all() registrations), in which case a concrete probeMethod AND a concrete probePath are BOTH REQUIRED declarations, checked over every row (not just the sample); any body-bearing effective method (POST/PUT/PATCH, or ALL whose probeMethod is body-bearing) REQUIRES a declared probeBody, also checked over every row; a row missing a required declaration fails BY NAME regardless of sampling; a row\'s declared valueComparison (unordered-array/composite/binary) canonicalizes BOTH surfaces before comparison -- absent or mode=exact stays a REAL, unrelaxed, ordered byte-level check (the preserved implementation duty); composite mode requires EVERY declared field to be present and non-empty in BOTH payloads (a field missing from either is a structural fail, never a silently-equal undefined projection); binary mode strictly validates the encoding (hex: /^[0-9a-f]+$/i even length; base64: charset+padding+round-trip re-encode) BEFORE decoding -- malformed input is a structural fail, never permissively decoded; sample invocations prove the CLI reaches the manifest\'s SAME handler via a nonce value, not just matching key shapes; a composite/binary precondition failure fails the entry regardless of nonce success (conjunctive, never masked); randomized red control exercises the SAME canonicalizer and precondition checks as its basis row and must still fail for a genuine mismatch -- the basis is required to have at least one leaf corruptValues can actually change (an empty-array/object payload is skipped), widening deterministically over the rest of the manifest, alphabetically, until a corruptible basis is found or all applicable capabilities are exhausted; every od CLI subprocess this criterion launches (identity canary, sampled/widened probes, and the bespoke artifacts/figma probes) receives the CURRENT isolated boot\'s own dataDir as OD_DATA_DIR, audited per-launch and hard-failed if any launch could resolve to <repo>/.od; a typed sampling-excluded allowlist entry (capability + source fingerprint + commit, same rigor as C0-7\'s allowlist classes) removes its capability from the random sample and the widened red-control search only, never from set-equality/structural/route-registration checks; the artifacts capability is graded by gate-owned nonce-bound create+observe read-after-write on both the CLI and HTTP surfaces, never response-body substring matching; the figma capability is graded by a real multipart probe against a gate-owned known-good .fig fixture, sending the same bytes and fields the CLI itself sends', async () => {
    if (!fileExists(capabilityManifestRel)) { record('C0-10', '', '', false, '', { detail: `missing: ${capabilityManifestRel}` }); return; }
    let manifest: CapabilityManifestEntry[] = [];
    try {
      const raw = JSON.parse(readRepoFile(capabilityManifestRel));
      if (!Array.isArray(raw)) throw new Error('top-level value must be an array');
      manifest = raw as CapabilityManifestEntry[];
    } catch (err) { record('C0-10', '', '', false, '', { detail: `invalid manifest JSON: ${String(err)}` }); return; }

    const problems: string[] = [];
    for (let i = 0; i < manifest.length; i++) {
      const rowProblems = validateManifestRowShape(manifest[i]);
      if (rowProblems.length > 0) problems.push(`row ${i} ("${(manifest[i] as { capability?: string })?.capability ?? '?'}"): ${rowProblems.join(', ')}`);
    }
    const capNames = manifest.map((e) => e.capability);
    const dupCapNames = capNames.filter((c, i) => capNames.indexOf(c) !== i);
    if (dupCapNames.length > 0) problems.push(`duplicate capability names: ${[...new Set(dupCapNames)].join(', ')}`);
    const subcommandKeys = extractSubcommandMapKeys();
    const manifestCapSet = new Set(capNames);
    const subcommandSet = new Set(subcommandKeys);
    const missingSubcommands = subcommandKeys.filter((k) => !manifestCapSet.has(k));
    // Round-4 F10: TRUE set equality -- a manifest capability name that is
    // not itself a SUBCOMMAND_MAP key fails, same as a missing key. This
    // closes the "pad the applicable floor with fake rows" gaming vector.
    const extraCapabilities = capNames.filter((c) => !subcommandSet.has(c));
    if (missingSubcommands.length > 0) problems.push(`SUBCOMMAND_MAP keys with no exact-name manifest entry: ${missingSubcommands.join(', ')}`);
    if (extraCapabilities.length > 0) problems.push(`manifest capabilities not in SUBCOMMAND_MAP (set equality violated): ${extraCapabilities.join(', ')}`);

    const applicable = manifest.filter((e) => e.parityApplicable);
    const notApplicableWithoutReason = manifest.filter((e) => !e.parityApplicable && !e.reason?.trim());
    problems.push(...notApplicableWithoutReason.map((e) => `capability "${e.capability}": parityApplicable=false without a reason`));
    if (applicable.length < subcommandKeys.length) problems.push(`applicable count (${applicable.length}) below SUBCOMMAND_MAP floor (${subcommandKeys.length})`);
    if (applicable.length === 0) problems.push('manifest has zero applicable capabilities');

    // Round-final coordinator ruling, item 3: typed allowlist class
    // "sampling-excluded" (same shared orchestrator-owned allowlist file as
    // C0-7's dynamic-row/canary-unreachable classes -- loaded independently
    // here, scoped to entryClass === 'sampling-excluded' only; C0-7 never
    // judges these entries, and this criterion never judges C0-7's own
    // entries -- each criterion owns exactly its own class). An entry binds
    // to {capability, source fingerprint, commit} with the SAME rigor as
    // every other class (fingerprint/commit reuse the identical generic
    // functions C0-7 uses); a valid entry excludes its capability from the
    // random 3-sample AND the red-control widened search ONLY -- it stays
    // fully subject to set-equality, structural row validation, and the
    // registered-live-route check above, unaffected by exclusion.
    const { entries: allowlistEntriesC10, status: allowlistStatusC10 } = loadUnreachableAllowlist();
    const samplingExcludedEntries = allowlistEntriesC10.filter((e) => e.entryClass === 'sampling-excluded');
    const staleSamplingExcludedEntries: { entry: UnreachableAllowlistEntry; reason: string }[] = [];
    const commitValidationBySamplingEntry = new Map<UnreachableAllowlistEntry, { status: CommitValidationStatus; detail?: string }>();
    for (const e of samplingExcludedEntries) {
      const fp = computeSourceLineFingerprint(e.file, e.line);
      if (!fp.ok) staleSamplingExcludedEntries.push({ entry: e, reason: fp.reason ?? 'unresolvable' });
      else if (fp.hash?.toLowerCase() !== e.sourceFingerprint.toLowerCase()) staleSamplingExcludedEntries.push({ entry: e, reason: `fingerprint mismatch: recomputed ${fp.hash} != declared ${e.sourceFingerprint}` });
      const cv = validateEntryCommitBinding(e);
      commitValidationBySamplingEntry.set(e, cv);
      if (cv.status !== 'ok') staleSamplingExcludedEntries.push({ entry: e, reason: `commit-binding invalid (${cv.status}): ${cv.detail ?? ''}` });
    }
    const samplingExcludedKeyCounts = new Map<string, number>();
    for (const e of samplingExcludedEntries) { const k = e.capability ?? ''; samplingExcludedKeyCounts.set(k, (samplingExcludedKeyCounts.get(k) ?? 0) + 1); }
    const duplicateSamplingExcludedEntries = samplingExcludedEntries.filter((e) => (samplingExcludedKeyCounts.get(e.capability ?? '') ?? 0) > 1);
    const unusedSamplingExcludedEntries = samplingExcludedEntries.filter((e) => typeof e.capability !== 'string' || !manifestCapSet.has(e.capability));
    const invalidSamplingExcludedEntries = new Set<UnreachableAllowlistEntry>([
      ...staleSamplingExcludedEntries.map((s) => s.entry),
      ...duplicateSamplingExcludedEntries,
      ...unusedSamplingExcludedEntries,
    ]);
    // Fail-closed: only VALID (non-stale, non-duplicate, non-unused) entries
    // actually exclude a capability from sampling -- an invalid entry
    // authorizes nothing, same fail-closed posture as every other class.
    const excludedCapabilityNames = new Set(samplingExcludedEntries.filter((e) => !invalidSamplingExcludedEntries.has(e)).map((e) => e.capability as string));

    const sampleResults: { capability: string; ok: boolean; detail: string }[] = [];
    let redControlOk = false, redControlDetail = '';
    let identityOk = false;
    let artifactsNonceBindingOk = false, artifactsNonceBindingDetail = '';
    let figmaMultipartOk = false, figmaMultipartDetail = '';
    let daemon: BootedDaemon | null = null;
    // Round-final coordinator ruling, item 1 (safety defect): every `od`
    // CLI subprocess this criterion launches MUST receive the CURRENT
    // isolated boot's OWN dataDir as OD_DATA_DIR (AGENTS.md "Daemon data
    // directory contract" -- subprocesses "must inherit the daemon's truth
    // source instead of guessing their own data path"; a missing
    // OD_DATA_DIR is a named forbidden-pattern escape that can fall through
    // to a cwd-relative legacy default, i.e. <repo>/.od).
    //
    // Sol REJECT round 1, finding 1: buildOdCliEnv alone only audits
    // launches that actually CALL it -- a regressed inline env construction
    // would never appear in odDataDirAudit, and the old odDataDirLeaks
    // check (computed only from what the audit DOES contain) would stay
    // green while that launch silently used <repo>/.od.
    //
    // Sol REJECT round 2, same finding: the round-1 fix (a lexical count of
    // one specific call SHAPE) was still not structural -- an equivalent
    // one-line launch using a different call shape (spawn, a different
    // program identifier, a wrapped/derived path expression, an array
    // spread, etc.) would leave that lexical count unchanged while still
    // reaching the SAME binary, because every such shape has to reference
    // the SAME identifier to do so. The structural fix moves enforcement to
    // the IDENTIFIER, not the call shape: see the sentinel-delimited
    // identifier-scope audit after the try/finally below, which asserts
    // that -- within this criterion's own sentinel-delimited extent -- the
    // od-binary-path constant's bare identifier appears ONLY inside
    // runOdCli's own sentinel-delimited body, catching any shape that
    // references it anywhere else in this criterion, without having to
    // enumerate call shapes. (An implementer who re-derives the binary path
    // from scratch WITHOUT referencing this identifier at all is deliberate
    // multi-step evasion, out of this check's scope by design.)
    //
    // Also fixed (round 1): resolvesUnderRepoOd previously tested equality
    // only -- a dataDir resolving to a DESCENDANT of <repo>/.od (or of
    // repoRoot) would not have been caught. Now checks startsWith too.
    const odDataDirAudit: { site: string; dataDir: string | undefined; matchesBootedDataDir: boolean; resolvesUnderRepoOd: boolean }[] = [];
    const repoOdDir = path.join(repoRoot, '.od');
    function isUnderRepoOd(resolved: string | undefined): boolean {
      if (typeof resolved !== 'string') return false;
      return resolved === repoOdDir || resolved.startsWith(`${repoOdDir}${path.sep}`) || resolved === repoRoot || resolved.startsWith(`${repoRoot}${path.sep}`);
    }
    function buildOdCliEnv(bootedDaemon: BootedDaemon, site: string): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = { ...odDataEnv(bootedDaemon.dataDir), OD_DAEMON_URL: bootedDaemon.url };
      const resolved = typeof env.OD_DATA_DIR === 'string' ? path.resolve(env.OD_DATA_DIR) : undefined;
      odDataDirAudit.push({
        site,
        dataDir: env.OD_DATA_DIR,
        matchesBootedDataDir: env.OD_DATA_DIR === bootedDaemon.dataDir,
        resolvesUnderRepoOd: isUnderRepoOd(resolved),
      });
      return env;
    }
    // The single, structurally-enforced execFileAsync call site for every
    // od CLI launch this criterion performs -- see the sentinel-delimited
    // identifier-scope audit after the try/finally below. The BEGIN/END
    // comments immediately surrounding this function are load-bearing:
    // that audit locates this exact span at gate-run time and treats it as
    // the one place permitted to reference the od-binary-path constant.
    /* RUNODCLI-BODY-BEGIN */
    async function runOdCli(bootedDaemon: BootedDaemon, site: string, args: string[], timeoutMs: number): Promise<{ stdout: string }> {
      return execFileAsync('node', [odBinPath, ...args], { env: buildOdCliEnv(bootedDaemon, site), timeout: timeoutMs });
    }
    /* RUNODCLI-BODY-END */
    const requiredOdCliSitePatterns: { label: string; matches: (site: string) => boolean }[] = [
      { label: 'identity-canary', matches: (s) => s === 'identity-canary' },
      { label: 'artifacts-nonce-binding:cli-create', matches: (s) => s === 'artifacts-nonce-binding:cli-create' },
      { label: 'artifacts-nonce-binding:cli-observe', matches: (s) => s === 'artifacts-nonce-binding:cli-observe' },
      { label: 'figma-multipart:cli', matches: (s) => s === 'figma-multipart:cli' },
      { label: 'probeCapabilityEntry:*', matches: (s) => s.startsWith('probeCapabilityEntry:') },
    ];
    try {
      daemon = await bootDaemonForProbing();
      const liveRouteKeys = new Set(daemon.routeInventory.map((r) => `${r.method} ${r.path}`));
      // Round-9 C0-10 amendment: httpMethod='ALL' matches an Express
      // `.all()` registration's route-inventory entry directly (recorded as
      // method 'ALL' by installRouteRegistrationGuard) -- no special-casing
      // needed here, it is checked with the exact same equality as any
      // other method now that the schema permits the literal value 'ALL'.
      for (const e of applicable) if (!liveRouteKeys.has(`${e.httpMethod} ${e.httpPath}`)) problems.push(`capability "${e.capability}": ${e.httpMethod} ${e.httpPath} is not a registered route`);

      const nonce = `w0-nonce-${crypto.randomBytes(8).toString('hex')}`;
      await fetch(`${daemon.url}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: nonce, name: nonce }) }).catch(() => null);
      try {
        const { stdout } = await runOdCli(daemon, 'identity-canary', ['project', 'list', '--json'], 30_000);
        identityOk = stdout.includes(nonce);
      } catch (err) {
        identityOk = false;
        problems.push(`identity canary failed: ${String(err)}`);
      }
      if (!identityOk) problems.push('identity canary did not observe the nonce project through the CLI');

      // Round-final coordinator ruling, item 4a (artifacts): the generic
      // per-sample nonceCheck (response BODY contains the nonce substring)
      // cannot honestly bind "artifacts" -- POST /api/projects/:id/files's
      // JSON response never echoes the parent project id (manifest reason
      // field, C0-10 live-sample finding), and cliArgs substitution was
      // exact-match-only (could not embed a nonce into a larger filename
      // string). Gate-owned nonce binding instead, unconditional (like the
      // identity canary -- never sample-gated): the nonce is embedded as a
      // SUBSTRING into a valid filename (extension preserved), and BOTH the
      // real CLI surface (od artifacts create + od files list --json) and
      // the real HTTP surface (POST + GET .../files) independently create
      // AND observe (read-after-write) their own nonce-bound resource.
      {
        const r = await probeArtifactsNonceBinding(daemon, nonce);
        artifactsNonceBindingOk = r.ok;
        artifactsNonceBindingDetail = r.detail;
        if (!artifactsNonceBindingOk) problems.push(`artifacts nonce-binding create+observe probe failed: ${r.detail}`);
      }

      // Round-final coordinator ruling, item 4b (figma): the manifest's
      // declared --file fixtures/w0-manifest-check.fig does not exist
      // anywhere in this repository, and the generic probeCapabilityEntry
      // mechanism only ever sends application/json bodies -- POST
      // .../figma/import is multipart/form-data-only, so no JSON body can
      // ever reach a genuine success there. Unconditional (never
      // sample-gated), using the gate-owned known-good fixture provisioned
      // at scripts/waves/fixtures/w0-figma-check.fig.
      // r2 amendment 2026-07-27: this declaration must lexically precede the
      // probeFigmaMultipart call below -- it previously sat ~100 lines after
      // the call site in the same block scope, so every run crashed on a TDZ
      // ReferenceError before any manifest validity mattered.
      const figmaFixturePath = path.join(repoRoot, 'scripts/waves/fixtures/w0-figma-check.fig');
      {
        const r = await probeFigmaMultipart(daemon, nonce);
        figmaMultipartOk = r.ok;
        figmaMultipartDetail = r.detail;
        if (!figmaMultipartOk) problems.push(`figma multipart probe failed: ${r.detail}`);
      }

      // Round-final coordinator ruling, item 3: sampling-excluded
      // capabilities are drawn from neither the random 3-sample nor the
      // red-control widened search -- samplingEligible, never applicable,
      // feeds both. All structural/route-registration checks above already
      // ran over `applicable` (unaffected).
      const samplingEligible = applicable.filter((e) => !excludedCapabilityNames.has(e.capability));
      const shuffled = [...samplingEligible].sort(() => Math.random() - 0.5);
      const sample = shuffled.length <= 3 ? shuffled : shuffled.slice(0, 3);
      // Round-4 F11: every sample is bound to a value-level check, not just
      // project-scoped ones -- and captured cliJson/httpBody feed the red
      // control below so it exercises the SAME comparator on real data.
      // Round-9: captured samples also retain the entry's valueComparison
      // spec so the red control canonicalizes identically to the real check.
      // Round-final coordinator ruling, item 4a (artifacts): gate-owned
      // nonce binding replacing the response-body substring check the
      // manifest's own reason field documents as structurally impossible
      // for this capability. Each call uses a fresh per-call id (callId) so
      // repeat invocations (the unconditional call above, plus a possible
      // re-invocation if "artifacts" is ALSO drawn into the random sample
      // or widened search below) never collide on an already-created
      // filename/project.
      async function probeArtifactsNonceBinding(bootedDaemon: BootedDaemon, nonceValue: string): Promise<{ ok: boolean; detail: string }> {
        const problems: string[] = [];
        const callId = crypto.randomBytes(4).toString('hex');
        const cliFileName = `w0-artifacts-cli-${nonceValue}-${callId}.html`;
        const httpFileName = `w0-artifacts-http-${nonceValue}-${callId}.html`;
        const cliProjectId = `w0-artifacts-cli-${nonceValue}-${callId}`;
        const httpProjectId = `w0-artifacts-http-${nonceValue}-${callId}`;
        for (const id of [cliProjectId, httpProjectId]) {
          await fetch(`${bootedDaemon.url}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: id }) }).catch(() => null);
        }
        const inputFile = path.join(os.tmpdir(), `w0-artifacts-input-${nonceValue}-${callId}.html`);
        fs.writeFileSync(inputFile, '<!doctype html><title>w0 artifacts nonce probe</title>');
        let cliCreateOk = false;
        try {
          await runOdCli(bootedDaemon, 'artifacts-nonce-binding:cli-create', ['artifacts', 'create', '--name', cliFileName, '--input', inputFile, '--project', cliProjectId], 60_000);
          cliCreateOk = true;
        } catch (err) { problems.push(`CLI artifacts create failed: ${String(err)}`); }
        finally { try { fs.unlinkSync(inputFile); } catch { /* best effort */ } }
        let httpCreateOk = false;
        try {
          const res = await fetch(`${bootedDaemon.url}/api/projects/${encodeURIComponent(httpProjectId)}/files`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: httpFileName, content: '<!doctype html><title>w0 artifacts nonce probe (http)</title>', encoding: 'utf8' }),
          });
          httpCreateOk = res.ok;
          if (!res.ok) problems.push(`HTTP artifacts create failed: status ${res.status}`);
        } catch (err) { problems.push(`HTTP artifacts create failed: ${String(err)}`); }
        async function cliListsFile(projectId: string, name: string): Promise<boolean> {
          try {
            const { stdout } = await runOdCli(bootedDaemon, 'artifacts-nonce-binding:cli-observe', ['files', 'list', projectId, '--json'], 30_000);
            const parsed: unknown = JSON.parse(stdout);
            const files = isRecord(parsed) && Array.isArray(parsed.files) ? (parsed.files as unknown[]) : [];
            return files.some((f) => isRecord(f) && (f.name === name || f.path === name));
          } catch { return false; }
        }
        async function httpListsFile(projectId: string, name: string): Promise<boolean> {
          try {
            const res = await fetch(`${bootedDaemon.url}/api/projects/${encodeURIComponent(projectId)}/files`);
            const body: unknown = await res.json().catch(() => null);
            const files = isRecord(body) && Array.isArray(body.files) ? (body.files as unknown[]) : [];
            return res.ok && files.some((f) => isRecord(f) && (f.name === name || f.path === name));
          } catch { return false; }
        }
        const cliObservesOwn = await cliListsFile(cliProjectId, cliFileName);
        const httpObservesOwn = await httpListsFile(httpProjectId, httpFileName);
        if (!cliObservesOwn) problems.push('CLI-created artifact not observed via read-after-write (od files list) under the CLI nonce project');
        if (!httpObservesOwn) problems.push('HTTP-created artifact not observed via read-after-write (GET .../files) under the HTTP nonce project');
        const ok = cliCreateOk && httpCreateOk && cliObservesOwn && httpObservesOwn;
        return { ok, detail: `cliCreateOk=${cliCreateOk} httpCreateOk=${httpCreateOk} cliObservesOwn=${cliObservesOwn} httpObservesOwn=${httpObservesOwn} problems=${JSON.stringify(problems)}` };
      }

      // Round-final coordinator ruling, item 4b (figma): a manifest-declared
      // multipart probe using a gate-owned known-good .fig fixture,
      // provisioned as part of this amendment at
      // scripts/waves/fixtures/w0-figma-check.fig -- the smallest
      // deterministically-constructible valid .fig: a raw (unwrapped, no
      // ZIP container -- apps/daemon/src/figma/fig-decode.ts explicitly
      // supports this as a first-class "source: raw" input, not a degraded
      // fallback) fig-kiwi canvas defining ONE minimal, self-consistent
      // kiwi schema/message pair (a single real DOCUMENT node) -- verified
      // to decode with decoded=true, nodeCount=1 through the actual
      // apps/daemon/src/figma/fig-decode.ts + figma-import.ts product code
      // before being committed. Sends the same bytes and fields the real
      // CLI sends
      // (apps/daemon/src/cli.ts figma import: form.append('file', new
      // Blob([bytes]), basename(file)); no other fields when --notes is
      // absent, which it is here). figmaFixturePath is declared above the
      // probeFigmaMultipart call site (r2 amendment 2026-07-27, TDZ fix).
      // Round-final coordinator ruling (Sol REJECT, finding 3): shape-only
      // validation (label/snapshotDir/inventory/suggestedPrompt all
      // present) is satisfied by a lazy handler returning a static,
      // assets-only stub with inventory.decoded=false and
      // inventory.nodeCount=0 -- the gate-owned fixture's own genuine
      // decodability (verified offline: decoded=true, nodeCount=1) is not
      // load-bearing unless the response is required to actually reflect
      // it. Both success legs now require the REAL response to report
      // inventory.decoded === true and inventory.nodeCount >= 1.
      function validateFigmaOutputShape(v: unknown): boolean {
        if (!isRecord(v) || typeof v.label !== 'string' || typeof v.snapshotDir !== 'string' || !isRecord(v.inventory) || typeof v.suggestedPrompt !== 'string') return false;
        const inventory = v.inventory;
        return inventory.decoded === true && typeof inventory.nodeCount === 'number' && inventory.nodeCount >= 1;
      }
      async function probeFigmaMultipart(bootedDaemon: BootedDaemon, nonceValue: string): Promise<{ ok: boolean; detail: string }> {
        const problems: string[] = [];
        if (!fs.existsSync(figmaFixturePath)) return { ok: false, detail: `gate-owned fixture missing: ${figmaFixturePath}` };
        const fixtureBytes = fs.readFileSync(figmaFixturePath);
        const callId = crypto.randomBytes(4).toString('hex');
        const cliProjectId = `w0-figma-cli-${nonceValue}-${callId}`;
        const httpProjectId = `w0-figma-http-${nonceValue}-${callId}`;
        for (const id of [cliProjectId, httpProjectId]) {
          await fetch(`${bootedDaemon.url}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: id }) }).catch(() => null);
        }
        let cliOk = false;
        try {
          const { stdout } = await runOdCli(bootedDaemon, 'figma-multipart:cli', ['figma', 'import', '--project', cliProjectId, '--file', figmaFixturePath, '--json'], 60_000);
          const cliJson: unknown = JSON.parse(stdout);
          cliOk = validateFigmaOutputShape(cliJson);
          if (!cliOk) problems.push(`CLI response missing declared outputSchema keys: ${stdout.slice(0, 500)}`);
        } catch (err) { problems.push(`CLI figma import failed: ${String(err)}`); }
        let httpOk = false;
        try {
          const form = new FormData();
          form.append('file', new Blob([fixtureBytes]), path.basename(figmaFixturePath));
          const res = await fetch(`${bootedDaemon.url}/api/projects/${encodeURIComponent(httpProjectId)}/figma/import`, { method: 'POST', body: form });
          const httpJson: unknown = await res.json().catch(() => null);
          httpOk = res.ok && validateFigmaOutputShape(httpJson);
          if (!httpOk) problems.push(`HTTP multipart response invalid: status=${res.status} body=${JSON.stringify(httpJson).slice(0, 500)}`);
        } catch (err) { problems.push(`HTTP figma multipart probe failed: ${String(err)}`); }
        const ok = cliOk && httpOk;
        return { ok, detail: `cliOk=${cliOk} httpOk=${httpOk} fixture=${figmaFixturePath} fixtureBytes=${fixtureBytes.length} problems=${JSON.stringify(problems)}` };
      }

      // Round-11 Ruling B: factored into a standalone function so the same
      // probe logic can be re-run for the red control's widened search
      // without duplicating it.
      async function probeCapabilityEntry(entry: CapabilityManifestEntry, bootedDaemon: BootedDaemon, nonceValue: string): Promise<{ cliOk: boolean; httpOk: boolean; cliJson: unknown; httpBody: unknown; entryOk: boolean; detail: string; valueComparison: ValueComparisonSpec | undefined }> {
        // Round-final coordinator ruling, items 4a/4b: "artifacts" and
        // "figma" are structurally unable to pass the generic nonce-
        // substring / JSON-body mechanism below (documented in the
        // manifest's own reason field for each) -- delegate to their
        // bespoke gate-owned probes instead, wherever this function is
        // invoked from (the unconditional calls above already cover them,
        // but the random sample / widened search may ALSO draw them; this
        // ensures they are never independently re-judged by the broken
        // generic path either way).
        if (entry.capability === 'artifacts') {
          const r = await probeArtifactsNonceBinding(bootedDaemon, nonceValue);
          return { cliOk: r.ok, httpOk: r.ok, cliJson: null, httpBody: null, entryOk: r.ok, detail: r.detail, valueComparison: entry.valueComparison };
        }
        if (entry.capability === 'figma') {
          const r = await probeFigmaMultipart(bootedDaemon, nonceValue);
          return { cliOk: r.ok, httpOk: r.ok, cliJson: null, httpBody: null, entryOk: r.ok, detail: r.detail, valueComparison: entry.valueComparison };
        }
        const daemonUrl = bootedDaemon.url;
        // Value-level nonce check when the capability's route is
        // project/resource-scoped -- proves the CLI reaches the SAME
        // handler (static JSON can't know a value the verifier just
        // created).
        const isProjectScoped = /:projectId|:id/i.test(entry.httpPath) || entry.cliArgs.some((a) => a === nonceValue || /project/i.test(a));
        let nonceCheck: { attempted: boolean; ok: boolean } = { attempted: false, ok: false };
        let cliStdout = '', cliOk = false;
        try {
          const args = entry.cliArgs.map((a) => (a === '<nonceProjectId>' ? nonceValue : a));
          const { stdout } = await runOdCli(bootedDaemon, `probeCapabilityEntry:${entry.capability}`, args, 60_000);
          cliStdout = stdout;
          cliOk = true;
        } catch { cliOk = false; }
        let httpOk = false, httpBody: unknown = null, httpText = '';
        try {
          // Round-9 C0-10 amendment: httpMethod='ALL' cannot itself be sent
          // as a request method -- probeMethod (structurally required for
          // ALL rows) supplies the concrete verb. probePath overrides
          // httpPath when the declared route needs a different concrete
          // instance to probe. probeBody supplies an equivalent HTTP body
          // (with '<nonceProjectId>' substitution) for POST/PUT/PATCH rows
          // that need one -- the old probe never sent a body at all.
          const effectiveMethod = entry.httpMethod === 'ALL' ? (entry.probeMethod as string) : entry.httpMethod;
          const rawPath = entry.probePath ?? entry.httpPath;
          const httpPath = rawPath.replace(/:projectId|:id/i, nonceValue);
          const init: RequestInit = { method: effectiveMethod };
          if (entry.probeBody !== undefined) {
            init.headers = { 'Content-Type': 'application/json' };
            init.body = JSON.stringify(substituteNoncePlaceholder(entry.probeBody, nonceValue));
          }
          const res = await fetch(`${daemonUrl}${httpPath}`, init);
          httpText = await res.clone().text();
          httpBody = await res.json().catch(() => null);
          httpOk = res.ok;
        } catch { httpOk = false; }
        if (isProjectScoped) {
          nonceCheck = { attempted: true, ok: cliOk && httpOk && cliStdout.includes(nonceValue) && httpText.includes(nonceValue) };
        }
        const cliJson = cliOk ? (() => { try { return JSON.parse(cliStdout); } catch { return null; } })() : null;
        // Round-4 F11: for capabilities NOT bound by a nonce, require full
        // recursive VALUE equality between the CLI and HTTP payloads, not
        // merely a matching key shape -- a list-shaped capability must
        // contain the nonce resource in BOTH surfaces' lists (covered by
        // deepValueEqual over the whole array), and a pure-info capability
        // must match byte-for-byte on values. Round-9: canonicalized per the
        // row's DECLARED valueComparison first -- absent/exact stays a real,
        // unrelaxed, ordered check (the preserved implementation duty).
        // Round-10 C0-10-COMPOSITE-ESCAPE / C0-10-BINARY-FAILOPEN (Sol
        // confirmation review): a composite field missing from either
        // payload, or a binary value that isn't strictly valid encoded
        // data, is a STRUCTURAL fail in its own right -- checked BEFORE
        // canonicalization+comparison, never absorbed into a passing
        // deepValueEqual via a silently-equal undefined/permissive decode.
        const precondition = validateValueComparisonPreconditions(cliJson, httpBody, entry.valueComparison);
        const canonicalCli = canonicalizeForComparison(cliJson, entry.valueComparison);
        const canonicalHttp = canonicalizeForComparison(httpBody, entry.valueComparison);
        const valueEqual = cliOk && httpOk && precondition.ok && deepValueEqual(canonicalCli, canonicalHttp);
        // Round-11 C0-10 precondition-bypass (Sol confirmation review,
        // verify-w0.ts:2180 in the reviewed copy): entryOk used to pick
        // nonceCheck.ok ALONE whenever nonce-checking applied, completely
        // ignoring `precondition` -- a project-scoped capability could
        // declare a composite/binary valueComparison that structurally
        // fails (missing field, malformed encoding) while its nonce check
        // still passed, and entryOk would still be true. Preconditions are
        // now CONJUNCTIVE: a precondition failure fails the entry
        // regardless of nonce success.
        const entryOk = precondition.ok && (nonceCheck.attempted ? nonceCheck.ok : valueEqual);
        const detail = `nonceAttempted=${nonceCheck.attempted} nonceOk=${nonceCheck.ok} valueEqual=${valueEqual} valueComparisonMode=${entry.valueComparison?.mode ?? 'exact(default)'} preconditionOk=${precondition.ok} preconditionProblems=${JSON.stringify(precondition.problems)} cliOk=${cliOk} httpOk=${httpOk}`;
        return { cliOk, httpOk, cliJson, httpBody, entryOk, detail, valueComparison: entry.valueComparison };
      }
      const capturedSamples: { capability: string; cliOk: boolean; httpOk: boolean; cliJson: unknown; httpBody: unknown; valueComparison: ValueComparisonSpec | undefined }[] = [];
      for (const entry of sample) {
        const result = await probeCapabilityEntry(entry, daemon, nonce);
        capturedSamples.push({ capability: entry.capability, cliOk: result.cliOk, httpOk: result.httpOk, cliJson: result.cliJson, httpBody: result.httpBody, valueComparison: result.valueComparison });
        sampleResults.push({ capability: entry.capability, ok: result.entryOk, detail: result.detail });
      }

      // Round-4 F11: the red control now exercises the SAME comparator used
      // above (deepValueEqual), on a shape-IDENTICAL but value-CORRUPTED
      // pair built from a real captured sample -- proving discrimination is
      // on values, not key shape. A stub-vs-/api/health comparison could
      // pass or fail for reasons unrelated to value binding.
      // Round-11 Ruling B: the basis must be a payload corruptValues can
      // actually CHANGE -- an empty-array/empty-object payload corrupts to
      // itself, making the control vacuously ineffective. Skip such bases;
      // if none of the random 3-sample captures is corruptible, widen the
      // search DETERMINISTICALLY (alphabetical by capability name) over the
      // remaining applicable capabilities, probing one at a time, until a
      // corruptible basis is found or all are exhausted -- never fail this
      // randomly just because the 3-sample draw happened to be empty payloads.
      function hasCorruptibleLeaf(v: unknown): boolean {
        return JSON.stringify(corruptValues(v)) !== JSON.stringify(v);
      }
      let controlBasis = capturedSamples.find((s) => s.cliOk && s.httpOk && s.cliJson !== null && s.httpBody !== null && hasCorruptibleLeaf(s.httpBody));
      const widenedSearchCapabilitiesTried: string[] = [];
      if (!controlBasis) {
        const alreadyTried = new Set(sample.map((e) => e.capability));
        const remaining = samplingEligible.filter((e) => !alreadyTried.has(e.capability)).sort((a, b) => a.capability.localeCompare(b.capability));
        for (const entry of remaining) {
          widenedSearchCapabilitiesTried.push(entry.capability);
          const result = await probeCapabilityEntry(entry, daemon, nonce);
          const candidate = { capability: entry.capability, cliOk: result.cliOk, httpOk: result.httpOk, cliJson: result.cliJson, httpBody: result.httpBody, valueComparison: result.valueComparison };
          capturedSamples.push(candidate);
          if (candidate.cliOk && candidate.httpOk && candidate.cliJson !== null && candidate.httpBody !== null && hasCorruptibleLeaf(candidate.httpBody)) {
            controlBasis = candidate;
            break;
          }
        }
      }
      if (controlBasis) {
        const corrupted = corruptValues(controlBasis.httpBody);
        // shapeStillMatches is deliberately checked on the RAW (uncanonicalized)
        // pair -- it proves corruptValues() only mutated leaf values, not
        // structure. The discrimination check below uses the SAME
        // canonicalization the basis capability's real sample used, so a
        // row declaring e.g. unordered-array/composite/binary gets a red
        // control that is honest about what that mode actually compares.
        const shapeStillMatches = JSON.stringify(deepKeyStructure(controlBasis.cliJson)) === JSON.stringify(deepKeyStructure(corrupted));
        const controlPrecondition = validateValueComparisonPreconditions(controlBasis.cliJson, corrupted, controlBasis.valueComparison);
        const canonicalCliForControl = canonicalizeForComparison(controlBasis.cliJson, controlBasis.valueComparison);
        const canonicalCorrupted = canonicalizeForComparison(corrupted, controlBasis.valueComparison);
        // A precondition failure on the corrupted pair is ALSO a legitimate
        // "rejected" outcome for a red control -- the goal is that a
        // genuinely corrupted pair must fail one way or another.
        const valueCheckRejectsIt = !controlPrecondition.ok || !deepValueEqual(canonicalCliForControl, canonicalCorrupted);
        redControlOk = shapeStillMatches && valueCheckRejectsIt;
        redControlDetail = `basis=${controlBasis.capability} widenedSearch=${widenedSearchCapabilitiesTried.length > 0} widenedSearchCapabilitiesTried=${JSON.stringify(widenedSearchCapabilitiesTried)} valueComparisonMode=${controlBasis.valueComparison?.mode ?? 'exact(default)'} shapeStillMatches=${shapeStillMatches} controlPreconditionOk=${controlPrecondition.ok} valueCheckRejectsIt=${valueCheckRejectsIt}`;
      } else {
        redControlOk = false;
        redControlDetail = `no capability (3-sample draw plus a deterministic widened search over all ${applicable.length} applicable capabilities: ${JSON.stringify(widenedSearchCapabilitiesTried)}) produced a real CLI+HTTP payload pair with at least one corruptible leaf to build a red control from`;
      }
    } finally {
      if (daemon) await daemon.kill();
    }
    // Round-final coordinator ruling, item 1: a real regression, over every
    // launch this actual run performed -- proves OD_DATA_DIR was always
    // explicitly bound to the isolated boot's own dataDir and never absent
    // or resolvable to <repo>/.od / repoRoot (now including descendants,
    // not just exact equality).
    const odDataDirLeaks = odDataDirAudit.filter((a) => !a.matchesBootedDataDir || a.resolvesUnderRepoOd);
    // Sol REJECT, finding 1 (round-final confirmation), enforcement (2):
    // every distinct call-site label this criterion is supposed to
    // exercise every run must actually appear in the audit -- a code path
    // that stops calling runOdCli (without regressing to a raw call at
    // all) would otherwise leave a silent gap instead of a caught leak.
    const observedOdCliSites = odDataDirAudit.map((a) => a.site);
    const missingRequiredOdCliSites = requiredOdCliSitePatterns.filter((p) => !observedOdCliSites.some((s) => p.matches(s))).map((p) => p.label);
    const selfSourcePath = fileURLToPath(import.meta.url);
    const selfSourceText = fs.readFileSync(selfSourcePath, 'utf8');
    // Sol REJECT round 1, finding 1, enforcement (1): a self-inspecting
    // count of this file's OWN current source text. execFileAsync spawning
    // the od binary must appear EXACTLY ONCE anywhere in this file --
    // runOdCli's own definition -- so a regressed direct call added at any
    // OTHER site (bypassing runOdCli/buildOdCliEnv entirely, and therefore
    // invisible to odDataDirAudit) raises this count and is caught by name.
    // Kept unchanged in shape per round-2 instruction; the identifier
    // fragment below is split across a concatenation ONLY so this check's
    // own source text does not itself trip the round-2 identifier-scope
    // scan a few lines down (which -- correctly -- treats any bare
    // occurrence of the identifier as a reportable reference; this
    // detection code has to name the identifier to know what it is
    // scanning for, without becoming a false positive against itself).
    const RAW_OD_CLI_CALL_SITE_PATTERN = new RegExp(`execFileAsync\\(\\s*['"]node['"]\\s*,\\s*\\[\\s*${'od' + 'BinPath'}`, 'g');
    const rawOdCliCallSiteCount = (selfSourceText.match(RAW_OD_CLI_CALL_SITE_PATTERN) ?? []).length;
    const EXPECTED_RAW_OD_CLI_CALL_SITE_COUNT = 1; // runOdCli's own definition, nowhere else
    const unexpectedRawOdCliCallSiteCount = rawOdCliCallSiteCount !== EXPECTED_RAW_OD_CLI_CALL_SITE_COUNT;

    // Sol REJECT round 2, same finding: the count above only matches ONE
    // lexical call SHAPE (execFileAsync('node', [<identifier>, ...])) --
    // Sol's confirmation named four other one-line shapes (spawn(), a
    // different program identifier such as process.execPath, a wrapped
    // path expression such as path.resolve(<identifier>), and an array
    // spread) that all still have to reference the SAME bare identifier to
    // reach the binary, yet none of them match that one lexical pattern.
    // Rather than keep enumerating call shapes (a losing game -- there is
    // always one more shape), this scan is structural over the IDENTIFIER
    // itself, scoped to this criterion's own extent (the C0-10-CRITERION
    // sentinels wrapping this entire checkCriterion call, above and below):
    // within that extent, the bare token naming the od-binary-path
    // constant may appear ONLY inside runOdCli's own sentinel-delimited
    // body (the one place permitted to launch it) -- ANY other occurrence
    // anywhere else in THIS criterion's source is a hard fail, by
    // construction, regardless of call syntax. (Occurrences outside this
    // criterion entirely -- e.g. the constant's own module-level
    // declaration, and the separate, already-correct C0-1..C0-6
    // restore-product call sites that thread OD_DATA_DIR through their own
    // long-standing odDataEnv helper -- are out of scope for this check by
    // design: the original ruling names "both C0-10 CLI launch sites"
    // specifically, and "do not change restore product behavior" is a
    // standing constraint from that same ruling.)
    //
    // Sentinel-integrity comes FIRST and is unconditional: if a sentinel is
    // missing, duplicated, or out of order, the allowed region cannot be
    // trusted at all (a widened/unbounded region would silently defeat the
    // whole scan by making "everything after a deleted END sentinel" look
    // allowed, or "everything if the criterion span itself can't be found"
    // look allowed) -- so malformed sentinels are treated as zero allowed
    // regions, never as "no restriction", and every identifier occurrence
    // anywhere in the file is reported as out-of-scope in that case.
    function countLiteralOccurrences(haystack: string, needle: string): number {
      return needle.length === 0 ? 0 : haystack.split(needle).length - 1;
    }
    // Sentinel marker text, split across concatenation so these definition
    // lines never contain the sentinels' own contiguous text -- otherwise
    // each definition line would self-match its own "exactly one" search,
    // corrupting the sentinel-integrity count.
    const C0_10_CRITERION_BEGIN = '/* C0-10' + '-CRITERION-BEGIN */';
    const C0_10_CRITERION_END = '/* C0-10' + '-CRITERION-END */';
    const RUNODCLI_BODY_BEGIN = '/* RUNODCLI' + '-BODY-BEGIN */';
    const RUNODCLI_BODY_END = '/* RUNODCLI' + '-BODY-END */';
    const c010BeginCount = countLiteralOccurrences(selfSourceText, C0_10_CRITERION_BEGIN);
    const c010EndCount = countLiteralOccurrences(selfSourceText, C0_10_CRITERION_END);
    const c010BeginIndex = selfSourceText.indexOf(C0_10_CRITERION_BEGIN);
    const c010EndIndex = selfSourceText.indexOf(C0_10_CRITERION_END);
    const runOdCliBeginCount = countLiteralOccurrences(selfSourceText, RUNODCLI_BODY_BEGIN);
    const runOdCliEndCount = countLiteralOccurrences(selfSourceText, RUNODCLI_BODY_END);
    const runOdCliBeginIndex = selfSourceText.indexOf(RUNODCLI_BODY_BEGIN);
    const runOdCliEndIndex = selfSourceText.indexOf(RUNODCLI_BODY_END);
    const identifierScopeSentinelsOk =
      c010BeginCount === 1 && c010EndCount === 1 && c010BeginIndex !== -1 && c010EndIndex !== -1 && c010BeginIndex < c010EndIndex &&
      runOdCliBeginCount === 1 && runOdCliEndCount === 1 && runOdCliBeginIndex !== -1 && runOdCliEndIndex !== -1 && runOdCliBeginIndex < runOdCliEndIndex &&
      runOdCliBeginIndex > c010BeginIndex && runOdCliEndIndex < c010EndIndex; // runOdCli's body must nest INSIDE this criterion's own extent
    function withinRegion(index: number, start: number, endExclusive: number): boolean {
      return index >= start && index < endExclusive;
    }
    const ODBINPATH_TOKEN_PATTERN = new RegExp(`\\b${'od' + 'BinPath'}\\b`, 'g');
    const allOdBinPathOccurrenceIndices = [...selfSourceText.matchAll(ODBINPATH_TOKEN_PATTERN)]
      .map((m) => m.index)
      .filter((i): i is number => typeof i === 'number');
    const c010RegionEnd = c010EndIndex + C0_10_CRITERION_END.length;
    const runOdCliRegionEnd = runOdCliEndIndex + RUNODCLI_BODY_END.length;
    const occurrencesInsideC010Extent = identifierScopeSentinelsOk
      ? allOdBinPathOccurrenceIndices.filter((idx) => withinRegion(idx, c010BeginIndex, c010RegionEnd))
      : allOdBinPathOccurrenceIndices; // sentinel integrity itself failed -- fail closed over EVERY occurrence in the file, never silently narrow the scan to nothing
    const outOfScopeOdBinPathOccurrences = identifierScopeSentinelsOk
      ? occurrencesInsideC010Extent.filter((idx) => !withinRegion(idx, runOdCliBeginIndex, runOdCliRegionEnd))
      : occurrencesInsideC010Extent;
    const odBinPathIdentifierScopeViolation = !identifierScopeSentinelsOk || outOfScopeOdBinPathOccurrences.length > 0;

    const ok = problems.length === 0 && sampleResults.length > 0 && sampleResults.every((r) => r.ok) && redControlOk && identityOk &&
      artifactsNonceBindingOk && figmaMultipartOk &&
      odDataDirLeaks.length === 0 &&
      missingRequiredOdCliSites.length === 0 &&
      !unexpectedRawOdCliCallSiteCount &&
      !odBinPathIdentifierScopeViolation &&
      staleSamplingExcludedEntries.length === 0 && duplicateSamplingExcludedEntries.length === 0 && unusedSamplingExcludedEntries.length === 0;
    record('C0-10', '', '', ok,
      `manifest: ${manifest.length}, applicable: ${applicable.length}, SUBCOMMAND_MAP: ${subcommandKeys.length}\nproblems: ${problems.join('; ') || 'none'}\nsample: ${JSON.stringify(sampleResults)}\nred control: ${redControlDetail}\n` +
        `artifacts nonce-binding (item 4a): ok=${artifactsNonceBindingOk} ${artifactsNonceBindingDetail}\n` +
        `figma multipart (item 4b): ok=${figmaMultipartOk} ${figmaMultipartDetail}\n` +
        `OD_DATA_DIR audit (item 1 -- every od CLI launch this run performed; a leak is a launch that omitted OD_DATA_DIR, diverged from the booted daemon's own dataDir, or could resolve under or below <repo>/.od / repoRoot): ${JSON.stringify(odDataDirAudit)}; leaks: ${JSON.stringify(odDataDirLeaks)}\n` +
        `required od CLI launch-site coverage (every distinct call site must fire at least once): required=${JSON.stringify(requiredOdCliSitePatterns.map((p) => p.label))} observed=${JSON.stringify(observedOdCliSites)} missing=${JSON.stringify(missingRequiredOdCliSites)}\n` +
        `self-inspecting raw-call-site count (this file's own source; expected exactly ${EXPECTED_RAW_OD_CLI_CALL_SITE_COUNT}, inside runOdCli only): ${rawOdCliCallSiteCount}\n` +
        `identifier-scope audit (round-2 closure -- the od-binary-path constant's bare identifier may appear ONLY on its declaration line or inside runOdCli's sentinel-delimited body, regardless of call syntax elsewhere): sentinelsOk=${identifierScopeSentinelsOk} totalOccurrences=${allOdBinPathOccurrenceIndices.length} outOfScopeOccurrences=${outOfScopeOdBinPathOccurrences.length}\n` +
        `sampling-excluded (item 3): allowlistStatus=${allowlistStatusC10} entries=${JSON.stringify(samplingExcludedEntries.map((e) => ({ capability: e.capability, file: e.file, line: e.line, reason: e.reason })))} excludedCapabilities=${JSON.stringify([...excludedCapabilityNames])} staleEntries=${JSON.stringify(staleSamplingExcludedEntries)} duplicateEntries=${JSON.stringify(duplicateSamplingExcludedEntries)} unusedEntries=${JSON.stringify(unusedSamplingExcludedEntries)} per-entry commit-validation=${JSON.stringify(samplingExcludedEntries.map((e) => ({ capability: e.capability, ...commitValidationBySamplingEntry.get(e) })))}`,
      {
        detail: ok ? undefined : `problems=${problems.length} identityOk=${identityOk} sample=${JSON.stringify(sampleResults.map((r) => r.ok))} redControlOk=${redControlOk} artifactsNonceBindingOk=${artifactsNonceBindingOk} figmaMultipartOk=${figmaMultipartOk} odDataDirLeaks=${odDataDirLeaks.length} missingRequiredOdCliSites=${JSON.stringify(missingRequiredOdCliSites)} rawOdCliCallSiteCount=${rawOdCliCallSiteCount} identifierScopeSentinelsOk=${identifierScopeSentinelsOk} outOfScopeOdBinPathOccurrences=${outOfScopeOdBinPathOccurrences.length} staleSamplingExcludedEntries=${staleSamplingExcludedEntries.length} duplicateSamplingExcludedEntries=${duplicateSamplingExcludedEntries.length} unusedSamplingExcludedEntries=${unusedSamplingExcludedEntries.length}`,
      });
  });
  /* C0-10-CRITERION-END */

  // Round-3 F13 (manifest-schema half): mutate a REAL manifest row (remove
  // its cliArgs) rather than adding a synthetic one.
  // Round-4 F13 (source-surface half): a schema-only mutation can never
  // prove guard detects a REAL unmanifested UI/CLI/HTTP capability -- a
  // guard that only validates manifest.json's own internal shape would
  // stay green forever against actual source-level drift. Fixture #2
  // writes a REAL route registration file into apps/daemon/src/routes/
  // (following the exact export/registration shape every other file in
  // that directory uses) that is absent from the manifest, and requires
  // guard to name it.
  await checkCriterion('C0-11', 'two independent guard-defeat fixtures: (1) verifier mutates a COPY of the real committed manifest -- removes cliArgs from one real applicable capability; (2) verifier drops a REAL new route-registration source file into apps/daemon/src/routes/ that is absent from the manifest', 'guard must fail and attribute EACH fixture failure by name (capability / route path); both fixtures are reverted and guard must pass cleanly with a clean git tree afterward', () => {
    if (!fileExists(capabilityManifestRel)) { record('C0-11', '', '', false, '', { detail: `missing: ${capabilityManifestRel}` }); return; }
    const manifestAbs = path.join(repoRoot, capabilityManifestRel);
    const original = fs.readFileSync(manifestAbs, 'utf8');
    let brokenExit = 1, brokenStdout = '', revertedCleanly = false, targetCapability = '';
    try {
      const parsed = JSON.parse(original) as CapabilityManifestEntry[];
      const target = parsed.find((e) => e.parityApplicable && e.cliArgs?.length > 0);
      if (!target) {
        record('C0-11', '', '', false, '', { detail: 'no real applicable capability with cliArgs found in the committed manifest to mutate' });
        return;
      }
      targetCapability = target.capability;
      const mutated = parsed.map((e) => (e.capability === target.capability ? { ...e, cliArgs: [] } : e));
      fs.writeFileSync(manifestAbs, JSON.stringify(mutated, null, 2));
      const brokenRun = sh('pnpm', ['guard'], { timeoutMs: 20 * 60_000 });
      brokenExit = brokenRun.status;
      brokenStdout = brokenRun.stdout;
    } finally {
      fs.writeFileSync(manifestAbs, original);
      revertedCleanly = fs.readFileSync(manifestAbs, 'utf8') === original;
    }
    if (!targetCapability) return;
    const attributed = brokenStdout.includes(targetCapability);

    // Fixture 2: a REAL, statically-discoverable route registration with no
    // manifest row anywhere.
    const fixtureRoutePath = '/api/w0-parity-fixture';
    const fixtureRelPath = 'apps/daemon/src/routes/w0-parity-fixture-probe.ts';
    const fixtureAbsPath = path.join(repoRoot, fixtureRelPath);
    let fixtureBrokenExit = 1, fixtureBrokenStdout = '', fixtureAttributed = false, fixtureCleanedUp = false;
    try {
      fs.writeFileSync(
        fixtureAbsPath,
        [
          "import type { Express } from 'express';",
          '',
          '// Round-4 W0 verifier fixture -- proves guard detects a real, unmanifested',
          '// route registration. Written and deleted entirely by verify-w0.ts C0-11;',
          '// never intended to be wired into server.ts or committed.',
          `export function registerW0ParityFixtureProbeRoutes(app: Express): void {`,
          `  app.get('${fixtureRoutePath}', (_req, res) => {`,
          "    res.json({ ok: true });",
          '  });',
          '}',
          '',
        ].join('\n'),
      );
      const fixtureRun = sh('pnpm', ['guard'], { timeoutMs: 20 * 60_000 });
      fixtureBrokenExit = fixtureRun.status;
      fixtureBrokenStdout = fixtureRun.stdout;
      fixtureAttributed = fixtureBrokenStdout.includes(fixtureRoutePath) || fixtureBrokenStdout.includes('w0-parity-fixture-probe');
    } finally {
      try { fs.unlinkSync(fixtureAbsPath); } catch { /* best effort */ }
      fixtureCleanedUp = !fs.existsSync(fixtureAbsPath);
    }

    const revertedRun = sh('pnpm', ['guard'], { timeoutMs: 20 * 60_000 });
    const revertedExit = revertedRun.status;
    const treeClean = sh('git', ['status', '--porcelain', '--', capabilityManifestRel, fixtureRelPath]).stdout.trim().length === 0;
    const ok = brokenExit !== 0 && attributed && fixtureBrokenExit !== 0 && fixtureAttributed && fixtureCleanedUp && revertedExit === 0 && revertedCleanly && treeClean;
    record('C0-11', '', '', ok,
      `target=${targetCapability} brokenExit=${brokenExit} attributed=${attributed}\n` +
        `fixtureRoute=${fixtureRoutePath} fixtureBrokenExit=${fixtureBrokenExit} fixtureAttributed=${fixtureAttributed} fixtureCleanedUp=${fixtureCleanedUp}\n` +
        `revertedExit=${revertedExit} revertedCleanly=${revertedCleanly} treeClean=${treeClean}\n${brokenStdout.slice(-1500)}\n--fixture--\n${fixtureBrokenStdout.slice(-1500)}`,
      { detail: ok ? undefined : `target=${targetCapability} brokenExit=${brokenExit} attributed=${attributed} fixtureBrokenExit=${fixtureBrokenExit} fixtureAttributed=${fixtureAttributed} fixtureCleanedUp=${fixtureCleanedUp} revertedExit=${revertedExit} revertedCleanly=${revertedCleanly} treeClean=${treeClean}` },
    );
  });

  // =======================================================================
  // C0-12 -- live static counts, repo-wide.
  // =======================================================================
  await checkCriterion('C0-12', 'read docs/security/stored-identity-inventory.md; live static-source-surrogate counts for all six categories, grepped repo-wide', 'STATIC SOURCE-LEVEL SURROGATE counts (not live runtime record counts -- declared boundary); statically-countable categories must match exactly; unrecognized rows fail', () => {
    const rel = 'docs/security/stored-identity-inventory.md';
    const CATEGORIES = ['.od/', 'OD_', 'MCP server', 'project JSON key', 'connector credential', 'sidecar stamp'];
    if (!fileExists(rel)) { record('C0-12', '', '', false, '', { detail: `missing: ${rel}` }); return; }
    const text = readRepoFile(rel);
    const missingCategories = CATEGORIES.filter((c) => !text.toLowerCase().includes(c.toLowerCase()));
    const tableRows = text.split('\n').filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:-]+\|/.test(l));
    const header = tableRows[0] ?? '';
    const hasCountColumn = /count/i.test(header);
    const dataRows = tableRows.slice(1);
    const unknownRows = dataRows.filter((r) => !CATEGORIES.some((c) => r.toLowerCase().includes(c.toLowerCase())));

    // Round-4 F14: count distinct OCCURRENCE SITES (file:line), not distinct
    // matched lexemes -- adding 100 more `.od/` sites must move the count.
    // A Set keyed on the matched substring collapses every identical
    // occurrence to one, making the count effectively binary.
    function grepCountRepoWide(pattern: RegExp): number {
      const sites = new Set<string>();
      (function walk(dir: string): void {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (['node_modules', '.git', 'dist', '.tmp', '.next'].includes(entry.name) || entry.name.startsWith('.')) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(ts|tsx|md|json)$/.test(entry.name)) {
            let t = '';
            try { t = fs.readFileSync(full, 'utf8'); } catch { continue; }
            for (const m of t.matchAll(pattern)) {
              const line = t.slice(0, m.index ?? 0).split('\n').length;
              sites.add(`${full}:${line}`);
            }
          }
        }
      })(repoRoot);
      return sites.size;
    }
    const liveCounts: Record<string, number> = {
      '.od/': grepCountRepoWide(/\.od\//g),
      OD_: grepCountRepoWide(/\bOD_[A-Z_]+\b/g),
      'MCP server': grepCountRepoWide(/\bSERVER_NAME\s*[:=]\s*['"`][\w-]+['"`]/g),
      'project JSON key': grepCountRepoWide(/\bmetadata\.\w+\b/g),
      'connector credential': grepCountRepoWide(/\b(clientId|clientSecret|apiKey|accessToken|refreshToken)\b/g),
      'sidecar stamp': grepCountRepoWide(/\b(app|mode|namespace|ipc|source)\s*:/g),
    };
    function docCountFor(category: string): number | null {
      const row = dataRows.find((r) => r.toLowerCase().includes(category.toLowerCase()));
      if (!row) return null;
      const nums = (row.match(/\d+/g) ?? []).map(Number);
      return nums.length > 0 ? (nums[nums.length - 1] ?? null) : null;
    }
    const problems: string[] = [...unknownRows.map((r) => `unrecognized inventory row: ${r.slice(0, 80)}`)];
    for (const cat of CATEGORIES) {
      const docCount = docCountFor(cat);
      if (docCount === null) { problems.push(`category "${cat}": no numeric count in doc`); continue; }
      const live = liveCounts[cat];
      if (live !== undefined && docCount !== live) problems.push(`"${cat}": doc=${docCount} live=${live}`);
    }
    const ok = missingCategories.length === 0 && hasCountColumn && dataRows.length >= 6 && problems.length === 0;
    record('C0-12', '', '', ok, `missing categories: ${missingCategories.join(', ') || 'none'}\nlive counts: ${JSON.stringify(liveCounts)}\nproblems: ${problems.join('; ') || 'none'}`, { detail: ok ? undefined : problems.join('; ') || 'see evidence' });
  });

  // =======================================================================
  // C0-13 -- round-3 F15: fold e2eExecuted / e2eRun.status / claimed-vs
  // -observed e2e failure count into the pass condition.
  // =======================================================================
  await checkCriterion('C0-13', 'cross-check docs/testing/daemon-failure-inventory.md against daemon (unit) + e2e/tests (integration) runs; execute a bounded named Playwright e2e smoke subset and require it to actually run', 'unit/integration counts must exactly match observed failures from genuinely different suites; e2e execution status and its observed/claimed failure count are part of the pass condition, not just computed and ignored', () => {
    const rel = 'docs/testing/daemon-failure-inventory.md';
    if (!fileExists(rel)) { record('C0-13', '', '', false, '', { detail: `missing: ${rel}` }); return; }
    const text = readRepoFile(rel);
    const hasUnitSection = /unit/i.test(text);
    const hasIntegrationSection = /integration/i.test(text);
    const hasE2eSection = /e2e|end-to-end/i.test(text);
    const actualDaemonFailures = daemonSuite.data?.numFailedTests ?? null;
    const actualIntegrationFailures = integrationSuite.data?.numFailedTests ?? null;
    const unitMatch = text.match(/unit[\s\S]{0,120}?(\d+)\s*failure/i);
    const integrationMatch = text.match(/integration[\s\S]{0,120}?(\d+)\s*failure/i);
    const e2eMatch = text.match(/e2e[\s\S]{0,120}?(\d+)\s*failure/i);
    const claimsUnitNone = /unit[\s\S]{0,120}?\bnone\b/i.test(text);
    const claimsIntegrationNone = /integration[\s\S]{0,120}?\bnone\b/i.test(text);
    const claimsE2eNone = /e2e[\s\S]{0,120}?\bnone\b/i.test(text);
    const unitClaimed = unitMatch?.[1] !== undefined ? Number(unitMatch[1]) : claimsUnitNone ? 0 : null;
    const integrationClaimed = integrationMatch?.[1] !== undefined ? Number(integrationMatch[1]) : claimsIntegrationNone ? 0 : null;
    const e2eClaimed = e2eMatch?.[1] !== undefined ? Number(e2eMatch[1]) : claimsE2eNone ? 0 : null;
    const unitConsistent = actualDaemonFailures !== null && unitClaimed !== null && unitClaimed === actualDaemonFailures;
    const integrationConsistent = actualIntegrationFailures !== null && integrationClaimed !== null && integrationClaimed === actualIntegrationFailures;

    const e2eSmokeSpec = 'ui/critical-smoke.test.ts';
    const e2eRun = sh('pnpm', ['--filter', 'e2e', 'exec', 'playwright', 'test', '-c', 'playwright.config.ts', e2eSmokeSpec], { cwd: path.join(repoRoot, 'e2e'), timeoutMs: 5 * 60_000 });
    restoreNextEnvIfChurned();
    const passedMatch = e2eRun.stdout.match(/(\d+)\s+passed/i);
    const failedMatch = e2eRun.stdout.match(/(\d+)\s+failed/i);
    const e2eExecuted = passedMatch !== null || failedMatch !== null;
    const e2eObservedFailures = failedMatch?.[1] !== undefined ? Number(failedMatch[1]) : e2eRun.status === 0 ? 0 : null;
    const e2eConsistent = e2eClaimed !== null && e2eObservedFailures !== null && e2eClaimed === e2eObservedFailures;

    // Round-3 F15 fix: these three now GATE the pass condition.
    const ok = hasUnitSection && hasIntegrationSection && hasE2eSection && unitConsistent && integrationConsistent && e2eExecuted && e2eRun.status === 0 && e2eConsistent;
    record('C0-13', '', '', ok,
      `unit=${hasUnitSection} integration=${hasIntegrationSection} e2e=${hasE2eSection}\n` +
        `daemon(unit) failures=${actualDaemonFailures} claimed=${unitClaimed} consistent=${unitConsistent}\n` +
        `e2e/tests(integration) failures=${actualIntegrationFailures} claimed=${integrationClaimed} consistent=${integrationConsistent}\n` +
        `e2e Playwright smoke exit=${e2eRun.status} executed=${e2eExecuted} observedFailures=${e2eObservedFailures} claimed=${e2eClaimed} consistent=${e2eConsistent}\n${e2eRun.stdout.slice(-1500)}`,
      { detail: ok ? undefined : `unitConsistent=${unitConsistent} integrationConsistent=${integrationConsistent} e2eExecuted=${e2eExecuted} e2eExit=${e2eRun.status} e2eConsistent=${e2eConsistent}` });
  });

  // =======================================================================
  // C0-14
  // =======================================================================
  await checkCriterion('C0-14', 'pnpm guard && pnpm typecheck (+ suites above) + git-ls-tree per-file static test-count diff + JSON-reporter skip/todo scan', "pnpm guard exit 0; pnpm typecheck exit 0; daemon + web + integration suites green; zero skip/todo/pending in this wave's changed test files; no test files lost or shrunk vs baseCommit", () => {
    const guard = sh('pnpm', ['guard'], { timeoutMs: 20 * 60_000 });
    const typecheck = sh('pnpm', ['typecheck'], { timeoutMs: 20 * 60_000 });
    function listTestFiles(ref: string, dir: string): string[] {
      const r = sh('git', ['ls-tree', '-r', '--name-only', ref, '--', dir]);
      if (r.status !== 0) throw new Error(`git ls-tree ${ref} -- ${dir} failed (exit=${r.status})`);
      return r.stdout.trim().split('\n').filter((f) => /\.test\.(ts|tsx|js|mjs|cjs)$/.test(f));
    }
    function staticTestCount(ref: string, rel: string): number {
      const r = sh('git', ['show', `${ref}:${rel}`]);
      if (r.status !== 0) return 0;
      return (r.stdout.match(/\b(it|test)\s*\(/g) ?? []).length;
    }
    let baseDaemonTests: string[] = [], lostDaemonTests: string[] = [], shrunkDaemonTests: { file: string; base: number; head: number }[] = [];
    try {
      baseDaemonTests = listTestFiles(baseCommit, 'apps/daemon/tests');
      const headDaemonTests = new Set(listTestFiles(headSha, 'apps/daemon/tests'));
      lostDaemonTests = baseDaemonTests.filter((f) => !headDaemonTests.has(f) && !path.basename(f).startsWith('web-clone-'));
      for (const f of baseDaemonTests.filter((f) => headDaemonTests.has(f))) {
        const baseCount = staticTestCount(baseCommit, f);
        const headCount = staticTestCount(headSha, f);
        if (headCount < baseCount) shrunkDaemonTests.push({ file: f, base: baseCount, head: headCount });
      }
    } catch (err) {
      lostDaemonTests = [`<ls-tree failure: ${String(err)}>`];
    }
    const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
    const diffCommandOk = diffResult.status === 0;
    const changedFiles = diffCommandOk ? diffResult.stdout.trim().split('\n').filter(Boolean) : [];
    const bannedStatuses = new Set(['skipped', 'todo', 'pending']);
    const changedTestFilesNotInSuite: string[] = [];
    const newBannedHits: string[] = [];
    for (const rel of changedFiles) {
      if (!/\.test\.(ts|tsx|js|mjs|cjs)$/.test(rel)) continue;
      const abs = path.join(repoRoot, rel);
      if (!fs.existsSync(abs)) continue;
      const trDaemon = daemonSuite.data?.testResults.find((t) => t.name === abs);
      const trWeb = webSuite.data?.testResults.find((t) => t.name === abs);
      if (!trDaemon && !trWeb) { changedTestFilesNotInSuite.push(rel); continue; }
      const hits = [...(trDaemon?.assertionResults ?? []), ...(trWeb?.assertionResults ?? [])].filter((a) => bannedStatuses.has(a.status));
      if (hits.length > 0) newBannedHits.push(rel);
    }
    const checks = {
      guardExitZero: guard.status === 0, typecheckExitZero: typecheck.status === 0,
      daemonSuiteRanCleanly: daemonSuite.runResult.status === 0 && (daemonSuite.data?.numFailedTests ?? 1) === 0,
      webSuiteRanCleanly: webSuite.runResult.status === 0 && (webSuite.data?.numFailedTests ?? 1) === 0,
      integrationSuiteRanCleanly: integrationSuite.runResult.status === 0 && (integrationSuite.data?.numFailedTests ?? 1) === 0,
      diffCommandOk, noNewBannedStatuses: newBannedHits.length === 0, noLostDaemonTests: lostDaemonTests.length === 0,
      noShrunkDaemonTestFiles: shrunkDaemonTests.length === 0, noChangedTestFileMissingFromSuite: changedTestFilesNotInSuite.length === 0,
    };
    const ok = Object.values(checks).every(Boolean);
    record('C0-14', '', '', ok,
      `guard exit=${guard.status}\ntypecheck exit=${typecheck.status}\n` +
        `daemon: failed=${daemonSuite.data?.numFailedTests ?? '?'}\nweb: failed=${webSuite.data?.numFailedTests ?? '?'}\nintegration: failed=${integrationSuite.data?.numFailedTests ?? '?'}\n` +
        `new skip/todo/pending: ${newBannedHits.join(', ') || 'none'}\nlost daemon tests: ${lostDaemonTests.join(', ') || 'none'}\nshrunk: ${JSON.stringify(shrunkDaemonTests)}\nmissing-from-suite: ${changedTestFilesNotInSuite.join(', ') || 'none'}\n` +
        `guard tail:\n${guard.stdout.slice(-4000)}\n\ntypecheck tail:\n${typecheck.stdout.slice(-4000)}`,
      { detail: ok ? undefined : `failing: ${Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(', ')}` });
  });

  // =======================================================================
  // GATE-INTEGRITY / LEASE / HEAD-DRIFT
  // =======================================================================
  await checkCriterion('GATE-INTEGRITY', 'sha256(this file) vs an orchestrator-approved hash, if one exists', 'defense-in-depth self-hash check; the PRIMARY control is the external-copy execution model', () => {
    const selfPath = fileURLToPath(import.meta.url);
    const selfSha256 = sha256File(selfPath);
    const approvedHashPath = path.join(os.homedir(), '.claude', 'goal-state', 'mishmash-w0-substrate', 'approved-gate.sha256');
    if (!fs.existsSync(approvedHashPath)) { record('GATE-INTEGRITY', '', '', true, `sha256: ${selfSha256}\nno approved-gate.sha256 present -- advisory only`); return; }
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === selfSha256;
    record('GATE-INTEGRITY', '', '', gateOk, `sha256: ${selfSha256}\napproved: ${approved}`, { detail: gateOk ? undefined : 'verify-w0.ts modified since orchestrator approval' });
  });

  function globToRegExp(glob: string): RegExp {
    let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    re = re.replace(/\*\*/g, ' GLOBSTAR ');
    re = re.replace(/\*/g, '[^/]*');
    re = re.replace(/ GLOBSTAR /g, '.*');
    return new RegExp(`^${re}$`);
  }
  await checkCriterion('LEASE', `git diff --name-only ${baseCommit}...HEAD subset-of leases.json[W0] read via git show ${baseCommit}:docs/plans/waves/leases.json`, 'no writes outside the W0 lease, read from baseCommit so the wave cannot widen its own lease', () => {
    const leasesText = readFileAtCommit(baseCommit, 'docs/plans/waves/leases.json');
    const leasesRaw = JSON.parse(leasesText) as { waves: Record<string, { allow: string[]; deny?: string[] }> };
    const w0Lease = leasesRaw.waves.W0;
    const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
    const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
    if (!w0Lease) { record('LEASE', '', '', false, '', { detail: 'no "W0" entry in leases.json@baseCommit' }); }
    else if (diffResult.status !== 0) { record('LEASE', '', '', false, diffResult.stdout, { detail: `git diff exited ${diffResult.status}` }); }
    else if (diffNames.length === 0) { record('LEASE', '', '', false, '', { detail: `baseCommit=${baseCommit} headSha=${headSha} differ but git diff reported zero changed files` }); }
    else {
      const allowRe = w0Lease.allow.map(globToRegExp);
      const denyRe = (w0Lease.deny ?? []).map(globToRegExp);
      const violations = diffNames.filter((f) => !allowRe.some((re) => re.test(f)) || denyRe.some((re) => re.test(f)));
      record('LEASE', '', '', violations.length === 0, violations.join('\n') || `all ${diffNames.length} changed files inside the lease`);
    }
  });

  const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  record('HEAD-DRIFT', 'git rev-parse HEAD (re-resolved at end)', 'HEAD must not move during the run', headShaFinal === headSha, `initial=${headSha} final=${headShaFinal}`, { detail: headShaFinal === headSha ? undefined : 'HEAD moved during the run' });

  // =======================================================================
  // Round-3 F31 fix: --ignored=matching is DROPPED from the global
  // treeDirty computation (a normal installed worktree has node_modules,
  // dist, .tmp, .od, tsbuildinfo -- all correctly gitignored, none of which
  // is "dirt"). .gitignore/.git/info/exclude are still hashed. Ignored-file
  // presence is checked ONLY under the wave's own artifact paths, where
  // hidden evidence could plausibly live.
  // =======================================================================
  restoreNextEnvIfChurned();
  const statusResult = sh('git', ['-c', 'status.showUntrackedFiles=normal', 'status', '--porcelain=v1']);
  const treeDirty = statusResult.status !== 0 || statusResult.stdout.trim().length > 0;
  const scopedIgnoredCheck = sh('git', ['status', '--porcelain=v1', '--ignored=matching', '--', 'scripts/waves/', 'docs/security/', 'docs/testing/']);
  // Only `!!` (ignored) lines count as "hidden evidence" here -- an
  // ordinary tracked change (`M `) under these paths is already covered by
  // the main treeDirty check above and must not double-count as this
  // separate, narrower signal.
  const hiddenEvidenceInWaveArtifacts = scopedIgnoredCheck.status === 0 && scopedIgnoredCheck.stdout.split('\n').some((l) => l.startsWith('!!'));
  const localExcludePath = path.join(repoRoot, '.git', 'info', 'exclude');
  const localExcludeContent = fs.existsSync(localExcludePath) ? fs.readFileSync(localExcludePath, 'utf8') : '';
  const localExcludeIsNonTrivial = localExcludeContent.split('\n').some((l) => l.trim() && !l.trim().startsWith('#'));
  const gitignoreHash = fileExists('.gitignore') ? sha256File(path.join(repoRoot, '.gitignore')) : 'absent';
  const localExcludeHash = localExcludeContent ? sha256Bytes(localExcludeContent) : 'absent';

  for (const r of results) {
    if (!r.artifact || !r.artifactSha256) continue;
    try {
      const currentHash = sha256File(r.artifact);
      if (currentHash !== r.artifactSha256) { r.status = 'fail'; r.detail = `${r.detail ? `${r.detail}; ` : ''}TAMPER DETECTED`; }
    } catch { r.status = 'fail'; r.detail = `${r.detail ? `${r.detail}; ` : ''}artifact disappeared before final integrity re-check`; }
  }

  const manifestPreHash = {
    wave: 'W0', commit: headSha, treeDirty, baseCommit,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    suiteCacheReused: reuseSuiteCache, gitExcludeAdvisory: localExcludeIsNonTrivial, hiddenEvidenceInWaveArtifacts, gitignoreHash, localExcludeHash,
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
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w0-emergency-manifest.json'), JSON.stringify(manifestPreHash, null, 2));
      console.error(`verify-w0: primary manifest write failed (${String(err)}); wrote fallback`);
    } catch (err2) { console.error(`verify-w0: manifest write failed everywhere (${String(err)} / ${String(err2)})`); }
  }
  let manifestSha256 = 'unavailable';
  if (manifestWritten) {
    try { manifestSha256 = sha256File(manifestPath); fs.writeFileSync(path.join(proofDir, 'manifest.sha256.txt'), `${manifestSha256}\n`); } catch { manifestSha256 = 'unavailable'; }
  }

  const failures = results.filter((r) => r.status === 'fail');
  console.log(`\nverify-w0: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty}, suiteCacheReused=${reuseSuiteCache}, hiddenEvidenceInWaveArtifacts=${hiddenEvidenceInWaveArtifacts}, gitExcludeAdvisory=${localExcludeIsNonTrivial})`);
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  if (treeDirty) console.log('  ⚠ tree is dirty: advisory only');
  if (reuseSuiteCache) console.log('  ⚠ --reuse-suite-cache: advisory only');
  if (hiddenEvidenceInWaveArtifacts) console.log('  ⚠ ignored files present under scripts/waves//docs/security//docs/testing/: advisory (F31 scoped check)');
  if (localExcludeIsNonTrivial) console.log('  ⚠ .git/info/exclude has local content: advisory (F26)');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  process.exit(failures.length === 0 && !treeDirty && !reuseSuiteCache && !hiddenEvidenceInWaveArtifacts && !localExcludeIsNonTrivial && manifestWritten ? 0 : 1);
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
