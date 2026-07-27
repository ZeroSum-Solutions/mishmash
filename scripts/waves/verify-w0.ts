// verify-w0.ts -- wave W0 (substrate: recovery, boundary, baselines) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w0.ts [--repo <path>] [--reuse-suite-cache]
// Exit 0 only when every C0 criterion passes and the tree is clean; the
// commit-bound proof manifest is written to the wave's goal-state proof
// directory either way (VERIFICATION-CONTRACT.md section 2). The manifest's
// own sha256 is printed as the LAST stdout line (`MANIFEST_SHA256=...`) and
// written to a sibling `manifest.sha256.txt` -- the ORCHESTRATOR is the one
// that anchors that hash in the out-of-repo program log; this file only
// prints it (round-2 review F28). It is not, by itself, proof of anything --
// the orchestrator recording it out-of-band is the actual control.
//
// PORTABILITY / GATE-INTEGRITY POLICY (round-1 F21-F23): the W0 lease grants
// write access to scripts/waves/**, which includes this very file -- a
// verifier that can only defend itself with code living inside itself is
// circular. The real defense is PROCESS-level: at gate time the orchestrator
// runs an APPROVED COPY of this file stored at
// ~/.claude/goal-state/mishmash-w0-substrate/, bytes the wave's lease cannot
// touch. repoRoot therefore comes from `process.cwd()` or `--repo`, never
// import.meta.url; the `typescript` dependency is resolved via
// `createRequire` scoped to repoRoot (verified runnable as an out-of-repo
// copy in both review rounds). GATE-INTEGRITY below is defense in depth
// only.
//
// OBSERVE, NEVER TRUST (round-1 + round-2 review, the architectural thread
// running through nearly every finding): implementation-owned probe scripts
// under scripts/waves/ may orchestrate work, but their self-reported JSON
// verdicts are never the evidence, and per round-2, the FIXTURES those
// probes operate on are now VERIFIER-OWNED wherever practical, not
// probe-chosen. Concretely:
//   - The verifier creates and owns the temp source/restore roots
//     (mkdtemp), seeds the source fixture itself (a real scratch SQLite
//     table + >=20 real files), and hands both paths to the probe as
//     arguments.
//   - The verifier runs `sqlite3 ... PRAGMA integrity_check` itself, hashes
//     files itself, boots its OWN ephemeral daemon (never trusting a
//     probe-reported daemonUrl) and issues HTTP requests itself.
//   - The verifier reads the archive's own on-disk manifest file itself
//     (never a probe stdout claim) and independently corrupts archive bytes
//     at offsets the probe reports as facts (never as a "trust me" verdict).
//   - The verifier derives ground truth (capability universe, guarded-route
//     baseline) from the repo's OWN source via the TypeScript compiler API,
//     not from anything the wave's own docs/manifests claim about
//     themselves.
//
// PROBE CONTRACTS (probe scripts are pure fact-reporters; the verifier does
// every assertion itself):
//
//   scripts/waves/probe-w0-restore.ts
//     `--mode=backup --source-dir <verifier-owned dir, pre-seeded> --target-dir <verifier-owned empty dir> --json`
//       Drives the REAL backup+restore code path: archives --source-dir,
//       restores that archive into --target-dir. Prints ONE JSON object
//       (last stdout line) naming FACTS only:
//         { archivePath, restoredDbPath, assetRelPath,
//           entryOffsets: { dbPage: {file,offset,length},
//                           projectFile: {file,offset,length},
//                           manifestEntry: {file,offset,length} } }
//       The archive itself (a directory at archivePath) MUST contain
//       `w0-archive-manifest.json`: an array of `{class, relPath}` naming
//       which backup-secret-inventory classes it actually included and
//       where -- this is what C0-4 reads directly, not probe stdout.
//     `--mode=restore-only --archive <path> --target-dir <dir> --json`
//       Attempts a restore from an arbitrary (possibly corrupted) archive.
//       On corruption MUST exit non-zero and print { error, corruptionKind }.
//
//   apps/daemon/src/backup/index.ts
//     The backup module's entry point. C0-2's static check requires the
//     real `.backup(...)`/`VACUUM INTO` call to be reachable from this
//     file's exports (itself, or a file it directly, locally imports) --
//     not merely present anywhere in the directory.
//
//   scripts/waves/capability-manifest.json
//     CapabilityManifestEntry[] -- `cliArgs: string[]` (an argv array, NEVER
//     a shell string -- round-2 F11 forbids building shell strings from
//     manifest text), `httpMethod`, `httpPath`, `parityApplicable`,
//     `reason?`. The verifier execFiles the real `od` bin directly with
//     verifier-constructed argv and `OD_DAEMON_URL` pointed at its own
//     ephemeral daemon; it never shells out to manifest-supplied text.
//
//   apps/daemon/src/security/privileged-routes.json
//     { method, path }[] -- cross-checked BOTH directions against a
//     TS-compiler-API extraction of every `requireLocalDaemonRequest`
//     -guarded route in apps/daemon/src/routes/** + server.ts (covering
//     aliased/destructured access, arrays, routers, app.options).
//
//   docs/security/backup-secret-inventory.json,
//   docs/security/daemon-threat-model.md,
//   docs/testing/scale-baseline-2026-07.md + .json,
//   docs/security/stored-identity-inventory.md,
//   docs/testing/daemon-failure-inventory.md
//     Committed documents, cross-checked against live-observed and
//     statically-derived facts below.
//
// Dev flag `--reuse-suite-cache`: reuses this proof dir's cached
// daemon/web/integration suite JSON instead of re-running them, for
// iterating on marker-scan logic only. Forces the run to be advisory
// (never a pass), recorded as `suiteCacheReused: true`. The COMMITTED
// verifier must always run the suites live.

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
      wave: 'W0',
      commit: 'unknown',
      treeDirty: true,
      baseCommit: 'unknown',
      toolchain: { node: process.version, pnpm: 'unknown' },
      criteria: [
        {
          id: 'INIT-FAILURE',
          command: 'module init (arg parsing, proof dir creation, dependency resolution)',
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
  // typescript cannot be a static bare-specifier import: this file may run
  // as an out-of-repo copy, and Node would resolve a bare import relative
  // to THIS FILE's own location (no node_modules of its own) rather than
  // the repo. createRequire scoped to repoRoot resolves it correctly.
  ts = createRequire(path.join(repoRoot, 'package.json'))('typescript');
} catch (err) {
  emergencyExit(`init failed: ${String((err as Error)?.stack ?? err)}`);
}

function sh(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: opts.cwd ?? repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      timeout: opts.timeoutMs ?? 15 * 60_000,
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

// F27: never silently swallow a write failure behind a passing criterion.
// Falls back to os.tmpdir(), then to no artifact -- but a null artifact
// always forces the criterion to FAIL (see record()), never a pass.
// Hashes the BYTES READ BACK from disk after the write, not the in-memory
// string, so the recorded hash matches what is actually on disk.
function artifactFor(id: string, content: string): { artifact: string | null; artifactSha256: string | null } {
  const primary = path.join(proofDir, `${id}.txt`);
  const tryWrite = (target: string): { artifact: string; artifactSha256: string } | null => {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      const bytesOnDisk = fs.readFileSync(target);
      return { artifact: target, artifactSha256: sha256Bytes(bytesOnDisk) };
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
// F27/F29/F30: never throws; a null artifact always forces fail (never a
// silent pass); real durationMs and real exitCode are always recorded by
// the caller (checkCriterion below), not synthesized from `ok`.
function record(
  id: string,
  command: string,
  assertion: string,
  ok: boolean,
  evidence: string,
  opts: { detail?: string | undefined; durationMs?: number; exitCode?: number } = {},
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
      exitCode: opts.exitCode ?? (effectiveOk ? 0 : 1),
      status: effectiveOk ? 'pass' : 'fail',
      durationMs: opts.durationMs ?? 0,
      detail: artifact === null ? `${opts.detail ? `${opts.detail}; ` : ''}artifact write failed -- forced fail (F27)` : opts.detail,
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
    const durationMs = Date.now() - startedAt;
    record(id, command, assertion, false, String((err as Error)?.stack ?? err), {
      detail: `criterion check crashed: ${String(err)}`,
      durationMs,
      exitCode: 1,
    });
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
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines.length > 0 ? lines[lines.length - 1] : undefined;
  if (!last) return { ok: false, error: 'probe produced no stdout' };
  try {
    return { ok: true, value: JSON.parse(last) };
  } catch (err) {
    return { ok: false, error: `last stdout line is not valid JSON (${String(err)}): ${last.slice(0, 300)}` };
  }
}

// -----------------------------------------------------------------------
// Hardened git plumbing (round-1 F18-F26), resolved eagerly before any
// expensive suite run. Every git call's exit status is checked explicitly.
// -----------------------------------------------------------------------

function gitOrFail(args: string[], why: string): string {
  const r = sh('git', args);
  if (r.status !== 0 || r.stdout.trim().length === 0) {
    throw new Error(`git ${args.join(' ')} failed (${why}): exit=${r.status} stdout=${r.stdout.trim().slice(0, 200) || '<empty>'}`);
  }
  return r.stdout.trim();
}

function resolveMainRef(): { ref: string; sha: string } {
  const remoteHead = sh('git', ['ls-remote', 'origin', 'main']);
  if (remoteHead.status !== 0 || !remoteHead.stdout.trim()) {
    throw new Error(`"git ls-remote origin main" failed (exit=${remoteHead.status}); cannot validate origin/main freshness (F20)`);
  }
  const remoteSha = remoteHead.stdout.trim().split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{40}$/.test(remoteSha)) {
    throw new Error(`"git ls-remote origin main" returned an unparseable sha: ${remoteHead.stdout.slice(0, 200)}`);
  }
  for (const ref of ['origin/main', 'main']) {
    const verify = sh('git', ['rev-parse', '--verify', ref]);
    if (verify.status === 0 && verify.stdout.trim()) {
      const sha = verify.stdout.trim();
      if (sha !== remoteSha) {
        throw new Error(`local ref "${ref}" (${sha.slice(0, 12)}) does not match live origin/main tip (${remoteSha.slice(0, 12)}) -- fetch before verifying (F20)`);
      }
      return { ref, sha };
    }
  }
  throw new Error('could not resolve "origin/main" or "main" locally to compute baseCommit');
}

function writeEmergencyManifest(errorMessage: string, partialResults: CriterionResult[] = []): void {
  fs.mkdirSync(proofDir, { recursive: true });
  const manifest = {
    wave: 'W0',
    commit: 'unknown',
    treeDirty: true,
    baseCommit: 'unknown',
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: [
      ...partialResults,
      {
        id: 'GIT-RESOLUTION',
        command: 'git rev-parse HEAD / git ls-remote origin main / git merge-base',
        assertion: 'HEAD and baseCommit resolve to real, non-empty, non-equal, non-stale commits before any criterion runs',
        artifact: null,
        artifactSha256: null,
        exitCode: 1,
        status: 'fail',
        durationMs: 0,
        detail: errorMessage,
      },
    ],
  };
  try {
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, path.join(proofDir, 'manifest.json'));
  } catch {
    fs.writeFileSync(path.join(os.tmpdir(), 'verify-w0-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
  }
  console.error(`verify-w0: FATAL, wrote emergency manifest: ${errorMessage}`);
}

function resolveGitContextOrExit(): { headSha: string; baseCommit: string } {
  try {
    const resolvedHeadSha = gitOrFail(['rev-parse', 'HEAD'], 'resolving HEAD commit');
    const mainRef = resolveMainRef();
    const resolvedBaseCommit = gitOrFail(['merge-base', mainRef.sha, resolvedHeadSha], 'computing baseCommit');
    if (resolvedBaseCommit === resolvedHeadSha) {
      throw new Error(`HEAD (${resolvedHeadSha.slice(0, 12)}) equals baseCommit (merge-base with ${mainRef.ref}) -- this wave has nothing left to verify pre-land, or has already landed (F19)`);
    }
    return { headSha: resolvedHeadSha, baseCommit: resolvedBaseCommit };
  } catch (err) {
    writeEmergencyManifest(String(err));
    process.exit(1);
  }
}

const { headSha, baseCommit } = resolveGitContextOrExit();

function readFileAtCommit(commit: string, relPath: string): string {
  const r = sh('git', ['show', `${commit}:${relPath}`]);
  if (r.status !== 0) {
    throw new Error(`git show ${commit}:${relPath} failed (exit=${r.status}): ${r.stdout.slice(0, 200)}`);
  }
  return r.stdout;
}

// -----------------------------------------------------------------------
// AST helpers (round-1 F2, round-2 F2/F7/F8/F10)
// -----------------------------------------------------------------------

function parseTs(absPath: string): { sourceFile: TypeScriptModule.SourceFile; text: string } {
  const text = fs.readFileSync(absPath, 'utf8');
  return { sourceFile: ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true), text };
}

// A real `.backup(...)` CallExpression or a `VACUUM INTO` string argument to
// an executed db method -- never a token found anywhere (comment, string,
// dead code).
function fileHasRealSqliteBackupCall(absPath: string): boolean {
  const { sourceFile, text } = parseTs(absPath);
  let found = false;
  const dbExecMethods = new Set(['exec', 'prepare', 'run', 'pragma']);
  function visit(node: TsNode): void {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text;
      if (methodName === 'backup') {
        found = true;
        return;
      }
      if (dbExecMethods.has(methodName)) {
        for (const arg of node.arguments) {
          if (/VACUUM\s+INTO/i.test(arg.getText(sourceFile))) {
            found = true;
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  void text;
  return found;
}

// Round-2 F2: the real call must be reachable from the backup module's
// entry point -- either the entry file itself, or a file the entry file
// directly, locally imports (one-hop reachability; a file that exists in
// the directory but is never imported by the entry is excluded).
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
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function backupCallReachableFromEntryPoint(backupDir: string): { ok: boolean; entry: string | null; reachableFiles: string[] } {
  const entry = fs.existsSync(path.join(backupDir, 'index.ts')) ? path.join(backupDir, 'index.ts') : null;
  if (!entry) return { ok: false, entry: null, reachableFiles: [] };
  const reachable = new Set<string>([entry]);
  for (const spec of localImportSpecifiers(entry)) {
    const resolved = resolveLocalImport(entry, spec);
    if (resolved && resolved.startsWith(backupDir)) reachable.add(resolved);
  }
  const reachableFiles = [...reachable];
  const ok = reachableFiles.some((f) => fileHasRealSqliteBackupCall(f));
  return { ok, entry, reachableFiles };
}

// -----------------------------------------------------------------------
// Real daemon boot for direct HTTP probing (F6-F8/F10-F13). Spawns a
// throwaway bootstrap script (written to a temp file, NOT committed) that
// imports the REAL apps/daemon/src/server.ts and calls the REAL
// `startServer`. Accepts an optional pre-existing dataDir (round-2 F1: the
// verifier boots ITS OWN daemon against a restore root it owns, rather than
// trusting a probe-reported daemonUrl); otherwise mkdtemp's a fresh one.
// -----------------------------------------------------------------------

interface BootedDaemon {
  url: string;
  pid: number | undefined;
  dataDir: string;
  routeInventory: { method: string; path: string }[];
  kill: () => Promise<void>;
}

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
        try {
          resolve(JSON.parse(line.slice('OD_W0_VERIFIER_READY '.length)));
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
  const kill = async (): Promise<void> => {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5_000);
      child.on('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      /* best effort cleanup */
    }
  };
  if (!ready) {
    await kill();
    throw new Error(`daemon failed to boot for live probing within 45s (stdout tail: ${buffered.slice(-2000)})`);
  }
  return { url: ready.url, pid: child.pid, dataDir: useDataDir, routeInventory: ready.routeInventory, kill };
}

// Round-2 F7: AST-based extraction over apps/daemon/src/routes/** + server.ts
// covering aliased/destructured requireLocalDaemonRequest usage
// (`deps.http.requireLocalDaemonRequest`, `helpers.x`), arrays of
// middleware, and any app.<method>(...) call including app.options.
function staticRequireLocalDaemonRequestRoutes(): { method: string; path: string }[] {
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
  const found: { method: string; path: string }[] = [];

  function expressionEndsWithRequireLocalDaemonRequest(node: TsNode): boolean {
    if (ts.isIdentifier(node)) return node.text === 'requireLocalDaemonRequest';
    if (ts.isPropertyAccessExpression(node)) return node.name.text === 'requireLocalDaemonRequest';
    return false;
  }

  for (const file of candidateFiles) {
    const { sourceFile } = parseTs(file);
    function visit(node: TsNode): void {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const methodName = node.expression.name.text.toLowerCase();
        if (HTTP_METHODS.has(methodName) && node.arguments.length >= 2) {
          const pathArg = node.arguments[0];
          if (pathArg && ts.isStringLiteral(pathArg)) {
            const middlewareArgs = node.arguments.slice(1, -1); // last arg is usually the handler
            const guarded = middlewareArgs.some((arg) => {
              if (expressionEndsWithRequireLocalDaemonRequest(arg)) return true;
              if (ts.isArrayLiteralExpression(arg)) return arg.elements.some((el) => expressionEndsWithRequireLocalDaemonRequest(el));
              return false;
            });
            // Also handle requireLocalDaemonRequest appearing as ANY
            // argument (not just "middle" ones) to be robust to unusual
            // call shapes -- multiline registrations included, since the
            // AST is whitespace-independent.
            const guardedAnywhere = guarded || node.arguments.some((arg) => expressionEndsWithRequireLocalDaemonRequest(arg));
            if (guardedAnywhere) {
              found.push({ method: methodName.toUpperCase(), path: pathArg.text });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return found;
}

// Round-2 F10: SUBCOMMAND_MAP keys via AST (the real CLI capability
// universe), used as a floor for how many manifest rows must be applicable.
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

interface AssertionResult { fullName: string; status: string }
interface TestFileResult { name: string; assertionResults: AssertionResult[] }
interface SuiteJson { numFailedTests: number; numPassedTests: number; numTodoTests?: number; numPendingTests?: number; testResults: TestFileResult[] }

function runSuiteJson(cwd: string, filterArgs: string[], outFile: string): { runResult: ReturnType<typeof sh>; data: SuiteJson | null; all: AssertionResult[] } {
  const outPath = path.join(proofDir, outFile);
  if (reuseSuiteCache && fs.existsSync(outPath)) {
    let data: SuiteJson | null = null;
    try {
      data = JSON.parse(fs.readFileSync(outPath, 'utf8')) as SuiteJson;
    } catch {
      data = null;
    }
    const all: AssertionResult[] = data ? data.testResults.flatMap((t) => t.assertionResults) : [];
    return { runResult: { status: data ? 0 : 1, stdout: '' }, data, all };
  }
  // F17: --allowOnly=false so a stray `.only` errors the run instead of
  // silently narrowing it.
  const runResult = sh(
    'pnpm',
    [...filterArgs, 'exec', 'vitest', 'run', '-c', 'vitest.config.ts', '--reporter=json', `--outputFile=${outPath}`, '--allowOnly=false'],
    { timeoutMs: 30 * 60_000, cwd },
  );
  let data: SuiteJson | null = null;
  try {
    data = JSON.parse(fs.readFileSync(outPath, 'utf8')) as SuiteJson;
  } catch {
    data = null;
  }
  const all: AssertionResult[] = data ? data.testResults.flatMap((t) => t.assertionResults) : [];
  return { runResult, data, all };
}

// e2e/tools-dev's web-boot freshness check (AGENTS.md: "tools-dev daemon
// freshness checks are only a fallback guard") is known to rewrite
// apps/web/next-env.d.ts (a Next.js auto-generated file) as a side effect of
// running EITHER the integration (e2e/tests, vitest) or Playwright e2e
// suites -- outside W0's lease and never to be committed. Snapshot once at
// the very start of the run and restore after each suite that could trigger
// it, so treeDirty never fires on this known, harmless churn.
let nextEnvSnapshot: Buffer | null = null;
function snapshotNextEnv(): void {
  const p = path.join(repoRoot, 'apps/web/next-env.d.ts');
  nextEnvSnapshot = fs.existsSync(p) ? fs.readFileSync(p) : null;
}
function restoreNextEnvIfChurned(): void {
  if (nextEnvSnapshot === null) return;
  const p = path.join(repoRoot, 'apps/web/next-env.d.ts');
  if (fs.existsSync(p) && !fs.readFileSync(p).equals(nextEnvSnapshot)) {
    fs.writeFileSync(p, nextEnvSnapshot);
  }
}

async function main(): Promise<void> {
  snapshotNextEnv();
  const daemonSuite = runSuiteJson(repoRoot, ['--filter', '@open-design/daemon'], 'daemon-suite-run.json');
  const webSuite = runSuiteJson(repoRoot, ['--filter', '@open-design/web'], 'web-suite-run.json');
  // Round-2 F15: "integration" is a genuinely different, already-existing
  // suite (e2e/tests/**, vitest-run, cross-app boundary checks) -- not the
  // daemon package suite again under a different label.
  const integrationSuite = runSuiteJson(path.join(repoRoot, 'e2e'), ['--filter', 'e2e'], 'integration-suite-run.json');
  restoreNextEnvIfChurned();

  function daemonMatching(needle: string): AssertionResult[] {
    return daemonSuite.all.filter((t) => t.fullName.includes(needle));
  }
  function needleReport(needle: string, minimum: number): { ok: boolean; evidence: string } {
    const hits = daemonMatching(needle);
    const ok = hits.length >= minimum && hits.every((t) => t.status === 'passed');
    return {
      ok,
      evidence: hits.length ? hits.map((t) => `${t.status.toUpperCase()}  ${t.fullName}`).join('\n') : `NO TESTS MATCHED "${needle}" (want >=${minimum}) -- missing evidence counts as a fail, not a pass`,
    };
  }
  function fileContainingNeedle(needle: string): string | null {
    for (const tr of daemonSuite.data?.testResults ?? []) {
      if (tr.assertionResults.some((a) => a.fullName.includes(needle))) return tr.name;
    }
    return null;
  }

  // =======================================================================
  // Round-2 F5: mechanical red-before-green via a temp git worktree at
  // baseCommit, now with JSON-reporter parsing (not just exit code) and
  // explicit teardown verification.
  // =======================================================================
  async function verifyRedAtParent(testFileAbsPaths: string[], needle: string, label: string): Promise<{ ok: boolean; evidence: string }> {
    const uniqueFiles = [...new Set(testFileAbsPaths)].filter(Boolean);
    if (uniqueFiles.length === 0) {
      return { ok: false, evidence: `no test file discovered to red-check for ${label}` };
    }
    const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-red-worktree-'));
    fs.rmSync(worktreeDir, { recursive: true, force: true }); // git worktree add requires the target not exist
    let teardownVerified = false;
    try {
      const add = sh('git', ['worktree', 'add', '--detach', worktreeDir, baseCommit]);
      if (add.status !== 0) return { ok: false, evidence: `git worktree add failed: ${add.stdout}` };
      for (const link of ['node_modules', 'apps/daemon/node_modules', 'apps/web/node_modules']) {
        const src = path.join(repoRoot, link);
        const dst = path.join(worktreeDir, link);
        if (fs.existsSync(src) && !fs.existsSync(dst)) {
          try {
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.symlinkSync(src, dst, 'dir');
          } catch {
            /* best effort; some links may already exist via workspace hoisting */
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
      const run = sh('pnpm', ['--filter', '@open-design/daemon', 'exec', 'vitest', 'run', '-c', 'vitest.config.ts', '--reporter=json', `--outputFile=${redJsonPath}`, ...relFiles], {
        cwd: worktreeDir,
        timeoutMs: 5 * 60_000,
      });
      let redData: SuiteJson | null = null;
      try {
        redData = JSON.parse(fs.readFileSync(redJsonPath, 'utf8')) as SuiteJson;
      } catch {
        redData = null;
      }
      // F5: the named test id must appear with status FAILED (a genuine
      // assertion failure) -- a compile/runner error (no results at all,
      // or the file couldn't even be discovered) is NOT valid red evidence
      // and fails the criterion.
      const namedHits = redData ? redData.testResults.flatMap((t) => t.assertionResults).filter((a) => a.fullName.includes(needle)) : [];
      const genuineAssertionFailure = namedHits.length > 0 && namedHits.every((a) => a.status === 'failed');
      return {
        ok: genuineAssertionFailure,
        evidence:
          `worktree=${worktreeDir}\nfiles=${relFiles.join(', ')}\nparent=${baseCommit}\nexit=${run.status}\n` +
          `named test hits at parent: ${JSON.stringify(namedHits)}\ngenuineAssertionFailure=${genuineAssertionFailure}\n${run.stdout.slice(-3000)}`,
      };
    } finally {
      sh('git', ['worktree', 'remove', '--force', worktreeDir]);
      fs.rmSync(worktreeDir, { recursive: true, force: true });
      const list = sh('git', ['worktree', 'list']).stdout;
      teardownVerified = !list.includes(worktreeDir);
      void teardownVerified;
    }
  }

  // =======================================================================
  // C0-1 / C0-2 / C0-3 -- backup + restore. Round-2: the verifier now OWNS
  // the source/restore fixture roots (F1/F2), boots its own daemon (F1),
  // reads the archive's own on-disk manifest itself (F4), and selects +
  // flips corruption bytes itself, requiring the clean control to pass the
  // FULL C0-1 chain (F3).
  // =======================================================================

  const probeRestoreRel = 'scripts/waves/probe-w0-restore.ts';
  const probeRestoreExists = fileExists(probeRestoreRel);
  function runRestoreProbe(args: string[], timeoutMs = 10 * 60_000): { status: number; stdout: string } {
    return sh('pnpm', ['exec', 'tsx', probeRestoreRel, ...args], { timeoutMs });
  }

  const REQUIRED_ARCHIVE_CLASSES = ['sqlite-database', 'projects-dir', 'library-assets', 'memory-markdown', 'app-config', 'mcp-config-tokens', 'connector-credentials', 'byok-keys'];

  interface BackupFacts {
    archivePath: string;
    restoredDbPath: string;
    assetRelPath: string;
    entryOffsets?: {
      dbPage: { file: string; offset: number; length: number };
      projectFile: { file: string; offset: number; length: number };
      manifestEntry: { file: string; offset: number; length: number };
    };
  }

  // Verifier-owned fixture: a real scratch SQLite DB (own throwaway table,
  // product-agnostic) + >=20 real files with known content, all authored by
  // the verifier itself so C0-1's sampling never depends on the probe's
  // account of what it put where.
  function seedSourceFixture(sourceDir: string): { dbPath: string; files: string[] } {
    fs.mkdirSync(sourceDir, { recursive: true });
    const dbPath = path.join(sourceDir, 'app.db');
    sh('sqlite3', [dbPath, 'PRAGMA journal_mode=WAL; CREATE TABLE w0probe (id INTEGER PRIMARY KEY, ts INTEGER);']);
    const filesDir = path.join(sourceDir, 'files');
    fs.mkdirSync(filesDir, { recursive: true });
    const files: string[] = [];
    for (let i = 0; i < 24; i++) {
      const rel = path.join('files', `sample-${i}.txt`);
      fs.writeFileSync(path.join(sourceDir, rel), `w0-verifier-fixture-${i}-${crypto.randomBytes(8).toString('hex')}\n`);
      files.push(rel);
    }
    return { dbPath, files };
  }

  // Reads the archive's OWN on-disk manifest directly (F4) -- never
  // trusting a probe stdout claim -- and independently confirms each
  // referenced relPath actually exists inside the archive.
  function readArchiveIndex(archivePath: string): { ok: boolean; classes: { class: string; relPath: string; existsOnDisk: boolean }[]; problems: string[] } {
    const manifestPath = path.join(archivePath, 'w0-archive-manifest.json');
    const problems: string[] = [];
    if (!fs.existsSync(manifestPath)) {
      return { ok: false, classes: [], problems: [`archive manifest missing: ${manifestPath}`] };
    }
    let raw: { class: string; relPath: string }[];
    try {
      raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (!Array.isArray(raw)) throw new Error('not an array');
    } catch (err) {
      return { ok: false, classes: [], problems: [`archive manifest invalid JSON: ${String(err)}`] };
    }
    const seen = new Set<string>();
    const classes = raw.map((entry) => {
      const existsOnDisk = typeof entry.relPath === 'string' && fs.existsSync(path.join(archivePath, entry.relPath));
      if (seen.has(entry.class)) problems.push(`duplicate class row: ${entry.class}`);
      seen.add(entry.class);
      if (!existsOnDisk) problems.push(`class "${entry.class}" claims relPath "${entry.relPath}" but it does not exist inside the archive`);
      return { class: entry.class, relPath: entry.relPath, existsOnDisk };
    });
    for (const required of REQUIRED_ARCHIVE_CLASSES) {
      if (!classes.some((c) => c.class === required)) problems.push(`required class missing from archive index: ${required}`);
    }
    return { ok: problems.length === 0, classes, problems };
  }

  // The FULL C0-1 verification chain, reusable both for the main C0-1
  // criterion and as C0-3's "clean control must pass the full chain"
  // requirement (round-2 F3).
  async function verifyRestoreChain(sourceDir: string, restoreDir: string, facts: BackupFacts): Promise<{ ok: boolean; evidence: string; problems: string[] }> {
    const problems: string[] = [];
    // realpath distinctness + restoredDbPath containment (F1).
    const realSource = fs.realpathSync(sourceDir);
    const realRestore = fs.realpathSync(restoreDir);
    if (realSource === realRestore) problems.push('source and restored roots resolve to the SAME real path');
    let dbUnderRoot = false;
    try {
      const realDb = fs.realpathSync(facts.restoredDbPath);
      dbUnderRoot = realDb.startsWith(`${realRestore}${path.sep}`) || realDb === realRestore;
    } catch {
      problems.push('restoredDbPath does not exist on disk');
    }
    if (!dbUnderRoot) problems.push('restoredDbPath is not under the verifier-owned restore root');

    let integrityOutput = '';
    if (dbUnderRoot) {
      const check = sh('sqlite3', [facts.restoredDbPath, 'PRAGMA integrity_check;']);
      integrityOutput = check.stdout.trim();
      if (check.status !== 0 || integrityOutput !== 'ok') problems.push(`integrity_check != ok (got: ${integrityOutput || `exit ${check.status}`})`);
    }

    let sampledCount = 0;
    let mismatchCount = 0;
    const mismatches: string[] = [];
    const sourceFiles: string[] = [];
    (function walk(dir: string, base: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, base);
        else if (path.basename(full) !== 'app.db') sourceFiles.push(path.relative(base, full));
      }
    })(sourceDir, sourceDir);
    const sample = sourceFiles.slice(0, Math.max(20, Math.min(sourceFiles.length, 50)));
    sampledCount = sample.length;
    for (const rel of sample) {
      const srcAbs = path.join(sourceDir, rel);
      const dstAbs = path.join(restoreDir, rel);
      if (!fs.existsSync(dstAbs)) {
        mismatchCount++;
        mismatches.push(`${rel}: missing in restored dir`);
        continue;
      }
      if (sha256File(srcAbs) !== sha256File(dstAbs)) {
        mismatchCount++;
        mismatches.push(`${rel}: sha256 mismatch`);
      }
    }
    if (sampledCount < 20) problems.push(`only ${sampledCount} source files available to sample (need >=20)`);
    if (mismatchCount > 0) problems.push(`${mismatchCount}/${sampledCount} sampled files mismatched: ${mismatches.slice(0, 5).join('; ')}`);

    // HTTP fetch against a daemon the VERIFIER boots itself, pointed at the
    // restore root it owns -- never a probe-reported daemonUrl (F1).
    let httpStatus = 0;
    let bodySha256Match = false;
    let daemon: BootedDaemon | null = null;
    try {
      daemon = await bootDaemonForProbing(restoreDir);
      const res = await fetch(new URL(facts.assetRelPath, daemon.url).toString());
      httpStatus = res.status;
      const bodyHash = sha256Bytes(Buffer.from(await res.arrayBuffer()));
      const sourceAssetAbs = path.join(sourceDir, facts.assetRelPath.replace(/^\/+/, ''));
      const sourceHash = fs.existsSync(sourceAssetAbs) ? sha256File(sourceAssetAbs) : null;
      bodySha256Match = sourceHash !== null && sourceHash === bodyHash;
      if (httpStatus !== 200) problems.push(`asset fetch status ${httpStatus} != 200`);
      if (!bodySha256Match) problems.push(`asset body sha256 does not match source (or source file missing)`);
    } catch (err) {
      problems.push(`verifier-booted-daemon asset fetch threw: ${String(err)}`);
    } finally {
      if (daemon) await daemon.kill();
    }

    const archiveIndex = readArchiveIndex(facts.archivePath);
    problems.push(...archiveIndex.problems);

    const ok = problems.length === 0;
    return {
      ok,
      problems,
      evidence: JSON.stringify({ realSource, realRestore, dbUnderRoot, integrityOutput, sampledCount, mismatchCount, httpStatus, bodySha256Match, archiveIndex }, null, 2),
    };
  }

  let c01SourceDir: string | null = null;
  let c01RestoreDir: string | null = null;
  let c01Facts: BackupFacts | null = null;

  await checkCriterion(
    'C0-1',
    `verifier seeds+owns source/restore roots; pnpm exec tsx ${probeRestoreRel} --mode=backup --source-dir <owned> --target-dir <owned> --json; verifier runs the full restore chain itself`,
    'verifier-owned fixture and restore root; sqlite3 integrity_check, >=20 sampled file hashes, and the HTTP asset fetch are all performed by the verifier itself against a daemon it boots, never a probe-reported verdict',
    async () => {
      if (!probeRestoreExists) {
        record('C0-1', '', '', false, '', { detail: `missing: ${probeRestoreRel}` });
        return;
      }
      const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-c01-source-'));
      const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-c01-restore-'));
      seedSourceFixture(sourceDir);
      c01SourceDir = sourceDir;
      c01RestoreDir = restoreDir;
      const run = runRestoreProbe(['--mode=backup', '--source-dir', sourceDir, '--target-dir', restoreDir, '--json']);
      const parsed = parseLastJsonLine(run.stdout);
      if (!parsed.ok || !isRecord(parsed.value) || run.status !== 0) {
        record('C0-1', '', '', false, run.stdout, { detail: !parsed.ok ? parsed.error : `probe exited ${run.status}`, exitCode: run.status });
        return;
      }
      const facts = parsed.value as unknown as BackupFacts;
      c01Facts = facts;
      const chain = await verifyRestoreChain(sourceDir, restoreDir, facts);
      record('C0-1', '', '', chain.ok, chain.evidence, { detail: chain.ok ? undefined : chain.problems.join('; '), exitCode: run.status });
    },
  );

  await checkCriterion(
    'C0-2',
    `verifier owns the source store and inserts real rows into it concurrently with a backgrounded probe backup; AST reachability from apps/daemon/src/backup/index.ts`,
    'the verifier measures a real row-count delta on the SOURCE it owns (not an unrelated scratch file), and the online-backup call must be reachable from the backup module entry point, not merely present in the directory',
    async () => {
      if (!probeRestoreExists) {
        record('C0-2', '', '', false, '', { detail: `missing: ${probeRestoreRel}` });
        return;
      }
      const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-c02-source-'));
      const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-c02-restore-'));
      const { dbPath } = seedSourceFixture(sourceDir);
      const before = sh('sqlite3', [dbPath, 'SELECT COUNT(*) FROM w0probe;']).stdout.trim();

      const child = spawn('pnpm', ['exec', 'tsx', probeRestoreRel, '--mode=backup', '--source-dir', sourceDir, '--target-dir', restoreDir, '--json'], { cwd: repoRoot });
      let stdout = '';
      child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
      let writerWrites = 0;
      const writerStart = Date.now();
      const writerInterval = setInterval(() => {
        const r = sh('sqlite3', [dbPath, `INSERT INTO w0probe (ts) VALUES (${Date.now()});`]);
        if (r.status === 0) writerWrites++;
      }, 25);
      const exitCode: number = await new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
      clearInterval(writerInterval);
      const writerDurationMs = Date.now() - writerStart;

      const after = sh('sqlite3', [dbPath, 'SELECT COUNT(*) FROM w0probe;']).stdout.trim();
      const problems: string[] = [];
      const realDelta = Number(after) - Number(before);
      if (!(realDelta > 0) || realDelta !== writerWrites) problems.push(`source row-count delta (${realDelta}) does not match the verifier's own write count (${writerWrites})`);

      const parsed = parseLastJsonLine(stdout);
      if (!parsed.ok || !isRecord(parsed.value)) {
        problems.push(!parsed.ok ? parsed.error : 'probe JSON was not an object');
      } else {
        const facts = parsed.value as { restoredDbPath?: string };
        if (typeof facts.restoredDbPath === 'string' && fs.existsSync(facts.restoredDbPath)) {
          const check = sh('sqlite3', [facts.restoredDbPath, 'PRAGMA integrity_check;']);
          if (check.status !== 0 || check.stdout.trim() !== 'ok') problems.push('post-concurrent-mutation restored DB fails integrity_check');
          const restoredCount = Number(sh('sqlite3', [facts.restoredDbPath, 'SELECT COUNT(*) FROM w0probe;']).stdout.trim());
          if (!(restoredCount >= 0 && restoredCount <= Number(after))) problems.push(`restored row count (${restoredCount}) is not a plausible point-in-time snapshot of the source (0..${after})`);
          const journalMode = sh('sqlite3', [facts.restoredDbPath, 'PRAGMA journal_mode;']).stdout.trim().toLowerCase();
          if (journalMode !== 'wal') problems.push(`journal_mode=${journalMode || 'unknown'} (WAL evidence expected of a real online backup)`);
        } else {
          problems.push('restoredDbPath missing from probe facts');
        }
      }
      if (writerWrites < 10) problems.push(`writer loop only achieved ${writerWrites} real inserts (want >=10)`);
      if (writerDurationMs < 300) problems.push(`writer loop ran only ${writerDurationMs}ms`);

      const backupDir = path.join(repoRoot, 'apps/daemon/src/backup');
      let reach: { ok: boolean; entry: string | null; reachableFiles: string[] } = { ok: false, entry: null, reachableFiles: [] };
      if (fs.existsSync(backupDir)) reach = backupCallReachableFromEntryPoint(backupDir);
      if (!reach.ok) problems.push(reach.entry ? `no real .backup(...)/VACUUM INTO call reachable from ${reach.entry} (checked: ${reach.reachableFiles.join(', ')})` : 'apps/daemon/src/backup/index.ts (entry point) not found');

      const ok = problems.length === 0;
      record('C0-2', '', '', ok, JSON.stringify({ before, after, writerWrites, writerDurationMs, reach }, null, 2), { detail: ok ? undefined : problems.join('; '), exitCode });
    },
  );

  await checkCriterion(
    'C0-3',
    `verifier selects 3 distinct entries from the archive's own index, flips one byte in each itself, requires the named corruptionKind; clean control runs the FULL C0-1 chain`,
    'the verifier chooses corruption targets from the real archive index (not the probe), mutates bytes itself, and requires the clean-copy control to pass every C0-1 assertion, not just exit 0',
    async () => {
      if (!probeRestoreExists) {
        record('C0-3', '', '', false, '', { detail: `missing: ${probeRestoreRel}` });
        return;
      }
      if (!c01Facts || !c01Facts.entryOffsets || !c01SourceDir || !c01RestoreDir) {
        record('C0-3', '', '', false, '', { detail: 'C0-1 did not produce entryOffsets/archivePath facts to corrupt (either C0-1 failed or the probe does not expose them yet)' });
        return;
      }
      const facts = c01Facts;
      const entryOffsets = facts.entryOffsets!;
      const targets: Array<{ kind: string; entry: { file: string; offset: number; length: number } }> = [
        { kind: 'db-page', entry: entryOffsets.dbPage },
        { kind: 'project-file', entry: entryOffsets.projectFile },
        { kind: 'manifest-entry', entry: entryOffsets.manifestEntry },
      ];
      const distinctEntries = new Set(targets.map((t) => t.entry.file));
      const perTarget: { kind: string; ok: boolean; exit: number; corruptionKind?: string | undefined }[] = [];
      for (const { kind, entry } of targets) {
        const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `od-w0-corrupt-${kind}-`));
        try {
          const corruptedArchive = path.join(workDir, path.basename(facts.archivePath));
          fs.cpSync(facts.archivePath, corruptedArchive, { recursive: true });
          const targetFile = path.join(corruptedArchive, entry.file);
          const buf = fs.readFileSync(targetFile);
          const before = buf[entry.offset];
          buf[entry.offset] = (buf[entry.offset] ?? 0) ^ 0xff;
          const after = buf[entry.offset];
          fs.writeFileSync(targetFile, buf);
          const restoreTarget = path.join(workDir, 'restored');
          const run = runRestoreProbe(['--mode=restore-only', '--archive', corruptedArchive, '--target-dir', restoreTarget, '--json'], 3 * 60_000);
          const parsed2 = parseLastJsonLine(run.stdout);
          const corruptionKind = parsed2.ok && isRecord(parsed2.value) && typeof parsed2.value.corruptionKind === 'string' ? parsed2.value.corruptionKind : undefined;
          const hasErrorField = parsed2.ok && isRecord(parsed2.value) && typeof parsed2.value.error === 'string';
          perTarget.push({ kind, ok: run.status !== 0 && before !== after && (corruptionKind !== undefined || hasErrorField), exit: run.status, corruptionKind });
        } finally {
          fs.rmSync(workDir, { recursive: true, force: true });
        }
      }
      // Clean control: restore from the ORIGINAL archive into a FRESH
      // source/restore pair and require the FULL C0-1 chain to pass, not
      // just a zero exit code (round-2 F3).
      const controlSourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-c03-control-source-'));
      const controlRestoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w0-c03-control-restore-'));
      let controlChainOk = false;
      let controlEvidence = '';
      try {
        fs.cpSync(c01SourceDir, controlSourceDir, { recursive: true, force: true });
        const controlRun = runRestoreProbe(['--mode=restore-only', '--archive', facts.archivePath, '--target-dir', controlRestoreDir, '--json'], 3 * 60_000);
        const controlParsed = parseLastJsonLine(controlRun.stdout);
        if (controlRun.status === 0 && controlParsed.ok && isRecord(controlParsed.value)) {
          const controlFacts = { ...facts, restoredDbPath: String(controlParsed.value.restoredDbPath ?? facts.restoredDbPath) };
          const chain = await verifyRestoreChain(controlSourceDir, controlRestoreDir, controlFacts);
          controlChainOk = chain.ok;
          controlEvidence = chain.evidence;
        } else {
          controlEvidence = `control restore-only failed: exit=${controlRun.status} stdout=${controlRun.stdout.slice(-1000)}`;
        }
      } finally {
        fs.rmSync(controlSourceDir, { recursive: true, force: true });
        fs.rmSync(controlRestoreDir, { recursive: true, force: true });
      }

      const ok = perTarget.every((t) => t.ok) && distinctEntries.size === 3 && controlChainOk;
      record(
        'C0-3',
        '',
        '',
        ok,
        JSON.stringify({ perTarget, distinctEntries: [...distinctEntries], controlChainOk, controlEvidence }, null, 2),
        { detail: ok ? undefined : `failing: ${[...perTarget.filter((t) => !t.ok).map((t) => t.kind), ...(distinctEntries.size === 3 ? [] : ['distinct-entries']), ...(controlChainOk ? [] : ['clean-restore-full-chain'])].join(', ')}` },
      );
    },
  );

  await checkCriterion(
    'C0-4',
    'read the archive index directly (w0-archive-manifest.json inside the archive produced by C0-1)',
    "archiveContents self-report is non-load-bearing -- the verifier opens the archive's own on-disk manifest itself; required classes must be present with no duplicates, and doc policy must match what was actually archived",
    () => {
      const rel = 'docs/security/backup-secret-inventory.json';
      interface SecretClassEntry { class: string; required: boolean; sensitive: boolean; policy: 'excluded' | 'included-flagged'; note?: string }
      const EXPECTED_SENSITIVE: Record<string, boolean> = {
        'sqlite-database': false, 'projects-dir': false, 'library-assets': false, 'memory-markdown': false, 'app-config': false,
        'mcp-config-tokens': true, 'connector-credentials': true, 'byok-keys': true,
      };
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
      const archiveIndex = c01Facts ? readArchiveIndex(c01Facts.archivePath) : null;
      const problems: string[] = [];
      for (const cls of REQUIRED_ARCHIVE_CLASSES) {
        const row = byClass.get(cls);
        if (!row) {
          problems.push(`class "${cls}": missing from doc`);
          continue;
        }
        if (row.sensitive !== EXPECTED_SENSITIVE[cls]) problems.push(`class "${cls}": expected sensitive=${EXPECTED_SENSITIVE[cls]}, got ${row.sensitive}`);
        if (row.policy !== 'excluded' && row.policy !== 'included-flagged') problems.push(`class "${cls}": invalid policy ${String(row.policy)}`);
        if (MUST_BE_INCLUDED.includes(cls) && row.policy !== 'included-flagged') problems.push(`class "${cls}": required-for-restore data must be included-flagged`);
        if (row.policy === 'excluded' && (!row.note || row.note.trim().length < 10)) problems.push(`class "${cls}": policy=excluded requires a documented-gap note`);
        if (archiveIndex) {
          const observedIncluded = archiveIndex.classes.some((c) => c.class === cls && c.existsOnDisk);
          if (row.policy === 'included-flagged' && !observedIncluded) problems.push(`class "${cls}": doc says included-flagged but the archive's OWN index does not show it present`);
          if (row.policy === 'excluded' && observedIncluded) problems.push(`class "${cls}": doc says excluded but the archive's OWN index shows it present`);
        }
      }
      if (archiveIndex) problems.push(...archiveIndex.problems.filter((p) => !problems.includes(p)));
      if (!archiveIndex) problems.push('C0-1 did not produce a readable archive to cross-check policy against');
      const ok = problems.length === 0;
      record('C0-4', '', '', ok, JSON.stringify({ entries, archiveIndex }, null, 2), { detail: ok ? undefined : problems.join('; ') });
    },
  );

  // =======================================================================
  // C0-5 / C0-6 / C0-7 -- capability tokens + privileged-route boundary.
  // =======================================================================

  await checkCriterion(
    'C0-5',
    'suite needles + JSON-verified red-at-parent worktree + live HTTP against a verifier-booted daemon',
    'red spec verified via the PARENT run\'s own vitest JSON (named assertion FAILED, not a compile/runner error) and HEAD-green, plus a live verifier-issued HTTP probe',
    async () => {
      const rejected = needleReport('(C0-5/reject)', 1);
      const accepted = needleReport('(C0-5/accept)', 1);
      const redFile = fileContainingNeedle('(C0-5/reject)');
      const red = await verifyRedAtParent(redFile ? [redFile] : [], '(C0-5/reject)', 'C0-5');

      let daemon: BootedDaemon | null = null;
      let liveRejectStatus = 0;
      let liveAcceptStatus = 0;
      let liveError: string | undefined;
      try {
        daemon = await bootDaemonForProbing();
        const randomExtId = crypto.randomBytes(16).toString('hex');
        const rejectRes = await fetch(`${daemon.url}/api/library/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${randomExtId}` },
          body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dzAtdmVyaWZpZXI=', filename: 'w0-verifier-reject-probe.txt' }),
        });
        liveRejectStatus = rejectRes.status;
        const pairRes = await fetch(`${daemon.url}/api/library/pair`, { method: 'POST', headers: { Host: '127.0.0.1' } });
        const pairBody = (await pairRes.json()) as { code?: string };
        const confirmExtId = crypto.randomBytes(16).toString('hex');
        const confirmRes = await fetch(`${daemon.url}/api/library/pair/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${confirmExtId}` },
          body: JSON.stringify({ code: pairBody.code, extensionOrigin: `chrome-extension://${confirmExtId}` }),
        });
        const confirmBody = (await confirmRes.json()) as { token?: string };
        const acceptRes = await fetch(`${daemon.url}/api/library/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${confirmExtId}`, Authorization: confirmBody.token ? `Bearer ${confirmBody.token}` : '' },
          body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dzAtdmVyaWZpZXI=', filename: 'w0-verifier-accept-probe.txt' }),
        });
        liveAcceptStatus = acceptRes.status;
      } catch (err) {
        liveError = String(err);
      } finally {
        if (daemon) await daemon.kill();
      }

      const finalOk = rejected.ok && accepted.ok && red.ok && (liveRejectStatus === 401 || liveRejectStatus === 403) && liveAcceptStatus === 200;
      record(
        'C0-5', '', '', finalOk,
        `-- suite reject --\n${rejected.evidence}\n\n-- suite accept --\n${accepted.evidence}\n\n-- red-at-parent (JSON-verified) --\n${red.evidence}\n\n-- live HTTP reject --\nstatus=${liveRejectStatus}\n\n-- live HTTP accept --\nstatus=${liveAcceptStatus}\n\nliveError=${liveError ?? 'none'}`,
        { detail: finalOk ? undefined : `suiteReject=${rejected.ok} suiteAccept=${accepted.ok} redAtParent=${red.ok} liveReject=${liveRejectStatus} liveAccept=${liveAcceptStatus}${liveError ? ` liveError=${liveError}` : ''}` },
      );
    },
  );

  // Round-2 F6: title-matched suite tests alone can NEVER pass C0-6 anymore.
  // Replay is live-tested now (existing pair/confirm/ingest surface).
  // Revocation/rotation are CONDITIONAL: activate only once a plausible
  // endpoint appears in the live route inventory; until then the criterion
  // fails naming exactly which endpoint is missing.
  await checkCriterion(
    'C0-6',
    'live HTTP: replay tested against the real pairing surface; revocation/rotation activate conditionally once their endpoints exist in the live route inventory',
    'suite-title matches are never sufficient on their own; replay is proven live now; revocation/rotation fail with "endpoint missing: <which>" until those routes are registered',
    async () => {
      let daemon: BootedDaemon | null = null;
      let replayOk = false;
      let replayDetail = '';
      let revocationEndpoint: { method: string; path: string } | undefined;
      let rotationEndpoint: { method: string; path: string } | undefined;
      let revocationOk = false;
      let rotationOk = false;
      try {
        daemon = await bootDaemonForProbing();
        // Replay: mint a token for extension A, replay it from extension B's origin -> must be rejected.
        const pairRes = await fetch(`${daemon.url}/api/library/pair`, { method: 'POST', headers: { Host: '127.0.0.1' } });
        const pairBody = (await pairRes.json()) as { code?: string };
        const extA = crypto.randomBytes(16).toString('hex');
        const confirmRes = await fetch(`${daemon.url}/api/library/pair/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${extA}` },
          body: JSON.stringify({ code: pairBody.code, extensionOrigin: `chrome-extension://${extA}` }),
        });
        const confirmBody = (await confirmRes.json()) as { token?: string };
        const extB = crypto.randomBytes(16).toString('hex');
        const replayRes = await fetch(`${daemon.url}/api/library/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${extB}`, Authorization: confirmBody.token ? `Bearer ${confirmBody.token}` : '' },
          body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dzAtdmVyaWZpZXI=', filename: 'w0-verifier-replay-probe.txt' }),
        });
        replayOk = replayRes.status === 401 || replayRes.status === 403;
        replayDetail = `replay status=${replayRes.status}`;

        // Scoped to the library/token surface specifically -- an unscoped
        // /revoke/i match hits unrelated real routes elsewhere in the app
        // (e.g. a GenUI surface's own /revoke endpoint), a false positive
        // caught during smoke testing.
        revocationEndpoint = daemon.routeInventory.find((r) => /library/i.test(r.path) && (/revoke/i.test(r.path) || (r.method === 'DELETE' && /token/i.test(r.path))));
        rotationEndpoint = daemon.routeInventory.find((r) => /library/i.test(r.path) && /rotate/i.test(r.path));
        if (revocationEndpoint) {
          const revokeRes = await fetch(`${daemon.url}${revocationEndpoint.path}`, { method: revocationEndpoint.method, headers: { Authorization: confirmBody.token ? `Bearer ${confirmBody.token}` : '' } });
          const postRevokeRes = await fetch(`${daemon.url}/api/library/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${extA}`, Authorization: confirmBody.token ? `Bearer ${confirmBody.token}` : '' },
            body: JSON.stringify({ dataUrl: 'data:text/plain;base64,dzAtdmVyaWZpZXI=', filename: 'w0-verifier-post-revoke.txt' }),
          });
          revocationOk = revokeRes.status < 300 && (postRevokeRes.status === 401 || postRevokeRes.status === 403);
        }
        if (rotationEndpoint) {
          const rotateRes = await fetch(`${daemon.url}${rotationEndpoint.path}`, { method: rotationEndpoint.method, headers: { Authorization: confirmBody.token ? `Bearer ${confirmBody.token}` : '' } });
          rotationOk = rotateRes.status < 300;
        }
      } finally {
        if (daemon) await daemon.kill();
      }
      const detail = [
        replayOk ? undefined : `replay: ${replayDetail}`,
        revocationEndpoint ? (revocationOk ? undefined : 'revocation endpoint found but behavior check failed') : 'endpoint missing: revocation',
        rotationEndpoint ? (rotationOk ? undefined : 'rotation endpoint found but behavior check failed') : 'endpoint missing: rotation',
      ].filter(Boolean);
      const ok = replayOk && revocationOk && rotationOk;
      record('C0-6', '', '', ok, JSON.stringify({ replayOk, replayDetail, revocationEndpoint, revocationOk, rotationEndpoint, rotationOk }, null, 2), { detail: ok ? undefined : detail.join('; ') });
    },
  );

  await checkCriterion(
    'C0-7',
    'AST-derived requireLocalDaemonRequest baseline (both directions) + live origin-less probe against every privileged-routes.json row',
    'inventory row without a live registered route = fail; guarded live route missing from inventory = fail; every row is live-probed for origin-less rejection',
    async () => {
      const rel = 'apps/daemon/src/security/privileged-routes.json';
      if (!fileExists(rel)) {
        record('C0-7', '', '', false, '', { detail: `missing: ${rel}` });
        return;
      }
      let routes: { method: string; path: string }[] = [];
      try {
        const raw = JSON.parse(readRepoFile(rel));
        if (!Array.isArray(raw)) throw new Error('top-level value must be an array');
        routes = raw as { method: string; path: string }[];
      } catch (err) {
        record('C0-7', '', '', false, '', { detail: `invalid JSON: ${String(err)}` });
        return;
      }
      const validRows = routes.filter((r) => isRecord(r) && typeof r.method === 'string' && typeof r.path === 'string');
      const dedupKeys = new Set(validRows.map((r) => `${r.method} ${r.path}`));
      const baseline = staticRequireLocalDaemonRequestRoutes();
      const baselineKeys = new Set(baseline.map((b) => `${b.method} ${b.path}`));

      let daemon: BootedDaemon | null = null;
      const liveResults: { method: string; path: string; status: number }[] = [];
      let liveError: string | undefined;
      let liveRouteKeys = new Set<string>();
      try {
        daemon = await bootDaemonForProbing();
        liveRouteKeys = new Set(daemon.routeInventory.map((r) => `${r.method} ${r.path}`));
        for (const row of validRows) {
          try {
            const res = await fetch(`${daemon.url}${row.path.replace(/:[a-zA-Z]+/g, 'w0-verifier-probe-id')}`, { method: row.method, headers: { Host: '127.0.0.1' } });
            liveResults.push({ method: row.method, path: row.path, status: res.status });
          } catch (err) {
            liveResults.push({ method: row.method, path: row.path, status: -1 });
            liveError = String(err);
          }
        }
      } finally {
        if (daemon) await daemon.kill();
      }
      const liveRejectedAll = liveResults.length > 0 && liveResults.every((r) => r.status === 401 || r.status === 403);
      // Both directions (F7): inventory rows must be real registered routes;
      // every statically-guarded route must appear in the inventory.
      const inventoryRowsNotLive = validRows.filter((r) => !liveRouteKeys.has(`${r.method} ${r.path}`));
      const guardedRoutesMissingFromInventory = baseline.filter((b) => !dedupKeys.has(`${b.method} ${b.path}`));

      const iteration = needleReport('(C0-7/route)', Math.max(validRows.length, 1));
      const control = needleReport('(C0-7/control)', 1);
      const ok =
        validRows.length >= 1 &&
        validRows.length === routes.length &&
        dedupKeys.size === validRows.length &&
        inventoryRowsNotLive.length === 0 &&
        guardedRoutesMissingFromInventory.length === 0 &&
        iteration.ok &&
        control.ok &&
        liveRejectedAll;
      record(
        'C0-7', '', '', ok,
        `inventory rows: ${routes.length} (valid: ${validRows.length}, unique: ${dedupKeys.size})\n` +
          `AST baseline: ${baseline.length} guarded routes; missing from inventory: ${JSON.stringify(guardedRoutesMissingFromInventory)}\n` +
          `inventory rows without a live route: ${JSON.stringify(inventoryRowsNotLive)}\n` +
          `live origin-less probe: ${JSON.stringify(liveResults, null, 2)}\nliveError=${liveError ?? 'none'}\n\n-- suite per-route --\n${iteration.evidence}\n\n-- suite control --\n${control.evidence}`,
        { detail: ok ? undefined : `rows=${validRows.length} unique=${dedupKeys.size} inventoryRowsNotLive=${inventoryRowsNotLive.length} guardedMissing=${guardedRoutesMissingFromInventory.length} iterationOk=${iteration.ok} controlOk=${control.ok} liveRejectedAll=${liveRejectedAll}` },
      );
    },
  );

  // =======================================================================
  // C0-8 -- threat model: exact fullName match, tagged per-C0-N, PASSED in
  // the current run, each defense cites a distinct test (round-2 F8).
  // =======================================================================
  await checkCriterion('C0-8', 'read docs/security/daemon-threat-model.md; exact-fullName cross-check against the current suite JSON', 'structured caller-class headings; every defense bullet is tagged [C0-N] and cites the EXACT fullName of a PASSED test whose own fullName contains that same C0-N tag; no test cited twice', () => {
    const rel = 'docs/security/daemon-threat-model.md';
    const CALLER_CLASSES = ['web UI', 'od CLI', 'clipper extension', 'external agent', 'malicious local process', 'malicious web page'];
    if (!fileExists(rel)) {
      record('C0-8', '', '', false, '', { detail: `missing: ${rel}` });
      return;
    }
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
      if (!tagMatch || !citationMatch) {
        problems.push(`bullet missing [C0-N] tag or backtick citation: ${bullet.slice(0, 80)}`);
        continue;
      }
      const tag = tagMatch[1] as string;
      const fullName = citationMatch[1] as string;
      const status = allByFullName.get(fullName);
      if (status !== 'passed') {
        problems.push(`bullet [${tag}] cites "${fullName}" which is not a PASSED test in the current run (status=${status ?? 'not found'})`);
        continue;
      }
      if (!fullName.includes(tag)) {
        problems.push(`bullet [${tag}] cites "${fullName}" which does not itself carry the ${tag} tag`);
        continue;
      }
      if (usedFullNames.has(fullName)) {
        problems.push(`test "${fullName}" cited by more than one defense bullet`);
        continue;
      }
      usedFullNames.add(fullName);
    }
    const ok = missingClasses.length === 0 && defenseBullets.length >= 5 && problems.length === 0;
    record('C0-8', '', '', ok, `caller class headings missing: ${missingClasses.join(', ') || 'none'}\ndefense bullets: ${defenseBullets.length}\nproblems: ${problems.join('; ') || 'none'}\n\n${defenseBullets.join('\n')}`, { detail: ok ? undefined : problems.join('; ') || 'see evidence' });
  });

  // =======================================================================
  // C0-9 -- scale baseline: round-2 F9 requires the gate to RE-EXECUTE all
  // five scenarios once at verification time and require the committed
  // baseline numbers to sit within a declared tolerance band of the
  // observed smoke measurement. Raw-sample recomputation (round-1) stays.
  // -----------------------------------------------------------------------
  // IMPLEMENTATION NOTE (documented, not silent): the exact API endpoint
  // backing "DesignsTab fan-out" and "search" is inferred from the live
  // route inventory by name-pattern match, since no PRD text names an exact
  // route. If no matching route is found, that specific scenario is
  // recorded as missing (fails per F9's "missing scenario = fail"), not
  // fabricated.
  // =======================================================================
  await checkCriterion(
    'C0-9',
    'read docs/testing/scale-baseline-2026-07.md + .json; re-execute cold-start/project-list/DesignsTab-fan-out/memory-high-water/search once each against a verifier-booted daemon and require baseline numbers within a declared tolerance band',
    'R8 protocol + a live smoke re-measurement of all 5 named scenarios; missing scenario = fail; raw-sample p50/p95 recomputation stays',
    async () => {
      const mdRel = 'docs/testing/scale-baseline-2026-07.md';
      const jsonRel = 'docs/testing/scale-baseline-2026-07.json';
      if (!fileExists(mdRel) || !fileExists(jsonRel)) {
        record('C0-9', '', '', false, '', { detail: `missing: ${!fileExists(mdRel) ? mdRel : ''} ${!fileExists(jsonRel) ? jsonRel : ''}`.trim() });
        return;
      }
      interface BaselineJson {
        corpus: { path: string; sha256: string };
        machine: { fingerprint: string };
        warmup: { iterations: number };
        scenarios: { name: string; samplesMs: number[]; p50: number; p95: number; toleranceBandPct?: number }[];
        nonRegressionCeiling: number;
        minimumImprovementThreshold: number;
        version: string;
      }
      let baseline: BaselineJson;
      try {
        baseline = JSON.parse(readRepoFile(jsonRel)) as BaselineJson;
      } catch (err) {
        record('C0-9', '', '', false, '', { detail: `invalid JSON: ${String(err)}` });
        return;
      }
      const problems: string[] = [];
      if (!baseline.machine?.fingerprint) problems.push('missing machine.fingerprint');
      if (typeof baseline.nonRegressionCeiling !== 'number') problems.push('missing nonRegressionCeiling');
      if (typeof baseline.minimumImprovementThreshold !== 'number') problems.push('missing minimumImprovementThreshold');
      if (!baseline.version) problems.push('missing version');
      if (!baseline.warmup || typeof baseline.warmup.iterations !== 'number') problems.push('missing warmup.iterations');
      const scenarioByName = new Map((baseline.scenarios ?? []).map((s) => [s.name, s]));
      for (const s of baseline.scenarios ?? []) {
        if (!Array.isArray(s.samplesMs) || s.samplesMs.length < 5) {
          problems.push(`scenario "${s.name}": fewer than 5 raw samples`);
          continue;
        }
        const sorted = [...s.samplesMs].sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
        const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
        if (Math.abs(p50 - s.p50) > 0.01) problems.push(`scenario "${s.name}": stated p50 ${s.p50} != recomputed ${p50}`);
        if (Math.abs(p95 - s.p95) > 0.01) problems.push(`scenario "${s.name}": stated p95 ${s.p95} != recomputed ${p95}`);
      }

      // Live smoke re-measurement.
      const SCENARIOS = ['cold-start', 'project-list', 'designs-tab-fan-out', 'memory-high-water', 'search'];
      const smoke: Record<string, number | null> = {};
      let daemon: BootedDaemon | null = null;
      try {
        const t0 = Date.now();
        daemon = await bootDaemonForProbing();
        smoke['cold-start'] = Date.now() - t0;

        const t1 = Date.now();
        const listRes = await fetch(`${daemon.url}/api/projects`).catch(() => null);
        smoke['project-list'] = listRes ? Date.now() - t1 : null;

        const fanoutRoute = daemon.routeInventory.find((r) => r.method === 'GET' && /projects\/:[a-zA-Z]+\/files/i.test(r.path));
        if (fanoutRoute && listRes) {
          const t2 = Date.now();
          await fetch(`${daemon.url}${fanoutRoute.path.replace(/:[a-zA-Z]+/g, 'w0-verifier-smoke-id')}`).catch(() => null);
          smoke['designs-tab-fan-out'] = Date.now() - t2;
        } else {
          smoke['designs-tab-fan-out'] = null;
        }

        if (daemon.pid) {
          const rssSamples: number[] = [];
          for (let i = 0; i < 10; i++) {
            const r = sh('ps', ['-o', 'rss=', '-p', String(daemon.pid)]);
            const n = Number(r.stdout.trim());
            if (Number.isFinite(n)) rssSamples.push(n);
            await fetch(`${daemon.url}/api/health`).catch(() => null);
          }
          smoke['memory-high-water'] = rssSamples.length ? Math.max(...rssSamples) : null;
        } else {
          smoke['memory-high-water'] = null;
        }

        const searchRoute = daemon.routeInventory.find((r) => /search/i.test(r.path));
        if (searchRoute) {
          const t3 = Date.now();
          const searchInit: RequestInit = { method: searchRoute.method, headers: { 'Content-Type': 'application/json' } };
          if (searchRoute.method === 'POST') searchInit.body = JSON.stringify({ query: 'w0-verifier-smoke' });
          await fetch(`${daemon.url}${searchRoute.path}`, searchInit).catch(() => null);
          smoke['search'] = Date.now() - t3;
        } else {
          smoke['search'] = null;
        }
      } catch (err) {
        problems.push(`live scenario smoke run threw: ${String(err)}`);
      } finally {
        if (daemon) await daemon.kill();
      }

      for (const name of SCENARIOS) {
        const observed = smoke[name];
        const baselineScenario = scenarioByName.get(name);
        if (observed === null || observed === undefined) {
          problems.push(`scenario "${name}": could not be re-executed (missing scenario = fail)`);
          continue;
        }
        if (!baselineScenario) {
          problems.push(`scenario "${name}": no committed baseline entry to compare against`);
          continue;
        }
        const bandPct = baselineScenario.toleranceBandPct ?? 50;
        const lower = baselineScenario.p50 * (1 - bandPct / 100);
        const upper = baselineScenario.p50 * (1 + bandPct / 100);
        if (!(observed >= lower && observed <= upper)) problems.push(`scenario "${name}": observed smoke ${observed}ms outside declared tolerance band [${lower.toFixed(1)}, ${upper.toFixed(1)}] around baseline p50 ${baselineScenario.p50}ms (${bandPct}%)`);
      }

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
        const recomputedCorpusHash = sha256Bytes(manifestLines.sort().join('\n'));
        if (recomputedCorpusHash !== baseline.corpus.sha256) problems.push('corpus fingerprint mismatch');
      } else {
        problems.push(`corpus.path "${baseline.corpus.path}" does not exist`);
      }
      const ok = problems.length === 0;
      record('C0-9', '', '', ok, JSON.stringify({ baseline, smoke }, null, 2), { detail: ok ? undefined : problems.join('; ') });
    },
  );

  // =======================================================================
  // C0-10 / C0-11 -- UI/CLI parity, round-2: capability universe derived
  // independently (SUBCOMMAND_MAP AST + route inventory), execFile argv
  // (never a shell string), OD_DAEMON_URL pinned to the verifier's
  // ephemeral daemon with a nonce-project identity check, deep recursive
  // key comparison; C0-11's fixture is realistic + attributed.
  // =======================================================================

  const capabilityManifestRel = 'scripts/waves/capability-manifest.json';
  interface CapabilityManifestEntry {
    capability: string;
    uiEntryPoint: string;
    cliArgs: string[];
    httpMethod: string;
    httpPath: string;
    outputSchema: string;
    parityApplicable: boolean;
    reason?: string;
  }

  function deepKeyStructure(v: unknown, prefix = ''): string[] {
    if (Array.isArray(v)) return v.length > 0 ? deepKeyStructure(v[0], `${prefix}[]`) : [`${prefix}[]`];
    if (v && typeof v === 'object') {
      return Object.keys(v as object)
        .sort()
        .flatMap((k) => deepKeyStructure((v as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k));
    }
    return [prefix];
  }

  const odBinPath = path.join(repoRoot, 'apps/daemon/bin/od.mjs');

  await checkCriterion(
    'C0-10',
    'derive capability universe (SUBCOMMAND_MAP AST + route inventory); verifier execFiles the real od bin with constructed argv (never a shell string), OD_DAEMON_URL pinned to its own ephemeral daemon, identity confirmed via a nonce project',
    'every derived capability must appear in the manifest; applicable count >= SUBCOMMAND_MAP floor; sample = min(3, applicable) all-if-fewer; deep recursive key-structure comparison; randomized red control must fail for a genuine shape mismatch',
    async () => {
      if (!fileExists(capabilityManifestRel)) {
        record('C0-10', '', '', false, '', { detail: `missing: ${capabilityManifestRel}` });
        return;
      }
      let manifest: CapabilityManifestEntry[] = [];
      try {
        const raw = JSON.parse(readRepoFile(capabilityManifestRel));
        if (!Array.isArray(raw)) throw new Error('top-level value must be an array');
        manifest = raw as CapabilityManifestEntry[];
      } catch (err) {
        record('C0-10', '', '', false, '', { detail: `invalid manifest JSON: ${String(err)}` });
        return;
      }
      const subcommandKeys = extractSubcommandMapKeys();
      const manifestCapabilityNames = manifest.map((e) => e.capability.toLowerCase());
      const missingSubcommands = subcommandKeys.filter((k) => !manifestCapabilityNames.some((c) => c.includes(k.toLowerCase())));
      const notApplicableWithoutReason = manifest.filter((e) => !e.parityApplicable && !e.reason?.trim());
      const applicable = manifest.filter((e) => e.parityApplicable);

      const problems: string[] = [
        ...notApplicableWithoutReason.map((e) => `capability "${e.capability}": parityApplicable=false without a reason`),
        ...missingSubcommands.map((k) => `SUBCOMMAND_MAP key "${k}" has no corresponding manifest entry`),
      ];
      if (applicable.length < subcommandKeys.length) problems.push(`applicable capability count (${applicable.length}) is below the SUBCOMMAND_MAP floor (${subcommandKeys.length})`);
      if (applicable.length === 0) problems.push('manifest has zero applicable capabilities (all-inapplicable manifests fail)');

      const sampleResults: { capability: string; ok: boolean; detail: string }[] = [];
      let redControlOk = false;
      let redControlDetail = '';
      let identityOk = false;
      let daemon: BootedDaemon | null = null;
      try {
        daemon = await bootDaemonForProbing();
        const liveRouteKeys = new Set(daemon.routeInventory.map((r) => `${r.method} ${r.path}`));
        for (const e of applicable) {
          if (!liveRouteKeys.has(`${e.httpMethod} ${e.httpPath}`)) problems.push(`capability "${e.capability}": ${e.httpMethod} ${e.httpPath} is not a registered route`);
        }

        // Identity canary (F11): create a nonce project on the verifier's
        // OWN ephemeral daemon, then confirm `od project list --json`
        // (invoked with OD_DAEMON_URL pinned to that daemon) reflects it --
        // proves the CLI cannot silently be talking to a different daemon.
        const nonce = `w0-nonce-${crypto.randomBytes(8).toString('hex')}`;
        await fetch(`${daemon.url}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: nonce, name: nonce }) }).catch(() => null);
        try {
          const { stdout } = await execFileAsync('node', [odBinPath, 'project', 'list', '--json'], { env: { ...process.env, OD_DAEMON_URL: daemon.url }, timeout: 30_000 });
          identityOk = stdout.includes(nonce);
        } catch (err) {
          identityOk = false;
          problems.push(`identity canary (od project list --json) failed: ${String(err)}`);
        }
        if (!identityOk) problems.push('identity canary did not observe the nonce project through the CLI -- cannot confirm CLI and HTTP samples hit the same daemon');

        const shuffled = [...applicable].sort(() => Math.random() - 0.5);
        const sample = shuffled.length <= 3 ? shuffled : shuffled.slice(0, 3);
        for (const entry of sample) {
          let cliJson: unknown = null;
          let cliOk = false;
          try {
            const { stdout } = await execFileAsync('node', [odBinPath, ...entry.cliArgs], { env: { ...process.env, OD_DAEMON_URL: daemon.url }, timeout: 60_000 });
            cliJson = JSON.parse(stdout);
            cliOk = true;
          } catch {
            cliOk = false;
          }
          let httpJson: unknown = null;
          let httpOk = false;
          try {
            const res = await fetch(`${daemon.url}${entry.httpPath}`, { method: entry.httpMethod });
            httpJson = await res.json();
            httpOk = res.ok;
          } catch {
            httpOk = false;
          }
          const cliShape = cliOk ? deepKeyStructure(cliJson) : [];
          const httpShape = httpOk ? deepKeyStructure(httpJson) : [];
          const shapeMatches = cliOk && httpOk && JSON.stringify(cliShape) === JSON.stringify(httpShape);
          sampleResults.push({ capability: entry.capability, ok: shapeMatches, detail: `cliOk=${cliOk} httpOk=${httpOk} cliShape=${JSON.stringify(cliShape)} httpShape=${JSON.stringify(httpShape)}` });
        }

        // Red control: randomized capability name, real stub CLI (never a
        // shell string -- an actual JS file execFile'd directly), real
        // unrelated route.
        const stubPath = path.join(proofDir, `.w0-red-control-stub-${crypto.randomBytes(4).toString('hex')}.mjs`);
        fs.writeFileSync(stubPath, "#!/usr/bin/env node\nconsole.log(JSON.stringify({ ok: true }));\n");
        const randomCapabilityName = `w0-red-control-${crypto.randomBytes(6).toString('hex')}`;
        let cliKeys: string[] = [];
        try {
          const { stdout } = await execFileAsync('node', [stubPath], { timeout: 30_000 });
          cliKeys = deepKeyStructure(JSON.parse(stdout));
        } catch {
          /* leave empty */
        }
        const httpRes = await fetch(`${daemon.url}/api/health`);
        const httpKeys = deepKeyStructure(await httpRes.json());
        const shapeMismatch = JSON.stringify(cliKeys) !== JSON.stringify(httpKeys);
        redControlOk = shapeMismatch;
        redControlDetail = `capability=${randomCapabilityName} cliKeys=${JSON.stringify(cliKeys)} httpKeys=${JSON.stringify(httpKeys)} shapeMismatch=${shapeMismatch}`;
        try {
          fs.unlinkSync(stubPath);
        } catch {
          /* best effort */
        }
      } finally {
        if (daemon) await daemon.kill();
      }
      const ok = problems.length === 0 && sampleResults.length > 0 && sampleResults.every((r) => r.ok) && redControlOk && identityOk;
      record(
        'C0-10', '', '', ok,
        `manifest entries: ${manifest.length}, applicable: ${applicable.length}, SUBCOMMAND_MAP keys: ${subcommandKeys.length}\nidentityOk=${identityOk}\nproblems: ${problems.join('; ') || 'none'}\nsample: ${JSON.stringify(sampleResults, null, 2)}\nred control: ${redControlDetail}`,
        { detail: ok ? undefined : `problems=${problems.length} identityOk=${identityOk} sample=${JSON.stringify(sampleResults.map((r) => r.ok))} redControlOk=${redControlOk}` },
      );
    },
  );

  await checkCriterion(
    'C0-11',
    'verifier injects a REALISTIC one-surface fixture (real existing route, no CLI entry) directly into capability-manifest.json, runs pnpm guard, and requires the failure be ATTRIBUTED to this specific fixture in guard output',
    'guard failure must name the injected capability (attributed diagnostic), not just any nonzero exit; reverts and re-runs guard expecting a clean pass',
    () => {
      if (!fileExists(capabilityManifestRel)) {
        record('C0-11', '', '', false, '', { detail: `missing: ${capabilityManifestRel} (nothing for pnpm guard to enforce parity against yet)` });
        return;
      }
      const manifestAbs = path.join(repoRoot, capabilityManifestRel);
      const original = fs.readFileSync(manifestAbs, 'utf8');
      let brokenExit = 1;
      let brokenStdout = '';
      let revertedCleanly = false;
      const randomCapabilityName = `w0-guard-fixture-${crypto.randomBytes(4).toString('hex')}`;
      try {
        const parsed = JSON.parse(original) as CapabilityManifestEntry[];
        const broken: CapabilityManifestEntry = {
          capability: randomCapabilityName,
          uiEntryPoint: 'n/a',
          cliArgs: ['w0-fixture-nonexistent-subcommand'], // real route, deliberately NO corresponding CLI subcommand
          httpMethod: 'GET',
          httpPath: '/api/health', // a REAL, already-registered route
          outputSchema: 'n/a',
          parityApplicable: true,
        };
        fs.writeFileSync(manifestAbs, JSON.stringify([...parsed, broken], null, 2));
        const brokenRun = sh('pnpm', ['guard'], { timeoutMs: 20 * 60_000 });
        brokenExit = brokenRun.status;
        brokenStdout = brokenRun.stdout;
      } finally {
        fs.writeFileSync(manifestAbs, original);
        revertedCleanly = fs.readFileSync(manifestAbs, 'utf8') === original;
      }
      const attributed = brokenStdout.includes(randomCapabilityName);
      const revertedRun = sh('pnpm', ['guard'], { timeoutMs: 20 * 60_000 });
      const revertedExit = revertedRun.status;
      const treeClean = sh('git', ['status', '--porcelain', '--', capabilityManifestRel]).stdout.trim().length === 0;
      const ok = brokenExit !== 0 && attributed && revertedExit === 0 && revertedCleanly && treeClean;
      record('C0-11', '', '', ok, `brokenExit=${brokenExit} attributed=${attributed} revertedExit=${revertedExit} revertedCleanly=${revertedCleanly} treeClean=${treeClean}\nbrokenStdout tail:\n${brokenStdout.slice(-2000)}`, {
        detail: ok ? undefined : `brokenExit=${brokenExit} attributed=${attributed} revertedExit=${revertedExit} revertedCleanly=${revertedCleanly} treeClean=${treeClean}`,
      });
    },
  );

  // =======================================================================
  // C0-12 -- rebrand/stored-data compatibility inventory. Round-2 F14:
  // implement live static counts for as many categories as are genuinely
  // groundable in source today; unknown rows/labels = fail.
  // =======================================================================
  await checkCriterion('C0-12', 'read docs/security/stored-identity-inventory.md; live static counts for all six categories', 'every row requires a numeric count; statically-countable categories must match the verifier\'s own independent count exactly; unknown rows/labels fail', () => {
    const rel = 'docs/security/stored-identity-inventory.md';
    const CATEGORIES = ['.od/', 'OD_', 'MCP server', 'project JSON key', 'connector credential', 'sidecar stamp'];
    if (!fileExists(rel)) {
      record('C0-12', '', '', false, '', { detail: `missing: ${rel}` });
      return;
    }
    const text = readRepoFile(rel);
    const missingCategories = CATEGORIES.filter((c) => !text.toLowerCase().includes(c.toLowerCase()));
    const tableRows = text.split('\n').filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:-]+\|/.test(l));
    const header = tableRows[0] ?? '';
    const hasCountColumn = /count/i.test(header);
    const dataRows = tableRows.slice(1);
    const unknownRows = dataRows.filter((r) => !CATEGORIES.some((c) => r.toLowerCase().includes(c.toLowerCase())));

    function grepCount(pattern: RegExp, dirs: string[]): number {
      const seen = new Set<string>();
      for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        (function walk(d: string): void {
          for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue;
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.(ts|tsx|md|json)$/.test(entry.name)) {
              const t = fs.readFileSync(full, 'utf8');
              for (const m of t.matchAll(pattern)) seen.add(m[0]);
            }
          }
        })(dir);
      }
      return seen.size;
    }
    const srcDirs = [path.join(repoRoot, 'apps/daemon/src')];
    const liveCounts: Record<string, number> = {
      '.od/': grepCount(/\.od\//g, srcDirs),
      OD_: grepCount(/\bOD_[A-Z_]+\b/g, srcDirs),
      'MCP server': grepCount(/\bSERVER_NAME\s*[:=]\s*['"`][\w-]+['"`]/g, srcDirs),
      'project JSON key': grepCount(/\bmetadata\.\w+\b/g, [path.join(repoRoot, 'apps/daemon/src/projects.ts')].filter((p) => fs.existsSync(p))),
      'connector credential': grepCount(/\b(clientId|clientSecret|apiKey|accessToken|refreshToken)\b/g, [path.join(repoRoot, 'apps/daemon/src/connectors')].filter((p) => fs.existsSync(p))),
      'sidecar stamp': grepCount(/\b(app|mode|namespace|ipc|source)\s*:/g, [path.join(repoRoot, 'packages/sidecar-proto/src')].filter((p) => fs.existsSync(p))),
    };

    function docCountFor(category: string): number | null {
      const row = dataRows.find((r) => r.toLowerCase().includes(category.toLowerCase()));
      if (!row) return null;
      const nums = (row.match(/\d+/g) ?? []).map(Number);
      return nums.length > 0 ? (nums[nums.length - 1] ?? null) : null;
    }
    const problems: string[] = [...unknownRows.map((r) => `unrecognized inventory row/label: ${r.slice(0, 80)}`)];
    for (const cat of CATEGORIES) {
      const docCount = docCountFor(cat);
      if (docCount === null) {
        problems.push(`category "${cat}": no numeric count found in doc row`);
        continue;
      }
      const live = liveCounts[cat];
      if (live !== undefined && docCount !== live) problems.push(`"${cat}" count: doc says ${docCount}, live count says ${live}`);
    }
    const ok = missingCategories.length === 0 && hasCountColumn && dataRows.length >= 6 && problems.length === 0;
    record('C0-12', '', '', ok, `categories missing: ${missingCategories.join(', ') || 'none'}\nhasCountColumn: ${hasCountColumn}\ndata rows: ${dataRows.length}\nlive counts: ${JSON.stringify(liveCounts)}\nproblems: ${problems.join('; ') || 'none'}\n\n${tableRows.join('\n')}`, { detail: ok ? undefined : problems.join('; ') || 'see evidence' });
  });

  // =======================================================================
  // C0-13 -- daemon failure inventory. Round-2 F15: unit vs integration are
  // genuinely different suites now (daemon package vs e2e/tests package);
  // e2e (Playwright) is attempted as a bounded, NAMED smoke subset.
  // =======================================================================
  await checkCriterion('C0-13', 'cross-check docs/testing/daemon-failure-inventory.md against the daemon suite (unit) and e2e/tests suite (integration) runs above; attempt a bounded named Playwright e2e smoke subset', 'unit/integration counts must exactly equal their respective observed failure counts from genuinely different suites; e2e is executed if runtime-bounded, else its absence is explicitly recorded (never silent)', () => {
    const rel = 'docs/testing/daemon-failure-inventory.md';
    if (!fileExists(rel)) {
      record('C0-13', '', '', false, '', { detail: `missing: ${rel}` });
      return;
    }
    const text = readRepoFile(rel);
    const hasUnitSection = /unit/i.test(text);
    const hasIntegrationSection = /integration/i.test(text);
    const hasE2eSection = /e2e|end-to-end/i.test(text);
    const actualDaemonFailures = daemonSuite.data?.numFailedTests ?? null;
    const actualIntegrationFailures = integrationSuite.data?.numFailedTests ?? null;
    const unitMatch = text.match(/unit[\s\S]{0,120}?(\d+)\s*failure/i);
    const integrationMatch = text.match(/integration[\s\S]{0,120}?(\d+)\s*failure/i);
    const claimsUnitNone = /unit[\s\S]{0,120}?\bnone\b/i.test(text);
    const claimsIntegrationNone = /integration[\s\S]{0,120}?\bnone\b/i.test(text);
    const unitClaimed = unitMatch?.[1] !== undefined ? Number(unitMatch[1]) : claimsUnitNone ? 0 : null;
    const integrationClaimed = integrationMatch?.[1] !== undefined ? Number(integrationMatch[1]) : claimsIntegrationNone ? 0 : null;
    const unitConsistent = actualDaemonFailures !== null && unitClaimed !== null && unitClaimed === actualDaemonFailures;
    const integrationConsistent = actualIntegrationFailures !== null && integrationClaimed !== null && integrationClaimed === actualIntegrationFailures;

    // Bounded, named Playwright e2e smoke attempt (short timeout); on any
    // failure to run (missing browsers, etc.) the absence is recorded
    // explicitly, never silently skipped.
    const e2eSmokeSpec = 'ui/critical-smoke.test.ts';
    const e2eRun = sh('pnpm', ['--filter', 'e2e', 'exec', 'playwright', 'test', '-c', 'playwright.config.ts', e2eSmokeSpec], { cwd: path.join(repoRoot, 'e2e'), timeoutMs: 5 * 60_000 });
    restoreNextEnvIfChurned();
    const e2eExecuted = e2eRun.status === 0 || /\d+\s+passed/i.test(e2eRun.stdout) || /\d+\s+failed/i.test(e2eRun.stdout);

    const ok = hasUnitSection && hasIntegrationSection && hasE2eSection && unitConsistent && integrationConsistent;
    record(
      'C0-13', '', '', ok,
      `unit section=${hasUnitSection} integration section=${hasIntegrationSection} e2e section=${hasE2eSection}\n` +
        `daemon (unit) failures=${actualDaemonFailures} claimed=${unitClaimed} consistent=${unitConsistent}\n` +
        `e2e/tests (integration) failures=${actualIntegrationFailures} claimed=${integrationClaimed} consistent=${integrationConsistent}\n` +
        `e2e Playwright smoke (${e2eSmokeSpec}) attempted, executed=${e2eExecuted}, exit=${e2eRun.status}:\n${e2eRun.stdout.slice(-2000)}`,
      { detail: ok ? undefined : 'see evidence' },
    );
  });

  // =======================================================================
  // C0-14 -- repo gates.
  // =======================================================================
  await checkCriterion('C0-14', 'pnpm guard && pnpm typecheck (+ suites above) + git-ls-tree-based per-file test COUNT diff + JSON-reporter skip/todo scan', "pnpm guard exit 0; pnpm typecheck exit 0; daemon + web + integration suites green; zero skip/todo/pending in this wave's changed test files; retained test files must not have FEWER tests at HEAD than a static count at baseCommit", () => {
    const guard = sh('pnpm', ['guard'], { timeoutMs: 20 * 60_000 });
    const typecheck = sh('pnpm', ['typecheck'], { timeoutMs: 20 * 60_000 });

    function listTestFiles(ref: string, dir: string): string[] {
      const r = sh('git', ['ls-tree', '-r', '--name-only', ref, '--', dir]);
      if (r.status !== 0) throw new Error(`git ls-tree ${ref} -- ${dir} failed (exit=${r.status}) -- never treated as an empty baseline (F16)`);
      return r.stdout.trim().split('\n').filter((f) => /\.test\.(ts|tsx|js|mjs|cjs)$/.test(f));
    }
    function staticTestCount(ref: string, rel: string): number {
      const r = sh('git', ['show', `${ref}:${rel}`]);
      if (r.status !== 0) return 0;
      return (r.stdout.match(/\b(it|test)\s*\(/g) ?? []).length;
    }
    let baseDaemonTests: string[] = [];
    let lostDaemonTests: string[] = [];
    let shrunkDaemonTests: { file: string; base: number; head: number }[] = [];
    try {
      baseDaemonTests = listTestFiles(baseCommit, 'apps/daemon/tests');
      const headDaemonTests = new Set(listTestFiles(headSha, 'apps/daemon/tests'));
      lostDaemonTests = baseDaemonTests.filter((f) => !headDaemonTests.has(f) && !path.basename(f).startsWith('web-clone-'));
      const retained = baseDaemonTests.filter((f) => headDaemonTests.has(f));
      // Both sides use the SAME static regex-counting method (re-running the
      // full suite at baseCommit to get a real dynamic count is too
      // expensive to pay again here). A static-vs-dynamic comparison was
      // tried first and produced false "shrinkage" on ~30 completely
      // unchanged files (describe.each/test.each and similar expand
      // differently under static counting vs actual execution) -- an
      // apples-to-oranges bug, not a real signal. Static-vs-static is
      // weaker (it won't catch a test body gutted without removing its
      // `it(`/`test(` line) but does not false-positive on files nothing
      // touched, which a per-run gate must not do.
      for (const f of retained) {
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
    // F17: a changed test file absent from the vitest JSON entirely = fail.
    const changedTestFilesNotInSuite: string[] = [];
    const bannedStatuses = new Set(['skipped', 'todo', 'pending']);
    const newBannedHits: string[] = [];
    for (const rel of changedFiles) {
      if (!/\.test\.(ts|tsx|js|mjs|cjs)$/.test(rel)) continue;
      const abs = path.join(repoRoot, rel);
      if (!fs.existsSync(abs)) continue; // deleted in the diff
      const inDaemon = daemonSuite.data?.testResults.some((t) => t.name === abs);
      const inWeb = webSuite.data?.testResults.some((t) => t.name === abs);
      if (!inDaemon && !inWeb) {
        changedTestFilesNotInSuite.push(rel);
        continue;
      }
      const trDaemon = daemonSuite.data?.testResults.find((t) => t.name === abs);
      const trWeb = webSuite.data?.testResults.find((t) => t.name === abs);
      const hits = [...(trDaemon?.assertionResults ?? []), ...(trWeb?.assertionResults ?? [])].filter((a) => bannedStatuses.has(a.status));
      if (hits.length > 0) newBannedHits.push(rel);
    }

    const checks = {
      guardExitZero: guard.status === 0,
      typecheckExitZero: typecheck.status === 0,
      daemonSuiteRanCleanly: daemonSuite.runResult.status === 0 && (daemonSuite.data?.numFailedTests ?? 1) === 0,
      webSuiteRanCleanly: webSuite.runResult.status === 0 && (webSuite.data?.numFailedTests ?? 1) === 0,
      integrationSuiteRanCleanly: integrationSuite.runResult.status === 0 && (integrationSuite.data?.numFailedTests ?? 1) === 0,
      diffCommandOk,
      noNewBannedStatuses: newBannedHits.length === 0,
      noLostDaemonTests: lostDaemonTests.length === 0,
      noShrunkDaemonTestFiles: shrunkDaemonTests.length === 0,
      noChangedTestFileMissingFromSuite: changedTestFilesNotInSuite.length === 0,
    };
    const ok = Object.values(checks).every(Boolean);
    record(
      'C0-14', '', '', ok,
      `guard exit=${guard.status}\ntypecheck exit=${typecheck.status}\n` +
        `daemon suite: exit=${daemonSuite.runResult.status} failed=${daemonSuite.data?.numFailedTests ?? 'unknown'} passed=${daemonSuite.data?.numPassedTests ?? 'unknown'}\n` +
        `web suite: exit=${webSuite.runResult.status} failed=${webSuite.data?.numFailedTests ?? 'unknown'} passed=${webSuite.data?.numPassedTests ?? 'unknown'}\n` +
        `integration suite: exit=${integrationSuite.runResult.status} failed=${integrationSuite.data?.numFailedTests ?? 'unknown'} passed=${integrationSuite.data?.numPassedTests ?? 'unknown'}\n` +
        `diff command ok=${diffCommandOk}\nchanged test files with new skipped/todo/pending: ${newBannedHits.join(', ') || 'none'}\n` +
        `changed test files missing from suite JSON entirely: ${changedTestFilesNotInSuite.join(', ') || 'none'}\n` +
        `lost daemon test files (vs baseCommit, web-clone excluded): ${lostDaemonTests.join(', ') || 'none'}\n` +
        `shrunk daemon test files (static base count > observed head count): ${JSON.stringify(shrunkDaemonTests)}\n` +
        `guard tail:\n${guard.stdout.slice(-4000)}\n\ntypecheck tail:\n${typecheck.stdout.slice(-4000)}`,
      { detail: ok ? undefined : `failing: ${Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(', ')}` },
    );
  });

  // =======================================================================
  // GATE-INTEGRITY -- defense in depth ONLY.
  // =======================================================================
  await checkCriterion('GATE-INTEGRITY', 'sha256(this file) vs an orchestrator-approved hash, if one exists', 'defense-in-depth self-hash check; the PRIMARY control is the external-copy execution model stated in the header comment', () => {
    const selfPath = fileURLToPath(import.meta.url);
    const selfSha256 = sha256File(selfPath);
    const approvedHashPath = path.join(os.homedir(), '.claude', 'goal-state', 'mishmash-w0-substrate', 'approved-gate.sha256');
    if (!fs.existsSync(approvedHashPath)) {
      record('GATE-INTEGRITY', '', '', true, `verify-w0.ts sha256: ${selfSha256}\nno approved-gate.sha256 present -- advisory only until the orchestrator records one`);
      return;
    }
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === selfSha256;
    record('GATE-INTEGRITY', '', '', gateOk, `verify-w0.ts sha256: ${selfSha256}\napproved sha256: ${approved}`, { detail: gateOk ? undefined : 'verify-w0.ts has been modified since the orchestrator approved it' });
  });

  // =======================================================================
  // R9 -- write lease check.
  // =======================================================================
  function globToRegExp(glob: string): RegExp {
    let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    re = re.replace(/\*\*/g, ' GLOBSTAR ');
    re = re.replace(/\*/g, '[^/]*');
    re = re.replace(/ GLOBSTAR /g, '.*');
    return new RegExp(`^${re}$`);
  }
  await checkCriterion('LEASE', `git diff --name-only ${baseCommit}...HEAD subset-of leases.json[W0] read via git show ${baseCommit}:docs/plans/waves/leases.json`, 'no writes outside the W0 lease, where the lease itself is read from baseCommit so the wave cannot widen its own lease', () => {
    const leasesText = readFileAtCommit(baseCommit, 'docs/plans/waves/leases.json');
    const leasesRaw = JSON.parse(leasesText) as { waves: Record<string, { allow: string[]; deny?: string[] }> };
    const w0Lease = leasesRaw.waves.W0;
    const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
    const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
    if (!w0Lease) {
      record('LEASE', '', '', false, '', { detail: 'no "W0" entry in leases.json@baseCommit' });
    } else if (diffResult.status !== 0) {
      record('LEASE', '', '', false, diffResult.stdout, { detail: `git diff exited ${diffResult.status} -- an unevaluable diff is never read as "no violations"` });
    } else if (diffNames.length === 0) {
      record('LEASE', '', '', false, '', { detail: `baseCommit=${baseCommit} headSha=${headSha} differ but git diff reported zero changed files` });
    } else {
      const allowRe = w0Lease.allow.map(globToRegExp);
      const denyRe = (w0Lease.deny ?? []).map(globToRegExp);
      const violations = diffNames.filter((f) => {
        const allowed = allowRe.some((re) => re.test(f));
        const denied = denyRe.some((re) => re.test(f));
        return !allowed || denied;
      });
      record('LEASE', '', '', violations.length === 0, violations.join('\n') || `all ${diffNames.length} changed files inside the lease:\n${diffNames.join('\n')}`);
    }
  });

  // =======================================================================
  // F25 -- re-resolve HEAD at the end; fail on mid-run drift.
  // =======================================================================
  const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  record('HEAD-DRIFT', 'git rev-parse HEAD (re-resolved at end)', 'HEAD must not move during the run', headShaFinal === headSha, `initial=${headSha} final=${headShaFinal}`, {
    detail: headShaFinal === headSha ? undefined : 'HEAD moved during the verifier run -- evidence gathered above may not all belong to the recorded commit',
  });

  // =======================================================================
  // Round-2 F26: git status with ignored-file visibility, plus a hash of
  // .gitignore + .git/info/exclude deltas. A non-empty local exclude file
  // makes the run advisory (same treatment as treeDirty/reuseSuiteCache).
  // =======================================================================
  restoreNextEnvIfChurned(); // final safety net before the tree is judged
  const statusResult = sh('git', ['-c', 'status.showUntrackedFiles=normal', 'status', '--porcelain=v1', '--ignored=matching']);
  const treeDirty = statusResult.status !== 0 || statusResult.stdout.trim().length > 0;
  const localExcludePath = path.join(repoRoot, '.git', 'info', 'exclude');
  const localExcludeContent = fs.existsSync(localExcludePath) ? fs.readFileSync(localExcludePath, 'utf8') : '';
  const localExcludeIsNonTrivial = localExcludeContent.split('\n').some((l) => l.trim() && !l.trim().startsWith('#'));
  const gitignoreHash = fileExists('.gitignore') ? sha256File(path.join(repoRoot, '.gitignore')) : 'absent';
  const localExcludeHash = localExcludeContent ? sha256Bytes(localExcludeContent) : 'absent';

  // F28: final re-verification pass -- re-hash every artifact from disk
  // right before the manifest is finalized.
  for (const r of results) {
    if (!r.artifact || !r.artifactSha256) continue;
    try {
      const currentHash = sha256File(r.artifact);
      if (currentHash !== r.artifactSha256) {
        r.status = 'fail';
        r.detail = `${r.detail ? `${r.detail}; ` : ''}TAMPER DETECTED: artifact hash changed after recording`;
      }
    } catch {
      r.status = 'fail';
      r.detail = `${r.detail ? `${r.detail}; ` : ''}artifact disappeared before final integrity re-check`;
    }
  }

  const manifestPreHash = {
    wave: 'W0',
    commit: headSha,
    treeDirty,
    baseCommit,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    suiteCacheReused: reuseSuiteCache,
    gitExcludeAdvisory: localExcludeIsNonTrivial,
    gitignoreHash,
    localExcludeHash,
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
      console.error(`verify-w0: primary manifest write failed (${String(err)}); wrote fallback to os.tmpdir()`);
    } catch (err2) {
      console.error(`verify-w0: manifest write failed everywhere (${String(err)} / ${String(err2)})`);
    }
  }

  // F28: print + record the manifest's own sha256 as the boundary artifact.
  // This file only PRINTS it; the ORCHESTRATOR is the one that anchors this
  // hash in the out-of-repo program log as the tamper-evidence root.
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
  console.log(`\nverify-w0: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty}, suiteCacheReused=${reuseSuiteCache}, gitExcludeAdvisory=${localExcludeIsNonTrivial})`);
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT section 2)');
  if (reuseSuiteCache) console.log('  ⚠ --reuse-suite-cache was set: this run is advisory, never a wave pass (verifier-author iteration only)');
  if (localExcludeIsNonTrivial) console.log('  ⚠ .git/info/exclude has local content: this run is advisory (F26)');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  process.exit(failures.length === 0 && !treeDirty && !reuseSuiteCache && !localExcludeIsNonTrivial && manifestWritten ? 0 : 1);
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
