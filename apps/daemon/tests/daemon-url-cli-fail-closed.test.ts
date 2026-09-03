// The CLI half of CANVAS-8. `resolveDaemonUrl` refuses to assume the default
// port after a discovery probe that never finished; this proves the real `od`
// binary turns that refusal into the repository's structured-error envelope
// (a machine-readable code an embedding agent can branch on) instead of an
// unhandled rejection or a silent write against someone else's daemon.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, '../../..');
const odBinPath = path.join(repoRoot, 'apps/daemon/bin/od.mjs');
/** `daemon-url-unresolved` in RECOVERABLE_EXIT_CODES (apps/daemon/src/cli.ts). */
const DAEMON_URL_UNRESOLVED_EXIT = 76;

let hangingBinDir = '';

beforeAll(async () => {
  hangingBinDir = await mkdtemp(path.join(os.tmpdir(), 'od-cli-daemon-url-'));
  const pnpmShim = path.join(hangingBinDir, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  if (process.platform === 'win32') {
    await writeFile(pnpmShim, '@echo off\r\ntimeout /t 30 /nobreak > nul\r\n');
  } else {
    // Absolute path: PATH is replaced below, so `sleep` would not resolve.
    await writeFile(pnpmShim, '#!/bin/sh\nexec /bin/sleep 30\n');
    await chmod(pnpmShim, 0o755);
  }
});

afterAll(async () => {
  await rm(hangingBinDir, { recursive: true, force: true }).catch(() => {});
});

describe('od with an inconclusive daemon discovery', () => {
  it('exits with the daemon-url-unresolved envelope instead of addressing the default port', async () => {
    // No --daemon-url, no OD_DAEMON_URL, no sidecar socket, and `pnpm` resolves
    // to a shim that never answers — discovery is inconclusive by construction.
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: hangingBinDir };
    delete env.OD_DAEMON_URL;
    delete env.OD_SIDECAR_IPC_PATH;

    let status = 0;
    let stderr = '';
    try {
      // `process.execPath`, not 'node': PATH is replaced by the shim directory
      // above so the daemon's own `pnpm` lookup is the hanging shim.
      await execFileAsync(process.execPath, [odBinPath, 'project', 'list', '--json'], {
        env,
        encoding: 'utf8',
        timeout: 60_000,
      });
    } catch (err) {
      const e = err as { code?: number; stderr?: string };
      status = e.code ?? 1;
      stderr = e.stderr ?? '';
    }

    expect(status, stderr).toBe(DAEMON_URL_UNRESOLVED_EXIT);
    const envelope = JSON.parse(stderr.trim().split('\n').pop() ?? '{}') as {
      error?: { code?: string; message?: string; data?: { reasons?: string[] } };
    };
    expect(envelope.error?.code).toBe('daemon-url-unresolved');
    // The message must name both ways out, and the reasons must say which probe
    // could not finish — that is what makes "timed out" readable as different
    // from "no daemon found".
    expect(envelope.error?.message).toMatch(/--daemon-url/);
    expect(envelope.error?.message).toMatch(/OD_DAEMON_URL/);
    expect(envelope.error?.data?.reasons?.join(' ')).toMatch(/tools-dev status probe exceeded/);
    // And it must not have quietly picked the legacy port.
    expect(stderr).not.toMatch(/failed to reach daemon at http:\/\/127\.0\.0\.1:7456/);
  });
});
