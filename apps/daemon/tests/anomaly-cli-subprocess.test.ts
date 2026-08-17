// `od anomalies` — the real CLI subprocess chain against a real
// booted daemon. No mocked transport: this is the proof that the CLI surface
// required by the repository's UI/CLI dual-track rule actually reaches the same
// records the web reports into, which is what makes the anomaly log usable by an
// external agent driving `od` rather than rendering the UI.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const odBinPath = path.join(repoRoot, 'apps/daemon/bin/od.mjs');

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-anomaly-cli-'));
  process.env.OD_DATA_DIR = dataDir;
  const { startServer } = await import('../src/server.js');
  const started = (await startServer({ port: 0, host: '127.0.0.1', returnServer: true })) as {
    url: string;
    server: http.Server;
    shutdown?: () => Promise<void> | void;
  };
  baseUrl = started.url;
  daemon = started.server;
  daemonShutdown = started.shutdown;
});

afterEach(async () => {
  if (daemonShutdown) {
    await Promise.race([Promise.resolve(daemonShutdown()), new Promise((r) => setTimeout(r, 2000))]);
  }
  daemon?.closeAllConnections?.();
  await new Promise<void>((resolve) => daemon?.close(() => resolve()) ?? resolve());
  if (PREV_DATA_DIR === undefined) delete process.env.OD_DATA_DIR;
  else process.env.OD_DATA_DIR = PREV_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  // server.ts pins RUNTIME_DATA_DIR at module load from OD_DATA_DIR, so without
  // resetting the registry the next boot would reuse this test's data dir.
  register.clear();
  vi.resetModules();
});

const execFileAsync = promisify(execFile);

/**
 * Runs the real `od` binary as a child process.
 *
 * ASYNC on purpose. The daemon under test boots inside this worker process, so a
 * synchronous spawn (`execFileSync`) would block the very event loop that has to
 * answer the child's HTTP request — the child would wait for a response that
 * cannot be produced until the child exits. Awaiting an async spawn leaves the
 * loop free to serve it.
 */
async function odCli(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'node',
      [odBinPath, ...args, '--daemon-url', baseUrl],
      { env: { ...process.env, OD_DATA_DIR: dataDir }, encoding: 'utf8', timeout: 60_000 },
    );
    return { status: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { status: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

async function report(body: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}/api/anomalies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
}

describe('od anomalies — real CLI subprocess chain', () => {
  it('reads back what was reported over HTTP, filters it, and clears it', async () => {
    await report({ kind: 'ui-lag', severity: 'warn', summary: 'main thread blocked for 640ms' });
    await report({ kind: 'white-screen', severity: 'error', summary: 'app did not mount' });

    const json = await odCli(['anomalies', '--json']);
    expect(json.status, json.stderr).toBe(0);
    const payload = JSON.parse(json.stdout) as {
      anomalies: Array<{ kind: string; severity: string; summary: string; source: string }>;
      total: number;
      path: string;
    };
    // Newest first, and both records made it through the real HTTP + file path.
    expect(payload.anomalies.map((a) => a.kind)).toEqual(['white-screen', 'ui-lag']);
    expect(payload.total).toBe(2);
    expect(payload.path.startsWith(dataDir)).toBe(true);
    expect(payload.anomalies.every((a) => a.source === 'web')).toBe(true);

    // Filtering happens server-side; the flag has to reach it.
    const filtered = await odCli(['anomalies', '--kind', 'white-screen', '--json']);
    expect(filtered.status).toBe(0);
    expect(
      (JSON.parse(filtered.stdout) as { anomalies: Array<{ summary: string }> }).anomalies,
    ).toHaveLength(1);

    // The human-readable form is the default, and it groups by kind.
    const human = await odCli(['anomalies']);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain('white-screen');
    expect(human.stdout).toContain('app did not mount');
    expect(human.stdout).toContain('2 of 2 anomalies');

    const cleared = await odCli(['anomalies', '--clear', '--json']);
    expect(cleared.status).toBe(0);
    expect((JSON.parse(cleared.stdout) as { cleared: number }).cleared).toBe(2);

    const empty = await odCli(['anomalies']);
    expect(empty.status).toBe(0);
    expect(empty.stdout).toContain('No anomalies recorded.');
  }, 120_000);

  it('advertises its flags in its own help, and diagnostics points at it', async () => {
    const help = await odCli(['anomalies', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('od anomalies');
    // `--json` is required of every CLI capability by the dual-track rule, so
    // the help must offer it.
    expect(help.stdout).toContain('--json');
    expect(help.stdout).toContain('--clear');

    // The diagnostics bundle carries the same records, so its help must send a
    // reader here rather than leaving the two surfaces unlinked.
    const diagnosticsHelp = await odCli(['diagnostics', '--help']);
    expect(diagnosticsHelp.status).toBe(0);
    expect(diagnosticsHelp.stdout).toContain('"od anomalies --help"');
  }, 60_000);
});
