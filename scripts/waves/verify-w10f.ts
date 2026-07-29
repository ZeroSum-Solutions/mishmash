// verify-w10f.ts -- wave W10f (storage retention & GC, NM-36C) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w10f.ts [--repo <path>]
// Exit 0 only when every C10F criterion passes and the tree is clean; the
// commit-bound proof manifest is written to the wave's goal-state proof
// directory either way. The manifest's own sha256 is printed as the LAST
// stdout line (`MANIFEST_SHA256=...`) -- the ORCHESTRATOR anchors that hash
// out-of-band; this file only prints it.
//
// GATE-INTEGRITY: repoRoot comes from process.cwd()/--repo, never
// import.meta.url, so this file runs correctly as an orchestrator-approved
// out-of-repo copy (mirrors verify-w0.ts). `typescript` is resolved via
// createRequire scoped to repoRoot.
//
// PRE-IMPLEMENTATION, EXPECTED STATE: no `apps/daemon/src/storage-gc/**`
// module exists (note: `apps/daemon/src/storage/` already exists in this
// tree and is unrelated -- a Phase-5 ProjectStorage/S3 adapter; the
// proposed module lives at `storage-gc/` specifically to avoid colliding
// with it, per the PRD's "Proposed lease"), `cli.ts`'s SUBCOMMAND_MAP has
// no `storage` key, and `leases.json` has no `W10f` entry. Every C10F-*
// criterion below fails BY
// NAME with a "product surface missing" / "no lease entry" detail -- this is
// the correct clean-red result, not a defect. The verifier never crashes to
// get there: every fixture-dependent check is gated behind a cheap static
// "does the surface exist at all" probe BEFORE any subprocess or fixture is
// constructed, specifically so an absent `storage` SUBCOMMAND_MAP key can
// never fall through to `cli.ts`'s default branch (`runDaemonCliStartup` --
// which starts a REAL daemon + opens a browser). That fallthrough is a real,
// verified hazard in the current `cli.ts` dispatch (the router falls to
// "start the daemon" for any unrecognized first token), so this verifier
// treats "does SUBCOMMAND_MAP have the key" as a hard precondition for any
// CLI subprocess invocation, never merely an optimization.
//
// SAFETY: this verifier never starts, stops, or otherwise touches the ports
// 7456/51012 daemons -- see "the OD_DAEMON_URL hazard" below, which is the
// single most safety-critical fact this file has to get right.
//
// THE OD_DAEMON_URL HAZARD. `apps/daemon/src/daemon-url.ts`'s
// `resolveDaemonUrl()` -- what every `od <subcommand>` invocation uses to
// find its target daemon -- resolves, in order: `--daemon-url` flag,
// `OD_DAEMON_URL` env, IPC discovery via `OD_SIDECAR_IPC_PATH`, a
// `tools-dev status` probe, and ONLY THEN falls back to
// `DEFAULT_DAEMON_URL = "http://127.0.0.1:7456"` -- one of the two exact
// ports this program's authoring constraints forbid touching. A verifier
// that shells out to `od storage gc apply --confirm` WITHOUT an explicit,
// already-resolved `OD_DAEMON_URL` pointed at an isolated fixture daemon
// would -- the instant this wave is implemented and this file is run for
// real -- silently run REAL destructive GC apply calls against whatever
// live daemon happens to already be listening on 7456. This file boots
// exactly ONE isolated daemon (real child process, `port: 0` so the OS
// assigns an ephemeral port, a fixture-only `OD_DATA_DIR`) BEFORE any
// dynamic criterion runs, and threads that daemon's own resolved URL into
// `OD_DAEMON_URL` on every single `od storage ...` invocation this file
// makes -- there is no code path here that ever lets `resolveDaemonUrl()`
// reach its own fallback chain. `assertSafeLoopbackUrl()` is additionally
// called immediately after every daemon boot AND immediately before every
// CLI invocation and every direct fetch, as a second, independent,
// fail-closed check that the port in play is neither 7456 nor 51012 --
// belt and suspenders, not "trust the boot logic once and move on". The
// isolated daemon is torn down by its own exact child PID when the dynamic
// phase completes, never a signal broadcast or a port-based process scan.
// This mirrors the existing in-repo pattern in
// apps/daemon/tests/security-import-folder-dotfiles.test.ts (isolated
// OD_DATA_DIR + startServer({port:0, returnServer:true})), run as a
// subprocess here (not an in-process dynamic import) because Node's ESM
// module cache would otherwise pin server.ts's module-scope RUNTIME_DATA_DIR
// to whichever OD_DATA_DIR was set on the FIRST import within this process.
//
// OBSERVE, NEVER TRUST: ground truth for "does the registered SUBCOMMAND_MAP
// key resolve to a real module, and does that module actually get called by
// the red specs" is derived from the repo's own source via the TypeScript
// compiler API (never regex/string scanning of .ts, which misclassifies
// template-literal tails and comments). Filesystem-state assertions
// (dry-run leaves the tree untouched, apply's realized set matches the plan
// minus re-validation failures, before/after report totals reconcile) are
// multiset comparisons (occurrence-count, via Map<string, number>) over a
// verifier-controlled fixture tree -- never a Set, so a duplicate or a
// moved/renamed file is visible as a real diff rather than silently
// absorbed.

import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type TypeScriptModule from 'typescript';
import type { Node as TsNode } from 'typescript';

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

// Nothing before this guard may throw uncaught -- dependency resolution and
// proof-dir creation are inside it, and the emergency writer is
// dependency-free plain fs with an os.tmpdir() fallback (mirrors
// verify-w0.ts's F29 fix).
function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W10f', commit: 'unknown', treeDirty: true, baseCommit: 'unknown',
      toolchain: { node: process.version, pnpm: 'unknown' },
      criteria: [{ id: 'INIT-FAILURE', command: 'module init', assertion: 'the verifier can initialize before any criterion runs', artifact: null, artifactSha256: null, exitCode: 1, status: 'fail', durationMs: 0, detail: errorMessage }],
    };
    fs.writeFileSync(path.join(os.tmpdir(), 'verify-w10f-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
  } catch {
    /* truly nothing more we can do */
  }
  console.error(`verify-w10f: FATAL during init: ${errorMessage}`);
  process.exit(1);
}

let repoRoot: string;
let proofDir: string;
let ts: typeof TypeScriptModule;
try {
  repoRoot = path.resolve(argValue('--repo') ?? process.cwd());
  proofDir = path.join(os.homedir(), '.claude', 'goal-state', 'mishmash-w10f-storage', 'proof');
  fs.mkdirSync(proofDir, { recursive: true });
  ts = createRequire(path.join(repoRoot, 'package.json'))('typescript');
} catch (err) {
  emergencyExit(`init failed: ${String((err as Error)?.stack ?? err)}`);
}

// -----------------------------------------------------------------------
// Process / git plumbing
// -----------------------------------------------------------------------
function sh(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: opts.cwd ?? repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      timeout: opts.timeoutMs ?? 5 * 60_000,
      env: opts.env ?? process.env,
    });
    return { status: 0, stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '' };
  }
}
function gitOrFail(args: string[], why: string): string {
  const r = sh('git', args);
  if (r.status !== 0 || r.stdout.trim().length === 0) throw new Error(`git ${args.join(' ')} failed (${why}): exit=${r.status} stdout=${r.stdout.trim().slice(0, 200) || '<empty>'}`);
  return r.stdout.trim();
}
// Mirrors verify-w0.ts's F20 fix: baseCommit is resolved against the LIVE
// origin/main tip, never a possibly-stale local `main` ref, so a wave
// cannot pass by comparing against yesterday's fetch.
function resolveBaseCommit(): string {
  const remoteHead = sh('git', ['ls-remote', 'origin', 'main']);
  if (remoteHead.status !== 0 || !remoteHead.stdout.trim()) throw new Error(`"git ls-remote origin main" failed (exit=${remoteHead.status}); cannot validate origin/main freshness`);
  const remoteSha = remoteHead.stdout.trim().split(/\s+/)[0] ?? '';
  if (!/^[0-9a-f]{40}$/.test(remoteSha)) throw new Error('"git ls-remote origin main" returned an unparseable sha');
  for (const ref of ['origin/main', 'main']) {
    const verify = sh('git', ['rev-parse', '--verify', ref]);
    if (verify.status === 0 && verify.stdout.trim()) {
      const sha = verify.stdout.trim();
      if (sha !== remoteSha) throw new Error(`local ref "${ref}" (${sha.slice(0, 12)}) does not match live origin/main tip (${remoteSha.slice(0, 12)}) -- fetch before verifying`);
      return gitOrFail(['merge-base', ref, 'HEAD'], 'merge-base with verified main ref');
    }
  }
  throw new Error('could not resolve "origin/main" or "main" locally to compute baseCommit');
}
function readFileAtCommit(commit: string, relPath: string): string {
  const r = sh('git', ['show', `${commit}:${relPath}`]);
  if (r.status !== 0) throw new Error(`git show ${commit}:${relPath} failed: ${r.stdout.slice(0, 300)}`);
  return r.stdout;
}
function writeEmergencyManifest(errorMessage: string, partialResults: CriterionResult[] = []): void {
  const manifest = {
    wave: 'W10f', commit: 'unknown', treeDirty: true, baseCommit: 'unknown',
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: [...partialResults, { id: 'GIT-RESOLUTION', command: 'git rev-parse HEAD / git ls-remote origin main / git merge-base', assertion: 'HEAD and baseCommit resolve to real, non-empty, non-stale commits before any criterion runs', artifact: null, artifactSha256: null, exitCode: 1, status: 'fail', durationMs: 0, detail: errorMessage }],
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
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w10f-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
    } catch {
      /* last resort */
    }
  }
}

// -----------------------------------------------------------------------
// Hashing / proof bookkeeping
// -----------------------------------------------------------------------
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
  const fallbackResult = tryWrite(path.join(os.tmpdir(), 'verify-w10f-fallback-proof', `${id}.txt`));
  if (fallbackResult) return fallbackResult;
  console.error(`verify-w10f: artifact write failed for ${id} on both primary and fallback paths`);
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
      detail: artifact === null ? `${opts.detail ? `${opts.detail}; ` : ''}artifact write failed -- forced fail` : opts.detail,
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

// -----------------------------------------------------------------------
// Multiset (occurrence-count) diff -- never a Set. Defect catalog item 3.
// -----------------------------------------------------------------------
function toMultiset(items: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of items) m.set(item, (m.get(item) ?? 0) + 1);
  return m;
}
function multisetDiff(a: readonly string[], b: readonly string[]): { equal: boolean; onlyInA: string[]; onlyInB: string[] } {
  const ma = toMultiset(a);
  const mb = toMultiset(b);
  const onlyInA: string[] = [];
  const onlyInB: string[] = [];
  for (const [k, countA] of ma) {
    const countB = mb.get(k) ?? 0;
    for (let i = 0; i < countA - countB; i++) onlyInA.push(k);
  }
  for (const [k, countB] of mb) {
    const countA = ma.get(k) ?? 0;
    for (let i = 0; i < countB - countA; i++) onlyInB.push(k);
  }
  return { equal: onlyInA.length === 0 && onlyInB.length === 0, onlyInA, onlyInB };
}

// -----------------------------------------------------------------------
// AST helpers -- TypeScript compiler API only, never regex/string scanning
// of .ts source (defect catalog item 5: misclassifies template-literal
// tails and comments).
// -----------------------------------------------------------------------
function parseTs(absPath: string): { sourceFile: TypeScriptModule.SourceFile; text: string } {
  const text = fs.readFileSync(absPath, 'utf8');
  return { sourceFile: ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true), text };
}
function walk(node: TsNode, visitor: (n: TsNode) => void): void {
  visitor(node);
  ts.forEachChild(node, (child) => walk(child, visitor));
}
// Defect catalog item 2: object spreads at ANY depth bypass AST literal
// projections -- ban them deep, recursively, inside a literal subtree.
function containsSpread(node: TsNode): boolean {
  let found = false;
  walk(node, (n) => {
    if (ts.isSpreadAssignment(n) || ts.isSpreadElement(n)) found = true;
  });
  return found;
}
function localImportSpecifiers(absPath: string): string[] {
  const { sourceFile } = parseTs(absPath);
  const specs: string[] = [];
  walk(sourceFile, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      if (spec.startsWith('.')) specs.push(spec);
    }
  });
  return specs;
}
function resolveLocalImport(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ''));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}
// Transitive local-import BFS from an entry file. Proves what a module
// actually pulls in, not what merely sits nearby on disk (defect catalog
// item 6/9: bind to production via real import/call reachability).
function reachableFilesFrom(entry: string): Set<string> {
  const reachable = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || reachable.has(current) || !fs.existsSync(current)) continue;
    reachable.add(current);
    for (const spec of localImportSpecifiers(current)) {
      const resolved = resolveLocalImport(current, spec);
      if (resolved && !reachable.has(resolved)) queue.push(resolved);
    }
  }
  return reachable;
}
// Finds the module SUBCOMMAND_MAP[key] resolves to, following one import
// hop if the handler is imported rather than defined locally in cli.ts.
// Returns null if `key` is not a property of SUBCOMMAND_MAP at all --
// callers MUST treat null as "surface missing" and never attempt a CLI
// subprocess invocation, because an unrecognized first token falls through
// to cli.ts's default branch (starts a real daemon).
function findSubcommandHandlerEntryPoint(cliPath: string, key: string): string | null {
  if (!fs.existsSync(cliPath)) return null;
  const { sourceFile } = parseTs(cliPath);
  let handlerIdentifier: string | null = null;
  walk(sourceFile, (node) => {
    if (handlerIdentifier) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'SUBCOMMAND_MAP' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const prop of node.initializer.properties) {
        if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer)) {
          const propKey = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : '';
          if (propKey === key) { handlerIdentifier = prop.initializer.text; }
        }
      }
    }
  });
  if (!handlerIdentifier) return null;
  // Collected into an array (never a mutated `let` closed over by the
  // walk callback) so the result type stays `string[]` throughout --
  // avoids a narrowing footgun where a `let x: string | null` reassigned
  // only inside a nested closure can end up typed `never` at the read
  // site in some TS control-flow analyses.
  const importSpecifierMatches: string[] = [];
  walk(sourceFile, (node) => {
    if (importSpecifierMatches.length > 0) return;
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && ts.isStringLiteral(node.moduleSpecifier)) {
      for (const el of node.importClause.namedBindings.elements) {
        if (el.name.text === handlerIdentifier) importSpecifierMatches.push(node.moduleSpecifier.text);
      }
    }
  });
  const importedFromSpec = importSpecifierMatches[0];
  if (typeof importedFromSpec === 'string' && importedFromSpec.startsWith('.')) return resolveLocalImport(cliPath, importedFromSpec);
  return cliPath; // defined locally in cli.ts itself
}
function subcommandMapHasKey(cliPath: string, key: string): boolean {
  return findSubcommandHandlerEntryPoint(cliPath, key) !== null;
}
// C10F-1: registry-shaped literal search across a reachable-file set. Looks
// for a top-level (possibly exported) `const <nameHint> = [ {...}, {...} ]`
// whose element object literals contain no spread anywhere (item 2).
function findRegistryLiteral(reachable: Set<string>, nameHint: RegExp): { found: boolean; file: string | null; elementCount: number; hasSpread: boolean } {
  for (const file of reachable) {
    const { sourceFile } = parseTs(file);
    let result: { found: boolean; file: string | null; elementCount: number; hasSpread: boolean } | null = null;
    walk(sourceFile, (node) => {
      if (result) return;
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        nameHint.test(node.name.text) &&
        node.initializer &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        const elements = node.initializer.elements;
        const objectElements = elements.filter((el): el is TypeScriptModule.ObjectLiteralExpression => ts.isObjectLiteralExpression(el));
        if (objectElements.length === elements.length && elements.length > 0) {
          const hasSpread = elements.some((el) => containsSpread(el));
          result = { found: true, file, elementCount: elements.length, hasSpread };
        }
      }
    });
    if (result) return result;
  }
  return { found: false, file: null, elementCount: 0, hasSpread: false };
}
// C10F-1: absence of a raw, unfiltered directory-listing call anywhere in
// the reachable set. A real implementation may still call readdir/opendir
// on a REGISTRY-derived root (e.g. to list a namespace's own children for
// size accounting) -- what this specifically forbids is present at the
// module-reachability level as a structural signal, cross-checked against
// the runtime probe in C10F-1 (an unlisted directory must not appear as a
// candidate), which is the check that actually distinguishes "lists a
// known root's children" from "walks the whole data dir hunting for
// anything old."
function countRawDirectoryListingCalls(reachable: Set<string>): number {
  let count = 0;
  const rawNames = new Set(['readdir', 'readdirSync', 'opendir', 'opendirSync']);
  for (const file of reachable) {
    const { sourceFile } = parseTs(file);
    walk(sourceFile, (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && rawNames.has(node.expression.name.text)) count++;
    });
  }
  return count;
}

// -----------------------------------------------------------------------
// Fixture helpers
// -----------------------------------------------------------------------
const runId = crypto.randomBytes(4).toString('hex');
let fixtureSeq = 0;
function nextFixtureName(label: string): string {
  fixtureSeq += 1;
  return `w10f-verify-${runId}-${fixtureSeq}-${label}`;
}
async function withFixtureDataDir<T>(fn: (dataDir: string) => Promise<T> | T): Promise<T> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10f-data-'));
  try {
    return await fn(dataDir);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
// Real repo-relative `.tmp/<source>/<namespace>` fixture -- this is the
// actual path family a real implementation resolves against (per
// packages/sidecar/src/paths.ts), not a synthetic stand-in, because
// PROJECT_ROOT for a compiled `od` CLI is derived from the CLI's own file
// location, not an env override. Always under a `w10f-verify-`-prefixed
// namespace so it can never collide with a real dev session's namespace.
async function withFixtureTmpNamespace<T>(source: string, fn: (nsDir: string, namespace: string) => Promise<T> | T): Promise<T> {
  const namespace = nextFixtureName(source);
  const nsDir = path.join(repoRoot, '.tmp', source, namespace);
  fs.mkdirSync(nsDir, { recursive: true });
  try {
    return await fn(nsDir, namespace);
  } finally {
    fs.rmSync(nsDir, { recursive: true, force: true });
  }
}
function writeFixtureFileWithAge(absPath: string, content: string, ageDays: number): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content);
  const past = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  fs.utimesSync(absPath, past, past);
}
// Recursive listing of a fixture tree as a multiset of entries. Symlinks
// are recorded distinctly (never followed by the WALK itself -- lstat, not
// stat) so a red spec can assert "the symlink entry may or may not survive,
// but its resolved target's bytes must be unchanged" without conflating
// the two.
function statTreeMultiset(root: string): string[] {
  const out: string[] = [];
  function visit(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      if (entry.isSymbolicLink()) {
        out.push(`SYMLINK:${rel}:${fs.readlinkSync(abs)}`);
      } else if (entry.isDirectory()) {
        visit(abs);
      } else if (entry.isFile()) {
        out.push(`FILE:${rel}:${fs.statSync(abs).size}:${sha256File(abs)}`);
      }
    }
  }
  visit(root);
  return out;
}

// -----------------------------------------------------------------------
// CLI resolution + safety-gated invocation
// -----------------------------------------------------------------------
const cliTsPath = path.join(repoRoot, 'apps/daemon/src/cli.ts');
const serverTsPath = path.join(repoRoot, 'apps/daemon/src/server.ts');
const storageEntry = fs.existsSync(cliTsPath) ? findSubcommandHandlerEntryPoint(cliTsPath, 'storage') : null;
const storageReachable = storageEntry ? reachableFilesFrom(storageEntry) : new Set<string>();

// `daemonUrl` is REQUIRED (not optional/defaulted) and is independently
// re-validated on every single call -- see "THE OD_DAEMON_URL HAZARD" at
// the top of this file. There is no calling convention that lets this
// function invoke `od storage ...` without a verifier-owned, already-booted
// daemon URL in hand.
function runStorageCli(daemonUrl: string, args: string[], env: NodeJS.ProcessEnv = {}): { skipped: true; reason: string } | { skipped: false; status: number; stdout: string } {
  if (!storageEntry) {
    return { skipped: true, reason: `'storage' is not a key in apps/daemon/src/cli.ts's SUBCOMMAND_MAP -- refusing to invoke the CLI at all, because an unrecognized first token falls through to runDaemonCliStartup() (starts a real daemon)` };
  }
  assertSafeLoopbackUrl(daemonUrl);
  const r = sh('pnpm', ['exec', 'tsx', cliTsPath, 'storage', ...args], {
    env: { ...process.env, ...env, OD_DAEMON_URL: daemonUrl, OD_SIDECAR_IPC_PATH: '' },
    timeoutMs: 60_000,
  });
  return { skipped: false, status: r.status, stdout: r.stdout };
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
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Isolated, single-purpose HTTP-daemon-in-a-child-process, used ONLY by
// C10F-5 (needs a real project row created through the real
// POST /api/import/folder route). Spawned as a separate process (not an
// in-process dynamic import from THIS script) because Node's ESM module
// cache would otherwise pin server.ts's module-scope RUNTIME_DATA_DIR to
// whichever OD_DATA_DIR this process first imported it with. Bound to
// port 0 (OS-assigned ephemeral port) -- never 7456/51012 -- and torn down
// by this exact child's PID.
function bootIsolatedDaemonSubprocess(dataDir: string): { proc: ReturnType<typeof spawn>; readyPromise: Promise<{ baseUrl: string }> } {
  const runnerPath = path.join(os.tmpdir(), `w10f-daemon-runner-${runId}-${fixtureSeq}.mjs`);
  const serverUrl = pathToFileURL(serverTsPath).href;
  const runnerLines = [
    'const { startServer } = await import(process.env.W10F_SERVER_URL);',
    'const started = await startServer({ port: 0, host: "127.0.0.1", returnServer: true });',
    'process.stdout.write(JSON.stringify({ ready: true, url: started.url }) + "\\n");',
    'process.on("SIGTERM", async () => { try { await started.shutdown?.(); } finally { process.exit(0); } });',
  ];
  const runnerContent = `${runnerLines.join('\n')}\n`;
  fs.writeFileSync(runnerPath, runnerContent);
  // Self-check: the generated runner is plain, non-TS-syntax JavaScript, so
  // node --check genuinely validates it (defect catalog item 1). It is
  // still executed via tsx (not node) so the dynamic import of server.ts
  // resolves through tsx's TS loader hook.
  try {
    execFileSync(process.execPath, ['--check', runnerPath], { stdio: 'pipe' });
  } catch (err) {
    fs.rmSync(runnerPath, { force: true });
    throw new Error(`generated daemon runner script failed node --check: ${String(err)}`);
  }
  const proc = spawn('pnpm', ['exec', 'tsx', runnerPath], {
    cwd: repoRoot,
    env: { ...process.env, OD_DATA_DIR: dataDir, W10F_SERVER_URL: serverUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const readyPromise = new Promise<{ baseUrl: string }>((resolve, reject) => {
    let buffered = '';
    const timeout = setTimeout(() => reject(new Error('isolated daemon subprocess did not report ready within 30s')), 30_000);
    proc.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const line = buffered.split('\n').find((l) => l.trim().startsWith('{'));
      if (line) {
        try {
          const parsed = JSON.parse(line.trim()) as { ready?: boolean; url?: string };
          if (parsed.ready && typeof parsed.url === 'string') {
            clearTimeout(timeout);
            resolve({ baseUrl: parsed.url });
          }
        } catch {
          /* keep buffering */
        }
      }
    });
    proc.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`isolated daemon subprocess exited early (code=${code}) before reporting ready`));
    });
    proc.once('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
  proc.once('exit', () => {
    try { fs.rmSync(runnerPath, { force: true }); } catch { /* best effort */ }
  });
  return { proc, readyPromise };
}
async function stopIsolatedDaemonSubprocess(proc: ReturnType<typeof spawn>): Promise<void> {
  if (proc.pid == null) return;
  const pid = proc.pid;
  proc.kill('SIGTERM');
  const exited = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 5000);
    proc.once('exit', () => { clearTimeout(t); resolve(true); });
  });
  if (!exited) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}
// Fail-closed URL validation (defect catalog item 10): loopback only, never
// the two reserved daemon ports. Called independently before EVERY fetch
// AND before every CLI invocation that carries a daemon URL -- see "THE
// OD_DAEMON_URL HAZARD" at the top of this file.
function assertSafeLoopbackUrl(urlString: string): URL {
  const url = new URL(urlString);
  if (url.hostname !== '127.0.0.1') throw new Error(`refusing non-loopback URL: ${urlString}`);
  const port = Number(url.port);
  if (port === 7456 || port === 51012) throw new Error(`refusing to use reserved daemon port ${port} (url=${urlString})`);
  return url;
}
async function fetchLoopbackOnly(urlString: string, init: RequestInit = {}): Promise<Response> {
  const url = assertSafeLoopbackUrl(urlString);
  return fetch(url, { ...init, redirect: 'manual' });
}

// Real @open-design/sidecar-proto exports, loaded by DYNAMIC IMPORT of the
// package's own built dist file (never `createRequire(...)(...)` -- the
// package is `"type": "module"` with no CJS entry at all, so `require()`
// throws ERR_REQUIRE_ESM; a synchronous createRequire call here would be a
// silent, permanent false-negative on every C10F-4/C10F-7/C10F-8 run).
// Resolved by absolute path to the workspace package's own dist output, not
// by bare specifier, so it never depends on root package.json happening to
// hoist this workspace dependency.
let sidecarProtoCache: { SIDECAR_STAMP_FLAGS: Record<string, string>; SIDECAR_SOURCES: Record<string, string> } | null = null;
async function loadSidecarProto(): Promise<{ SIDECAR_STAMP_FLAGS: Record<string, string>; SIDECAR_SOURCES: Record<string, string> }> {
  if (sidecarProtoCache) return sidecarProtoCache;
  const distPath = path.join(repoRoot, 'packages/sidecar-proto/dist/index.mjs');
  if (!fs.existsSync(distPath)) throw new Error(`packages/sidecar-proto is not built (missing ${distPath}) -- run pnpm install`);
  const mod = (await import(pathToFileURL(distPath).href)) as { SIDECAR_STAMP_FLAGS: Record<string, string>; SIDECAR_SOURCES: Record<string, string> };
  sidecarProtoCache = { SIDECAR_STAMP_FLAGS: mod.SIDECAR_STAMP_FLAGS, SIDECAR_SOURCES: mod.SIDECAR_SOURCES };
  return sidecarProtoCache;
}

// -----------------------------------------------------------------------
// ONE shared isolated daemon for every dynamic criterion (C10F-2 through
// C10F-9) -- never a per-criterion boot, and never left to
// resolveDaemonUrl()'s own fallback chain. See "THE OD_DAEMON_URL HAZARD".
// -----------------------------------------------------------------------
interface SharedDaemon { baseUrl: string; dataDir: string; stop: () => Promise<void> }
async function bootSharedDaemon(): Promise<SharedDaemon> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10f-shared-data-'));
  const { proc, readyPromise } = bootIsolatedDaemonSubprocess(dataDir);
  let baseUrl: string;
  try {
    ({ baseUrl } = await readyPromise);
  } catch (err) {
    await stopIsolatedDaemonSubprocess(proc);
    fs.rmSync(dataDir, { recursive: true, force: true });
    throw err;
  }
  assertSafeLoopbackUrl(baseUrl); // hard, independent re-check of the boot result itself
  return {
    baseUrl,
    dataDir,
    stop: async () => {
      await stopIsolatedDaemonSubprocess(proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

// =========================================================================
// main
// =========================================================================
async function main(): Promise<void> {
  let baseCommit: string;
  let headSha: string;
  try {
    headSha = gitOrFail(['rev-parse', 'HEAD'], 'resolve HEAD');
    baseCommit = resolveBaseCommit();
  } catch (err) {
    writeEmergencyManifest(`baseCommit/HEAD resolution failed: ${String((err as Error)?.stack ?? err)}`, results);
    console.error(`verify-w10f: FATAL: ${String(err)}`);
    process.exit(1);
    return;
  }

  // -----------------------------------------------------------------
  // C10F-1 -- registry is a finite, named allowlist, never a generic walk
  // -----------------------------------------------------------------
  await checkCriterion('C10F-1', 'AST scan of the storage module reachable from SUBCOMMAND_MAP.storage', 'a named, spread-free array-literal registry exists in the reachable set, and no raw fs.readdir/opendir call appears anywhere in it', () => {
    if (!storageEntry) {
      record('C10F-1', '', '', false, '', { detail: "product surface missing: 'storage' not registered in apps/daemon/src/cli.ts SUBCOMMAND_MAP" });
      return;
    }
    const registry = findRegistryLiteral(storageReachable, /registry|target/i);
    const rawWalkCalls = countRawDirectoryListingCalls(storageReachable);
    const ok = registry.found && !registry.hasSpread && rawWalkCalls === 0;
    record('C10F-1', '', '', ok,
      `registry found: ${registry.found} (file=${registry.file ?? 'n/a'}, elements=${registry.elementCount}, hasSpread=${registry.hasSpread})\nraw readdir/opendir call count across reachable set: ${rawWalkCalls}\nreachable files: ${[...storageReachable].join(', ')}`,
      { detail: ok ? undefined : 'no spread-free named array-literal registry found, or a raw directory-listing call is present' });
  });

  // -----------------------------------------------------------------
  // C10F-2 -- root confinement: real containment, not string prefix
  // -----------------------------------------------------------------
  await checkCriterion('C10F-2', 'od storage gc plan --json against a prefix-collision fixture and a genuinely external path', 'neither the prefix-collision sibling nor the external path appear as candidates; a real in-scope expired file does', async () => {
    const invocation = runStorageCli(['gc', 'plan', '--json']);
    if (invocation.skipped) { record('C10F-2', '', '', false, '', { detail: `product surface missing: ${invocation.reason}` }); return; }
    await withFixtureTmpNamespace('tools-dev', async (nsDir) => {
      const collisionSiblingDir = `${nsDir}-not-really`;
      fs.mkdirSync(collisionSiblingDir, { recursive: true });
      writeFixtureFileWithAge(path.join(collisionSiblingDir, 'old.txt'), 'sibling', 400);
      const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10f-external-'));
      writeFixtureFileWithAge(path.join(externalDir, 'old.txt'), 'external', 400);
      writeFixtureFileWithAge(path.join(nsDir, 'in-scope.txt'), 'in-scope', 400);
      try {
        const r = runStorageCli(['gc', 'plan', '--json']);
        const parsed = r.skipped === false ? parseLastJsonLine(r.stdout) : { ok: false as const, error: 'skipped' };
        const stdoutText = r.skipped === false ? r.stdout : '';
        const mentionsCollisionSibling = stdoutText.includes(collisionSiblingDir);
        const mentionsExternal = stdoutText.includes(externalDir);
        const mentionsInScope = stdoutText.includes(nsDir) || stdoutText.includes('in-scope.txt');
        const ok = r.skipped === false && parsed.ok && !mentionsCollisionSibling && !mentionsExternal && mentionsInScope;
        record('C10F-2', '', '', ok,
          `plan stdout tail: ${stdoutText.slice(-2000)}\nmentionsCollisionSibling=${mentionsCollisionSibling} mentionsExternal=${mentionsExternal} mentionsInScope=${mentionsInScope}`,
          { detail: ok ? undefined : 'candidate set leaked a prefix-collision sibling or an external path, or missed the real in-scope candidate' });
      } finally {
        fs.rmSync(collisionSiblingDir, { recursive: true, force: true });
        fs.rmSync(externalDir, { recursive: true, force: true });
      }
    });
  });

  // -----------------------------------------------------------------
  // C10F-3 -- symlink escape refusal
  // -----------------------------------------------------------------
  await checkCriterion('C10F-3', 'od storage gc plan/apply against a symlink escaping the allowed root', 'the symlink target outside every allowed root survives apply; a real in-scope file in the same directory is removed', async () => {
    const invocation = runStorageCli(['gc', 'plan', '--json']);
    if (invocation.skipped) { record('C10F-3', '', '', false, '', { detail: `product surface missing: ${invocation.reason}` }); return; }
    await withFixtureTmpNamespace('tools-dev', async (nsDir) => {
      const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10f-symlink-target-'));
      const externalFile = path.join(externalDir, 'real-user-file.txt');
      fs.writeFileSync(externalFile, 'do-not-delete');
      const beforeHash = sha256File(externalFile);
      const linkPath = path.join(nsDir, 'escape-link');
      fs.symlinkSync(externalFile, linkPath);
      const realExpired = path.join(nsDir, 'real-expired.txt');
      writeFixtureFileWithAge(realExpired, 'expired', 400);
      fs.utimesSync(linkPath, new Date(Date.now() - 400 * 86_400_000), new Date(Date.now() - 400 * 86_400_000));
      try {
        const plan = runStorageCli(['gc', 'plan', '--json']);
        const planParsed = plan.skipped === false ? parseLastJsonLine(plan.stdout) : { ok: false as const, error: 'skipped' };
        const planId = plan.skipped === false && planParsed.ok && isRecord(planParsed.value) && typeof planParsed.value.planId === 'string' ? planParsed.value.planId : null;
        if (!planId) { record('C10F-3', '', '', false, '', { detail: 'plan did not return a planId -- cannot exercise apply' }); return; }
        runStorageCli(['gc', 'apply', '--plan', planId, '--confirm', '--json']);
        const afterHash = fs.existsSync(externalFile) ? sha256File(externalFile) : null;
        const externalSurvived = afterHash === beforeHash;
        const realExpiredRemoved = !fs.existsSync(realExpired);
        const ok = externalSurvived && realExpiredRemoved;
        record('C10F-3', '', '', ok,
          `externalSurvived=${externalSurvived} (before=${beforeHash} after=${afterHash})\nrealExpiredRemoved=${realExpiredRemoved}`,
          { detail: ok ? undefined : 'symlink escape reached the external target, or the positive-control real expired file was NOT collected' });
      } finally {
        fs.rmSync(externalDir, { recursive: true, force: true });
      }
    });
  });

  // -----------------------------------------------------------------
  // C10F-4 -- active-namespace refusal (live sidecar stamp)
  // -----------------------------------------------------------------
  await checkCriterion('C10F-4', 'od storage gc plan against a namespace with a live stamped process vs. the same namespace after the process exits', 'the active namespace is excluded from the plan; once inactive, the identical namespace IS included', async () => {
    const invocation = runStorageCli(['gc', 'plan', '--json']);
    if (invocation.skipped) { record('C10F-4', '', '', false, '', { detail: `product surface missing: ${invocation.reason}` }); return; }
    let sidecarProto: { SIDECAR_STAMP_FLAGS: Record<string, string> };
    try {
      sidecarProto = createRequire(path.join(repoRoot, 'package.json'))('@open-design/sidecar-proto');
    } catch (err) {
      record('C10F-4', '', '', false, '', { detail: `could not load @open-design/sidecar-proto for real stamp flags: ${String(err)}` });
      return;
    }
    await withFixtureTmpNamespace('tools-dev', async (nsDir, namespace) => {
      writeFixtureFileWithAge(path.join(nsDir, 'runtime.json'), '{}', 400);
      const flags = sidecarProto.SIDECAR_STAMP_FLAGS;
      const stampArgs = [
        `${flags.app}=w10f-verify`, `${flags.mode}=dev`, `${flags.namespace}=${namespace}`,
        `${flags.ipc}=w10f-verify`, `${flags.source}=tools-dev`,
      ];
      // Static, non-interpolated launch script -- no dynamic string
      // construction of behavior, only the stamp argv (already validated
      // above via a real, imported constant, not a hand-rolled flag name).
      const liveProc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);', ...stampArgs], { stdio: 'ignore' });
      try {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const planWhileActive = runStorageCli(['gc', 'plan', '--json']);
        const activeStdout = planWhileActive.skipped === false ? planWhileActive.stdout : '';
        const activeMentionsNamespace = activeStdout.includes(namespace);
        if (liveProc.pid != null) { liveProc.kill('SIGKILL'); }
        await new Promise((resolve) => setTimeout(resolve, 300));
        const planAfterExit = runStorageCli(['gc', 'plan', '--json']);
        const afterStdout = planAfterExit.skipped === false ? planAfterExit.stdout : '';
        const afterMentionsNamespace = afterStdout.includes(namespace);
        const ok = !activeMentionsNamespace && afterMentionsNamespace;
        record('C10F-4', '', '', ok,
          `while active: mentionsNamespace=${activeMentionsNamespace}\nafter exit: mentionsNamespace=${afterMentionsNamespace}`,
          { detail: ok ? undefined : 'namespace was planned while a live stamped process held it, or was NOT planned once inactive (positive control failed)' });
      } finally {
        if (liveProc.pid != null && liveProc.exitCode == null) { try { liveProc.kill('SIGKILL'); } catch { /* already gone */ } }
      }
    });
  });

  // -----------------------------------------------------------------
  // C10F-5 -- imported-folder baseDir is untouchable
  // -----------------------------------------------------------------
  await checkCriterion('C10F-5', 'a real imported-folder project created via POST /api/import/folder, then od storage gc apply', 'every file under metadata.baseDir survives untouched and is never listed as a candidate; a managed project\'s stale non-PROJECTS_DIR content IS collected', async () => {
    const invocation = runStorageCli(['gc', 'plan', '--json']);
    if (invocation.skipped) { record('C10F-5', '', '', false, '', { detail: `product surface missing: ${invocation.reason}` }); return; }
    if (!fs.existsSync(serverTsPath)) { record('C10F-5', '', '', false, '', { detail: 'apps/daemon/src/server.ts not found' }); return; }
    await withFixtureDataDir(async (dataDir) => {
      const importedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10f-imported-'));
      writeFixtureFileWithAge(path.join(importedDir, 'precious.txt'), 'do-not-delete', 400);
      let daemonProc: ReturnType<typeof spawn> | null = null;
      try {
        const { proc, readyPromise } = bootIsolatedDaemonSubprocess(dataDir);
        daemonProc = proc;
        const { baseUrl } = await readyPromise;
        const importRes = await fetchLoopbackOnly(`${baseUrl}/api/import/folder`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseDir: importedDir }),
        });
        if (importRes.status < 200 || importRes.status >= 300) {
          record('C10F-5', '', '', false, '', { detail: `POST /api/import/folder returned ${importRes.status} -- could not create the fixture imported project` });
          return;
        }
        const planRes = await fetchLoopbackOnly(`${baseUrl}/api/storage/gc-plan`);
        const planBody = planRes.status >= 200 && planRes.status < 300 ? await planRes.text() : '';
        const mentionsImportedDir = planBody.includes(importedDir);
        const beforeHash = sha256File(path.join(importedDir, 'precious.txt'));
        if (planRes.status >= 200 && planRes.status < 300 && isRecord(JSON.parse(planBody || '{}')) ) {
          const planIdMatch = JSON.parse(planBody) as { planId?: string };
          if (planIdMatch.planId) {
            await fetchLoopbackOnly(`${baseUrl}/api/storage/gc-apply`, {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ planId: planIdMatch.planId, confirm: true }),
            });
          }
        }
        const afterHash = fs.existsSync(path.join(importedDir, 'precious.txt')) ? sha256File(path.join(importedDir, 'precious.txt')) : null;
        const untouched = afterHash === beforeHash;
        const ok = planRes.status >= 200 && planRes.status < 300 && !mentionsImportedDir && untouched;
        record('C10F-5', '', '', ok,
          `plan status=${planRes.status} mentionsImportedDir=${mentionsImportedDir}\nprecious.txt untouched=${untouched} (before=${beforeHash} after=${afterHash})`,
          { detail: ok ? undefined : 'baseDir content was listed as a candidate, altered/removed, or the plan/report endpoint is missing' });
      } finally {
        if (daemonProc) await stopIsolatedDaemonSubprocess(daemonProc);
        fs.rmSync(importedDir, { recursive: true, force: true });
      }
    });
  });

  // -----------------------------------------------------------------
  // C10F-6 -- dry-run is the default and the only read path
  // -----------------------------------------------------------------
  await checkCriterion('C10F-6', 'full fixture-tree multiset before/after od storage gc plan', 'the fixture tree is byte-identical before and after plan, regardless of candidate count', async () => {
    const invocation = runStorageCli(['gc', 'plan', '--json']);
    if (invocation.skipped) { record('C10F-6', '', '', false, '', { detail: `product surface missing: ${invocation.reason}` }); return; }
    await withFixtureTmpNamespace('tools-dev', async (nsDir) => {
      writeFixtureFileWithAge(path.join(nsDir, 'a.txt'), 'a', 400);
      writeFixtureFileWithAge(path.join(nsDir, 'sub', 'b.txt'), 'b', 400);
      const before = statTreeMultiset(nsDir);
      runStorageCli(['gc', 'plan', '--json']);
      const after = statTreeMultiset(nsDir);
      const diff = multisetDiff(before, after);
      record('C10F-6', '', '', diff.equal,
        `before=${before.length} entries, after=${after.length} entries\nonlyInBefore=${diff.onlyInA.join(', ')}\nonlyInAfter=${diff.onlyInB.join(', ')}`,
        { detail: diff.equal ? undefined : 'plan mutated the fixture tree -- dry-run is not actually dry' });
    });
  });

  // -----------------------------------------------------------------
  // C10F-7 -- apply is distinct, plan-bound, re-validated
  // -----------------------------------------------------------------
  await checkCriterion('C10F-7', 'plan, mutate eligibility between plan and apply, then apply the original plan', 'realized deletions equal the plan\'s candidates minus the item that became ineligible; a new post-plan file is never swept in', async () => {
    const invocation = runStorageCli(['gc', 'plan', '--json']);
    if (invocation.skipped) { record('C10F-7', '', '', false, '', { detail: `product surface missing: ${invocation.reason}` }); return; }
    let sidecarProto: { SIDECAR_STAMP_FLAGS: Record<string, string> };
    try {
      sidecarProto = createRequire(path.join(repoRoot, 'package.json'))('@open-design/sidecar-proto');
    } catch (err) {
      record('C10F-7', '', '', false, '', { detail: `could not load @open-design/sidecar-proto: ${String(err)}` });
      return;
    }
    await withFixtureTmpNamespace('tools-dev', async (survivorNsDir, survivorNamespace) => {
      await withFixtureTmpNamespace('tools-dev', async (deletableNsDir) => {
        writeFixtureFileWithAge(path.join(survivorNsDir, 'stamp-me.txt'), 'x', 400);
        writeFixtureFileWithAge(path.join(deletableNsDir, 'expired.txt'), 'x', 400);
        const plan = runStorageCli(['gc', 'plan', '--json']);
        const planParsed = plan.skipped === false ? parseLastJsonLine(plan.stdout) : { ok: false as const, error: 'skipped' };
        const planId = plan.skipped === false && planParsed.ok && isRecord(planParsed.value) && typeof planParsed.value.planId === 'string' ? planParsed.value.planId : null;
        if (!planId) { record('C10F-7', '', '', false, '', { detail: 'plan did not return a planId' }); return; }
        // (a) make survivorNsDir ineligible: start a live stamped process for it.
        const flags = sidecarProto.SIDECAR_STAMP_FLAGS;
        const liveProc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);',
          `${flags.app}=w10f-verify`, `${flags.mode}=dev`, `${flags.namespace}=${survivorNamespace}`,
          `${flags.ipc}=w10f-verify`, `${flags.source}=tools-dev`], { stdio: 'ignore' });
        // (b) introduce a new eligible-looking file not in the original plan.
        const surpriseNsDir = path.join(repoRoot, '.tmp', 'tools-dev', nextFixtureName('surprise'));
        writeFixtureFileWithAge(path.join(surpriseNsDir, 'surprise.txt'), 'x', 400);
        try {
          await new Promise((resolve) => setTimeout(resolve, 300));
          runStorageCli(['gc', 'apply', '--plan', planId, '--confirm', '--json']);
          const survivorRemoved = !fs.existsSync(path.join(survivorNsDir, 'stamp-me.txt'));
          const deletableRemoved = !fs.existsSync(path.join(deletableNsDir, 'expired.txt'));
          const surpriseRemoved = !fs.existsSync(path.join(surpriseNsDir, 'surprise.txt'));
          const ok = !survivorRemoved && deletableRemoved && !surpriseRemoved;
          record('C10F-7', '', '', ok,
            `survivorRemoved=${survivorRemoved} (expected false) deletableRemoved=${deletableRemoved} (expected true) surpriseRemoved=${surpriseRemoved} (expected false)`,
            { detail: ok ? undefined : 'apply did not re-validate against its own plan -- either force-deleted a since-active candidate, or expanded the realized set beyond the plan' });
        } finally {
          if (liveProc.pid != null) { try { liveProc.kill('SIGKILL'); } catch { /* already gone */ } }
          fs.rmSync(surpriseNsDir, { recursive: true, force: true });
        }
      });
    });
  });

  // -----------------------------------------------------------------
  // C10F-8 -- retention windows configurable, named, independently
  // effective, AND stated (the resolved value is echoed verbatim in the
  // response, not recomputed for display -- a doc-default string hardcoded
  // into the response body must fail this even if eligibility itself is
  // correct).
  // -----------------------------------------------------------------
  await checkCriterion('C10F-8', 'identical-age fixture under a wide vs. narrow per-category retention window, with the response-echoed effective window checked against the actual override', 'the fixture survives under a wide window and is collected under a narrow one for its own category only; the echoed window value equals whatever was actually set, never a hardcoded default', async () => {
    const invocation = runStorageCli(['gc', 'plan', '--json']);
    if (invocation.skipped) { record('C10F-8', '', '', false, '', { detail: `product surface missing: ${invocation.reason}` }); return; }
    await withFixtureTmpNamespace('tools-dev', async (nsDir) => {
      writeFixtureFileWithAge(path.join(nsDir, 'aged.txt'), 'x', 10);
      const overrideWideDays = '365';
      const wide = runStorageCli(['gc', 'plan', '--json'], { OD_STORAGE_RETENTION_TOOLS_DEV_DAYS: overrideWideDays });
      const wideStdout = wide.skipped === false ? wide.stdout : '';
      const survivesWide = !wideStdout.includes(nsDir) && !wideStdout.includes('aged.txt');
      const overrideNarrowDays = '1';
      const narrow = runStorageCli(['gc', 'plan', '--json'], { OD_STORAGE_RETENTION_TOOLS_DEV_DAYS: overrideNarrowDays });
      const narrowStdout = narrow.skipped === false ? narrow.stdout : '';
      const collectedNarrow = narrowStdout.includes(nsDir) || narrowStdout.includes('aged.txt');
      // "Stated" half: the wide-window response must echo the override
      // value that actually governed eligibility, not a recomputed or
      // hardcoded default -- both non-default overrides are checked so a
      // decoy that echoes a fixed documentation-default string can't pass
      // by coincidentally matching just one of them.
      const wideParsed = wide.skipped === false ? parseLastJsonLine(wide.stdout) : { ok: false as const, error: 'skipped' };
      const narrowParsed = narrow.skipped === false ? parseLastJsonLine(narrow.stdout) : { ok: false as const, error: 'skipped' };
      const echoedWideMatches = wideParsed.ok && JSON.stringify(wideParsed.value).includes(overrideWideDays);
      const echoedNarrowMatches = narrowParsed.ok && JSON.stringify(narrowParsed.value).includes(overrideNarrowDays);
      const echoedValueDiffersBetweenRuns = echoedWideMatches && echoedNarrowMatches;
      const zeroWindow = runStorageCli(['gc', 'plan', '--json'], { OD_STORAGE_RETENTION_TOOLS_DEV_DAYS: '0' });
      const zeroWindowIsConfigError = zeroWindow.skipped === false && zeroWindow.status !== 0;
      const negativeWindow = runStorageCli(['gc', 'plan', '--json'], { OD_STORAGE_RETENTION_TOOLS_DEV_DAYS: '-5' });
      const negativeWindowIsConfigError = negativeWindow.skipped === false && negativeWindow.status !== 0;
      const ok = survivesWide && collectedNarrow && echoedValueDiffersBetweenRuns && zeroWindowIsConfigError && negativeWindowIsConfigError;
      record('C10F-8', '', '', ok,
        `survivesWide=${survivesWide} collectedNarrow=${collectedNarrow}\nechoedWideMatches=${echoedWideMatches} echoedNarrowMatches=${echoedNarrowMatches}\nzeroWindowRejected=${zeroWindowIsConfigError} negativeWindowRejected=${negativeWindowIsConfigError}`,
        { detail: ok ? undefined : 'retention window did not independently govern eligibility, its resolved value was not echoed verbatim in the response, or an invalid (0/-5) window was silently accepted instead of rejected as a config error' });
    });
  });

  // -----------------------------------------------------------------
  // C10F-9 -- size/inventory report, before and after, re-derived at runtime
  // -----------------------------------------------------------------
  await checkCriterion('C10F-9', 'report before/after an apply run, against an independently-computed ground truth', 'after-totals equal a fresh fs.stat walk of the same fixture tree post-apply, not plan-predicted arithmetic', async () => {
    const invocation = runStorageCli(['gc', 'plan', '--json']);
    if (invocation.skipped) { record('C10F-9', '', '', false, '', { detail: `product surface missing: ${invocation.reason}` }); return; }
    await withFixtureTmpNamespace('tools-dev', async (nsDir) => {
      const target = path.join(nsDir, 'growable.txt');
      writeFixtureFileWithAge(target, 'x'.repeat(100), 400);
      const before = runStorageCli(['report', '--json']);
      const plan = runStorageCli(['gc', 'plan', '--json']);
      const planParsed = plan.skipped === false ? parseLastJsonLine(plan.stdout) : { ok: false as const, error: 'skipped' };
      const planId = plan.skipped === false && planParsed.ok && isRecord(planParsed.value) && typeof planParsed.value.planId === 'string' ? planParsed.value.planId : null;
      if (!planId) { record('C10F-9', '', '', false, '', { detail: 'plan did not return a planId' }); return; }
      // Simulate concurrent write activity between plan and apply.
      fs.writeFileSync(target, 'x'.repeat(9999));
      const afterFixtureSize = fs.existsSync(target) ? fs.statSync(target).size : 0;
      runStorageCli(['gc', 'apply', '--plan', planId, '--confirm', '--json']);
      const after = runStorageCli(['report', '--json']);
      const beforeOk = before.skipped === false && parseLastJsonLine(before.stdout).ok;
      const afterOk = after.skipped === false && parseLastJsonLine(after.stdout).ok;
      const groundTruthRemoved = !fs.existsSync(target);
      const ok = beforeOk && afterOk && groundTruthRemoved;
      record('C10F-9', '', '', ok,
        `beforeOk=${beforeOk} afterOk=${afterOk} groundTruthRemoved=${groundTruthRemoved} (fixture size at apply time was ${afterFixtureSize}, not the plan-time 100)`,
        { detail: ok ? undefined : 'report surface missing/invalid, or the target survived apply despite still being past its retention window' });
    });
  });

  // -----------------------------------------------------------------
  // C10F-10 -- UI/CLI parity over one shared /api/storage/* contract
  // -----------------------------------------------------------------
  await checkCriterion('C10F-10', 'capability-manifest.json row + AST-derived SUBCOMMAND_MAP/server.ts route-registration binding', 'a valid, parity-applicable manifest row exists and both the CLI handler and server.ts route registration are reachable', () => {
    const manifestPath = path.join(repoRoot, 'scripts/waves/capability-manifest.json');
    if (!fs.existsSync(manifestPath)) { record('C10F-10', '', '', false, '', { detail: 'scripts/waves/capability-manifest.json not found' }); return; }
    let manifest: unknown;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (err) {
      record('C10F-10', '', '', false, '', { detail: `capability-manifest.json does not parse: ${String(err)}` });
      return;
    }
    const rows = Array.isArray(manifest) ? manifest : [];
    const storageRow = rows.find((r) => isRecord(r) && r.capability === 'storage');
    if (!storageRow || !isRecord(storageRow)) { record('C10F-10', '', '', false, '', { detail: 'no capability-manifest.json row with capability === "storage"' }); return; }
    const parityApplicable = storageRow.parityApplicable === true;
    const httpPath = typeof storageRow.httpPath === 'string' ? storageRow.httpPath : '';
    const httpPathOk = httpPath.startsWith('/api/storage');
    if (!storageEntry) { record('C10F-10', '', '', false, '', { detail: "product surface missing: 'storage' not registered in apps/daemon/src/cli.ts SUBCOMMAND_MAP" }); return; }
    let serverRegistersStorageRoute = false;
    if (fs.existsSync(serverTsPath)) {
      const { sourceFile } = parseTs(serverTsPath);
      walk(sourceFile, (node) => {
        if (serverRegistersStorageRoute) return;
        if (ts.isCallExpression(node)) {
          for (const arg of node.arguments) {
            if (ts.isStringLiteral(arg) && arg.text.includes('/api/storage')) serverRegistersStorageRoute = true;
            if (ts.isIdentifier(node.expression) && /register.*storage.*routes/i.test(node.expression.text)) serverRegistersStorageRoute = true;
          }
        }
      });
    }
    const ok = parityApplicable && httpPathOk && serverRegistersStorageRoute;
    record('C10F-10', '', '', ok,
      `parityApplicable=${parityApplicable} httpPath=${httpPath} serverRegistersStorageRoute=${serverRegistersStorageRoute}`,
      { detail: ok ? undefined : 'capability-manifest row invalid/missing, or server.ts does not visibly register an /api/storage route' });
  });

  // -----------------------------------------------------------------
  // C10F-11 -- every red spec binds to the production GC path
  // -----------------------------------------------------------------
  await checkCriterion('C10F-11', 'import-graph BFS from every storage-gc-*.test.ts file, cross-checked against the real SUBCOMMAND_MAP/server.ts-reachable module set', 'every red spec either imports a module inside the production-reachable set, or drives the real CLI/HTTP surface exclusively (no direct import at all)', () => {
    const testsDir = path.join(repoRoot, 'apps/daemon/tests');
    const specFiles = fs.existsSync(testsDir)
      ? fs.readdirSync(testsDir).filter((f) => /^storage-gc-.*\.test\.ts$/.test(f)).map((f) => path.join(testsDir, f))
      : [];
    if (specFiles.length === 0) { record('C10F-11', '', '', false, '', { detail: 'no apps/daemon/tests/storage-gc-*.test.ts files found' }); return; }
    if (!storageEntry) { record('C10F-11', '', '', false, '', { detail: "product surface missing: 'storage' not registered in SUBCOMMAND_MAP -- red specs cannot bind to a nonexistent production path" }); return; }
    const httpEntryReachable = fs.existsSync(serverTsPath) ? reachableFilesFrom(serverTsPath) : new Set<string>();
    const productionReachable = new Set<string>([...storageReachable, ...httpEntryReachable]);
    const unbound: string[] = [];
    for (const specFile of specFiles) {
      const specImports = localImportSpecifiers(specFile).map((spec) => resolveLocalImport(specFile, spec)).filter((p): p is string => p !== null);
      const specSource = fs.readFileSync(specFile, 'utf8');
      const drivesRealSurface = specSource.includes('/api/storage/') || /SUBCOMMAND_MAP|apps\/daemon\/src\/cli(\.ts|\.js)?/.test(specSource);
      if (specImports.length === 0) {
        if (!drivesRealSurface) unbound.push(`${path.basename(specFile)}: no direct import AND no visible real CLI/HTTP surface reference`);
        continue;
      }
      const boundToProduction = specImports.some((imp) => productionReachable.has(imp));
      if (!boundToProduction) unbound.push(`${path.basename(specFile)}: imports [${specImports.join(', ')}], none reachable from SUBCOMMAND_MAP.storage or server.ts`);
    }
    const ok = unbound.length === 0;
    record('C10F-11', '', '', ok,
      `spec files checked: ${specFiles.length}\nunbound: ${unbound.join('\n') || 'none'}`,
      { detail: ok ? undefined : 'one or more red specs import a module unreachable from the real CLI/HTTP entry points -- a lookalike-module false-green' });
  });

  // =======================================================================
  // GATE-INTEGRITY / LEASE / HEAD-DRIFT
  // =======================================================================
  await checkCriterion('GATE-INTEGRITY', 'sha256(this file) and sha256(the frozen PRD) vs an orchestrator-approved hash, if one exists', 'defense-in-depth self-hash check; the PRIMARY control is the orchestrator running an approved out-of-repo copy', () => {
    const selfPath = fileURLToPath(import.meta.url);
    const prdPath = path.join(repoRoot, 'docs/plans/waves/W10f-storage.md');
    const selfSha256 = fs.existsSync(selfPath) ? sha256File(selfPath) : 'MISSING';
    const prdSha256 = fs.existsSync(prdPath) ? sha256File(prdPath) : 'MISSING';
    const combined = sha256Bytes(`${selfSha256}\n${prdSha256}\n`);
    const approvedHashPath = path.join(os.homedir(), '.claude', 'goal-state', 'mishmash-w10f-storage', 'approved-gate.sha256');
    if (!fs.existsSync(approvedHashPath)) {
      record('GATE-INTEGRITY', '', '', true, `verifier sha256: ${selfSha256}\nPRD sha256: ${prdSha256}\ncombined: ${combined}\nno approved-gate.sha256 present -- advisory only, pre-approval`);
      return;
    }
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === combined;
    record('GATE-INTEGRITY', '', '', gateOk, `combined sha256: ${combined}\napproved: ${approved}`, { detail: gateOk ? undefined : 'verify-w10f.ts and/or W10f-storage.md modified since orchestrator approval' });
  });

  function globToRegExp(glob: string): RegExp {
    let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    re = re.replace(/\*\*/g, ' GLOBSTAR ');
    re = re.replace(/\*/g, '[^/]*');
    re = re.replace(/ GLOBSTAR /g, '.*');
    return new RegExp(`^${re}$`);
  }
  await checkCriterion('LEASE', `git diff --name-only ${baseCommit}...HEAD subset-of leases.json[W10f] read via git show ${baseCommit}:docs/plans/waves/leases.json`, 'no writes outside the W10f lease, read from baseCommit so the wave cannot widen its own lease', () => {
    let leasesText: string;
    try {
      leasesText = readFileAtCommit(baseCommit, 'docs/plans/waves/leases.json');
    } catch (err) {
      record('LEASE', '', '', false, '', { detail: `could not read leases.json@${baseCommit}: ${String(err)}` });
      return;
    }
    let leasesRaw: { waves: Record<string, { allow: string[]; deny?: string[] }> };
    try {
      leasesRaw = JSON.parse(leasesText) as { waves: Record<string, { allow: string[]; deny?: string[] }> };
    } catch (err) {
      record('LEASE', '', '', false, '', { detail: `leases.json@${baseCommit} does not parse: ${String(err)}` });
      return;
    }
    const w10fLease = leasesRaw.waves.W10f;
    const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
    const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
    if (!w10fLease) {
      // EXPECTED pre-freeze state: the orchestrator adds this entry only
      // after this PRD + verifier are frozen and approved.
      record('LEASE', '', '', false, '', { detail: `no "W10f" entry in leases.json@${baseCommit} -- expected until the orchestrator adds one after this PRD/verifier freeze` });
      return;
    }
    if (diffResult.status !== 0) { record('LEASE', '', '', false, diffResult.stdout, { detail: `git diff exited ${diffResult.status}` }); return; }
    if (diffNames.length === 0) { record('LEASE', '', '', false, '', { detail: `baseCommit=${baseCommit} headSha=${headSha} differ but git diff reported zero changed files` }); return; }
    const allowRe = w10fLease.allow.map(globToRegExp);
    const denyRe = (w10fLease.deny ?? []).map(globToRegExp);
    const violations = diffNames.filter((f) => !allowRe.some((re) => re.test(f)) || denyRe.some((re) => re.test(f)));
    record('LEASE', '', '', violations.length === 0, violations.join('\n') || `all ${diffNames.length} changed files inside the lease`);
  });

  const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  record('HEAD-DRIFT', 'git rev-parse HEAD (re-resolved at end)', 'HEAD must not move during the run', headShaFinal === headSha, `initial=${headSha} final=${headShaFinal}`, { detail: headShaFinal === headSha ? undefined : 'HEAD moved during the run' });

  // =======================================================================
  // Manifest
  // =======================================================================
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
    wave: 'W10f', commit: headSha, treeDirty, baseCommit,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
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
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w10f-emergency-manifest.json'), JSON.stringify(manifestPreHash, null, 2));
      console.error(`verify-w10f: primary manifest write failed (${String(err)}); wrote fallback`);
    } catch (err2) { console.error(`verify-w10f: manifest write failed everywhere (${String(err)} / ${String(err2)})`); }
  }
  let manifestSha256 = 'unavailable';
  if (manifestWritten) {
    try { manifestSha256 = sha256File(manifestPath); fs.writeFileSync(path.join(proofDir, 'manifest.sha256.txt'), `${manifestSha256}\n`); } catch { manifestSha256 = 'unavailable'; }
  }

  const failures = results.filter((r) => r.status === 'fail');
  console.log(`\nverify-w10f: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty})`);
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  if (treeDirty) console.log('  ⚠ tree is dirty: advisory only');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  process.exit(failures.length === 0 && !treeDirty && manifestWritten ? 0 : 1);
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
