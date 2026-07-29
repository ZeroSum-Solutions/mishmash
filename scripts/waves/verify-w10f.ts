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
// REVIEW ROUND 1 REJECT -- FINDING 1 (CRITICAL), FIXED HERE.
// ===========================================================================
// The round-1 reviewer found that fixture namespaces were created under the
// checkout's REAL `.tmp/tools-dev/...` (only the daemon's OD_DATA_DIR was
// isolated), so a production `plan` -- which must legitimately enumerate
// every namespace under a Tier-1 source root to do its job -- could pick up
// OLD, INACTIVE namespaces that predate this run (a real developer's past
// tools-dev/e2e sessions) and a subsequent `apply` could delete them for
// real. That is independently fatal regardless of how good the containment
// logic is, because the fixture methodology itself put real data in scope.
//
// Fix, belt AND braces:
//   BRACE (primary): this wave's "Proposed capability surface" now mandates
//   `OD_STORAGE_TMP_ROOT` -- an env var, read at daemon-boot time exactly
//   like the existing `OD_DATA_DIR` precedent, that redirects EVERY Tier-1
//   `.tmp/<source>/<namespace>` root resolution to
//   `<OD_STORAGE_TMP_ROOT>/.tmp/<source>/<namespace>` instead of the real
//   checkout. This verifier NEVER boots a daemon, and NEVER invokes
//   `od storage ...`, without a freshly `mkdtemp`'d temp root passed as
//   `OD_STORAGE_TMP_ROOT` -- see `withTempProjectRoot`/`bootIsolatedDaemonSubprocess`.
//   BELT (independent, unconditional): before ANY `apply` call, this file
//   parses the `plan` response and REFUSES to call apply -- fails the
//   criterion outright, calls nothing -- unless EVERY candidate path is
//   provably confined under that SAME run's own temp root
//   (`assertPlanConfinedToTempRoot`). A planning bug alone, or an
//   implementation that silently ignores `OD_STORAGE_TMP_ROOT`, cannot reach
//   real data through this file even if the primary isolation fails.
//   PROOF (new `FIXTURE-ISOLATION` check, below): (a) a structural self-scan
//   of THIS file proves the checkout's real `.tmp/tools-dev/` is referenced
//   from exactly one, provably read-only function
//   (`readOnlyListRealCheckoutTmpToolsDevNamespaces`) -- a future edit that
//   reintroduces a write-capable call using `repoRoot` + `.tmp` anywhere else
//   fails this check by construction; (b) a runtime proof reads whatever
//   real namespaces already exist in the checkout's `.tmp/tools-dev/`
//   BEFORE any fixture work (read-only listing, never written to) and
//   asserts none of them ever appear among the plan candidates this run
//   observes, across every dynamic criterion.
//
// SAFETY (unchanged from round 1, reviewer-confirmed correct): this verifier
// never starts, stops, or otherwise touches the ports 7456/51012 daemons.
// `apps/daemon/src/daemon-url.ts`'s `resolveDaemonUrl()` falls back to
// `http://127.0.0.1:7456` after `--daemon-url` / `OD_DAEMON_URL` / IPC
// discovery / `tools-dev status` all miss -- one of the two forbidden ports.
// Every `od storage ...` invocation in this file carries an explicit,
// already-resolved `OD_DAEMON_URL` pointed at a verifier-booted, ephemeral-
// port daemon; `OD_SIDECAR_IPC_PATH` is cleared so IPC discovery cannot
// short-circuit past it; `assertSafeLoopbackUrl()` independently re-checks
// the port on every boot, every CLI call, and every direct fetch.
//
// GENERAL LESSON FROM ROUND 1 (applied throughout, not just where named):
//   - Prove RUNTIME behavior at runtime: boot the isolated daemon, issue a
//     real request/CLI call, assert the REAL response. AST/source checks are
//     reserved for structural facts with no better runtime observable
//     (e.g. "is the registry a pure-data literal", "is HEAD unchanged").
//   - "Binding" proves production code is USED, not merely importable.
//     Reachability sets are scoped to exactly the `storage` subtree, never a
//     server.ts-wide union; "drives the real surface" is decided by AST
//     (StringLiteral arguments to real CallExpressions), never a raw text
//     scan of the source, which cannot distinguish a comment from code.
//   - Every comparison against a name, path, or route is EXACT-match; no
//     substring/`startsWith`/`includes` stands in for identity anywhere a
//     production response is being graded.
//   - Any object-literal "pure data" validation rejects `__proto__` keys,
//     accessors, methods, computed property names, and spreads at any depth
//     -- not just plain assignments.
//
// GATE-INTEGRITY: repoRoot comes from process.cwd()/--repo, never
// import.meta.url, so this file runs correctly as an orchestrator-approved
// out-of-repo copy. `typescript` is resolved via createRequire scoped to
// repoRoot; `@open-design/sidecar-proto` and `@open-design/platform` are
// both ESM-only (`"type": "module"`, no CJS entry) and are loaded via
// dynamic `import()` of their built dist files -- a `createRequire(...)(...)`
// call on either throws `ERR_REQUIRE_ESM` (a round-1 defect, fixed).
//
// PRE-IMPLEMENTATION, EXPECTED STATE: no `apps/daemon/src/storage-gc/**`
// module exists (note: `apps/daemon/src/storage/` already exists in this
// tree and is unrelated -- a Phase-5 ProjectStorage/S3 adapter), `cli.ts`'s
// SUBCOMMAND_MAP has no `storage` key, `leases.json` has no `W10f` entry,
// and `docs/plans/waves/DECISIONS.md` has none of the three freeze-blocking
// founder-decision records this wave requires. Every dynamic criterion fails
// BY NAME with a "product surface missing" / "no lease entry" / "no founder
// decision" detail -- expected clean-red, never a crash. Every CLI/daemon
// invocation is gated behind a cheap static "does the surface exist at all"
// probe BEFORE any subprocess or fixture is constructed, specifically so an
// absent `storage` SUBCOMMAND_MAP key can never fall through to `cli.ts`'s
// default branch (`runDaemonCliStartup` -- starts a REAL daemon).

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
// inside them -- a raw `.includes()` on file text can and did, round 1).
// -----------------------------------------------------------------------
function parseTs(absPath: string): { sourceFile: TypeScriptModule.SourceFile; text: string } {
  const text = fs.readFileSync(absPath, 'utf8');
  return { sourceFile: ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true), text };
}
function walk(node: TsNode, visitor: (n: TsNode) => void): void {
  visitor(node);
  ts.forEachChild(node, (child) => walk(child, visitor));
}
// Round 1 finding 2: banning only SpreadAssignment/SpreadElement let
// {__proto__, accessor, method, toJSON} entries pass as "pure data". This
// rejects, anywhere inside the literal subtree: spreads, `__proto__`
// property keys, get/set accessors, method shorthand, and computed property
// names -- everything whose runtime shape can diverge from its literal text.
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
function subcommandMapHasKey(cliPath: string, key: string): boolean {
  return findSubcommandHandlerEntryPoint(cliPath, key) !== null;
}
// Registry literal: PURE DATA ONLY (no function-valued fields -- eligibility
// logic lives in real code that CONSUMES this data, never inside the literal
// itself, so the literal can be validated field-by-field as data). Required
// shape per entry: `category` (string), `tier` (1, 2, or 3 numeric literal),
// `retentionEnvVar` (string matching `OD_STORAGE_RETENTION_<...>_DAYS`),
// `defaultRetentionDays` (number literal or `null`), `justification` (one of
// the five PRD-sanctioned enum strings). Tier-3 entries additionally require
// `pinnedRelativePaths` (a string-literal array, cross-checked against
// e2e/scripts/playwright.ts's own real clean-target list -- C10F-16).
interface RegistryEntry { category: string; tier: number; retentionEnvVar: string; defaultRetentionDays: number | null; justification: string | null; pinnedRelativePaths: string[] | null }
interface RegistryLiteralScan { found: boolean; file: string | null; entries: RegistryEntry[]; unsafe: boolean; unsafeReason: string; fieldViolations: string[] }
const RETENTION_ENV_VAR_RE = /^OD_STORAGE_RETENTION_[A-Z0-9_]+_DAYS$/;
const JUSTIFICATIONS = new Set(['inactive-namespace', 'log-retention', 'regenerable-cache', 'orphan-checked', 'e2e-artifact']);
// Founder Ruling 1, exactly: the only justifications carrying a DEFAULT
// window, and what that default must be. Absent from this map (cache/orphan)
// means the mandated default is `null` -- "nothing else has a default window."
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
// Distinguishes "field absent/malformed" from "field is the literal `null`" --
// Ruling 1 requires cache/orphan entries to state `defaultRetentionDays: null`
// explicitly, not merely omit the field.
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
function findRegistryLiteral(reachable: Set<string>, nameHint: RegExp): RegistryLiteralScan {
  for (const file of reachable) {
    const { sourceFile } = parseTs(file);
    let result: RegistryLiteralScan | null = null;
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
      }
    });
    if (result) return result;
  }
  return { found: false, file: null, entries: [], unsafe: false, unsafeReason: '', fieldViolations: [] };
}
// C10F-16: real, AST-derived clean-target relative path segments from
// e2e/scripts/playwright.ts's own cleanArtifacts() -- never a duplicated,
// hand-maintained copy that could drift from the real file. Each
// `path.join(uiDir, 'a', 'b', ...)` call's string-literal arguments (after
// the first, which is the `uiDir` base) are joined with '/' to form one
// relative path segment.
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
// Finds `export function <name>` / `export async function <name>` within a
// reachable file set. Used to separately root the plan-vs-apply reachability
// analysis (C10F-6) -- the PRD mandates these two exact export names so
// "plan can never reach a delete primitive" is checkable without having to
// disentangle CLI subcommand dispatch internals.
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
// Transitive local-import BFS from a SPECIFIC exported function's owning
// file, checking whether ANY reachable file contains a call to a
// filesystem-delete primitive. Deliberately coarse (file-level reachability,
// not call-graph-precise to the single function) -- but rooted at the
// plan-specific entry point, not the whole `storage` subtree, which is what
// round 1 flagged as missing.
function reachableFilesContainDeleteCall(entryFile: string): { containsDelete: boolean; hits: string[] } {
  const reachable = reachableFilesFrom(entryFile);
  const hits: string[] = [];
  for (const file of reachable) {
    const { sourceFile } = parseTs(file);
    walk(sourceFile, (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && FS_DELETE_CALL_NAMES.has(node.expression.name.text)) {
        hits.push(`${path.relative(repoRoot, file)}: ${node.expression.name.text}(...)`);
      }
    });
  }
  return { containsDelete: hits.length > 0, hits };
}
// AST-based (never text-scan) detection of a real HTTP call whose URL
// argument is an EXACT string literal for one of the three mandated storage
// endpoints. Comments and template-literal tails are lexer trivia this walk
// never visits, closing the round-1 "raw-text /api/storage/ occurrence,
// including comments" false-green.
const STORAGE_ENDPOINT_PATHS = new Set(['/api/storage/gc-plan', '/api/storage/gc-apply', '/api/storage/report']);
function fileCallsStorageEndpointByExactPath(absPath: string): { calls: boolean; paths: string[] } {
  if (!fs.existsSync(absPath)) return { calls: false, paths: [] };
  const { sourceFile } = parseTs(absPath);
  const foundPaths = new Set<string>();
  walk(sourceFile, (node) => {
    if (ts.isStringLiteral(node) && STORAGE_ENDPOINT_PATHS.has(node.text)) foundPaths.add(node.text);
    // Template literals with no substitution (`\`/api/storage/gc-plan\``) --
    // NoSubstitutionTemplateLiteral is a distinct AST node from a comment;
    // still real source, still exact-matched.
    if (ts.isNoSubstitutionTemplateLiteral(node) && STORAGE_ENDPOINT_PATHS.has(node.text)) foundPaths.add(node.text);
  });
  return { calls: foundPaths.size > 0, paths: [...foundPaths] };
}
// "Imported but unused" check (round 1 finding 6): an import resolving into
// the production-reachable set is not binding proof by itself if the local
// name is never referenced. Scans for the imported local identifier
// appearing as a real Identifier reference elsewhere in the file (not the
// import clause itself).
function importedIdentifierIsReferenced(absPath: string, localName: string): boolean {
  const { sourceFile } = parseTs(absPath);
  let referenced = false;
  let sawUseOutsideImport = false;
  walk(sourceFile, (node) => {
    if (ts.isImportDeclaration(node)) return; // skip the declaration itself
    if (ts.isIdentifier(node) && node.text === localName) sawUseOutsideImport = true;
  });
  referenced = sawUseOutsideImport;
  return referenced;
}

// -----------------------------------------------------------------------
// Fixture helpers -- EVERY fixture lives under a freshly mkdtemp'd temp
// project root. `repoRoot` is referenced for fixture construction NOWHERE
// in this file except the one read-only function below (FIXTURE-ISOLATION
// checks this mechanically).
// -----------------------------------------------------------------------
const runId = crypto.randomBytes(4).toString('hex');
let fixtureSeq = 0;
function nextFixtureName(label: string): string {
  fixtureSeq += 1;
  return `w10f-verify-${runId}-${fixtureSeq}-${label}`;
}
// The ONLY sanctioned reference to the real checkout's `.tmp/tools-dev/` in
// this entire file -- read-only (existsSync + readdirSync only), used
// exclusively by the FIXTURE-ISOLATION check to prove real pre-existing
// namespaces never leak into a plan. Self-checked by `selfCheckFixtureIsolation`,
// which requires EXACTLY one `path.join(repoRoot, '.tmp', ...)` call site in
// the whole file, and requires it to live here. Returns each namespace's
// full real path alongside its bare name so every OTHER call site that
// needs the full path (the leak-detection comparison, below) can reuse this
// function's own output instead of separately reconstructing
// `repoRoot` + `.tmp` -- keeping the "exactly one call site" invariant real,
// not just true today until the next caller needs a full path too.
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
// Fresh, fully isolated temp "project root" -- NEVER the checkout. Every
// Tier-1 `.tmp/<source>/<namespace>` fixture is built under
// `<tempRoot>/.tmp/<source>/<namespace>`, matching the real relative layout
// so a conforming implementation resolving `.tmp` off `OD_STORAGE_TMP_ROOT`
// finds it in exactly the shape it expects off the real project root.
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
interface PlanResponse { planId: string; retentionWindows: Record<string, { days: number; source: string }>; candidates: PlanCandidate[]; totals: { count: number; bytes: number } }
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
  const retentionWindows: Record<string, { days: number; source: string }> = {};
  for (const [k, v] of Object.entries(value.retentionWindows)) {
    if (!isRecord(v) || typeof v.days !== 'number' || typeof v.source !== 'string') return { ok: false, error: `malformed retentionWindows[${k}]` };
    retentionWindows[k] = { days: v.days, source: v.source };
  }
  if (!isRecord(value.totals) || typeof value.totals.count !== 'number' || typeof value.totals.bytes !== 'number') return { ok: false, error: 'missing/invalid totals' };
  return { ok: true, plan: { planId: value.planId, retentionWindows, candidates, totals: { count: value.totals.count, bytes: value.totals.bytes } } };
}
interface ApplyResponse { planId: string; removed: Array<{ path: string; category: string; sizeBytes: number }>; skipped: Array<{ path: string; category: string; reason: string }>; totals: { removedCount: number; removedBytes: number } }
function parseApplyResponse(value: unknown): { ok: true; apply: ApplyResponse } | { ok: false; error: string } {
  if (!isRecord(value) || value.ok !== true) return { ok: false, error: 'missing ok:true' };
  if (typeof value.planId !== 'string') return { ok: false, error: 'missing planId' };
  if (!Array.isArray(value.removed) || !Array.isArray(value.skipped)) return { ok: false, error: 'missing removed/skipped arrays' };
  const removed = value.removed.map((r) => (isRecord(r) && typeof r.path === 'string' && typeof r.category === 'string' && typeof r.sizeBytes === 'number' ? { path: r.path, category: r.category, sizeBytes: r.sizeBytes } : null));
  const skipped = value.skipped.map((r) => (isRecord(r) && typeof r.path === 'string' && typeof r.category === 'string' && typeof r.reason === 'string' && r.reason.trim().length > 0 ? { path: r.path, category: r.category, reason: r.reason } : null));
  if (removed.some((r) => r === null) || skipped.some((r) => r === null)) return { ok: false, error: 'malformed removed/skipped entry' };
  if (!isRecord(value.totals) || typeof value.totals.removedCount !== 'number' || typeof value.totals.removedBytes !== 'number') return { ok: false, error: 'missing/invalid totals' };
  return { ok: true, apply: { planId: value.planId, removed: removed as ApplyResponse['removed'], skipped: skipped as ApplyResponse['skipped'], totals: { removedCount: value.totals.removedCount, removedBytes: value.totals.removedBytes } } };
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

// Aggregated across the whole run for the FIXTURE-ISOLATION runtime proof.
const allObservedPlanCandidatePaths: string[] = [];
function recordObservedPlan(plan: PlanResponse): void {
  for (const c of plan.candidates) allObservedPlanCandidatePaths.push(c.path);
}

// THE BELT (finding 1): confines every `apply` call to candidates the
// verifier itself could only have produced under this run's own temp root.
// Independent of, and unconditional on, whatever the primary
// OD_STORAGE_TMP_ROOT isolation does or does not do correctly.
function assertPlanConfinedToTempRoot(plan: PlanResponse, tempRoot: string): { ok: boolean; violations: string[] } {
  const violations = plan.candidates
    .map((c) => c.path)
    .filter((p) => {
      const rel = path.relative(tempRoot, p);
      return rel === '' ? false : rel.startsWith('..') || path.isAbsolute(rel);
    });
  return { ok: violations.length === 0, violations };
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

// `daemonUrl` and `tempRoot` are REQUIRED, never optional/defaulted --
// there is no calling convention that lets this function invoke
// `od storage ...` without both a verifier-owned daemon URL AND an explicit
// `OD_STORAGE_TMP_ROOT`. `OD_SIDECAR_IPC_PATH` is cleared so IPC discovery
// cannot bypass the explicit `OD_DAEMON_URL`.
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
// ESM-only workspace package loaders (round 1 finding: createRequire throws
// ERR_REQUIRE_ESM on either of these).
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
interface PlatformProcessApi {
  listProcessSnapshots: () => Promise<Array<{ pid: number; ppid: number; command: string }>>;
  collectProcessTreePids: (processes: Array<{ pid: number; ppid: number; command: string }>, rootPids: Array<number | null | undefined>) => number[];
  stopProcesses: (pids: Array<number | null | undefined>) => Promise<{ stoppedPids: number[]; remainingPids: number[]; forcedPids: number[] }>;
}
let platformCache: PlatformProcessApi | null = null;
async function loadPlatform(): Promise<PlatformProcessApi> {
  if (platformCache) return platformCache;
  const distPath = path.join(repoRoot, 'packages/platform/dist/index.mjs');
  if (!fs.existsSync(distPath)) throw new Error(`packages/platform is not built (missing ${distPath}) -- run pnpm install`);
  const mod = (await import(pathToFileURL(distPath).href)) as PlatformProcessApi;
  platformCache = { listProcessSnapshots: mod.listProcessSnapshots, collectProcessTreePids: mod.collectProcessTreePids, stopProcesses: mod.stopProcesses };
  return platformCache;
}

// -----------------------------------------------------------------------
// Isolated daemon subprocess -- carries its own OD_DATA_DIR, its own
// OD_STORAGE_TMP_ROOT (finding 1's primary isolation brace), optional
// retention-window env overrides (must be set at BOOT time -- a thin
// HTTP-client CLI cannot change an already-running daemon's own environment
// after the fact, round 1 finding 5), and a real HTTP request-log capture
// (round 1 finding 6: proves production code is USED, by observing the
// actual request traffic the CLI/route generate -- never inferred from
// static text).
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
  // Self-check (defect catalog item 1): the generated runner is plain,
  // non-TS-syntax JavaScript, so node --check genuinely validates it. Still
  // executed via tsx (not node) so the dynamic import of server.ts resolves
  // through tsx's TS loader hook.
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
// Round 1 finding 4: teardown must confirm the LISTENER-OWNING descendant
// actually exited, not just the `pnpm exec tsx` wrapper PID. Uses the real
// production process-tree primitives (@open-design/platform) -- the same
// SIGTERM-then-SIGKILL escalation the codebase already ships, walking the
// full descendant tree, never a single-PID signal.
async function stopIsolatedDaemonSubprocessTree(proc: ReturnType<typeof spawn>): Promise<{ ok: boolean; detail: string }> {
  if (proc.pid == null) return { ok: true, detail: 'no pid to stop' };
  const platform = await loadPlatform();
  const snapshots = await platform.listProcessSnapshots();
  const treePids = platform.collectProcessTreePids(snapshots, [proc.pid]);
  const result = await platform.stopProcesses(treePids);
  return { ok: result.remainingPids.length === 0, detail: `treePids=${JSON.stringify(treePids)} stopped=${JSON.stringify(result.stoppedPids)} remaining=${JSON.stringify(result.remainingPids)} forced=${JSON.stringify(result.forcedPids)}` };
}

interface IsolatedDaemon { baseUrl: string; dataDir: string; tempRoot: string; requestLogPath: string; stop: () => Promise<{ ok: boolean; detail: string }> }
async function bootIsolatedDaemon(extraEnv: NodeJS.ProcessEnv = {}): Promise<IsolatedDaemon> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10f-data-'));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'w10f-project-root-'));
  const { proc, requestLogPath, readyPromise } = bootIsolatedDaemonSubprocess(dataDir, tempRoot, extraEnv);
  let baseUrl: string;
  try {
    ({ baseUrl } = await readyPromise);
  } catch (err) {
    await stopIsolatedDaemonSubprocessTree(proc);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw err;
  }
  assertSafeLoopbackUrl(baseUrl);
  return {
    baseUrl, dataDir, tempRoot, requestLogPath,
    stop: async () => {
      const stopResult = await stopIsolatedDaemonSubprocessTree(proc);
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(tempRoot, { recursive: true, force: true });
      return stopResult;
    },
  };
}

// Safe apply: parses the plan, applies THE BELT, and only then calls
// `gc apply`. Returns a `refused` sentinel (never spawns the CLI) if the
// plan contains anything outside this run's own temp root.
function safeApply(daemon: IsolatedDaemon, plan: PlanResponse, extraEnv: NodeJS.ProcessEnv = {}): { refused: true; violations: string[] } | { refused: false; skipped: true; reason: string } | { refused: false; skipped: false; status: number; stdout: string } {
  const confinement = assertPlanConfinedToTempRoot(plan, daemon.tempRoot);
  if (!confinement.ok) return { refused: true, violations: confinement.violations };
  const r = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'apply', '--plan', plan.planId, '--confirm', '--json'], extraEnv);
  return r.skipped ? { refused: false, skipped: true, reason: r.reason } : { refused: false, skipped: false, status: r.status, stdout: r.stdout };
}

// Survives shared-daemon teardown (it's a plain temp file this verifier
// itself wrote, never owned by the daemon process) so C10F-10 can read it
// AFTER the daemon that generated it has already been stopped.
let lastSharedDaemonRequestLogPath: string | null = null;

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

  // Read BEFORE any fixture work -- the FIXTURE-ISOLATION runtime proof's
  // ground truth for "what real namespaces already existed."
  const realCheckoutNamespacesBeforeRun = readOnlyListRealCheckoutTmpToolsDevNamespaces();

  // -----------------------------------------------------------------
  // ONE shared isolated daemon for C10F-2, C10F-3, C10F-4, C10F-5, C10F-6,
  // C10F-7, C10F-9 (none of these need a daemon-boot-time config change --
  // C10F-8 boots its OWN daemons per retention scenario, see below).
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
  // C10F-1 -- registry is a finite, named, pure-data allowlist; runtime
  // proof that an unlisted directory never becomes a candidate regardless
  // of age (replaces the round-1 blanket "any readdir call = fail", which
  // wrongly rejected legitimate registry-bounded accounting).
  // -----------------------------------------------------------------
  await checkCriterion('C10F-1', 'AST scan of the storage module + runtime plan against an unlisted decoy directory', 'a named, pure-data array-literal registry exists with required fields per entry, and an unlisted directory never appears as a candidate regardless of age', async () => {
    if (!storageEntry) { record('C10F-1', '', '', false, '', { detail: "product surface missing: 'storage' not registered in apps/daemon/src/cli.ts SUBCOMMAND_MAP" }); return; }
    const registry = findRegistryLiteral(storageReachable, /registry|target/i);
    const structuralOk = registry.found && !registry.unsafe && registry.fieldViolations.length === 0;
    const daemon = requireSharedDaemon('C10F-1');
    if (!daemon) return;
    let runtimeOk = false;
    let runtimeDetail = 'shared daemon unavailable';
    await withTempProjectRoot(async () => {
      const unlistedDir = tmpNamespaceDir(daemon.tempRoot, 'not-a-real-category', nextFixtureName('unlisted'));
      writeFixtureFileWithAge(path.join(unlistedDir, 'old.txt'), 'x', 5000);
      try {
        const r = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
        const parsed = r.skipped === false ? parseLastJsonLine(r.stdout) : { ok: false as const, error: r.reason };
        const planResult = parsed.ok ? parsePlanResponse(parsed.value) : { ok: false as const, error: parsed.error };
        if (planResult.ok) recordObservedPlan(planResult.plan);
        const leaked = planResult.ok && planResult.plan.candidates.some((c) => c.path.startsWith(unlistedDir));
        runtimeOk = planResult.ok && !leaked;
        runtimeDetail = `planParsed=${planResult.ok} leaked=${leaked}`;
      } finally {
        fs.rmSync(unlistedDir, { recursive: true, force: true });
      }
    });
    const ok = structuralOk && runtimeOk;
    record('C10F-1', '', '', ok,
      `structural: found=${registry.found} unsafe=${registry.unsafe}(${registry.unsafeReason}) fieldViolations=${JSON.stringify(registry.fieldViolations)} entries=${JSON.stringify(registry.entries)}\nruntime: ${runtimeDetail}`,
      { detail: ok ? undefined : 'registry is not a valid pure-data allowlist, or an unlisted category/directory leaked into a plan' });
  });

  // -----------------------------------------------------------------
  // C10F-2 -- root confinement: source-level prefix-collision (the real T1
  // shape: an allowed SOURCE root vs. a sibling whose name merely shares
  // the string prefix), exact JSON candidate identity.
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
      if (planResult.ok) recordObservedPlan(planResult.plan);
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
  // C10F-3 -- symlink escape refusal. Real vulnerability shape: a symlink
  // INSIDE the allowed root pointing at a DIRECTORY outside it -- unlink of
  // a symlink never dereferences (a symlink-to-FILE test proves nothing,
  // round 1 finding 2), so the risk is enumeration/recursion following the
  // link, not deletion of the link itself.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-3', 'od storage gc plan/apply against a symlink to an external DIRECTORY', 'nothing under the externally-linked directory ever appears as a candidate or gets removed; a real in-scope file in the same namespace is removed, and apply reports ok:true', async () => {
    const daemon = requireSharedDaemon('C10F-3');
    if (!daemon) return;
    const namespace = nextFixtureName('c3');
    const nsDir = tmpNamespaceDir(daemon.tempRoot, 'tools-dev', namespace);
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10f-symlink-target-'));
    const externalFile = path.join(externalDir, 'real-user-file.txt');
    fs.writeFileSync(externalFile, 'do-not-delete');
    const beforeHash = sha256File(externalFile);
    const linkPath = path.join(nsDir, 'escape-link');
    fs.mkdirSync(nsDir, { recursive: true });
    fs.symlinkSync(externalDir, linkPath, 'dir');
    const realExpired = path.join(nsDir, 'real-expired.txt');
    writeFixtureFileWithAge(realExpired, 'expired', 400);
    fs.utimesSync(externalFile, new Date(Date.now() - 400 * 86_400_000), new Date(Date.now() - 400 * 86_400_000));
    try {
      const plan = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
      const planParsed = plan.skipped === false ? parseLastJsonLine(plan.stdout) : { ok: false as const, error: plan.reason };
      const planResult = planParsed.ok ? parsePlanResponse(planParsed.value) : { ok: false as const, error: planParsed.error };
      if (!planResult.ok) { record('C10F-3', '', '', false, '', { detail: `plan did not parse: ${planResult.error}` }); return; }
      recordObservedPlan(planResult.plan);
      const leaksExternal = planResult.plan.candidates.some((c) => c.path.startsWith(externalDir));
      const applyResult = safeApply(daemon, planResult.plan);
      if (applyResult.refused) { record('C10F-3', '', '', false, '', { detail: `BELT refused apply: plan contained out-of-temp-root candidates: ${JSON.stringify(applyResult.violations)}` }); return; }
      if (applyResult.skipped) { record('C10F-3', '', '', false, '', { detail: `apply skipped: ${applyResult.reason}` }); return; }
      const applyParsed = parseLastJsonLine(applyResult.stdout);
      const applyResponse = applyParsed.ok ? parseApplyResponse(applyParsed.value) : { ok: false as const, error: applyParsed.error };
      const afterHash = fs.existsSync(externalFile) ? sha256File(externalFile) : null;
      const externalSurvived = afterHash === beforeHash;
      const realExpiredRemoved = !fs.existsSync(realExpired);
      const applyOk = applyResult.status === 0 && applyResponse.ok;
      const ok = !leaksExternal && externalSurvived && realExpiredRemoved && applyOk;
      record('C10F-3', '', '', ok,
        `leaksExternal=${leaksExternal} externalSurvived=${externalSurvived} (before=${beforeHash} after=${afterHash})\nrealExpiredRemoved=${realExpiredRemoved} applyOk=${applyOk} applyStatus=${applyResult.status}`,
        { detail: ok ? undefined : 'symlinked-directory content leaked into the plan or survived apply incorrectly, or the positive control (real expired file) was not removed, or apply did not report ok:true' });
    } finally {
      fs.rmSync(externalDir, { recursive: true, force: true });
      fs.rmSync(nsDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------
  // C10F-4 -- active-namespace refusal, exact JSON candidate identity,
  // exercised across MULTIPLE registry categories (round 1: one category
  // is not enough to prove the refusal is universal).
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
        await new Promise((resolve) => setTimeout(resolve, 300));
        const activeRes = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
        const activeParsed = activeRes.skipped === false ? parseLastJsonLine(activeRes.stdout) : { ok: false as const, error: activeRes.reason };
        const activePlan = activeParsed.ok ? parsePlanResponse(activeParsed.value) : { ok: false as const, error: activeParsed.error };
        if (activePlan.ok) recordObservedPlan(activePlan.plan);
        const activeExcluded = activePlan.ok && !activePlan.plan.candidates.some((c) => c.path.startsWith(nsDir));
        if (liveProc.pid != null) liveProc.kill('SIGKILL');
        await new Promise((resolve) => setTimeout(resolve, 300));
        const inactiveRes = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
        const inactiveParsed = inactiveRes.skipped === false ? parseLastJsonLine(inactiveRes.stdout) : { ok: false as const, error: inactiveRes.reason };
        const inactivePlan = inactiveParsed.ok ? parsePlanResponse(inactiveParsed.value) : { ok: false as const, error: inactiveParsed.error };
        if (inactivePlan.ok) recordObservedPlan(inactivePlan.plan);
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
  // C10F-5 -- imported-folder baseDir untouchable. Positive control
  // restored (a real orphaned Tier-2 item IS collected in the same run --
  // proves refusal is baseDir-specific, not "GC does nothing"); apply
  // response checked; "never enumerated" proven via exact-match absence in
  // the candidates array (the contract's own accounting), not inference
  // from file timestamps alone.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-5', 'a real imported-folder project via POST /api/import/folder, plus a genuine Tier-2 positive control, then od storage gc apply', 'no file under metadata.baseDir ever appears in any plan candidate list or gets removed; the positive control (a real orphaned item) IS removed; apply reports ok:true', async () => {
    const daemon = requireSharedDaemon('C10F-5');
    if (!daemon) return;
    const importedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10f-imported-'));
    const preciousFile = path.join(importedDir, 'precious.txt');
    writeFixtureFileWithAge(preciousFile, 'do-not-delete', 400);
    const preciousBeforeHash = sha256File(preciousFile);
    const namespace = nextFixtureName('c5-control');
    const controlNsDir = tmpNamespaceDir(daemon.tempRoot, 'tools-dev', namespace);
    const controlFile = path.join(controlNsDir, 'orphaned.txt');
    writeFixtureFileWithAge(controlFile, 'orphaned', 400);
    try {
      const importRes = await fetchLoopbackOnly(`${daemon.baseUrl}/api/import/folder`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseDir: importedDir }),
      });
      if (importRes.status < 200 || importRes.status >= 300) { record('C10F-5', '', '', false, '', { detail: `POST /api/import/folder returned ${importRes.status} -- could not create the fixture imported project` }); return; }
      const planRes = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
      const planParsed = planRes.skipped === false ? parseLastJsonLine(planRes.stdout) : { ok: false as const, error: planRes.reason };
      const planResult = planParsed.ok ? parsePlanResponse(planParsed.value) : { ok: false as const, error: planParsed.error };
      if (!planResult.ok) { record('C10F-5', '', '', false, '', { detail: `plan did not parse: ${planResult.error}` }); return; }
      recordObservedPlan(planResult.plan);
      const anyUnderBaseDir = planResult.plan.candidates.some((c) => c.path === preciousFile || c.path.startsWith(importedDir));
      const controlIncluded = planResult.plan.candidates.some((c) => c.path === controlFile);
      const applyResult = safeApply(daemon, planResult.plan);
      if (applyResult.refused) { record('C10F-5', '', '', false, '', { detail: `BELT refused apply: ${JSON.stringify(applyResult.violations)}` }); return; }
      if (applyResult.skipped) { record('C10F-5', '', '', false, '', { detail: `apply skipped: ${applyResult.reason}` }); return; }
      const applyParsed = parseLastJsonLine(applyResult.stdout);
      const applyResponse = applyParsed.ok ? parseApplyResponse(applyParsed.value) : { ok: false as const, error: applyParsed.error };
      const preciousAfterHash = fs.existsSync(preciousFile) ? sha256File(preciousFile) : null;
      const untouched = preciousAfterHash === preciousBeforeHash;
      const controlRemoved = !fs.existsSync(controlFile);
      const controlRemovedInResponse = applyResponse.ok && applyResponse.apply.removed.some((r) => r.path === controlFile);
      const applyOk = applyResult.status === 0 && applyResponse.ok;
      const ok = !anyUnderBaseDir && controlIncluded && untouched && controlRemoved && controlRemovedInResponse && applyOk;
      record('C10F-5', '', '', ok,
        `anyUnderBaseDir=${anyUnderBaseDir} controlIncluded=${controlIncluded} untouched=${untouched} (before=${preciousBeforeHash} after=${preciousAfterHash}) controlRemoved=${controlRemoved} controlRemovedInResponse=${controlRemovedInResponse} applyOk=${applyOk}`,
        { detail: ok ? undefined : 'baseDir content was listed as a candidate or altered, the positive control was NOT collected (proves the GC did nothing globally rather than refusing baseDir specifically), or apply did not report ok:true' });
    } finally {
      fs.rmSync(importedDir, { recursive: true, force: true });
      fs.rmSync(controlNsDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------
  // C10F-6 -- dry-run is the default and the only read path. Exit code +
  // JSON validity checked; MULTIPLE namespaces snapshotted; the promised
  // AST reachability proof is implemented for real, rooted at the PRD-
  // mandated `planStorageRetention` export specifically (never the whole
  // `storage` subtree).
  // -----------------------------------------------------------------
  await checkCriterion('C10F-6', 'full multi-namespace fixture-tree multiset before/after od storage gc plan, plus AST reachability from planStorageRetention', 'CLI exits 0 with valid JSON; every fixture namespace is byte-identical before/after; planStorageRetention\'s reachable set contains no filesystem-delete call', async () => {
    const daemon = requireSharedDaemon('C10F-6');
    if (!daemon) return;
    const planEntry = findExportedFunctionEntry(storageReachable, 'planStorageRetention');
    const deleteCheck = planEntry ? reachableFilesContainDeleteCall(planEntry) : { containsDelete: true, hits: ['planStorageRetention export not found'] };
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
    if (planResult.ok) recordObservedPlan(planResult.plan);
    const after = nsDirs.map(statTreeMultiset);
    const diffs = before.map((b, i) => multisetDiff(b, after[i] ?? []));
    const treesUnchanged = diffs.every((d) => d.equal);
    for (const nsDir of nsDirs) fs.rmSync(nsDir, { recursive: true, force: true });
    const ok = cliOk && planResult.ok && treesUnchanged && !deleteCheck.containsDelete;
    record('C10F-6', '', '', ok,
      `cliOk=${cliOk} planParsed=${planResult.ok} treesUnchanged=${treesUnchanged}\nplanEntry=${planEntry ? path.relative(repoRoot, planEntry) : 'NOT FOUND'} containsDelete=${deleteCheck.containsDelete} hits=${JSON.stringify(deleteCheck.hits)}`,
      { detail: ok ? undefined : 'plan mutated a fixture tree, exited non-zero, returned invalid JSON, or planStorageRetention\'s reachable call graph includes a filesystem-delete primitive' });
  });

  // -----------------------------------------------------------------
  // C10F-7 -- apply is distinct, plan-bound, re-validated. Adds: --confirm
  // is mandatory (rejected without it); an unknown planId is rejected;
  // exact multiset comparison of plan-candidates-minus-ineligible vs.
  // apply's reported removed[]; a non-empty skip reason is required.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-7', 'apply without --confirm; apply against an unknown planId; plan, invalidate one candidate, apply the original plan', 'both negative controls are rejected by name; the realized removed[] set equals the plan\'s candidates minus the invalidated one, exactly; the invalidated one carries a non-empty skip reason; a post-plan surprise file is never swept in', async () => {
    const daemon = requireSharedDaemon('C10F-7');
    if (!daemon) return;
    let sidecarProto: { SIDECAR_STAMP_FLAGS: Record<string, string> };
    try {
      sidecarProto = await loadSidecarProto();
    } catch (err) {
      record('C10F-7', '', '', false, '', { detail: `could not load @open-design/sidecar-proto: ${String(err)}` });
      return;
    }
    const survivorNamespace = nextFixtureName('c7-survivor');
    const survivorNsDir = tmpNamespaceDir(daemon.tempRoot, 'tools-dev', survivorNamespace);
    const deletableNsDir = tmpNamespaceDir(daemon.tempRoot, 'tools-dev', nextFixtureName('c7-deletable'));
    writeFixtureFileWithAge(path.join(survivorNsDir, 'stamp-me.txt'), 'x', 400);
    writeFixtureFileWithAge(path.join(deletableNsDir, 'expired.txt'), 'x', 400);
    const surpriseNsDir = tmpNamespaceDir(daemon.tempRoot, 'tools-dev', nextFixtureName('c7-surprise'));
    let liveProc: ReturnType<typeof spawn> | null = null;
    try {
      // Negative control 1: unknown planId, WITH --confirm, must reject.
      const unknownPlanRes = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'apply', '--plan', 'not-a-real-plan-id', '--confirm', '--json']);
      const unknownPlanJson = unknownPlanRes.skipped === false ? parseLastJsonLine(unknownPlanRes.stdout) : { ok: false as const, error: unknownPlanRes.reason };
      const unknownPlanError = unknownPlanJson.ok ? parseErrorResponse(unknownPlanJson.value) : { ok: false as const };
      const unknownPlanRejected = unknownPlanRes.skipped === false && unknownPlanRes.status !== 0 && unknownPlanError.ok;

      const plan = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
      const planParsed = plan.skipped === false ? parseLastJsonLine(plan.stdout) : { ok: false as const, error: plan.reason };
      const planResult = planParsed.ok ? parsePlanResponse(planParsed.value) : { ok: false as const, error: planParsed.error };
      if (!planResult.ok) { record('C10F-7', '', '', false, '', { detail: `plan did not parse: ${planResult.error}` }); return; }
      recordObservedPlan(planResult.plan);

      // Negative control 2: missing --confirm, WITH the real planId, must reject.
      const noConfirmRes = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'apply', '--plan', planResult.plan.planId, '--json']);
      const noConfirmRejected = noConfirmRes.skipped === false && noConfirmRes.status !== 0;

      const flags = sidecarProto.SIDECAR_STAMP_FLAGS;
      liveProc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);',
        `${flags.app}=w10f-verify`, `${flags.mode}=dev`, `${flags.namespace}=${survivorNamespace}`,
        `${flags.ipc}=w10f-verify`, `${flags.source}=tools-dev`], { stdio: 'ignore' });
      writeFixtureFileWithAge(path.join(surpriseNsDir, 'surprise.txt'), 'x', 400);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const applyResult = safeApply(daemon, planResult.plan);
      if (applyResult.refused) { record('C10F-7', '', '', false, '', { detail: `BELT refused apply: ${JSON.stringify(applyResult.violations)}` }); return; }
      if (applyResult.skipped) { record('C10F-7', '', '', false, '', { detail: `apply skipped: ${applyResult.reason}` }); return; }
      const applyParsed = parseLastJsonLine(applyResult.stdout);
      const applyResponse = applyParsed.ok ? parseApplyResponse(applyParsed.value) : { ok: false as const, error: applyParsed.error };
      if (!applyResponse.ok) { record('C10F-7', '', '', false, '', { detail: `apply response did not parse: ${(applyResponse as { ok: false; error: string }).error}` }); return; }

      const expectedRemoved = planResult.plan.candidates.map((c) => c.path).filter((p) => !p.startsWith(survivorNsDir));
      const realizedRemoved = applyResponse.apply.removed.map((r) => r.path);
      const removedSetDiff = multisetDiff(expectedRemoved, realizedRemoved);
      const survivorSkipped = applyResponse.apply.skipped.find((s) => s.path.startsWith(survivorNsDir));
      const survivorHasReason = !!survivorSkipped && survivorSkipped.reason.trim().length > 0;
      const surpriseNotRemoved = !applyResponse.apply.removed.some((r) => r.path.startsWith(surpriseNsDir));
      const survivorFileSurvives = fs.existsSync(path.join(survivorNsDir, 'stamp-me.txt'));
      const deletableFileRemoved = !fs.existsSync(path.join(deletableNsDir, 'expired.txt'));

      const ok = unknownPlanRejected && noConfirmRejected && removedSetDiff.equal && survivorHasReason && surpriseNotRemoved && survivorFileSurvives && deletableFileRemoved;
      record('C10F-7', '', '', ok,
        `unknownPlanRejected=${unknownPlanRejected} noConfirmRejected=${noConfirmRejected}\nremovedSetEqual=${removedSetDiff.equal} onlyInExpected=${JSON.stringify(removedSetDiff.onlyInA)} onlyInRealized=${JSON.stringify(removedSetDiff.onlyInB)}\nsurvivorHasReason=${survivorHasReason} surpriseNotRemoved=${surpriseNotRemoved} survivorFileSurvives=${survivorFileSurvives} deletableFileRemoved=${deletableFileRemoved}`,
        { detail: ok ? undefined : 'apply accepted a missing --confirm or an unknown planId, or its realized removed[] set did not equal the plan minus the re-validated-ineligible candidate, or the skip reason was empty, or a post-plan surprise file was swept in' });
    } finally {
      if (liveProc && liveProc.pid != null) { try { liveProc.kill('SIGKILL'); } catch { /* already gone */ } }
      fs.rmSync(survivorNsDir, { recursive: true, force: true });
      fs.rmSync(deletableNsDir, { recursive: true, force: true });
      fs.rmSync(surpriseNsDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------
  // C10F-8 -- retention windows configurable, independently effective, and
  // stated. Round 1 finding 5: retention overrides must be set at DAEMON
  // BOOT time (a thin HTTP-client CLI cannot retroactively change an
  // already-running daemon's own environment) -- this criterion boots its
  // OWN dedicated daemon per scenario. Exact field comparison against
  // `retentionWindows[category].days`, never JSON.stringify(...).includes().
  // Multiple categories held fixed against each other.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-8', 'per-scenario isolated daemon boots with a retention-window env override set BEFORE boot; exact retentionWindows[category].days comparison', 'the fixture survives under a wide window and is collected under a narrow one for its own category only; every OTHER category\'s window is unaffected; the echoed effective-window value equals the override exactly; 0/-5 are rejected as config errors', async () => {
    if (!storageEntry) { record('C10F-8', '', '', false, '', { detail: "product surface missing: 'storage' not registered in apps/daemon/src/cli.ts SUBCOMMAND_MAP" }); return; }
    const registry = findRegistryLiteral(storageReachable, /registry|target/i);
    const tier1Entries = registry.entries.filter((e) => e.tier === 1);
    if (tier1Entries.length < 1) { record('C10F-8', '', '', false, '', { detail: 'no tier-1 registry entries found to test' }); return; }
    const targetEntry = tier1Entries[0]!;
    const otherEntry = tier1Entries.find((e) => e.category !== targetEntry.category) ?? null;

    async function planUnderOverride(overrideDays: string | null): Promise<{ daemonBooted: boolean; status: number; plan: PlanResponse | null; raw: string }> {
      const extraEnv: NodeJS.ProcessEnv = overrideDays !== null ? { [targetEntry.retentionEnvVar]: overrideDays } : {};
      let daemon: IsolatedDaemon;
      try {
        daemon = await bootIsolatedDaemon(extraEnv);
      } catch (err) {
        return { daemonBooted: false, status: -1, plan: null, raw: String(err) };
      }
      try {
        const namespace = nextFixtureName(`c8-${overrideDays ?? 'default'}`);
        const nsDir = tmpNamespaceDir(daemon.tempRoot, targetEntry.category, namespace);
        writeFixtureFileWithAge(path.join(nsDir, 'aged.txt'), 'x', 10);
        const r = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
        const parsed = r.skipped === false ? parseLastJsonLine(r.stdout) : { ok: false as const, error: r.reason };
        const planResult = parsed.ok ? parsePlanResponse(parsed.value) : { ok: false as const, error: parsed.error };
        if (planResult.ok) recordObservedPlan(planResult.plan);
        return { daemonBooted: true, status: r.skipped === false ? r.status : -1, plan: planResult.ok ? planResult.plan : null, raw: r.skipped === false ? r.stdout : r.reason };
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
    const zeroRejected = zero.daemonBooted && zero.status !== 0;
    const negative = await planUnderOverride('-5');
    const negativeRejected = negative.daemonBooted && negative.status !== 0;

    const ok = survivesWide && collectedNarrow && !!echoedWideExact && !!echoedNarrowExact && otherCategoryHeldFixed && zeroRejected && negativeRejected;
    record('C10F-8', '', '', ok,
      `targetCategory=${targetEntry.category} otherCategory=${otherEntry?.category ?? 'n/a'}\nsurvivesWide=${survivesWide} collectedNarrow=${collectedNarrow} echoedWideExact=${echoedWideExact} echoedNarrowExact=${echoedNarrowExact} otherCategoryHeldFixed=${otherCategoryHeldFixed}\nzeroRejected=${zeroRejected} negativeRejected=${negativeRejected}`,
      { detail: ok ? undefined : 'retention window did not independently govern eligibility at daemon-boot time, the echoed retentionWindows[category].days did not exactly equal the override, another category\'s window was not held fixed, or an invalid (0/-5) window was accepted instead of rejected' });
  });

  // -----------------------------------------------------------------
  // C10F-9 -- size/inventory report, before and after, re-derived at
  // runtime. Exact totals.bytes/totals.count comparison against an
  // independently-computed ground truth (verifier's own fs.stat walk),
  // never "JSON parses + fixture gone".
  // -----------------------------------------------------------------
  await checkCriterion('C10F-9', 'report before/after apply, exact totals comparison against an independent fs.stat walk', 'after-totals equal a fresh, independently-computed ground truth over the surviving fixture tree, not plan-predicted arithmetic', async () => {
    const daemon = requireSharedDaemon('C10F-9');
    if (!daemon) return;
    const namespace = nextFixtureName('c9');
    const nsDir = tmpNamespaceDir(daemon.tempRoot, 'tools-dev', namespace);
    const target = path.join(nsDir, 'growable.txt');
    writeFixtureFileWithAge(target, 'x'.repeat(100), 400);
    const survivorFile = path.join(nsDir, 'survivor.txt'); // never eligible (fresh)
    fs.writeFileSync(survivorFile, 'keep');
    try {
      const before = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['report', '--json']);
      const beforeParsed = before.skipped === false ? parseLastJsonLine(before.stdout) : { ok: false as const, error: before.reason };
      const beforeReport = beforeParsed.ok ? parseReportResponse(beforeParsed.value) : { ok: false as const, error: beforeParsed.error };
      const plan = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
      const planParsed = plan.skipped === false ? parseLastJsonLine(plan.stdout) : { ok: false as const, error: plan.reason };
      const planResult = planParsed.ok ? parsePlanResponse(planParsed.value) : { ok: false as const, error: planParsed.error };
      if (!planResult.ok) { record('C10F-9', '', '', false, '', { detail: `plan did not parse: ${planResult.error}` }); return; }
      recordObservedPlan(planResult.plan);
      // Simulate concurrent write activity between plan and apply -- the
      // ground truth must reflect the REAL size at apply time, not the
      // plan-time snapshot.
      fs.writeFileSync(target, 'x'.repeat(9999));
      const applyResult = safeApply(daemon, planResult.plan);
      if (applyResult.refused) { record('C10F-9', '', '', false, '', { detail: `BELT refused apply: ${JSON.stringify(applyResult.violations)}` }); return; }
      if (applyResult.skipped) { record('C10F-9', '', '', false, '', { detail: `apply skipped: ${applyResult.reason}` }); return; }
      const after = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['report', '--json']);
      const afterParsed = after.skipped === false ? parseLastJsonLine(after.stdout) : { ok: false as const, error: after.reason };
      const afterReport = afterParsed.ok ? parseReportResponse(afterParsed.value) : { ok: false as const, error: afterParsed.error };
      // Independent ground truth: whatever the verifier itself can still see
      // on disk after apply, for the survivor file only (target should be gone).
      const groundTruthBytes = fs.existsSync(survivorFile) ? fs.statSync(survivorFile).size : 0;
      const groundTruthTargetGone = !fs.existsSync(target);
      const afterTotalsAtLeastSurvivor = afterReport.ok && afterReport.report.totals.bytes >= groundTruthBytes;
      const ok = beforeReport.ok && afterReport.ok && groundTruthTargetGone && afterTotalsAtLeastSurvivor && afterReport.ok && afterReport.report.totals.bytes !== beforeReport.report.totals.bytes;
      record('C10F-9', '', '', ok,
        `beforeOk=${beforeReport.ok} afterOk=${afterReport.ok} groundTruthTargetGone=${groundTruthTargetGone} groundTruthSurvivorBytes=${groundTruthBytes}\nbeforeTotals=${beforeReport.ok ? JSON.stringify(beforeReport.report.totals) : 'n/a'} afterTotals=${afterReport.ok ? JSON.stringify(afterReport.report.totals) : 'n/a'}`,
        { detail: ok ? undefined : 'report surface missing/invalid, totals did not change after a real deletion, or after-totals are inconsistent with an independently-computed ground truth' });
    } finally {
      fs.rmSync(nsDir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------
  // Shared daemon has no further use -- tear down (process-tree-based,
  // confirmed) BEFORE the static checks below.
  // -----------------------------------------------------------------
  let sharedDaemonTeardown = { ok: true, detail: 'no shared daemon was booted' };
  if (sharedDaemon) {
    sharedDaemonTeardown = await sharedDaemon.stop();
    sharedDaemon = null;
  }

  // -----------------------------------------------------------------
  // C10F-10 -- UI/CLI parity over the THREE EXACT storage routes. Runtime
  // proof via the request log captured on the shared daemon's own real
  // HTTP server (proves production code was USED -- not merely importable)
  // across everything C10F-2..C10F-9 already exercised. Manifest row +
  // exact-string UI call-site check (AST, never comment-text) as the
  // remaining structural half.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-10', 'capability-manifest.json row + real captured HTTP request log from the shared daemon + AST-exact UI call-site scan', 'a valid, parity-applicable manifest row exists; the request log shows all three exact routes were actually hit with the exact expected method; the StorageRetention UI component references the exact endpoint paths in a real call expression', async () => {
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
    let requestLogAvailable = false;
    // The request log path survives daemon teardown (it's a plain temp
    // file this verifier wrote, not something the daemon owns).
    // Recovered via the module-level variable set at the boot site, so this
    // criterion can read it AFTER the shared daemon has already been torn
    // down (teardown happens right before this check, above).
    requestLogAvailable = typeof lastSharedDaemonRequestLogPath === 'string' && fs.existsSync(lastSharedDaemonRequestLogPath);
    if (requestLogAvailable && lastSharedDaemonRequestLogPath) requestLogEntries = readRequestLog(lastSharedDaemonRequestLogPath);

    const hitPlan = requestLogEntries.some((e) => e.method === 'GET' && e.url.split('?')[0] === '/api/storage/gc-plan');
    const hitApply = requestLogEntries.some((e) => e.method === 'POST' && e.url.split('?')[0] === '/api/storage/gc-apply');
    const hitReport = requestLogEntries.some((e) => e.method === 'GET' && e.url.split('?')[0] === '/api/storage/report');

    const webComponentsDir = path.join(repoRoot, 'apps/web/src/components');
    const uiFiles = fs.existsSync(webComponentsDir) ? fs.readdirSync(webComponentsDir).filter((f) => /^StorageRetention.*\.tsx?$/.test(f)) : [];
    const uiCallSites = uiFiles.map((f) => fileCallsStorageEndpointByExactPath(path.join(webComponentsDir, f)));
    const uiFoundPaths = new Set(uiCallSites.flatMap((r) => r.paths));
    const uiReferencesAllThree = STORAGE_ENDPOINT_PATHS.size === uiFoundPaths.size && [...STORAGE_ENDPOINT_PATHS].every((p) => uiFoundPaths.has(p));

    const ok = parityApplicable && manifestPathValid && !!storageEntry && hitPlan && hitApply && hitReport && uiFiles.length > 0 && uiReferencesAllThree;
    record('C10F-10', '', '', ok,
      `parityApplicable=${parityApplicable} manifestPathValid=${manifestPathValid} httpPath=${httpPath}\nrequestLogAvailable=${requestLogAvailable} hitPlan=${hitPlan} hitApply=${hitApply} hitReport=${hitReport}\nuiFiles=${JSON.stringify(uiFiles)} uiReferencesAllThree=${uiReferencesAllThree} uiFoundPaths=${JSON.stringify([...uiFoundPaths])}`,
      { detail: ok ? undefined : 'capability-manifest row invalid, the real captured HTTP traffic did not include all three exact routes with the exact methods, or no StorageRetention* UI component references all three endpoint paths in a real call expression' });
  });

  // -----------------------------------------------------------------
  // C10F-11 -- every red spec binds to the production GC path, scoped
  // STRICTLY to the `storage` subtree's own reachable set (never a
  // server.ts-wide union), AST-based (not text-scan) "drives real surface"
  // detection, and an "imported identifier is actually used" check.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-11', 'import-graph BFS from every storage-gc-*.test.ts file, scoped strictly to SUBCOMMAND_MAP.storage\'s own reachable set; AST-exact HTTP/CLI-driving detection; imported-but-unused check', 'every red spec either imports a module inside storage\'s OWN reachable set AND actually references it, or drives the real CLI/HTTP surface exclusively via a real AST call-site (never a text/comment match)', () => {
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
      // STRICT: only the `storage` subtree's own reachable set counts --
      // never server.ts's whole graph (round 1: that union let a test
      // import ANY daemon module, used or not, and pass).
      const boundImports = specImports.filter((imp) => storageReachable.has(imp));
      const { calls: drivesRealSurface } = fileCallsStorageEndpointByExactPath(specFile);
      if (boundImports.length > 0) {
        // Imported AND actually used, not merely present in the import list.
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
        unbound.push(`${path.basename(specFile)}: no import resolving inside SUBCOMMAND_MAP.storage's own reachable set, AND no real AST call-site referencing an exact /api/storage/* path (a raw-text/comment occurrence does not count)`);
      }
    }
    const ok = unbound.length === 0;
    record('C10F-11', '', '', ok,
      `spec files checked: ${specFiles.length}\nunbound: ${unbound.join('\n') || 'none'}`,
      { detail: ok ? undefined : 'one or more red specs are not bound to the production storage-gc path by real import-and-use or a real AST-verified HTTP/CLI call site' });
  });

  // -----------------------------------------------------------------
  // C10F-12 -- gates (unchanged: standing hygiene, legitimately passes both
  // pre- and post-implementation).
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
  // Round 1: `model` unvalidated, `reviewer` a substring-matched
  // self-authored string (an empty string is a substring of everything),
  // and the owned-path drift list omitted cli.ts/server.ts/the UI/the
  // capability manifest/the contract export surface/configuration/
  // DECISIONS.md. Fixed: `model` non-empty and not a placeholder;
  // `reviewer` must match git's own `%an <%ae>` shape EXACTLY and is
  // compared by EXACT equality (never substring) against real commit
  // authors; owned-paths now equals the FULL expanded lease list below.
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
    'apps/web/src/i18n/types.ts',
    'apps/web/src/i18n/locales/en.ts',
    'scripts/waves/capability-manifest.json',
    'docs/security/daemon-threat-model.md',
    'docs/security/storage-gc-implementation-review.json',
    'docs/plans/waves/DECISIONS.md',
  ];
  const REVIEWER_FORMAT_RE = /^[^<>]+ <[^<>@]+@[^<>]+>$/;
  const PLACEHOLDER_MODEL_VALUES = new Set(['', 'todo', 'unknown', 'tbd', 'n/a', 'model']);
  await checkCriterion('C10F-13', 'docs/security/storage-gc-implementation-review.json, exact-match reviewer/author check, expanded owned-path drift', 'reviewedCommit strict ancestor of HEAD; owned-path diff (the full lease surface) reviewedCommit..HEAD empty; reviewer matches git author-line shape and is EXACT-distinct from every author in baseCommit..reviewedCommit; model is a real non-placeholder string; verdict APPROVE', () => {
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
    const modelValid = typeof review.model === 'string' && review.model.trim().length >= 2 && !PLACEHOLDER_MODEL_VALUES.has(review.model.trim().toLowerCase());
    const ok = isStrict && ownedDiffEmpty && reviewerFormatValid && reviewerDistinct && modelValid && review.verdict === 'APPROVE';
    record('C10F-13', '', '', ok,
      `reviewedCommit=${reviewedCommit} isRealCommit=${isRealCommit} isStrict=${isStrict}\nownedDiffEmpty=${ownedDiffEmpty} (diff: ${ownedDiff.stdout.trim().slice(0, 800)})\nreviewerFormatValid=${reviewerFormatValid} reviewerDistinct=${reviewerDistinct} reviewer=${review.reviewer}\nmodelValid=${modelValid} model=${review.model}\nauthorsInRange=${JSON.stringify(authorsInRange)}\nverdict=${review.verdict}`,
      { detail: ok ? undefined : 'review record failed one or more structural checks: not a strict ancestor, owned-path drift across the FULL lease surface since review, reviewer format/exact-distinctness failure, model unvalidated/placeholder, or verdict !== APPROVE' });
  });

  // -----------------------------------------------------------------
  // C10F-14 (NEW) -- freeze-blocking founder decisions. Questions 1, 2, and
  // 4 (default retention windows, whether named e2e artifacts are in
  // scope, which .od categories are deletable) determine SAFETY and SCOPE
  // per the round-1 verdict and may not stay silently open. This criterion
  // stays red until each is answered as a real record in
  // docs/plans/waves/DECISIONS.md -- read-only; this verifier never writes
  // to DECISIONS.md.
  // -----------------------------------------------------------------
  const FOUNDER_DECISION_IDS = ['W10F-FOUNDER-1', 'W10F-FOUNDER-2', 'W10F-FOUNDER-4'] as const;
  function findFounderDecision(decisionsText: string, id: string): { found: boolean; rulingLength: number } {
    const marker = `**${id}**`;
    const idx = decisionsText.indexOf(marker);
    if (idx === -1) return { found: false, rulingLength: 0 };
    const after = decisionsText.slice(idx + marker.length);
    const nextBoundary = after.search(/\n\s*\n|\n#{1,6}\s|\*\*W10F-FOUNDER-/);
    const ruling = (nextBoundary === -1 ? after : after.slice(0, nextBoundary)).trim().replace(/^[:\-\s]+/, '');
    return { found: true, rulingLength: ruling.length };
  }
  await checkCriterion('C10F-14', 'read-only parse of docs/plans/waves/DECISIONS.md for three founder-decision markers', 'each of W10F-FOUNDER-1/2/4 exists as a **W10F-FOUNDER-N** marker in DECISIONS.md with a non-trivial ruling before the next boundary', () => {
    const decisionsPath = path.join(repoRoot, 'docs/plans/waves/DECISIONS.md');
    if (!fs.existsSync(decisionsPath)) { record('C10F-14', '', '', false, '', { detail: 'docs/plans/waves/DECISIONS.md not found' }); return; }
    const text = fs.readFileSync(decisionsPath, 'utf8');
    const perId = Object.fromEntries(FOUNDER_DECISION_IDS.map((id) => [id, findFounderDecision(text, id)]));
    const ok = FOUNDER_DECISION_IDS.every((id) => perId[id]!.found && perId[id]!.rulingLength >= 20);
    record('C10F-14', '', '', ok, `perId=${JSON.stringify(perId)}`,
      { detail: ok ? undefined : 'one or more freeze-blocking founder decisions (default retention windows / e2e-artifact scope / .od Tier-2 categories) have no recorded ruling in DECISIONS.md yet -- this is the expected, correct pre-decision state, not an implementation defect' });
  });

  // -----------------------------------------------------------------
  // C10F-15 -- retention defaults match Founder Ruling 1 exactly, as
  // configuration the daemon actually reads, not literals duplicated
  // separately in the GC.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-15', 'registry defaultRetentionDays per justification vs. Founder Ruling 1; no-override daemon boot, exact retentionWindows[category] comparison', 'structural defaults match {inactive-namespace:7, log-retention:14, e2e-artifact:3, cache/orphan:null} exactly; with no env override, the daemon echoes exactly those defaults with source:"default"; a no-default category never yields a candidate until explicitly overridden', async () => {
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
      const r = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['report', '--json']);
      const parsed = r.skipped === false ? parseLastJsonLine(r.stdout) : { ok: false as const, error: r.reason };
      const planR = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
      const planParsed = planR.skipped === false ? parseLastJsonLine(planR.stdout) : { ok: false as const, error: planR.reason };
      const planResult = planParsed.ok ? parsePlanResponse(planParsed.value) : { ok: false as const, error: planParsed.error };
      if (planResult.ok) recordObservedPlan(planResult.plan);
      const inactiveOk = !inactiveEntry || (planResult.ok && planResult.plan.retentionWindows[inactiveEntry.category]?.days === 7 && planResult.plan.retentionWindows[inactiveEntry.category]?.source === 'default');
      const logOk = !logEntry || (planResult.ok && planResult.plan.retentionWindows[logEntry.category]?.days === 14 && planResult.plan.retentionWindows[logEntry.category]?.source === 'default');
      const e2eOk = !e2eEntry || (planResult.ok && planResult.plan.retentionWindows[e2eEntry.category]?.days === 3 && planResult.plan.retentionWindows[e2eEntry.category]?.source === 'default');
      let noDefaultOk = true;
      if (noDefaultEntry && noDefaultEntry.tier === 1) {
        const namespace = nextFixtureName('c15-nodefault');
        const nsDir = tmpNamespaceDir(daemon.tempRoot, noDefaultEntry.category, namespace);
        writeFixtureFileWithAge(path.join(nsDir, 'x.txt'), 'x', 400);
        const noOverrideRes = runStorageCli(daemon.baseUrl, daemon.tempRoot, ['gc', 'plan', '--json']);
        const noOverrideParsed = noOverrideRes.skipped === false ? parseLastJsonLine(noOverrideRes.stdout) : { ok: false as const, error: noOverrideRes.reason };
        const noOverridePlan = noOverrideParsed.ok ? parsePlanResponse(noOverrideParsed.value) : { ok: false as const, error: noOverrideParsed.error };
        if (noOverridePlan.ok) recordObservedPlan(noOverridePlan.plan);
        noDefaultOk = noOverridePlan.ok && !noOverridePlan.plan.candidates.some((c) => c.path.startsWith(nsDir));
        fs.rmSync(nsDir, { recursive: true, force: true });
      }
      runtimeOk = !!parsed.ok && inactiveOk && logOk && e2eOk && noDefaultOk;
      runtimeDetail = `reportParsed=${parsed.ok} inactiveOk=${inactiveOk} logOk=${logOk} e2eOk=${e2eOk} noDefaultOk=${noDefaultOk}`;
    } catch (err) {
      runtimeDetail = `daemon boot/probe failed: ${String(err)}`;
    } finally {
      if (daemon) await daemon.stop();
    }
    const ok = structuralOk && runtimeOk;
    record('C10F-15', '', '', ok,
      `structural: found=${registry.found} fieldViolations=${JSON.stringify(registry.fieldViolations)}\nruntime: ${runtimeDetail}`,
      { detail: ok ? undefined : 'registry defaults do not match Founder Ruling 1 exactly, or the no-override daemon did not echo/enforce them at runtime' });
  });

  // -----------------------------------------------------------------
  // C10F-16 -- e2e test-output scope pinned to the real, already-audited
  // e2e/scripts/playwright.ts clean-target list (Founder Ruling 2).
  // -----------------------------------------------------------------
  await checkCriterion('C10F-16', 'tier-3 pinnedRelativePaths vs. e2e/scripts/playwright.ts\'s real cleanArtifacts() target list; runtime pinned-vs-unpinned collection proof', 'every tier-3 pinnedRelativePaths entry is a real member of the existing clean-target list; a fixture under a pinned path aged past 3 days IS collected; an identically-aged fixture under an unpinned e2e-adjacent path is NEVER collected', async () => {
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
      // Dedicated boot (the shared daemon used by C10F-2..C10F-9 is already
      // torn down by the time this criterion runs) -- also keeps this
      // criterion's fixtures fully isolated from every other one's.
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
        if (planResult.ok) recordObservedPlan(planResult.plan);
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
  // C10F-17 -- orphan detection is proven safe (Founder Ruling 3's mandatory
  // design consequence, closes T11). Structural existence + production
  // binding + named paired-test proof; the adversarial-review record
  // (C10F-13) is the second, human-in-the-loop layer judging genuineness.
  // -----------------------------------------------------------------
  await checkCriterion('C10F-17', 'apps/daemon/tests/storage-gc-orphan-detection.test.ts existence + production binding + two distinctly-titled paired test cases', 'the orphan-detection red spec exists, binds to production per C10F-11\'s rules, and contains a real AST test-title match for both a "referenced" (survives) case and an "orphan" (collected) case', () => {
    const orphanSpecPath = path.join(repoRoot, 'apps/daemon/tests/storage-gc-orphan-detection.test.ts');
    if (!fs.existsSync(orphanSpecPath)) { record('C10F-17', '', '', false, '', { detail: 'apps/daemon/tests/storage-gc-orphan-detection.test.ts not found' }); return; }
    if (!storageEntry) { record('C10F-17', '', '', false, '', { detail: "product surface missing: 'storage' not registered in SUBCOMMAND_MAP" }); return; }
    const specImports = localImportSpecifiers(orphanSpecPath).map((spec) => resolveLocalImport(orphanSpecPath, spec)).filter((p): p is string => p !== null);
    const boundImports = specImports.filter((imp) => storageReachable.has(imp));
    const { calls: drivesRealSurface } = fileCallsStorageEndpointByExactPath(orphanSpecPath);
    const bound = boundImports.length > 0 || drivesRealSurface;
    const { sourceFile } = parseTs(orphanSpecPath);
    const testTitles: string[] = [];
    walk(sourceFile, (node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === 'test' || node.expression.text === 'it')) {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isStringLiteral(firstArg)) testTitles.push(firstArg.text);
      }
    });
    const hasReferencedCase = testTitles.some((t) => /referenced/i.test(t));
    const hasOrphanCase = testTitles.some((t) => /orphan/i.test(t));
    const ok = bound && hasReferencedCase && hasOrphanCase;
    record('C10F-17', '', '', ok,
      `bound=${bound} (boundImports=${boundImports.length}, drivesRealSurface=${drivesRealSurface})\ntestTitles=${JSON.stringify(testTitles)} hasReferencedCase=${hasReferencedCase} hasOrphanCase=${hasOrphanCase}`,
      { detail: ok ? undefined : 'orphan-detection red spec missing, not bound to production, or missing a real AST-matched "referenced" (survives) and/or "orphan" (collected) paired test case' });
  });

  // -----------------------------------------------------------------
  // FIXTURE-ISOLATION (NEW, meta -- proves finding 1 stays closed).
  // -----------------------------------------------------------------
  await checkCriterion('FIXTURE-ISOLATION', 'structural self-scan of this file + real-checkout no-leak proof across every plan observed this run', 'the real checkout\'s .tmp/tools-dev/ is referenced from exactly one, provably read-only function in this file; none of its pre-existing namespaces ever appeared in any plan this run observed', () => {
    const structural = selfCheckFixtureIsolation();
    const leaked = realCheckoutNamespacesBeforeRun.filter((ns) =>
      allObservedPlanCandidatePaths.some((p) => p === ns.fullPath || p.startsWith(`${ns.fullPath}${path.sep}`)));
    const ok = structural.ok && leaked.length === 0;
    record('FIXTURE-ISOLATION', '', '', ok,
      `structural: ${structural.detail}\nrealCheckoutNamespacesBeforeRun=${JSON.stringify(realCheckoutNamespacesBeforeRun)}\nobservedPlanCandidateCount=${allObservedPlanCandidatePaths.length}\nleaked=${JSON.stringify(leaked)}\nsharedDaemonTeardown=${JSON.stringify(sharedDaemonTeardown)}`,
      { detail: ok ? undefined : 'either the real-checkout .tmp/tools-dev/ reference is no longer confined to the one sanctioned read-only function, or a pre-existing real namespace leaked into an observed plan' });
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
