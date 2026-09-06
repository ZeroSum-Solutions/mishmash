import http from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_REQUEST_TIMING_LOG_PATH,
  createRequestTimingObserver,
  resolveRequestTimingLogPath,
  type RequestTimingEndRow,
  type RequestTimingRow,
} from '../../src/http/request-timing-log.js';

let dataDir = '';
let server: http.Server | null = null;
let baseUrl = '';

/** Mounts the observer the way the daemon does — before every route. */
async function start(
  options: Parameters<typeof createRequestTimingObserver>[0],
  routes: (app: express.Express) => void,
): Promise<void> {
  const app = express();
  app.use(createRequestTimingObserver(options));
  routes(app);
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server?.address();
      if (!addr || typeof addr !== 'object') {
        reject(new Error('could not bind'));
        return;
      }
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
    server?.on('error', reject);
  });
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'od-request-timing-'));
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
  await rm(dataDir, { recursive: true, force: true });
});

const logPath = (): string => join(dataDir, DEFAULT_REQUEST_TIMING_LOG_PATH);

/** Whatever the capture holds right now, or an empty list when it holds nothing. */
async function rowsSoFar(): Promise<RequestTimingRow[]> {
  try {
    return (await readFile(logPath(), 'utf8'))
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as RequestTimingRow);
  } catch {
    return [];
  }
}

/**
 * Reads the capture once it holds `expected` rows, or returns what it does hold.
 *
 * Returning rather than throwing on a timeout is deliberate: the bug this file
 * pins is a request that reaches the log with NO row at all, and a helper that
 * threw would report it as harness noise instead of as the missing-row assertion
 * it is.
 *
 * The observer appends through a serialised chain, so a write lands shortly
 * after the response the client already has.
 */
async function readRows(expected: number): Promise<RequestTimingRow[]> {
  let rows: RequestTimingRow[] = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    rows = await rowsSoFar();
    if (rows.length >= expected) return rows;
    await new Promise((done) => setTimeout(done, 10));
  }
  return rows;
}

/**
 * The terminal rows only.
 *
 * Each request writes two lines — an attempt at entry and its terminal status —
 * so a test about what a request RESULTED in reads this, and a test about the
 * journal itself reads the raw rows.
 */
function endRows(rows: readonly RequestTimingRow[]): RequestTimingEndRow[] {
  return rows.filter((row): row is RequestTimingEndRow => row.phase === 'end');
}

describe('request timing log path', () => {
  it('stays off when the env value is absent, empty, or explicitly false', () => {
    for (const value of [undefined, '', '   ', '0', 'false', 'off', 'no']) {
      expect(resolveRequestTimingLogPath({ dataDir, value })).toBeNull();
    }
  });

  it('resolves an enable token to the default path under the data root', () => {
    expect(resolveRequestTimingLogPath({ dataDir, value: '1' })).toBe(logPath());
  });

  it('treats any other value as a path relative to the data root', () => {
    expect(resolveRequestTimingLogPath({ dataDir, value: 'capture/w3.jsonl' })).toBe(
      join(dataDir, 'capture', 'w3.jsonl'),
    );
  });

  it('refuses an absolute path or one that climbs out of the data root', () => {
    // The daemon data-directory contract: daemon-owned data stays under the
    // resolved root. A value that would escape turns the capture off rather
    // than writing outside it.
    expect(resolveRequestTimingLogPath({ dataDir, value: '/tmp/anywhere.jsonl' })).toBeNull();
    expect(resolveRequestTimingLogPath({ dataDir, value: '../escape.jsonl' })).toBeNull();
    expect(resolveRequestTimingLogPath({ dataDir, value: 'a/../../escape.jsonl' })).toBeNull();
  });
});

describe('request timing observer', () => {
  // Superseded. This case used to claim one row per COMPLETED request and assert
  // `rows).toHaveLength(2)` for two requests. That assertion was the defect
  // written down: a sink that only writes on completion cannot record a request
  // that never completed, which is the whole of W3-R1-F2. The observation the
  // case was protecting — a healthy 200 reaches this sink, because a p95 is made
  // of exactly the rows the anomaly log throws away — is kept and now reads off
  // the terminal row of the pair.
  it('records one terminal row per completed API request, healthy ones included', async () => {
    await start({ dataDir, value: '1' }, (app) => {
      app.get('/api/widgets/:id', (_req, res) => {
        res.json({ ok: true });
      });
    });

    await fetch(`${baseUrl}/api/widgets/abc`);
    await fetch(`${baseUrl}/api/widgets/def`);

    const rows = endRows(await readRows(4));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ method: 'GET', route: '/api/widgets/:id', status: 200 });
    expect(rows[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(Date.parse(rows[0]?.atUtc ?? ''))).toBe(true);
  });

  it('records a failing request rather than dropping it', async () => {
    await start({ dataDir, value: '1' }, (app) => {
      app.get('/api/broken', (_req, res) => {
        res.status(500).json({ ok: false });
      });
    });

    await fetch(`${baseUrl}/api/broken`);

    const rows = endRows(await readRows(2));
    expect(rows.map((row) => row.status)).toEqual([500]);
  });

  it('journals an attempt at entry and pairs it with its terminal row', async () => {
    await start({ dataDir, value: '1' }, (app) => {
      app.get('/api/widgets/:id', (_req, res) => {
        res.json({ ok: true });
      });
    });

    await fetch(`${baseUrl}/api/widgets/abc`);

    const rows = await readRows(2);
    // The entry row is the only durable evidence a request was ever made: a
    // daemon killed mid-request writes no terminal row at all, and without the
    // attempt beside it that request leaves the capture with no trace.
    expect(rows.map((row) => row.phase)).toEqual(['start', 'end']);
    expect(rows[0]).toMatchObject({ method: 'GET', route: '/api/widgets/abc' });
    expect(rows[0]?.id).toBe(rows[1]?.id);
    expect(rows[1]).toMatchObject({ route: '/api/widgets/:id', status: 200 });
  });

  it('finalises a request the client aborted with a terminal status of 0', async () => {
    let release = (): void => {};
    await start({ dataDir, value: '1' }, (app) => {
      app.get('/api/slow', (_req, res) => {
        // Held open past the abort, so nothing is ever sent to the client.
        release = () => res.json({ ok: true });
      });
    });

    const controller = new AbortController();
    const inflight = fetch(`${baseUrl}/api/slow`, { signal: controller.signal });
    await new Promise((done) => setTimeout(done, 50));
    controller.abort();
    await inflight.catch(() => undefined);

    const rows = await readRows(2);
    // The condition 3D fixes and 3E characterises: the request never answered.
    // A capture that cannot see it reports the route on its completions alone,
    // so any number of never-answered attempts sits invisible beside them.
    expect(rows.map((row) => row.phase)).toEqual(['start', 'end']);
    const [terminal] = endRows(rows);
    expect(terminal?.status).toBe(0);
    expect(terminal?.durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(Date.parse(terminal?.atUtc ?? ''))).toBe(true);
    release();
  });

  it('keeps the real status when a client drops a response that already began', async () => {
    let release = (): void => {};
    await start({ dataDir, value: '1' }, (app) => {
      app.get('/api/runs/:id/events', (_req, res) => {
        // The long-lived SSE shape: headers and a first frame go out, then the
        // client walks away. It is excluded from judgement, but its rows must
        // still be well-formed — calling a stream that served every frame it was
        // asked for `unreachable` would be a lie about the route.
        res.setHeader('Content-Type', 'text/event-stream');
        res.flushHeaders();
        res.write('data: {}\n\n');
        release = () => res.end();
      });
    });

    const controller = new AbortController();
    const inflight = fetch(`${baseUrl}/api/runs/abc/events`, { signal: controller.signal });
    await inflight.catch(() => undefined);
    await new Promise((done) => setTimeout(done, 50));
    controller.abort();

    const rows = await readRows(2);
    const [terminal] = endRows(rows);
    expect(terminal?.status).toBe(200);
    expect(terminal?.route).toBe('/api/runs/:id/events');
    release();
  });

  it('writes exactly one terminal row per attempt, never two', async () => {
    await start({ dataDir, value: '1' }, (app) => {
      app.get('/api/ok', (_req, res) => {
        res.json({ ok: true });
      });
    });

    await fetch(`${baseUrl}/api/ok`);
    // `close` fires for a completed response as well as for a dropped one, so a
    // finaliser without a once-only latch would double-count every healthy
    // request and inflate the very denominator the capture is judged on.
    await new Promise((done) => setTimeout(done, 100));

    const rows = await rowsSoFar();
    expect(rows.map((row) => row.phase)).toEqual(['start', 'end']);
  });

  it('groups by the Express route pattern and falls back to the path when none matched', async () => {
    await start({ dataDir, value: '1' }, (app) => {
      app.get('/api/projects/:id/files', (_req, res) => {
        res.json({ files: [] });
      });
    });

    await fetch(`${baseUrl}/api/projects/one/files`);
    await fetch(`${baseUrl}/api/nothing-here`);

    const rows = endRows(await readRows(4));
    expect(rows.map((row) => row.route)).toEqual(['/api/projects/:id/files', '/api/nothing-here']);
  });

  it('ignores everything outside the API surface', async () => {
    await start({ dataDir, value: '1' }, (app) => {
      app.get('/assets/logo.svg', (_req, res) => {
        res.type('svg').send('<svg />');
      });
      app.get('/api/ok', (_req, res) => {
        res.json({ ok: true });
      });
    });

    await fetch(`${baseUrl}/assets/logo.svg`);
    await fetch(`${baseUrl}/api/ok`);

    const rows = endRows(await readRows(2));
    expect(rows.map((row) => row.route)).toEqual(['/api/ok']);
  });

  it('writes nothing and stays a pass-through when the capture is off', async () => {
    await start({ dataDir, value: undefined }, (app) => {
      app.get('/api/ok', (_req, res) => {
        res.json({ ok: true });
      });
    });

    const res = await fetch(`${baseUrl}/api/ok`);
    expect(res.status).toBe(200);
    await new Promise((done) => setTimeout(done, 50));
    await expect(readFile(logPath(), 'utf8')).rejects.toThrow();
  });

  it('says nothing when the operator turned the capture off on purpose', async () => {
    const warnings: string[] = [];
    await start({ dataDir, value: '0', warn: (message) => warnings.push(message) }, (app) => {
      app.get('/api/ok', (_req, res) => {
        res.json({ ok: true });
      });
    });

    await fetch(`${baseUrl}/api/ok`);

    // A diagnostic for a deliberate off is a false alarm: it reads as a
    // misconfiguration the operator has to go and check.
    expect(warnings).toEqual([]);
  });

  it('warns and stays off when the env value would escape the data root', async () => {
    const warnings: string[] = [];
    await start(
      { dataDir, value: '/etc/somewhere.jsonl', warn: (message) => warnings.push(message) },
      (app) => {
        app.get('/api/ok', (_req, res) => {
          res.json({ ok: true });
        });
      },
    );

    const res = await fetch(`${baseUrl}/api/ok`);
    expect(res.status).toBe(200);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('OD_REQUEST_TIMING_LOG');
  });

  it('reports a failed append instead of raising it at the request', async () => {
    const warnings: unknown[] = [];
    const observer = createRequestTimingObserver({
      dataDir,
      value: '1',
      // A gateway that cannot mint its capability stands in for a full disk or
      // a read-only data root: the capture must degrade, never break a response.
      createGateway: (() => ({
        runtimeData: () => Promise.reject(new Error('no capability')),
      })) as never,
      warn: (_message, detail) => warnings.push(detail),
    });

    const res = new EventEmitter() as unknown as express.Response;
    (res as unknown as { statusCode: number; headersSent: boolean }).statusCode = 200;
    (res as unknown as { headersSent: boolean }).headersSent = true;
    const req = {
      method: 'GET',
      path: '/api/ok',
      route: { path: '/api/ok' },
    } as unknown as express.Request;
    let nextCalled = false;
    observer(req, res, () => {
      nextCalled = true;
    });
    (res as unknown as EventEmitter).emit('finish');
    for (let i = 0; i < 20; i += 1) await new Promise((done) => setImmediate(done));

    expect(nextCalled).toBe(true);
    // One per journalled phase: the entry attempt and its terminal row.
    expect(warnings).toHaveLength(2);
  });
});
