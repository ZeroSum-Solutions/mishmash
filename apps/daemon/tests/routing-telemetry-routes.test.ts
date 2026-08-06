// HTTP-level coverage for GET /api/routing/meters (real aggregates, not the
// P0 empty stub) and GET /api/routing/telemetry (WR wave, P1 tranche).
// Mirrors routing-routes.test.ts's bare-express harness, but seeds a real
// (mkdtemp) daemon db first so registerRoutingRoutes(app, db) has telemetry
// to aggregate/list.

import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isRoutingMetersResponse,
  isRoutingTelemetryListResponse,
  type StoredRoutingTelemetryRow,
} from '@open-design/contracts';

import { closeDatabase, openDatabase } from '../src/db.js';
import { ensureRoutingTelemetryTable, recordRoutingTelemetry } from '../src/routing/telemetry.js';
import { registerRoutingRoutes } from '../src/routes/routing.js';

function row(overrides: Partial<StoredRoutingTelemetryRow> = {}): StoredRoutingTelemetryRow {
  return {
    runId: 'run-1',
    projectId: 'proj-1',
    attempt: 0,
    stage: 'chat',
    templateId: null,
    designSystem: null,
    routedModel: 'claude-sonnet-5',
    observedModel: 'claude-sonnet-5',
    routedLane: 'claude-code-oauth',
    observedLane: 'claude-code-oauth',
    tokens: { input: 100, output: 50, cacheReadInput: 0 },
    cacheHits: 0,
    latencyMs: 1000,
    costUsd: 0.01,
    costEstimated: true,
    gateOutcomes: {},
    escalated: false,
    policyVersion: 1,
    createdAt: '2026-08-05T00:00:00.000Z',
    recordedAt: '2026-08-05T00:00:00.000Z',
    ...overrides,
  };
}

describe('GET /api/routing/meters -- real aggregates from telemetry', () => {
  let tempDir: string;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-meters-routes-'));
  });

  afterEach(async () => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  async function startServer(db: ReturnType<typeof openDatabase>) {
    const app = express();
    registerRoutingRoutes(app, db);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns per-lane aggregates once telemetry rows exist, replacing the P0 always-empty stub', async () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(db, row({ runId: 'a', routedLane: 'claude-code-oauth' }));
    recordRoutingTelemetry(db, row({ runId: 'b', routedLane: 'moonshot', observedLane: 'moonshot' }));
    await startServer(db);

    const resp = await fetch(`${baseUrl}/api/routing/meters`);
    expect(resp.status).toBe(200);
    const body: unknown = await resp.json();
    expect(isRoutingMetersResponse(body)).toBe(true);
    const { laneMeters } = body as { laneMeters: Array<{ lane: string; runsRouted: number }> };
    expect(laneMeters.length).toBeGreaterThanOrEqual(2);
    expect(laneMeters.find((m) => m.lane === 'claude-code-oauth')?.runsRouted).toBe(1);
    expect(laneMeters.find((m) => m.lane === 'moonshot')?.runsRouted).toBe(1);
  });

  it('respects ?windowMs= to scope the aggregation', async () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    recordRoutingTelemetry(db, row({ runId: 'old', routedLane: 'claude-code-oauth', createdAt: old }));
    await startServer(db);

    const resp = await fetch(`${baseUrl}/api/routing/meters?windowMs=${24 * 60 * 60 * 1000}`);
    const body = (await resp.json()) as { laneMeters: Array<{ lane: string }> };
    expect(body.laneMeters.find((m) => m.lane === 'claude-code-oauth')).toBeUndefined();
  });

  it('returns an empty laneMeters array when registered with no db (graceful degradation)', async () => {
    const app = express();
    registerRoutingRoutes(app);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const resp = await fetch(`${baseUrl}/api/routing/meters`);
    const body = (await resp.json()) as { laneMeters: unknown[] };
    expect(body.laneMeters).toEqual([]);
  });

  // --- Sol review MED-5: malformed query bounds are a 400, not a silent default ---
  it('returns 400 with the house error shape for a non-numeric ?windowMs=', async () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    await startServer(db);

    const resp = await fetch(`${baseUrl}/api/routing/meters?windowMs=not-a-number`);
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('invalid-query-param');
    expect(body.error.message).toContain('windowMs');
  });

  it('returns 400 for a negative ?windowMs=', async () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    await startServer(db);

    const resp = await fetch(`${baseUrl}/api/routing/meters?windowMs=-5`);
    expect(resp.status).toBe(400);
  });
});

describe('GET /api/routing/telemetry -- filtered, paginated list', () => {
  let tempDir: string;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-telemetry-routes-'));
  });

  afterEach(async () => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('lists telemetry rows filtered by projectId, paginated', async () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(db, row({ runId: 'run-1', projectId: 'proj-a' }));
    recordRoutingTelemetry(db, row({ runId: 'run-2', projectId: 'proj-a' }));
    recordRoutingTelemetry(db, row({ runId: 'run-3', projectId: 'proj-b' }));

    const app = express();
    registerRoutingRoutes(app, db);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const resp = await fetch(`${baseUrl}/api/routing/telemetry?projectId=proj-a&limit=1&offset=0`);
    expect(resp.status).toBe(200);
    const body: unknown = await resp.json();
    expect(isRoutingTelemetryListResponse(body)).toBe(true);
    const response = body as { rows: Array<{ runId: string }>; total: number; limit: number; offset: number };
    expect(response.total).toBe(2);
    expect(response.limit).toBe(1);
    expect(response.rows).toHaveLength(1);
  });

  // --- Sol review MED-5: malformed query bounds are a 400, not a silent default ---
  it.each([
    ['sinceMs', 'not-a-number'],
    ['untilMs', 'not-a-number'],
    ['limit', 'abc'],
    ['limit', '0'], // limit must be >= 1
    ['offset', '-1'],
  ])('returns 400 with the house error shape for a malformed ?%s=%s', async (param, value) => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    const app = express();
    registerRoutingRoutes(app, db);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const resp = await fetch(`${baseUrl}/api/routing/telemetry?${param}=${value}`);
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('invalid-query-param');
    expect(body.error.message).toContain(param);
  });
});
