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
try {
  repoRoot = path.resolve(argValue('--repo') ?? process.cwd());
  reuseSuiteCache = argv.includes('--reuse-suite-cache');
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
function backupCallReachableFrom(entry: string): { ok: boolean; reachableFiles: string[] } {
  const reachable = new Set<string>([entry]);
  const entryDir = path.dirname(entry);
  for (const spec of localImportSpecifiers(entry)) {
    const resolved = resolveLocalImport(entry, spec);
    if (resolved) reachable.add(resolved);
  }
  void entryDir;
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
        for (const link of ['node_modules', 'apps/daemon/node_modules', 'apps/web/node_modules']) {
          const src = path.join(repoRoot, link);
          const dst = path.join(worktreeDir, link);
          if (fs.existsSync(src) && !fs.existsSync(dst)) {
            try { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.symlinkSync(src, dst, 'dir'); } catch { /* best effort */ }
          }
        }
        // Re-point first-party workspace package symlinks at the
        // WORKTREE's own checked-out sources (pinned to baseCommit)
        // instead of letting them resolve back through the shared
        // node_modules symlink to the live HEAD-state packages/apps.
        const scopeDir = path.join(worktreeDir, 'node_modules', '@open-design');
        if (fs.existsSync(scopeDir)) {
          for (const entry of fs.readdirSync(scopeDir)) {
            const linkPath = path.join(scopeDir, entry);
            let isSymlink = false;
            try { isSymlink = fs.lstatSync(linkPath).isSymbolicLink(); } catch { /* ignore */ }
            if (!isSymlink) continue;
            const worktreePkg = path.join(worktreeDir, 'packages', entry);
            const worktreeApp = path.join(worktreeDir, 'apps', entry);
            const target = fs.existsSync(worktreePkg) ? worktreePkg : fs.existsSync(worktreeApp) ? worktreeApp : null;
            if (target) {
              try { fs.unlinkSync(linkPath); fs.symlinkSync(target, linkPath, 'dir'); } catch { /* best effort */ }
            }
          }
        }
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
        runResult = { ok: genuineAssertionFailure, evidence: `worktree=${worktreeDir}\nfiles=${relFiles.join(', ')}\nparent=${baseCommit}\nexit=${run.status}\nnamed hits: ${JSON.stringify(namedHits)}\ngenuineAssertionFailure=${genuineAssertionFailure}\n${run.stdout.slice(-3000)}` };
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

  async function verifyProjectFilesViaHttp(dataDir: string, fixture: SeededFixture, sampleMin: number): Promise<{ ok: boolean; sampled: number; mismatches: string[]; problems: string[] }> {
    const problems: string[] = [];
    const allFiles = fixture.projects.flatMap((p) => p.files.map((f) => ({ projectId: p.id, ...f })));
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
    if (sample.length < sampleMin) problems.push(`only ${sample.length} files available to sample (need >=${sampleMin})`);
    if (mismatches.length > 0) problems.push(`${mismatches.length}/${sample.length} sampled files mismatched via HTTP raw fetch`);
    return { ok: problems.length === 0, sampled: sample.length, mismatches, problems };
  }

  // Reads the archive's own on-disk manifest.json directly -- the sole
  // source of archive contents (round-3 F4: archiveContents self-report
  // eliminated entirely). Rejects path escapes.
  function readArchiveIndex(archivePath: string): { ok: boolean; classes: { class: string; relPath: string; absPath: string | null }[]; problems: string[] } {
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
      const withinRoot = resolved === archiveRootReal || resolved.startsWith(`${archiveRootReal}${path.sep}`);
      if (!withinRoot) {
        problems.push(`class "${entry.class}" relPath "${entry.relPath}" escapes the archive root -- rejected`);
        return { class: entry.class, relPath: entry.relPath, absPath: null };
      }
      const existsOnDisk = fs.existsSync(resolved);
      if (!existsOnDisk) problems.push(`class "${entry.class}" claims relPath "${entry.relPath}" but it does not exist inside the archive`);
      return { class: entry.class, relPath: entry.relPath, absPath: existsOnDisk ? resolved : null };
    });
    return { ok: problems.length === 0, classes, problems };
  }

  function odDataEnv(dataDir: string): NodeJS.ProcessEnv {
    return { ...process.env, OD_DATA_DIR: dataDir, OD_DAEMON_CLI_PATH: path.join(repoRoot, 'apps/daemon/dist/cli.js') };
  }

  let c01Fixture: SeededFixture | null = null;
  let c01ArchivePath: string | null = null;

  await checkCriterion(
    'C0-1',
    `OD_DATA_DIR=<verifier-owned source> node ${odBinPath} backup create --out <archivePath> --json; OD_DATA_DIR=<verifier-owned fresh root> node ${odBinPath} restore --archive <archivePath> --json`,
    'verifier seeds real projects+files via the daemon\'s own HTTP API, invokes the real od backup/restore CLI, and independently runs PRAGMA integrity_check, >=20 file HTTP round-trip comparisons, and an asset fetch against a daemon it boots on the restored root -- fails "product surface missing: od backup"/"od restore" until those subcommands exist',
    async () => {
      const fixture = await seedRealSourceFixture();
      c01Fixture = fixture;
      const archiveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-archive-'));
      const archivePath = path.join(archiveDir, 'archive');
      const backupRun = odCli(['backup', 'create', '--out', archivePath, '--json'], odDataEnv(fixture.sourceDir));
      if (backupRun.status !== 0) {
        record('C0-1', '', '', false, backupRun.stdout, { detail: 'product surface missing: od backup', exitCode: backupRun.status });
        return;
      }
      c01ArchivePath = archivePath;
      const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-restore-'));
      const restoreRun = odCli(['restore', '--archive', archivePath, '--json'], odDataEnv(restoreDir));
      if (restoreRun.status !== 0) {
        record('C0-1', '', '', false, restoreRun.stdout, { detail: 'product surface missing: od restore', exitCode: restoreRun.status });
        return;
      }
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
      const ok = problems.length === 0;
      record('C0-1', '', '', ok, JSON.stringify({ integrityOutput, httpCheck, archiveIndex }, null, 2), { detail: ok ? undefined : problems.join('; '), exitCode: Math.max(backupRun.status, restoreRun.status) });
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

      const child = spawn('node', [odBinPath, 'backup', 'create', '--out', archivePath, '--json'], { cwd: repoRoot, env: odDataEnv(fixture.sourceDir) });
      let stdout = '';
      child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
      let writerWrites = 0;
      const writerStart = Date.now();
      const writerInterval = setInterval(() => {
        const r = sh('sqlite3', [dbPath, `UPDATE projects SET updated_at = ${Date.now()} WHERE id = (SELECT id FROM projects LIMIT 1);`]);
        if (r.status === 0) writerWrites++;
      }, 25);
      const exitCode: number = await new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
      clearInterval(writerInterval);
      const writerDurationMs = Date.now() - writerStart;

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
          // must resolve to a real, fetchable file.
          const restoredProjectIds = sh('sqlite3', [restoredDbPath, 'SELECT id FROM projects;']).stdout.trim().split('\n').filter(Boolean);
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
      if (writerWrites < 10) problems.push(`writer loop only achieved ${writerWrites} real DB updates (want >=10)`);
      if (writerDurationMs < 300) problems.push(`writer loop ran only ${writerDurationMs}ms`);

      const cliPath = path.join(repoRoot, 'apps/daemon/src/cli.ts');
      const entry = findSubcommandHandlerEntryPoint(cliPath, /^backup$/i);
      let reach: { ok: boolean; reachableFiles: string[] } = { ok: false, reachableFiles: [] };
      if (entry) reach = backupCallReachableFrom(entry);
      if (!entry) problems.push('no "backup" key found in cli.ts SUBCOMMAND_MAP -- product surface missing: od backup');
      else if (!reach.ok) problems.push(`no real .backup(...)/VACUUM INTO call reachable from the SUBCOMMAND_MAP "backup" handler (checked: ${reach.reachableFiles.join(', ')})`);

      const ok = problems.length === 0;
      record('C0-2', '', '', ok, JSON.stringify({ before, after, writerWrites, writerDurationMs, entry, reach }, null, 2), { detail: ok ? undefined : problems.join('; '), exitCode });
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
      const targets: { kind: string; absPath: string }[] = [
        ...(dbEntry?.absPath ? [{ kind: 'sqlite-database', absPath: dbEntry.absPath }] : []),
        ...(projectsEntry?.absPath ? [{ kind: 'projects-dir', absPath: projectsEntry.absPath }] : []),
        { kind: 'manifest-entry', absPath: manifestPath },
      ];
      const distinctPaths = new Set(targets.map((t) => t.absPath));
      const perTarget: { kind: string; ok: boolean; exit: number }[] = [];
      for (const { kind, absPath } of targets) {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `od-w0-corrupt-${kind}-`));
        try {
          const corruptedArchive = path.join(workDir, path.basename(archivePath));
          fs.cpSync(archivePath, corruptedArchive, { recursive: true });
          const relInArchive = path.relative(archivePath, absPath);
          const targetFile = path.join(corruptedArchive, relInArchive);
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
  await checkCriterion('C0-6', 'live HTTP: replay tested against the real pairing surface; revocation/rotation, when their endpoints exist, must prove the OLD token is rejected and (for rotation) a NEW token is accepted -- a 204 no-op cannot pass', 'suite-title matches are never sufficient; endpoints fail with "endpoint missing: <which>" until they exist; once they exist, semantics are asserted', async () => {
    let daemon: BootedDaemon | null = null;
    let replayOk = false, replayDetail = '';
    let revocationEndpoint: { method: string; path: string } | undefined;
    let rotationEndpoint: { method: string; path: string } | undefined;
    let revocationOk = false, rotationOk = false;
    try {
      daemon = await bootDaemonForProbing();
      const pairRes = await fetch(`${daemon.url}/api/library/pair`, { method: 'POST', headers: { Host: '127.0.0.1' } });
      const pairBody = (await pairRes.json()) as { code?: string };
      const extA = crypto.randomBytes(16).toString('hex');
      const confirmRes = await fetch(`${daemon.url}/api/library/pair/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${extA}` }, body: JSON.stringify({ code: pairBody.code, extensionOrigin: `chrome-extension://${extA}` }) });
      const confirmBody = (await confirmRes.json()) as { token?: string };
      const extB = crypto.randomBytes(16).toString('hex');
      const replayRes = await fetch(`${daemon.url}/api/library/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${extB}`, Authorization: confirmBody.token ? `Bearer ${confirmBody.token}` : '' }, body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dzAtdmVyaWZpZXI=', filename: 'w0-verifier-replay-probe.txt' }) });
      replayOk = replayRes.status === 401 || replayRes.status === 403;
      replayDetail = `replay status=${replayRes.status}`;

      revocationEndpoint = daemon.routeInventory.find((r) => /library/i.test(r.path) && (/revoke/i.test(r.path) || (r.method === 'DELETE' && /token/i.test(r.path))));
      rotationEndpoint = daemon.routeInventory.find((r) => /library/i.test(r.path) && /rotate/i.test(r.path));
      if (revocationEndpoint) {
        await fetch(`${daemon.url}${revocationEndpoint.path}`, { method: revocationEndpoint.method, headers: { Authorization: confirmBody.token ? `Bearer ${confirmBody.token}` : '' } });
        const postRevokeRes = await fetch(`${daemon.url}/api/library/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${extA}`, Authorization: confirmBody.token ? `Bearer ${confirmBody.token}` : '' }, body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dzAtdmVyaWZpZXI=', filename: 'w0-verifier-post-revoke.txt' }) });
        revocationOk = postRevokeRes.status === 401 || postRevokeRes.status === 403;
      }
      if (rotationEndpoint) {
        const rotateRes = await fetch(`${daemon.url}${rotationEndpoint.path}`, { method: rotationEndpoint.method, headers: { Authorization: confirmBody.token ? `Bearer ${confirmBody.token}` : '' } });
        const rotateBody = (await rotateRes.json().catch(() => ({}))) as { token?: string };
        const oldTokenRes = await fetch(`${daemon.url}/api/library/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${extA}`, Authorization: confirmBody.token ? `Bearer ${confirmBody.token}` : '' }, body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dzAtdmVyaWZpZXI=', filename: 'w0-verifier-old-token-post-rotate.txt' }) });
        const oldTokenRejected = oldTokenRes.status === 401 || oldTokenRes.status === 403;
        let newTokenAccepted = false;
        if (rotateBody.token) {
          const newTokenRes = await fetch(`${daemon.url}/api/library/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${extA}`, Authorization: `Bearer ${rotateBody.token}` }, body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dzAtdmVyaWZpZXI=', filename: 'w0-verifier-new-token-post-rotate.txt' }) });
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

  await checkCriterion(
    'C0-7',
    'two-pass alias-aware AST extraction (local const aliases, property chains, constant paths) over apps/daemon/src/routes/** + server.ts; unresolvable-path guarded registrations must be explicitly acknowledged as dynamic in the inventory',
    'inventory row without a live route = fail; guarded live route missing from inventory = fail; an unresolvable-path guarded registration not explicitly marked dynamic in the inventory = fail; every row live-probed',
    async () => {
      const rel = 'apps/daemon/src/security/privileged-routes.json';
      if (!fileExists(rel)) {
        record('C0-7', '', '', false, '', { detail: `missing: ${rel}` });
        return;
      }
      let routes: { method: string; path: string; dynamic?: boolean }[] = [];
      try {
        const raw = JSON.parse(readRepoFile(rel));
        if (!Array.isArray(raw)) throw new Error('top-level value must be an array');
        routes = raw as { method: string; path: string; dynamic?: boolean }[];
      } catch (err) {
        record('C0-7', '', '', false, '', { detail: `invalid JSON: ${String(err)}` });
        return;
      }
      const validRows = routes.filter((r) => isRecord(r) && typeof r.method === 'string' && typeof r.path === 'string');
      const dedupKeys = new Set(validRows.map((r) => `${r.method} ${r.path}`));
      const { guarded, unresolvable } = staticRequireLocalDaemonRequestRoutesAndDynamics();
      const baselineKeys = new Set(guarded.map((b) => `${b.method} ${b.path}`));
      const acknowledgedDynamicCount = validRows.filter((r) => r.dynamic === true).length;
      const dynamicUnacknowledged = acknowledgedDynamicCount < unresolvable.length;

      let daemon: BootedDaemon | null = null;
      const liveResults: { method: string; path: string; status: number }[] = [];
      let liveRouteKeys = new Set<string>();
      try {
        daemon = await bootDaemonForProbing();
        liveRouteKeys = new Set(daemon.routeInventory.map((r) => `${r.method} ${r.path}`));
        for (const row of validRows.filter((r) => !r.dynamic)) {
          try {
            const res = await fetch(`${daemon.url}${row.path.replace(/:[a-zA-Z]+/g, 'w0-verifier-probe-id')}`, { method: row.method, headers: { Host: '127.0.0.1' } });
            liveResults.push({ method: row.method, path: row.path, status: res.status });
          } catch {
            liveResults.push({ method: row.method, path: row.path, status: -1 });
          }
        }
      } finally {
        if (daemon) await daemon.kill();
      }
      const liveRejectedAll = liveResults.length > 0 && liveResults.every((r) => r.status === 401 || r.status === 403);
      const inventoryRowsNotLive = validRows.filter((r) => !r.dynamic && !liveRouteKeys.has(`${r.method} ${r.path}`));
      const guardedRoutesMissingFromInventory = guarded.filter((b) => !dedupKeys.has(`${b.method} ${b.path}`));
      const iteration = needleReport('(C0-7/route)', Math.max(validRows.length, 1));
      const control = needleReport('(C0-7/control)', 1);
      const ok = validRows.length >= 1 && validRows.length === routes.length && dedupKeys.size === validRows.length && inventoryRowsNotLive.length === 0 && guardedRoutesMissingFromInventory.length === 0 && !dynamicUnacknowledged && iteration.ok && control.ok && liveRejectedAll;
      record('C0-7', '', '', ok,
        `inventory rows: ${routes.length}\nAST guarded baseline: ${guarded.length}; missing: ${JSON.stringify(guardedRoutesMissingFromInventory)}\n` +
          `unresolvable-path guarded registrations: ${JSON.stringify(unresolvable)}; acknowledged as dynamic in inventory: ${acknowledgedDynamicCount}\n` +
          `inventory rows without a live route: ${JSON.stringify(inventoryRowsNotLive)}\nlive probe: ${JSON.stringify(liveResults)}\n-- per-route --\n${iteration.evidence}\n-- control --\n${control.evidence}`,
        { detail: ok ? undefined : `rows=${validRows.length} unique=${dedupKeys.size} inventoryRowsNotLive=${inventoryRowsNotLive.length} guardedMissing=${guardedRoutesMissingFromInventory.length} dynamicUnacknowledged=${dynamicUnacknowledged} iterationOk=${iteration.ok} controlOk=${control.ok} liveRejectedAll=${liveRejectedAll}` });
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
  await checkCriterion('C0-9', 'read docs/testing/scale-baseline-2026-07.md + .json; re-execute all 5 scenarios against the DECLARED corpus (not an empty store)', 'corpus content hash must match; HTTP scenarios require 2xx; machine fingerprint must match THIS machine; toleranceBandPct capped at 50 (larger declared bands fail)', async () => {
    const mdRel = 'docs/testing/scale-baseline-2026-07.md';
    const jsonRel = 'docs/testing/scale-baseline-2026-07.json';
    if (!fileExists(mdRel) || !fileExists(jsonRel)) { record('C0-9', '', '', false, '', { detail: `missing: ${!fileExists(mdRel) ? mdRel : ''} ${!fileExists(jsonRel) ? jsonRel : ''}`.trim() }); return; }
    interface BaselineJson { corpus: { path: string; sha256: string }; machine: { fingerprint: string }; warmup: { iterations: number }; scenarios: { name: string; samplesMs: number[]; p50: number; p95: number; toleranceBandPct?: number }[]; nonRegressionCeiling: number; minimumImprovementThreshold: number; version: string }
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
    let corpusOk = false;
    if (!baseline.corpus?.path || !baseline.corpus?.sha256) {
      problems.push('missing corpus.path/corpus.sha256');
    } else if (fs.existsSync(baseline.corpus.path)) {
      const manifestLines: string[] = [];
      (function walk(dir: string, base: string): void {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full, base);
          else manifestLines.push(`${path.relative(base, full)}:${fs.statSync(full).size}`);
        }
      })(baseline.corpus.path, baseline.corpus.path);
      if (manifestLines.length === 0) problems.push('corpus.path is an empty store -- not declared/documented as intentionally empty');
      const recomputedCorpusHash = sha256Bytes(manifestLines.sort().join('\n'));
      if (recomputedCorpusHash !== baseline.corpus.sha256) problems.push(`corpus fingerprint mismatch: recomputed ${recomputedCorpusHash.slice(0, 12)} != stated ${baseline.corpus.sha256.slice(0, 12)}`);
      else corpusOk = true;
    } else {
      problems.push(`corpus.path "${baseline.corpus.path}" does not exist`);
    }

    const SCENARIOS = ['cold-start', 'project-list', 'designs-tab-fan-out', 'memory-high-water', 'search'];
    const smoke: Record<string, { valueMs: number | null; httpOk: boolean }> = {};
    if (corpusOk) {
      let daemon: BootedDaemon | null = null;
      try {
        const t0 = Date.now();
        daemon = await bootDaemonForProbing(baseline.corpus.path);
        smoke['cold-start'] = { valueMs: Date.now() - t0, httpOk: true };
        const t1 = Date.now();
        const listRes = await fetch(`${daemon.url}/api/projects`).catch(() => null);
        smoke['project-list'] = { valueMs: listRes ? Date.now() - t1 : null, httpOk: !!listRes && listRes.ok };
        const fanoutRoute = daemon.routeInventory.find((r) => r.method === 'GET' && /projects\/:[a-zA-Z]+\/files/i.test(r.path));
        if (fanoutRoute) {
          const t2 = Date.now();
          const res = await fetch(`${daemon.url}${fanoutRoute.path.replace(/:[a-zA-Z]+/g, 'w0-verifier-smoke-id')}`).catch(() => null);
          smoke['designs-tab-fan-out'] = { valueMs: Date.now() - t2, httpOk: !!res && res.ok };
        } else smoke['designs-tab-fan-out'] = { valueMs: null, httpOk: false };
        if (daemon.pid) {
          const rssSamples: number[] = [];
          for (let i = 0; i < 10; i++) {
            const r = sh('ps', ['-o', 'rss=', '-p', String(daemon.pid)]);
            const n = Number(r.stdout.trim());
            if (Number.isFinite(n)) rssSamples.push(n);
            await fetch(`${daemon.url}/api/health`).catch(() => null);
          }
          smoke['memory-high-water'] = { valueMs: rssSamples.length ? Math.max(...rssSamples) : null, httpOk: rssSamples.length > 0 };
        } else smoke['memory-high-water'] = { valueMs: null, httpOk: false };
        const searchRoute = daemon.routeInventory.find((r) => /search/i.test(r.path));
        if (searchRoute) {
          const t3 = Date.now();
          const init: RequestInit = { method: searchRoute.method, headers: { 'Content-Type': 'application/json' } };
          if (searchRoute.method === 'POST') init.body = JSON.stringify({ query: 'w0-verifier-smoke' });
          const res = await fetch(`${daemon.url}${searchRoute.path}`, init).catch(() => null);
          smoke['search'] = { valueMs: Date.now() - t3, httpOk: !!res && res.ok };
        } else smoke['search'] = { valueMs: null, httpOk: false };
      } catch (err) {
        problems.push(`live scenario smoke run threw: ${String(err)}`);
      } finally {
        if (daemon) await daemon.kill();
      }
    } else {
      problems.push('scenarios not re-executed: corpus binding failed (missing scenario = fail)');
    }
    for (const name of SCENARIOS) {
      const observed = smoke[name];
      const baselineScenario = scenarioByName.get(name);
      if (!observed || observed.valueMs === null) { problems.push(`scenario "${name}": could not be re-executed`); continue; }
      if (name !== 'memory-high-water' && !observed.httpOk) { problems.push(`scenario "${name}": HTTP response was not 2xx`); continue; }
      if (!baselineScenario) { problems.push(`scenario "${name}": no committed baseline entry`); continue; }
      const band = Math.min(baselineScenario.toleranceBandPct ?? 50, 50);
      const lower = baselineScenario.p50 * (1 - band / 100);
      const upper = baselineScenario.p50 * (1 + band / 100);
      if (!(observed.valueMs >= lower && observed.valueMs <= upper)) problems.push(`scenario "${name}": observed ${observed.valueMs}ms outside [${lower.toFixed(1)}, ${upper.toFixed(1)}]`);
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
  interface CapabilityManifestEntry { capability: string; uiEntryPoint: string; cliArgs: string[]; httpMethod: string; httpPath: string; outputSchema: string; parityApplicable: boolean; reason?: string }
  function deepKeyStructure(v: unknown, prefix = ''): string[] {
    if (Array.isArray(v)) return v.length > 0 ? deepKeyStructure(v[0], `${prefix}[]`) : [`${prefix}[]`];
    if (v && typeof v === 'object') return Object.keys(v as object).sort().flatMap((k) => deepKeyStructure((v as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k));
    return [prefix];
  }
  function validateManifestRowShape(e: unknown): string[] {
    const problems: string[] = [];
    if (!isRecord(e)) return ['row is not an object'];
    if (typeof e.capability !== 'string' || !e.capability.trim()) problems.push('missing/empty capability');
    if (typeof e.uiEntryPoint !== 'string') problems.push('missing uiEntryPoint');
    if (!Array.isArray(e.cliArgs) || !e.cliArgs.every((a) => typeof a === 'string')) problems.push('cliArgs must be a string[]');
    if (typeof e.httpMethod !== 'string' || !/^(GET|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(e.httpMethod)) problems.push('invalid httpMethod');
    if (typeof e.httpPath !== 'string' || !e.httpPath.startsWith('/')) problems.push('httpPath must start with /');
    if (typeof e.outputSchema !== 'string') problems.push('missing outputSchema');
    if (typeof e.parityApplicable !== 'boolean') problems.push('parityApplicable must be boolean');
    if (e.parityApplicable === false && !(typeof e.reason === 'string' && e.reason.trim())) problems.push('parityApplicable=false requires a reason');
    return problems;
  }

  await checkCriterion('C0-10', 'SUBCOMMAND_MAP capability ids must be SET-EQUAL (exact, no substring) to manifest capability names; full structural validation of ALL rows; live sampled invocations use a nonce-bearing value check, not shape-only', 'set-equal capability ids, unique rows, every row structurally valid; sample invocations prove the CLI reaches the manifest\'s SAME handler via a nonce value, not just matching key shapes; randomized red control must fail for a genuine mismatch', async () => {
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
    const extraNonSubcommandCaps = capNames.filter((c) => !subcommandSet.has(c) && subcommandKeys.some((k) => c.includes(k)) === false);
    void extraNonSubcommandCaps; // extra capabilities beyond the CLI universe are fine; only exact SUBCOMMAND_MAP coverage is required
    if (missingSubcommands.length > 0) problems.push(`SUBCOMMAND_MAP keys with no exact-name manifest entry: ${missingSubcommands.join(', ')}`);

    const applicable = manifest.filter((e) => e.parityApplicable);
    const notApplicableWithoutReason = manifest.filter((e) => !e.parityApplicable && !e.reason?.trim());
    problems.push(...notApplicableWithoutReason.map((e) => `capability "${e.capability}": parityApplicable=false without a reason`));
    if (applicable.length < subcommandKeys.length) problems.push(`applicable count (${applicable.length}) below SUBCOMMAND_MAP floor (${subcommandKeys.length})`);
    if (applicable.length === 0) problems.push('manifest has zero applicable capabilities');

    const sampleResults: { capability: string; ok: boolean; detail: string }[] = [];
    let redControlOk = false, redControlDetail = '';
    let identityOk = false;
    let daemon: BootedDaemon | null = null;
    try {
      daemon = await bootDaemonForProbing();
      const liveRouteKeys = new Set(daemon.routeInventory.map((r) => `${r.method} ${r.path}`));
      for (const e of applicable) if (!liveRouteKeys.has(`${e.httpMethod} ${e.httpPath}`)) problems.push(`capability "${e.capability}": ${e.httpMethod} ${e.httpPath} is not a registered route`);

      const nonce = `w0-nonce-${crypto.randomBytes(8).toString('hex')}`;
      await fetch(`${daemon.url}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: nonce, name: nonce }) }).catch(() => null);
      try {
        const { stdout } = await execFileAsync('node', [odBinPath, 'project', 'list', '--json'], { env: { ...process.env, OD_DAEMON_URL: daemon.url }, timeout: 30_000 });
        identityOk = stdout.includes(nonce);
      } catch (err) {
        identityOk = false;
        problems.push(`identity canary failed: ${String(err)}`);
      }
      if (!identityOk) problems.push('identity canary did not observe the nonce project through the CLI');

      const shuffled = [...applicable].sort(() => Math.random() - 0.5);
      const sample = shuffled.length <= 3 ? shuffled : shuffled.slice(0, 3);
      for (const entry of sample) {
        // Round-3 F11: value-level nonce check when the capability's route
        // is project-scoped -- proves the CLI reaches the SAME handler
        // (static JSON can't know a value the verifier just created).
        const isProjectScoped = /:projectId|:id/i.test(entry.httpPath) || entry.cliArgs.some((a) => a === nonce || /project/i.test(a));
        let nonceCheck: { attempted: boolean; ok: boolean } = { attempted: false, ok: false };
        let cliStdout = '', cliOk = false;
        try {
          const args = entry.cliArgs.map((a) => (a === '<nonceProjectId>' ? nonce : a));
          const { stdout } = await execFileAsync('node', [odBinPath, ...args], { env: { ...process.env, OD_DAEMON_URL: daemon.url }, timeout: 60_000 });
          cliStdout = stdout;
          cliOk = true;
        } catch { cliOk = false; }
        let httpOk = false, httpBody: unknown = null, httpText = '';
        try {
          const httpPath = entry.httpPath.replace(/:projectId|:id/i, nonce);
          const res = await fetch(`${daemon.url}${httpPath}`, { method: entry.httpMethod });
          httpText = await res.clone().text();
          httpBody = await res.json().catch(() => null);
          httpOk = res.ok;
        } catch { httpOk = false; }
        if (isProjectScoped) {
          nonceCheck = { attempted: true, ok: cliOk && httpOk && cliStdout.includes(nonce) && httpText.includes(nonce) };
        }
        const cliShape = cliOk ? deepKeyStructure((() => { try { return JSON.parse(cliStdout); } catch { return null; } })()) : [];
        const httpShape = httpOk ? deepKeyStructure(httpBody) : [];
        const shapeMatches = cliOk && httpOk && JSON.stringify(cliShape) === JSON.stringify(httpShape);
        const entryOk = nonceCheck.attempted ? nonceCheck.ok : shapeMatches;
        sampleResults.push({ capability: entry.capability, ok: entryOk, detail: `nonceAttempted=${nonceCheck.attempted} nonceOk=${nonceCheck.ok} shapeMatches=${shapeMatches} cliOk=${cliOk} httpOk=${httpOk}` });
      }

      const stubPath = path.join(proofDir, `.w0-red-control-stub-${crypto.randomBytes(4).toString('hex')}.mjs`);
      fs.writeFileSync(stubPath, "#!/usr/bin/env node\nconsole.log(JSON.stringify({ ok: true }));\n");
      const cliRun = await execFileAsync('node', [stubPath], { timeout: 30_000 }).catch((e: { stdout?: string }) => ({ stdout: e.stdout ?? '' }));
      const cliKeys = deepKeyStructure((() => { try { return JSON.parse(cliRun.stdout); } catch { return null; } })());
      const httpRes = await fetch(`${daemon.url}/api/health`);
      const httpKeys = deepKeyStructure(await httpRes.json());
      redControlOk = JSON.stringify(cliKeys) !== JSON.stringify(httpKeys);
      redControlDetail = `cliKeys=${JSON.stringify(cliKeys)} httpKeys=${JSON.stringify(httpKeys)}`;
      try { fs.unlinkSync(stubPath); } catch { /* best effort */ }
    } finally {
      if (daemon) await daemon.kill();
    }
    const ok = problems.length === 0 && sampleResults.length > 0 && sampleResults.every((r) => r.ok) && redControlOk && identityOk;
    record('C0-10', '', '', ok, `manifest: ${manifest.length}, applicable: ${applicable.length}, SUBCOMMAND_MAP: ${subcommandKeys.length}\nproblems: ${problems.join('; ') || 'none'}\nsample: ${JSON.stringify(sampleResults)}\nred control: ${redControlDetail}`, {
      detail: ok ? undefined : `problems=${problems.length} identityOk=${identityOk} sample=${JSON.stringify(sampleResults.map((r) => r.ok))} redControlOk=${redControlOk}`,
    });
  });

  // Round-3 F13: mutate a REAL manifest row (remove its cliArgs) rather than
  // adding a synthetic one.
  await checkCriterion('C0-11', 'verifier mutates a COPY of the real committed manifest -- removes cliArgs from one real applicable capability -- runs pnpm guard, requires the failure to name that specific capability', 'guard must fail and attribute the failure to the real capability whose CLI form was removed; reverts and re-runs guard expecting a clean pass', () => {
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
    const revertedRun = sh('pnpm', ['guard'], { timeoutMs: 20 * 60_000 });
    const revertedExit = revertedRun.status;
    const treeClean = sh('git', ['status', '--porcelain', '--', capabilityManifestRel]).stdout.trim().length === 0;
    const ok = brokenExit !== 0 && attributed && revertedExit === 0 && revertedCleanly && treeClean;
    record('C0-11', '', '', ok, `target=${targetCapability} brokenExit=${brokenExit} attributed=${attributed} revertedExit=${revertedExit} revertedCleanly=${revertedCleanly} treeClean=${treeClean}\n${brokenStdout.slice(-2000)}`, {
      detail: ok ? undefined : `target=${targetCapability} brokenExit=${brokenExit} attributed=${attributed} revertedExit=${revertedExit} revertedCleanly=${revertedCleanly} treeClean=${treeClean}`,
    });
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

    function grepCountRepoWide(pattern: RegExp): number {
      const seen = new Set<string>();
      (function walk(dir: string): void {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (['node_modules', '.git', 'dist', '.tmp', '.next'].includes(entry.name) || entry.name.startsWith('.')) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(ts|tsx|md|json)$/.test(entry.name)) {
            let t = '';
            try { t = fs.readFileSync(full, 'utf8'); } catch { continue; }
            for (const m of t.matchAll(pattern)) seen.add(m[0]);
          }
        }
      })(repoRoot);
      return seen.size;
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
