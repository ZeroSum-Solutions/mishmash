// verify-w10f.ts -- wave W10f (storage retention & GC, NM-36C) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w10f.ts [--repo <path>]
// Exit 0 only when every criterion passes and the tree is clean; the
// commit-bound proof manifest is written to the wave's goal-state proof
// directory either way. The manifest's own sha256 is printed as the LAST
// stdout line (`MANIFEST_SHA256=...`).
//
// ===========================================================================
// ROUND 3 -- ARCHITECTURAL CHANGE, NOT ANOTHER PATCH (fixes the round-2
// CRITICAL finding). Full rationale in docs/plans/waves/W10f-storage.md
// ("Verifier fixture-isolation guarantee" + "Round-2 findings -> closures").
// ===========================================================================
// Round 2 found that round 1's "belt and braces" did not make destructive
// `apply` safe: the belt (`assertPlanConfinedToTempRoot`) validated only the
// LEXICAL paths a `plan` response claimed; `safeApply` then handed
// unconstrained production code nothing but a bare `planId`, free to
// re-derive its own deletion targets any way it likes at apply time. The
// belt validated a DESCRIPTION of the work, never the work itself.
//
// THE FIX: this file NEVER invokes `apply` -- not against a temp root, not
// with `--confirm`, not as a negative control expected to be rejected, not
// ever. `safeApply` is deleted, along with every call site.
// `NO-DESTRUCTIVE-INVOCATION` (near the end of `main()`) makes this
// self-enforcing: it AST-scans this file itself and fails the gate if a
// future edit reintroduces an apply/--confirm/gc-apply invocation anywhere.
//
// Coverage that used to come from calling `apply` is re-established two
// different ways, matched to what each criterion actually needs to prove:
//
//   (a) PLAN-ONLY, verifier-side (safe, real, never destructive). Anything
//       that only needs to prove something about ELIGIBILITY -- which paths
//       become candidates, under what category, with what retention window,
//       reported how -- keeps booting an isolated daemon, building real
//       fixtures under a fresh temp root, and calling `od storage gc
//       plan`/`report` for real. `plan` is dry-run by construction and
//       C10F-6 proves its call graph contains no delete primitive, so this
//       stays unconditionally safe regardless of what fixtures exist.
//
//   (b) DELETION SEMANTICS, as the PRODUCT'S OWN vitest tests -- never this
//       verifier. Proving a file is REALLY GONE (not merely "reported
//       removed") can only be done by code that runs `apply` for real
//       against a fixture root IT constructs itself, inside the daemon's
//       own test process -- exactly what `apps/daemon/tests/*.test.ts`
//       already does throughout this codebase, and exactly the boundary
//       VERIFICATION-CONTRACT.md draws between "code under test" and "the
//       verifier." Five required test files (`REQUIRED_RED_SPECS`, below)
//       are mandated by name, exact required test title(s), and the exact
//       realized-on-disk assertion each must make. This verifier's job for
//       each, via `checkRequiredRedSpecSync`, is threefold -- never to run
//       `apply` itself:
//         1. EXISTS -- present at HEAD, contains every required test title
//            (AST-exact `test(...)`/`it(...)` call sites).
//         2. BOUND -- reuses C10F-11's exact binding rule (imports a module
//            inside `storage`'s own reachable set AND references the
//            binding, or drives a real endpoint path from a real
//            call-expression position); `apply-semantics` additionally
//            requires the exact `/api/storage/gc-apply` path in that
//            position (`requireExactPath`).
//         3. RED-BEFORE-GREEN -- proved by REAL vitest execution, never by
//            reading source: (i) at HEAD, right now, every required title
//            passes (`pnpm --filter @open-design/daemon exec vitest run`,
//            JSON reporter, per-title `status`); (ii) the file's own
//            INTRODUCTION COMMIT (first commit in `baseCommit..HEAD` history
//            adding this exact path) is found by walking real git history,
//            checked out into an isolated `git worktree add --detach`, given
//            a frozen `pnpm install --offline --frozen-lockfile`, and run
//            for real AS COMMITTED AT THAT COMMIT (no overlay) -- proving
//            the file did not arrive already fully green. This is a
//            deliberately simpler, per-FILE instantiation of
//            `verify-w9-ingest.ts`'s per-TEST red-before-green replay --
//            simpler because W9 proves a regression test would have caught
//            a bug that PREDATES the test (needs a HEAD-content overlay onto
//            old production code); these five files are brand-new tests for
//            a brand-new feature with no pre-existing bug to regress
//            against, so proving ordinary red-before-green TDD discipline is
//            the right-shaped proof, and needs no overlay: the commit's own
//            content is exactly what gets replayed.
//
//   (c) `OD_STORAGE_TMP_ROOT` (round 1) is KEPT -- it is still exactly what
//       makes (a) safe: every Tier-1 fixture built for a plan-only criterion
//       must never resolve into the real checkout's `.tmp/tools-dev/...`
//       regardless of what the implementation does at apply time, since
//       apply is never invoked at all. What round 2 correctly rejected was
//       treating that brace, plus a lexical belt over a bare planId handoff,
//       as sufficient to make DESTRUCTIVE calls safe -- it was never safe
//       for that job, only for this one. The old belt function survives,
//       renamed and repurposed, as `planPathsOutsideFixtureRoots`: a
//       plan-CORRECTNESS check folded into every observed plan
//       (`recordObservedPlan`), still useful evidence that a compliant
//       implementation's `plan` never echoes a path outside the fixture
//       roots it was told to use -- but it gates nothing destructive,
//       because nothing destructive is gated here anymore.
//
// ALSO CLOSED THIS ROUND (round-2 findings 2-8; file:line-precise reasoning
// lives in the comment at each call site):
//   2. C10F-1 gets a genuine Tier-2/RUNTIME_DATA_DIR unknown-category probe
//      (not just a Tier-1-shaped one), plus a registry-consumption
//      cross-check. C10F-5's positive control is now a genuine Tier-2 fixture.
//   3. C10F-7/C10F-9's realized-vs-reported comparisons are now the
//      product's own tests, asserting fs.existsSync on their own synthetic
//      root -- never this verifier's read of a JSON removed[] array.
//   4. `fileCallsStorageEndpointByExactPath` now requires real
//      CallExpression argument position. `importedIdentifierIsReferenced`
//      is a dedicated, self-contained, REALLY-pruning traversal.
//   5. C10F-14's markers now match the real DECISIONS.md headings
//      (found by this file's own author reading the merged file) and
//      require the ruling's own content, not just 20 characters of any
//      text. C10F-15's no-default probe is schema-based
//      (`retentionWindows[category] = {days:number|null,
//      source:'default'|'override'|'unset'}`), never vacuous on a missing
//      entry, and adds the override positive control the PRD already
//      claimed but the old code never ran.
//   6. C10F-13's OWNED_REVIEW_PATHS no longer includes the review record's
//      own (necessarily-post-reviewedCommit) path, and now includes the
//      leased StorageRetention* glob. `reviewer` must additionally be a
//      real identity that has committed to this repository before.
//   7. Daemon teardown is rebuilt around POSIX process GROUPS
//      (`spawn(...,{detached:true})` + `process.kill(-pgid,sig)`), signals
//      the whole group, and POLLS for zero survivors before resolving --
//      the DECISIONS.md `W9AS-PARK` carry-forward, verbatim. Every teardown
//      result is pushed into one shared `allDaemonTeardownResults` array by
//      `bootIsolatedDaemon`'s own `.stop()` wrapper; `FIXTURE-ISOLATION`
//      requires every one of them `ok`.
//   8. `findRegistryLiteral` unwraps an `AsExpression` (`as const`) before
//      checking for an array literal -- this PRD's own example uses
//      `as const`. C10F-8's "rejected" no longer requires
//      `daemonBooted===true`. C10F-6 walks a real, memoized, cycle-safe call
//      graph rooted at `planStorageRetention` specifically
//      (`functionCallGraphContainsDeleteCall`) instead of flagging any
//      delete call anywhere in the whole file-level reachable set.
//
// SAFETY (unchanged): this verifier never starts, stops, or otherwise
// touches the ports 7456/51012 daemons. Every `od storage ...` invocation
// carries an explicit, already-resolved `OD_DAEMON_URL`; `OD_SIDECAR_IPC_PATH`
// is cleared; `assertSafeLoopbackUrl()` re-checks the port on every boot,
// every CLI call, and every direct fetch.
//
// GATE-INTEGRITY: repoRoot comes from process.cwd()/--repo, never
// import.meta.url. `typescript` is resolved via createRequire scoped to
// repoRoot; `@open-design/sidecar-proto` is ESM-only and loaded via dynamic
// `import()` of its built dist file.
//
// PRE-IMPLEMENTATION, EXPECTED STATE: no `apps/daemon/src/storage-gc/**`
// module exists, `cli.ts`'s SUBCOMMAND_MAP has no `storage` key,
// `leases.json` has no `W10f` entry, `DECISIONS.md` has none of the three
// freeze-blocking founder-decision records, and none of the five required
// red-spec test files exist. Every dynamic criterion fails BY NAME --
// expected clean-red, never a crash.

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
// Multiset (occurrence-count) diff -- never a Set.
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
// of .ts source (comments and template-literal tails are lexer trivia that
// ts.forEachChild never visits, so an AST walk structurally cannot match
// inside them).
// -----------------------------------------------------------------------
function parseTs(absPath: string): { sourceFile: TypeScriptModule.SourceFile; text: string } {
  const text = fs.readFileSync(absPath, 'utf8');
  return { sourceFile: ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true), text };
}
// Generic, deliberately NON-pruning: visitor(node) never controls recursion.
// Every caller that needs real pruning (e.g. "never descend into an
// ImportDeclaration") writes its own dedicated traversal instead of relying
// on this one's return value to stop descent -- see
// `importedIdentifierIsReferenced`, below, which does exactly that after a
// round-2 finding that a generic-`walk`-based version could not actually
// prune and silently matched inside the import clause itself.
function walk(node: TsNode, visitor: (n: TsNode) => void): void {
  visitor(node);
  ts.forEachChild(node, (child) => walk(child, visitor));
}
function containsUnsafeLiteralConstruct(node: TsNode): { unsafe: boolean; reason: string } {
  let unsafe = false;
  let reason = '';
  walk(node, (n) => {
    if (unsafe) return;
    if (ts.isSpreadAssignment(n) || ts.isSpreadElement(n)) { unsafe = true; reason = 'spread'; return; }
    if (ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)) { unsafe = true; reason = 'accessor'; return; }
    if (ts.isMethodDeclaration(n)) { unsafe = true; reason = 'method shorthand'; return; }
    if (ts.isComputedPropertyName(n)) { unsafe = true; reason = 'computed property name'; return; }
    if (ts.isPropertyAssignment(n)) {
      const keyText = ts.isIdentifier(n.name) ? n.name.text : ts.isStringLiteral(n.name) ? n.name.text : null;
      if (keyText === '__proto__') { unsafe = true; reason = '__proto__ key'; return; }
    }
  });
  return { unsafe, reason };
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
  return cliPath;
}
// Registry literal: PURE DATA ONLY. Required shape per entry: `category`
// (string), `tier` (1, 2, or 3 numeric literal), `retentionEnvVar` (string
// matching `OD_STORAGE_RETENTION_<...>_DAYS`), `defaultRetentionDays`
// (number literal or `null`), `justification` (one of the five
// PRD-sanctioned enum strings). Tier-3 entries additionally require
// `pinnedRelativePaths`.
interface RegistryEntry { category: string; tier: number; retentionEnvVar: string; defaultRetentionDays: number | null; justification: string | null; pinnedRelativePaths: string[] | null }
interface RegistryLiteralScan { found: boolean; file: string | null; entries: RegistryEntry[]; unsafe: boolean; unsafeReason: string; fieldViolations: string[] }
const RETENTION_ENV_VAR_RE = /^OD_STORAGE_RETENTION_[A-Z0-9_]+_DAYS$/;
const JUSTIFICATIONS = new Set(['inactive-namespace', 'log-retention', 'regenerable-cache', 'orphan-checked', 'e2e-artifact']);
// Founder Ruling 1, exactly: the only justifications carrying a DEFAULT
// window, and what that default must be. Absent from this map (cache/orphan)
// means the mandated default is `null`.
const RULING1_DEFAULT_DAYS: Record<string, number> = { 'inactive-namespace': 7, 'log-retention': 14, 'e2e-artifact': 3 };
function literalPropertyString(obj: TypeScriptModule.ObjectLiteralExpression, key: string): string | null {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const propKey = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null;
      if (propKey === key && ts.isStringLiteral(prop.initializer)) return prop.initializer.text;
    }
  }
  return null;
}
function literalPropertyNumber(obj: TypeScriptModule.ObjectLiteralExpression, key: string): number | null {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const propKey = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null;
      if (propKey === key && ts.isNumericLiteral(prop.initializer)) return Number(prop.initializer.text);
    }
  }
  return null;
}
function literalPropertyNullableNumber(obj: TypeScriptModule.ObjectLiteralExpression, key: string): { present: boolean; isNull: boolean; value: number | null } {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const propKey = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null;
      if (propKey === key) {
        if (prop.initializer.kind === ts.SyntaxKind.NullKeyword) return { present: true, isNull: true, value: null };
        if (ts.isNumericLiteral(prop.initializer)) return { present: true, isNull: false, value: Number(prop.initializer.text) };
        return { present: true, isNull: false, value: null };
      }
    }
  }
  return { present: false, isNull: false, value: null };
}
function literalPropertyStringArray(obj: TypeScriptModule.ObjectLiteralExpression, key: string): string[] | null {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const propKey = ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteral(prop.name) ? prop.name.text : null;
      if (propKey === key && ts.isArrayLiteralExpression(prop.initializer)) {
        const values = prop.initializer.elements.map((el) => (ts.isStringLiteral(el) ? el.text : null));
        if (values.some((v) => v === null)) return null;
        return values as string[];
      }
    }
  }
  return null;
}
// Round-2 finding 8a: unwraps an `AsExpression` (`as const`) before checking
// for an array literal -- this PRD's own recommended registry example uses
// `as const`, and the old check required the array literal to be the DIRECT
// initializer, so a legitimate implementation following the PRD's own
// example would have false-red.
function unwrapAsExpression(node: TypeScriptModule.Expression): TypeScriptModule.Expression {
  return ts.isAsExpression(node) ? unwrapAsExpression(node.expression) : node;
}
function findRegistryLiteral(reachable: Set<string>, nameHint: RegExp): RegistryLiteralScan {
  for (const file of reachable) {
    const { sourceFile } = parseTs(file);
    let result: RegistryLiteralScan | null = null;
    walk(sourceFile, (node) => {
      if (result) return;
      if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !nameHint.test(node.name.text) || !node.initializer) return;
      const initializer = unwrapAsExpression(node.initializer);
      if (!ts.isArrayLiteralExpression(initializer)) return;
      const elements = initializer.elements;
      const objectElements = elements.filter((el): el is TypeScriptModule.ObjectLiteralExpression => ts.isObjectLiteralExpression(el));
      if (objectElements.length !== elements.length || elements.length === 0) return;
      let unsafe = false; let unsafeReason = '';
      for (const el of elements) {
        const check = containsUnsafeLiteralConstruct(el);
        if (check.unsafe) { unsafe = true; unsafeReason = check.reason; break; }
      }
      const fieldViolations: string[] = [];
      const entries: RegistryEntry[] = objectElements.map((el, idx) => {
        const category = literalPropertyString(el, 'category');
        const tier = literalPropertyNumber(el, 'tier');
        const retentionEnvVar = literalPropertyString(el, 'retentionEnvVar');
        const justification = literalPropertyString(el, 'justification');
        const defaultField = literalPropertyNullableNumber(el, 'defaultRetentionDays');
        const pinnedRelativePaths = literalPropertyStringArray(el, 'pinnedRelativePaths');
        if (!category) fieldViolations.push(`entry[${idx}]: missing/non-literal "category"`);
        if (tier !== 1 && tier !== 2 && tier !== 3) fieldViolations.push(`entry[${idx}]: "tier" must be literal 1, 2, or 3`);
        if (!retentionEnvVar || !RETENTION_ENV_VAR_RE.test(retentionEnvVar)) fieldViolations.push(`entry[${idx}]: "retentionEnvVar" missing or does not match ${RETENTION_ENV_VAR_RE}`);
        if (!justification || !JUSTIFICATIONS.has(justification)) fieldViolations.push(`entry[${idx}]: "justification" missing or not in {${[...JUSTIFICATIONS].join(', ')}}`);
        if (!defaultField.present) fieldViolations.push(`entry[${idx}]: "defaultRetentionDays" missing -- must be an explicit literal number or the literal null`);
        if (justification && JUSTIFICATIONS.has(justification)) {
          const mandated = RULING1_DEFAULT_DAYS[justification] ?? null;
          const actual = defaultField.isNull ? null : defaultField.value;
          if (actual !== mandated) fieldViolations.push(`entry[${idx}]: justification "${justification}" requires defaultRetentionDays === ${mandated === null ? 'null' : mandated} (Founder Ruling 1), found ${actual === null ? 'null' : actual}`);
        }
        if (tier === 3 && (!pinnedRelativePaths || pinnedRelativePaths.length === 0)) fieldViolations.push(`entry[${idx}]: tier-3 requires a non-empty "pinnedRelativePaths" string array`);
        return { category: category ?? '', tier: tier ?? -1, retentionEnvVar: retentionEnvVar ?? '', defaultRetentionDays: defaultField.isNull ? null : defaultField.value, justification, pinnedRelativePaths };
      });
      result = { found: true, file, entries, unsafe, unsafeReason, fieldViolations };
    });
    if (result) return result;
  }
  return { found: false, file: null, entries: [], unsafe: false, unsafeReason: '', fieldViolations: [] };
}
// C10F-16: real, AST-derived clean-target relative path segments from
// e2e/scripts/playwright.ts's own cleanArtifacts() -- never a duplicated,
// hand-maintained copy that could drift from the real file.
function extractPlaywrightCleanTargets(): { found: boolean; targets: string[] } {
  const scriptPath = path.join(repoRoot, 'e2e/scripts/playwright.ts');
  if (!fs.existsSync(scriptPath)) return { found: false, targets: [] };
  const { sourceFile } = parseTs(scriptPath);
  let cleanFnNode: TsNode | null = null;
  walk(sourceFile, (node) => {
    if (cleanFnNode) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'cleanArtifacts') cleanFnNode = node;
  });
  if (!cleanFnNode) return { found: false, targets: [] };
  const targets: string[] = [];
  walk(cleanFnNode, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (!(ts.isIdentifier(node.expression.expression) && node.expression.name.text === 'join')) return;
    const [first, ...rest] = node.arguments;
    if (!first || !ts.isIdentifier(first) || rest.length === 0) return;
    const segments = rest.map((a) => (ts.isStringLiteral(a) ? a.text : null));
    if (segments.some((s) => s === null)) return;
    targets.push((segments as string[]).join('/'));
  });
  return { found: true, targets };
}
// Finds `export function <name>` within a reachable file set -- roots the
// plan-side reachability/call-graph analysis (C10F-6) at the PRD-mandated
// exact export name.
function findExportedFunctionEntry(reachable: Set<string>, exportName: string): string | null {
  for (const file of reachable) {
    const { sourceFile } = parseTs(file);
    let found = false;
    walk(sourceFile, (node) => {
      if (found) return;
      if ((ts.isFunctionDeclaration(node)) && node.name?.text === exportName) {
        const hasExportModifier = (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (hasExportModifier) found = true;
      }
    });
    if (found) return file;
  }
  return null;
}
const FS_DELETE_CALL_NAMES = new Set(['rm', 'rmSync', 'unlink', 'unlinkSync', 'rmdir', 'rmdirSync']);
// Round-2 finding 8c: locates a named function's own body node (function
// declaration OR `const x = (...) => ...`/`function(...) {}`), used by the
// real call-graph walk below.
function findFunctionBodyNode(sourceFile: TypeScriptModule.SourceFile, name: string): TsNode | null {
  let found: TsNode | null = null;
  walk(sourceFile, (node) => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) { found = node.body; return; }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
      node.initializer.body
    ) {
      found = node.initializer.body;
    }
  });
  return found;
}
// Round-2 finding 8c fix: a real, memoized, cycle-safe call graph rooted at
// ONE specific exported function -- replaces the old file-level
// `reachableFilesContainDeleteCall`, which flagged ANY delete call anywhere
// in the WHOLE transitively-imported file set. That was both a false-red
// (a colocated `applyStorageRetention` with a real, correct delete call in
// the SAME file as `planStorageRetention` failed this check even though
// `planStorageRetention` itself never calls it) and imprecise (attribution
// to the specific entry function was never actually checked). This walk
// only visits `entryFnName`'s own body, plus the bodies of same-file or
// storage-subtree-imported functions it ACTUALLY CALLS, transitively,
// memoized against cycles.
function functionCallGraphContainsDeleteCall(entryFile: string, entryFnName: string, reachableScope: Set<string>): { containsDelete: boolean; hits: string[]; visitedFns: string[] } {
  const hits: string[] = [];
  const visitedKeys = new Set<string>();
  const visitedFns: string[] = [];
  const queue: Array<{ file: string; fnName: string }> = [{ file: entryFile, fnName: entryFnName }];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) continue;
    const { file, fnName } = next;
    const key = `${file}::${fnName}`;
    if (visitedKeys.has(key) || !fs.existsSync(file)) continue;
    visitedKeys.add(key);
    const { sourceFile } = parseTs(file);
    const bodyNode = findFunctionBodyNode(sourceFile, fnName);
    if (!bodyNode) continue;
    visitedFns.push(`${path.relative(repoRoot, file)}::${fnName}`);
    walk(bodyNode, (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && FS_DELETE_CALL_NAMES.has(node.expression.name.text)) {
        hits.push(`${path.relative(repoRoot, file)}::${fnName}: ${node.expression.name.text}(...)`);
      }
    });
    const localImportMap = new Map<string, string>();
    walk(sourceFile, (node) => {
      if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && ts.isStringLiteral(node.moduleSpecifier)) {
        const resolved = resolveLocalImport(file, node.moduleSpecifier.text);
        if (resolved) {
          for (const el of node.importClause.namedBindings.elements) localImportMap.set(el.name.text, resolved);
        }
      }
    });
    walk(bodyNode, (node) => {
      if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return;
      const calleeName = node.expression.text;
      const importedFrom = localImportMap.get(calleeName);
      if (importedFrom) {
        // STRICT: never follow a call out of the storage subtree.
        if (reachableScope.has(importedFrom)) queue.push({ file: importedFrom, fnName: calleeName });
      } else {
        queue.push({ file, fnName: calleeName });
      }
    });
  }
  return { containsDelete: hits.length > 0, hits, visitedFns };
}
// Round-2 finding 4a fix: requires the matched literal to sit in real
// CallExpression argument position -- an unused array literal containing
// all three routes, or a dead variable declaration, no longer passes.
const STORAGE_ENDPOINT_PATHS = new Set(['/api/storage/gc-plan', '/api/storage/gc-apply', '/api/storage/report']);
function fileCallsStorageEndpointByExactPath(absPath: string): { calls: boolean; paths: string[] } {
  if (!fs.existsSync(absPath)) return { calls: false, paths: [] };
  const { sourceFile } = parseTs(absPath);
  const foundPaths = new Set<string>();
  walk(sourceFile, (node) => {
    const isMatchingLiteral =
      (ts.isStringLiteral(node) && STORAGE_ENDPOINT_PATHS.has(node.text)) ||
      (ts.isNoSubstitutionTemplateLiteral(node) && STORAGE_ENDPOINT_PATHS.has(node.text));
    if (!isMatchingLiteral) return;
    const literalText = (node as TypeScriptModule.StringLiteral | TypeScriptModule.NoSubstitutionTemplateLiteral).text;
    const parent = node.parent as TsNode | undefined;
    if (parent && ts.isCallExpression(parent) && parent.arguments.some((a) => a === node)) {
      foundPaths.add(literalText);
    }
  });
  return { calls: foundPaths.size > 0, paths: [...foundPaths] };
}
// Round-2 finding 4b fix: a dedicated, self-contained traversal with REAL
// pruning -- the generic `walk` above always recurses into every child
// regardless of what the visitor does, so the old version's
// `if (ts.isImportDeclaration(node)) return;` only skipped PROCESSING that
// node, never its descent; the import specifier's own name Identifier
// (e.g. `planStorageRetention` in `import { planStorageRetention } from
// '...'`) still got visited and matched, so an imported-but-never-used
// binding reported `referenced: true`. This function calls
// `ts.forEachChild` itself and returns BEFORE calling it for an
// ImportDeclaration, so that subtree is genuinely never visited.
function importedIdentifierIsReferenced(absPath: string, localName: string): boolean {
  const { sourceFile } = parseTs(absPath);
  let referenced = false;
  function visit(node: TsNode): void {
    if (referenced) return;
    if (ts.isImportDeclaration(node)) return; // PRUNE: never descend into an import declaration.
    if (ts.isIdentifier(node) && node.text === localName) { referenced = true; return; }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return referenced;
}

// -----------------------------------------------------------------------
// Fixture helpers -- EVERY fixture lives under a freshly mkdtemp'd temp
// project root (Tier-1) or a freshly mkdtemp'd temp data dir (Tier-2,
// RUNTIME_DATA_DIR). `repoRoot` is referenced for fixture construction
// NOWHERE in this file except the one read-only function below
// (FIXTURE-ISOLATION checks this mechanically).
// -----------------------------------------------------------------------
const runId = crypto.randomBytes(4).toString('hex');
let fixtureSeq = 0;
function nextFixtureName(label: string): string {
  fixtureSeq += 1;
  return `w10f-verify-${runId}-${fixtureSeq}-${label}`;
}
// The ONLY sanctioned reference to the real checkout's `.tmp/tools-dev/` in
// this entire file -- read-only, used exclusively by FIXTURE-ISOLATION to
// prove real pre-existing namespaces never leak into a plan.
function readOnlyListRealCheckoutTmpToolsDevNamespaces(): Array<{ name: string; fullPath: string }> {
  const dir = path.join(repoRoot, '.tmp', 'tools-dev');
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => ({ name: e.name, fullPath: path.join(dir, e.name) }));
  } catch {
    return [];
  }
}
function selfCheckFixtureIsolation(): { ok: boolean; detail: string } {
  const selfPath = fileURLToPath(import.meta.url);
  const { sourceFile } = parseTs(selfPath);
  const SANCTIONED_FN = 'readOnlyListRealCheckoutTmpToolsDevNamespaces';
  const WRITE_CALLS = new Set(['mkdirSync', 'writeFileSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'renameSync', 'utimesSync', 'appendFileSync', 'symlinkSync', 'copyFileSync', 'mkdtempSync']);
  function isTmpJoinOnRepoRoot(node: TsNode): boolean {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
    const obj = node.expression.expression;
    if (!(ts.isIdentifier(obj) && obj.text === 'path' && node.expression.name.text === 'join')) return false;
    const [first, second] = node.arguments;
    return !!first && !!second && ts.isIdentifier(first) && first.text === 'repoRoot' && ts.isStringLiteral(second) && second.text === '.tmp';
  }
  function isWriteCall(node: TsNode): boolean {
    return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && WRITE_CALLS.has(node.expression.name.text);
  }
  let totalTmpJoinSites = 0;
  walk(sourceFile, (node) => { if (isTmpJoinOnRepoRoot(node)) totalTmpJoinSites++; });
  let sanctionedFnFound = false;
  let sanctionedFnTmpJoinSites = 0;
  let sanctionedFnHasWriteCall = false;
  walk(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === SANCTIONED_FN) {
      sanctionedFnFound = true;
      walk(node, (inner) => {
        if (isTmpJoinOnRepoRoot(inner)) sanctionedFnTmpJoinSites++;
        if (isWriteCall(inner)) sanctionedFnHasWriteCall = true;
      });
    }
  });
  const ok = sanctionedFnFound && totalTmpJoinSites === 1 && sanctionedFnTmpJoinSites === 1 && !sanctionedFnHasWriteCall;
  return { ok, detail: `sanctionedFnFound=${sanctionedFnFound} totalTmpJoinSites=${totalTmpJoinSites} sanctionedFnTmpJoinSites=${sanctionedFnTmpJoinSites} sanctionedFnHasWriteCall=${sanctionedFnHasWriteCall}` };
}
async function withTempProjectRoot<T>(fn: (tempRoot: string) => Promise<T> | T): Promise<T> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'w10f-project-root-'));
  try {
    return await fn(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
function tmpNamespaceDir(tempRoot: string, source: string, namespace: string): string {
  return path.join(tempRoot, '.tmp', source, namespace);
}
function writeFixtureFileWithAge(absPath: string, content: string, ageDays: number): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content);
  const past = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  fs.utimesSync(absPath, past, past);
}
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
// Response schemas -- EXACT field extraction, never substring/"includes".
// -----------------------------------------------------------------------
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
interface PlanCandidate { path: string; category: string; namespace: string | null; sizeBytes: number; ageDays: number }
// `days` is `number | null` -- a category with no default and no override
// (Founder Ruling 1: "nothing else has a default window") echoes
// `{days: null, source: 'unset'}`, never a fabricated number (C10F-15).
interface PlanResponse { planId: string; retentionWindows: Record<string, { days: number | null; source: string }>; candidates: PlanCandidate[]; totals: { count: number; bytes: number } }
function parsePlanResponse(value: unknown): { ok: true; plan: PlanResponse } | { ok: false; error: string } {
  if (!isRecord(value) || value.ok !== true) return { ok: false, error: 'missing ok:true' };
  if (typeof value.planId !== 'string' || value.planId.length === 0) return { ok: false, error: 'missing/invalid planId' };
  if (!isRecord(value.retentionWindows)) return { ok: false, error: 'missing retentionWindows' };
  if (!Array.isArray(value.candidates)) return { ok: false, error: 'missing candidates array' };
  const candidates: PlanCandidate[] = [];
  for (const c of value.candidates) {
    if (!isRecord(c) || typeof c.path !== 'string' || typeof c.category !== 'string' || typeof c.sizeBytes !== 'number' || typeof c.ageDays !== 'number') {
      return { ok: false, error: `malformed candidate entry: ${JSON.stringify(c).slice(0, 200)}` };
    }
    candidates.push({ path: c.path, category: c.category, namespace: typeof c.namespace === 'string' ? c.namespace : null, sizeBytes: c.sizeBytes, ageDays: c.ageDays });
  }
  const retentionWindows: Record<string, { days: number | null; source: string }> = {};
  for (const [k, v] of Object.entries(value.retentionWindows)) {
    if (!isRecord(v) || (typeof v.days !== 'number' && v.days !== null) || typeof v.source !== 'string') return { ok: false, error: `malformed retentionWindows[${k}]` };
    retentionWindows[k] = { days: v.days, source: v.source };
  }
  if (!isRecord(value.totals) || typeof value.totals.count !== 'number' || typeof value.totals.bytes !== 'number') return { ok: false, error: 'missing/invalid totals' };
  return { ok: true, plan: { planId: value.planId, retentionWindows, candidates, totals: { count: value.totals.count, bytes: value.totals.bytes } } };
}
function parseErrorResponse(value: unknown): { ok: true; code: string; message: string } | { ok: false } {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) return { ok: false };
  const code = value.error.code;
  const message = value.error.message;
  if (typeof code !== 'string' || code.length === 0 || typeof message !== 'string') return { ok: false };
  return { ok: true, code, message };
}
interface ReportResponse { byCategory: Array<{ category: string; count: number; bytes: number }>; totals: { count: number; bytes: number } }
function parseReportResponse(value: unknown): { ok: true; report: ReportResponse } | { ok: false; error: string } {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.byCategory)) return { ok: false, error: 'missing ok:true / byCategory array' };
  const byCategory = value.byCategory.map((c) => (isRecord(c) && typeof c.category === 'string' && typeof c.count === 'number' && typeof c.bytes === 'number' ? { category: c.category, count: c.count, bytes: c.bytes } : null));
  if (byCategory.some((c) => c === null)) return { ok: false, error: 'malformed byCategory entry' };
  if (!isRecord(value.totals) || typeof value.totals.count !== 'number' || typeof value.totals.bytes !== 'number') return { ok: false, error: 'missing/invalid totals' };
  return { ok: true, report: { byCategory: byCategory as ReportResponse['byCategory'], totals: { count: value.totals.count, bytes: value.totals.bytes } } };
}

// Aggregated across the whole run.
const allObservedPlanCandidatePaths: string[] = [];
const allPlanConfinementViolations: string[] = [];
function isPathConfinedTo(p: string, root: string): boolean {
  const rel = path.relative(root, p);
  return rel === '' ? true : !rel.startsWith('..') && !path.isAbsolute(rel);
}
// Plan-CORRECTNESS evidence, never a destructive-action gate (round 3: this
// file never calls apply, so nothing destructive needs gating). A candidate
// is confined if it sits under EITHER this run's Tier-1 temp project root OR
// its Tier-2 temp data dir -- both verifier-owned fixture roots, never the
// real checkout.
function recordObservedPlan(plan: PlanResponse, tempRoot: string, dataDir: string): void {
  for (const c of plan.candidates) allObservedPlanCandidatePaths.push(c.path);
  const violations = plan.candidates.map((c) => c.path).filter((p) => !isPathConfinedTo(p, tempRoot) && !isPathConfinedTo(p, dataDir));
  allPlanConfinementViolations.push(...violations);
}

// -----------------------------------------------------------------------
// CLI resolution + safety-gated invocation
// -----------------------------------------------------------------------
const cliTsPath = path.join(repoRoot, 'apps/daemon/src/cli.ts');
const serverTsPath = path.join(repoRoot, 'apps/daemon/src/server.ts');
const storageEntry = fs.existsSync(cliTsPath) ? findSubcommandHandlerEntryPoint(cliTsPath, 'storage') : null;
const storageReachable = storageEntry ? reachableFilesFrom(storageEntry) : new Set<string>();

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

// `daemonUrl` and `tempRoot` are REQUIRED, never optional/defaulted.
// `OD_SIDECAR_IPC_PATH` is cleared so IPC discovery cannot bypass the
// explicit `OD_DAEMON_URL`.
function runStorageCli(daemonUrl: string, tempRoot: string, args: string[], env: NodeJS.ProcessEnv = {}): { skipped: true; reason: string } | { skipped: false; status: number; stdout: string } {
  if (!storageEntry) {
    return { skipped: true, reason: `'storage' is not a key in apps/daemon/src/cli.ts's SUBCOMMAND_MAP -- refusing to invoke the CLI at all, because an unrecognized first token falls through to runDaemonCliStartup() (starts a real daemon)` };
  }
  assertSafeLoopbackUrl(daemonUrl);
  const r = sh('pnpm', ['exec', 'tsx', cliTsPath, 'storage', ...args], {
    env: { ...process.env, ...env, OD_DAEMON_URL: daemonUrl, OD_SIDECAR_IPC_PATH: '', OD_STORAGE_TMP_ROOT: tempRoot },
    timeoutMs: 60_000,
  });
  return { skipped: false, status: r.status, stdout: r.stdout };
}

// -----------------------------------------------------------------------
// ESM-only workspace package loaders.
// -----------------------------------------------------------------------
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
// Isolated daemon subprocess. Round-2 finding 7: teardown is rebuilt around
// POSIX process GROUPS, per DECISIONS.md's `W9AS-PARK` carry-forward ("a
// leader's exit event is not proof the group exited... teardown must signal
// the process GROUP and then CONFIRM no survivors before resolving").
// `spawn(..., {detached:true})` makes the immediate child the leader of a
// NEW session and process group (pgid === its own pid on POSIX); every
// further descendant it spawns inherits that SAME pgid unless it
// independently calls setsid() itself, so `process.kill(-pgid, sig)`
// reaches the whole tree regardless of reparenting -- the exact class of
// orphan a ppid-based tree walk can miss.
// -----------------------------------------------------------------------
interface RequestLogEntry { method: string; url: string }
function bootIsolatedDaemonSubprocess(dataDir: string, tempRoot: string, extraEnv: NodeJS.ProcessEnv = {}): { proc: ReturnType<typeof spawn>; requestLogPath: string; readyPromise: Promise<{ baseUrl: string }> } {
  const runnerPath = path.join(os.tmpdir(), `w10f-daemon-runner-${runId}-${fixtureSeq}.mjs`);
  const requestLogPath = path.join(os.tmpdir(), `w10f-request-log-${runId}-${fixtureSeq}.jsonl`);
  fixtureSeq += 1;
  const serverUrl = pathToFileURL(serverTsPath).href;
  const runnerLines = [
    'import { appendFileSync } from "node:fs";',
    'const { startServer } = await import(process.env.W10F_SERVER_URL);',
    'const started = await startServer({ port: 0, host: "127.0.0.1", returnServer: true });',
    'started.server.on("request", (req) => {',
    '  try {',
    '    appendFileSync(process.env.W10F_REQUEST_LOG_PATH, JSON.stringify({ method: req.method ?? "", url: req.url ?? "" }) + "\\n");',
    '  } catch {',
    '    /* logging must never break the real request */',
    '  }',
    '});',
    'process.stdout.write(JSON.stringify({ ready: true, url: started.url }) + "\\n");',
    'process.on("SIGTERM", async () => { try { await started.shutdown?.(); } finally { process.exit(0); } });',
  ];
  const runnerContent = `${runnerLines.join('\n')}\n`;
  fs.writeFileSync(runnerPath, runnerContent);
  fs.writeFileSync(requestLogPath, '');
  try {
    execFileSync(process.execPath, ['--check', runnerPath], { stdio: 'pipe' });
  } catch (err) {
    fs.rmSync(runnerPath, { force: true });
    throw new Error(`generated daemon runner script failed node --check: ${String(err)}`);
  }
  const proc = spawn('pnpm', ['exec', 'tsx', runnerPath], {
    cwd: repoRoot,
    env: { ...process.env, ...extraEnv, OD_DATA_DIR: dataDir, OD_STORAGE_TMP_ROOT: tempRoot, W10F_SERVER_URL: serverUrl, W10F_REQUEST_LOG_PATH: requestLogPath },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
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
  return { proc, requestLogPath, readyPromise };
}
function readRequestLog(requestLogPath: string): RequestLogEntry[] {
  try {
    return fs.readFileSync(requestLogPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as RequestLogEntry);
  } catch {
    return [];
  }
}
function listProcessGroupMemberPids(pgid: number): number[] {
  const r = sh('ps', ['-Ao', 'pid=,pgid=']);
  if (r.status !== 0) return [];
  const pids: number[] = [];
  for (const line of r.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const pid = Number(parts[0]);
    const gid = Number(parts[1]);
    if (Number.isFinite(pid) && Number.isFinite(gid) && gid === pgid) pids.push(pid);
  }
  return pids;
}
async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
// Signals the WHOLE process group and polls for zero survivors before
// resolving -- never trusts the group leader's own `exit` event as proof
// the group is gone (that is exactly what `DECISIONS.md`'s `W9AS-PARK`
// entry names as the safety defect: "cancels the pending SIGKILL and
// resolves, while a SIGTERM-handling descendant in the same group stays
// alive").
async function stopIsolatedDaemonSubprocessTree(proc: ReturnType<typeof spawn>): Promise<{ ok: boolean; detail: string }> {
  if (proc.pid == null) return { ok: true, detail: 'no pid to stop' };
  const pgid = proc.pid;
  try { process.kill(-pgid, 'SIGTERM'); } catch { /* group may already be gone */ }
  const termDeadline = Date.now() + 8_000;
  let remaining = listProcessGroupMemberPids(pgid);
  while (remaining.length > 0 && Date.now() < termDeadline) {
    await sleepMs(200);
    remaining = listProcessGroupMemberPids(pgid);
  }
  if (remaining.length > 0) {
    try { process.kill(-pgid, 'SIGKILL'); } catch { /* already gone */ }
    const killDeadline = Date.now() + 4_000;
    while (remaining.length > 0 && Date.now() < killDeadline) {
      await sleepMs(200);
      remaining = listProcessGroupMemberPids(pgid);
    }
  }
  const ok = remaining.length === 0;
  return { ok, detail: `pgid=${pgid} SIGTERM sent, SIGKILL escalation ${remaining.length > 0 ? 'attempted' : 'not needed'}; remainingAfterConfirm=${JSON.stringify(remaining)}` };
}

// Every teardown this file ever performs is pushed here by
// `bootIsolatedDaemon`'s own `.stop()` wrapper -- never left for an
// individual call site to remember (round-2 finding 7: dedicated-daemon
// callers discarded the result). `FIXTURE-ISOLATION` requires every entry
// `ok`.
const allDaemonTeardownResults: Array<{ ok: boolean; detail: string }> = [];

interface IsolatedDaemon { baseUrl: string; dataDir: string; tempRoot: string; requestLogPath: string; stop: () => Promise<{ ok: boolean; detail: string }> }
async function bootIsolatedDaemon(extraEnv: NodeJS.ProcessEnv = {}): Promise<IsolatedDaemon> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10f-data-'));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'w10f-project-root-'));
  const { proc, requestLogPath, readyPromise } = bootIsolatedDaemonSubprocess(dataDir, tempRoot, extraEnv);
  let baseUrl: string;
  try {
    ({ baseUrl } = await readyPromise);
  } catch (err) {
    const stopResult = await stopIsolatedDaemonSubprocessTree(proc);
    allDaemonTeardownResults.push(stopResult);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw err;
  }
  assertSafeLoopbackUrl(baseUrl);
  return {
    baseUrl, dataDir, tempRoot, requestLogPath,
    stop: async () => {
      const stopResult = await stopIsolatedDaemonSubprocessTree(proc);
      allDaemonTeardownResults.push(stopResult);
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(tempRoot, { recursive: true, force: true });
      return stopResult;
    },
  };
}

// Survives shared-daemon teardown (it's a plain temp file this verifier
// itself wrote, never owned by the daemon process) so C10F-10 can read it
// AFTER the daemon that generated it has already been stopped.
let lastSharedDaemonRequestLogPath: string | null = null;

// =========================================================================
// REQUIRED RED SPECS -- the product's own vitest tests prove deletion
// semantics; this verifier proves they EXIST, are BOUND to production, and
// went RED BEFORE GREEN. See the round-3 header comment for the full
// architectural rationale. NEVER calls `apply` -- only `git`, `pnpm
// install --offline`, and `vitest run` against files the implementer wrote.
// =========================================================================
interface RequiredRedSpecConfig { key: string; relPath: string; requiredTitles: string[]; requireExactPath?: string }
const REQUIRED_RED_SPECS: Record<string, RequiredRedSpecConfig> = {
  'symlink-escape': {
    key: 'symlink-escape',
    relPath: 'apps/daemon/tests/storage-gc-symlink-escape.test.ts',
    requiredTitles: [
      'W10F-GC: a symlink to an external directory inside an eligible namespace is never entered by apply, and a real expired file in the same namespace is removed',
    ],
  },
  'imported-folder': {
    key: 'imported-folder',
    relPath: 'apps/daemon/tests/storage-gc-imported-folder.test.ts',
    requiredTitles: [
      "W10F-GC: apply never removes anything under an imported-folder project's metadata.baseDir, while a genuine orphaned Tier-2 fixture in the same run is removed",
    ],
  },
  'apply-semantics': {
    key: 'apply-semantics',
    relPath: 'apps/daemon/tests/storage-gc-apply-semantics.test.ts',
    requiredTitles: [
      'W10F-GC: apply without --confirm is rejected and deletes nothing',
      'W10F-GC: apply against an unknown planId is rejected and deletes nothing',
      "W10F-GC: apply's realized removed[] set exactly equals the plan's candidates minus a namespace that became active after planning, and the survivor is skipped with a non-empty reason",
      'W10F-GC: a file created after planning is never removed by apply even though it lives in an otherwise-eligible namespace',
    ],
    requireExactPath: '/api/storage/gc-apply',
  },
  'report-reconciliation': {
    key: 'report-reconciliation',
    relPath: 'apps/daemon/tests/storage-gc-report-reconciliation.test.ts',
    requiredTitles: [
      "W10F-GC: report totals after apply equal a fresh on-disk stat walk of the surviving fixture tree, not the plan's predicted totals",
    ],
  },
  'orphan-detection': {
    key: 'orphan-detection',
    relPath: 'apps/daemon/tests/storage-gc-orphan-detection.test.ts',
    requiredTitles: [
      'W10F-GC: a referenced artifact with a live database row is never a plan candidate and is never removed by apply',
      'W10F-GC: a genuinely orphaned artifact with no referencing database row is a plan candidate and is removed by apply',
    ],
  },
};
function extractTestTitlesFromSource(text: string, fakeFileName: string): { titles: string[]; duplicate: boolean } {
  const sourceFile = ts.createSourceFile(fakeFileName, text, ts.ScriptTarget.Latest, true);
  const titles: string[] = [];
  walk(sourceFile, (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === 'test' || node.expression.text === 'it')) {
      const firstArg = node.arguments[0];
      if (firstArg && ts.isStringLiteral(firstArg)) titles.push(firstArg.text);
    }
  });
  return { titles, duplicate: new Set(titles).size !== titles.length };
}
interface VitestJsonResult { reporterParsed: boolean; status: number; numFailedTests: number; numPassedTests: number; titleStatus: Map<string, string> }
function runVitestFileJson(cwd: string, testFileArg: string, outPath: string): VitestJsonResult {
  const r = sh('pnpm', ['--filter', '@open-design/daemon', 'exec', 'vitest', 'run', '-c', 'vitest.config.ts', '--reporter=json', `--outputFile=${outPath}`, testFileArg], { cwd, timeoutMs: 3 * 60_000 });
  let data: { numFailedTests?: number; numPassedTests?: number; testResults?: Array<{ assertionResults?: Array<{ title?: string; status?: string }> }> } | null = null;
  try { data = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch { data = null; }
  const titleStatus = new Map<string, string>();
  for (const fileResult of data?.testResults ?? []) {
    for (const a of fileResult.assertionResults ?? []) {
      if (typeof a.title === 'string' && typeof a.status === 'string') titleStatus.set(a.title, a.status);
    }
  }
  return { reporterParsed: data !== null, status: r.status, numFailedTests: data?.numFailedTests ?? -1, numPassedTests: data?.numPassedTests ?? -1, titleStatus };
}
// First commit in `baseCommit..headSha` history adding this exact path.
// `baseCommit`/`headSha` are resolved inside `main()` (never at module load,
// so a git-resolution failure can still write a proper emergency manifest)
// and threaded through explicitly rather than closed over as mutable
// module state.
function findFileFirstIntroductionCommit(relPath: string, baseCommit: string, headSha: string): string | null {
  const logResult = sh('git', ['log', '--reverse', '--format=%H', `${baseCommit}..${headSha}`, '--', relPath]);
  if (logResult.status !== 0) return null;
  const commits = logResult.stdout.trim().split('\n').filter(Boolean);
  return commits[0] ?? null;
}
// Checks out the introduction commit itself (NO overlay -- the commit's own
// content, as committed, is exactly what gets replayed) into an isolated
// detached worktree, frozen offline install, and runs the file for real.
// Genuinely red requires a nonzero exit AND at least one real assertion
// failure -- proving the file did not arrive already fully green.
function replayFileRedAtCommit(commit: string, relPath: string): { ok: boolean; detail: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10f-redspec-'));
  let worktreeAdded = false;
  try {
    const addResult = sh('git', ['worktree', 'add', '--detach', tempDir, commit], { timeoutMs: 5 * 60_000 });
    if (addResult.status !== 0) return { ok: false, detail: `git worktree add --detach ${tempDir} ${commit} failed: exit=${addResult.status} ${addResult.stdout.slice(-500)}` };
    worktreeAdded = true;
    sh('mise', ['trust'], { cwd: tempDir, timeoutMs: 30_000 });
    const installResult = sh('pnpm', ['install', '--offline', '--frozen-lockfile'], { cwd: tempDir, timeoutMs: 5 * 60_000 });
    if (installResult.status !== 0) return { ok: false, detail: `frozen offline install at ${commit} failed: exit=${installResult.status} ${installResult.stdout.slice(-1000)}` };
    const testFileAbs = path.join(tempDir, relPath);
    if (!fs.existsSync(testFileAbs)) return { ok: false, detail: `${relPath} does not exist at its own claimed introduction commit ${commit} -- introduction-commit resolution is broken` };
    const outPath = path.join(tempDir, '.w10f-redspec-result.json');
    const result = runVitestFileJson(path.join(tempDir, 'apps/daemon'), `tests/${path.basename(relPath)}`, outPath);
    const genuinelyRed = result.reporterParsed && result.status !== 0 && result.numFailedTests >= 1;
    return { ok: genuinelyRed, detail: `commit=${commit} reporterParsed=${result.reporterParsed} exit=${result.status} numFailedTests=${result.numFailedTests} numPassedTests=${result.numPassedTests}` };
  } catch (err) {
    return { ok: false, detail: `replay crashed: ${String(err)}` };
  } finally {
    if (worktreeAdded) sh('git', ['worktree', 'remove', '--force', tempDir], { timeoutMs: 60_000 });
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
interface RequiredRedSpecResult { ok: boolean; boundToProduction: boolean; fileExists: boolean; detail: string }
const requiredRedSpecCache = new Map<string, RequiredRedSpecResult>();
function checkRequiredRedSpecSync(config: RequiredRedSpecConfig, baseCommit: string, headSha: string): RequiredRedSpecResult {
  const cached = requiredRedSpecCache.get(config.key);
  if (cached) return cached;
  const finish = (result: RequiredRedSpecResult): RequiredRedSpecResult => {
    requiredRedSpecCache.set(config.key, result);
    return result;
  };
  const absPath = path.join(repoRoot, config.relPath);
  if (!fs.existsSync(absPath)) {
    return finish({ ok: false, boundToProduction: false, fileExists: false, detail: `${config.relPath} does not exist -- expected pre-implementation state` });
  }
  if (!storageEntry) {
    return finish({ ok: false, boundToProduction: false, fileExists: true, detail: "product surface missing: 'storage' not registered in SUBCOMMAND_MAP -- a red spec cannot bind to a nonexistent production path" });
  }
  const specImportSpecs = localImportSpecifiers(absPath);
  const specImports = specImportSpecs.map((spec) => resolveLocalImport(absPath, spec)).filter((p): p is string => p !== null);
  const boundImports = specImports.filter((imp) => storageReachable.has(imp));
  const { calls: drivesRealSurface, paths: drivenPaths } = fileCallsStorageEndpointByExactPath(absPath);
  let importBound = false;
  if (boundImports.length > 0) {
    const localNames: string[] = [];
    const { sourceFile } = parseTs(absPath);
    walk(sourceFile, (node) => {
      if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && ts.isStringLiteral(node.moduleSpecifier)) {
        const resolved = resolveLocalImport(absPath, node.moduleSpecifier.text);
        if (resolved && boundImports.includes(resolved)) {
          for (const el of node.importClause.namedBindings.elements) localNames.push(el.name.text);
        }
      }
    });
    importBound = localNames.some((name) => importedIdentifierIsReferenced(absPath, name));
  }
  const exactPathBound = config.requireExactPath ? drivenPaths.includes(config.requireExactPath) : true;
  const boundToProduction = (importBound || drivesRealSurface) && exactPathBound;
  if (!boundToProduction) {
    return finish({ ok: false, boundToProduction: false, fileExists: true, detail: `not bound to production: importBound=${importBound} drivesRealSurface=${drivesRealSurface} exactPathBound=${exactPathBound} (requireExactPath=${config.requireExactPath ?? 'n/a'}) drivenPaths=${JSON.stringify(drivenPaths)}` });
  }
  const { titles: presentTitles, duplicate } = extractTestTitlesFromSource(fs.readFileSync(absPath, 'utf8'), absPath);
  const missingTitles = config.requiredTitles.filter((t) => !presentTitles.includes(t));
  if (missingTitles.length > 0 || duplicate) {
    return finish({ ok: false, boundToProduction: true, fileExists: true, detail: `required title(s) missing, or the file has duplicate test titles: missing=${JSON.stringify(missingTitles)} duplicateTitlesPresent=${duplicate}` });
  }
  const greenOutPath = path.join(proofDir, `.redspec-head-${config.key}.json`);
  const green = runVitestFileJson(path.join(repoRoot, 'apps/daemon'), `tests/${path.basename(config.relPath)}`, greenOutPath);
  const allRequiredPassAtHead = green.reporterParsed && config.requiredTitles.every((t) => green.titleStatus.get(t) === 'passed');
  const greenOk = green.status === 0 && allRequiredPassAtHead;
  if (!greenOk) {
    return finish({ ok: false, boundToProduction: true, fileExists: true, detail: `not green at HEAD: exit=${green.status} reporterParsed=${green.reporterParsed} allRequiredPassAtHead=${allRequiredPassAtHead} titleStatus=${JSON.stringify([...green.titleStatus])}` });
  }
  const introductionCommit = findFileFirstIntroductionCommit(config.relPath, baseCommit, headSha);
  if (!introductionCommit) {
    return finish({ ok: false, boundToProduction: true, fileExists: true, detail: `could not resolve an introduction commit for ${config.relPath} in ${baseCommit}..${headSha}` });
  }
  const red = replayFileRedAtCommit(introductionCommit, config.relPath);
  return finish({ ok: red.ok, boundToProduction: true, fileExists: true, detail: `green-at-head: ok (exit=${green.status}); introductionCommit=${introductionCommit}; red-at-introduction: ${red.detail}` });
}
function getRequiredRedSpec(key: string, baseCommit: string, headSha: string): RequiredRedSpecResult {
  const config = REQUIRED_RED_SPECS[key];
  if (!config) throw new Error(`unknown required red spec key: ${key}`);
  return checkRequiredRedSpecSync(config, baseCommit, headSha);
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

  const requiredRedSpec = (key: string): RequiredRedSpecResult => getRequiredRedSpec(key, baseCommit, headSha);

  // Read BEFORE any fixture work -- FIXTURE-ISOLATION's ground truth.
  const realCheckoutNamespacesBeforeRun = readOnlyListRealCheckoutTmpToolsDevNamespaces();

  // -----------------------------------------------------------------
  // ONE shared isolated daemon for the plan-only criteria (C10F-1, C10F-2,
  // C10F-3's plan-only half, C10F-4, C10F-5's plan-only half, C10F-6).
  // C10F-8/C10F-15/C10F-16 boot their OWN dedicated daemons (need env
  // overrides set at boot time). C10F-7/C10F-9/C10F-17 need no daemon at
  // all -- they are entirely required-red-spec checks now.
  // -----------------------------------------------------------------
  let sharedDaemon: IsolatedDaemon | null = null;
  if (storageEntry) {
    try {
      sharedDaemon = await bootIsolatedDaemon();
      lastSharedDaemonRequestLogPath = sharedDaemon.requestLogPath;
    } catch (err) {
      console.error(`verify-w10f: shared daemon boot failed (dynamic criteria will fail honestly): ${String(err)}`);
    }
  }
  function requireSharedDaemon(id: string): IsolatedDaemon | null {
    if (!sharedDaemon) {
      record(id, '', '', false, '', { detail: sharedDaemon === null && storageEntry ? 'the shared verifier-owned daemon failed to boot -- see console output for the boot error' : "product surface missing: 'storage' not registered in apps/daemon/src/cli.ts SUBCOMMAND_MAP" });
      return null;
    }
    return sharedDaemon;
  }

  // -----------------------------------------------------------------
  // C10F-1 -- registry is a finite, named, pure-data allowlist. Runtime
  // proof that an unlisted directory never becomes a candidate regardless
  // of age, at BOTH Tier 1 (.tmp/<source>) and Tier 2 (RUNTIME_DATA_DIR --
  // round-2 finding 2: the old probe was Tier-1-shaped only). Plus a
  // registry-consumption cross-check: every registry category has a
  // corresponding retentionWindows key in the real runtime response, so a
  // decorative registry paired with a parallel hardcoded eligibility list
  // cannot pass silently.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-1', 'AST scan of the storage module + runtime plan against unlisted-category decoys at both Tier 1 and Tier 2', 'a named, pure-data array-literal registry exists with required fields per entry; an unlisted directory never appears as a candidate at either tier, regardless of age; every registry category has a corresponding retentionWindows key in the real runtime response', async () => {
    if (!storageEntry) { record('C10F-1', '', '', false, '', { detail: "product surface missing: 'storage' not registered in apps/daemon/src/cli.ts SUBCOMMAND_MAP" }); return; }
    const registry = findRegistryLiteral(storageReachable, /registry|target/i);
    const structuralOk = registry.found && !registry.unsafe && registry.fieldViolations.length === 0;
    const daemon = requireSharedDaemon('C10F-1');
    if (!daemon) return;
    const unlistedTier1Dir = tmpNamespaceDir(daemon.tempRoot, 'not-a-real-category', nextFixtureName('unlisted-t1'));
    writeFixtureFileWithAge(path.join(unlistedTier1Dir, 'old.txt'), 'x', 5000);
    const unlistedTier2Dir = path.join(daemon.dataDir, 'not-a-real-tier2-category', nextFixtureName('unlisted-t2'));
    writeFixtureFileWithAge(path.join(unlistedTier2Dir, 'old.txt'), 'x', 5000);
    let runtimeOk = false;
    let runtimeDetail = 'plan did not parse';
    try {
      const r = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
      const parsed = r.skipped === false ? parseLastJsonLine(r.stdout) : { ok: false as const, error: r.reason };
      const planResult = parsed.ok ? parsePlanResponse(parsed.value) : { ok: false as const, error: parsed.error };
      if (planResult.ok) recordObservedPlan(planResult.plan, daemon.tempRoot, daemon.dataDir);
      const leakedT1 = planResult.ok && planResult.plan.candidates.some((c) => c.path.startsWith(unlistedTier1Dir));
      const leakedT2 = planResult.ok && planResult.plan.candidates.some((c) => c.path.startsWith(unlistedTier2Dir));
      const registryCategoriesHaveWindows = planResult.ok && registry.entries.every((e) => e.category in planResult.plan.retentionWindows);
      runtimeOk = planResult.ok && !leakedT1 && !leakedT2 && registryCategoriesHaveWindows;
      runtimeDetail = `planParsed=${planResult.ok} leakedTier1=${leakedT1} leakedTier2=${leakedT2} registryCategoriesHaveWindows=${registryCategoriesHaveWindows}`;
    } finally {
      fs.rmSync(unlistedTier1Dir, { recursive: true, force: true });
      fs.rmSync(unlistedTier2Dir, { recursive: true, force: true });
    }
    const ok = structuralOk && runtimeOk;
    record('C10F-1', '', '', ok,
      `structural: found=${registry.found} unsafe=${registry.unsafe}(${registry.unsafeReason}) fieldViolations=${JSON.stringify(registry.fieldViolations)} entries=${JSON.stringify(registry.entries)}\nruntime: ${runtimeDetail}`,
      { detail: ok ? undefined : 'registry is not a valid pure-data allowlist, an unlisted category/directory leaked into a plan at either tier, or a registry category has no corresponding retentionWindows key at runtime' });
  });

  // -----------------------------------------------------------------
  // C10F-2 -- root confinement: source-level prefix-collision, exact JSON
  // candidate identity.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-2', 'od storage gc plan --json against a source-level prefix-collision fixture', 'a decoy source directory whose name string-prefix-collides with the real source root never appears as a candidate; a real in-scope file does, by exact path', async () => {
    const daemon = requireSharedDaemon('C10F-2');
    if (!daemon) return;
    const namespace = nextFixtureName('c2');
    const nsDir = tmpNamespaceDir(daemon.tempRoot, 'tools-dev', namespace);
    const collisionSourceDir = path.join(daemon.tempRoot, '.tmp', 'tools-devEVIL', namespace);
    writeFixtureFileWithAge(path.join(collisionSourceDir, 'old.txt'), 'evil', 400);
    const inScopeFile = path.join(nsDir, 'in-scope.txt');
    writeFixtureFileWithAge(inScopeFile, 'in-scope', 400);
    try {
      const r = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
      const parsed = r.skipped === false ? parseLastJsonLine(r.stdout) : { ok: false as const, error: r.reason };
      const planResult = parsed.ok ? parsePlanResponse(parsed.value) : { ok: false as const, error: parsed.error };
      if (planResult.ok) recordObservedPlan(planResult.plan, daemon.tempRoot, daemon.dataDir);
      const paths = planResult.ok ? planResult.plan.candidates.map((c) => c.path) : [];
      const includesCollision = paths.some((p) => p.startsWith(collisionSourceDir));
      const includesInScopeExact = paths.includes(inScopeFile);
      const ok = planResult.ok && !includesCollision && includesInScopeExact;
      record('C10F-2', '', '', ok,
        `planParsed=${planResult.ok} includesCollision=${includesCollision} includesInScopeExact=${includesInScopeExact}\ncandidatePaths=${JSON.stringify(paths)}`,
        { detail: ok ? undefined : 'candidate set leaked a source-level prefix-collision sibling, or missed the exact in-scope candidate path' });
    } finally {
      fs.rmSync(collisionSourceDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------
  // C10F-3 -- symlink escape refusal. Two halves, never overlapping in what
  // they prove: (a) plan-only, verifier-side -- content behind a symlink to
  // an external DIRECTORY never appears as a plan candidate (safe: read
  // only, no apply); (b) deletion semantics -- the required red spec
  // `storage-gc-symlink-escape.test.ts` proves the external content
  // literally survives a real `apply` and a real in-scope expired file is
  // literally removed, against a fixture root it builds itself.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-3', 'plan-only symlink-to-external-directory leak probe + required red spec apps/daemon/tests/storage-gc-symlink-escape.test.ts', 'nothing under an externally-linked directory ever appears as a plan candidate; a real in-scope expired file in the same namespace does; the required red spec exists, is bound to production, and proves realized apply behavior red-before-green', async () => {
    const daemon = requireSharedDaemon('C10F-3');
    if (!daemon) return;
    const namespace = nextFixtureName('c3');
    const nsDir = tmpNamespaceDir(daemon.tempRoot, 'tools-dev', namespace);
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10f-symlink-target-'));
    const externalFile = path.join(externalDir, 'real-user-file.txt');
    writeFixtureFileWithAge(externalFile, 'do-not-delete', 400);
    const linkPath = path.join(nsDir, 'escape-link');
    fs.mkdirSync(nsDir, { recursive: true });
    fs.symlinkSync(externalDir, linkPath, 'dir');
    const realExpired = path.join(nsDir, 'real-expired.txt');
    writeFixtureFileWithAge(realExpired, 'expired', 400);
    let planOk = false;
    let planDetail = 'plan did not parse';
    try {
      const plan = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
      const planParsed = plan.skipped === false ? parseLastJsonLine(plan.stdout) : { ok: false as const, error: plan.reason };
      const planResult = planParsed.ok ? parsePlanResponse(planParsed.value) : { ok: false as const, error: planParsed.error };
      if (planResult.ok) recordObservedPlan(planResult.plan, daemon.tempRoot, daemon.dataDir);
      const leaksExternal = planResult.ok && planResult.plan.candidates.some((c) => c.path.startsWith(externalDir));
      const includesRealExpired = planResult.ok && planResult.plan.candidates.some((c) => c.path === realExpired);
      planOk = planResult.ok && !leaksExternal && includesRealExpired;
      planDetail = `planParsed=${planResult.ok} leaksExternal=${leaksExternal} includesRealExpired=${includesRealExpired}`;
    } finally {
      fs.rmSync(externalDir, { recursive: true, force: true });
      fs.rmSync(nsDir, { recursive: true, force: true });
    }
    const redSpec = requiredRedSpec('symlink-escape');
    const ok = planOk && redSpec.ok;
    record('C10F-3', '', '', ok, `plan-only: ${planDetail}\nrequired red spec: ${redSpec.detail}`,
      { detail: ok ? undefined : 'symlinked-directory content leaked into the plan, the real in-scope expired file was missing from the plan, or the required red spec did not exist/bind/prove red-before-green' });
  });

  // -----------------------------------------------------------------
  // C10F-4 -- active-namespace refusal, across every Tier-1 category.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-4', 'od storage gc plan against a live-stamped namespace, across every Tier-1 category the registry declares', 'every category excludes its active namespace by exact path while the process is alive; every category includes it, exactly, once inactive', async () => {
    const daemon = requireSharedDaemon('C10F-4');
    if (!daemon) return;
    let sidecarProto: { SIDECAR_STAMP_FLAGS: Record<string, string> };
    try {
      sidecarProto = await loadSidecarProto();
    } catch (err) {
      record('C10F-4', '', '', false, '', { detail: `could not load @open-design/sidecar-proto: ${String(err)}` });
      return;
    }
    const registry = findRegistryLiteral(storageReachable, /registry|target/i);
    const tier1Categories = registry.entries.filter((e) => e.tier === 1).map((e) => e.category);
    const categories = tier1Categories.length > 0 ? tier1Categories : ['tools-dev'];
    const perCategory: Record<string, { activeExcluded: boolean; inactiveIncluded: boolean }> = {};
    for (const category of categories) {
      const namespace = nextFixtureName(`c4-${category}`);
      const nsDir = tmpNamespaceDir(daemon.tempRoot, category, namespace);
      writeFixtureFileWithAge(path.join(nsDir, 'runtime.json'), '{}', 400);
      const flags = sidecarProto.SIDECAR_STAMP_FLAGS;
      const liveProc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);',
        `${flags.app}=w10f-verify`, `${flags.mode}=dev`, `${flags.namespace}=${namespace}`,
        `${flags.ipc}=w10f-verify`, `${flags.source}=${category}`], { stdio: 'ignore' });
      try {
        await sleepMs(300);
        const activeRes = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
        const activeParsed = activeRes.skipped === false ? parseLastJsonLine(activeRes.stdout) : { ok: false as const, error: activeRes.reason };
        const activePlan = activeParsed.ok ? parsePlanResponse(activeParsed.value) : { ok: false as const, error: activeParsed.error };
        if (activePlan.ok) recordObservedPlan(activePlan.plan, daemon.tempRoot, daemon.dataDir);
        const activeExcluded = activePlan.ok && !activePlan.plan.candidates.some((c) => c.path.startsWith(nsDir));
        if (liveProc.pid != null) liveProc.kill('SIGKILL');
        await sleepMs(300);
        const inactiveRes = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
        const inactiveParsed = inactiveRes.skipped === false ? parseLastJsonLine(inactiveRes.stdout) : { ok: false as const, error: inactiveRes.reason };
        const inactivePlan = inactiveParsed.ok ? parsePlanResponse(inactiveParsed.value) : { ok: false as const, error: inactiveParsed.error };
        if (inactivePlan.ok) recordObservedPlan(inactivePlan.plan, daemon.tempRoot, daemon.dataDir);
        const inactiveIncluded = inactivePlan.ok && inactivePlan.plan.candidates.some((c) => c.path.startsWith(nsDir));
        perCategory[category] = { activeExcluded, inactiveIncluded };
      } finally {
        if (liveProc.pid != null && liveProc.exitCode == null) { try { liveProc.kill('SIGKILL'); } catch { /* already gone */ } }
        fs.rmSync(nsDir, { recursive: true, force: true });
      }
    }
    const ok = Object.values(perCategory).every((r) => r.activeExcluded && r.inactiveIncluded);
    record('C10F-4', '', '', ok, `perCategory=${JSON.stringify(perCategory)}`, { detail: ok ? undefined : 'at least one registry category planned/deleted an active namespace, or failed to include it once inactive' });
  });

  // -----------------------------------------------------------------
  // C10F-5 -- imported-folder baseDir untouchable. Plan-only half: no
  // candidate path is ever under baseDir, while a genuine Tier-2
  // (RUNTIME_DATA_DIR) positive control DOES appear -- round-2 finding 2:
  // the old positive control was `.tmp/tools-dev`, a Tier-1 fixture, so it
  // never actually proved Tier-2 collection works. Deletion-semantics half:
  // the required red spec `storage-gc-imported-folder.test.ts` proves
  // baseDir literally survives a real apply while the Tier-2 control is
  // literally removed.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-5', 'a real imported-folder project via POST /api/import/folder, plus a genuine Tier-2 (RUNTIME_DATA_DIR) plan-only positive control, plus required red spec apps/daemon/tests/storage-gc-imported-folder.test.ts', 'no file under metadata.baseDir ever appears in any plan candidate list; a genuine Tier-2 positive control does; the required red spec exists, is bound to production, and proves realized apply behavior red-before-green', async () => {
    const daemon = requireSharedDaemon('C10F-5');
    if (!daemon) return;
    const registry = findRegistryLiteral(storageReachable, /registry|target/i);
    const tier2DefaultEntry = registry.entries.find((e) => e.tier === 2 && e.defaultRetentionDays !== null);
    if (!tier2DefaultEntry) { record('C10F-5', '', '', false, '', { detail: 'no tier-2 registry entry with a non-null default window exists to use as the plan-only positive control' }); return; }
    const importedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10f-imported-'));
    const preciousFile = path.join(importedDir, 'precious.txt');
    writeFixtureFileWithAge(preciousFile, 'do-not-delete', 400);
    const controlDir = path.join(daemon.dataDir, tier2DefaultEntry.category, nextFixtureName('c5-control'));
    const controlFile = path.join(controlDir, 'orphaned.txt');
    writeFixtureFileWithAge(controlFile, 'orphaned', (tier2DefaultEntry.defaultRetentionDays ?? 0) + 30);
    let planOk = false;
    let planDetail = 'could not create the fixture imported project';
    try {
      const importRes = await fetchLoopbackOnly(`${daemon.baseUrl}/api/import/folder`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseDir: importedDir }),
      });
      if (importRes.status >= 200 && importRes.status < 300) {
        const planRes = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
        const planParsed = planRes.skipped === false ? parseLastJsonLine(planRes.stdout) : { ok: false as const, error: planRes.reason };
        const planResult = planParsed.ok ? parsePlanResponse(planParsed.value) : { ok: false as const, error: planParsed.error };
        if (planResult.ok) recordObservedPlan(planResult.plan, daemon.tempRoot, daemon.dataDir);
        const anyUnderBaseDir = planResult.ok && planResult.plan.candidates.some((c) => c.path === preciousFile || c.path.startsWith(importedDir));
        const controlIncluded = planResult.ok && planResult.plan.candidates.some((c) => c.path === controlFile);
        planOk = planResult.ok && !anyUnderBaseDir && controlIncluded;
        planDetail = `importStatus=${importRes.status} planParsed=${planResult.ok} anyUnderBaseDir=${anyUnderBaseDir} controlIncluded=${controlIncluded}`;
      } else {
        planDetail = `POST /api/import/folder returned ${importRes.status}`;
      }
    } finally {
      fs.rmSync(importedDir, { recursive: true, force: true });
      fs.rmSync(controlDir, { recursive: true, force: true });
    }
    const redSpec = requiredRedSpec('imported-folder');
    const ok = planOk && redSpec.ok;
    record('C10F-5', '', '', ok, `plan-only: ${planDetail}\nrequired red spec: ${redSpec.detail}`,
      { detail: ok ? undefined : 'baseDir content was listed as a candidate, the genuine Tier-2 positive control was not, or the required red spec did not exist/bind/prove red-before-green' });
  });

  // -----------------------------------------------------------------
  // C10F-6 -- dry-run is the default and the only read path.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-6', 'full multi-namespace fixture-tree multiset before/after od storage gc plan, plus a real call-graph walk from planStorageRetention', 'CLI exits 0 with valid JSON; every fixture namespace is byte-identical before/after; planStorageRetention\'s own call graph contains no filesystem-delete call', async () => {
    const daemon = requireSharedDaemon('C10F-6');
    if (!daemon) return;
    const planEntry = findExportedFunctionEntry(storageReachable, 'planStorageRetention');
    const deleteCheck = planEntry ? functionCallGraphContainsDeleteCall(planEntry, 'planStorageRetention', storageReachable) : { containsDelete: true, hits: ['planStorageRetention export not found'], visitedFns: [] };
    const namespaces = [nextFixtureName('c6a'), nextFixtureName('c6b')];
    const nsDirs = namespaces.map((ns) => tmpNamespaceDir(daemon.tempRoot, 'tools-dev', ns));
    for (const nsDir of nsDirs) {
      writeFixtureFileWithAge(path.join(nsDir, 'a.txt'), 'a', 400);
      writeFixtureFileWithAge(path.join(nsDir, 'sub', 'b.txt'), 'b', 400);
    }
    const before = nsDirs.map(statTreeMultiset);
    const r = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
    const cliOk = r.skipped === false && r.status === 0;
    const parsed = r.skipped === false ? parseLastJsonLine(r.stdout) : { ok: false as const, error: r.reason };
    const planResult = parsed.ok ? parsePlanResponse(parsed.value) : { ok: false as const, error: parsed.error };
    if (planResult.ok) recordObservedPlan(planResult.plan, daemon.tempRoot, daemon.dataDir);
    const after = nsDirs.map(statTreeMultiset);
    const diffs = before.map((b, i) => multisetDiff(b, after[i] ?? []));
    const treesUnchanged = diffs.every((d) => d.equal);
    for (const nsDir of nsDirs) fs.rmSync(nsDir, { recursive: true, force: true });
    const ok = cliOk && planResult.ok && treesUnchanged && !deleteCheck.containsDelete;
    record('C10F-6', '', '', ok,
      `cliOk=${cliOk} planParsed=${planResult.ok} treesUnchanged=${treesUnchanged}\nplanEntry=${planEntry ? path.relative(repoRoot, planEntry) : 'NOT FOUND'} containsDelete=${deleteCheck.containsDelete} hits=${JSON.stringify(deleteCheck.hits)} visitedFns=${JSON.stringify(deleteCheck.visitedFns)}`,
      { detail: ok ? undefined : 'plan mutated a fixture tree, exited non-zero, returned invalid JSON, or planStorageRetention\'s own call graph reaches a filesystem-delete primitive' });
  });

  // -----------------------------------------------------------------
  // C10F-7 -- apply is a distinct, plan-bound, re-validated, confirm-gated
  // action. Round-3: entirely a required-red-spec check now -- this
  // verifier never calls apply, including as a negative control expected to
  // be rejected (the round-2 CRITICAL ruling is unconditional). Every
  // assertion the old verifier-side version made (both negative controls,
  // exact multiset removed[] comparison, non-empty skip reason, the
  // post-plan surprise file never swept in) is now a required test title in
  // `storage-gc-apply-semantics.test.ts`, asserting REALIZED on-disk state
  // (fs.existsSync on its own synthetic root), never this verifier's read
  // of a reported removed[] array (round-2 finding 3).
  // -----------------------------------------------------------------
  await checkCriterion('C10F-7', 'required red spec apps/daemon/tests/storage-gc-apply-semantics.test.ts', 'the red spec exists, is bound to production via the exact /api/storage/gc-apply call, contains all four required titles, and proves each one red-before-green by real vitest execution', () => {
    const redSpec = requiredRedSpec('apply-semantics');
    record('C10F-7', '', '', redSpec.ok, redSpec.detail, { detail: redSpec.ok ? undefined : redSpec.detail });
  });

  // -----------------------------------------------------------------
  // C10F-8 -- retention windows: boot-time, independently effective, and
  // stated. Round-2 finding 8b: "rejected" no longer requires
  // `daemonBooted === true` -- a correct implementation that fails fast and
  // refuses to boot at all on an invalid 0/-5 window is a valid rejection.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-8', 'per-scenario isolated daemon boots with a retention-window env override set BEFORE boot; exact retentionWindows[category].days comparison', 'the fixture survives under a wide window and is collected under a narrow one for its own category only; every OTHER category\'s window is unaffected; the echoed effective-window value equals the override exactly; 0/-5 are rejected as config errors, whether by a nonzero CLI/HTTP status or by the daemon refusing to boot at all', async () => {
    if (!storageEntry) { record('C10F-8', '', '', false, '', { detail: "product surface missing: 'storage' not registered in apps/daemon/src/cli.ts SUBCOMMAND_MAP" }); return; }
    const registry = findRegistryLiteral(storageReachable, /registry|target/i);
    const tier1Entries = registry.entries.filter((e) => e.tier === 1);
    if (tier1Entries.length < 1) { record('C10F-8', '', '', false, '', { detail: 'no tier-1 registry entries found to test' }); return; }
    const targetEntry = tier1Entries[0]!;
    const otherEntry = tier1Entries.find((e) => e.category !== targetEntry.category) ?? null;

    async function planUnderOverride(overrideDays: string | null): Promise<{ daemonBooted: boolean; status: number; plan: PlanResponse | null }> {
      const extraEnv: NodeJS.ProcessEnv = overrideDays !== null ? { [targetEntry.retentionEnvVar]: overrideDays } : {};
      let daemon: IsolatedDaemon;
      try {
        daemon = await bootIsolatedDaemon(extraEnv);
      } catch {
        return { daemonBooted: false, status: -1, plan: null };
      }
      try {
        const namespace = nextFixtureName(`c8-${overrideDays ?? 'default'}`);
        const nsDir = tmpNamespaceDir(daemon.tempRoot, targetEntry.category, namespace);
        writeFixtureFileWithAge(path.join(nsDir, 'aged.txt'), 'x', 10);
        const r = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
        const parsed = r.skipped === false ? parseLastJsonLine(r.stdout) : { ok: false as const, error: r.reason };
        const planResult = parsed.ok ? parsePlanResponse(parsed.value) : { ok: false as const, error: parsed.error };
        if (planResult.ok) recordObservedPlan(planResult.plan, daemon.tempRoot, daemon.dataDir);
        return { daemonBooted: true, status: r.skipped === false ? r.status : -1, plan: planResult.ok ? planResult.plan : null };
      } finally {
        await daemon.stop();
      }
    }

    const wide = await planUnderOverride('365');
    const survivesWide = !!wide.plan && !wide.plan.candidates.some((c) => c.category === targetEntry.category);
    const narrow = await planUnderOverride('1');
    const collectedNarrow = !!narrow.plan && narrow.plan.candidates.some((c) => c.category === targetEntry.category);
    const echoedWideExact = wide.plan?.retentionWindows[targetEntry.category]?.days === 365;
    const echoedNarrowExact = narrow.plan?.retentionWindows[targetEntry.category]?.days === 1;
    let otherCategoryHeldFixed = true;
    if (otherEntry) {
      const otherWideWindow = wide.plan?.retentionWindows[otherEntry.category]?.days;
      const otherNarrowWindow = narrow.plan?.retentionWindows[otherEntry.category]?.days;
      otherCategoryHeldFixed = otherWideWindow !== undefined && otherWideWindow === otherNarrowWindow;
    }
    const zero = await planUnderOverride('0');
    const zeroRejected = zero.status !== 0;
    const negative = await planUnderOverride('-5');
    const negativeRejected = negative.status !== 0;

    const ok = survivesWide && collectedNarrow && !!echoedWideExact && !!echoedNarrowExact && otherCategoryHeldFixed && zeroRejected && negativeRejected;
    record('C10F-8', '', '', ok,
      `targetCategory=${targetEntry.category} otherCategory=${otherEntry?.category ?? 'n/a'}\nsurvivesWide=${survivesWide} collectedNarrow=${collectedNarrow} echoedWideExact=${echoedWideExact} echoedNarrowExact=${echoedNarrowExact} otherCategoryHeldFixed=${otherCategoryHeldFixed}\nzeroRejected=${zeroRejected} (daemonBooted=${zero.daemonBooted}) negativeRejected=${negativeRejected} (daemonBooted=${negative.daemonBooted})`,
      { detail: ok ? undefined : 'retention window did not independently govern eligibility at daemon-boot time, the echoed retentionWindows[category].days did not exactly equal the override, another category\'s window was not held fixed, or an invalid (0/-5) window was accepted instead of rejected' });
  });

  // -----------------------------------------------------------------
  // C10F-9 -- size/inventory report reconciliation. Round-3: entirely a
  // required-red-spec check -- exact "after-totals equal a fresh
  // independently-computed ground truth over the surviving fixture tree"
  // can only be observed with a real apply, which this verifier never
  // calls (round-2 finding 3).
  // -----------------------------------------------------------------
  await checkCriterion('C10F-9', 'required red spec apps/daemon/tests/storage-gc-report-reconciliation.test.ts', 'the red spec exists, is bound to production, contains the required title, and proves red-before-green by real vitest execution', () => {
    const redSpec = requiredRedSpec('report-reconciliation');
    record('C10F-9', '', '', redSpec.ok, redSpec.detail, { detail: redSpec.ok ? undefined : redSpec.detail });
  });

  // -----------------------------------------------------------------
  // Shared daemon has no further use -- tear down (process-group-based,
  // confirmed) BEFORE the static checks below.
  // -----------------------------------------------------------------
  if (sharedDaemon) {
    await sharedDaemon.stop();
    sharedDaemon = null;
  }

  // -----------------------------------------------------------------
  // C10F-10 -- UI/CLI parity over the three EXACT /api/storage/* routes.
  // gc-plan/report: real request-log proof from the shared daemon's own
  // HTTP server (this verifier's own real, non-destructive calls). gc-apply:
  // round-3 -- this verifier never calls apply, so its proof cannot come
  // from a request log; instead it cross-references the apply-semantics
  // required red spec's own `requireExactPath` binding (already computed by
  // C10F-7, cached -- no extra work), which proves the PRODUCT's own test
  // drives the real /api/storage/gc-apply endpoint from a real
  // call-expression position.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-10', 'capability-manifest.json row + real captured HTTP request log (gc-plan/report) + the apply-semantics red spec\'s own exact-endpoint binding (gc-apply) + AST-exact UI call-site scan', 'a valid, parity-applicable manifest row exists; the request log shows gc-plan/report were actually hit with the exact expected method; the apply-semantics red spec is bound to the exact gc-apply endpoint and fully proven; the StorageRetention UI component references the exact endpoint paths in a real call expression', () => {
    const manifestPath = path.join(repoRoot, 'scripts/waves/capability-manifest.json');
    if (!fs.existsSync(manifestPath)) { record('C10F-10', '', '', false, '', { detail: 'scripts/waves/capability-manifest.json not found' }); return; }
    let manifest: unknown;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (err) {
      record('C10F-10', '', '', false, '', { detail: `capability-manifest.json does not parse: ${String(err)}` });
      return;
    }
    const rows = Array.isArray(manifest) ? manifest : [];
    const storageRow = rows.find((r) => isRecord(r) && r.capability === 'storage');
    const parityApplicable = isRecord(storageRow) && storageRow.parityApplicable === true;
    const httpPath = isRecord(storageRow) && typeof storageRow.httpPath === 'string' ? storageRow.httpPath : '';
    const manifestPathValid = STORAGE_ENDPOINT_PATHS.has(httpPath);

    let requestLogEntries: RequestLogEntry[] = [];
    const requestLogAvailable = typeof lastSharedDaemonRequestLogPath === 'string' && fs.existsSync(lastSharedDaemonRequestLogPath);
    if (requestLogAvailable && lastSharedDaemonRequestLogPath) requestLogEntries = readRequestLog(lastSharedDaemonRequestLogPath);
    const hitPlan = requestLogEntries.some((e) => e.method === 'GET' && e.url.split('?')[0] === '/api/storage/gc-plan');
    const hitReport = requestLogEntries.some((e) => e.method === 'GET' && e.url.split('?')[0] === '/api/storage/report');

    const applySpec = requiredRedSpec('apply-semantics');

    const webComponentsDir = path.join(repoRoot, 'apps/web/src/components');
    const uiFiles = fs.existsSync(webComponentsDir) ? fs.readdirSync(webComponentsDir).filter((f) => /^StorageRetention.*\.tsx?$/.test(f)) : [];
    const uiCallSites = uiFiles.map((f) => fileCallsStorageEndpointByExactPath(path.join(webComponentsDir, f)));
    const uiFoundPaths = new Set(uiCallSites.flatMap((r) => r.paths));
    const uiReferencesAllThree = STORAGE_ENDPOINT_PATHS.size === uiFoundPaths.size && [...STORAGE_ENDPOINT_PATHS].every((p) => uiFoundPaths.has(p));

    const ok = parityApplicable && manifestPathValid && !!storageEntry && hitPlan && hitReport && applySpec.ok && uiFiles.length > 0 && uiReferencesAllThree;
    record('C10F-10', '', '', ok,
      `parityApplicable=${parityApplicable} manifestPathValid=${manifestPathValid} httpPath=${httpPath}\nrequestLogAvailable=${requestLogAvailable} hitPlan=${hitPlan} hitReport=${hitReport}\napplySpecOk=${applySpec.ok} (${applySpec.detail})\nuiFiles=${JSON.stringify(uiFiles)} uiReferencesAllThree=${uiReferencesAllThree} uiFoundPaths=${JSON.stringify([...uiFoundPaths])}`,
      { detail: ok ? undefined : 'capability-manifest row invalid, real captured HTTP traffic did not include gc-plan/report, the apply-semantics red spec did not prove exact gc-apply binding, or no StorageRetention* UI component references all three endpoint paths in a real call expression' });
  });

  // -----------------------------------------------------------------
  // C10F-11 -- every red spec binds to the production GC path, strictly
  // scoped.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-11', 'import-graph BFS from every storage-gc-*.test.ts file, scoped strictly to SUBCOMMAND_MAP.storage\'s own reachable set; AST-exact HTTP/CLI-driving detection; imported-but-unused check', 'every red spec either imports a module inside storage\'s OWN reachable set AND actually references it, or drives the real CLI/HTTP surface exclusively via a real AST call-site', () => {
    const testsDir = path.join(repoRoot, 'apps/daemon/tests');
    const specFiles = fs.existsSync(testsDir)
      ? fs.readdirSync(testsDir).filter((f) => /^storage-gc-.*\.test\.ts$/.test(f)).map((f) => path.join(testsDir, f))
      : [];
    if (specFiles.length === 0) { record('C10F-11', '', '', false, '', { detail: 'no apps/daemon/tests/storage-gc-*.test.ts files found' }); return; }
    if (!storageEntry) { record('C10F-11', '', '', false, '', { detail: "product surface missing: 'storage' not registered in SUBCOMMAND_MAP -- red specs cannot bind to a nonexistent production path" }); return; }
    const unbound: string[] = [];
    for (const specFile of specFiles) {
      const specImportSpecs = localImportSpecifiers(specFile);
      const specImports = specImportSpecs.map((spec) => resolveLocalImport(specFile, spec)).filter((p): p is string => p !== null);
      const boundImports = specImports.filter((imp) => storageReachable.has(imp));
      const { calls: drivesRealSurface } = fileCallsStorageEndpointByExactPath(specFile);
      if (boundImports.length > 0) {
        const localNames: string[] = [];
        const { sourceFile } = parseTs(specFile);
        walk(sourceFile, (node) => {
          if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && ts.isStringLiteral(node.moduleSpecifier)) {
            const resolved = resolveLocalImport(specFile, node.moduleSpecifier.text);
            if (resolved && boundImports.includes(resolved)) {
              for (const el of node.importClause.namedBindings.elements) localNames.push(el.name.text);
            }
          }
        });
        const anyUsed = localNames.some((name) => importedIdentifierIsReferenced(specFile, name));
        if (!anyUsed) unbound.push(`${path.basename(specFile)}: imports a production-reachable module but never references any imported binding (imported-but-unused)`);
        continue;
      }
      if (!drivesRealSurface) {
        unbound.push(`${path.basename(specFile)}: no import resolving inside SUBCOMMAND_MAP.storage's own reachable set, AND no real AST call-site referencing an exact /api/storage/* path`);
      }
    }
    const ok = unbound.length === 0;
    record('C10F-11', '', '', ok,
      `spec files checked: ${specFiles.length}\nunbound: ${unbound.join('\n') || 'none'}`,
      { detail: ok ? undefined : 'one or more red specs are not bound to the production storage-gc path by real import-and-use or a real AST-verified HTTP/CLI call site' });
  });

  // -----------------------------------------------------------------
  // C10F-12 -- gates.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-12', 'pnpm guard && pnpm typecheck', 'both exit 0 on the current tree', () => {
    const guard = sh('pnpm', ['guard'], { timeoutMs: 20 * 60_000 });
    const typecheck = sh('pnpm', ['typecheck'], { timeoutMs: 20 * 60_000 });
    const ok = guard.status === 0 && typecheck.status === 0;
    record('C10F-12', '', '', ok,
      `guard exit=${guard.status}\ntypecheck exit=${typecheck.status}\n\nguard tail:\n${guard.stdout.slice(-4000)}\n\ntypecheck tail:\n${typecheck.stdout.slice(-4000)}`,
      { detail: ok ? undefined : `guardExit=${guard.status} typecheckExit=${typecheck.status}` });
  });

  // -----------------------------------------------------------------
  // C10F-13 -- adversarial review of the implementation, non-spoofable.
  // Round-2 finding 6: the review record's OWN path is no longer in
  // OWNED_REVIEW_PATHS (it is committed strictly AFTER reviewedCommit by
  // construction -- naming its own path in the diff-must-be-empty set made
  // this criterion unsatisfiable by any legitimate review record). The
  // leased StorageRetention* UI glob is added. `reviewer` must additionally
  // be a real identity that has committed to this repository before
  // (git log --all), not merely a string shaped like "Name <email>".
  // -----------------------------------------------------------------
  const OWNED_REVIEW_PATHS = [
    'apps/daemon/src/storage-gc',
    'apps/daemon/src/routes/storage-gc.ts',
    'apps/daemon/src/cli.ts',
    'apps/daemon/src/server.ts',
    'apps/daemon/tests',
    'packages/contracts/src/api/storage-gc.ts',
    'packages/contracts/src/index.ts',
    'apps/web/src/components/SettingsDialog.tsx',
    ':(glob)apps/web/src/components/StorageRetention*',
    'apps/web/src/i18n/types.ts',
    'apps/web/src/i18n/locales/en.ts',
    'scripts/waves/capability-manifest.json',
    'docs/security/daemon-threat-model.md',
    'docs/plans/waves/DECISIONS.md',
    // Deliberately EXCLUDES docs/security/storage-gc-implementation-review.json
    // itself -- see the round-3 header comment / round-2 finding 6.
  ];
  const REVIEWER_FORMAT_RE = /^[^<>]+ <[^<>@]+@[^<>]+>$/;
  const PLACEHOLDER_MODEL_VALUES = new Set(['', 'todo', 'unknown', 'tbd', 'n/a', 'model']);
  const MODEL_NAME_RE = /^[A-Za-z][A-Za-z0-9.\- ]{5,80}$/;
  await checkCriterion('C10F-13', 'docs/security/storage-gc-implementation-review.json, exact-match reviewer/author check, expanded owned-path drift, reviewer-is-known-contributor check', 'reviewedCommit strict ancestor of HEAD; owned-path diff (the full lease surface, excluding the review record itself) reviewedCommit..HEAD empty; reviewer matches git author-line shape, is EXACT-distinct from every author in baseCommit..reviewedCommit, and has committed to this repository before; model is a real non-placeholder string; verdict APPROVE', () => {
    const reviewRel = 'docs/security/storage-gc-implementation-review.json';
    const reviewAbs = path.join(repoRoot, reviewRel);
    if (!fs.existsSync(reviewAbs)) { record('C10F-13', '', '', false, '', { detail: `${reviewRel} does not exist yet -- expected pre-implementation state` }); return; }
    let review: { reviewer?: string; model?: string; reviewedCommit?: string; verdict?: string };
    try {
      review = JSON.parse(fs.readFileSync(reviewAbs, 'utf8'));
    } catch (err) {
      record('C10F-13', '', '', false, '', { detail: `review record failed to parse: ${String(err)}` });
      return;
    }
    const reviewedCommit = review.reviewedCommit ?? '';
    const isRealCommit = /^[0-9a-f]{40}$/.test(reviewedCommit) && sh('git', ['cat-file', '-e', `${reviewedCommit}^{commit}`]).status === 0;
    const isAncestor = isRealCommit && sh('git', ['merge-base', '--is-ancestor', reviewedCommit, headSha]).status === 0;
    const isStrict = isAncestor && reviewedCommit !== headSha;
    const ownedDiff = isStrict ? sh('git', ['diff', '--name-only', reviewedCommit, headSha, '--', ...OWNED_REVIEW_PATHS]) : { status: 1, stdout: '' };
    const ownedDiffEmpty = isStrict && ownedDiff.status === 0 && ownedDiff.stdout.trim().length === 0;
    const authorsInRange = isStrict ? sh('git', ['log', '--format=%an <%ae>', `${baseCommit}..${reviewedCommit}`]).stdout.trim().split('\n').filter(Boolean) : [];
    const reviewerFormatValid = typeof review.reviewer === 'string' && REVIEWER_FORMAT_RE.test(review.reviewer);
    const reviewerDistinct = reviewerFormatValid && !authorsInRange.includes(review.reviewer as string); // EXACT equality, never substring
    const allRepoAuthorsResult = reviewerFormatValid ? sh('git', ['log', '--all', '--format=%an <%ae>']) : { status: 1, stdout: '' };
    const allRepoAuthors = new Set(allRepoAuthorsResult.stdout.trim().split('\n').filter(Boolean));
    const reviewerIsKnownContributor = reviewerFormatValid && allRepoAuthors.has(review.reviewer as string);
    const modelValid = typeof review.model === 'string' && MODEL_NAME_RE.test(review.model.trim()) && /\d/.test(review.model) && !PLACEHOLDER_MODEL_VALUES.has(review.model.trim().toLowerCase());
    const ok = isStrict && ownedDiffEmpty && reviewerFormatValid && reviewerDistinct && reviewerIsKnownContributor && modelValid && review.verdict === 'APPROVE';
    record('C10F-13', '', '', ok,
      `reviewedCommit=${reviewedCommit} isRealCommit=${isRealCommit} isStrict=${isStrict}\nownedDiffEmpty=${ownedDiffEmpty} (diff: ${ownedDiff.stdout.trim().slice(0, 800)})\nreviewerFormatValid=${reviewerFormatValid} reviewerDistinct=${reviewerDistinct} reviewerIsKnownContributor=${reviewerIsKnownContributor} reviewer=${review.reviewer}\nmodelValid=${modelValid} model=${review.model}\nauthorsInRange=${JSON.stringify(authorsInRange)}\nverdict=${review.verdict}`,
      { detail: ok ? undefined : 'review record failed one or more structural checks: not a strict ancestor, owned-path drift across the full lease surface since review, reviewer format/exact-distinctness/known-contributor failure, model unvalidated/placeholder, or verdict !== APPROVE' });
  });

  // -----------------------------------------------------------------
  // C10F-14 -- freeze-blocking founder decisions are recorded. Round-2:
  // this file's own author found (independent of the round-2 verdict) that
  // the old markers (**W10F-FOUNDER-1/2/4**) never matched the REAL landed
  // headings in DECISIONS.md (### W10F-RETENTION-WINDOWS /
  // ### W10F-E2E-ARTIFACT-SCOPE / ### W10F-OD-DELETABLE-CATEGORIES) --
  // fixed here. Round-2 finding 5: content-bound, not just 20 characters of
  // any text (which would accept text contradicting the actual ruling).
  // -----------------------------------------------------------------
  function findFounderDecisionSection(decisionsText: string, heading: string): { found: boolean; body: string } {
    const marker = `### ${heading}`;
    const idx = decisionsText.indexOf(marker);
    if (idx === -1) return { found: false, body: '' };
    const after = decisionsText.slice(idx + marker.length);
    const nextBoundary = after.search(/\n#{1,6}\s/);
    const body = (nextBoundary === -1 ? after : after.slice(0, nextBoundary)).trim();
    return { found: true, body };
  }
  await checkCriterion('C10F-14', 'read-only parse of docs/plans/waves/DECISIONS.md for the three real founder-decision headings, content-bound to their numeric/scope rulings', 'each of ### W10F-RETENTION-WINDOWS / ### W10F-E2E-ARTIFACT-SCOPE / ### W10F-OD-DELETABLE-CATEGORIES exists with content stating the actual ruling (the 7/14/3-day windows; e2e narrowly in scope; the named allowlist), not merely any 20 characters of arbitrary or contradicting text', () => {
    const decisionsPath = path.join(repoRoot, 'docs/plans/waves/DECISIONS.md');
    if (!fs.existsSync(decisionsPath)) { record('C10F-14', '', '', false, '', { detail: 'docs/plans/waves/DECISIONS.md not found' }); return; }
    const text = fs.readFileSync(decisionsPath, 'utf8');
    const windows = findFounderDecisionSection(text, 'W10F-RETENTION-WINDOWS');
    const e2eScope = findFounderDecisionSection(text, 'W10F-E2E-ARTIFACT-SCOPE');
    const categories = findFounderDecisionSection(text, 'W10F-OD-DELETABLE-CATEGORIES');
    const windowsBound = windows.found && windows.body.length >= 40 && /\b7\b/.test(windows.body) && /\b14\b/.test(windows.body) && /\b3\b/.test(windows.body);
    const e2eScopeBound = e2eScope.found && e2eScope.body.length >= 40 && /\bnarrow/i.test(e2eScope.body);
    const categoriesBound = categories.found && categories.body.length >= 40 && /allowlist/i.test(categories.body);
    const ok = windowsBound && e2eScopeBound && categoriesBound;
    record('C10F-14', '', '', ok,
      `windows: found=${windows.found} bound=${windowsBound}\ne2eScope: found=${e2eScope.found} bound=${e2eScopeBound}\ncategories: found=${categories.found} bound=${categoriesBound}`,
      { detail: ok ? undefined : 'one or more freeze-blocking founder decisions is missing from DECISIONS.md, or its recorded text does not state the actual ruling content -- this is the expected, correct pre-decision state, not an implementation defect' });
  });

  // -----------------------------------------------------------------
  // C10F-15 -- retention defaults match Founder Ruling 1 exactly, as
  // configuration. Round-2 finding 5: no longer vacuously passes a MISSING
  // registry entry; the no-default probe is schema-based
  // (retentionWindows[category] = {days, source:'unset'|'override'}) rather
  // than the old dead-code Tier-1-fixture-under-a-Tier-2-entry check; adds
  // the override positive control the PRD already claimed but the old code
  // never ran.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-15', 'registry defaultRetentionDays per justification vs. Founder Ruling 1; a no-override daemon boot plus a dedicated override daemon boot; exact schema-based retentionWindows[category] comparison', 'structural defaults match {inactive-namespace:7, log-retention:14, e2e-artifact:3, cache/orphan:null} exactly, requiring each entry to actually exist; with no override the daemon echoes exactly those defaults with source:"default", and a no-default category echoes {days:null, source:"unset"} and is never a candidate; setting a no-default category\'s env var explicitly makes an identically-aged fixture collectable with source:"override"', async () => {
    if (!storageEntry) { record('C10F-15', '', '', false, '', { detail: "product surface missing: 'storage' not registered in apps/daemon/src/cli.ts SUBCOMMAND_MAP" }); return; }
    const registry = findRegistryLiteral(storageReachable, /registry|target/i);
    const structuralOk = registry.found && registry.fieldViolations.length === 0;
    const inactiveEntry = registry.entries.find((e) => e.justification === 'inactive-namespace');
    const logEntry = registry.entries.find((e) => e.justification === 'log-retention');
    const e2eEntry = registry.entries.find((e) => e.justification === 'e2e-artifact');
    const noDefaultEntry = registry.entries.find((e) => e.justification === 'regenerable-cache' || e.justification === 'orphan-checked');

    let daemon: IsolatedDaemon | null = null;
    let runtimeOk = false;
    let runtimeDetail = 'could not boot a no-override daemon';
    try {
      daemon = await bootIsolatedDaemon();
      const planR = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
      const planParsed = planR.skipped === false ? parseLastJsonLine(planR.stdout) : { ok: false as const, error: planR.reason };
      const planResult = planParsed.ok ? parsePlanResponse(planParsed.value) : { ok: false as const, error: planParsed.error };
      if (planResult.ok) recordObservedPlan(planResult.plan, daemon.tempRoot, daemon.dataDir);
      const inactiveOk = !!inactiveEntry && planResult.ok && planResult.plan.retentionWindows[inactiveEntry.category]?.days === 7 && planResult.plan.retentionWindows[inactiveEntry.category]?.source === 'default';
      const logOk = !!logEntry && planResult.ok && planResult.plan.retentionWindows[logEntry.category]?.days === 14 && planResult.plan.retentionWindows[logEntry.category]?.source === 'default';
      const e2eOk = !!e2eEntry && planResult.ok && planResult.plan.retentionWindows[e2eEntry.category]?.days === 3 && planResult.plan.retentionWindows[e2eEntry.category]?.source === 'default';
      let noDefaultUnsetOk = false;
      if (noDefaultEntry) {
        const nsDir = path.join(daemon.dataDir, noDefaultEntry.category, nextFixtureName('c15-nodefault'));
        writeFixtureFileWithAge(path.join(nsDir, 'x.txt'), 'x', 400);
        const noOverrideRes = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
        const noOverrideParsed = noOverrideRes.skipped === false ? parseLastJsonLine(noOverrideRes.stdout) : { ok: false as const, error: noOverrideRes.reason };
        const noOverridePlan = noOverrideParsed.ok ? parsePlanResponse(noOverrideParsed.value) : { ok: false as const, error: noOverrideParsed.error };
        if (noOverridePlan.ok) recordObservedPlan(noOverridePlan.plan, daemon.tempRoot, daemon.dataDir);
        noDefaultUnsetOk = noOverridePlan.ok
          && noOverridePlan.plan.retentionWindows[noDefaultEntry.category]?.days === null
          && noOverridePlan.plan.retentionWindows[noDefaultEntry.category]?.source === 'unset'
          && !noOverridePlan.plan.candidates.some((c) => c.path.startsWith(nsDir));
        fs.rmSync(nsDir, { recursive: true, force: true });
      }
      runtimeOk = inactiveOk && logOk && e2eOk && noDefaultUnsetOk;
      runtimeDetail = `inactiveOk=${inactiveOk} logOk=${logOk} e2eOk=${e2eOk} noDefaultUnsetOk=${noDefaultUnsetOk}`;
    } catch (err) {
      runtimeDetail = `daemon boot/probe failed: ${String(err)}`;
    } finally {
      if (daemon) await daemon.stop();
    }

    let overrideOk = false;
    let overrideDetail = 'no no-default registry entry available to test the override positive control';
    if (noDefaultEntry) {
      let overrideDaemon: IsolatedDaemon | null = null;
      try {
        overrideDaemon = await bootIsolatedDaemon({ [noDefaultEntry.retentionEnvVar]: '5' });
        const nsDir = path.join(overrideDaemon.dataDir, noDefaultEntry.category, nextFixtureName('c15-override'));
        writeFixtureFileWithAge(path.join(nsDir, 'x.txt'), 'x', 30);
        const r = runStorageCli(overrideDaemon.baseUrl, overrideDaemon.tempRoot, ['gc', 'plan', '--json']);
        const parsed = r.skipped === false ? parseLastJsonLine(r.stdout) : { ok: false as const, error: r.reason };
        const planResult = parsed.ok ? parsePlanResponse(parsed.value) : { ok: false as const, error: parsed.error };
        if (planResult.ok) recordObservedPlan(planResult.plan, overrideDaemon.tempRoot, overrideDaemon.dataDir);
        overrideOk = planResult.ok
          && planResult.plan.retentionWindows[noDefaultEntry.category]?.days === 5
          && planResult.plan.retentionWindows[noDefaultEntry.category]?.source === 'override'
          && planResult.plan.candidates.some((c) => c.path.startsWith(nsDir));
        overrideDetail = `planParsed=${planResult.ok} echoed=${JSON.stringify(planResult.ok ? planResult.plan.retentionWindows[noDefaultEntry.category] : null)}`;
        fs.rmSync(nsDir, { recursive: true, force: true });
      } catch (err) {
        overrideDetail = `override daemon boot/probe failed: ${String(err)}`;
      } finally {
        if (overrideDaemon) await overrideDaemon.stop();
      }
    }

    const ok = structuralOk && runtimeOk && (noDefaultEntry ? overrideOk : true);
    record('C10F-15', '', '', ok,
      `structural: found=${registry.found} fieldViolations=${JSON.stringify(registry.fieldViolations)}\nruntime: ${runtimeDetail}\noverride: ${overrideDetail}`,
      { detail: ok ? undefined : 'registry defaults do not match Founder Ruling 1 exactly, or a no-override/override daemon did not echo/enforce them at runtime' });
  });

  // -----------------------------------------------------------------
  // C10F-16 -- e2e test-output scope pinned to the existing generated-only
  // allowlist. Stays plan-only, unchanged in architecture: this criterion's
  // threat is SCOPE (which paths are eligible), never deletion-realization
  // accuracy, so plan candidacy is the correct and sufficient runtime
  // observable -- it does not fall under the round-2 CRITICAL ruling's
  // "reported vs. realized" concern the way C10F-7/C10F-9 did.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-16', 'tier-3 pinnedRelativePaths vs. e2e/scripts/playwright.ts\'s real cleanArtifacts() target list; runtime pinned-vs-unpinned collection proof', 'every tier-3 pinnedRelativePaths entry is a real member of the existing clean-target list; a fixture under a pinned path aged past 3 days IS a plan candidate; an identically-aged fixture under an unpinned e2e-adjacent path is NEVER a plan candidate', async () => {
    if (!storageEntry) { record('C10F-16', '', '', false, '', { detail: "product surface missing: 'storage' not registered in apps/daemon/src/cli.ts SUBCOMMAND_MAP" }); return; }
    const registry = findRegistryLiteral(storageReachable, /registry|target/i);
    const tier3Entries = registry.entries.filter((e) => e.tier === 3);
    const realTargets = extractPlaywrightCleanTargets();
    if (tier3Entries.length === 0) { record('C10F-16', '', '', false, '', { detail: 'no tier-3 (e2e-artifact) registry entries found' }); return; }
    const pinViolations: string[] = [];
    for (const entry of tier3Entries) {
      for (const p of entry.pinnedRelativePaths ?? []) {
        if (!realTargets.targets.includes(p)) pinViolations.push(`entry "${entry.category}": pinnedRelativePaths "${p}" is not in e2e/scripts/playwright.ts's real clean-target list (${JSON.stringify(realTargets.targets)})`);
      }
    }
    const structuralOk = realTargets.found && pinViolations.length === 0;
    const target = tier3Entries[0]!;
    const pinnedPath = (target.pinnedRelativePaths ?? [])[0];
    let runtimeOk = false;
    let runtimeDetail = 'no pinned path to test';
    if (pinnedPath) {
      let daemon: IsolatedDaemon | null = null;
      try {
        daemon = await bootIsolatedDaemon();
        const pinnedFixture = path.join(daemon.tempRoot, 'e2e', 'ui', pinnedPath, 'w10f-pinned.txt');
        const unpinnedFixture = path.join(daemon.tempRoot, 'e2e', 'ui', 'src', 'w10f-unpinned-user-file.txt');
        writeFixtureFileWithAge(pinnedFixture, 'x', 10);
        writeFixtureFileWithAge(unpinnedFixture, 'x', 10);
        const r = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
        const parsed = r.skipped === false ? parseLastJsonLine(r.stdout) : { ok: false as const, error: r.reason };
        const planResult = parsed.ok ? parsePlanResponse(parsed.value) : { ok: false as const, error: parsed.error };
        if (planResult.ok) recordObservedPlan(planResult.plan, daemon.tempRoot, daemon.dataDir);
        const pinnedCollected = planResult.ok && planResult.plan.candidates.some((c) => c.path === pinnedFixture);
        const unpinnedNeverCollected = planResult.ok && !planResult.plan.candidates.some((c) => c.path === unpinnedFixture);
        runtimeOk = planResult.ok && pinnedCollected && unpinnedNeverCollected;
        runtimeDetail = `planParsed=${planResult.ok} pinnedCollected=${pinnedCollected} unpinnedNeverCollected=${unpinnedNeverCollected}`;
      } catch (err) {
        runtimeDetail = `daemon boot/probe failed: ${String(err)}`;
      } finally {
        if (daemon) await daemon.stop();
      }
    }
    const ok = structuralOk && runtimeOk;
    record('C10F-16', '', '', ok,
      `structural: realTargetsFound=${realTargets.found} pinViolations=${JSON.stringify(pinViolations)} realTargets=${JSON.stringify(realTargets.targets)}\nruntime: ${runtimeDetail}`,
      { detail: ok ? undefined : 'a tier-3 registry entry pins a path outside the real e2e clean-target list, or the implementation generalizes past the pinned allowlist (or fails to collect a pinned, aged fixture)' });
  });

  // -----------------------------------------------------------------
  // C10F-17 -- orphan detection is proven safe. Round-3: upgraded from
  // AST-title-scan-only to full required-red-spec execution (round-2
  // finding 5: the old check "neither executes the tests nor verifies
  // their assertions/fixtures").
  // -----------------------------------------------------------------
  await checkCriterion('C10F-17', 'required red spec apps/daemon/tests/storage-gc-orphan-detection.test.ts', 'the red spec exists, is bound to production, contains both required titles (referenced-survives, orphan-collected), and proves each red-before-green by real vitest execution', () => {
    const redSpec = requiredRedSpec('orphan-detection');
    record('C10F-17', '', '', redSpec.ok, redSpec.detail, { detail: redSpec.ok ? undefined : redSpec.detail });
  });

  // -----------------------------------------------------------------
  // NO-DESTRUCTIVE-INVOCATION (NEW, self-enforcing -- round-2 CRITICAL
  // ruling). Fails the gate if this file itself contains an apply/
  // --confirm/gc-apply invocation anywhere, so a future edit cannot quietly
  // reintroduce the exact defect class round 2 rejected.
  // -----------------------------------------------------------------
  function selfCheckNoDestructiveInvocation(): { ok: boolean; detail: string } {
    const selfPath = fileURLToPath(import.meta.url);
    const { sourceFile } = parseTs(selfPath);
    const violations: string[] = [];
    walk(sourceFile, (node) => {
      if (!ts.isCallExpression(node)) return;
      const calleeName = ts.isIdentifier(node.expression) ? node.expression.text : null;
      if (calleeName === 'runStorageCli') {
        const argsArrayArg = node.arguments[2];
        if (argsArrayArg && ts.isArrayLiteralExpression(argsArrayArg)) {
          const stringEls = argsArrayArg.elements.filter((el): el is TypeScriptModule.StringLiteral => ts.isStringLiteral(el)).map((el) => el.text);
          if (stringEls.includes('apply') || stringEls.includes('--confirm')) {
            violations.push(`runStorageCli(...) call passes 'apply' and/or '--confirm' in its CLI args array: ${JSON.stringify(stringEls)}`);
          }
        }
      }
      if (calleeName === 'fetchLoopbackOnly' || calleeName === 'fetch') {
        const urlArg = node.arguments[0];
        if (urlArg) {
          const raw = urlArg.getText(sourceFile);
          if (raw.includes('gc-apply')) violations.push(`${calleeName}(...) call's URL argument references gc-apply: ${raw.slice(0, 200)}`);
        }
      }
    });
    const hasSafeApplyFn = sourceFile.statements.some((s) => ts.isFunctionDeclaration(s) && s.name?.text === 'safeApply');
    if (hasSafeApplyFn) violations.push('a function named safeApply exists in this file again');
    return { ok: violations.length === 0, detail: violations.length === 0 ? 'no apply/--confirm/gc-apply invocation found in this file' : violations.join('; ') };
  }
  await checkCriterion('NO-DESTRUCTIVE-INVOCATION', 'structural self-scan of this file for any apply/--confirm/gc-apply invocation', 'this verifier never calls the destructive apply path, anywhere, under any name -- self-enforcing against a future edit that reintroduces one', () => {
    const result = selfCheckNoDestructiveInvocation();
    record('NO-DESTRUCTIVE-INVOCATION', '', '', result.ok, result.detail, { detail: result.ok ? undefined : result.detail });
  });

  // -----------------------------------------------------------------
  // FIXTURE-ISOLATION (meta -- proves round-1 finding 1 stays closed, and
  // now additionally requires every daemon teardown this run performed to
  // have confirmed zero survivors, and every observed plan to have stayed
  // confined to its own fixture roots -- round-2 finding 7).
  // -----------------------------------------------------------------
  await checkCriterion('FIXTURE-ISOLATION', 'structural self-scan of this file + real-checkout no-leak proof + plan-confinement proof + all-teardowns-confirmed proof', 'the real checkout\'s .tmp/tools-dev/ is referenced from exactly one, provably read-only function in this file; none of its pre-existing namespaces ever appeared in any plan this run observed; every observed plan\'s candidates stayed confined to their own fixture roots; every daemon teardown this run performed confirmed zero survivors', () => {
    const structural = selfCheckFixtureIsolation();
    const leaked = realCheckoutNamespacesBeforeRun.filter((ns) =>
      allObservedPlanCandidatePaths.some((p) => p === ns.fullPath || p.startsWith(`${ns.fullPath}${path.sep}`)));
    const confinementOk = allPlanConfinementViolations.length === 0;
    const teardownAllOk = allDaemonTeardownResults.every((r) => r.ok);
    const ok = structural.ok && leaked.length === 0 && confinementOk && teardownAllOk;
    record('FIXTURE-ISOLATION', '', '', ok,
      `structural: ${structural.detail}\nrealCheckoutNamespacesBeforeRun=${JSON.stringify(realCheckoutNamespacesBeforeRun)}\nobservedPlanCandidateCount=${allObservedPlanCandidatePaths.length}\nleaked=${JSON.stringify(leaked)}\nplanConfinementViolations=${JSON.stringify(allPlanConfinementViolations)}\ndaemonTeardownResults=${JSON.stringify(allDaemonTeardownResults)}`,
      { detail: ok ? undefined : 'either the real-checkout .tmp/tools-dev/ reference is no longer confined to the one sanctioned read-only function, a pre-existing real namespace leaked into an observed plan, a plan candidate escaped its own fixture roots, or a daemon teardown this run performed did not confirm zero survivors' });
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
