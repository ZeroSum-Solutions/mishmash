// verify-w2.ts -- wave W2 (brand honesty & docs) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w2.ts [repoRootOverride]
//
// This verifier SHIPS BEFORE the W2 implementation (VERIFICATION-CONTRACT.md
// S1). Every criterion below is expected to be "fail" today with a named,
// honest reason (missing file, wrong bytes, live egress observed) -- that is
// the correct pre-implementation result, not a bug in this file.
//
// House pattern borrowed from scripts/waves/verify-w0.ts and verify-w7.ts:
// an async IIFE (top-level await is invalid once this file is compiled as
// CJS from an out-of-repo copy), a `probe()`/`record()` result pipeline that
// never lets a thrown exception escape as an uncaught crash, a commit-bound
// proof manifest with `treeDirty` sealed by `git status --porcelain`, a
// single-line GATE-INTEGRITY self-sha pinned against
// ~/.claude/goal-state/mishmash-w2-brand-honesty/approved-gate.sha256 (a
// missing pin file is advisory-only, per house convention), and a LEASE
// check that recomputes baseCommit as merge-base(origin/main, HEAD) and
// diffs HEAD against it, read against docs/plans/waves/leases.json's W2
// entry (allow AND deny globs) at runtime rather than hardcoded here.
//
// C2-1 REQUIRES RUNTIME PROOF, NOT GREP (VERIFICATION-CONTRACT.md + the W2
// PRD are explicit that a static text search is insufficient -- the first
// rebrand sweep missed a live URL by grepping one file and generalizing).
// This file boots the REAL daemon (apps/daemon/src/server.ts) in a fully
// isolated environment -- a fresh mkdtemp() OD_DATA_DIR, port 0 (never the
// product defaults 7456/51012, never a "default" namespace) -- with
// `globalThis.fetch` monkey-patched at the daemon's OWN network boundary
// (never the module under test) so every outbound request the REAL route
// handlers construct is captured and short-circuited before it leaves the
// process. It then exercises the actual code paths named in the PRD
// (POST /api/test/connection against an openrouter.ai baseUrl, and the
// upstream-metadata GET routes) and asserts on the CAPTURED requests, with a
// positive control proving the exercised path was genuinely reached (not
// silently skipped). The newsletter-URL default (web side) is verified by
// parsing the real AST, tracing the SAME identifier to its actual `fetch(`
// call site (data-flow, not a same-looking decoy constant), and evaluating
// the real fallback expression in a `vm` context -- not a naive substring
// grep. A whole-repository AST sweep for `X-Title` header literals backstops
// exhaustiveness: it is not scoped to the one file the backlog named.
//
// C2-1a is EXPLICITLY OUT OF SCOPE for this file's write surface (it lands
// under W1's lease on EntryShell.tsx, per GLOBAL-GOAL.md Burst 2 and
// leases.json's W2 note), but several other criteria below (C2-1's X-Title
// fix sites, C2-6's consumer cleanup, C2-9's daemon/web residual strings)
// name files that are ALSO outside W2's granted lease with no equivalent
// named carve-out. Per the same principle used for C2-1/EntryShell.tsx,
// every content criterion in this file grades the LANDED TREE's observable
// behavior -- it never requires that W2's OWN diff be the one that touched
// an out-of-lease file. The mechanical LEASE criterion, run separately at
// the end of this file, is what actually enforces W2's diff stays inside
// its allow-list; if closing a named criterion truly requires an edit
// outside that allow-list, LEASE will fail and that is the correct signal
// for an orchestrator-level lease amendment (the DECISIONS.md precedent:
// W0's cli.ts/origin-validation.ts amendment, and C2-1a itself).

import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import type TypeScriptModule from 'typescript';
import type { Node as TsNode } from 'typescript';

void (async () => {
const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
const WAVE_SLUG = 'mishmash-w2-brand-honesty';
const goalStateDir = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG);

let proofDir = path.join(goalStateDir, 'proof');
let canonicalProofDirFailed = false;
try {
  fs.mkdirSync(proofDir, { recursive: true });
} catch (e) {
  canonicalProofDirFailed = true;
  const fallback = path.join(os.tmpdir(), `verify-w2-proof-fallback-${process.pid}`);
  console.error(`verify-w2: could not create primary proof dir ${proofDir} (${(e as Error).message}); falling back to ${fallback}`);
  fs.mkdirSync(fallback, { recursive: true });
  proofDir = fallback;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
function sh(cmd: string, args: string[], cwd: string = repoRoot, env?: NodeJS.ProcessEnv, timeoutMs = 15 * 60_000): { status: number; stdout: string; stderr: string } {
  try {
    const options: { cwd: string; encoding: 'utf8'; maxBuffer: number; timeout: number; env?: NodeJS.ProcessEnv } = {
      cwd,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      timeout: timeoutMs,
    };
    if (env) options.env = env;
    const stdout = execFileSync(cmd, args, options);
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function sha256Buffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function sha256File(absPath: string): string | null {
  try {
    return sha256Buffer(fs.readFileSync(absPath));
  } catch {
    return null;
  }
}
function abs(rel: string): string {
  return path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
}
function exists(rel: string): boolean {
  return fs.existsSync(abs(rel));
}
function readText(rel: string): string | null {
  try {
    return fs.readFileSync(abs(rel), 'utf8');
  } catch {
    return null;
  }
}
function toRepoRelative(absFilePath: string): string {
  return path.relative(repoRoot, absFilePath).split(path.sep).join('/');
}

// ===========================================================================
// I-W2-ONE-CANONICAL-TARGET (ceremony ruling, F2, 2026-07-28): exactly one
// predicate and one resolver, called without local variation by checkC2_2,
// checkC2_3, and checkC2_9. Round-2's shared regex still let each of the
// three pick a DIFFERENT matching property (first-match, or any match) when
// an entry carried more than one candidate key -- this resolver removes that
// degree of freedom entirely: zero or multiple matches is an error, never a
// first-match pick.
// ===========================================================================

// Whole-key anchors (^...$): `surfaceId`, `surfaceRationale`, `filepathHint`,
// `pathname` do NOT match. Only an entry's OWN property named exactly one of
// these (case-insensitive) is a target-path candidate.
const INVENTORY_TARGET_FIELD_PATTERN = /^(?:file|path|surface|location)$/i;

type ResolvedInventoryTarget = { ok: true; canonicalPath: string } | { ok: false; error: string };

// The single resolver. Requires exactly one matching own-enumerable
// property; requires a normalized, repo-relative, non-escaping path that
// realpath-resolves to a regular file contained under repoRoot. Returns one
// canonical repo-relative (POSIX-separated) path, or a structured error --
// never throws, never silently picks a first match.
function resolveInventoryTargetPath(entry: Record<string, unknown>): ResolvedInventoryTarget {
  const matches = Object.entries(entry).filter(([k, v]) => INVENTORY_TARGET_FIELD_PATTERN.test(k) && typeof v === 'string' && v.trim().length > 0);
  if (matches.length === 0) {
    return { ok: false, error: 'no own property key matches ^(?:file|path|surface|location)$/i with a non-empty (trimmed) string value' };
  }
  if (matches.length > 1) {
    return { ok: false, error: `${matches.length} properties match the target-field pattern [${matches.map(([k]) => k).join(', ')}] -- exactly one is required; never first-match` };
  }
  const raw = (matches[0]![1] as string).trim();
  if (raw.includes('\0')) return { ok: false, error: `"${raw}": contains a NUL byte` };
  if (path.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) return { ok: false, error: `"${raw}": absolute path is not permitted -- must be repo-relative` };
  const posixRaw = raw.split(path.sep).join('/').replace(/^\/+/, '');
  // Fidelity-round fix: the ruling requires no `.` OR `..` segment -- a raw
  // "." segment (e.g. "./foo", "foo/./bar") was previously accepted and
  // silently normalized away instead of rejected outright.
  if (posixRaw.split('/').some((seg) => seg === '.' || seg === '..')) {
    return { ok: false, error: `"${raw}": contains a "." or ".." segment -- no dot-segments are permitted` };
  }
  const normalized = path.posix.normalize(posixRaw);
  if (normalized === '' || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    return { ok: false, error: `"${raw}": normalizes to "${normalized}", which is empty or escapes the repo root` };
  }
  const absTarget = path.join(repoRoot, normalized);
  let realRepoRoot: string;
  let realTarget: string;
  try {
    realRepoRoot = fs.realpathSync(repoRoot);
  } catch (err) {
    return { ok: false, error: `could not realpath repoRoot: ${String((err as Error)?.message ?? err)}` };
  }
  try {
    realTarget = fs.realpathSync(absTarget);
  } catch (err) {
    return { ok: false, error: `"${normalized}": does not resolve on disk under repoRoot: ${String((err as Error)?.message ?? err)}` };
  }
  if (!(realTarget === realRepoRoot || realTarget.startsWith(realRepoRoot + path.sep))) {
    return { ok: false, error: `"${normalized}": resolves outside repoRoot (${realTarget})` };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(realTarget);
  } catch (err) {
    return { ok: false, error: `"${normalized}": could not stat resolved path: ${String((err as Error)?.message ?? err)}` };
  }
  if (!stat.isFile()) return { ok: false, error: `"${normalized}": does not resolve to a regular file` };
  return { ok: true, canonicalPath: normalized };
}

// ---------------------------------------------------------------------------
// Result plumbing (house pattern: verify-w7.ts's record()/probe())
// ---------------------------------------------------------------------------
interface CriterionResult {
  id: string;
  command: string;
  assertion: string;
  artifact: string | null;
  artifactSha256: string | null;
  exitCode: number;
  status: 'pass' | 'fail' | 'blocked-on-founder';
  durationMs: number;
  detail?: string | undefined;
}
const results: CriterionResult[] = [];

function artifactFor(id: string, content: string): { artifact: string | null; artifactSha256: string } {
  const primary = path.join(proofDir, `${id}.txt`);
  try {
    fs.writeFileSync(primary, content);
    return { artifact: primary, artifactSha256: sha256Buffer(Buffer.from(content)) };
  } catch {
    /* fall through */
  }
  try {
    const fallbackDir = path.join(os.tmpdir(), `verify-w2-fallback-${process.pid}`);
    fs.mkdirSync(fallbackDir, { recursive: true });
    const fallback = path.join(fallbackDir, `${id}-${Date.now()}.txt`);
    fs.writeFileSync(fallback, content);
    return { artifact: fallback, artifactSha256: sha256Buffer(Buffer.from(content)) };
  } catch {
    return { artifact: null, artifactSha256: sha256Buffer(Buffer.from(content)) };
  }
}

function record(id: string, command: string, assertion: string, status: 'pass' | 'fail' | 'blocked-on-founder', evidence: string, startedAt: number, detail?: string): void {
  const truncatedEvidence = evidence.length > 20_000 ? `${evidence.slice(0, 20_000)}\n...[truncated, ${evidence.length} bytes total]` : evidence;
  const { artifact, artifactSha256 } = artifactFor(
    id,
    `# ${id}\n# assertion: ${assertion}\n# verdict: ${status}\n${detail ? `# detail: ${detail}\n` : ''}\n${truncatedEvidence}\n`,
  );
  const effectiveStatus: 'pass' | 'fail' | 'blocked-on-founder' = artifact === null ? 'fail' : status;
  const effectiveDetail = artifact === null ? `${detail ? `${detail}; ` : ''}artifact could not be written to any location -- forced fail, no artifact-less pass permitted` : detail;
  results.push({
    id,
    command,
    assertion,
    artifact,
    artifactSha256,
    exitCode: effectiveStatus === 'fail' ? 1 : 0,
    status: effectiveStatus,
    durationMs: Date.now() - startedAt,
    detail: effectiveDetail,
  });
}

async function probe(
  id: string,
  command: string,
  assertion: string,
  fn: () => Promise<{ ok: boolean; evidence: string; detail?: string | undefined }>,
): Promise<void> {
  const startedAt = Date.now();
  try {
    const { ok, evidence, detail } = await fn();
    record(id, command, assertion, ok ? 'pass' : 'fail', evidence, startedAt, detail);
  } catch (error) {
    record(id, command, assertion, 'fail', `probe threw: ${(error as Error).stack ?? String(error)}`, startedAt, 'probe crashed instead of failing cleanly');
  }
}

// ---------------------------------------------------------------------------
// Git identity (HEAD, baseCommit) -- resolved early since several criteria
// need baseCommit for before/after comparisons.
// ---------------------------------------------------------------------------
const headShaResult = sh('git', ['rev-parse', 'HEAD']);
const headSha = headShaResult.status === 0 ? headShaResult.stdout.trim() : '';
const gitIdentityOk = /^[0-9a-f]{40}$/i.test(headSha);

function resolveRemoteMainShaOrFail(): { ok: true; sha: string } | { ok: false; error: string } {
  const lsRemote = sh('git', ['ls-remote', 'origin', 'main']);
  if (lsRemote.status !== 0) return { ok: false, error: `git ls-remote origin main failed (status=${lsRemote.status}): ${lsRemote.stderr}` };
  const sha = lsRemote.stdout.trim().split('\n')[0]?.split('\t')[0]?.trim();
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) return { ok: false, error: `git ls-remote origin main returned unparseable output: "${lsRemote.stdout}"` };
  const catCheck = sh('git', ['cat-file', '-e', sha]);
  if (catCheck.status !== 0) return { ok: false, error: `remote origin/main (${sha}) is not present locally -- fetch required` };
  return { ok: true, sha };
}
const remoteMain = resolveRemoteMainShaOrFail();
let baseCommit = '';
if (remoteMain.ok && gitIdentityOk) {
  const mb = sh('git', ['merge-base', remoteMain.sha, headSha]);
  if (mb.status === 0 && mb.stdout.trim()) baseCommit = mb.stdout.trim();
}

function readFileAtCommit(commit: string, relPath: string): string | null {
  const r = sh('git', ['show', `${commit}:${relPath}`]);
  return r.status === 0 ? r.stdout : null;
}

// Enumerate every tracked file at a given commit via `git ls-tree`, NOT the
// checked-out HEAD working tree. Sol round-2 F3: checkC2_7 previously
// enumerated the huashu-*/humanize-ppt directory set with fs.readdirSync
// against HEAD, so a directory deleted between baseCommit and HEAD silently
// vanished from the comparison set instead of being flagged as lost content.
function listRepoFilesAtCommit(commit: string): string[] | null {
  const r = sh('git', ['ls-tree', '-r', '--name-only', commit]);
  if (r.status !== 0) return null;
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// TypeScript compiler API (used for every AST-based check below -- never a
// flat text grep for anything load-bearing).
// ---------------------------------------------------------------------------
let ts: typeof TypeScriptModule;
let tsLoadError: string | null = null;
try {
  ts = createRequire(path.join(repoRoot, 'package.json'))('typescript');
} catch (err) {
  tsLoadError = String((err as Error)?.stack ?? err);
  ts = null as unknown as typeof TypeScriptModule;
}

function parseSource(absPath: string): { sourceFile: TypeScriptModule.SourceFile; text: string } {
  const text = fs.readFileSync(absPath, 'utf8');
  const kind = /\.tsx$/.test(absPath) ? ts.ScriptKind.TSX : /\.jsx$/.test(absPath) ? ts.ScriptKind.JSX : /\.js|\.mjs|\.cjs$/.test(absPath) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return { sourceFile: ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, kind), text };
}

function lineOf(sourceFile: TypeScriptModule.SourceFile, node: TsNode): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

// Best-effort static evaluation of a simple string-producing expression:
// string literals, template literals with only literal parts, and binary
// `+` concatenation of the above. Returns null (never throws) when the
// expression is not staticaly resolvable this way.
function evalSimpleStringExpr(node: TsNode): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    if (node.templateSpans.length > 0) return null; // has interpolation -- not staticaly resolvable
    return node.head.text;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = evalSimpleStringExpr(node.left);
    const r = evalSimpleStringExpr(node.right);
    return l !== null && r !== null ? l + r : null;
  }
  if (ts.isParenthesizedExpression(node)) return evalSimpleStringExpr(node.expression);
  return null;
}

// Recursively walk every node in a source file.
function walkAst(node: TsNode, visitor: (n: TsNode) => void): void {
  visitor(node);
  ts.forEachChild(node, (child) => walkAst(child, visitor));
}

function collectRepoFiles(startDirs: string[], opts: { exts: string[]; skipDirNames?: string[] }): string[] {
  const skipDirNames = new Set(opts.skipDirNames ?? ['node_modules', '.git', 'dist', '.next', '.tmp', 'out', '.turbo', 'coverage', '.od']);
  const out: string[] = [];
  for (const startDir of startDirs) {
    const abs0 = path.join(repoRoot, startDir);
    if (!fs.existsSync(abs0)) continue;
    (function walk(dir: string): void {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (skipDirNames.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (opts.exts.some((ext) => entry.name.endsWith(ext))) {
          out.push(full);
        }
      }
    })(abs0);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Isolated daemon boot with a network-boundary fetch patch (real code paths,
// captured egress, never a mocked module under test).
// ---------------------------------------------------------------------------
interface BootedDaemon {
  url: string;
  dataDir: string;
  egressLogPath: string;
  bootFailure: string | null;
  readEgress: () => Array<{ url: string; host: string; method: string; headers: Record<string, string> }>;
  kill: () => Promise<void>;
}

// F-10 (Sol round-1): boot infrastructure (mkdtemp, spawn, script writes) can
// itself fail -- under a restricted sandbox this threw uncaught, which
// propagated past every criterion probe and the manifest write entirely
// (the outer async-IIFE catch is a last resort, not a substitute for a named
// per-criterion result). `bootDaemonForProbing` is now a thin guard: it never
// throws, and any infra failure becomes a normal `BootedDaemon.bootFailure`
// string that C2-1/C2-6 already know how to fail cleanly on, while every
// OTHER criterion and the manifest write still proceed.
async function bootDaemonForProbing(): Promise<BootedDaemon> {
  try {
    return await bootDaemonForProbingUnguarded();
  } catch (err) {
    return {
      url: '',
      dataDir: '',
      egressLogPath: '',
      bootFailure: `daemon boot infrastructure crashed before any probe could run: ${String((err as Error)?.stack ?? err)}`,
      readEgress: () => [],
      kill: async () => {},
    };
  }
}

async function bootDaemonForProbingUnguarded(): Promise<BootedDaemon> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w2-verify-data-'));
  const egressLogPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'od-w2-verify-egress-')), 'egress.jsonl');
  fs.writeFileSync(egressLogPath, '');
  const scriptPath = path.join(os.tmpdir(), `od-w2-boot-${process.pid}-${crypto.randomBytes(4).toString('hex')}.mjs`);
  const bootScript = `
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const egressLogPath = ${JSON.stringify(egressLogPath)};
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  let url = '';
  try { url = typeof input === 'string' ? input : (input && input.url) ? input.url : String(input); } catch { url = String(input); }
  let host = '';
  try { host = new URL(url).hostname; } catch { host = ''; }
  const method = (init && init.method) || (input && input.method) || 'GET';
  const headers = {};
  try {
    const h = (init && init.headers) ?? (input && input.headers);
    if (h) for (const [k, v] of new Headers(h).entries()) headers[k] = v;
  } catch { /* best effort */ }
  try {
    fs.appendFileSync(egressLogPath, JSON.stringify({ url, host, method, headers }) + '\\n');
  } catch { /* never let logging break the boot */ }
  if (host && !LOOPBACK.has(host)) {
    // Real network egress is captured above, then short-circuited here --
    // this verifier never actually contacts third-party hosts. Requests
    // shaped like the upstream-metadata calls get a PLAUSIBLE SUCCESSFUL
    // body instead of a bare failure: the route handlers under test embed
    // their own hardcoded repo/invite identifiers directly in the JSON they
    // return to the client (not derived from this response), so a failure
    // response here would short-circuit them into their error branch before
    // ever reaching that code -- silently making the C2-6 content check
    // vacuous. A believable upstream success is what actually exercises it.
    if (/^\/repos\/[^/]+\/[^/]+$/.test(new URL(url).pathname) && host === 'api.github.com') {
      return new Response(JSON.stringify({ stargazers_count: 1 }), { status: 200 });
    }
    if (/\/releases\/latest$/.test(new URL(url).pathname) && host === 'api.github.com') {
      return new Response(JSON.stringify({ tag_name: 'w2-verifier-fake-tag', html_url: 'https://example.invalid/w2-verifier-fake-release' }), { status: 200 });
    }
    if (host === 'discord.com' && /\/invites\//.test(new URL(url).pathname)) {
      return new Response(
        JSON.stringify({ approximate_presence_count: 1, approximate_member_count: 2, profile: { online_count: 1, member_count: 2 } }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ w2VerifierMocked: true }), { status: 599 });
  }
  return originalFetch(input, init);
};

try {
  const mod = await import(pathToFileURL(${JSON.stringify(path.join(repoRoot, 'apps/daemon/src/server.ts'))}).href);
  const started = await mod.startServer({ port: 0, returnServer: true });
  console.log('W2_VERIFIER_READY ' + JSON.stringify({ url: started.url }));
  process.on('SIGTERM', async () => { try { await started.shutdown(); } catch {} process.exit(0); });
} catch (err) {
  console.log('W2_VERIFIER_BOOT_FAILED ' + JSON.stringify({ error: String(err && err.stack || err) }));
  process.exit(1);
}
`;
  fs.writeFileSync(scriptPath, bootScript);
  const child = spawn('pnpm', ['exec', 'tsx', scriptPath], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OD_DATA_DIR: dataDir },
  });
  let buffered = '';
  let bootFailure: string | null = null;
  // 180s, not 60s: an isolated boot takes ~2s, but under real machine
  // contention (this verifier is one process among many on a shared dev
  // box) `pnpm exec tsx` startup + 455-plugin registration was observed to
  // occasionally miss a 60s window even though nothing was actually wrong --
  // C2-1/C2-6 depend on this boot succeeding, so a too-tight timeout would
  // manufacture false fails, not catch real ones.
  const ready = await new Promise<{ url: string } | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 180_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const readyLine = buffered.split('\n').find((l) => l.startsWith('W2_VERIFIER_READY '));
      const failLine = buffered.split('\n').find((l) => l.startsWith('W2_VERIFIER_BOOT_FAILED '));
      if (readyLine) {
        clearTimeout(timeout);
        try {
          resolve(JSON.parse(readyLine.slice('W2_VERIFIER_READY '.length)));
        } catch {
          resolve(null);
        }
      } else if (failLine) {
        clearTimeout(timeout);
        try {
          bootFailure = (JSON.parse(failLine.slice('W2_VERIFIER_BOOT_FAILED '.length)) as { error: string }).error;
        } catch {
          bootFailure = failLine;
        }
        resolve(null);
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
      /* best effort */
    }
  };
  const readEgress = (): Array<{ url: string; host: string; method: string; headers: Record<string, string> }> => {
    try {
      return fs
        .readFileSync(egressLogPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { url: string; host: string; method: string; headers: Record<string, string> });
    } catch {
      return [];
    }
  };
  if (!ready) {
    await kill();
    return {
      url: '',
      dataDir,
      egressLogPath,
      bootFailure: bootFailure ?? `daemon failed to boot within timeout (stdout tail: ${buffered.slice(-2000)})`,
      readEgress,
      kill: async () => {},
    };
  }
  return { url: ready.url, dataDir, egressLogPath, bootFailure: null, readEgress, kill };
}

// ===========================================================================
// C2-1 -- no live old-brand egress, proven at runtime.
// ===========================================================================
async function checkC2_1(daemon: BootedDaemon): Promise<void> {
  await probe(
    'C2-1',
    'boot isolated daemon (temp OD_DATA_DIR, port 0) + patched fetch boundary; POST /api/test/connection against an openrouter.ai baseUrl; GET the upstream-metadata routes; AST-trace EntryShell.tsx NEWSLETTER_SUBSCRIBE_URL to its real fetch( call site and vm-evaluate the fallback; whole-repo AST sweep for X-Title header literals',
    'no captured outbound request has hostname open-design.ai (or a subdomain); no captured or statically-resolved header literal named X-Title (case-insensitive) equals "Open Design"; the EntryShell newsletter default does not resolve to open-design.ai; the openrouter.ai code path was genuinely exercised (positive control)',
    async () => {
      const evidenceLines: string[] = [];
      const problems: string[] = [];

      if (daemon.bootFailure) {
        return { ok: false, evidence: `daemon failed to boot for runtime egress probing:\n${daemon.bootFailure}`, detail: 'cannot prove runtime egress without a booted daemon' };
      }

      // --- 1. Exercise POST /api/test/connection against openrouter.ai ------
      let openRouterCallCaptured = false;
      try {
        const resp = await fetch(`${daemon.url}/api/test/connection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'provider',
            protocol: 'openai',
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey: 'w2-verifier-fake-key',
            model: 'w2-verifier-fake-model',
          }),
        });
        evidenceLines.push(`POST /api/test/connection -> status ${resp.status}`);
      } catch (err) {
        evidenceLines.push(`POST /api/test/connection threw: ${String(err)}`);
      }

      // --- 2. Exercise the upstream-metadata routes --------------------------
      const metadataEndpoints = ['/api/github/open-design', '/api/github/open-design/releases/latest', '/api/community/discord'];
      for (const endpoint of metadataEndpoints) {
        try {
          const resp = await fetch(`${daemon.url}${endpoint}`);
          evidenceLines.push(`GET ${endpoint} -> status ${resp.status}`);
        } catch (err) {
          evidenceLines.push(`GET ${endpoint} threw: ${String(err)}`);
        }
      }

      const egress = daemon.readEgress();
      evidenceLines.push(`captured ${egress.length} outbound fetch call(s):`);
      for (const call of egress) evidenceLines.push(`  ${call.method} ${call.url} headers=${JSON.stringify(call.headers)}`);

      for (const call of egress) {
        if (call.host === 'openrouter.ai') openRouterCallCaptured = true;
        if (call.host === 'open-design.ai' || call.host.endsWith('.open-design.ai')) {
          problems.push(`captured outbound request to old-brand host: ${call.method} ${call.url}`);
        }
        const xTitleKey = Object.keys(call.headers).find((k) => k.toLowerCase() === 'x-title');
        if (xTitleKey && call.headers[xTitleKey]?.trim().toLowerCase() === 'open design') {
          problems.push(`captured X-Title: "${call.headers[xTitleKey]}" on outbound request ${call.url}`);
        }
      }
      if (!openRouterCallCaptured) {
        problems.push('positive control failed: no outbound call to host "openrouter.ai" was captured -- the provider-header code path was not genuinely exercised, so an absence of X-Title above would be inconclusive, not a real pass');
      }

      // --- 3. Whole-repo AST sweep for X-Title header literals --------------
      if (ts) {
        const candidateFiles = collectRepoFiles(['apps', 'packages'], { exts: ['.ts', '.tsx'] });
        let xTitleSitesFound = 0;
        for (const file of candidateFiles) {
          let sourceFile: TypeScriptModule.SourceFile;
          try {
            ({ sourceFile } = parseSource(file));
          } catch {
            continue;
          }
          walkAst(sourceFile, (node) => {
            if (!ts.isPropertyAssignment(node)) return;
            const nameNode = node.name;
            const keyText = ts.isIdentifier(nameNode) ? nameNode.text : ts.isStringLiteralLike(nameNode) ? nameNode.text : null;
            if (!keyText || keyText.toLowerCase() !== 'x-title') return;
            xTitleSitesFound += 1;
            const resolved = evalSimpleStringExpr(node.initializer);
            const rel = toRepoRelative(file);
            const ln = lineOf(sourceFile, node);
            if (resolved === null) {
              problems.push(`${rel}:${ln} -- X-Title header value is not staticaly resolvable (dynamic expression); cannot confirm it is not the old brand name`);
            } else if (resolved.trim().toLowerCase() === 'open design') {
              problems.push(`${rel}:${ln} -- X-Title header literal is still "Open Design"`);
            } else {
              evidenceLines.push(`${rel}:${ln} -- X-Title header literal resolved to "${resolved}" (ok)`);
            }
          });
        }
        evidenceLines.push(`whole-repo AST sweep found ${xTitleSitesFound} X-Title header construction site(s) across ${candidateFiles.length} .ts/.tsx files under apps/ and packages/`);
      } else {
        problems.push(`TypeScript compiler API failed to load: ${tsLoadError}`);
      }

      // --- 4. EntryShell.tsx newsletter default, AST + data-flow + vm-eval ---
      const entryShellPath = abs('apps/web/src/components/EntryShell.tsx');
      if (!fs.existsSync(entryShellPath)) {
        problems.push('apps/web/src/components/EntryShell.tsx not found -- cannot verify the newsletter default (C2-1a lands under W1\'s lease; this checks the landed tree, which must still contain the file)');
      } else if (ts) {
        const { sourceFile } = parseSource(entryShellPath);
        let declName: string | null = null;
        let initializerText: string | null = null;
        walkAst(sourceFile, (node) => {
          if (declName) return;
          if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && /newsletter.*url/i.test(node.name.text)) {
            declName = node.name.text;
            initializerText = node.initializer.getText(sourceFile);
          }
        });
        if (!declName || initializerText === null) {
          problems.push('EntryShell.tsx: could not find a NEWSLETTER_*_URL-shaped constant declaration via AST');
        } else {
          let usedAtFetchCallSite = false;
          walkAst(sourceFile, (node) => {
            if (usedAtFetchCallSite) return;
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
              const arg0 = node.arguments[0];
              if (arg0 && ts.isIdentifier(arg0) && arg0.text === declName) usedAtFetchCallSite = true;
            }
          });
          if (!usedAtFetchCallSite) {
            problems.push(`EntryShell.tsx: ${declName} declaration found but is never the first argument to a fetch( call -- cannot confirm it is the real network call site, not a decoy`);
          }
          let resolvedDefault: string | null = null;
          try {
            const ctx = vm.createContext({ process: { env: {} } });
            resolvedDefault = vm.runInContext(initializerText, ctx, { timeout: 1_000 }) as string;
          } catch (err) {
            problems.push(`EntryShell.tsx: vm evaluation of ${declName}'s initializer threw: ${String(err)}`);
          }
          if (resolvedDefault !== null) {
            evidenceLines.push(`EntryShell.tsx: ${declName} default (env unset) evaluates to "${resolvedDefault}", used at fetch(...) call site: ${usedAtFetchCallSite}`);
            let host = '';
            try {
              host = new URL(resolvedDefault).hostname;
            } catch {
              problems.push(`EntryShell.tsx: ${declName} default "${resolvedDefault}" is not a parseable URL`);
            }
            if (host === 'open-design.ai' || host.endsWith('.open-design.ai')) {
              problems.push(`EntryShell.tsx: ${declName} still defaults to the old-brand host (${host})`);
            }
          }
        }
      }

      return { ok: problems.length === 0, evidence: `${evidenceLines.join('\n')}\n\nPROBLEMS:\n${problems.join('\n') || '(none)'}`, detail: problems[0] };
    },
  );
}

// ===========================================================================
// C2-2 -- brand-surface inventory is allowlist-based, typed, wired into
// pnpm guard.
// ===========================================================================
interface BrandSurfaceDiscovery {
  modulePath: string | null;
  checkFnName: string | null;
  inventoryExportName: string | null;
  inventoryLength: number;
}

function discoverCheckBrandSurfacesModule(): { path: string | null; candidates: string[] } {
  const scriptsDir = abs('scripts');
  let candidates: string[] = [];
  try {
    candidates = fs
      .readdirSync(scriptsDir)
      .filter((f) => /^check-brand-surfaces.*\.ts$/.test(f))
      .map((f) => path.join(scriptsDir, f));
  } catch {
    candidates = [];
  }
  return { path: candidates[0] ?? null, candidates };
}

// Sol round-1 F2: `checkFnName` and the guard-wiring proof used to be
// discovered INDEPENDENTLY of each other -- any exported `check*`-named
// function qualified for `checkFnName`, and separately any `run:` property
// anywhere in guard.ts whose value matched an imported name from a
// check-brand-surfaces-shaped module specifier counted as "wired." Those two
// facts were never required to be the SAME function, so an unrelated
// `{run: someOtherImportedFn}` property elsewhere in guard.ts (or an
// unrelated decorative `check*` export) could satisfy both checks without
// `pnpm guard` ever actually executing brand-surface enforcement. This now
// derives the wired function's name FROM guard.ts's own `checks` ARRAY
// LITERAL (the thing `runChecks()` actually iterates), and only that
// specific exported name is treated as "the" check function everywhere else
// (C2-3's mutation test in particular).
function discoverGuardWiring(): { wired: boolean; wiredExportedName: string | null; evidence: string } {
  const guardPath = abs('scripts/guard.ts');
  if (!ts) return { wired: false, wiredExportedName: null, evidence: `TypeScript compiler API unavailable: ${tsLoadError}` };
  if (!fs.existsSync(guardPath)) return { wired: false, wiredExportedName: null, evidence: 'scripts/guard.ts not found' };
  const { sourceFile } = parseSource(guardPath);

  // Step 1: named imports from a check-brand-surfaces-shaped module
  // specifier, keeping BOTH the local binding name (used inside guard.ts)
  // and the exported name in the source module (propertyName when aliased
  // `{ x as y }`, otherwise the same as the local name).
  const importedBindings = new Map<string, string>(); // localName -> exportedName
  walkAst(sourceFile, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /check-brand-surfaces/i.test(node.moduleSpecifier.text)) {
      const clause = node.importClause;
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          importedBindings.set(el.name.text, (el.propertyName ?? el.name).text);
        }
      }
    }
  });
  if (importedBindings.size === 0) return { wired: false, wiredExportedName: null, evidence: 'scripts/guard.ts has no import from a module path matching /check-brand-surfaces/i' };

  // Step 2: the ACTUAL `checks` array literal (`const checks: GuardCheck[] =
  // [...]`), not just any object anywhere in the file. Only a `run:`
  // property on an object literal that is itself an ELEMENT of that array
  // counts.
  let checksArrayFound = false;
  let wiredExportedName: string | null = null;
  walkAst(sourceFile, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'checks' && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      checksArrayFound = true;
      for (const element of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue;
        for (const prop of element.properties) {
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'run' && ts.isIdentifier(prop.initializer) && importedBindings.has(prop.initializer.text)) {
            wiredExportedName = importedBindings.get(prop.initializer.text) ?? null;
          }
        }
      }
    }
  });
  if (!checksArrayFound) return { wired: false, wiredExportedName: null, evidence: 'scripts/guard.ts has an import from check-brand-surfaces, but no `const checks: GuardCheck[] = [...]` array literal was found to check against' };
  if (!wiredExportedName) return { wired: false, wiredExportedName: null, evidence: `imported binding(s) [${[...importedBindings.keys()].join(', ')}] found, but none appears as an ELEMENT of the \`checks\` array's \`run:\` property -- an unrelated run:<importedFn> elsewhere in the file does not count` };
  return { wired: true, wiredExportedName, evidence: `checks array element's run: property resolves to imported export "${wiredExportedName}"` };
}

async function discoverBrandSurfacesShape(modulePath: string, wiredExportedName: string | null): Promise<BrandSurfaceDiscovery & { error?: string }> {
  try {
    const mod = (await import(pathToFileURL(modulePath).href + `?t=${Date.now()}`)) as Record<string, unknown>;
    // Sol round-1 F2: checkFnName is now the guard-derived name, not an
    // independent "any export starting with check" guess.
    const checkFnName = wiredExportedName && typeof mod[wiredExportedName] === 'function' ? wiredExportedName : null;
    let inventoryExportName: string | null = null;
    let inventoryLength = 0;
    for (const [name, value] of Object.entries(mod)) {
      if (!inventoryExportName && Array.isArray(value) && value.length > 0 && value.every((el) => el !== null && typeof el === 'object' && !Array.isArray(el))) {
        inventoryExportName = name;
        inventoryLength = value.length;
      }
    }
    return { modulePath, checkFnName, inventoryExportName, inventoryLength };
  } catch (err) {
    return { modulePath, checkFnName: null, inventoryExportName: null, inventoryLength: 0, error: String((err as Error)?.stack ?? err) };
  }
}

async function checkC2_2(): Promise<BrandSurfaceDiscovery | null> {
  let discovery: BrandSurfaceDiscovery | null = null;
  await probe(
    'C2-2',
    'discover scripts/check-brand-surfaces*.ts; AST-parse scripts/guard.ts\'s ACTUAL `checks` array literal to find the specific imported function wired into it (not any check*-named export, not any unrelated run: property); dynamic-import the module and inspect its exported inventory array (rationale field + file/path/surface/location field, the latter resolved via the single shared canonical-target resolver, per entry)',
    'an allowlist-shaped, typed brand-surface inventory (>=5 entries, each carrying a rationale-like field and EXACTLY one file/path/surface/location field that the shared resolver resolves to a real, repo-contained, non-escaping file) exists and is exported; 100% of entries resolve, not a ratio threshold; the function actually registered as an ELEMENT of guard.ts\'s `checks` array (what `pnpm guard` executes) is a real export of the module',
    async () => {
      const { path: modulePath, candidates } = discoverCheckBrandSurfacesModule();
      if (!modulePath) {
        return { ok: false, evidence: `no file matching scripts/check-brand-surfaces*.ts found under ${toRepoRelative(abs('scripts'))}`, detail: 'inventory module missing' };
      }
      const wiring = discoverGuardWiring();
      const shape = await discoverBrandSurfacesShape(modulePath, wiring.wiredExportedName);
      discovery = shape;
      const problems: string[] = [];
      if (shape.error) problems.push(`failed to import ${toRepoRelative(modulePath)}: ${shape.error}`);
      if (!wiring.wired) problems.push(`guard.ts wiring: ${wiring.evidence}`);
      if (wiring.wired && !shape.checkFnName) problems.push(`guard.ts wires in the export "${wiring.wiredExportedName}", but the module does not actually export a function by that name`);
      if (!shape.inventoryExportName) problems.push('no exported array-of-objects inventory was found');
      if (shape.inventoryExportName && shape.inventoryLength < 5) problems.push(`inventory "${shape.inventoryExportName}" has only ${shape.inventoryLength} entries (want >= 5 -- the PRD names at least the newsletter URL, 3+ X-Title sites, the metadata route, share-helpers, pluginFolderActions, and the sidecar handshake string as distinct surfaces)`);

      let rationaleFieldsOk = true;
      let allResolved = true;
      let resolvedCount = 0;
      let entryCount = 0;
      const resolutionProblems: string[] = [];
      if (shape.inventoryExportName) {
        try {
          const mod = (await import(pathToFileURL(modulePath).href + `?t=${Date.now()}`)) as Record<string, unknown>;
          const arr = mod[shape.inventoryExportName] as Array<Record<string, unknown>>;
          entryCount = arr.length;
          for (const [index, entry] of arr.entries()) {
            const keys = Object.keys(entry);
            const hasRationale = keys.some((k) => /rationale|reason|why/i.test(k) && typeof entry[k] === 'string' && (entry[k] as string).trim().length > 0);
            if (!hasRationale) rationaleFieldsOk = false;
            // I-W2-ONE-CANONICAL-TARGET (ceremony ruling F2): the SAME
            // resolveInventoryTargetPath used by checkC2_3/checkC2_9 --
            // exactly one matching field, resolved to a real, contained,
            // regular file. 100% of entries must resolve; no ratio.
            const resolution = resolveInventoryTargetPath(entry);
            if (resolution.ok) {
              resolvedCount += 1;
            } else {
              allResolved = false;
              resolutionProblems.push(`entry #${index}: ${resolution.error}`);
            }
          }
        } catch (err) {
          rationaleFieldsOk = false;
          allResolved = false;
          resolutionProblems.push(`failed to inspect inventory entries: ${String((err as Error)?.message ?? err)}`);
        }
      }
      if (shape.inventoryExportName && !rationaleFieldsOk) problems.push(`inventory "${shape.inventoryExportName}" has at least one entry missing a non-empty rationale-like string field`);
      // Sol round-2 F2 / ceremony ruling F2: 100% resolution required, not a
      // ratio threshold -- every entry must resolve via the single shared
      // canonical-target resolver (exactly one matching field, a real,
      // repo-contained, non-escaping regular file).
      if (shape.inventoryExportName && !allResolved) {
        problems.push(`inventory "${shape.inventoryExportName}": not every entry resolves via the canonical file/path/surface/location resolver (${resolvedCount}/${entryCount} resolved; want 100%) -- ${resolutionProblems.join('; ')}`);
      }

      const evidence = `module: ${toRepoRelative(modulePath)} (candidates: ${candidates.map(toRepoRelative).join(', ')})\nguardWiring: ${wiring.evidence}\ncheckFnName (guard-derived): ${shape.checkFnName}\ninventoryExportName: ${shape.inventoryExportName} (length ${shape.inventoryLength}, resolved ${resolvedCount}/${entryCount})\n\nPROBLEMS:\n${problems.join('\n') || '(none)'}`;
      return { ok: problems.length === 0, evidence, detail: problems[0] };
    },
  );
  return discovery;
}

// ===========================================================================
// C2-3 -- the guard actually catches reintroduction (mutation test on a
// throwaway repo copy; the real tree is never touched).
// ===========================================================================
// I-W2-NO-PROBE-SIGNATURE (ceremony ruling, F1, 2026-07-28): the ONLY stable
// semantic bytes a mutation may introduce are the genuine prohibited
// signals -- `open-design.ai` and `Open Design`. Earlier rounds fixed the
// payload TEMPLATE (Sol round-2 F1) but still wrapped it in a verifier-owned
// identifier (`__w2MutationProbe_<id>`) or a fixed JSON key
// (`__w2VerifierMutationProbe`) -- both are stable, grep-classifiable
// verifier identity that an opportunistic checker can special-case without
// enforcing any real brand rule. There is no wrapper now: every mutation
// REPLACES the value of an EXISTING carrier already present in the target
// (an AST string/template literal for code, a string leaf for JSON, a text
// boundary for Markdown) -- nothing named "w2", "verifier", "mutation", or
// "probe" is ever written into a mutation target.
function randomMutationMarker(): { kind: 'url' | 'displayName'; text: string } {
  const nonce = crypto.randomBytes(6).toString('hex');
  if (crypto.randomInt(2) === 0) {
    const paths = [`/${nonce}`, `/subscribe?ref=${nonce}`, `/r/${nonce}`, `/${nonce}/join`, `/go/${nonce}`];
    const prefixes = ['', 'Sign up at ', 'See ', 'Visit ', 'More: '];
    const path = paths[crypto.randomInt(paths.length)]!;
    const prefix = prefixes[crypto.randomInt(prefixes.length)]!;
    return { kind: 'url', text: `${prefix}https://open-design.ai${path}` };
  }
  const shapes = [
    `Open Design (ref ${nonce})`,
    `Powered by Open Design -- build ${nonce}`,
    `The Open Design team -- ${nonce}`,
    `Open Design v${nonce}`,
    `© Open Design, build ${nonce}`,
  ];
  return { kind: 'displayName', text: shapes[crypto.randomInt(shapes.length)]! };
}

function fisherYatesShuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mutation mechanism (I-W2-NO-PROBE-SIGNATURE). One `applyMutation` dispatch
// per supported file class; anything else is a hard failure, never a skip.
// ---------------------------------------------------------------------------
type MutationOutcome = { ok: true; mutated: string; markerKind: 'url' | 'displayName' } | { ok: false; error: string };

function escapeForTemplateLiteralChunk(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

// A mutation carrier is an EXISTING string/template/JSX-text span already in
// the source; mutating it means overwriting its content in place, never
// adding a declaration, identifier, property, or comment around it.
interface MutationCarrier {
  start: number;
  end: number;
  replacementFor: (payload: string) => string;
}

// Excludes import/export module specifiers (including dynamic `import()`
// and `export =`/`export default` assignments), directive-prologue-shaped
// bare string-expression-statements, and property-name positions (object/
// class/interface member names, computed property names, AND element-access
// keys like `obj["Open Design"]`) -- exactly the exclusions
// I-W2-NO-PROBE-SIGNATURE names. Fidelity-round fix: dynamic-import
// specifiers, export assignments, class property names, and element-access
// keys were previously left eligible.
function isExcludedCarrierPosition(node: TsNode): boolean {
  const p = node.parent;
  if (!p) return false;
  if ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node) return true;
  if (ts.isImportEqualsDeclaration(p) && ts.isExternalModuleReference(p.moduleReference) && p.moduleReference.expression === node) return true;
  // Dynamic `import("specifier")`: a CallExpression whose callee is the
  // `import` keyword token itself (ts.isImportCall exists at runtime but is
  // not part of the public .d.ts, so match on SyntaxKind directly).
  if (ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword && p.arguments[0] === node) return true;
  if (ts.isExportAssignment(p) && p.expression === node) return true;
  if (ts.isExpressionStatement(p) && p.expression === node) return true;
  if (ts.isComputedPropertyName(p)) return true;
  if (ts.isPropertyAssignment(p) && p.name === node) return true;
  if (ts.isPropertySignature(p) && p.name === node) return true;
  if (ts.isPropertyDeclaration(p) && p.name === node) return true;
  if (ts.isMethodDeclaration(p) && p.name === node) return true;
  if (ts.isMethodSignature(p) && p.name === node) return true;
  if (ts.isGetAccessorDeclaration(p) && p.name === node) return true;
  if (ts.isSetAccessorDeclaration(p) && p.name === node) return true;
  if (ts.isEnumMember(p) && p.name === node) return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true;
  return false;
}

function collectMutationCarriers(sourceFile: TypeScriptModule.SourceFile): MutationCarrier[] {
  const carriers: MutationCarrier[] = [];
  walkAst(sourceFile, (node) => {
    if (ts.isStringLiteralLike(node)) {
      if (isExcludedCarrierPosition(node)) return;
      carriers.push({ start: node.getStart(sourceFile), end: node.getEnd(), replacementFor: (payload) => JSON.stringify(payload) });
      return;
    }
    if (ts.isTemplateExpression(node)) {
      // Each literal piece (head, and every span's middle/tail) is an
      // independently eligible carrier -- overwriting one preserves the
      // surrounding `${...}` interpolations and backtick delimiters.
      carriers.push({
        start: node.head.getStart(sourceFile),
        end: node.head.getEnd(),
        replacementFor: (payload) => `\`${escapeForTemplateLiteralChunk(payload)}\${`,
      });
      for (const span of node.templateSpans) {
        const lit = span.literal;
        const isTail = lit.kind === ts.SyntaxKind.TemplateTail;
        carriers.push({
          start: lit.getStart(sourceFile),
          end: lit.getEnd(),
          replacementFor: (payload) => (isTail ? `}${escapeForTemplateLiteralChunk(payload)}\`` : `}${escapeForTemplateLiteralChunk(payload)}\${`),
        });
      }
      return;
    }
    if (ts.isJsxText(node) && node.text.trim().length > 0) {
      carriers.push({ start: node.getStart(sourceFile), end: node.getEnd(), replacementFor: (payload) => payload.replace(/[<>{}&]/g, '') });
    }
  });
  return carriers;
}

function isSyntacticallyValid(text: string, scriptKind: TypeScriptModule.ScriptKind): boolean {
  try {
    const fileName = scriptKind === ts.ScriptKind.TSX ? 'reparse-check.tsx' : scriptKind === ts.ScriptKind.JSX ? 'reparse-check.jsx' : 'reparse-check.ts';
    const result = ts.transpileModule(text, {
      compilerOptions: { target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext },
      reportDiagnostics: true,
      fileName,
    });
    return !result.diagnostics || result.diagnostics.length === 0;
  } catch {
    return false;
  }
}

// AST-select a RANDOM existing eligible carrier and overwrite it in place;
// reparse (isSyntacticallyValid) before returning. No valid carrier, or a
// reparse failure, is a hard failure -- never a skip.
function applyCodeMutation(relPath: string, original: string, marker: { kind: 'url' | 'displayName'; text: string }): MutationOutcome {
  if (!ts) return { ok: false, error: 'TypeScript compiler API unavailable -- cannot AST-select a mutation carrier' };
  const scriptKind = /\.tsx$/.test(relPath) ? ts.ScriptKind.TSX : /\.jsx$/.test(relPath) ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
  let sourceFile: TypeScriptModule.SourceFile;
  try {
    sourceFile = ts.createSourceFile(relPath, original, ts.ScriptTarget.Latest, true, scriptKind);
  } catch (err) {
    return { ok: false, error: `could not parse original source: ${String((err as Error)?.message ?? err)}` };
  }
  const carriers = collectMutationCarriers(sourceFile);
  if (carriers.length === 0) {
    return { ok: false, error: 'no eligible string/template/JSX-text carrier found (excluding imports/exports, directive prologues, and property names) -- no valid mutation carrier' };
  }
  const carrier = carriers[crypto.randomInt(carriers.length)]!;
  const mutated = original.slice(0, carrier.start) + carrier.replacementFor(marker.text) + original.slice(carrier.end);
  if (!isSyntacticallyValid(mutated, scriptKind)) {
    return { ok: false, error: 'mutated source failed to reparse cleanly' };
  }
  return { ok: true, mutated, markerKind: marker.kind };
}

// JSON: replace an EXISTING string-valued leaf's value; never add a
// property. Absence of a string leaf, or unparsable JSON, is a hard failure.
function applyJsonMutation(original: string, marker: { kind: 'url' | 'displayName'; text: string }): MutationOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(original);
  } catch (err) {
    return { ok: false, error: `not parseable JSON: ${String((err as Error)?.message ?? err)}` };
  }
  const setters: Array<(v: string) => void> = [];
  (function collect(node: unknown): void {
    if (Array.isArray(node)) {
      node.forEach((v, i) => {
        if (typeof v === 'string') setters.push((nv) => { (node as unknown[])[i] = nv; });
        else collect(v);
      });
    } else if (node && typeof node === 'object') {
      for (const k of Object.keys(node as Record<string, unknown>)) {
        const v = (node as Record<string, unknown>)[k];
        if (typeof v === 'string') setters.push((nv) => { (node as Record<string, unknown>)[k] = nv; });
        else collect(v);
      }
    }
  })(parsed);
  if (setters.length === 0) return { ok: false, error: 'no existing string-valued leaf found in the JSON document to mutate' };
  setters[crypto.randomInt(setters.length)]!(marker.text);
  return { ok: true, mutated: JSON.stringify(parsed, null, 2), markerKind: marker.kind };
}

// Markdown/text: insert the payload at a CSPRNG-selected line boundary
// (never a fixed position) with no probe-owned wrapper.
function applyTextBoundaryMutation(original: string, marker: { kind: 'url' | 'displayName'; text: string }): MutationOutcome {
  const boundaries = [0, original.length];
  for (let i = 0; i < original.length; i++) if (original[i] === '\n') boundaries.push(i + 1);
  const offset = boundaries[crypto.randomInt(boundaries.length)]!;
  const before = original.slice(0, offset);
  const after = original.slice(offset);
  const leadingNl = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
  const trailingNl = after.length > 0 && !after.startsWith('\n') ? '\n' : '';
  return { ok: true, mutated: `${before}${leadingNl}${marker.text}\n${trailingNl}${after}`, markerKind: marker.kind };
}

// Dispatcher: JSON leaf replace, AST carrier replace for code, CSPRNG text
// boundary for Markdown. Everything else is unsupported -- a hard failure,
// never a skip (I-W2-NO-PROBE-SIGNATURE mechanism, ceremony ruling F1).
function applyMutation(relPath: string, original: string): MutationOutcome {
  const marker = randomMutationMarker();
  if (relPath.endsWith('.json')) return applyJsonMutation(original, marker);
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(relPath)) return applyCodeMutation(relPath, original, marker);
  if (relPath.endsWith('.md')) return applyTextBoundaryMutation(original, marker);
  return { ok: false, error: `unsupported file type for mutation ("${relPath}") -- unsupported/binary targets are hard failures, never skips` };
}

async function checkC2_3(discovery: BrandSurfaceDiscovery | null): Promise<void> {
  await probe(
    'C2-3',
    'rsync-copy the repo (excluding node_modules/.git/dist/.next/.tmp) to a scratch dir; symlink node_modules read-only (mount-namespace-free best effort); run the discovered check function on the pristine copy (negative control, expect pass); resolve EVERY inventory entry via the single shared canonical-target resolver (I-W2-ONE-CANONICAL-TARGET) and give every resolved entry exactly one completed mutation attempt -- a CSPRNG-selected EXISTING carrier (AST string/template literal for code, a string leaf for JSON, a text boundary for Markdown) overwritten in place with a randomized, structurally-varied old-brand payload containing no stable verifier identity (I-W2-NO-PROBE-SIGNATURE), reparsed for validity, re-run (expect fail), then byte-verified revert; node_modules-rooted, unresolved, outside-copy, unsupported, or unparsable targets are hard failures, never silent skips; mutationsAttempted must equal inventory.length; the real repo tree is never written to',
    'the check function passes on the unmutated copy (proving it is not vacuously failing) and every resolved inventory entry, mutated with a probe-signature-free payload, fails the check (proving each inventoried surface class is actually enforced, not merely pattern-matched against a fixed wrapper), with mutationsAttempted === inventory.length and no entry silently exempted, and the real repository tree remains untouched throughout',
    async () => {
      if (!discovery || !discovery.modulePath || !discovery.checkFnName || !discovery.inventoryExportName) {
        return { ok: false, evidence: 'C2-2 discovery did not find a usable check-brand-surfaces module/function/inventory -- cannot run the mutation test', detail: 'depends on C2-2' };
      }
      const evidenceLines: string[] = [];
      const problems: string[] = [];
      const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w2-mutation-'));
      const copyRoot = path.join(scratchRoot, 'repo-copy');
      try {
        fs.mkdirSync(copyRoot, { recursive: true });
        const rsync = sh(
          'rsync',
          ['-a', '--exclude=.git', '--exclude=node_modules', '--exclude=dist', '--exclude=.next', '--exclude=.tmp', '--exclude=out', '--exclude=.turbo', '--exclude=coverage', `${repoRoot}/`, `${copyRoot}/`],
          repoRoot,
          undefined,
          5 * 60_000,
        );
        if (rsync.status !== 0) {
          return { ok: false, evidence: `rsync repo copy failed: ${rsync.stderr || rsync.stdout}`, detail: 'could not build an isolated scratch copy' };
        }
        try {
          fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(copyRoot, 'node_modules'), 'dir');
        } catch (err) {
          return { ok: false, evidence: `could not symlink node_modules into the scratch copy: ${String(err)}`, detail: 'scratch copy cannot resolve its own imports' };
        }
        // Sol round-1 F3: the node_modules symlink points at the REAL,
        // shared node_modules -- a write through it would mutate the live
        // dependency tree invisibly to `git status` (node_modules is
        // gitignored). Never treat anything under it as a mutation target,
        // and realpath-verify (below) that no mutation target resolves
        // outside the scratch copy through it or any other symlink.
        const realCopyRoot = fs.realpathSync(copyRoot);

        const relModulePath = path.relative(repoRoot, discovery.modulePath);
        const copyModulePath = path.join(copyRoot, relModulePath);
        const checkFnName = discovery.checkFnName;
        const inventoryExportName = discovery.inventoryExportName;

        async function runCheckOnCopy(): Promise<{ ok: boolean; raw: unknown }> {
          const mod = (await import(pathToFileURL(copyModulePath).href + `?t=${Date.now()}-${Math.random()}`)) as Record<string, unknown>;
          const fn = mod[checkFnName] as () => Promise<boolean> | boolean;
          const raw = await fn();
          return { ok: raw === true, raw };
        }

        const baseline = await runCheckOnCopy();
        evidenceLines.push(`baseline (unmutated copy) check result: ${JSON.stringify(baseline.raw)}`);
        if (!baseline.ok) {
          problems.push('the check function returns non-true on a pristine, unmutated copy of the tree -- it is not a working negative control, so a later "fail" on a mutated copy would be meaningless');
        }

        const inventoryMod = (await import(pathToFileURL(copyModulePath).href + `?t=${Date.now()}-init`)) as Record<string, unknown>;
        const inventory = inventoryMod[inventoryExportName] as Array<Record<string, unknown>>;
        const shuffledInventory = fisherYatesShuffle(inventory);
        // I-W2-ONE-CANONICAL-TARGET (ceremony ruling F2): every entry gets
        // exactly one completed mutation attempt -- no `continue` may exempt
        // an accepted entry from being counted. Resolution/mutation failures
        // are surfaced per entry in `problems`, never converted into skips.
        // Fidelity-round fix: `mutationsAttempted` now increments ONLY once
        // a full mutate-run-revert cycle actually completes (not at the top
        // of the loop before resolution is even attempted), so
        // `mutationsAttempted === inventory.length` is a genuine signal --
        // any entry that fails resolution, containment, or mutation makes
        // the count fall short (in addition to its own per-entry problem),
        // rather than being tautologically true by construction.
        let mutationsAttempted = 0;
        for (const [index, entry] of shuffledInventory.entries()) {
          const resolution = resolveInventoryTargetPath(entry);
          if (!resolution.ok) {
            problems.push(`entry ${index + 1}/${shuffledInventory.length}: canonical-target resolution failed: ${resolution.error}`);
            continue;
          }
          const canonicalPath = resolution.canonicalPath;
          if (canonicalPath === 'node_modules' || canonicalPath.startsWith('node_modules/')) {
            problems.push(`${canonicalPath}: node_modules-rooted path is not eligible for mutation`);
            continue;
          }
          const targetInCopy = path.join(copyRoot, canonicalPath);
          let realTargetInCopy: string;
          try {
            realTargetInCopy = fs.realpathSync(targetInCopy);
          } catch (err) {
            problems.push(`${canonicalPath}: does not exist in the scratch copy: ${String((err as Error)?.message ?? err)}`);
            continue;
          }
          // Sol round-1 F3: realpath-containment -- refuse to mutate
          // anything that resolves outside the scratch copy (a symlink
          // escape from rsync-preserved links, or a path-traversal-shaped
          // inventory entry).
          if (!(realTargetInCopy === realCopyRoot || realTargetInCopy.startsWith(realCopyRoot + path.sep))) {
            problems.push(`${canonicalPath}: resolved outside the scratch copy (${realTargetInCopy}) -- refusing to mutate (symlink/traversal escape guard)`);
            continue;
          }
          // Fidelity-round fix: read as a Buffer and verify a lossless UTF-8
          // round-trip BEFORE treating the content as text. A lossy decode
          // (invalid UTF-8 / binary content) would otherwise let the
          // eventual string-based restore silently corrupt the scratch
          // original while a string comparison still reported "matches".
          const originalBuffer = fs.readFileSync(targetInCopy);
          const utf8RoundTrip = Buffer.from(originalBuffer.toString('utf8'), 'utf8');
          if (!utf8RoundTrip.equals(originalBuffer)) {
            problems.push(`${canonicalPath}: not valid UTF-8 (binary or lossy-decode content) -- unsupported/binary targets are hard failures, never skips`);
            continue;
          }
          const original = originalBuffer.toString('utf8');
          const mutation = applyMutation(canonicalPath, original);
          if (!mutation.ok) {
            problems.push(`${canonicalPath}: ${mutation.error}`);
            continue;
          }
          fs.writeFileSync(targetInCopy, mutation.mutated);
          let mutatedResult: { ok: boolean; raw: unknown } | null = null;
          let threw: string | null = null;
          try {
            mutatedResult = await runCheckOnCopy();
          } catch (err) {
            threw = String((err as Error)?.stack ?? err);
          }
          // Restore the ORIGINAL BYTES (the Buffer captured before mutation),
          // not a re-encoded string -- and verify the revert at the byte
          // level (Buffer.equals), not via a UTF-8 string comparison that a
          // lossy decode could make pass despite real corruption.
          fs.writeFileSync(targetInCopy, originalBuffer);
          const stillMatchesOriginal = fs.readFileSync(targetInCopy).equals(originalBuffer);
          if (!stillMatchesOriginal) problems.push(`${canonicalPath}: revert verification failed after mutation (byte-level mismatch)`);
          // A full mutate -> run -> revert cycle completed for this entry --
          // this is the "completed mutation attempt" the ruling requires.
          mutationsAttempted += 1;
          if (threw) {
            evidenceLines.push(`${canonicalPath}: mutation (${mutation.markerKind}) caused the check to throw (treated as a pass-through, not a confirmed catch): ${threw.slice(0, 300)}`);
            problems.push(`${canonicalPath}: check function threw instead of returning false on a mutated copy -- inconclusive, not a confirmed reintroduction catch`);
          } else if (mutatedResult) {
            evidenceLines.push(`${canonicalPath}: mutation kind=${mutation.markerKind} mutated copy check result: ${JSON.stringify(mutatedResult.raw)}`);
            if (mutatedResult.ok) problems.push(`${canonicalPath}: injecting a randomized old-brand-shaped payload (${mutation.markerKind}) did NOT fail the check -- this surface class is not actually enforced`);
          }
        }
        if (mutationsAttempted !== inventory.length) {
          problems.push(`mutationsAttempted (${mutationsAttempted}) !== inventory.length (${inventory.length}) -- every entry must receive exactly one COMPLETED mutation attempt, with no continue-exemption`);
        }
        evidenceLines.push(`mutations attempted (completed cycles): ${mutationsAttempted} of ${inventory.length} inventory entries (randomized order, uncapped)`);
      } finally {
        try {
          fs.rmSync(scratchRoot, { recursive: true, force: true });
        } catch {
          /* best effort cleanup */
        }
      }

      const treeStatus = sh('git', ['status', '--porcelain']);
      if (treeStatus.stdout.trim().length > 0) {
        problems.push('git status is not clean after the mutation test -- the real repository tree may have been touched (it must never be; only the scratch copy is mutated)');
      }

      return { ok: problems.length === 0, evidence: evidenceLines.join('\n'), detail: problems[0] };
    },
  );
}

// ===========================================================================
// C2-4 -- favicon/apple-touch-icon are MishMash; home-logo-assets.test.ts
// extended to cover the PNGs (red before, green after).
// ===========================================================================
const OLD_APP_ICON_SHA256 = '3141cc3b348ac538c68d615cde8cf642abc0b1fb60f44a520853b499982a74cb';
const OLD_LOGO_SHA256 = 'b8f95c00d25f3bc2af03a03eb9236cff4745e923e28528efc45c04dc1f9f93ff';

async function checkC2_4(): Promise<void> {
  await probe(
    'C2-4',
    'sha256 the wired favicon/apple-touch-icon PNGs (paths read from apps/web/app/layout.tsx\'s AST) against a hardcoded deny-set of the frozen old-brand asset hashes; parse apps/web/tests/components/home-logo-assets.test.ts and confirm it now asserts on PNG bytes (not just SVGs); replay that test file against a baseCommit worktree (red) and HEAD (green)',
    'the PNGs served as favicon and apple-touch-icon differ in sha256 from the recorded old-brand hashes; home-logo-assets.test.ts references and asserts on the PNG paths; the test fails at baseCommit and passes at HEAD',
    async () => {
      const problems: string[] = [];
      const evidenceLines: string[] = [];

      const layoutPath = abs('apps/web/app/layout.tsx');
      const iconPaths = new Set<string>();
      if (!fs.existsSync(layoutPath)) {
        problems.push('apps/web/app/layout.tsx not found');
      } else if (ts) {
        const { sourceFile } = parseSource(layoutPath);
        walkAst(sourceFile, (node) => {
          if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) && /^(icon|apple)$/.test(ts.isIdentifier(node.name) ? node.name.text : node.name.text)) {
            const val = evalSimpleStringExpr(node.initializer);
            if (val) iconPaths.add(val.replace(/^\//, ''));
          }
        });
      }
      if (iconPaths.size === 0) {
        problems.push('could not find metadata.icons.icon / metadata.icons.apple string values in layout.tsx via AST');
      }
      evidenceLines.push(`wired icon paths from layout.tsx: ${[...iconPaths].join(', ') || '(none found)'}`);
      for (const rel of iconPaths) {
        const fileAbs = abs(path.join('apps/web/public', rel));
        const hash = sha256File(fileAbs);
        evidenceLines.push(`apps/web/public/${rel}: sha256=${hash}`);
        if (!hash) {
          problems.push(`apps/web/public/${rel} does not exist`);
        } else if (hash === OLD_APP_ICON_SHA256 || hash === OLD_LOGO_SHA256) {
          problems.push(`apps/web/public/${rel} still matches an old-brand asset hash (${hash})`);
        }
      }
      // Also directly check the two named legacy files, UNCONDITIONALLY --
      // Sol round-1 F4: this used to only log (never fail) when layout.tsx
      // didn't happen to wire the file, which let logo.png sit in a
      // user-visible public/ path still carrying the frozen old-brand bytes
      // and pass anyway. Both frozen files are known old-brand assets by
      // name; either one still matching its old hash is a hard fail
      // regardless of what layout.tsx currently wires as the favicon.
      for (const known of ['app-icon.png', 'logo.png']) {
        const h = sha256File(abs(path.join('apps/web/public', known)));
        evidenceLines.push(`apps/web/public/${known}: sha256=${h ?? '(missing)'}`);
        if (h && (h === OLD_APP_ICON_SHA256 || h === OLD_LOGO_SHA256)) {
          problems.push(`apps/web/public/${known} still matches an old-brand asset hash (${h}), regardless of whether layout.tsx currently wires it`);
        }
      }

      const testRelPath = 'apps/web/tests/components/home-logo-assets.test.ts';
      const testAbsPath = abs(testRelPath);
      let testCoversPngs = false;
      if (!fs.existsSync(testAbsPath)) {
        problems.push(`${testRelPath} not found`);
      } else {
        const testSource = fs.readFileSync(testAbsPath, 'utf8');
        testCoversPngs = /\.png/.test(testSource) && /sha256|createHash|readFileSync\([^)]*\.png/i.test(testSource);
        if (!testCoversPngs) problems.push(`${testRelPath} does not appear to reference/assert on a .png asset yet (no .png + hash-style assertion found)`);
      }

      if (testCoversPngs && baseCommit) {
        const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w2-red-worktree-'));
        fs.rmSync(worktreeDir, { recursive: true, force: true });
        try {
          const add = sh('git', ['worktree', 'add', '--detach', worktreeDir, baseCommit]);
          if (add.status !== 0) {
            problems.push(`git worktree add for red-at-parent check failed: ${add.stdout}`);
          } else {
            const testDirInWorktree = path.join(worktreeDir, path.dirname(testRelPath));
            fs.mkdirSync(testDirInWorktree, { recursive: true });
            fs.writeFileSync(path.join(worktreeDir, testRelPath), fs.readFileSync(testAbsPath, 'utf8'));
            const webPkgJsonInWorktree = path.join(worktreeDir, 'apps/web/package.json');
            const vitestConfigInWorktree = path.join(worktreeDir, 'apps/web/vitest.config.ts');
            if (fs.existsSync(webPkgJsonInWorktree) && fs.existsSync(vitestConfigInWorktree)) {
              // Sol round-1 F4: a bare nonzero exit doesn't prove the PNG
              // assertion specifically caused it -- an unrelated crash (a
              // missing SVG fixture, a module-resolution error) would also
              // exit nonzero and look like a valid "red." Use the JSON
              // reporter and require the failure MESSAGE actually names a
              // PNG-shaped assertion (the icon filename or a hash
              // comparison), not just "the process didn't exit 0."
              const redJsonPath = path.join(proofDir, 'C2-4-red-at-parent.json');
              const redRun = sh(
                'pnpm',
                ['exec', 'vitest', 'run', '-c', 'vitest.config.ts', '--reporter=json', `--outputFile=${redJsonPath}`, testRelPath.replace('apps/web/', '')],
                path.join(worktreeDir, 'apps/web'),
                undefined,
                3 * 60_000,
              );
              let redFailureMessages: string[] = [];
              try {
                const redData = JSON.parse(fs.readFileSync(redJsonPath, 'utf8')) as { testResults: Array<{ assertionResults: Array<{ status: string; failureMessages?: string[] }> }> };
                redFailureMessages = redData.testResults.flatMap((t) => t.assertionResults).filter((a) => a.status === 'failed').flatMap((a) => a.failureMessages ?? []);
              } catch {
                /* left empty, handled below */
              }
              const pngShapedFailure = redFailureMessages.some((m) => /\.png/i.test(m) || /sha256|hash/i.test(m));
              evidenceLines.push(`red-at-parent (baseCommit=${baseCommit.slice(0, 12)}) run exit=${redRun.status}, pngShapedFailure=${pngShapedFailure}, failureMessages=${JSON.stringify(redFailureMessages).slice(0, 500)}`);
              if (redRun.status === 0) {
                problems.push('extended home-logo-assets.test.ts passes even when run against baseCommit\'s public/*.png assets -- it is not distinguishing old bytes from new (no genuine red-before-green)');
              } else if (!pngShapedFailure) {
                problems.push('home-logo-assets.test.ts fails at baseCommit, but no failure message mentions a .png/sha256/hash assertion -- the red could be an unrelated crash, not proof the PNG check specifically caught the old bytes');
              }
            } else {
              problems.push('could not locate apps/web/package.json or vitest.config.ts inside the baseCommit worktree to run the red-at-parent check');
            }
          }
        } finally {
          sh('git', ['worktree', 'remove', '--force', worktreeDir]);
          fs.rmSync(worktreeDir, { recursive: true, force: true });
        }

        const greenRun = sh('pnpm', ['exec', 'vitest', 'run', '-c', 'vitest.config.ts', 'tests/components/home-logo-assets.test.ts'], abs('apps/web'), undefined, 3 * 60_000);
        evidenceLines.push(`green-at-HEAD run exit=${greenRun.status}`);
        if (greenRun.status !== 0) problems.push(`home-logo-assets.test.ts does not pass at HEAD (exit=${greenRun.status})`);
      } else if (testCoversPngs && !baseCommit) {
        problems.push('baseCommit unresolved -- cannot run the red-at-parent half of this check');
      }

      return { ok: problems.length === 0, evidence: `${evidenceLines.join('\n')}\n\nPROBLEMS:\n${problems.join('\n') || '(none)'}`, detail: problems[0] };
    },
  );
}

// ===========================================================================
// C2-5 -- README is MishMash's, by required content + forbidden content.
// ===========================================================================
async function checkC2_5(): Promise<void> {
  await probe(
    'C2-5',
    'text-scan README.md for a set of forbidden upstream markers and a set of required content markers',
    'README.md contains none of {open design cloud, discord.gg, open-design.ai, nexu-io/open-design, @OpenDesignHQ} (case-insensitive) AND does mention MishMash + fork identity + FORK-PIN.md + a real run command (pnpm tools-dev)',
    async () => {
      const readme = readText('README.md');
      if (readme === null) return { ok: false, evidence: 'README.md not found', detail: 'missing' };
      const lower = readme.toLowerCase();
      const forbidden = ['open design cloud', 'discord.gg', 'open-design.ai', 'nexu-io/open-design', '@opendesignhq'];
      const problems: string[] = [];
      for (const marker of forbidden) {
        if (lower.includes(marker)) problems.push(`README.md still contains forbidden upstream marker: "${marker}"`);
      }
      const requiredChecks: Array<[string, RegExp]> = [
        ['mentions MishMash', /mishmash/i],
        ['states fork identity/relationship to upstream', /\bfork\b/i],
        ['references the FORK-PIN lane', /fork-pin\.md/i],
        ['documents how to run it (pnpm tools-dev)', /pnpm\s+tools-dev/],
      ];
      for (const [label, re] of requiredChecks) {
        if (!re.test(readme)) problems.push(`README.md is missing required content: ${label}`);
      }
      return {
        ok: problems.length === 0,
        evidence: `README.md length=${readme.length} bytes\n\nPROBLEMS:\n${problems.join('\n') || '(none)'}`,
        detail: problems[0],
      };
    },
  );
}

// ===========================================================================
// C2-6 -- upstream metadata route removed or repointed; no doc-only escape.
// ===========================================================================
async function checkC2_6(daemon: BootedDaemon): Promise<void> {
  await probe(
    'C2-6',
    'if apps/daemon/src/routes/open-design-public-metadata.ts still exists, boot the daemon and GET its 3 endpoints, inspecting the actual JSON payload for upstream identifiers (nexu-io/open-design repo, mHAjSMV6gz Discord invite); if the file is removed, AST-scan the whole repo\'s import specifiers and fetch(-target string literals for any remaining consumer',
    'either the route file is gone with no remaining consumer (grep-verified import specifiers AND literal endpoint-path strings), or it is repointed such that none of its live JSON responses carry the upstream repo/invite identifiers -- a doc-only "deliberate" claim is not accepted while egress still serves upstream data (VERIFICATION-CONTRACT S3 R5)',
    async () => {
      const problems: string[] = [];
      const evidenceLines: string[] = [];
      const routeRelPath = 'apps/daemon/src/routes/open-design-public-metadata.ts';
      const routeExists = exists(routeRelPath);
      evidenceLines.push(`route file exists: ${routeExists}`);

      if (!routeExists) {
        if (!ts) {
          problems.push(`TypeScript compiler API unavailable: ${tsLoadError}`);
        } else {
          const candidateFiles = collectRepoFiles(['apps', 'packages'], { exts: ['.ts', '.tsx'] });
          const consumers: string[] = [];
          for (const file of candidateFiles) {
            let sourceFile: TypeScriptModule.SourceFile;
            try {
              ({ sourceFile } = parseSource(file));
            } catch {
              continue;
            }
            walkAst(sourceFile, (node) => {
              if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && /open-design-public-metadata/i.test(node.moduleSpecifier.text)) {
                consumers.push(`${toRepoRelative(file)} imports "${node.moduleSpecifier.text}"`);
              }
              if (ts.isStringLiteralLike(node) && /^\/api\/(github\/open-design|community\/discord)/.test(node.text)) {
                consumers.push(`${toRepoRelative(file)}: literal endpoint string "${node.text}"`);
              }
            });
          }
          if (consumers.length > 0) {
            problems.push(`route file is removed but ${consumers.length} consumer reference(s) remain:\n${consumers.join('\n')}`);
          }
          evidenceLines.push(`consumer scan found ${consumers.length} reference(s)`);
        }
      } else {
        if (daemon.bootFailure) {
          problems.push(`route file still exists and the daemon could not be booted to inspect its live responses: ${daemon.bootFailure}`);
        } else {
          // Sol round-1 F5: a response-body-only check is defeated by
          // returning a different response TEXT while the service keeps
          // calling the exact frozen upstream URLs -- egress is behavior,
          // never documentation (VERIFICATION-CONTRACT S3 R5). Assert on the
          // CAPTURED requests (same boundary as C2-1), not just what the
          // route says back to the client. A 404/502/thrown request is also
          // a fail here (not a skip): a route left present but broken is not
          // a "repointed" pass.
          const checks: Array<{ path: string; badFields: RegExp[] }> = [
            { path: '/api/github/open-design', badFields: [/nexu-io\/open-design/i] },
            { path: '/api/github/open-design/releases/latest', badFields: [/nexu-io\/open-design/i] },
            { path: '/api/community/discord', badFields: [/mHAjSMV6gz/i] },
          ];
          for (const c of checks) {
            try {
              const resp = await fetch(`${daemon.url}${c.path}`);
              const text = await resp.text();
              evidenceLines.push(`GET ${c.path} -> ${resp.status}: ${text.slice(0, 300)}`);
              if (resp.status < 200 || resp.status >= 300) {
                problems.push(`GET ${c.path} returned non-2xx status ${resp.status} -- the route file is present but not serving a working repointed response (404/502/error is not a pass)`);
              } else {
                for (const bad of c.badFields) {
                  if (bad.test(text)) problems.push(`GET ${c.path} response still carries an upstream identifier matching ${bad}`);
                }
              }
            } catch (err) {
              problems.push(`GET ${c.path} threw instead of returning a real response: ${String(err)}`);
            }
          }

          const FROZEN_UPSTREAM_CALLS: Array<{ host: string; pathTest: RegExp; label: string }> = [
            { host: 'api.github.com', pathTest: /\/repos\/nexu-io\/open-design(\/releases\/latest)?$/, label: 'GitHub repo/release stats for nexu-io/open-design' },
            { host: 'discord.com', pathTest: /\/invites\/mHAjSMV6gz/, label: 'Discord invite lookup for mHAjSMV6gz' },
          ];
          const egress = daemon.readEgress();
          for (const call of egress) {
            let callPath = '';
            try {
              callPath = new URL(call.url).pathname;
            } catch {
              /* leave empty */
            }
            for (const frozen of FROZEN_UPSTREAM_CALLS) {
              if (call.host === frozen.host && frozen.pathTest.test(callPath)) {
                problems.push(`captured outbound call to the frozen upstream endpoint (${frozen.label}): ${call.method} ${call.url} -- the service still calls it even if the client-facing response text changed`);
              }
            }
          }
          evidenceLines.push(`captured ${egress.length} outbound call(s) while exercising the metadata routes; checked against ${FROZEN_UPSTREAM_CALLS.length} frozen upstream endpoint(s)`);
        }
      }

      return { ok: problems.length === 0, evidence: `${evidenceLines.join('\n')}\n\nPROBLEMS:\n${problems.join('\n') || '(none)'}`, detail: problems[0] };
    },
  );
}

// ===========================================================================
// C2-7 -- foreign UI chrome removed, deliberate content retained.
// ===========================================================================
async function checkC2_7(): Promise<void> {
  await probe(
    'C2-7',
    'AST-parse clipper/i18n.js: require LOCALES deep-equals [\'en\'] (not just length 1) and the `overrides` object literal has zero populated non-English entries; grep-confirm settings.memoryEmptyHintZh is fully absent from en.ts, types.ts, and everywhere else; sha256-compare EVERY file under the full huashu-* example set and humanize-ppt between baseCommit and HEAD to prove none of it was collaterally deleted; require a retained-content rationale doc outside docs/plans/**',
    'clipper/i18n.js ships English-only (LOCALES===["en"]); the orphaned memoryEmptyHintZh key is gone everywhere; every sampled deliberate-content file (all huashu-* examples + humanize-ppt, not a 3-file sample) is byte-identical to baseCommit; the retained-content rationale lives in a real doc, not the W2 PRD describing the work',
    async () => {
      const problems: string[] = [];
      const evidenceLines: string[] = [];

      const clipperPath = abs('clipper/i18n.js');
      if (!exists('clipper/i18n.js')) {
        problems.push('clipper/i18n.js not found');
      } else if (ts) {
        const { sourceFile } = parseSource(clipperPath);
        // Wrapped in helper functions that RETURN the discovered value
        // (rather than a `let` mutated from inside the walkAst callback and
        // narrowed at the call site) -- TS's control-flow analysis does not
        // trace assignment through an arbitrary passed callback, so
        // narrowing a closure-mutated `let` against `null` right after the
        // call spuriously narrows the non-null branch to `never`.
        function findLocalesArrayValues(): string[] | null {
          let result: string[] | null = null;
          walkAst(sourceFile, (node) => {
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'LOCALES' && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
              result = node.initializer.elements.map((el) => evalSimpleStringExpr(el) ?? `<unresolvable:${el.getText(sourceFile)}>`);
            }
          });
          return result;
        }
        function findOverridesEntryCount(): number | null {
          let result: number | null = null;
          walkAst(sourceFile, (node) => {
            if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'overrides' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
              result = node.initializer.properties.length;
            }
          });
          return result;
        }
        const localesValues = findLocalesArrayValues();
        const overridesEntryCount = findOverridesEntryCount();
        evidenceLines.push(`clipper/i18n.js: LOCALES=${JSON.stringify(localesValues)}, overrides entry count=${overridesEntryCount}`);
        // Sol round-1 F6: length===1 alone would pass LOCALES=['zh-CN'] --
        // require the actual, sole element to be the string "en".
        if (localesValues === null) problems.push('clipper/i18n.js: could not find a LOCALES array literal via AST');
        else if (!(localesValues.length === 1 && localesValues[0] === 'en')) problems.push(`clipper/i18n.js: LOCALES is ${JSON.stringify(localesValues)}, want exactly ["en"]`);
        if (overridesEntryCount === null) {
          // no `overrides` object at all is also an acceptable English-only shape
          evidenceLines.push('clipper/i18n.js: no `overrides` object literal found (acceptable if the dictionary was collapsed to English-only some other way)');
        } else if (overridesEntryCount !== 0) {
          problems.push(`clipper/i18n.js: \`overrides\` still has ${overridesEntryCount} non-English locale entries`);
        }
      } else {
        problems.push(`TypeScript compiler API unavailable: ${tsLoadError}`);
      }

      const enTsHasKey = /memoryEmptyHintZh/.test(readText('apps/web/src/i18n/locales/en.ts') ?? '');
      const typesTsHasKey = /memoryEmptyHintZh/.test(readText('apps/web/src/i18n/types.ts') ?? '');
      const anyOtherReference = collectRepoFiles(['apps', 'packages'], { exts: ['.ts', '.tsx'] }).some(
        (f) => !f.endsWith('apps/web/src/i18n/locales/en.ts') && !f.endsWith('apps/web/src/i18n/types.ts') && fs.readFileSync(f, 'utf8').includes('memoryEmptyHintZh'),
      );
      evidenceLines.push(`memoryEmptyHintZh: en.ts=${enTsHasKey}, types.ts=${typesTsHasKey}, elsewhere=${anyOtherReference}`);
      if (enTsHasKey) problems.push('apps/web/src/i18n/locales/en.ts still defines settings.memoryEmptyHintZh');
      if (typesTsHasKey) problems.push('apps/web/src/i18n/types.ts still declares settings.memoryEmptyHintZh');
      if (anyOtherReference) problems.push('memoryEmptyHintZh is still referenced somewhere outside en.ts/types.ts');

      // Deliberate-content preservation: Sol round-1 F6 -- a 3-file sample
      // ignored the rest of the huashu-* set and all of humanize-ppt.
      // Compare EVERY file under the full set instead.
      //
      // Sol round-2 F3: the frozen comparison set must be enumerated from
      // baseCommit, not HEAD -- otherwise a deleted directory or file simply
      // isn't there to enumerate at HEAD and silently drops out of the
      // comparison. It must also cover every tracked file under the roots,
      // not a 5-extension allowlist (the pinned base is 79 files across the
      // nine huashu-* roots + humanize-ppt; a .md/.ts/.py/.json/.js filter
      // only sees 60 of them, missing every example.html and LICENSE file).
      // And a file present at baseCommit but missing at HEAD is a FAILURE
      // (wholesale deletion is not an acceptable way to remove foreign UI
      // chrome), never a silent `continue`.
      if (baseCommit) {
        const allFilesAtBase = listRepoFilesAtCommit(baseCommit);
        if (allFilesAtBase === null) {
          problems.push(`could not enumerate the repository tree at baseCommit (${baseCommit.slice(0, 12)}) via git ls-tree -- cannot verify deliberate-content preservation`);
        } else {
          const deliberateFileSet = allFilesAtBase.filter(
            (rel) => /^plugins\/_official\/examples\/huashu-[^/]+\//.test(rel) || rel.startsWith('plugins/community/humanize-ppt/'),
          );
          let sampledCount = 0;
          let changedCount = 0;
          let deletedCount = 0;
          for (const rel of deliberateFileSet) {
            const before = readFileAtCommit(baseCommit, rel);
            if (before === null) continue; // ls-tree already proved it exists at baseCommit; treat a read failure as inconclusive, not this check's concern
            sampledCount += 1;
            const after = readText(rel);
            if (after === null) {
              deletedCount += 1;
              problems.push(`${rel}: present at baseCommit but missing at HEAD -- deliberate multilingual content was deleted, not retained`);
            } else if (before !== after) {
              changedCount += 1;
              problems.push(`${rel}: deliberate multilingual content changed between baseCommit and HEAD -- collateral damage from the de-brand pass?`);
            }
          }
          evidenceLines.push(
            `deliberate-content preservation: ${sampledCount} file(s) enumerated from baseCommit's tree via git ls-tree (every tracked file under the huashu-* + humanize-ppt roots, no extension filter -- includes example.html and LICENSE), ${changedCount} changed, ${deletedCount} deleted`,
          );
        }
      }

      // A written retained-content rationale should exist somewhere under
      // docs/, but NOT inside docs/plans/** -- Sol round-1 F6: the W2 PRD
      // itself (docs/plans/waves/W2-brand-honesty.md) mentions "huashu" and
      // "multilingual" while describing the WORK to do, which would
      // satisfy a naive search vacuously without any actual written record
      // of what was decided to keep.
      const docsFiles = collectRepoFiles(['docs'], { exts: ['.md'] }).filter((f) => !toRepoRelative(f).startsWith('docs/plans/'));
      const hasRetainedContentDoc = docsFiles.some((f) => {
        const t = fs.readFileSync(f, 'utf8');
        return /huashu|retained/i.test(t) && /multilingual|non-english|foreign/i.test(t);
      });
      evidenceLines.push(`written retained-content rationale found under docs/ (excluding docs/plans/**): ${hasRetainedContentDoc}`);
      if (!hasRetainedContentDoc) problems.push('no docs/**/*.md file (outside docs/plans/**) explicitly lists retained multilingual content with a rationale');

      return { ok: problems.length === 0, evidence: `${evidenceLines.join('\n')}\n\nPROBLEMS:\n${problems.join('\n') || '(none)'}`, detail: problems[0] };
    },
  );
}

// ===========================================================================
// C2-8 -- toolbox discovery does not regress (before/after recall fixture).
// ===========================================================================
const TOOLBOX_RECALL_QUERIES = ['icon', 'gsap', 'moodboard', 'chart', 'logo', 'video', 'three.js', 'polish', 'transition', 'outline'];

async function loadDesignToolboxModuleFromSource(source: string): Promise<{ ids: (query: string) => string[] } | null> {
  const tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'od-w2-toolbox-')), 'design-toolbox.ts');
  fs.writeFileSync(tmpFile, source);
  try {
    const mod = (await import(pathToFileURL(tmpFile).href + `?t=${Date.now()}-${Math.random()}`)) as {
      DESIGN_TOOLBOX_ACTIONS: Array<{ id: string; searchTerms: string[] }>;
      designToolboxActionMatchesQuery: (action: unknown, query: string, skill: null, t: (k: string) => string, extra: string[]) => boolean;
    };
    const stubT = (): string => '';
    return {
      ids: (query: string) => mod.DESIGN_TOOLBOX_ACTIONS.filter((a) => mod.designToolboxActionMatchesQuery(a, query, null, stubT, [])).map((a) => a.id),
    };
  } catch {
    return null;
  } finally {
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  }
}

async function checkC2_8(): Promise<void> {
  await probe(
    'C2-8',
    'dynamic-import design-toolbox.ts at baseCommit (git show blob into a scratch file) and at HEAD (its own real matching function, not a reimplementation); run a fixed set of representative English queries through each and diff the matched action-id sets',
    'for every query in a fixed representative set, the set of matched design-toolbox action ids at HEAD is a superset of the set matched at baseCommit -- no recall regression from any edit (Chinese searchTerms removal or otherwise) to design-toolbox.ts',
    async () => {
      if (!baseCommit) return { ok: false, evidence: 'baseCommit unresolved', detail: 'cannot compare before/after' };
      const relPath = 'apps/web/src/runtime/design-toolbox.ts';
      const beforeSource = readFileAtCommit(baseCommit, relPath);
      const afterSource = readText(relPath);
      if (beforeSource === null) return { ok: false, evidence: `${relPath} did not exist at baseCommit (${baseCommit.slice(0, 12)})`, detail: 'no baseline to compare against' };
      if (afterSource === null) return { ok: false, evidence: `${relPath} does not exist at HEAD`, detail: 'missing' };

      const before = await loadDesignToolboxModuleFromSource(beforeSource);
      const after = await loadDesignToolboxModuleFromSource(afterSource);
      if (!before || !after) return { ok: false, evidence: `could not dynamically import design-toolbox.ts at one or both commits (before ok=${!!before}, after ok=${!!after})`, detail: 'import failure' };

      const problems: string[] = [];
      const evidenceLines: string[] = [];
      for (const query of TOOLBOX_RECALL_QUERIES) {
        const beforeIds = new Set(before.ids(query));
        const afterIds = new Set(after.ids(query));
        const dropped = [...beforeIds].filter((id) => !afterIds.has(id));
        evidenceLines.push(`"${query}": before=${[...beforeIds].join(',')} after=${[...afterIds].join(',')}`);
        if (dropped.length > 0) problems.push(`query "${query}" lost match(es) [${dropped.join(', ')}] between baseCommit and HEAD`);
      }
      return { ok: problems.length === 0, evidence: `${evidenceLines.join('\n')}\n\nPROBLEMS:\n${problems.join('\n') || '(none)'}`, detail: problems[0] };
    },
  );
}

// ===========================================================================
// C2-9 -- daemon residual de-brand (share-helpers, pluginFolderActions,
// sidecar handshake strings). Landed-tree check -- see file header note on
// out-of-lease targets.
// ===========================================================================
// Sol round-1 F7: the display-name scan must not depend on any hardcoded
// file list -- report EVERY hit, and separately track whether it fell
// inside the still-maintained named floor so evidence stays legible.
function scanFileForDisplayNameHits(fileAbs: string): Array<{ line: number; kind: string; text: string }> {
  const DISPLAY_NAME = /\bOpen Design\b/;
  const { sourceFile } = parseSource(fileAbs);
  const hits: Array<{ line: number; kind: string; text: string }> = [];
  walkAst(sourceFile, (node) => {
    if (ts.isStringLiteralLike(node) && DISPLAY_NAME.test(node.text)) {
      hits.push({ line: lineOf(sourceFile, node), kind: 'string literal', text: node.text });
    } else if (ts.isTemplateExpression(node)) {
      // Sol round-1 F7: a multi-span template's non-head text (the pieces
      // between/after `${...}` substitutions -- TemplateMiddle/TemplateTail)
      // was previously never inspected; only `.head.text` was checked.
      if (DISPLAY_NAME.test(node.head.text)) hits.push({ line: lineOf(sourceFile, node), kind: 'template head', text: node.head.text });
      for (const span of node.templateSpans) {
        if (DISPLAY_NAME.test(span.literal.text)) hits.push({ line: lineOf(sourceFile, span), kind: 'template span', text: span.literal.text });
      }
    } else if (ts.isJsxText(node) && DISPLAY_NAME.test(node.text)) {
      hits.push({ line: lineOf(sourceFile, node), kind: 'JSX text', text: node.text.trim() });
    }
  });
  return hits;
}

async function checkC2_9(discovery: BrandSurfaceDiscovery | null): Promise<void> {
  await probe(
    'C2-9',
    'AST-walk string/template/JSX-text literals (never comments; template MIDDLE/TAIL spans included, not just the head) for the display-name pattern /\\bOpen Design\\b/, across a named floor list PLUS a whole-repo sweep of apps/ and packages/ PLUS every C2-2 inventory entry resolved through the single shared canonical-target resolver (I-W2-COVERAGE-BY-RESOLVED-TARGET) -- never a hardcoded list alone, never any other entry property',
    'no user-visible string/template/JSX-text literal anywhere in apps/ or packages/ still reads "Open Design" as a display name (internal kebab identifiers like open-design.json / @open-design/* / OD_* are explicitly out of scope per the NM-03 KEEP ruling); every named floor file is covered by EXACT canonical-path equality against the resolver-derived inventory paths, and any resolver failure fails this check closed rather than narrowing silently',
    async () => {
      if (!ts) return { ok: false, evidence: `TypeScript compiler API unavailable: ${tsLoadError}`, detail: 'cannot AST-scan' };
      // A named floor -- files the W2 PRD explicitly calls out. Sol round-1
      // F7 caught that this floor was missing the ACTUAL pluginFolderActions
      // implementation file (only test/component consumers were listed).
      const namedFloor = [
        'apps/daemon/src/plugins/share-helpers.ts',
        'apps/web/src/components/AssistantMessage.tsx',
        'apps/web/src/components/ChatPane.tsx',
        'apps/web/src/components/FileWorkspace.tsx',
        'apps/web/src/components/ProjectView.tsx',
        'apps/web/src/components/DesignFilesPanel.tsx',
        'apps/web/src/components/design-files/pluginFolderActions.ts',
        'packages/sidecar-proto/src/index.ts',
      ];
      const problems: string[] = [];
      const evidenceLines: string[] = [];

      // Sol round-1 F7: derive the scan set from the floor + inventory +ONE +
      // a whole-repo sweep, so a file this list never named (like the miss
      // above) is still caught. The repo-wide sweep is authoritative; the
      // floor/inventory checks below exist only to prove COVERAGE of the
      // known surfaces, not to gate the scan itself.
      const sweepFiles = collectRepoFiles(['apps', 'packages'], { exts: ['.ts', '.tsx'] });
      let totalHits = 0;
      for (const fileAbs of sweepFiles) {
        let hits: Array<{ line: number; kind: string; text: string }>;
        try {
          hits = scanFileForDisplayNameHits(fileAbs);
        } catch {
          continue;
        }
        if (hits.length === 0) continue;
        totalHits += hits.length;
        const rel = toRepoRelative(fileAbs);
        for (const hit of hits) problems.push(`${rel}:${hit.line} -- ${hit.kind} still reads "${hit.text.slice(0, 120)}"`);
      }
      evidenceLines.push(`whole-repo sweep (apps/, packages/, .ts/.tsx): ${sweepFiles.length} files scanned, ${totalHits} display-name hit(s)`);
      for (const rel of namedFloor) evidenceLines.push(`named floor: ${rel}: exists=${fs.existsSync(abs(rel))}`);

      if (discovery?.inventoryExportName && discovery.modulePath) {
        try {
          const mod = (await import(pathToFileURL(discovery.modulePath).href + `?t=${Date.now()}`)) as Record<string, unknown>;
          const arr = mod[discovery.inventoryExportName] as Array<Record<string, unknown>>;
          // I-W2-COVERAGE-BY-RESOLVED-TARGET (ceremony ruling, F4): coverage
          // comes ONLY from the SAME shared resolver checkC2_2/checkC2_3 use
          // -- no other property (ids, rationale prose, partial paths) may
          // contribute. Any resolver failure fails this check closed rather
          // than silently narrowing the coverage set, and a named-floor file
          // counts as covered only by EXACT canonical-path equality -- no
          // substring containment either direction.
          const inventoriedPaths = new Set<string>();
          let resolverFailures = 0;
          for (const [index, entry] of arr.entries()) {
            const resolution = resolveInventoryTargetPath(entry);
            if (resolution.ok) {
              inventoriedPaths.add(resolution.canonicalPath);
            } else {
              resolverFailures += 1;
              problems.push(`C2-2 inventory entry #${index} failed canonical-target resolution: ${resolution.error} -- C2-9 fails closed`);
            }
          }
          if (resolverFailures === 0) {
            const uncovered = namedFloor.filter((t) => fs.existsSync(abs(t)) && !inventoriedPaths.has(t));
            if (uncovered.length > 0) problems.push(`the C2-2 inventory does not appear to cover: ${uncovered.join(', ')}`);
            evidenceLines.push(`inventory cross-check: ${uncovered.length} of ${namedFloor.length} named-floor target(s) uncovered (exact canonical-path equality, resolver-derived)`);
          } else {
            evidenceLines.push(`inventory cross-check fails closed: ${resolverFailures} of ${arr.length} inventory entries failed canonical-target resolution`);
          }
        } catch (err) {
          problems.push(`could not cross-check against the C2-2 inventory (import failed): ${String((err as Error)?.message ?? err)} -- fails closed, not skipped`);
        }
      } else {
        // Fidelity-round fix: absent/unusable C2-2 discovery means inventory
        // coverage can never be established -- the most extreme case of a
        // resolver failure (zero entries resolvable). This must fail closed
        // like every other resolver failure, not merely log a skip and let
        // the whole-repo sweep's result alone decide pass/fail.
        problems.push('C2-2 inventory unavailable (module/export not discovered) -- inventory coverage cannot be established; fails closed, not skipped');
      }

      return { ok: problems.length === 0, evidence: `${evidenceLines.join('\n')}\n\nPROBLEMS:\n${problems.join('\n') || '(none)'}`, detail: problems[0] };
    },
  );
}

// ===========================================================================
// C2-10 -- internal-identifier ruling recorded (structural decision-record
// check, mirroring C7-16's founderOk pattern but resolving pass/fail since
// the ruling is already made, not blocked-on-founder).
// ===========================================================================
async function checkC2_10(): Promise<void> {
  await probe(
    'C2-10',
    'structural check of docs/decisions/internal-identifiers.md: mentions NM-03, NM-01, a KEEP ruling, and grounds it in the actual internal identifiers/@open-design scope',
    'the decision record exists and documents the already-made NM-03/NM-01 KEEP ruling (DECISIONS.md 2026-07-27) -- not a re-solicitation of the founder, since this criterion is decidable as keep',
    async () => {
      const text = readText('docs/decisions/internal-identifiers.md');
      if (text === null) return { ok: false, evidence: 'docs/decisions/internal-identifiers.md not found', detail: 'missing' };
      const problems: string[] = [];
      if (!/NM-03/.test(text)) problems.push('does not mention NM-03');
      if (!/NM-01/.test(text)) problems.push('does not mention NM-01');
      if (!/\bKEEP\b/i.test(text)) problems.push('does not state a KEEP ruling');
      if (!/@open-design|internal identifier/i.test(text)) problems.push('does not ground the ruling in the actual internal-identifier / @open-design scope');
      return { ok: problems.length === 0, evidence: `length=${text.length}\n\nPROBLEMS:\n${problems.join('\n') || '(none)'}`, detail: problems[0] };
    },
  );
}

// ===========================================================================
// C2-11 -- archived docs marked in-file.
// ===========================================================================
async function checkC2_11(): Promise<void> {
  await probe(
    'C2-11',
    'require an unambiguous archived banner within the first 15 lines of docs/spec.md and docs/roadmap.md: a line mentioning "archiv" (case-insensitive) that is visually marked as a callout -- bold (`**...**`), a blockquote (`>` prefix), or a heading (`#` prefix) -- not buried in throwaway prose',
    'both spec.md and roadmap.md carry an unambiguous archived marker at the top of the file, not just a caveat living only in AGENTS.md',
    async () => {
      // Sol round-1 F8: an earlier draft required the specific
      // decision-record `**Status:**` shape and false-red'd roadmap.md,
      // which already carries a clear banner ("> **Archived plan:** ...",
      // lines 5-7) in a different but equally unambiguous shape. Any
      // visually-marked archived callout near the top now qualifies --
      // this criterion is about honesty-of-signal, not matching one doc's
      // formatting convention.
      const problems: string[] = [];
      const evidenceLines: string[] = [];
      for (const rel of ['docs/spec.md', 'docs/roadmap.md']) {
        const text = readText(rel);
        if (text === null) {
          problems.push(`${rel} not found`);
          continue;
        }
        const topLines = text.split('\n').slice(0, 15);
        const bannerLine = topLines.find((line) => /archiv/i.test(line) && (/\*\*[^*]*\*\*/.test(line) || /^\s*>/.test(line) || /^\s*#/.test(line)));
        evidenceLines.push(`${rel}: archived banner line found = ${bannerLine !== undefined}${bannerLine ? ` ("${bannerLine.trim().slice(0, 120)}")` : ''}`);
        if (!bannerLine) problems.push(`${rel} has no visually-marked (bold/blockquote/heading) line mentioning "archived" within its first 15 lines`);
      }
      return { ok: problems.length === 0, evidence: `${evidenceLines.join('\n')}\n\nPROBLEMS:\n${problems.join('\n') || '(none)'}`, detail: problems[0] };
    },
  );
}

// ===========================================================================
// C2-12 -- fork maintenance cadence documented.
// ===========================================================================
async function checkC2_12(): Promise<void> {
  await probe(
    'C2-12',
    'structural check of docs/decisions/fork-cadence.md: mentions the FORK-PIN commit b9f550854, a cherry-pick playbook, and a compatibility-alias inventory (a table or a >=3-item bullet list under an alias-related heading)',
    'the doc exists and covers both named halves: the cherry-pick playbook against b9f550854, and the compatibility-alias inventory',
    async () => {
      const text = readText('docs/decisions/fork-cadence.md');
      if (text === null) return { ok: false, evidence: 'docs/decisions/fork-cadence.md not found', detail: 'missing' };
      const problems: string[] = [];
      if (!/b9f550854/.test(text)) problems.push('does not mention the pinned FORK-PIN commit b9f550854');
      if (!/cherry-pick/i.test(text)) problems.push('does not mention a cherry-pick playbook');
      const aliasSectionMatch = text.match(/#[^\n]*alias[^\n]*\n([\s\S]{0,4000})/i);
      const aliasBody = aliasSectionMatch?.[1] ?? '';
      const bulletCount = (aliasBody.match(/^\s*[-*]\s+/gm) ?? []).length;
      const tableRowCount = (aliasBody.match(/^\s*\|.*\|\s*$/gm) ?? []).length;
      if (!/alias/i.test(text)) {
        problems.push('does not mention a compatibility-alias inventory at all');
      } else if (bulletCount < 3 && tableRowCount < 3) {
        problems.push(`alias section found but has neither a >=3-row table nor a >=3-item bullet list (bullets=${bulletCount}, table rows=${tableRowCount})`);
      }
      return { ok: problems.length === 0, evidence: `length=${text.length}, bulletCount=${bulletCount}, tableRowCount=${tableRowCount}\n\nPROBLEMS:\n${problems.join('\n') || '(none)'}`, detail: problems[0] };
    },
  );
}

// ===========================================================================
// C2-13 -- gates: pnpm guard, pnpm typecheck exit 0; web tests green; no
// skip/only/todo introduced by this wave's diff.
// ===========================================================================
async function checkC2_13(): Promise<void> {
  await probe(
    'C2-13',
    'run `pnpm guard`, `pnpm typecheck`, and the @open-design/web vitest suite for real; scan the ADDED lines of this wave\'s diff (baseCommit...HEAD) restricted to *.test.ts/*.test.tsx files for newly-introduced skip/only/todo markers',
    'guard and typecheck exit 0; the web test suite reports zero failed tests; no added line in a changed test file matches .skip(/.only(/.todo(',
    async () => {
      const problems: string[] = [];
      const evidenceLines: string[] = [];

      const guardRun = sh('pnpm', ['guard'], repoRoot, undefined, 20 * 60_000);
      evidenceLines.push(`pnpm guard exit=${guardRun.status}`);
      if (guardRun.status !== 0) problems.push(`pnpm guard exited ${guardRun.status}`);

      const typecheckRun = sh('pnpm', ['typecheck'], repoRoot, undefined, 20 * 60_000);
      evidenceLines.push(`pnpm typecheck exit=${typecheckRun.status}`);
      if (typecheckRun.status !== 0) problems.push(`pnpm typecheck exited ${typecheckRun.status}`);

      const webTestJsonPath = path.join(proofDir, 'C2-13-web-test-run.json');
      const webTestRun = sh('pnpm', ['--filter', '@open-design/web', 'exec', 'vitest', 'run', '-c', 'vitest.config.ts', '--reporter=json', `--outputFile=${webTestJsonPath}`], repoRoot, undefined, 20 * 60_000);
      let webFailed = -1;
      let webPassed = -1;
      try {
        const parsed = JSON.parse(fs.readFileSync(webTestJsonPath, 'utf8')) as { numFailedTests: number; numPassedTests: number };
        webFailed = parsed.numFailedTests;
        webPassed = parsed.numPassedTests;
      } catch {
        /* left as -1, handled below */
      }
      evidenceLines.push(`web test run exit=${webTestRun.status}, parsed numFailedTests=${webFailed}, numPassedTests=${webPassed}`);
      // Sol round-1 F9: the JSON reporter's numFailedTests can read 0 even
      // when the process itself exited nonzero (a crash before the suite
      // ran, an unhandled rejection after JSON was written, etc.) or when
      // zero tests ran at all (a vacuous "pass"). All three signals must
      // agree: real exit 0, at least one test actually executed, and zero
      // reported failures.
      if (webTestRun.status !== 0) problems.push(`@open-design/web vitest process exited ${webTestRun.status} (nonzero exit is a fail regardless of what the JSON reporter says)`);
      if (webPassed <= 0) problems.push(`@open-design/web test run reports ${webPassed} passed test(s) -- a suite that ran zero tests is not a green suite`);
      if (webFailed !== 0) problems.push(`@open-design/web test suite has ${webFailed === -1 ? 'an unparseable result (see run exit code)' : `${webFailed} failing test(s)`}`);

      if (baseCommit && gitIdentityOk) {
        const diffFilesRaw = sh('git', ['diff', '--name-only', `${baseCommit}...${headSha}`]);
        const changedTestFiles = diffFilesRaw.stdout.split('\n').map((l) => l.trim()).filter((l) => /\.(test\.tsx?|spec\.ts)$/.test(l));
        for (const file of changedTestFiles) {
          const patch = sh('git', ['diff', `${baseCommit}...${headSha}`, '--', file]);
          const addedLines = patch.stdout.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
          for (const line of addedLines) {
            if (/\.\s*(skip|only)\s*\(/.test(line) || /\btodo\s*\(/.test(line)) {
              problems.push(`${file}: added line introduces a skip/only/todo marker: ${line.trim().slice(0, 160)}`);
            }
          }
        }
        evidenceLines.push(`scanned ${changedTestFiles.length} changed test file(s) for newly-added skip/only/todo`);
      } else {
        evidenceLines.push('baseCommit unresolved -- skipping the skip/only/todo diff scan (guard/typecheck/test results above still stand)');
      }

      return { ok: problems.length === 0, evidence: `${evidenceLines.join('\n')}\n\nPROBLEMS:\n${problems.join('\n') || '(none)'}`, detail: problems[0] };
    },
  );
}

// ===========================================================================
// main
// ===========================================================================
const daemon = await bootDaemonForProbing();
await checkC2_1(daemon);
const discovery = await checkC2_2();
await checkC2_3(discovery);
await checkC2_4();
await checkC2_5();
await checkC2_6(daemon);
await checkC2_7();
await checkC2_8();
await checkC2_9(discovery);
await checkC2_10();
await checkC2_11();
await checkC2_12();
await checkC2_13();
await daemon.kill();

// ---------------------------------------------------------------------------
// GATE-INTEGRITY -- self-sha vs the ENTIRE trimmed approved-gate.sha256.
// Named-skip if the approval file is absent (advisory-only pre-approval).
// ---------------------------------------------------------------------------
const APPROVED_GATE_SHA_PATH = path.join(goalStateDir, 'approved-gate.sha256');
{
  const startedAt = Date.now();
  const command = `sha256(scripts/waves/verify-w2.ts) vs ${APPROVED_GATE_SHA_PATH}`;
  const assertion = 'once an approval round writes approved-gate.sha256, this verifier\'s own sha256 must match it (trimmed, single-line) on every subsequent run; a missing approval file is a named-skip (advisory pass), not a hard requirement pre-approval';
  try {
    const selfScriptPath = path.resolve(process.argv[1] ?? path.join(repoRoot, 'scripts/waves/verify-w2.ts'));
    const selfBytes = fs.readFileSync(selfScriptPath);
    const selfSha256 = sha256Buffer(selfBytes);
    if (!fs.existsSync(APPROVED_GATE_SHA_PATH)) {
      record('GATE-INTEGRITY', command, assertion, 'pass', `no ${APPROVED_GATE_SHA_PATH} yet -- named-skip (advisory). current self sha256=${selfSha256}`, startedAt, 'named-skip: approval file absent');
    } else {
      const approved = fs.readFileSync(APPROVED_GATE_SHA_PATH, 'utf8').trim();
      const match = approved === selfSha256;
      record('GATE-INTEGRITY', command, assertion, match ? 'pass' : 'fail', `approved=${approved}\nactual=${selfSha256}\nmatch=${match}`, startedAt, match ? undefined : 'verify-w2.ts has been modified since gate approval');
    }
  } catch (error) {
    record('GATE-INTEGRITY', command, assertion, 'fail', `probe threw: ${(error as Error).stack ?? String(error)}`, startedAt, 'probe crashed instead of failing cleanly');
  }
}

// ---------------------------------------------------------------------------
// LEASE -- git diff --name-only merge-base(origin/main, HEAD)...HEAD must be
// a subset of leases.json's W2.allow globs AND disjoint from W2.deny globs.
// Both glob lists are read from leases.json at runtime, never hardcoded.
// ---------------------------------------------------------------------------
function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      out += '.*';
      i++;
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c && '.+^${}()|[]\\'.includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

{
  const startedAt = Date.now();
  const command = 'git diff --name-only <merge-base(origin/main, HEAD)>...HEAD subset of leases.json@baseCommit W2.allow, disjoint from W2.deny';
  const assertion = 'every file changed on this branch relative to merge-base(origin/main, HEAD) matches at least one W2 allow glob and no W2 deny glob, read from docs/plans/waves/leases.json AS IT EXISTED AT baseCommit (never the working tree) -- a lease is not self-authorizing: W2 cannot loosen its own allow/deny rules and have that same commit range grade against the loosened version';
  try {
    if (!remoteMain.ok) {
      record('LEASE', command, assertion, 'fail', remoteMain.error, startedAt, 'git ls-remote origin main failed');
    } else if (!gitIdentityOk) {
      record('LEASE', command, assertion, 'fail', `cannot resolve HEAD sha (status=${headShaResult.status})`, startedAt, 'unresolvable HEAD');
    } else if (!baseCommit) {
      record('LEASE', command, assertion, 'fail', `merge-base against ${remoteMain.sha} failed to resolve`, startedAt, 'unresolvable base commit');
    } else {
      // Sol round-1 F1: leases.json must be read from baseCommit via `git
      // show`, not from the working tree via fs.readFileSync -- otherwise a
      // branch that edits its own lease entry (widening allow, shrinking
      // deny) would be graded against its own edit instead of the policy
      // that was actually in force when the wave started.
      const leasesShow = sh('git', ['show', `${baseCommit}:docs/plans/waves/leases.json`]);
      if (leasesShow.status !== 0) {
        record('LEASE', command, assertion, 'fail', `git show ${baseCommit}:docs/plans/waves/leases.json failed (status=${leasesShow.status}): ${leasesShow.stderr}`, startedAt, 'could not read leases.json at baseCommit');
      } else {
        let leases: { waves: Record<string, { allow: string[]; deny?: string[] }> };
        try {
          leases = JSON.parse(leasesShow.stdout) as { waves: Record<string, { allow: string[]; deny?: string[] }> };
        } catch (err) {
          record('LEASE', command, assertion, 'fail', `leases.json@${baseCommit} did not parse as JSON: ${String(err)}`, startedAt, 'unparseable lease policy');
          leases = { waves: {} };
        }
        const w2Lease = leases.waves['W2'];
        if (!w2Lease) {
          record('LEASE', command, assertion, 'fail', `leases.json@${baseCommit} has no "W2" entry`, startedAt, 'missing lease entry');
        } else {
          const allowRes = w2Lease.allow.map(globToRegExp);
          const denyRes = (w2Lease.deny ?? []).map(globToRegExp);
          const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...${headSha}`]);
          const commitCountResult = sh('git', ['rev-list', '--count', `${baseCommit}..${headSha}`]);
          if (diffResult.status !== 0) {
            record('LEASE', command, assertion, 'fail', `git diff --name-only ${baseCommit}...${headSha} failed (status=${diffResult.status}): ${diffResult.stderr}`, startedAt, 'git diff exit status not checked previously -- fixed');
          } else if (commitCountResult.status !== 0) {
            record('LEASE', command, assertion, 'fail', `git rev-list --count ${baseCommit}..${headSha} failed (status=${commitCountResult.status}): ${commitCountResult.stderr}`, startedAt, 'rev-list failed');
          } else {
            const commitCount = parseInt(commitCountResult.stdout.trim(), 10);
            const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
            if (diffNames.length === 0 && Number.isFinite(commitCount) && commitCount > 0) {
              record('LEASE', command, assertion, 'fail', `empty file diff but ${commitCount} commit(s) between baseCommit and HEAD`, startedAt, 'suspicious empty diff');
            } else {
              const violations = diffNames.filter((f) => !allowRes.some((re) => re.test(f)) || denyRes.some((re) => re.test(f)));
              const evidence = [
                `baseCommit=${baseCommit} (merge-base of verified origin/main=${remoteMain.sha} and HEAD=${headSha})`,
                `leases.json read via: git show ${baseCommit}:docs/plans/waves/leases.json`,
                `changed files: ${diffNames.length}`,
                `allow globs: ${w2Lease.allow.join(', ')}`,
                `deny globs: ${(w2Lease.deny ?? []).join(', ')}`,
                violations.length > 0 ? `VIOLATIONS:\n${violations.join('\n')}` : 'all changed files are inside the W2 lease',
              ].join('\n');
              record('LEASE', command, assertion, violations.length === 0 ? 'pass' : 'fail', evidence, startedAt);
            }
          }
        }
      }
    }
  } catch (error) {
    record('LEASE', command, assertion, 'fail', `probe threw: ${(error as Error).stack ?? String(error)}`, startedAt, 'probe crashed instead of failing cleanly');
  }
}

// ---------------------------------------------------------------------------
// Commit-bound proof manifest.
// ---------------------------------------------------------------------------
function writeManifestSafely(data: unknown): { path: string; wroteOk: boolean } {
  const content = JSON.stringify(data, null, 2);
  const primary = path.join(proofDir, 'manifest.json');
  try {
    const tmp = `${primary}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, primary);
    return { path: primary, wroteOk: true };
  } catch (e1) {
    console.error(`verify-w2: primary manifest write failed (${(e1 as Error).message}), trying fallback`);
  }
  try {
    const fallbackDir = path.join(os.tmpdir(), `verify-w2-fallback-${process.pid}`);
    fs.mkdirSync(fallbackDir, { recursive: true });
    const fallbackPath = path.join(fallbackDir, 'manifest.json');
    fs.writeFileSync(fallbackPath, content);
    return { path: fallbackPath, wroteOk: false };
  } catch (e2) {
    console.error(`verify-w2: fallback manifest write failed (${(e2 as Error).message})`);
    return { path: '(none)', wroteOk: false };
  }
}

const REQUIRED_CRITERIA = ['C2-1', 'C2-2', 'C2-3', 'C2-4', 'C2-5', 'C2-6', 'C2-7', 'C2-8', 'C2-9', 'C2-10', 'C2-11', 'C2-12', 'C2-13'];
for (const id of REQUIRED_CRITERIA) {
  if (!results.some((r) => r.id === id)) {
    record(id, '(never ran)', `${id} must appear in every manifest -- silence is failure`, 'fail', 'this criterion never produced a result', Date.now(), 'criterion did not run to completion');
  }
}

const statusResult = sh('git', ['status', '--porcelain']);
const treeDirty = statusResult.status !== 0 || statusResult.stdout.trim().length > 0;
const manifestOut = {
  wave: 'W2',
  commit: headSha || 'unknown',
  treeDirty,
  baseCommit: baseCommit || 'unknown',
  toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
  canonicalProofDirFailed,
  criteria: results,
};
const manifestWrite = writeManifestSafely(manifestOut);

const hardFailures = results.filter((r) => r.status === 'fail');
const blocked = results.filter((r) => r.status === 'blocked-on-founder');
const passed = results.filter((r) => r.status === 'pass');
console.log(`\nverify-w2: ${passed.length} pass, ${blocked.length} blocked-on-founder, ${hardFailures.length} fail (of ${results.length}); treeDirty=${treeDirty}; manifest=${manifestWrite.path} (wroteOk=${manifestWrite.wroteOk})`);
for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id} -- ${r.assertion.slice(0, 140)}${r.assertion.length > 140 ? '...' : ''}`);
if (treeDirty) console.log('  tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT S2)');
if (!manifestWrite.wroteOk) console.log('  proof manifest degraded to a fallback path -- never a wave pass');

process.exit(hardFailures.length === 0 && !treeDirty && manifestWrite.wroteOk && !canonicalProofDirFailed ? 0 : 1);
})().catch((e) => {
  console.error('verify-w2: fatal error escaped the async IIFE', e);
  process.exit(1);
});
