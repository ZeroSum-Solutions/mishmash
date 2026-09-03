// Red spec for W1F.3, finding 1: the run the bug report actually describes.
//
// Issue #157 reports a run that SUCCEEDED with exit 0 and was still presented
// as a failure while its agent output carried external-MCP connect noise. The
// classifier cases in `mcp-health-surface.test.ts` all pass `exitCode: 1`, and
// `diagnoseClaudeCliFailure` returns null for exit 0 without a signal
// (`apps/daemon/src/claude-diagnostics.ts:90`), so none of them can reach the
// reported run. This file asserts the reported run itself, on the daemon side:
// the terminal facts a succeeded exit-0 run ends with, and the assistant row
// those facts leave behind.
//
// Fixture: run 074ab1fd-a7af-4469-aa85-ae38185c4f95 from the team daemon's run
// log, the run linked from #157. Its `state.json` records `status: succeeded`,
// `exitCode: 0`, `signal: null`, `error: null`, `errorCode: null`,
// `artifactCount: 1`; its final `end` event carries `failureCategory: null`.
// The `tool_result` text below is verbatim from that run's persisted events.
//
// The web half of the same rule -- what the user actually sees -- is
// `apps/web/tests/components/ChatPane.mcp-noise-succeeded.test.tsx`.

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { diagnoseClaudeCliFailure } from '../src/claude-diagnostics.js';
import { classifyRunFailure } from '../src/run-failure-classification.js';
import { persistRunFailureClassification } from '../src/runtimes/chat-run-messages.js';
import { followRunTerminalOnMessage } from '../src/runtimes/run-terminal-reconciliation.js';

/** Verbatim `tool_result` content persisted by run 074ab1fd. `isError` was
 *  false: the agent asked for a tool and was told which servers were absent. */
const MCP_CONNECT_NOISE =
  'No matching deferred tools found. Note: these configured MCP servers failed to connect, ' +
  'so their tools are unavailable for this session: shadcn-ui (CONNECT_TIMEOUT): ' +
  '"MCP server shadcn-ui connection timed out after 30000ms"; antv-chart (CONNECT_TIMEOUT): ' +
  '"MCP server antv-chart connection timed out after 30000ms"; mermaid (CONNECTION_CLOSED): ' +
  '"Connection closed"; fal-ai (CONNECTION_CLOSED): "Connection closed". ' +
  'Treat this as a connection failure — do not conclude the capability is unconfigured.';

/** The mid-turn flap from the same session, reported in the #157 comment. */
const MCP_FLAP_NOISE =
  '3 deferred tools are no longer available (MCP server disconnected)\n' +
  '3 deferred tools are available again (reconnected)';

const RUN_ID = '074ab1fd-a7af-4469-aa85-ae38185c4f95';
const ASSISTANT_MESSAGE_ID = 'c794cb95-c5d5-4f51-9d35-1e9290e5b1a4';
const ANSWER = 'Done. `index.html` is the full-viewport curl-noise flow field.';

/** The run's own events, reduced to the kinds the daemon classifiers read. */
const RUN_EVENTS = [
  { kind: 'status', label: 'starting', detail: 'claude' },
  { kind: 'tool_use', id: 'toolu_01HjDoqVnHsPXRkWzYZEFY7F', name: 'ToolSearch', input: {} },
  {
    kind: 'tool_result',
    toolUseId: 'toolu_01HjDoqVnHsPXRkWzYZEFY7F',
    content: MCP_CONNECT_NOISE,
    isError: false,
  },
  { kind: 'text', text: MCP_FLAP_NOISE },
  { kind: 'text', text: ANSWER },
];

describe('a succeeded exit-0 run carrying MCP noise ends with no failure (#157)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        role TEXT,
        content TEXT,
        run_id TEXT,
        run_status TEXT,
        ended_at INTEGER,
        events_json TEXT
      )
    `);
    db.prepare(
      `INSERT INTO messages (id, role, content, run_id, run_status, ended_at, events_json)
       VALUES (?, 'assistant', ?, ?, 'succeeded', 1787891501446, ?)`,
    ).run(ASSISTANT_MESSAGE_ID, ANSWER, RUN_ID, JSON.stringify(RUN_EVENTS));
  });

  afterEach(() => {
    db.close();
  });

  it('classifies no failure for the run terminal facts the run recorded', () => {
    const failure = classifyRunFailure({
      result: 'success',
      status: {
        status: 'succeeded',
        error: null,
        errorCode: null,
        exitCode: 0,
        signal: null,
      },
      agentId: 'claude',
      events: RUN_EVENTS,
    } as unknown as Parameters<typeof classifyRunFailure>[0]);

    expect(failure).toBeUndefined();
  });

  it('produces no agent diagnostic for exit 0 even with the connect noise present', () => {
    expect(
      diagnoseClaudeCliFailure({
        agentId: 'claude',
        exitCode: 0,
        signal: null,
        stdoutTail: `${MCP_CONNECT_NOISE}\n${MCP_FLAP_NOISE}\n${ANSWER}`,
        env: {},
      }),
    ).toBeNull();
  });

  it('writes no error event onto the assistant row of the succeeded run', () => {
    persistRunFailureClassification(db, {
      id: RUN_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      status: 'succeeded',
      failureCategory: null,
      failureDetail: null,
      failureStage: null,
      artifactCount: 1,
    });

    const row = db
      .prepare(`SELECT events_json AS eventsJson FROM messages WHERE id = ?`)
      .get(ASSISTANT_MESSAGE_ID) as { eventsJson: string };
    const events = JSON.parse(row.eventsJson) as Array<Record<string, unknown>>;

    expect(
      events.some((event) => event.kind === 'status' && event.label === 'error'),
    ).toBe(false);
  });

  it('leaves the assistant row succeeded with the answer it delivered', () => {
    followRunTerminalOnMessage(db, {
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      endedAt: 1787891501446,
      status: 'succeeded',
    });

    const row = db
      .prepare(`SELECT run_status AS runStatus, content FROM messages WHERE id = ?`)
      .get(ASSISTANT_MESSAGE_ID) as { runStatus: string; content: string };

    expect(row.runStatus).toBe('succeeded');
    expect(row.content).toBe(ANSWER);
  });
});
