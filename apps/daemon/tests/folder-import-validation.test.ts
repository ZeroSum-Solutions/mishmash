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
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
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

  it('rejects ~/.ssh as a project root with 400', async () => {
    const sshDir = path.join(os.homedir(), '.ssh');
    const resp = await importFolder({ baseDir: sshDir });
    // Only assert the block when the credential dir actually exists on this
    // machine — a fresh CI box may not have one, and creating it here would
    // reach outside the sandboxed temp tree this test suite otherwise stays
    // inside.
    if (resp.status === 400) {
      expect(await errorMessage(resp)).toMatch(/system or credential directory/i);
    } else {
      expect(resp.status).toBe(400); // fails loudly with the real status for visibility
    }
  });

  // Security-relevant: a symlink inside an otherwise-importable folder must
  // not be usable to bypass the credential-directory block. The route
  // realpath()s baseDir BEFORE running blockedProjectRootReason, so a
  // symlink pointing at ~/.ssh must resolve to ~/.ssh's real path and be
  // rejected exactly like importing ~/.ssh directly would be.
  it('rejects a symlink that resolves into a credential directory (path-traversal via symlink)', async () => {
    const sshDir = path.join(os.homedir(), '.ssh');
    const folder = makeFolder();
    const link = path.join(folder, 'sneaky-link');
    try {
      symlinkSync(sshDir, link, 'dir');
    } catch {
      // .ssh doesn't exist or symlinking isn't permitted on this machine —
      // nothing to prove here.
      return;
    }
    const resp = await importFolder({ baseDir: link });
    expect(resp.status).toBe(400);
    expect(await errorMessage(resp)).toMatch(/system or credential directory/i);
  });
});
