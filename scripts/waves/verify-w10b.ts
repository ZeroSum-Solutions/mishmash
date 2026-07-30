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
// WIRE-SELFTEST, DAEMON-TEARDOWN, HEAD-DRIFT) pass. The commit-bound proof
// manifest is written to the wave's goal-state proof directory either way,
// per docs/plans/waves/W10b-voicebox-registration.md's "Definition of green".
//
// ROUND-3 (founder-authorized final round, three closures -- deep spread
// ban / scanner fix / GATE-INTEGRITY) and ROUND-4 (runtime-import
// verification, rejected) are recorded in full in the PRD's "Round 3
// adversarial review", "Round 3 verdict" and "Round 4 fix" sections, and
// summarized in this file's own git history. This header covers only
// ROUND 5, which replaces round 4's mechanism wholesale.
//
// ROUND-4 REJECT (why round 4's mechanism had to be replaced, not patched):
// round 4 made C10B-1/2/4 dynamically `import()` a throwaway copy of HEAD's
// committed apps/daemon/src/mcp-config.ts, materialized into a temp `.mts`
// file, then round-trip the matched entry through `JSON.stringify`/
// `JSON.parse` as a ROOT value and compare it to FROZEN. The round-4
// confirmation review found three independent, type-clean bypasses of that
// mechanism, all in the same class (a verifier-owned RECONSTRUCTION of what
// production would serve, rather than an observation of what production
// actually serves):
//   (1) SERIALIZATION CONTEXT. `JSON.stringify` calls `toJSON(key)` with the
//       key the value occupies in its parent -- '' for a root value, but the
//       stringified array index (e.g. '0') for an element of
//       `{ servers, templates: MCP_TEMPLATES }`, which is the actual shape
//       apps/daemon/src/mcp-routes.ts:157's `res.json({ servers: cfg.servers,
//       templates: MCP_TEMPLATES })` serializes. A `toJSON(key)` that
//       special-cases on that key returned FROZEN as a root value (key '')
//       and hostile fields as templates[0] (key '0'), passing every round-4
//       check while the real route would have served the hostile value.
//   (2) SINGLE-READ SNAPSHOT. Every criterion imported a FRESH module and
//       read it ONCE. A stateful getter honest on its first read and hostile
//       on every later one passed, while the daemon holds one imported
//       `MCP_TEMPLATES` instance for its whole process lifetime and would
//       serve the hostile value on every request after the first.
//   (3) TEMP-PATH MODULE IDENTITY. The throwaway import lived at a
//       predictable `verify-w10b-runtime-*` temp path; a
//       `import.meta.url.includes('verify-w10b-runtime-')` probe could
//       distinguish "being read by the verifier" from "being loaded by
//       production" and behave differently only for the verifier.
//
// ROUND-5 FIX (this file, founder-authorized re-expansion round, 2026-07-29):
// the founder's binding correction to the round-4 instruction (recorded in
// docs/plans/waves/DECISIONS.md's W10B-PARK entry) is that a runtime-truth
// claim must ALSO hold (a) in the production serialization CONTEXT, (b) on
// REPEATED reads, and (c) at the module's REAL path. Round 4 tried to keep
// reconstructing those three properties one at a time inside a
// verifier-owned proxy for production (a temp-file import + manual
// JSON.stringify call) -- exactly the "prove RUNTIME truth by inspecting
// SOURCE STRUCTURE" failure class DECISIONS.md names as the root cause of
// every W10-family park (W10a, W10b round 4, W9as), just one layer deeper
// than the AST-freezing rounds 1-3 tried. There is no bound on how many
// layers of proxy-vs-real distinction an adversarial reviewer can find in a
// RECONSTRUCTION; the fix is to stop reconstructing.
//
// C10B-1/2/4 now boot the REAL daemon entrypoint (apps/daemon/src/server.ts,
// completely unmodified) from THIS repository's own working tree, in an
// isolated namespace (fresh OD_DATA_DIR, ephemeral OS-assigned port, its own
// detached process group -- see "RUNTIME SAFETY" below), and issue REAL HTTP
// GET requests to `/api/mcp/servers` -- the exact route
// apps/daemon/src/mcp-routes.ts:151-157 serves, calling the exact
// `res.json({ servers: cfg.servers, templates: MCP_TEMPLATES })` that a real
// browser or `od` CLI invocation would receive. This closes all three
// round-4 bypasses structurally, not by naming them individually:
//   (1) is closed because there is no verifier-reconstructed serialization
//       context anymore -- the response body IS production's real `res.json`
//       output, with `templates` nested exactly where mcp-routes.ts puts it,
//       so a `toJSON(key)` keyed on '0' sees the SAME key production's real
//       serialization would give it, every time.
//   (2) is closed because the daemon process is booted ONCE and stays alive
//       for the run: `observeVoiceboxWireEntryRepeated()` issues MULTIPLE
//       independent HTTP requests against that one long-lived process (three
//       per criterion, times three criteria using it -- nine total reads
//       against one module instance), and every one of them is independently
//       compared to FROZEN. A getter honest only on an early read fails on a
//       later one.
//   (3) is closed because there is no temp path for a probe to key off of --
//       the daemon imports its OWN `./mcp-config.js` from its OWN real
//       location under apps/daemon/src/, exactly as `pnpm tools-dev` boots
//       it. `import.meta.url` inside mcp-config.ts, if anything ever read
//       it, would show this repository's real path, indistinguishable from a
//       genuine `od` launch.
//
// WIRE-SELFTEST (renamed from round 4's RUNTIME-SELFTEST) proves the
// OBSERVATION mechanism itself -- fetch, parse, compare -- correctly flags
// every divergence class (the round-3 __proto__/toJSON vector, an own
// toJSON method, the round-2 spread-override vector, a getter/accessor, a
// post-declaration Object.defineProperty/Object.setPrototypeOf mutation, and
// a dead-branch-lookalike ternary) as a mismatch, and passes a clean entry.
// It builds each fixture as a REAL in-process JS object (Object.create,
// Object.defineProperty, a getter, a spread -- the same mechanisms hostile
// SOURCE would use, applied directly, since JSON.stringify cannot tell the
// difference between an object built inline and one produced by compiling
// and importing a module) and serves it through a real `node:http` server's
// `res.end(JSON.stringify(...))`, nested inside `{ servers, templates }`
// exactly like production, fetched over a real loopback socket -- never
// `JSON.stringify()` called in-process on a bare object with no network
// layer at all (round 4's approach). This is deliberately NOT a claim that
// the fixture objects are equivalent to compiling hostile source through the
// real apps/daemon module graph -- that claim is what C10B-1/2/4 make, using
// the real daemon. WIRE-SELFTEST's only job is proving this file's own
// fetch+parse+compare pipeline has no blind spot, which is a narrower and
// fully honest claim; see the PRD's "Round 5 fix" section for why a
// synthetic in-process HTTP server is sufficient for that narrower claim and
// does not need Express or the real module graph.
//
// C10B-3 and C10B-5 are UNCHANGED from round 4 -- they were not implicated
// in the round-4 reject, and both answer questions with no runtime
// observable (a two-commit TEXT diff; comment-token provenance), which is
// exactly the founder's stated carve-out for keeping a structural/AST check:
// "a structural/AST check may remain only for facts with no runtime
// observable." GATE-INTEGRITY and SCANNER-SELFTEST are also unchanged.
// DAEMON-TEARDOWN is new: a named infra check, mirroring GATE-INTEGRITY's
// "infra check, not a PRD criterion" shape, that must independently confirm
// the isolated daemon's entire process GROUP is empty before the run can be
// green -- see "RUNTIME SAFETY" below.
//
// PORTABILITY: repoRoot comes from `process.cwd()`/`--repo`, never
// `import.meta.url`.
//
// RUNTIME SAFETY (binding constraints of the wave program this run operates
// under -- default-namespace daemons on ports 7456/51012 must never be
// touched): the isolated daemon this file boots is a genuine `detached:
// true` child process with its OWN process group (pgid === its own pid on
// POSIX), receiving its isolated `OD_DATA_DIR`/`OD_BIND_HOST` ONLY through
// that child's own `env` object (a fresh shallow copy of `process.env`,
// never an assignment to this process's own `process.env`), bound to
// `port: 0` (an OS-assigned ephemeral port, independently re-checked against
// FORBIDDEN_PORTS = {7456, 51012} after boot -- boot is refused and torn
// down immediately if the OS ever handed back one of those two exact
// ports). Teardown (`killGroupFailClosed`, adapted from the reference
// implementation in scripts/waves/verify-w9-filesystem.ts) signals the WHOLE
// GROUP by its one known pid (`-pid`, never a broader/fuzzy process match),
// escalates SIGTERM -> SIGKILL only if the group is not empty after a
// bounded wait, and independently RE-SCANS the real system process table
// (`ps`) for any surviving member of that exact group before declaring
// success -- a resolved `exit` event on the tracked leader is never treated
// as proof the whole group exited, because daemon startup can itself spawn
// further children (a fire-and-forget agent-detection probe in
// apps/daemon/src/server.ts) that inherit the group. `ps` scan failure is
// treated as an UNCONFIRMED, non-passing teardown, never as evidence of a
// clean exit. This file never signals or inspects any PID it did not itself
// spawn -- it has no way to name the default-namespace daemons' actual PIDs
// (those are specific to one running machine, not a fact this committed
// script could safely hardcode), so its only mechanism for staying clear of
// them is process-group exactness plus the FORBIDDEN_PORTS refusal, both of
// which are unconditional regardless of what else is running. Git context is
// resolved from local refs only (no fetch/push). WIRE-SELFTEST's synthetic
// HTTP server is in-process (`node:http`, no subprocess, no process group of
// its own) and is torn down with a plain `server.close()`.

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
const SERVER_FILE = 'apps/daemon/src/server.ts';

// Default-namespace daemon ports (binding safety constraint for this run --
// see "RUNTIME SAFETY" above). Never dialed, never bound.
const FORBIDDEN_PORTS = new Set([7456, 51012]);

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
// facts with no runtime observable" -- see the header's ROUND-5 note). Never
// used to validate the frozen fields of the voicebox entry itself -- that is
// C10B-1/2/4's job now, proven against the real booted daemon's real HTTP
// response (see "RUNTIME OBSERVATION" below).
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
// RUNTIME OBSERVATION (round 5). C10B-1/2/4 no longer trust any
// verifier-reconstructed serialization of the voicebox entry -- they boot
// the REAL apps/daemon/src/server.ts, hit the REAL
// GET /api/mcp/servers route, and compare the REAL HTTP response body to
// FROZEN. See the header's ROUND-5 note for the full rationale and how this
// closes all three round-4 bypasses structurally.
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

/** Scans the REAL system process table (never trusts a single leader's
 * `exit` event as proof the whole group is gone) for any process still
 * reporting the given process-group id. Adapted from the reference
 * implementation, scripts/waves/verify-w9-filesystem.ts's
 * `processGroupSurvivors()`. */
function processGroupSurvivors(pgid: number): string[] {
  const r = sh('ps', ['-Ao', 'pid=,pgid=,comm='], { timeoutMs: 15_000 });
  if (r.status !== 0) {
    return [`ps scan itself failed (exit=${r.status}) -- treated as unconfirmed, not as proof of a clean exit`];
  }
  const survivors: string[] = [];
  for (const line of r.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const rowPid = Number(parts[0]);
    const rowPgid = Number(parts[1]);
    if (!Number.isFinite(rowPid) || !Number.isFinite(rowPgid)) continue;
    if (rowPgid === pgid) survivors.push(`pid=${rowPid} pgid=${rowPgid} comm=${parts.slice(2).join(' ')}`);
  }
  return survivors;
}

async function waitForCondition(check: () => boolean, timeoutMs: number, intervalMs = 200): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return check();
}

/** Fail-closed process-GROUP teardown (see "RUNTIME SAFETY" above and the
 * reference implementation, `killGroupFailClosed` in
 * scripts/waves/verify-w9-filesystem.ts, which this is adapted from
 * unchanged in mechanism): escalate on process-group EMPTINESS, never on
 * leader liveness alone. Kills by exact pid only (`-pid`, the group led by
 * that exact pid), never a broader/fuzzy match. Any unconfirmed or partial
 * result is `ok: false`, and every call site below treats that as a FAILURE,
 * never as evidence to route around. */
async function killGroupFailClosed(pid: number): Promise<{ ok: boolean; detail: string }> {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
      return { ok: false, detail: `SIGTERM to group -${pid} failed: ${String(err)}` };
    }
  }
  const emptyAfterTerm = await waitForCondition(() => processGroupSurvivors(pid).length === 0, 8_000);
  if (!emptyAfterTerm) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
        return { ok: false, detail: `SIGKILL to group -${pid} failed: ${String(err)}` };
      }
    }
    const emptyAfterKill = await waitForCondition(() => processGroupSurvivors(pid).length === 0, 5_000);
    if (!emptyAfterKill) {
      const survivors = processGroupSurvivors(pid);
      return {
        ok: false,
        detail: `process group -${pid} still has survivors after SIGTERM+SIGKILL -- teardown NOT confirmed: ${survivors.join('; ')}`,
      };
    }
  }
  const survivors = processGroupSurvivors(pid);
  if (survivors.length > 0) {
    return { ok: false, detail: `process group -${pid} has survivors after kill+wait: ${survivors.join('; ')}` };
  }
  return { ok: true, detail: `process group -${pid} confirmed empty (group-wide ps scan found nothing)` };
}

interface LiveDaemon {
  url: string;
  pid: number;
  shutdown: () => Promise<{ ok: boolean; detail: string }>;
}

type BootResult =
  | { ok: true; daemon: LiveDaemon }
  | { ok: false; error: string; spawnedPid: number | null; teardownIfSpawned: { ok: boolean; detail: string } | null };

/** Boots the REAL, completely unmodified apps/daemon/src/server.ts from this
 * repository's own working tree (never a materialized copy -- see the
 * header's ROUND-5 note on why closing the "temp-path module identity"
 * bypass means NOT reintroducing a temp-path anywhere), as a genuine
 * `detached: true` child process with its own process group, an isolated
 * `OD_DATA_DIR`, and `port: 0` (OS-assigned, independently re-checked
 * against FORBIDDEN_PORTS). Adapted from the reference implementation,
 * `bootIsolatedDaemon()` in scripts/waves/verify-w9-filesystem.ts -- same
 * generated-boot-script mechanism (every dynamic value JSON.stringify'd,
 * never interpolated raw), same `node --check` validation of the generated
 * script, same graceful-SIGTERM handling, same process-group teardown. */
async function bootIsolatedDaemon(): Promise<BootResult> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10b-daemon-data-'));
  const serverTsPath = path.join(repoRoot, SERVER_FILE);
  const marker = crypto.randomBytes(16).toString('hex');
  const bootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w10b-daemon-boot-'));
  const bootScriptPath = path.join(bootDir, 'boot.mjs');
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
    return { ok: false, error: 'daemon-boot child process failed to spawn (no pid)', spawnedPid: null, teardownIfSpawned: null };
  }
  const childPid = child.pid;

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
    try {
      fs.rmSync(bootDir, { recursive: true, force: true });
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup; does not affect the fail-closed teardown verdict */
    }
    return { ok: false, error: reason, spawnedPid: childPid, teardownIfSpawned: teardown };
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
        const result = await killGroupFailClosed(childPid);
        try {
          fs.rmSync(bootDir, { recursive: true, force: true });
          fs.rmSync(dataDir, { recursive: true, force: true });
        } catch {
          /* best-effort cleanup; does not affect the fail-closed teardown verdict */
        }
        return result;
      },
    },
  };
}

// -------------------------------------------------------------------------
// Fail-closed probe fetch: parse + resolve, refuse non-loopback and refuse
// FORBIDDEN_PORTS, redirect:'manual'. Adapted from the reference
// implementation's `safeProbeFetch()`.
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
  return fetch(parsed.toString(), { ...init, redirect: 'manual' });
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

/** Finds every wire-observed array element whose real `.id` property equals
 * 'voicebox' (ordinary JS property access on the JSON.parse'd response --
 * follows the prototype chain exactly like any other reader would, though by
 * this point the value has already round-tripped through the wire once, so
 * any prototype-based trick production ever had is long gone -- this is
 * genuinely the value that left the process). */
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

interface RepeatedObservation {
  ok: boolean;
  error?: string;
  reads: Record<string, unknown>[];
}

/** Issues `n` INDEPENDENT real HTTP reads against the same long-lived
 * `daemonUrl`, each requiring exactly one wire-observed element with
 * id==='voicebox'. This is what closes round-4 bypass (2) -- a getter or
 * counter honest only on an early read fails on a later independent one,
 * because every read here is a fresh network round trip against the SAME
 * module instance the daemon has held since it booted, never a fresh
 * import. */
async function observeVoiceboxWireEntryRepeated(daemonUrl: string, n: number): Promise<RepeatedObservation> {
  const reads: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop -- reads must be sequential,
    // independent round trips against the daemon's one long-lived module
    // instance, not concurrent requests racing each other.
    const wire = await fetchMcpServersWire(daemonUrl);
    if (!wire.ok || !wire.templates) {
      return { ok: false, error: `read #${i + 1}: ${wire.error ?? 'unknown fetch error'}`, reads };
    }
    const matches = findVoiceboxWireEntries(wire.templates);
    if (matches.length !== 1) {
      return {
        ok: false,
        error: `read #${i + 1}: expected exactly 1 wire element with id 'voicebox', found ${matches.length}`,
        reads,
      };
    }
    const entry = matches[0];
    if (!entry) {
      return { ok: false, error: `read #${i + 1}: unreachable -- matches.length===1 but element was falsy`, reads };
    }
    reads.push(entry);
  }
  return { ok: true, reads };
}

// ---------------------------------------------------------------------
// WIRE-SELFTEST fixtures (round 5, replaces round 4's RUNTIME-SELFTEST).
// See the header's WIRE-SELFTEST note for the full rationale: these fixture
// objects are built directly, using the same JS mechanisms (Object.create,
// getters, spreads, post-declaration mutation) hostile SOURCE would use --
// JSON.stringify cannot tell the difference between an object built inline
// here and one produced by compiling and importing a module, so building
// them inline is fully faithful for testing THIS FILE's observation
// pipeline, without reintroducing any temp-file/module-identity mechanism.
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
      // Mirrors round 2's exact vector: frozen direct properties, THEN a
      // later spread that silently wins (JS object literals are
      // last-write-wins).
      return { ...FROZEN, ...{ url: EVIL_FIELDS.url, authMode: EVIL_FIELDS.authMode } };
    case 'getter-accessor-override': {
      const { url: _unused, ...rest } = FROZEN;
      return Object.defineProperty({ ...rest }, 'url', {
        get: () => EVIL_FIELDS.url,
        enumerable: true,
        configurable: true,
      });
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

/** Serves `entry` nested inside `{ servers: [], templates: [entry] }` --
 * matching production's exact shape at apps/daemon/src/mcp-routes.ts:157 --
 * from a genuine in-process `node:http` server, then fetches it TWICE over a
 * real loopback socket through the exact same `fetchMcpServersWire()` /
 * `findVoiceboxWireEntries()` / `compareFrozenFields()` pipeline C10B-1/2/4
 * use. In-process (no subprocess, no process group) because the fixtures
 * never claim to BE production -- see the header's WIRE-SELFTEST note. */
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
    const observation = await observeVoiceboxWireEntryRepeated(url, 2);
    if (!observation.ok) {
      return { name, ok: false, detail: `fixture fetch failed: ${observation.error}` };
    }
    const frozenKeys = Object.keys(FROZEN).sort();
    const perReadProblems = observation.reads.map((read) => {
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
// loop -- see SCANNER-SELFTEST below.
// ---------------------------------------------------------------------
const COMMENT_LIKE_PATTERN = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/** Exact `[start,end)` span of every string/template-piece/regex literal
 * token in the file, as determined by the real parser -- template
 * substitution boundaries included, correctly, because the parser (not a
 * hand-rolled re-scan) resolved them. */
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

/** All real comments in a file. A comment-shaped regex match is discarded
 * unless its start position falls OUTSIDE every literal token span the
 * parser found -- so text inside a template literal (including the tail
 * following a `${...}` substitution) can never be misread as a comment,
 * regardless of what it looks like. */
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
  // DAEMON-TEARDOWN below. Sharing one long-lived instance across all three
  // criteria is intentional, not an efficiency shortcut: it is what makes
  // "the daemon holds one module instance across many requests" (the exact
  // production property round-4 bypass (2) exploited the absence of)
  // actually true of this run, rather than merely asserted by naming three
  // criteria "independent." See the header's ROUND-5 note.
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
    const observation = await observeVoiceboxWireEntryRepeated(liveDaemon.url, 3);
    if (!observation.ok) {
      record(
        id,
        `GET ${liveDaemon.url}/api/mcp/servers (repeated, real HTTP)`,
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
      `GET ${liveDaemon.url}/api/mcp/servers (3 independent real HTTP reads against the one isolated daemon instance)`,
      assertion,
      allProblems.length === 0,
      allProblems.join('\n') ||
        `all ${observation.reads.length} wire reads matched FROZEN exactly: ${JSON.stringify(observation.reads[0])}`,
      { detail: allProblems.length === 0 ? undefined : allProblems.join('; ') },
    );
  }

  // -----------------------------------------------------------------
  // C10B-1 -- registration present, proven at RUNTIME against the REAL
  // booted daemon's REAL GET /api/mcp/servers response, read 3 independent
  // times. Requires exactly one wire element per read whose id ===
  // 'voicebox', and that read's own-key set to be EXACTLY FROZEN's key set.
  // -----------------------------------------------------------------
  await checkCriterion('C10B-1', () =>
    recordDaemonBoundCriterion(
      'C10B-1',
      "exactly one wire-observed element has id === 'voicebox' on every one of 3 independent real HTTP reads, and each read's own-key set is exactly FROZEN's key set -- no more, no fewer",
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
  // DAEMON-TEARDOWN -- infra check, not a PRD criterion (mirrors
  // GATE-INTEGRITY's "infra check" shape). Binding safety constraint for
  // this run: a failed or partial teardown FAILS the run. If the daemon
  // never finished booting, nothing was left running either way -- recorded
  // as `not-exercised`, never a vacuous `pass`.
  // -----------------------------------------------------------------
  await checkCriterion('DAEMON-TEARDOWN', async () => {
    if (boot.ok) {
      const teardown = await boot.daemon.shutdown();
      record(
        'DAEMON-TEARDOWN',
        'killGroupFailClosed(pid) -- SIGTERM the process group, poll for group emptiness, escalate to SIGKILL, re-scan ps before declaring success',
        "the isolated daemon's entire process group is confirmed empty after teardown",
        teardown.ok,
        teardown.detail,
        { detail: teardown.ok ? undefined : teardown.detail },
      );
      return;
    }
    if (boot.spawnedPid !== null) {
      // Boot spawned a process but never became ready; bootIsolatedDaemon()
      // already ran killGroupFailClosed() internally on that failure path
      // (see `failBoot()`) -- report that real teardown result here rather
      // than re-deriving it, since a process genuinely was spawned and
      // needed cleanup.
      const teardown = boot.teardownIfSpawned;
      record(
        'DAEMON-TEARDOWN',
        'killGroupFailClosed(pid), run inside bootIsolatedDaemon()\'s own failure path',
        "the isolated daemon's entire process group is confirmed empty after teardown, even though boot itself never became ready",
        teardown?.ok === true,
        teardown?.detail ?? 'no teardown result recorded for a spawned pid -- treated as unconfirmed',
        { detail: teardown?.ok === true ? undefined : (teardown?.detail ?? 'unconfirmed teardown after a spawned pid') },
      );
      return;
    }
    // spawn() itself never produced a pid -- genuinely nothing was ever
    // running, so there is nothing to have leaked. Distinct from `pass`:
    // the mechanism was not exercised this run.
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
  // C10B-3 -- no extra surface added (round-1 findings 1-3, round-3
  // finding 1 + ruling): UNCHANGED from round 4 -- see the header's
  // ROUND-5 note on why this stays AST/text-based.
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
  // C10B-5 -- documentation record: UNCHANGED from round 4.
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
  // GATE-INTEGRITY -- infra check, not a PRD criterion. UNCHANGED from
  // round 3/4. Defense in depth: self-hashes the file currently executing
  // and compares against an orchestrator-placed approved-gate.sha256. The
  // PRIMARY control remains C10B-3's lease-subset check.
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
    const approvedHashPath = path.join(os.homedir(), '.claude', 'goal-state', WAVE_SLUG, 'approved-gate.sha256');
    if (!gateIntegrityPinned) {
      record(
        'GATE-INTEGRITY',
        '',
        'defense-in-depth self-hash check',
        true,
        `sha256: ${selfSha256}\nUNPINNED -- no approved-gate.sha256 present. This file is not tamper-protected by this specific check until the orchestrator pins one post-approval; see manifest.gateIntegrityPinned=false. C10B-3's lease-subset check is the primary control regardless.`,
      );
      return;
    }
    const approved = fs.readFileSync(approvedHashPath, 'utf8').trim();
    const gateOk = approved === selfSha256;
    record('GATE-INTEGRITY', '', 'defense-in-depth self-hash check', gateOk, `sha256: ${selfSha256}\napproved: ${approved}\nPINNED`, {
      detail: gateOk ? undefined : 'verify-w10b.ts modified since orchestrator approval',
    });
  });

  // -----------------------------------------------------------------
  // SCANNER-SELFTEST -- infra check, not a PRD criterion. UNCHANGED from
  // round 3.
  // -----------------------------------------------------------------
  await checkCriterion('SCANNER-SELFTEST', () => {
    const cases: Array<{ name: string; source: string; expectNm25Comments: string[] }> = [
      {
        name: 'real-line-comment',
        source: 'const x = 1; // NM-25\n',
        expectNm25Comments: ['// NM-25'],
      },
      {
        name: 'real-block-comment',
        source: 'const x = 1; /* NM-25 */\n',
        expectNm25Comments: ['/* NM-25 */'],
      },
      {
        name: 'template-tail-after-substitution-line-comment-lookalike (round-2 false-positive)',
        source: 'const x = `${0}// NM-25`;\n',
        expectNm25Comments: [],
      },
      {
        name: 'template-tail-after-substitution-block-comment-lookalike (round-2 false-positive)',
        source: 'const x = `before ${0} /* NM-25 */ after`;\n',
        expectNm25Comments: [],
      },
      {
        name: 'no-substitution-template-literal-text',
        source: 'const x = `// NM-25`;\n',
        expectNm25Comments: [],
      },
      {
        name: 'plain-string-literal-text',
        source: "const x = 'NM-25 inside a plain string, not a comment';\n",
        expectNm25Comments: [],
      },
      {
        name: 'real-comment-immediately-after-a-template-literal',
        source: 'const x = `${0}`; // NM-25\n',
        expectNm25Comments: ['// NM-25'],
      },
      {
        name: 'nested-template-substitution-with-comment-lookalike-in-inner-tail',
        source: 'const x = `${`${0}// NM-25`}`;\n',
        expectNm25Comments: [],
      },
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
  // WIRE-SELFTEST -- infra check, not a PRD criterion (round 5, replaces
  // round 4's RUNTIME-SELFTEST). See the header's WIRE-SELFTEST note for
  // the full mechanism and rationale. Proves this file's own
  // fetch+parse+compare pipeline correctly passes a clean entry and
  // correctly DETECTS every named mutation-probe divergence vector over a
  // real loopback HTTP round trip.
  // -----------------------------------------------------------------
  await checkCriterion('WIRE-SELFTEST', async () => {
    const cases: Array<{ name: string; kind: FixtureKind; expectClean: boolean }> = [
      { name: 'clean-legitimate-entry', kind: 'clean-legitimate-entry', expectClean: true },
      {
        name: 'round3-proto-inherited-tojson (the exact round-3 REJECT vector)',
        kind: 'proto-inherited-tojson',
        expectClean: false,
      },
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
      // and closes it before the next starts, so there is no benefit to
      // parallelizing and it keeps failure attribution unambiguous.
      const outcome = await runOneWireSelftestCase(c.name, c.kind, c.expectClean);
      outcomes.push(outcome);
    }
    const failures = outcomes.filter((o) => !o.ok);
    record(
      'WIRE-SELFTEST',
      'in-process node:http fixture cases: serve a synthetic { servers: [], templates: [entry] } body exactly like mcp-routes.ts:157, fetch it twice over real loopback HTTP through the exact fetchMcpServersWire()/findVoiceboxWireEntries()/compareFrozenFields() pipeline C10B-1/2/4 use',
      'the wire-observation mechanism correctly passes a clean legitimate entry and correctly DETECTS every named divergence vector as a mismatch over the wire (no false green): __proto__/inherited toJSON (the round-3 vector), an own toJSON method, a property spread overriding earlier fields (round-2 regression), a getter/accessor, a post-declaration Object.defineProperty mutation, a post-declaration Object.setPrototypeOf mutation, and a dead-branch-lookalike conditional',
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
