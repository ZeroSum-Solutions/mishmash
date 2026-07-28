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
// CEREMONY ROUND FIX (ruling item 8): non-throwing variant used by the
// immutable-archive integrity checks below -- a reread/verify step must
// record a named mismatch, never crash the verifier.
function sha256FileSafe(absPath: string): string | null {
  try { return sha256File(absPath); } catch { return null; }
}
function walkAllFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkAllFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
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
// CEREMONY ROUND FIX (ruling item 8, "Immutable proof archive"): round 2's
// artifacts all shared ONE top-level proofDir, so a second run silently
// overwrote the first run's evidence files even though this file's OWN
// manifest.json snapshot differed run to run -- "distinct manifest hashes
// without retained hash-matching artifacts do not provide two independently
// auditable runs" (ruling finding 8). Every invocation now gets an
// EXCLUSIVE, never-reused proof/runs/<UTC>-<shortHead>-<nonce>/ directory;
// `proofDir` (declared in the init try/catch above) is reassigned to it
// HERE, before any criterion runs, so artifactFor()/record()/
// writeManifestSafely() below -- all of which read the `proofDir` binding
// at CALL time, not at parse time -- transparently write into the new
// exclusive directory with no further changes needed at their call sites.
// The canonical proof/manifest.json and proof/manifest.sha256.txt paths
// become latest-run COPIES only, atomically replaced from the archive AFTER
// it verifies (see the reread/verify/promote block near the manifest tail).
// =============================================================================
const CANONICAL_PROOF_DIR = proofDir; // goalStateDir/proof, from the init try/catch
const RUNS_ROOT = path.join(CANONICAL_PROOF_DIR, 'runs');
const archiveIntegrityViolations: string[] = [];
let preExistingArchiveHashes = new Map<string, string | null>();
let runDir = '';
try {
  fs.mkdirSync(RUNS_ROOT, { recursive: true });
  // Startup snapshot: every file a PRIOR invocation already archived,
  // hashed before THIS invocation writes anything of its own (its own
  // not-yet-created run directory is naturally excluded from this walk).
  for (const f of walkAllFiles(RUNS_ROOT)) preExistingArchiveHashes.set(f, sha256FileSafe(f));

  const shortHead = gitIdentityOk ? headSha.slice(0, 12) : `unresolved${crypto.randomBytes(4).toString('hex')}`;
  const utcStamp = new Date().toISOString().replace(/[^0-9TZ]/g, '');
  let created = false;
  for (let attempt = 0; attempt < 5 && !created; attempt++) {
    const candidate = path.join(RUNS_ROOT, `${utcStamp}-${shortHead}-${crypto.randomBytes(6).toString('hex')}`);
    try {
      fs.mkdirSync(candidate, { recursive: false });
      runDir = candidate;
      created = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err;
      // Nonce collision -- vanishingly unlikely; retry with a fresh nonce.
    }
  }
  if (!created) throw new Error('could not create an exclusive proof/runs/<UTC>-<shortHead>-<nonce> directory after 5 attempts (repeated nonce collisions)');
  proofDir = runDir;

  // Preserve whatever manifest currently sits at the canonical path (round
  // 2's -- the last surviving evidence; round 1's own manifest was already
  // unrecoverably overwritten by round 2 before this archiving scheme
  // existed, per the ceremony ruling's own finding 8: "lost run-1 artifacts
  // cannot be reconstructed") as an explicit, clearly-labeled historical
  // snapshot, exactly once, before this run's own canonical replacement
  // would otherwise clobber it a second time with no trace at all.
  const preArchiveManifestPath = path.join(CANONICAL_PROOF_DIR, 'manifest.json');
  const historicalManifestPath = path.join(CANONICAL_PROOF_DIR, 'historical-pre-archive-manifest.json');
  if (fs.existsSync(preArchiveManifestPath) && !fs.existsSync(historicalManifestPath)) {
    try {
      fs.copyFileSync(preArchiveManifestPath, historicalManifestPath);
      const preArchiveShaPath = path.join(CANONICAL_PROOF_DIR, 'manifest.sha256.txt');
      const historicalShaPath = path.join(CANONICAL_PROOF_DIR, 'historical-pre-archive-manifest.sha256.txt');
      if (fs.existsSync(preArchiveShaPath)) fs.copyFileSync(preArchiveShaPath, historicalShaPath);
    } catch (err) {
      archiveIntegrityViolations.push(`could not preserve the pre-existing canonical manifest as historical evidence: ${String((err as Error)?.message ?? err)}`);
    }
  }
} catch (err) {
  emergencyExit(`immutable proof archive setup failed: ${String((err as Error)?.stack ?? err)}`);
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
// ROUND 2 FIX (new defect in changed regions, Sol round-2): C1-7's aggregate
// search used `collectStrings(...).filter(numeric-looking)`, which only
// walks STRING-typed leaves -- a real JSON response encoding a total as an
// actual NUMBER (`"total": 12.34`, not `"total": "12.34"`), the normal way
// JSON APIs encode costs, was invisible to it entirely, so a CORRECT
// implementation using real numeric JSON fields could fail this check.
// `collectNumbers` walks NUMBER-typed leaves directly; both this and
// `collectStrings`' numeric-looking-string path are combined at each call
// site so either encoding is recognized.
function collectNumbers(root: unknown, _seen: Set<unknown> = new Set()): number[] {
  const out: number[] = [];
  if (typeof root === 'number' && Number.isFinite(root)) { out.push(root); return out; }
  if (!isRecord(root) && !Array.isArray(root)) return out;
  if (_seen.has(root)) return out;
  _seen.add(root);
  if (isRecord(root)) for (const v of Object.values(root)) out.push(...collectNumbers(v, _seen));
  else if (Array.isArray(root)) for (const v of root) out.push(...collectNumbers(v, _seen));
  return out;
}
// CEREMONY ROUND FIX (ruling item 3): round 2's `findPropertiesModelIdValues`
// still recursively walked the WHOLE payload for any object carrying a
// `properties` member -- an unrelated event elsewhere in the same batch (a
// `run_created`, a retry event, a DIFFERENT run's `run_finished`) could still
// satisfy it. "Parse only actual PostHog envelopes: either a root
// {event, properties} object or direct elements of a root batch array. Do
// not recursively discover arbitrary event-like objects." This extracts
// ONLY those two legitimate envelope shapes (one level, no recursion into
// arbitrary nesting), and the call site below filters to
// event==="run_finished" && properties.run_id===probeRunId, requiring
// EXACTLY ONE match before trusting its properties.model_id at all.
interface PostHogEnvelopeEvent { event: unknown; properties: unknown }
function extractPostHogEnvelopeEvents(parsedBody: unknown): PostHogEnvelopeEvent[] {
  const out: PostHogEnvelopeEvent[] = [];
  if (!isRecord(parsedBody)) return out;
  if ('event' in parsedBody && 'properties' in parsedBody) {
    out.push({ event: parsedBody.event, properties: parsedBody.properties });
  }
  if (Array.isArray(parsedBody.batch)) {
    for (const el of parsedBody.batch) {
      if (isRecord(el) && 'event' in el && 'properties' in el) out.push({ event: el.event, properties: el.properties });
    }
  }
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
// Finds the first object anywhere in `root` that mentions `runId` as one of
// its OWN values and returns that object itself (not a specific field) --
// used to bind a substring check (e.g. "unavailable") to the SAME run's own
// record instead of accepting a match anywhere in the whole response body
// (finding 7: "any unrelated nested 'unavailable' string exempts a numeric
// total from requiring a partial marker").
function findRunScopedRecord(root: unknown, runId: string, _seen: Set<unknown> = new Set()): Record<string, unknown> | null {
  if (!isRecord(root) && !Array.isArray(root)) return null;
  if (_seen.has(root)) return null;
  _seen.add(root);
  if (isRecord(root)) {
    const mentionsRun = Object.values(root).some((v) => v === runId);
    if (mentionsRun) return root;
    for (const v of Object.values(root)) {
      const hit = findRunScopedRecord(v, runId, _seen);
      if (hit) return hit;
    }
    return null;
  }
  for (const v of root as unknown[]) {
    const hit = findRunScopedRecord(v, runId, _seen);
    if (hit) return hit;
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
// `dataDir` is normally a fresh per-boot temp dir; C1-7's daemon-restart
// scenario passes an EXISTING dataDir back in on a second boot to prove
// the cost meter's data survives a real process restart, not just an
// in-memory cache.
async function bootDaemon(opts: { homeDir?: string; extraPathDirs?: string[]; extraEnv?: Record<string, string>; dataDir?: string } = {}): Promise<BootedDaemon> {
  const dataDir = opts.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'od-w1-verify-data-'));
  const bootScript = `
import { pathToFileURL } from 'node:url';
const mod = await import(pathToFileURL(${JSON.stringify(path.join(repoRoot, 'apps/daemon/src/server.ts'))}).href);
const started = await mod.startServer({ port: 0, returnServer: true });
console.log('OD_W1_VERIFIER_READY ' + JSON.stringify({ url: started.url }));
process.on('SIGTERM', async () => { try { await started.shutdown(); } catch {} process.exit(0); });
`;
  // CEREMONY ROUND FIX (ruling item 8): this is disposable spawn scratch,
  // not a proof artifact -- keep it out of the immutable per-run archive
  // directory (os.tmpdir() instead of proofDir) so it never has to be
  // reasoned about by the archive's reread/verify/hash-snapshot logic.
  const scriptPath = path.join(os.tmpdir(), `od-w1-boot-daemon.${process.pid}.${crypto.randomBytes(3).toString('hex')}.mjs`);
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
// ROUND 2 FIX (finding 11 / Sol round-2 F11): device/session ids used to be
// fixed "verifier-device-c1-5"/"verifier-session-c1-5" literals -- a stable,
// greppable, verifier-classifiable pair. Built fresh per call from
// randomNonce() instead.
function buildAnalyticsHeaders(): Record<string, string> {
  return {
    'x-od-analytics-device-id': randomNonce(8),
    'x-od-analytics-session-id': randomNonce(8),
    'x-od-analytics-client-type': 'web',
    'x-od-analytics-locale': 'en',
  };
}

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

// CEREMONY ROUND FIX (ruling item 1a, C1-7 same-run retry): mirrors
// apps/daemon/tests/run-retry-runtime.test.ts's own readRunEvents almost
// exactly -- asserting exact event COUNTS (two `start`, one `run_retry_
// attempted`, etc.) must read the daemon's live in-memory ring buffer via
// GET /api/runs/:id/events (SSE replay), never events.jsonl: disk
// persistence is explicitly best-effort (that test file's own comment:
// "ensureLogStream drops buffered writes when the stream errors under fd
// pressure"), so early events can be legitimately absent from the file
// while the ring buffer -- what SSE clients actually consume -- is
// complete. Called only after the run is terminal, so the replay is finite
// and closes on the terminal `end` event.
interface RunEventRecord { event: string; data: Record<string, unknown> }
async function readRunEventsViaSse(daemonUrl: string, runId: string, timeoutMs = 10_000): Promise<RunEventRecord[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const events: RunEventRecord[] = [];
  try {
    const res = await fetch(`${daemonUrl}/api/runs/${encodeURIComponent(runId)}/events`, {
      signal: controller.signal,
      headers: { accept: 'text/event-stream' },
    });
    if (!res.ok || !res.body) return events;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sawEnd = false;
    while (!sawEnd) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep = buffer.indexOf('\n\n');
      while (sep >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf('\n\n');
        let event = 'message';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!event || frame.startsWith(':')) continue;
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(data) as Record<string, unknown>; } catch { /* keepalives/no-payload events replay without JSON data */ }
        events.push({ event, data: parsed });
        if (event === 'end') sawEnd = true;
      }
    }
  } catch { /* timeout/abort: return whatever replayed so assertions fail with real data */ }
  finally { clearTimeout(timer); controller.abort(); }
  return events;
}
function matchesObjectSubset(actual: unknown, expected: Record<string, unknown>): boolean {
  if (!isRecord(actual)) return false;
  return Object.entries(expected).every(([k, v]) => actual[k] === v);
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

// EVASION ANALYSIS (finding 11, round 1): every probe value that a lazy/
// opportunistic implementation could pattern-match to special-case its way
// past the gate is generated per-run from crypto.randomBytes, never a fixed
// "verifier-*" literal. randomNonce() is the single source for that; every
// model-id / prompt-marker builder below routes through it.
function randomNonce(bytes = 6): string {
  return crypto.randomBytes(bytes).toString('hex');
}
// Builds a model id GUARANTEED to fail apps/daemon/src/runtimes/models.ts's
// `sanitizeCustomModel` (confirmed by reading it: `^[A-Za-z0-9][A-Za-z0-9._/
// :@-]*$`, so an embedded space always fails) -- empirically confirmed via a
// live probe against this exact repo's current (pre-implementation) code
// that this makes `resolveModelForAgent` receive `resolved=null` and fall
// through to ITS fallback-resolution branch, i.e. a REAL substitution
// decision is forced today, not merely hoped-for once W1 lands. This closes
// finding 3: an unknown-but-well-formed custom model id (e.g.
// "claude-totally-unknown-<x>") passes sanitizeCustomModel unchanged and
// resolveModelForAgent's first branch (`if (resolved && resolved !==
// 'default') return resolved`) returns it AS-IS -- requested===resolved,
// no substitution ever occurs, so criteria built on that trigger can never
// go genuinely green even after a correct fix. A malformed id has no such
// escape hatch.
// ROUND 2 FIX (finding 11): dropped the caller-supplied `seed` string this
// took in round 1 (e.g. "c1-1", "c1-2") -- a stable, criterion-identifying
// substring embedded in a value that drives the substitution oracle is
// exactly the class of marker finding 11 objects to. Every call site below
// now gets a value with no fixed substring at all.
function invalidModelId(): string {
  return `custom claude model ${randomNonce()} ${randomNonce()} unresolved`;
}
// IMPORTANT DESIGN NOTE: a spawned daemon child's process.env is fixed at
// ITS OWN spawn time (see bootDaemon()) -- mutating this verifier's own
// process.env AFTER the daemon has already booted does NOT propagate to the
// already-running daemon, and therefore not to whatever it spawns. Every
// per-run signal these fakes need (usage numbers, kimi failure mode) is
// therefore encoded into the REQUESTED MODEL ID STRING or (for FAKE_CLAUDE
// usage numbers specifically, see below) the PROMPT TEXT delivered over
// stdin -- both are genuinely per-request values that flow through the
// daemon unmodified, with no daemon restart required.
//
// Usage-marker prompt encoding (finding 5 fix): C1-7/C1-9 need a run whose
// MODEL ID is a real, current, honestly-priceable Claude model (so a correct
// pricing implementation can legitimately answer with real numbers instead
// of "unavailable"), while still controlling the exact usage/cost shape this
// verifier already knows the right answer for. Encoding usage in the model
// id (the OLD approach) forced a choice between "real model id" and
// "verifier-controlled usage" -- encoding it in the PROMPT instead keeps the
// model id real while remaining fully verifier-controlled, because
// `apps/daemon/src/server.ts` (promptInputFormat:'stream-json' for claude)
// writes the composed prompt into stdin as one JSONL `{type:'user',
// message:{role:'user',content:[{type:'text',text:<prompt>}]}}` line
// (confirmed by reading server.ts directly) -- FAKE_CLAUDE_SCRIPT below
// parses that line and looks for the marker. Real product code (pricing,
// cost aggregation) never sees or parses this marker -- it only sees the
// STRUCTURED `usage`/`total_cost_usd` fields FAKE_CLAUDE_SCRIPT emits on its
// `result` event, the same as it would from a real claude CLI -- so there is
// no oracle for an implementation to special-case against.
// CEREMONY ROUND FIX (ruling item 7, "Randomization boundary"): these were
// fixed literal strings ("OD_W1_USAGE_MARKER_START/END") -- exactly the
// stable-classifier-word class the ruling forbids ("OD_W1", "marker-start",
// "marker-end" are named explicitly). Fresh CSPRNG values per invocation now;
// every downstream use already threads them through JSON.stringify(...) into
// the generated fake-CLI source, so no other structural change is needed.
const USAGE_MARKER_START = randomNonce(12);
const USAGE_MARKER_END = randomNonce(12);
// CEREMONY ROUND FIX (ruling item 7): "model-ID carrier prefixes/suffixes
// used only by the fake" must also be fresh per invocation, not a fixed
// literal an implementation could pattern-match against.
const FAKE_CLAUDE_OWN_DEFAULT_MODEL = `agentdefault${randomNonce(10)}`;
const FAKE_CLAUDE_VERSION_STRING = `1.0.${randomNonce(4)}`;
interface ProbeUsage { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number }
// ROUND 2 FIX (finding 11): dropped the round-1 `label` parameter (e.g.
// "small run", "priced", "cost meter probe") -- a fixed, criterion-
// describing prompt prefix is exactly the "fixed pricing prompts" class
// finding 11 names. Replaced with a random nonce that carries no
// classifiable meaning.
function usageMarkerPrompt(usage: ProbeUsage, costUsd: number): string {
  return `${randomNonce(6)} ${USAGE_MARKER_START}${JSON.stringify({ ...usage, costUsd })}${USAGE_MARKER_END}`;
}
const FAKE_CLAUDE_SCRIPT = `#!/usr/bin/env node
// fake claude CLI -- see verify-w1.ts header comment.
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write(${JSON.stringify(FAKE_CLAUDE_VERSION_STRING)} + '\\n'); process.exit(0); }
const modelIdx = args.indexOf('--model');
const requestedModel = modelIdx >= 0 ? args[modelIdx + 1] : null;
// A real installed claude CLI, launched with no --model flag, still runs
// SOME concrete account/config-default model and reports it in its own
// init event -- never a bare null. This id (a fresh CSPRNG value per
// verifier invocation, per ceremony ruling item 7) stands in for that CLI's
// own hardcoded config default. The daemon cannot see or guess this value
// before spawn (it only learns it from this fake's stdout, exactly like a
// real CLI's echo), so it is legitimate ground truth, not an oracle leak.
const OWN_DEFAULT_MODEL = ${JSON.stringify(FAKE_CLAUDE_OWN_DEFAULT_MODEL)};
const executedModel = requestedModel || OWN_DEFAULT_MODEL;
function num(re, s, fallback) { const mm = re.exec(s); return mm ? Number(mm[1]) : fallback; }
function respond(promptText) {
  const markerIdx = (promptText || '').indexOf(${JSON.stringify(USAGE_MARKER_START)});
  const endIdx = (promptText || '').indexOf(${JSON.stringify(USAGE_MARKER_END)});
  let usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let costUsd = 0;
  if (markerIdx >= 0 && endIdx > markerIdx) {
    try {
      const parsed = JSON.parse(promptText.slice(markerIdx + ${JSON.stringify(USAGE_MARKER_START)}.length, endIdx));
      usage = { input_tokens: parsed.input_tokens ?? 1, output_tokens: parsed.output_tokens ?? 1, cache_creation_input_tokens: parsed.cache_creation_input_tokens ?? 0, cache_read_input_tokens: parsed.cache_read_input_tokens ?? 0 };
      costUsd = parsed.costUsd ?? 0;
    } catch {}
  } else {
    // Defensive fallback: usage encoded in the model id itself (legacy
    // scheme, no criterion currently sends this shape -- kept only so this
    // fake never silently degrades to all-default usage if a future check
    // needs a distinct-per-run-usage trigger without a prompt marker).
    const m = requestedModel || '';
    usage = { input_tokens: num(/input(\\d+)/, m, 1), output_tokens: num(/output(\\d+)/, m, 1), cache_creation_input_tokens: num(/cachecreate(\\d+)/, m, 0), cache_read_input_tokens: num(/cacheread(\\d+)/, m, 0) };
    costUsd = num(/costUSD([\\d.]+)/, m, 0);
  }
  const sessionId = 'fake-session-' + Math.random().toString(16).slice(2);
  function line(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }
  line({ type: 'system', subtype: 'init', model: executedModel, session_id: sessionId });
  line({ type: 'assistant', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'fake claude reply for ' + executedModel }], stop_reason: 'end_turn' } });
  line({ type: 'result', subtype: 'success', usage, total_cost_usd: costUsd, duration_ms: 5, stop_reason: 'end_turn' });
  setTimeout(() => process.exit(0), 30);
}
let stdinBuf = '';
let responded = false;
process.stdin.on('data', (chunk) => {
  stdinBuf += chunk.toString('utf8');
  if (responded) return;
  const nl = stdinBuf.indexOf('\\n');
  if (nl === -1) return;
  responded = true;
  let promptText = '';
  try {
    const parsed = JSON.parse(stdinBuf.slice(0, nl));
    const block = parsed && parsed.message && Array.isArray(parsed.message.content) ? parsed.message.content[0] : null;
    promptText = (block && block.text) || '';
  } catch {}
  respond(promptText);
});
// Fallback so this fake never hangs if stdin never delivers a full line
// (e.g. a future non-stream-json invocation shape).
setTimeout(() => { if (!responded) { responded = true; respond(''); } }, 2000);
`;

// Reproduces the EXACT documented silent-success shape from
// json-event-stream.ts's handleKimiEvent comment: a `role:'tool'` failure
// with no "Command failed with exit code" marker (the Write/Edit/etc. tool
// class the comment names as the blind spot), vs a control failure that DOES
// carry the marker (already correctly classified today) and a control
// success with no failing tool call at all. Mode is decoded from the
// requested model id (see the process.env note above FAKE_CLAUDE_SCRIPT --
// the same constraint applies here).
// ROUND 2 REWRITE (finding 8 / Sol round-2 F8): round 1 still special-cased
// exactly three fixed textual phrases (EPERM, ENOENT, the "Command failed
// with exit code" marker) -- "a three-string special case remains
// sufficient." kimi's real wire format (confirmed by reading
// handleKimiEvent's own comment in json-event-stream.ts) carries no
// STRUCTURED error field at all -- content string is the only variable
// dimension -- so exercising the PRD's "any non-zero tool-error field"
// property, within that real constraint, means feeding it ARBITRARY,
// per-run-randomized content strings (not a fixed enum of phrasings) and
// requiring the guard to fail EVERY one. The content is base64url-encoded
// into the model id (the only per-run channel available -- see the
// process.env note above FAKE_CLAUDE_SCRIPT) since sanitizeCustomModel's
// character class (`^[A-Za-z0-9][A-Za-z0-9._/:@-]*$`, confirmed by direct
// regex testing) is exactly base64url's alphabet plus separators.
function base64UrlEncode(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecode(s: string): string {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
// CEREMONY ROUND FIX (ruling item 4, "C1-10 tool-confound removal"): round 2
// always ran every failure on `Write` and the ONE success on `Read` --
// "permits a fail-all-Write implementation" (ruling finding 4) -- and the
// model-id encoding baked in classifier-legible substrings ("-ctrl-success",
// "-ctrl-marked-", "-rand-", named explicitly as forbidden in item 7). This
// generates matched success/failure PAIRS per tool identity (Read and Write
// mandatory; Edit and Bash included too, each also getting both a success
// and a failure), CSPRNG-shuffles run order, and encodes each run's whole
// spec (tool identity + outcome + failure content) as ONE opaque base64url
// blob -- the fake CLI decodes it structurally; no regex-matchable tag
// survives in the model id string the daemon itself ever sees.
interface KimiProbeSpec { tool: string; ok: boolean; content: string }
function encodeKimiProbeSpec(spec: KimiProbeSpec): string {
  return `m${base64UrlEncode(JSON.stringify(spec))}`;
}
// Runtime/combinatorial failure-content generator (replaces the closed
// seven-template pool): error CLASS, casing, punctuation, wrapper, path, and
// status/errno code are all independently randomized per call, and the
// wrapper composition varies the field ORDERING within the message.
function randomCase(s: string): string {
  const mode = Math.floor(Math.random() * 3);
  return mode === 0 ? s.toUpperCase() : mode === 1 ? s.toLowerCase() : s;
}
function combinatorialToolErrorContent(): string {
  const errnoNum = 1 + Math.floor(Math.random() * 90);
  const statusCode = 1 + Math.floor(Math.random() * 200);
  const ext = ['txt', 'py', 'json', 'log'][Math.floor(Math.random() * 4)];
  const p = `/${randomNonce(3)}/${randomNonce(4)}.${ext}`;
  const punctuation = [':', ' -', ',', ''][Math.floor(Math.random() * 4)]!;
  const bodies: Array<() => string> = [
    () => `${randomCase('EPERM')}${punctuation} operation not permitted, open '${p}'`,
    () => `${randomCase('ENOENT')}${punctuation} no such file or directory, stat '${p}'`,
    () => `${randomCase('EACCES')}${punctuation} permission denied, unlink '${p}'`,
    () => `${randomCase('fatal')}${punctuation} ${randomNonce(6)}: unable to write new object`,
    () => `${randomCase('OSError')}${punctuation} [Errno ${errnoNum}] ${randomNonce(6)}`,
    () => `${randomCase('Error')}${punctuation} ${randomNonce(8)} exited with status ${statusCode}`,
    () => `${randomCase('TimeoutError')}${punctuation} operation timed out after ${1 + Math.floor(Math.random() * 9000)}ms (${randomNonce(4)})`,
  ];
  const wrappers: Array<(inner: string) => string> = [
    (inner) => inner,
    (inner) => `${randomCase('Error')}${punctuation} ${inner}`,
    (inner) => `[tool-error] ${inner}`,
    (inner) => `${inner}\nexit status ${statusCode}`,
    (inner) => `Traceback (most recent call last):\n  File "${randomNonce(4)}.py", line ${1 + Math.floor(Math.random() * 900)}\n${inner}`,
  ];
  const body = bodies[Math.floor(Math.random() * bodies.length)]!();
  const wrapper = wrappers[Math.floor(Math.random() * wrappers.length)]!;
  return wrapper(body);
}
const FAKE_KIMI_SCRIPT = `#!/usr/bin/env node
// fake kimi CLI -- see verify-w1.ts header comment.
const crypto = require('node:crypto');
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write(${JSON.stringify(`0.27.${randomNonce(4)}`)} + '\\n'); process.exit(0); }
function b64urlDecode(s) {
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
const modelIdx = args.indexOf('--model');
const requestedModel = (modelIdx >= 0 ? args[modelIdx + 1] : '') || '';
let spec = { tool: 'Read', ok: true, content: 'ok' };
if (requestedModel[0] === 'm') {
  try { spec = JSON.parse(b64urlDecode(requestedModel.slice(1))); } catch {}
}
const toolCallId = 'call_' + crypto.randomBytes(6).toString('hex');
const sessionId = 'sess_' + crypto.randomBytes(6).toString('hex');
function line(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }
line({ role: 'assistant', tool_calls: [{ type: 'function', id: toolCallId, function: { name: spec.tool, arguments: '{}' } }] });
line({ role: 'tool', tool_call_id: toolCallId, content: spec.ok ? 'ok' : spec.content });
line({ role: 'assistant', content: spec.ok ? 'all good' : "I couldn't complete that." });
line({ role: 'meta', type: 'session.resume_hint', session_id: sessionId });
setTimeout(() => process.exit(0), 30);
`;
// Builds the full battery: combinatorial-content pairs for Read/Write/Edit,
// plus one Bash pair that RETAINS the real, already-correctly-classified
// exact `Command failed with exit code: N.` marker shape as its failure
// (ruling: "retain the real... negative control, but pair it with a
// successful result using the same tool identity"). CSPRNG-shuffled order.
function buildKimiProbePairs(): KimiProbeSpec[] {
  const combinatorialTools = ['Read', 'Write', 'Edit'];
  const specs: KimiProbeSpec[] = [];
  for (const tool of combinatorialTools) {
    specs.push({ tool, ok: true, content: 'ok' });
    specs.push({ tool, ok: false, content: combinatorialToolErrorContent() });
  }
  specs.push({ tool: 'Bash', ok: true, content: 'ok' });
  specs.push({ tool: 'Bash', ok: false, content: `Command failed with exit code: ${1 + Math.floor(Math.random() * 200)}.` });
  for (let i = specs.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    const tmp = specs[i]!; specs[i] = specs[j]!; specs[j] = tmp;
  }
  return specs;
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
// ROUND 1 FIX (Sol's non-blocking note): mocks/recordings/ is gitignored,
// so a fresh checkout has none locally, and mocks/scripts/fetch-recordings.sh
// performs REAL Cloudflare R2 network egress and writes files -- a
// completion gate silently reaching out to an external network and mutating
// the filesystem on a cold checkout is not offline/side-effect-free. This no
// longer auto-fetches; it fails closed with a named prerequisite unless
// explicitly opted into via OD_W1_VERIFY_ALLOW_RECORDINGS_FETCH=1 (e.g. an
// environment that has already accepted that egress can set it once).
function ensureMockRecordings(agent: string): { ok: boolean; error?: string } {
  const dir = path.join(repoRoot, 'mocks', 'recordings');
  function haveAllLocally(): boolean {
    if (!fs.existsSync(dir) || !fs.readdirSync(dir).some((f) => f.endsWith('.jsonl'))) return false;
    // Recordings dir is shared across agents once fetched; confirm this
    // agent's specific manifest entries are present, not just SOME jsonl.
    const manifestPath = path.join(repoRoot, 'mocks', 'manifest.json');
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { entries: { agent: string; trace_id: string }[] };
      const need = manifest.entries.filter((e) => e.agent === agent);
      return need.every((e) => fs.existsSync(path.join(dir, `${e.trace_id}.jsonl`)));
    } catch {
      return false;
    }
  }
  if (haveAllLocally()) return { ok: true };
  if (process.env.OD_W1_VERIFY_ALLOW_RECORDINGS_FETCH !== '1') {
    return {
      ok: false,
      error: `mocks/recordings/ does not have the "${agent}" trace(s) cached locally, and this verifier does not fetch them automatically -- fetch-recordings.sh performs real Cloudflare R2 network egress, which a completion gate must not do silently on a cold checkout. Prerequisite: run \`bash mocks/scripts/fetch-recordings.sh --agent ${agent}\` before invoking this gate, or set OD_W1_VERIFY_ALLOW_RECORDINGS_FETCH=1 to explicitly allow this verifier to perform that fetch itself.`,
    };
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
type PlaywrightCdpSession = { send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>> };
type PlaywrightBrowserContext = { newCDPSession: (page: PlaywrightPage) => Promise<PlaywrightCdpSession> };
type PlaywrightRoute = {
  request: () => { method: () => string; url: () => string };
  fulfill: (opts: { json?: unknown; status?: number }) => Promise<void>;
  fallback: () => Promise<void>;
  continue: () => Promise<void>;
};
type PlaywrightPage = {
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  locator: (selector: string) => PlaywrightLocator;
  waitForTimeout: (ms: number) => Promise<void>;
  evaluate: <T>(fn: (...a: unknown[]) => T, arg?: unknown) => Promise<T>;
  context: () => PlaywrightBrowserContext;
  addInitScript: <T>(fn: (arg: T) => void, arg: T) => Promise<void>;
  route: (pattern: string, handler: (route: PlaywrightRoute) => Promise<void>) => Promise<void>;
};
type PlaywrightLocator = {
  count: () => Promise<number>;
  first: () => PlaywrightLocator;
  innerText: (opts?: { timeout?: number }) => Promise<string>;
  getAttribute: (name: string) => Promise<string | null>;
  waitFor: (opts?: { timeout?: number; state?: string }) => Promise<void>;
  click: (opts?: { timeout?: number }) => Promise<void>;
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

// Finding 1 (round 1): C1-11 must be a REAL computed-accessibility audit,
// not a hand-rolled aria-label/innerText read. axe-core is unavailable
// without a lease-violating root package.json dependency add (see the
// C1-11 header note this file already carries), but Chromium's OWN
// accessibility engine -- the same one axe-core and Lighthouse query -- is
// reachable through Playwright's CDP session API, which IS still present
// in the installed @playwright/test@1.60.0 (empirically confirmed live:
// `page.accessibility.snapshot()`, the older wrapper, has been REMOVED in
// this version -- `page.accessibility` is `undefined` -- so this file goes
// straight to the CDP `Accessibility` domain instead of assuming the
// deprecated helper still exists). Returns the browser's own computed
// role/name/ignored-state for the first element matching `selector`, or
// null if the selector matches nothing.
async function computedAxNodeForSelector(
  page: PlaywrightPage,
  selector: string,
): Promise<{ role: string | null; name: string | null; ignored: boolean } | null> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
  try {
    const doc = (await cdp.send('DOM.getDocument', { depth: -1 })) as { root: { nodeId: number } };
    const found = (await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector })) as { nodeId: number };
    if (!found.nodeId) return null;
    const desc = (await cdp.send('DOM.describeNode', { nodeId: found.nodeId })) as { node: { backendNodeId: number } };
    const ax = (await cdp.send('Accessibility.getPartialAXTree', { backendNodeId: desc.node.backendNodeId, fetchRelatives: false })) as {
      nodes: { role?: { value?: string }; name?: { value?: string }; ignored?: boolean }[];
    };
    const node = ax.nodes[0];
    if (!node) return null;
    return { role: node.role?.value ?? null, name: node.name?.value ?? null, ignored: node.ignored === true };
  } finally {
    try { await cdp.send('Accessibility.disable'); } catch { /* best effort */ }
    try { await cdp.send('DOM.disable'); } catch { /* best effort */ }
  }
}

// ROUND 2 ADDITION (finding 1 / Sol round-2 F1): `computedAxNodeForSelector`
// only reports the accessible name of ONE named node (the message
// container), which real substitution UI has no reason to name directly --
// the state/model information more plausibly lives on a labeled child badge
// INSIDE the message. This walks the CDP full accessibility tree, restricts
// it to nodes whose DOM element is `containerSelector` itself or one of its
// descendants (via `DOM.querySelectorAll(container, '*')` + backendNodeId
// cross-reference), and returns the first one whose COMPUTED NAME contains
// `needle` -- i.e. proves some real, accessibility-tree-visible control
// inside the message actually NAMES the state/model, not merely that SOME
// node somewhere has a nonempty name.
async function findNamedDescendantAx(
  page: PlaywrightPage,
  containerSelector: string,
  needle: string,
): Promise<{ role: string | null; name: string | null; ignored: boolean } | null> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
  try {
    const doc = (await cdp.send('DOM.getDocument', { depth: -1 })) as { root: { nodeId: number } };
    const container = (await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: containerSelector })) as { nodeId: number };
    if (!container.nodeId) return null;
    const descendants = (await cdp.send('DOM.querySelectorAll', { nodeId: container.nodeId, selector: '*' })) as { nodeIds: number[] };
    const candidateNodeIds = [container.nodeId, ...descendants.nodeIds];
    const backendIds = new Set<number>();
    for (const nodeId of candidateNodeIds) {
      try {
        const desc = (await cdp.send('DOM.describeNode', { nodeId })) as { node: { backendNodeId: number } };
        backendIds.add(desc.node.backendNodeId);
      } catch { /* a stale nodeId is fine to skip */ }
    }
    const full = (await cdp.send('Accessibility.getFullAXTree', {})) as {
      nodes: { role?: { value?: string }; name?: { value?: string }; ignored?: boolean; backendDOMNodeId?: number }[];
    };
    const needleLower = needle.toLowerCase();
    for (const node of full.nodes) {
      if (node.backendDOMNodeId === undefined || !backendIds.has(node.backendDOMNodeId)) continue;
      const name = node.name?.value ?? '';
      if (name && name.toLowerCase().includes(needleLower)) {
        return { role: node.role?.value ?? null, name, ignored: node.ignored === true };
      }
    }
    return null;
  } finally {
    try { await cdp.send('Accessibility.disable'); } catch { /* best effort */ }
    try { await cdp.send('DOM.disable'); } catch { /* best effort */ }
  }
}

// tools-dev suite boot (real namespaced daemon+web pair) for the browser
// criteria, reusing e2e's own harness rather than hand-rolling one (per the
// house rule that test/lifecycle code must go through this harness).
interface WebSuiteHandle { daemonUrl: string; webUrl: string; dataDir: string; stop: () => Promise<void> }
// EVASION-ANALYSIS-ADJACENT HARNESS FIX (found empirically while verifying
// this round's own fixes, not one of Sol's named findings, but load-bearing
// for every browser-based criterion): a real page load against a freshly
// booted web suite renders NOTHING of the conversation UI -- confirmed live
// that `data-assistant-message-id` is absent from the DOM even for an
// ordinary, non-substituted, successfully-completed run -- until the
// client's `mishmash:config` localStorage entry is seeded with
// `onboardingCompleted: true` BEFORE the page's own scripts run. Without
// this, EVERY DOM-based check (C1-2's browser half, C1-9's rendered-UI half,
// C1-11) would be structurally unsatisfiable regardless of implementation --
// exactly the failure mode this file exists to avoid. This mirrors
// `e2e/lib/playwright/mock-factory.ts`'s `applyStorageConfig` (the house
// pattern real e2e Playwright tests already use), scoped to the one field
// (`onboardingCompleted`) and the real agent id this file actually drives,
// rather than importing that file's MOCK-agent-shaped config wholesale.
async function seedWebClientConfig(page: PlaywrightPage, agentId: string): Promise<void> {
  const config = {
    mode: 'daemon',
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    agentId,
    skillId: null,
    designSystemId: null,
    onboardingCompleted: true,
    agentModels: {},
    privacyDecisionAt: 1,
    telemetry: { metrics: false, content: false, artifactManifest: false },
  };
  await page.addInitScript(
    (arg: { key: string; value: string }) => {
      (globalThis as unknown as { window: { localStorage: { setItem: (k: string, v: string) => void } } }).window.localStorage.setItem(arg.key, arg.value);
    },
    { key: 'mishmash:config', value: JSON.stringify(config) },
  );
}
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
// EVASION ANALYSIS: two runs, DIFFERENT in KIND, not just in string value --
// a stub that hardcodes a single constant "requested"/"resolved" value, or
// that copies requested into resolved unconditionally, fails one of the two:
//   Run A (known model, e.g. 'claude-sonnet-4-5'): no substitution should
//     occur -- requested === resolved === reported.
//   Run B (invalidModelId(), fails sanitizeCustomModel -- confirmed live
//     against this repo's current code that this forces resolveModelForAgent
//     into its fallback branch): a real substitution IS forced -- resolved
//     must differ from requested AND must equal the INDEPENDENTLY observed
//     ground truth (FAKE_CLAUDE_SCRIPT's own "fake claude reply for <exec>"
//     text, parsed from the persisted message content, not trusted from
//     whatever the daemon claims about itself) -- closing finding 2's "never
//     requires resolved differs or matches the runtime resolution". `reported`
//     is required non-null and equal to `resolved` for both runs since
//     claude always echoes (closing finding 2's "C1-1 ... never requires
//     reported").
// -----------------------------------------------------------------------
await checkCriterion('C1-1', 'contract type scan (packages/contracts/src/**) + two real HTTP runs via a verifier-owned fake claude binary, ground-truthed against the daemon\'s own sqlite messages table AND the fake CLI\'s own independent echo', 'a known model persists requested===resolved===reported; an unresolvable model forces resolved!=requested, resolved matches the independently-observed executed model, and reported is non-null and consistent', async () => {
  const typeCheck = findTypeWithFields(path.join(repoRoot, 'packages/contracts/src'), ['requested', 'resolved', 'reported']);
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'claude', FAKE_CLAUDE_SCRIPT);
  const daemon = await bootDaemon({ extraPathDirs: [fakeBinDir] });
  try {
    const projectId = await createProject(daemon.url, randomNonce(8));
    const modelA = 'claude-sonnet-4-5';
    const modelB = invalidModelId();
    const runA = await startRun(daemon.url, { projectId, agentId: 'claude', model: modelA, message: randomNonce(10) });
    const statusA = await pollRunTerminal(daemon.url, runA.runId);
    const runB = await startRun(daemon.url, { projectId, agentId: 'claude', model: modelB, message: randomNonce(10) });
    const statusB = await pollRunTerminal(daemon.url, runB.runId);
    const msgA = readMessageRow(daemon.dataDir, runA.assistantMessageId);
    const msgB = readMessageRow(daemon.dataDir, runB.assistantMessageId);
    function extractRRR(status: Record<string, unknown>, msg: MessageRow | null): { requested?: string; resolved?: string; reported: string | null } {
      const candidates: unknown[] = [status];
      if (msg?.run_context_json) { try { candidates.push(JSON.parse(msg.run_context_json)); } catch { /* ignore */ } }
      if (msg?.events_json) { try { candidates.push(JSON.parse(msg.events_json)); } catch { /* ignore */ } }
      for (const c of candidates) {
        const hit = findSiblingRecord(c, ['requested', 'resolved'], ['reported']);
        if (hit) return { requested: String(hit.record.requested), resolved: String(hit.record.resolved), reported: hit.record.reported === null || hit.record.reported === undefined ? null : String(hit.record.reported) };
      }
      return { reported: null };
    }
    // Ground truth independent of whatever the daemon persists about
    // itself: FAKE_CLAUDE_SCRIPT always emits "fake claude reply for
    // <executedModel>" as the assistant text.
    function executedModelFromContent(msg: MessageRow | null): string | null {
      const m = /^fake claude reply for (.+)$/.exec(msg?.content ?? '');
      return m?.[1] ?? null;
    }
    const rrA = extractRRR(statusA, msgA);
    const rrB = extractRRR(statusB, msgB);
    const executedA = executedModelFromContent(msgA);
    const executedB = executedModelFromContent(msgB);
    const problems: string[] = [];
    if (!typeCheck.found) problems.push('no contract type under packages/contracts/src has requested+resolved+reported as sibling fields');
    if (!rrA.requested || !rrA.resolved) problems.push('run A (known model): no requested/resolved sibling pair found in status response, run_context_json, or events_json');
    if (!rrB.requested || !rrB.resolved) problems.push('run B (unresolvable model): no requested/resolved sibling pair found');
    if (rrA.requested && rrA.requested !== modelA) problems.push(`run A requested=${rrA.requested} but the run actually requested ${modelA}`);
    if (rrB.requested && rrB.requested !== modelB) problems.push(`run B requested=${rrB.requested} but the run actually requested ${modelB}`);
    if (rrA.resolved && executedA && rrA.resolved !== executedA) problems.push(`run A: persisted resolved="${rrA.resolved}" does not match the independently-observed executed model "${executedA}" (known model should not be substituted)`);
    if (rrA.resolved && rrA.resolved !== modelA) problems.push(`run A: resolved="${rrA.resolved}" differs from requested="${modelA}" for a KNOWN model -- no substitution should occur here`);
    if (!rrA.reported) problems.push('run A: reported is null/absent even though claude always echoes its model -- reported must be populated for an echoing lane');
    else if (rrA.reported !== rrA.resolved) problems.push(`run A: reported="${rrA.reported}" does not equal resolved="${rrA.resolved}"`);
    if (rrB.resolved && rrB.resolved === modelB) problems.push('run B: resolved equals the unresolvable requested string verbatim -- no substitution occurred (resolveModelForAgent did not fall back)');
    if (rrB.resolved && executedB && rrB.resolved !== executedB) problems.push(`run B: persisted resolved="${rrB.resolved}" does not match the independently-observed executed model "${executedB}"`);
    if (!executedB) problems.push('run B: could not independently observe the executed model from the fake CLI\'s own echoed reply text -- cannot ground-truth the substitution');
    if (!rrB.reported) problems.push('run B: reported is null/absent even though claude always echoes its model -- reported must be populated for an echoing lane');
    else if (executedB && rrB.reported !== executedB) problems.push(`run B: reported="${rrB.reported}" does not match the independently-observed executed model "${executedB}"`);
    const evidence = `contractType=${JSON.stringify(typeCheck)}\nrunA(requested=${modelA})=${JSON.stringify(rrA)} executedA=${executedA}\nrunB(requested=${modelB})=${JSON.stringify(rrB)} executedB=${executedB}\nstatusA=${JSON.stringify(statusA).slice(0, 800)}\nstatusB=${JSON.stringify(statusB).slice(0, 800)}`;
    record('C1-1', 'fake claude x2 (known + unresolvable) + contract AST scan', 'known-model run has requested===resolved===reported; unresolvable-model run has resolved!=requested, resolved/reported matching the independently-observed executed model', problems.length === 0, evidence, { detail: problems.length ? problems.join('; ') : undefined });
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
// ROUND 1 FIXES (finding 1 + finding 3):
//   - selector was `[data-message-id]`, which only exists on the unrelated
//     question-form history summary node (AssistantMessage.tsx:2933);
//     ordinary assistant messages carry `data-assistant-message-id`
//     (AssistantMessage.tsx:862) -- fixed below.
//   - the previous "unknown model" trigger was a well-formed custom id,
//     which `sanitizeCustomModel` accepts unchanged and
//     `resolveModelForAgent`'s first branch returns as-is -- confirmed live
//     against this repo's current code that requested===resolved for that
//     trigger, so no substitution ever occurs to be visible. `invalidModelId`
//     (fails sanitizeCustomModel) forces a real substitution instead.
//   - the DOM check now requires BOTH the requested id AND the
//     independently-observed resolved id to appear (previously only
//     checked the requested string), matching the PRD's "naming both
//     models" wording.
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
      const requestedInvalid = invalidModelId();
      const projectResp = await httpJson('POST', `${webSuite.daemonUrl}/api/projects`, { id: randomNonce(8), name: randomNonce(6) });
      const projectId = (projectResp.json as { project?: { id?: string } })?.project?.id;
      if (!projectId) throw new Error(`could not create project via web daemon: ${projectResp.text.slice(0, 300)}`);
      const run = await startRun(webSuite.daemonUrl, { projectId, agentId: 'claude', model: requestedInvalid, message: randomNonce(10) });
      const runStatus = await pollRunTerminal(webSuite.daemonUrl, run.runId);
      // Independent ground truth for what actually executed, read straight
      // from the fake CLI's own echoed reply text (see C1-1's identical
      // technique) -- never trusted from whatever the UI itself claims.
      const msg = readMessageRow(webSuite.dataDir, run.assistantMessageId);
      const executedMatch = /^fake claude reply for (.+)$/.exec(msg?.content ?? '');
      const executedModel = executedMatch?.[1] ?? null;
      if (!executedModel) problems.push('could not independently observe the executed model from the fake CLI\'s own echoed reply text -- cannot verify the DOM names the real resolved model');
      browser = await pw.pw.chromium.launch({ headless: true });
      const page = await browser.newPage();
      await seedWebClientConfig(page, 'claude');
      await page.goto(`${webSuite.webUrl}/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(run.conversationId)}`, { waitUntil: 'load', timeout: 30_000 });
      const messageSelector = `[data-assistant-message-id="${run.assistantMessageId}"]`;
      const locator = page.locator(messageSelector);
      let found = false;
      try { await locator.waitFor({ timeout: 15_000 }); found = (await locator.count()) > 0; } catch { found = false; }
      if (!found) {
        problems.push(`no [data-assistant-message-id="${run.assistantMessageId}"] node rendered in the conversation view within 15s -- substitution UI surface not present yet`);
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
        const hasRequested = rr.text.includes(requestedInvalid) || rr.accessibleName.includes(requestedInvalid);
        const hasResolved = !!executedModel && (rr.text.includes(executedModel) || rr.accessibleName.includes(executedModel));
        const hasNonEmptyAccessibleName = rr.accessibleName.trim().length > 0;
        if (!hasRequested) problems.push(`assistant message text/accessible-name does not mention the originally-requested model ("${requestedInvalid}") anywhere -- substitution is not visible`);
        if (executedModel && !hasResolved) problems.push(`assistant message text/accessible-name does not mention the RESOLVED model that actually ran ("${executedModel}") anywhere -- the PRD requires visible text naming BOTH models, not just the requested one`);
        if (!hasNonEmptyAccessibleName) problems.push('message node has an empty computed accessible name (text-only stripped or colour-only badge)');
        if (rr.ariaHiddenAncestor) problems.push('the substitution-bearing node sits inside an aria-hidden="true" ancestor -- invisible to assistive tech');
        evidenceParts.push(`dom probe: ${JSON.stringify(rr)} executedModel=${executedModel}`);
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
// ROUND 1 FIX (finding 2): the previous check accepted ANY nested nonempty
// `resolved` string anywhere in the response -- a value that never touched
// settings.json or the echo could still satisfy it. The persisted
// requested/resolved sibling record is now REQUIRED to equal BOTH
// independently-observed ground truths (the actual settings.json content
// AND the fake agy's own echoed observation), not merely be present.
// `reported` is deliberately NOT required here (unlike C1-1): NM-13c
// documents antigravity's plain stream as a genuine no-structured-echo
// evidence ceiling, so a correct implementation may legitimately leave
// `reported` null for this lane -- requiring it would fight C1-4's own
// unverified-lane framing.
// ROUND 2 FIX (finding 2, Sol round-2 F2): round 1 never asserted that the
// SAME sibling record's `requested` field equals what was actually
// requested over HTTP -- a run whose `resolved` was correctly bound but
// whose `requested` was wrong (or copied from `resolved`) still passed.
// `requested` is now asserted equal to `requestedLabel`, closing that hole.
// -----------------------------------------------------------------------
await checkCriterion('C1-3', 'single antigravity run via a verifier-owned fake agy + independent settings.json readback', 'the persisted requested value equals the actual HTTP-requested launch input, AND the persisted resolved value is bound to BOTH the actual settings.json content written before spawn AND agy\'s own echoed observation', async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w1-agy-home-'));
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'agy', FAKE_AGY_SCRIPT);
  const daemon = await bootDaemon({ homeDir, extraPathDirs: [fakeBinDir], extraEnv: { FAKE_AGY_DELAY_MS: '80' } });
  try {
    const projectId = await createProject(daemon.url, randomNonce(8));
    const requestedLabel = 'Claude Sonnet 4.6 (Thinking)';
    const run = await startRun(daemon.url, { projectId, agentId: 'antigravity', model: requestedLabel, message: randomNonce(10) });
    const status = await pollRunTerminal(daemon.url, run.runId);
    const settingsPath = path.join(homeDir, '.gemini', 'antigravity-cli', 'settings.json');
    const settingsAfter = fs.existsSync(settingsPath) ? (JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as { model?: string }).model : undefined;
    const msg = readMessageRow(daemon.dataDir, run.assistantMessageId);
    const echoedFromReply = msg?.content?.startsWith('AGY_OBSERVED_MODEL: ') ? msg.content.slice('AGY_OBSERVED_MODEL: '.length).trim() : null;
    const problems: string[] = [];
    if (settingsAfter !== requestedLabel) problems.push(`settings.json after the run holds "${settingsAfter}", expected the requested label "${requestedLabel}" -- daemon did not write the launch input as expected`);
    if (echoedFromReply !== requestedLabel) problems.push(`persisted assistant reply echoes "${echoedFromReply}", expected agy to have observed "${requestedLabel}" -- ground truth and product output disagree`);
    const candidates: unknown[] = [status];
    if (msg?.run_context_json) { try { candidates.push(JSON.parse(msg.run_context_json)); } catch { /* ignore */ } }
    if (msg?.events_json) { try { candidates.push(JSON.parse(msg.events_json)); } catch { /* ignore */ } }
    let launchInputRecord: { record: Record<string, unknown>; atPath: string } | null = null;
    for (const c of candidates) {
      const hit = findSiblingRecord(c, ['requested', 'resolved'], ['reported']);
      if (hit) { launchInputRecord = hit; break; }
    }
    if (!launchInputRecord) {
      problems.push('no persisted requested/resolved sibling pair found on the run (status, run_context_json, or events_json) -- reconciliation is not recorded on the run itself yet');
    } else {
      const persistedRequested = String(launchInputRecord.record.requested);
      const persistedResolved = String(launchInputRecord.record.resolved);
      if (persistedRequested !== requestedLabel) {
        problems.push(`persisted requested="${persistedRequested}" does not equal the actual HTTP-requested launch input ("${requestedLabel}") -- requested is wrong or not bound to the real request`);
      }
      if (settingsAfter !== undefined && persistedResolved !== settingsAfter) {
        problems.push(`persisted resolved="${persistedResolved}" does not equal the actual settings.json content ("${settingsAfter}") written before spawn -- resolved is not bound to the isolated settings file`);
      }
      if (echoedFromReply !== null && persistedResolved !== echoedFromReply) {
        problems.push(`persisted resolved="${persistedResolved}" does not equal agy's own echoed observation ("${echoedFromReply}") -- resolved is not bound to the echoed result`);
      }
    }
    record('C1-3', 'fake agy + settings.json readback', 'requested equals the real HTTP launch input; resolved is bound to both the actual settings.json content and the independently-observed echo', problems.length === 0, `settingsAfter=${settingsAfter}\nechoedFromReply=${echoedFromReply}\nlaunchInputRecord=${JSON.stringify(launchInputRecord)}\nstatus=${JSON.stringify(status).slice(0, 600)}`, { detail: problems.length ? problems.join('; ') : undefined });
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
    const projectId = await createProject(daemon.url, randomNonce(8));
    const claudeRun = await startRun(daemon.url, { projectId, agentId: 'claude', model: 'claude-sonnet-4-5', message: randomNonce(10) });
    const claudeStatus = await pollRunTerminal(daemon.url, claudeRun.runId);
    const claudeMsg = readMessageRow(daemon.dataDir, claudeRun.assistantMessageId);
    const claudeState = findEnumValueField(claudeStatus, ['verified', 'substituted', 'unverified']) ?? (claudeMsg?.events_json ? findEnumValueField(JSON.parse(claudeMsg.events_json), ['verified', 'substituted', 'unverified']) : null);

    const problems: string[] = [];
    let codexState: { key: string; value: string } | null = null;
    let codexStatus: Record<string, unknown> = {};
    if (!codexFetch.ok) {
      problems.push(`could not fetch a codex mock recording: ${codexFetch.error}`);
    } else {
      const codexRun = await startRun(daemon.url, { projectId, agentId: 'codex', model: 'gpt-5.6-codex', message: randomNonce(10), context: {} });
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
// ROUND 1 FIX (finding 3): the previous "unknown model" trigger was a
// well-formed custom id that `sanitizeCustomModel` accepts unchanged and
// `resolveModelForAgent` returns as-is -- confirmed live against this
// repo's current code that requested===resolved for that trigger, so the
// very telemetry bug this criterion exists to catch (raw requested leaking
// into run.model) could never actually manifest, silently passing for the
// wrong reason. `invalidModelId` forces a real substitution.
// ROUND 2 FIX (finding 3, Sol round-2 F3): the telemetry scan now binds
// specifically to `properties.model_id` (the real PostHog event envelope
// shape) via `findPropertiesModelIdValues`, not any nested key anywhere in
// the payload literally named `model_id` -- a decoy field elsewhere in the
// captured body can no longer satisfy this. Round 2 also drops the fixed
// analytics-header literals and message text (finding 11).
// -----------------------------------------------------------------------
await checkCriterion('C1-5', 'local PostHog-shaped capture stub + a substitution-triggering run (unresolvable model id, non-amr agent)', 'the model_id property stamped on properties.model_id of the captured analytics event equals the resolved model, not the raw requested one', async () => {
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'claude', FAKE_CLAUDE_SCRIPT);
  const capture = await startCaptureServer();
  const daemon = await bootDaemon({ extraPathDirs: [fakeBinDir], extraEnv: { POSTHOG_KEY: randomNonce(8), POSTHOG_HOST: capture.url } });
  try {
    const projectId = await createProject(daemon.url, randomNonce(8));
    const requestedInvalid = invalidModelId();
    const analyticsHeaders = buildAnalyticsHeaders();
    // analyticsHeaders: without x-od-analytics-device-id, readAnalyticsContext
    // returns null and the daemon's capture call short-circuits before ever
    // reaching PostHog -- confirmed empirically.
    const run = await startRun(daemon.url, { projectId, agentId: 'claude', model: requestedInvalid, message: randomNonce(10) }, analyticsHeaders);
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
    }, analyticsHeaders);
    // Give posthog-node's internal flush a moment; it batches rather than
    // sending synchronously on capture().
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const resolvedGuess = findSiblingRecord(status, ['requested', 'resolved'], ['reported'])?.record.resolved;
    // Independent ground truth, not trusted from whatever the daemon claims
    // about itself: FAKE_CLAUDE_SCRIPT always emits "fake claude reply for
    // <executedModel>" as the assistant text (see C1-1/C1-2's identical
    // technique).
    const msgForExec = readMessageRow(daemon.dataDir, run.assistantMessageId);
    const executedMatch = /^fake claude reply for (.+)$/.exec(msgForExec?.content ?? '');
    const executedModel = executedMatch?.[1] ?? null;
    // CEREMONY ROUND FIX (ruling item 3): strict envelope parse (root
    // {event,properties} OR elements of a root batch array only, no
    // recursion into arbitrary nesting -- see extractPostHogEnvelopeEvents),
    // filtered to event==="run_finished" && properties.run_id===run.runId,
    // requiring EXACTLY ONE match. run_created, retry events, unrelated
    // runs, and unrelated properties.model_id fields elsewhere in the same
    // batch supply no evidence. Only on that one matched event do we look
    // at properties.model_id at all.
    const allEnvelopeEvents = capture.bodies.flatMap((b) => {
      try { return extractPostHogEnvelopeEvents(JSON.parse(b)); } catch { return []; }
    });
    const matchingRunFinished = allEnvelopeEvents.filter((e) => e.event === 'run_finished' && isRecord(e.properties) && e.properties.run_id === run.runId);
    const problems: string[] = [];
    if (capture.bodies.length === 0) problems.push('no analytics payload was captured at all -- POSTHOG_HOST override did not take effect, or capture() was never called');
    if (!executedModel) problems.push('could not independently observe the executed model from the fake CLI\'s own echoed reply text -- cannot ground-truth the telemetry assertion');
    let matchedModelId: string | null = null;
    if (matchingRunFinished.length === 0) {
      problems.push(`no captured PostHog envelope is a run_finished event with properties.run_id === "${run.runId}" (checked ${allEnvelopeEvents.length} total envelope event(s) across ${capture.bodies.length} captured body/bodies)`);
    } else if (matchingRunFinished.length > 1) {
      problems.push(`${matchingRunFinished.length} captured run_finished events match properties.run_id === "${run.runId}" -- expected exactly one, unambiguous match`);
    } else {
      const props = matchingRunFinished[0]!.properties as Record<string, unknown>;
      const modelId = props.model_id;
      if (typeof modelId !== 'string' || modelId.length === 0) {
        problems.push('the matched run_finished event has no non-empty properties.model_id');
      } else {
        matchedModelId = modelId;
        if (modelId === requestedInvalid) problems.push(`the matched run_finished event's properties.model_id equals the RAW REQUESTED model ("${requestedInvalid}") -- run.model still records pre-resolution input`);
        if (!resolvedGuess) problems.push('no requested/resolved field pair found on the run yet, so resolved-vs-telemetry cannot be cross-checked');
        else if (modelId !== resolvedGuess) problems.push(`the matched run_finished event's properties.model_id ("${modelId}") does not equal the persisted resolved model ("${resolvedGuess}")`);
        if (executedModel && modelId !== executedModel) problems.push(`the matched run_finished event's properties.model_id ("${modelId}") does not equal the INDEPENDENTLY-observed executed model ("${executedModel}") -- telemetry may match a self-reported "resolved" value without matching what actually ran`);
      }
    }
    record('C1-5', 'local PostHog stub, strict run_finished/run_id-bound envelope', 'exactly one run_finished event matches properties.run_id; on it alone, properties.model_id equals the resolved AND independently-observed executed model, never the raw requested one', problems.length === 0, `capturedBodyCount=${capture.bodies.length}\ntotalEnvelopeEvents=${allEnvelopeEvents.length}\nmatchingRunFinishedCount=${matchingRunFinished.length}\nmatchedModelId=${matchedModelId}\nresolvedGuess=${String(resolvedGuess)}\nexecutedModel=${executedModel}\nfirstBody=${capture.bodies[0]?.slice(0, 800) ?? '(none)'}`, { detail: problems.length ? problems.join('; ') : undefined });
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
// ROUND 1 FIX (finding 4): "the verifier accepts either concurrent run
// failing for any reason... an implementation that simply breaks one model
// always passes." Two SEQUENTIAL solo controls now run FIRST, each model
// alone with no overlap, and must both succeed with correct self-observation
// -- this is the overlap-specific failure oracle: if the concurrent pair's
// hard-fail branch fires, the failing label's OWN solo control must have
// succeeded, proving the failure is concurrency-specific rather than an
// implementation that unconditionally breaks that one model regardless of
// contention. If a solo control itself fails, the whole criterion fails
// with a distinguishing message rather than silently treating the harness
// as broken.
// -----------------------------------------------------------------------
await checkCriterion('C1-6', 'two SEQUENTIAL solo antigravity runs (positive controls, no overlap) + two concurrent antigravity runs (different concrete models) via a verifier-owned fake agy with a deliberate pre-read delay', 'both solo controls succeed with correct self-observation; the concurrent pair shows no cross-run model contamination, and any hard-fail is bound to a label whose SOLO run succeeded (concurrency-specific, not an unconditional per-model break)', async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w1-agy-race-home-'));
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'agy', FAKE_AGY_SCRIPT);
  const daemon = await bootDaemon({ homeDir, extraPathDirs: [fakeBinDir], extraEnv: { FAKE_AGY_DELAY_MS: '250' } });
  try {
    const projectId = await createProject(daemon.url, randomNonce(8));
    const labelA = 'Claude Sonnet 4.6 (Thinking)';
    const labelB = 'Gemini 3.1 Pro (High)';
    function observedModel(msg: MessageRow | null): string | null {
      return msg?.content?.startsWith('AGY_OBSERVED_MODEL: ') ? msg.content.slice('AGY_OBSERVED_MODEL: '.length).trim() : null;
    }
    const problems: string[] = [];

    // Solo controls: sequential, no overlap, each on its own conversation so
    // there is no shared-conversation side effect between them.
    const soloA = await startRun(daemon.url, { projectId, agentId: 'antigravity', model: labelA, message: randomNonce(10) });
    const soloStatusA = await pollRunTerminal(daemon.url, soloA.runId, 30_000);
    const soloObservedA = observedModel(readMessageRow(daemon.dataDir, soloA.assistantMessageId));
    const soloB = await startRun(daemon.url, { projectId, agentId: 'antigravity', model: labelB, message: randomNonce(10) });
    const soloStatusB = await pollRunTerminal(daemon.url, soloB.runId, 30_000);
    const soloObservedB = observedModel(readMessageRow(daemon.dataDir, soloB.assistantMessageId));
    const soloAOk = soloStatusA.status === 'succeeded' && soloObservedA === labelA;
    const soloBOk = soloStatusB.status === 'succeeded' && soloObservedB === labelB;
    if (!soloAOk) problems.push(`solo control for labelA failed outside any concurrency (status=${soloStatusA.status}, observed=${soloObservedA}) -- the harness itself, or an unconditional per-model break, not concurrency, is the problem`);
    if (!soloBOk) problems.push(`solo control for labelB failed outside any concurrency (status=${soloStatusB.status}, observed=${soloObservedB}) -- the harness itself, or an unconditional per-model break, not concurrency, is the problem`);

    // Concurrent pair: the actual race probe.
    const [runA, runB] = await Promise.all([
      startRun(daemon.url, { projectId, agentId: 'antigravity', model: labelA, message: randomNonce(10) }),
      startRun(daemon.url, { projectId, agentId: 'antigravity', model: labelB, message: randomNonce(10) }),
    ]);
    const [statusA, statusB] = await Promise.all([
      pollRunTerminal(daemon.url, runA.runId, 30_000),
      pollRunTerminal(daemon.url, runB.runId, 30_000),
    ]);
    const observedA = observedModel(readMessageRow(daemon.dataDir, runA.assistantMessageId));
    const observedB = observedModel(readMessageRow(daemon.dataDir, runB.assistantMessageId));
    // A hard-fail on the second spawn is also an acceptable outcome per the
    // wave doc ("or hard-fail the spawn"); detect it via a non-succeeded
    // terminal status paired with the OTHER run staying clean AND bind it to
    // the failing label's own solo control having succeeded (finding 4).
    const bHardFailed = statusB.status === 'failed' && observedA === labelA;
    const aHardFailed = statusA.status === 'failed' && observedB === labelB;
    if (bHardFailed && !soloBOk) problems.push('labelB failed in the concurrent pair, but labelB ALSO failed in its own solo (non-concurrent) control -- this is an unconditional per-model break, not overlap-specific serialization, and does not satisfy C1-6');
    if (aHardFailed && !soloAOk) problems.push('labelA failed in the concurrent pair, but labelA ALSO failed in its own solo (non-concurrent) control -- this is an unconditional per-model break, not overlap-specific serialization, and does not satisfy C1-6');
    const overlapSpecificHardFail = (bHardFailed && soloBOk) || (aHardFailed && soloAOk);
    const noContamination = (observedA === labelA && observedB === labelB) || overlapSpecificHardFail;
    if (!noContamination) problems.push(`cross-contamination: requested A=${labelA} B=${labelB}, observed A=${observedA} B=${observedB} -- the settings.json race was not closed`);
    record('C1-6', 'sequential solo controls x2 + concurrent fake agy x2, deliberate race window', 'solo controls succeed; concurrent pair shows no cross-contamination, and any hard-fail is bound to a label whose solo run succeeded', problems.length === 0, `soloA: status=${soloStatusA.status} observed=${soloObservedA}\nsoloB: status=${soloStatusB.status} observed=${soloObservedB}\nlabelA=${labelA} observedA=${observedA} statusA=${statusA.status}\nlabelB=${labelB} observedB=${observedB} statusB=${statusB.status}`, { detail: problems.length ? problems.join('; ') : undefined });
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
// ROUND 1 FIX (finding 5): both runs request a REAL, current, listed Claude
// model id ('claude-sonnet-4-5') and carry their usage numbers in the
// PROMPT instead (usageMarkerPrompt / FAKE_CLAUDE_SCRIPT's stdin-marker
// decode path). The project aggregate check is MANDATORY.
// CEREMONY ROUND FIX (ruling items 1 + 6): round 2's retry/resume/cache-
// inclusive/multi-lane additions were rejected as insufficient evidence --
// "a comment is not an executable retry probe; a second ordinary run
// sharing conversationId is not lifecycle resume; and directly invoking the
// Codex extractor does not prove that the future cost route consumes its
// result" (ruling finding 1) -- and the aggregate oracle accepted any
// numeric leaf equal to the expected sum (ruling finding 6). This section
// now:
//   - builds a REAL same-run retry probe directly on
//     apps/daemon/tests/run-retry-runtime.test.ts's deterministic shape
//     (dedicated daemon, stateful fake claude);
//   - replaces the same-conversation pair with a genuine resumable-failure
//     + real `od run continue` flow directly on apps/daemon/tests/
//     run-resume-on-failure.test.ts's shape (dedicated daemon);
//   - replaces the direct extractCodexLastTurnFirstCallUsage import/call
//     with a verifier-owned fake Codex through the real daemon, isolated
//     CODEX_HOME, and a REAL rollout file (dedicated daemon) -- this also
//     absorbs the old MULTI-LANE aggregate/partiality check;
//   - replaces the any-leaf-matches-the-sum aggregate scan with
//     findAggregateCandidates/readAggregateAtPath: exactly one unambiguous,
//     project-scoped, non-run-anchored, aggregate-and-money-shaped field
//     path, discovered ONCE against the main run1/run2 project and REUSED
//     (by path string, queried against each dedicated daemon's own
//     project) across retry/resume/Codex/restart.
// The accepted daemon-restart design/mechanism itself is UNCHANGED (ceremony
// ruling: "The restart design is accepted and remains closed").
// -----------------------------------------------------------------------
function additiveEffectiveInput(input: number, cacheRead: number, cacheCreation: number): number {
  return input + cacheRead + cacheCreation;
}
// Path-validated aggregate-field-rule (ruling item 6). Candidates are found
// ONLY in the project-scoped response, EXCLUDING any object that itself
// carries one of `excludeRunIds` as one of its own values (the per-run cost
// records the findRunNumberField lookups above already bind to -- an
// aggregate must live somewhere else in the shape). A candidate's full,
// normalized (camelCase/snake_case/kebab-case-insensitive) field path must
// contain at least one token from {total,aggregate,project} AND one from
// {cost,spend}, and a USD signal must appear either in the path itself or as
// a sibling `currency:"USD"` field on the SAME object the leaf lives on. The
// leaf itself must be one finite, nonnegative number (or a numeric-looking
// string at that same path). Zero or multiple ambiguous candidates both fail
// -- this is deliberately a single, unambiguous, path-anchored oracle, never
// "any leaf that happens to equal the sum."
interface AggregateCandidate { path: string; value: number }
function normalizePathToken(seg: string): string {
  return seg.replace(/[_-]/g, '').toLowerCase();
}
function findAggregateCandidates(root: unknown, excludeRunIds: string[]): AggregateCandidate[] {
  const out: AggregateCandidate[] = [];
  const AGGREGATE_TOKENS = ['total', 'aggregate', 'project'];
  const MONEY_TOKENS = ['cost', 'spend'];
  function objectCarriesRunId(obj: Record<string, unknown>): boolean {
    return excludeRunIds.some((id) => Object.values(obj).includes(id));
  }
  function pushIfCandidate(segPath: string[], numeric: number, siblingObj: Record<string, unknown>): void {
    const normalizedFull = segPath.map(normalizePathToken).join('.');
    const hasAggregateToken = AGGREGATE_TOKENS.some((t) => normalizedFull.includes(t));
    const hasMoneyToken = MONEY_TOKENS.some((t) => normalizedFull.includes(t));
    if (!hasAggregateToken || !hasMoneyToken) return;
    const siblingCurrencyUsd = Object.entries(siblingObj).some(([kk, vv]) => /currency/i.test(kk) && typeof vv === 'string' && vv.toUpperCase() === 'USD');
    if (siblingCurrencyUsd || normalizedFull.includes('usd')) out.push({ path: segPath.join('.'), value: numeric });
  }
  function walk(node: unknown, pathSegs: string[]): void {
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, [...pathSegs, String(i)])); return; }
    if (!isRecord(node)) return;
    if (objectCarriesRunId(node)) return;
    for (const [k, v] of Object.entries(node)) {
      const segPath = [...pathSegs, k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) pushIfCandidate(segPath, v, node);
      else if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) pushIfCandidate(segPath, Number(v), node);
      else walk(v, segPath);
    }
  }
  walk(root, []);
  return out;
}
function readAggregateAtPath(root: unknown, fieldPath: string): number | null {
  let cur: unknown = root;
  for (const seg of fieldPath.split('.')) {
    if (Array.isArray(cur)) cur = cur[Number(seg)];
    else if (isRecord(cur)) cur = cur[seg];
    else return null;
  }
  if (typeof cur === 'number' && Number.isFinite(cur)) return cur;
  if (typeof cur === 'string' && /^\d+(\.\d+)?$/.test(cur)) return Number(cur);
  return null;
}
function projectRouteUrl(baseUrl: string, routePath: string, projectId: string): string {
  return `${baseUrl}${routePath.replace(/:\w+/, encodeURIComponent(projectId))}`;
}
// Used by the Codex cache-inclusive probe: navigates to the FIRST object
// anywhere in `root` that mentions `runId` as one of its own values (reusing
// findRunScopedRecord), then searches that object's ENTIRE subtree for the
// first numeric field whose key exactly matches one of `candidateNames` --
// so a field nested one level deeper than the run-id-bearing object itself
// (e.g. run.usage.inputTokensEffective) is still found, without falling
// back to an unrelated global field.
function findNamedNumberInSubtree(root: unknown, candidateNames: string[], _seen: Set<unknown> = new Set()): number | null {
  if (!isRecord(root) && !Array.isArray(root)) return null;
  if (_seen.has(root)) return null;
  _seen.add(root);
  if (isRecord(root)) {
    for (const name of candidateNames) {
      const v = root[name];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
    for (const v of Object.values(root)) {
      const hit = findNamedNumberInSubtree(v, candidateNames, _seen);
      if (hit !== null) return hit;
    }
    return null;
  }
  for (const v of root as unknown[]) {
    const hit = findNamedNumberInSubtree(v, candidateNames, _seen);
    if (hit !== null) return hit;
  }
  return null;
}
function findRunScopedNamedNumber(root: unknown, runId: string, candidateNames: string[]): number | null {
  const scoped = findRunScopedRecord(root, runId);
  if (!scoped) return null;
  return findNamedNumberInSubtree(scoped, candidateNames);
}
const C17_KNOWN_MODEL = 'claude-sonnet-4-5';
const usageRouteFilesForC17 = findUsageRouteFiles();
// Same-run retry fake claude (ruling item 1a): fails BEFORE FIRST TOKEN with
// the exact transient-503 shape apps/daemon/tests/run-retry-runtime.test.ts's
// writeFlakyClaude uses -- the daemon's own EXISTING, already-shipped retry
// policy recognizes this and retries once, same-run. Attempt 0 emits nothing
// (no usage) so a correct cost route must charge attempt 1's controlled
// usage exactly once.
function writeRetryProbeClaude(dir: string, name: string, usage: ProbeUsage, costUsd: number): string {
  const bin = path.join(dir, name);
  const counterPath = path.join(dir, `${name}-attempts`);
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const counterPath = ${JSON.stringify(counterPath)};
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write(${JSON.stringify(`1.0.${randomNonce(4)}`)} + '\\n'); process.exit(0); }
if (args.includes('--help')) { process.stdout.write('Usage: claude -p\\n'); process.exit(0); }
if (args.includes('auth')) { process.stdout.write('Logged in (fixture)\\n'); process.exit(0); }
let attempts = 0;
try { attempts = Number(fs.readFileSync(counterPath, 'utf8')) || 0; } catch {}
fs.writeFileSync(counterPath, String(attempts + 1));
function line(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }
if (attempts === 0) {
  process.stderr.write('HTTP 503 Service Unavailable: upstream provider unavailable before first token.\\n');
  setTimeout(() => process.exit(1), 20);
} else {
  line({ type: 'system', subtype: 'init', model: ${JSON.stringify(C17_KNOWN_MODEL)} });
  line({ type: 'assistant', message: { id: 'msg_retry', role: 'assistant', content: [{ type: 'text', text: 'recovered after retry' }], stop_reason: 'end_turn' } });
  line({ type: 'result', subtype: 'success', usage: ${JSON.stringify(usage)}, total_cost_usd: ${JSON.stringify(costUsd)}, duration_ms: 5, stop_reason: 'end_turn' });
  setTimeout(() => process.exit(0), 30);
}
`;
  fs.writeFileSync(bin, script);
  fs.chmodSync(bin, 0o755);
  return bin;
}
// Lifecycle-resume fake claude (ruling item 1b): mirrors apps/daemon/tests/
// run-resume-on-failure.test.ts's writeResumableClaude -- attempt 0 commits
// a tool_use (a real resume boundary), emits a NON-error `result` usage
// event carrying controlled failed-turn usage (safe: claude-stream.ts's
// result handler only escalates to a terminal `error` event when
// `is_error===true`, so this is purely additive and does not interfere with
// the daemon's separate stderr-driven resumable-failure classification),
// then fails with an upstream drop. Every later invocation succeeds.
// Records argv per invocation so the criterion can assert --session-id /
// --resume.
function writeResumeProbeClaude(dir: string, name: string, failUsage: ProbeUsage, failCostUsd: number, resumeUsage: ProbeUsage, resumeCostUsd: number): { bin: string; argsLogPath: string } {
  const bin = path.join(dir, name);
  const counterPath = path.join(dir, `${name}-attempts`);
  const argsLogPath = path.join(dir, `${name}-args.jsonl`);
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const counterPath = ${JSON.stringify(counterPath)};
const argsLogPath = ${JSON.stringify(argsLogPath)};
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write(${JSON.stringify(`1.0.${randomNonce(4)}`)} + '\\n'); process.exit(0); }
if (args.includes('--help')) { process.stdout.write('Usage: claude -p\\n'); process.exit(0); }
if (args.includes('auth')) { process.stdout.write('Logged in (fixture)\\n'); process.exit(0); }
let attempts = 0;
try { attempts = Number(fs.readFileSync(counterPath, 'utf8')) || 0; } catch {}
fs.writeFileSync(counterPath, String(attempts + 1));
fs.appendFileSync(argsLogPath, JSON.stringify(args) + '\\n');
function line(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }
line({ type: 'system', subtype: 'init', model: ${JSON.stringify(C17_KNOWN_MODEL)} });
if (attempts === 0) {
  line({ type: 'assistant', message: { id: 'msg_resume0', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_resume0', name: 'Bash', input: { command: 'echo working' } }], stop_reason: 'tool_use' } });
  // EMPIRICALLY CONFIRMED (scratchpad probe-resume.mjs, live daemon):
  // stop_reason MUST be 'tool_use' here. apps/daemon/src/runtimes/
  // chat-run-lifecycle.ts's applyClaudeStreamJsonRunBookkeeping treats ANY
  // 'usage' stream event whose stopReason !== 'tool_use' as a terminal turn
  // and marks run.turnCompletedCleanly=true UNLESS isError===true -- a bare
  // usage-carrying result with no stop_reason (what a naive "safe, additive"
  // event looked like on paper) got silently classified as a clean
  // completion, which classifyChatRunCloseStatus then turns into
  // 'succeeded' even though the process still exits 1 with the 503 stderr
  // right after -- resumable never got set. Fresh empirical confirmation
  // this round, not carried from a prior round's finding.
  line({ type: 'result', usage: ${JSON.stringify(failUsage)}, total_cost_usd: ${JSON.stringify(failCostUsd)}, duration_ms: 5, stop_reason: 'tool_use' });
  process.stderr.write('Upstream request failed: HTTP 503 stream disconnected before completion.\\n');
  setTimeout(() => process.exit(1), 20);
} else {
  line({ type: 'assistant', message: { id: 'msg_resume', role: 'assistant', content: [{ type: 'text', text: 'recovered after resume' }], stop_reason: 'end_turn' } });
  line({ type: 'result', subtype: 'success', usage: ${JSON.stringify(resumeUsage)}, total_cost_usd: ${JSON.stringify(resumeCostUsd)}, duration_ms: 5, stop_reason: 'end_turn' });
  setTimeout(() => process.exit(0), 30);
}
`;
  fs.writeFileSync(bin, script);
  fs.chmodSync(bin, 0o755);
  return { bin, argsLogPath };
}
function readClaudeArgvLog(file: string): string[][] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line) as string[]; } catch { return []; } });
}
function flagValueFromArgv(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] ?? null : null;
}
// Cache-inclusive fake Codex (ruling item 1c): through the REAL daemon,
// writes a REAL rollout file under an isolated CODEX_HOME with codex's own
// real shape (`payload.type==='task_started'` resets, then
// `payload.type==='token_count'` carrying `info.last_token_usage.
// {input_tokens,cached_input_tokens}`, where input_tokens is INCLUSIVE of
// the cached subset), and emits enough of codex's real stream protocol
// (thread.started with a fresh session UUID, an agent_message, turn.
// completed) for the run to succeed through json-event-stream.ts's real,
// unmodified codex parser.
function writeFakeCodexRolloutScript(dir: string, name: string, rolloutInputTokens: number, rolloutCachedTokens: number): string {
  const bin = path.join(dir, name);
  const script = `#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write(${JSON.stringify(`1.0.${randomNonce(4)}`)} + '\\n'); process.exit(0); }
if (args[0] === 'login' && args[1] === 'status') { process.stdout.write('Logged in (fixture)\\n'); process.exit(0); }
if (args[0] === 'debug' && args[1] === 'models') { process.stdout.write(JSON.stringify({ models: [] }) + '\\n'); process.exit(0); }
const threadId = crypto.randomUUID();
function line(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const now = new Date();
const yyyy = String(now.getUTCFullYear());
const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
const dd = String(now.getUTCDate()).padStart(2, '0');
const sessDir = path.join(codexHome, 'sessions', yyyy, mm, dd);
fs.mkdirSync(sessDir, { recursive: true });
const rolloutPath = path.join(sessDir, 'rollout-' + now.toISOString().replace(/[:.]/g, '') + '-' + threadId + '.jsonl');
const rolloutLines = [
  JSON.stringify({ payload: { type: 'task_started' } }),
  JSON.stringify({ payload: { type: 'token_count', info: { last_token_usage: { input_tokens: ${JSON.stringify(rolloutInputTokens)}, cached_input_tokens: ${JSON.stringify(rolloutCachedTokens)} } } } }),
];
fs.writeFileSync(rolloutPath, rolloutLines.join('\\n') + '\\n');
line({ type: 'thread.started', thread_id: threadId });
line({ type: 'turn.started' });
line({ type: 'item.completed', item: { type: 'agent_message', text: 'fake codex reply ' + threadId } });
line({ type: 'turn.completed', usage: { input_tokens: ${JSON.stringify(rolloutInputTokens)}, output_tokens: 50, cached_input_tokens: ${JSON.stringify(rolloutCachedTokens)} } });
setTimeout(() => process.exit(0), 30);
`;
  fs.writeFileSync(bin, script);
  fs.chmodSync(bin, 0o755);
  return bin;
}
await checkCriterion('C1-7', 'two different-sized fake-claude runs on a REAL known model id in one project (read through apps/daemon/src/routes/usage*.ts) + a dedicated same-run retry probe + a dedicated lifecycle-resume probe (real od run continue) + a dedicated cache-inclusive fake-Codex probe + a real daemon restart, all bound to ONE path-validated aggregate field', 'per-run cost differs proportionately with token volume; a project aggregate has exactly one unambiguous aggregate-and-money-shaped field path and equals the exact sum; a same-run retry charges the successful attempt exactly once; a resumable failure + real od run continue binds both turns\' usage exactly once each; a fake Codex proves cache-inclusive accounting via the real usage route; the accepted field survives a daemon restart', async () => {
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
  // `daemon` is reassigned by the restart scenario below (same dataDir, new
  // process); `retryDaemon`/`resumeDaemon`/`codexDaemon` are each a fresh,
  // dedicated daemon+project (mirroring the two reference test files' own
  // "fresh startServer() per scenario" pattern) so their stateful fakes
  // never cross-talk with run1/run2 or each other. The outer `finally` kills
  // whichever of these are non-null.
  let daemon = await bootDaemon({ extraPathDirs: [fakeBinDir] });
  let retryDaemon: BootedDaemon | null = null;
  let resumeDaemon: BootedDaemon | null = null;
  let codexDaemon: BootedDaemon | null = null;
  try {
    const projectId = await createProject(daemon.url, randomNonce(8));
    // Run 1: small, no cache tokens. Real model id; no self-reported
    // total_cost_usd (left at 0), so a pass here can only mean the NEW
    // meter computed cost from normalized token counts, not merely echoed a
    // provider figure.
    const usage1 = { input_tokens: 200, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const run1 = await startRun(daemon.url, { projectId, agentId: 'claude', model: C17_KNOWN_MODEL, message: usageMarkerPrompt(usage1, 0) });
    const status1 = await pollRunTerminal(daemon.url, run1.runId);
    // Run 2: large, WITH additive cache tokens (cache_read > 0, distinct
    // input) -- the exact shape whose naive/inclusive misreading the wave
    // doc calls out. Same real model id as run1, so any cost difference
    // MUST come from token-volume accounting, not a model-id switch.
    const usage2 = { input_tokens: 4000, output_tokens: 800, cache_creation_input_tokens: 300, cache_read_input_tokens: 900 };
    const run2 = await startRun(daemon.url, { projectId, agentId: 'claude', model: C17_KNOWN_MODEL, message: usageMarkerPrompt(usage2, 0) });
    const status2 = await pollRunTerminal(daemon.url, run2.runId);

    const projectRoute = getRoutes.find((r) => r.routePath.includes(':') && /project/i.test(r.routePath)) ?? getRoutes.find((r) => r.routePath.includes(':'));
    const globalRoute = getRoutes.find((r) => !r.routePath.includes(':'));
    const perRun1 = projectRoute ? await httpJson('GET', projectRouteUrl(daemon.url, projectRoute.routePath, projectId)) : null;
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

      // CEREMONY ROUND FIX (ruling item 6): exactly one unambiguous,
      // path-validated aggregate candidate, never "any leaf equal to the
      // sum." The accepted path is RECORDED and REUSED (by path string,
      // queried against each dedicated daemon's own response) below.
      let acceptedFieldPath: string | null = null;
      if (cost1 !== null && cost2 !== null) {
        const expectedSum = cost1 + cost2;
        const candidates = findAggregateCandidates(body, [run1.runId, run2.runId]);
        if (candidates.length === 0) {
          problems.push('no aggregate-and-money-shaped, project-scoped, non-run-anchored field found in the project usage response (needed: a field path containing one of {total,aggregate,project} AND one of {cost,spend}, with a USD signal in the path or a sibling currency:"USD")');
        } else if (candidates.length > 1) {
          problems.push(`${candidates.length} ambiguous aggregate-field candidates found (${JSON.stringify(candidates.map((c) => c.path))}) -- expected exactly one unambiguous candidate`);
        } else {
          const candidate = candidates[0]!;
          if (Math.abs(candidate.value - expectedSum) > 1e-6) {
            problems.push(`the one unambiguous aggregate candidate ("${candidate.path}" = ${candidate.value}) does not equal cost1+cost2 (${expectedSum})`);
          } else {
            acceptedFieldPath = candidate.path;
          }
        }
      }

      let lifecycleAggregate = cost1 !== null && cost2 !== null ? cost1 + cost2 : null;
      if (acceptedFieldPath && lifecycleAggregate !== null && projectRoute) {
        const fieldPath = acceptedFieldPath;

        // DAEMON RESTART (accepted design, unchanged mechanism -- ceremony
        // ruling: "The restart design is accepted and remains closed"):
        // kill this instance, boot a SECOND one pointed at the SAME
        // dataDir, and requery the accepted field path on the NEW process.
        const dataDirBeforeRestart = daemon.dataDir;
        await daemon.kill();
        daemon = await bootDaemon({ dataDir: dataDirBeforeRestart, extraPathDirs: [fakeBinDir] });
        const postRestartResp = await httpJson('GET', projectRouteUrl(daemon.url, projectRoute.routePath, projectId));
        if (postRestartResp.status !== 200) {
          problems.push(`DAEMON RESTART: GET ${projectRoute.routePath} on the restarted daemon did not return 200 (status=${postRestartResp.status}) -- cost data did not survive the restart`);
        } else {
          const postRestartAggregate = readAggregateAtPath(postRestartResp.json, fieldPath);
          if (postRestartAggregate === null || Math.abs(postRestartAggregate - lifecycleAggregate) > 1e-6) {
            problems.push(`DAEMON RESTART: the accepted aggregate field ("${fieldPath}") after a real process restart (same dataDir) reads ${postRestartAggregate}, expected cost1+cost2 (${lifecycleAggregate}) -- cost data did not survive the restart`);
          }
        }

        // SAME-RUN RETRY (ruling item 1a).
        const retryFakeBinDir = mkFakeBinDir();
        const retryUsage = { input_tokens: 500, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
        writeRetryProbeClaude(retryFakeBinDir, 'claude', retryUsage, 0);
        retryDaemon = await bootDaemon({ extraPathDirs: [retryFakeBinDir] });
        const retryProjectId = await createProject(retryDaemon.url, randomNonce(8));
        const retryRun = await startRun(retryDaemon.url, { projectId: retryProjectId, agentId: 'claude', model: C17_KNOWN_MODEL, message: randomNonce(10) });
        const retryStatus = await pollRunTerminal(retryDaemon.url, retryRun.runId, 20_000);
        const retryEvents = await readRunEventsViaSse(retryDaemon.url, retryRun.runId, 15_000);
        const retryStarts = retryEvents.filter((e) => e.event === 'start');
        const retryEnds = retryEvents.filter((e) => e.event === 'end');
        const retryAttempted = retryEvents.filter((e) => e.event === 'run_retry_attempted');
        const retryFinished = retryEvents.filter((e) => e.event === 'run_retry_finished');
        if (retryStatus.status !== 'succeeded') problems.push(`RETRY: run status="${String(retryStatus.status)}", expected "succeeded"`);
        if (retryStarts.length !== 2) problems.push(`RETRY: ${retryStarts.length} 'start' events, expected exactly 2`);
        if (retryEnds.length !== 1) problems.push(`RETRY: ${retryEnds.length} terminal 'end' events, expected exactly 1`);
        if (retryAttempted.length !== 1) {
          problems.push(`RETRY: ${retryAttempted.length} 'run_retry_attempted' events, expected exactly 1`);
        } else if (!matchesObjectSubset(retryAttempted[0]!.data, { run_id: retryRun.runId, retry_of_run_id: retryRun.runId, retry_attempt_index: 1, retry_strategy: 'same_run_transient', retry_reason: 'transient_failure' })) {
          problems.push(`RETRY: run_retry_attempted event does not match the expected shape (got ${JSON.stringify(retryAttempted[0]!.data)})`);
        }
        if (retryFinished.length !== 1) {
          problems.push(`RETRY: ${retryFinished.length} 'run_retry_finished' events, expected exactly 1`);
        } else if (!matchesObjectSubset(retryFinished[0]!.data, { run_id: retryRun.runId, retry_of_run_id: retryRun.runId, retry_attempt_index: 1, retry_result: 'success' })) {
          problems.push(`RETRY: run_retry_finished event does not match the expected shape (got ${JSON.stringify(retryFinished[0]!.data)})`);
        }
        const retryUsageResp = await httpJson('GET', projectRouteUrl(retryDaemon.url, projectRoute.routePath, retryProjectId));
        if (retryUsageResp.status !== 200) {
          problems.push(`RETRY: GET ${projectRoute.routePath} on the retry-probe project did not return 200 (status=${retryUsageResp.status})`);
        } else {
          const retryCost = findRunNumberField(retryUsageResp.json, retryRun.runId, /cost|price|usd|spend/i);
          if (retryCost === null) {
            problems.push(`RETRY: no numeric cost/price field bound to the retry-probe run's id (${retryRun.runId})`);
          } else {
            const retryAggregate = readAggregateAtPath(retryUsageResp.json, fieldPath);
            if (retryAggregate === null) problems.push(`RETRY: no value at the accepted aggregate field path ("${fieldPath}") in the retry-probe project's usage response`);
            else if (Math.abs(retryAggregate - retryCost) > 1e-6) problems.push(`RETRY: project aggregate (${retryAggregate}) does not equal exactly the one successful attempt's own cost (${retryCost}) in a project containing only that one run -- attempt 0's (unemitted) usage was charged, or the successful attempt was double-counted`);
          }
        }

        // LIFECYCLE RESUME (ruling item 1b).
        const resumeFakeBinDir = mkFakeBinDir();
        const failUsage = { input_tokens: 400, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
        const resumeUsage = { input_tokens: 250, output_tokens: 90, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
        const { argsLogPath: resumeArgsLogPath } = writeResumeProbeClaude(resumeFakeBinDir, 'claude', failUsage, 0, resumeUsage, 0);
        resumeDaemon = await bootDaemon({ extraPathDirs: [resumeFakeBinDir] });
        const resumeProjectId = await createProject(resumeDaemon.url, randomNonce(8));
        // EMPIRICALLY CONFIRMED (scratchpad probe-resume.mjs): `model` is
        // deliberately OMITTED here. `od run continue` (cli.ts's `case
        // 'continue'`) never sends a `model` field in its POST body, so the
        // continuation always resolves the daemon's own default model.
        // agent-session-resume.ts's evaluateResumeInvalidation rejects a
        // resume the instant storedModel !== currentModel ("model_changed")
        // -- requesting a concrete model on turn 1 while turn 2 is
        // necessarily model-less guarantees that mismatch and silently
        // forces a from-scratch session every time, live-confirmed against
        // the real daemon this round (argv never carried --resume until
        // both turns omitted model).
        const failedRun = await startRun(resumeDaemon.url, { projectId: resumeProjectId, agentId: 'claude', message: randomNonce(10) });
        const failedStatus = await pollRunTerminal(resumeDaemon.url, failedRun.runId, 20_000);
        if (failedStatus.status !== 'failed') problems.push(`RESUME: first turn status="${String(failedStatus.status)}", expected "failed"`);
        if (failedStatus.resumable !== true) problems.push(`RESUME: first turn resumable=${String(failedStatus.resumable)}, expected true`);
        const nativeRecovery = failedStatus.nativeSessionRecovery;
        if (!isRecord(nativeRecovery) || nativeRecovery.state !== 'captured_not_resumed') problems.push(`RESUME: first turn nativeSessionRecovery.state="${isRecord(nativeRecovery) ? String(nativeRecovery.state) : '(absent)'}", expected "captured_not_resumed"`);
        const continueResp = odCli(resumeDaemon.url, resumeDaemon.dataDir, ['run', 'continue', failedRun.runId, '--json'], {}, 30_000);
        let continueJson: unknown = null;
        // EMPIRICALLY CONFIRMED (scratchpad probe): `od run continue --json`
        // (cli.ts's `case 'continue'`) writes ONE pretty-printed
        // (2-space-indented) JSON.stringify block as its entire --json
        // stdout, not a single compact line -- the "last non-empty line"
        // trick this file uses elsewhere for CLI outputs with unknown
        // shape (e.g. C1-8's boundKey command) would only capture a bare
        // "}" here and silently fail to parse. Parse the whole trimmed
        // stdout directly.
        try { continueJson = JSON.parse(continueResp.stdout.trim()); } catch { continueJson = null; }
        const continuedRunId = isRecord(continueJson) && typeof continueJson.runId === 'string' ? continueJson.runId : null;
        if (continueResp.status !== 0 || !continuedRunId) {
          problems.push(`RESUME: real \`od run continue ${failedRun.runId} --json\` failed (exit=${continueResp.status}): ${continueResp.stdout.slice(-500)}${continueResp.stderr.slice(-500)}`);
        } else if (continuedRunId === failedRun.runId) {
          problems.push('RESUME: od run continue returned the SAME run id as the failed run -- expected a different, new run id');
        } else {
          const continuedStatus = await pollRunTerminal(resumeDaemon.url, continuedRunId, 20_000);
          if (continuedStatus.status !== 'succeeded') problems.push(`RESUME: continued run status="${String(continuedStatus.status)}", expected "succeeded"`);
          if (continuedStatus.projectId !== resumeProjectId) problems.push(`RESUME: continued run's projectId ("${String(continuedStatus.projectId)}") does not match the original ("${resumeProjectId}")`);
          if (continuedStatus.conversationId !== failedStatus.conversationId) problems.push(`RESUME: continued run's conversationId ("${String(continuedStatus.conversationId)}") does not match the failed run's ("${String(failedStatus.conversationId)}")`);
          const argvLog = readClaudeArgvLog(resumeArgsLogPath);
          const firstSessionId = argvLog[0] ? flagValueFromArgv(argvLog[0], '--session-id') : null;
          if (!firstSessionId) problems.push('RESUME: first invocation\'s argv carries no --session-id');
          if (argvLog.length < 2) {
            problems.push(`RESUME: fake CLI was invoked ${argvLog.length} time(s), expected at least 2 (original + continued)`);
          } else {
            const secondResumeId = flagValueFromArgv(argvLog[1]!, '--resume');
            if (!secondResumeId) problems.push(`RESUME: second invocation's argv carries no --resume flag (argv=${JSON.stringify(argvLog[1])})`);
            else if (secondResumeId !== firstSessionId) problems.push(`RESUME: second invocation's --resume value ("${secondResumeId}") does not equal the first invocation's --session-id ("${firstSessionId}")`);
          }
          const resumeUsageResp = await httpJson('GET', projectRouteUrl(resumeDaemon.url, projectRoute.routePath, resumeProjectId));
          if (resumeUsageResp.status !== 200) {
            problems.push(`RESUME: GET ${projectRoute.routePath} on the resume-probe project did not return 200 (status=${resumeUsageResp.status})`);
          } else {
            const failedCost = findRunNumberField(resumeUsageResp.json, failedRun.runId, /cost|price|usd|spend/i);
            const continuedCost = findRunNumberField(resumeUsageResp.json, continuedRunId, /cost|price|usd|spend/i);
            if (failedCost === null) problems.push(`RESUME: no numeric cost bound to the failed run's id (${failedRun.runId}) -- the controlled failed-turn usage was not bound to it`);
            if (continuedCost === null) problems.push(`RESUME: no numeric cost bound to the continued run's id (${continuedRunId})`);
            if (failedCost !== null && continuedCost !== null) {
              const resumeAggregate = readAggregateAtPath(resumeUsageResp.json, fieldPath);
              if (resumeAggregate === null) problems.push(`RESUME: no value at the accepted aggregate field path ("${fieldPath}") in the resume-probe project's usage response`);
              else if (Math.abs(resumeAggregate - (failedCost + continuedCost)) > 1e-6) problems.push(`RESUME: project aggregate (${resumeAggregate}) does not equal failed-turn cost + continued-turn cost (${failedCost + continuedCost})`);
            }
          }
        }

        // CACHE-INCLUSIVE (ruling item 1c). Absent/unwired route below is a
        // NAMED failure (the GET-status/field-lookup problems pushed) --
        // never a substituted pure-function call.
        const codexFakeBinDir = mkFakeBinDir();
        const codexHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w1-verify-codex-home-'));
        const rolloutInputTokens = 1000;
        const rolloutCachedTokens = 400;
        writeFakeCodexRolloutScript(codexFakeBinDir, 'codex', rolloutInputTokens, rolloutCachedTokens);
        codexDaemon = await bootDaemon({ extraPathDirs: [codexFakeBinDir], extraEnv: { CODEX_HOME: codexHomeDir } });
        const codexProjectId = await createProject(codexDaemon.url, randomNonce(8));
        const codexRun = await startRun(codexDaemon.url, { projectId: codexProjectId, agentId: 'codex', model: 'gpt-5.6-codex', message: randomNonce(10), context: {} });
        const codexRunStatus = await pollRunTerminal(codexDaemon.url, codexRun.runId, 30_000);
        if (codexRunStatus.status !== 'succeeded') problems.push(`CACHE-INCLUSIVE: codex run status="${String(codexRunStatus.status)}", expected "succeeded"`);
        const codexUsageResp = await httpJson('GET', projectRouteUrl(codexDaemon.url, projectRoute.routePath, codexProjectId));
        if (codexUsageResp.status !== 200) {
          problems.push(`CACHE-INCLUSIVE: GET ${projectRoute.routePath} on the codex-probe project did not return 200 (status=${codexUsageResp.status}) -- absent/unwired route is a named C1-7 failure`);
        } else {
          const codexEffective = findRunScopedNamedNumber(codexUsageResp.json, codexRun.runId, ['input_tokens_effective', 'inputTokensEffective']);
          const codexCacheRead = findRunScopedNamedNumber(codexUsageResp.json, codexRun.runId, ['cache_read_input_tokens', 'cacheReadInputTokens']);
          if (codexEffective === null) problems.push(`CACHE-INCLUSIVE: no input_tokens_effective/inputTokensEffective field found bound to the codex run (${codexRun.runId})`);
          else if (codexEffective !== rolloutInputTokens) problems.push(`CACHE-INCLUSIVE: codex run's effective input tokens = ${codexEffective}, expected the INCLUSIVE total ${rolloutInputTokens} (codex's own convention already includes the cached subset -- ${rolloutInputTokens + rolloutCachedTokens} would mean double-counting)`);
          if (codexCacheRead === null) problems.push(`CACHE-INCLUSIVE: no cache_read_input_tokens/cacheReadInputTokens field found bound to the codex run (${codexRun.runId})`);
          else if (codexCacheRead !== rolloutCachedTokens) problems.push(`CACHE-INCLUSIVE: codex run's cache_read_input_tokens = ${codexCacheRead}, expected ${rolloutCachedTokens}`);
          const codexScoped = findRunScopedRecord(codexUsageResp.json, codexRun.runId);
          const codexCost = findRunNumberField(codexUsageResp.json, codexRun.runId, /cost|price|usd|spend/i);
          const codexUnavailable = codexScoped ? findPricingUnavailableField(codexScoped) : null;
          if (codexCost === null && !codexUnavailable) problems.push('CACHE-INCLUSIVE: the codex run has neither a numeric cost field nor an honest pricing-unavailable marker bound to its own record');
          const codexAggregate = readAggregateAtPath(codexUsageResp.json, fieldPath);
          if (codexAggregate === null) {
            problems.push(`CACHE-INCLUSIVE: no value at the accepted aggregate field path ("${fieldPath}") in the codex-probe project's usage response -- the codex lane is not participating in the same aggregate rules as the claude runs`);
          } else if (codexCost !== null) {
            if (Math.abs(codexAggregate - codexCost) > 1e-6) problems.push(`CACHE-INCLUSIVE: project aggregate (${codexAggregate}) does not match the codex run's own cost (${codexCost}) in a project containing only that one run`);
          } else {
            const bodyText = JSON.stringify(codexUsageResp.json).toLowerCase();
            const hasPartialityMarker = ['partial', 'incomplete', 'unavailable', 'unpricedcount', 'unavailablecount'].some((m) => bodyText.includes(m));
            if (!hasPartialityMarker) problems.push('CACHE-INCLUSIVE: no numeric cost was found for the codex run and no partiality/unavailable marker is present -- an unpriced lane must be explained, not silent');
          }
        }
      }
    }
    record('C1-7', `GET ${projectRoute?.routePath ?? '?'} / GET ${globalRoute?.routePath ?? '?'} + daemon restart + dedicated retry/resume/cache-inclusive probes`, 'per-run cost is id-bound and tracks token volume (run2 > run1) on a real, honestly-priceable model id; exactly one unambiguous project-scoped aggregate field exists and mandatorily matches the per-run sum; that same field path survives a restart, a real same-run retry, a real resumable-failure + od run continue, and a real fake-Codex cache-inclusive lane', problems.length === 0, `routes=${JSON.stringify(routes)}\nrun1(id=${run1.runId} status=${status1.status} usage=${JSON.stringify(usage1)})\nrun2(id=${run2.runId} status=${status2.status} usage=${JSON.stringify(usage2)})\nperRun1Body=${perRun1 ? JSON.stringify(perRun1.json).slice(0, 1500) : '(n/a)'}`, { detail: problems.length ? problems.join('; ') : undefined });
  } finally {
    await daemon.kill();
    if (retryDaemon) await retryDaemon.kill();
    if (resumeDaemon) await resumeDaemon.kill();
    if (codexDaemon) await codexDaemon.kill();
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
// ROUND 1 FIX (finding 6): "any new CLI key plus any usage GET route sharing
// one top-level key can pass, with no UI assertion or authoritative-data
// binding... C1-8+C1-14+LEASE are therefore mutually unsatisfiable" because
// `scripts/guard.ts` requires exact SUBCOMMAND_MAP<->capability-manifest.json
// parity and W1 could not edit that manifest. The orchestrator resolved the
// lease impossibility by amending W1's lease to include
// scripts/waves/capability-manifest.json (guard.ts already makes it
// authoritative -- see checkCapabilityManifestParityCore). This gate now:
//   (1) requires a capability-manifest.json ROW for the new capability,
//       structurally bound to one of the ACTUAL discovered usage*.ts GET
//       routes (httpMethod+httpPath, param-name-normalized) -- closing the
//       "admits decoys" hole, since an unrelated new CLI key + unrelated
//       route can no longer pass without a manifest row tying them together;
//   (2) requires that row's `uiEntryPoint` be non-empty prose naming the UI
//       surface -- the same documentation-level UI binding W0's own
//       capability-manifest rows use (a literal Playwright DOM probe would
//       have to assume a UI location this PRD does not specify; matching the
//       house pattern instead of inventing one is a deliberate choice, noted
//       for round 2 in case the reviewer wants a stronger UI assertion);
//   (3) upgrades "share some top-level key" to a genuine value-level
//       identity check: the SAME numeric cost figure for the SAME run must
//       appear through BOTH the CLI and HTTP surfaces (mirrors W0's own
//       C0-10 nonce-binding style, see capability-manifest.json's
//       "artifacts" row `reason` field for the precedent this follows).
// -----------------------------------------------------------------------
const BASELINE_SUBCOMMAND_KEYS = new Set([
  'artifacts', 'media', 'mcp', 'amr', 'message-center', 'research', 'plugin', 'ui', 'marketplace', 'share',
  'brand', 'brands', 'project', 'automation', 'automations', 'memory', 'run', 'files', 'templates', 'conversation',
  'chat', 'deploy', 'daemon', 'atoms', 'skills', 'design-systems', 'craft', 'diagnostics', 'export', 'status',
  'version', 'whats-new', 'doctor', 'config', 'library', 'figma', 'backup', 'restore',
]);
interface CapabilityManifestRowLoose { capability?: unknown; uiEntryPoint?: unknown; httpMethod?: unknown; httpPath?: unknown }
function normalizeRoutePath(p: string): string {
  return p.replace(/:\w+/g, ':param');
}
function loadCapabilityManifestRows(): { rows: CapabilityManifestRowLoose[] } | { error: string } {
  const manifestPath = path.join(repoRoot, 'scripts/waves/capability-manifest.json');
  if (!fs.existsSync(manifestPath)) return { error: 'scripts/waves/capability-manifest.json does not exist' };
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(parsed)) return { error: 'capability-manifest.json is not a top-level JSON array' };
    return { rows: parsed as CapabilityManifestRowLoose[] };
  } catch (err) {
    return { error: `capability-manifest.json is not valid JSON: ${String(err)}` };
  }
}
// CEREMONY ROUND FIX (ruling item 5, "C1-8 manifest-driven UI proof"): round
// 2's UI check crawled three GUESSED pages and scanned the whole body for a
// small fixed set of literal number formats -- "three guessed pages and
// fixed render strings can reject a correct Settings/dedicated-route UI and
// accept unrelated body text" (ruling finding 5). This parses a
// machine-actionable `| verify={...}` suffix out of the manifest row's own
// `uiEntryPoint`, navigates ONLY the declared path, clicks the declared
// activate selectors in order, requires exactly one VISIBLE target, attaches
// network observation BEFORE navigation to confirm the manifest-bound usage
// GET actually fires, and matches the target's rendered text SEMANTICALLY
// (currency marker, decimal/grouping separators, arbitrary precision,
// </ / <= bound forms) against the authoritative HTTP cost.
interface UiEntryPointVerifySpec { path: string; activate: string[]; target: string; currency: string }
function parseUiEntryPointVerifySpec(uiEntryPoint: string): { ok: true; spec: UiEntryPointVerifySpec } | { ok: false; error: string } {
  const marker = '| verify=';
  const idx = uiEntryPoint.indexOf(marker);
  if (idx === -1) return { ok: false, error: 'uiEntryPoint has no "| verify={...}" suffix' };
  const jsonText = uiEntryPoint.slice(idx + marker.length).trim();
  let parsed: unknown;
  try { parsed = JSON.parse(jsonText); } catch (err) { return { ok: false, error: `verify= suffix is not valid JSON: ${String(err)}` }; }
  if (!isRecord(parsed)) return { ok: false, error: 'verify= suffix is not a JSON object' };
  const p = parsed.path;
  const activate = parsed.activate;
  const target = parsed.target;
  const currency = parsed.currency;
  if (typeof p !== 'string' || p.length === 0) return { ok: false, error: 'verify.path is missing or not a non-empty string' };
  if (!p.startsWith('/')) return { ok: false, error: `verify.path ("${p}") must be a same-origin relative path starting with "/"` };
  if (p.includes('://')) return { ok: false, error: `verify.path ("${p}") looks like an external URL, not a same-origin relative path` };
  if (!Array.isArray(activate) || activate.length === 0 || !activate.every((a) => typeof a === 'string' && a.length > 0)) return { ok: false, error: 'verify.activate is missing or not a non-empty array of non-empty strings' };
  if (typeof target !== 'string' || target.length === 0) return { ok: false, error: 'verify.target is missing or not a non-empty string' };
  if (currency !== 'USD') return { ok: false, error: `verify.currency ("${String(currency)}") must be exactly "USD"` };
  const allSelectorsAndPath = [p, ...(activate as string[]), target];
  for (const s of allSelectorsAndPath) {
    const placeholderRe = /\{([a-zA-Z]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = placeholderRe.exec(s))) {
      if (!['projectId', 'conversationId', 'runId'].includes(m[1]!)) return { ok: false, error: `unknown placeholder "{${m[1]}}" in "${s}" -- only {projectId}, {conversationId}, {runId} are permitted` };
    }
    if (/[\n\r]/.test(s)) return { ok: false, error: `"${s}" contains a raw newline -- not a valid path/selector` };
  }
  return { ok: true, spec: { path: p, activate: activate as string[], target, currency: currency as string } };
}
function fillUiEntryPointPlaceholders(template: string, values: { projectId: string; conversationId: string; runId: string }): string {
  return template.replace(/\{projectId\}/g, values.projectId).replace(/\{conversationId\}/g, values.conversationId).replace(/\{runId\}/g, values.runId);
}
// Extracts every number-looking occurrence in `text`, tolerant of the
// currency/separator/precision variance ruling item 5 requires ($/US$/USD
// before or after; '.' or ',' decimal separator; comma/dot/space/NBSP/
// apostrophe grouping; arbitrary displayed precision; </<= bound prefixes).
interface RenderedMoneyMatch { raw: string; value: number; fractionDigits: number; bound: 'exact' | 'lt' | 'lte' }
function extractRenderedMoneyMatches(text: string): RenderedMoneyMatch[] {
  const out: RenderedMoneyMatch[] = [];
  const re = /(<=|≤|<)?\s*(?:\$|US\$|USD)?\s*([0-9][0-9,.\s ']*[0-9]|[0-9])\s*(?:\$|USD)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const boundToken = m[1];
    const numRaw = m[2]!;
    const cleaned = numRaw.replace(/[\s ']/g, '');
    const lastDot = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');
    const decimalIdx = Math.max(lastDot, lastComma);
    let integerPart: string;
    let fractionPart: string;
    if (decimalIdx === -1) {
      integerPart = cleaned;
      fractionPart = '';
    } else {
      const after = cleaned.slice(decimalIdx + 1);
      // Only treat as a decimal separator when 1-4 digits follow (a real
      // fractional amount); otherwise it is pure grouping (e.g. "1,234").
      if (after.length >= 1 && after.length <= 4 && /^[0-9]+$/.test(after)) {
        integerPart = cleaned.slice(0, decimalIdx).replace(/[.,]/g, '');
        fractionPart = after;
      } else {
        integerPart = cleaned.replace(/[.,]/g, '');
        fractionPart = '';
      }
    }
    const numeric = Number(`${integerPart}.${fractionPart || '0'}`);
    if (!Number.isFinite(numeric)) continue;
    out.push({
      raw: m[0],
      value: numeric,
      fractionDigits: fractionPart.length,
      bound: boundToken === '<' ? 'lt' : (boundToken === '<=' || boundToken === '≤') ? 'lte' : 'exact',
    });
  }
  return out;
}
// For a displayed value with `d` fractional digits, accept when the
// authoritative cost is within 0.5*10^-d of it (ruling's exact tolerance
// formula); <N only when strictly below N; <=N only when at most N.
function moneyMatchAcceptsCost(match: RenderedMoneyMatch, authoritativeCost: number): boolean {
  if (match.bound === 'lt') return authoritativeCost < match.value;
  if (match.bound === 'lte') return authoritativeCost <= match.value;
  const tolerance = 0.5 * Math.pow(10, -match.fractionDigits);
  return Math.abs(authoritativeCost - match.value) <= tolerance;
}
await checkCriterion('C1-8', 'cli.ts SUBCOMMAND_MAP diff + capability-manifest.json row binding + apps/daemon/src/routes/usage*.ts route discovery + real od CLI invocation vs real HTTP, value-bound to the same run\'s cost', 'a new CLI subcommand has a capability-manifest.json row structurally bound to a real usage*.ts GET route with a documented UI entry point, and the CLI/HTTP surfaces report the IDENTICAL numeric cost for the same run', async () => {
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
  const getRoutes = routes.filter((r) => r.method === 'GET');
  if (getRoutes.length === 0) {
    record('C1-8', 'static discovery', 'usage*.ts registers a GET route', false, JSON.stringify(routes), { detail: 'no GET route registered in usage*.ts' });
    return;
  }
  const manifest = loadCapabilityManifestRows();
  if ('error' in manifest) {
    record('C1-8', 'capability-manifest.json read', 'capability-manifest.json is readable and a top-level array', false, '', { detail: manifest.error });
    return;
  }
  // Bind: a manifest row whose `capability` is one of the new CLI keys AND
  // whose httpMethod+httpPath structurally matches one of the ACTUAL
  // discovered usage*.ts GET routes (param names normalized). A decoy new
  // key with no manifest row, or a manifest row pointing at an unrelated
  // route, cannot satisfy this.
  let boundKey: string | null = null;
  let boundRoute: { method: string; routePath: string } | null = null;
  let boundRow: CapabilityManifestRowLoose | null = null;
  for (const key of newKeys) {
    const row = manifest.rows.find((r) => r.capability === key);
    if (!row || typeof row.httpMethod !== 'string' || typeof row.httpPath !== 'string') continue;
    const match = getRoutes.find((r) => r.method === row.httpMethod && normalizeRoutePath(r.routePath) === normalizeRoutePath(row.httpPath as string));
    if (match) { boundKey = key; boundRoute = match; boundRow = row; break; }
  }
  if (!boundKey || !boundRoute || !boundRow) {
    record('C1-8', 'capability-manifest.json <-> SUBCOMMAND_MAP <-> usage*.ts route binding', 'a new capability has a manifest row structurally bound to a real usage*.ts GET route', false, `newKeys=${JSON.stringify(newKeys)}\ngetRoutes=${JSON.stringify(getRoutes)}\nmanifestRows(new)=${JSON.stringify(manifest.rows.filter((r) => newKeys.includes(r.capability as string)))}`, { detail: 'no new SUBCOMMAND_MAP key has a capability-manifest.json row whose httpMethod+httpPath matches an actually-registered usage*.ts GET route -- either the manifest was not updated, or it points at a decoy/unrelated route' });
    return;
  }
  if (typeof boundRow.uiEntryPoint !== 'string' || boundRow.uiEntryPoint.trim().length === 0) {
    record('C1-8', 'capability-manifest.json uiEntryPoint', `row for "${boundKey}" documents a non-empty UI entry point`, false, JSON.stringify(boundRow), { detail: `capability-manifest.json row for "${boundKey}" has no non-empty uiEntryPoint -- the UI surface is undocumented` });
    return;
  }
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'claude', FAKE_CLAUDE_SCRIPT);
  const daemon = await bootDaemon({ extraPathDirs: [fakeBinDir] });
  try {
    const projectId = await createProject(daemon.url, randomNonce(8));
    const usage = { input_tokens: 777, output_tokens: 111, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const run = await startRun(daemon.url, { projectId, agentId: 'claude', model: 'claude-sonnet-4-5', message: usageMarkerPrompt(usage, 0) });
    await pollRunTerminal(daemon.url, run.runId);
    const httpUrl = `${daemon.url}${boundRoute.routePath.replace(/:\w+/, encodeURIComponent(projectId))}`;
    const httpResp = await httpJson('GET', httpUrl);
    const cliResp = odCli(daemon.url, daemon.dataDir, [boundKey, '--project', projectId, '--json']);
    let cliJson: unknown = null;
    try { cliJson = JSON.parse(cliResp.stdout.trim().split('\n').filter(Boolean).slice(-1)[0] ?? ''); } catch { cliJson = null; }
    const httpTopKeys = isRecord(httpResp.json) ? Object.keys(httpResp.json).sort() : null;
    const cliTopKeys = isRecord(cliJson) ? Object.keys(cliJson).sort() : null;
    const p2: string[] = [];
    const p2Evidence: Record<string, unknown> = {};
    if (httpResp.status !== 200) p2.push(`GET ${boundRoute.routePath} did not return 200 (status=${httpResp.status})`);
    if (cliResp.status !== 0) p2.push(`od ${boundKey} --json exited ${cliResp.status}: ${cliResp.stderr.slice(0, 500) || cliResp.stdout.slice(0, 500)}`);
    if (!httpTopKeys) p2.push('HTTP response body is not a JSON object');
    if (!cliTopKeys) p2.push(`od ${boundKey} --json did not print a JSON object as its last stdout line`);
    if (httpTopKeys && cliTopKeys) {
      const overlap = httpTopKeys.filter((k) => cliTopKeys.includes(k));
      if (overlap.length === 0) p2.push(`HTTP body keys [${httpTopKeys.join(',')}] and CLI JSON keys [${cliTopKeys.join(',')}] share NO top-level keys -- not the same contract shape`);
    }
    // Value-level identity binding (finding 6: "no authoritative-data
    // binding"): the SAME run's numeric cost must appear through BOTH
    // surfaces, not merely a shared key name.
    const httpCost = httpResp.json !== null ? findRunNumberField(httpResp.json, run.runId, /cost|price|usd|spend/i) : null;
    const cliCost = cliJson !== null ? findRunNumberField(cliJson, run.runId, /cost|price|usd|spend/i) : null;
    if (httpCost === null) p2.push(`no numeric cost/price field bound to run id ${run.runId} found in the HTTP response`);
    if (cliCost === null) p2.push(`no numeric cost/price field bound to run id ${run.runId} found in the CLI --json output`);
    if (httpCost !== null && cliCost !== null && Math.abs(httpCost - cliCost) > 1e-6) p2.push(`HTTP surface reports cost=${httpCost} for run ${run.runId} but the CLI surface reports cost=${cliCost} for the SAME run -- the two surfaces disagree on authoritative data`);

    // CEREMONY ROUND FIX (ruling item 5): round 2 crawled three GUESSED
    // pages and scanned the whole body for a handful of fixed literal
    // number formats -- "three guessed pages and fixed render strings can
    // reject a correct Settings/dedicated-route UI and accept unrelated
    // body text" (ruling finding 5). This now parses a machine-actionable
    // `| verify={...}` suffix out of the manifest row's OWN uiEntryPoint,
    // navigates ONLY the declared path, clicks the declared activate
    // selectors in order, requires exactly one VISIBLE target, attaches
    // network observation BEFORE navigation to confirm the manifest-bound
    // usage GET actually fires, and matches the target's own rendered text
    // SEMANTICALLY against the authoritative HTTP cost.
    if (httpCost !== null) {
      const specResult = parseUiEntryPointVerifySpec(boundRow.uiEntryPoint);
      if (!specResult.ok) {
        p2.push(`UI manifest-driven check: uiEntryPoint's verify= suffix is invalid: ${specResult.error}`);
      } else {
        const spec = specResult.spec;
        const pw = resolvePlaywright();
        if (!pw.ok) {
          p2.push(`UI manifest-driven check skipped: ${pw.error}`);
        } else {
          const fakeBinDir2 = mkFakeBinDir();
          writeFakeBin(fakeBinDir2, 'claude', FAKE_CLAUDE_SCRIPT);
          let webSuite: WebSuiteHandle | null = null;
          let browser: PlaywrightBrowser | null = null;
          try {
            webSuite = await bootWebSuite({ PATH: `${fakeBinDir2}${path.delimiter}${process.env.PATH ?? ''}` });
            const uiProjectResp = await httpJson('POST', `${webSuite.daemonUrl}/api/projects`, { id: randomNonce(8), name: randomNonce(6) });
            const uiProjectId = (uiProjectResp.json as { project?: { id?: string } })?.project?.id;
            if (!uiProjectId) throw new Error(`could not create project via web daemon: ${uiProjectResp.text.slice(0, 300)}`);
            const uiUsage = { input_tokens: 888, output_tokens: 222, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
            const uiRun = await startRun(webSuite.daemonUrl, { projectId: uiProjectId, agentId: 'claude', model: 'claude-sonnet-4-5', message: usageMarkerPrompt(uiUsage, 0) });
            await pollRunTerminal(webSuite.daemonUrl, uiRun.runId);
            const uiHttpUrl = projectRouteUrl(webSuite.daemonUrl, boundRoute.routePath, uiProjectId);
            const uiHttpResp = await httpJson('GET', uiHttpUrl);
            const uiCost = uiHttpResp.json !== null ? findRunNumberField(uiHttpResp.json, uiRun.runId, /cost|price|usd|spend/i) : null;
            if (uiCost === null) {
              p2.push('UI manifest-driven check: could not independently establish a known cost for the web-suite run (HTTP route did not report one) -- cannot verify a rendered value against it');
            } else {
              const placeholderValues = { projectId: uiProjectId, conversationId: uiRun.conversationId, runId: uiRun.runId };
              const resolvedPath = fillUiEntryPointPlaceholders(spec.path, placeholderValues);
              if (resolvedPath.includes('://')) {
                p2.push(`UI manifest-driven check: resolved path "${resolvedPath}" is not a same-origin relative path after placeholder substitution -- refusing to navigate outside the isolated web origin`);
              } else {
                const resolvedActivate = spec.activate.map((a) => fillUiEntryPointPlaceholders(a, placeholderValues));
                const resolvedTarget = fillUiEntryPointPlaceholders(spec.target, placeholderValues);
                browser = await pw.pw.chromium.launch({ headless: true });
                const page = await browser.newPage();
                await seedWebClientConfig(page, 'claude');
                // Network observation attached BEFORE navigation (ruling:
                // "require the surface to issue the manifest-bound usage GET").
                // route.continue() lets the real request proceed unmodified --
                // this observes, it does not mock/fulfill.
                let boundRequestObserved = false;
                const boundPathGlob = `**${normalizeRoutePath(boundRoute.routePath).replace(/:param/g, '*')}*`;
                await page.route(boundPathGlob, async (route) => {
                  if (route.request().method() === 'GET') boundRequestObserved = true;
                  await route.continue();
                });
                await page.goto(`${webSuite.webUrl}${resolvedPath}`, { waitUntil: 'load', timeout: 30_000 });
                for (const sel of resolvedActivate) {
                  const loc = page.locator(sel).first();
                  await loc.waitFor({ timeout: 10_000, state: 'visible' });
                  await loc.click({ timeout: 10_000 });
                }
                await page.locator(resolvedTarget).first().waitFor({ timeout: 15_000, state: 'visible' }).catch(() => {});
                const visibleCount = await page.evaluate((sel: unknown) => {
                  const doc = (globalThis as unknown as { document: any }).document;
                  const getComputed = (globalThis as unknown as { getComputedStyle: (el: any) => any }).getComputedStyle;
                  const nodes = Array.from(doc.querySelectorAll(sel as string)) as any[];
                  return nodes.filter((n) => {
                    const rect = n.getBoundingClientRect();
                    const style = getComputed(n);
                    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                  }).length;
                }, resolvedTarget);
                if (visibleCount !== 1) {
                  p2.push(`UI manifest-driven check: verify.target ("${resolvedTarget}") has ${visibleCount} visible match(es), expected exactly 1`);
                } else {
                  const targetText = await page.locator(resolvedTarget).first().innerText().catch(() => '');
                  const moneyMatches = extractRenderedMoneyMatches(targetText);
                  const accepted = moneyMatches.find((mm) => moneyMatchAcceptsCost(mm, uiCost));
                  if (!accepted) p2.push(`UI manifest-driven check: verify.target's own rendered text ("${targetText.slice(0, 200)}") does not semantically match the authoritative cost (${uiCost}); parsed candidates=${JSON.stringify(moneyMatches)}`);
                  if (!boundRequestObserved) p2.push(`UI manifest-driven check: the manifest-bound usage route (${boundRoute.routePath}) was never observed as a GET request during navigation/activation -- a target rendered without observing the bound API request fails`);
                  p2Evidence.uiTargetText = targetText.slice(0, 200);
                  p2Evidence.uiMoneyMatches = moneyMatches;
                  p2Evidence.uiBoundRequestObserved = boundRequestObserved;
                }
                p2Evidence.uiCost = uiCost;
                p2Evidence.resolvedPath = resolvedPath;
              }
            }
          } catch (err) {
            p2.push(`UI manifest-driven check failed: ${String((err as Error)?.message ?? err)}`);
          } finally {
            try { await browser?.close(); } catch { /* best effort */ }
            try { await webSuite?.stop(); } catch { /* best effort */ }
          }
        }
      }
    }

    record('C1-8', `od ${boundKey} --json vs GET ${boundRoute.routePath}, value-bound to run ${run.runId}, plus a real browser rendered-value check`, 'CLI and HTTP surfaces expose the same cost-meter contract shape AND the identical numeric cost for the same run, AND at least one real page renders the known cost figure', p2.length === 0, `boundKey=${boundKey}\nboundRoute=${JSON.stringify(boundRoute)}\nuiEntryPoint=${boundRow.uiEntryPoint}\nhttpTopKeys=${JSON.stringify(httpTopKeys)}\ncliTopKeys=${JSON.stringify(cliTopKeys)}\nhttpCost=${httpCost}\ncliCost=${cliCost}\n${JSON.stringify(p2Evidence)}\ncliStdout=${cliResp.stdout.slice(-800)}`, { detail: p2.length ? p2.join('; ') : undefined });
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
// ROUND 1 FIX (finding 7): "any unrelated nested 'unavailable' string
// exempts a numeric total from requiring a partial marker" -- the previous
// check treated the substring "unavailable" ANYWHERE in the whole response
// body as proof the unpriced run was correctly flagged, so an implementation
// could stamp `unavailable` on something else entirely (e.g. an unrelated
// enum default) and still pass. The "unavailable" claim is now bound to a
// record that specifically mentions the UNPRICED run's own id
// (findRunScopedRecord), the same run-id-anchoring pattern findRunNumberField
// already uses elsewhere in this file.
// ROUND 2 FIX (finding 7, Sol round-2 F7): round 1's "unavailable" check
// still searched the WHOLE scoped record's stringified JSON for the
// substring "unavailable", so an unrelated field on that same record (e.g.
// an unrelated status enum) could satisfy it. `findPricingUnavailableField`
// now requires a key whose NAME is pricing/cost-shaped (matching
// langfuse-trace.ts's own real `pricing_version`/`cost_status` naming
// convention, confirmed by reading it) AND whose VALUE is exactly
// "unavailable" -- binding to the PRICING FIELD, not any field. The
// rendered-UI half is also now a HARD requirement: round 1 only failed on a
// bare confident zero and let "no unknown/unavailable indication rendered
// at all" pass; it now REQUIRES a qualifying word to be present in the
// unpriced message's rendered text, so absence fails.
// -----------------------------------------------------------------------
function findPricingUnavailableField(record: Record<string, unknown>, _seen: Set<unknown> = new Set()): { key: string; value: string } | null {
  if (_seen.has(record)) return null;
  _seen.add(record);
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === 'string' && v.toLowerCase() === 'unavailable' && /cost|price|pricing/i.test(k)) {
      return { key: k, value: v };
    }
    if (isRecord(v)) {
      const nested = findPricingUnavailableField(v, _seen);
      if (nested) return nested;
    }
  }
  return null;
}
await checkCriterion('C1-9', 'one priced fake-claude run + one unpriced fake-agy run in the same project, read through usage*.ts AND rendered in a real browser', 'the unpriced run\'s OWN record claims unavailable pricing (never a confident $0.00, in the API or the rendered UI), and any numeric project total co-occurs with a partiality marker', async () => {
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
  const problems: string[] = [];
  let unpricedAssistantMessageId: string | null = null;
  try {
    const projectId = await createProject(daemon.url, randomNonce(8));
    const pricedUsage = { input_tokens: 500, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
    const pricedRun = await startRun(daemon.url, { projectId, agentId: 'claude', model: 'claude-sonnet-4-5', message: usageMarkerPrompt(pricedUsage, 0) });
    await pollRunTerminal(daemon.url, pricedRun.runId);
    // antigravity's plain stream carries no usage/cost signal at all --
    // this is a REAL evidence ceiling (streamFormat:'plain'), not a
    // contrived gap, so pricing for this run should legitimately be
    // unavailable.
    const unpricedRun = await startRun(daemon.url, { projectId, agentId: 'antigravity', model: 'Gemini 3.1 Pro (High)', message: randomNonce(10) });
    await pollRunTerminal(daemon.url, unpricedRun.runId, 15_000);
    unpricedAssistantMessageId = unpricedRun.assistantMessageId;

    const httpUrl = `${daemon.url}${projectRoute.routePath.replace(/:\w+/, encodeURIComponent(projectId))}`;
    const resp = await httpJson('GET', httpUrl);
    if (resp.status !== 200) {
      problems.push(`GET ${projectRoute.routePath} did not return 200 (status=${resp.status})`);
    } else {
      const bodyText = JSON.stringify(resp.json);
      const pricedCost = findRunNumberField(resp.json, pricedRun.runId, /cost|price|usd|spend/i);
      const unpricedScoped = findRunScopedRecord(resp.json, unpricedRun.runId);
      const unpricedPricingField = unpricedScoped ? findPricingUnavailableField(unpricedScoped) : null;
      if (pricedCost === null) problems.push(`no numeric cost/price field bound to the PRICED run's id (${pricedRun.runId}) -- a known-usage run should have a real numeric cost`);
      if (!unpricedScoped) problems.push(`no record in the response mentions the unpriced run's own id (${unpricedRun.runId}) -- cannot bind the "unavailable" claim to that specific run`);
      else if (!unpricedPricingField) problems.push(`the unpriced run's OWN record (${JSON.stringify(unpricedScoped).slice(0, 300)}) has no pricing/cost-shaped field whose value is exactly "unavailable" -- an unrelated field, or a value merely CONTAINING "unavailable", does not count`);
      // A bare "$0.00"/0 total with no partial/unavailable marker anywhere
      // alongside it would misrepresent a confident zero -- check that SOME
      // partiality signal co-occurs with a numeric total.
      const hasNumericTotal = /"total(_usd)?"\s*:\s*[\d.]/i.test(bodyText) || /"cost_usd"\s*:\s*[\d.]/i.test(bodyText);
      const partialityMarkers = ['partial', 'incomplete', 'isPartial', 'unpricedCount', 'unavailableCount', 'complete":false', 'complete\\":false'];
      const hasPartialityMarker = partialityMarkers.some((m) => bodyText.toLowerCase().includes(m.toLowerCase()));
      if (hasNumericTotal && !hasPartialityMarker) {
        problems.push('response reports a numeric total with no partiality marker alongside it -- a mixed known/unknown project must not present a bare confident total');
      }
    }
  } finally {
    await daemon.kill();
    try { fs.rmSync(homeDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  // Rendered-UI half (finding 7: "never checks the rendered $0.00/unknown
  // UI"). Reuses C1-2/C1-11's established per-message DOM anchor
  // (`data-assistant-message-id`) since the PRD does not name a dedicated
  // cost-dashboard page/selector -- checking the message the unpriced run
  // itself produced is the one UI location this file can bind without
  // guessing an unspecified location.
  const pw = resolvePlaywright();
  if (!pw.ok || !unpricedAssistantMessageId) {
    problems.push(`UI check skipped: ${pw.ok ? 'no unpriced assistant message id captured' : pw.error}`);
  } else {
    let webSuite: WebSuiteHandle | null = null;
    let browser: PlaywrightBrowser | null = null;
    try {
      const fakeBinDir2 = mkFakeBinDir();
      writeFakeBin(fakeBinDir2, 'claude', FAKE_CLAUDE_SCRIPT);
      writeFakeBin(fakeBinDir2, 'agy', FAKE_AGY_SCRIPT);
      webSuite = await bootWebSuite({ PATH: `${fakeBinDir2}${path.delimiter}${process.env.PATH ?? ''}`, FAKE_AGY_DELAY_MS: '20' });
      const projectResp = await httpJson('POST', `${webSuite.daemonUrl}/api/projects`, { id: randomNonce(8), name: randomNonce(6) });
      const projectId = (projectResp.json as { project?: { id?: string } })?.project?.id;
      if (!projectId) throw new Error(`could not create project via web daemon: ${projectResp.text.slice(0, 300)}`);
      const unpricedRun = await startRun(webSuite.daemonUrl, { projectId, agentId: 'antigravity', model: 'Gemini 3.1 Pro (High)', message: randomNonce(10) });
      await pollRunTerminal(webSuite.daemonUrl, unpricedRun.runId, 15_000);
      browser = await pw.pw.chromium.launch({ headless: true });
      const page = await browser.newPage();
      await seedWebClientConfig(page, 'antigravity');
      await page.goto(`${webSuite.webUrl}/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(unpricedRun.conversationId)}`, { waitUntil: 'load', timeout: 30_000 });
      const selector = `[data-assistant-message-id="${unpricedRun.assistantMessageId}"]`;
      const locator = page.locator(selector);
      let found = false;
      try { await locator.waitFor({ timeout: 15_000 }); found = (await locator.count()) > 0; } catch { found = false; }
      if (!found) {
        problems.push(`the unpriced run's rendered message node (${selector}) did not appear within 15s -- cannot verify a rendered unknown/unavailable pricing indication`);
      } else {
        const text = await locator.first().innerText({ timeout: 5_000 }).catch(() => '');
        // ROUND 2 FIX (finding 7): round 1 only failed on a bare confident
        // zero and silently PASSED when no cost indication rendered at all.
        // A qualifying word is now REQUIRED -- absence fails. Deliberately
        // narrowed to "unavailable"/"unknown" only (dropping generic
        // punctuation like "--"/an em-dash/"n/a" from round 1's draft) --
        // this message's OTHER rendered chrome (footer buttons, etc.,
        // confirmed empirically via C1-2's own DOM probe evidence) is free-
        // form and a bare em-dash or hyphen pair is common enough in
        // ordinary UI punctuation to false-positive; "unavailable"/"unknown"
        // match the actual convention already used elsewhere in this
        // codebase (langfuse-trace.ts's own literal `'unavailable'`).
        const hasQualifier = /unavailable|unknown/i.test(text);
        const bareZero = /\$\s?0(\.0{1,2})?(?!\d)/.test(text) && !hasQualifier;
        if (bareZero) problems.push(`the unpriced run's rendered message node shows a bare zero-cost figure with no qualifying word nearby: "${text.slice(0, 200)}"`);
        if (!hasQualifier) problems.push(`the unpriced run's rendered message node shows NO unknown/unavailable pricing indication at all (text: "${text.slice(0, 200)}") -- absence of a rendered indication is a failure, not merely a bare zero`);
      }
    } catch (err) {
      problems.push(`UI check failed: ${String((err as Error)?.message ?? err)}`);
    } finally {
      try { await browser?.close(); } catch { /* best effort */ }
      try { await webSuite?.stop(); } catch { /* best effort */ }
    }
  }

  record('C1-9', `GET ${projectRoute.routePath} + rendered DOM`, 'the unpriced run\'s own record claims unavailable pricing (API and UI), never a bare confident $0.00; any numeric total co-occurs with a partiality marker', problems.length === 0, problems.join('\n') || 'no problems', { detail: problems.length ? problems.join('; ') : undefined });
});

// -----------------------------------------------------------------------
// C1-10 -- Kimi tool failure CANNOT terminate as success. Property test
// shape (VERIFICATION-CONTRACT R3/R4): an empirical dry run of this exact
// harness during authoring proved that `isError:true` on a kimi tool_result
// event does not by itself flip the RUN's overall status today (nothing
// currently wires per-tool isError into run-level success/failure
// classification at all). The one true R4 CONTROL here is `posControl` (a
// clean run with no failing tool call), which must stay "succeeded" --
// proving the fix doesn't fail every kimi run indiscriminately.
// ROUND 1 FIX (finding 8, part 1): `od run watch <runId> --json` is bound
// to a SPECIFIC, already-HTTP-confirmed run id (not a fresh run the CLI
// itself started), so a CLI that exits nonzero unconditionally cannot pass.
// CEREMONY ROUND FIX (ruling item 4): round 2 always ran every failure on
// `Write` and the ONE success on `Read` -- "permits a fail-all-Write
// implementation" (ruling finding 4). This now runs MATCHED
// success/failure PAIRS across Read/Write/Edit/Bash (buildKimiProbePairs,
// CSPRNG-shuffled order -- see its own comment above), asserting BOTH the
// HTTP-confirmed status AND a bound `od run watch` exit code for EVERY
// probe (not just one sampled pair), plus an explicit assertion that the
// mandatory defeating pair (a failing Read + a successful Write) actually
// ran.
// -----------------------------------------------------------------------
await checkCriterion('C1-10', 'matched success/failure fake-kimi pairs across Read/Write/Edit/Bash (CSPRNG-shuffled order, combinatorial failure content, one exact-marker Bash control), each independently CLI-followed via `od run watch` bound to its own HTTP-confirmed status', 'every failing pair (any tool identity, including a failing Read paired with a successful Write) ends up "failed" with a nonzero `od run watch` exit bound to that SPECIFIC run; every successful pair ends up "succeeded" with a zero exit', async () => {
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'kimi', FAKE_KIMI_SCRIPT);
  const daemon = await bootDaemon({ extraPathDirs: [fakeBinDir] });
  try {
    const projectId = await createProject(daemon.url, randomNonce(8));
    const specs = buildKimiProbePairs();
    interface KimiProbeResult { spec: KimiProbeSpec; runId: string; httpStatus: string; watchExit: number }
    const probeResults: KimiProbeResult[] = [];
    for (const spec of specs) {
      const run = await startRun(daemon.url, { projectId, agentId: 'kimi', model: encodeKimiProbeSpec(spec), message: randomNonce(10) });
      const status = await pollRunTerminal(daemon.url, run.runId, 15_000);
      // `od run watch <runId> --json` is bound to a SPECIFIC, already-HTTP-
      // confirmed run id -- not a fresh run the CLI itself started -- so a
      // pass here can only mean the CLI's own exit code genuinely reflects
      // THAT run's terminal status (confirmed by reading streamRunEvents():
      // no exit-code wiring for run failure exists anywhere in cli.ts
      // today, it reads the SSE stream and returns unconditionally on
      // `event:end`).
      const watch = odCli(daemon.url, daemon.dataDir, ['run', 'watch', run.runId, '--json'], {}, 20_000);
      probeResults.push({ spec, runId: run.runId, httpStatus: String(status.status), watchExit: watch.status });
    }

    const problems: string[] = [];
    for (const pr of probeResults) {
      const label = `tool=${pr.spec.tool} ok=${pr.spec.ok} run=${pr.runId} content="${pr.spec.content.slice(0, 80)}"`;
      if (pr.spec.ok) {
        if (pr.httpStatus !== 'succeeded') problems.push(`${label}: resolved to status="${pr.httpStatus}", expected "succeeded"`);
        if (pr.watchExit !== 0) problems.push(`${label}: od run watch --json exited ${pr.watchExit}, expected 0`);
      } else {
        if (pr.httpStatus !== 'failed') problems.push(`${label}: resolved to status="${pr.httpStatus}", expected "failed" -- the guard does not generalize across tool identities/content shapes`);
        if (pr.watchExit === 0) problems.push(`${label}: od run watch --json exited 0, expected nonzero -- the CLI does not surface this run's failure via its exit code`);
      }
    }
    // The mandatory defeating case (ruling item 4): a failing Read paired
    // with a successful Write must both have actually run.
    const readFail = probeResults.find((pr) => pr.spec.tool === 'Read' && !pr.spec.ok);
    const writeSuccess = probeResults.find((pr) => pr.spec.tool === 'Write' && pr.spec.ok);
    if (!readFail || !writeSuccess) problems.push('the mandatory cross-tool defeating pair (a failing Read + a successful Write) was not exercised by buildKimiProbePairs()');
    const cliInfoResp = readFail ? odCli(daemon.url, daemon.dataDir, ['run', 'info', readFail.runId, '--json']) : null;
    let cliInfoJson: unknown = null;
    try { cliInfoJson = cliInfoResp ? JSON.parse(cliInfoResp.stdout) : null; } catch { cliInfoJson = null; }
    if (readFail) {
      const cliAgreesFailed = isRecord(cliInfoJson) && cliInfoJson.status === 'failed';
      if (cliInfoResp?.status !== 0) problems.push(`od run info --json exited ${cliInfoResp?.status} unexpectedly for the failing-Read probe`);
      if (!cliAgreesFailed) problems.push(`od run info --json reports status="${isRecord(cliInfoJson) ? String(cliInfoJson.status) : '(unparseable)'}" for the failing-Read probe, expected "failed"`);
    }
    record('C1-10', 'matched success/failure fake-kimi pairs (Read/Write/Edit/Bash) + od run info/watch --json bound to each probe\'s own run', 'every failing pair (any tool identity) fails with a nonzero od run watch exit bound to that run; every successful pair succeeds with a zero exit; the failing-Read/succeeding-Write defeating pair ran', problems.length === 0, `specs=${JSON.stringify(specs)}\nprobeResults=${JSON.stringify(probeResults)}\ncliInfoJson=${JSON.stringify(cliInfoJson)}`, { detail: problems.length ? problems.join('; ') : undefined });
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
// violation. Sol's round-1 ruling did not dispute this constraint, only that
// the bespoke check must be a REAL computed-accessibility audit and must
// cover picker + substituted + unverified states.
// ROUND 1 FIX (finding 1): the previous bespoke probe hand-rolled
// `aria-label || innerText` and only checked ONE state (substituted). It is
// replaced with `computedAxNodeForSelector` (defined above, near
// resolvePlaywright), which queries Chromium's own CDP `Accessibility`
// domain -- the SAME engine axe-core and Lighthouse query -- for a genuine
// computed role/name/ignored-state per node (empirically confirmed live
// that `page.accessibility.snapshot()`, the older wrapper this file
// originally reached for, has been REMOVED from the installed
// @playwright/test@1.60.0: `page.accessibility` is `undefined`).
// ROUND 2 REWRITE (finding 1, Sol round-2 F1):
//   - substituted/unverified: round 1 only checked that the MESSAGE
//     CONTAINER itself had a nonempty computed name -- a container with NO
//     explicit naming mechanism legitimately gets an empty computed name
//     even when its rendered TEXT clearly shows the substitution (that is
//     exactly what round 1's own evidence showed: role="generic", name="").
//     `findNamedDescendantAx` (defined above) instead walks the message's
//     full accessibility SUBTREE for a descendant control whose computed
//     name actually CONTAINS the requested model, the resolved/executed
//     model (ground-truthed via the fake CLI's own echo, same technique as
//     C1-1/C1-2/C1-5), or the "unverified" state word -- proving some real,
//     accessible control names the state/models, not merely that some node
//     somewhere is nonempty.
//   - picker: ruling 4 requires this HARD, reached from `/` (EntryShell),
//     matching e2e/ui/entry-topbar.test.ts's own pattern -- not the
//     conversation route (round 1's silent no-render was an artifact of
//     probing the wrong route). `/api/agents` is intercepted with a fake
//     available agent (mirroring e2e's `routeAgents` helper) so the check
//     is not gated on live agent-detection timing outside its own boundary
//     under test (accessibility of the picker, not agent-detection speed).
//     Absence is now a hard failure, not informational.
// CEREMONY ROUND FIX (ruling item 2): round 2 only EXCLUDED `none`/
// `presentation` (an allowlist-by-exclusion), so `generic`, `statictext`,
// `heading`, `paragraph`, and `group` all still passed -- "a named generic,
// StaticText, heading, paragraph, or presentation node proves that text
// entered the AX tree, not that the claimed state-bearing semantic node/
// control is accessible" (ruling finding 2). Replaced with an explicit,
// lowercase-normalized ALLOWLIST per role class; every role outside it now
// fails, including the ones round 2 let through. The existing computed-name/
// model/state checks above each role check are unchanged.
// -----------------------------------------------------------------------
const STATE_BEARING_ALLOWED_ROLES = new Set(['button', 'link', 'status', 'alert']);
const PICKER_ALLOWED_ROLES = new Set(['button', 'combobox']);
function axRoleViolation(ax: { role: string | null; ignored: boolean }, allowed: Set<string>, label: string): string | null {
  if (ax.ignored) return `${label}: node is \`ignored\` by the accessibility tree`;
  const normalizedRole = (ax.role ?? '').toLowerCase();
  if (!allowed.has(normalizedRole)) return `${label}: computed role is "${ax.role}", not in the allowed set {${[...allowed].join('|')}} (ceremony ruling item 2 -- generic/statictext/heading/paragraph/group/none/presentation all fail)`;
  return null;
}
await checkCriterion('C1-11', 'CDP Accessibility-domain computed audit across THREE states: a named descendant control inside the substituted message, a named descendant control inside the unverified (codex, no-echo) message, and the model picker reached from / per the e2e house pattern', 'the substituted message has a descendant control whose computed accessible name contains BOTH the requested and resolved model; the unverified message has one naming "unverified"; the picker is present, visible, and has a non-empty computed accessible name with no generic/none/presentation role', async () => {
  const pw = resolvePlaywright();
  if (!pw.ok) {
    record('C1-11', 'Playwright resolution', 'chromium is launchable', false, '', { detail: pw.error });
    return;
  }
  const fakeBinDir = mkFakeBinDir();
  writeFakeBin(fakeBinDir, 'claude', FAKE_CLAUDE_SCRIPT);
  let webSuite: WebSuiteHandle | null = null;
  let browser: PlaywrightBrowser | null = null;
  const problems: string[] = [];
  const evidence: Record<string, unknown> = {};
  try {
    const codexFetch = ensureMockRecordings('codex');
    webSuite = await bootWebSuite({
      PATH: `${fakeBinDir}${path.delimiter}${MOCKS_BIN}${path.delimiter}${process.env.PATH ?? ''}`,
      OD_MOCKS_TRACE: C1_4_FIXED_CODEX_TRACE,
      OD_MOCKS_NO_DELAY: '1',
    });
    const projectResp = await httpJson('POST', `${webSuite.daemonUrl}/api/projects`, { id: randomNonce(8), name: randomNonce(6) });
    const projectId = (projectResp.json as { project?: { id?: string } })?.project?.id;
    if (!projectId) throw new Error(`could not create project: ${projectResp.text.slice(0, 300)}`);

    const substitutedModel = invalidModelId();
    const substitutedRun = await startRun(webSuite.daemonUrl, { projectId, agentId: 'claude', model: substitutedModel, message: randomNonce(10) });
    await pollRunTerminal(webSuite.daemonUrl, substitutedRun.runId);
    // Independent ground truth for the resolved/executed model, same
    // technique as C1-1/C1-2/C1-5: FAKE_CLAUDE_SCRIPT always emits "fake
    // claude reply for <executedModel>" as the assistant text.
    const substitutedMsg = readMessageRow(webSuite.dataDir, substitutedRun.assistantMessageId);
    const executedMatch = /^fake claude reply for (.+)$/.exec(substitutedMsg?.content ?? '');
    const executedModel = executedMatch?.[1] ?? null;
    if (!executedModel) problems.push('substituted state: could not independently observe the executed model from the fake CLI\'s own echoed reply text');

    let unverifiedRun: { runId: string; conversationId: string; assistantMessageId: string } | null = null;
    if (codexFetch.ok) {
      unverifiedRun = await startRun(webSuite.daemonUrl, { projectId, agentId: 'codex', model: 'gpt-5.6-codex', message: randomNonce(10), context: {} });
      await pollRunTerminal(webSuite.daemonUrl, unverifiedRun.runId, 30_000);
    } else {
      problems.push(`unverified-state probe skipped: could not fetch a codex mock recording: ${codexFetch.error}`);
    }

    browser = await pw.pw.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await seedWebClientConfig(page, 'claude');

    // (1) substituted state -- reuses the conversation the substituted run
    // landed in.
    await page.goto(`${webSuite.webUrl}/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(substitutedRun.conversationId)}`, { waitUntil: 'load', timeout: 30_000 });
    const substitutedSelector = `[data-assistant-message-id="${substitutedRun.assistantMessageId}"]`;
    let substitutedFound = false;
    try { await page.locator(substitutedSelector).waitFor({ timeout: 15_000 }); substitutedFound = (await page.locator(substitutedSelector).count()) > 0; } catch { substitutedFound = false; }
    if (!substitutedFound) {
      problems.push(`substituted state: no ${substitutedSelector} node rendered within 15s -- substitution UI surface not present yet`);
    } else {
      const requestedAx = await findNamedDescendantAx(page, substitutedSelector, substitutedModel);
      evidence.substitutedRequestedAx = requestedAx;
      if (!requestedAx) problems.push(`substituted state: no accessible descendant control's computed name contains the requested model ("${substitutedModel}")`);
      else { const v = axRoleViolation(requestedAx, STATE_BEARING_ALLOWED_ROLES, 'substituted state (requested-model control)'); if (v) problems.push(v); }
      if (executedModel) {
        const resolvedAx = await findNamedDescendantAx(page, substitutedSelector, executedModel);
        evidence.substitutedResolvedAx = resolvedAx;
        if (!resolvedAx) problems.push(`substituted state: no accessible descendant control's computed name contains the resolved/executed model ("${executedModel}")`);
        else { const v = axRoleViolation(resolvedAx, STATE_BEARING_ALLOWED_ROLES, 'substituted state (resolved-model control)'); if (v) problems.push(v); }
      }
    }

    // (2) unverified state -- same conversation-page pattern, codex lane.
    // "unverified" is the PRD's own display-state vocabulary (the same
    // literal C1-4 already asserts as a persisted enum value), so it is the
    // most grounded needle available pre-implementation for what an
    // accessible label would say.
    if (unverifiedRun) {
      await page.goto(`${webSuite.webUrl}/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(unverifiedRun.conversationId)}`, { waitUntil: 'load', timeout: 30_000 });
      const unverifiedSelector = `[data-assistant-message-id="${unverifiedRun.assistantMessageId}"]`;
      let unverifiedFound = false;
      try { await page.locator(unverifiedSelector).waitFor({ timeout: 15_000 }); unverifiedFound = (await page.locator(unverifiedSelector).count()) > 0; } catch { unverifiedFound = false; }
      if (!unverifiedFound) {
        problems.push(`unverified state: no ${unverifiedSelector} node rendered within 15s`);
      } else {
        const ax = await findNamedDescendantAx(page, unverifiedSelector, 'unverified');
        evidence.unverified = ax;
        if (!ax) problems.push('unverified state: no accessible descendant control\'s computed name contains "unverified"');
        else { const v = axRoleViolation(ax, STATE_BEARING_ALLOWED_ROLES, 'unverified state'); if (v) problems.push(v); }
      }
    }

    // (3) picker state (ruling 4, MUST be hard) -- reached from `/`
    // (EntryShell), matching e2e/ui/entry-topbar.test.ts's own pattern, with
    // `/api/agents` intercepted (mirroring e2e's `routeAgents` helper) so
    // this check is not gated on live agent-detection timing outside its
    // own boundary under test.
    await page.route('**/api/agents**', async (route) => {
      if (route.request().method() !== 'GET') { await route.fallback(); return; }
      await route.fulfill({
        json: {
          agents: [{
            id: 'claude', name: 'Claude Code', bin: 'claude', available: true, version: 'fake-verifier',
            path: '/fake/verifier/claude', models: [{ id: 'claude-sonnet-4-5', label: 'claude-sonnet-4-5' }],
          }],
        },
      });
    });
    await page.goto(`${webSuite.webUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const pickerSelector = '[data-testid="inline-model-switcher-chip"]';
    let pickerVisible = false;
    try { await page.locator(pickerSelector).waitFor({ timeout: 20_000, state: 'visible' }); pickerVisible = (await page.locator(pickerSelector).count()) > 0; } catch { pickerVisible = false; }
    if (!pickerVisible) {
      problems.push(`picker state: [data-testid="inline-model-switcher-chip"] did not become visible within 20s at ${webSuite.webUrl}/ (ruling 4: this is a hard requirement, not informational)`);
    } else {
      const ax = await computedAxNodeForSelector(page, pickerSelector);
      evidence.picker = ax;
      if (!ax) problems.push('picker state: CDP Accessibility.getPartialAXTree returned no node for the picker trigger');
      else {
        if (!ax.name || ax.name.trim().length === 0) problems.push('picker state: computed accessible name is empty');
        const v = axRoleViolation(ax, PICKER_ALLOWED_ROLES, 'picker state');
        if (v) problems.push(v);
      }
    }

    record('C1-11', 'CDP full-tree named-descendant audit (substituted, unverified) + CDP node audit (picker, from /)', 'a real accessible control inside each message names the state/models; the picker is visible with a non-empty computed accessible name', problems.length === 0, JSON.stringify(evidence), { detail: problems.length ? problems.join('; ') : undefined });
  } catch (err) {
    record('C1-11', 'CDP Accessibility-domain probe', 'substitution/unverified/picker surfaces are accessible', false, JSON.stringify(evidence), { detail: `probe failed: ${String((err as Error)?.message ?? err)}${problems.length ? `; also: ${problems.join('; ')}` : ''}` });
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
// ROUND 1 FIXES (finding 9 + orchestrator ruling):
//   - LEASE: the first draft scanned every docs/decisions/*.md file because
//     W1 could not lease docs/decisions/** at all -- Sol's finding 9 called
//     this both unleased and impossible to satisfy honestly. The orchestrator
//     resolved this out-of-band: main's lease is amended to grant W1 EXACTLY
//     two decision paths. This check now grades those two exact paths, not a
//     generic scan -- a decision recorded under any other filename no longer
//     satisfies it (tighter, not looser, than the round-1 version).
//   - PARSER HOLE: the previous `hasDecisionLine` check matched a bare
//     "Decision:" marker ANYWHERE in the doc, then read `text.replace(marker,
//     '').split('\n')[0]` -- since `.replace` without the `g` flag only
//     strips the FIRST occurrence and `.split('\n')[0]` reads line ONE of the
//     WHOLE remaining document (not the line following the matched marker),
//     any doc with an empty "Decision:" line but ANY other non-empty content
//     (e.g. a title) passed. `extractDecisionLineContent` below reads the
//     line immediately after the marker, and only that line.
//   - PREDATES-IMPLEMENTATION PROOF: Sol required proof the decision predated
//     implementation, not just that both now coexist on the branch. This
//     walks `baseCommit..HEAD` in commit order and requires the decision
//     doc's completing commit to be at or before the FIRST commit that
//     touches any file outside docs/decisions/** and this verifier itself --
//     i.e. implementation code landing before (or in the same commit as) a
//     completed decision record fails this half explicitly.
// -----------------------------------------------------------------------
const NM14_DECISION_PATH = 'docs/decisions/gemini-lane.md';
const NM37C_DECISION_PATH = 'docs/decisions/deepseek-path-hygiene.md';
// Reads the content on the line immediately following a "Decision:" marker
// (same line, after the colon, OR the next non-empty line) -- NOT any
// nonempty line elsewhere in the document (finding 9's parser hole).
function extractDecisionLineContent(text: string): string | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? '').trim();
    const isDecisionColon = /^Decision:/i.test(trimmed);
    const isFounderHeading = /^#{1,6}\s*Founder/i.test(trimmed);
    if (!isDecisionColon && !isFounderHeading) continue;
    if (isDecisionColon) {
      const sameLine = trimmed.replace(/^Decision:/i, '').trim();
      if (sameLine.length > 0) return sameLine;
    }
    for (let j = i + 1; j < lines.length; j++) {
      const next = (lines[j] ?? '').trim();
      if (next.length === 0) continue;
      if (/^#{1,6}\s/.test(next)) return null; // hit the next heading with no intervening content
      return next;
    }
    return null;
  }
  return null;
}
await checkCriterion('C1-12', `exact-path read of ${NM14_DECISION_PATH} and ${NM37C_DECISION_PATH}, plus a commit-order proof that each completed before any non-decision implementation commit`, 'both decisions are recorded at their exact leased paths, with an identifiable decision line, and each completes at or before the first implementation commit in this branch; never resolves to a mechanical pass', () => {
  function readDecisionFile(relPath: string): { exists: boolean; decisionText: string | null } {
    const abs = path.join(repoRoot, relPath);
    if (!fs.existsSync(abs)) return { exists: false, decisionText: null };
    return { exists: true, decisionText: extractDecisionLineContent(fs.readFileSync(abs, 'utf8')) };
  }
  const nm14 = readDecisionFile(NM14_DECISION_PATH);
  const nm37c = readDecisionFile(NM37C_DECISION_PATH);
  const problems: string[] = [];
  if (!nm14.exists) problems.push(`${NM14_DECISION_PATH} does not exist`);
  else if (!nm14.decisionText) problems.push(`${NM14_DECISION_PATH} exists but has no identifiable "Decision:"/"## Founder..." line with content on the line immediately following`);
  if (!nm37c.exists) problems.push(`${NM37C_DECISION_PATH} does not exist`);
  else if (!nm37c.decisionText) problems.push(`${NM37C_DECISION_PATH} exists but has no identifiable "Decision:"/"## Founder..." line with content on the line immediately following`);

  // Predates-implementation proof, only meaningful once baseCommit resolved
  // (LEASE's own prerequisites) and only evaluated once both docs are
  // structurally complete -- a missing/incomplete doc already fails above.
  let predatesDetail = '';
  if (problems.length === 0 && baseCommit) {
    const commitList = sh('git', ['log', '--reverse', '--format=%H', `${baseCommit}..HEAD`]);
    const commits = commitList.status === 0 ? commitList.stdout.trim().split('\n').filter(Boolean) : [];
    let decisionCompleteAt: number | null = null;
    let firstImplementationAt: number | null = null;
    for (let i = 0; i < commits.length; i++) {
      const sha = commits[i]!;
      if (decisionCompleteAt === null) {
        const nm14At = readFileAtCommit(sha, NM14_DECISION_PATH);
        const nm37cAt = readFileAtCommit(sha, NM37C_DECISION_PATH);
        const nm14Ok = nm14At.ok && !!extractDecisionLineContent(nm14At.text);
        const nm37cOk = nm37cAt.ok && !!extractDecisionLineContent(nm37cAt.text);
        if (nm14Ok && nm37cOk) decisionCompleteAt = i;
      }
      if (firstImplementationAt === null) {
        const changed = sh('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', sha]);
        const files = changed.status === 0 ? changed.stdout.trim().split('\n').filter(Boolean) : [];
        const hasNonDecisionFile = files.some((f) => f !== 'scripts/waves/verify-w1.ts' && !f.startsWith('docs/decisions/'));
        if (hasNonDecisionFile) firstImplementationAt = i;
      }
    }
    // ROUND 2 FIX (finding 9, Sol round-2 F9): `>` permitted EQUALITY --
    // the decision becoming complete in the SAME commit as the first
    // implementation change -- to pass. That contradicts a strict
    // decision-BEFORE-implementation invariant (VERIFICATION-CONTRACT's own
    // "recorded BEFORE implementation" wording, not "recorded no later
    // than"). `>=` now fails same-commit landings too.
    if (firstImplementationAt !== null && (decisionCompleteAt === null || decisionCompleteAt >= firstImplementationAt)) {
      const sameCommit = decisionCompleteAt !== null && decisionCompleteAt === firstImplementationAt;
      problems.push(`implementation commit ${commits[firstImplementationAt]} touches non-decision files ${sameCommit ? 'in the SAME commit that completes' : 'before'} either decision record in this branch's history (baseCommit..HEAD) -- the decision must STRICTLY predate implementation (an earlier commit), not merely coexist with it or land in the same commit`);
    }
    predatesDetail = `commits=${commits.length} decisionCompleteAt=${decisionCompleteAt} firstImplementationAt=${firstImplementationAt}`;
  } else if (!baseCommit) {
    predatesDetail = 'baseCommit unresolved -- predates-implementation proof skipped (LEASE will already fail for the same reason)';
  }

  const evidence = `nm14=${JSON.stringify(nm14)}\nnm37c=${JSON.stringify(nm37c)}\n${predatesDetail}`;
  if (problems.length > 0) {
    record('C1-12', 'exact-path read + commit-order proof', 'both decision records exist at their exact leased paths, are structurally complete, and predate implementation', 'fail', evidence, { detail: problems.join('; ') });
  } else {
    // R7: even when structurally complete AND provably first, this NEVER
    // auto-passes -- it blocks landing, not the autonomous loop, matching
    // C7-16's pattern.
    record('C1-12', 'exact-path read + commit-order proof', 'both decision records exist at their exact leased paths, are structurally complete, and predate implementation', 'blocked-on-founder', evidence, { detail: 'structurally complete and provably first in commit order; the founder decision itself is never machine-verified as correct, only as recorded and well-ordered' });
  }
});

// -----------------------------------------------------------------------
// C1-13 -- C2-1a: EntryShell.tsx:228 newsletter default de-branded. Reads
// the LANDED file at HEAD (not a diff of the change) per the task brief.
// ROUND 1 ADDITION (finding 10): W1 also carries a SECOND carve-out --
// C2-9a, the AssistantMessage.tsx brand-string correction -- for the same
// structural reason C2-1a lives here: W2 is denied write access to this
// file (it is not in W2's lease; see leases.json's W2 `deny` list and
// §4.1's EntryShell precedent, which this mirrors), so W1 must land it and
// C1-13 is the gate that grades landed-tree carve-outs W1 executes on
// another wave's behalf.
// ROUND 2 FIX (finding 10, Sol round-2 F10, ruling 3): round 1 scanned for
// "open-design.ai", a string class ABSENT from AssistantMessage.tsx --
// vacuously green while the real leak stayed open. The actual live upstream-
// brand egress is `DISCORD_INVITE_URL` (AssistantMessage.tsx:117,
// "https://discord.gg/mHAjSMV6gz"), rendered by two feedback anchors
// (`data-testid="assistant-feedback-discord-positive"/"-negative"`, around
// :2024-2046). This now grades BOTH the constant AND both rendered links: a
// real claude run's completed message is loaded in a browser, the positive
// then negative feedback thumbs are clicked (revealing each note+anchor in
// turn -- confirmed by reading toggleFeedback's toggle logic), and neither
// anchor's actual `href` may resolve to the leaked invite.
// -----------------------------------------------------------------------
const LEAKED_DISCORD_INVITE = 'discord.gg/mHAjSMV6gz';
await checkCriterion('C1-13', 'read apps/web/src/components/EntryShell.tsx (C2-1a: NEWSLETTER_SUBSCRIBE_URL) at HEAD AND click through both AssistantMessage.tsx feedback thumbs in a real browser (C2-9a: DISCORD_INVITE_URL + both rendered feedback links)', 'the C2-1a declaration does not default to open-design.ai, and neither rendered C2-9a feedback link resolves to the leaked Discord invite', async () => {
  const problems: string[] = [];
  const evidenceParts: string[] = [];

  // C2-1a
  const entryShellPath = path.join(repoRoot, 'apps/web/src/components/EntryShell.tsx');
  if (!fs.existsSync(entryShellPath)) {
    problems.push('apps/web/src/components/EntryShell.tsx does not exist');
  } else {
    const text = fs.readFileSync(entryShellPath, 'utf8');
    const match = /const\s+NEWSLETTER_SUBSCRIBE_URL\s*=\s*([\s\S]*?);/.exec(text);
    if (!match) {
      problems.push('no `const NEWSLETTER_SUBSCRIBE_URL = ...;` declaration found in EntryShell.tsx -- file may have been restructured');
    } else {
      const declaration = match[1] ?? '';
      const stillDefaultsToOpenDesign = /open-design\.ai/i.test(declaration);
      if (stillDefaultsToOpenDesign) problems.push('C2-1a: EntryShell.tsx\'s NEWSLETTER_SUBSCRIBE_URL declaration still contains "open-design.ai"');
      evidenceParts.push(`C2-1a declaration: ${declaration}`);
    }
  }

  // C2-9a static half: the DISCORD_INVITE_URL constant itself.
  const assistantMessagePath = path.join(repoRoot, 'apps/web/src/components/AssistantMessage.tsx');
  if (!fs.existsSync(assistantMessagePath)) {
    problems.push('apps/web/src/components/AssistantMessage.tsx does not exist');
  } else {
    const text = fs.readFileSync(assistantMessagePath, 'utf8');
    const match = /const\s+DISCORD_INVITE_URL\s*=\s*([\s\S]*?);/.exec(text);
    if (!match) {
      problems.push('C2-9a: no `const DISCORD_INVITE_URL = ...;` declaration found in AssistantMessage.tsx -- file may have been restructured');
    } else {
      const declaration = match[1] ?? '';
      if (declaration.includes(LEAKED_DISCORD_INVITE)) problems.push(`C2-9a: AssistantMessage.tsx's DISCORD_INVITE_URL declaration still contains the leaked upstream invite ("${LEAKED_DISCORD_INVITE}"): ${declaration}`);
      evidenceParts.push(`C2-9a declaration: ${declaration}`);
    }
  }

  // C2-9a behavioral half: both rendered feedback links, in a real browser.
  const pw = resolvePlaywright();
  if (!pw.ok) {
    problems.push(`C2-9a rendered-link check skipped: ${pw.error}`);
  } else {
    const fakeBinDir = mkFakeBinDir();
    writeFakeBin(fakeBinDir, 'claude', FAKE_CLAUDE_SCRIPT);
    let webSuite: WebSuiteHandle | null = null;
    let browser: PlaywrightBrowser | null = null;
    try {
      webSuite = await bootWebSuite({ PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ''}` });
      const projectResp = await httpJson('POST', `${webSuite.daemonUrl}/api/projects`, { id: randomNonce(8), name: randomNonce(6) });
      const projectId = (projectResp.json as { project?: { id?: string } })?.project?.id;
      if (!projectId) throw new Error(`could not create project: ${projectResp.text.slice(0, 300)}`);
      const run = await startRun(webSuite.daemonUrl, { projectId, agentId: 'claude', model: 'claude-sonnet-4-5', message: randomNonce(10) });
      await pollRunTerminal(webSuite.daemonUrl, run.runId);
      browser = await pw.pw.chromium.launch({ headless: true });
      const page = await browser.newPage();
      await seedWebClientConfig(page, 'claude');
      await page.goto(`${webSuite.webUrl}/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(run.conversationId)}`, { waitUntil: 'load', timeout: 30_000 });
      const messageSelector = `[data-assistant-message-id="${run.assistantMessageId}"]`;
      let messageFound = false;
      try { await page.locator(messageSelector).waitFor({ timeout: 15_000 }); messageFound = (await page.locator(messageSelector).count()) > 0; } catch { messageFound = false; }
      if (!messageFound) {
        problems.push(`C2-9a rendered-link check: no ${messageSelector} node rendered within 15s`);
      } else {
        async function clickAndReadDiscordHref(thumbsTestId: string, anchorTestId: string): Promise<string | null> {
          const thumbsSelector = `${messageSelector} [data-testid="${thumbsTestId}"]`;
          const thumbsLocator = page!.locator(thumbsSelector);
          if ((await thumbsLocator.count()) === 0) return null;
          await thumbsLocator.first().click({ timeout: 5_000 });
          await page!.waitForTimeout(300);
          const anchorSelector = `${messageSelector} [data-testid="${anchorTestId}"]`;
          const anchorLocator = page!.locator(anchorSelector);
          try { await anchorLocator.waitFor({ timeout: 5_000 }); } catch { return null; }
          if ((await anchorLocator.count()) === 0) return null;
          return anchorLocator.first().getAttribute('href');
        }
        const positiveHref = await clickAndReadDiscordHref('assistant-feedback-positive', 'assistant-feedback-discord-positive');
        const negativeHref = await clickAndReadDiscordHref('assistant-feedback-negative', 'assistant-feedback-discord-negative');
        if (positiveHref === null) problems.push('C2-9a: could not reveal the positive-feedback Discord link (thumbs-up control or discord anchor did not render) -- cannot verify it is de-branded');
        else if (positiveHref.includes(LEAKED_DISCORD_INVITE)) problems.push(`C2-9a: the RENDERED positive-feedback Discord link's href is the leaked upstream invite: "${positiveHref}"`);
        if (negativeHref === null) problems.push('C2-9a: could not reveal the negative-feedback Discord link (thumbs-down control or discord anchor did not render) -- cannot verify it is de-branded');
        else if (negativeHref.includes(LEAKED_DISCORD_INVITE)) problems.push(`C2-9a: the RENDERED negative-feedback Discord link's href is the leaked upstream invite: "${negativeHref}"`);
        evidenceParts.push(`C2-9a rendered hrefs: positive=${positiveHref} negative=${negativeHref}`);
      }
    } catch (err) {
      problems.push(`C2-9a rendered-link check failed: ${String((err as Error)?.message ?? err)}`);
    } finally {
      try { await browser?.close(); } catch { /* best effort */ }
      try { await webSuite?.stop(); } catch { /* best effort */ }
    }
  }

  record('C1-13', 'C2-1a: regex over the landed NEWSLETTER_SUBSCRIBE_URL declaration; C2-9a: DISCORD_INVITE_URL declaration + both rendered feedback links clicked in a real browser', 'neither carve-out leaves a live brand-leak: no open-design.ai default, and no rendered/declared Discord link resolves to the leaked invite', problems.length === 0, evidenceParts.join('\n'), { detail: problems.length ? problems.join('; ') : undefined });
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

// =============================================================================
// CEREMONY ROUND FIX (ruling item 8): reread and verify every artifact +
// the manifest itself before trusting anything just written; only THEN
// atomically promote latest-run COPIES to the canonical proof/manifest.json
// / manifest.sha256.txt paths (copy, never move/rename the archived
// originals -- "canonical replacement must never alter archived files");
// finally, re-verify every file the startup snapshot already found archived
// by a PRIOR invocation is still byte-identical. Any violation anywhere in
// this chain forces a nonzero exit regardless of the criteria results
// above.
// =============================================================================
function verifyArchiveIntegrity(criteria: CriterionResult[], writtenManifestPath: string, writtenManifestWroteOk: boolean, expectedManifestSha256: string): string[] {
  const violations: string[] = [];
  if (!writtenManifestWroteOk) { violations.push('run manifest.json was not written successfully to the archive directory'); return violations; }
  const rereadManifestSha = sha256FileSafe(writtenManifestPath);
  if (rereadManifestSha !== expectedManifestSha256) violations.push(`rereading ${writtenManifestPath} produced sha256 ${String(rereadManifestSha)}, expected ${expectedManifestSha256} (manifest write did not verify)`);
  for (const r of criteria) {
    if (r.artifact === null || r.artifactSha256 === null) { violations.push(`criterion ${r.id} has no artifact on disk (artifact write failed at record time)`); continue; }
    const rereadSha = sha256FileSafe(r.artifact);
    if (rereadSha === null) violations.push(`criterion ${r.id}'s artifact ${r.artifact} could not be reread from disk`);
    else if (rereadSha !== r.artifactSha256) violations.push(`criterion ${r.id}'s artifact ${r.artifact} rereads as sha256 ${rereadSha}, expected ${r.artifactSha256} (artifact changed after being recorded)`);
  }
  return violations;
}
function promoteCanonicalManifestCopies(archivedManifestPath: string, expectedManifestSha256: string): string | null {
  try {
    const canonicalManifest = path.join(CANONICAL_PROOF_DIR, 'manifest.json');
    const canonicalSha = path.join(CANONICAL_PROOF_DIR, 'manifest.sha256.txt');
    const tmpManifest = `${canonicalManifest}.tmp-${process.pid}`;
    const tmpSha = `${canonicalSha}.tmp-${process.pid}`;
    fs.copyFileSync(archivedManifestPath, tmpManifest); // COPY, never move -- the archived file is untouched.
    fs.renameSync(tmpManifest, canonicalManifest);
    fs.writeFileSync(tmpSha, `${expectedManifestSha256}\n`);
    fs.renameSync(tmpSha, canonicalSha);
    return null;
  } catch (err) {
    return `canonical manifest replacement failed: ${String((err as Error)?.message ?? err)}`;
  }
}
if (manifestSha256 === 'unavailable') archiveIntegrityViolations.push('manifest.sha256.txt could not be computed/written for this run\'s archive');
archiveIntegrityViolations.push(...verifyArchiveIntegrity(results, manifestWrite.path, manifestWrite.wroteOk, manifestSha256));
if (archiveIntegrityViolations.length === 0) {
  const promoteError = promoteCanonicalManifestCopies(manifestWrite.path, manifestSha256);
  if (promoteError) archiveIntegrityViolations.push(promoteError);
} else {
  console.log(`  ⚠ archive integrity violation(s) before promotion -- canonical manifest.json/manifest.sha256.txt left untouched: ${archiveIntegrityViolations.join('; ')}`);
}
// Re-verify every file a PRIOR invocation already archived is still exactly
// what the startup snapshot recorded -- this run must not have collided
// with, overwritten, or otherwise disturbed another run's evidence.
for (const [f, expectedHash] of preExistingArchiveHashes) {
  const nowHash = sha256FileSafe(f);
  if (nowHash !== expectedHash) archiveIntegrityViolations.push(`previously-archived file changed during this run: ${f} (was ${String(expectedHash)}, now ${String(nowHash)})`);
}

const hardFailures = results.filter((r) => r.status === 'fail');
const blocked = results.filter((r) => r.status === 'blocked-on-founder');
const passed = results.filter((r) => r.status === 'pass');
console.log(`\nverify-w1: ${passed.length} pass, ${blocked.length} blocked-on-founder, ${hardFailures.length} fail (of ${results.length}); treeDirty=${treeDirty}; runDir=${runDir}; manifest=${manifestWrite.path} (wroteOk=${manifestWrite.wroteOk}); archiveIntegrityViolations=${archiveIntegrityViolations.length}`);
for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` -- ${r.detail.slice(0, 200)}` : ''}`);
if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md S2)');
if (!manifestWrite.wroteOk) console.log('  ⚠ proof manifest degraded to a fallback path -- never a wave pass');
if (archiveIntegrityViolations.length > 0) { console.log('  ⚠ ARCHIVE INTEGRITY VIOLATIONS (forces a fail regardless of criteria results):'); for (const v of archiveIntegrityViolations) console.log(`    - ${v}`); }
console.log(`MANIFEST_SHA256=${manifestSha256}`);
const finalExitCode = hardFailures.length === 0 && !treeDirty && manifestWrite.wroteOk && archiveIntegrityViolations.length === 0 ? 0 : 1;
// RELIABILITY FIX (found empirically this round, not a named ruling item,
// but load-bearing for honest reporting): when stdout is piped (tee,
// redirection -- not a TTY), Node's writes to it can be asynchronous;
// calling process.exit() immediately after a burst of console.log calls
// can truncate output before it reaches the pipe, silently dropping most
// of the per-criterion result lines even though the manifest itself (the
// actual proof artifact) was already written complete and correct. Exit
// only after an empty stdout.write's callback confirms every prior write
// has fully drained.
process.stdout.write('', () => { process.exit(finalExitCode); });

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
