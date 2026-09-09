// FU-50: `GET /api/projects` derives each project's display status from the
// LATEST run row only, but `listLatestProjectRunStatuses` used to SELECT
// `events_json` for EVERY run row in the database and throw all but one per
// project away. Persisted run events are large (the live team data root
// carried 73 MB across 190 run rows on 2026-09-09), so every projects-list
// call materialised tens of megabytes of JSON strings in Node and blocked the
// daemon's event loop for most of a second -- and every other route's API
// wait stalled behind it. The listing must read event payloads for the
// latest row per project and nothing else.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import {
  closeDatabase,
  insertConversation,
  insertProject,
  listLatestProjectRunStatuses,
  openDatabase,
  upsertMessage,
} from '../src/db.js';

const tempDirs: string[] = [];

afterEach(() => {
  closeDatabase();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createDb(): Database.Database {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-project-status-cost-'));
  tempDirs.push(dir);
  return openDatabase(dir, { dataDir: path.join(dir, '.od') });
}

// One persisted TodoWrite-shaped event padded to ~1 MB, the order of size a
// long agent run leaves behind.
function bulkyEvents(marker: string): unknown[] {
  return [
    {
      kind: 'tool_use',
      id: `tw-${marker}`,
      name: 'TodoWrite',
      input: { todos: [{ content: marker, status: 'completed' }] },
      padding: 'x'.repeat(1_000_000),
    },
  ];
}

const OLD_RUNS_PER_PROJECT = 60;
const PROJECTS = 2;
// Red on the previous query: 120 rows x ~1 MB are pulled into Node on every
// call (measured ~250 ms on the 2026-09-09 Mac; 73 MB of live events cost
// 203 ms per call in isolation and ~800 ms inside the loaded daemon). Green
// reads two rows' events: single-digit milliseconds. The bound sits well
// inside that gap so machine load cannot turn a green tree red.
const MAX_MS_PER_CALL = 100;

describe('listLatestProjectRunStatuses event-payload cost (FU-50)', () => {
  it('reads persisted events for the latest run row per project only', () => {
    const db = createDb();
    for (let p = 0; p < PROJECTS; p += 1) {
      const projectId = `project-${p}`;
      insertProject(db, { id: projectId, name: projectId, createdAt: 1, updatedAt: 1 });
      insertConversation(db, {
        id: `${projectId}-conv`,
        projectId,
        title: null,
        createdAt: 1,
        updatedAt: 1,
      });
      for (let r = 0; r < OLD_RUNS_PER_PROJECT; r += 1) {
        upsertMessage(db, `${projectId}-conv`, {
          id: `${projectId}-old-${r}`,
          role: 'assistant',
          content: 'older run',
          runId: `${projectId}-old-run-${r}`,
          runStatus: 'succeeded',
          endedAt: 100 + r,
          events: bulkyEvents(`old-${r}`),
        });
      }
      // The latest row is small and ended with unfinished work, so the
      // derivation must still read ITS events and answer `incomplete`.
      upsertMessage(db, `${projectId}-conv`, {
        id: `${projectId}-latest`,
        role: 'assistant',
        content: 'latest run',
        runId: `${projectId}-latest-run`,
        runStatus: 'succeeded',
        endedAt: 5_000,
        events: [
          {
            kind: 'tool_use',
            id: 'tw-latest',
            name: 'TodoWrite',
            input: { todos: [{ content: 'still open', status: 'in_progress' }] },
          },
        ],
      });
    }

    // Warm SQLite's page cache so the measurement is about what the query
    // materialises, not about the first disk read.
    listLatestProjectRunStatuses(db);

    const started = performance.now();
    const calls = 3;
    let statuses = listLatestProjectRunStatuses(db);
    for (let i = 1; i < calls; i += 1) statuses = listLatestProjectRunStatuses(db);
    const perCallMs = (performance.now() - started) / calls;

    for (let p = 0; p < PROJECTS; p += 1) {
      const status = statuses.get(`project-${p}`);
      expect(status?.runId).toBe(`project-${p}-latest-run`);
      expect(status?.updatedAt).toBe(5_000);
      expect(status?.value).toBe('incomplete');
    }
    expect(statuses.size).toBe(PROJECTS);
    expect(perCallMs).toBeLessThan(MAX_MS_PER_CALL);
  });

  it('re-derives a project status when its latest run row is rewritten', () => {
    const db = createDb();
    insertProject(db, { id: 'p', name: 'p', createdAt: 1, updatedAt: 1 });
    insertConversation(db, { id: 'p-conv', projectId: 'p', title: null, createdAt: 1, updatedAt: 1 });
    const write = (todos: Array<{ content: string; status: string }>, endedAt: number) =>
      upsertMessage(db, 'p-conv', {
        id: 'p-latest',
        role: 'assistant',
        content: 'latest run',
        runId: 'p-run',
        runStatus: 'succeeded',
        endedAt,
        events: [{ kind: 'tool_use', id: 'tw-1', name: 'TodoWrite', input: { todos } }],
      });

    write([{ content: 'still open', status: 'in_progress' }], 10);
    expect(listLatestProjectRunStatuses(db).get('p')?.value).toBe('incomplete');

    // Same row id, same end time, new events: the remembered derivation must
    // not survive the rewrite.
    write([{ content: 'still open', status: 'completed' }], 10);
    expect(listLatestProjectRunStatuses(db).get('p')?.value).toBe('succeeded');

    // A newer run row for the same project takes over.
    upsertMessage(db, 'p-conv', {
      id: 'p-newer',
      role: 'assistant',
      content: 'newer run',
      runId: 'p-run-2',
      runStatus: 'failed',
      endedAt: 20,
    });
    const newer = listLatestProjectRunStatuses(db).get('p');
    expect(newer?.value).toBe('failed');
    expect(newer?.runId).toBe('p-run-2');
  });
});
