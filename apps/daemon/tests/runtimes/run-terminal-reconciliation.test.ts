import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  followRunTerminalOnMessage,
  holdTerminalRunStatusOnMessageWrite,
  reconcileDurableRunTerminals,
} from '../../src/runtimes/run-terminal-reconciliation.js';

describe('durable run terminal reconciliation', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-run-reconcile-test-'));
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails an interrupted run, repairs its message, and emits missing terminal telemetry once', async () => {
    const runId = 'run-interrupted';
    const runDir = path.join(tmpDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
      schemaVersion: 1,
      id: runId,
      projectId: 'p1',
      conversationId: 'c1',
      assistantMessageId: 'm1',
      agentId: 'claude',
      status: 'running',
      createdAt: 1_000,
      updatedAt: 2_000,
      analyticsRecovery: {
        context: {
          deviceId: 'device-1',
          sessionId: 'session-1',
          clientType: 'desktop',
          locale: 'zh-CN',
        },
        properties: {
          page_name: 'chat_panel',
          area: 'chat_panel',
          project_id: 'p1',
          conversation_id: 'c1',
          run_id: runId,
          project_kind: 'prototype',
          design_system_source: 'not_applicable',
          has_attachment: false,
          user_query_tokens: 10,
          model_id: 'default',
          agent_provider_id: 'claude_code',
          skill_id: null,
          mcp_id: null,
          token_count_source: 'estimated',
        },
        insertId: 'run-created-1',
      },
    }));
    db.prepare(
      `INSERT INTO messages (id, run_id, run_status, events_json)
       VALUES (?, ?, 'running', '[]')`,
    ).run('m1', runId);
    const capture = vi.fn(async () => undefined);
    const reportLangfuse = vi.fn(async () => ({
      langfuse_expected: true,
      langfuse_delivery_status: 'accepted' as const,
    }));

    const first = await reconcileDurableRunTerminals({
      analytics: { capture },
      appVersion: '0.15.1',
      db,
      reportLangfuse,
      runsLogDir: tmpDir,
    });

    expect(first).toMatchObject({ interrupted: 1, messagesReconciled: 1, analyticsReplayed: 1 });
    expect(db.prepare(`SELECT run_status AS status, ended_at AS endedAt, events_json AS eventsJson FROM messages WHERE id = 'm1'`).get()).toMatchObject({
      status: 'failed',
      endedAt: expect.any(Number),
      eventsJson: expect.stringContaining('daemon restarted'),
    });
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'run_finished',
      insertId: 'run-created-1-finish',
      properties: expect.objectContaining({
        result: 'failed',
        error_code: 'DAEMON_RESTARTED',
        failure_category: 'process_exit',
        failure_detail: 'interrupted',
        failure_stage: 'finalize',
        retryable: true,
        user_action: 'retry',
        terminal_reconciled: true,
        terminal_recovery_reason: 'daemon_restart',
      }),
    }));
    expect(reportLangfuse).toHaveBeenCalledWith(expect.objectContaining({
      persistedRunStatus: 'failed',
      run: expect.objectContaining({ id: runId, status: 'failed' }),
    }));

    const recoveredState = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
    expect(recoveredState).toMatchObject({
      status: 'failed',
      errorCode: 'DAEMON_RESTARTED',
      analyticsRecovery: { completedAt: expect.any(Number) },
      langfuseCompletedAt: expect.any(Number),
    });

    const second = await reconcileDurableRunTerminals({
      analytics: { capture },
      appVersion: '0.15.1',
      db,
      reportLangfuse,
      runsLogDir: tmpDir,
    });
    expect(second.analyticsReplayed).toBe(0);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(reportLangfuse).toHaveBeenCalledTimes(1);
  });

  it('repairs legacy queued messages even when no state journal exists', async () => {
    db.prepare(
      `INSERT INTO messages (id, run_id, run_status, events_json)
       VALUES (?, ?, 'queued', '[]')`,
    ).run('legacy-message', 'legacy-run');

    const result = await reconcileDurableRunTerminals({
      analytics: { capture: vi.fn() },
      appVersion: '0.15.1',
      db,
      reportLangfuse: vi.fn(),
      runsLogDir: tmpDir,
    });

    expect(result.messagesReconciled).toBe(1);
    expect(db.prepare(`SELECT run_status AS status FROM messages WHERE id = 'legacy-message'`).get())
      .toEqual({ status: 'failed' });
  });

  it('preserves the real failure taxonomy when replaying incomplete analytics', async () => {
    const runId = 'run-analytics-incomplete';
    const runDir = path.join(tmpDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
      schemaVersion: 1,
      id: runId,
      projectId: 'p1',
      conversationId: 'c1',
      assistantMessageId: 'm1',
      agentId: 'claude',
      status: 'failed',
      createdAt: 1_000,
      updatedAt: 2_000,
      exitCode: 1,
      error: 'Authentication required before starting the session.',
      errorCode: 'AGENT_AUTH_REQUIRED',
      analyticsRecovery: {
        context: {
          deviceId: 'device-1',
          sessionId: 'session-1',
          clientType: 'desktop',
          locale: 'en',
        },
        properties: {
          page_name: 'chat_panel',
          area: 'chat_panel',
          project_id: 'p1',
          conversation_id: 'c1',
          run_id: runId,
        },
        insertId: 'run-created-analytics-incomplete',
      },
      langfuseCompletedAt: 2_000,
    }));
    db.prepare(
      `INSERT INTO messages (id, run_id, run_status, events_json)
       VALUES (?, ?, 'running', '[]')`,
    ).run('m1', runId);
    const capture = vi.fn(async () => undefined);

    const result = await reconcileDurableRunTerminals({
      analytics: { capture },
      appVersion: '0.15.1',
      db,
      reportLangfuse: vi.fn(),
      runsLogDir: tmpDir,
    });

    expect(result).toMatchObject({
      interrupted: 0,
      messagesReconciled: 1,
      analyticsReplayed: 1,
    });
    const message = db.prepare(
      `SELECT run_status AS status, events_json AS eventsJson FROM messages WHERE id = 'm1'`,
    ).get() as { status: string; eventsJson: string };
    expect(message).toMatchObject({
      status: 'failed',
      eventsJson: expect.stringContaining('Authentication required before starting the session.'),
    });
    expect(message.eventsJson).not.toContain('daemon restarted');
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'run_finished',
      properties: expect.objectContaining({
        result: 'failed',
        error_code: 'AGENT_AUTH_REQUIRED',
        failure_category: 'auth',
        failure_detail: 'auth_required',
        failure_stage: 'session_init',
        retryable: false,
        user_action: 'login',
        terminal_reconciled: true,
        terminal_recovery_reason: 'analytics_incomplete',
      }),
    }));
  });

  it('does not read events after analytics and Langfuse are checkpointed', async () => {
    const runId = 'run-fully-checkpointed';
    const runDir = path.join(tmpDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
      schemaVersion: 1,
      id: runId,
      projectId: 'p1',
      conversationId: 'c1',
      assistantMessageId: 'm1',
      agentId: 'claude',
      status: 'succeeded',
      createdAt: 1_000,
      updatedAt: 2_000,
      analyticsRecovery: {
        context: {},
        properties: {},
        insertId: 'run-created-fully-checkpointed',
        completedAt: 2_000,
      },
      langfuseCompletedAt: 2_000,
    }));
    const readFile = vi.spyOn(fs, 'readFileSync');
    const capture = vi.fn();
    const reportLangfuse = vi.fn();

    const result = await reconcileDurableRunTerminals({
      analytics: { capture },
      appVersion: '0.15.1',
      db,
      reportLangfuse,
      runsLogDir: tmpDir,
    });

    expect(result).toMatchObject({
      scanned: 1,
      analyticsReplayed: 0,
      langfuseReplayed: 0,
    });
    expect(readFile).not.toHaveBeenCalledWith(path.join(runDir, 'events.jsonl'), 'utf8');
    expect(capture).not.toHaveBeenCalled();
    expect(reportLangfuse).not.toHaveBeenCalled();
  });

  it('leaves failed Langfuse delivery uncheckpointed for the next boot', async () => {
    const runId = 'run-langfuse-retry';
    const runDir = path.join(tmpDir, runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
      schemaVersion: 1,
      id: runId,
      projectId: 'p1',
      conversationId: 'c1',
      assistantMessageId: 'm1',
      agentId: 'codex',
      status: 'failed',
      createdAt: 1_000,
      updatedAt: 2_000,
      errorCode: 'AGENT_EXIT_1',
    }));
    const reportLangfuse = vi.fn(async () => ({
      langfuse_expected: true,
      langfuse_delivery_status: 'failed' as const,
      langfuse_drop_reason: 'network_error' as const,
    }));
    const options = {
      analytics: { capture: vi.fn() },
      appVersion: '0.15.1',
      db,
      reportLangfuse,
      runsLogDir: tmpDir,
    };

    await reconcileDurableRunTerminals(options);
    await reconcileDurableRunTerminals(options);

    expect(reportLangfuse).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8')))
      .not.toHaveProperty('langfuseCompletedAt');
  });
  describe('assistant rows follow the run terminal event (issue #159 A)', () => {
    function writeTerminalState(runId: string, status: string, updatedAt: number): void {
      const runDir = path.join(tmpDir, runId);
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
        schemaVersion: 1,
        id: runId,
        projectId: 'p1',
        conversationId: 'c1',
        assistantMessageId: `m-${runId}`,
        agentId: 'claude',
        status,
        createdAt: 1_000,
        updatedAt,
        langfuseCompletedAt: updatedAt,
      }));
    }

    // The run's own durable terminal record: the `end` line `emit()` appends to
    // events.jsonl after it has already written state.json (runtimes/runs.ts).
    function writeTerminalEvent(runId: string, status: string, timestamp: number): void {
      const runDir = path.join(tmpDir, runId);
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, 'events.jsonl'), [
        JSON.stringify({ id: 1, event: 'start', data: {}, timestamp: 1_000 }),
        JSON.stringify({ id: 2, event: 'end', data: { status, code: null, signal: null }, timestamp }),
        '',
      ].join('\n'));
    }

    function insertStuckRow(messageId: string, runId: string, content = ''): void {
      db.prepare(
        `INSERT INTO messages (id, role, content, run_id, run_status, ended_at, events_json)
         VALUES (?, 'assistant', ?, ?, 'failed', 2000, ?)`,
      ).run(
        messageId,
        content,
        runId,
        JSON.stringify([
          { kind: 'status', label: 'starting', detail: 'antigravity' },
          { kind: 'status', label: 'error', detail: 'Run interrupted because the daemon restarted.' },
        ]),
      );
    }

    function readRow(messageId: string): { status: string; endedAt: number; eventsJson: string } {
      return db.prepare(
        `SELECT run_status AS status, ended_at AS endedAt, events_json AS eventsJson
           FROM messages WHERE id = ?`,
      ).get(messageId) as { status: string; endedAt: number; eventsJson: string };
    }

    it('backfills a row left failed with empty content beside a succeeded run, idempotently', async () => {
      writeTerminalState('run-succeeded', 'succeeded', 9_000);
      writeTerminalEvent('run-succeeded', 'succeeded', 9_000);
      insertStuckRow('m-run-succeeded', 'run-succeeded');
      const options = {
        analytics: { capture: vi.fn() },
        appVersion: '0.15.1',
        db,
        reportLangfuse: vi.fn(async () => ({ langfuse_expected: false })),
        runsLogDir: tmpDir,
      };

      const first = await reconcileDurableRunTerminals(options);
      expect(first.messagesFollowedTerminal).toBe(1);
      const repaired = readRow('m-run-succeeded');
      expect(repaired.status).toBe('succeeded');
      expect(repaired.endedAt).toBe(9_000);
      expect(repaired.eventsJson).toContain('Message reconciled to the run terminal event.');

      const second = await reconcileDurableRunTerminals(options);
      expect(second.messagesFollowedTerminal).toBe(0);
      expect(readRow('m-run-succeeded').status).toBe('succeeded');
    });

    it('leaves a genuinely failed run and a failed row carrying content alone', async () => {
      writeTerminalState('run-really-failed', 'failed', 9_000);
      writeTerminalEvent('run-really-failed', 'failed', 9_000);
      insertStuckRow('m-run-really-failed', 'run-really-failed');
      writeTerminalState('run-with-body', 'succeeded', 9_000);
      writeTerminalEvent('run-with-body', 'succeeded', 9_000);
      insertStuckRow('m-run-with-body', 'run-with-body', 'The agent could not reach the provider.');

      const result = await reconcileDurableRunTerminals({
        analytics: { capture: vi.fn() },
        appVersion: '0.15.1',
        db,
        reportLangfuse: vi.fn(async () => ({ langfuse_expected: false })),
        runsLogDir: tmpDir,
      });

      expect(result.messagesFollowedTerminal).toBe(0);
      expect(readRow('m-run-really-failed').status).toBe('failed');
      expect(readRow('m-run-with-body').status).toBe('failed');
    });

    // `emit()` (runtimes/runs.ts) persists state.json BEFORE it appends the
    // record to events.jsonl, so a terminal state.json can exist with no
    // durable `end` line behind it — a crash between the two writes, a log the
    // stream never flushed, a run directory restored without its log. Reading
    // history, state.json alone is therefore not proof the run reached that
    // terminal; the backfill rewrites a user-visible row, so it must require
    // the run's own durable terminal record and agree with it.
    it('does not backfill a row whose run has no durable terminal event', async () => {
      writeTerminalState('run-no-event', 'succeeded', 9_000);
      insertStuckRow('m-run-no-event', 'run-no-event');

      const result = await reconcileDurableRunTerminals({
        analytics: { capture: vi.fn() },
        appVersion: '0.15.1',
        db,
        reportLangfuse: vi.fn(async () => ({ langfuse_expected: false })),
        runsLogDir: tmpDir,
      });

      expect(result.messagesFollowedTerminal).toBe(0);
      expect(readRow('m-run-no-event').status).toBe('failed');
    });

    it('does not backfill a row whose durable terminal event disagrees with state.json', async () => {
      writeTerminalState('run-mismatch', 'succeeded', 9_000);
      writeTerminalEvent('run-mismatch', 'failed', 9_000);
      insertStuckRow('m-run-mismatch', 'run-mismatch');

      const result = await reconcileDurableRunTerminals({
        analytics: { capture: vi.fn() },
        appVersion: '0.15.1',
        db,
        reportLangfuse: vi.fn(async () => ({ langfuse_expected: false })),
        runsLogDir: tmpDir,
      });

      expect(result.messagesFollowedTerminal).toBe(0);
      expect(readRow('m-run-mismatch').status).toBe('failed');
    });

    it('does not backfill a row whose event log carries no end record at all', async () => {
      const runId = 'run-no-end-record';
      writeTerminalState(runId, 'succeeded', 9_000);
      fs.writeFileSync(
        path.join(tmpDir, runId, 'events.jsonl'),
        `${JSON.stringify({ id: 1, event: 'start', data: {}, timestamp: 1_000 })}\n`,
      );
      insertStuckRow('m-run-no-end-record', runId);

      const result = await reconcileDurableRunTerminals({
        analytics: { capture: vi.fn() },
        appVersion: '0.15.1',
        db,
        reportLangfuse: vi.fn(async () => ({ langfuse_expected: false })),
        runsLogDir: tmpDir,
      });

      expect(result.messagesFollowedTerminal).toBe(0);
      expect(readRow('m-run-no-end-record').status).toBe('failed');
    });

    // A daemon SIGKILLed mid-append leaves a half-written LAST line behind an
    // otherwise complete log. Reading the file as all-or-nothing threw the
    // run's real `end` record away with that fragment, so the stranded row was
    // left `failed` with empty content — the symptom the backfill exists to
    // clear, silently un-repaired.
    it('repairs a row whose event log ends in a half-written line after its end record', async () => {
      const runId = 'run-truncated-tail';
      writeTerminalState(runId, 'succeeded', 9_000);
      fs.mkdirSync(path.join(tmpDir, runId), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, runId, 'events.jsonl'),
        `${JSON.stringify({ id: 1, event: 'start', data: {}, timestamp: 1_000 })}\n`
        + `${JSON.stringify({
          id: 2,
          event: 'end',
          data: { status: 'succeeded', code: null, signal: null },
          timestamp: 9_000,
        })}\n`
        + '{"id":3,"event":"usage","data":{"input',
      );
      insertStuckRow('m-run-truncated-tail', runId);

      const result = await reconcileDurableRunTerminals({
        analytics: { capture: vi.fn() },
        appVersion: '0.15.1',
        db,
        reportLangfuse: vi.fn(async () => ({ langfuse_expected: false })),
        runsLogDir: tmpDir,
      });

      expect(result.messagesFollowedTerminal).toBe(1);
      expect(readRow('m-run-truncated-tail').status).toBe('succeeded');
    });

    // Damage anywhere but the last line is not a torn append: records may be
    // missing or interleaved, so the log is not evidence of anything and the
    // pass must still fail closed rather than repair a row on a guess.
    it('still refuses a log whose malformed line is not the last one', async () => {
      const runId = 'run-corrupt-middle';
      writeTerminalState(runId, 'succeeded', 9_000);
      fs.mkdirSync(path.join(tmpDir, runId), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, runId, 'events.jsonl'),
        '{"id":1,"event":"start","data":{"partial\n'
        + `${JSON.stringify({
          id: 2,
          event: 'end',
          data: { status: 'succeeded', code: null, signal: null },
          timestamp: 9_000,
        })}\n`,
      );
      insertStuckRow('m-run-corrupt-middle', runId);

      const result = await reconcileDurableRunTerminals({
        analytics: { capture: vi.fn() },
        appVersion: '0.15.1',
        db,
        reportLangfuse: vi.fn(async () => ({ langfuse_expected: false })),
        runsLogDir: tmpDir,
      });

      expect(result.messagesFollowedTerminal).toBe(0);
      expect(readRow('m-run-corrupt-middle').status).toBe('failed');
    });

    it('repairs the row from the run terminal hook without waiting for a restart', () => {
      insertStuckRow('m-live', 'run-live');

      expect(followRunTerminalOnMessage(db, {
        assistantMessageId: 'm-live',
        endedAt: 7_000,
        status: 'succeeded',
      })).toBe(true);
      const repaired = readRow('m-live');
      expect(repaired.status).toBe('succeeded');
      expect(repaired.endedAt).toBe(7_000);

      expect(followRunTerminalOnMessage(db, {
        assistantMessageId: 'm-live',
        endedAt: 8_000,
        status: 'succeeded',
      })).toBe(false);
      expect(readRow('m-live').endedAt).toBe(7_000);
    });

    it('repairs a failed row that already streamed content, because the terminal event is later', () => {
      insertStuckRow('m-live-content', 'run-live-content', 'Partial answer streamed before the row was failed.');

      expect(followRunTerminalOnMessage(db, {
        assistantMessageId: 'm-live-content',
        endedAt: 7_000,
        status: 'succeeded',
      })).toBe(true);
      expect(readRow('m-live-content').status).toBe('succeeded');
    });

    it('reports a write failure instead of swallowing it, and never throws into the terminal hook', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      // The UPDATE itself fails: the row schema has no `role` column.
      const noRole = new Database(':memory:');
      noRole.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, run_status TEXT, ended_at INTEGER)`);
      expect(followRunTerminalOnMessage(noRole, {
        assistantMessageId: 'm-broken',
        endedAt: 7_000,
        status: 'succeeded',
      })).toBe(false);
      expect(warn).toHaveBeenCalledWith(
        '[runs] message terminal reconciliation failed',
        expect.anything(),
      );
      noRole.close();

      // The UPDATE commits and the status-event append then fails: the row is
      // still repaired and reported as repaired, and nothing propagates into
      // the caller's remaining terminal bookkeeping.
      warn.mockClear();
      const noEvents = new Database(':memory:');
      noEvents.exec(`
        CREATE TABLE messages (
          id TEXT PRIMARY KEY, role TEXT, content TEXT, run_status TEXT, ended_at INTEGER
        )
      `);
      noEvents.prepare(
        `INSERT INTO messages (id, role, content, run_status, ended_at)
         VALUES ('m-no-events', 'assistant', '', 'failed', 2000)`,
      ).run();
      expect(followRunTerminalOnMessage(noEvents, {
        assistantMessageId: 'm-no-events',
        endedAt: 7_000,
        status: 'succeeded',
      })).toBe(true);
      expect(noEvents.prepare(`SELECT run_status AS status FROM messages WHERE id = 'm-no-events'`).get())
        .toEqual({ status: 'succeeded' });
      expect(warn).toHaveBeenCalledWith(
        '[runs] message terminal reconciliation failed',
        expect.anything(),
      );
      noEvents.close();
    });

    describe('a delayed message write cannot leave the run terminal event', () => {
      function insertRow(messageId: string, runStatus: string, endedAt: number, role = 'assistant'): void {
        db.prepare(
          `INSERT INTO messages (id, role, content, run_id, run_status, ended_at, events_json)
           VALUES (?, ?, '', 'run-hold', ?, ?, NULL)`,
        ).run(messageId, role, runStatus, endedAt);
      }

      it('pins a failed write back to the terminal status the row already follows', () => {
        insertRow('m-held', 'succeeded', 9_000);

        expect(holdTerminalRunStatusOnMessageWrite(db, {
          content: '',
          endedAt: 2_000,
          id: 'm-held',
          role: 'assistant',
          runStatus: 'failed',
        })).toEqual({
          content: '',
          endedAt: 9_000,
          id: 'm-held',
          role: 'assistant',
          runStatus: 'succeeded',
        });
      });

      it('pins a failed write back to a canceled terminal too', () => {
        insertRow('m-held-canceled', 'canceled', 9_000);

        expect(holdTerminalRunStatusOnMessageWrite(db, {
          id: 'm-held-canceled',
          runStatus: 'failed',
        })).toMatchObject({ runStatus: 'canceled' });
      });

      it('passes every other field of the delayed write through untouched', () => {
        insertRow('m-held-fields', 'succeeded', 9_000);

        expect(holdTerminalRunStatusOnMessageWrite(db, {
          content: 'The answer the client finally flushed.',
          events: [{ kind: 'text', text: 'hi' }],
          id: 'm-held-fields',
          producedFiles: ['index.html'],
          runStatus: 'failed',
        })).toMatchObject({
          content: 'The answer the client finally flushed.',
          events: [{ kind: 'text', text: 'hi' }],
          producedFiles: ['index.html'],
          runStatus: 'succeeded',
        });
      });

      // Pinning the status alone moved the symptom rather than closing it: the
      // held write is a copy of the turn made before it finished, so it still
      // blanked the answer to '' and re-attached the stale "daemon restarted"
      // event. The user then read a succeeded turn with no answer in it under
      // two contradictory status events.
      it('keeps the stored answer and its events when the held write carries none', () => {
        db.prepare(
          `INSERT INTO messages (id, role, content, run_id, run_status, ended_at, events_json)
           VALUES ('m-held-body', 'assistant', ?, 'run-hold', 'succeeded', 9000, ?)`,
        ).run(
          'Here is the page you asked for.',
          JSON.stringify([{ kind: 'status', label: 'succeeded', detail: 'Message reconciled to the run terminal event.' }]),
        );

        expect(holdTerminalRunStatusOnMessageWrite(db, {
          content: '',
          endedAt: 2_000,
          events: [{ detail: 'Run interrupted because the daemon restarted.', kind: 'status', label: 'error' }],
          id: 'm-held-body',
          role: 'assistant',
          runId: 'run-hold',
          runStatus: 'failed',
        })).toEqual({
          content: 'Here is the page you asked for.',
          endedAt: 9_000,
          events: [{ detail: 'Message reconciled to the run terminal event.', kind: 'status', label: 'succeeded' }],
          id: 'm-held-body',
          role: 'assistant',
          runId: 'run-hold',
          runStatus: 'succeeded',
        });
      });

      // Holding the body must not cost a real late delivery. The dropped
      // client's OTHER flush — the one that finally carries the answer — still
      // writes its own content and events onto the row.
      it('lets a held write deliver a body the row does not have yet', () => {
        db.prepare(
          `INSERT INTO messages (id, role, content, run_id, run_status, ended_at, events_json)
           VALUES ('m-held-late-body', 'assistant', '', 'run-hold', 'succeeded', 9000, ?)`,
        ).run(JSON.stringify([{ kind: 'status', label: 'succeeded', detail: 'stored' }]));

        expect(holdTerminalRunStatusOnMessageWrite(db, {
          content: 'The answer the client finally flushed.',
          events: [{ kind: 'text', text: 'hi' }],
          id: 'm-held-late-body',
          runId: 'run-hold',
          runStatus: 'failed',
        })).toMatchObject({
          content: 'The answer the client finally flushed.',
          events: [{ kind: 'text', text: 'hi' }],
          runStatus: 'succeeded',
        });
      });

      // A stale copy of the turn does not have to claim `failed` to strand the
      // row. `upsertMessage` writes `run_status` unconditionally, so a delayed
      // write that still believes the turn is `running` — or one that carries no
      // run status at all, which stores NULL — takes the row off its terminal
      // just as effectively.
      it('pins a delayed write that still claims the turn is running', () => {
        insertRow('m-held-running', 'succeeded', 9_000);

        expect(holdTerminalRunStatusOnMessageWrite(db, {
          id: 'm-held-running',
          runId: 'run-hold',
          runStatus: 'running',
        })).toMatchObject({ endedAt: 9_000, runStatus: 'succeeded' });
      });

      it('pins a delayed write that carries no run status at all', () => {
        insertRow('m-held-absent', 'succeeded', 9_000);

        expect(holdTerminalRunStatusOnMessageWrite(db, {
          content: 'late content',
          id: 'm-held-absent',
        })).toMatchObject({ endedAt: 9_000, runStatus: 'succeeded' });
      });

      it('lets a write from a different run own the row', () => {
        insertRow('m-held-other-run', 'succeeded', 9_000);

        const write = { id: 'm-held-other-run', runId: 'run-other', runStatus: 'running' };
        expect(holdTerminalRunStatusOnMessageWrite(db, write)).toEqual(write);
      });

      it('leaves a write alone when the row is not already on a non-failed terminal', () => {
        insertRow('m-running', 'running', 2_000);
        insertRow('m-already-failed', 'failed', 2_000);
        insertRow('m-user', 'succeeded', 9_000, 'user');

        for (const id of ['m-running', 'm-already-failed', 'm-user', 'm-absent']) {
          const write = { id, runStatus: 'failed' };
          expect(holdTerminalRunStatusOnMessageWrite(db, write)).toEqual(write);
        }
      });

      // Agreeing on the status is not enough. A stale copy that carries the
      // `endedAt` its own writer stamped would drag the row's timestamp back
      // off the run's terminal clock, which is the same class of drift one
      // step down.
      it('pins the terminal timestamp even when the delayed write agrees on status', () => {
        insertRow('m-agrees', 'succeeded', 9_000);
        insertRow('m-agrees-canceled', 'canceled', 9_000);

        for (const id of ['m-agrees', 'm-agrees-canceled']) {
          const held = id === 'm-agrees' ? 'succeeded' : 'canceled';
          expect(holdTerminalRunStatusOnMessageWrite(db, {
            endedAt: 1_000,
            id,
            runStatus: held,
          })).toMatchObject({ endedAt: 9_000, runStatus: held });
        }
      });

      // Not every write that disagrees on the timestamp is a stale copy. The
      // daemon stamps the row the moment the run ends
      // (`reconcileAssistantMessageOnRunEnd`, `plugins/share-helpers.ts`), and
      // the client's own onDone save lands a few hundred milliseconds later
      // carrying the completion time it rendered. That save agrees with the
      // row's terminal and moves the clock FORWARDS, so it is the live turn's
      // final write and owns its own `endedAt` — the retried turn in
      // `e2e/tests/dialog/retry-after-stop.test.ts` asserts exactly that.
      it('lets a retried turn\'s final save keep its own later terminal timestamp', () => {
        insertRow('m-retried-final', 'succeeded', 9_000);

        const write = {
          content: 'the answer',
          endedAt: 9_196,
          id: 'm-retried-final',
          runStatus: 'succeeded',
        };
        expect(holdTerminalRunStatusOnMessageWrite(db, write)).toEqual(write);
      });

      it('never touches a write that already agrees on status and timestamp', () => {
        insertRow('m-agrees-fully', 'succeeded', 9_000);

        const write = { content: 'the answer', endedAt: 9_000, id: 'm-agrees-fully', runStatus: 'succeeded' };
        expect(holdTerminalRunStatusOnMessageWrite(db, write)).toEqual(write);
      });

      it('fails open with a warning rather than rejecting the write', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const noRole = new Database(':memory:');
        noRole.exec(`CREATE TABLE messages (id TEXT PRIMARY KEY, run_status TEXT)`);

        const write = { id: 'm-broken', runStatus: 'failed' };
        expect(holdTerminalRunStatusOnMessageWrite(noRole, write)).toEqual(write);
        expect(warn).toHaveBeenCalledWith(
          '[runs] terminal run status hold failed',
          expect.anything(),
        );
        noRole.close();
      });
    });

    it('never rewrites a row for a non-terminal or failed run status', () => {
      insertStuckRow('m-guard', 'run-guard');

      for (const status of ['running', 'queued', 'failed']) {
        expect(followRunTerminalOnMessage(db, {
          assistantMessageId: 'm-guard',
          endedAt: 7_000,
          status,
        })).toBe(false);
      }
      expect(readRow('m-guard')).toMatchObject({ status: 'failed', endedAt: 2_000 });
    });
  });
});
