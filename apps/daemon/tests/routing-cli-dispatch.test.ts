// `od route` must not crash on dispatch (mirrors cli-usage-dispatch.test.ts's
// TDZ regression guard: ROUTE_STRING_FLAGS/ROUTE_BOOLEAN_FLAGS must be
// declared before the top-of-file SUBCOMMAND_MAP dispatcher runs, or --help
// throws "Cannot access '...' before initialization" instead of printing),
// plus real end-to-end coverage of the `policy|preview|meters` subcommands:
// JSON success against a live route (mirrors host-tools-open-in-route.test.ts's
// bare-express harness -- no full daemon boot needed since the P0 routing
// route has no SQLite/project dependency), and a structured error on
// transport failure (MED-7: --json must emit the same
// exitWithStructuredError envelope runUsage/runWhatsNew use, not a plain
// stderr line).

import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import express from 'express';
import path from 'node:path';
import url from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

describe('od route dispatch', () => {
  it('does not throw a temporal-dead-zone ReferenceError on --help', async () => {
    const { stdout, stderr, code } = await runCli(['route', '--help']);
    expect(stderr).not.toContain('ReferenceError');
    expect(stderr).not.toContain('before initialization');
    expect(stdout).toContain('od route <policy|preview|meters|telemetry|gates|rates>');
    expect(code).toBe(0);
  });

  it('exits with usage on an unrecognized subcommand instead of crashing', async () => {
    const { stderr, code } = await runCli(['route', 'bogus']);
    expect(stderr).not.toContain('ReferenceError');
    expect(stderr).toContain('unknown subcommand');
    expect(code).toBe(2);
  });
});

describe('od route <policy|preview|meters|telemetry> --json against a live route', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    registerRoutingRoutes(app);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('od route policy --json prints the same envelope GET /api/routing/policy returns', async () => {
    const { stdout, stderr, code } = await runCli(['route', 'policy', '--json', '--daemon-url', baseUrl]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { policyVersion: number };
    // v1 policy content landed (CWR-P1-1) -- see
    // packages/contracts/tests/routing-policy-drift.test.ts.
    expect(parsed.policyVersion).toBe(1);
  });

  it('od route preview --json forwards --template-id/--build-class/--stage as query params', async () => {
    const { stdout, stderr, code } = await runCli([
      'route', 'preview', '--json', '--daemon-url', baseUrl,
      '--template-id', 't1', '--build-class', 'landing-page', '--stage', 'prototype',
    ]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { key: { templateId: string; buildClass: string; stage: string } };
    expect(parsed.key).toMatchObject({ templateId: 't1', buildClass: 'landing-page', stage: 'prototype' });
  });

  it('od route meters --json prints an empty laneMeters array', async () => {
    const { stdout, stderr, code } = await runCli(['route', 'meters', '--json', '--daemon-url', baseUrl]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { laneMeters: unknown[] };
    expect(parsed.laneMeters).toEqual([]);
  });

  // t9 (plan §5 P2 gate, WR-routing.md CWR-P2-4): `od route rates --json`
  // and a bare `od route --json` (no subcommand at all) must resolve to the
  // identical GET /api/routing/rates call. This harness registers the
  // routes with no `db` (bare-express, per registerRoutingRoutes' own doc
  // comment), so `laneMeters` degrades to `{}` here -- the non-empty-lane-
  // meters guarantee (seeded from policy) is asserted against a REAL db in
  // routing-dispatch.test.ts's `computeRoutingRates` coverage instead; this
  // suite only proves the CLI dispatch/shape wiring itself.
  it('od route rates --json prints the escalationRate/passRate/laneMeters shape', async () => {
    const { stdout, stderr, code } = await runCli(['route', 'rates', '--json', '--daemon-url', baseUrl]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { escalationRate: number; passRate: number; laneMeters: Record<string, unknown> };
    expect(parsed).toHaveProperty('escalationRate');
    expect(parsed).toHaveProperty('passRate');
    expect(parsed).toHaveProperty('laneMeters');
    expect(parsed).toHaveProperty('byStage');
  });

  it('od route --json with NO subcommand resolves to the same rates call as `od route rates --json`', async () => {
    const { stdout, stderr, code } = await runCli(['route', '--json', '--daemon-url', baseUrl]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { escalationRate: number; passRate: number; laneMeters: Record<string, unknown> };
    expect(parsed).toHaveProperty('escalationRate');
    expect(parsed).toHaveProperty('passRate');
    expect(parsed).toHaveProperty('laneMeters');
  });
});

describe('od route <policy|preview|meters|telemetry> --json on transport failure', () => {
  // Nothing listens on this port (an ephemeral, momentarily-bound-then-closed
  // port), so every fetch() in runRoute hits ECONNREFUSED -- the transport
  // failure MED-7 asks the CLI to report as a structured --json error rather
  // than a plain stderr line.
  let deadPortUrl: string;

  beforeAll(async () => {
    const probe = express().listen(0);
    await new Promise<void>((resolve) => probe.once('listening', () => resolve()));
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    deadPortUrl = `http://127.0.0.1:${port}`;
  });

  async function expectStructuredTransportFailure(sub: string, extraArgs: string[] = []) {
    const { stdout, stderr, code } = await runCli(['route', sub, '--json', '--daemon-url', deadPortUrl, ...extraArgs]);
    expect(stdout).toBe('');
    expect(code).toBe(64); // RECOVERABLE_EXIT_CODES['daemon-not-running']
    const envelope = JSON.parse(stderr) as { error: { code: string; message: string } };
    expect(envelope.error.code).toBe('daemon-not-running');
    expect(envelope.error.message).toContain(deadPortUrl);
  }

  it('od route policy --json emits a structured daemon-not-running error', async () => {
    await expectStructuredTransportFailure('policy');
  });

  it('od route preview --json emits a structured daemon-not-running error', async () => {
    await expectStructuredTransportFailure('preview');
  });

  it('od route meters --json emits a structured daemon-not-running error', async () => {
    await expectStructuredTransportFailure('meters');
  });
});
