// Dispatch-time routing integration -- SERVER-LEVEL coverage (WR wave, P2
// tranche, t9 -- plan docs/plans/2026-08-05-model-routing-system.md §3.1
// binding point). apps/daemon/tests/routing-dispatch.test.ts already covers
// apps/daemon/src/routing/dispatch.ts's pure functions directly; THIS file
// proves the additive server.ts wiring (startChatRun's pre-spawn
// resolveDispatchRouting/recordDispatchIntent hook + onRunFinished's
// reconcilePostRun hook) actually fires on a REAL POST /api/chat request
// through a REAL booted daemon (`startServer`), the same pattern
// chat-route.test.ts already establishes (PATH-overlaid fake agent binary,
// no mocks/ replay corpus needed for a plain success run).
//
// Four round trips:
//   1. An explicit `routingOverride` naming a REAL (model, lane) pair the
//      shipped routing-policy.json actually vets for runtime 'claude'
//      (claude-haiku-4-5 / claude-code-oauth, the 'mechanical-batch' row) --
//      proves 'override' mode reaches the wire, vetted (HIGH-2) and
//      same-runtime (HIGH-1), end to end over HTTP.
//   2. A plain request with no override (proves WR-routing.md Fallback B's
//      'runtime-default' mode -- the ONLY mode a real /api/chat request can
//      reach today without an override, since ChatRequest carries no
//      templateId/buildClass/taskClass; see dispatch.ts's own header for the
//      governance gap this reflects).
//   3. An override naming an unresolvable (model, lane) pair (Sol review
//      MED-4) -- proves a BLOCKED dispatch finalizes the SSE/status stream
//      cleanly (`'failed'`, not stuck `'running'`), never spawns the fake
//      agent binary at all, and never leaves an orphan run row.
//   4. A REAL same-run retry (attempt 0 fails with a cooldown-recordable
//      'upstream_unavailable' category, attempt 1 succeeds) driven through
//      the live daemon's actual retry runtime (apps/daemon/tests/
//      run-retry-runtime.test.ts's `writeFlakyClaude` fixture shape) --
//      proves Sol review MED-5's retry-attempt-boundary reconcilePostRun
//      call (server.ts's `finishWithRetryDecision`) actually records the
//      failed attempt's cooldown BEFORE the retry is scheduled, and MED-6's
//      terminal `onFinalize` reconcile then clears it once the retry
//      succeeds -- in that order, not the reverse.
//
// Round trips 1-2 also assert the pre-spawn ROUTED telemetry row via this
// wave's own GET /api/routing/telemetry, and that the OBSERVED side gets
// filled in once the run reports back (reconcilePostRun).

import type http from 'node:http';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { StoredRoutingTelemetryRow } from '@open-design/contracts';

import { startServer } from '../src/server.js';
import { getCooldownRecord } from '../src/routing/reliability.js';

async function withFakeAgentBin<T>(binName: string, script: string, run: () => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'od-routing-dispatch-bin-'));
  const oldPath = process.env.PATH;
  try {
    const bin = join(dir, binName);
    await fsp.writeFile(bin, `#!/usr/bin/env node\n${script}`);
    await fsp.chmod(bin, 0o755);
    process.env.PATH = `${dir}${delimiter}${oldPath ?? ''}`;
    return await run();
  } finally {
    process.env.PATH = oldPath;
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

const OPENCODE_SUCCESS_SCRIPT = `
console.log(JSON.stringify({ type: 'step_start', sessionID: 'routing-dispatch-session' }));
console.log(JSON.stringify({ type: 'text', sessionID: 'routing-dispatch-session', part: { text: 'hello from the fake agent' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { tokens: { input: 5, output: 5 } } }));
process.exit(0);
`;

// Sol review H1 residue: the override server test previously only asserted
// the TELEMETRY row's routedModel, which proves resolveDispatchRouting
// decided correctly but NOT that the decision actually reached the real
// spawn's argv -- a regression in server.ts's `safeModel = ...;
// agentOptions.model = safeModel;` wiring (the exact HIGH-1 bug this fix
// round closed) could silently spawn the runtime's OWN default model while
// telemetry still reported the override, and this test would not catch it.
// This variant of the success script writes its own real invocation argv
// (apps/daemon/src/runtimes/defs/claude.ts's buildArgs pushes `['--model',
// options.model]` onto the real CLI args) to a file the test reads AFTER
// the run finishes, so the assertion is against what the CHILD PROCESS was
// actually invoked with, not against a layer that could diverge from it.
function claudeSuccessScriptRecordingArgv(argvLogPath: string): string {
  return `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(argvLogPath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', model: 'fake-claude-model', session_id: 'routing-dispatch-claude-session' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'text', text: 'hello from the fake claude agent' }], stop_reason: 'end_turn' } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'routing-dispatch-claude-session', usage: { input_tokens: 5, output_tokens: 5 }, total_cost_usd: 0.001, duration_ms: 10 }) + '\\n');
setTimeout(() => process.exit(0), 20);
`;
}

// Sol review MED-5/MED-6: a STATEFUL fake claude binary -- unlike the two
// scripts above, this one must behave differently across the SAME run's two
// spawns (fail transiently, then succeed on retry). Mirrors apps/daemon/
// tests/run-retry-runtime.test.ts's `writeFlakyClaude` fixture exactly: a
// `HTTP 503` stderr line + exit 1 on the first invocation classifies as
// `upstream_unavailable`/`upstream_5xx` (run-failure-classification.ts),
// which IS in dispatch.ts's `COOLDOWN_RECORDABLE_FAILURE_CATEGORIES` and
// IS retried by run-retry-policy.ts's transient-failure policy; a clean
// stream-json success on the second invocation ends the run 'succeeded'.
// A counter file on disk (not a closure variable -- each invocation is a
// separate process) tracks which attempt this is.
async function withFlakyClaudeBin<T>(run: () => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'od-routing-dispatch-flaky-bin-'));
  const oldPath = process.env.PATH;
  try {
    const bin = join(dir, 'claude');
    const counterPath = join(dir, 'claude-attempts');
    await fsp.writeFile(
      bin,
      `#!/usr/bin/env node
const fs = require('node:fs');
const counterPath = ${JSON.stringify(counterPath)};
if (process.argv.includes('--version')) { console.log('claude-code 1.0.0-cooldown-retry'); process.exit(0); }
if (process.argv.includes('--help')) { console.log('Usage: claude -p'); process.exit(0); }
if (process.argv.includes('auth')) { console.log('Logged in (fixture)'); process.exit(0); }
let attempts = 0;
try { attempts = Number(fs.readFileSync(counterPath, 'utf8')) || 0; } catch {}
fs.writeFileSync(counterPath, String(attempts + 1));
if (attempts === 0) {
  process.stderr.write('HTTP 503 Service Unavailable: upstream provider unavailable before first token.\\n');
  setTimeout(() => process.exit(1), 20);
} else {
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-cooldown-retry', session_id: 'routing-cooldown-session' }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'text', text: 'Recovered after retry.' }], stop_reason: 'end_turn' } }) + '\\n');
  setTimeout(() => process.exit(0), 20);
}
`,
    );
    await fsp.chmod(bin, 0o755);
    process.env.PATH = `${dir}${delimiter}${oldPath ?? ''}`;
    return await run();
  } finally {
    process.env.PATH = oldPath;
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

// Sol review MED-6: unlike `withFlakyClaudeBin` (fails once, then succeeds),
// this fixture ALWAYS fails the same cooldown-recordable way -- attempt 0
// is retried once (run-retry-policy.ts's DEFAULT_SAFE_RUN_RETRY_MAX_ATTEMPTS
// = 1), attempt 1's identical failure hits the retry cap and becomes the
// run's real TERMINAL failure. Exactly two cooldown-recording events should
// ever fire for this run: the MED-5 retry-attempt-boundary call (attempt 0)
// and the MED-6 terminal onFinalize call (attempt 1) -- proving the
// terminal finalizer installs (and fires) exactly once, not once per retry
// re-entry.
async function withAlwaysFailingClaudeBin<T>(run: () => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'od-routing-dispatch-alwaysfail-bin-'));
  const oldPath = process.env.PATH;
  try {
    const bin = join(dir, 'claude');
    await fsp.writeFile(
      bin,
      `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('claude-code 1.0.0-always-fail'); process.exit(0); }
if (process.argv.includes('--help')) { console.log('Usage: claude -p'); process.exit(0); }
if (process.argv.includes('auth')) { console.log('Logged in (fixture)'); process.exit(0); }
process.stderr.write('HTTP 503 Service Unavailable: upstream provider unavailable before first token.\\n');
setTimeout(() => process.exit(1), 20);
`,
    );
    await fsp.chmod(bin, 0o755);
    process.env.PATH = `${dir}${delimiter}${oldPath ?? ''}`;
    return await run();
  } finally {
    process.env.PATH = oldPath;
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

// Sol review M5 residue: attempt 0 emits REAL usage (an opencode
// step_finish frame with token counts) before failing; attempt 1 emits NO
// usage at all and succeeds. Proves the terminal reconcile's usage snapshot
// is scoped to events AFTER the retry-boundary offset -- without that
// scoping, attempt 1's telemetry row would inherit attempt 0's token counts
// from the shared event ring instead of reporting its own (null/zero)
// observed usage.
//
// Uses OPENCODE, not claude, for a structural reason discovered while
// building this fixture: claude-stream.ts's ONLY source of a `usage` event
// is the CLI's single terminal `result` frame, and that frame's `is_error`
// flag is dual-purpose -- `is_error:false` marks the turn CLEANLY completed
// (`applyClaudeStreamJsonRunBookkeeping`'s `turnCompletedCleanly`, which
// makes `classifyChatRunCloseStatus` report 'succeeded' regardless of a
// later nonzero exit), while `is_error:true` emits a terminal, ALWAYS
// non-retryable `AGENT_EXECUTION_FAILED` error event -- so a claude fixture
// can never emit real usage on an attempt that ALSO ends up both 'failed'
// AND retryable. OpenCode's json-event-stream.ts, by contrast, emits
// `step_finish`'s `usage` event as an ordinary progress signal decoupled
// from turn-completion/error semantics (mirrors apps/daemon/tests/
// run-retry-runtime.test.ts's own `writeStreamErrorThenSuccessfulOpenCode`
// retryable-opencode-failure shape, here with usage added to attempt 0).
async function withUsageThenEmptyRetryOpencodeBin<T>(run: () => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'od-routing-dispatch-usage-offset-bin-'));
  const oldPath = process.env.PATH;
  try {
    const bin = join(dir, 'opencode');
    const counterPath = join(dir, 'opencode-attempts');
    await fsp.writeFile(
      bin,
      `#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
const counterPath = ${JSON.stringify(counterPath)};
if (argv.includes('--version')) { console.log('1.17.7'); process.exit(0); }
if (argv.includes('--help')) { console.log('opencode run [message..]'); process.exit(0); }
if (argv[0] === 'models') { console.log('anthropic/claude-sonnet-4-5'); process.exit(0); }
let attempts = 0;
try { attempts = Number(fs.readFileSync(counterPath, 'utf8')) || 0; } catch {}
fs.writeFileSync(counterPath, String(attempts + 1));
if (attempts === 0) {
  // Deliberately NO 'text' frame here: run-retry-policy.ts's
  // decideSafeRunRetry suppresses same-run retry once the user has seen
  // ANY visible output (sideEffects.userVisibleOutputSeen), regardless of
  // how retryable the failure category itself is. step_finish's usage
  // signal is decoupled from visible text, so real token counts can still
  // be reported without tripping that guard.
  console.log(JSON.stringify({ type: 'step_start', sessionID: 'usage-offset-session-0' }));
  console.log(JSON.stringify({ type: 'step_finish', sessionID: 'usage-offset-session-0', part: { tokens: { input: 40, output: 15, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.002 } }));
  console.log(JSON.stringify({ type: 'error', error: { data: { message: 'synthetic upstream drop' } } }));
  setTimeout(() => process.exit(1), 20);
} else {
  console.log(JSON.stringify({ type: 'step_start', sessionID: 'usage-offset-session-1' }));
  console.log(JSON.stringify({ type: 'text', sessionID: 'usage-offset-session-1', part: { text: 'Recovered, no usage reported this attempt.' } }));
  setTimeout(() => process.exit(0), 20);
}
`,
    );
    await fsp.chmod(bin, 0o755);
    process.env.PATH = `${dir}${delimiter}${oldPath ?? ''}`;
    return await run();
  } finally {
    process.env.PATH = oldPath;
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

// Sol review M5 residue (fix-round 2): `run.events` is a BOUNDED ring
// (runtimes/runs.ts's `emit()` splices from the front once it exceeds
// `maxEvents` = 2000) -- an array-index/length snapshot silently drifts
// once real eviction happens between the retry boundary and the terminal
// reconcile, since every later element's POSITION shifts but a stored
// index does not know that.
//
// This fixture is deliberately shaped to DISCRIMINATE the two designs, not
// merely exercise the code path: attempt 0 emits ~1000 events of its own
// (inflating the array-index/length value an offset-based design would
// have stored) before reporting usage and failing; attempt 1 reports its
// OWN distinct usage IMMEDIATELY (before any filler), then emits ~1200
// trailing filler -- enough that total events comfortably exceed 2000 (so
// the ring genuinely evicts attempt 0's entire history) while attempt 1's
// early usage frame still lands within the surviving ~2000-event window
// (so it is not itself evicted). A stale array-index snapshot, taken
// BEFORE eviction, is now too LARGE relative to the post-eviction array
// (which no longer contains attempt 0 at all) -- `.slice(thatStaleIndex)`
// would skip past attempt 1's own early usage frame entirely, reporting
// null/zero. The id-based design (each event's `.id` is stamped at push
// time and never renumbered by eviction) finds it correctly regardless.
async function withRingEvictingRetryOpencodeBin<T>(run: () => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'od-routing-dispatch-ring-evict-bin-'));
  const oldPath = process.env.PATH;
  try {
    const bin = join(dir, 'opencode');
    const counterPath = join(dir, 'opencode-attempts');
    await fsp.writeFile(
      bin,
      `#!/usr/bin/env node
const fs = require('node:fs');
const argv = process.argv.slice(2);
const counterPath = ${JSON.stringify(counterPath)};
if (argv.includes('--version')) { console.log('1.17.7'); process.exit(0); }
if (argv.includes('--help')) { console.log('opencode run [message..]'); process.exit(0); }
if (argv[0] === 'models') { console.log('anthropic/claude-sonnet-4-5'); process.exit(0); }
let attempts = 0;
try { attempts = Number(fs.readFileSync(counterPath, 'utf8')) || 0; } catch {}
fs.writeFileSync(counterPath, String(attempts + 1));
if (attempts === 0) {
  // ~1000 events of its own BEFORE failing -- inflates whatever
  // array-index/length value a (buggy) offset-based design would have
  // stored at the retry boundary.
  for (let i = 0; i < 1000; i++) {
    console.log(JSON.stringify({ type: 'step_start', sessionID: 'ring-evict-attempt0-filler-' + i }));
  }
  console.log(JSON.stringify({ type: 'step_finish', sessionID: 'ring-evict-session-0', part: { tokens: { input: 40, output: 15, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.002 } }));
  console.log(JSON.stringify({ type: 'error', error: { data: { message: 'synthetic upstream drop' } } }));
  setTimeout(() => process.exit(1), 20);
} else {
  // Reports its OWN usage IMMEDIATELY -- before any filler -- so this
  // frame sits early in attempt 1's own event range. It must survive
  // physical eviction (fewer than maxEvents=2000 events may follow it)
  // while still landing inside the zone a stale attempt-0-sized offset
  // would wrongly skip.
  console.log(JSON.stringify({ type: 'step_start', sessionID: 'ring-evict-session-1' }));
  console.log(JSON.stringify({ type: 'step_finish', sessionID: 'ring-evict-session-1', part: { tokens: { input: 7, output: 3, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.0005 } }));
  // Attempt 0 ALONE already exceeds maxEvents=2000 (empirically confirmed:
  // its own ~1000 script lines produce ~2007 internal events, each real
  // frame fanning out into more than one daemon-side event) -- the ring is
  // ALREADY at its cap by the time attempt 1 starts, so every event
  // attempt 1 pushes evicts one of attempt 0's from the front on a 1:1
  // basis. A modest trailing filler is enough to demonstrate "activity
  // after the usage frame" without pushing attempt 1's OWN early usage
  // frame back out of the (fixed-size) surviving window itself.
  for (let i = 0; i < 50; i++) {
    console.log(JSON.stringify({ type: 'step_start', sessionID: 'ring-evict-attempt1-filler-' + i }));
  }
  // A real text frame: without any visible assistant output, the daemon's
  // own empty-answer safety net classifies this as a FAILED
  // (empty_output) attempt despite exit(0), defeating this fixture's
  // point entirely (it needs attempt 1 to genuinely SUCCEED).
  console.log(JSON.stringify({ type: 'text', sessionID: 'ring-evict-session-1', part: { text: 'Recovered after the ring evicted attempt 0.' } }));
  setTimeout(() => process.exit(0), 20);
}
`,
    );
    await fsp.chmod(bin, 0o755);
    process.env.PATH = `${dir}${delimiter}${oldPath ?? ''}`;
    return await run();
  } finally {
    process.env.PATH = oldPath;
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

describe('dispatch-time routing wiring in the real chat dispatch path', () => {
  let server: http.Server;
  let baseUrl: string;
  const originalPath = process.env.PATH;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterEach(() => {
    if (originalPath == null) delete process.env.PATH;
    else process.env.PATH = originalPath;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function createProject(): Promise<string> {
    const projectId = `proj-routing-dispatch-${randomUUID()}`;
    const createResponse = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: 'Routing dispatch server test fixture', skillId: null, designSystemId: null }),
    });
    expect(createResponse.status).toBe(200);
    return projectId;
  }

  // The ENTIRE request/response lifecycle (fetch + draining the SSE body via
  // .text()) must run INSIDE withFakeAgentBin's PATH-scoped callback, not
  // just the fetch() call: fetch() resolves as soon as response headers
  // arrive (design.runs.stream starts the SSE response immediately), while
  // the actual agent spawn/PATH resolution happens ASYNCHRONOUSLY
  // afterward, while the body is still streaming. Resetting PATH right
  // after fetch() resolves (before the body finishes) would race the real
  // spawn attempt off of PATH entirely.
  async function runChat(
    agentId: string,
    binName: string,
    script: string,
    projectId: string,
    conversationId: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    return withFakeAgentBin(binName, script, async () => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // A `projectId` is REQUIRED for server.ts's onRunFinished hook (usage
        // tracking AND this wave's reconcilePostRun addition both live behind
        // its `if (!run.projectId || !run.id) return;` guard) to run at all.
        body: JSON.stringify({ agentId, projectId, conversationId, message: 'hello', ...body }),
      });
      expect(response.ok).toBe(true);
      return response.text();
    });
  }

  async function getRunRow(conversationId: string): Promise<{ id: string; status: string; errorCode: string | null }> {
    const runsResponse = await fetch(`${baseUrl}/api/runs?conversationId=${encodeURIComponent(conversationId)}`);
    const runsBody = (await runsResponse.json()) as {
      runs: Array<{ id: string; status: string; errorCode: string | null }>;
    };
    expect(runsBody.runs).toHaveLength(1);
    return runsBody.runs[0]!;
  }

  it('records a routed-vs-observed telemetry row for an explicit routingOverride naming a REAL, vetted (model, lane) pair, end to end over HTTP', async () => {
    const projectId = await createProject();
    const conversationId = `conv-routing-override-${randomUUID()}`;
    const argvLogDir = await fsp.mkdtemp(join(tmpdir(), 'od-routing-dispatch-argv-'));
    const argvLogPath = join(argvLogDir, 'claude-argv.json');
    let text: string;
    try {
      text = await runChat(
        'claude',
        'claude',
        claudeSuccessScriptRecordingArgv(argvLogPath),
        projectId,
        conversationId,
        {
          // claude-haiku-4-5 / claude-code-oauth is the shipped policy's
          // 'mechanical-batch' row primary -- a REAL candidate with runtimeId
          // 'claude', matching this request's own agentId (HIGH-1's same-
          // runtime requirement) and passing §15/allowlist/admission (HIGH-2).
          routingOverride: { model: 'claude-haiku-4-5', lane: 'claude-code-oauth', reason: 'server-level override test' },
        },
      );
      expect(text).toContain('"status":"succeeded"');

      // Sol review H1 residue: assert the REAL spawn's argv, not telemetry --
      // the fake agent recorded exactly what it was invoked with.
      const spawnedArgv = JSON.parse(await fsp.readFile(argvLogPath, 'utf8')) as string[];
      const modelFlagIndex = spawnedArgv.indexOf('--model');
      expect(modelFlagIndex).toBeGreaterThanOrEqual(0);
      expect(spawnedArgv[modelFlagIndex + 1]).toBe('claude-haiku-4-5');
    } finally {
      await fsp.rm(argvLogDir, { recursive: true, force: true });
    }

    const run = await getRunRow(conversationId);
    expect(run.status).toBe('succeeded');

    const telemetryResponse = await fetch(`${baseUrl}/api/routing/telemetry?runId=${encodeURIComponent(run.id)}`);
    expect(telemetryResponse.status).toBe(200);
    const telemetryBody = (await telemetryResponse.json()) as { rows: StoredRoutingTelemetryRow[] };
    expect(telemetryBody.rows).toHaveLength(1);
    const row = telemetryBody.rows[0]!;
    // Pre-spawn ROUTED side: the vetted override, not the claude runtime default.
    expect(row.routedModel).toBe('claude-haiku-4-5');
    expect(row.routedLane).toBe('claude-code-oauth');
    // Post-run OBSERVED side: reconcilePostRun (server.ts's onRunFinished
    // hook) filled it in once the run reported back.
    expect(row.observedModel).not.toBeNull();
  });

  it('records a runtime-default telemetry row for a plain chat request with no override or taskClass (WR-routing.md Fallback B)', async () => {
    const projectId = await createProject();
    const conversationId = `conv-routing-default-${randomUUID()}`;
    const text = await runChat('opencode', 'opencode', OPENCODE_SUCCESS_SCRIPT, projectId, conversationId, {});
    expect(text).toContain('"status":"succeeded"');
    const run = await getRunRow(conversationId);
    expect(run.status).toBe('succeeded');

    const telemetryResponse = await fetch(`${baseUrl}/api/routing/telemetry?runId=${encodeURIComponent(run.id)}`);
    expect(telemetryResponse.status).toBe(200);
    const telemetryBody = (await telemetryResponse.json()) as { rows: StoredRoutingTelemetryRow[] };
    expect(telemetryBody.rows).toHaveLength(1);
    const row = telemetryBody.rows[0]!;
    expect(row.routedLane).toBe('runtime-default');
    expect(row.stage).toBe('chat');
  });

  // Sol review M7 residue (write-path defense in depth): a raw,
  // traversal-shaped `projectId` on the /api/chat request body must never
  // reach the routing_telemetry row's own `projectId` column -- server.ts's
  // dispatch hook now validates with the SAME `isSafeId` single-path-segment
  // check `resolveProjectDir`/`ensureProject` (apps/daemon/src/projects.ts)
  // already enforce before ever writing to disk, falling back to a safe
  // sentinel instead of persisting the unvalidated string. This is additive
  // to (not a replacement for) POST /api/routing/gates/run's own read-time
  // isSafeId check on whatever a telemetry row already contains.
  it('sanitizes a traversal-shaped raw projectId before it ever reaches the telemetry row (Sol review M7 residue)', async () => {
    const conversationId = `conv-routing-projectid-traversal-${randomUUID()}`;
    const text = await runChat('opencode', 'opencode', OPENCODE_SUCCESS_SCRIPT, '../../../tmp', conversationId, {});
    expect(text).toContain('"status":"succeeded"');
    const run = await getRunRow(conversationId);
    expect(run.status).toBe('succeeded');

    const telemetryResponse = await fetch(`${baseUrl}/api/routing/telemetry?runId=${encodeURIComponent(run.id)}`);
    expect(telemetryResponse.status).toBe(200);
    const telemetryBody = (await telemetryResponse.json()) as { rows: StoredRoutingTelemetryRow[] };
    expect(telemetryBody.rows).toHaveLength(1);
    const row = telemetryBody.rows[0]!;
    expect(row.projectId).not.toBe('../../../tmp');
    expect(row.projectId).not.toContain('..');
  });

  // Sol review MED-4: a blocked dispatch must finalize the SSE/status
  // stream CLEANLY -- 'failed', not stuck 'running' or orphaned -- and must
  // never spawn the underlying agent binary at all. The opencode fake agent
  // is registered on PATH but its distinguishing success marker
  // ('hello from the fake agent') must never appear anywhere in the
  // response, proving the spawn never happened.
  it('a BLOCKED dispatch (unresolvable override) finalizes cleanly with no spawn and no orphan run row', async () => {
    const projectId = await createProject();
    const conversationId = `conv-routing-blocked-${randomUUID()}`;
    const text = await runChat('opencode', 'opencode', OPENCODE_SUCCESS_SCRIPT, projectId, conversationId, {
      routingOverride: { model: 'totally-unrecognized-model-xyz', lane: 'openrouter', reason: 'test' },
    });
    expect(text).not.toContain('hello from the fake agent');
    expect(text).toContain('"status":"failed"');
    // Amendment 2, item 1: policy refusal is ROUTING_BLOCKED, not FORBIDDEN.
    // The caller IS entitled to dispatch here -- routing policy is what
    // stopped it -- so reporting an authorization failure misclassified it.
    expect(text).toContain('ROUTING_BLOCKED');

    const run = await getRunRow(conversationId);
    expect(run.status).toBe('failed');
    expect(run.errorCode).toBe('ROUTING_BLOCKED');

    // No routed telemetry intent was ever recorded for a blocked dispatch.
    const telemetryResponse = await fetch(`${baseUrl}/api/routing/telemetry?runId=${encodeURIComponent(run.id)}`);
    const telemetryBody = (await telemetryResponse.json()) as { rows: StoredRoutingTelemetryRow[] };
    expect(telemetryBody.rows).toHaveLength(0);
  });

  // Sol review MED-5 + MED-6, end to end: attempt 0 fails with a
  // cooldown-recordable category, the daemon's real same-run retry runtime
  // (run-retry-runtime.test.ts's own territory, reused here for the routing
  // side effect it drives) restarts the SAME run as attempt 1, and attempt 1
  // succeeds. Asserts the cooldown was RECORDED while attempt 1's backoff was
  // in flight (a background poll racing the request, not just the final
  // state -- proving the MED-5 retry-boundary call actually fired, not just
  // that the MED-6 terminal call cleared a cooldown that never existed) and
  // is CLEARED by the time the run finishes -- in that order.
  it('a retried run records a failure cooldown on its failed attempt, then clears it once the retry succeeds', async () => {
    if (!process.env.OD_DATA_DIR) {
      throw new Error('OD_DATA_DIR is required to read the cooldowns table directly');
    }
    const dbFile = resolve(process.env.OD_DATA_DIR, 'app.sqlite');
    const sqlite = new Database(dbFile);
    try {
      const projectId = await createProject();
      const conversationId = `conv-routing-cooldown-retry-${randomUUID()}`;

      let sawRecordedDuringRetry = false;
      const pollForRecordedCooldown = (async () => {
        const deadline = Date.now() + 8_000;
        while (Date.now() < deadline && !sawRecordedDuringRetry) {
          const record = getCooldownRecord(sqlite, 'runtime', 'claude');
          if (record && record.consecutiveFailures > 0) {
            sawRecordedDuringRetry = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 25));
        }
      })();

      const text = await withFlakyClaudeBin(async () => {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: 'claude', projectId, conversationId, message: 'hello' }),
        });
        expect(response.ok).toBe(true);
        return response.text();
      });
      await pollForRecordedCooldown;

      expect(text).toContain('"status":"succeeded"');
      const run = await getRunRow(conversationId);
      expect(run.status).toBe('succeeded');

      // Two attempts, two telemetry rows: attempt 0's pre-spawn intent (the
      // one whose failure the MED-5 boundary call recorded) and attempt 1's
      // (the one whose success the MED-6 terminal call reconciled).
      const telemetryResponse = await fetch(`${baseUrl}/api/routing/telemetry?runId=${encodeURIComponent(run.id)}`);
      const telemetryBody = (await telemetryResponse.json()) as { rows: StoredRoutingTelemetryRow[] };
      expect(telemetryBody.rows.length).toBeGreaterThanOrEqual(2);

      expect(sawRecordedDuringRetry).toBe(true);
      const finalRecord = getCooldownRecord(sqlite, 'runtime', 'claude');
      expect(finalRecord?.consecutiveFailures ?? 0).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  // Sol review MED-6: a run that fails, retries once (per run-retry-
  // policy.ts's own attempt cap), and fails again TERMINALLY must record
  // the cooldown failure EXACTLY ONCE PER REAL FAILURE (attempt 0's
  // MED-5 retry-boundary call + attempt 1's MED-6 terminal onFinalize
  // call = 2 total) -- never more. Before the install-once guard, each
  // retry re-entered startChatRun and wrapped ANOTHER onFinalize layer
  // around the previous one; all of them fired at the run's one true
  // terminal moment, so attempt 1's own failure alone would have recorded
  // 2+ extra times on top of attempt 0's 1, over-incrementing
  // consecutiveFailures past the real failure count. Reads the BEFORE
  // count (not an assumed 0) so this test stays correct regardless of
  // what earlier tests in this file left in the shared 'claude' runtime
  // scope.
  it('a run that retries once and then fails terminally records the cooldown exactly once per real failure (Sol review MED-6)', async () => {
    if (!process.env.OD_DATA_DIR) {
      throw new Error('OD_DATA_DIR is required to read the cooldowns table directly');
    }
    const dbFile = resolve(process.env.OD_DATA_DIR, 'app.sqlite');
    const sqlite = new Database(dbFile);
    try {
      const beforeCount = getCooldownRecord(sqlite, 'runtime', 'claude')?.consecutiveFailures ?? 0;

      const projectId = await createProject();
      const conversationId = `conv-routing-cooldown-terminal-fail-${randomUUID()}`;

      const text = await withAlwaysFailingClaudeBin(async () => {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: 'claude', projectId, conversationId, message: 'hello' }),
        });
        expect(response.ok).toBe(true);
        return response.text();
      });

      expect(text).toContain('"status":"failed"');
      const run = await getRunRow(conversationId);
      expect(run.status).toBe('failed');

      // Two attempts, one retry: attempt 0's own pre-spawn intent row and
      // attempt 1's (the one whose terminal failure the once-only MED-6
      // finalizer reconciled).
      const telemetryResponse = await fetch(`${baseUrl}/api/routing/telemetry?runId=${encodeURIComponent(run.id)}`);
      const telemetryBody = (await telemetryResponse.json()) as { rows: StoredRoutingTelemetryRow[] };
      expect(telemetryBody.rows.length).toBeGreaterThanOrEqual(2);

      const afterCount = getCooldownRecord(sqlite, 'runtime', 'claude')?.consecutiveFailures ?? 0;
      expect(afterCount - beforeCount).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  // Sol review M5 residue: attempt 0 reports REAL usage before failing;
  // attempt 1 reports NO usage at all and succeeds. Without scoping the
  // terminal reconcile's usage scan to events recorded AFTER the retry
  // boundary, attempt 1's telemetry row would inherit attempt 0's token
  // counts from the shared event ring instead of its own null/zero
  // observed usage.
  it("a final attempt that reports no usage of its own does not inherit a prior failed attempt's usage (Sol review M5 residue)", async () => {
    const projectId = await createProject();
    const conversationId = `conv-routing-usage-offset-${randomUUID()}`;

    const text = await withUsageThenEmptyRetryOpencodeBin(async () => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'opencode', projectId, conversationId, message: 'hello' }),
      });
      expect(response.ok).toBe(true);
      return response.text();
    });

    expect(text).toContain('"status":"succeeded"');
    const run = await getRunRow(conversationId);
    expect(run.status).toBe('succeeded');

    const telemetryResponse = await fetch(`${baseUrl}/api/routing/telemetry?runId=${encodeURIComponent(run.id)}`);
    const telemetryBody = (await telemetryResponse.json()) as { rows: StoredRoutingTelemetryRow[] };
    expect(telemetryBody.rows.length).toBeGreaterThanOrEqual(2);

    const attempt0Row = telemetryBody.rows.find((r) => r.attempt === 0);
    const attempt1Row = telemetryBody.rows.find((r) => r.attempt === 1);
    expect(attempt0Row).toBeDefined();
    expect(attempt1Row).toBeDefined();

    // Attempt 0's own reported usage survives in ITS OWN row, unaffected by
    // attempt 1 ever having run at all.
    expect(attempt0Row?.tokens.input).toBe(40);
    expect(attempt0Row?.tokens.output).toBe(15);

    // Attempt 1 emitted no usage of its own -- its row must report
    // null/zero, never attempt 0's 40/15 leaking across the shared event
    // ring.
    expect(attempt1Row?.tokens.input ?? 0).toBe(0);
    expect(attempt1Row?.tokens.output ?? 0).toBe(0);
  });

  // Sol review M5 residue (fix-round 2): forces GENUINE ring eviction
  // (>2000 events, runtimes/runs.ts's default maxEvents) between the retry
  // boundary and the terminal reconcile -- proving the id-based scoping
  // (not an array-index/length snapshot, which would silently drift once
  // eviction shifts every later element's position) still attributes each
  // attempt's own usage correctly.
  it('attributes correct per-attempt usage even after the shared event ring evicts across a retry (Sol review M5 residue, fix-round 2)', async () => {
    const projectId = await createProject();
    const conversationId = `conv-routing-ring-evict-${randomUUID()}`;

    const text = await withRingEvictingRetryOpencodeBin(async () => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'opencode', projectId, conversationId, message: 'hello' }),
      });
      expect(response.ok).toBe(true);
      return response.text();
    });

    expect(text).toContain('"status":"succeeded"');
    const run = await getRunRow(conversationId);
    expect(run.status).toBe('succeeded');

    const telemetryResponse = await fetch(`${baseUrl}/api/routing/telemetry?runId=${encodeURIComponent(run.id)}`);
    const telemetryBody = (await telemetryResponse.json()) as { rows: StoredRoutingTelemetryRow[] };
    expect(telemetryBody.rows.length).toBeGreaterThanOrEqual(2);

    const attempt0Row = telemetryBody.rows.find((r) => r.attempt === 0);
    const attempt1Row = telemetryBody.rows.find((r) => r.attempt === 1);
    expect(attempt0Row).toBeDefined();
    expect(attempt1Row).toBeDefined();

    // Attempt 0's usage was persisted to its OWN row at the retry boundary,
    // before any of attempt 1's >2000 filler events existed to evict
    // anything -- this is a control assertion (a plain DB read is not
    // itself at risk from later in-memory ring eviction), confirming the
    // write from the earlier test's mechanism still holds under this
    // fixture's heavier load.
    expect(attempt0Row?.tokens.input).toBe(40);
    expect(attempt0Row?.tokens.output).toBe(15);

    // Attempt 1's OWN distinct usage (7/3, reported near the end of >2000
    // filler events) must survive the terminal reconcile's scan even
    // though attempt 0's entire history -- and a chunk of attempt 1's own
    // leading filler -- has been evicted from the live ring by the time
    // this fires. Never 40/15 (attempt 0 leaking in), never null/zero (the
    // real usage frame missed by a mis-scoped scan).
    expect(attempt1Row?.tokens.input).toBe(7);
    expect(attempt1Row?.tokens.output).toBe(3);
  });
});
