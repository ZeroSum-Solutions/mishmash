// `od interview run` — the real CLI subprocess chain against a real booted
// daemon. Proves the R1 dual-track CLI surface actually drives the same
// /api/interviews engine the web chat-pane surface uses, per AGENTS.md
// "Capability exposure" (an external agent that never renders the web UI
// must still be able to run the interview).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-interview-cli-'));
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

describe('od interview run — real CLI subprocess chain', () => {
  it('runs the quick tier end-to-end from a --prompt-file answer set and prints JSON', async () => {
    const answersPath = path.join(dataDir, 'answers.json');
    await writeFile(
      answersPath,
      JSON.stringify({
        hqLocation: 'Tampa, FL',
        serviceArea: 'Tampa, Clearwater, St. Petersburg',
        certifications: 'BICSI, EPA',
        phone: '(813) 555-0100',
        email: 'owner@example.com',
        services: 'Structured cabling, fiber splicing',
        idealCustomer: 'Commercial property managers',
        backgroundPreference: 'light background',
        threeWordsFeel: 'clean and professional',
        primaryCta: 'Call for an estimate',
      }),
      'utf8',
    );

    const result = await odCli(['interview', 'run', 'quick', '--prompt-file', answersPath, '--json']);
    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      session: { status: string; tier: string };
      clientBrief: { status: string; openItems: Array<{ fieldId: string }> };
      guidedBrief: { product?: string; audience?: string; direction?: string };
    };
    expect(payload.session.status).toBe('complete');
    expect(payload.session.tier).toBe('quick');
    expect(payload.clientBrief.status).toBe('complete');
    expect(payload.guidedBrief.product).toContain('Structured cabling');
    expect(payload.guidedBrief.audience).toContain('Commercial property managers');
  }, 60_000);

  it('exits non-zero and names the field when a REQUIRED answer is too vague', async () => {
    const answersPath = path.join(dataDir, 'bad-answers.json');
    await writeFile(
      answersPath,
      JSON.stringify({
        hqLocation: 'Tampa, FL',
        serviceArea: 'Tampa, Clearwater',
        certifications: 'BICSI',
        phone: 'my main line',
        email: 'owner@example.com',
      }),
      'utf8',
    );

    const result = await odCli(['interview', 'run', 'quick', '--prompt-file', answersPath, '--json']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('REQUIRED');
    expect(result.stderr).toContain('phone');
  }, 60_000);

  it('advertises --json and --prompt-file in its own help', async () => {
    const help = await odCli(['interview', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('od interview run');
    expect(help.stdout).toContain('--json');
    expect(help.stdout).toContain('--prompt-file');
  }, 30_000);
});
