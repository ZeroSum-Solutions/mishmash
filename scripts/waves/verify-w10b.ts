// verify-w10b.ts -- wave mishmash-w10b-voicebox (VoiceBox MCP registration)
// completion verifier.
//
// PROGRAM SCAFFOLDING, not product surface: this file exists for the wave
// program defined in docs/plans/waves/ (see VERIFICATION-CONTRACT.md) and is
// deleted, with the rest of scripts/waves/, when that program closes.
//
// Run: pnpm exec tsx scripts/waves/verify-w10b.ts [--repo <path>]
// Exit 0 only when C10B-1 through C10B-5 all pass AND the tree is clean
// (treeDirty: false) AND the infra checks (GATE-INTEGRITY, SCANNER-SELFTEST,
// WIRE-SELFTEST, TEARDOWN-ARTIFACTS-SELFTEST, DAEMON-TEARDOWN, HEAD-DRIFT)
// pass. The commit-bound proof manifest is written to the wave's goal-state
// proof directory either way, per docs/plans/waves/
// W10b-voicebox-registration.md's "Definition of green".
//
// Prior rounds (1-4) are recorded in the PRD's own "Round N adversarial
// review" / "Round N fix" / "Round N verdict" sections; this header covers
// only ROUND 5 (booted-daemon HTTP observation, replacing round 4's
// verifier-owned reconstruction) and ROUND 6 (this file, closing six
// residuals the round-5 confirmation review found in that redesign).
//
// ROUND 5 SUMMARY (full detail in the PRD's "Round 5 fix"): C10B-1/2/4 boot
// apps/daemon/src/server.ts unmodified, from this repository's own working
// tree, in an isolated namespace, and observe the REAL GET /api/mcp/servers
// HTTP response instead of a verifier-reconstructed serialization. Round 5
// was REJECTED with six findings, closed below.
//
// ROUND 6 (this file, founder-authorized autonomous fix round; verdict
// "REJECT" on round 5, but the round-5 core -- real-route observation,
// residue-free satisfiability -- was independently confirmed VALID, not
// re-architected here):
//
//   1. READ-HORIZON. Round 5 read the wire-served entry a FIXED, SOURCE-
//      LEGIBLE 3 times per criterion (9 total). Because this file's own text
//      is committed and readable, an adversarial implementation does not
//      need to observe anything at runtime to know that number -- it can
//      just read verify-w10b.ts and return the frozen value for exactly
//      that many reads, then diverge. `observeVoiceboxWireEntryRepeated()`
//      now draws a FRESH burst-read count and a FRESH long-tail delay from
//      `crypto.randomInt()` (OS-entropy-backed, not a seedable PRNG) at RUN
//      TIME for every criterion invocation, interleaves unpredictable
//      real, pre-existing, side-effect-free traffic
//      (GET /api/mcp/install-info) between reads, and always ends with one
//      more read after an independently randomized delay. This converts a
//      bypass that ALWAYS defeated round 5 deterministically into one that
//      only sometimes defeats a given run, with unpredictable-to-the-
//      candidate-code odds -- it does NOT, and cannot, close the
//      information-theoretic residual: a getter honest for an arbitrarily
//      large, hardcoded read count (or arbitrarily far in the future) cannot
//      be distinguished from a genuinely-honest one by any FINITE
//      verification run, randomized or not. The PRD states this bound
//      explicitly rather than repeating round 5's "structurally closed"
//      overclaim. `Math.random()`/`Date.now()` are ordinary, permitted APIs
//      in this file -- this is a program-scaffolding CLI script, not one of
//      apps/daemon's product Workflow-automation scripts (which live
//      elsewhere and answer to separate determinism constraints this file
//      never touches); `crypto.randomInt()` is used here in preference to
//      `Math.random()` because it is OS-entropy-backed rather than a
//      seedable PRNG, which is the stronger unpredictability property this
//      check actually wants.
//   2. VERIFIER FINGERPRINTS. Round 5's isolated daemon boot leaked its own
//      identity into the daemon's observable environment: `OD_DATA_DIR`
//      always began the literal substring `w10b-daemon-data-`, and the
//      generated entrypoint always lived under a `w10b-daemon-boot-*`
//      directory as `boot.mjs`. Both are now generic (`od-*` temp-dir
//      prefixes -- matching this product's own internal `OD_*`/`.od/`/`od`
//      naming convention rather than anything verifier-specific -- and a
//      neutral `main.mjs` entrypoint filename), carrying no "w10b" or
//      "verify" text anywhere a candidate module could read. Swept and
//      confirmed clean: every other env var this file sets (`OD_BIND_HOST`)
//      or deletes (`OD_API_TOKEN`, `OD_WEB_PORT`) is either a normal,
//      legitimately-set daemon config value or an absence indistinguishable
//      from a real deployment that simply never set it; the bound port is
//      always OS-assigned (`port: 0`), never a fixed, guessable value; and
//      `apps/daemon/src/mcp-config.ts`'s own confirmed-narrow import surface
//      (`node:fs/promises`, `node:fs`, `node:crypto`, `node:path` only --
//      re-confirmed this round) has no plausible path to inspect its own
//      process's argv or its own listening port at all, so those were not
//      pursued as fixes. NOT closed, and disclosed rather than hidden: this
//      boot mechanism (a generated single-file `tsx` launcher, not
//      `tools-dev`'s own sidecar/IPC-stamped launch path) remains
//      structurally distinguishable from a `pnpm tools-dev` launch by
//      anything that can see argv globally (no `--od-stamp-*` flags, no IPC
//      socket) -- closing that residual would mean routing through the full
//      sidecar control plane inside an isolated verifier, which is
//      disproportionate for a registration-only wave and was not done; see
//      the PRD's "Round 6 fix" for the same disclosure.
//   3. TRANSITIVE COMMIT-BINDING. `apps/daemon/src/server.ts` statically
//      imports several first-party `@open-design/*` workspace packages
//      (contracts, platform, sidecar-proto, and others -- 10 packages on
//      this tree, via `pnpm --filter "@open-design/daemon^..." list`) whose
//      package-exports resolve to gitignored `dist/*.mjs` bundles, never
//      rebuilt by this verifier. A stale or hand-edited dist artifact could
//      execute during daemon boot without appearing in `treeDirty` or being
//      bound to HEAD. `ensureDaemonWorkspaceDepsRebuiltFromHead()` (adapted
//      from `scripts/waves/verify-w9-filesystem.ts`'s
//      `ensureFirstPartyPackagesRebuiltFromHead`, commit 79b15e90a, and
//      `scripts/waves/verify-w9-external-fetch.ts`'s
//      `ensureDaemonWorkspaceDepsRebuiltFromHead`, commit 45b5b445b) forces
//      a fresh `pnpm --filter "@open-design/daemon^..." run build` before
//      any daemon boot, memoized once per verifier process (~10s wall clock,
//      measured on this tree). Rebuild, not hash-pin: unconditionally
//      commit-binds the live boot every run rather than merely detecting a
//      stale dist and refusing to proceed.
//   4. SELF-HASH. `GATE-INTEGRITY`'s approved-hash comparison only applies
//      once the orchestrator pins `approved-gate.sha256`, which does not
//      exist yet -- correct for that mechanism's own purpose (an
//      orchestrator-controlled post-approval pin), but it left this
//      executing file with NO tamper-evidence before that pin lands. An
//      `assume-unchanged`/`skip-worktree` git flag can hide a local edit
//      from `git status --porcelain` (the ONLY thing `treeDirty` checks)
//      while the actually-executing bytes differ from the committed HEAD
//      blob -- silently redefining `FROZEN` (a literal independent of
//      `mcp-config.ts`, so C10B-3's lease-diff check never sees it) without
//      tripping `treeDirty`. `GATE-INTEGRITY` now ALWAYS (not only once
//      pinned) compares the executing file's own bytes against
//      `git show HEAD:scripts/waves/verify-w10b.ts`'s bytes, independent of
//      `git status`. A mismatch while the tree independently claims to be
//      clean is treated as a tamper alarm and fails this check; a mismatch
//      while the tree honestly reports itself dirty (the expected state
//      during ordinary pre-commit authoring, including every run in this
//      session) is recorded plainly as an informational difference, since
//      the overall run already fails via `treeDirty` in that case regardless
//      -- this sub-check exists to catch the CONCEALED case, not to
//      duplicate the honest one.
//   5. CLEANUP ORDERING. Multiple exit paths out of `bootIsolatedDaemon()`
//      deleted its temp directories WITHOUT first confirming
//      `killGroupFailClosed()` actually succeeded (normal shutdown, boot
//      timeout, boot failure all deleted unconditionally), while two other
//      paths (`node --check` failure, spawn-with-no-pid) deleted NEITHER
//      directory even though nothing was ever spawned. `finalizeArtifacts()`
//      is now the single, shared implementation every exit path uses:
//      delete `paths` ONLY when the teardown result is `ok: true`; on any
//      unconfirmed/failed teardown, RETAIN every path and name them in the
//      returned detail as forensic evidence, never silently destroy evidence
//      of what actually happened (adapted from
//      `verify-w9-external-fetch.ts`'s `bootIsolatedDaemon` catch block,
//      commit 45b5b445b). `cleanupNeverSpawnedArtifacts()` is the separate,
//      unconditional-delete path used ONLY when no process was ever spawned
//      (nothing could have leaked). `TEARDOWN-ARTIFACTS-SELFTEST` (new infra
//      check) proves both branches against REAL temporary files created on
//      disk for the test -- confirmed-ok deletes them, unconfirmed retains
//      them -- not merely a return-value assertion. Fetches against the
//      daemon now carry a bounded `AbortSignal.timeout()` (`safeProbeFetch`)
//      so a hanging route cannot block the run from ever reaching teardown,
//      and this verifier's own process registers `SIGINT`/`SIGTERM`
//      handlers that best-effort tear down any currently-live isolated
//      daemon before exiting, in case the verifier itself is interrupted
//      mid-run.
//   6. TARGET-VISIBILITY ENUMERATION. The round-5 `killGroupFailClosed()`
//      trusted an exit-zero, well-formed-but-EMPTY `ps` scan as proof the
//      process group was gone, with no positive control that the scan
//      mechanism could see the target's session at all -- a session-scoped
//      or PATH-shimmed `ps` returning exit 0 with zero (or self-only) rows
//      would read as "confirmed empty" whether or not the target was really
//      gone. `killGroupFailClosed()` is rewritten (ported from
//      `scripts/waves/verify-w9-filesystem.ts` commit `0d6bf026f`, the
//      landed target-visibility reference this round's authorization named)
//      to: (a) gate on synthetic-input self-probes for BOTH the process-
//      table classifier and the target-visibility evaluator before trusting
//      any real scan this run; (b) establish, BEFORE sending any signal,
//      that the target is independently alive (`process.kill(pid,0)`) AND
//      that the SAME `ps`-based scan mechanism shows a row for that exact
//      pgid while it is alive (the positive control); (c) require BOTH zero
//      post-kill survivors AND a passed positive control before declaring
//      "confirmed empty" -- a scan that never proved it could see the
//      target's session is never trusted for the negative result either,
//      even if it reports zero rows. `ps` exit-nonzero, empty output,
//      malformed rows, or a missing self-visibility row are all treated as
//      an untrustworthy scan (RUN FAILURE), never as proof of a clean exit.
//
// Scope note (unchanged since round 5): C10B-3 and C10B-5 remain AST/text-
// based -- both answer two-commit TEXT questions with no runtime observable,
// the founder's stated carve-out for keeping a structural check.
//
// PORTABILITY: repoRoot comes from `process.cwd()`/`--repo`, never
// `import.meta.url`.
//
// RUNTIME SAFETY: the isolated daemon this file boots is a genuine
// `detached: true` child process with its own process group, an isolated
// `OD_DATA_DIR`, and `port: 0` (OS-assigned, independently re-checked
// against FORBIDDEN_PORTS = {7456, 51012} after boot -- boot is refused and
// torn down immediately if the OS ever hands back one of those two exact
// ports). This file never signals or inspects any PID it did not itself
// spawn -- it has no way to name the default-namespace daemons' actual PIDs
// (machine-specific, not a fact this committed script could safely
// hardcode), so its only mechanism for staying clear of them is process-
// group exactness plus the FORBIDDEN_PORTS refusal, both unconditional
// regardless of what else is running. Git context is resolved from local
// refs only (no fetch/push). WIRE-SELFTEST's synthetic HTTP server is
// in-process (`node:http`, no subprocess, no process group of its own) and
// is torn down with a plain `server.close()`.

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type TypeScriptModule from 'typescript';
import type {
  ArrayLiteralExpression,
  Node as TsNode,
  ObjectLiteralExpression,
  SourceFile,
} from 'typescript';

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx === -1 ? undefined : argv[idx + 1];
}

const WAVE_SLUG = 'mishmash-w10b-voicebox';
const TEMPLATE_FILE = 'apps/daemon/src/mcp-config.ts';
const SELF_FILE = 'scripts/waves/verify-w10b.ts';
const SERVER_FILE = 'apps/daemon/src/server.ts';

// Default-namespace daemon ports (binding safety constraint for this run --
// see "RUNTIME SAFETY" above). Never dialed, never bound.
const FORBIDDEN_PORTS = new Set([7456, 51012]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -------------------------------------------------------------------------
// Frozen fields (round-1 finding 4 fix, unchanged since). Copied verbatim
// from the PRD's "Implementation surface" code block -- kept in exact byte
// sync with that file by hand, since neither file may depend on the other at
// runtime (portability; see header). Any wording change to the registered
// template requires updating BOTH the PRD and this file, together, in one
// commit.
// -------------------------------------------------------------------------
const FROZEN = {
  id: 'voicebox',
  label: 'VoiceBox',
  description:
    'Local text-to-speech and voice-cloning MCP from your local VoiceBox app (jamiepine/voicebox on GitHub -- Tauri + Bun + Python, unrelated to the Meta Voicebox research model). Exposes voicebox.speak (speak text in a cloned or preset voice profile), plus voicebox.transcribe, voicebox.list_captures and voicebox.list_profiles. Requires the VoiceBox app running locally on 127.0.0.1:17493 -- this only connects to it; Open Design does not install, launch, or manage it.',
  example: 'Speak "Build complete." using my default VoiceBox voice profile.',
  homepage: 'https://github.com/jamiepine/voicebox',
  transport: 'http',
  authMode: 'none',
  category: 'utilities',
  url: 'http://127.0.0.1:17493/mcp',
} as const;

function emergencyExit(errorMessage: string): never {
  try {
    const manifest = {
      wave: 'W10b',
      commit: 'unknown',
      treeDirty: true,
      baseCommit: 'unknown',
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
      path.join(os.tmpdir(), 'verify-w10b-emergency-manifest.json'),
      JSON.stringify(manifest, null, 2),
    );
  } catch {
    /* truly nothing more we can do */
  }
  console.error(`verify-w10b: FATAL during init: ${errorMessage}`);
  process.exit(1);
}

let repoRoot: string;
let proofDir: string;
let ts: typeof TypeScriptModule;
try {
  repoRoot = path.resolve(argValue('--repo') ?? process.cwd());
  proofDir = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'proof');
  fs.mkdirSync(proofDir, { recursive: true });
  ts = createRequire(path.join(repoRoot, 'package.json'))('typescript');
} catch (err) {
  emergencyExit(`init failed: ${String((err as Error)?.stack ?? err)}`);
}

function sh(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 30_000,
  });
  if (result.error) {
    return {
      status: 1,
      stdout: result.stdout ?? '',
      stderr: `${result.stderr ?? ''}\n${String(result.error)}`,
    };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function sha256Bytes(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function sha256File(absPath: string): string {
  return sha256Bytes(fs.readFileSync(absPath));
}

// 'not-exercised' is a genuine third state, distinct from both 'pass' and
// 'fail': used only by DAEMON-TEARDOWN when the isolated daemon never
// finished spawning (nothing was left running either way, so nothing was
// actually torn down -- reporting that as 'pass' would be the same vacuous
// shape as a `.every()` over an empty array). It counts as `!== 'pass'`
// everywhere this file checks for green, so it can never silently read as
// done.
type CriterionStatus = 'pass' | 'fail' | 'not-exercised';

interface CriterionResult {
  id: string;
  command: string;
  assertion: string;
  artifact: string | null;
  artifactSha256: string | null;
  exitCode: number;
  status: CriterionStatus;
  durationMs: number;
  detail?: string | undefined;
}

const results: CriterionResult[] = [];

function artifactFor(
  id: string,
  content: string,
): { artifact: string | null; artifactSha256: string | null } {
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
  const fallbackResult = tryWrite(
    path.join(os.tmpdir(), 'verify-w10b-fallback-proof', `${id}.txt`),
  );
  if (fallbackResult) return fallbackResult;
  console.error(`verify-w10b: artifact write failed for ${id} on both primary and fallback paths`);
  return { artifact: null, artifactSha256: null };
}

function record(
  id: string,
  command: string,
  assertion: string,
  ok: boolean,
  evidence: string,
  opts: { detail?: string | undefined; durationMs?: number; status?: 'not-exercised' } = {},
): void {
  try {
    const wantsNotExercised = opts.status === 'not-exercised';
    const verdictLabel = wantsNotExercised ? 'not-exercised' : ok ? 'pass' : 'fail';
    const { artifact, artifactSha256 } = artifactFor(
      id,
      `# ${id}\n# assertion: ${assertion}\n# verdict: ${verdictLabel}\n${
        opts.detail ? `# detail: ${opts.detail}\n` : ''
      }\n${evidence}\n`,
    );
    const artifactWriteFailed = artifact === null;
    const status: CriterionStatus = artifactWriteFailed
      ? 'fail'
      : wantsNotExercised
        ? 'not-exercised'
        : ok
          ? 'pass'
          : 'fail';
    results.push({
      id,
      command,
      assertion,
      artifact,
      artifactSha256,
      exitCode: status === 'pass' || status === 'not-exercised' ? 0 : 1,
      status,
      durationMs: opts.durationMs ?? 0,
      detail:
        artifact === null
          ? `${opts.detail ? `${opts.detail}; ` : ''}artifact write failed -- forced fail`
          : opts.detail,
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

// ---------------------------------------------------------------------
// Git context -- local refs only, no fetch/push.
// ---------------------------------------------------------------------
function gitOrFail(args: string[], why: string): string {
  const r = sh('git', args);
  if (r.status !== 0 || r.stdout.trim().length === 0) {
    throw new Error(
      `git ${args.join(' ')} failed (${why}): exit=${r.status} stdout=${
        r.stdout.trim().slice(0, 200) || '<empty>'
      }`,
    );
  }
  return r.stdout.trim();
}
function resolveMainRefLocal(): string {
  for (const ref of ['origin/main', 'main']) {
    const verify = sh('git', ['rev-parse', '--verify', ref]);
    if (verify.status === 0 && verify.stdout.trim()) return ref;
  }
  throw new Error(
    'could not resolve "origin/main" or "main" locally (no network ref-check -- this verifier never fetches)',
  );
}
function writeEmergencyManifest(errorMessage: string, partialResults: CriterionResult[] = []): void {
  const manifest = {
    wave: 'W10b',
    commit: 'unknown',
    treeDirty: true,
    baseCommit: 'unknown',
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
      fs.writeFileSync(
        path.join(os.tmpdir(), 'verify-w10b-emergency-manifest.json'),
        JSON.stringify(manifest, null, 2),
      );
    } catch {
      /* last resort: stderr only */
    }
  }
  console.error(`verify-w10b: FATAL, emergency manifest written=${wrote}: ${errorMessage}`);
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

const gateIntegrityPinned = fs.existsSync(
  path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256'),
);

function readFileAtCommit(commit: string, relPath: string): string | null {
  const r = sh('git', ['show', `${commit}:${relPath}`]);
  if (r.status !== 0) return null;
  return r.stdout;
}

// ---------------------------------------------------------------------
// AST analysis over apps/daemon/src/mcp-config.ts's MCP_TEMPLATES array.
// Read-as-text + TypeScript compiler API -- used ONLY by C10B-3 (lease/diff
// subset check) and C10B-5 (comment provenance), both of which are
// inherently two-commit TEXT comparisons with no runtime equivalent (the
// founder's stated carve-out: "a structural/AST check may remain only for
// facts with no runtime observable"). Never used to validate the frozen
// fields of the voicebox entry itself -- that is C10B-1/2/4's job, proven
// against the real booted daemon's real HTTP response.
// ---------------------------------------------------------------------
interface TemplateBlock {
  id: string;
  rawText: string; // exact source text of the object literal, trimmed
}

interface ArrayScan {
  file: SourceFile;
  arrayNode: ArrayLiteralExpression;
  /** Non-empty means the array could NOT be safely reasoned about BY ID: a
   * spread/call/other non-object-literal element, an object literal with no
   * plain string-literal `id`, or a duplicate `id` across the array. This is
   * a purely structural, text-identification fact -- "which array slots
   * correspond to which ids" -- used ONLY by C10B-3's baseCommit-vs-HEAD
   * byte-diffing. Every consumer below must check this is empty before
   * trusting `clean`. */
  problems: string[];
  /** One block per id, populated only when `problems` is empty. */
  clean: Map<string, TemplateBlock> | null;
}

function locateTemplateArray(
  sourceText: string,
  syntheticFileName: string,
): { file: SourceFile; arrayNode: ArrayLiteralExpression } | null {
  const sourceFile = ts.createSourceFile(syntheticFileName, sourceText, ts.ScriptTarget.Latest, true);
  let found: ArrayLiteralExpression | null = null;
  const visit = (node: TsNode): void => {
    if (found) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'MCP_TEMPLATES' &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) return null;
  // Explicit assertion, not a narrowed read: `found` is assigned inside the
  // `visit` closure above, and TS does not reliably narrow a `let` binding's
  // type across a closure boundary. `visit(sourceFile)` has already returned
  // synchronously by this point, so the null check above is a real runtime
  // guarantee even though TS can't see it that way.
  return { file: sourceFile, arrayNode: found as ArrayLiteralExpression };
}

function findStringProp(
  obj: ObjectLiteralExpression,
  sourceFile: SourceFile,
  name: string,
): string | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!ts.isIdentifier(prop.name) || prop.name.text !== name) continue;
    const init = prop.initializer;
    if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
    return undefined; // present but not a plain string literal -- caller treats as absent
  }
  return undefined;
}

function shortText(sourceFile: SourceFile, node: TsNode): string {
  return node.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 100);
}

function analyzeTemplateArray(sourceText: string, syntheticFileName: string): ArrayScan | null {
  const located = locateTemplateArray(sourceText, syntheticFileName);
  if (!located) return null;
  const { file, arrayNode } = located;
  const problems: string[] = [];
  const byId = new Map<string, TemplateBlock[]>();

  for (const element of arrayNode.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      problems.push(
        `MCP_TEMPLATES element is not a plain object literal (SyntaxKind=${ts.SyntaxKind[element.kind]}): ${shortText(file, element)}`,
      );
      continue;
    }
    const id = findStringProp(element, file, 'id');
    if (id === undefined) {
      problems.push(
        `object literal in MCP_TEMPLATES has no plain string-literal 'id' property: ${shortText(file, element)}`,
      );
      continue;
    }
    const block: TemplateBlock = { id, rawText: element.getText(file).trim() };
    const list = byId.get(id);
    if (list) list.push(block);
    else byId.set(id, [block]);
  }

  for (const [id, list] of byId) {
    if (list.length > 1) {
      problems.push(`duplicate MCP_TEMPLATES id '${id}' appears ${list.length} times`);
    }
  }

  const clean =
    problems.length === 0
      ? new Map(
          [...byId.entries()].map(([id, list]) => {
            const first = list[0];
            if (!first) throw new Error(`unreachable: byId group for '${id}' was empty`);
            return [id, first] as const;
          }),
        )
      : null;

  return { file, arrayNode, problems, clean };
}

/** Everything in the file's own text OUTSIDE the array literal's span (round-1
 * finding 2): required to be byte-identical across baseCommit/HEAD so a new
 * export, function, import, or any other surface elsewhere in the same file
 * cannot pass as part of "one additive change." */
function splitAroundArray(
  sourceText: string,
  scan: ArrayScan,
): { before: string; after: string } {
  const start = scan.arrayNode.getStart(scan.file);
  const end = scan.arrayNode.getEnd();
  return { before: sourceText.slice(0, start), after: sourceText.slice(end) };
}

// ---------------------------------------------------------------------
// PROCESS-GROUP TEARDOWN, with target-visibility enumeration (round 6 fix
// #6). Ported from scripts/waves/verify-w9-filesystem.ts commit 0d6bf026f --
// see the header's ROUND-6 note #6 for the full rationale.
// ---------------------------------------------------------------------
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code !== 'ESRCH'; // ESRCH = no such process; anything else (e.g. EPERM) means it still exists
  }
}

interface ProcessTableScanResult {
  /** True only when the scan itself is TRUSTWORTHY (exit 0, this verifier's
   * own known-alive pid is visible somewhere in the output, every row
   * parsed) -- never merely "found zero matching rows." `survivors` is only
   * meaningful when this is true. */
  ok: boolean;
  survivors: string[];
  detail: string;
}

/** Pure, deterministic classification over a `ps -Ao pid=,pgid=,comm=`-shaped
 * invocation's raw exit status + stdout, separated from the actual `ps` call
 * so its trustworthiness logic can be exercised with SYNTHETIC input
 * (`PROCESS_TABLE_SELF_PROBES`). Exit-zero-but-empty output, exit-zero
 * malformed-row output, and a missing self-visibility row are all treated as
 * an UNTRUSTWORTHY scan -- never as proof of an empty group. */
function classifyProcessTableScan(status: number, stdout: string, selfPid: number, targetPgid: number): ProcessTableScanResult {
  if (status !== 0) {
    return { ok: false, survivors: [], detail: `ps scan itself failed (exit=${status}) -- treated as unconfirmed, not as proof of a clean exit` };
  }
  const survivors: string[] = [];
  const malformed: string[] = [];
  let sawSelf = false;
  let rowCount = 0;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rowCount++;
    const parts = trimmed.split(/\s+/);
    const rowPid = Number(parts[0]);
    const rowPgid = Number(parts[1]);
    if (parts.length < 3 || !Number.isFinite(rowPid) || !Number.isFinite(rowPgid)) {
      malformed.push(trimmed.slice(0, 160));
      continue;
    }
    if (rowPid === selfPid) sawSelf = true;
    if (rowPgid === targetPgid) survivors.push(`pid=${rowPid} pgid=${rowPgid} comm=${parts.slice(2).join(' ')}`);
  }
  if (malformed.length > 0) {
    return {
      ok: false,
      survivors: [],
      detail: `ps output contained ${malformed.length} unparseable row(s) out of ${rowCount} -- enumeration integrity not confirmed, treated as a scan failure, never as proof of an empty group: ${malformed.slice(0, 3).join(' | ')}`,
    };
  }
  if (!sawSelf) {
    return {
      ok: false,
      survivors: [],
      detail: `ps output (exit=0, ${rowCount} row(s)) never included this verifier's own pid=${selfPid} -- a process KNOWN to be alive right now -- so enumeration itself is broken (self-visibility control failed), treated as a scan failure, never as proof of an empty group`,
    };
  }
  return { ok: true, survivors, detail: `ps scan trustworthy: self pid=${selfPid} visible among ${rowCount} row(s), 0 malformed` };
}

const PROCESS_TABLE_SELF_PROBES: Array<{ name: string; status: number; stdout: string; expectOk: boolean; expectSurvivorCount?: number }> = [
  { name: 'well-formed output, self visible, no target-pgid match', status: 0, stdout: '    1     1 launchd\n 4242   999 node\n  555   555 sh\n', expectOk: true, expectSurvivorCount: 0 },
  { name: 'well-formed output, self visible, target-pgid HAS a survivor', status: 0, stdout: '    1     1 launchd\n 4242   999 node\n 6001   777 hermes-agent\n', expectOk: true, expectSurvivorCount: 1 },
  { name: 'exit-zero but EMPTY output (enumeration silently produced nothing)', status: 0, stdout: '', expectOk: false },
  { name: 'exit-zero, well-formed OTHER rows, but self pid missing entirely', status: 0, stdout: '    1     1 launchd\n  555   555 sh\n', expectOk: false },
  { name: 'exit-zero, garbage/malformed rows', status: 0, stdout: 'not-a-pid not-a-pgid garbage\n 4242   999 node\n', expectOk: false },
  { name: 'nonzero exit (ps itself failed)', status: 1, stdout: '', expectOk: false },
];
let processTableSelfProbeResult: { pass: boolean; report: string[]; passCount: number; total: number } | null = null;
function runProcessTableSelfProbes(): { pass: boolean; report: string[]; passCount: number; total: number } {
  if (processTableSelfProbeResult) return processTableSelfProbeResult;
  const SELF_PID = 4242;
  const TARGET_PGID = 777;
  const report: string[] = [];
  let passCount = 0;
  for (const c of PROCESS_TABLE_SELF_PROBES) {
    const result = classifyProcessTableScan(c.status, c.stdout, SELF_PID, TARGET_PGID);
    const okMatches = result.ok === c.expectOk;
    const survivorMatches = c.expectSurvivorCount === undefined || (result.ok && result.survivors.length === c.expectSurvivorCount);
    if (okMatches && survivorMatches) {
      passCount++;
      report.push(`PASS ${c.name}: ok=${result.ok} survivors=${result.survivors.length}`);
    } else {
      report.push(`FAIL ${c.name}: expected ok=${c.expectOk}${c.expectSurvivorCount !== undefined ? ` survivors=${c.expectSurvivorCount}` : ''}, got ok=${result.ok} survivors=${result.survivors.length} detail=${result.detail}`);
    }
  }
  processTableSelfProbeResult = { pass: passCount === PROCESS_TABLE_SELF_PROBES.length, report, passCount, total: PROCESS_TABLE_SELF_PROBES.length };
  return processTableSelfProbeResult;
}
function processGroupSurvivors(pgid: number): ProcessTableScanResult {
  const r = sh('ps', ['-Ao', 'pid=,pgid=,comm='], { timeoutMs: 15_000 });
  return classifyProcessTableScan(r.status, r.stdout, process.pid, pgid);
}

interface TargetVisibilityResult {
  ok: boolean;
  detail: string;
}
/** Self-visibility alone proves the scan sees the CALLER; it says nothing
 * about whether the scan can see the TARGET's session (a DIFFERENT session,
 * since `bootIsolatedDaemon` spawns `detached: true`). A session-scoped `ps`
 * could enumerate only the caller's own session -- passing self-visibility
 * every time while never showing a row for the daemon's session, regardless
 * of whether it has survivors -- and every such scan would read as "self
 * visible, zero target rows," which in isolation is a well-formed result.
 * The fix is a POSITIVE control, evaluated once per teardown BEFORE any kill
 * signal: while the target is independently confirmed alive
 * (`process.kill(pid,0)`, session/`ps`-agnostic), the SAME `ps`-based scan
 * must ALSO show a row for that exact pgid. A later "zero target rows"
 * result is trusted as "confirmed empty" ONLY when this positive control
 * passed. */
function evaluateTargetVisibility(targetAliveAtStart: boolean, preKillScan: ProcessTableScanResult | null): TargetVisibilityResult {
  if (!targetAliveAtStart) {
    return {
      ok: false,
      detail: 'target-visibility not established: the target was not independently confirmed alive (process.kill(pid,0)) at teardown start -- a later "confirmed empty" verdict cannot be trusted without this positive control',
    };
  }
  if (!preKillScan || !preKillScan.ok || preKillScan.survivors.length === 0) {
    return {
      ok: false,
      detail: `target-visibility FAILED: process.kill(pid,0) confirms the target is alive, but the ps-based scan for its own pgid found ${!preKillScan || !preKillScan.ok ? `an untrustworthy scan (${preKillScan?.detail ?? 'no scan performed'})` : 'zero rows'} -- the scan mechanism may be blind to this target's session (e.g. a session-scoped ps)`,
    };
  }
  return {
    ok: true,
    detail: `target-visibility confirmed: ${preKillScan.survivors.length} row(s) for the target's own pgid seen while it was independently confirmed alive`,
  };
}
const TARGET_VISIBILITY_SELF_PROBES: Array<{ name: string; targetAliveAtStart: boolean; preKillScan: ProcessTableScanResult | null; expectOk: boolean }> = [
  { name: 'normal healthy case: target alive, scan sees its own pgid row', targetAliveAtStart: true, preKillScan: { ok: true, survivors: ['pid=999 pgid=999 node'], detail: 'ok' }, expectOk: true },
  { name: 'exploit: session-scoped-blind scan -- target alive, self visible, but 0 target rows', targetAliveAtStart: true, preKillScan: { ok: true, survivors: [], detail: 'trustworthy: self visible, 0 target rows' }, expectOk: false },
  { name: 'target alive, but the pre-kill scan itself was untrustworthy', targetAliveAtStart: true, preKillScan: { ok: false, survivors: [], detail: 'malformed rows' }, expectOk: false },
  { name: 'target already not alive at teardown start -- no positive control possible', targetAliveAtStart: false, preKillScan: null, expectOk: false },
];
let targetVisibilitySelfProbeResult: { pass: boolean; report: string[]; passCount: number; total: number } | null = null;
function runTargetVisibilitySelfProbes(): { pass: boolean; report: string[]; passCount: number; total: number } {
  if (targetVisibilitySelfProbeResult) return targetVisibilitySelfProbeResult;
  const report: string[] = [];
  let passCount = 0;
  for (const c of TARGET_VISIBILITY_SELF_PROBES) {
    const result = evaluateTargetVisibility(c.targetAliveAtStart, c.preKillScan);
    if (result.ok === c.expectOk) {
      passCount++;
      report.push(`PASS ${c.name}: ok=${result.ok}`);
    } else {
      report.push(`FAIL ${c.name}: expected ok=${c.expectOk}, got ok=${result.ok} detail=${result.detail}`);
    }
  }
  targetVisibilitySelfProbeResult = { pass: passCount === TARGET_VISIBILITY_SELF_PROBES.length, report, passCount, total: TARGET_VISIBILITY_SELF_PROBES.length };
  return targetVisibilitySelfProbeResult;
}

async function waitForCondition(check: () => boolean, timeoutMs: number, intervalMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return check();
}

/** Fail-closed process-GROUP teardown, now gated on target-visibility (round
 * 6 fix #6). Kills by exact pid only (`-pid`), never a broader/fuzzy match.
 * Any unconfirmed or partial result is `ok: false`, and every call site
 * treats that as a FAILURE, never as evidence to route around. */
async function killGroupFailClosed(pid: number): Promise<{ ok: boolean; detail: string }> {
  const selfProbes = runProcessTableSelfProbes();
  const targetVisibilityProbes = runTargetVisibilitySelfProbes();
  const selfProbeSummary = `process-table self-probes ${selfProbes.passCount}/${selfProbes.total} pass, target-visibility self-probes ${targetVisibilityProbes.passCount}/${targetVisibilityProbes.total} pass`;
  if (!selfProbes.pass || !targetVisibilityProbes.pass) {
    const failures = [...selfProbes.report, ...targetVisibilityProbes.report].filter((l) => l.startsWith('FAIL'));
    return { ok: false, detail: `${selfProbeSummary} -- refusing to trust any survivor scan this run: ${failures.join(' | ')}` };
  }
  const targetAliveAtStart = isPidAlive(pid);
  const preKillScan = targetAliveAtStart ? processGroupSurvivors(pid) : null;
  const targetVisibility = evaluateTargetVisibility(targetAliveAtStart, preKillScan);
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
      return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; SIGTERM to group -${pid} failed: ${String(err)}` };
    }
  }
  const emptyAfterTerm = await waitForCondition(() => {
    const scan = processGroupSurvivors(pid);
    return scan.ok && scan.survivors.length === 0;
  }, 8_000);
  if (!emptyAfterTerm) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
        return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; SIGKILL to group -${pid} failed: ${String(err)}` };
      }
    }
    const emptyAfterKill = await waitForCondition(() => {
      const scan = processGroupSurvivors(pid);
      return scan.ok && scan.survivors.length === 0;
    }, 5_000);
    if (!emptyAfterKill) {
      const scan = processGroupSurvivors(pid);
      if (!scan.ok) {
        return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; SCAN UNTRUSTWORTHY after SIGTERM+SIGKILL -- teardown NOT confirmed, never treated as an empty group: ${scan.detail}` };
      }
      return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; process group -${pid} still has survivors after SIGTERM+SIGKILL -- teardown NOT confirmed: ${scan.survivors.join('; ')}` };
    }
  }
  const finalScan = processGroupSurvivors(pid);
  if (!finalScan.ok) {
    return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; FINAL SCAN UNTRUSTWORTHY -- teardown NOT confirmed, never treated as an empty group: ${finalScan.detail}` };
  }
  if (finalScan.survivors.length > 0) {
    return { ok: false, detail: `${selfProbeSummary}; ${targetVisibility.detail}; process group -${pid} has survivors after kill+wait: ${finalScan.survivors.join('; ')}` };
  }
  if (!targetVisibility.ok) {
    return {
      ok: false,
      detail: `${selfProbeSummary}; ${targetVisibility.detail}; post-kill scan shows zero survivors, but that result is NOT TRUSTED without a passing target-visibility positive control -- teardown NOT confirmed`,
    };
  }
  return { ok: true, detail: `${selfProbeSummary}; ${targetVisibility.detail}; process group -${pid} confirmed empty (${finalScan.detail})` };
}

// ---------------------------------------------------------------------
// CLEANUP ORDERING (round 6 fix #5). Single shared implementation for every
// exit path that owns daemon-boot artifacts.
// ---------------------------------------------------------------------
/** Deletes `paths` ONLY when `teardown.ok` is true. On an unconfirmed/failed
 * teardown, RETAINS every path as forensic evidence and names them in the
 * returned detail -- never silently destroys evidence of what actually
 * happened. */
function finalizeArtifacts(teardown: { ok: boolean; detail: string }, paths: string[]): { ok: boolean; detail: string } {
  if (!teardown.ok) {
    return { ok: false, detail: `${teardown.detail}; forensic evidence RETAINED (not deleted): ${paths.join(', ')}` };
  }
  for (const p of paths) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup; does not affect the confirmed-ok teardown verdict */
    }
  }
  return { ok: true, detail: `${teardown.detail}; artifacts removed: ${paths.join(', ')}` };
}
/** No process was ever spawned -- nothing could have leaked, so cleanup is
 * unconditional; there is no "unconfirmed teardown" concept when there was
 * never a process to tear down. */
function cleanupNeverSpawnedArtifacts(paths: string[]): void {
  for (const p of paths) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// ---------------------------------------------------------------------
// COMMIT-BINDING for first-party workspace dependencies (round 6 fix #3).
// Adapted from scripts/waves/verify-w9-filesystem.ts's
// ensureFirstPartyPackagesRebuiltFromHead (79b15e90a) and
// scripts/waves/verify-w9-external-fetch.ts's
// ensureDaemonWorkspaceDepsRebuiltFromHead (45b5b445b).
// ---------------------------------------------------------------------
let daemonWorkspaceDepsRebuiltFromHead: Promise<{ detail: string }> | null = null;
function ensureDaemonWorkspaceDepsRebuiltFromHead(): Promise<{ detail: string }> {
  if (!daemonWorkspaceDepsRebuiltFromHead) {
    daemonWorkspaceDepsRebuiltFromHead = (async () => {
      const startedAt = Date.now();
      const r = sh('pnpm', ['--filter', '@open-design/daemon^...', 'run', 'build'], { timeoutMs: 5 * 60_000 });
      const durationMs = Date.now() - startedAt;
      if (r.status !== 0) {
        throw new Error(
          `rebuilding apps/daemon's first-party workspace dependencies from the current checkout failed (exit=${r.status}) -- refusing to boot a live daemon against possibly-stale/untrusted dist: ${(r.stderr || r.stdout).slice(-2000)}`,
        );
      }
      return {
        detail: `workspace dependency closure rebuilt from the current checkout -- pnpm --filter "@open-design/daemon^..." run build exited 0 in ${durationMs}ms; every transitively-imported first-party dist is fresh from tracked src at this run's checkout, never a possibly-stale/tampered prior build`,
      };
    })();
  }
  return daemonWorkspaceDepsRebuiltFromHead;
}

// ---------------------------------------------------------------------
// RUNTIME OBSERVATION (round 5, boot-mechanism fingerprints neutralized in
// round 6 fix #2). C10B-1/2/4 boot the REAL apps/daemon/src/server.ts and
// observe the REAL GET /api/mcp/servers HTTP response.
// ---------------------------------------------------------------------
interface LiveDaemon {
  url: string;
  pid: number;
  shutdown: () => Promise<{ ok: boolean; detail: string }>;
}

type BootResult =
  | { ok: true; daemon: LiveDaemon }
  | { ok: false; error: string; spawnedPid: number | null; teardownIfSpawned: { ok: boolean; detail: string } | null };

// Safety-net registry (round 6 fix #5): if THIS verifier process is itself
// interrupted mid-run, the SIGINT/SIGTERM handlers below best-effort tear
// down whatever isolated daemon is currently tracked here.
let currentLiveDaemonPid: number | null = null;
let signalTeardownInFlight = false;
async function emergencyTeardownOnSignal(): Promise<void> {
  if (signalTeardownInFlight) return;
  signalTeardownInFlight = true;
  if (currentLiveDaemonPid !== null) {
    try {
      await killGroupFailClosed(currentLiveDaemonPid);
    } catch {
      /* best-effort -- the process is already exiting on an external signal */
    }
  }
  process.exit(1);
}
process.on('SIGINT', () => {
  void emergencyTeardownOnSignal();
});
process.on('SIGTERM', () => {
  void emergencyTeardownOnSignal();
});

/** Boots the REAL, completely unmodified apps/daemon/src/server.ts from this
 * repository's own working tree (never a materialized copy), as a genuine
 * `detached: true` child process with its own process group, an isolated
 * `OD_DATA_DIR`, and `port: 0` (OS-assigned, independently re-checked
 * against FORBIDDEN_PORTS). Temp-dir/entrypoint naming carries no
 * "w10b"/"verify" text (round 6 fix #2); commit-binds first-party workspace
 * deps before spawning (round 6 fix #3); every exit path uses
 * `finalizeArtifacts()`/`cleanupNeverSpawnedArtifacts()` correctly (round 6
 * fix #5). */
async function bootIsolatedDaemon(): Promise<BootResult> {
  let rebuild: { detail: string };
  try {
    rebuild = await ensureDaemonWorkspaceDepsRebuiltFromHead();
  } catch (err) {
    return { ok: false, error: String((err as Error)?.stack ?? err), spawnedPid: null, teardownIfSpawned: null };
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-'));
  const serverTsPath = path.join(repoRoot, SERVER_FILE);
  const marker = crypto.randomBytes(16).toString('hex');
  const bootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-'));
  const bootScriptPath = path.join(bootDir, 'main.mjs');
  const bootScript = [
    `const SERVER_TS_PATH = ${JSON.stringify(serverTsPath)};`,
    `const MARKER = ${JSON.stringify(marker)};`,
    'const mod = await import(SERVER_TS_PATH);',
    'const result = await mod.startServer({ port: 0, host: "127.0.0.1", returnServer: true });',
    'const address = result.server.address();',
    'const port = address && typeof address === "object" ? address.port : 0;',
    'process.stdout.write(MARKER + JSON.stringify({ port }) + MARKER + "\\n");',
    'let shuttingDown = false;',
    'async function gracefulExit() {',
    '  if (shuttingDown) return;',
    '  shuttingDown = true;',
    '  try { await result.shutdown(); } catch {}',
    '  process.exit(0);',
    '}',
    'process.on("SIGTERM", gracefulExit);',
    'process.on("SIGINT", gracefulExit);',
  ].join('\n');
  fs.writeFileSync(bootScriptPath, bootScript);
  const checkResult = sh('node', ['--check', bootScriptPath], { timeoutMs: 15_000 });
  if (checkResult.status !== 0) {
    // Nothing was ever spawned -- unconditional cleanup, not
    // finalizeArtifacts() (there is no teardown result to gate on).
    cleanupNeverSpawnedArtifacts([bootDir, dataDir]);
    return {
      ok: false,
      error: `generated daemon-boot script failed node --check: ${checkResult.stderr.slice(0, 500)}`,
      spawnedPid: null,
      teardownIfSpawned: null,
    };
  }

  // A fresh env OBJECT for the child only -- this process's own `process.env`
  // is never assigned to, so nothing spawned later in this same verifier run
  // can inherit a stray OD_DATA_DIR/OD_BIND_HOST from an isolated daemon
  // boot.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, OD_DATA_DIR: dataDir, OD_BIND_HOST: '127.0.0.1' };
  delete childEnv.OD_API_TOKEN;
  delete childEnv.OD_WEB_PORT;

  const child = spawn('pnpm', ['exec', 'tsx', bootScriptPath], {
    cwd: repoRoot,
    detached: true, // own process group: pgid === child.pid on POSIX
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
  });
  if (!child.pid) {
    // Nothing was ever spawned -- unconditional cleanup.
    cleanupNeverSpawnedArtifacts([bootDir, dataDir]);
    return { ok: false, error: 'daemon-boot child process failed to spawn (no pid)', spawnedPid: null, teardownIfSpawned: null };
  }
  const childPid = child.pid;
  currentLiveDaemonPid = childPid;

  let stdoutBuf = '';
  let stderrBuf = '';
  child.stdout?.on('data', (d: Buffer) => {
    stdoutBuf += d.toString('utf8');
  });
  child.stderr?.on('data', (d: Buffer) => {
    stderrBuf += d.toString('utf8');
  });
  let exited = false;
  let exitInfo = '';
  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    exited = true;
    exitInfo = `exit code=${code} signal=${signal}`;
  });

  const readyPayload = await waitForCondition(() => stdoutBuf.split(marker).length - 1 >= 2, 30_000, 100).then(
    (found) => {
      if (!found) return null;
      const occurrences = stdoutBuf.split(marker).length - 1;
      if (occurrences !== 2) return null; // exactly two, never a first-match trust
      const re = new RegExp(`${marker}(.*?)${marker}`, 's');
      const match = re.exec(stdoutBuf);
      return match ? (match[1] ?? null) : null;
    },
  );

  const failBoot = async (reason: string): Promise<BootResult> => {
    const teardown = await killGroupFailClosed(childPid);
    currentLiveDaemonPid = null;
    const finalized = finalizeArtifacts(teardown, [bootDir, dataDir]);
    return { ok: false, error: `${reason} | ${finalized.detail}`, spawnedPid: childPid, teardownIfSpawned: teardown };
  };

  if (exited || readyPayload === null) {
    return failBoot(
      `daemon boot did not produce a ready marker within timeout (exited=${exited} ${exitInfo}); stdout tail: ${stdoutBuf.slice(-1000)}; stderr tail: ${stderrBuf.slice(-1000)}`,
    );
  }

  let parsed: { port: number };
  try {
    parsed = JSON.parse(readyPayload);
  } catch {
    return failBoot('daemon boot ready marker payload was not valid JSON');
  }
  if (!parsed.port || parsed.port === 0) {
    return failBoot(`isolated daemon boot resolved to an unacceptable port: ${parsed.port}`);
  }
  if (FORBIDDEN_PORTS.has(parsed.port)) {
    return failBoot(
      `isolated daemon boot resolved to a FORBIDDEN default-namespace port ${parsed.port} -- refused before issuing any request`,
    );
  }

  return {
    ok: true,
    daemon: {
      url: `http://127.0.0.1:${parsed.port}`,
      pid: childPid,
      shutdown: async () => {
        const teardown = await killGroupFailClosed(childPid);
        currentLiveDaemonPid = null;
        const finalized = finalizeArtifacts(teardown, [bootDir, dataDir]);
        return { ok: finalized.ok, detail: `${finalized.detail} [workspace-deps rebuild: ${rebuild.detail}]` };
      },
    },
  };
}

// -------------------------------------------------------------------------
// Fail-closed probe fetch: parse + resolve, refuse non-loopback and refuse
// FORBIDDEN_PORTS, redirect:'manual', bounded timeout (round 6 fix #5 --
// a hanging route must never block the run from ever reaching teardown).
// -------------------------------------------------------------------------
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  if (net.isIP(hostname) === 4) return hostname.startsWith('127.');
  if (net.isIP(hostname) === 6) return hostname === '::1';
  return false;
}
async function safeProbeFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`probe fetch refused: unparsable URL ${rawUrl}`);
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error(`probe fetch refused: non-loopback host ${parsed.hostname}`);
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
  if (FORBIDDEN_PORTS.has(port)) {
    throw new Error(`probe fetch refused: forbidden port ${port}`);
  }
  const signal = init.signal ?? AbortSignal.timeout(10_000);
  return fetch(parsed.toString(), { ...init, redirect: 'manual', signal });
}

interface WireFetchResult {
  ok: boolean;
  templates?: unknown[];
  error?: string;
}

/** Issues a REAL GET to `/api/mcp/servers` -- the exact route
 * apps/daemon/src/mcp-routes.ts:151-157 serves -- and parses the REAL
 * response body a wire client would receive. No JSON.stringify is called by
 * this file for this path; the bytes are whatever `res.json({ servers,
 * templates })` actually put on the socket. */
async function fetchMcpServersWire(daemonUrl: string): Promise<WireFetchResult> {
  let res: Response;
  try {
    res = await safeProbeFetch(`${daemonUrl}/api/mcp/servers`, { method: 'GET' });
  } catch (err) {
    return { ok: false, error: `fetch failed: ${String((err as Error)?.message ?? err)}` };
  }
  if (res.status !== 200) {
    return { ok: false, error: `GET /api/mcp/servers returned status ${res.status}` };
  }
  let bodyText: string;
  try {
    bodyText = await res.text();
  } catch (err) {
    return { ok: false, error: `reading response body failed: ${String(err)}` };
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyText);
  } catch (err) {
    return { ok: false, error: `response body was not valid JSON: ${String(err)}` };
  }
  if (parsedBody === null || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return { ok: false, error: `response body is not a plain object: ${bodyText.slice(0, 200)}` };
  }
  const templates = (parsedBody as Record<string, unknown>)['templates'];
  if (!Array.isArray(templates)) {
    return { ok: false, error: `response body has no 'templates' array (got ${typeof templates})` };
  }
  return { ok: true, templates };
}

/** Best-effort unrelated real traffic interleaved between reads (round 6 fix
 * #1) -- GET /api/mcp/install-info is a real, pre-existing, side-effect-free
 * route (apps/daemon/src/mcp-routes.ts:83-93), never a route invented for
 * this check. Its outcome is ignored; this call exists purely to add
 * unpredictable request-pattern noise around the reads that matter. */
async function fetchUnrelatedNoiseRoute(daemonUrl: string): Promise<void> {
  try {
    await safeProbeFetch(`${daemonUrl}/api/mcp/install-info`, { method: 'GET' });
  } catch {
    /* best-effort noise -- never fails an observation on its own */
  }
}

/** Finds every wire-observed array element whose real `.id` property equals
 * 'voicebox'. */
function findVoiceboxWireEntries(templates: unknown[]): Record<string, unknown>[] {
  return templates.filter(
    (t): t is Record<string, unknown> => t !== null && typeof t === 'object' && !Array.isArray(t) && (t as Record<string, unknown>)['id'] === 'voicebox',
  );
}

/** Compares a wire-observed voicebox entry against FROZEN, restricted to
 * `fields`. Empty return = exact match. */
function compareFrozenFields(
  wireShape: Record<string, unknown>,
  fields: readonly (keyof typeof FROZEN)[],
): string[] {
  const problems: string[] = [];
  for (const field of fields) {
    const actual = wireShape[field];
    const expected = FROZEN[field];
    if (actual !== expected) {
      problems.push(
        `wire-observed ${String(field)}=${JSON.stringify(actual)}, want exactly ${JSON.stringify(expected)}`,
      );
    }
  }
  return problems;
}

async function readVoiceboxEntryOnce(daemonUrl: string): Promise<{ ok: boolean; error?: string | undefined; value?: Record<string, unknown> }> {
  const wire = await fetchMcpServersWire(daemonUrl);
  if (!wire.ok || !wire.templates) return { ok: false, error: wire.error };
  const matches = findVoiceboxWireEntries(wire.templates);
  if (matches.length !== 1) {
    return { ok: false, error: `expected exactly 1 wire element with id 'voicebox', found ${matches.length}` };
  }
  const entry = matches[0];
  if (!entry) return { ok: false, error: "unreachable -- matches.length===1 but element was falsy" };
  return { ok: true, value: entry };
}

// ---------------------------------------------------------------------
// READ-HORIZON (round 6 fix #1). See the header's ROUND-6 note #1 for the
// full rationale and the honest bound on what this does and does not
// guarantee.
// ---------------------------------------------------------------------
const MIN_BURST_READS = 5;
const MAX_BURST_READS_EXCLUSIVE = 15; // burst length drawn fresh from [5, 14]
const MIN_INTER_READ_JITTER_MS = 0;
const MAX_INTER_READ_JITTER_MS_EXCLUSIVE = 150;
const MIN_TAIL_DELAY_MS = 250;
const MAX_TAIL_DELAY_MS_EXCLUSIVE = 2500;

interface RepeatedObservation {
  ok: boolean;
  error?: string;
  reads: Record<string, unknown>[];
  schedule: string;
}

/** Reads the voicebox wire entry a randomized-per-call number of times
 * (drawn fresh from `crypto.randomInt()` at call time, never derivable from
 * this file's own committed source), with randomized inter-read jitter,
 * unpredictable interleaved unrelated traffic, and a final long-tail read
 * after an independently randomized delay. */
async function observeVoiceboxWireEntryRepeated(daemonUrl: string): Promise<RepeatedObservation> {
  const burstCount = crypto.randomInt(MIN_BURST_READS, MAX_BURST_READS_EXCLUSIVE);
  const reads: Record<string, unknown>[] = [];
  for (let i = 0; i < burstCount; i++) {
    if (i > 0) {
      const jitterMs = crypto.randomInt(MIN_INTER_READ_JITTER_MS, MAX_INTER_READ_JITTER_MS_EXCLUSIVE);
      if (jitterMs > 0) await sleep(jitterMs);
      if (crypto.randomInt(0, 2) === 0) await fetchUnrelatedNoiseRoute(daemonUrl);
    }
    // eslint-disable-next-line no-await-in-loop -- reads must be sequential,
    // independent round trips against the daemon's one long-lived module
    // instance, not concurrent requests racing each other.
    const r = await readVoiceboxEntryOnce(daemonUrl);
    if (!r.ok || !r.value) {
      return { ok: false, error: `burst read #${i + 1}/${burstCount}: ${r.error ?? 'unknown fetch error'}`, reads, schedule: `burstCount=${burstCount} (failed at read ${i + 1})` };
    }
    reads.push(r.value);
  }
  const tailDelayMs = crypto.randomInt(MIN_TAIL_DELAY_MS, MAX_TAIL_DELAY_MS_EXCLUSIVE);
  await sleep(tailDelayMs);
  const tail = await readVoiceboxEntryOnce(daemonUrl);
  if (!tail.ok || !tail.value) {
    return { ok: false, error: `long-tail read after ${tailDelayMs}ms: ${tail.error ?? 'unknown fetch error'}`, reads, schedule: `burstCount=${burstCount}, tailDelayMs=${tailDelayMs} (tail read failed)` };
  }
  reads.push(tail.value);
  return { ok: true, reads, schedule: `burstCount=${burstCount}, tailDelayMs=${tailDelayMs}, totalReads=${reads.length}` };
}

// ---------------------------------------------------------------------
// WIRE-SELFTEST fixtures (round 5). These test the OBSERVATION MECHANISM's
// (fetch/parse/compare) sensitivity to value-divergence tricks -- a
// DIFFERENT property than the read-horizon defense above, which only C10B-
// 1/2/4 need against the REAL daemon. Kept on a small fixed read count (2)
// rather than the randomized horizon: these fixtures are static objects with
// no time/count-triggered behavior of their own, so a large randomized
// schedule here would only add runtime, not evidence.
// ---------------------------------------------------------------------
const EVIL_FIELDS = {
  id: 'voicebox',
  label: 'EVIL',
  description: 'evil',
  example: 'evil',
  homepage: 'https://evil.invalid',
  transport: 'http',
  authMode: 'oauth',
  category: 'utilities',
  url: 'http://evil.invalid',
} as const;

type FixtureKind =
  | 'clean-legitimate-entry'
  | 'proto-inherited-tojson'
  | 'own-method-tojson'
  | 'spread-override'
  | 'getter-accessor-override'
  | 'defineProperty-after-declaration'
  | 'setPrototypeOf-after-declaration'
  | 'dead-branch-lookalike-ternary';

function buildFixtureEntry(kind: FixtureKind): unknown {
  switch (kind) {
    case 'clean-legitimate-entry':
      return { ...FROZEN };
    case 'proto-inherited-tojson': {
      const proto = { toJSON: () => ({ ...EVIL_FIELDS }) };
      return Object.assign(Object.create(proto), FROZEN);
    }
    case 'own-method-tojson':
      return { ...FROZEN, toJSON: () => ({ ...EVIL_FIELDS }) };
    case 'spread-override':
      return { ...FROZEN, ...{ url: EVIL_FIELDS.url, authMode: EVIL_FIELDS.authMode } };
    case 'getter-accessor-override': {
      const { url: _unused, ...rest } = FROZEN;
      return Object.defineProperty({ ...rest }, 'url', { get: () => EVIL_FIELDS.url, enumerable: true, configurable: true });
    }
    case 'defineProperty-after-declaration': {
      const obj: Record<string, unknown> = { ...FROZEN };
      Object.defineProperty(obj, 'url', { value: EVIL_FIELDS.url, enumerable: true, configurable: true });
      return obj;
    }
    case 'setPrototypeOf-after-declaration': {
      const obj: Record<string, unknown> = { ...FROZEN };
      Object.setPrototypeOf(obj, { toJSON: () => ({ ...EVIL_FIELDS }) });
      return obj;
    }
    case 'dead-branch-lookalike-ternary': {
      const ALWAYS_EVIL = 1 === 1;
      const { url: _unused, ...rest } = FROZEN;
      return { ...rest, url: ALWAYS_EVIL ? EVIL_FIELDS.url : FROZEN.url };
    }
  }
}

async function runOneWireSelftestCase(
  name: string,
  kind: FixtureKind,
  expectClean: boolean,
): Promise<{ name: string; ok: boolean; detail: string }> {
  const entry = buildFixtureEntry(kind);
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ servers: [], templates: [entry] }));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : 0;
    if (!port) return { name, ok: false, detail: 'selftest http server did not resolve a port' };
    if (FORBIDDEN_PORTS.has(port)) {
      return { name, ok: false, detail: `selftest http server bound to a forbidden port ${port}` };
    }
    const url = `http://127.0.0.1:${port}`;
    const first = await readVoiceboxEntryOnce(url);
    const second = await readVoiceboxEntryOnce(url);
    if (!first.ok || !first.value || !second.ok || !second.value) {
      return { name, ok: false, detail: `fixture fetch failed: first=${first.error ?? 'ok'} second=${second.error ?? 'ok'}` };
    }
    const frozenKeys = Object.keys(FROZEN).sort();
    const perReadProblems = [first.value, second.value].map((read) => {
      const actualKeys = Object.keys(read).sort();
      const keySetProblems =
        actualKeys.join(',') !== frozenKeys.join(',')
          ? [`key set mismatch: actual=[${actualKeys.join(', ')}] frozen=[${frozenKeys.join(', ')}]`]
          : [];
      return [...keySetProblems, ...compareFrozenFields(read, frozenKeys as (keyof typeof FROZEN)[])];
    });
    const allProblems = perReadProblems.flat();
    const isClean = allProblems.length === 0;
    const matchesExpectation = isClean === expectClean;
    return {
      name,
      ok: matchesExpectation,
      detail: matchesExpectation
        ? isClean
          ? 'correctly detected as clean across both wire reads (matches FROZEN exactly)'
          : `correctly detected divergence(s) from FROZEN over the wire: ${allProblems.join(' | ')}`
        : isClean
          ? 'FALSE GREEN -- fixture should have diverged from FROZEN over the wire but compared clean'
          : `expected clean but found wire divergence(s): ${allProblems.join(' | ')}`,
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ---------------------------------------------------------------------
// Comment collection (round-3 finding 2 fix, unchanged since). Trusts the
// parser's own literal boundaries instead of hand-rolling a stateful scanner
// loop.
// ---------------------------------------------------------------------
const COMMENT_LIKE_PATTERN = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

function collectOpaqueLiteralRanges(sourceFile: SourceFile): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  function visit(node: TsNode): void {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isRegularExpressionLiteral(node)
    ) {
      ranges.push([node.getStart(sourceFile), node.getEnd()]);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return ranges;
}

function isInsideAnyRange(pos: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => pos >= start && pos < end);
}

function collectComments(sourceText: string, sourceFile: SourceFile): string[] {
  const opaque = collectOpaqueLiteralRanges(sourceFile);
  const comments: string[] = [];
  COMMENT_LIKE_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMMENT_LIKE_PATTERN.exec(sourceText)) !== null) {
    if (!isInsideAnyRange(m.index, opaque)) comments.push(m[0]);
  }
  return comments;
}

async function main(): Promise<void> {
  // Two-phase manifest write: a dirty placeholder goes down IMMEDIATELY,
  // before any criterion runs, so a crash/interruption mid-run can never
  // leave a stale-but-complete-looking prior green manifest on disk.
  const placeholder = {
    wave: 'W10b',
    commit: headSha,
    treeDirty: true,
    baseCommit,
    gateIntegrityPinned,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: [] as CriterionResult[],
  };
  try {
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, JSON.stringify(placeholder, null, 2));
    fs.renameSync(tmp, path.join(proofDir, 'manifest.json'));
  } catch (err) {
    writeEmergencyManifest(`could not write placeholder manifest: ${String(err)}`);
    process.exit(1);
  }

  // ---------------------------------------------------------------------
  // Boot ONE isolated daemon, shared by C10B-1/2/4 and torn down by
  // DAEMON-TEARDOWN below.
  // ---------------------------------------------------------------------
  let boot: BootResult;
  try {
    boot = await bootIsolatedDaemon();
  } catch (err) {
    boot = {
      ok: false,
      error: `bootIsolatedDaemon() threw: ${String((err as Error)?.stack ?? err)}`,
      spawnedPid: null,
      teardownIfSpawned: null,
    };
  }
  const liveDaemon: LiveDaemon | null = boot.ok ? boot.daemon : null;
  const bootFailureDetail = boot.ok ? null : boot.error;

  async function recordDaemonBoundCriterion(
    id: string,
    assertion: string,
    fields: readonly (keyof typeof FROZEN)[],
    extraCheck?: (read: Record<string, unknown>) => string[],
  ): Promise<void> {
    if (!liveDaemon) {
      record(id, '', assertion, false, '', {
        detail: `isolated daemon never became ready: ${bootFailureDetail ?? 'unknown boot failure'}`,
      });
      return;
    }
    const observation = await observeVoiceboxWireEntryRepeated(liveDaemon.url);
    if (!observation.ok) {
      record(
        id,
        `GET ${liveDaemon.url}/api/mcp/servers (randomized-horizon repeated real HTTP; schedule=${observation.schedule})`,
        assertion,
        false,
        '',
        { detail: observation.error ?? 'repeated wire observation failed for an unknown reason' },
      );
      return;
    }
    const frozenKeys = Object.keys(FROZEN).sort();
    const perReadProblems = observation.reads.map((read, i) => {
      const actualKeys = Object.keys(read).sort();
      const extra = actualKeys.filter((k) => !frozenKeys.includes(k));
      const missing = frozenKeys.filter((k) => !actualKeys.includes(k));
      const keySetProblems =
        extra.length || missing.length
          ? [`read #${i + 1}: EXTRA keys=[${extra.join(', ')}] MISSING keys=[${missing.join(', ')}]`]
          : [];
      const fieldProblems = compareFrozenFields(read, fields).map((p) => `read #${i + 1}: ${p}`);
      const extraProblems = (extraCheck?.(read) ?? []).map((p) => `read #${i + 1}: ${p}`);
      return [...keySetProblems, ...fieldProblems, ...extraProblems];
    });
    const allProblems = perReadProblems.flat();
    record(
      id,
      `GET ${liveDaemon.url}/api/mcp/servers (randomized-horizon repeated real HTTP against the one isolated daemon instance; schedule=${observation.schedule})`,
      assertion,
      allProblems.length === 0,
      allProblems.join('\n') ||
        `all ${observation.reads.length} wire reads (schedule=${observation.schedule}) matched FROZEN exactly: ${JSON.stringify(observation.reads[0])}`,
      { detail: allProblems.length === 0 ? undefined : allProblems.join('; ') },
    );
  }

  // -----------------------------------------------------------------
  // C10B-1 -- registration present, proven at RUNTIME against the REAL
  // booted daemon's REAL GET /api/mcp/servers response, over a
  // randomized-per-run number of independent reads plus a randomly-delayed
  // long-tail read (round 6 fix #1 -- see header). Requires exactly one wire
  // element per read whose id === 'voicebox', and that read's own-key set to
  // be EXACTLY FROZEN's key set.
  // -----------------------------------------------------------------
  await checkCriterion('C10B-1', () =>
    recordDaemonBoundCriterion(
      'C10B-1',
      "exactly one wire-observed element has id === 'voicebox' on every read of a randomized-per-run burst (5-14 reads) plus one independently-delayed long-tail read, and each read's own-key set is exactly FROZEN's key set -- no more, no fewer",
      [],
    ),
  );

  // -----------------------------------------------------------------
  // C10B-2 -- correct transport/config shape, exact, proven at RUNTIME on
  // the same repeated wire observation C10B-1 establishes.
  // -----------------------------------------------------------------
  await checkCriterion('C10B-2', () =>
    recordDaemonBoundCriterion(
      'C10B-2',
      "wire-observed transport===FROZEN.transport, url===FROZEN.url (full-string), category===FROZEN.category, authMode===FROZEN.authMode on every read; no 'headerFields' key served on any read",
      ['transport', 'url', 'category', 'authMode'],
      (read) =>
        'headerFields' in read
          ? [
              `wire-observed entry has a 'headerFields' key (value=${JSON.stringify(read['headerFields'])}) -- round-1 ruling pins X-Voicebox-Client-Id (and headerFields entirely) absent`,
            ]
          : [],
    ),
  );

  // -----------------------------------------------------------------
  // C10B-4 -- no voiceover-workflow scope creep (round-1 finding 4), proven
  // at RUNTIME on the same repeated wire observation.
  // -----------------------------------------------------------------
  await checkCriterion('C10B-4', () =>
    recordDaemonBoundCriterion(
      'C10B-4',
      'wire-observed label/description/example/homepage are byte-identical to the frozen strings on every read',
      ['label', 'description', 'example', 'homepage'],
    ),
  );

  // -----------------------------------------------------------------
  // DAEMON-TEARDOWN -- infra check, not a PRD criterion. Binding safety
  // constraint for this run: a failed or partial teardown FAILS the run.
  // -----------------------------------------------------------------
  await checkCriterion('DAEMON-TEARDOWN', async () => {
    if (boot.ok) {
      const teardown = await boot.daemon.shutdown();
      record(
        'DAEMON-TEARDOWN',
        'killGroupFailClosed(pid) with target-visibility positive control -- SIGTERM the process group, poll for group emptiness, escalate to SIGKILL, re-scan ps before declaring success; artifacts deleted only when confirmed',
        "the isolated daemon's entire process group is confirmed empty after teardown, with a passed target-visibility positive control",
        teardown.ok,
        teardown.detail,
        { detail: teardown.ok ? undefined : teardown.detail },
      );
      return;
    }
    if (boot.spawnedPid !== null) {
      const teardown = boot.teardownIfSpawned;
      record(
        'DAEMON-TEARDOWN',
        "killGroupFailClosed(pid), run inside bootIsolatedDaemon()'s own failure path",
        "the isolated daemon's entire process group is confirmed empty after teardown, even though boot itself never became ready",
        teardown?.ok === true,
        teardown?.detail ?? 'no teardown result recorded for a spawned pid -- treated as unconfirmed',
        { detail: teardown?.ok === true ? undefined : (teardown?.detail ?? 'unconfirmed teardown after a spawned pid') },
      );
      return;
    }
    record(
      'DAEMON-TEARDOWN',
      '',
      "the isolated daemon's entire process group is confirmed empty after teardown",
      true,
      `no process was ever spawned this run (boot failed before spawn: ${bootFailureDetail ?? 'unknown'})`,
      { status: 'not-exercised' },
    );
  });

  // -----------------------------------------------------------------
  // C10B-3 -- no extra surface added: UNCHANGED since round 4.
  // -----------------------------------------------------------------
  function globToRegExp(glob: string): RegExp {
    let re = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    re = re.replace(/\*\*/g, ' GLOBSTAR ');
    re = re.replace(/\*/g, '[^/]*');
    re = re.replace(/ GLOBSTAR /g, '.*');
    return new RegExp(`^${re}$`);
  }

  await checkCriterion('C10B-3', () => {
    const problems: string[] = [];

    const leasesText = readFileAtCommit(baseCommit, 'docs/plans/waves/leases.json');
    let lease: { allow: string[]; deny?: string[] } | undefined;
    if (leasesText === null) {
      problems.push(`could not read docs/plans/waves/leases.json at baseCommit ${baseCommit}`);
    } else {
      try {
        const parsedLeases = JSON.parse(leasesText) as {
          waves: Record<string, { allow: string[]; deny?: string[] }>;
        };
        lease = parsedLeases.waves['W10b'];
      } catch (err) {
        problems.push(`leases.json@baseCommit did not parse: ${String(err)}`);
      }
      if (!lease) {
        problems.push(
          'no "W10b" entry in leases.json@baseCommit -- expected until the orchestrator adds the entry proposed in docs/plans/waves/W10b-voicebox-registration.md\'s "Proposed write lease" section (fails closed by design; see that PRD\'s "Verified baseline" section)',
        );
      } else {
        if (lease.allow.length !== 1 || lease.allow[0] !== TEMPLATE_FILE) {
          problems.push(
            `leases.json@baseCommit["W10b"].allow is ${JSON.stringify(lease.allow)}, want exactly ["${TEMPLATE_FILE}"] -- this verifier must not be implementer-writable (round-1 finding 1)`,
          );
        }
        const denyList = lease.deny ?? [];
        const requiredDeny = ['docs/plans/waves/W10b-voicebox-registration.md', 'scripts/waves/verify-w10b.ts'];
        const missingDeny = requiredDeny.filter((p) => !denyList.includes(p));
        if (missingDeny.length > 0) {
          problems.push(
            `leases.json@baseCommit["W10b"].deny is missing ${JSON.stringify(missingDeny)} -- round-3 requires the PRD and this verifier both explicitly denied, not merely omitted from allow`,
          );
        }
      }
    }

    const diffResult = sh('git', ['diff', '--name-only', `${baseCommit}...HEAD`]);
    const diffNames = diffResult.stdout.trim().split('\n').filter(Boolean);
    if (diffResult.status !== 0) problems.push(`git diff exited ${diffResult.status}: ${diffResult.stderr}`);
    if (lease) {
      const allowRe = lease.allow.map(globToRegExp);
      const denyRe = (lease.deny ?? []).map(globToRegExp);
      const violations = diffNames.filter(
        (f) => !allowRe.some((re) => re.test(f)) || denyRe.some((re) => re.test(f)),
      );
      if (violations.length > 0) problems.push(`outside W10b lease: ${violations.join(', ')}`);
    }

    const baseText = readFileAtCommit(baseCommit, TEMPLATE_FILE);
    const headText = readFileAtCommit(headSha, TEMPLATE_FILE);
    if (baseText === null || headText === null) {
      problems.push(`could not read ${TEMPLATE_FILE} at baseCommit and/or HEAD`);
    } else {
      const baseScan = analyzeTemplateArray(baseText, `${TEMPLATE_FILE}@base`);
      const headScan = analyzeTemplateArray(headText, `${TEMPLATE_FILE}@head`);
      if (!baseScan || !headScan) {
        problems.push('could not locate MCP_TEMPLATES at baseCommit and/or HEAD');
      } else if (baseScan.problems.length > 0 || headScan.problems.length > 0) {
        problems.push(
          `array elements could not be identified by id -- base: [${baseScan.problems.join(' | ')}] head: [${headScan.problems.join(' | ')}]`,
        );
      } else {
        const baseSplit = splitAroundArray(baseText, baseScan);
        const headSplit = splitAroundArray(headText, headScan);
        if (baseSplit.before !== headSplit.before) {
          problems.push('file text BEFORE the MCP_TEMPLATES array changed -- only the array may change (round-1 finding 2)');
        }
        if (baseSplit.after !== headSplit.after) {
          problems.push('file text AFTER the MCP_TEMPLATES array changed -- only the array may change (round-1 finding 2)');
        }
        const baseClean = baseScan.clean as Map<string, TemplateBlock>;
        const headClean = headScan.clean as Map<string, TemplateBlock>;
        for (const [id, baseBlock] of baseClean) {
          const headBlock = headClean.get(id);
          if (!headBlock) {
            problems.push(`pre-existing template '${id}' was removed`);
          } else if (headBlock.rawText !== baseBlock.rawText) {
            problems.push(`pre-existing template '${id}' was modified (not byte-identical)`);
          }
        }
        const newIds = [...headClean.keys()].filter((id) => !baseClean.has(id));
        if (newIds.length !== 1) {
          problems.push(`expected exactly 1 new MCP_TEMPLATES entry, found ${newIds.length}: ${newIds.join(', ') || '<none>'}`);
        } else if (newIds[0] !== 'voicebox') {
          problems.push(`the one new entry is '${newIds[0]}', expected 'voicebox'`);
        }
      }
    }

    record(
      'C10B-3',
      `git diff --name-only ${baseCommit}...HEAD subset-of leases.json@baseCommit["W10b"] (allow exactly mcp-config.ts, deny includes this PRD+verifier); MCP_TEMPLATES array elements identifiable by id both sides; non-array file text byte-identical; additive-only array diff`,
      "diff is within the narrowed W10b lease (exact allow, required deny entries present); both baseCommit and HEAD's MCP_TEMPLATES arrays are structurally identifiable by id with zero ambiguity; every file byte outside the array is unchanged; every pre-existing entry is byte-identical; exactly one new entry, id voicebox",
      problems.length === 0,
      problems.join('\n') ||
        (diffNames.length === 0 ? 'no diff between baseCommit and HEAD' : `changed files: ${diffNames.join(', ')}`),
      { detail: problems.length === 0 ? undefined : problems.join('; ') },
    );
  });

  // -----------------------------------------------------------------
  // C10B-5 -- documentation record: UNCHANGED since round 4.
  // -----------------------------------------------------------------
  await checkCriterion('C10B-5', () => {
    const baseText = readFileAtCommit(baseCommit, TEMPLATE_FILE);
    const headText = readFileAtCommit(headSha, TEMPLATE_FILE);
    if (baseText === null || headText === null) {
      record('C10B-5', '', "a comment token added to the file contains the literal substring 'NM-25'", false, '', {
        detail: `could not read ${TEMPLATE_FILE} at baseCommit and/or HEAD`,
      });
      return;
    }
    const baseSf = ts.createSourceFile(`${TEMPLATE_FILE}@base-c5`, baseText, ts.ScriptTarget.Latest, true);
    const headSf = ts.createSourceFile(`${TEMPLATE_FILE}@head-c5`, headText, ts.ScriptTarget.Latest, true);
    const baseComments = new Set(collectComments(baseText, baseSf));
    const headComments = collectComments(headText, headSf);
    const newNm25Comments = headComments.filter((c) => c.includes('NM-25') && !baseComments.has(c));
    record(
      'C10B-5',
      `parse ${TEMPLATE_FILE}@baseCommit and @HEAD, collect real comment tokens via collectComments() (round-3: literal-boundary-aware, not raw scanning)`,
      "a comment token added to the file (present at HEAD, absent at baseCommit) contains the literal substring 'NM-25' -- text inside a string or template literal, at any interpolation depth, does not count",
      newNm25Comments.length > 0,
      newNm25Comments.length > 0
        ? newNm25Comments.join('\n')
        : `${headComments.length} total comment(s) at HEAD, ${baseComments.size} at baseCommit; none newly-added contain 'NM-25'`,
      { detail: newNm25Comments.length > 0 ? undefined : 'no newly-added NM-25 comment found' },
    );
  });

  // -----------------------------------------------------------------
  // GATE-INTEGRITY -- infra check, not a PRD criterion. Round 6 fix #4 adds
  // an ALWAYS-ACTIVE self-vs-HEAD tamper-evidence comparison, independent of
  // git status; the pre-existing approved-hash comparison (once pinned) is
  // unchanged and layers on top.
  // -----------------------------------------------------------------
  await checkCriterion('GATE-INTEGRITY', () => {
    const selfPath = process.argv[1] ? path.resolve(process.argv[1]) : path.join(repoRoot, 'scripts/waves/verify-w10b.ts');
    let selfSha256: string;
    try {
      selfSha256 = sha256File(selfPath);
    } catch (err) {
      record(
        'GATE-INTEGRITY',
        '',
        'defense-in-depth self-hash check; the PRIMARY control is the lease-subset check in C10B-3, not this pin',
        false,
        '',
        { detail: `could not hash self at ${selfPath}: ${String(err)}` },
      );
      return;
    }

    // Round 6 fix #4: self-vs-HEAD, ALWAYS checked (not gated on
    // gateIntegrityPinned), independent of git status -- catches an
    // assume-unchanged/skip-worktree hidden edit that `treeDirty` cannot see.
    const treeDirtyNow = sh('git', ['status', '--porcelain=v1']).stdout.trim().length > 0;
    const headText = readFileAtCommit(headSha, SELF_FILE);
    const headSha256 = headText === null ? null : sha256Bytes(Buffer.from(headText, 'utf8'));
    const selfMatchesHead = headSha256 !== null && headSha256 === selfSha256;
    let selfVsHeadProblem: string | null = null;
    if (headSha256 === null) {
      selfVsHeadProblem = `could not read ${SELF_FILE} at HEAD (${headSha}) via git show`;
    } else if (!selfMatchesHead) {
      selfVsHeadProblem = treeDirtyNow
        ? `expected mismatch: working tree has uncommitted changes (treeDirty=true) -- HEAD is not the currently-executing bytes; this is not evidence of tampering on its own, and the overall run already fails via treeDirty regardless (self=${selfSha256}, HEAD=${headSha256})`
        : `TAMPER ALARM: git status reports a CLEAN tree, but the executing verifier's bytes differ from git show HEAD:${SELF_FILE} -- possible assume-unchanged/skip-worktree hidden edit (self=${selfSha256}, HEAD=${headSha256})`;
    }

    const approvedHashPath = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256');
    if (!gateIntegrityPinned) {
      record(
        'GATE-INTEGRITY',
        'self-hash vs git show HEAD (always active) + self-hash vs approved-gate.sha256 (once pinned)',
        'defense-in-depth self-hash checks',
        selfVsHeadProblem === null,
        `sha256: ${selfSha256}\nself-vs-HEAD: ${selfVsHeadProblem ?? 'match'}\nUNPINNED -- no approved-gate.sha256 present yet; see manifest.gateIntegrityPinned=false. C10B-3's lease-subset check is the primary control regardless.`,
        { detail: selfVsHeadProblem ?? undefined },
      );
      return;
    }
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const pinMatches = approved === selfSha256;
    const gateOk = pinMatches && selfVsHeadProblem === null;
    record(
      'GATE-INTEGRITY',
      'self-hash vs git show HEAD (always active) + self-hash vs approved-gate.sha256 (pinned)',
      'defense-in-depth self-hash checks',
      gateOk,
      `sha256: ${selfSha256}\napproved: ${approved}\nself-vs-HEAD: ${selfVsHeadProblem ?? 'match'}\nPINNED`,
      { detail: gateOk ? undefined : !pinMatches ? 'verify-w10b.ts modified since orchestrator approval' : (selfVsHeadProblem ?? undefined) },
    );
  });

  // -----------------------------------------------------------------
  // SCANNER-SELFTEST -- infra check, not a PRD criterion. UNCHANGED since
  // round 3.
  // -----------------------------------------------------------------
  await checkCriterion('SCANNER-SELFTEST', () => {
    const cases: Array<{ name: string; source: string; expectNm25Comments: string[] }> = [
      { name: 'real-line-comment', source: 'const x = 1; // NM-25\n', expectNm25Comments: ['// NM-25'] },
      { name: 'real-block-comment', source: 'const x = 1; /* NM-25 */\n', expectNm25Comments: ['/* NM-25 */'] },
      { name: 'template-tail-after-substitution-line-comment-lookalike (round-2 false-positive)', source: 'const x = `${0}// NM-25`;\n', expectNm25Comments: [] },
      { name: 'template-tail-after-substitution-block-comment-lookalike (round-2 false-positive)', source: 'const x = `before ${0} /* NM-25 */ after`;\n', expectNm25Comments: [] },
      { name: 'no-substitution-template-literal-text', source: 'const x = `// NM-25`;\n', expectNm25Comments: [] },
      { name: 'plain-string-literal-text', source: "const x = 'NM-25 inside a plain string, not a comment';\n", expectNm25Comments: [] },
      { name: 'real-comment-immediately-after-a-template-literal', source: 'const x = `${0}`; // NM-25\n', expectNm25Comments: ['// NM-25'] },
      { name: 'nested-template-substitution-with-comment-lookalike-in-inner-tail', source: 'const x = `${`${0}// NM-25`}`;\n', expectNm25Comments: [] },
    ];
    const problems: string[] = [];
    for (const c of cases) {
      const sf = ts.createSourceFile('selftest.ts', c.source, ts.ScriptTarget.Latest, true);
      const actual = collectComments(c.source, sf).filter((s) => s.includes('NM-25'));
      const expected = c.expectNm25Comments;
      const match = actual.length === expected.length && actual.every((v, i) => v === expected[i]);
      if (!match) {
        problems.push(`${c.name}: source=${JSON.stringify(c.source)} expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
      }
    }
    record(
      'SCANNER-SELFTEST',
      'in-process fixture cases exercising collectComments() against template-literal edge cases, including the exact two round-2 false-positive shapes',
      'collectComments() correctly distinguishes real comments from comment-shaped text inside string/template literals, at every interpolation depth, in both directions (no false positive, no false negative on a real adjacent comment)',
      problems.length === 0,
      problems.join('\n') || `${cases.length} fixture cases all matched expected output`,
      { detail: problems.length === 0 ? undefined : `${problems.length}/${cases.length} fixture case(s) failed` },
    );
  });

  // -----------------------------------------------------------------
  // WIRE-SELFTEST -- infra check, not a PRD criterion (round 5). Proves the
  // fetch+parse+compare pipeline correctly passes a clean entry and
  // correctly DETECTS every named value-divergence vector, over a real
  // loopback HTTP round trip.
  // -----------------------------------------------------------------
  await checkCriterion('WIRE-SELFTEST', async () => {
    const cases: Array<{ name: string; kind: FixtureKind; expectClean: boolean }> = [
      { name: 'clean-legitimate-entry', kind: 'clean-legitimate-entry', expectClean: true },
      { name: 'round3-proto-inherited-tojson (the exact round-3 REJECT vector)', kind: 'proto-inherited-tojson', expectClean: false },
      { name: 'own-method-toJSON', kind: 'own-method-tojson', expectClean: false },
      { name: 'round2-spread-override (regression)', kind: 'spread-override', expectClean: false },
      { name: 'getter-accessor-override', kind: 'getter-accessor-override', expectClean: false },
      { name: 'defineProperty-after-declaration', kind: 'defineProperty-after-declaration', expectClean: false },
      { name: 'setPrototypeOf-after-declaration', kind: 'setPrototypeOf-after-declaration', expectClean: false },
      { name: 'dead-branch-lookalike-ternary', kind: 'dead-branch-lookalike-ternary', expectClean: false },
    ];
    const outcomes: Array<{ name: string; ok: boolean; detail: string }> = [];
    for (const c of cases) {
      // eslint-disable-next-line no-await-in-loop -- fixtures must run
      // sequentially: each binds its own throwaway in-process http server
      // and closes it before the next starts.
      const outcome = await runOneWireSelftestCase(c.name, c.kind, c.expectClean);
      outcomes.push(outcome);
    }
    const failures = outcomes.filter((o) => !o.ok);
    record(
      'WIRE-SELFTEST',
      'in-process node:http fixture cases: serve a synthetic { servers: [], templates: [entry] } body exactly like mcp-routes.ts:157, fetch it twice over real loopback HTTP through the exact fetchMcpServersWire()/findVoiceboxWireEntries()/compareFrozenFields() pipeline C10B-1/2/4 use',
      'the wire-observation mechanism correctly passes a clean legitimate entry and correctly DETECTS every named divergence vector as a mismatch over the wire (no false green)',
      failures.length === 0,
      outcomes.map((o) => `[${o.ok ? 'OK' : 'FAIL'}] ${o.name}: ${o.detail}`).join('\n'),
      {
        detail:
          failures.length === 0
            ? undefined
            : `${failures.length}/${cases.length} fixture case(s) failed: ${failures.map((f) => f.name).join(', ')}`,
      },
    );
  });

  // -----------------------------------------------------------------
  // TEARDOWN-ARTIFACTS-SELFTEST -- infra check, not a PRD criterion (round 6
  // fix #5). Proves finalizeArtifacts() against REAL temporary files created
  // on disk for the test: a confirmed-ok teardown deletes them, an
  // unconfirmed/failed teardown retains them -- a controlled probe for the
  // cleanup-ordering invariant, not merely a return-value assertion.
  // -----------------------------------------------------------------
  await checkCriterion('TEARDOWN-ARTIFACTS-SELFTEST', () => {
    const problems: string[] = [];

    const okDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10b-teardown-selftest-ok-'));
    const okFile = path.join(okDir, 'marker.txt');
    fs.writeFileSync(okFile, 'ok-case');
    const okResult = finalizeArtifacts({ ok: true, detail: 'synthetic confirmed teardown' }, [okDir]);
    if (!okResult.ok) problems.push(`confirmed-ok case: finalizeArtifacts() returned ok:false unexpectedly (${okResult.detail})`);
    if (fs.existsSync(okDir)) problems.push(`confirmed-ok case: ${okDir} still exists after finalizeArtifacts() with ok:true -- should have been deleted`);

    const failDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10b-teardown-selftest-fail-'));
    const failFile = path.join(failDir, 'marker.txt');
    fs.writeFileSync(failFile, 'unconfirmed-case');
    const failResult = finalizeArtifacts({ ok: false, detail: 'synthetic UNCONFIRMED teardown' }, [failDir]);
    if (failResult.ok) problems.push('unconfirmed case: finalizeArtifacts() returned ok:true unexpectedly');
    if (!fs.existsSync(failDir) || !fs.existsSync(failFile)) {
      problems.push(`unconfirmed case: ${failDir} (or its marker file) was deleted -- forensic evidence must be RETAINED on an unconfirmed teardown`);
    }
    if (!failResult.detail.includes(failDir)) {
      problems.push(`unconfirmed case: returned detail does not name the retained path ${failDir}: ${failResult.detail}`);
    }
    // Clean up the retained fixture now that the assertion above has run --
    // this is test cleanup, not the mechanism under test.
    try {
      fs.rmSync(failDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }

    record(
      'TEARDOWN-ARTIFACTS-SELFTEST',
      'finalizeArtifacts() exercised against real on-disk temp directories for both a confirmed-ok and an unconfirmed/failed synthetic teardown result',
      'a confirmed-ok teardown deletes its artifacts; an unconfirmed/failed teardown RETAINS its artifacts and names them in the returned detail',
      problems.length === 0,
      problems.join('\n') || '2/2 fixture cases (confirmed-ok deletes; unconfirmed retains) behaved correctly against real on-disk directories',
      { detail: problems.length === 0 ? undefined : problems.join('; ') },
    );
  });

  // -----------------------------------------------------------------
  // HEAD-DRIFT -- infra check, not a PRD criterion. UNCHANGED.
  // -----------------------------------------------------------------
  const headShaFinal = sh('git', ['rev-parse', 'HEAD']).stdout.trim();
  await checkCriterion('HEAD-DRIFT', () => {
    record(
      'HEAD-DRIFT',
      'git rev-parse HEAD (re-resolved at end)',
      'HEAD must not move during the run',
      headShaFinal === headSha,
      `initial=${headSha} final=${headShaFinal}`,
      { detail: headShaFinal === headSha ? undefined : 'HEAD moved during the run' },
    );
  });

  // -----------------------------------------------------------------
  // Final manifest.
  // -----------------------------------------------------------------
  const treeDirtyResult = sh('git', ['status', '--porcelain=v1']);
  const treeDirty = treeDirtyResult.status !== 0 || treeDirtyResult.stdout.trim().length > 0;
  const finalManifest = {
    wave: 'W10b',
    commit: headSha,
    treeDirty,
    baseCommit,
    gateIntegrityPinned,
    toolchain: { node: process.version, pnpm: sh('pnpm', ['--version']).stdout.trim() },
    criteria: results,
  };
  let manifestWritten = false;
  let manifestSha256 = '';
  try {
    const manifestJson = JSON.stringify(finalManifest, null, 2);
    const tmp = path.join(proofDir, `.manifest.tmp.${process.pid}.json`);
    fs.writeFileSync(tmp, manifestJson);
    fs.renameSync(tmp, path.join(proofDir, 'manifest.json'));
    manifestSha256 = sha256Bytes(manifestJson);
    manifestWritten = true;
  } catch (err) {
    console.error(`verify-w10b: FAILED to write final manifest: ${String(err)}`);
  }

  const nonPassing = results.filter((r) => r.status !== 'pass');
  console.log(
    `\nverify-w10b: ${results.length - nonPassing.length}/${results.length} criteria pass (treeDirty=${treeDirty}, gateIntegrityPinned=${gateIntegrityPinned})`,
  );
  for (const r of results) {
    const label = r.status === 'pass' ? 'PASS' : r.status === 'not-exercised' ? 'N/EX' : 'FAIL';
    console.log(`  [${label}] ${r.id}${r.detail ? ` (${r.detail})` : ''}`);
  }
  if (treeDirty) console.log('  ⚠ tree is dirty: this run is advisory, never a wave pass (VERIFICATION-CONTRACT.md §2)');
  console.log(`MANIFEST_SHA256=${manifestSha256}`);
  console.log(`MANIFEST_PATH=${path.join(proofDir, 'manifest.json')}`);
  process.exit(nonPassing.length === 0 && !treeDirty && manifestWritten ? 0 : 1);
}

main().catch((err) => {
  writeEmergencyManifest(`unhandled error in main(): ${String((err as Error)?.stack ?? err)}`, results);
  process.exit(1);
});
