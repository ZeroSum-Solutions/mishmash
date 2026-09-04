import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import type { ProjectFile } from '@open-design/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isRunTouchedProjectFile } from '../../src/projects.js';
import {
  classifyUnattendedRunDelivery,
  producedFilesForRun,
  replayUnattendedDeliveryClassifications,
} from '../../src/runtimes/run-delivery-classification.js';

const RUN_ID = 'run-unattended';
const MESSAGE_ID = 'assistant-unattended';
const CONVERSATION_ID = 'conversation-1';
const PROJECT_ID = 'project-1';
const RUN_STARTED_AT = 100_000;

function projectFile(name: string, mtime: number, extra: Partial<ProjectFile> = {}): ProjectFile {
  return {
    name,
    size: 10,
    mtime,
    kind: 'other',
    mime: 'text/plain',
    ...extra,
  } as ProjectFile;
}

describe('unattended run delivery classification', () => {
  let tmpDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-run-delivery-test-'));
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        role TEXT,
        content TEXT,
        run_id TEXT,
        run_status TEXT,
        result_delivery_state TEXT,
        produced_files_json TEXT,
        trace_object_files_json TEXT,
        session_mode TEXT,
        started_at INTEGER,
        created_at INTEGER
      );
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT
      );
      INSERT INTO conversations (id, project_id) VALUES ('${CONVERSATION_ID}', '${PROJECT_ID}');
    `);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeRunLog(records: Array<Record<string, unknown>>): void {
    const runDir = path.join(tmpDir, RUN_ID);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, 'events.jsonl'),
      `${records.map((record, index) => JSON.stringify({ id: index, ...record })).join('\n')}\n`,
    );
  }

  function succeededRunLog(
    extraRecords: Array<Record<string, unknown>> = [],
    endData: Record<string, unknown> = {},
  ): void {
    writeRunLog([
      { event: 'start', data: {} },
      ...extraRecords,
      {
        event: 'end',
        data: { status: 'succeeded', endedWithUnfinishedWork: false, ...endData },
      },
    ]);
  }

  function insertRow(overrides: Partial<Record<string, unknown>> = {}): void {
    const row = {
      id: MESSAGE_ID,
      conversation_id: CONVERSATION_ID,
      role: 'assistant',
      content: 'Generated index.html.',
      run_id: RUN_ID,
      run_status: 'succeeded',
      result_delivery_state: null,
      produced_files_json: null,
      trace_object_files_json: null,
      session_mode: 'design',
      started_at: RUN_STARTED_AT,
      created_at: RUN_STARTED_AT,
      ...overrides,
    };
    db.prepare(
      `INSERT INTO messages
         (id, conversation_id, role, content, run_id, run_status, result_delivery_state,
          produced_files_json, trace_object_files_json, session_mode, started_at, created_at)
       VALUES (@id, @conversation_id, @role, @content, @run_id, @run_status, @result_delivery_state,
               @produced_files_json, @trace_object_files_json, @session_mode, @started_at, @created_at)`,
    ).run(row);
  }

  function classify(files: ProjectFile[], previewStarted = false) {
    return classifyUnattendedRunDelivery(
      db,
      {
        assistantMessageId: MESSAGE_ID,
        conversationId: CONVERSATION_ID,
        id: RUN_ID,
        projectId: PROJECT_ID,
        sessionMode: 'design',
        startedAt: RUN_STARTED_AT,
      },
      {
        listProjectFiles: async () => files,
        previewStartedDuringRun: () => previewStarted,
        runsLogDir: tmpDir,
      },
      isRunTouchedProjectFile,
    );
  }

  function storedRow() {
    return db.prepare(
      `SELECT result_delivery_state AS resultDeliveryState,
              produced_files_json AS producedFilesJson,
              trace_object_files_json AS traceObjectFilesJson
         FROM messages WHERE id = ?`,
    ).get(MESSAGE_ID) as {
      resultDeliveryState: string | null;
      producedFilesJson: string | null;
      traceObjectFilesJson: string | null;
    };
  }

  describe('producedFilesForRun', () => {
    it('keeps only non-directory files written inside the run window', () => {
      const produced = producedFilesForRun(
        [
          projectFile('index.html', RUN_STARTED_AT + 500),
          projectFile('stale.html', RUN_STARTED_AT - 60_000),
          projectFile('assets', RUN_STARTED_AT + 500, { type: 'dir' }),
        ],
        RUN_STARTED_AT,
        isRunTouchedProjectFile,
      );
      expect(produced.map((file) => file.name)).toEqual(['index.html']);
    });

    it('never attributes a user sketch to the run', () => {
      const produced = producedFilesForRun(
        [projectFile('board.sketch.json', RUN_STARTED_AT + 500)],
        RUN_STARTED_AT,
        isRunTouchedProjectFile,
      );
      expect(produced).toEqual([]);
    });
  });

  it('records delivered and the file list for a design turn no client classified', async () => {
    insertRow();
    succeededRunLog();

    await expect(classify([projectFile('index.html', RUN_STARTED_AT + 500)])).resolves.toBe(true);

    const row = storedRow();
    expect(row.resultDeliveryState).toBe('delivered');
    expect(JSON.parse(row.producedFilesJson ?? 'null')).toEqual([
      expect.objectContaining({ name: 'index.html' }),
    ]);
    // The chat reads a succeeded design turn missing either list as still
    // verifying, so both columns have to leave that state.
    expect(row.traceObjectFilesJson).toBe(row.producedFilesJson);
  });

  it('treats a preview server started during the run as the deliverable', async () => {
    insertRow();
    succeededRunLog();

    await expect(classify([], true)).resolves.toBe(true);
    expect(storedRow().resultDeliveryState).toBe('delivered');
  });

  it('treats a live artifact created during the run as the deliverable', async () => {
    insertRow();
    succeededRunLog([
      { event: 'agent', data: { type: 'live_artifact', action: 'created', artifactId: 'a1' } },
    ]);

    await expect(classify([])).resolves.toBe(true);
    expect(storedRow().resultDeliveryState).toBe('delivered');
  });

  it('records no_result when the turn attempted a write and delivered nothing', async () => {
    insertRow();
    succeededRunLog([
      {
        event: 'agent',
        data: { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/tmp/out.html' } },
      },
      { event: 'agent', data: { type: 'tool_result', toolUseId: 't1', isError: true } },
    ]);

    await expect(classify([])).resolves.toBe(true);
    expect(storedRow().resultDeliveryState).toBe('no_result');
  });

  it('leaves a report-only turn unlabelled but still records its file list', async () => {
    insertRow();
    succeededRunLog();

    await expect(classify([])).resolves.toBe(true);

    const row = storedRow();
    expect(row.resultDeliveryState).toBeNull();
    expect(row.producedFilesJson).toBe('[]');
  });

  it('leaves a turn that stopped to ask the user unlabelled', async () => {
    insertRow({ content: 'Which layout do you want?\n<question-form id="f1"></question-form>' });
    succeededRunLog();

    await classify([]);
    expect(storedRow().resultDeliveryState).toBeNull();
  });

  it('leaves a turn that ended with unfinished work unlabelled', async () => {
    insertRow();
    succeededRunLog([], { endedWithUnfinishedWork: true });

    await classify([projectFile('index.html', RUN_STARTED_AT + 500)]);
    expect(storedRow().resultDeliveryState).toBeNull();
  });

  it('never overwrites a classification an attached client already wrote', async () => {
    insertRow({ result_delivery_state: 'delivered', produced_files_json: '[]', trace_object_files_json: '[]' });
    succeededRunLog();

    await expect(classify([projectFile('index.html', RUN_STARTED_AT + 500)])).resolves.toBe(false);

    const row = storedRow();
    expect(row.resultDeliveryState).toBe('delivered');
    expect(row.producedFilesJson).toBe('[]');
  });

  it('never overwrites a file list an attached client already wrote', async () => {
    insertRow({ produced_files_json: '[]', trace_object_files_json: '[]' });
    succeededRunLog();

    await expect(classify([projectFile('index.html', RUN_STARTED_AT + 500)])).resolves.toBe(false);
    expect(storedRow().producedFilesJson).toBe('[]');
  });

  it('does not classify a chat-mode turn', async () => {
    insertRow({ session_mode: 'chat' });
    succeededRunLog();

    await expect(classify([projectFile('index.html', RUN_STARTED_AT + 500)])).resolves.toBe(false);
    expect(storedRow().producedFilesJson).toBeNull();
  });

  it('does not classify a run whose log records no succeeded terminal', async () => {
    insertRow();
    writeRunLog([
      { event: 'start', data: {} },
      { event: 'end', data: { status: 'failed', endedWithUnfinishedWork: false } },
    ]);

    await expect(classify([projectFile('index.html', RUN_STARTED_AT + 500)])).resolves.toBe(false);
    expect(storedRow().producedFilesJson).toBeNull();
  });

  it('does not classify a row that belongs to a different run', async () => {
    insertRow({ run_id: 'other-run' });
    succeededRunLog();

    await expect(classify([projectFile('index.html', RUN_STARTED_AT + 500)])).resolves.toBe(false);
    expect(storedRow().producedFilesJson).toBeNull();
  });

  it('classifies on the run text when the row carries no answer body', async () => {
    insertRow({ content: '' });
    succeededRunLog([
      { event: 'agent', data: { type: 'text_delta', delta: 'Reviewed the layout; ' } },
      { event: 'agent', data: { type: 'text_delta', delta: 'no changes were needed.' } },
    ]);

    await expect(classify([])).resolves.toBe(true);
    // Substantive text with no write attempt is a report, not a failed delivery.
    expect(storedRow().resultDeliveryState).toBeNull();
  });

  // The daemon exits inside the settle window and the timer never fires. The
  // replay is the daemon's next boot asking the same question from durable
  // state only.
  describe('replayUnattendedDeliveryClassifications', () => {
    function replay(files: ProjectFile[]) {
      return replayUnattendedDeliveryClassifications(
        db,
        {
          listProjectFiles: async () => files,
          previewStartedDuringRun: () => false,
          runsLogDir: tmpDir,
        },
        isRunTouchedProjectFile,
      );
    }

    it('classifies a succeeded design turn whose settle-window timer never fired', async () => {
      insertRow();
      succeededRunLog();

      await expect(replay([projectFile('index.html', RUN_STARTED_AT + 500)]))
        .resolves.toEqual({ candidates: 1, classified: 1 });
      expect(storedRow().resultDeliveryState).toBe('delivered');
      expect(JSON.parse(storedRow().producedFilesJson ?? '[]'))
        .toEqual([expect.objectContaining({ name: 'index.html' })]);
    });

    it('is idempotent: a second boot finds nothing left to decide', async () => {
      insertRow();
      succeededRunLog();
      const files = [projectFile('index.html', RUN_STARTED_AT + 500)];

      await replay(files);
      const afterFirst = storedRow();

      await expect(replay(files)).resolves.toEqual({ candidates: 0, classified: 0 });
      expect(storedRow()).toEqual(afterFirst);
    });

    it('never overwrites a verdict a client already wrote', async () => {
      insertRow({
        produced_files_json: '[]',
        result_delivery_state: 'no_result',
        trace_object_files_json: '[]',
      });
      succeededRunLog();

      await expect(replay([projectFile('index.html', RUN_STARTED_AT + 500)]))
        .resolves.toEqual({ candidates: 0, classified: 0 });
      expect(storedRow()).toEqual({
        producedFilesJson: '[]',
        resultDeliveryState: 'no_result',
        traceObjectFilesJson: '[]',
      });
    });

    it('leaves a run that did not succeed alone', async () => {
      insertRow({ run_status: 'failed' });
      writeRunLog([
        { event: 'start', data: {} },
        { event: 'end', data: { status: 'failed', endedWithUnfinishedWork: false } },
      ]);

      await expect(replay([projectFile('index.html', RUN_STARTED_AT + 500)]))
        .resolves.toEqual({ candidates: 0, classified: 0 });
      expect(storedRow().resultDeliveryState).toBeNull();
    });

    it('leaves a chat-mode turn alone', async () => {
      insertRow({ session_mode: 'chat' });
      succeededRunLog();

      await expect(replay([projectFile('index.html', RUN_STARTED_AT + 500)]))
        .resolves.toEqual({ candidates: 0, classified: 0 });
      expect(storedRow().resultDeliveryState).toBeNull();
    });

    it('declines a candidate whose run log did not survive the exit', async () => {
      insertRow();

      await expect(replay([projectFile('index.html', RUN_STARTED_AT + 500)]))
        .resolves.toEqual({ candidates: 1, classified: 0 });
      expect(storedRow().resultDeliveryState).toBeNull();
      expect(storedRow().producedFilesJson).toBeNull();
    });
  });
});
