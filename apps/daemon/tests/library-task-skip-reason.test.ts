// Red spec (W3G / PRD 3.7, item T-08): is the library ingest queue doing
// nothing, and can a reader tell WHY?
//
// The live daemon's `library_tasks` table holds 4,331 rows and every single
// one is `status = 'skipped'`. The reason lives only inside a hardcoded
// English progress line -- `recordEnrichmentTask`
// (apps/daemon/src/library.ts:474-492) pushes the literal
// "ai: caption/ocr/embedding skipped (no model configured)" onto every task
// unconditionally, with no model-configuration check anywhere and no other
// outcome path. So the claim in that line is an assertion the code never
// tests, and a reader querying the table has no machine-readable field to
// group or filter 4,331 skips by.
//
// This spec drives the real `POST /api/library/ingest` route against a real
// booted daemon (the harness apps/daemon/tests/
// library-ingest-concurrent-hash-race.test.ts already establishes), takes the
// `taskId` that route returns, and reads the row the daemon actually
// persisted straight out of its SQLite file.
//
// RED on main: the persisted row carries no skip-reason column at all, so the
// first assertion ("a skipped enrichment task must record a typed reason")
// fails on the column list.
import type http from 'node:http';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

/** The credentials `resolveEnrichmentSkipReason` reads (the same set
 * apps/daemon/src/memory-llm.ts:631,641 treats as "a model is reachable").
 * The test process inherits whatever the developer's shell exports, so both
 * cases below pin them explicitly -- otherwise which reason is recorded would
 * depend on the machine, not on the code. */
const MODEL_CREDENTIAL_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
] as const;

async function withModelCredentials<T>(present: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const saved = new Map<string, string | undefined>();
  for (const key of MODEL_CREDENTIAL_ENV_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  Object.assign(process.env, present);
  try {
    return await run();
  } finally {
    for (const key of MODEL_CREDENTIAL_ENV_KEYS) {
      const previous = saved.get(key);
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
}

type StartedServer = {
  url: string;
  server: http.Server;
  shutdown?: () => Promise<void> | void;
};

/** Reads the row the daemon really persisted, as columns -- deliberately
 * `SELECT *` rather than the typed read path, so the assertion is about what
 * the TABLE stores, not about what a DTO happens to project. */
function storedTaskColumns(taskId: string): Record<string, unknown> {
  const dataDir = process.env.OD_DATA_DIR;
  if (!dataDir) throw new Error('OD_DATA_DIR is required to read the library_tasks table directly');
  const sqlite = new Database(resolve(dataDir, 'app.sqlite'), { readonly: true });
  try {
    const rows = sqlite.prepare(`SELECT * FROM library_tasks WHERE id = ?`).all(taskId) as Array<
      Record<string, unknown>
    >;
    expect(rows, `exactly one library_tasks row per ingest (task ${taskId})`).toHaveLength(1);
    return rows[0]!;
  } finally {
    sqlite.close();
  }
}

describe('a skipped library enrichment task records a typed reason', () => {
  let started: StartedServer | null = null;

  afterEach(async () => {
    await Promise.resolve(started?.shutdown?.());
    if (started?.server) {
      await new Promise<void>((done) => started?.server.close(() => done()));
    }
    started = null;
  });

  /** One real ingest through the public route; returns the row the daemon
   * persisted for the task that ingest created. */
  async function ingestOnceAndReadTaskRow(): Promise<Record<string, unknown>> {
    started = (await startServer({ port: 0, returnServer: true })) as StartedServer;

    // Unique bytes so this ingest is always a fresh insert (a dedup would
    // return an existing asset and no new task) -- same shape as the
    // committed fixture in library-ingest-concurrent-hash-race.test.ts.
    const unique = randomUUID();
    const bytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from(`open-design-skip-reason-${unique}`, 'utf8'),
    ]);
    const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;

    const response = await fetch(`${started.url}/api/library/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl, filename: 'skip-reason.png', mime: 'image/png' }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { taskId?: string; deduped?: boolean };
    expect(body.deduped, 'the fixture bytes are unique, so this must be a fresh insert').toBe(false);
    expect(typeof body.taskId).toBe('string');

    const row = storedTaskColumns(body.taskId!);
    expect(row.status, 'the AI enrichment layer is unbuilt, so the task still skips').toBe('skipped');
    return row;
  }

  /** The prose the user reads must be generated FROM the stored reason, so
   * the two can never drift apart the way a hardcoded line can. */
  function expectProgressNamesTheReason(row: Record<string, unknown>): void {
    const progress = JSON.parse(String(row.progress_json)) as string[];
    expect(
      progress.some((line) => line.includes(String(row.skip_reason))),
      `the progress log must name the same reason the row stores; progress: ${JSON.stringify(progress)}`,
    ).toBe(true);
  }

  it('records no_model_configured when no caption/OCR/embedding credential is available', async () => {
    const row = await withModelCredentials({}, ingestOnceAndReadTaskRow);

    expect(
      Object.keys(row),
      'a skipped enrichment task must record WHY it skipped as a typed value, not only inside an ' +
        `English progress line; columns present: ${JSON.stringify(Object.keys(row))}`,
    ).toContain('skip_reason');
    expect(row.skip_reason, 'no model credential is reachable, so the AI layer had nothing to call').toBe(
      'no_model_configured',
    );
    expectProgressNamesTheReason(row);
  });

  it('records a DIFFERENT reason when a model credential IS available', async () => {
    const row = await withModelCredentials(
      { OPENAI_API_KEY: 'sk-library-skip-reason-fixture' },
      ingestOnceAndReadTaskRow,
    );

    expect(
      Object.keys(row),
      'a skipped enrichment task must record WHY it skipped as a typed value, not only inside an ' +
        `English progress line; columns present: ${JSON.stringify(Object.keys(row))}`,
    ).toContain('skip_reason');
    expect(
      row.skip_reason,
      'a model IS reachable here, so "no model configured" would be a false claim; the honest block ' +
        'is that this cut ships no enrichment pipeline',
    ).toBe('enrichment_not_implemented');
    expectProgressNamesTheReason(row);
  });
});
