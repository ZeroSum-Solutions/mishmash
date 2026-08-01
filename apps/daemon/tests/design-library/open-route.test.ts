import type http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The happy path of POST /api/design-library/open shells out to macOS
// `open`, which would pop a real Finder window (or crash on runners without
// the binary). Mock spawn -- in its own file so the module mock can't leak
// into the unmocked route tests in routes.test.ts.
const spawnMock = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ unref: vi.fn(), on: vi.fn() })));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: spawnMock };
});

import { startServer } from '../../src/server.js';

describe('design library open route (spawn mocked)', () => {
  let server: http.Server | null = null;
  let shutdown: (() => Promise<void> | void) | undefined;
  let fixtureDir: string | null = null;
  const PREV_ROOT = process.env.OD_DESIGN_LIBRARY_DIR;

  afterEach(async () => {
    await Promise.resolve(shutdown?.());
    shutdown = undefined;
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
    if (fixtureDir) {
      rmSync(fixtureDir, { recursive: true, force: true });
      fixtureDir = null;
    }
    if (PREV_ROOT === undefined) delete process.env.OD_DESIGN_LIBRARY_DIR;
    else process.env.OD_DESIGN_LIBRARY_DIR = PREV_ROOT;
  });

  it('opens an existing library path via argument-array spawn and returns 204', async () => {
    fixtureDir = mkdtempSync(path.join(tmpdir(), 'od-design-library-open-test-'));
    writeFileSync(path.join(fixtureDir, 'catalog.json'), '{}', 'utf8');
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
      shutdown?: () => Promise<void> | void;
    };
    server = started.server;
    shutdown = started.shutdown;
    spawnMock.mockClear();

    const res = await fetch(`${started.url}/api/design-library/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel: 'catalog.json' }),
    });
    expect(res.status).toBe(204);

    // Argument-array form is the injection-safety contract: the target path
    // must be a spawn argv entry, never interpolated into a shell string.
    const openCalls = spawnMock.mock.calls.filter(([cmd]) => cmd === 'open');
    expect(openCalls).toHaveLength(1);
    const [, args, opts] = openCalls[0]!;
    expect(args).toEqual([path.join(fixtureDir, 'catalog.json')]);
    expect(opts).toMatchObject({ detached: true });
  });
});
