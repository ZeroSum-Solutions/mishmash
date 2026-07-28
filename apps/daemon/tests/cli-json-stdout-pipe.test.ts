// od CLI top-level dispatch drops the tail of large --json payloads when
// stdout is a pipe.
//
// The top-of-file SUBCOMMAND_MAP dispatch in apps/daemon/src/cli.ts
// (`await SUBCOMMAND_MAP[first](rest); process.exit(0);`) exits the process
// in the same tick the awaited handler resolves. Handlers like
// `runLibraryList`'s `list --json` branch end with a bare
// `return process.stdout.write(JSON.stringify(data, null, 2) + '\n')` and
// return normally without waiting for the write to flush. When stdout is a
// PIPE -- what any embedding process gets from `spawn`/`execFile`, as
// opposed to a TTY -- writes past the OS pipe buffer (~64KB) are
// asynchronous, and `process.exit()` tears down the event loop before the
// remainder drains. The JSON tail is silently dropped.
//
// `od design-systems list --json` is a deterministic repro with zero test
// fixture setup: the repo ships 150+ built-in design-system presets under
// `design-systems/` at the repo root (read from `DESIGN_SYSTEMS_DIR`, which
// is repo-relative, not OD_DATA_DIR-relative -- see
// apps/daemon/src/design-systems/server-services.ts's listAllDesignSystems),
// so a completely fresh, empty daemon data directory still produces a
// pretty-printed JSON body comfortably over the ~64KB threshold.

import type http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const CLI_SRC = path.join(__dirname, '../src/cli.ts');
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

describe('od CLI --json stdout through a pipe', () => {
  let server: http.Server;
  let baseUrl: string;
  let shutdown: (() => Promise<void> | void) | undefined;
  let dataDir: string;
  const PREV_DATA_DIR = process.env.OD_DATA_DIR;

  beforeAll(async () => {
    // Fresh, isolated OD_DATA_DIR on an ephemeral port -- never the shared
    // "default" namespace or its fixed ports (7456 / 51012). Anchored
    // directly under /tmp (not the possibly long/nested inherited $TMPDIR),
    // matching cli-phase2c.test.ts's makeFolder(): tsx's own loader IPC pipe
    // is an AF_UNIX socket capped at ~104 bytes of sun_path on macOS, and a
    // long temp root can push it past that cap.
    //
    // server.ts pins RUNTIME_DATA_DIR from process.env.OD_DATA_DIR at
    // module-top-level, so the env var must be set before the first
    // `../src/server.js` import (mirrors backup-cli-subprocess.test.ts).
    dataDir = mkdtempSync(path.join('/tmp', 'od-cli-pipe-data-'));
    process.env.OD_DATA_DIR = dataDir;
    const { startServer } = await import('../src/server.js');
    const started = (await startServer({ port: 0, host: '127.0.0.1', returnServer: true })) as {
      url: string;
      server: http.Server;
      shutdown?: () => Promise<void> | void;
    };
    baseUrl = started.url;
    server = started.server;
    shutdown = started.shutdown;
  });

  afterAll(async () => {
    await Promise.resolve(shutdown?.());
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dataDir, { recursive: true, force: true });
    if (PREV_DATA_DIR === undefined) delete process.env.OD_DATA_DIR;
    else process.env.OD_DATA_DIR = PREV_DATA_DIR;
  });

  async function runCli(
    args: string[],
    options: { input?: string; timeout?: number } = {},
  ): Promise<{ stdout: string; stderr: string; code: number | null; elapsedMs: number }> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OD_DAEMON_URL: baseUrl,
      // Pin TMPDIR/TMP/TEMP for the spawned CLI subprocess tree: tsx's own
      // loader opens an AF_UNIX IPC pipe at `${TMPDIR}/tsx-<uid>/<pid>.pipe`,
      // subject to the same ~104-byte sun_path cap. Without this, the child
      // inherits the parent's (possibly long/nested) $TMPDIR and tsx's own
      // pipe -- not just this file's own data dir -- can overflow the cap
      // and crash the child with EINVAL. Mirrors cli-phase2c.test.ts's
      // runCli() exactly; load-bearing under the gate's environment.
      TMPDIR: '/tmp',
      TMP: '/tmp',
      TEMP: '/tmp',
    };
    delete env.NODE_OPTIONS;

    const startedAt = Date.now();
    return await new Promise((resolve, reject) => {
      // stdio 'pipe' is the point of the test: this is exactly what
      // execFile/spawn give any embedding process (hermes-agent, openclaw,
      // a Slack bot job) -- an OS pipe, never a TTY.
      const child = spawn(process.execPath, [TSX_CLI, CLI_SRC, ...args], {
        cwd: path.join(__dirname, '..'),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`CLI timed out: od ${args.join(' ')}`));
      }, options.timeout ?? 20_000);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve({ stdout, stderr, code, elapsedMs: Date.now() - startedAt });
      });
      child.stdin.end(options.input ?? '');
    });
  }

  it('emits the complete design-systems --json payload -- byte-complete and exit-prompt -- when stdout is piped', async () => {
    const httpResp = await fetch(`${baseUrl}/api/design-systems`);
    expect(httpResp.ok).toBe(true);
    const httpBody = (await httpResp.json()) as unknown;

    // The CLI pretty-prints with `JSON.stringify(data, null, 2) + '\n'`
    // (apps/daemon/src/cli.ts's runLibraryList), so that's the shape that
    // actually crosses the ~64KB OS pipe buffer this bug depends on -- the
    // compact HTTP wire body is smaller. Sanity check the repro's own
    // precondition: if the bundled preset count ever shrinks below that
    // threshold, this test stops proving anything about the truncation bug.
    const expectedSerialization = `${JSON.stringify(httpBody, null, 2)}\n`;
    expect(Buffer.byteLength(expectedSerialization, 'utf8')).toBeGreaterThan(65_536);

    const cli = await runCli(['design-systems', 'list', '--json']);

    expect(cli.code).toBe(0);
    // The dispatcher must not hang or dawdle waiting for anything else
    // (undici keep-alive sockets, timers) once the handler's write drains.
    expect(cli.elapsedMs).toBeLessThan(5_000);

    let parsedCli: unknown;
    expect(() => {
      parsedCli = JSON.parse(cli.stdout);
    }).not.toThrow();
    expect(parsedCli).toEqual(httpBody);

    // Sharper than JSON-parseability alone: an exact byte-length match rules
    // out a truncation that happened to land on a still-parseable boundary.
    expect(Buffer.byteLength(cli.stdout, 'utf8')).toBe(Buffer.byteLength(expectedSerialization, 'utf8'));
  });
});
