// POST /api/import/folder — input-validation and error-handling branches.
//
// folder-import-route.test.ts and folder-import-projects.test.ts already
// cover sandbox-mode gating and metadata/entry-file resolution, but neither
// exercises the route's own basic request-shape and containment checks
// (missing/relative baseDir, a target that does not exist or is not a
// directory, the filesystem root, or a system/credential directory). This
// file covers exactly those branches, including the security-relevant case:
// a symlink cannot be used to bypass the credential-directory block, because
// the route resolves the real path BEFORE running containment checks.

import type http from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

describe('POST /api/import/folder — validation', () => {
  let server: http.Server;
  let baseUrl: string;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function makeFolder(): string {
    const d = mkdtempSync(path.join(tmpdir(), 'od-import-validate-'));
    tempDirs.push(d);
    return d;
  }

  async function importFolder(body: unknown) {
    return fetch(`${baseUrl}/api/import/folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function errorMessage(resp: Response): Promise<string | undefined> {
    const body = (await resp.json()) as { error?: { message?: string } | string };
    return typeof body.error === 'string' ? body.error : body.error?.message;
  }

  it('rejects a missing baseDir with 400', async () => {
    const resp = await importFolder({});
    expect(resp.status).toBe(400);
    expect(await errorMessage(resp)).toMatch(/baseDir required/i);
  });

  it('rejects a blank baseDir with 400', async () => {
    const resp = await importFolder({ baseDir: '   ' });
    expect(resp.status).toBe(400);
    expect(await errorMessage(resp)).toMatch(/baseDir required/i);
  });

  it('rejects a relative baseDir with 400', async () => {
    const resp = await importFolder({ baseDir: 'relative/path' });
    expect(resp.status).toBe(400);
    expect(await errorMessage(resp)).toMatch(/baseDir must be absolute/i);
  });

  it('rejects a baseDir that does not exist with 400', async () => {
    const folder = makeFolder();
    const missing = path.join(folder, 'does-not-exist');
    const resp = await importFolder({ baseDir: missing });
    expect(resp.status).toBe(400);
    expect(await errorMessage(resp)).toMatch(/folder not found/i);
  });

  it('rejects a baseDir that points at a file, not a directory, with 400', async () => {
    const folder = makeFolder();
    const filePath = path.join(folder, 'not-a-dir.txt');
    await writeFile(filePath, 'hello');
    const resp = await importFolder({ baseDir: filePath });
    expect(resp.status).toBe(400);
    expect(await errorMessage(resp)).toMatch(/path must be a directory/i);
  });

  it('rejects the filesystem root as a project root with 400', async () => {
    const resp = await importFolder({ baseDir: path.parse(process.cwd()).root });
    expect(resp.status).toBe(400);
    expect(await errorMessage(resp)).toMatch(/cannot import the filesystem root/i);
  });

  it('rejects a known system directory (/etc) as a project root with 400', async () => {
    if (process.platform === 'win32') return;
    const resp = await importFolder({ baseDir: '/etc' });
    expect(resp.status).toBe(400);
    expect(await errorMessage(resp)).toMatch(/system or credential directory/i);
  });

  // Both credential-directory cases below run against a HOME this file creates,
  // not the machine's own. An earlier version read the real ~/.ssh and tried to
  // skip when it was absent, which was wrong twice over: it gated on
  // `resp.status === 400`, but "folder not found" is ALSO a 400, so on a runner
  // without ~/.ssh the skip never triggered and the assertion ran against the
  // wrong rejection reason; and the symlink case gated on symlinkSync throwing,
  // which it does not — a dangling symlink is perfectly legal, so that guard
  // never fired either. Both passed on a developer machine (~/.ssh exists) and
  // failed on CI (it does not).
  //
  // `blockedProjectRootReason` derives the credential dirs from
  // `realpath(os.homedir())` on every request, and Node's os.homedir() returns
  // $HOME on POSIX, so pointing HOME at a temp tree makes the check operate on
  // a directory this test owns. That removes the machine dependency entirely:
  // the block is exercised everywhere instead of silently skipped wherever the
  // real ~/.ssh happens to be missing.
  async function withFakeHomeCredentialDir(
    run: (credentialDir: string) => Promise<void>,
  ): Promise<void> {
    const home = makeFolder();
    const credentialDir = path.join(home, '.ssh');
    mkdirSync(credentialDir);
    const realHome = process.env.HOME;
    process.env.HOME = home;
    try {
      await run(credentialDir);
    } finally {
      if (realHome === undefined) delete process.env.HOME;
      else process.env.HOME = realHome;
    }
  }

  it('rejects a credential directory (~/.ssh) as a project root with 400', async () => {
    if (process.platform === 'win32') return; // os.homedir() ignores $HOME on Windows
    await withFakeHomeCredentialDir(async (credentialDir) => {
      const resp = await importFolder({ baseDir: credentialDir });
      expect(resp.status).toBe(400);
      expect(await errorMessage(resp)).toMatch(/system or credential directory/i);
    });
  });

  // Security-relevant: a symlink inside an otherwise-importable folder must
  // not be usable to bypass the credential-directory block. The route
  // realpath()s baseDir BEFORE running blockedProjectRootReason, so a
  // symlink pointing at ~/.ssh must resolve to ~/.ssh's real path and be
  // rejected exactly like importing ~/.ssh directly would be.
  it('rejects a symlink that resolves into a credential directory (path-traversal via symlink)', async () => {
    if (process.platform === 'win32') return;
    await withFakeHomeCredentialDir(async (credentialDir) => {
      const folder = makeFolder();
      const link = path.join(folder, 'sneaky-link');
      symlinkSync(credentialDir, link, 'dir');
      const resp = await importFolder({ baseDir: link });
      expect(resp.status).toBe(400);
      expect(await errorMessage(resp)).toMatch(/system or credential directory/i);
    });
  });
});
