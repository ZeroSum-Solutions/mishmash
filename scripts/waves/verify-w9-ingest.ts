// verify-w9-ingest.ts -- wave mishmash-w9-ingest-tranche (Library ingest route
// hardening, first of the rolling W9 tranches) completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w9-ingest.ts [--repo <path>]
// Exit 0 only when every C9 criterion passes, the tree is clean, the initial
// manifest placeholder wrote successfully, archival succeeded, and the three
// named infra checks (GATE-INTEGRITY / LEASE / HEAD-DRIFT) pass. The
// commit-bound proof manifest is written to the wave's goal-state proof
// directory either way -- W3's own verifier (criterion C3-4) reads that
// manifest directly per docs/plans/waves/W9-ingest-tranche.md's "Definition
// of green"; it must not re-run this tranche's checks itself.
//
// ROUND 2 FIX (Sol REJECT again, verbatim record at ~/.claude/goal-state/
// mishmash-w9-ingest-tranche/reviews/sol-r2-findings.md). Round 1's fixes for
// F1/F4/F7/F8/F9's core mechanisms held (baseCommit route derivation, exact
// fullName binding, arithmetic/duplicate enforcement, corrected ground
// facts) but left gaps and introduced two new blocking defects:
//   F2 (still not fixed) -- the six attribution fields accepted any
//     non-empty string ("x" passed), and `decisionRef` used substring
//     containment against DECISIONS.md ("x" matches something, somewhere).
//     Fixed: PLACEHOLDER_DENYLIST + length/anti-repetition floor on every
//     field; `authn` additionally must contain the keyword matching its
//     mechanically-derived exposure class; `acceptedRisk.decisionRef` must
//     equal a UNIQUE, fully-structured `### W9-ACCEPT-*` entry in
//     DECISIONS.md@baseCommit (Route/Accepted risk/Accepter/Date/Rationale
//     all present), whose Route field matches the row and whose Accepter is
//     not any commit author across baseCommit..HEAD.
//   F3 (still not fixed) -- exact fullName binding didn't stop the SAME test
//     covering every row, "new test" was decided by whole-FILE existence (so
//     an appended test to an old file skipped red evidence), the red
//     "transcript" was any 100-char file with RED/FAIL, ">=2 assertions"
//     counted anything, C9-6 accepted "no rate limit exists" (contains
//     rate+limit), C9-7 accepted route names anywhere in prose. Fixed: a
//     primary testRef must be unique per row; "new" is keyed on whether the
//     exact test TITLE string existed in the file's baseCommit content
//     (not file existence); the red transcript is a structured
//     PARENT_SHA/COMMAND/TEST header (PARENT_SHA must resolve and be a real
//     ancestor of HEAD, TEST must exactly match); the pairing check requires
//     an actual positive-signal AND negative-signal passing assertion in the
//     same file, not a raw count; C9-6's mechanism text is checked for an
//     enforcement pattern AND rejected on a negation pattern; C9-7 requires
//     the P0 route's own key inside the SAME cited-and-valid bullet line.
//   F5 (still not fixed) -- the stale-proof drift check named only two
//     files; the initial wroteOk:false write's result was discarded. Fixed:
//     the PRD's "Definition of green" predicate 9 now names every evidence
//     path (tests, attribution JSON, threat model, review record,
//     DECISIONS.md, this verifier); the initial placeholder write's result
//     is checked and a failure now aborts the run instead of being ignored.
//   NEW DEFECT -- C9-10 required an in-repo file to contain its OWN
//     commit's SHA, which is structurally impossible, and bound "reviewer"
//     only to HEAD's own author. Redesigned: the review record names
//     `reviewedCommit`, a STRICT ancestor of HEAD; the gate verifies (a) it
//     resolves and is a real ancestor, (b) nothing in the tranche's owned
//     implementation/evidence paths changed between reviewedCommit and HEAD
//     (the review, committed later, necessarily covers the reviewed
//     commit's full, final state), and (c) reviewer is distinct from every
//     commit author across baseCommit..reviewedCommit (not just the tip).
//     This makes a clean green run feasible (commit the implementation,
//     THEN commit a review record naming that already-real commit) while
//     the record can no longer spoof authorship or self-reference.
//   NEW DEFECT -- `GET /api/library/assets` was frozen at impact 0/P2 but
//     calls `runReconcile(false)`, which inserts library-asset rows
//     (library-sync.ts). Its floor is corrected to 2 (score 5, P0); every
//     other GET route was re-audited for the same hidden-mutation pattern
//     and none other qualifies (see W9-ingest-tranche.md S9-2).
//   NEW DEFECT -- the AST classifier counted `authorizeToolRequest()` and
//     the bearer pattern from ANYWHERE in the handler, so dead/unreachable
//     code (a decoy inside an `if(false)` block, after an unconditional
//     return, or nested in an unrelated callback) still counted as a live
//     gate. Fixed: guard-signal collection is now scoped to the handler's
//     OWN top-level statements, stops at the first unconditional top-level
//     return/throw, and never descends into a nested function/arrow
//     literal's own body. Separately, the self-service-bearer pattern is
//     now vetoed by the presence of `isLocalSameOrigin` ANYWHERE in the
//     handler -- POST /api/library/ingest calls both `bearerToken` and
//     `validateLibraryToken` at top level too, but its token check is one
//     branch of a three-way decision with a loopback ALTERNATIVE
//     (`isLocalSameOrigin`), which is not the self-service-bearer shape
//     (proof of possession as the ONLY accepted path) -- this exact
//     misclassification was caught and fixed here before submission, not
//     just the reviewer's named finding.
//   Verifier-integrity -- GATE-INTEGRITY's advisory-when-unpinned state is
//     now an explicit top-level manifest field (`gateIntegrityPinned`), not
//     buried in one criterion's prose.
//   MEDIUM -- archived per-run manifests now rewrite their own
//     `criteria[].artifact` paths to point at the run-dir-local copies (
//     fully self-contained, independently re-verifiable without touching
//     the canonical, overwrite-prone proof/ paths), and archive failure now
//     fails the run (`archiveOk` is a top-level manifest field and a hard
//     exit-code contributor).
//
// PORTABILITY: repoRoot comes from `process.cwd()`/`--repo`, never
// `import.meta.url` -- matches the verify-w0.ts / verify-w7.ts convention so
// this file can be copied to an orchestrator-approved out-of-repo location
// and still run correctly with cwd set to the target worktree.
//
// Isolation: every daemon this verifier boots binds to port 0 (OS-assigned
// ephemeral port) with a fresh mkdtemp OD_DATA_DIR, and is killed by its own
// exact child PID on teardown. This verifier never touches a default-
// namespace daemon (ports 7456/51012) and never issues a `git fetch`/`git
// push` -- git context is resolved from local refs only.

import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type TypeScriptModule from 'typescript';
import type { Node as TsNode } from 'typescript';

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

const WAVE_SLUG = 'mishmash-w9-ingest-tranche';

function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W9-ingest',
      commit: 'unknown',
      treeDirty: true,
      baseCommit: 'unknown',
      wroteOk: false,
      gateIntegrityPinned: false,
      archiveOk: false,
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
      path.join(os.tmpdir(), 'verify-w9-ingest-emergency-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  } catch {
    /* truly nothing more we can do */
  }
  console.error(`verify-w9-ingest: FATAL during init: ${errorMessage}`);
  process.exit(1);
}

let repoRoot: string;
let proofDir: string;
let ts: typeof TypeScriptModule;
try {
  repoRoot = path.resolve(argValue('--repo') ?? process.cwd());
  proofDir = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'proof');
  fs.mkdirSync(proofDir, { recursive: true });
  fs.mkdirSync(path.join(proofDir, 'runs'), { recursive: true });
  ts = createRequire(path.join(repoRoot, 'package.json'))('typescript');
} catch (err) {
  emergencyExit(`init failed: ${String((err as Error)?.stack ?? err)}`);
}

function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd: opts.cwd ?? repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      timeout: opts.timeoutMs ?? 10 * 60_000,
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
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'unnamed'
  );
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
  const fallbackResult = tryWrite(path.join(os.tmpdir(), 'verify-w9-ingest-fallback-proof', `${id}.txt`));
  if (fallbackResult) return fallbackResult;
  console.error(`verify-w9-ingest: artifact write failed for ${id} on both primary and fallback paths`);
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
  } catch (err) {
    record(id, '', '', false, String((err as Error)?.stack ?? err), {
      detail: `criterion check crashed: ${String(err)}`,
      durationMs: Date.now() - startedAt,
    });
  }
}

// -----------------------------------------------------------------------
// Git context -- local refs only, no fetch/push (hard constraint).
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
    wave: 'W9-ingest',
    commit: 'unknown',
    treeDirty: true,
    baseCommit: 'unknown',
    wroteOk: false,
    gateIntegrityPinned: false,
    archiveOk: false,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: [
      ...partialResults,
      {
        id: 'GIT-RESOLUTION',
        command: 'git rev-parse HEAD / git merge-base',
        assertion: 'HEAD and baseCommit resolve to real, non-empty, non-equal commits before any criterion runs',
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
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w9-ingest-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
    } catch {
      /* last resort: stderr only */
    }
  }
  console.error(`verify-w9-ingest: FATAL, emergency manifest written=${wrote}: ${errorMessage}`);
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
function fileExistsAtCommit(commit: string, relPath: string): boolean {
  const r = sh('git', ['cat-file', '-e', `${commit}:${relPath}`]);
  return r.status === 0;
}
function resolveCommit(sha: string): boolean {
  return sh('git', ['cat-file', '-e', `${sha}^{commit}`]).status === 0;
}
function isAncestor(ancestor: string, descendant: string): boolean {
  return sh('git', ['merge-base', '--is-ancestor', ancestor, descendant]).status === 0;
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
// F5 fix: two-phase manifest write. A wroteOk:false placeholder is written
// IMMEDIATELY (before any criterion runs), overwriting whatever manifest.json
// a PRIOR run left behind, so a crash/interruption after this point can never
// leave a stale-but-complete-looking prior green manifest on disk. Round 2:
// the write's own result is checked -- if the placeholder itself cannot be
// written, this run aborts rather than silently proceeding while a possibly
// stale prior manifest sits unflagged.
// =========================================================================
interface ManifestShape {
  wave: string;
  commit: string;
  treeDirty: boolean;
  baseCommit: string;
  wroteOk: boolean;
  gateIntegrityPinned: boolean;
  archiveOk: boolean;
  toolchain: { node: string; pnpm: string };
  criteria: CriterionResult[];
}
function buildManifest(wroteOk: boolean, treeDirty: boolean, archiveOk: boolean): ManifestShape {
  return {
    wave: 'W9-ingest',
    commit: headSha,
    treeDirty,
    baseCommit,
    wroteOk,
    gateIntegrityPinned,
    archiveOk,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: results,
  };
}
function writeManifestFile(manifest: ManifestShape): { written: boolean; sha256: string } {
  const manifestPath = path.join(proofDir, 'manifest.json');
  try {
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
    fs.renameSync(tmp, manifestPath);
    const sha256 = sha256File(manifestPath);
    fs.writeFileSync(path.join(proofDir, 'manifest.sha256.txt'), `${sha256}\n`);
    return { written: true, sha256 };
  } catch (err) {
    try {
      fs.writeFileSync(path.join(os.tmpdir(), 'verify-w9-ingest-emergency-manifest.json'), JSON.stringify(manifest, null, 2));
      console.error(`verify-w9-ingest: primary manifest write failed (${String(err)}); wrote fallback`);
    } catch (err2) {
      console.error(`verify-w9-ingest: manifest write failed everywhere (${String(err)} / ${String(err2)})`);
    }
    return { written: false, sha256: 'unavailable' };
  }
}
// Round 2 fix: the archived copy is now SELF-CONTAINED -- every
// criteria[].artifact path is rewritten to the run-dir-local copy before
// writing the archived manifest, so it remains independently re-verifiable
// even after later runs overwrite the canonical proof/<ID>.txt paths.
// Archive failure is no longer swallowed: the caller treats a non-ok result
// as a run failure.
function archiveRunArtifacts(manifest: ManifestShape): { runDir: string; ok: boolean } {
  const runDir = path.join(proofDir, 'runs', `${manifest.commit}-${Date.now()}-${process.pid}`);
  try {
    fs.mkdirSync(runDir, { recursive: true });
    const selfContainedCriteria = manifest.criteria.map((r) => {
      if (!r.artifact || !fs.existsSync(r.artifact)) return r;
      const dest = path.join(runDir, path.basename(r.artifact));
      fs.copyFileSync(r.artifact, dest);
      return { ...r, artifact: dest };
    });
    const selfContainedManifest: ManifestShape = { ...manifest, criteria: selfContainedCriteria };
    const manifestJsonPath = path.join(runDir, 'manifest.json');
    fs.writeFileSync(manifestJsonPath, JSON.stringify(selfContainedManifest, null, 2));
    fs.writeFileSync(path.join(runDir, 'manifest.sha256.txt'), `${sha256File(manifestJsonPath)}\n`);
    return { runDir, ok: true };
  } catch (err) {
    console.error(`verify-w9-ingest: run-archive copy FAILED (this now fails the run): ${String(err)}`);
    return { runDir, ok: false };
  }
}

// -----------------------------------------------------------------------
// Round 1+2 fix: AST route-registration collector, scoped strictly to
// registerLibraryRoutes's own body, duplicate-registration-aware,
// comment-blind by construction, and (round 2) reachability-aware --
// guard-signal detection is scoped to the handler's own TOP-LEVEL
// statements and stops at the first unconditional return/throw, so a
// decoy call inside dead code or a nested callback cannot count.
// -----------------------------------------------------------------------
interface RouteRegistration {
  method: string;
  routePath: string;
  hasRequireLocalDaemonRequest: boolean;
  hasAuthorizeToolRequest: boolean;
  hasSelfServiceBearerPattern: boolean;
}
interface CollectResult {
  registrations: RouteRegistration[];
  duplicates: string[]; // "METHOD path" keys seen more than once
}

function findFunctionBody(sourceFile: TypeScriptModule.SourceFile, fnName: string): TsNode | null {
  let found: TsNode | null = null;
  function visit(node: TsNode): void {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === fnName && node.body) {
      found = node.body;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

/**
 * Real AST search for a CallExpression `name(...)` under `root`, never
 * descending into a nested function/arrow-function literal's own body -- a
 * guard call hidden inside an unrelated inline callback does not count as
 * "directly in this statement."
 */
function containsDirectCallToAny(root: TsNode, names: string[]): boolean {
  let found = false;
  function visit(node: TsNode): void {
    if (found) return;
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isFunctionDeclaration(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.includes(node.expression.text)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}

/**
 * Round 2 fix (reachability): only the handler's OWN top-level statements
 * are scanned for authorizeToolRequest / bearerToken / validateLibraryToken
 * (never nested inside an if/loop/function, so dead/decoy code cannot
 * count), and the scan stops at the first unconditional top-level
 * return/throw -- anything after is genuinely unreachable JS.
 * `isLocalSameOrigin` is checked over the WHOLE handler (any branch)
 * because its mere presence is what disqualifies the self-service-bearer
 * shape: that pattern means "token possession is the ONLY accepted proof,
 * no loopback alternative." POST /api/library/ingest calls both
 * bearerToken and validateLibraryToken at its own top level too, but it
 * ALSO calls isLocalSameOrigin as an alternative acceptance branch, so it
 * must NOT classify as the bearer pattern -- verified directly against the
 * real handler before this file was submitted, not just from the
 * reviewer's named finding.
 */
function collectTopLevelGuardSignals(handler: TsNode): {
  authorizeToolRequest: boolean;
  bearerToken: boolean;
  validateLibraryToken: boolean;
  isLocalSameOrigin: boolean;
} {
  const out = { authorizeToolRequest: false, bearerToken: false, validateLibraryToken: false, isLocalSameOrigin: false };
  let fnBody: TsNode | undefined;
  if ((ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) && handler.body && ts.isBlock(handler.body)) {
    fnBody = handler.body;
  }
  if (!fnBody) return out; // cannot reason about it -- fail closed (no signals found)
  // BUG FIXED BEFORE SUBMISSION (caught by a direct dry-run against the real
  // handler, not just re-reading the diff): searching from `handler` itself
  // is wrong -- containsDirectCallToAny's own function-boundary guard fires
  // on the FIRST node it visits when that node IS a function/arrow literal,
  // so passing the handler (always an arrow function here) as `root` made
  // the search return false immediately without ever descending. Search
  // from `fnBody` (a Block, not a function literal) instead, so the
  // boundary guard only fires on NESTED function literals as intended.
  out.isLocalSameOrigin = containsDirectCallToAny(fnBody, ['isLocalSameOrigin']);
  for (const stmt of (fnBody as unknown as { statements: TsNode[] }).statements) {
    if (containsDirectCallToAny(stmt, ['authorizeToolRequest'])) out.authorizeToolRequest = true;
    if (containsDirectCallToAny(stmt, ['bearerToken'])) out.bearerToken = true;
    if (containsDirectCallToAny(stmt, ['validateLibraryToken'])) out.validateLibraryToken = true;
    if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) break;
  }
  return out;
}

function collectRouteRegistrations(sourceText: string, label: string): CollectResult {
  const sourceFile = ts.createSourceFile(label, sourceText, ts.ScriptTarget.Latest, true);
  const scopeRoot = findFunctionBody(sourceFile, 'registerLibraryRoutes');
  if (!scopeRoot) throw new Error(`registerLibraryRoutes function body not found in ${label}`);
  const httpMethods = new Set(['get', 'post', 'delete', 'options', 'put', 'patch']);
  const registrations: RouteRegistration[] = [];
  const seen = new Map<string, number>();
  function visit(node: TsNode): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'app' &&
      httpMethods.has(node.expression.name.text)
    ) {
      const method = node.expression.name.text;
      const [pathArg, ...rest] = node.arguments;
      if (pathArg && ts.isStringLiteral(pathArg) && rest.length > 0) {
        const finalHandler = rest[rest.length - 1]!;
        const middlewareArgs = rest.slice(0, -1);
        const hasRequireLocalDaemonRequest = middlewareArgs.some(
          (a) => ts.isIdentifier(a) && a.text === 'requireLocalDaemonRequest',
        );
        const signals = collectTopLevelGuardSignals(finalHandler);
        const hasSelfServiceBearerPattern = signals.bearerToken && signals.validateLibraryToken && !signals.isLocalSameOrigin;
        const key = `${method.toUpperCase()} ${pathArg.text}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        registrations.push({
          method: method.toUpperCase(),
          routePath: pathArg.text,
          hasRequireLocalDaemonRequest,
          hasAuthorizeToolRequest: signals.authorizeToolRequest,
          hasSelfServiceBearerPattern,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(scopeRoot);
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  return { registrations, duplicates };
}

/** Exposure per W9-ingest-tranche.md S9-2, mechanically derived, never trusted from the matrix. */
function classifyExposure(reg: RouteRegistration): number {
  if (reg.hasRequireLocalDaemonRequest) return 0;
  if (reg.hasAuthorizeToolRequest) return 1;
  if (reg.hasSelfServiceBearerPattern) return 2;
  return 3;
}

// -----------------------------------------------------------------------
// Reviewer-owned, frozen impact FLOORS (ruling 5). Round 2 fix: `GET
// /api/library/assets` was wrongly frozen at 0 -- it calls
// `runReconcile(false)` (library.ts:537), which inserts library_assets rows
// via library-sync.ts (a real, if throttled, mutation: RECONCILE_THROTTLE_MS
// caps it to once per 10s program-wide, not per caller -- see PRD S9-2 for
// the full note). Corrected to floor 2 (score 5, P0). Every other GET route
// was re-audited for the same hidden-mutation shape and none other
// qualifies: GET /connection, /assets/:id, /clipper-probe are pure reads;
// /raw, /figma, /element stream stored bytes with no write; /events adds an
// in-memory (non-persisted, non-cross-request) SSE listener only.
// -----------------------------------------------------------------------
const FROZEN_IMPACT_FLOORS: Record<string, number> = {
  'POST /api/library/pair': 0,
  'OPTIONS /api/library/pair/confirm': 0,
  'POST /api/library/pair/confirm': 2,
  'GET /api/library/connection': 0,
  'POST /api/library/pair/revoke': 2,
  'OPTIONS /api/library/pair/revoke': 0,
  'POST /api/library/pair/rotate': 2,
  'OPTIONS /api/library/pair/rotate': 0,
  'OPTIONS /api/library/ingest': 0,
  'POST /api/library/ingest': 3,
  'GET /api/library/clipper-probe': 0,
  'GET /api/library/assets': 2,
  'POST /api/library/sync': 2,
  'GET /api/library/assets/:id': 0,
  'DELETE /api/library/assets/:id': 2,
  'GET /api/library/assets/:id/raw': 1,
  'GET /api/library/assets/:id/figma': 1,
  'GET /api/library/assets/:id/element': 1,
  'POST /api/library/assets/:id/apply': 2,
  'POST /api/library/assets/:id/edit-as-page': 2,
  'POST /api/tools/library/search': 0,
  'POST /api/tools/library/apply': 2,
  'GET /api/library/events': 0,
};
const FROZEN_ROUTE_KEYS = new Set(Object.keys(FROZEN_IMPACT_FLOORS));
function tierFor(score: number): 'P0' | 'P1' | 'P2' {
  if (score >= 5) return 'P0';
  if (score === 4) return 'P1';
  return 'P2';
}

// -----------------------------------------------------------------------
// F2 fix: attribution-authority hardening. Every required field must clear
// a placeholder floor ("x" no longer passes); `authn` must additionally
// contain a keyword matching the row's own mechanically-derived exposure
// class -- the one field the PRD claims IS partially mechanical.
// -----------------------------------------------------------------------
const PLACEHOLDER_DENYLIST = new Set([
  'x', 'xx', 'xxx', 'n/a', 'na', 'tbd', 'todo', 'none', 'unknown', 'owner',
  'test', 'foo', 'bar', '...', '-', 'fixme', 'placeholder', 'value', 'string',
  'description', 'field', 'tbd.', 'todo:',
]);
const MIN_FIELD_LENGTH = 12;
function isPlaceholderText(raw: unknown): boolean {
  if (typeof raw !== 'string') return true;
  const t = raw.trim().toLowerCase();
  if (t.length < MIN_FIELD_LENGTH) return true;
  if (PLACEHOLDER_DENYLIST.has(t)) return true;
  if (/^(.)\1*$/.test(t)) return true; // any single character repeated
  return false;
}
const AUTHN_KEYWORD_BY_EXPOSURE: Record<number, RegExp> = {
  0: /requireLocalDaemonRequest|loopback/i,
  1: /authorizeToolRequest|tool[- ]token/i,
  2: /bearer|self-service|proof of possession/i,
  3: /\bnone\b|no gate|ungated|zero-config|pairing code/i,
};

// F3 fix: mechanical route/mechanism association for testRef binding --
// derived from the route's OWN path (never a hand-authored per-row table),
// so a cited test must textually relate to the route it attributes.
function routeAssociationTerms(routeKey: string): string[] {
  const routePath = routeKey.split(' ').slice(1).join(' ');
  const stripped = routePath.replace(/^\/api\/(?:tools\/)?library\//, '').replace(/:id/g, '');
  return stripped
    .split(/[/-]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3);
}

// F3 fix: semantic (not substring) validation for C9-6's rate/volume
// control mechanism text. "no rate limit exists" contains "rate" and
// "limit" but is a NEGATION, not an enforcement claim -- the negation
// pattern independently vetoes it even though the enforcement pattern
// would otherwise match.
const RATE_ENFORCEMENT_PATTERN =
  /\b(rate|volume|throttl\w*)\b[^.\n]{0,30}\b(limit|cap|control)s?\b|\b(limit|cap)s?\b[^.\n]{0,30}\b(enforc\w*|reject|429|block|throttl\w*)/i;
const RATE_NEGATION_PATTERN = /\b(no|not|n't|lacks?|absen[ct]|without|missing|does\s+not|doesn't)\b[^.\n]{0,40}\b(rate|volume|throttl\w*|limit|cap)\b/i;

// F3 fix: a paired positive+negative control signal, replacing the raw
// ">=2 passing assertions" count with real content.
const POSITIVE_SIGNAL = /\b(accept|success|succeed|allow|valid|ok|round-trip|correctly)\b/i;
const NEGATIVE_SIGNAL = /\b(reject|den(?:y|ied)|forbid|invalid|fail|block|refus\w*)\b/i;

// F3 fix: structured red-transcript header (PARENT_SHA / COMMAND / TEST),
// replacing "any 100-char file containing RED or FAIL."
function parseRedTranscript(content: string): {
  parentSha: string | undefined;
  command: string | undefined;
  test: string | undefined;
  body: string;
} {
  const lines = content.split('\n');
  let parentSha: string | undefined;
  let command: string | undefined;
  let test: string | undefined;
  let bodyStartIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^---+\s*$/.test(l)) {
      bodyStartIdx = i + 1;
      break;
    }
    const pm = /^PARENT_SHA:\s*(\S+)/.exec(l);
    if (pm) parentSha = pm[1];
    const cm = /^COMMAND:\s*(.+)$/.exec(l);
    if (cm) command = cm[1]!.trim();
    const tm = /^TEST:\s*(.+)$/.exec(l);
    if (tm) test = tm[1]!.trim();
  }
  return { parentSha, command, test, body: lines.slice(bodyStartIdx).join('\n') };
}

// F2 fix: structured DECISIONS.md accepted-risk entries. `decisionRef` must
// equal a UNIQUE `### W9-ACCEPT-<slug>` heading whose block carries all five
// required fields -- a substring match against arbitrary prose no longer
// qualifies.
interface DecisionEntry {
  id: string;
  route: string;
  acceptedRisk: string;
  accepter: string;
  date: string;
  rationale: string;
}
function parseDecisionEntries(text: string): { entries: Map<string, DecisionEntry>; duplicateIds: Set<string> } {
  const headingRe = /^###\s+(W9-ACCEPT-[A-Za-z0-9-]+)\s*$/gm;
  const matches = [...text.matchAll(headingRe)];
  const idCounts = new Map<string, number>();
  for (const m of matches) idCounts.set(m[1]!, (idCounts.get(m[1]!) ?? 0) + 1);
  const duplicateIds = new Set([...idCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  const entries = new Map<string, DecisionEntry>();
  for (const m of matches) {
    const id = m[1]!;
    if (duplicateIds.has(id)) continue; // ambiguous -- never resolvable
    const start = m.index! + m[0].length;
    const rest = text.slice(start);
    const nextHeadingRel = rest.search(/^#{2,3}\s+/m);
    const blockText = nextHeadingRel === -1 ? rest : rest.slice(0, nextHeadingRel);
    const routeM = /^-\s*Route:\s*`([^`]+)`\s*$/im.exec(blockText);
    const riskM = /^-\s*Accepted risk:\s*(.+)$/im.exec(blockText);
    const accepterM = /^-\s*Accepter:\s*(.+)$/im.exec(blockText);
    const dateM = /^-\s*Date:\s*(\d{4}-\d{2}-\d{2})/im.exec(blockText);
    const rationaleM = /^-\s*Rationale:\s*(.+)$/im.exec(blockText);
    if (routeM && riskM && accepterM && dateM && rationaleM) {
      entries.set(id, {
        id,
        route: routeM[1]!.trim(),
        acceptedRisk: riskM[1]!.trim(),
        accepter: accepterM[1]!.trim(),
        date: dateM[1]!,
        rationale: rationaleM[1]!.trim(),
      });
    }
  }
  return { entries, duplicateIds };
}

// -----------------------------------------------------------------------
// Real daemon boot for route-inventory introspection (C9-1). Isolated:
// port 0, fresh mkdtemp OD_DATA_DIR, killed by its own exact PID.
// -----------------------------------------------------------------------
async function bootDaemonForRouteInventory(): Promise<{ method: string; path: string }[]> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w9-ingest-verify-'));
  const bootScript = `
import { pathToFileURL } from 'node:url';
process.env.OD_DATA_DIR = ${JSON.stringify(dataDir)};
const mod = await import(pathToFileURL(${JSON.stringify(path.join(repoRoot, 'apps/daemon/src/server.ts'))}).href);
const started = await mod.startServer({ port: 0, host: '127.0.0.1', returnServer: true });
console.log('OD_W9_INGEST_VERIFIER_READY ' + JSON.stringify({ routeInventory: started.routeInventory }));
await started.shutdown();
process.exit(0);
`;
  const scriptPath = path.join(proofDir, `.boot-daemon.${process.pid}.${crypto.randomBytes(3).toString('hex')}.mjs`);
  fs.writeFileSync(scriptPath, bootScript);
  const child = spawn('pnpm', ['exec', 'tsx', scriptPath], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffered = '';
  const routes = await new Promise<{ method: string; path: string }[] | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), 60_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const line = buffered.split('\n').find((l) => l.startsWith('OD_W9_INGEST_VERIFIER_READY '));
      if (line) {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(line.slice('OD_W9_INGEST_VERIFIER_READY '.length)) as {
            routeInventory: { method: string; path: string }[];
          };
          resolve(parsed.routeInventory);
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
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      resolve();
    }, 5_000);
    child.kill('SIGTERM');
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
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  if (!routes) throw new Error(`daemon failed to boot / report routeInventory within 60s (stdout tail: ${buffered.slice(-2000)})`);
  return routes;
}

// -----------------------------------------------------------------------
// Glob apps/daemon/tests/library-*.test.ts at run time -- never a fixed
// list an implementer could route new coverage around.
// -----------------------------------------------------------------------
function discoverLibraryTestFiles(): string[] {
  const testsDir = path.join(repoRoot, 'apps/daemon/tests');
  return fs
    .readdirSync(testsDir)
    .filter((f) => /^library-.*\.test\.ts$/.test(f))
    .sort()
    .map((f) => `tests/${f}`);
}
interface AssertionResult {
  fullName: string;
  status: string;
}
interface FileTestResult {
  name: string; // absolute path to the test file, per vitest's json reporter
  assertionResults: AssertionResult[];
}
interface SuiteJson {
  numFailedTests: number;
  numPassedTests: number;
  numPendingTests?: number;
  testResults: FileTestResult[];
}
function runLibrarySuite(testFiles: string[], attempt: number): { suite: { status: number }; data: SuiteJson | null } {
  const jsonPath = path.join(proofDir, `suite-run.attempt-${attempt}.json`);
  const suite = sh('pnpm', [
    '--filter',
    '@open-design/daemon',
    'exec',
    'vitest',
    'run',
    '-c',
    'vitest.config.ts',
    '--reporter=json',
    `--outputFile=${jsonPath}`,
    ...testFiles,
  ]);
  let data: SuiteJson | null = null;
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as SuiteJson;
  } catch {
    data = null;
  }
  return { suite, data };
}

async function main(): Promise<void> {
  // F5 fix: the placeholder write's OWN result is now checked. If even the
  // wroteOk:false placeholder cannot be written, abort -- proceeding would
  // risk leaving an earlier run's stale manifest as the only evidence on
  // disk, unflagged.
  const placeholderWrite = writeManifestFile(buildManifest(false, true, false));
  if (!placeholderWrite.written) {
    console.error('verify-w9-ingest: FATAL: could not write the initial wroteOk:false placeholder manifest -- aborting rather than risk leaving a stale prior manifest unflagged.');
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // Shared, computed once: baseCommit-derived route registrations (the
  // frozen ground truth) and HEAD-derived route registrations (what the
  // matrix, built during implementation, actually describes).
  // -----------------------------------------------------------------------
  let baseCommitCollect: CollectResult | null = null;
  let baseCommitError = '';
  try {
    const baseCommitText = readFileAtCommit(baseCommit, 'apps/daemon/src/routes/library.ts');
    baseCommitCollect = collectRouteRegistrations(baseCommitText, `${baseCommit}:routes/library.ts`);
  } catch (err) {
    baseCommitError = String((err as Error)?.stack ?? err);
  }
  let headCollect: CollectResult | null = null;
  let headError = '';
  try {
    const headText = fs.readFileSync(path.join(repoRoot, 'apps/daemon/src/routes/library.ts'), 'utf8');
    headCollect = collectRouteRegistrations(headText, 'HEAD:routes/library.ts');
  } catch (err) {
    headError = String((err as Error)?.stack ?? err);
  }
  const headExposureByKey = new Map<string, number>();
  if (headCollect) {
    for (const reg of headCollect.registrations) {
      headExposureByKey.set(`${reg.method} ${reg.routePath}`, classifyExposure(reg));
    }
  }

  // C9-1: route snapshot frozen at baseCommit, drift-checked against a real
  // daemon boot's live registration -- never a HEAD literal compared to HEAD.
  await checkCriterion('C9-1', async () => {
    if (!baseCommitCollect) {
      record('C9-1', `git show ${baseCommit}:apps/daemon/src/routes/library.ts`, 'frozen route set derives from baseCommit, not a HEAD literal', false, '', {
        detail: `could not derive baseCommit route set: ${baseCommitError}`,
      });
      return;
    }
    const baseKeys = new Set(baseCommitCollect.registrations.map((r) => `${r.method} ${r.routePath}`));
    const baseVsFrozenTableMissing = [...FROZEN_ROUTE_KEYS].filter((k) => !baseKeys.has(k));
    const baseVsFrozenTableExtra = [...baseKeys].filter((k) => !FROZEN_ROUTE_KEYS.has(k));
    if (baseCommitCollect.duplicates.length > 0 || baseVsFrozenTableMissing.length > 0 || baseVsFrozenTableExtra.length > 0) {
      record(
        'C9-1',
        `AST-scan git show ${baseCommit}:apps/daemon/src/routes/library.ts, scoped to registerLibraryRoutes`,
        'baseCommit route set matches the reviewer-frozen FROZEN_IMPACT_FLOORS key set exactly, with zero duplicate registrations',
        false,
        `baseCommit duplicates: ${baseCommitCollect.duplicates.join(', ') || 'none'}\nmissing from baseCommit vs frozen table: ${baseVsFrozenTableMissing.join(', ') || 'none'}\nextra in baseCommit vs frozen table: ${baseVsFrozenTableExtra.join(', ') || 'none'}`,
      );
      return;
    }
    const liveRoutesRaw = await bootDaemonForRouteInventory();
    const scopedLive = liveRoutesRaw.filter(
      (r) => (r.path.startsWith('/api/library') || r.path.startsWith('/api/tools/library')) && r.method !== 'USE' && r.method !== 'ALL',
    );
    const liveDuplicateCounts = new Map<string, number>();
    for (const r of scopedLive) {
      const k = `${r.method} ${r.path}`;
      liveDuplicateCounts.set(k, (liveDuplicateCounts.get(k) ?? 0) + 1);
    }
    const liveDuplicates = [...liveDuplicateCounts.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    const liveKeys = new Set(scopedLive.map((r) => `${r.method} ${r.path}`));
    const added = [...liveKeys].filter((k) => !FROZEN_ROUTE_KEYS.has(k));
    const removed = [...FROZEN_ROUTE_KEYS].filter((k) => !liveKeys.has(k));
    // Informational exposure histogram (baseCommit-derived), so a reader can
    // see the classifier's actual per-route output without needing a matrix
    // to exist yet -- C9-8 is the only criterion that GATES on this, but
    // nothing before it exercised the values themselves pre-implementation.
    const exposureHistogram = baseCommitCollect.registrations
      .map((r) => `${r.method} ${r.routePath} => exposure ${classifyExposure(r)}`)
      .join('\n');
    const ok = liveDuplicates.length === 0 && added.length === 0 && removed.length === 0;
    record(
      'C9-1',
      'baseCommit AST self-consistency + boot real daemon (port 0, isolated data dir) -> routeInventory filtered to /api/library/* + /api/tools/library/*',
      '23-route frozen snapshot (derived from baseCommit, self-consistent with the reviewer-frozen impact table) matches the live daemon\'s own route registration, zero drift, zero duplicate registrations',
      ok,
      `frozen=${FROZEN_ROUTE_KEYS.size} live(scoped)=${liveKeys.size} liveRaw=${scopedLive.length}\nlive duplicates: ${liveDuplicates.join(', ') || 'none'}\nadded (drift, not in frozen set): ${added.join(', ') || 'none'}\nremoved (frozen route missing from live daemon): ${removed.join(', ') || 'none'}\n\nbaseCommit exposure histogram (informational):\n${exposureHistogram}`,
    );
  });

  // C9-2: existing suite green over a GLOBBED file set, pending/skipped
  // reporter counts checked, broadened skip-marker regex.
  const testFiles = discoverLibraryTestFiles();
  let suiteRun = runLibrarySuite(testFiles, 1);
  let suiteAttempts = 1;
  if (suiteRun.suite.status !== 0 || (suiteRun.data?.numFailedTests ?? 1) !== 0) {
    suiteRun = runLibrarySuite(testFiles, 2);
    suiteAttempts = 2;
  }
  const bannedMarker = /\b(?:it|describe|test)\s*(?:\.\s*(?:skip|only|todo)\s*\(|\[\s*['"](?:skip|only|todo)['"]\s*\]\s*\()/;
  const markerHits: string[] = [];
  for (const rel of testFiles) {
    const text = fs.readFileSync(path.join(repoRoot, 'apps/daemon', rel), 'utf8');
    if (bannedMarker.test(text)) markerHits.push(rel);
  }
  const allTests: AssertionResult[] = suiteRun.data ? suiteRun.data.testResults.flatMap((t) => t.assertionResults) : [];
  const passedTestNames = new Set(allTests.filter((t) => t.status === 'passed').map((t) => t.fullName));
  const nonPassed = allTests.filter((t) => t.status !== 'passed');
  await checkCriterion('C9-2', () => {
    const ok =
      suiteRun.suite.status === 0 &&
      (suiteRun.data?.numFailedTests ?? 1) === 0 &&
      (suiteRun.data?.numPendingTests ?? 0) === 0 &&
      nonPassed.length === 0 &&
      markerHits.length === 0 &&
      allTests.length > 0 &&
      testFiles.length > 0;
    record(
      'C9-2',
      `vitest --reporter=json over ${testFiles.length} glob-discovered library-*.test.ts files (attempts=${suiteAttempts})`,
      'full existing ingest-security suite green (zero failed, zero pending/skipped), zero skip/only/todo markers, discovered by glob not a fixed list',
      ok,
      `discovered files: ${testFiles.join(', ')}\nsuite exit=${suiteRun.suite.status} failed=${suiteRun.data?.numFailedTests ?? 'unknown'} pending=${suiteRun.data?.numPendingTests ?? 'unknown'} passed=${suiteRun.data?.numPassedTests ?? 'unknown'} totalAssertions=${allTests.length}\nnon-passed: ${nonPassed.map((t) => `${t.status}:${t.fullName}`).join('\n') || 'none'}\nbanned markers: ${markerHits.join(', ') || 'none'}\nattempts=${suiteAttempts}`,
    );
  });

  // F3 fix: "new test" is now keyed on the exact test TITLE existing in the
  // file's baseCommit content, not whole-file existence -- a test appended
  // to an already-existing file no longer skips red evidence.
  const fileTextAtBaseCache = new Map<string, string | null>();
  function readFileAtCommitCached(commit: string, relPath: string): string | null {
    const cacheKey = `${commit}:${relPath}`;
    if (fileTextAtBaseCache.has(cacheKey)) return fileTextAtBaseCache.get(cacheKey)!;
    try {
      const text = readFileAtCommit(commit, relPath);
      fileTextAtBaseCache.set(cacheKey, text);
      return text;
    } catch {
      fileTextAtBaseCache.set(cacheKey, null);
      return null;
    }
  }
  function testTitleExistedAtBaseCommit(rel: string, fullName: string): boolean {
    const baseContent = readFileAtCommitCached(baseCommit, `apps/daemon/${rel}`);
    if (baseContent === null) return false;
    const title = fullName.split(' > ').pop() ?? fullName;
    const titleEscaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`['"\`]${titleEscaped}['"\`]`);
    return re.test(baseContent);
  }
  function findContainingFile(fullName: string): { rel: string } | null {
    for (const t of suiteRun.data?.testResults ?? []) {
      if (t.assertionResults.some((a) => a.fullName === fullName)) {
        return { rel: path.relative(path.join(repoRoot, 'apps/daemon'), t.name) };
      }
    }
    return null;
  }

  // Attribution matrix: parsed once, reused across C9-3..C9-8.
  const matrixPath = path.join(repoRoot, 'docs/security/library-ingest-attribution.json');
  interface AttributionRow {
    method?: unknown;
    path?: unknown;
    owner?: unknown;
    authn?: unknown;
    authz?: unknown;
    inputValidation?: unknown;
    sizeRateLimit?: unknown;
    testRef?: unknown;
    riskScore?: { exposure?: unknown; impact?: unknown; score?: unknown; tier?: unknown };
    control?: { mechanism?: unknown; testRef?: unknown } | null;
    acceptedRisk?: { decisionRef?: unknown } | null;
  }
  let matrixRows: AttributionRow[] | null = null;
  let matrixParseError = '';
  if (fs.existsSync(matrixPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(matrixPath, 'utf8')) as { rows?: AttributionRow[] };
      matrixRows = Array.isArray(raw.rows) ? raw.rows : null;
      if (!matrixRows) matrixParseError = 'top-level "rows" is not an array';
    } catch (err) {
      matrixParseError = `JSON parse failed: ${String(err)}`;
    }
  } else {
    matrixParseError = `file does not exist: ${path.relative(repoRoot, matrixPath)}`;
  }

  // C9-3: matrix exists and covers exactly the frozen route set.
  await checkCriterion('C9-3', () => {
    if (!matrixRows) {
      record('C9-3', `read ${path.relative(repoRoot, matrixPath)}`, 'exactly one row per frozen route, no orphans, no gaps', false, '', {
        detail: matrixParseError,
      });
      return;
    }
    const rowKeys = matrixRows
      .filter((r) => typeof r.method === 'string' && typeof r.path === 'string')
      .map((r) => `${r.method} ${r.path}`);
    const duplicates = rowKeys.filter((k, i) => rowKeys.indexOf(k) !== i);
    const orphans = [...new Set(rowKeys)].filter((k) => !FROZEN_ROUTE_KEYS.has(k));
    const missing = [...FROZEN_ROUTE_KEYS].filter((k) => !rowKeys.includes(k));
    const ok = orphans.length === 0 && missing.length === 0 && duplicates.length === 0 && rowKeys.length === FROZEN_ROUTE_KEYS.size;
    record(
      'C9-3',
      `read ${path.relative(repoRoot, matrixPath)}`,
      'exactly one row per frozen route, no orphans, no gaps, no duplicates',
      ok,
      `rows=${matrixRows.length} frozen=${FROZEN_ROUTE_KEYS.size}\nmissing: ${missing.join(', ') || 'none'}\norphans: ${orphans.join(', ') || 'none'}\nduplicates: ${duplicates.join(', ') || 'none'}`,
    );
  });

  // DECISIONS.md@baseCommit, parsed once for both C9-4 and C9-6.
  let decisionsAtBase = '';
  let decisionsAtBaseError = '';
  try {
    decisionsAtBase = readFileAtCommit(baseCommit, 'docs/plans/waves/DECISIONS.md');
  } catch (err) {
    decisionsAtBaseError = String(err);
  }
  const { entries: decisionEntries, duplicateIds: decisionDuplicateIds } = decisionsAtBaseError
    ? { entries: new Map<string, DecisionEntry>(), duplicateIds: new Set<string>() }
    : parseDecisionEntries(decisionsAtBase);
  const implAuthorsFullRange = commitAuthorsBetween(baseCommit, headSha);

  function checkAcceptedRisk(ref: string, routeKey: string): string[] {
    const problems: string[] = [];
    if (!ref) {
      problems.push(`acceptedRisk.decisionRef missing/empty`);
      return problems;
    }
    if (decisionsAtBaseError) {
      problems.push(`could not read DECISIONS.md at baseCommit: ${decisionsAtBaseError}`);
      return problems;
    }
    if (decisionDuplicateIds.has(ref)) {
      problems.push(`decisionRef "${ref}" is ambiguous -- appears more than once as a "### W9-ACCEPT-*" heading in DECISIONS.md@baseCommit`);
      return problems;
    }
    const entry = decisionEntries.get(ref);
    if (!entry) {
      problems.push(`decisionRef "${ref}" is not a valid, fully-structured "### W9-ACCEPT-*" entry (Route/Accepted risk/Accepter/Date/Rationale) in DECISIONS.md@baseCommit`);
      return problems;
    }
    if (entry.route !== routeKey) {
      problems.push(`decisionRef "${ref}" is bound to Route "${entry.route}", not this row's route "${routeKey}"`);
    }
    if (implAuthorsFullRange.has(entry.accepter.trim().toLowerCase())) {
      problems.push(`decisionRef "${ref}"'s Accepter ("${entry.accepter}") matches a commit author in baseCommit..HEAD -- cannot self-accept its own risk`);
    }
    return problems;
  }

  // C9-4: full attribution per S6. Round 2 fix: fields must clear a
  // placeholder floor (not just be non-empty); `authn` must additionally
  // match the mechanically-derived exposure class's keyword; `acceptedRisk`
  // is now a structured, unique, route-bound, non-self-accepted DECISIONS.md
  // entry, never a substring match.
  await checkCriterion('C9-4', () => {
    if (!matrixRows) {
      record('C9-4', '', 'every row carries all six structured fields; exposure===3 rows carry control XOR a structured DECISIONS.md-at-baseCommit acceptedRisk reference', false, '', {
        detail: 'no matrix to check',
      });
      return;
    }
    const problems: string[] = [];
    let attributed = 0;
    let unattributed = 0;
    let knownVulnerable = 0;
    for (const row of matrixRows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      const mechanicalExposure = headExposureByKey.get(key);
      let fieldsOk = true;
      for (const field of ['owner', 'authz', 'inputValidation', 'sizeRateLimit'] as const) {
        if (isPlaceholderText(row[field])) {
          problems.push(`${key}: "${field}" is empty, too short, or a recognized placeholder`);
          fieldsOk = false;
        }
      }
      if (isPlaceholderText(row.testRef)) {
        problems.push(`${key}: "testRef" is empty, too short, or a recognized placeholder`);
        fieldsOk = false;
      }
      if (isPlaceholderText(row.authn)) {
        problems.push(`${key}: "authn" is empty, too short, or a recognized placeholder`);
        fieldsOk = false;
      } else if (mechanicalExposure !== undefined) {
        const expectedKeyword = AUTHN_KEYWORD_BY_EXPOSURE[mechanicalExposure];
        if (expectedKeyword && !expectedKeyword.test(String(row.authn))) {
          problems.push(`${key}: "authn" does not name the mechanically-derived exposure-${mechanicalExposure} mechanism (expected to match ${expectedKeyword})`);
          fieldsOk = false;
        }
      }
      const noGateMechanically = mechanicalExposure === 3;
      const hasControl = row.control != null;
      const hasAcceptedRisk = row.acceptedRisk != null;
      if (noGateMechanically) {
        if (hasControl === hasAcceptedRisk) {
          problems.push(`${key}: exposure===3 (mechanically no route-level gate) requires exactly one of control/acceptedRisk (control=${hasControl}, acceptedRisk=${hasAcceptedRisk})`);
        } else if (hasAcceptedRisk) {
          const ar = row.acceptedRisk as { decisionRef?: unknown };
          const ref = typeof ar.decisionRef === 'string' ? ar.decisionRef.trim() : '';
          const arProblems = checkAcceptedRisk(ref, key);
          if (arProblems.length > 0) problems.push(...arProblems.map((p) => `${key}: ${p}`));
          else knownVulnerable += 1;
        } else if (hasControl) {
          attributed += 1; // control validity itself is checked by C9-5/C9-6
        }
        if (!hasControl && !hasAcceptedRisk) unattributed += 1;
      } else {
        attributed += 1;
      }
      if (!fieldsOk) problems.push(`${key}: incomplete/placeholder required fields`);
    }
    const ok = problems.length === 0;
    record(
      'C9-4',
      'placeholder-floor + authn-keyword-vs-exposure check per field; acceptedRisk resolved via a unique, structured, route-bound, non-self-accepted DECISIONS.md@baseCommit entry',
      'no field may be a bare placeholder; authn must name the real mechanical class; every mechanically-ungated row carries control XOR a verified accepted-risk decision',
      ok,
      `attributed=${attributed} unattributed(no control, no accepted risk)=${unattributed} known-vulnerable(accepted risk on file)=${knownVulnerable} total=${matrixRows.length}\n${problems.join('\n') || 'all rows fully attributed'}`,
    );
  });

  // C9-5: exact-fullName + route-association + uniqueness test binding.
  // New tests (title not present at baseCommit) require a structured red
  // transcript (PARENT_SHA resolves + is an ancestor of HEAD, COMMAND looks
  // like a real vitest invocation, TEST matches exactly) plus a genuine
  // paired positive+negative control in the same file.
  const redDir = path.join(repoRoot, 'docs/security/library-ingest-red');
  function checkTestRef(ref: string, routeKey: string): string[] {
    const problems: string[] = [];
    if (!passedTestNames.has(ref)) {
      problems.push(`testRef does not exactly match any PASSED test fullName this run: "${ref}"`);
      return problems;
    }
    const terms = routeAssociationTerms(routeKey);
    const refLower = ref.toLowerCase();
    if (terms.length > 0 && !terms.some((t) => refLower.includes(t.toLowerCase()))) {
      problems.push(`testRef "${ref}" is not associated with route ${routeKey} by any path-derived term (${terms.join(', ')})`);
    }
    const containing = findContainingFile(ref);
    if (!containing) {
      problems.push(`testRef matched a passed test but its containing file could not be resolved: "${ref}"`);
      return problems;
    }
    const isNew = !testTitleExistedAtBaseCommit(containing.rel, ref);
    if (isNew) {
      const artifactPath = path.join(redDir, `${slugify(ref)}.txt`);
      if (!fs.existsSync(artifactPath)) {
        problems.push(`new test (title not present at baseCommit in ${containing.rel}) cited by testRef "${ref}" has no red-transcript artifact at docs/security/library-ingest-red/${slugify(ref)}.txt`);
      } else {
        const content = fs.readFileSync(artifactPath, 'utf8');
        const parsed = parseRedTranscript(content);
        if (!parsed.parentSha || !/^[0-9a-f]{7,40}$/i.test(parsed.parentSha)) {
          problems.push(`red transcript for "${ref}": PARENT_SHA missing or not a plausible git SHA`);
        } else if (!resolveCommit(parsed.parentSha)) {
          problems.push(`red transcript for "${ref}": PARENT_SHA "${parsed.parentSha}" does not resolve to a real commit`);
        } else if (!isAncestor(parsed.parentSha, headSha)) {
          problems.push(`red transcript for "${ref}": PARENT_SHA "${parsed.parentSha}" is not an ancestor of HEAD`);
        }
        if (!parsed.command || !/vitest/i.test(parsed.command)) {
          problems.push(`red transcript for "${ref}": COMMAND missing or does not look like a vitest invocation`);
        }
        if (parsed.test !== ref) {
          problems.push(`red transcript for "${ref}": TEST field ("${parsed.test ?? ''}") does not exactly match this testRef`);
        }
        if (parsed.body.trim().length < 80 || !/\b(RED|FAIL(?:ED)?)\b/i.test(parsed.body)) {
          problems.push(`red transcript for "${ref}": output body too short or lacks a RED/FAIL marker`);
        }
      }
      const fileResult = (suiteRun.data?.testResults ?? []).find(
        (t) => path.relative(path.join(repoRoot, 'apps/daemon'), t.name) === containing.rel,
      );
      const passedInFile = fileResult ? fileResult.assertionResults.filter((a) => a.status === 'passed') : [];
      const hasPositive = passedInFile.some((a) => POSITIVE_SIGNAL.test(a.fullName));
      const hasNegative = passedInFile.some((a) => NEGATIVE_SIGNAL.test(a.fullName));
      if (passedInFile.length < 2 || !hasPositive || !hasNegative) {
        problems.push(
          `new-control testRef "${ref}"'s file must contain a paired positive+negative control (found ${passedInFile.length} passing, positive-signal=${hasPositive}, negative-signal=${hasNegative}) -- R4`,
        );
      }
    }
    return problems;
  }
  await checkCriterion('C9-5', () => {
    if (!matrixRows) {
      record('C9-5', '', 'every testRef exactly matches a passed, route-associated test, unique per row; new tests carry structured red evidence + a paired control', false, '', {
        detail: 'no matrix to check',
      });
      return;
    }
    const primaryRefs = matrixRows.map((r) => (typeof r.testRef === 'string' ? r.testRef.trim() : ''));
    const dupPrimary = new Set(primaryRefs.filter((r, i) => r && primaryRefs.indexOf(r) !== i));
    const problems: string[] = [];
    if (dupPrimary.size > 0) {
      problems.push(`primary testRef must be unique per row; duplicated across multiple rows: ${[...dupPrimary].join(', ')}`);
    }
    let citedCount = 0;
    for (const row of matrixRows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      if (typeof row.testRef === 'string' && row.testRef.trim()) {
        citedCount += 1;
        problems.push(...checkTestRef(row.testRef.trim(), key).map((p) => `${key} testRef: ${p}`));
      }
      if (row.control && typeof row.control.testRef === 'string' && row.control.testRef.trim()) {
        citedCount += 1;
        problems.push(...checkTestRef(row.control.testRef.trim(), key).map((p) => `${key} control.testRef: ${p}`));
      }
    }
    record(
      'C9-5',
      'exact fullName + route-association-term match against the C9-2 vitest run; primary testRef unique per row; new-file testRefs cross-checked against docs/security/library-ingest-red/',
      'every cited testRef exactly matches a real PASSED, route-associated test; no two rows share a primary testRef; new controls carry structured red evidence and a genuine paired control',
      problems.length === 0 && citedCount > 0,
      `citations checked=${citedCount}\n${problems.join('\n') || 'all citations matched and (where new) carried valid red evidence'}`,
    );
  });

  // C9-6: every row whose mechanically-verified tier is P0 must resolve its
  // sizeRateLimit dimension with a REAL, semantically-enforcement-shaped,
  // passing volume/rate-control test reference, or a verified acceptedRisk.
  await checkCriterion('C9-6', () => {
    if (!matrixRows) {
      record('C9-6', '', 'every P0-tier row resolves sizeRateLimit with a real, semantically-validated control test or verified acceptedRisk', false, '', {
        detail: 'no matrix to check',
      });
      return;
    }
    const problems: string[] = [];
    let p0Count = 0;
    for (const row of matrixRows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      const tier = row.riskScore?.tier;
      if (tier !== 'P0') continue;
      p0Count += 1;
      const hasControl = row.control != null;
      const hasAcceptedRisk = row.acceptedRisk != null;
      if (hasControl === hasAcceptedRisk) {
        problems.push(`${key} (P0): sizeRateLimit must resolve with exactly one of control/acceptedRisk (control=${hasControl}, acceptedRisk=${hasAcceptedRisk})`);
        continue;
      }
      if (hasControl) {
        const c = row.control as { mechanism?: unknown; testRef?: unknown };
        const mechanism = typeof c.mechanism === 'string' ? c.mechanism : '';
        const enforced = RATE_ENFORCEMENT_PATTERN.test(mechanism) && !RATE_NEGATION_PATTERN.test(mechanism);
        if (!enforced) {
          problems.push(`${key} (P0): control.mechanism "${mechanism}" does not read as an ENFORCED rate/volume/throttle control (must match an enforcement pattern and not a negation)`);
        }
        const ref = typeof c.testRef === 'string' ? c.testRef.trim() : '';
        if (!ref) {
          problems.push(`${key} (P0): control.testRef missing`);
        } else {
          const testProblems = checkTestRef(ref, key);
          if (testProblems.length > 0) problems.push(`${key} (P0) control.testRef: ${testProblems.join('; ')}`);
        }
      } else if (hasAcceptedRisk) {
        const ar = row.acceptedRisk as { decisionRef?: unknown };
        const ref = typeof ar.decisionRef === 'string' ? ar.decisionRef.trim() : '';
        const arProblems = checkAcceptedRisk(ref, key);
        if (arProblems.length > 0) problems.push(...arProblems.map((p) => `${key} (P0): ${p}`));
      }
    }
    record(
      'C9-6',
      "every row with riskScore.tier === 'P0' resolves sizeRateLimit with a semantically-enforced, verified rate/volume control test or a verified accepted risk",
      'mechanism text must match an enforcement pattern and NOT a negation pattern ("no rate limit exists" fails); control.testRef and acceptedRisk both fully re-validated',
      problems.length === 0 && p0Count > 0,
      `P0 rows found: ${p0Count}\n${problems.join('\n') || 'all P0 rows resolved'}`,
    );
  });

  // C9-7: threat-model doc extended, section boundary correctly extracted,
  // exact fullName citations, and every P0 route named inside the SAME
  // cited-and-valid bullet line (not merely present anywhere in prose).
  await checkCriterion('C9-7', () => {
    const threatModelPath = path.join(repoRoot, 'docs/security/daemon-threat-model.md');
    if (!fs.existsSync(threatModelPath)) {
      record('C9-7', '', 'daemon-threat-model.md carries a bounded Wave 9 section whose [C9-N] bullets exactly cite real passing tests, one per P0 route, in the SAME bullet', false, '', {
        detail: 'daemon-threat-model.md does not exist',
      });
      return;
    }
    const text = fs.readFileSync(threatModelPath, 'utf8');
    const afterHeading = text.split(/^##\s+Wave 9\b.*$/m)[1];
    const waveSection = afterHeading?.split(/\n##\s+/)[0];
    if (!waveSection) {
      record('C9-7', `read ${path.relative(repoRoot, threatModelPath)}`, 'a bounded "## Wave 9" section exists (up to the next "## " heading)', false, text.slice(0, 500), {
        detail: 'no "## Wave 9" heading found',
      });
      return;
    }
    const bulletLines = waveSection.split('\n').filter((l) => /\[C9-\d+\]/.test(l));
    const problems: string[] = [];
    const p0Keys = matrixRows ? matrixRows.filter((r) => r.riskScore?.tier === 'P0').map((r) => `${String(r.method)} ${String(r.path)}`) : [];
    const bulletsCoveringP0 = new Set<string>();
    for (const line of bulletLines) {
      const backtickMatches = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
      const cited = backtickMatches.find((t) => t.length > 20);
      if (!cited) {
        problems.push(`no backtick-quoted test name found: ${line.slice(0, 120)}`);
        continue;
      }
      if (!passedTestNames.has(cited)) {
        problems.push(`cited test is not an exact match to any PASSED test this run: "${cited.slice(0, 160)}"`);
        continue;
      }
      const lineLower = line.toLowerCase();
      for (const k of p0Keys) if (lineLower.includes(k.toLowerCase())) bulletsCoveringP0.add(k);
    }
    const uncoveredP0 = p0Keys.filter((k) => !bulletsCoveringP0.has(k));
    const ok = bulletLines.length > 0 && problems.length === 0 && (p0Keys.length === 0 || uncoveredP0.length === 0);
    record(
      'C9-7',
      `read ${path.relative(repoRoot, threatModelPath)}, section bounded to the next "## " heading, cross-check bullets against C9-2's vitest run`,
      'every [C9-N] bullet exactly cites a PASSED test; every P0-tier route\'s own key appears inside a valid, test-cited bullet line (not merely elsewhere in the section)',
      ok,
      `[C9-N] bullets found: ${bulletLines.length}\nP0 routes: ${p0Keys.join(', ') || 'none'}\nuncovered P0 routes (no valid bullet names this exact route): ${uncoveredP0.join(', ') || 'none'}\n${problems.join('\n') || 'all citations matched'}`,
    );
  });

  // C9-8: full risk-score formula enforcement -- exposure exact (AST,
  // scoped+dedup'd, comment-blind, reachability-aware), impact >= frozen
  // floor, score === exposure+impact exactly, tier === tierFor(score)
  // exactly.
  await checkCriterion('C9-8', () => {
    if (!matrixRows) {
      record('C9-8', '', 'exposure/impact/score/tier all mechanically enforced per row', false, '', { detail: 'no matrix to check' });
      return;
    }
    if (!headCollect) {
      record('C9-8', '', 'exposure/impact/score/tier all mechanically enforced per row', false, '', {
        detail: `could not derive HEAD route set: ${headError}`,
      });
      return;
    }
    if (headCollect.duplicates.length > 0) {
      record('C9-8', '', 'exposure/impact/score/tier all mechanically enforced per row', false, `duplicate registrations at HEAD: ${headCollect.duplicates.join(', ')}`, {
        detail: 'refusing to classify while duplicate route registrations exist -- see C9-1',
      });
      return;
    }
    const problems: string[] = [];
    for (const row of matrixRows) {
      const key = `${String(row.method)} ${String(row.path)}`;
      const derivedExposure = headExposureByKey.get(key);
      const floor = FROZEN_IMPACT_FLOORS[key];
      const claimedExposure = row.riskScore?.exposure;
      const claimedImpact = row.riskScore?.impact;
      const claimedScore = row.riskScore?.score;
      const claimedTier = row.riskScore?.tier;
      if (derivedExposure === undefined) {
        problems.push(`${key}: no matching AST registration at HEAD`);
        continue;
      }
      if (floor === undefined) {
        problems.push(`${key}: not a frozen route (no impact floor defined)`);
        continue;
      }
      if (typeof claimedExposure !== 'number' || claimedExposure !== derivedExposure) {
        problems.push(`${key}: riskScore.exposure claims ${JSON.stringify(claimedExposure)}, AST derives ${derivedExposure}`);
      }
      if (typeof claimedImpact !== 'number' || claimedImpact < 0 || claimedImpact > 3 || !Number.isInteger(claimedImpact)) {
        problems.push(`${key}: riskScore.impact must be an integer 0-3, got ${JSON.stringify(claimedImpact)}`);
      } else if (claimedImpact < floor) {
        problems.push(`${key}: riskScore.impact (${claimedImpact}) is below the frozen floor (${floor})`);
      }
      if (typeof claimedExposure === 'number' && typeof claimedImpact === 'number') {
        const expectedScore = claimedExposure + claimedImpact;
        if (claimedScore !== expectedScore) {
          problems.push(`${key}: riskScore.score claims ${JSON.stringify(claimedScore)}, expected exposure+impact=${expectedScore}`);
        } else if (claimedTier !== tierFor(expectedScore)) {
          problems.push(`${key}: riskScore.tier claims ${JSON.stringify(claimedTier)}, expected ${tierFor(expectedScore)} for score=${expectedScore}`);
        }
      }
    }
    record(
      'C9-8',
      'AST scan of registerLibraryRoutes at HEAD (scoped, comment-blind, duplicate-checked, reachability-aware) cross-checked against FROZEN_IMPACT_FLOORS',
      'every row: exposure exact match, impact >= frozen floor, score === exposure+impact, tier === tierFor(score)',
      problems.length === 0,
      problems.join('\n') || `all ${matrixRows.length} rows' exposure/impact/score/tier independently confirmed`,
    );
  });

  // C9-9: gates.
  await checkCriterion('C9-9', () => {
    const guard = sh('pnpm', ['guard']);
    const typecheck = sh('pnpm', ['typecheck']);
    const ok = guard.status === 0 && typecheck.status === 0;
    record(
      'C9-9',
      'pnpm guard && pnpm typecheck',
      'both exit 0 on the current tree',
      ok,
      `guard exit=${guard.status}\ntypecheck exit=${typecheck.status}\n\nguard tail:\n${guard.stdout.slice(-3000)}\n\ntypecheck tail:\n${typecheck.stdout.slice(-3000)}`,
    );
  });

  // C9-10 (redesigned, round 2): commit-bound adversarial implementation
  // review. The record names `reviewedCommit` -- a STRICT ancestor of HEAD
  // (never HEAD itself, which is structurally impossible to self-reference)
  // -- and the gate verifies it resolves, is a real ancestor, that nothing
  // in the tranche's owned implementation/evidence paths changed between
  // reviewedCommit and HEAD (so the review, committed later, necessarily
  // covers the FINAL state of what it reviewed), and that the reviewer is
  // distinct from every commit author across baseCommit..reviewedCommit
  // (not just HEAD's own tip author, which a same-author later commit could
  // trivially dodge). Design rationale: commit the full implementation
  // first (routes, store, tests, matrix, threat-model doc) as some real
  // commit P; a distinct reviewer reviews P; the review record naming P is
  // then committed afterward (possibly as HEAD itself, adding only that one
  // file) -- P's SHA is already real and stable by construction, so there
  // is no chicken-and-egg problem, and a clean green run is feasible.
  await checkCriterion('C9-10', () => {
    const reviewPath = path.join(repoRoot, 'docs/security/library-ingest-implementation-review.json');
    if (!fs.existsSync(reviewPath)) {
      record(
        'C9-10',
        `read ${path.relative(repoRoot, reviewPath)}`,
        'reviewedCommit is a real, strict ancestor of HEAD whose owned-path diff to HEAD is empty; reviewer distinct from every baseCommit..reviewedCommit author; verdict is APPROVE',
        false,
        '',
        { detail: 'no implementation review record on disk' },
      );
      return;
    }
    let review: { reviewer?: unknown; model?: unknown; reviewedCommit?: unknown; verdict?: unknown };
    try {
      review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
    } catch (err) {
      record('C9-10', '', 'review record parses as JSON', false, '', { detail: `parse failed: ${String(err)}` });
      return;
    }
    const problems: string[] = [];
    const reviewer = typeof review.reviewer === 'string' ? review.reviewer.trim() : '';
    const reviewedCommit = typeof review.reviewedCommit === 'string' ? review.reviewedCommit.trim() : '';
    if (!reviewer) problems.push('reviewer field missing/empty');
    if (typeof review.model !== 'string' || !review.model.trim()) problems.push('model field missing/empty');
    if (review.verdict !== 'APPROVE') problems.push(`verdict is "${String(review.verdict)}", not APPROVE`);
    if (!reviewedCommit || !/^[0-9a-f]{7,40}$/i.test(reviewedCommit)) {
      problems.push('reviewedCommit missing or not a plausible git SHA');
    } else if (!resolveCommit(reviewedCommit)) {
      problems.push(`reviewedCommit "${reviewedCommit}" does not resolve to a real commit`);
    } else if (reviewedCommit === headSha) {
      problems.push('reviewedCommit equals HEAD exactly -- a commit cannot review itself (the record could not have existed at that commit yet); reviewedCommit must be a STRICT ancestor of HEAD');
    } else if (!isAncestor(reviewedCommit, headSha)) {
      problems.push(`reviewedCommit "${reviewedCommit}" is not an ancestor of HEAD (${headSha})`);
    } else {
      const coveragePaths = [
        'apps/daemon/src/routes/library.ts',
        'apps/daemon/src/library-store.ts',
        'apps/daemon/tests/library-*.test.ts',
        'docs/security/library-ingest-attribution.json',
        'docs/security/daemon-threat-model.md',
      ];
      const diffResult = sh('git', ['diff', '--name-only', reviewedCommit, headSha, '--', ...coveragePaths]);
      if (diffResult.status !== 0) {
        problems.push(`git diff reviewedCommit..HEAD over coverage paths failed (exit=${diffResult.status})`);
      } else {
        const changedSinceReview = diffResult.stdout.trim().split('\n').filter(Boolean);
        if (changedSinceReview.length > 0) {
          problems.push(`implementation/evidence changed AFTER reviewedCommit -- review is stale for: ${changedSinceReview.join(', ')}`);
        }
      }
      if (reviewer) {
        const reviewedRangeAuthors = commitAuthorsBetween(baseCommit, reviewedCommit);
        if (reviewedRangeAuthors.has(reviewer.toLowerCase())) {
          problems.push(`reviewer ("${reviewer}") matches an author of a commit in baseCommit..reviewedCommit -- not distinguishable from the implementation`);
        }
      }
    }
    record(
      'C9-10',
      `read ${path.relative(repoRoot, reviewPath)}; reviewedCommit resolvability/ancestry + owned-path coverage-diff + author-distinctness checks`,
      'reviewedCommit is a real, strict ancestor of HEAD whose owned-path diff to HEAD is empty; reviewer distinct from every baseCommit..reviewedCommit author; verdict is APPROVE',
      problems.length === 0,
      problems.join('\n') || `reviewer=${reviewer} model=${String(review.model)} reviewedCommit=${reviewedCommit} verdict=${String(review.verdict)}`,
    );
  });

  // =======================================================================
  // GATE-INTEGRITY / LEASE / HEAD-DRIFT
  // =======================================================================
  await checkCriterion('GATE-INTEGRITY', () => {
    // Advisory-when-absent by the same two-phase design every other wave
    // verifier uses: an orchestrator pins approved-gate.sha256 only AFTER
    // this expansion is approved, which cannot have happened before the
    // approval this run is part of. Round 2: the pin's absence is now ALSO
    // an explicit top-level manifest field (`gateIntegrityPinned`), not
    // buried in this criterion's prose evidence alone -- a consumer does
    // not need to parse text to know whether floor-table/collector
    // tampering is currently detectable. The route-set collusion Sol found
    // in round 1 is independently closed by C9-1/C9-8 deriving the frozen
    // set from baseCommit via git show, not from a HEAD literal, regardless
    // of pin timing.
    const selfPath = process.argv[1] ? path.resolve(process.argv[1]) : path.join(repoRoot, 'scripts/waves/verify-w9-ingest.ts');
    let selfSha256: string;
    try {
      selfSha256 = sha256File(selfPath);
    } catch (err) {
      record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check; the PRIMARY control is baseCommit-derived route/lease/decision truth, not this pin', false, '', {
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
        `sha256: ${selfSha256}\nUNPINNED -- no approved-gate.sha256 present. Floor table and route collector are NOT tamper-protected by this check until the orchestrator pins one post-approval; see manifest.gateIntegrityPinned=false.`,
      );
      return;
    }
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === selfSha256;
    record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', gateOk, `sha256: ${selfSha256}\napproved: ${approved}\nPINNED`, {
      detail: gateOk ? undefined : 'verify-w9-ingest.ts modified since orchestrator approval',
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
      record('LEASE', `git show ${baseCommit}:docs/plans/waves/leases.json`, 'no writes outside the W9-ingest lease, read from baseCommit', false, '', {
        detail: `could not read/parse leases.json at baseCommit: ${String(err)}`,
      });
      return;
    }
    const lease = leasesRaw.waves['W9-ingest'];
    if (!lease) {
      record('LEASE', '', '', false, '', { detail: 'no "W9-ingest" entry in leases.json@baseCommit' });
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
      `git diff --name-only ${baseCommit}...HEAD subset-of leases.json[W9-ingest] read via git show ${baseCommit}:docs/plans/waves/leases.json`,
      'no writes outside the W9-ingest lease, read from baseCommit so the wave cannot widen its own lease',
      violations.length === 0,
      violations.join('\n') ||
        (diffNames.length === 0
          ? 'no diff between baseCommit and HEAD'
          : `all ${diffNames.length} changed files inside the lease`),
      {
        detail:
          violations.length === 0
            ? undefined
            : "see W9-ingest-tranche.md AUTHOR-FLAGGED dispositions, ruling 3: docs/plans/waves/W9-ingest-tranche.md itself is outside leases.json's W9-ingest.allow at THIS branch's baseCommit -- expected to self-resolve once this PRD lands on main and a later implementation branch's baseCommit includes it",
      },
    );
  });

  const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  await checkCriterion('HEAD-DRIFT', () => {
    record('HEAD-DRIFT', 'git rev-parse HEAD (re-resolved at end)', 'HEAD must not move during the run', headShaFinal === headSha, `initial=${headSha} final=${headShaFinal}`, {
      detail: headShaFinal === headSha ? undefined : 'HEAD moved during the run',
    });
  });

  // -----------------------------------------------------------------------
  // Commit-bound manifest. Tamper re-check, archive (self-contained, round
  // 2), then the FINAL write (wroteOk:true).
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
  const preArchiveManifest = buildManifest(true, treeDirty, false);
  const archiveResult = archiveRunArtifacts(preArchiveManifest);
  const finalManifest: ManifestShape = { ...preArchiveManifest, archiveOk: archiveResult.ok };
  // Self-referential correction: archiveRunArtifacts wrote its own copy of
  // the manifest BEFORE archival's own outcome could be known (the same
  // class of chicken-and-egg this run already fixed once for C9-10), so
  // that copy's `archiveOk` is necessarily stale (always false). Once the
  // true outcome is known, correct the archived copy in place -- the
  // canonical proof/manifest.json (written next) is authoritative
  // regardless, but the archived copy should not misreport its own result.
  if (archiveResult.ok) {
    try {
      const archivedManifestPath = path.join(archiveResult.runDir, 'manifest.json');
      const archivedRaw = JSON.parse(fs.readFileSync(archivedManifestPath, 'utf8')) as ManifestShape;
      archivedRaw.archiveOk = true;
      fs.writeFileSync(archivedManifestPath, JSON.stringify(archivedRaw, null, 2));
      fs.writeFileSync(path.join(archiveResult.runDir, 'manifest.sha256.txt'), `${sha256File(archivedManifestPath)}\n`);
    } catch {
      /* best-effort correction only; canonical manifest.json is authoritative regardless */
    }
  }
  const { written: manifestWritten, sha256: manifestSha256 } = writeManifestFile(finalManifest);

  const failures = results.filter((r) => r.status === 'fail');
  console.log(`\nverify-w9-ingest: ${results.length - failures.length}/${results.length} criteria pass (treeDirty=${treeDirty}, wroteOk=true, gateIntegrityPinned=${gateIntegrityPinned}, archiveOk=${archiveResult.ok})`);
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md §2)');
  if (!archiveResult.ok) console.log('  ⚠ per-run archival FAILED -- this fails the run (round-2 fix, was previously non-fatal)');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  console.log(`RUN_ARCHIVE=${archiveResult.runDir}`);
  process.exit(failures.length === 0 && !treeDirty && manifestWritten && archiveResult.ok ? 0 : 1);
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
