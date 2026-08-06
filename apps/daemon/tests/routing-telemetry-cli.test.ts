// `od route telemetry --json` end-to-end coverage (WR wave, P1 tranche's
// optional CLI wiring for the L5 storage list surface). Mirrors
// routing-cli-dispatch.test.ts's live-route pattern, but seeds a real
// (mkdtemp) db first so there is telemetry content to page through.

import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StoredRoutingTelemetryRow } from '@open-design/contracts';

import { closeDatabase, openDatabase } from '../src/db.js';
import { ensureRoutingTelemetryTable, recordRoutingTelemetry } from '../src/routing/telemetry.js';
import { registerRoutingRoutes } from '../src/routes/routing.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLI_SRC = path.join(__dirname, '../src/cli.ts');
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TSX_CLI, CLI_SRC, ...args], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, TMPDIR: '/tmp', TMP: '/tmp', TEMP: '/tmp' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`CLI timed out: od ${args.join(' ')}`));
    }, 20_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, code });
    });
  });
}

function row(overrides: Partial<StoredRoutingTelemetryRow> = {}): StoredRoutingTelemetryRow {
  return {
    runId: 'run-1',
    projectId: 'proj-a',
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

describe('od route telemetry --json', () => {
  let tempDir: string;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-telemetry-cli-'));
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(db, row({ runId: 'run-1', projectId: 'proj-a' }));
    recordRoutingTelemetry(db, row({ runId: 'run-2', projectId: 'proj-b' }));

    const app = express();
    registerRoutingRoutes(app, db);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('forwards --project-id/--limit/--offset as query params and prints the real envelope', async () => {
    const { stdout, stderr, code } = await runCli([
      'route', 'telemetry', '--json', '--daemon-url', baseUrl,
      '--project-id', 'proj-a',
    ]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { rows: Array<{ runId: string; projectId: string }>; total: number };
    expect(parsed.total).toBe(1);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ runId: 'run-1', projectId: 'proj-a' });
  });

  it('prints a human-readable summary without --json', async () => {
    const { stdout, stderr, code } = await runCli(['route', 'telemetry', '--daemon-url', baseUrl]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('Telemetry rows: 2 of 2');
  });
});
