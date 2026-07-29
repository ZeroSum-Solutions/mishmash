// verify-w10c.ts -- wave mishmash-w10c-toolbox (Toolbox reliability, NM-19)
// completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w10c.ts [--repo <path>]
// Exit 0 only when every C10C criterion (C10C-1..C10C-8) reads exactly
// "pass", GATE-INTEGRITY/LEASE/HEAD-DRIFT all pass, and the tree is clean.
// C10C-8 is human:-marked and may legitimately resolve "blocked-on-founder"
// per VERIFICATION-CONTRACT.md §3 R7 -- see the FIX ROUND 3 note below for
// why it was reinstated after being removed in an earlier round. The
// commit-bound proof manifest is written to the wave's goal-state proof
// directory either way.
//
// ===========================================================================
// FIX ROUND 1 -- this file was rewritten to close 8 numbered findings from an
// independent adversarial review of the prior draft. Each fix is tagged
// [R1-F<n>] at its point of use; docs/plans/waves/W10c-toolbox.md carries the
// full satisfiability/decoy argument for each. Summary:
//   F1 (package-relative paths + NodeNext dynamic-import requirement) --
//     every `pnpm --filter <pkg> exec ...` invocation now uses a path
//     relative to that PACKAGE's own root (confirmed live: `pnpm --filter
//     @open-design/e2e exec pwd` prints .../e2e), not the repo root. Any
//     runtime code in this file that needs apps/web/src/runtime/
//     design-toolbox.ts loads it via a DYNAMIC import() with a computed
//     specifier (via pathToFileURL), never a static import declaration --
//     confirmed live that a static import fails e2e's own NodeNext typecheck
//     (TS2835) while the dynamic form typechecks clean under this file's own
//     NodeNext project AND executes correctly under tsx.
//   F2/F3/F4 (C10C-2/3/4 checked import/title shape only, not behavior) --
//     each of these criteria now has TWO independent lines of evidence: (a)
//     this verifier's OWN direct execution of the real production code
//     (dynamic-imported design-toolbox.ts / apps/daemon/src/skills.ts,
//     called for real, against a real live registry -- for C10C-3 via a
//     freshly-booted isolated daemon, matching the "boot the daemon, make
//     the real request, assert the real response" instruction) as the
//     PRIMARY, unfakeable-by-a-delegated-file proof; (b) structural checks on
//     the required delegated artifact that bind to the EXACT exported name
//     (not a local-alias substring), require it to be CALLED (not just
//     imported), require the pinned phantom-fixture string to appear as a
//     genuine AST string-literal NODE (not merely present in raw text, which
//     a comment would also satisfy), and -- for C10C-2 specifically -- cross
//     check a runtime marker each per-action test must emit (captured via
//     Playwright's JSON reporter's confirmed-live results[].stdout[].text
//     schema) against this verifier's own freshly-computed expected value.
//   F5 (C10C-1's AST authority accepted an ambiguous/decoy declaration and
//     ignored extra object-literal members) -- the AST layer now requires a
//     UNIQUE top-level exported const declaration, rejects any object-literal
//     member outside the 5 real DesignToolboxAction fields (methods,
//     accessors, __proto__, shorthand, computed names all rejected), and
//     scans for push/splice/Object.assign/defineProperty/setPrototypeOf
//     mutation calls against the binding. On top of that, a RUNTIME layer
//     dynamically imports the real module and requires the actual executed
//     export to exactly match the AST reading -- closing the decoy-shape
//     problem from a second, independent direction regardless of how
//     thorough the AST enumeration is. The i18n cross-check is now scoped to
//     the unique `Dict` interface specifically, and en.ts coverage is
//     computed as an expected-key-set diff, not just an empty-string scan.
//   F6 (C10C-5 decoy argument falsely claimed order-detection) -- this file's
//     own header comment and the PRD text were corrected; multisetDiff never
//     claimed to detect ordering and does not.
//   F7 (C10C-7 spoofable: model unchecked, reviewer identity exact-string-only,
//     owned-path list incomplete) -- model is now validated non-empty;
//     reviewer-identity matching handles the "Name <email>" combined form and
//     whitespace via reviewerIdentityCandidates(); the owned-path list now
//     includes all 8 lease-allowed content files.
//   F8 (founder question 1 left as a soft, non-blocking open question when
//     repository authority makes it blocking) -- ORIGINALLY promoted to a
//     formal C10C-8 criterion (human:-marked, DECISIONS.md-gated). The
//     orchestrator has since ruled on all three of this PRD's open founder
//     questions directly (Orchestrator ruling under delegated founder
//     authority, 2026-07-28 -- see docs/plans/waves/W10c-toolbox.md §9):
//     ruling 1 is NO new toolbox-action HTTP/CLI capability, which closes the
//     question C10C-8 existed to gate -- C10C-8 is therefore REMOVED (a
//     criterion that would now trivially and permanently read "pass" is not
//     measuring anything); ruling 2 is YES, extend the exhaustive walk to
//     NextStepActions.tsx as a second catalogue consumer, with the two
//     consumers' featured/non-featured partition asserted explicitly -- C10C-2
//     below is extended accordingly (two required for-of loops, one per
//     consumer, 2x the per-action spec count, a dedicated partition check);
//     ruling 3 is KEEP scripts/check-toolbox-skill-refs.test.ts as a floor --
//     no code change here, it was never touched by this file.
// ===========================================================================
// FIX ROUND 3 -- a confirmation review REJECTED the round-2 draft with 7
// findings; the orchestrator additionally ruled that removing C10C-8 in
// round 2 was wrong and it must be reinstated. Each fix is tagged [R3-F<n>]:
//   F7/finding-7 (C10C-8 wrongly removed) -- REINSTATED. The
//     `### W10C-CAPABILITY-DECISION` block that landed on main via
//     docs/plans/waves/DECISIONS.md is a real, fail-able invariant: C10C-8
//     now reads it at baseCommit (never HEAD, since a wave branch cannot
//     reach the docs lane -- leases.json denies DECISIONS.md to W10c),
//     parses Decision/Decider/Date/Rationale, and checks the decider against
//     baseCommit's own commit authors. This proves the ruling landed through
//     the review lane that produced baseCommit -- it does NOT and cannot
//     cryptographically verify anyone's authority; the criterion text below
//     says so explicitly. Modeled on the W9-agent-spawn "C9S-8" mechanism
//     described in DECISIONS.md's W9AS-PARK record (the one part of that
//     package the reviewer found sound).
//   F2/F3 (unbound-import class) -- hasDestructuredBindingNamed and
//     hasNamedImportOfExactExport verified a PROPERTY/exported name existed
//     but threw away the LOCAL identifier the import actually binds to, and
//     countCallsToExactIdentifier then matched calls by the exported name's
//     TEXT -- so `const { findDesignToolboxSkill: _unused } = await
//     import(...)` (import present, never called) plus an unrelated local
//     `function findDesignToolboxSkill() {...}` (a lookalike decoy) passed
//     both checks by calling the decoy. findDestructuredImportBinding /
//     findNamedImportBinding now return the actual LOCAL NAME the import
//     produces, and every call-count check below counts calls to THAT local
//     name. In the non-adversarial case (no alias) this is a no-op, since an
//     unaliased import's local name equals its exported name. C10C-4 also
//     gained the PRD-required SKILL_ID_ALIASES import+reference check, and
//     the decorative "some ts.createSourceFile call exists somewhere" check
//     was replaced by usesCompilerApiForRealExtraction, which requires the
//     createSourceFile call's OWN RETURN VALUE to be bound to a variable
//     that is then passed as the first argument to a real ts.forEachChild
//     call -- a genuine, connected data-flow chain, not two decorative,
//     unrelated calls. C10C-3's raw regex checks for createSmokeSuite /
//     .with.toolsDev were replaced with real AST CallExpression checks.
//   F4/finding-4 (alias-mediated mutation) -- C10C-1's static
//     scanForMutationCalls only sees calls whose arguments directly contain
//     the DESIGN_TOOLBOX_ACTIONS identifier, so aliasing an array element
//     into a local variable before calling Object.defineProperty/
//     setPrototypeOf on it (or on one of its elements) dodges the scan
//     entirely. inspectRuntimeActionsShape now inspects the ACTUAL RUNTIME
//     VALUE returned by the dynamic import: exact own keys (no extras),
//     every field a plain enumerable DATA property (get/set accessor
//     descriptors are rejected outright, regardless of what value they
//     currently return), and Object.prototype/Array.prototype identity on
//     both the array and every element -- this is now the AUTHORITATIVE
//     check; the static scan stays only as cheap defense-in-depth.
//   F5/finding-5 (fail-closed safety, program-wide carry-forward) -- EVERY
//     probe fetch in this file (including C10C-3's second, previously-raw
//     `fetch(...)` call, now routed through fetchLiveSkillsOverHttp) sets
//     redirect:'manual' and re-validates origin/status before trusting a
//     response. withIsolatedDaemon's teardown no longer trusts a single
//     `tools-dev stop` exit code: it captures the daemon's own reported PID
//     at boot, parses the stop result's `status`/`stop.remainingPids`
//     fields, independently polls (process.kill(pid, 0)) to CONFIRM no
//     survivor remains, and -- since the sidecar is spawned with
//     detached:true (its PID is also its process-group id) -- escalates to
//     a process-GROUP SIGTERM/SIGKILL if anything survives. A `partial` stop
//     or an unconfirmed survivor now FAILS the calling criterion instead of
//     being silently ignored; this is exactly the bug DECISIONS.md's
//     W9AS-PARK record identifies (trusting a group leader's exit event
//     while a descendant in the same group survives).
//   F1/finding-1 (C10C-2 must prove the second consumer RENDERS the split)
//     -- deriving the non-featured id set as the complement of the featured
//     set proved a fact about the verifier's own arithmetic, not about
//     NextStepActions.tsx. C10C-2 now parses NextStepActions.tsx's OWN real
//     source and requires it to import FEATURED_DESIGN_TOOLBOX_ACTION_IDS
//     and compute its non-featured set via a `.filter(...)` referencing
//     that same import, requires the four pinned testid fragments to exist
//     as genuine `data-testid` JSX-attribute literal values in that file,
//     and replaces the old "selector text appears somewhere in the loop"
//     plus "some .click() appears somewhere in the loop" (two independent,
//     unbound facts that let one loop drive both surfaces or neither) with
//     countClickChainsReferencing, which requires each `.click()` call's own
//     RECEIVER subtree to contain the relevant selector fragment. The marker
//     parser also now validates the reported action id (capture group 1)
//     equals the id under test, not just extracting the value.
//   F6/finding-6 (whitespace-only reviewer) -- `if (!reviewer)` passed a
//     whitespace-only string (truthy, non-empty length) through to
//     identityMatchesAnyAuthor, which then matched no author -- so a
//     whitespace reviewer field silently passed. Both C10C-7's reviewer
//     check and C10C-8's decider check now reject a string that is empty
//     AFTER trimming, not just a falsy/missing one.
// ===========================================================================
//
// Anti-gaming compliance notes (verifier defect catalog):
//   1. This file writes no generated script/JS content to disk itself -- no
//      runner-script generation, no fixture-file writes. `node --check` has
//      nothing generated to validate.
//   2. Object/array spreads inside DESIGN_TOOLBOX_ACTIONS are banned at any
//      depth (hasSpreadDeep / per-element scans), and the runtime cross-check
//      (Layer B) catches any residual divergence a spread-based decoy could
//      still produce even if it dodged the AST ban.
//   3. Every id-set comparison in this file is a multiset/occurrence-count
//      comparison (multisetDiff), never bare Set difference.
//   4. Every "must be rejected" check is paired with a positive control per
//      criterion (C10C-1 Layer A+B agreement, C10C-3/C10C-4's paired
//      positive+negative oracle calls and pinned test titles).
//   5. Every TS source extraction below uses the TypeScript compiler API
//      (ts.createSourceFile + AST walks), never a regex/string scan of TS
//      source.
//   6. Every "does this test bind to real production code" check resolves
//      to the EXACT exported name (never a local-alias substring) and
//      requires an actual CALL site, not just an import.
//   7. N/A here (no JSX under test).
//   8. Every count this file asserts on is derived at verifier runtime from
//      the repo, never hardcoded.
//   9. Dynamic import()/require of design-toolbox.ts by a future test file
//      is exactly the pattern this verifier requires and structurally
//      checks for (a string-literal fragment inside the import() argument
//      subtree); the verifier's own runtime oracles additionally make the
//      BEHAVIORAL claim independent of how faithfully any delegated file's
//      loading mechanism is captured statically.
//  10. Every runtime probe in this file uses redirect:'manual', validates
//      the URL's origin against the discovered daemon's own loopback origin
//      immediately before each request, and hard-fails if the discovered
//      port is 7456 or 51012 -- it never requests either port. Daemon
//      teardown kills by the exact PID `tools-dev` itself reports owns the
//      listener (via `tools-dev stop daemon --namespace <ns>`, which targets
//      that namespace's own tracked process, not a wrapper shell).
//  11. Every criterion carries satisfiability + decoy arguments in
//      docs/plans/waves/W10c-toolbox.md; this file is the mechanical half.
//  12. This run is expected to exit non-zero pre-implementation.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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

type Verdict = 'pass' | 'fail' | 'blocked-on-founder';

interface CriterionResult {
  id: string;
  command: string;
  assertion: string;
  artifact: string | null;
  artifactSha256: string | null;
  exitCode: number;
  status: Verdict;
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
  ok: boolean | 'blocked-on-founder',
  evidence: string,
  opts: { detail?: string | undefined; durationMs?: number } = {},
): void {
  const verdict: Verdict = ok === 'blocked-on-founder' ? 'blocked-on-founder' : ok ? 'pass' : 'fail';
  try {
    const { artifact, artifactSha256 } = artifactFor(
      id,
      `# ${id}\n# assertion: ${assertion}\n# verdict: ${verdict}\n${opts.detail ? `# detail: ${opts.detail}\n` : ''}\n${evidence}\n`,
    );
    const effectiveVerdict: Verdict = artifact === null && verdict === 'pass' ? 'fail' : verdict;
    results.push({
      id,
      command,
      assertion,
      artifact,
      artifactSha256,
      exitCode: effectiveVerdict === 'pass' ? 0 : 1,
      status: effectiveVerdict,
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
// [R1-F7] Handles a combined "Name <email>" identity string and surrounding
// whitespace: returns every candidate substring (the whole trimmed string,
// plus the name-only and email-only parts when a "<...>" suffix is present)
// so a caller can check each against an authors set built from bare
// name/email entries -- a single exact-string comparison previously let
// "Jane Doe <jane@example.com>" dodge a match against a bare "jane doe" or
// "jane@example.com" author entry.
function reviewerIdentityCandidates(raw: string): string[] {
  const trimmed = raw.trim().toLowerCase();
  const candidates = new Set<string>([trimmed]);
  const m = /^(.*)<([^>]+)>$/.exec(trimmed);
  if (m) {
    const namePart = (m[1] ?? '').trim();
    const emailPart = (m[2] ?? '').trim();
    if (namePart) candidates.add(namePart);
    if (emailPart) candidates.add(emailPart);
  }
  return [...candidates].filter((c) => c.length > 0);
}
function identityMatchesAnyAuthor(raw: string, authors: Set<string>): boolean {
  return reviewerIdentityCandidates(raw).some((c) => authors.has(c));
}

const gateIntegrityPinned = fs.existsSync(path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256'));

// =========================================================================
// Two-phase manifest write.
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
// TypeScript-compiler-API extraction + structural-binding helpers.
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
// [R3-F1] .tsx files must parse with ScriptKind.TSX, or JSX syntax
// (<div data-testid=...>) is never recognized as JSX at all -- discovered
// empirically: parsing NextStepActions.tsx with the hardcoded ScriptKind.TS
// this function previously always used meant ts.isJsxAttribute could never
// match anything, making the testid-literal check permanently unsatisfiable
// regardless of how correct a real implementation's source was.
function parseTs(fileName: string, sourceText: string): TypeScriptModule.SourceFile {
  const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
}
// Collects every string-literal / no-substitution-template-literal NODE
// VALUE in the file -- used to prove a pinned fixture string is a genuine
// AST literal, never merely present in a comment (which a raw .includes()
// scan would wrongly accept). [R1-F3]
function collectAllStringLiteralValues(sf: TypeScriptModule.SourceFile): Set<string> {
  const out = new Set<string>();
  function visit(n: TypeScriptModule.Node): void {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.add(n.text);
    ts.forEachChild(n, visit);
  }
  visit(sf);
  return out;
}
function containsBannedTestMarker(sf: TypeScriptModule.SourceFile): string[] {
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
function countCallsToExactIdentifier(sf: TypeScriptModule.SourceFile, exactName: string): number {
  let count = 0;
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === exactName) count++;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === exactName) count++;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}
// [R1-F1] Dynamic import() with a computed (non-string-literal) argument
// cannot be resolved to an exact file path by pure syntax, so this checks
// the weaker-but-real structural signal the PRD names: the import() call's
// argument subtree contains a string-literal fragment naming the target
// file, AND the call is a genuine dynamic import (ImportKeyword callee).
function hasDynamicImportReferencingFile(sf: TypeScriptModule.SourceFile, fileNameFragment: string): boolean {
  let found = false;
  function visit(node: TypeScriptModule.Node): void {
    if (found) return;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg) {
        let hit = false;
        function inner(n: TypeScriptModule.Node): void {
          if (hit) return;
          if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text.includes(fileNameFragment)) hit = true;
          ts.forEachChild(n, inner);
        }
        inner(arg);
        if (hit) found = true;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}
interface ImportBinding {
  found: boolean;
  localName: string | null;
}
// [R3-F2/F3] Does an ObjectBindingPattern anywhere in the file destructure a
// property named exactly `exactPropertyName`, and if so, what LOCAL
// IDENTIFIER does that binding actually produce? A destructure can rename
// away from the original property (`{ findDesignToolboxSkill: _unused }`),
// in which case `localName` is `_unused` -- callers MUST count calls to
// `localName`, never to `exactPropertyName` itself, or an unrelated local
// function sharing the property's original name silently absorbs the call
// count instead of the real import.
function findDestructuredImportBinding(sf: TypeScriptModule.SourceFile, exactPropertyName: string): ImportBinding {
  let result: ImportBinding = { found: false, localName: null };
  function visit(node: TypeScriptModule.Node): void {
    if (result.found) return;
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const effectiveName = node.propertyName ? propertyName(node.propertyName) : ts.isIdentifier(node.name) ? node.name.text : null;
      if (effectiveName === exactPropertyName && ts.isIdentifier(node.name)) {
        result = { found: true, localName: node.name.text };
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return result;
}
// [R3-F2/F3] Real ES `import { a, b as c } from '...'` -- checks the
// ORIGINAL exported name (propertyName ?? name) for presence, but returns
// the LOCAL identifier (`name.text`) the import actually binds in this
// file's scope, which callers must count calls against. For a normal,
// non-aliased import (no `as` clause) localName === exactExportedName, so
// this is a no-op change for the common case; only an adversarial alias
// makes the two diverge, which is exactly when the distinction matters.
function findNamedImportBinding(sf: TypeScriptModule.SourceFile, exactExportedName: string, moduleSpecifierFragment: string): ImportBinding {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const spec = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(spec) || !spec.text.includes(moduleSpecifierFragment)) continue;
    const clause = stmt.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const el of clause.namedBindings.elements) {
      const originalName = el.propertyName ? el.propertyName.text : el.name.text;
      if (originalName === exactExportedName) return { found: true, localName: el.name.text };
    }
  }
  return { found: false, localName: null };
}
// [R3-F2] Counts every occurrence of `exactName` as an Identifier node
// anywhere in the file, including its own declaration site -- used to prove
// an import is REFERENCED at least once beyond being declared (count >= 2),
// closing the "imported and never used" half of the unbound-import class for
// bindings (like SKILL_ID_ALIASES) that are read, not called.
function countIdentifierReferences(sf: TypeScriptModule.SourceFile, exactName: string): number {
  let count = 0;
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isIdentifier(node) && node.text === exactName) count++;
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}
// [R3-F2/F3] Proves ts.createSourceFile's OWN RETURN VALUE feeds a real
// ts.forEachChild walk -- not two decorative, unconnected calls each
// independently satisfying a "some call to X exists" check. Requires: (1) a
// variable declaration whose initializer is a direct `ts.createSourceFile(
// ...)` call, and (2) a `ts.forEachChild(X, ...)` call whose first argument
// is an Identifier referencing one of those bound variable names.
function usesCompilerApiForRealExtraction(sf: TypeScriptModule.SourceFile): boolean {
  const boundNames = new Set<string>();
  function collectBindings(node: TypeScriptModule.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isPropertyAccessExpression(node.initializer.expression) &&
      ts.isIdentifier(node.initializer.expression.expression) &&
      node.initializer.expression.expression.text === 'ts' &&
      node.initializer.expression.name.text === 'createSourceFile'
    ) {
      boundNames.add(node.name.text);
    }
    ts.forEachChild(node, collectBindings);
  }
  collectBindings(sf);
  if (boundNames.size === 0) return false;
  let usesIt = false;
  function checkForEachChildUsage(node: TypeScriptModule.Node): void {
    if (usesIt) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'ts' &&
      node.expression.name.text === 'forEachChild' &&
      node.arguments[0] &&
      ts.isIdentifier(node.arguments[0]) &&
      boundNames.has((node.arguments[0] as TypeScriptModule.Identifier).text)
    ) {
      usesIt = true;
      return;
    }
    ts.forEachChild(node, checkForEachChildUsage);
  }
  checkForEachChildUsage(sf);
  return usesIt;
}
// Locates every `for (const X of <binding referencing iterableNameSubstring>)`
// loop whose body directly contains a `test(...)` call -- required shape for
// C10C-2's table-driven per-action generation. Returns ALL matches (plural),
// not just the first: [R1-F2]/orchestrator-ruling-2 extended C10C-2 to require
// TWO such loops in the same file (one per catalogue consumer), and the two
// must be told apart by what each loop body actually references, not by
// assuming the first match is "the" loop.
function findAllForOfLoopsGeneratingTests(sf: TypeScriptModule.SourceFile, iterableNameSubstring: string): TypeScriptModule.ForOfStatement[] {
  const found: TypeScriptModule.ForOfStatement[] = [];
  function subtreeReferencesName(node: TypeScriptModule.Node): boolean {
    let hit = false;
    function inner(n: TypeScriptModule.Node): void {
      if (hit) return;
      if (ts.isIdentifier(n) && n.text.includes(iterableNameSubstring)) hit = true;
      ts.forEachChild(n, inner);
    }
    inner(node);
    return hit;
  }
  function bodyHasTestCall(node: TypeScriptModule.Node): boolean {
    let hit = false;
    function inner(n: TypeScriptModule.Node): void {
      if (hit) return;
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'test') hit = true;
      ts.forEachChild(n, inner);
    }
    inner(node);
    return hit;
  }
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isForOfStatement(node) && subtreeReferencesName(node.expression) && bodyHasTestCall(node.statement)) {
      found.push(node);
      return; // do not descend into a matched loop looking for a nested match
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}
function subtreeHasMethodCall(node: TypeScriptModule.Node, methodNames: string[]): boolean {
  let found = false;
  function visit(n: TypeScriptModule.Node): void {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && methodNames.includes(n.expression.name.text)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return found;
}
// Does any string-literal/template-literal NODE inside this subtree contain
// `fragment`? Used to tell C10C-2's two required for-of loops apart by which
// consumer's selectors each one actually references (e.g. "chat-plus-trigger"
// vs. "next-step-toolbox"), rather than assuming loop order.
function subtreeContainsStringLiteralFragment(node: TypeScriptModule.Node, fragment: string): boolean {
  let found = false;
  function inner(n: TypeScriptModule.Node): void {
    if (found) return;
    if (
      (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) &&
      n.text.includes(fragment)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, inner);
  }
  inner(node);
  return found;
}
// [R3-F2/F3] Real AST check for a chained method call like `X.with.toolsDev(
// ...)`: a CallExpression whose callee, walked backwards through nested
// PropertyAccessExpressions, matches `propertyChain` exactly -- replaces a
// raw regex/text scan (`/\.with\.toolsDev/.test(source)`) that a comment or
// unrelated identically-spelled chain would also satisfy.
function hasChainedMethodCall(sf: TypeScriptModule.SourceFile, propertyChain: string[]): boolean {
  let found = false;
  function visit(node: TypeScriptModule.Node): void {
    if (found) return;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      let cur: TypeScriptModule.Expression = node.expression;
      let matched = true;
      for (let i = propertyChain.length - 1; i >= 0; i--) {
        if (!ts.isPropertyAccessExpression(cur) || cur.name.text !== propertyChain[i]) {
          matched = false;
          break;
        }
        cur = cur.expression;
      }
      if (matched) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return found;
}
// [R3-F1] Counts `.click()` CallExpressions whose RECEIVER subtree (e.g. the
// `page.getByTestId('X')` in `page.getByTestId('X').click()`) contains
// `fragment` -- binds the click to the selector, rather than treating "a
// selector fragment appears somewhere in the loop" and "some .click() call
// appears somewhere in the loop" as two independent, unbound facts that a
// loop driving a DIFFERENT surface (or no surface) could also satisfy.
function countClickChainsReferencing(node: TypeScriptModule.Node, fragment: string): number {
  let count = 0;
  function visit(n: TypeScriptModule.Node): void {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'click') {
      if (subtreeContainsStringLiteralFragment(n.expression.expression, fragment)) count++;
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return count;
}
// [R3-F1] Collects every literal string fragment that appears as (or inside
// a template literal forming) a JSX `data-testid` attribute value anywhere
// in the file -- used to prove a required testid literally exists in
// NextStepActions.tsx's own source, not merely asserted by the verifier's
// own arithmetic.
function collectJsxTestIdLiteralValues(sf: TypeScriptModule.SourceFile): Set<string> {
  const out = new Set<string>();
  function collectLiteralsIn(n: TypeScriptModule.Node): void {
    if (
      ts.isStringLiteral(n) ||
      ts.isNoSubstitutionTemplateLiteral(n) ||
      ts.isTemplateHead(n) ||
      ts.isTemplateMiddle(n) ||
      ts.isTemplateTail(n)
    ) {
      out.add(n.text);
    }
    ts.forEachChild(n, collectLiteralsIn);
  }
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'data-testid' && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) {
        out.add(node.initializer.text);
      } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        collectLiteralsIn(node.initializer.expression);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}
// [R3-F1] Cross-file structural proof: does NextStepActions.tsx's OWN real
// source (a) import FEATURED_DESIGN_TOOLBOX_ACTION_IDS by exact name from a
// design-toolbox-referencing module, and (b) compute a non-featured set via
// a `.filter(...)` CallExpression whose callback body references that same
// imported local binding through a `.includes(` call? This is a fact about
// a DIFFERENT file than the one the verifier itself derives the partition
// from -- proving the split is actually implemented there, not tautologically
// re-derived by the verifier and merely asserted against a fixed spec file.
function nextStepPartitionIsStructurallyReal(sf: TypeScriptModule.SourceFile): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const featuredImport = findNamedImportBinding(sf, 'FEATURED_DESIGN_TOOLBOX_ACTION_IDS', 'design-toolbox');
  if (!featuredImport.found || !featuredImport.localName) {
    problems.push('NextStepActions.tsx does not import FEATURED_DESIGN_TOOLBOX_ACTION_IDS by exact name from a design-toolbox module');
    return { ok: false, problems };
  }
  const localName = featuredImport.localName;
  let hasFilterOverBinding = false;
  function visit(node: TypeScriptModule.Node): void {
    if (hasFilterOverBinding) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'filter' &&
      node.arguments[0]
    ) {
      const callback = node.arguments[0];
      let referencesIncludesOnBinding = false;
      function innerVisit(n: TypeScriptModule.Node): void {
        if (referencesIncludesOnBinding) return;
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          n.expression.name.text === 'includes' &&
          ts.isIdentifier(n.expression.expression) &&
          n.expression.expression.text === localName
        ) {
          referencesIncludesOnBinding = true;
          return;
        }
        ts.forEachChild(n, innerVisit);
      }
      innerVisit(callback);
      if (referencesIncludesOnBinding) hasFilterOverBinding = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (!hasFilterOverBinding) {
    problems.push(`NextStepActions.tsx imports FEATURED_DESIGN_TOOLBOX_ACTION_IDS as "${localName}" but has no .filter(...) callback calling "${localName}.includes(...)" to derive the non-featured set`);
  }
  return { ok: problems.length === 0, problems };
}

// -----------------------------------------------------------------------
// C10C-1 structural (Layer A) extraction.
// -----------------------------------------------------------------------
const ALLOWED_ACTION_FIELDS = new Set(['id', 'icon', 'preferredSkillIds', 'categoryHints', 'searchTerms']);
interface ExtractedAction {
  id: string;
  preferredSkillIds: string[];
}
interface ExtractActionsResult {
  ok: boolean;
  actions: ExtractedAction[];
  errors: string[];
}
function findTopLevelNamedVariableDeclarations(sf: TypeScriptModule.SourceFile, name: string): TypeScriptModule.VariableDeclaration[] {
  const out: TypeScriptModule.VariableDeclaration[] = [];
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) out.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}
function isExportedTopLevelConst(decl: TypeScriptModule.VariableDeclaration, sf: TypeScriptModule.SourceFile): boolean {
  const declList = decl.parent;
  if (!ts.isVariableDeclarationList(declList)) return false;
  const stmt = declList.parent;
  if (!ts.isVariableStatement(stmt)) return false;
  if (stmt.parent !== sf) return false;
  const hasExport = (ts.getModifiers(stmt) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isConst = (declList.flags & ts.NodeFlags.Const) !== 0;
  return hasExport && isConst;
}
// [R1-F5] Requires: exactly one DESIGN_TOOLBOX_ACTIONS declaration in the
// whole file, top-level + exported + const; every array element a plain
// object literal whose ONLY members are the 5 real DesignToolboxAction
// fields as direct PropertyAssignments (no methods/accessors/shorthand/
// computed names/spread, no __proto__/toJSON or any other extra key).
function extractDesignToolboxActionsLayerA(sourceText: string, fileName: string): ExtractActionsResult {
  const errors: string[] = [];
  const actions: ExtractedAction[] = [];
  const sf = parseTs(fileName, sourceText);
  const decls = findTopLevelNamedVariableDeclarations(sf, 'DESIGN_TOOLBOX_ACTIONS');
  if (decls.length === 0) return { ok: false, actions: [], errors: ['no DESIGN_TOOLBOX_ACTIONS declaration found anywhere in the file'] };
  if (decls.length > 1) return { ok: false, actions: [], errors: [`DESIGN_TOOLBOX_ACTIONS is declared ${decls.length} times in this file -- must be unique`] };
  const decl = decls[0]!;
  if (!isExportedTopLevelConst(decl, sf)) return { ok: false, actions: [], errors: ['DESIGN_TOOLBOX_ACTIONS is not a top-level `export const` declaration'] };
  if (!decl.initializer || !ts.isArrayLiteralExpression(decl.initializer)) return { ok: false, actions: [], errors: ['DESIGN_TOOLBOX_ACTIONS initializer is not an array literal'] };
  for (const el of decl.initializer.elements) {
    if (ts.isSpreadElement(el)) {
      errors.push('spread element directly inside the DESIGN_TOOLBOX_ACTIONS array -- banned');
      continue;
    }
    if (!ts.isObjectLiteralExpression(el)) {
      errors.push(`non-object-literal element in DESIGN_TOOLBOX_ACTIONS (kind=${ts.SyntaxKind[el.kind]})`);
      continue;
    }
    let id: string | null = null;
    let preferredSkillIds: string[] | null = null;
    let elementBad = false;
    for (const prop of el.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        errors.push(`an action element has a non-PropertyAssignment member (kind=${ts.SyntaxKind[prop.kind]}) -- methods/accessors/shorthand/spread are banned`);
        elementBad = true;
        continue;
      }
      const name = propertyName(prop.name);
      if (name === null || !ALLOWED_ACTION_FIELDS.has(name)) {
        errors.push(`an action element has a disallowed property "${name ?? '<computed>'}" -- only id/icon/preferredSkillIds/categoryHints/searchTerms are allowed`);
        elementBad = true;
        continue;
      }
      if (name === 'id') {
        id = stringLiteralValue(prop.initializer);
      } else if (name === 'preferredSkillIds') {
        if (ts.isArrayLiteralExpression(prop.initializer)) {
          const vals: string[] = [];
          let arrBad = false;
          for (const item of prop.initializer.elements) {
            if (ts.isSpreadElement(item)) {
              arrBad = true;
              break;
            }
            const v = stringLiteralValue(item);
            if (v === null) {
              arrBad = true;
              break;
            }
            vals.push(v);
          }
          if (!arrBad) preferredSkillIds = vals;
        }
      }
    }
    if (elementBad) continue;
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
  return { ok: errors.length === 0 && actions.length > 0, actions, errors };
}
const MUTATION_ARRAY_METHODS = new Set(['push', 'splice', 'unshift', 'shift', 'pop', 'sort', 'reverse', 'copyWithin', 'fill']);
const MUTATION_OBJECT_METHODS = new Set(['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf']);
// [R1-F5] Scans the whole file for calls that could mutate the exported
// binding after declaration.
function scanForMutationCalls(sf: TypeScriptModule.SourceFile, identifierName: string): string[] {
  const hits: string[] = [];
  function subtreeReferencesIdentifier(expr: TypeScriptModule.Node): boolean {
    let hit = false;
    function inner(n: TypeScriptModule.Node): void {
      if (hit) return;
      if (ts.isIdentifier(n) && n.text === identifierName) hit = true;
      ts.forEachChild(n, inner);
    }
    inner(expr);
    return hit;
  }
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        if (MUTATION_ARRAY_METHODS.has(callee.name.text) && subtreeReferencesIdentifier(callee.expression)) {
          hits.push(`${identifierName}...${callee.name.text}(...)`);
        }
        if (
          MUTATION_OBJECT_METHODS.has(callee.name.text) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'Object' &&
          node.arguments.some((a) => subtreeReferencesIdentifier(a))
        ) {
          hits.push(`Object.${callee.name.text}(... ${identifierName} ...)`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return hits;
}
// [R3-F4] Inspects the ACTUAL RUNTIME VALUE (own keys, property descriptors,
// prototypes) of the dynamically-imported DESIGN_TOOLBOX_ACTIONS array and
// each of its elements. This is authoritative over scanForMutationCalls,
// which only sees calls whose ARGUMENTS directly contain the identifier
// text -- aliasing an element into a local variable before calling
// Object.defineProperty/setPrototypeOf on it dodges that scan entirely, but
// cannot dodge this: whatever code path produced the final shape, the
// runtime shape either matches an honest plain literal or it does not. A
// getter that currently RETURNS the honest value is still rejected here,
// because the check is against descriptor SHAPE (get/set vs a plain `value`
// data property), never against the value a getter happens to evaluate to.
interface RuntimeShapeCheck {
  ok: boolean;
  problems: string[];
}
function inspectRuntimeActionsShape(value: unknown): RuntimeShapeCheck {
  const problems: string[] = [];
  if (!Array.isArray(value)) return { ok: false, problems: ['DESIGN_TOOLBOX_ACTIONS runtime export is not an Array instance'] };
  if (Object.getPrototypeOf(value) !== Array.prototype) problems.push('DESIGN_TOOLBOX_ACTIONS prototype is not Array.prototype');
  const arrayOwnKeys = Object.getOwnPropertyNames(value).filter((k) => k !== 'length' && !/^\d+$/.test(k));
  if (arrayOwnKeys.length > 0) problems.push(`DESIGN_TOOLBOX_ACTIONS has extra own properties beyond numeric indices/length: ${arrayOwnKeys.join(', ')}`);
  value.forEach((el, idx) => {
    if (typeof el !== 'object' || el === null) {
      problems.push(`element ${idx} is not a plain object`);
      return;
    }
    if (Object.getPrototypeOf(el) !== Object.prototype) {
      problems.push(`element ${idx} ("${(el as Record<string, unknown>).id ?? '?'}") has a non-Object.prototype prototype -- possible inherited toJSON/valueOf injection`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(el as object);
    const ownKeys = Object.keys(descriptors);
    const unexpectedKeys = ownKeys.filter((k) => !ALLOWED_ACTION_FIELDS.has(k));
    if (unexpectedKeys.length > 0) problems.push(`element ${idx} has unexpected own key(s) at runtime: ${unexpectedKeys.join(', ')}`);
    for (const key of ownKeys) {
      const d = descriptors[key]!;
      if (typeof d.get === 'function' || typeof d.set === 'function') {
        problems.push(`element ${idx} property "${key}" is a runtime ACCESSOR (getter/setter), not a plain data property -- rejected regardless of the value it currently returns`);
        continue;
      }
      if (!d.enumerable) problems.push(`element ${idx} property "${key}" is non-enumerable at runtime`);
      if (key === 'preferredSkillIds') {
        const v = d.value;
        if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || !v.every((x) => typeof x === 'string')) {
          problems.push(`element ${idx} preferredSkillIds is not a plain runtime string Array`);
        } else {
          const innerExtra = Object.getOwnPropertyNames(v).filter((k) => k !== 'length' && !/^\d+$/.test(k));
          if (innerExtra.length) problems.push(`element ${idx} preferredSkillIds has extra own properties at runtime: ${innerExtra.join(', ')}`);
        }
      }
      if (key === 'id' && typeof d.value !== 'string') problems.push(`element ${idx} id is not a plain string data value at runtime`);
    }
  });
  return { ok: problems.length === 0, problems };
}
// [R3-F4] Lighter sibling check for FEATURED_DESIGN_TOOLBOX_ACTION_IDS
// (consumed by C10C-2's partition proof) -- same class of attack, smaller
// surface: a plain Array.prototype array of plain strings, no extra own keys.
function inspectRuntimeStringArrayShape(value: unknown, label: string): RuntimeShapeCheck {
  const problems: string[] = [];
  if (!Array.isArray(value)) return { ok: false, problems: [`${label} runtime export is not an Array instance`] };
  if (Object.getPrototypeOf(value) !== Array.prototype) problems.push(`${label} prototype is not Array.prototype`);
  const extra = Object.getOwnPropertyNames(value).filter((k) => k !== 'length' && !/^\d+$/.test(k));
  if (extra.length) problems.push(`${label} has extra own properties: ${extra.join(', ')}`);
  if (!value.every((x) => typeof x === 'string')) problems.push(`${label} contains a non-string element`);
  return { ok: problems.length === 0, problems };
}
// [R1-F5] i18n cross-check scoped specifically to the unique `Dict` interface.
function findUniqueInterface(sf: TypeScriptModule.SourceFile, name: string): TypeScriptModule.InterfaceDeclaration[] {
  const out: TypeScriptModule.InterfaceDeclaration[] = [];
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) out.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}
interface I18nExtraction {
  ok: boolean;
  error?: string;
  complete: Set<string>;
  incomplete: string[];
}
function extractDesignToolboxI18nIdsFromDict(sourceText: string, fileName: string): I18nExtraction {
  const sf = parseTs(fileName, sourceText);
  const dicts = findUniqueInterface(sf, 'Dict');
  if (dicts.length !== 1) {
    return { ok: false, error: `found ${dicts.length} "Dict" interface declaration(s), expected exactly 1`, complete: new Set(), incomplete: [] };
  }
  const pattern = /^chat\.designToolbox\.action\.([a-zA-Z0-9-]+)\.(title|badge|description)$/;
  const seen = new Map<string, Set<string>>();
  for (const member of dicts[0]!.members) {
    if (!ts.isPropertySignature(member)) continue;
    const name = member.name;
    const text = ts.isStringLiteral(name) ? name.text : null;
    const m = text ? pattern.exec(text) : null;
    if (m && m[1] && m[2]) {
      if (!seen.has(m[1])) seen.set(m[1], new Set());
      seen.get(m[1])!.add(m[2]);
    }
  }
  const complete = new Set<string>();
  const incomplete: string[] = [];
  for (const [id, kinds] of seen) {
    if (kinds.size === 3) complete.add(id);
    else incomplete.push(`${id} (has: ${[...kinds].sort().join(',')})`);
  }
  return { ok: true, complete, incomplete };
}
function extractEnToolboxKeyValues(sourceText: string, fileName: string): { present: Set<string>; empty: string[] } {
  const sf = parseTs(fileName, sourceText);
  const pattern = /^chat\.designToolbox\.action\.([a-zA-Z0-9-]+)\.(title|badge|description)$/;
  const present = new Set<string>();
  const empty: string[] = [];
  function visit(node: TypeScriptModule.Node): void {
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name && pattern.test(name)) {
        const value = stringLiteralValue(node.initializer);
        if (value === null || value.trim().length === 0) empty.push(name);
        else present.add(name);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { present, empty };
}

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
// Exact-sequence comparison for two {id, preferredSkillIds}[] lists (order
// of preferredSkillIds matters -- it is the tier-1 match priority).
function actionListsExactlyEqual(a: ExtractedAction[], b: ExtractedAction[]): { equal: boolean; detail: string } {
  const byIdA = new Map(a.map((x) => [x.id, x.preferredSkillIds] as const));
  const byIdB = new Map(b.map((x) => [x.id, x.preferredSkillIds] as const));
  const diff = multisetDiff(
    a.map((x) => x.id),
    b.map((x) => x.id),
  );
  const problems: string[] = [];
  if (diff.onlyInA.length) problems.push(`ids only in AST-derived reading: ${diff.onlyInA.join(', ')}`);
  if (diff.onlyInB.length) problems.push(`ids only in runtime-imported reading: ${diff.onlyInB.join(', ')}`);
  if (diff.countMismatch.length) problems.push(`id occurrence-count mismatches: ${diff.countMismatch.join(', ')}`);
  for (const [id, seqA] of byIdA) {
    const seqB = byIdB.get(id);
    if (!seqB) continue;
    if (seqA.length !== seqB.length || seqA.some((v, i) => v !== seqB[i])) {
      problems.push(`preferredSkillIds sequence mismatch for "${id}": AST=[${seqA.join(',')}] runtime=[${seqB.join(',')}]`);
    }
  }
  return { equal: problems.length === 0, detail: problems.join('\n') };
}

// -----------------------------------------------------------------------
// [R1-F5] Layer B: dynamically import the REAL production module and read
// the actually-executed export -- a genuine runtime execution, not an
// inference from source shape.
// -----------------------------------------------------------------------
const DESIGN_TOOLBOX_SRC_REL = 'apps/web/src/runtime/design-toolbox.ts';
const DAEMON_SKILLS_SRC_REL = 'apps/daemon/src/skills.ts';
const SKILLS_ROOT_REL = 'skills';
const NEXT_STEP_ACTIONS_SRC_REL = 'apps/web/src/components/NextStepActions.tsx'; // [R3-F1]

async function loadDesignToolboxModule(): Promise<{ ok: true; mod: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const abs = path.join(repoRoot, DESIGN_TOOLBOX_SRC_REL);
    const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
    return { ok: true, mod };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.stack ?? err) };
  }
}
async function loadDaemonSkillsModule(): Promise<{ ok: true; mod: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const abs = path.join(repoRoot, DAEMON_SKILLS_SRC_REL);
    const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
    return { ok: true, mod };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.stack ?? err) };
  }
}
function safeExtractRuntimeActions(value: unknown): { ok: boolean; actions: ExtractedAction[]; error?: string } {
  if (!Array.isArray(value)) return { ok: false, actions: [], error: 'DESIGN_TOOLBOX_ACTIONS runtime export is not an array' };
  const actions: ExtractedAction[] = [];
  for (const el of value) {
    if (typeof el !== 'object' || el === null) return { ok: false, actions: [], error: 'a runtime action element is not an object' };
    const rec = el as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(rec, 'id') || !Object.prototype.hasOwnProperty.call(rec, 'preferredSkillIds')) {
      return { ok: false, actions: [], error: 'a runtime action element is missing id/preferredSkillIds as own properties' };
    }
    const id = rec.id;
    const pref = rec.preferredSkillIds;
    if (typeof id !== 'string') return { ok: false, actions: [], error: 'a runtime action id is not a string' };
    if (!Array.isArray(pref) || !pref.every((x) => typeof x === 'string')) {
      return { ok: false, actions: [], error: `runtime preferredSkillIds for "${id}" is not a string array` };
    }
    actions.push({ id, preferredSkillIds: pref as string[] });
  }
  return { ok: true, actions };
}
async function liveSkillsList(): Promise<{ ok: true; skills: unknown[] } | { ok: false; error: string }> {
  const loaded = await loadDaemonSkillsModule();
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const listSkills = loaded.mod.listSkills;
  if (typeof listSkills !== 'function') return { ok: false, error: 'apps/daemon/src/skills.ts does not export a callable listSkills' };
  try {
    const skills = (await (listSkills as (roots: string[]) => Promise<unknown[]>)([path.join(repoRoot, SKILLS_ROOT_REL)])) as unknown[];
    return { ok: true, skills };
  } catch (err) {
    return { ok: false, error: `listSkills() threw: ${String((err as Error)?.stack ?? err)}` };
  }
}

// =========================================================================
// Vitest / Playwright JSON reporter runners. [R1-F1]: file arguments are
// PACKAGE-relative (the caller passes the path relative to that package's
// own root), matching `pnpm --filter <pkg> exec ...`'s actual CWD -- verified
// live in this session against throwaway probe files at every pinned path.
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
function runVitestFile(pkgFilter: string, packageRelativeFile: string, outName: string): { status: number; data: VitestSuiteJson | null; raw: string } {
  const outPath = path.join(proofDir, `${outName}.json`);
  const r = sh('pnpm', ['--filter', pkgFilter, 'exec', 'vitest', 'run', packageRelativeFile, '--reporter=json', `--outputFile=${outPath}`], { timeoutMs: 10 * 60_000 });
  let data: VitestSuiteJson | null = null;
  try {
    data = JSON.parse(fs.readFileSync(outPath, 'utf8')) as VitestSuiteJson;
  } catch {
    data = null;
  }
  return { status: r.status, data, raw: `${r.stdout}\n${r.stderr}`.slice(0, 20_000) };
}
interface PwResult {
  status: string;
  stdout?: { text?: string }[];
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
// [R1-F2] Also collects every captured console.log line from every result's
// `stdout` array (confirmed-live schema, §2) so callers can cross-check a
// per-test runtime marker.
function pwSpecStdoutLines(spec: PwSpec): string[] {
  const lines: string[] = [];
  for (const t of spec.tests) {
    for (const r of t.results) {
      for (const entry of r.stdout ?? []) {
        if (entry.text) lines.push(...entry.text.split('\n'));
      }
    }
  }
  return lines;
}
function runPlaywrightFile(packageRelativeFile: string, outName: string): { status: number; specs: PwSpec[]; raw: string } {
  const outPath = path.join(proofDir, `${outName}.json`);
  const r = sh('pnpm', ['--filter', '@open-design/e2e', 'exec', 'playwright', 'test', '-c', 'playwright.config.ts', packageRelativeFile, '--reporter=json'], {
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
// Shared isolated-daemon-boot helper (C10C-3, C10C-5). Never ports
// 7456/51012; teardown targets the exact namespaced process `tools-dev`
// itself tracks, never a wrapper shell.
// =========================================================================
interface DaemonBootOk {
  ok: true;
  daemonUrl: string;
}
interface DaemonBootFail {
  ok: false;
  detail: string;
  rawEvidence: string;
}
// [R3-F5] pid liveness check -- process.kill(pid, 0) sends no signal, just
// probes existence; it throws ESRCH once the process is truly gone. Never
// infer death from a single point-in-time report; poll it.
function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function waitUntilDead(pids: number[], deadlineMs: number): Promise<number[]> {
  const startedAt = Date.now();
  let survivors = pids.filter(pidIsAlive);
  while (survivors.length > 0 && Date.now() - startedAt < deadlineMs) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    survivors = survivors.filter(pidIsAlive);
  }
  return survivors;
}
// [R3-F5] Fail-closed teardown confirmation. DECISIONS.md's W9AS-PARK record
// documents the exact bug this replaces: trusting a tracked group leader's
// reported exit as proof the whole group is gone, while a descendant in the
// same process group survives. This never trusts `tools-dev stop`'s report
// alone -- it independently polls pid liveness (process.kill(pid, 0)) for
// both the pid this helper itself captured at boot AND every pid `stop`
// reports as still-remaining, and if anything is still alive, escalates via
// process-GROUP signaling (safe here because the daemon sidecar is spawned
// with detached:true -- POSIX setsid() makes its own pid double as its
// process-group id, so `process.kill(-pid, signal)` reaches every
// descendant in the group, not just the tracked leader). A `partial` status
// or an unconfirmed survivor after full escalation is reported as
// `ok:false`; callers MUST fold that into their criterion's overall
// pass/fail, never silently proceed.
interface StopParsedShape {
  daemon?: { status?: string; stop?: { remainingPids?: number[] } };
}
async function confirmTeardown(namespace: string, tempDataDir: string, knownPid: number | null): Promise<{ ok: boolean; detail: string }> {
  const stopResult = sh('pnpm', ['tools-dev', 'stop', 'daemon', '--namespace', namespace, '--json'], {
    timeoutMs: 60_000,
    env: { ...process.env, OD_DATA_DIR: tempDataDir },
  });
  const jsonStart = stopResult.stdout.indexOf('{');
  let stopParsed: StopParsedShape | null = null;
  if (jsonStart !== -1) {
    try {
      stopParsed = JSON.parse(stopResult.stdout.slice(jsonStart)) as StopParsedShape;
    } catch {
      stopParsed = null;
    }
  }
  const reportedStatus = stopParsed?.daemon?.status ?? null;
  const reportedRemaining = stopParsed?.daemon?.stop?.remainingPids ?? [];
  const candidatePids = [...new Set([...(knownPid !== null ? [knownPid] : []), ...reportedRemaining])];
  if (candidatePids.length === 0) {
    return { ok: true, detail: `tools-dev reported status="${reportedStatus}"; no known/reported pid to confirm (stop exit=${stopResult.status})` };
  }
  const survivorsAfterStop = await waitUntilDead(candidatePids, 5_000);
  if (survivorsAfterStop.length === 0) {
    return { ok: true, detail: `tools-dev reported status="${reportedStatus}"; independent pid-liveness polling confirmed pid(s) ${candidatePids.join(', ')} dead` };
  }
  // Escalate: process-GROUP signal, never a single leader-only signal.
  for (const pid of survivorsAfterStop) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      /* group may already be gone, or pid was never a pgid leader -- continue to confirmation poll regardless */
    }
  }
  const survivorsAfterTerm = await waitUntilDead(survivorsAfterStop, 3_000);
  for (const pid of survivorsAfterTerm) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* best effort -- confirmation poll below is the actual gate */
    }
  }
  const survivorsAfterKill = await waitUntilDead(survivorsAfterTerm, 3_000);
  if (survivorsAfterKill.length > 0) {
    return { ok: false, detail: `TEARDOWN FAILED: pid(s) ${survivorsAfterKill.join(', ')} still alive after tools-dev stop (status="${reportedStatus}") + independent process-group SIGTERM + SIGKILL escalation` };
  }
  return { ok: true, detail: `tools-dev reported status="${reportedStatus}" but pid(s) ${survivorsAfterStop.join(', ')} were still alive after its own stop; escalated via process-group SIGTERM/SIGKILL and confirmed dead` };
}
async function withIsolatedDaemon<T>(
  label: string,
  fn: (daemonUrl: string) => Promise<T>,
): Promise<{ boot: DaemonBootOk | DaemonBootFail; result: T | null; teardownOk: boolean; teardownDetail: string }> {
  const namespace = `verify-w10c-${label}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-w10c-data-'));
  let started = false;
  let bootedPid: number | null = null;

  // `pnpm tools-dev ...` (a root npm-style script alias) prints a
  // "> mishmash@... tools-dev\n> pnpm exec tools-dev ..." banner ahead of
  // the command's own stdout, so JSON.parse on the raw stdout fails --
  // slice from the first '{' instead of trusting stdout to be pure JSON.
  function parseJsonTail<J>(stdout: string): J | null {
    const start = stdout.indexOf('{');
    if (start === -1) return null;
    try {
      return JSON.parse(stdout.slice(start)) as J;
    } catch {
      return null;
    }
  }

  async function bootAndRun(): Promise<{ boot: DaemonBootOk | DaemonBootFail; result: T | null }> {
    // `start`, not `run`: `tools-dev run` blocks in the foreground until
    // interrupted (confirmed by reading its own CLI registration text,
    // "Start apps and keep this command alive until interrupted"); `start`
    // returns once the daemon is confirmed running, which this script needs.
    const startResult = sh('pnpm', ['tools-dev', 'start', 'daemon', '--namespace', namespace, '--json'], {
      timeoutMs: 3 * 60_000,
      env: { ...process.env, OD_DATA_DIR: tempDataDir },
    });
    if (startResult.status !== 0) {
      return { boot: { ok: false, detail: `tools-dev start failed with exit ${startResult.status}`, rawEvidence: `${startResult.stdout}\n${startResult.stderr}` }, result: null };
    }
    started = true;
    // [R3-F5] Capture the daemon's own reported pid (DaemonStatusSnapshot.pid,
    // packages/sidecar-proto/src/index.ts) at boot -- this is what teardown
    // independently confirms dead, rather than trusting a later report alone.
    let daemonUrl: string | null = null;
    const startParsed = parseJsonTail<{ daemon?: { status?: { url?: string; pid?: number | null } } }>(startResult.stdout);
    daemonUrl = startParsed?.daemon?.status?.url ?? null;
    bootedPid = startParsed?.daemon?.status?.pid ?? null;
    if (!daemonUrl || bootedPid === null) {
      const statusResult = sh('pnpm', ['tools-dev', 'status', 'daemon', '--namespace', namespace, '--json'], { timeoutMs: 30_000 });
      const statusParsed = parseJsonTail<{ url?: string; pid?: number | null }>(statusResult.stdout);
      daemonUrl = daemonUrl ?? statusParsed?.url ?? null;
      bootedPid = bootedPid ?? statusParsed?.pid ?? null;
    }
    if (!daemonUrl) {
      return { boot: { ok: false, detail: 'could not discover the isolated daemon URL from tools-dev output', rawEvidence: startResult.stdout }, result: null };
    }
    const parsedUrl = new URL(daemonUrl);
    const forbiddenPorts = new Set(['7456', '51012']);
    if (forbiddenPorts.has(parsedUrl.port)) {
      return { boot: { ok: false, detail: `discovered daemon port ${parsedUrl.port} is a forbidden default-namespace port -- refusing to probe it`, rawEvidence: '' }, result: null };
    }
    if (!['127.0.0.1', 'localhost'].includes(parsedUrl.hostname)) {
      return { boot: { ok: false, detail: `discovered daemon hostname "${parsedUrl.hostname}" is not a loopback address -- refusing to probe it`, rawEvidence: '' }, result: null };
    }
    const result = await fn(daemonUrl);
    return { boot: { ok: true, daemonUrl }, result };
  }

  let outcome: { boot: DaemonBootOk | DaemonBootFail; result: T | null } = {
    boot: { ok: false, detail: 'bootAndRun did not complete', rawEvidence: '' },
    result: null,
  };
  let teardownOk = true;
  let teardownDetail = 'daemon never started -- no teardown needed';
  try {
    outcome = await bootAndRun();
  } finally {
    if (started) {
      const confirmed = await confirmTeardown(namespace, tempDataDir, bootedPid);
      teardownOk = confirmed.ok;
      teardownDetail = confirmed.detail;
    }
    try {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    } catch {
      /* best effort cleanup only */
    }
  }
  return { ...outcome, teardownOk, teardownDetail };
}
// [R3-F5] Fail-closed, redirect:'manual', re-validated-origin GET for
// /api/skills -- the SINGLE hardened fetch path every C10C-3/C10C-5 probe
// must go through (never a raw, ad hoc `fetch(...)` call), returning both
// the id list (for parity/multiset checks) and the raw skill records (for
// callers, like C10C-3's oracle, that need real objects to pass into
// findDesignToolboxSkill).
async function fetchLiveSkillsOverHttp(daemonUrl: string): Promise<{ ok: true; ids: string[]; skills: unknown[] } | { ok: false; error: string }> {
  try {
    const base = new URL(daemonUrl);
    const skillsUrl = new URL('/api/skills', daemonUrl);
    if (skillsUrl.origin !== base.origin) throw new Error('constructed URL origin drifted from the discovered daemon origin');
    const resp = await fetch(skillsUrl, { redirect: 'manual' });
    if (resp.status >= 300 && resp.status < 400) throw new Error(`unexpected redirect (status ${resp.status}) -- refusing to follow`);
    if (resp.status !== 200) throw new Error(`GET /api/skills returned status ${resp.status}`);
    const body = (await resp.json()) as { skills?: { id?: string }[] };
    const skills = body.skills ?? [];
    return { ok: true, ids: skills.map((s) => String(s.id ?? '')), skills };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

// =========================================================================
// Main
// =========================================================================
const I18N_TYPES_REL = 'apps/web/src/i18n/types.ts';
const I18N_EN_REL = 'apps/web/src/i18n/locales/en.ts';
const E2E_UI_SPEC_REL = 'e2e/ui/design-toolbox-actions.test.ts';
const E2E_UI_SPEC_PKG_REL = 'ui/design-toolbox-actions.test.ts'; // [R1-F1]
const E2E_PHANTOM_SPEC_REL = 'e2e/tests/design-toolbox-phantom-id.test.ts';
const E2E_PHANTOM_SPEC_PKG_REL = 'tests/design-toolbox-phantom-id.test.ts'; // [R1-F1]
const DAEMON_SUITE_SPEC_REL = 'apps/daemon/tests/design-toolbox-skill-refs.test.ts';
const DAEMON_SUITE_SPEC_PKG_REL = 'tests/design-toolbox-skill-refs.test.ts'; // [R1-F1]
const REVIEW_RECORD_REL = 'docs/plans/waves/w10c-toolbox-implementation-review.json';
const CHAT_COMPOSER_JSDOM_TEST_REL = 'apps/web/tests/components/ChatComposer.design-toolbox.test.tsx';
const REPO_ROOT_GUARD_REL = 'scripts/check-toolbox-skill-refs.test.ts';

// [R1-F7] Complete owned-path list. [R3-F1] added NEXT_STEP_ACTIONS_SRC_REL
// -- it is now a real dependency of C10C-2's cross-file structural proof, so
// C10C-7's stale-review check must cover it too.
const OWNED_IMPLEMENTATION_PATHS = [
  E2E_UI_SPEC_REL,
  E2E_PHANTOM_SPEC_REL,
  DAEMON_SUITE_SPEC_REL,
  DESIGN_TOOLBOX_SRC_REL,
  I18N_TYPES_REL,
  I18N_EN_REL,
  CHAT_COMPOSER_JSDOM_TEST_REL,
  REPO_ROOT_GUARD_REL,
  NEXT_STEP_ACTIONS_SRC_REL,
];

let derivedActionIds: string[] | null = null; // set by C10C-1, consumed by C10C-2/C10C-4

async function main(): Promise<void> {
  // -----------------------------------------------------------------------
  // C10C-1
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-1', async () => {
    const srcAbs = path.join(repoRoot, DESIGN_TOOLBOX_SRC_REL);
    const typesAbs = path.join(repoRoot, I18N_TYPES_REL);
    const enAbs = path.join(repoRoot, I18N_EN_REL);
    if (!fs.existsSync(srcAbs)) {
      record('C10C-1', '', 'DESIGN_TOOLBOX_ACTIONS structurally sound, runtime-cross-checked, and i18n-complete', false, '', { detail: `${DESIGN_TOOLBOX_SRC_REL} does not exist` });
      return;
    }
    const source = fs.readFileSync(srcAbs, 'utf8');
    const sf = parseTs(srcAbs, source);
    const layerA = extractDesignToolboxActionsLayerA(source, srcAbs);
    const mutationHits = scanForMutationCalls(sf, 'DESIGN_TOOLBOX_ACTIONS');
    const structuralProblems: string[] = [...layerA.errors];
    if (mutationHits.length) structuralProblems.push(`mutation call(s) against DESIGN_TOOLBOX_ACTIONS found: ${mutationHits.join(', ')}`);

    if (!layerA.ok) {
      record('C10C-1', `TypeScript-AST parse of ${DESIGN_TOOLBOX_SRC_REL}`, 'DESIGN_TOOLBOX_ACTIONS is a unique, top-level, exported, literal-only array (Layer A)', false, structuralProblems.join('\n'));
      return;
    }

    // Layer B -- runtime cross-check.
    const runtimeMod = await loadDesignToolboxModule();
    if (!runtimeMod.ok) {
      record('C10C-1', 'dynamic import() of the real design-toolbox.ts module', 'the module loads and executes at runtime', false, '', { detail: runtimeMod.error });
      return;
    }
    // [R3-F4] Runtime property-descriptor/prototype shape check -- the
    // authoritative defense against alias-mediated mutation (see FIX ROUND 3
    // header note); run BEFORE the more lenient safeExtractRuntimeActions,
    // which only checks hasOwnProperty and would happily accept a shape this
    // check rejects (extra keys, accessor descriptors, foreign prototypes).
    const shapeCheck = inspectRuntimeActionsShape(runtimeMod.mod.DESIGN_TOOLBOX_ACTIONS);
    if (!shapeCheck.ok) structuralProblems.push(`runtime shape check failed:\n${shapeCheck.problems.join('\n')}`);

    const runtimeActions = safeExtractRuntimeActions(runtimeMod.mod.DESIGN_TOOLBOX_ACTIONS);
    if (!runtimeActions.ok) {
      record('C10C-1', '', 'the runtime-executed DESIGN_TOOLBOX_ACTIONS export matches the AST-derived reading', false, structuralProblems.join('\n'), { detail: runtimeActions.error });
      return;
    }
    const crossCheck = actionListsExactlyEqual(layerA.actions, runtimeActions.actions);
    if (!crossCheck.equal) {
      structuralProblems.push(`Layer A / Layer B mismatch:\n${crossCheck.detail}`);
    }

    if (!fs.existsSync(typesAbs) || !fs.existsSync(enAbs)) {
      record('C10C-1', '', 'i18n cross-check sources exist', false, structuralProblems.join('\n'), { detail: `missing ${!fs.existsSync(typesAbs) ? I18N_TYPES_REL : ''} ${!fs.existsSync(enAbs) ? I18N_EN_REL : ''}`.trim() });
      return;
    }
    const i18n = extractDesignToolboxI18nIdsFromDict(fs.readFileSync(typesAbs, 'utf8'), typesAbs);
    if (!i18n.ok) {
      record('C10C-1', `TypeScript-AST parse of ${I18N_TYPES_REL}`, 'exactly one "Dict" interface declaration exists', false, structuralProblems.join('\n'), { detail: i18n.error });
      return;
    }
    const enExtract = extractEnToolboxKeyValues(fs.readFileSync(enAbs, 'utf8'), enAbs);
    const idDiff = multisetDiff(
      runtimeActions.actions.map((a) => a.id),
      [...i18n.complete],
    );
    const problems: string[] = [...structuralProblems];
    if (idDiff.onlyInA.length) problems.push(`actions with no complete (title+badge+description) Dict key triple: ${idDiff.onlyInA.join(', ')}`);
    if (idDiff.onlyInB.length) problems.push(`Dict key triples with no matching action: ${idDiff.onlyInB.join(', ')}`);
    if (idDiff.countMismatch.length) problems.push(`id count mismatches: ${idDiff.countMismatch.join(', ')}`);
    if (i18n.incomplete.length) problems.push(`incomplete Dict key triples: ${i18n.incomplete.join(', ')}`);
    if (enExtract.empty.length) problems.push(`empty-string en.ts values: ${enExtract.empty.join(', ')}`);
    const expectedKeys = [...i18n.complete].flatMap((id) => [
      `chat.designToolbox.action.${id}.title`,
      `chat.designToolbox.action.${id}.badge`,
      `chat.designToolbox.action.${id}.description`,
    ]);
    const missingFromEn = expectedKeys.filter((k) => !enExtract.present.has(k));
    if (missingFromEn.length) problems.push(`keys declared in Dict but missing (or empty) in en.ts: ${missingFromEn.join(', ')}`);

    if (problems.length === 0) derivedActionIds = runtimeActions.actions.map((a) => a.id);
    record(
      'C10C-1',
      `AST parse of ${DESIGN_TOOLBOX_SRC_REL}/${I18N_TYPES_REL}/${I18N_EN_REL} + dynamic import() of ${DESIGN_TOOLBOX_SRC_REL}`,
      'unique top-level exported literal-only DESIGN_TOOLBOX_ACTIONS (Layer A), no mutation calls, exactly matching its own runtime-executed export (Layer B) whose OWN KEYS/DESCRIPTORS/PROTOTYPE are an honest plain array of plain data-property objects (no accessor, no extra key, no foreign prototype), exactly matching the unique Dict interface, exactly matching non-empty en.ts values',
      problems.length === 0,
      `derived action count: ${runtimeActions.actions.length}\nderived ids: ${[...new Set(runtimeActions.actions.map((a) => a.id))].sort().join(', ')}\n${problems.join('\n')}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-2 -- [orchestrator ruling 2] extended to cover BOTH catalogue
  // consumers (DesignToolboxPanel + NextStepActions.tsx), asserting their
  // featured/non-featured partition of the derived action set explicitly.
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-2', async () => {
    if (!derivedActionIds || derivedActionIds.length === 0) {
      record('C10C-2', '', 'per-action walk covers exactly the C10C-1-derived action set for both consumers', false, '', { detail: 'C10C-1 did not produce a derived action-id set; cannot verify per-action coverage' });
      return;
    }

    // Independent runtime oracle + the explicit consumer-partition check
    // (orchestrator ruling 2's "assert the intended difference" instruction).
    // Computed regardless of whether the delegated spec file exists yet --
    // the partition is a fact about the catalogue itself, not about the test.
    const toolboxMod = await loadDesignToolboxModule();
    const skillsResult = await liveSkillsList();
    if (!toolboxMod.ok || !skillsResult.ok) {
      record('C10C-2', '', 'this verifier can independently compute the expected resolution for every action and the featured/non-featured partition', false, '', {
        detail: !toolboxMod.ok ? toolboxMod.error : !skillsResult.ok ? skillsResult.error : 'unknown oracle failure',
      });
      return;
    }
    const findDesignToolboxSkill = toolboxMod.mod.findDesignToolboxSkill;
    const actionsRuntime = safeExtractRuntimeActions(toolboxMod.mod.DESIGN_TOOLBOX_ACTIONS);
    if (typeof findDesignToolboxSkill !== 'function' || !actionsRuntime.ok) {
      record('C10C-2', '', 'this verifier can independently compute the expected resolution for every action', false, '', { detail: 'findDesignToolboxSkill is not callable or DESIGN_TOOLBOX_ACTIONS is malformed at runtime' });
      return;
    }
    const runtimeActionsByFullObj = toolboxMod.mod.DESIGN_TOOLBOX_ACTIONS as { id: string }[];
    const expectedByAction = new Map<string, string>();
    for (const action of runtimeActionsByFullObj) {
      const resolved = (findDesignToolboxSkill as (a: unknown, s: unknown[]) => { name?: unknown } | null)(action, skillsResult.skills);
      expectedByAction.set(action.id, resolved && typeof resolved.name === 'string' ? resolved.name : '__NONE__');
    }

    const partitionProblems: string[] = [];
    const featuredRaw = toolboxMod.mod.FEATURED_DESIGN_TOOLBOX_ACTION_IDS;
    const featuredShape = inspectRuntimeStringArrayShape(featuredRaw, 'FEATURED_DESIGN_TOOLBOX_ACTION_IDS'); // [R3-F4]
    if (!featuredShape.ok) {
      partitionProblems.push(...featuredShape.problems);
    } else {
      const featuredIds = featuredRaw as string[];
      if (featuredIds.length === 0) partitionProblems.push('FEATURED_DESIGN_TOOLBOX_ACTION_IDS is empty');
      const nonFeaturedIds = derivedActionIds.filter((id) => !featuredIds.includes(id));
      const partitionDiff = multisetDiff([...featuredIds, ...nonFeaturedIds], derivedActionIds);
      if (partitionDiff.onlyInA.length) partitionProblems.push(`featured+non-featured union has id(s) not in the derived set: ${partitionDiff.onlyInA.join(', ')}`);
      if (partitionDiff.onlyInB.length) partitionProblems.push(`derived set has id(s) covered by NEITHER featured nor non-featured: ${partitionDiff.onlyInB.join(', ')}`);
      if (partitionDiff.countMismatch.length) partitionProblems.push(`featured/non-featured partition count mismatch (overlap or duplicate): ${partitionDiff.countMismatch.join(', ')}`);
    }
    // [R3-F1] Cross-file structural proof: the above is a fact about the
    // verifier's OWN arithmetic (complement of the featured set). Proving
    // the SECOND CONSUMER actually renders that split requires parsing
    // NextStepActions.tsx's own real source and checking it, not the
    // verifier's derived set, structurally implements the partition and
    // exposes the four pinned testid fragments as genuine JSX literals.
    const nextStepSrcAbs = path.join(repoRoot, NEXT_STEP_ACTIONS_SRC_REL);
    if (!fs.existsSync(nextStepSrcAbs)) {
      partitionProblems.push(`${NEXT_STEP_ACTIONS_SRC_REL} does not exist -- cannot prove the second consumer structurally implements the featured/non-featured split`);
    } else {
      const nextStepSource = fs.readFileSync(nextStepSrcAbs, 'utf8');
      const nextStepSf = parseTs(nextStepSrcAbs, nextStepSource);
      const structuralPartition = nextStepPartitionIsStructurallyReal(nextStepSf);
      if (!structuralPartition.ok) partitionProblems.push(...structuralPartition.problems.map((p) => `[${NEXT_STEP_ACTIONS_SRC_REL}] ${p}`));
      const testIdValues = collectJsxTestIdLiteralValues(nextStepSf);
      for (const fragment of ['next-step-toolbox-action-', 'next-step-toolbox-more', 'next-step-more-toolbox', 'next-step-toolbox-sub-action-']) {
        if (![...testIdValues].some((v) => v.includes(fragment))) {
          partitionProblems.push(`[${NEXT_STEP_ACTIONS_SRC_REL}] no data-testid literal containing "${fragment}" found in its own source`);
        }
      }
    }

    const specAbs = path.join(repoRoot, E2E_UI_SPEC_REL);
    if (!fs.existsSync(specAbs)) {
      record('C10C-2', '', 'exhaustive, table-driven, real-daemon-backed per-action walk from BOTH catalogue consumers, with an explicit partition assertion and a fresh runtime oracle', false, partitionProblems.join('\n'), { detail: `${E2E_UI_SPEC_REL} does not exist` });
      return;
    }

    const source = fs.readFileSync(specAbs, 'utf8');
    const sf = parseTs(specAbs, source);
    const banned = containsBannedTestMarker(sf);
    const hasDynImport = hasDynamicImportReferencingFile(sf, 'design-toolbox');
    const allLoops = findAllForOfLoopsGeneratingTests(sf, 'TOOLBOX_ACTIONS');
    const sidePanelLoop = allLoops.find((l) => subtreeContainsStringLiteralFragment(l.statement, 'chat-plus-trigger'));
    const nextStepLoop = allLoops.find((l) => subtreeContainsStringLiteralFragment(l.statement, 'next-step-toolbox'));
    const structuralProblems: string[] = [...partitionProblems];
    if (banned.length) structuralProblems.push(`banned skip/only/fixme/todo markers: ${banned.join(', ')}`);
    if (!hasDynImport) structuralProblems.push('no dynamic import() call referencing "design-toolbox" found (a static import declaration fails this package\'s NodeNext typecheck -- see PRD §2)');
    if (!sidePanelLoop) {
      structuralProblems.push('no for-of loop over a TOOLBOX_ACTIONS-like binding referencing "chat-plus-trigger" (the DesignToolboxPanel consumer loop) was found');
    } else {
      // [R3-F1] bind .click() to its OWN selector-chain fragment, not two
      // independent unbound facts ("a fragment appears somewhere in the
      // loop" + "some .click() appears somewhere in the loop") that let one
      // loop drive both surfaces, or neither, while computing markers from
      // the imported resolver.
      if (countClickChainsReferencing(sidePanelLoop.statement, 'chat-plus-trigger') < 1) {
        structuralProblems.push('the side-panel test loop has no .click() call whose OWN selector-chain references "chat-plus-trigger"');
      }
      if (!subtreeHasMethodCall(sidePanelLoop.statement, ['textContent', 'innerText'])) structuralProblems.push('the side-panel test loop body has no .textContent(...)/.innerText(...) call');
    }
    if (!nextStepLoop) {
      structuralProblems.push('no for-of loop over a TOOLBOX_ACTIONS-like binding referencing "next-step-toolbox" (the NextStepActions consumer loop required by orchestrator ruling 2) was found');
    } else {
      // [R3-F1] require THREE distinct, selector-bound click chains proving
      // the real multi-step "More" navigation structure confirmed against
      // NextStepActions.tsx's own source (next-step-toolbox-more opens the
      // More menu, next-step-more-toolbox opens the toolbox submenu, then
      // either next-step-toolbox-action-<id> (featured/direct) or
      // next-step-toolbox-sub-action-<id> (non-featured/submenu) is
      // clicked) -- not one unbound .click() call that could belong to
      // either surface or neither.
      const moreTriggerClicks = countClickChainsReferencing(nextStepLoop.statement, 'next-step-toolbox-more');
      const moreSubmenuClicks = countClickChainsReferencing(nextStepLoop.statement, 'next-step-more-toolbox');
      const directOrSubActionClicks =
        countClickChainsReferencing(nextStepLoop.statement, 'next-step-toolbox-action') + countClickChainsReferencing(nextStepLoop.statement, 'next-step-toolbox-sub-action');
      if (moreTriggerClicks < 1) structuralProblems.push('the next-step test loop has no .click() call bound to the "next-step-toolbox-more" trigger selector');
      if (moreSubmenuClicks < 1) structuralProblems.push('the next-step test loop has no .click() call bound to the "next-step-more-toolbox" submenu selector');
      if (directOrSubActionClicks < 1) structuralProblems.push('the next-step test loop has no .click() call bound to a "next-step-toolbox-action-"/"next-step-toolbox-sub-action-" selector');
      if (!subtreeHasMethodCall(nextStepLoop.statement, ['textContent', 'innerText'])) structuralProblems.push('the next-step test loop body has no .textContent(...)/.innerText(...) call');
    }

    const run = runPlaywrightFile(E2E_UI_SPEC_PKG_REL, 'C10C-2-playwright'); // [R1-F1] package-relative
    const coverageProblems: string[] = [];
    const sidePanelTitle = (id: string) => `toolbox action "${id}" resolves and applies from the side panel`;
    const nextStepTitle = (id: string) => `next-step action "${id}" resolves and applies from the assistant next-step card`;
    const sidePanelMarkerRe = /^W10C_RESOLVED (\S+) (.+)$/;
    const nextStepMarkerRe = /^W10C_NEXTSTEP_RESOLVED (\S+) (.+)$/;

    function checkOneConsumer(titleFor: (id: string) => string, markerRe: RegExp, label: string): void {
      for (const id of derivedActionIds!) {
        const expectedTitle = titleFor(id);
        const matching = run.specs.filter((s) => s.title === expectedTitle);
        if (matching.length === 0) {
          coverageProblems.push(`[${label}] no spec titled exactly "${expectedTitle}"`);
          continue;
        }
        if (matching.length > 1) {
          coverageProblems.push(`[${label}] ${matching.length} specs titled exactly "${expectedTitle}" -- expected exactly 1`);
          continue;
        }
        const spec = matching[0]!;
        if (!spec.ok) {
          coverageProblems.push(`[${label}] spec for "${id}" did not pass`);
          continue;
        }
        const lines = pwSpecStdoutLines(spec);
        // [R3-F1] the marker's reported id (capture group 1) must equal the
        // id under test, not merely match the marker's regex SHAPE -- a
        // spec that emits a syntactically-valid marker for the WRONG id
        // (e.g. always the first action) previously still passed here,
        // since only the value (group 2) was ever inspected.
        let matchedMarker: RegExpExecArray | null = null;
        for (const l of lines) {
          const exec = markerRe.exec(l.trim());
          if (exec && exec[1] === id) {
            matchedMarker = exec;
            break;
          }
        }
        if (!matchedMarker) {
          coverageProblems.push(`[${label}] no marker REPORTING id "${id}" found in captured stdout (a marker present for a different id does not count)`);
          continue;
        }
        const observed = matchedMarker[2] ?? '';
        const expected = expectedByAction.get(id) ?? '__NONE__';
        if (observed !== expected) {
          coverageProblems.push(`[${label}] action "${id}": observed marker "${observed}" != independently-computed expected "${expected}"`);
        }
      }
    }
    checkOneConsumer(sidePanelTitle, sidePanelMarkerRe, 'side-panel');
    checkOneConsumer(nextStepTitle, nextStepMarkerRe, 'next-step');

    const expectedTitles = new Set<string>();
    for (const id of derivedActionIds) {
      expectedTitles.add(sidePanelTitle(id));
      expectedTitles.add(nextStepTitle(id));
    }
    const extraneous = run.specs.filter((s) => !expectedTitles.has(s.title));
    if (extraneous.length) coverageProblems.push(`extraneous spec(s) not matching either pinned per-action title format: ${extraneous.map((s) => s.title).join(' | ')}`);
    const expectedSpecCount = derivedActionIds.length * 2;
    if (run.specs.length !== expectedSpecCount) coverageProblems.push(`spec count ${run.specs.length} != expected ${expectedSpecCount} (2 x derived action count, one per consumer)`);

    const allOk = run.status === 0 && run.specs.length > 0 && structuralProblems.length === 0 && coverageProblems.length === 0;
    record(
      'C10C-2',
      `pnpm --filter @open-design/e2e exec playwright test -c playwright.config.ts ${E2E_UI_SPEC_PKG_REL} --reporter=json`,
      "every C10C-1-derived action id has exactly one passing, exact-titled test in EACH of the two catalogue consumers (DesignToolboxPanel + NextStepActions), the featured/non-featured partition holds exactly AND is structurally proven against NextStepActions.tsx's own real source (its own FEATURED_DESIGN_TOOLBOX_ACTION_IDS import + .filter(...).includes(...) split, plus its own data-testid literals), each surface's test loop binds .click() calls to their own selector-chain (not two independent unbound facts), and both consumers' reported runtime markers -- validated by REPORTED ID, not just extracted value -- equal this verifier's own freshly-computed expected resolution",
      allOk,
      `derived action count: ${derivedActionIds.length} (expected spec count: ${expectedSpecCount})\nplaywright exit: ${run.status}\nspecs found: ${run.specs.length}\n${[...structuralProblems, ...coverageProblems].join('\n')}\n\n${run.raw}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-3
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-3', async () => {
    const PHANTOM_LITERAL = 'w10c-red-spec-phantom-skill-id';

    // (a) Verifier's own direct runtime proof -- primary evidence.
    const oracle = await withIsolatedDaemon('c10c3', async (daemonUrl) => {
      // [R3-F5] single hardened fetch (redirect:'manual', origin-revalidated)
      // reused for both the liveness smoke-test and the actual resolution
      // inputs -- no separate raw `fetch(...)` call.
      const httpSkills = await fetchLiveSkillsOverHttp(daemonUrl);
      if (!httpSkills.ok) return { ok: false as const, detail: `HTTP probe failed: ${httpSkills.error}` };
      const toolboxMod = await loadDesignToolboxModule();
      if (!toolboxMod.ok) return { ok: false as const, detail: `could not load design-toolbox.ts: ${toolboxMod.error}` };
      const findDesignToolboxSkill = toolboxMod.mod.findDesignToolboxSkill;
      if (typeof findDesignToolboxSkill !== 'function') return { ok: false as const, detail: 'findDesignToolboxSkill is not callable at runtime' };
      const realActions = safeExtractRuntimeActions(toolboxMod.mod.DESIGN_TOOLBOX_ACTIONS);
      if (!realActions.ok || realActions.actions.length === 0) return { ok: false as const, detail: 'could not read a real action from DESIGN_TOOLBOX_ACTIONS' };
      const realAction = (toolboxMod.mod.DESIGN_TOOLBOX_ACTIONS as unknown[])[0];
      const positive = (findDesignToolboxSkill as (a: unknown, s: unknown[]) => unknown)(realAction, httpSkills.skills);
      const phantomAction = { id: 'w10c-oracle-phantom-action', preferredSkillIds: [PHANTOM_LITERAL], categoryHints: [], searchTerms: ['w10c-red-spec-unmatchable-search-term'] };
      const negative = (findDesignToolboxSkill as (a: unknown, s: unknown[]) => unknown)(phantomAction, httpSkills.skills);
      const positiveOk = positive !== null && positive !== undefined;
      const negativeOk = negative === null || negative === undefined;
      return {
        ok: positiveOk && negativeOk,
        detail: `positive control resolved=${positiveOk} (value=${JSON.stringify(positive)}); phantom resolved-to-null=${negativeOk} (value=${JSON.stringify(negative)})`,
      };
    });

    const oracleOk = oracle.boot.ok && oracle.result?.ok === true && oracle.teardownOk; // [R3-F5] a teardown failure fails the criterion
    const oracleEvidence = oracle.boot.ok
      ? `daemon url: ${oracle.boot.daemonUrl}\n${oracle.result?.detail ?? 'no result'}\nteardown: ok=${oracle.teardownOk} ${oracle.teardownDetail}`
      : `boot failed: ${oracle.boot.detail}\n${oracle.boot.rawEvidence.slice(0, 4000)}\nteardown: ok=${oracle.teardownOk} ${oracle.teardownDetail}`;

    // (b) Required, structurally-bound delegated artifact.
    const specAbs = path.join(repoRoot, E2E_PHANTOM_SPEC_REL);
    if (!fs.existsSync(specAbs)) {
      record('C10C-3', '', "verifier's own runtime proof (a) AND a required, structurally-bound delegated artifact (b)", false, oracleEvidence, { detail: `oracle ok=${oracleOk}; ${E2E_PHANTOM_SPEC_REL} does not exist` });
      return;
    }
    const source = fs.readFileSync(specAbs, 'utf8');
    const sf = parseTs(specAbs, source);
    const banned = containsBannedTestMarker(sf);
    // [R3-F2/F3] real AST call-expression checks, not raw regex/text scans.
    const hasSmokeSuiteCall = countCallsToExactIdentifier(sf, 'createSmokeSuite') >= 1;
    const hasToolsDevChain = hasChainedMethodCall(sf, ['with', 'toolsDev']);
    const hasDynImport = hasDynamicImportReferencingFile(sf, 'design-toolbox');
    // [R3-F2/F3] bind the call-count check to the LOCAL identifier the
    // destructure actually produces, never to the property name text --
    // closes the unbound-import class (an aliased-away import plus a local
    // lookalike function of the same name would otherwise pass).
    const bindingInfo = findDestructuredImportBinding(sf, 'findDesignToolboxSkill');
    const callCount = bindingInfo.localName ? countCallsToExactIdentifier(sf, bindingInfo.localName) : 0;
    const literals = collectAllStringLiteralValues(sf);
    const hasPhantomLiteral = literals.has(PHANTOM_LITERAL);
    const structuralProblems: string[] = [];
    if (banned.length) structuralProblems.push(`banned skip/only/fixme/todo markers: ${banned.join(', ')}`);
    if (!hasSmokeSuiteCall) structuralProblems.push('no real createSmokeSuite(...) CallExpression found (AST-bound)');
    if (!hasToolsDevChain) structuralProblems.push('no real .with.toolsDev(...) chained CallExpression found (AST-bound)');
    if (!hasDynImport) structuralProblems.push('no dynamic import() call referencing "design-toolbox" found');
    if (!bindingInfo.found || !bindingInfo.localName) structuralProblems.push('no destructured binding named exactly "findDesignToolboxSkill" found');
    if (callCount < 2) {
      structuralProblems.push(
        `the local binding this file's "findDesignToolboxSkill" destructure produces (local name: "${bindingInfo.localName ?? '<none>'}") is called ${callCount} time(s), expected at least 2 (positive + negative) -- calls to an unrelated same-named local identifier do not satisfy this`,
      );
    }
    if (!hasPhantomLiteral) structuralProblems.push(`the pinned literal "${PHANTOM_LITERAL}" was not found as a genuine string-literal AST node (a comment does not count)`);

    const run = runVitestFile('@open-design/e2e', E2E_PHANTOM_SPEC_PKG_REL, 'C10C-3-vitest'); // [R1-F1]
    const allTests = run.data ? run.data.testResults.flatMap((t) => t.assertionResults) : [];
    const positiveTitle = 'positive control: a real action resolves via findDesignToolboxSkill';
    const negativeTitle = 'phantom red spec: an unresolvable action returns null via findDesignToolboxSkill';
    const positivePassed = allTests.some((t) => t.fullName.endsWith(positiveTitle) && t.status === 'passed');
    const negativePassed = allTests.some((t) => t.fullName.endsWith(negativeTitle) && t.status === 'passed');
    const runProblems: string[] = [];
    if (!positivePassed) runProblems.push(`no passing test titled exactly "${positiveTitle}"`);
    if (!negativePassed) runProblems.push(`no passing test titled exactly "${negativeTitle}"`);
    if ((run.data?.numFailedTests ?? 1) !== 0) runProblems.push(`${run.data?.numFailedTests ?? 'unknown'} failed test(s) in the suite`);

    const delegatedOk = run.status === 0 && structuralProblems.length === 0 && runProblems.length === 0;
    const allOk = oracleOk && delegatedOk;
    record(
      'C10C-3',
      `verifier-internal daemon boot + direct call to findDesignToolboxSkill; pnpm --filter @open-design/e2e exec vitest run ${E2E_PHANTOM_SPEC_PKG_REL} --reporter=json`,
      "the verifier's own oracle proves the phantom-ID/positive-control behavior at runtime AND its isolated daemon's teardown is independently confirmed (never trusted from a single exit report), AND the required delegated artifact exists, is structurally bound to the real function's LOCAL binding (not a same-named local lookalike), and passes with the pinned paired titles",
      allOk,
      `oracle ok=${oracleOk}\n${oracleEvidence}\n\ndelegated file structural: ${structuralProblems.join('; ') || 'none'}\ndelegated file run: ${runProblems.join('; ') || 'none'}\nvitest exit=${run.status}\n\n${run.raw}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-4
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-4', async () => {
    const PHANTOM_LITERAL = 'w10c-daemon-suite-phantom-skill-id';

    // (a) Verifier's own direct runtime proof.
    let oracleOk = false;
    let oracleEvidence = '';
    if (!derivedActionIds || derivedActionIds.length === 0) {
      oracleEvidence = 'C10C-1 did not produce a derived action-id set; oracle cannot run';
    } else {
      const skillsMod = await loadDaemonSkillsModule();
      const toolboxMod = await loadDesignToolboxModule();
      if (!skillsMod.ok || !toolboxMod.ok) {
        oracleEvidence = `module load failed: ${!skillsMod.ok ? skillsMod.error : ''} ${!toolboxMod.ok ? toolboxMod.error : ''}`.trim();
      } else {
        const listSkills = skillsMod.mod.listSkills;
        const findSkillById = skillsMod.mod.findSkillById;
        if (typeof listSkills !== 'function' || typeof findSkillById !== 'function') {
          oracleEvidence = 'listSkills/findSkillById are not callable at runtime';
        } else {
          const liveSkills = (await (listSkills as (roots: string[]) => Promise<unknown[]>)([path.join(repoRoot, SKILLS_ROOT_REL)])) as unknown[];
          const actionsRuntime = safeExtractRuntimeActions(toolboxMod.mod.DESIGN_TOOLBOX_ACTIONS);
          if (!actionsRuntime.ok) {
            oracleEvidence = 'could not read runtime DESIGN_TOOLBOX_ACTIONS for the mapping check';
          } else {
            const unresolved: string[] = [];
            for (const action of actionsRuntime.actions) {
              for (const skillId of action.preferredSkillIds) {
                const resolved = (findSkillById as (skills: unknown[], id: string) => unknown)(liveSkills, skillId);
                if (resolved === undefined) unresolved.push(`${action.id} -> "${skillId}"`);
              }
            }
            oracleOk = unresolved.length === 0;
            oracleEvidence = oracleOk ? `all preferredSkillIds entries resolved via findSkillById against ${liveSkills.length} live skills` : `unresolved entries: ${unresolved.join(', ')}`;
          }
        }
      }
    }

    // (b) Required, structurally-bound delegated artifact.
    const specAbs = path.join(repoRoot, DAEMON_SUITE_SPEC_REL);
    if (!fs.existsSync(specAbs)) {
      record('C10C-4', '', "verifier's own runtime proof (a) AND a required, structurally-bound delegated artifact in the daemon suite (b)", false, oracleEvidence, { detail: `oracle ok=${oracleOk}; ${DAEMON_SUITE_SPEC_REL} does not exist` });
      return;
    }
    const source = fs.readFileSync(specAbs, 'utf8');
    const sf = parseTs(specAbs, source);
    const banned = containsBannedTestMarker(sf);
    // [R3-F2/F3] real, data-flow-bound compiler-API check (createSourceFile's
    // OWN return value feeding a real forEachChild walk), replacing the
    // decorative "some call to either exists somewhere" check.
    const usesTsCompilerApi = usesCompilerApiForRealExtraction(sf);
    // [R3-F2/F3] bind the call-count checks to each import's LOCAL binding,
    // never to the exported name's text -- closes the unbound-import class.
    const listSkillsBinding = findNamedImportBinding(sf, 'listSkills', '/skills');
    const findSkillByIdBinding = findNamedImportBinding(sf, 'findSkillById', '/skills');
    const skillIdAliasesBinding = findNamedImportBinding(sf, 'SKILL_ID_ALIASES', '/skills'); // [R3-F2] PRD-required check, previously never made
    const listSkillsCalls = listSkillsBinding.localName ? countCallsToExactIdentifier(sf, listSkillsBinding.localName) : 0;
    const findSkillByIdCalls = findSkillByIdBinding.localName ? countCallsToExactIdentifier(sf, findSkillByIdBinding.localName) : 0;
    const skillIdAliasesRefs = skillIdAliasesBinding.localName ? countIdentifierReferences(sf, skillIdAliasesBinding.localName) : 0;
    const literals = collectAllStringLiteralValues(sf);
    const hasPhantomLiteral = literals.has(PHANTOM_LITERAL);
    const noWebImport = !/from\s+['"][^'"]*apps\/web\//.test(source);

    const structuralProblems: string[] = [];
    if (banned.length) structuralProblems.push(`banned skip/only/fixme/todo markers: ${banned.join(', ')}`);
    if (!findSkillByIdBinding.found) structuralProblems.push('no import of the exact export name "findSkillById" from a "/skills" module found');
    if (!listSkillsBinding.found) structuralProblems.push('no import of the exact export name "listSkills" from a "/skills" module found');
    if (!skillIdAliasesBinding.found) structuralProblems.push('no import of the exact export name "SKILL_ID_ALIASES" from a "/skills" module found');
    if (findSkillByIdCalls < 1) structuralProblems.push(`findSkillById's local binding ("${findSkillByIdBinding.localName ?? '<none>'}") is imported but its call count is ${findSkillByIdCalls} -- calls to a differently-bound same-named local identifier do not count`);
    if (listSkillsCalls < 1) structuralProblems.push(`listSkills's local binding ("${listSkillsBinding.localName ?? '<none>'}") is imported but its call count is ${listSkillsCalls} -- calls to a differently-bound same-named local identifier do not count`);
    if (skillIdAliasesRefs < 2) structuralProblems.push(`SKILL_ID_ALIASES's local binding ("${skillIdAliasesBinding.localName ?? '<none>'}") is imported but never referenced elsewhere in the file`);
    if (!usesTsCompilerApi) structuralProblems.push('no ts.createSourceFile(...) return value feeding a real ts.forEachChild(...) walk found -- a decorative/unconnected call to either does not count; design-toolbox.ts extraction must use the TypeScript compiler API, not regex');
    if (!hasPhantomLiteral) structuralProblems.push(`the pinned literal "${PHANTOM_LITERAL}" was not found as a genuine string-literal AST node`);
    if (!noWebImport) structuralProblems.push('file appears to import apps/web/** directly -- the cross-app boundary requires reading design-toolbox.ts as text, not importing it');

    const run = runVitestFile('@open-design/daemon', DAEMON_SUITE_SPEC_PKG_REL, 'C10C-4-vitest'); // [R1-F1]
    const allTests = run.data ? run.data.testResults.flatMap((t) => t.assertionResults) : [];
    const positiveTitle = 'positive control: a real skill id resolves via findSkillById';
    const negativeTitle = 'phantom red specs: an unresolvable skill id returns undefined via findSkillById';
    const positivePassed = allTests.some((t) => t.fullName.endsWith(positiveTitle) && t.status === 'passed');
    const negativePassed = allTests.some((t) => t.fullName.endsWith(negativeTitle) && t.status === 'passed');
    const coverageProblems: string[] = [];
    if (!positivePassed) coverageProblems.push(`no passing test titled exactly "${positiveTitle}"`);
    if (!negativePassed) coverageProblems.push(`no passing test titled exactly "${negativeTitle}"`);
    if (derivedActionIds) {
      for (const id of derivedActionIds) {
        const expectedTitle = `preferredSkillIds for action "${id}" resolve via findSkillById`;
        if (!allTests.some((t) => t.fullName.endsWith(expectedTitle) && t.status === 'passed')) {
          coverageProblems.push(`no passing test titled exactly "${expectedTitle}"`);
        }
      }
    }
    if ((run.data?.numFailedTests ?? 1) !== 0) coverageProblems.push(`${run.data?.numFailedTests ?? 'unknown'} failed test(s) in the suite`);

    const delegatedOk = run.status === 0 && structuralProblems.length === 0 && coverageProblems.length === 0;
    const allOk = oracleOk && delegatedOk;
    record(
      'C10C-4',
      `verifier-internal direct call to findSkillById(listSkills(...)); pnpm --filter @open-design/daemon exec vitest run ${DAEMON_SUITE_SPEC_PKG_REL} --reporter=json`,
      "the verifier's own oracle proves every preferredSkillIds entry resolves via the real registry, AND the required delegated daemon-suite artifact imports listSkills/findSkillById/SKILL_ID_ALIASES by exact export name, calls/references each import's own LOCAL BINDING (not a same-named local lookalike), uses the compiler API via a real createSourceFile-to-forEachChild data-flow chain, and passes with per-action + paired coverage",
      allOk,
      `oracle ok=${oracleOk}\n${oracleEvidence}\n\ndelegated file structural: ${structuralProblems.join('; ') || 'none'}\ndelegated file coverage: ${coverageProblems.join('; ') || 'none'}\nvitest exit=${run.status}\n\n${run.raw}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-5 -- UI/CLI parity, via the shared isolated-daemon helper.
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-5', async () => {
    const outcome = await withIsolatedDaemon('c10c5', async (daemonUrl) => {
      const httpSkills = await fetchLiveSkillsOverHttp(daemonUrl);
      const cliResult = sh(process.execPath, ['--import', 'tsx', path.join(repoRoot, 'apps/daemon/src/cli.ts'), 'skills', 'list', '--json', '--daemon-url', daemonUrl], {
        cwd: path.join(repoRoot, 'apps/daemon'),
        timeoutMs: 60_000,
      });
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
      const problems: string[] = [];
      if (!httpSkills.ok) problems.push(`HTTP probe failed: ${httpSkills.error}`);
      if (cliProblem) problems.push(`CLI probe failed: ${cliProblem}`);
      let httpCount = 0;
      const cliCount = cliIds.length;
      if (httpSkills.ok && !cliProblem) {
        httpCount = httpSkills.ids.length;
        if (httpSkills.ids.length === 0) problems.push('HTTP /api/skills returned zero skills -- cannot prove parity against an empty set');
        const diff = multisetDiff(httpSkills.ids, cliIds);
        if (diff.onlyInA.length) problems.push(`ids present via HTTP but not CLI: ${diff.onlyInA.join(', ')}`);
        if (diff.onlyInB.length) problems.push(`ids present via CLI but not HTTP: ${diff.onlyInB.join(', ')}`);
        if (diff.countMismatch.length) problems.push(`id occurrence-count mismatches: ${diff.countMismatch.join(', ')}`);
      }
      return { ok: problems.length === 0, evidence: `http id count: ${httpCount}\ncli id count: ${cliCount}\n${problems.join('\n')}` };
    });
    if (!outcome.boot.ok) {
      record('C10C-5', 'pnpm tools-dev start daemon --namespace <fresh>', 'the HTTP and CLI skill-id multisets are exactly identical for the same isolated daemon, and its teardown is independently confirmed', false, `${outcome.boot.rawEvidence}\nteardown: ok=${outcome.teardownOk} ${outcome.teardownDetail}`, {
        detail: outcome.boot.detail,
      });
      return;
    }
    record(
      'C10C-5',
      `GET ${outcome.boot.daemonUrl}/api/skills  vs  od skills list --json --daemon-url ${outcome.boot.daemonUrl}`,
      'the HTTP and CLI skill-id multisets are exactly identical for the same isolated daemon, and its teardown is independently confirmed (never trusted from a single exit report -- [R3-F5])',
      (outcome.result?.ok ?? false) && outcome.teardownOk,
      `daemon url: ${outcome.boot.daemonUrl}\n${outcome.result?.evidence ?? 'no result'}\nteardown: ok=${outcome.teardownOk} ${outcome.teardownDetail}`,
    );
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
      record('C10C-7', `git show ${headSha}:${REVIEW_RECORD_REL}`, 'implementation review record exists, committed, non-spoofable', false, '', { detail: `could not read ${REVIEW_RECORD_REL} at HEAD: ${String(err)}` });
      return;
    }
    let review: { reviewer?: unknown; model?: unknown; reviewedCommit?: unknown; verdict?: unknown };
    try {
      review = JSON.parse(raw) as typeof review;
    } catch (err) {
      record('C10C-7', '', 'review record parses as JSON', false, raw.slice(0, 2000), { detail: `JSON parse failed: ${String(err)}` });
      return;
    }
    // [R3-F6] a whitespace-only string is truthy (non-empty .length), so
    // `if (!reviewer)` alone let it through -- it then matched no author in
    // identityMatchesAnyAuthor and silently passed. Reject anything that
    // normalizes to nothing after trim, not just falsy/missing.
    const reviewerRaw = typeof review.reviewer === 'string' ? review.reviewer : null;
    const reviewer = reviewerRaw !== null && reviewerRaw.trim().length > 0 ? reviewerRaw : null;
    const model = typeof review.model === 'string' ? review.model.trim() : null;
    const reviewedCommit = typeof review.reviewedCommit === 'string' ? review.reviewedCommit : null;
    const verdict = typeof review.verdict === 'string' ? review.verdict : null;
    const problems: string[] = [];
    if (!reviewer) problems.push('"reviewer" is missing, not a string, or empty/whitespace-only after trim');
    if (!model) problems.push('"model" is missing, not a string, or empty after trim'); // [R1-F7]
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
        const diffResult = sh('git', ['diff', '--name-only', reviewedCommit, headSha, '--', ...OWNED_IMPLEMENTATION_PATHS]); // [R1-F7] complete list
        const changedSinceReview = diffResult.stdout.trim().split('\n').filter(Boolean);
        if (changedSinceReview.length > 0) problems.push(`implementation/evidence changed AFTER reviewedCommit -- review is stale for: ${changedSinceReview.join(', ')}`);
      }
      if (reviewer) {
        const authorsInRange = commitAuthorsBetween(baseCommit, reviewedCommit);
        if (identityMatchesAnyAuthor(reviewer, authorsInRange)) problems.push(`"reviewer" ("${reviewer}") matches a commit author in baseCommit..reviewedCommit (checked as name, email, and combined "Name <email>" form) -- not distinguishable from the implementation`); // [R1-F7]
      }
    }
    record(
      'C10C-7',
      `read ${REVIEW_RECORD_REL}@HEAD; model presence + reviewedCommit ancestry + owned-path (8 files) empty-diff + author-distinctness checks`,
      'model non-empty; reviewedCommit is a real, strict ancestor of HEAD whose complete owned-path diff to HEAD is empty; reviewer distinct from every baseCommit..reviewedCommit author (name/email/combined form); verdict is APPROVE',
      problems.length === 0,
      problems.join('\n') || `reviewer=${reviewer} model=${model} reviewedCommit=${reviewedCommit} verdict=${verdict}`,
    );
  });

  // -----------------------------------------------------------------------
  // C10C-8 -- [R3-F7] REINSTATED. Removing this in round 2 was wrong (the
  // orchestrator's own correction): the `### W10C-CAPABILITY-DECISION` block
  // that landed on main via docs/plans/waves/DECISIONS.md is a real,
  // fail-able invariant if deleted, malformed, or not actually present at a
  // point this wave's own commits cannot influence. human:-marked per
  // VERIFICATION-CONTRACT.md §3 R7: a record that has not yet landed
  // legitimately resolves "blocked-on-founder" (the founder/orchestrator
  // has not yet ruled), never "pass"; a record that HAS landed but is
  // malformed resolves "fail" (a defect in a landed artifact, not an
  // unanswered question). Modeled on the W9-agent-spawn "C9S-8" mechanism
  // DECISIONS.md's W9AS-PARK record describes -- the one part of that
  // package the reviewer found sound.
  // -----------------------------------------------------------------------
  await checkCriterion('C10C-8', () => {
    const DECISIONS_REL = 'docs/plans/waves/DECISIONS.md';
    let raw: string;
    try {
      // [R3-F7] read at baseCommit, NEVER HEAD: leases.json denies
      // DECISIONS.md to W10c and a wave branch cannot reach the docs lane
      // at all, so baseCommit is a fixed point this wave's own commits
      // structurally cannot have influenced.
      raw = readFileAtCommit(baseCommit, DECISIONS_REL);
    } catch (err) {
      record(
        'C10C-8',
        `git show ${baseCommit}:${DECISIONS_REL}`,
        'human: a well-formed W10C-CAPABILITY-DECISION record exists at baseCommit, proving the capability question landed through the review lane that produced baseCommit -- this does NOT and cannot cryptographically verify anyone\'s authority, only that the record\'s presence and shape are real at a point this wave cannot influence',
        'blocked-on-founder',
        '',
        { detail: `could not read ${DECISIONS_REL} at baseCommit (${baseCommit}): ${String(err)}` },
      );
      return;
    }
    const headingToken = '### W10C-CAPABILITY-DECISION';
    const startIdx = raw.indexOf(headingToken);
    if (startIdx === -1) {
      record(
        'C10C-8',
        `git show ${baseCommit}:${DECISIONS_REL}`,
        'human: a well-formed W10C-CAPABILITY-DECISION record exists at baseCommit, proving the capability question landed through the review lane (not that anyone\'s authority was cryptographically verified)',
        'blocked-on-founder',
        raw.slice(0, 1000),
        { detail: `no "${headingToken}" heading found at baseCommit -- the capability question has not yet landed through the review lane` },
      );
      return;
    }
    const afterHeading = raw.slice(startIdx + headingToken.length);
    const nextHeadingRel = afterHeading.search(/^###\s/m);
    const block = nextHeadingRel === -1 ? afterHeading : afterHeading.slice(0, nextHeadingRel);
    const blockLines = block.split('\n').map((l) => l.trim());
    function extractField(fieldName: string): string | null {
      const re = new RegExp(`^-\\s*${fieldName}:\\s*(.*)$`, 'i');
      for (const line of blockLines) {
        const m = re.exec(line);
        if (m) return (m[1] ?? '').trim();
      }
      return null;
    }
    const decisionRaw = extractField('Decision');
    const deciderRaw = extractField('Decider');
    const dateRaw = extractField('Date');
    const rationaleRaw = extractField('Rationale');

    const problems: string[] = [];
    const decision = decisionRaw ? decisionRaw.toLowerCase() : null;
    if (decision !== 'exempt' && decision !== 'build-now') {
      problems.push(`"Decision" is "${decisionRaw ?? '<missing>'}", expected exactly "exempt" or "build-now"`);
    }
    // [R3-F6] same whitespace-only-identity bug class as C10C-7's reviewer
    // check: reject a Decider that normalizes to nothing after trim.
    const decider = deciderRaw && deciderRaw.trim().length > 0 ? deciderRaw : null;
    if (!decider) problems.push('"Decider" is missing or empty/whitespace-only after trim');
    if (!dateRaw || dateRaw.trim().length === 0) problems.push('"Date" is missing or empty');
    if (!rationaleRaw || rationaleRaw.trim().length === 0) problems.push('"Rationale" is missing or empty');

    if (decider) {
      // [R3-F7] "decider checked against commit authors": mirrors C10C-7's
      // reviewer-distinctness pattern -- the decider identity must not
      // match any author of THIS WAVE's own commits (baseCommit..HEAD), so
      // an implementer cannot self-attribute founder/orchestrator decision
      // authority under their own commit identity.
      const waveAuthors = commitAuthorsBetween(baseCommit, headSha);
      if (identityMatchesAnyAuthor(decider, waveAuthors)) {
        problems.push(`"Decider" ("${decider}") matches an author of this wave's own commits (baseCommit..HEAD) -- not distinguishable from the implementation`);
      }
    }

    record(
      'C10C-8',
      `git show ${baseCommit}:${DECISIONS_REL}; parse "${headingToken}" block; decider vs. baseCommit..HEAD commit-author distinctness`,
      'human: Decision/Decider/Date/Rationale are all present and non-empty (Decider non-whitespace-after-trim), Decision is exactly "exempt" or "build-now", and Decider is distinguishable from every baseCommit..HEAD commit author. This proves the capability-decision record landed through the review lane that produced baseCommit -- it does NOT and cannot cryptographically verify anyone\'s authority.',
      problems.length === 0,
      problems.join('\n') || `decision=${decisionRaw} decider=${decider} date=${dateRaw} rationale=${(rationaleRaw ?? '').slice(0, 200)}`,
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
      record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check; the PRIMARY control is the LEASE deny-list on this file plus the PRD, not this pin', false, '', { detail: `could not hash self at ${selfPath}: ${String(err)}` });
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
    record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', gateOk, `sha256: ${selfSha256}\napproved: ${approved}\nPINNED`, { detail: gateOk ? undefined : 'verify-w10c.ts modified since orchestrator approval' });
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
      record('LEASE', `git show ${baseCommit}:docs/plans/waves/leases.json`, 'no writes outside the W10c lease, read from baseCommit', false, '', { detail: `could not read/parse leases.json at baseCommit: ${String(err)}` });
      return;
    }
    const lease = leasesRaw.waves['W10c'];
    if (!lease) {
      record('LEASE', '', 'no writes outside the W10c lease, read from baseCommit', false, '', { detail: 'no "W10c" entry in leases.json@baseCommit -- expected pre-orchestrator-transcription; see W10c-toolbox.md §6 "Proposed lease"' });
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
    record('HEAD-DRIFT', 'git rev-parse HEAD (re-resolved at end)', 'HEAD must not move during the run', headShaFinal === headSha, `initial=${headSha} final=${headShaFinal}`, { detail: headShaFinal === headSha ? undefined : 'HEAD moved during the run' });
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

  const nonPass = results.filter((r) => r.status !== 'pass');
  const blockedOnFounder = results.filter((r) => r.status === 'blocked-on-founder');
  console.log(`\nverify-w10c: ${results.length - nonPass.length}/${results.length} criteria pass (${blockedOnFounder.length} blocked-on-founder, treeDirty=${treeDirty}, gateIntegrityPinned=${gateIntegrityPinned})`);
  for (const r of results) console.log(`  [${r.status.toUpperCase()}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md §2)');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  process.exit(nonPass.length === 0 && !treeDirty && manifestWritten ? 0 : 1);
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
