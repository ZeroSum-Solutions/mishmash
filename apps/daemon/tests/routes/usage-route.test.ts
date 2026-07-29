// NM-20 / C1-8 / C1-9 -- HTTP wiring for the cost & usage meter. The pricing
// and aggregation logic itself is covered by
// apps/daemon/tests/runtimes/usage-tracking.test.ts; this file only proves
// the routes are reachable, return the right shape, and 404 correctly.
import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../../src/server.js';
import { closeDatabase, openDatabase } from '../../src/db.js';
import { ensureUsageTable, recordRunUsage, type RunUsageRecord } from '../../src/runtimes/usage-tracking.js';

describe('usage routes', () => {
  let server: http.Server;
  let baseUrl: string;
  let db: ReturnType<typeof openDatabase>;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    db = openDatabase(dataDir, { dataDir });
    ensureUsageTable(db);
  });

  afterAll(async () => {
    closeDatabase();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function createProject(): Promise<string> {
    const resp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'usage route test' }),
    });
    const data = (await resp.json()) as { project: { id: string } };
    return data.project.id;
  }

  const pricedRecord: RunUsageRecord = {
    requested: 'claude-sonnet-4-5',
    resolved: 'claude-sonnet-4-5',
    reported: 'claude-sonnet-4-5',
    displayState: 'verified',
    model: 'claude-sonnet-4-5',
    inputTokensEffective: 1000,
    outputTokens: 200,
    cacheReadInputTokens: 0,
    costUsd: 0.006,
    pricingVersion: 'estimated',
  };

  const unpricedRecord: RunUsageRecord = {
    requested: 'Gemini 3.1 Pro (High)',
    resolved: 'Gemini 3.1 Pro (High)',
    reported: null,
    displayState: 'unverified',
    model: 'Gemini 3.1 Pro (High)',
    inputTokensEffective: null,
    outputTokens: null,
    cacheReadInputTokens: null,
    costUsd: null,
    pricingVersion: 'unavailable',
  };

  it('GET /api/projects/:id/usage returns a summary + per-run breakdown', async () => {
    const projectId = await createProject();
    recordRunUsage(db, {
      runId: 'run-usage-a',
      projectId,
      conversationId: null,
      agentId: 'claude',
      record: pricedRecord,
    });

    const resp = await fetch(`${baseUrl}/api/projects/${projectId}/usage`);
    const json = (await resp.json()) as {
      projectId: string;
      currency: string;
      totalCostUsd: number | null;
      runCount: number;
      pricedRunCount: number;
      runs: Array<{ runId: string; costUsd: number | null }>;
    };

    expect(resp.status).toBe(200);
    expect(json.projectId).toBe(projectId);
    expect(json.currency).toBe('USD');
    expect(json.totalCostUsd).toBeCloseTo(0.006, 6);
    expect(json.runCount).toBe(1);
    expect(json.pricedRunCount).toBe(1);
    expect(json.runs).toHaveLength(1);
    expect(json.runs[0]?.runId).toBe('run-usage-a');
    expect(json.runs[0]?.costUsd).toBeCloseTo(0.006, 6);
  });

  it('GET /api/projects/:id/usage 404s for an unknown project', async () => {
    const resp = await fetch(`${baseUrl}/api/projects/does-not-exist-${Date.now()}/usage`);
    expect(resp.status).toBe(404);
  });

  it('GET /api/runs/:id/usage returns the single run usage record', async () => {
    const projectId = await createProject();
    recordRunUsage(db, {
      runId: 'run-usage-b',
      projectId,
      conversationId: null,
      agentId: 'antigravity',
      record: unpricedRecord,
    });

    const resp = await fetch(`${baseUrl}/api/runs/run-usage-b/usage`);
    const json = (await resp.json()) as { runId: string; costUsd: number | null; pricingVersion: string };

    expect(resp.status).toBe(200);
    expect(json.runId).toBe('run-usage-b');
    expect(json.costUsd).toBeNull();
    expect(json.pricingVersion).toBe('unavailable');
  });

  it('GET /api/runs/:id/usage 404s when no usage has been recorded for that run', async () => {
    const resp = await fetch(`${baseUrl}/api/runs/no-such-run-${Date.now()}/usage`);
    expect(resp.status).toBe(404);
  });
});
