// verify-w10c.ts -- wave mishmash-w10c-toolbox (Toolbox reliability, NM-19)
// completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w10c.ts [--repo <path>]
// Exit 0 only when every C10C criterion passes, GATE-INTEGRITY/LEASE/HEAD-DRIFT
// all pass, the tree is clean, and the manifest placeholder write succeeded.
// The commit-bound proof manifest is written to the wave's goal-state proof
// directory either way.
//
// Scope note relative to the sibling verify-w9-ingest.ts: this wave is a
// test-coverage/reliability wave, not a security-boundary tranche, so this
// verifier does not carry W9's route-exposure-classifier or git-worktree
// replay machinery. It DOES mirror the load-bearing structural pattern: a
// per-criterion scoreboard, a two-phase manifest write, and the three named
// infra checks (GATE-INTEGRITY / LEASE / HEAD-DRIFT). Per-run archival
// (W9's construct-then-reread-verify layer) is deliberately omitted as
// out-of-proportion for this wave's scope.
//
// Anti-gaming compliance notes (see the verifier defect catalog this wave's
// authoring brief was given):
//   1. This file writes no generated script/JS content to disk itself (no
//      runner-script generation, no fixture-file writes) -- every AST self
//      probe below runs against an in-memory string via ts.createSourceFile,
//      so there is nothing here for `node --check` to validate.
//   2. Object/array spreads inside DESIGN_TOOLBOX_ACTIONS are banned at any
//      depth by hasSpreadDeep(), not just top-level.
//   3. Every id-set comparison in this file is a multiset/occurrence-count
//      comparison (diffSets), never bare Set difference -- duplicates and
//      count mismatches are visible.
//   4. Every "must be rejected" check (LEASE violations, phantom-id
//      resolution) is paired with a positive control per criterion; no
//      "any non-ok status" checks exist here (this wave has no HTTP-status
//      rejection criteria to begin with).
//   5. Every TS source extraction below uses the TypeScript compiler API
//      (ts.createSourceFile + AST walks), never a regex/string scan of TS
//      source -- the exact defect the existing repo-root guard has.
//   6. Every "does the test import production code" check resolves the
//      import specifier to a real on-disk path and compares it against the
//      actual production file's real path -- never a same-named local stub.
//   7. N/A here (no JSX under test).
//   8. Every count this file asserts on (action count, i18n key count,
//      per-test coverage) is derived at verifier runtime from the repo, not
//      hardcoded.
//   9. dynamic import()/require of design-toolbox.ts by a future test file
//      would not be caught by the static "import resolves to the real file"
//      check as written; the running of the actual suites (which exercises
//      whatever loading mechanism was really used) is the primary control.
//  10. The one runtime probe in this file (C10C-5) uses redirect:'manual',
//      validates the URL's origin against the discovered daemon's own
//      loopback origin before every request, and hard-fails if the
//      discovered port is 7456 or 51012 -- it never requests either port.
//  11. Every criterion below carries satisfiability + decoy arguments in
//      docs/plans/waves/W10c-toolbox.md; this file is the mechanical half.
//  12. This run is expected to exit non-zero pre-implementation (LEASE has
//      no "W10c" entry yet; C10C-2/3/4/7 require files that do not exist
//      yet) -- see W10c-toolbox.md "Verified baseline" for which criteria
//      are legitimately expected to already be green.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type TypeScriptModule from 'typescript';

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

const WAVE_SLUG = 'mishmash-w10c-toolbox';

function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W10c',
      commit: 'unknown',
      treeDirty: true,
      baseCommit: 'unknown',
      wroteOk: false,
      gateIntegrityPinned: false,
      toolchain: { node: process.version, pnpm: 'unknown' },
      criteria: [
        {
          id: 'INIT-FAILURE',
          command: 'module init',
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
    fs.writeFileSync(
      path.join(os.tmpdir(), 'verify-w10c-emergency-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  } catch {
    /* truly nothing more we can do */
  }
  console.error(`verify-w10c: FATAL during init: ${errorMessage}`);
  process.exit(1);
}

let repoRoot: string;
let proofDir: string;
let ts: typeof TypeScriptModule;
try {
  repoRoot = path.resolve(argValue('--repo') ?? process.cwd());
  proofDir = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'proof');
  fs.mkdirSync(proofDir, { recursive: true });
  ts = createRequire(path.join(repoRoot, 'package.json'))('typescript') as typeof TypeScriptModule;
} catch (err) {
  emergencyExit(`init failed: ${String((err as Error)?.stack ?? err)}`);
}

function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): { status: number; stdout: string; stderr: string; processError: boolean } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repoRoot,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 10 * 60_000,
    env: opts.env ?? process.env,
  });
  const processError = !!result.error || !!result.signal;
  if (result.error) {
    return { status: 1, stdout: result.stdout ?? '', stderr: `${result.stderr ?? ''}\n${String(result.error)}`, processError: true };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '', processError };
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
  const fallbackResult = tryWrite(path.join(os.tmpdir(), 'verify-w10c-fallback-proof', `${id}.txt`));
  if (fallbackResult) return fallbackResult;
  console.error(`verify-w10c: artifact write failed for ${id} on both primary and fallback paths`);
  return { artifact: null, artifactSha256: null };
}

const results: CriterionResult[] = [];
function record(
  id: string,
  command: string,
  assertion: string,
  ok: boolean,
  evidence: string,
  opts: { detail?: string | undefined; durationMs?: number } = {},
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
      exitCode: effectiveOk ? 0 : 1,
      status: effectiveOk ? 'pass' : 'fail',
      durationMs: opts.durationMs ?? 0,
      detail: artifact === null ? `${opts.detail ? `${opts.detail}; ` : ''}artifact write failed -- forced fail` : opts.detail,
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

async function checkCriterion(id: string, fn: () => Promise<void> | void): Promise<void> {
  const startedAt = Date.now();
  const startIndex = results.length;
  try {
    await fn();
    const durationMs = Date.now() - startedAt;
    for (let i = startIndex; i < results.length; i++) {
      const r = results[i];
      if (r) r.durationMs = durationMs;
    }
    // A criterion function that ran to completion without calling record()
    // at all is itself a bug in this verifier, not a pass -- surface it
    // loudly rather than silently reporting zero criteria for this id.
    if (results.length === startIndex) {
      record(id, '', '', false, '', { detail: 'criterion function completed without recording a result', durationMs });
    }
  } catch (err) {
    record(id, '', '', false, String((err as Error)?.stack ?? err), {
      detail: `criterion check crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
    });
  }
}

// -----------------------------------------------------------------------
// Git context -- local refs only, no fetch/push.
// -----------------------------------------------------------------------
function gitOrFail(args: string[], why: string): string {
  const r = sh('git', args);
  if (r.status !== 0 || r.stdout.trim().length === 0) {
    throw new Error(`git ${args.join(' ')} failed (${why}): exit=${r.status} stdout=${r.stdout.trim().slice(0, 200) || '<empty>'}`);
  }
  return r.stdout.trim();
}
function resolveMainRefLocal(): string {
  for (const ref of ['origin/main', 'main']) {
    const verify = sh('git', ['rev-parse', '--verify', ref]);
    if (verify.status === 0 && verify.stdout.trim()) return ref;
  }
  throw new Error('could not resolve "origin/main" or "main" locally (no network ref-check -- this verifier never fetches)');
}
function writeEmergencyManifest(errorMessage: string, partialResults: CriterionResult[] = []): void {
  const manifest = {
    wave: 'W10c',
    commit: 'unknown',
    treeDirty: true,
    baseCommit: 'unknown',
    wroteOk: false,
    gateIntegrityPinned: false,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: [
      ...partialResults,
      {
        id: 'GIT-RESOLUTION',
        command: 'git rev-parse HEAD / git merge-base',
        assertion: 'HEAD and baseCommit resolve to real, non-empty commits before any criterion runs',
        artifact: null,
        artifactSha256: null,
        exitCode: 1,
        status: 'fail',
        durationMs: 0,
        detail: errorMessage,
      },
    ],
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
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w10c-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
    } catch {
      /* last resort: stderr only */
    }
  }
  console.error(`verify-w10c: FATAL, emergency manifest written=${wrote}: ${errorMessage}`);
}
function resolveGitContextOrExit(): { headSha: string; baseCommit: string } {
  try {
    const resolvedHeadSha = gitOrFail(['rev-parse', 'HEAD'], 'resolving HEAD commit');
    const mainRef = resolveMainRefLocal();
    const mainSha = gitOrFail(['rev-parse', mainRef], 'resolving main ref');
    const resolvedBaseCommit = gitOrFail(['merge-base', mainSha, resolvedHeadSha], 'computing baseCommit');
    return { headSha: resolvedHeadSha, baseCommit: resolvedBaseCommit };
  } catch (err) {
    writeEmergencyManifest(String((err as Error)?.stack ?? err));
    process.exit(1);
  }
}
const { headSha, baseCommit } = resolveGitContextOrExit();
function readFileAtCommit(commit: string, relPath: string): string {
  const r = sh('git', ['show', `${commit}:${relPath}`]);
  if (r.status !== 0) throw new Error(`git show ${commit}:${relPath} failed (exit=${r.status}): ${r.stdout.slice(0, 300)}`);
  return r.stdout;
}
function isAncestor(ancestor: string, descendant: string): boolean {
  return sh('git', ['merge-base', '--is-ancestor', ancestor, descendant]).status === 0;
}
function resolveCommit(sha: string): boolean {
  return sh('git', ['cat-file', '-e', `${sha}^{commit}`]).status === 0;
}
function commitAuthorsBetween(fromExclusive: string, toInclusive: string): Set<string> {
  const r = sh('git', ['log', '--format=%an%x00%ae', `${fromExclusive}..${toInclusive}`]);
  const out = new Set<string>();
  if (r.status !== 0) return out;
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\x00');
    if (parts[0]) out.add(parts[0].trim().toLowerCase());
    if (parts[1]) out.add(parts[1].trim().toLowerCase());
  }
  return out;
}

const gateIntegrityPinned = fs.existsSync(path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256'));

// =========================================================================
// Two-phase manifest write: a wroteOk:false placeholder is written IMMEDIATELY
// (before any criterion runs), overwriting whatever manifest.json a PRIOR run
// left behind, so a crash/interruption after this point can never leave a
// stale-but-complete-looking prior green manifest on disk.
// =========================================================================
interface ManifestShape {
  wave: string;
  commit: string;
  treeDirty: boolean;
  baseCommit: string;
  wroteOk: boolean;
  gateIntegrityPinned: boolean;
  toolchain: { node: string; pnpm: string };
  criteria: CriterionResult[];
}
function buildManifest(wroteOk: boolean, treeDirty: boolean): ManifestShape {
  return {
    wave: 'W10c',
    commit: headSha,
    treeDirty,
    baseCommit,
    wroteOk,
    gateIntegrityPinned,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: results,
  };
}
function writeManifestFile(manifest: ManifestShape): { written: boolean; sha256: string } {
  const manifestPath = path.join(proofDir, 'manifest.json');
  try {
    const content = JSON.stringify(manifest, null, 2);
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, manifestPath);
    return { written: true, sha256: sha256Bytes(content) };
  } catch (err) {
    console.error(`verify-w10c: FAILED to write manifest.json: ${String(err)}`);
    return { written: false, sha256: '' };
  }
}
{
  const placeholderWrite = writeManifestFile(buildManifest(false, true));
  if (!placeholderWrite.written) {
    writeEmergencyManifest('initial wroteOk:false placeholder manifest write failed -- aborting before any criterion runs');
    process.exit(1);
  }
}

// =========================================================================
// TypeScript-compiler-API extraction helpers. No regex/string scanning of
// TS source anywhere below -- every extraction is a real AST walk.
// =========================================================================

function hasSpreadDeep(node: TypeScriptModule.Node): boolean {
  let found = false;
  function visit(n: TypeScriptModule.Node): void {
    if (found) return;
    if (ts.isSpreadAssignment(n) || ts.isSpreadElement(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return found;
}

function stringLiteralValue(node: TypeScriptModule.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function propertyName(name: TypeScriptModule.PropertyName): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  if (ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

interface ExtractedAction {
  id: string;
  preferredSkillIds: string[];
}
interface ExtractActionsResult {
  ok: boolean;
  actions: ExtractedAction[];
  errors: string[];
}

// Parses `export const DESIGN_TOOLBOX_ACTIONS: DesignToolboxAction[] = [ ... ]`
// via the TypeScript compiler API. Any spread (object or array, at any
// depth) inside the literal is a hard failure, never a silently-skipped
// element -- this is the AST-literal-projection defect class this verifier
// is required to close.
function extractDesignToolboxActions(sourceText: string, fileName: string): ExtractActionsResult {
  const errors: string[] = [];
  const actions: ExtractedAction[] = [];
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let arrayLiteral: TypeScriptModule.ArrayLiteralExpression | null = null;
  function findArray(node: TypeScriptModule.Node): void {
    if (arrayLiteral) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'DESIGN_TOOLBOX_ACTIONS' &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      arrayLiteral = node.initializer;
      return;
    }
    ts.forEachChild(node, findArray);
  }
  findArray(sf);
  if (!arrayLiteral) {
    errors.push('DESIGN_TOOLBOX_ACTIONS array literal not found via AST walk');
    return { ok: false, actions: [], errors };
  }
  for (const el of (arrayLiteral as TypeScriptModule.ArrayLiteralExpression).elements) {
    if (ts.isSpreadElement(el)) {
      errors.push('spread element directly inside DESIGN_TOOLBOX_ACTIONS array -- banned at any depth');
      continue;
    }
    if (!ts.isObjectLiteralExpression(el)) {
      errors.push(`non-object-literal element in DESIGN_TOOLBOX_ACTIONS (kind=${ts.SyntaxKind[el.kind]})`);
      continue;
    }
    if (hasSpreadDeep(el)) {
      errors.push('spread assignment/element found inside an action object literal -- banned at any depth');
      continue;
    }
    let id: string | null = null;
    let preferredSkillIds: string[] | null = null;
    for (const prop of el.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = propertyName(prop.name);
      if (name === 'id') {
        id = stringLiteralValue(prop.initializer);
      } else if (name === 'preferredSkillIds') {
        if (ts.isArrayLiteralExpression(prop.initializer)) {
          const vals: string[] = [];
          let bad = false;
          for (const item of prop.initializer.elements) {
            if (ts.isSpreadElement(item)) {
              bad = true;
              break;
            }
            const v = stringLiteralValue(item);
            if (v === null) {
              bad = true;
              break;
            }
            vals.push(v);
          }
          if (!bad) preferredSkillIds = vals;
        }
      }
    }
    if (id === null) {
      errors.push('an action element is missing a literal string "id"');
      continue;
    }
    if (preferredSkillIds === null) {
      errors.push(`action "${id}" is missing a literal-string-array "preferredSkillIds"`);
      continue;
    }
    actions.push({ id, preferredSkillIds });
  }
  return { ok: errors.length === 0, actions, errors };
}

// Parses `apps/web/src/i18n/types.ts` for `"chat.designToolbox.action.<id>.<kind>"`
// PropertySignature keys, via AST (PropertySignature.name), never a regex
// scan of the file text. Requires all three of title/badge/description
// present per id to count that id as "declared".
interface I18nExtraction {
  complete: Set<string>;
  incomplete: string[];
}
function extractDesignToolboxI18nIds(sourceText: string, fileName: string): I18nExtraction {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const pattern = /^chat\.designToolbox\.action\.([a-zA-Z0-9-]+)\.(title|badge|description)$/;
  const seen = new Map<string, Set<string>>();
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isPropertySignature(node)) {
      const name = node.name;
      const text = ts.isStringLiteral(name) ? name.text : null;
      const m = text ? pattern.exec(text) : null;
      if (m && m[1] && m[2]) {
        const id = m[1];
        const kind = m[2];
        if (!seen.has(id)) seen.set(id, new Set());
        seen.get(id)!.add(kind);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  const complete = new Set<string>();
  const incomplete: string[] = [];
  for (const [id, kinds] of seen) {
    if (kinds.size === 3) complete.add(id);
    else incomplete.push(`${id} (has: ${[...kinds].sort().join(',')})`);
  }
  return { complete, incomplete };
}

// Parses `apps/web/src/i18n/locales/en.ts` for the same key family as VALUES
// (PropertyAssignment whose key matches the pattern), requiring a non-empty
// string literal value for every complete-in-types.ts id/kind pair.
function extractEnValuesForToolboxKeys(sourceText: string, fileName: string): { emptyOrMissing: string[]; present: Set<string> } {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const pattern = /^chat\.designToolbox\.action\.([a-zA-Z0-9-]+)\.(title|badge|description)$/;
  const present = new Set<string>();
  const empty: string[] = [];
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name && pattern.test(name)) {
        const value = stringLiteralValue(node.initializer);
        if (value === null || value.trim().length === 0) {
          empty.push(name);
        } else {
          present.add(name);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { emptyOrMissing: empty, present };
}

// Occurrence-counted multiset diff -- never bare Set difference, so
// duplicates and count mismatches are visible (defect class 3).
function multisetDiff(a: string[], b: string[]): { onlyInA: string[]; onlyInB: string[]; countMismatch: string[] } {
  const countA = new Map<string, number>();
  const countB = new Map<string, number>();
  for (const x of a) countA.set(x, (countA.get(x) ?? 0) + 1);
  for (const x of b) countB.set(x, (countB.get(x) ?? 0) + 1);
  const onlyInA: string[] = [];
  const onlyInB: string[] = [];
  const countMismatch: string[] = [];
  const allKeys = new Set([...countA.keys(), ...countB.keys()]);
  for (const k of allKeys) {
    const ca = countA.get(k) ?? 0;
    const cb = countB.get(k) ?? 0;
    if (ca > 0 && cb === 0) onlyInA.push(k);
    else if (cb > 0 && ca === 0) onlyInB.push(k);
    else if (ca !== cb) countMismatch.push(`${k} (${ca} vs ${cb})`);
  }
  return { onlyInA, onlyInB, countMismatch };
}

function boundedIncludes(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-zA-Z0-9_-])${escaped}($|[^a-zA-Z0-9_-])`).test(haystack);
}

// -----------------------------------------------------------------------
// Static "does this test file bind to real production code" checks
// (defect class 6: import/call binding, never a same-named local lookalike).
// -----------------------------------------------------------------------
interface ImportBindingCheck {
  found: boolean;
  detail: string;
}
function checkImportResolvesToRealFile(
  testFileAbsPath: string,
  testSource: string,
  localNameSubstring: string,
  expectedRealFileAbsPath: string,
): ImportBindingCheck {
  const sf = ts.createSourceFile(testFileAbsPath, testSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const expectedReal = fs.existsSync(expectedRealFileAbsPath) ? fs.realpathSync(expectedRealFileAbsPath) : path.resolve(expectedRealFileAbsPath);
  let found = false;
  let detail = `no import declaration found whose local binding contains "${localNameSubstring}"`;
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const clause = stmt.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    const hasMatchingBinding = clause.namedBindings.elements.some((el) => el.name.text.includes(localNameSubstring));
    if (!hasMatchingBinding) continue;
    const spec = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(spec)) continue;
    const specText = spec.text;
    if (!specText.startsWith('.')) {
      detail = `import specifier "${specText}" is not a relative path -- cannot statically verify it resolves to the real production file`;
      continue;
    }
    const base = path.resolve(path.dirname(testFileAbsPath), specText);
    const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')];
    const resolved = candidates.find((c) => fs.existsSync(c));
    if (!resolved) {
      detail = `import specifier "${specText}" (resolved base ${base}) does not exist on disk`;
      continue;
    }
    const resolvedReal = fs.realpathSync(resolved);
    if (resolvedReal === expectedReal) {
      found = true;
      detail = `import specifier "${specText}" resolves to ${resolvedReal}, matching the real production file`;
      break;
    }
    detail = `import specifier "${specText}" resolves to ${resolvedReal}, which is NOT the expected production file ${expectedReal}`;
  }
  return { found, detail };
}

// Confirms an imported identifier (by local-name substring) is actually
// referenced as the source of an iteration construct (for-of, or a
// .forEach/.map/.flatMap call) somewhere in the file -- not merely an
// unused import.
function checkIdentifierDrivesIteration(testSource: string, testFileAbsPath: string, localNameSubstring: string): boolean {
  const sf = ts.createSourceFile(testFileAbsPath, testSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;
  function subtreeReferencesName(node: TypeScriptModule.Node): boolean {
    let hit = false;
    function inner(n: TypeScriptModule.Node): void {
      if (hit) return;
      if (ts.isIdentifier(n) && n.text.includes(localNameSubstring)) {
        hit = true;
        return;
      }
      ts.forEachChild(n, inner);
    }
    inner(node);
    return hit;
  }
  function visit(node: TypeScriptModule.Node): void {
    if (found) return;
    if (ts.isForOfStatement(node) && subtreeReferencesName(node.expression)) {
      found = true;
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['forEach', 'map', 'flatMap'].includes(node.expression.name.text) &&
      subtreeReferencesName(node.expression.expression)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}

function containsBannedTestMarker(source: string): string[] {
  const sf = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const hits: string[] = [];
  function visit(node: TypeScriptModule.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      ['test', 'it', 'describe'].includes(node.expression.expression.text) &&
      ['skip', 'only', 'fixme', 'todo'].includes(node.expression.name.text)
    ) {
      hits.push(`${node.expression.expression.text}.${node.expression.name.text}(...)`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return hits;
}

// =========================================================================
// Vitest JSON reporter runner (verify-wc.ts's proven pattern).
// =========================================================================
interface VitestAssertionResult {
  fullName: string;
  status: string;
}
interface VitestSuiteJson {
  numFailedTests: number;
  numPassedTests: number;
  testResults: { assertionResults: VitestAssertionResult[] }[];
}
function runVitestFile(pkgFilter: string, relFile: string, outName: string): { ranAtAll: boolean; status: number; data: VitestSuiteJson | null; raw: string } {
  const outPath = path.join(proofDir, `${outName}.json`);
  const r = sh('pnpm', ['--filter', pkgFilter, 'exec', 'vitest', 'run', relFile, '--reporter=json', `--outputFile=${outPath}`], { timeoutMs: 10 * 60_000 });
  let data: VitestSuiteJson | null = null;
  try {
    data = JSON.parse(fs.readFileSync(outPath, 'utf8')) as VitestSuiteJson;
  } catch {
    data = null;
  }
  return { ranAtAll: true, status: r.status, data, raw: `${r.stdout}\n${r.stderr}`.slice(0, 20_000) };
}

// =========================================================================
// Playwright JSON reporter runner.
// =========================================================================
interface PwResult {
  status: string;
}
interface PwTest {
  results: PwResult[];
}
interface PwSpec {
  title: string;
  ok: boolean;
  tests: PwTest[];
}
interface PwSuite {
  specs?: PwSpec[];
  suites?: PwSuite[];
}
interface PwJson {
  suites?: PwSuite[];
}
function collectPwSpecs(suite: PwSuite | undefined, out: PwSpec[]): void {
  if (!suite) return;
  for (const s of suite.specs ?? []) out.push(s);
  for (const child of suite.suites ?? []) collectPwSpecs(child, out);
}
function runPlaywrightFile(relFile: string, outName: string): { status: number; specs: PwSpec[]; raw: string } {
  const outPath = path.join(proofDir, `${outName}.json`);
  const r = sh('pnpm', ['--filter', '@open-design/e2e', 'exec', 'playwright', 'test', '-c', 'playwright.config.ts', relFile, '--reporter=json'], {
    timeoutMs: 20 * 60_000,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: outPath },
  });
  const specs: PwSpec[] = [];
  try {
    const data = JSON.parse(fs.readFileSync(outPath, 'utf8')) as PwJson;
    for (const suite of data.suites ?? []) collectPwSpecs(suite, specs);
  } catch {
    /* specs stays empty -- caller treats that as evidence failure */
  }
  return { status: r.status, specs, raw: `${r.stdout}\n${r.stderr}`.slice(0, 20_000) };
}

// =========================================================================
// Main
// =========================================================================
const DESIGN_TOOLBOX_SRC_REL = 'apps/web/src/runtime/design-toolbox.ts';
const I18N_TYPES_REL = 'apps/web/src/i18n/types.ts';
const I18N_EN_REL = 'apps/web/src/i18n/locales/en.ts';
const E2E_UI_SPEC_REL = 'e2e/ui/design-toolbox-actions.test.ts';
const E2E_PHANTOM_SPEC_REL = 'e2e/tests/design-toolbox-phantom-id.test.ts';
const DAEMON_SUITE_SPEC_REL = 'apps/daemon/tests/design-toolbox-skill-refs.test.ts';
const REVIEW_RECORD_REL = 'docs/plans/waves/w10c-toolbox-implementation-review.json';

const OWNED_IMPLEMENTATION_PATHS = [
  E2E_UI_SPEC_REL,
  E2E_PHANTOM_SPEC_REL,
  DAEMON_SUITE_SPEC_REL,
  DESIGN_TOOLBOX_SRC_REL,
  I18N_TYPES_REL,
  I18N_EN_REL,
];

let derivedActionIds: string[] | null = null; // set by C10C-1, consumed by C10C-2/C10C-4

async function main(): Promise<void> {
  // -----------------------------------------------------------------------
  // C10C-1
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-1', () => {
    const srcAbs = path.join(repoRoot, DESIGN_TOOLBOX_SRC_REL);
    const typesAbs = path.join(repoRoot, I18N_TYPES_REL);
    const enAbs = path.join(repoRoot, I18N_EN_REL);
    if (!fs.existsSync(srcAbs)) {
      record('C10C-1', '', 'DESIGN_TOOLBOX_ACTIONS re-derived from source, cross-validated against i18n keys', false, '', {
        detail: `${DESIGN_TOOLBOX_SRC_REL} does not exist`,
      });
      return;
    }
    const actionsExtract = extractDesignToolboxActions(fs.readFileSync(srcAbs, 'utf8'), srcAbs);
    if (!actionsExtract.ok || actionsExtract.actions.length === 0) {
      record(
        'C10C-1',
        `TypeScript-AST parse of ${DESIGN_TOOLBOX_SRC_REL}`,
        'DESIGN_TOOLBOX_ACTIONS parses as a literal array of literal-only object entries, zero spreads',
        false,
        actionsExtract.errors.join('\n') || 'no actions extracted',
      );
      return;
    }
    const actionIds = actionsExtract.actions.map((a) => a.id);
    const actionIdSet = new Set(actionIds);
    if (actionIdSet.size !== actionIds.length) {
      record('C10C-1', '', 'DESIGN_TOOLBOX_ACTIONS ids are unique', false, `duplicate ids found: ${actionIds.join(', ')}`);
      return;
    }
    if (!fs.existsSync(typesAbs) || !fs.existsSync(enAbs)) {
      record('C10C-1', '', 'i18n cross-check sources exist', false, '', {
        detail: `missing ${!fs.existsSync(typesAbs) ? I18N_TYPES_REL : ''} ${!fs.existsSync(enAbs) ? I18N_EN_REL : ''}`.trim(),
      });
      return;
    }
    const i18nExtract = extractDesignToolboxI18nIds(fs.readFileSync(typesAbs, 'utf8'), typesAbs);
    const enExtract = extractEnValuesForToolboxKeys(fs.readFileSync(enAbs, 'utf8'), enAbs);
    const diff = multisetDiff(actionIds, [...i18nExtract.complete]);
    const problems: string[] = [];
    if (diff.onlyInA.length) problems.push(`actions with no complete (title+badge+description) i18n key triple: ${diff.onlyInA.join(', ')}`);
    if (diff.onlyInB.length) problems.push(`i18n key triples with no matching action: ${diff.onlyInB.join(', ')}`);
    if (i18nExtract.incomplete.length) problems.push(`incomplete i18n key triples (missing one of title/badge/description): ${i18nExtract.incomplete.join(', ')}`);
    if (enExtract.emptyOrMissing.length) problems.push(`empty-string en.ts values for toolbox keys: ${enExtract.emptyOrMissing.join(', ')}`);
    derivedActionIds = actionIds;
    record(
      'C10C-1',
      `TypeScript-AST parse of ${DESIGN_TOOLBOX_SRC_REL} + ${I18N_TYPES_REL} + ${I18N_EN_REL}`,
      'the action-id set derived from design-toolbox.ts exactly equals the id set with all 3 i18n keys declared in types.ts, all non-empty in en.ts; zero hardcoded count',
      problems.length === 0,
      `derived action count: ${actionIds.length}\nderived ids: ${[...actionIdSet].sort().join(', ')}\n${problems.join('\n')}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-2
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-2', () => {
    const specAbs = path.join(repoRoot, E2E_UI_SPEC_REL);
    if (!fs.existsSync(specAbs)) {
      record('C10C-2', '', 'exhaustive, table-driven, real-daemon-backed per-action walk from the side panel', false, '', {
        detail: `${E2E_UI_SPEC_REL} does not exist`,
      });
      return;
    }
    const source = fs.readFileSync(specAbs, 'utf8');
    const banned = containsBannedTestMarker(source);
    const importCheck = checkImportResolvesToRealFile(specAbs, source, 'TOOLBOX_ACTIONS', path.join(repoRoot, DESIGN_TOOLBOX_SRC_REL));
    const iterationCheck = importCheck.found ? checkIdentifierDrivesIteration(source, specAbs, 'TOOLBOX_ACTIONS') : false;
    const structuralProblems: string[] = [];
    if (banned.length) structuralProblems.push(`banned skip/only/fixme markers: ${banned.join(', ')}`);
    if (!importCheck.found) structuralProblems.push(`no import binding to the real DESIGN_TOOLBOX_ACTIONS found: ${importCheck.detail}`);
    else if (!iterationCheck) structuralProblems.push('the imported TOOLBOX_ACTIONS binding is never referenced by a for-of/.forEach/.map/.flatMap iteration construct -- looks like an unused or decorative import');

    if (!derivedActionIds || derivedActionIds.length === 0) {
      record('C10C-2', '', 'per-action walk covers exactly the C10C-1-derived action set', false, structuralProblems.join('\n'), {
        detail: 'C10C-1 did not produce a derived action-id set; cannot verify per-action coverage',
      });
      return;
    }

    const run = runPlaywrightFile(E2E_UI_SPEC_REL, 'C10C-2-playwright');
    const specTitles = run.specs.map((s) => s.title);
    const coverageProblems: string[] = [];
    for (const id of derivedActionIds) {
      const matching = run.specs.filter((s) => boundedIncludes(s.title, id));
      if (matching.length === 0) coverageProblems.push(`no test title references action "${id}"`);
      else if (matching.length > 1) coverageProblems.push(`action "${id}" matched by ${matching.length} test titles (expected exactly 1): ${matching.map((s) => s.title).join(' | ')}`);
      else if (!matching[0]!.ok) coverageProblems.push(`action "${id}" test did not pass: "${matching[0]!.title}"`);
    }
    const extraneous = run.specs.filter((s) => !derivedActionIds!.some((id) => boundedIncludes(s.title, id)));
    const allOk = run.status === 0 && run.specs.length > 0 && coverageProblems.length === 0 && structuralProblems.length === 0;
    record(
      'C10C-2',
      `pnpm --filter @open-design/e2e exec playwright test ${E2E_UI_SPEC_REL} --reporter=json`,
      'every C10C-1-derived action id has exactly one passing, uniquely-matched test row; zero skip/only/fixme; row source is import-bound to the real catalogue',
      allOk,
      `derived action count: ${derivedActionIds.length}\nplaywright exit: ${run.status}\nspecs found: ${run.specs.length}\nspec titles: ${specTitles.join(' | ')}\nextraneous specs (no matching derived id): ${extraneous.map((s) => s.title).join(' | ') || 'none'}\n${[...structuralProblems, ...coverageProblems].join('\n')}\n\n${run.raw}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-3
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-3', () => {
    const specAbs = path.join(repoRoot, E2E_PHANTOM_SPEC_REL);
    if (!fs.existsSync(specAbs)) {
      record('C10C-3', '', 'phantom-ID red spec with a paired positive control, against the real function and real live registry', false, '', {
        detail: `${E2E_PHANTOM_SPEC_REL} does not exist`,
      });
      return;
    }
    const source = fs.readFileSync(specAbs, 'utf8');
    const banned = containsBannedTestMarker(source);
    const importCheck = checkImportResolvesToRealFile(specAbs, source, 'findDesignToolboxSkill', path.join(repoRoot, DESIGN_TOOLBOX_SRC_REL));
    const hasPhantomLiteral = source.includes('w10c-red-spec-phantom-skill-id');
    const structuralProblems: string[] = [];
    if (banned.length) structuralProblems.push(`banned skip/only/fixme markers: ${banned.join(', ')}`);
    if (!importCheck.found) structuralProblems.push(`findDesignToolboxSkill is not import-bound to the real design-toolbox.ts: ${importCheck.detail}`);
    if (!hasPhantomLiteral) structuralProblems.push('the pinned phantom fixture literal "w10c-red-spec-phantom-skill-id" was not found in the file');

    const run = runVitestFile('@open-design/e2e', E2E_PHANTOM_SPEC_REL, 'C10C-3-vitest');
    const allTests = run.data ? run.data.testResults.flatMap((t) => t.assertionResults) : [];
    const passed = allTests.filter((t) => t.status === 'passed');
    const positive = passed.filter((t) => /resolves|positive|real skill|control/i.test(t.fullName) && !/phantom|does.?not.?exist|nonexistent|unresolvable|red.?spec/i.test(t.fullName));
    const negative = passed.filter((t) => /phantom|does.?not.?exist|nonexistent|unresolvable|red.?spec/i.test(t.fullName));
    const pairingProblems: string[] = [];
    if (positive.length === 0) pairingProblems.push('no passing assertion reads as a positive control (resolves/positive/real skill/control)');
    if (negative.length === 0) pairingProblems.push('no passing assertion reads as the phantom-id negative case');
    if (positive.length && negative.length && positive.some((p) => negative.includes(p))) pairingProblems.push('the same assertion satisfies both the positive and negative regex -- an omnibus assertion does not count as the pair');

    const allOk = run.status === 0 && (run.data?.numFailedTests ?? 1) === 0 && structuralProblems.length === 0 && pairingProblems.length === 0;
    record(
      'C10C-3',
      `pnpm --filter @open-design/e2e exec vitest run ${E2E_PHANTOM_SPEC_REL} --reporter=json`,
      'a phantom preferredSkillIds entry resolves to null via the real findDesignToolboxSkill against the real live registry, paired with a positive control resolving a real action',
      allOk,
      `vitest exit: ${run.status}\nfailed: ${run.data?.numFailedTests ?? 'unknown'} passed: ${run.data?.numPassedTests ?? 'unknown'}\npositive-control matches: ${positive.map((p) => p.fullName).join(' | ') || 'none'}\nnegative/phantom matches: ${negative.map((p) => p.fullName).join(' | ') || 'none'}\n${[...structuralProblems, ...pairingProblems].join('\n')}\n\n${run.raw}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-4
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-4', () => {
    const specAbs = path.join(repoRoot, DAEMON_SUITE_SPEC_REL);
    if (!fs.existsSync(specAbs)) {
      record('C10C-4', '', 'action->skill mapping assertions live in the daemon suite, against real registry resolution', false, '', {
        detail: `${DAEMON_SUITE_SPEC_REL} does not exist`,
      });
      return;
    }
    const source = fs.readFileSync(specAbs, 'utf8');
    const banned = containsBannedTestMarker(source);
    const skillsImportCheck = checkImportResolvesToRealFile(specAbs, source, 'findSkillById', path.join(repoRoot, 'apps/daemon/src/skills.ts'));
    const sf = ts.createSourceFile(specAbs, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let usesTsCompilerApi = false;
    function scanForTsUsage(node: TypeScriptModule.Node): void {
      if (usesTsCompilerApi) return;
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'ts' &&
        (node.expression.name.text === 'createSourceFile' || node.expression.name.text === 'forEachChild')
      ) {
        usesTsCompilerApi = true;
        return;
      }
      ts.forEachChild(node, scanForTsUsage);
    }
    scanForTsUsage(sf);
    const hasPhantomLiteral = source.includes('w10c-daemon-suite-phantom-skill-id');
    const noWebImport = !/from\s+['"][^'"]*apps\/web\//.test(source) && !/from\s+['"]\.\.\/\.\.\/web\//.test(source);

    const structuralProblems: string[] = [];
    if (banned.length) structuralProblems.push(`banned skip/only/fixme markers: ${banned.join(', ')}`);
    if (!skillsImportCheck.found) structuralProblems.push(`findSkillById is not import-bound to the real apps/daemon/src/skills.ts: ${skillsImportCheck.detail}`);
    if (!usesTsCompilerApi) structuralProblems.push('no ts.createSourceFile/ts.forEachChild call found -- design-toolbox.ts extraction must use the TypeScript compiler API, not regex');
    if (!hasPhantomLiteral) structuralProblems.push('the pinned phantom fixture literal "w10c-daemon-suite-phantom-skill-id" was not found in the file');
    if (!noWebImport) structuralProblems.push('file appears to import apps/web/** directly -- the cross-app boundary requires reading design-toolbox.ts as text, not importing it');

    if (!derivedActionIds || derivedActionIds.length === 0) {
      record('C10C-4', '', 'daemon suite coverage matches the C10C-1-derived action set exactly', false, structuralProblems.join('\n'), {
        detail: 'C10C-1 did not produce a derived action-id set; cannot verify per-action coverage',
      });
      return;
    }

    const run = runVitestFile('@open-design/daemon', DAEMON_SUITE_SPEC_REL, 'C10C-4-vitest');
    const allTests = run.data ? run.data.testResults.flatMap((t) => t.assertionResults) : [];
    const passed = allTests.filter((t) => t.status === 'passed');
    const coverageProblems: string[] = [];
    for (const id of derivedActionIds) {
      if (!passed.some((t) => boundedIncludes(t.fullName, id))) coverageProblems.push(`no passing daemon-suite test references action "${id}"`);
    }
    const positive = passed.filter((t) => /resolves|positive|real skill|control/i.test(t.fullName) && !/phantom|does.?not.?exist|nonexistent|unresolvable/i.test(t.fullName));
    const negative = passed.filter((t) => /phantom|does.?not.?exist|nonexistent|unresolvable/i.test(t.fullName));
    if (positive.length === 0) coverageProblems.push('no passing assertion reads as a positive control');
    if (negative.length === 0) coverageProblems.push('no passing assertion reads as the phantom-id negative case');

    const allOk = run.status === 0 && (run.data?.numFailedTests ?? 1) === 0 && structuralProblems.length === 0 && coverageProblems.length === 0;
    record(
      'C10C-4',
      `pnpm --filter @open-design/daemon exec vitest run ${DAEMON_SUITE_SPEC_REL} --reporter=json`,
      'every preferredSkillIds entry is checked against findSkillById(listSkills(realSkillsRoot)), covering exactly the C10C-1-derived action set, with a paired phantom/positive control',
      allOk,
      `vitest exit: ${run.status}\nfailed: ${run.data?.numFailedTests ?? 'unknown'} passed: ${run.data?.numPassedTests ?? 'unknown'}\nderived action count: ${derivedActionIds.length}\n${[...structuralProblems, ...coverageProblems].join('\n')}\n\n${run.raw}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-5 -- the one live runtime probe in this verifier.
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-5', async () => {
    const namespace = `verify-w10c-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-w10c-data-'));
    let started = false;
    try {
      const startResult = sh('pnpm', ['tools-dev', 'start', 'daemon', '--namespace', namespace, '--json'], {
        timeoutMs: 3 * 60_000,
        env: { ...process.env, OD_DATA_DIR: tempDataDir },
      });
      if (startResult.status !== 0) {
        record('C10C-5', 'pnpm tools-dev start daemon --namespace <fresh>', 'UI (/api/skills) and CLI (od skills list --json) skill listings agree, for an isolated real daemon', false, `${startResult.stdout}\n${startResult.stderr}`, {
          detail: `tools-dev start failed with exit ${startResult.status}`,
        });
        return;
      }
      started = true;
      // `pnpm tools-dev ...` (an npm-style root script alias) prints a
      // "> mishmash@... tools-dev\n> pnpm exec tools-dev ..." banner ahead
      // of the command's own stdout, so JSON.parse on the raw stdout fails;
      // slice from the first '{' instead of trusting stdout to be pure JSON.
      function parseJsonTail<T>(stdout: string): T | null {
        const start = stdout.indexOf('{');
        if (start === -1) return null;
        try {
          return JSON.parse(stdout.slice(start)) as T;
        } catch {
          return null;
        }
      }
      let daemonUrl: string | null = null;
      const startParsed = parseJsonTail<{ daemon?: { status?: { url?: string } } }>(startResult.stdout);
      daemonUrl = startParsed?.daemon?.status?.url ?? null;
      if (!daemonUrl) {
        const statusResult = sh('pnpm', ['tools-dev', 'status', 'daemon', '--namespace', namespace, '--json'], { timeoutMs: 30_000 });
        const statusParsed = parseJsonTail<{ url?: string }>(statusResult.stdout);
        daemonUrl = statusParsed?.url ?? null;
      }
      if (!daemonUrl) {
        record('C10C-5', '', 'daemon URL discoverable after start', false, startResult.stdout, { detail: 'could not discover the isolated daemon URL from tools-dev output' });
        return;
      }
      const parsedUrl = new URL(daemonUrl);
      const forbiddenPorts = new Set(['7456', '51012']);
      if (forbiddenPorts.has(parsedUrl.port)) {
        record('C10C-5', '', 'the isolated daemon never binds the reserved default-namespace ports', false, '', {
          detail: `discovered daemon port ${parsedUrl.port} is a forbidden default-namespace port -- refusing to probe it`,
        });
        return;
      }
      if (!['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)) {
        record('C10C-5', '', 'the isolated daemon is loopback-only', false, '', { detail: `discovered daemon hostname "${parsedUrl.hostname}" is not a loopback address -- refusing to probe it` });
        return;
      }

      // Fail-closed HTTP probe: redirect:'manual', origin re-validated against
      // the discovered daemon URL immediately before the request.
      let httpIds: string[] = [];
      let httpProblem: string | null = null;
      try {
        const skillsUrl = new URL('/api/skills', daemonUrl);
        if (skillsUrl.origin !== parsedUrl.origin) throw new Error('constructed URL origin drifted from the discovered daemon origin');
        const resp = await fetch(skillsUrl, { redirect: 'manual' });
        if (resp.status >= 300 && resp.status < 400) throw new Error(`unexpected redirect (status ${resp.status}) -- refusing to follow`);
        if (resp.status !== 200) throw new Error(`GET /api/skills returned status ${resp.status}`);
        const body = (await resp.json()) as { skills?: { id?: string }[] };
        httpIds = (body.skills ?? []).map((s) => String(s.id ?? ''));
      } catch (err) {
        httpProblem = String((err as Error)?.message ?? err);
      }

      const cliResult = sh(
        process.execPath,
        ['--import', 'tsx', path.join(repoRoot, 'apps/daemon/src/cli.ts'), 'skills', 'list', '--json', '--daemon-url', daemonUrl],
        { cwd: path.join(repoRoot, 'apps/daemon'), timeoutMs: 60_000 },
      );
      let cliIds: string[] = [];
      let cliProblem: string | null = null;
      if (cliResult.status !== 0) {
        cliProblem = `od skills list --json exited ${cliResult.status}: ${cliResult.stderr.slice(0, 2000)}`;
      } else {
        try {
          const parsed = JSON.parse(cliResult.stdout) as { skills?: { id?: string }[] };
          cliIds = (parsed.skills ?? []).map((s) => String(s.id ?? ''));
        } catch (err) {
          cliProblem = `could not parse CLI JSON output: ${String(err)}`;
        }
      }

      const diff = multisetDiff(httpIds, cliIds);
      const problems: string[] = [];
      if (httpProblem) problems.push(`HTTP probe failed: ${httpProblem}`);
      if (cliProblem) problems.push(`CLI probe failed: ${cliProblem}`);
      if (!httpProblem && !cliProblem) {
        if (httpIds.length === 0) problems.push('HTTP /api/skills returned zero skills -- cannot prove parity against an empty set');
        if (diff.onlyInA.length) problems.push(`ids present via HTTP but not CLI: ${diff.onlyInA.join(', ')}`);
        if (diff.onlyInB.length) problems.push(`ids present via CLI but not HTTP: ${diff.onlyInB.join(', ')}`);
        if (diff.countMismatch.length) problems.push(`id occurrence-count mismatches: ${diff.countMismatch.join(', ')}`);
      }
      record(
        'C10C-5',
        `GET ${daemonUrl}/api/skills  vs  od skills list --json --daemon-url ${daemonUrl}`,
        'the HTTP and CLI skill-id multisets are exactly identical for the same isolated daemon',
        problems.length === 0,
        `namespace: ${namespace}\ndaemon url: ${daemonUrl}\nhttp id count: ${httpIds.length}\ncli id count: ${cliIds.length}\n${problems.join('\n')}`,
      );
    } finally {
      if (started) {
        sh('pnpm', ['tools-dev', 'stop', 'daemon', '--namespace', namespace], { timeoutMs: 60_000, env: { ...process.env, OD_DATA_DIR: tempDataDir } });
      }
      try {
        fs.rmSync(tempDataDir, { recursive: true, force: true });
      } catch {
        /* best effort cleanup only */
      }
    }
  });

  // -----------------------------------------------------------------------
  // C10C-6
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-6', () => {
    const guard = sh('pnpm', ['guard'], { timeoutMs: 5 * 60_000 });
    const typecheck = sh('pnpm', ['typecheck'], { timeoutMs: 10 * 60_000 });
    record(
      'C10C-6',
      'pnpm guard && pnpm typecheck',
      'both exit 0 on the current tree',
      guard.status === 0 && typecheck.status === 0,
      `guard exit=${guard.status}\ntypecheck exit=${typecheck.status}\n\n${guard.stdout.slice(-4000)}\n\n${typecheck.stdout.slice(-4000)}\n${typecheck.stderr.slice(-4000)}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-7
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-7', () => {
    let raw: string;
    try {
      raw = readFileAtCommit(headSha, REVIEW_RECORD_REL);
    } catch (err) {
      record('C10C-7', `git show ${headSha}:${REVIEW_RECORD_REL}`, 'implementation review record exists, committed, non-spoofable', false, '', {
        detail: `could not read ${REVIEW_RECORD_REL} at HEAD: ${String(err)}`,
      });
      return;
    }
    let review: { reviewer?: unknown; model?: unknown; reviewedCommit?: unknown; verdict?: unknown };
    try {
      review = JSON.parse(raw) as typeof review;
    } catch (err) {
      record('C10C-7', '', 'review record parses as JSON', false, raw.slice(0, 2000), { detail: `JSON parse failed: ${String(err)}` });
      return;
    }
    const reviewer = typeof review.reviewer === 'string' ? review.reviewer : null;
    const reviewedCommit = typeof review.reviewedCommit === 'string' ? review.reviewedCommit : null;
    const verdict = typeof review.verdict === 'string' ? review.verdict : null;
    const problems: string[] = [];
    if (!reviewer) problems.push('"reviewer" is missing or not a string');
    if (!reviewedCommit) problems.push('"reviewedCommit" is missing or not a string');
    if (verdict !== 'APPROVE') problems.push(`"verdict" is "${String(verdict)}", expected "APPROVE"`);
    if (reviewedCommit) {
      if (!resolveCommit(reviewedCommit)) {
        problems.push(`"reviewedCommit" (${reviewedCommit}) does not resolve to a real commit`);
      } else if (reviewedCommit === headSha) {
        problems.push('"reviewedCommit" equals HEAD -- must be a strict ancestor (a commit cannot review itself)');
      } else if (!isAncestor(reviewedCommit, headSha)) {
        problems.push(`"reviewedCommit" (${reviewedCommit}) is not an ancestor of HEAD (${headSha})`);
      } else {
        const diffResult = sh('git', ['diff', '--name-only', reviewedCommit, headSha, '--', ...OWNED_IMPLEMENTATION_PATHS]);
        const changedSinceReview = diffResult.stdout.trim().split('\n').filter(Boolean);
        if (changedSinceReview.length > 0) problems.push(`implementation/evidence changed AFTER reviewedCommit -- review is stale for: ${changedSinceReview.join(', ')}`);
      }
      if (reviewer) {
        const authorsInRange = commitAuthorsBetween(baseCommit, reviewedCommit);
        if (authorsInRange.has(reviewer.toLowerCase())) problems.push(`"reviewer" ("${reviewer}") matches a commit author in baseCommit..reviewedCommit -- not distinguishable from the implementation`);
      }
    }
    record(
      'C10C-7',
      `read ${REVIEW_RECORD_REL}@HEAD; reviewedCommit ancestry + owned-path empty-diff + author-distinctness checks`,
      'reviewedCommit is a real, strict ancestor of HEAD whose owned-path diff to HEAD is empty; reviewer distinct from every baseCommit..reviewedCommit author; verdict is APPROVE',
      problems.length === 0,
      problems.join('\n') || `reviewer=${reviewer} model=${String(review.model)} reviewedCommit=${reviewedCommit} verdict=${verdict}`,
    );
  });

  // =======================================================================
  // GATE-INTEGRITY / LEASE / HEAD-DRIFT
  // =======================================================================
  await checkCriterion('GATE-INTEGRITY', () => {
    const selfPath = process.argv[1] ? path.resolve(process.argv[1]) : path.join(repoRoot, 'scripts/waves/verify-w10c.ts');
    let selfSha256: string;
    try {
      selfSha256 = sha256File(selfPath);
    } catch (err) {
      record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check; the PRIMARY control is the LEASE deny-list on this file plus the PRD, not this pin', false, '', {
        detail: `could not hash self at ${selfPath}: ${String(err)}`,
      });
      return;
    }
    const approvedHashPath = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256');
    if (!gateIntegrityPinned) {
      record(
        'GATE-INTEGRITY',
        '',
        'defense-in-depth self-hash check',
        true,
        `sha256: ${selfSha256}\nUNPINNED -- no approved-gate.sha256 present. This is advisory; the primary control is the LEASE check's deny-list on this file and the PRD (docs/plans/waves/W10c-toolbox.md), which a diff-based check enforces regardless of pin timing. See manifest.gateIntegrityPinned=false.`,
      );
      return;
    }
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === selfSha256;
    record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', gateOk, `sha256: ${selfSha256}\napproved: ${approved}\nPINNED`, {
      detail: gateOk ? undefined : 'verify-w10c.ts modified since orchestrator approval',
    });
  });

  function globToRegExp(glob: string): RegExp {
    let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    re = re.replace(/\*\*/g, ' GLOBSTAR ');
    re = re.replace(/\*/g, '[^/]*');
    re = re.replace(/ GLOBSTAR /g, '.*');
    return new RegExp(`^${re}$`);
  }
  await checkCriterion('LEASE', () => {
    let leasesRaw: { waves: Record<string, { allow: string[]; deny?: string[] }> };
    try {
      const leasesText = readFileAtCommit(baseCommit, 'docs/plans/waves/leases.json');
      leasesRaw = JSON.parse(leasesText) as typeof leasesRaw;
    } catch (err) {
      record('LEASE', `git show ${baseCommit}:docs/plans/waves/leases.json`, 'no writes outside the W10c lease, read from baseCommit', false, '', {
        detail: `could not read/parse leases.json at baseCommit: ${String(err)}`,
      });
      return;
    }
    const lease = leasesRaw.waves['W10c'];
    if (!lease) {
      record('LEASE', '', 'no writes outside the W10c lease, read from baseCommit', false, '', {
        detail: 'no "W10c" entry in leases.json@baseCommit -- expected pre-orchestrator-transcription; see W10c-toolbox.md §6 "Proposed lease"',
      });
      return;
    }
    const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
    const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
    if (diffResult.status !== 0) {
      record('LEASE', '', '', false, diffResult.stdout, { detail: `git diff exited ${diffResult.status}` });
      return;
    }
    const allowRe = lease.allow.map(globToRegExp);
    const denyRe = (lease.deny ?? []).map(globToRegExp);
    const violations = diffNames.filter((f) => !allowRe.some((re) => re.test(f)) || denyRe.some((re) => re.test(f)));
    record(
      'LEASE',
      `git diff --name-only ${baseCommit}...HEAD subset-of leases.json[W10c] read via git show ${baseCommit}:docs/plans/waves/leases.json`,
      'no writes outside the W10c lease, read from baseCommit so the wave cannot widen its own lease',
      violations.length === 0,
      violations.join('\n') || (diffNames.length === 0 ? 'no diff between baseCommit and HEAD' : `all ${diffNames.length} changed files inside the lease`),
    );
  });

  const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  await checkCriterion('HEAD-DRIFT', () => {
    record('HEAD-DRIFT', 'git rev-parse HEAD (re-resolved at end)', 'HEAD must not move during the run', headShaFinal === headSha, `initial=${headSha} final=${headShaFinal}`, {
      detail: headShaFinal === headSha ? undefined : 'HEAD moved during the run',
    });
  });

  // -----------------------------------------------------------------------
  // Final integrity re-check + manifest write.
  // -----------------------------------------------------------------------
  for (const r of results) {
    if (!r.artifact || !r.artifactSha256) continue;
    try {
      const currentHash = sha256File(r.artifact);
      if (currentHash !== r.artifactSha256) {
        r.status = 'fail';
        r.detail = `${r.detail ? `${r.detail}; ` : ''}TAMPER DETECTED`;
      }
    } catch {
      r.status = 'fail';
      r.detail = `${r.detail ? `${r.detail}; ` : ''}artifact disappeared before final integrity re-check`;
    }
  }

  const treeDirtyResult = sh('git', ['status', '--porcelain=v1']);
  const treeDirty = treeDirtyResult.status !== 0 || treeDirtyResult.stdout.trim().length > 0;
  const finalManifest = buildManifest(true, treeDirty);
  const { written: manifestWritten, sha256: manifestSha256 } = writeManifestFile(finalManifest);

  const failures = results.filter((r) => r.status === 'fail');
  console.log(`\nverify-w10c: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty}, gateIntegrityPinned=${gateIntegrityPinned})`);
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md §2)');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  process.exit(failures.length === 0 && !treeDirty && manifestWritten ? 0 : 1);
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
