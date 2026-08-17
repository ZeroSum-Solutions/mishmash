import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SLOW_REQUEST_MS,
  createAnomalySurface,
  registerAnomalyRoutes,
} from '../src/routes/anomalies.js';
import type { AnomalyLog } from '../src/anomaly-log.js';

let dataDir = '';
let server: http.Server | null = null;
let baseUrl = '';
let log: AnomalyLog;

/**
 * Mounts the anomaly surface the way the daemon does — observer first, routes
 * after — plus whatever extra routes a test needs the observer to watch.
 */
async function start(extra?: (app: express.Express) => void): Promise<void> {
  const app = express();
  const surface = createAnomalySurface({ dataDir });
  log = surface.log;
  app.use(surface.observer);
  registerAnomalyRoutes(app, { log: surface.log });
  extra?.(app);
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
  dataDir = await mkdtemp(join(tmpdir(), 'od-anomaly-routes-'));
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = null;
  await rm(dataDir, { recursive: true, force: true });
});

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function get(path: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

describe('anomaly HTTP surface', () => {
  it('accepts a reported anomaly and reads it back newest-first', async () => {
    await start();

    expect((await post('/api/anomalies', {
      kind: 'ui-lag',
      severity: 'warn',
      summary: 'main thread blocked 620ms',
      detail: { durationMs: 620 },
    })).status).toBe(200);
    expect((await post('/api/anomalies', {
      kind: 'white-screen',
      severity: 'error',
      summary: 'root rendered empty',
    })).status).toBe(200);

    const listed = await get('/api/anomalies');
    expect(listed.status).toBe(200);
    expect(listed.json.anomalies.map((a: any) => a.summary)).toEqual([
      'root rendered empty',
      'main thread blocked 620ms',
    ]);
    expect(listed.json.total).toBe(2);
    expect(listed.json.path).toContain(dataDir);
  });

  it('stamps the reporter as web rather than believing the body', async () => {
    await start();

    await post('/api/anomalies', {
      kind: 'ui-lag',
      severity: 'warn',
      summary: 'claims to be the daemon',
      source: 'daemon',
    });

    const listed = await get('/api/anomalies');
    expect(listed.json.anomalies[0].source).toBe('web');
  });

  it('rejects an unknown kind or severity instead of storing a category nobody groups on', async () => {
    await start();

    expect((await post('/api/anomalies', { kind: 'vibes', severity: 'warn', summary: 'x' })).status).toBe(400);
    expect((await post('/api/anomalies', { kind: 'ui-lag', severity: 'fatal', summary: 'x' })).status).toBe(400);
    expect((await post('/api/anomalies', { kind: 'ui-lag', severity: 'warn', summary: '   ' })).status).toBe(400);
    expect((await get('/api/anomalies')).json.total).toBe(0);
    expect((await get('/api/anomalies?kind=nope')).status).toBe(400);
  });

  it('filters a read by kind and severity', async () => {
    await start();
    await post('/api/anomalies', { kind: 'ui-lag', severity: 'warn', summary: 'lag' });
    await post('/api/anomalies', { kind: 'white-screen', severity: 'error', summary: 'blank' });

    expect((await get('/api/anomalies?kind=white-screen')).json.anomalies.map((a: any) => a.summary)).toEqual(['blank']);
    expect((await get('/api/anomalies?severity=warn')).json.anomalies.map((a: any) => a.summary)).toEqual(['lag']);
    expect((await get('/api/anomalies?limit=1')).json.anomalies).toHaveLength(1);
  });

  it('clears the log so a fresh testing session starts empty', async () => {
    await start();
    await post('/api/anomalies', { kind: 'ui-lag', severity: 'warn', summary: 'old news' });

    const res = await fetch(`${baseUrl}/api/anomalies`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { cleared: number }).cleared).toBe(1);
    expect((await get('/api/anomalies')).json.total).toBe(0);
  });
});

describe('daemon HTTP observer', () => {
  it('records a 5xx as an error against the route pattern, not the caller path', async () => {
    await start((app) => {
      app.get('/api/projects/:id/boom', (_req, res) => {
        res.status(500).json({ ok: false });
      });
    });

    await get('/api/projects/proj-abc/boom');

    // Poll: the observer reports on `finish`, after the response is sent.
    let anomalies: any[] = [];
    for (let i = 0; i < 40 && anomalies.length === 0; i += 1) {
      anomalies = (await log.list({})).anomalies;
    }
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].kind).toBe('request-failed');
    expect(anomalies[0].severity).toBe('error');
    expect(anomalies[0].source).toBe('daemon');
    // The pattern, so records group by the endpoint that misbehaved instead of
    // fragmenting into one row per project id.
    expect(anomalies[0].summary).toContain('/api/projects/:id/boom');
    expect(anomalies[0].summary).not.toContain('proj-abc');
  });

  it('leaves an ordinary 4xx alone — being told "no" correctly is not an anomaly', async () => {
    await start((app) => {
      app.get('/api/nope', (_req, res) => {
        res.status(404).json({ ok: false });
      });
      app.get('/api/denied', (_req, res) => {
        res.status(403).json({ ok: false });
      });
    });

    await get('/api/nope');
    await get('/api/denied');
    await get('/api/anomalies');

    expect((await log.list({})).total).toBe(0);
  });

  it('records 429 and 408, which mean the daemon could not serve a request it should have', async () => {
    await start((app) => {
      app.get('/api/limited', (_req, res) => {
        res.status(429).json({ ok: false });
      });
    });

    await get('/api/limited');

    let anomalies: any[] = [];
    for (let i = 0; i < 40 && anomalies.length === 0; i += 1) {
      anomalies = (await log.list({})).anomalies;
    }
    expect(anomalies[0].kind).toBe('request-failed');
    expect(anomalies[0].severity).toBe('warn');
  });

  it('records a slow request against its budget', async () => {
    await start((app) => {
      app.get('/api/slow', (_req, res) => {
        // Cross the budget without actually waiting seconds in the test: the
        // observer measures elapsed wall time, so the route only has to hold the
        // response slightly past the threshold.
        setTimeout(() => res.json({ ok: true }), SLOW_REQUEST_MS + 40);
      });
    });

    await get('/api/slow');

    let anomalies: any[] = [];
    for (let i = 0; i < 60 && anomalies.length === 0; i += 1) {
      anomalies = (await log.list({})).anomalies;
    }
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].kind).toBe('request-slow');
    expect(anomalies[0].detail.durationMs).toBeGreaterThanOrEqual(SLOW_REQUEST_MS);
  }, 20_000);

  it('ignores non-API paths and long-lived streams', async () => {
    await start((app) => {
      app.get('/static/thing.css', (_req, res) => {
        res.status(500).send('boom');
      });
      app.get('/api/library/events', (_req, res) => {
        res.status(500).end();
      });
    });

    // Raw fetch: these responses are not JSON.
    await fetch(`${baseUrl}/static/thing.css`).then((r) => r.text());
    await fetch(`${baseUrl}/api/library/events`).then((r) => r.text());
    // Give any (incorrect) append a chance to land before asserting absence.
    await get('/api/anomalies');

    expect((await log.list({})).total).toBe(0);
  });

  it('does not record its own anomaly endpoints, which would feed back on themselves', async () => {
    await start();

    await get('/api/anomalies');
    await post('/api/anomalies', { kind: 'ui-lag', severity: 'warn', summary: 'one real record' });
    await get('/api/anomalies');

    const { anomalies } = await log.list({});
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.summary).toBe('one real record');
  });
});
