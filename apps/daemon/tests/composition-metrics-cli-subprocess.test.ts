// `od composition-metrics` — the real CLI subprocess chain against a real
// booted daemon. No mocked transport: this is the proof the CLI reads back
// the exact same record the web preview's bridge reports, per AGENTS.md's
// "Capability exposure (UI/CLI dual-track)" rule. The CLI itself never
// measures anything (it has no browser) — it only ever reads what a
// preview already reported, which is what this test proves end to end.

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
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-composition-metrics-cli-'));
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
  register.clear();
  vi.resetModules();
});

const execFileAsync = promisify(execFile);

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

function fakeMetrics() {
  return {
    sectionCount: 6,
    outOfFlowElementCount: 2,
    transformedElementCount: 1,
    distinctSectionBackgroundCount: 3,
    distinctSectionWidthCount: 2,
    fullBleedAgainstContained: true,
    bodyFontSizePx: 14,
    maxDisplayFontSizePx: 140,
    displayToBodyFontRatio: 10,
    measuredAt: new Date().toISOString(),
  };
}

async function reportMetrics(projectId: string, file: string, metrics: unknown): Promise<void> {
  const res = await fetch(`${baseUrl}/api/composition-metrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, file, metrics }),
  });
  expect(res.status).toBe(200);
}

describe('od composition-metrics — real CLI subprocess chain', () => {
  it('reads back over --project/--file exactly what the web host reported over HTTP', async () => {
    await reportMetrics('proj-1', 'index.html', fakeMetrics());

    const json = await odCli(['composition-metrics', '--project', 'proj-1', '--file', 'index.html', '--json']);
    expect(json.status, json.stderr).toBe(0);
    const payload = JSON.parse(json.stdout) as { ok: boolean; record: { metrics: { sectionCount: number } } | null };
    expect(payload.ok).toBe(true);
    expect(payload.record?.metrics.sectionCount).toBe(6);

    const human = await odCli(['composition-metrics', '--project', 'proj-1', '--file', 'index.html']);
    expect(human.status, human.stderr).toBe(0);
    expect(human.stdout).toContain('index.html');
    expect(human.stdout).toContain('sections:');
    expect(human.stdout).toContain('6');
    // Never a score or a grade — raw counts only.
    expect(human.stdout.toLowerCase()).not.toMatch(/score|grade/);
  }, 60_000);

  it('honestly reports no measurement for an artifact nobody has previewed', async () => {
    const res = await odCli(['composition-metrics', '--project', 'proj-empty', '--file', 'never-opened.html']);
    expect(res.status, res.stderr).toBe(0);
    expect(res.stdout).toContain('No measurement recorded yet');
  }, 60_000);

  it('resolves an absolute artifact-path argument into the same record', async () => {
    await reportMetrics('proj-2', 'pages/about.html', fakeMetrics());
    const artifactPath = path.join(dataDir, 'projects', 'proj-2', 'pages', 'about.html');

    const json = await odCli(['composition-metrics', artifactPath, '--json']);
    expect(json.status, json.stderr).toBe(0);
    const payload = JSON.parse(json.stdout) as { record: { projectId: string; file: string } | null };
    expect(payload.record?.projectId).toBe('proj-2');
    expect(payload.record?.file).toBe('pages/about.html');
  }, 60_000);

  it('advertises --json and the two invocation forms in its own help', async () => {
    const help = await odCli(['composition-metrics', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('od composition-metrics');
    expect(help.stdout).toContain('--json');
    expect(help.stdout).toContain('--project');
    expect(help.stdout).toContain('--file');
  }, 60_000);
});
