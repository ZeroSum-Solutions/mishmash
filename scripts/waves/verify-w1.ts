// verify-w1.ts -- wave W1 (routing & spend truth) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w1.ts [--repo <path>]
//
// This verifier ships BEFORE W1's implementation (VERIFICATION-CONTRACT.md
// S1: "the verifier is the only thing that may declare a criterion passed").
// Running it against the pre-implementation tree is expected to be MOSTLY
// RED -- every criterion must still resolve to a NAMED pass/fail/
// blocked-on-founder, never a crash, never a silent skip.
//
// PORTABILITY: repoRoot comes from `--repo` or process.cwd(), never
// import.meta.url -- this file must keep working if an orchestrator pins an
// approved out-of-repo copy (see GATE-INTEGRITY below). Everything runs
// inside a single async IIFE (not top-level await) so a CJS-transformed
// out-of-repo invocation (no ancestor package.json declaring "type":
// "module") does not hit esbuild's "top-level await is not supported with
// the cjs output format" -- the same fix verify-w7.ts made after verify-w0.ts
// hit it, applied here from round 1 instead of after a failure.
//
// OBSERVE, NEVER TRUST is the standing principle: every criterion below
// either (a) boots a REAL, ISOLATED daemon (temp OD_DATA_DIR, port 0, and
// for the antigravity criteria a temp HOME so `~/.gemini/antigravity-cli/
// settings.json` isolates per-run instead of touching the operator's real
// file) and drives it over real HTTP + the real `od` CLI, or (b) statically
// inspects the repo's own current source via the TypeScript compiler API.
// Never a namespace named "default", never a hardcoded port (7456/51012).
//
// FAKE AGENT BINARIES: three lanes have no usable stand-in in mocks/ for
// what this wave needs to prove, so this file writes its own tiny,
// verifier-owned fake CLI binaries (Node scripts on an isolated PATH
// prefix) rather than reusing mocks/bin's replay corpus for those lanes:
//   - `agy` (Antigravity): mocks/ has zero antigravity wrappers (grep
//     mock-agent.mjs's dispatch switch -- confirmed absent), and the real
//     `agy` binary is proprietary. The fake reads
//     `~/.gemini/antigravity-cli/settings.json` after a deliberate delay
//     (long enough that an unserialized daemon would very likely interleave
//     two concurrent writes) and ECHOES what it read back as both the
//     `--log-file` propagation line (so the daemon's existing log-poll
//     lock-release still fires) and the plain-text stdout reply -- which
//     becomes the persisted assistant message content, a real,
//     product-visible signal, not a verifier side channel.
//   - `claude` (cache-token control): the checked-in `mocks/lib/format-
//     claude.mjs` HARDCODES `input_tokens/cache_creation/cache_read: 0` in
//     every replay (verified by reading it) -- it cannot produce the
//     non-zero, deliberately-additive cache-token usage shape C1-7 needs to
//     prove the daemon isn't double-counting cache tokens. The fake speaks
//     the exact wire shape `claude-stream.ts` already parses (`type:
//     'system'/'assistant'/'result'`, verified against that parser
//     directly), with usage numbers this file chooses and therefore knows
//     the correct answer for.
//   - `kimi` (silent-success repro): the exact defect (`handleKimiEvent`'s
//     `isError` regex only matches the Bash-wrapper's own "Command failed
//     with exit code" text) needs a specific non-Bash failure shape
//     (`role:'tool'` content with no such marker) that isn't guaranteed to
//     exist in the replay corpus. The fake reproduces the documented shape
//     exactly (see json-event-stream.ts's own comment on this).
// These are mocking OUTSIDE the boundary under test (R2): the real daemon,
// real HTTP layer, and real `od` CLI are exercised unmodified; only the
// unreachable-in-CI external agent binary is substituted, same as W0
// substituting a verifier-owned archive for a live cloud backend.
//
// EVASION ANALYSIS lives inline at each sampling/randomized point, per the
// task brief. Every check that cannot be evaluated pre-implementation fails
// NAMED (never throws) -- see checkCriterion()/record() below, which make an
// uncaught throw structurally impossible to surface as anything but a
// recorded "fail".

import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';
import type TypeScriptModule from 'typescript';
import type { Node as TsNode } from 'typescript';

void (async () => {

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

const WAVE_SLUG = 'mishmash-w1-routing-truth';
const goalStateDir = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG);

// Nothing above this guard may throw uncaught: dependency resolution and
// proof-dir creation happen inside it, with a dependency-free emergency
// writer as the last resort (mirrors verify-w0.ts's emergencyExit).
function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W1', commit: 'unknown', treeDirty: true, baseCommit: 'unknown',
      toolchain: { node: process.version, pnpm: 'unknown' },
      criteria: [{ id: 'INIT-FAILURE', command: 'module init', assertion: 'the verifier can initialize before any criterion runs', artifact: null, artifactSha256: null, exitCode: 1, status: 'fail', durationMs: 0, detail: errorMessage }],
    };
    fs.writeFileSync(path.join(os.tmpdir(), 'verify-w1-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
  } catch { /* truly nothing more we can do */ }
  console.error(`verify-w1: FATAL during init: ${errorMessage}`);
  process.exit(1);
}

let repoRoot: string;
let proofDir: string;
let ts: typeof TypeScriptModule;
try {
  repoRoot = path.resolve(argValue('--repo') ?? process.cwd());
  proofDir = path.join(goalStateDir, 'proof');
  fs.mkdirSync(proofDir, { recursive: true });
  ts = createRequire(path.join(repoRoot, 'package.json'))('typescript');
} catch (err) {
  emergencyExit(`init failed: ${String((err as Error)?.stack ?? err)}`);
}

// =============================================================================
// Shared low-level plumbing (sh / sha256 / result recording)
// =============================================================================
function sh(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: opts.cwd ?? repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      timeout: opts.timeoutMs ?? 15 * 60_000,
      env: opts.env ?? process.env,
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

interface CriterionResult {
  id: string; command: string; assertion: string; artifact: string | null; artifactSha256: string | null;
  exitCode: number; status: 'pass' | 'fail' | 'blocked-on-founder'; durationMs: number; detail?: string | undefined;
}
const results: CriterionResult[] = [];

// A criterion with no real, readable, hash-matched artifact can never be
// anything but "fail" (VERIFICATION-CONTRACT.md S2 rule 4) -- artifactFor
// never throws; a total write failure degrades to null, which record()
// below forces to "fail".
function artifactFor(id: string, content: string): { artifact: string | null; artifactSha256: string | null } {
  const primary = path.join(proofDir, `${id}.txt`);
  const tryWrite = (target: string): { artifact: string; artifactSha256: string } | null => {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      return { artifact: target, artifactSha256: sha256Bytes(fs.readFileSync(target)) };
    } catch { return null; }
  };
  const primaryResult = tryWrite(primary);
  if (primaryResult) return primaryResult;
  const fallbackResult = tryWrite(path.join(os.tmpdir(), 'verify-w1-fallback-proof', `${id}.txt`));
  if (fallbackResult) return fallbackResult;
  console.error(`verify-w1: artifact write failed for ${id} on both primary and fallback paths`);
  return { artifact: null, artifactSha256: null };
}

function record(
  id: string,
  command: string,
  assertion: string,
  statusOrOk: 'pass' | 'fail' | 'blocked-on-founder' | boolean,
  evidence: string,
  opts: { detail?: string | undefined; durationMs?: number } = {},
): void {
  const status: 'pass' | 'fail' | 'blocked-on-founder' = typeof statusOrOk === 'boolean' ? (statusOrOk ? 'pass' : 'fail') : statusOrOk;
  try {
    const { artifact, artifactSha256 } = artifactFor(id, `# ${id}\n# assertion: ${assertion}\n# verdict: ${status}\n${opts.detail ? `# detail: ${opts.detail}\n` : ''}\n${evidence}\n`);
    const effectiveStatus: 'pass' | 'fail' | 'blocked-on-founder' = artifact === null ? 'fail' : status;
    results.push({
      id, command, assertion, artifact, artifactSha256,
      exitCode: effectiveStatus === 'fail' ? 1 : 0,
      status: effectiveStatus,
      durationMs: opts.durationMs ?? 0,
      detail: artifact === null ? `${opts.detail ? `${opts.detail}; ` : ''}artifact write failed -- forced fail` : opts.detail,
    });
  } catch (err) {
    results.push({ id, command, assertion, artifact: null, artifactSha256: null, exitCode: 1, status: 'fail', durationMs: opts.durationMs ?? 0, detail: `record() itself failed: ${String(err)}` });
  }
}

// Every criterion runs through this. A thrown exception -- from a missing
// route, a boot timeout, a malformed response -- becomes a recorded named
// "fail", never an uncaught crash. This is what makes "fail NAMED, never
// throw" true even for checks this file cannot fully anticipate today.
async function checkCriterion(id: string, command: string, assertion: string, fn: () => Promise<void> | void): Promise<void> {
  const startedAt = Date.now();
  const before = results.length;
  try {
    await fn();
  } catch (err) {
    record(id, command, assertion, 'fail', String((err as Error)?.stack ?? err), { detail: `criterion check crashed: ${String(err)}`, durationMs: Date.now() - startedAt });
    return;
  }
  // If fn() didn't call record() itself for this id (some do it manually
  // for finer control), synthesize a fail so the id is never silently
  // absent from the manifest.
  const recordedThisId = results.slice(before).some((r) => r.id === id);
  if (!recordedThisId) {
    record(id, command, assertion, 'fail', '', { detail: 'criterion function returned without recording a result', durationMs: Date.now() - startedAt });
  }
}

// =============================================================================
// Git context (LEASE / manifest binding). No local-ref fallback: a landing
// context always has network, so an unreachable origin/main is itself a
// hard fail, never a silent downgrade to a stale local ref (the F15 lesson
// from verify-w7.ts).
// =============================================================================
function resolveRemoteMainShaOrFail(): { ok: true; sha: string } | { ok: false; error: string } {
  const lsRemote = sh('git', ['ls-remote', 'origin', 'main']);
  if (lsRemote.status !== 0) return { ok: false, error: `git ls-remote origin main failed (status=${lsRemote.status}): ${lsRemote.stderr}` };
  const sha = lsRemote.stdout.trim().split('\n')[0]?.split('\t')[0]?.trim();
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) return { ok: false, error: `git ls-remote origin main returned unparseable output: "${lsRemote.stdout}"` };
  const catCheck = sh('git', ['cat-file', '-e', sha]);
  if (catCheck.status !== 0) return { ok: false, error: `remote origin/main (${sha}) is not present locally -- fetch required before verifying` };
  return { ok: true, sha };
}
const headShaResult = sh('git', ['rev-parse', 'HEAD']);
const headSha = headShaResult.status === 0 ? headShaResult.stdout.trim() : '';
const gitIdentityOk = /^[0-9a-f]{40}$/i.test(headSha);
const remoteMain = resolveRemoteMainShaOrFail();
let baseCommit = '';
if (remoteMain.ok && gitIdentityOk) {
  const mb = sh('git', ['merge-base', remoteMain.sha, headSha]);
  if (mb.status === 0 && mb.stdout.trim()) baseCommit = mb.stdout.trim();
}
function readFileAtCommit(commit: string, relPath: string): { ok: true; text: string } | { ok: false; error: string } {
  const r = sh('git', ['show', `${commit}:${relPath}`]);
  if (r.status !== 0) return { ok: false, error: `git show ${commit}:${relPath} failed (exit=${r.status}): ${r.stderr}` };
  return { ok: true, text: r.stdout };
}

// =============================================================================
// AST helpers (TypeScript compiler API over this repo's own current source)
// =============================================================================
function parseTs(absPath: string): { sourceFile: TypeScriptModule.SourceFile; text: string } {
  const text = fs.readFileSync(absPath, 'utf8');
  return { sourceFile: ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true), text };
}
function walkTsFiles(dir: string, opts: { excludeTests?: boolean } = { excludeTests: true }): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  (function walk(d: string): void {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      if (opts.excludeTests && (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx'))) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
    }
  })(dir);
  return out;
}

// Searches every interface/type-literal member-name set under `dir` for one
// that contains ALL of `fieldNames` as property names (order-independent,
// any additional fields allowed). Used for C1-1's contract-type check --
// this is deliberately name-based (not shape/type-based): the wave doc names
// the three fields explicitly (`requested`/`resolved`/`reported`), and a
// contract type is exactly the place VERIFICATION-CONTRACT.md's own example
// manifest snippet expects such fields to live.
function findTypeWithFields(dir: string, fieldNames: string[]): { found: boolean; file?: string; typeName?: string } {
  for (const file of walkTsFiles(dir)) {
    const { sourceFile } = parseTs(file);
    let found: { file: string; typeName: string } | null = null;
    function memberNames(members: TypeScriptModule.NodeArray<TypeScriptModule.TypeElement | TypeScriptModule.ClassElement>): Set<string> {
      const names = new Set<string>();
      for (const m of members) {
        const name = (m as { name?: TsNode }).name;
        if (name && ts.isIdentifier(name)) names.add(name.text);
        else if (name && ts.isStringLiteral(name)) names.add(name.text);
      }
      return names;
    }
    function visit(node: TsNode): void {
      if (found) return;
      if (ts.isInterfaceDeclaration(node)) {
        const names = memberNames(node.members);
        if (fieldNames.every((f) => names.has(f))) { found = { file: path.relative(repoRoot, file), typeName: node.name.text }; return; }
      }
      if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
        const names = memberNames(node.type.members);
        if (fieldNames.every((f) => names.has(f))) { found = { file: path.relative(repoRoot, file), typeName: node.name.text }; return; }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    if (found) return { found: true, file: (found as { file: string }).file, typeName: (found as { typeName: string }).typeName };
  }
  return { found: false };
}

// Extracts every key of `SUBCOMMAND_MAP` in apps/daemon/src/cli.ts (same
// pattern as verify-w0.ts's extractSubcommandMapKeys).
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

// Enumerates `app.<method>(<literal-path>, ...)` registrations in a single
// file -- used to discover what apps/daemon/src/routes/usage*.ts actually
// registers, instead of guessing a route path.
function extractRouteRegistrations(absPath: string): { method: string; routePath: string }[] {
  if (!fs.existsSync(absPath)) return [];
  const { sourceFile } = parseTs(absPath);
  const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
  const out: { method: string; routePath: string }[] = [];
  function visit(node: TsNode): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text.toLowerCase();
      if (HTTP_METHODS.has(methodName) && node.arguments.length >= 1) {
        const pathArg = node.arguments[0];
        if (pathArg && ts.isStringLiteral(pathArg)) out.push({ method: methodName.toUpperCase(), routePath: pathArg.text });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return out;
}

function findUsageRouteFiles(): string[] {
  const routesDir = path.join(repoRoot, 'apps/daemon/src/routes');
  if (!fs.existsSync(routesDir)) return [];
  return fs.readdirSync(routesDir)
    .filter((f) => /^usage.*\.ts$/.test(f) && !f.endsWith('.test.ts'))
    .map((f) => path.join(routesDir, f));
}

// =============================================================================
// Generic recursive JSON search helpers -- used because the exact shape/
// nesting NM-13a's fields (or the display-state field, or a pricing
// partial-total flag) will land in is an implementation choice this
// verifier cannot and should not guess a single fixed path for.
// =============================================================================
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
// Finds the first object anywhere in `root` (DFS) that has ALL of
// `requiredStringKeys` present as non-empty-string-or-null values (a value
// may be null only if `allowNullFor` names it -- e.g. `reported` is legally
// null for a non-echoing lane). Returns that object plus its path, or null.
function findSiblingRecord(
  root: unknown,
  requiredKeys: string[],
  allowNullFor: string[] = [],
  _path: string = '$',
  _seen: Set<unknown> = new Set(),
): { record: Record<string, unknown>; atPath: string } | null {
  if (!isRecord(root) && !Array.isArray(root)) return null;
  if (_seen.has(root)) return null;
  _seen.add(root);
  if (isRecord(root)) {
    const hasAll = requiredKeys.every((k) => {
      if (!(k in root)) return false;
      const v = root[k];
      if (v === null) return allowNullFor.includes(k);
      return typeof v === 'string' && v.length > 0;
    });
    if (hasAll) return { record: root, atPath: _path };
    for (const [k, v] of Object.entries(root)) {
      const hit = findSiblingRecord(v, requiredKeys, allowNullFor, `${_path}.${k}`, _seen);
      if (hit) return hit;
    }
    return null;
  }
  if (Array.isArray(root)) {
    for (let i = 0; i < root.length; i++) {
      const hit = findSiblingRecord(root[i], requiredKeys, allowNullFor, `${_path}[${i}]`, _seen);
      if (hit) return hit;
    }
  }
  return null;
}
// Finds any string-valued field anywhere in `root` whose value exactly
// equals one of `enumValues` -- used to locate a "display state" field of
// unknown name.
function findEnumValueField(root: unknown, enumValues: string[], _seen: Set<unknown> = new Set()): { key: string; value: string } | null {
  if (!isRecord(root) && !Array.isArray(root)) return null;
  if (_seen.has(root)) return null;
  _seen.add(root);
  if (isRecord(root)) {
    for (const [k, v] of Object.entries(root)) {
      if (typeof v === 'string' && enumValues.includes(v)) return { key: k, value: v };
    }
    for (const v of Object.values(root)) {
      const hit = findEnumValueField(v, enumValues, _seen);
      if (hit) return hit;
    }
  } else if (Array.isArray(root)) {
    for (const v of root) {
      const hit = findEnumValueField(v, enumValues, _seen);
      if (hit) return hit;
    }
  }
  return null;
}
function collectStrings(root: unknown, _seen: Set<unknown> = new Set()): string[] {
  const out: string[] = [];
  if (typeof root === 'string') { out.push(root); return out; }
  if (!isRecord(root) && !Array.isArray(root)) return out;
  if (_seen.has(root)) return out;
  _seen.add(root);
  if (isRecord(root)) for (const v of Object.values(root)) out.push(...collectStrings(v, _seen));
  else if (Array.isArray(root)) for (const v of root) out.push(...collectStrings(v, _seen));
  return out;
}
// Finds the first object anywhere in `root` that mentions `runId` as one of
// its OWN values, then reads a numeric field from that SAME object whose key
// matches `numberKeyPattern` (e.g. /cost|price|usd/i). Deliberately anchored
// to the run-id-bearing object rather than any number anywhere in the
// response, so an unrelated numeric field cannot satisfy the check.
function findRunNumberField(root: unknown, runId: string, numberKeyPattern: RegExp, _seen: Set<unknown> = new Set()): number | null {
  if (!isRecord(root) && !Array.isArray(root)) return null;
  if (_seen.has(root)) return null;
  _seen.add(root);
  if (isRecord(root)) {
    const mentionsRun = Object.values(root).some((v) => v === runId);
    if (mentionsRun) {
      for (const [k, v] of Object.entries(root)) {
        if (typeof v === 'number' && Number.isFinite(v) && numberKeyPattern.test(k)) return v;
      }
    }
    for (const v of Object.values(root)) {
      const hit = findRunNumberField(v, runId, numberKeyPattern, _seen);
      if (hit !== null) return hit;
    }
    return null;
  }
  for (const v of root as unknown[]) {
    const hit = findRunNumberField(v, runId, numberKeyPattern, _seen);
    if (hit !== null) return hit;
  }
  return null;
}

// =============================================================================
// Isolated daemon boot. Port 0, temp OD_DATA_DIR always; temp HOME only when
// a criterion needs antigravity settings-file isolation (never the
// operator's real ~/.gemini/antigravity-cli/settings.json). Never namespace
// "default", never port 7456/51012.
// =============================================================================
interface BootedDaemon { url: string; dataDir: string; homeDir: string | null; kill: () => Promise<void> }
async function bootDaemon(opts: { homeDir?: string; extraPathDirs?: string[]; extraEnv?: Record<string, string> } = {}): Promise<BootedDaemon> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w1-verify-data-'));
  const bootScript = `
import { pathToFileURL } from 'node:url';
const mod = await import(pathToFileURL(${JSON.stringify(path.join(repoRoot, 'apps/daemon/src/server.ts'))}).href);
const started = await mod.startServer({ port: 0, returnServer: true });
console.log('OD_W1_VERIFIER_READY ' + JSON.stringify({ url: started.url }));
process.on('SIGTERM', async () => { try { await started.shutdown(); } catch {} process.exit(0); });
`;
  const scriptPath = path.join(proofDir, `.boot-daemon.${process.pid}.${crypto.randomBytes(3).toString('hex')}.mjs`);
  fs.writeFileSync(scriptPath, bootScript);
  const pathPrefix = (opts.extraPathDirs ?? []).join(path.delimiter);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...opts.extraEnv,
    OD_DATA_DIR: dataDir,
    OD_DAEMON_CLI_PATH: path.join(repoRoot, 'apps/daemon/dist/cli.js'),
    ...(opts.homeDir ? { HOME: opts.homeDir } : {}),
    ...(pathPrefix ? { PATH: `${pathPrefix}${path.delimiter}${process.env.PATH ?? ''}` } : {}),
  };
  const child = spawn('pnpm', ['exec', 'tsx', scriptPath], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffered = '';
  let stderrBuf = '';
  child.stderr?.on('data', (c: Buffer) => { stderrBuf += c.toString('utf8'); });
  const ready = await new Promise<{ url: string } | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 45_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const line = buffered.split('\n').find((l) => l.startsWith('OD_W1_VERIFIER_READY '));
      if (line) { clearTimeout(timeout); try { resolve(JSON.parse(line.slice('OD_W1_VERIFIER_READY '.length))); } catch { resolve(null); } }
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
    throw new Error(`daemon failed to boot within 45s (stderr tail: ${stderrBuf.slice(-2000)}; stdout tail: ${buffered.slice(-2000)})`);
  }
  return { url: ready.url, dataDir, homeDir: opts.homeDir ?? null, kill };
}

function odCli(daemonUrl: string, dataDir: string, args: string[], extraEnv: Record<string, string> = {}, timeoutMs = 3 * 60_000): { status: number; stdout: string; stderr: string } {
  const odBinPath = path.join(repoRoot, 'apps/daemon/bin/od.mjs');
  return sh('node', [odBinPath, ...args, '--daemon-url', daemonUrl], {
    env: { ...process.env, ...extraEnv, OD_DATA_DIR: dataDir },
    timeoutMs,
  });
}

async function httpJson(method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ status: number; json: unknown; text: string }> {
  const init: RequestInit = { method };
  if (body !== undefined || extraHeaders) {
    init.headers = { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...extraHeaders };
  }
  if (body !== undefined) init.body = JSON.stringify(body);
  const resp = await fetch(url, init);
  const text = await resp.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: resp.status, json, text };
}

async function createProject(daemonUrl: string, idPrefix: string): Promise<string> {
  const id = `${idPrefix}-${crypto.randomBytes(6).toString('hex')}`;
  const r = await httpJson('POST', `${daemonUrl}/api/projects`, { id, name: id });
  if (r.status < 200 || r.status >= 300) throw new Error(`POST /api/projects failed (${r.status}): ${r.text.slice(0, 500)}`);
  return id;
}

// Analytics capture (server.ts's createFinalizedMessageTelemetryReporter)
// only fires when `readAnalyticsContext(req)` finds the
// `x-od-analytics-device-id` header (packages/contracts/src/analytics/
// public-params.ts) -- without it, `context` is null and the capture call
// returns early before ever reaching PostHog. A real web client always sets
// this; a raw HTTP probe must set it explicitly to exercise the same path.
const ANALYTICS_HEADERS = {
  'x-od-analytics-device-id': 'verifier-device-c1-5',
  'x-od-analytics-session-id': 'verifier-session-c1-5',
  'x-od-analytics-client-type': 'web',
  'x-od-analytics-locale': 'en',
};

async function startRun(daemonUrl: string, body: Record<string, unknown>, extraHeaders?: Record<string, string>): Promise<{ runId: string; conversationId: string; assistantMessageId: string }> {
  const r = await httpJson('POST', `${daemonUrl}/api/runs`, body, extraHeaders);
  if (r.status < 200 || r.status >= 300) throw new Error(`POST /api/runs failed (${r.status}): ${r.text.slice(0, 1000)}`);
  const j = r.json as { runId?: string; conversationId?: string; assistantMessageId?: string };
  if (!j?.runId) throw new Error(`POST /api/runs did not return a runId: ${r.text.slice(0, 500)}`);
  return { runId: j.runId, conversationId: j.conversationId ?? '', assistantMessageId: j.assistantMessageId ?? '' };
}

async function pollRunTerminal(daemonUrl: string, runId: string, timeoutMs = 20_000): Promise<Record<string, unknown>> {
  const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    const r = await httpJson('GET', `${daemonUrl}/api/runs/${encodeURIComponent(runId)}`);
    if (r.status === 200 && isRecord(r.json)) {
      last = r.json;
      if (typeof last.status === 'string' && TERMINAL.has(last.status)) return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`run ${runId} did not reach a terminal status within ${timeoutMs}ms (last seen: ${JSON.stringify(last).slice(0, 500)})`);
}

// sqlite3 CLI read (matches verify-w0.ts's pattern) -- the daemon's own
// on-disk messages table is the ground-truth persisted record, independent
// of whatever the HTTP status endpoint chooses to expose.
function sqliteJson<T = unknown>(dataDir: string, sql: string): T[] {
  const dbPath = path.join(dataDir, 'app.sqlite');
  if (!fs.existsSync(dbPath)) return [];
  const r = sh('sqlite3', ['-json', dbPath, sql]);
  if (r.status !== 0 || !r.stdout.trim()) return [];
  try { return JSON.parse(r.stdout) as T[]; } catch { return []; }
}
interface MessageRow {
  id: string; agent_id: string | null; run_id: string | null; run_status: string | null;
  content: string | null; events_json: string | null; run_context_json: string | null;
}
function readMessageRow(dataDir: string, assistantMessageId: string): MessageRow | null {
  const rows = sqliteJson<MessageRow>(dataDir, `SELECT id, agent_id, run_id, run_status, content, events_json, run_context_json FROM messages WHERE id = '${assistantMessageId.replace(/'/g, "''")}';`);
  return rows[0] ?? null;
}
function readEventsLog(runStatus: Record<string, unknown>): unknown[] {
  const logPath = runStatus.eventsLogPath;
  if (typeof logPath !== 'string' || !fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter((x) => x !== null);
}

// =============================================================================
// Verifier-owned fake agent binaries. Each is a Node script (portable,
// avoids a bash dependency) written to a temp dir prepended to the daemon's
// PATH. Every one handles `--version` (daemon detection calls it) by
// printing a fake version and exiting 0.
// =============================================================================
function mkFakeBinDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'od-w1-fakebin-'));
}
function writeFakeBin(dir: string, name: string, script: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, script);
  fs.chmodSync(p, 0o755);
  return p;
}

// IMPORTANT DESIGN NOTE: a spawned daemon child's process.env is fixed at
// ITS OWN spawn time (see bootDaemon()) -- mutating this verifier's own
// process.env AFTER the daemon has already booted does NOT propagate to the
// already-running daemon, and therefore not to whatever it spawns. Every
// per-run signal these fakes need (usage numbers, kimi failure mode) is
// therefore encoded into the REQUESTED MODEL ID STRING instead, which is a
// genuinely per-request value that flows verbatim through
// apps/daemon/src/server.ts's `sanitizeCustomModel` (confirmed by reading
// apps/web/src/components/agentModelSelection.ts's — no, apps/daemon/src/
// runtimes/models.ts's `sanitizeCustomModel`: it only checks string
// shape/length, never a known-model list, so an unrecognized custom id
// passes through unchanged) all the way to `--model <id>` on the child's
// argv, per run, with no daemon restart required.
const FAKE_CLAUDE_SCRIPT = `#!/usr/bin/env node
// verifier-owned fake claude CLI -- see verify-w1.ts header comment.
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('1.0.0 (fake-claude, verifier-owned)\\n'); process.exit(0); }
process.stdin.resume();
process.stdin.on('data', () => {});
const modelIdx = args.indexOf('--model');
const requestedModel = modelIdx >= 0 ? args[modelIdx + 1] : null;
const m = requestedModel || '';
function num(re, fallback) { const mm = re.exec(m); return mm ? Number(mm[1]) : fallback; }
const usage = {
  input_tokens: num(/input(\\d+)/, 1),
  output_tokens: num(/output(\\d+)/, 1),
  cache_creation_input_tokens: num(/cachecreate(\\d+)/, 0),
  cache_read_input_tokens: num(/cacheread(\\d+)/, 0),
};
const costMatch = /costUSD([\\d.]+)/.exec(m);
const costUsd = costMatch ? Number(costMatch[1]) : 0;
const sessionId = 'fake-session-' + Math.random().toString(16).slice(2);
function line(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }
line({ type: 'system', subtype: 'init', model: requestedModel, session_id: sessionId });
line({ type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'fake claude reply for ' + requestedModel }], stop_reason: 'end_turn' } });
line({ type: 'result', subtype: 'success', usage, total_cost_usd: costUsd, duration_ms: 5, stop_reason: 'end_turn' });
setTimeout(() => process.exit(0), 30);
`;
// Builds a model id that FAKE_CLAUDE_SCRIPT decodes back into a usage/cost
// shape. Keeping the encode/decode pair colocated (this function right next
// to the script string above) so they cannot silently drift apart.
function fakeClaudeUsageModelId(usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number }, costUsd: number): string {
  return `verifier-usage-input${usage.input_tokens}-output${usage.output_tokens}-cacheread${usage.cache_read_input_tokens}-cachecreate${usage.cache_creation_input_tokens}-costUSD${costUsd}`;
}

// Reproduces the EXACT documented silent-success shape from
// json-event-stream.ts's handleKimiEvent comment: a `role:'tool'` failure
// with no "Command failed with exit code" marker (the Write/Edit/etc. tool
// class the comment names as the blind spot), vs a control failure that DOES
// carry the marker (already correctly classified today) and a control
// success with no failing tool call at all. Mode is decoded from the
// requested model id (see the process.env note above FAKE_CLAUDE_SCRIPT --
// the same constraint applies here).
const FAKE_KIMI_SCRIPT = `#!/usr/bin/env node
// verifier-owned fake kimi CLI -- see verify-w1.ts header comment.
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('0.27.0 (fake-kimi, verifier-owned)\\n'); process.exit(0); }
const modelIdx = args.indexOf('--model');
const requestedModel = (modelIdx >= 0 ? args[modelIdx + 1] : '') || '';
const mode = requestedModel.includes('mode-silent-non-bash-failure') ? 'silent-non-bash-failure'
  : requestedModel.includes('mode-marked-bash-failure') ? 'marked-bash-failure'
  : requestedModel.includes('mode-success') ? 'success'
  : 'success';
function line(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }
line({ role: 'assistant', tool_calls: [{ type: 'function', id: 'call_1', function: { name: mode === 'success' ? 'Read' : 'Write', arguments: '{}' } }] });
if (mode === 'silent-non-bash-failure') {
  line({ role: 'tool', tool_call_id: 'call_1', content: "EPERM: operation not permitted, open '/System/protected-verifier-probe.txt'" });
} else if (mode === 'marked-bash-failure') {
  line({ role: 'tool', tool_call_id: 'call_1', content: 'Command failed with exit code: 1.' });
} else {
  line({ role: 'tool', tool_call_id: 'call_1', content: 'ok' });
}
line({ role: 'assistant', content: mode === 'success' ? 'all good' : "I couldn't complete that." });
line({ role: 'meta', type: 'session.resume_hint', session_id: 'fake-kimi-session' });
setTimeout(() => process.exit(0), 30);
`;
function fakeKimiModelId(mode: 'silent-non-bash-failure' | 'marked-bash-failure' | 'success'): string {
  return `verifier-kimi-mode-${mode}`;
}

// Antigravity's daemon-side write-settings -> spawn -> agy-reads-settings
// race is exactly what C1-3/C1-6 probe. This fake is the ONLY place a
// concrete model choice can be independently observed, because `agy` itself
// has no `--model` flag (writeAntigravityModelSelection writes it to
// settings.json instead; verified directly in
// apps/daemon/src/runtimes/defs/antigravity.ts). It deliberately delays
// BEFORE reading settings.json -- long enough that an unserialized daemon
// would very likely let a second concurrent spawn's write land first --
// then echoes exactly what it read, both into `--log-file` (so the
// existing waitForAgyToReadModel poll still resolves) and to stdout (which
// becomes the persisted, product-visible assistant message content).
const FAKE_AGY_SCRIPT = `#!/usr/bin/env node
// verifier-owned fake agy (Antigravity) CLI -- see verify-w1.ts header comment.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('1.0.3 (fake-agy, verifier-owned)\\n'); process.exit(0); }
process.stdin.resume();
process.stdin.on('data', () => {});
const logFileIdx = args.indexOf('--log-file');
const logFile = logFileIdx >= 0 ? args[logFileIdx + 1] : null;
const delayMs = Number(process.env.FAKE_AGY_DELAY_MS || '200');
const settingsPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
setTimeout(() => {
  let observed = '(no settings.json)';
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (parsed && typeof parsed.model === 'string') observed = parsed.model;
  } catch (e) { observed = '(unreadable: ' + String(e && e.message) + ')'; }
  if (logFile) {
    try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); } catch {}
    try { fs.appendFileSync(logFile, 'Propagating selected model override to backend: label="' + observed + '"\\n'); } catch {}
  }
  process.stdout.write('AGY_OBSERVED_MODEL: ' + observed + '\\n');
  process.exit(0);
}, delayMs);
`;

// =============================================================================
// mocks/ recordings -- fetched on demand (gitignored corpus). Used only for
// the codex "no echo" lane (C1-4) and the legitimate claude replay smoke
// path; the cache-token / kimi-failure / antigravity scenarios use the fake
// binaries above because the corpus cannot represent them (see header).
// EVASION ANALYSIS: trace selection is NOT random -- fixed 8-char prefixes
// pinned below, so a re-run is deterministic and cannot "get lucky" by
// drawing an easy trace.
// =============================================================================
const MOCKS_BIN = path.join(repoRoot, 'mocks', 'bin');
function ensureMockRecordings(agent: string): { ok: boolean; error?: string } {
  const dir = path.join(repoRoot, 'mocks', 'recordings');
  const already = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.jsonl'));
  if (already) {
    // Recordings dir is shared across agents once fetched; if this agent's
    // manifest entries aren't yet present, fetch just that subset.
    const manifestPath = path.join(repoRoot, 'mocks', 'manifest.json');
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { entries: { agent: string; trace_id: string }[] };
      const need = manifest.entries.filter((e) => e.agent === agent);
      const have = need.every((e) => fs.existsSync(path.join(dir, `${e.trace_id}.jsonl`)));
      if (have) return { ok: true };
    } catch { /* fall through to fetch */ }
  }
  const r = sh('bash', [path.join(repoRoot, 'mocks/scripts/fetch-recordings.sh'), '--agent', agent], { timeoutMs: 120_000 });
  return r.status === 0 ? { ok: true } : { ok: false, error: `fetch-recordings.sh --agent ${agent} failed (exit=${r.status}): ${r.stdout.slice(-1500)}${r.stderr.slice(-500)}` };
}

// =============================================================================
// Local PostHog-shaped HTTP capture stub for C1-5 -- points POSTHOG_HOST at
// this instead of the real network, so daemon telemetry (posthog-node) POSTs
// its real batched payloads here instead of to us.i.posthog.com. Captures
// every request body verbatim; the daemon's actual analytics.capture() code
// path runs completely unmodified.
// =============================================================================
interface CaptureServer { url: string; bodies: string[]; close: () => Promise<void> }
async function startCaptureServer(): Promise<CaptureServer> {
  const bodies: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      // posthog-node gzip-compresses its batch payload by default
      // (Content-Encoding: gzip) -- decompress before treating it as text,
      // confirmed empirically (an un-decompressed capture produced one
      // binary-garbage "body" instead of parseable JSON).
      const encoding = String(req.headers['content-encoding'] ?? '').toLowerCase();
      let text: string;
      try {
        text = encoding.includes('gzip') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
      } catch {
        text = raw.toString('utf8');
      }
      bodies.push(text);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":1}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    bodies,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// =============================================================================
// Playwright (chromium) resolution -- resolved via createRequire scoped to
// e2e/package.json (the same "resolve a workspace-installed dependency
// without adding a new one" trick verify-w0.ts uses for `typescript`;
// `@playwright/test` is already an e2e devDependency, so this touches no
// package.json). C1-2 (DOM half) and C1-11 share one browser boot.
// =============================================================================
type PlaywrightModule = {
  chromium: { launch: (opts?: { headless?: boolean }) => Promise<PlaywrightBrowser> };
};
type PlaywrightBrowser = {
  newPage: () => Promise<PlaywrightPage>;
  close: () => Promise<void>;
};
type PlaywrightPage = {
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  locator: (selector: string) => PlaywrightLocator;
  waitForTimeout: (ms: number) => Promise<void>;
  evaluate: <T>(fn: (...a: unknown[]) => T, arg?: unknown) => Promise<T>;
};
type PlaywrightLocator = {
  count: () => Promise<number>;
  first: () => PlaywrightLocator;
  innerText: (opts?: { timeout?: number }) => Promise<string>;
  getAttribute: (name: string) => Promise<string | null>;
  waitFor: (opts?: { timeout?: number; state?: string }) => Promise<void>;
};
function resolvePlaywright(): { ok: true; pw: PlaywrightModule } | { ok: false; error: string } {
  try {
    const req = createRequire(path.join(repoRoot, 'e2e', 'package.json'));
    const pw = req('@playwright/test') as PlaywrightModule;
    if (!pw?.chromium?.launch) return { ok: false, error: '@playwright/test resolved but has no chromium.launch export' };
    return { ok: true, pw };
  } catch (err) {
    return { ok: false, error: `could not resolve @playwright/test from e2e/package.json: ${String((err as Error)?.message ?? err)}` };
  }
}

// tools-dev suite boot (real namespaced daemon+web pair) for the browser
// criteria, reusing e2e's own harness rather than hand-rolling one (per the
// house rule that test/lifecycle code must go through this harness).
interface WebSuiteHandle { daemonUrl: string; webUrl: string; dataDir: string; stop: () => Promise<void> }
async function bootWebSuite(extraEnv: Record<string, string> = {}): Promise<WebSuiteHandle> {
  const runtimeMod = (await import(pathToFileURL(path.join(repoRoot, 'e2e/lib/tools-dev/runtime.ts')).href)) as {
    createToolsDevSuite: (spec: { codexHomeDir: string; dataDir: string; namespace: string; root: string; toolsDevRoot: string }) => {
      startWeb: (env?: Record<string, string | undefined>) => Promise<unknown>;
      stopWeb: (env?: Record<string, string | undefined>) => Promise<unknown>;
      url: { daemon: (p?: string) => string; web: (p?: string) => string };
      dataDir: string;
    };
  };
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w1-verify-websuite-'));
  const namespace = `w1-verify-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
  const suite = runtimeMod.createToolsDevSuite({
    codexHomeDir: path.join(scratch, 'codex-home'),
    dataDir: path.join(scratch, 'data'),
    namespace,
    root: scratch,
    toolsDevRoot: path.join(scratch, 'tools-dev'),
  });
  await suite.startWeb(extraEnv);
  const warmup = await fetch(suite.url.web('/'));
  if (!warmup.ok) throw new Error(`web warmup failed: ${warmup.status}`);
  await warmup.arrayBuffer();
  // suite.url.daemon()/.web() always return a trailing-slash URL (appendPath
  // defaults to '/') -- strip it so callers concatenating "${url}/api/..."
  // don't produce a double slash (Express then 404s on "//api/...", a bug
  // this file's own first run caught).
  return {
    daemonUrl: suite.url.daemon().replace(/\/$/, ''),
    webUrl: suite.url.web().replace(/\/$/, ''),
    dataDir: suite.dataDir,
    stop: async () => { try { await suite.stopWeb(); } catch { /* best effort */ } try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ } },
  };
}

// =============================================================================
// main()
// =============================================================================
async function main(): Promise<void> {

// -----------------------------------------------------------------------
// C1-1 -- requested/resolved/reported persisted and populated.
// EVASION ANALYSIS: two runs with two DIFFERENT requested models via the
// fake-claude binary (deterministic, not sampled) -- a stub that hardcodes
// a single constant "requested"/"resolved" value regardless of input passes
// a single-run check but fails this one, because the two runs' persisted
// values must differ and each must equal what THAT run actually requested.
// -----------------------------------------------------------------------
await checkCriterion('C1-1', 'contract type scan (packages/contracts/src/**) + two real HTTP runs via a verifier-owned fake claude binary, ground-truthed against the daemon\'s own sqlite messages table', 'every successful run persists non-null, distinct, request-bound requested/resolved fields; a contract type names all three fields', async () => {
  const typeCheck = findTypeWithFields(path.join(repoRoot, 'packages/contracts/src'), ['requested', 'resolved', 'reported']);
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'claude', FAKE_CLAUDE_SCRIPT);
  const daemon = await bootDaemon({ extraPathDirs: [fakeBinDir] });
  try {
    const projectId = await createProject(daemon.url, 'w1-c1-1');
    const modelA = 'claude-sonnet-4-5-verifier-a';
    const modelB = 'claude-opus-4-8-verifier-b';
    const runA = await startRun(daemon.url, { projectId, agentId: 'claude', model: modelA, message: 'probe A' });
    const statusA = await pollRunTerminal(daemon.url, runA.runId);
    const runB = await startRun(daemon.url, { projectId, agentId: 'claude', model: modelB, message: 'probe B' });
    const statusB = await pollRunTerminal(daemon.url, runB.runId);
    const msgA = readMessageRow(daemon.dataDir, runA.assistantMessageId);
    const msgB = readMessageRow(daemon.dataDir, runB.assistantMessageId);
    function extractRR(status: Record<string, unknown>, msg: MessageRow | null): { requested?: string; resolved?: string } {
      const candidates: unknown[] = [status];
      if (msg?.run_context_json) { try { candidates.push(JSON.parse(msg.run_context_json)); } catch { /* ignore */ } }
      if (msg?.events_json) { try { candidates.push(JSON.parse(msg.events_json)); } catch { /* ignore */ } }
      for (const c of candidates) {
        const hit = findSiblingRecord(c, ['requested', 'resolved'], ['reported']);
        if (hit) return { requested: String(hit.record.requested), resolved: String(hit.record.resolved) };
      }
      return {};
    }
    const rrA = extractRR(statusA, msgA);
    const rrB = extractRR(statusB, msgB);
    const problems: string[] = [];
    if (!typeCheck.found) problems.push('no contract type under packages/contracts/src has requested+resolved+reported as sibling fields');
    if (!rrA.requested || !rrA.resolved) problems.push(`run A: no requested/resolved sibling pair found in status response, run_context_json, or events_json`);
    if (!rrB.requested || !rrB.resolved) problems.push(`run B: no requested/resolved sibling pair found`);
    if (rrA.requested && rrA.requested !== modelA) problems.push(`run A requested=${rrA.requested} but the run actually requested ${modelA}`);
    if (rrB.requested && rrB.requested !== modelB) problems.push(`run B requested=${rrB.requested} but the run actually requested ${modelB}`);
    if (rrA.requested && rrB.requested && rrA.requested === rrB.requested) problems.push('runs A and B report the SAME requested value despite requesting different models -- looks like a hardcoded constant, not a real persisted field');
    const evidence = `contractType=${JSON.stringify(typeCheck)}\nrunA(requested=${modelA})=${JSON.stringify(rrA)}\nrunB(requested=${modelB})=${JSON.stringify(rrB)}\nstatusA=${JSON.stringify(statusA).slice(0, 800)}\nstatusB=${JSON.stringify(statusB).slice(0, 800)}`;
    record('C1-1', 'fake claude x2 + contract AST scan', 'requested/resolved persisted, non-null, request-bound, and a contract type names all three fields', problems.length === 0, evidence, { detail: problems.length ? problems.join('; ') : undefined });
  } finally {
    await daemon.kill();
  }
});

// -----------------------------------------------------------------------
// C1-2 -- substitution visible to a USER, not just to a test.
// Two independent sub-checks, both must hold:
//   (a) the real, unmodified agentModelSelection.ts client-side correction
//       function, called directly, must correct a disabled/unknown model id
//       for a NON-amr agent (today it's hardcoded to `agent.id === 'amr'`).
//   (b) a real conversation, rendered in a real headless browser against a
//       real tools-dev web+daemon pair, must show BOTH the requested and
//       resolved model strings as real DOM text with a non-empty computed
//       accessible name -- not merely present as a `data-*` attribute value.
// EVASION ANALYSIS: (a) is a pure-function call on the actual shipped
// module, not a mock of it -- a lazy fix that special-cases one more agent
// id string (rather than removing the `agent.id !== 'amr'` gate) would still
// pass since the probe uses a THIRD agent id ('codex') never special-cased
// anywhere in this file. (b) strips all `data-testid` attributes from the
// DOM before reading accessible name/text, so a hidden test-only attribute
// carrying the two model strings cannot satisfy the check.
// -----------------------------------------------------------------------
await checkCriterion('C1-2', 'apps/web/src/components/agentModelSelection.ts direct call (non-amr agent, unknown model id) + tools-dev/Playwright real DOM check', 'a disabled/unknown model id is corrected for agents other than amr, and the substitution renders as real, accessible text naming both models', async () => {
  const problems: string[] = [];
  const evidenceParts: string[] = [];

  // (a) pure-function check
  try {
    const mod = (await import(pathToFileURL(path.join(repoRoot, 'apps/web/src/components/agentModelSelection.ts')).href + `?t=${Date.now()}`)) as {
      effectiveAgentModelChoice: (agent: unknown, choice: { model: string } | undefined) => { model?: string } | undefined;
    };
    const agent = { id: 'codex', models: [{ id: 'gpt-5.6-codex-current', enabled: true, default: true }, { id: 'gpt-5.6-codex-legacy', enabled: false, default: false }] };
    const corrected = mod.effectiveAgentModelChoice(agent, { model: 'gpt-5.6-codex-legacy' });
    const wasCorrected = !!corrected && corrected.model === 'gpt-5.6-codex-current';
    if (!wasCorrected) problems.push(`effectiveAgentModelChoice({id:'codex'}, disabled model) did not correct to the default -- got ${JSON.stringify(corrected)} (the amr-only gate is still in place)`);
    evidenceParts.push(`pure-function: agent=codex disabledModel=gpt-5.6-codex-legacy -> ${JSON.stringify(corrected)}`);
  } catch (err) {
    problems.push(`could not import/call agentModelSelection.ts: ${String((err as Error)?.message ?? err)}`);
  }

  // (b) real browser DOM check
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'claude', FAKE_CLAUDE_SCRIPT);
  const pw = resolvePlaywright();
  if (!pw.ok) {
    problems.push(`browser check skipped: ${pw.error}`);
  } else {
    let webSuite: WebSuiteHandle | null = null;
    let browser: PlaywrightBrowser | null = null;
    try {
      webSuite = await bootWebSuite({ PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}` });
      const requestedUnknown = 'claude-totally-unknown-verifier-model-c1-2';
      const projectResp = await httpJson('POST', `${webSuite.daemonUrl}/api/projects`, { id: `w1-c1-2-${crypto.randomBytes(4).toString('hex')}`, name: 'c1-2' });
      const projectId = (projectResp.json as { project?: { id?: string } })?.project?.id;
      if (!projectId) throw new Error(`could not create project via web daemon: ${projectResp.text.slice(0, 300)}`);
      const run = await startRun(webSuite.daemonUrl, { projectId, agentId: 'claude', model: requestedUnknown, message: 'trigger substitution' });
      const runStatus = await pollRunTerminal(webSuite.daemonUrl, run.runId);
      browser = await pw.pw.chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(`${webSuite.webUrl}/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(run.conversationId)}`, { waitUntil: 'load', timeout: 30_000 });
      const messageSelector = `[data-message-id="${run.assistantMessageId}"]`;
      const locator = page.locator(messageSelector);
      let found = false;
      try { await locator.waitFor({ timeout: 15_000 }); found = (await locator.count()) > 0; } catch { found = false; }
      if (!found) {
        problems.push(`no [data-message-id="${run.assistantMessageId}"] node rendered in the conversation view within 15s -- substitution UI surface not present yet`);
      } else {
        // NOTE: this callback runs inside the browser (Playwright serializes
        // it), not in this file's own Node/ES2022-lib type-checking context
        // -- deliberately typed via `any`/`globalThis` rather than
        // Element/HTMLElement/document, which the repo's scripts/
        // tsconfig.json (ES2022 lib only, no "dom") does not know about.
        const requestedResolvedProblems = await page.evaluate((sel: unknown) => {
          const doc = (globalThis as unknown as { document: any }).document;
          const el = doc.querySelector(sel);
          if (!el) return { text: '', accessibleName: '', ariaHiddenAncestor: false, testidStripped: false };
          // Strip every data-testid attribute in the subtree before reading
          // text/accessible-name, so a hidden test-only attribute cannot be
          // the sole carrier of the substitution info.
          el.querySelectorAll('[data-testid]').forEach((n: any) => n.removeAttribute('data-testid'));
          if (el.hasAttribute('data-testid')) el.removeAttribute('data-testid');
          const text = el.innerText || '';
          const accessibleName = (el.getAttribute('aria-label') || text || '').trim();
          let ancestor: any = el;
          let ariaHiddenAncestor = false;
          while (ancestor) { if (ancestor.getAttribute('aria-hidden') === 'true') { ariaHiddenAncestor = true; break; } ancestor = ancestor.parentElement; }
          return { text, accessibleName, ariaHiddenAncestor, testidStripped: true };
        }, messageSelector);
        const rr = requestedResolvedProblems as { text: string; accessibleName: string; ariaHiddenAncestor: boolean; testidStripped: boolean };
        const hasRequested = rr.text.includes(requestedUnknown) || rr.accessibleName.includes(requestedUnknown);
        const hasNonEmptyAccessibleName = rr.accessibleName.trim().length > 0;
        if (!hasRequested) problems.push(`assistant message text/accessible-name does not mention the originally-requested model ("${requestedUnknown}") anywhere -- substitution is not visible`);
        if (!hasNonEmptyAccessibleName) problems.push('message node has an empty computed accessible name (text-only stripped or colour-only badge)');
        if (rr.ariaHiddenAncestor) problems.push('the substitution-bearing node sits inside an aria-hidden="true" ancestor -- invisible to assistive tech');
        evidenceParts.push(`dom probe: ${JSON.stringify(rr)}`);
      }
    } catch (err) {
      problems.push(`browser check failed: ${String((err as Error)?.message ?? err)}`);
    } finally {
      try { await browser?.close(); } catch { /* best effort */ }
      try { await webSuite?.stop(); } catch { /* best effort */ }
    }
  }
  record('C1-2', 'agentModelSelection.ts direct call + real browser DOM', 'non-amr correction + visible, accessible, non-testid-only substitution text', problems.length === 0, evidenceParts.join('\n'), { detail: problems.length ? problems.join('; ') : undefined });
});

// -----------------------------------------------------------------------
// C1-3 -- launch input recorded separately and reconciled against the echo.
// Independent ground truth: the verifier reads settings.json itself
// (post-run) and the fake agy's stdout echo (which becomes the persisted
// message content, a real product artifact) -- neither is something the
// implementation controls, so a "set all three fields before spawn and
// never check what actually ran" implementation is caught here even though
// it might satisfy C1-1's shape check.
// -----------------------------------------------------------------------
await checkCriterion('C1-3', 'single antigravity run via a verifier-owned fake agy + independent settings.json readback', 'the model written to disk before spawn is independently reconcilable against what actually ran, and (once implemented) persisted as launch input on the run', async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w1-agy-home-'));
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'agy', FAKE_AGY_SCRIPT);
  const daemon = await bootDaemon({ homeDir, extraPathDirs: [fakeBinDir], extraEnv: { FAKE_AGY_DELAY_MS: '80' } });
  try {
    const projectId = await createProject(daemon.url, 'w1-c1-3');
    const requestedLabel = 'Claude Sonnet 4.6 (Thinking)';
    const run = await startRun(daemon.url, { projectId, agentId: 'antigravity', model: requestedLabel, message: 'reconcile probe' });
    const status = await pollRunTerminal(daemon.url, run.runId);
    const settingsPath = path.join(homeDir, '.gemini', 'antigravity-cli', 'settings.json');
    const settingsAfter = fs.existsSync(settingsPath) ? (JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { model?: string }).model : undefined;
    const msg = readMessageRow(daemon.dataDir, run.assistantMessageId);
    const echoedFromReply = msg?.content?.startsWith('AGY_OBSERVED_MODEL: ') ? msg.content.slice('AGY_OBSERVED_MODEL: '.length).trim() : null;
    const problems: string[] = [];
    if (settingsAfter !== requestedLabel) problems.push(`settings.json after the run holds "${settingsAfter}", expected the requested label "${requestedLabel}" -- daemon did not write the launch input as expected`);
    if (echoedFromReply !== requestedLabel) problems.push(`persisted assistant reply echoes "${echoedFromReply}", expected agy to have observed "${requestedLabel}" -- ground truth and product output disagree`);
    const launchInputRecord = findSiblingRecord(status, ['resolved'], []) ?? (msg?.run_context_json ? findSiblingRecord(JSON.parse(msg.run_context_json), ['resolved'], []) : null);
    if (!launchInputRecord) problems.push('no persisted field on the run reflects the launch input actually written to disk (requested/resolved shape not found) -- reconciliation is not recorded on the run itself yet');
    record('C1-3', 'fake agy + settings.json readback', 'independently-observed launch input matches what actually ran and is recorded on the run', problems.length === 0, `settingsAfter=${settingsAfter}\nechoedFromReply=${echoedFromReply}\nstatus=${JSON.stringify(status).slice(0, 600)}`, { detail: problems.length ? problems.join('; ') : undefined });
  } finally {
    await daemon.kill();
    try { fs.rmSync(homeDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

// -----------------------------------------------------------------------
// C1-4 -- unverifiable lanes say so, and only they.
// claude (fake, echoes model) must NOT be labelled 'unverified'; codex (real
// mock recording, genuinely no echo -- confirmed by reading
// json-event-stream.ts's codex handler, which never surfaces obj.model) MUST
// be labelled 'unverified'. This is the R4 negative control: if BOTH runs
// came back 'unverified', an unrelated failure (e.g. the display-state field
// simply doesn't exist) would still make the codex half look like a pass on
// its own -- pairing it with a lane that must NOT be 'unverified' closes
// that hole.
// -----------------------------------------------------------------------
// Fixed, hardcoded 8-char trace prefix -- NOT sampled/random -- so this
// check is reproducible across runs and cannot "get lucky" by drawing an
// easy trace. Confirmed present in mocks/manifest.json (agent:"codex",
// outcome:"succeeded") as of this file's authoring pass.
const C1_4_FIXED_CODEX_TRACE = '00e83799';
await checkCriterion('C1-4', 'fake claude (echo) vs a real codex mock recording (no echo), pinned to a fixed trace id via OD_MOCKS_TRACE set at daemon-boot time', 'codex resolves to exactly \'unverified\'; claude (which echoes) never does', async () => {
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'claude', FAKE_CLAUDE_SCRIPT);
  const codexFetch = ensureMockRecordings('codex');
  // OD_MOCKS_TRACE must be set on the DAEMON's own process env at spawn
  // time (mutating this verifier's env afterward would not reach the
  // already-running daemon or its children) -- fine here because this
  // daemon instance only ever drives ONE codex run.
  const daemon = await bootDaemon({ extraPathDirs: [fakeBinDir, MOCKS_BIN], extraEnv: { OD_MOCKS_TRACE: C1_4_FIXED_CODEX_TRACE, OD_MOCKS_NO_DELAY: '1' } });
  try {
    const projectId = await createProject(daemon.url, 'w1-c1-4');
    const claudeRun = await startRun(daemon.url, { projectId, agentId: 'claude', model: 'claude-sonnet-4-5', message: 'echo lane' });
    const claudeStatus = await pollRunTerminal(daemon.url, claudeRun.runId);
    const claudeMsg = readMessageRow(daemon.dataDir, claudeRun.assistantMessageId);
    const claudeState = findEnumValueField(claudeStatus, ['verified', 'substituted', 'unverified']) ?? (claudeMsg?.events_json ? findEnumValueField(JSON.parse(claudeMsg.events_json), ['verified', 'substituted', 'unverified']) : null);

    const problems: string[] = [];
    let codexState: { key: string; value: string } | null = null;
    let codexStatus: Record<string, unknown> = {};
    if (!codexFetch.ok) {
      problems.push(`could not fetch a codex mock recording: ${codexFetch.error}`);
    } else {
      const codexRun = await startRun(daemon.url, { projectId, agentId: 'codex', model: 'gpt-5.6-codex', message: 'no-echo lane', context: {} });
      codexStatus = await pollRunTerminal(daemon.url, codexRun.runId, 30_000);
      const codexMsg = readMessageRow(daemon.dataDir, codexRun.assistantMessageId);
      codexState = findEnumValueField(codexStatus, ['verified', 'substituted', 'unverified']) ?? (codexMsg?.events_json ? findEnumValueField(JSON.parse(codexMsg.events_json), ['verified', 'substituted', 'unverified']) : null);
      if (!codexState) problems.push('no display-state field (verified|substituted|unverified) found anywhere in the codex run\'s status/persisted events');
      else if (codexState.value !== 'unverified') problems.push(`codex (no model echo) resolved to "${codexState.value}", expected "unverified"`);
    }
    if (!claudeState) problems.push('no display-state field found anywhere in the claude run\'s status/persisted events');
    else if (claudeState.value === 'unverified') problems.push('claude (which DOES echo its model) was incorrectly labelled "unverified" -- the label is being applied lane-blind rather than based on real echo availability');

    record('C1-4', 'fake claude + real codex mock recording', 'unverified applied to codex only, never to an echoing lane', problems.length === 0, `claudeState=${JSON.stringify(claudeState)}\ncodexState=${JSON.stringify(codexState)}\ncodexStatus=${JSON.stringify(codexStatus).slice(0, 500)}`, { detail: problems.length ? problems.join('; ') : undefined });
  } finally {
    await daemon.kill();
  }
});

// -----------------------------------------------------------------------
// C1-5 -- telemetry (run.model) records the resolved model, not the raw
// requested one. Ground truth: a local PostHog-shaped HTTP stub captures
// the daemon's REAL analytics.capture() payload (posthog-node, unmodified
// code path) instead of a mock of the analytics layer.
// -----------------------------------------------------------------------
await checkCriterion('C1-5', 'local PostHog-shaped capture stub + a substitution-triggering run (unknown model id, non-amr agent)', 'the model_id stamped on the captured analytics event equals the resolved model, not the raw requested one', async () => {
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'claude', FAKE_CLAUDE_SCRIPT);
  const capture = await startCaptureServer();
  const daemon = await bootDaemon({ extraPathDirs: [fakeBinDir], extraEnv: { POSTHOG_KEY: 'verifier-fake-key', POSTHOG_HOST: capture.url } });
  try {
    const projectId = await createProject(daemon.url, 'w1-c1-5');
    const requestedUnknown = 'claude-verifier-unknown-model-c1-5';
    // ANALYTICS_HEADERS: without x-od-analytics-device-id, readAnalyticsContext
    // returns null and the daemon's capture call short-circuits before ever
    // reaching PostHog -- confirmed empirically.
    const run = await startRun(daemon.url, { projectId, agentId: 'claude', model: requestedUnknown, message: 'telemetry probe' }, ANALYTICS_HEADERS);
    const status = await pollRunTerminal(daemon.url, run.runId);
    // The daemon only calls analytics.capture() for a SUCCEEDED run from
    // `PUT /api/projects/:id/conversations/:cid/messages/:mid` (registered in
    // apps/daemon/src/routes/project/conversations.ts) with
    // `telemetryFinalized: true` in the body -- that PUT is what the real web
    // client issues once it has the finalized assistant message text; a
    // failed/canceled run instead gets a daemon-internal setTimeout fallback
    // (`shouldReportRunCompletionTelemetryFallbackStatus`), but that path
    // does not cover 'succeeded'. Confirmed empirically: without this PUT,
    // zero payloads were captured even with a reachable POSTHOG_HOST and
    // enabled:true telemetry consent. This mirrors exactly what the real web
    // client does after a run finishes, over the real, unmodified route.
    // upsertMessage's UPDATE branch binds `content`/`role` directly with no
    // COALESCE fallback -- omitting them from this PUT body would silently
    // wipe the already-persisted assistant reply, so the current row is read
    // back via sqlite first and echoed through unchanged.
    const preExistingMsg = readMessageRow(daemon.dataDir, run.assistantMessageId);
    await httpJson('PUT', `${daemon.url}/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(run.conversationId)}/messages/${encodeURIComponent(run.assistantMessageId)}`, {
      role: 'assistant',
      content: preExistingMsg?.content ?? '',
      runId: run.runId,
      runStatus: status.status,
      telemetryFinalized: true,
    }, ANALYTICS_HEADERS);
    // Give posthog-node's internal flush a moment; it batches rather than
    // sending synchronously on capture().
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const resolvedGuess = findSiblingRecord(status, ['requested', 'resolved'], ['reported'])?.record.resolved;
    const capturedModelIds = capture.bodies.flatMap((b) => {
      try { return collectStrings(JSON.parse(b)); } catch { return []; }
    });
    const rawRequestedCaptured = capturedModelIds.includes(requestedUnknown);
    const resolvedCaptured = typeof resolvedGuess === 'string' && capturedModelIds.includes(resolvedGuess);
    const problems: string[] = [];
    if (capture.bodies.length === 0) problems.push('no analytics payload was captured at all -- POSTHOG_HOST override did not take effect, or capture() was never called');
    if (rawRequestedCaptured && !resolvedGuess) problems.push(`telemetry captured the raw requested model ("${requestedUnknown}") verbatim and no resolved value exists yet to compare against`);
    if (rawRequestedCaptured && resolvedGuess && resolvedGuess !== requestedUnknown) problems.push(`telemetry captured the RAW REQUESTED model ("${requestedUnknown}"), not the resolved model ("${resolvedGuess}") -- run.model still records pre-resolution input`);
    if (!resolvedGuess) problems.push('no requested/resolved field pair found on the run yet, so resolved-vs-telemetry cannot be cross-checked');
    else if (!resolvedCaptured) problems.push(`resolved model ("${resolvedGuess}") does not appear anywhere in the captured analytics payloads`);
    record('C1-5', 'local PostHog stub', 'analytics model_id equals resolved, not raw requested', problems.length === 0, `capturedBodyCount=${capture.bodies.length}\nresolvedGuess=${String(resolvedGuess)}\nrawRequestedCaptured=${rawRequestedCaptured}\nresolvedCaptured=${resolvedCaptured}\nfirstBody=${capture.bodies[0]?.slice(0, 800) ?? '(none)'}`, { detail: problems.length ? problems.join('; ') : undefined });
  } finally {
    await daemon.kill();
    await capture.close();
  }
});

// -----------------------------------------------------------------------
// C1-6 -- Antigravity concurrency is CONTROLLED, not just labelled.
// EVASION ANALYSIS: the fake agy's read-delay (FAKE_AGY_DELAY_MS) is fixed
// and deliberately long relative to how fast two HTTP requests fire via
// Promise.all -- long enough that an UNSERIALIZED daemon would very likely
// let the second run's settings.json write land inside the first run's
// delay window (a genuine, reproducible race trigger), while a properly
// serialized daemon holds the second write until the first's full
// acquire -> spawn -> log-confirmed-read -> release cycle completes,
// regardless of this delay. Two DIFFERENT concrete models are requested (not
// two of the same) so cross-contamination is observable at all.
// -----------------------------------------------------------------------
await checkCriterion('C1-6', 'two concurrent antigravity runs (different concrete models) via a verifier-owned fake agy with a deliberate pre-read delay', 'no cross-run model contamination; the second spawn either serializes behind the first or hard-fails -- never both racing the same settings.json unserialized', async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w1-agy-race-home-'));
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'agy', FAKE_AGY_SCRIPT);
  const daemon = await bootDaemon({ homeDir, extraPathDirs: [fakeBinDir], extraEnv: { FAKE_AGY_DELAY_MS: '250' } });
  try {
    const projectId = await createProject(daemon.url, 'w1-c1-6');
    const labelA = 'Claude Sonnet 4.6 (Thinking)';
    const labelB = 'Gemini 3.1 Pro (High)';
    const [runA, runB] = await Promise.all([
      startRun(daemon.url, { projectId, agentId: 'antigravity', model: labelA, message: 'race A' }),
      startRun(daemon.url, { projectId, agentId: 'antigravity', model: labelB, message: 'race B' }),
    ]);
    const [statusA, statusB] = await Promise.all([
      pollRunTerminal(daemon.url, runA.runId, 30_000),
      pollRunTerminal(daemon.url, runB.runId, 30_000),
    ]);
    const msgA = readMessageRow(daemon.dataDir, runA.assistantMessageId);
    const msgB = readMessageRow(daemon.dataDir, runB.assistantMessageId);
    const observedA = msgA?.content?.startsWith('AGY_OBSERVED_MODEL: ') ? msgA.content.slice('AGY_OBSERVED_MODEL: '.length).trim() : null;
    const observedB = msgB?.content?.startsWith('AGY_OBSERVED_MODEL: ') ? msgB.content.slice('AGY_OBSERVED_MODEL: '.length).trim() : null;
    // A hard-fail on the second spawn is also an acceptable outcome per the
    // wave doc ("or hard-fail the spawn"); detect it via a non-succeeded
    // terminal status paired with the OTHER run staying clean.
    const bHardFailed = statusB.status === 'failed' && observedA === labelA;
    const aHardFailed = statusA.status === 'failed' && observedB === labelB;
    const noContamination = (observedA === labelA && observedB === labelB) || bHardFailed || aHardFailed;
    const problems: string[] = [];
    if (!noContamination) problems.push(`cross-contamination: requested A=${labelA} B=${labelB}, observed A=${observedA} B=${observedB} -- the settings.json race was not closed`);
    record('C1-6', 'concurrent fake agy x2, deliberate race window', 'no observed cross-contamination between concurrent non-default antigravity spawns', problems.length === 0, `labelA=${labelA} observedA=${observedA} statusA=${statusA.status}\nlabelB=${labelB} observedB=${observedB} statusB=${statusB.status}`, { detail: problems.length ? problems.join('; ') : undefined });
  } finally {
    await daemon.kill();
    try { fs.rmSync(homeDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

// -----------------------------------------------------------------------
// C1-7 -- cost uses resolved-model pricing and survives real cache-token
// shapes. Ground truth for the additive-vs-inclusive discriminator is
// inlined here (mirroring the ALREADY-CORRECT, pre-existing formula in
// apps/daemon/src/run-analytics-observability.ts's resolveEffectiveInputTokens
// -- documented and unchanged by this wave, per AGENTS.md boundary reading;
// this file does not import it, to keep this check independent of whatever
// the implementation reuses).
// EVASION ANALYSIS: two DIFFERENT-sized fake-claude runs (not one recorded
// run replayed twice) so a flat/constant per-run cost cannot pass the
// "differs and is proportionate" check, and the project total must equal
// the exact sum of the two -- catching double-counted aggregation.
// -----------------------------------------------------------------------
function additiveEffectiveInput(input: number, cacheRead: number, cacheCreation: number): number {
  return input + cacheRead + cacheCreation;
}
const usageRouteFilesForC17 = findUsageRouteFiles();
await checkCriterion('C1-7', 'two different-sized fake-claude runs (additive cache-token usage) in one project, read back through apps/daemon/src/routes/usage*.ts', 'per-run cost differs proportionately with token volume, project total is the exact sum, and cache tokens are accounted additively (not double-counted)', async () => {
  if (usageRouteFilesForC17.length === 0) {
    record('C1-7', 'apps/daemon/src/routes/usage*.ts route discovery', 'a usage/cost route exists to read back from', false, '', { detail: 'no apps/daemon/src/routes/usage*.ts file exists yet' });
    return;
  }
  const routes = usageRouteFilesForC17.flatMap((f) => extractRouteRegistrations(f).map((r) => ({ ...r, file: path.relative(repoRoot, f) })));
  const getRoutes = routes.filter((r) => r.method === 'GET');
  if (getRoutes.length === 0) {
    record('C1-7', 'route discovery', 'a GET usage/cost route exists', false, JSON.stringify(routes), { detail: 'usage*.ts registers no GET route' });
    return;
  }
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'claude', FAKE_CLAUDE_SCRIPT);
  const daemon = await bootDaemon({ extraPathDirs: [fakeBinDir] });
  try {
    const projectId = await createProject(daemon.url, 'w1-c1-7');
    // Run 1: small. Usage is encoded into the requested model id itself (see
    // the note above FAKE_CLAUDE_SCRIPT) -- no self-reported total_cost_usd
    // (left at 0), so a pass here can only mean the NEW meter computed cost
    // from normalized token counts, not merely echoed a provider figure.
    const usage1 = { input_tokens: 200, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const run1 = await startRun(daemon.url, { projectId, agentId: 'claude', model: fakeClaudeUsageModelId(usage1, 0), message: 'small run' });
    const status1 = await pollRunTerminal(daemon.url, run1.runId);
    // Run 2: large, WITH additive cache tokens (cache_read > 0, distinct
    // input) -- the exact shape whose naive/inclusive misreading the wave
    // doc calls out.
    const usage2 = { input_tokens: 4000, output_tokens: 800, cache_creation_input_tokens: 300, cache_read_input_tokens: 900 };
    const run2 = await startRun(daemon.url, { projectId, agentId: 'claude', model: fakeClaudeUsageModelId(usage2, 0), message: 'large run with cache' });
    const status2 = await pollRunTerminal(daemon.url, run2.runId);

    const projectRoute = getRoutes.find((r) => r.routePath.includes(':') && /project/i.test(r.routePath)) ?? getRoutes.find((r) => r.routePath.includes(':'));
    const globalRoute = getRoutes.find((r) => !r.routePath.includes(':'));
    function toUrl(routePath: string): string {
      return `${daemon.url}${routePath.replace(/:\w+/, encodeURIComponent(projectId))}`;
    }
    const perRun1 = projectRoute ? await httpJson('GET', toUrl(projectRoute.routePath)) : null;
    const problems: string[] = [];
    if (!perRun1 || perRun1.status !== 200) {
      problems.push(`GET ${projectRoute?.routePath ?? '(no project-scoped route found)'} did not return 200 (status=${perRun1?.status})`);
    } else {
      const body = perRun1.json;
      const strings = collectStrings(body);
      const effective2 = additiveEffectiveInput(usage2.input_tokens, usage2.cache_read_input_tokens, usage2.cache_creation_input_tokens);
      const naiveInclusive2 = usage2.input_tokens; // the WRONG number a mis-implemented inclusive read would use
      const hasEffective = strings.some((s) => s === String(effective2)) || JSON.stringify(body).includes(String(effective2));
      const usesNaiveInsteadOfAdditive = !hasEffective && JSON.stringify(body).includes(String(naiveInclusive2));
      if (!hasEffective) problems.push(`usage response for the cache-additive run does not expose the correctly-computed effective input token count (${effective2} = input ${usage2.input_tokens} + cache_read ${usage2.cache_read_input_tokens} + cache_creation ${usage2.cache_creation_input_tokens})${usesNaiveInsteadOfAdditive ? ' -- found the NAIVE (inclusive-read) number instead, meaning cache tokens are being double-counted or dropped' : ''}`);

      // Per-run cost is looked up by finding an object that mentions this
      // run's own id and reading a cost/price/usd-shaped numeric sibling
      // from THAT SAME object -- not a generic "any number anywhere" scan,
      // which would be too easily satisfied by an unrelated field.
      const cost1 = findRunNumberField(body, run1.runId, /cost|price|usd|spend/i);
      const cost2 = findRunNumberField(body, run2.runId, /cost|price|usd|spend/i);
      if (cost1 === null) problems.push(`no numeric cost/price field found associated with run1's id (${run1.runId}) in the project usage response`);
      if (cost2 === null) problems.push(`no numeric cost/price field found associated with run2's id (${run2.runId})`);
      if (cost1 !== null && cost2 !== null && !(cost2 > cost1)) {
        problems.push(`run2 (far more tokens incl. cache: ${JSON.stringify(usage2)}) costs ${cost2}, not greater than run1's ${cost1} (${JSON.stringify(usage1)}) -- cost is not tracking token volume`);
      }
      if (globalRoute && cost1 !== null && cost2 !== null) {
        const totalResp = await httpJson('GET', toUrl(globalRoute.routePath));
        if (totalResp.status !== 200) {
          problems.push(`GET ${globalRoute.routePath} did not return 200 (status=${totalResp.status})`);
        } else {
          const totalCandidates = collectStrings(totalResp.json).filter((s) => /^\d+(\.\d+)?$/.test(s)).map(Number);
          const expectedSum = cost1 + cost2;
          const matchesSum = totalCandidates.some((t) => Math.abs(t - expectedSum) < 1e-6);
          if (!matchesSum) problems.push(`GET ${globalRoute.routePath} exposes no number matching cost1+cost2 (${expectedSum}) -- project aggregation may be double-counting or dropping a run (evidence: candidates=${JSON.stringify(totalCandidates)})`);
        }
      }
    }
    record('C1-7', `GET ${projectRoute?.routePath ?? '?'} / GET ${globalRoute?.routePath ?? '?'}`, 'per-run cost is id-bound and tracks token volume (run2 > run1); cache-additive tokens are not double-counted or dropped; when a project-total route also exists, it matches the per-run sum', problems.length === 0, `routes=${JSON.stringify(routes)}\nrun1(id=${run1.runId} status=${status1.status} usage=${JSON.stringify(usage1)})\nrun2(id=${run2.runId} status=${status2.status} usage=${JSON.stringify(usage2)})\nperRun1Body=${perRun1 ? JSON.stringify(perRun1.json).slice(0, 1500) : '(n/a)'}`, { detail: problems.length ? problems.join('; ') : undefined });
  } finally {
    await daemon.kill();
  }
});

// -----------------------------------------------------------------------
// C1-8 -- cost meter reaches route + UI + od CLI over the same contract.
// EVASION ANALYSIS: the new SUBCOMMAND_MAP key is discovered structurally
// (diffed against a hardcoded baseline snapshot of the CURRENT map, taken
// from this file's own research pass) rather than guessed by name, so a
// differently-named subcommand still gets tested; the CLI and HTTP outputs
// are compared by SHAPE (top-level key set), not byte-equality, avoiding the
// cliJson-vs-httpBody wrinkle verify-w0.ts's C0-10 hit.
// -----------------------------------------------------------------------
const BASELINE_SUBCOMMAND_KEYS = new Set([
  'artifacts', 'media', 'mcp', 'amr', 'message-center', 'research', 'plugin', 'ui', 'marketplace', 'share',
  'brand', 'brands', 'project', 'automation', 'automations', 'memory', 'run', 'files', 'templates', 'conversation',
  'chat', 'deploy', 'daemon', 'atoms', 'skills', 'design-systems', 'craft', 'diagnostics', 'export', 'status',
  'version', 'whats-new', 'doctor', 'config', 'library', 'figma', 'backup', 'restore',
]);
await checkCriterion('C1-8', 'cli.ts SUBCOMMAND_MAP diff + apps/daemon/src/routes/usage*.ts route discovery + real od CLI invocation vs real HTTP', 'a new CLI subcommand and a new HTTP route expose the same cost-meter data with --json, over the same contract', async () => {
  const currentKeys = new Set(extractSubcommandMapKeys());
  const newKeys = [...currentKeys].filter((k) => !BASELINE_SUBCOMMAND_KEYS.has(k));
  const usageRouteFiles = findUsageRouteFiles();
  const problems: string[] = [];
  if (usageRouteFiles.length === 0) problems.push('no apps/daemon/src/routes/usage*.ts exists yet');
  if (newKeys.length === 0) problems.push('no new SUBCOMMAND_MAP key found in apps/daemon/src/cli.ts beyond the pre-W1 baseline -- no CLI subcommand for the cost meter yet');
  if (problems.length > 0) {
    record('C1-8', 'static discovery', 'both a CLI subcommand and an HTTP route exist for the cost meter', false, `newKeys=${JSON.stringify(newKeys)}\nusageRouteFiles=${JSON.stringify(usageRouteFiles.map((f) => path.relative(repoRoot, f)))}`, { detail: problems.join('; ') });
    return;
  }
  const routes = usageRouteFiles.flatMap((f) => extractRouteRegistrations(f));
  const getRoute = routes.find((r) => r.method === 'GET');
  if (!getRoute) {
    record('C1-8', 'static discovery', 'usage*.ts registers a GET route', false, JSON.stringify(routes), { detail: 'no GET route registered in usage*.ts' });
    return;
  }
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'claude', FAKE_CLAUDE_SCRIPT);
  const daemon = await bootDaemon({ extraPathDirs: [fakeBinDir] });
  try {
    const projectId = await createProject(daemon.url, 'w1-c1-8');
    const run = await startRun(daemon.url, { projectId, agentId: 'claude', model: 'claude-sonnet-4-5', message: 'cost meter probe' });
    await pollRunTerminal(daemon.url, run.runId);
    const httpUrl = `${daemon.url}${getRoute.routePath.replace(/:\w+/, encodeURIComponent(projectId))}`;
    const httpResp = await httpJson('GET', httpUrl);
    const cliKey = newKeys[0]!;
    const cliResp = odCli(daemon.url, daemon.dataDir, [cliKey, '--project', projectId, '--json']);
    let cliJson: unknown = null;
    try { cliJson = JSON.parse(cliResp.stdout.trim().split('\n').filter(Boolean).slice(-1)[0] ?? ''); } catch { cliJson = null; }
    const httpTopKeys = isRecord(httpResp.json) ? Object.keys(httpResp.json).sort() : null;
    const cliTopKeys = isRecord(cliJson) ? Object.keys(cliJson).sort() : null;
    const p2: string[] = [];
    if (httpResp.status !== 200) p2.push(`GET ${getRoute.routePath} did not return 200 (status=${httpResp.status})`);
    if (cliResp.status !== 0) p2.push(`od ${cliKey} --json exited ${cliResp.status}: ${cliResp.stderr.slice(0, 500) || cliResp.stdout.slice(0, 500)}`);
    if (!httpTopKeys) p2.push('HTTP response body is not a JSON object');
    if (!cliTopKeys) p2.push(`od ${cliKey} --json did not print a JSON object as its last stdout line`);
    if (httpTopKeys && cliTopKeys) {
      const overlap = httpTopKeys.filter((k) => cliTopKeys.includes(k));
      if (overlap.length === 0) p2.push(`HTTP body keys [${httpTopKeys.join(',')}] and CLI JSON keys [${cliTopKeys.join(',')}] share NO top-level keys -- not the same contract shape`);
    }
    record('C1-8', `od ${cliKey} --json vs GET ${getRoute.routePath}`, 'CLI and HTTP surfaces expose the same cost-meter contract shape', p2.length === 0, `newKeys=${JSON.stringify(newKeys)}\nhttpTopKeys=${JSON.stringify(httpTopKeys)}\ncliTopKeys=${JSON.stringify(cliTopKeys)}\ncliStdout=${cliResp.stdout.slice(-800)}`, { detail: p2.length ? p2.join('; ') : undefined });
  } finally {
    await daemon.kill();
  }
});

// -----------------------------------------------------------------------
// C1-9 -- unknown pricing is not faked. A run with genuinely NO usage
// signal (a lane emitting nothing pricing could key off) must show
// 'unavailable', not a confident $0.00; a mixed project (one priced run, one
// unpriced run) must flag partiality rather than silently summing to a bare
// confident number.
// -----------------------------------------------------------------------
await checkCriterion('C1-9', 'one priced fake-claude run + one unpriced fake-agy run in the same project, read through usage*.ts', 'unpriced runs render pricing_version=unavailable (never a confident $0.00), and a mixed project total is flagged partial', async () => {
  const usageRouteFiles = findUsageRouteFiles();
  if (usageRouteFiles.length === 0) {
    record('C1-9', 'route discovery', 'a usage/cost route exists', false, '', { detail: 'no apps/daemon/src/routes/usage*.ts file exists yet' });
    return;
  }
  const routes = usageRouteFiles.flatMap((f) => extractRouteRegistrations(f));
  const projectRoute = routes.find((r) => r.method === 'GET' && r.routePath.includes(':'));
  if (!projectRoute) {
    record('C1-9', 'route discovery', 'a project-scoped GET usage route exists', false, JSON.stringify(routes), { detail: 'no project-scoped GET route found in usage*.ts' });
    return;
  }
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w1-c1-9-home-'));
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'claude', FAKE_CLAUDE_SCRIPT);
  writeFakeBin(fakeBinDir, 'agy', FAKE_AGY_SCRIPT);
  const daemon = await bootDaemon({ homeDir, extraPathDirs: [fakeBinDir], extraEnv: { FAKE_AGY_DELAY_MS: '20' } });
  try {
    const projectId = await createProject(daemon.url, 'w1-c1-9');
    const pricedUsage = { input_tokens: 500, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const pricedRun = await startRun(daemon.url, { projectId, agentId: 'claude', model: fakeClaudeUsageModelId(pricedUsage, 0), message: 'priced' });
    await pollRunTerminal(daemon.url, pricedRun.runId);
    // antigravity's plain stream carries no usage/cost signal at all --
    // this is a REAL evidence ceiling (streamFormat:'plain'), not a
    // contrived gap, so pricing for this run should legitimately be
    // unavailable.
    const unpricedRun = await startRun(daemon.url, { projectId, agentId: 'antigravity', model: 'Gemini 3.1 Pro (High)', message: 'unpriced' });
    await pollRunTerminal(daemon.url, unpricedRun.runId, 15_000);

    const httpUrl = `${daemon.url}${projectRoute.routePath.replace(/:\w+/, encodeURIComponent(projectId))}`;
    const resp = await httpJson('GET', httpUrl);
    const problems: string[] = [];
    if (resp.status !== 200) {
      problems.push(`GET ${projectRoute.routePath} did not return 200 (status=${resp.status})`);
    } else {
      const bodyText = JSON.stringify(resp.json);
      const claimsUnavailable = bodyText.includes('unavailable');
      if (!claimsUnavailable) problems.push('response never mentions "unavailable" anywhere -- an unpriced run (antigravity, no usage signal) is not being distinguished from a priced one');
      // A bare "$0.00"/0 total with no partial/unavailable marker anywhere
      // alongside it would misrepresent a confident zero -- check that SOME
      // partiality signal co-occurs with a numeric total.
      const hasNumericTotal = /"total(_usd)?"\s*:\s*[\d.]/i.test(bodyText) || /"cost_usd"\s*:\s*[\d.]/i.test(bodyText);
      const partialityMarkers = ['partial', 'incomplete', 'isPartial', 'unpricedCount', 'unavailableCount', 'complete":false', 'complete\\":false'];
      const hasPartialityMarker = partialityMarkers.some((m) => bodyText.toLowerCase().includes(m.toLowerCase()));
      if (hasNumericTotal && !hasPartialityMarker && !claimsUnavailable) {
        problems.push('response reports a numeric total with no partiality/unavailable marker alongside it -- a mixed known/unknown project must not present a bare confident total');
      }
      record('C1-9', `GET ${projectRoute.routePath}`, 'unpriced runs report unavailable pricing_version; mixed totals are flagged partial, never a bare confident number', problems.length === 0, bodyText.slice(0, 2000), { detail: problems.length ? problems.join('; ') : undefined });
      return;
    }
    record('C1-9', `GET ${projectRoute.routePath}`, 'unpriced runs report unavailable pricing_version; mixed totals are flagged partial', false, resp.text.slice(0, 800), { detail: problems.join('; ') });
  } finally {
    await daemon.kill();
    try { fs.rmSync(homeDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

// -----------------------------------------------------------------------
// C1-10 -- Kimi tool failure CANNOT terminate as success. Property test
// shape (VERIFICATION-CONTRACT R3/R4): a genuine repro (silent-non-bash-
// failure) PLUS a second repro (marked-bash-failure) that this file
// originally assumed was "already correctly classified" by the existing
// isError regex -- an empirical dry run of this exact harness during
// authoring proved that assumption wrong: `isError:true` on a kimi
// tool_result event does not by itself flip the RUN's overall status today
// for either shape (nothing currently wires per-tool isError into run-level
// success/failure classification at all; the existing regex only feeds a
// separate tool-call-loop-guard signal). Both failure shapes are therefore
// genuine repros the fix must close. The one true R4 CONTROL here is
// `posControl` (a clean run with no failing tool call), which must stay
// "succeeded" -- proving the fix doesn't fail every kimi run indiscriminately.
// -----------------------------------------------------------------------
await checkCriterion('C1-10', 'three fake-kimi runs: silent non-Bash failure, a marked Bash failure, and a clean success (the R4 control)', 'any run whose tool call reports a genuine failure (marked or unmarked) ends up "failed", CLI-visible; a run with no failing tool call stays "succeeded"', async () => {
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'kimi', FAKE_KIMI_SCRIPT);
  const daemon = await bootDaemon({ extraPathDirs: [fakeBinDir] });
  try {
    const projectId = await createProject(daemon.url, 'w1-c1-10');
    async function runKimi(mode: 'silent-non-bash-failure' | 'marked-bash-failure' | 'success'): Promise<{ status: string; run: { runId: string; assistantMessageId: string } }> {
      const run = await startRun(daemon.url, { projectId, agentId: 'kimi', model: fakeKimiModelId(mode), message: `mode=${mode}` });
      const status = await pollRunTerminal(daemon.url, run.runId, 15_000);
      return { status: String(status.status), run };
    }
    // Sequential, not concurrent -- each run's mode is self-contained in its
    // own requested model id (see fakeKimiModelId), so there is no cross-run
    // leakage risk even if these ran concurrently, but sequential keeps the
    // evidence trail simpler to read.
    const repro = await runKimi('silent-non-bash-failure');
    const negControl = await runKimi('marked-bash-failure');
    const posControl = await runKimi('success');

    const cliInfoResp = odCli(daemon.url, daemon.dataDir, ['run', 'info', repro.run.runId, '--json']);
    // Direct test of the "CLI exits non-zero" half of the property, via the
    // general-purpose `od run start --follow --json` path (not assumed
    // passing -- recorded as its own evidence line, since no exit-code
    // wiring for run failure exists anywhere in cli.ts today, confirmed by
    // reading runRun()'s `case 'start'`/streamRunEvents, which return
    // unconditionally regardless of final run status).
    const cliFollowResp = odCli(daemon.url, daemon.dataDir, ['run', 'start', '--project', projectId, '--agent', 'kimi', '--model', fakeKimiModelId('silent-non-bash-failure'), '--message', 'cli exit-code probe', '--follow', '--json'], {}, 20_000);

    const problems: string[] = [];
    if (repro.status !== 'failed') problems.push(`silent non-Bash tool failure resolved to status="${repro.status}", expected "failed" -- the silent-success guard is not closing this hole`);
    if (negControl.status !== 'failed') problems.push(`marked-bash-failure (isError:true with the "Command failed with exit code" marker) resolved to status="${negControl.status}", expected "failed" -- a genuinely failing tool call must fail the run regardless of which regex branch classified it`);
    if (posControl.status !== 'succeeded') problems.push(`CONTROL CHECK: the clean-success run (no failing tool call) resolved to "${posControl.status}", expected "succeeded" -- if this fails, the harness itself is broken, not necessarily the product; a real fix must not fail every kimi run indiscriminately`);
    let cliInfoJson: unknown = null;
    try { cliInfoJson = JSON.parse(cliInfoResp.stdout); } catch { cliInfoJson = null; }
    const cliAgreesFailed = isRecord(cliInfoJson) && cliInfoJson.status === 'failed';
    if (cliInfoResp.status !== 0) problems.push(`od run info --json exited ${cliInfoResp.status} unexpectedly`);
    if (!cliAgreesFailed) problems.push(`od run info --json reports status="${isRecord(cliInfoJson) ? String(cliInfoJson.status) : '(unparseable)'}" for the repro run, expected "failed"`);
    if (cliFollowResp.status === 0) problems.push(`od run start --follow --json exited 0 for a run whose tool call silently failed -- the CLI does not surface run failure via its exit code`);
    record('C1-10', 'od run info --json + od run start --follow --json + three fake-kimi runs', 'silent non-Bash failures fail the run (CLI-visible via both run info and a non-zero od run start --follow exit code), Bash-marker failures still fail, clean runs still succeed', problems.length === 0, `repro=${JSON.stringify(repro)}\nnegControl=${JSON.stringify(negControl)}\nposControl=${JSON.stringify(posControl)}\ncliInfoJson=${JSON.stringify(cliInfoJson)}\ncliFollowExit=${cliFollowResp.status}`, { detail: problems.length ? problems.join('; ') : undefined });
  } finally {
    await daemon.kill();
  }
});

// -----------------------------------------------------------------------
// C1-11 -- picker/substitution states are accessible.
// SUBSTITUTION NOTE (flagged to the reviewer, see final report): axe-core is
// not installed anywhere in this workspace (verified: no axe-core package
// under any node_modules, including the pnpm store) and this file's lease
// does not include root package.json, so it cannot be added without a lease
// violation. This check implements a bespoke, narrower set of mechanical
// accessibility assertions using Chromium's own accessibility computation
// (via the same page from C1-2's boot) instead of literally running
// axe-core: non-empty accessible name, no aria-hidden ancestor, and a
// role that is not the ARIA-invalid/generic default. This is real signal,
// not axe-core's full rule set.
// -----------------------------------------------------------------------
await checkCriterion('C1-11', 'bespoke accessibility probe (accessible name, aria-hidden ancestor, role) on the same substituted-message DOM node C1-2 renders -- NOT literally axe-core (unavailable in this workspace without a lease-violating dependency add)', 'the substitution surface has a non-empty accessible name, is not aria-hidden, and does not rely on a generic/none role', async () => {
  const pw = resolvePlaywright();
  if (!pw.ok) {
    record('C1-11', 'Playwright resolution', 'chromium is launchable', false, '', { detail: pw.error });
    return;
  }
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'claude', FAKE_CLAUDE_SCRIPT);
  let webSuite: WebSuiteHandle | null = null;
  let browser: PlaywrightBrowser | null = null;
  try {
    webSuite = await bootWebSuite({ PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}` });
    const projectResp = await httpJson('POST', `${webSuite.daemonUrl}/api/projects`, { id: `w1-c1-11-${crypto.randomBytes(4).toString('hex')}`, name: 'c1-11' });
    const projectId = (projectResp.json as { project?: { id?: string } })?.project?.id;
    if (!projectId) throw new Error(`could not create project: ${projectResp.text.slice(0, 300)}`);
    const run = await startRun(webSuite.daemonUrl, { projectId, agentId: 'claude', model: 'claude-verifier-unknown-model-c1-11', message: 'a11y probe' });
    await pollRunTerminal(webSuite.daemonUrl, run.runId);
    browser = await pw.pw.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${webSuite.webUrl}/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(run.conversationId)}`, { waitUntil: 'load', timeout: 30_000 });
    const selector = `[data-message-id="${run.assistantMessageId}"]`;
    const locator = page.locator(selector);
    let found = false;
    try { await locator.waitFor({ timeout: 15_000 }); found = (await locator.count()) > 0; } catch { found = false; }
    if (!found) {
      record('C1-11', 'bespoke a11y probe', 'substitution surface is accessible', false, '', { detail: `no ${selector} node rendered -- substitution UI surface not present yet` });
      return;
    }
    // See the identical note above C1-2's page.evaluate call: this callback
    // runs in the browser, hence the `any`/`globalThis` typing rather than
    // Element/HTMLElement/document (not in this repo's scripts/tsconfig.json
    // lib set).
    const a11y = await page.evaluate((sel: unknown) => {
      const doc = (globalThis as unknown as { document: any }).document;
      const el = doc.querySelector(sel);
      if (!el) return { accessibleName: '', role: null as string | null, ariaHidden: false };
      const accessibleName = (el.getAttribute('aria-label') || el.innerText || '').trim();
      const role = el.getAttribute('role');
      let ancestor: any = el;
      let ariaHidden = false;
      while (ancestor) { if (ancestor.getAttribute('aria-hidden') === 'true') { ariaHidden = true; break; } ancestor = ancestor.parentElement; }
      return { accessibleName, role, ariaHidden };
    }, selector);
    const a11yTyped = a11y as { accessibleName: string; role: string | null; ariaHidden: boolean };
    const problems: string[] = [];
    if (!a11yTyped.accessibleName) problems.push('substitution node has an empty accessible name');
    if (a11yTyped.ariaHidden) problems.push('substitution node is inside an aria-hidden="true" ancestor');
    if (a11yTyped.role === 'none' || a11yTyped.role === 'presentation') problems.push(`substitution node has role="${a11yTyped.role}", which strips it from the accessibility tree`);
    record('C1-11', 'bespoke a11y probe on the substituted-message node', 'non-empty accessible name, no aria-hidden ancestor, no none/presentation role', problems.length === 0, JSON.stringify(a11yTyped), { detail: problems.length ? problems.join('; ') : undefined });
  } catch (err) {
    record('C1-11', 'bespoke a11y probe', 'substitution surface is accessible', false, '', { detail: `probe failed: ${String((err as Error)?.message ?? err)}` });
  } finally {
    try { await browser?.close(); } catch { /* best effort */ }
    try { await webSuite?.stop(); } catch { /* best effort */ }
  }
});

// -----------------------------------------------------------------------
// C1-12 -- NM-14 (Gemini lane) and NM-37C (deepseek PATH) decisions recorded
// BEFORE implementation, structure-only (mirrors verify-w7.ts's C7-16
// founderOk pattern: this criterion never mechanically "pass"es -- it is
// "fail" while the record is missing/incomplete and "blocked-on-founder"
// once structurally complete, per VERIFICATION-CONTRACT.md S3 R7).
// AMBIGUITY (flagged to the reviewer): the wave doc names no file path or
// required structure for these two decision records, so this file requires
// (a) at least one file under docs/decisions/ whose content mentions both
// "NM-14" and "Gemini", and (b) at least one (possibly the same) file
// mentioning both "NM-37C" and "deepseek", each with a non-empty line
// starting "Decision:" or "## Founder". A different, equally-reasonable
// structure could be chosen by the implementing agent; this file does not
// invent one beyond what R7 requires (declared, not disguised).
// -----------------------------------------------------------------------
await checkCriterion('C1-12', 'structural scan of docs/decisions/*.md for NM-14 (Gemini lane) and NM-37C (deepseek PATH) records', 'both decisions are recorded before implementation with an identifiable decision line; never resolves to a mechanical pass', () => {
  const decisionsDir = path.join(repoRoot, 'docs', 'decisions');
  if (!fs.existsSync(decisionsDir)) {
    record('C1-12', 'ls docs/decisions/', 'docs/decisions/ exists and contains NM-14 + NM-37C records', 'fail', '', { detail: 'docs/decisions/ does not exist' });
    return;
  }
  const files = fs.readdirSync(decisionsDir).filter((f) => f.endsWith('.md'));
  const contents = files.map((f) => ({ f, text: fs.readFileSync(path.join(decisionsDir, f), 'utf8') }));
  function findDecision(idTag: string, topicWord: RegExp): { file: string; hasDecisionLine: boolean } | null {
    for (const c of contents) {
      if (c.text.includes(idTag) && topicWord.test(c.text)) {
        const hasDecisionLine = /^(Decision:|##\s*Founder)/im.test(c.text) && /\S/.test(c.text.replace(/^(Decision:|##\s*Founder)/im, '').split('\n')[0] ?? '');
        return { file: c.f, hasDecisionLine };
      }
    }
    return null;
  }
  const nm14 = findDecision('NM-14', /gemini/i);
  const nm37c = findDecision('NM-37C', /deepseek/i);
  const problems: string[] = [];
  if (!nm14) problems.push('no docs/decisions/*.md file mentions both "NM-14" and "Gemini"');
  else if (!nm14.hasDecisionLine) problems.push(`${nm14.file} mentions NM-14/Gemini but has no non-empty "Decision:"/"## Founder" line`);
  if (!nm37c) problems.push('no docs/decisions/*.md file mentions both "NM-37C" and "deepseek"');
  else if (!nm37c.hasDecisionLine) problems.push(`${nm37c.file} mentions NM-37C/deepseek but has no non-empty "Decision:"/"## Founder" line`);
  const evidence = `files=${JSON.stringify(files)}\nnm14=${JSON.stringify(nm14)}\nnm37c=${JSON.stringify(nm37c)}`;
  if (problems.length > 0) {
    record('C1-12', 'structural scan', 'both decision records exist and are structurally complete', 'fail', evidence, { detail: problems.join('; ') });
  } else {
    // R7: even when structurally complete, this NEVER auto-passes -- it
    // blocks landing, not the autonomous loop, matching C7-16's pattern.
    record('C1-12', 'structural scan', 'both decision records exist and are structurally complete', 'blocked-on-founder', evidence, { detail: 'structurally complete; the founder decision itself is never machine-verified as correct, only as recorded' });
  }
});

// -----------------------------------------------------------------------
// C1-13 -- C2-1a: EntryShell.tsx:228 newsletter default de-branded. Reads
// the LANDED file at HEAD (not a diff of the change) per the task brief.
// -----------------------------------------------------------------------
await checkCriterion('C1-13', 'read apps/web/src/components/EntryShell.tsx at HEAD, locate the NEWSLETTER_SUBSCRIBE_URL declaration', 'the landed default no longer falls back to open-design.ai', () => {
  const entryShellPath = path.join(repoRoot, 'apps/web/src/components/EntryShell.tsx');
  if (!fs.existsSync(entryShellPath)) {
    record('C1-13', 'read EntryShell.tsx', 'NEWSLETTER_SUBSCRIBE_URL does not default to open-design.ai', 'fail', '', { detail: 'apps/web/src/components/EntryShell.tsx does not exist' });
    return;
  }
  const text = fs.readFileSync(entryShellPath, 'utf8');
  const match = /const\s+NEWSLETTER_SUBSCRIBE_URL\s*=\s*([\s\S]*?);/.exec(text);
  if (!match) {
    record('C1-13', 'read EntryShell.tsx', 'NEWSLETTER_SUBSCRIBE_URL declaration is present', 'fail', '', { detail: 'no `const NEWSLETTER_SUBSCRIBE_URL = ...;` declaration found -- file may have been restructured' });
    return;
  }
  const declaration = match[1] ?? '';
  const stillDefaultsToOpenDesign = /open-design\.ai/i.test(declaration);
  record('C1-13', 'regex over the landed NEWSLETTER_SUBSCRIBE_URL declaration', 'declaration text does not contain "open-design.ai"', stillDefaultsToOpenDesign ? 'fail' : 'pass', declaration, { detail: stillDefaultsToOpenDesign ? 'the literal fallback still contains "open-design.ai"' : undefined });
});

// -----------------------------------------------------------------------
// C1-14 -- parity + gates. Real `pnpm guard` / `pnpm typecheck` runs (not
// assumed green), plus a scan of every line ADDED by this branch (not the
// whole file, so pre-existing skips elsewhere in the repo don't false-fail)
// for skip/only/todo markers (R3).
// -----------------------------------------------------------------------
await checkCriterion('C1-14', 'pnpm guard && pnpm typecheck, plus a diff-scoped scan for skip/only/todo', 'both gates exit 0 and no skip/only/todo marker was added by this branch\'s diff', () => {
  const guard = sh('pnpm', ['guard'], { timeoutMs: 20 * 60_000 });
  const typecheck = sh('pnpm', ['typecheck'], { timeoutMs: 20 * 60_000 });
  let addedBannedMarkers: string[] = [];
  if (baseCommit) {
    const diff = sh('git', ['diff', `${baseCommit}...HEAD`, '--', '*.test.ts', '*.test.tsx']);
    if (diff.status === 0) {
      const addedLines = diff.stdout.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
      const BANNED = /\b(it|test|describe)\.(skip|only|todo)\b|\btodo\(/;
      addedBannedMarkers = addedLines.filter((l) => BANNED.test(l)).map((l) => l.slice(0, 200));
    }
  }
  const ok = guard.status === 0 && typecheck.status === 0 && addedBannedMarkers.length === 0;
  record('C1-14', 'pnpm guard && pnpm typecheck', 'both exit 0; no skip/only/todo added by this branch', ok,
    `guard exit=${guard.status}\ntypecheck exit=${typecheck.status}\naddedBannedMarkers=${JSON.stringify(addedBannedMarkers)}\nguard tail:\n${guard.stdout.slice(-3000)}\n${guard.stderr.slice(-1000)}\ntypecheck tail:\n${typecheck.stdout.slice(-3000)}\n${typecheck.stderr.slice(-1000)}`,
    { detail: ok ? undefined : `guard=${guard.status} typecheck=${typecheck.status} bannedMarkers=${addedBannedMarkers.length}` });
});

// =============================================================================
// GATE-INTEGRITY -- self-sha vs the ENTIRE trimmed content of
// approved-gate.sha256 (single-line file). Skip-with-named-status (pass,
// advisory) if absent, matching W0's pre-approval behavior exactly.
// =============================================================================
await checkCriterion('GATE-INTEGRITY', `sha256(scripts/waves/verify-w1.ts) vs ${path.join(goalStateDir, 'approved-gate.sha256')}`, 'once an approval round writes approved-gate.sha256, this verifier\'s own sha256 must match it on every subsequent run; before any approval exists (file missing) this is advisory-only, matching W0\'s pre-approval behavior', () => {
  const selfPath = path.resolve(process.argv[1] ?? path.join(repoRoot, 'scripts/waves/verify-w1.ts'));
  let selfSha256: string;
  try {
    selfSha256 = sha256File(selfPath);
  } catch {
    // Out-of-repo invocation whose argv[1] doesn't resolve to a real file on
    // disk (should not happen under normal invocation) -- fall back to the
    // in-repo path so the check can still run rather than crash.
    selfSha256 = sha256File(path.join(repoRoot, 'scripts/waves/verify-w1.ts'));
  }
  const approvedHashPath = path.join(goalStateDir, 'approved-gate.sha256');
  if (!fs.existsSync(approvedHashPath)) {
    record('GATE-INTEGRITY', '', '', 'pass', `sha256: ${selfSha256}\nno approved-gate.sha256 present -- advisory only`);
    return;
  }
  const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
  const gateOk = approved === selfSha256;
  record('GATE-INTEGRITY', '', '', gateOk ? 'pass' : 'fail', `sha256: ${selfSha256}\napproved: ${approved}`, { detail: gateOk ? undefined : 'verify-w1.ts modified since orchestrator approval' });
});

// =============================================================================
// LEASE (R9) -- git diff --name-only <merge-base(origin/main,HEAD)>...HEAD
// must be a subset of leases.json's W1 entry, read from baseCommit so the
// wave cannot widen its own lease by editing leases.json on its own branch.
// =============================================================================
function globToRegExp(glob: string): RegExp {
  let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  re = re.replace(/\*\*/g, ' GLOBSTAR ');
  re = re.replace(/\*/g, '[^/]*');
  re = re.replace(/ GLOBSTAR /g, '.*');
  return new RegExp(`^${re}$`);
}
await checkCriterion('LEASE', `git diff --name-only ${baseCommit || '<unresolved>'}...HEAD subset-of leases.json[W1] (read via git show ${baseCommit || '<unresolved>'}:docs/plans/waves/leases.json)`, 'no writes outside the W1 lease; base and leases.json are both read from the merge-base with a verified origin/main, so the wave cannot widen its own lease', () => {
  if (!remoteMain.ok) { record('LEASE', '', '', 'fail', remoteMain.error, { detail: 'git ls-remote origin main failed -- no fallback permitted' }); return; }
  if (!gitIdentityOk) { record('LEASE', '', '', 'fail', `HEAD=${headSha}`, { detail: 'HEAD does not resolve to a real sha' }); return; }
  if (!baseCommit) { record('LEASE', '', '', 'fail', '', { detail: 'merge-base against verified origin/main could not be resolved' }); return; }
  const leasesAtBase = readFileAtCommit(baseCommit, 'docs/plans/waves/leases.json');
  if (!leasesAtBase.ok) { record('LEASE', '', '', 'fail', leasesAtBase.error, { detail: 'could not read leases.json at baseCommit' }); return; }
  let leasesRaw: { waves: Record<string, { allow: string[]; deny?: string[] }> };
  try { leasesRaw = JSON.parse(leasesAtBase.text); } catch (err) { record('LEASE', '', '', 'fail', leasesAtBase.text.slice(0, 500), { detail: `leases.json@baseCommit is not valid JSON: ${String(err)}` }); return; }
  const w1Lease = leasesRaw.waves.W1;
  if (!w1Lease) { record('LEASE', '', '', 'fail', '', { detail: 'no "W1" entry in leases.json@baseCommit' }); return; }
  const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
  if (diffResult.status !== 0) { record('LEASE', '', '', 'fail', diffResult.stdout, { detail: `git diff exited ${diffResult.status}` }); return; }
  const commitCount = sh('git', ['rev-list', '--count', `${baseCommit}..HEAD`]);
  if (commitCount.status !== 0) { record('LEASE', '', '', 'fail', '', { detail: `git rev-list --count failed (status=${commitCount.status})` }); return; }
  const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
  const numCommits = parseInt(commitCount.stdout.trim(), 10);
  if (diffNames.length === 0 && numCommits > 0) { record('LEASE', '', '', 'fail', '', { detail: `empty file diff but ${numCommits} commit(s) between baseCommit and HEAD -- suspicious` }); return; }
  const allowRe = w1Lease.allow.map(globToRegExp);
  const denyRe = (w1Lease.deny ?? []).map(globToRegExp);
  const violations = diffNames.filter((f) => !allowRe.some((re) => re.test(f)) || denyRe.some((re) => re.test(f)));
  record('LEASE', '', '', violations.length === 0 ? 'pass' : 'fail', violations.join('\n') || `all ${diffNames.length} changed files inside the W1 lease`);
});

// HEAD-DRIFT -- HEAD must not move mid-run (mirrors verify-w0.ts).
const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
record('HEAD-DRIFT', 'git rev-parse HEAD (re-resolved at end)', 'HEAD must not move during the run', headShaFinal === headSha ? 'pass' : 'fail', `initial=${headSha}\nfinal=${headShaFinal}`, { detail: headShaFinal === headSha ? undefined : 'HEAD moved during the run' });

// =============================================================================
// Proof manifest -- every criterion ID must appear; treeDirty:true can never
// be a pass (VERIFICATION-CONTRACT.md S2).
// =============================================================================
const statusResult = sh('git', ['status', '--porcelain']);
const treeDirty = statusResult.status !== 0 || statusResult.stdout.trim().length > 0;

const REQUIRED_CRITERIA = ['C1-1', 'C1-2', 'C1-3', 'C1-4', 'C1-5', 'C1-6', 'C1-7', 'C1-8', 'C1-9', 'C1-10', 'C1-11', 'C1-12', 'C1-13', 'C1-14'];
for (const id of REQUIRED_CRITERIA) {
  if (!results.some((r) => r.id === id)) {
    record(id, '', '', 'fail', '', { detail: 'criterion id has no entry in the manifest -- silence is failure (VERIFICATION-CONTRACT.md S2 rule 1)' });
  }
}

function writeManifestSafely(data: unknown): { path: string; wroteOk: boolean } {
  const content = JSON.stringify(data, null, 2);
  const primary = path.join(proofDir, 'manifest.json');
  try {
    const tmp = `${primary}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, primary);
    return { path: primary, wroteOk: true };
  } catch (e1) {
    console.error(`verify-w1: primary manifest write failed (${(e1 as Error).message}), trying fallback`);
  }
  try {
    const fallbackDir = path.join(os.tmpdir(), `verify-w1-fallback-${process.pid}`);
    fs.mkdirSync(fallbackDir, { recursive: true });
    const fallbackPath = path.join(fallbackDir, 'manifest.json');
    fs.writeFileSync(fallbackPath, content);
    return { path: fallbackPath, wroteOk: false };
  } catch (e2) {
    console.error(`verify-w1: fallback manifest write failed (${(e2 as Error).message})`);
    return { path: '(none)', wroteOk: false };
  }
}

const manifestOut = {
  wave: 'W1',
  commit: headSha || 'unknown',
  treeDirty,
  baseCommit: baseCommit || 'unknown',
  toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
  criteria: results,
};
const manifestWrite = writeManifestSafely(manifestOut);
let manifestSha256 = 'unavailable';
if (manifestWrite.wroteOk) {
  try { manifestSha256 = sha256File(manifestWrite.path); fs.writeFileSync(path.join(proofDir, 'manifest.sha256.txt'), `${manifestSha256}\n`); } catch { manifestSha256 = 'unavailable'; }
}

const hardFailures = results.filter((r) => r.status === 'fail');
const blocked = results.filter((r) => r.status === 'blocked-on-founder');
const passed = results.filter((r) => r.status === 'pass');
console.log(`\nverify-w1: ${passed.length} pass, ${blocked.length} blocked-on-founder, ${hardFailures.length} fail (of ${results.length}); treeDirty=${treeDirty}; manifest=${manifestWrite.path} (wroteOk=${manifestWrite.wroteOk})`);
for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` -- ${r.detail.slice(0, 200)}` : ''}`);
if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md S2)');
if (!manifestWrite.wroteOk) console.log('  ⚠ proof manifest degraded to a fallback path -- never a wave pass');
console.log(`MANIFEST_SHA256=${manifestSha256}`);
process.exit(hardFailures.length === 0 && !treeDirty && manifestWrite.wroteOk ? 0 : 1);

}

await main();

})().catch((err) => {
  console.error('verify-w1: fatal error escaped the async IIFE', err);
  try {
    const goalStateDirFallback = path.join(os.homedir(), '.claude', 'goal-state', 'mishmash-w1-routing-truth', 'proof');
    fs.mkdirSync(goalStateDirFallback, { recursive: true });
    fs.writeFileSync(path.join(goalStateDirFallback, 'manifest.json'), JSON.stringify({
      wave: 'W1', commit: 'unknown', treeDirty: true, baseCommit: 'unknown',
      toolchain: { node: process.version, pnpm: 'unknown' },
      criteria: [{ id: 'FATAL', command: 'main()', assertion: 'the verifier runs end-to-end without crashing', artifact: null, artifactSha256: null, exitCode: 1, status: 'fail', durationMs: 0, detail: String((err as Error)?.stack ?? err) }],
    }, null, 2));
  } catch { /* truly nothing more we can do */ }
  process.exit(1);
});
