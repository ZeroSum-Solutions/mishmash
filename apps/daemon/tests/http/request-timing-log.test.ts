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

/**
 * Reads the capture once it holds `expected` rows.
 *
 * The observer appends on `finish` through a serialised chain, so the write
 * lands shortly after the response the client already has.
 */
async function readRows(expected: number): Promise<RequestTimingRow[]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const rows = (await readFile(logPath(), 'utf8'))
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as RequestTimingRow);
      if (rows.length >= expected) return rows;
    } catch {
      // not written yet
    }
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error(`capture never reached ${expected} rows`);
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
  it('records one row per completed API request, healthy ones included', async () => {
    await start({ dataDir, value: '1' }, (app) => {
      app.get('/api/widgets/:id', (_req, res) => {
        res.json({ ok: true });
      });
    });

    await fetch(`${baseUrl}/api/widgets/abc`);
    await fetch(`${baseUrl}/api/widgets/def`);

    const rows = await readRows(2);
    // A p95 is made of the healthy observations the anomaly log throws away, so
    // a 200 well inside every budget has to reach this sink.
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

    const rows = await readRows(1);
    expect(rows.map((row) => row.status)).toEqual([500]);
  });

  it('groups by the Express route pattern and falls back to the path when none matched', async () => {
    await start({ dataDir, value: '1' }, (app) => {
      app.get('/api/projects/:id/files', (_req, res) => {
        res.json({ files: [] });
      });
    });

    await fetch(`${baseUrl}/api/projects/one/files`);
    await fetch(`${baseUrl}/api/nothing-here`);

    const rows = await readRows(2);
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

    const rows = await readRows(1);
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
    (res as unknown as { statusCode: number }).statusCode = 200;
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
    expect(warnings).toHaveLength(1);
  });
});
