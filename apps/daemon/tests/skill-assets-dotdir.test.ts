// Regression: `/api/skills/:id/assets/*` must serve entries whose folder
// sits under the daemon data directory.
//
// The data directory is dot-prefixed by contract, and Express's `send`
// defaults to `dotfiles: 'ignore'` — which 404s any path with a dot-segment
// ancestor. Every design template installed into the *user* root was
// therefore unreachable through the asset route, while the same entry's
// `/example` (plain `res.send`, no `send`) still returned 200. That split is
// what made the failure hard to see: a listing check and an example check
// both pass while nothing actually renders.
//
// The test data dir that `tests/setup.ts` creates has no dot segment, so this
// suite imports the server with its own `OD_DATA_DIR` — server.ts resolves
// its paths at module import time, hence `vi.resetModules()`.

import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, expect, it } from 'vitest';

type StartedServer = { server: http.Server; url: string };

const ENTRY_ID = `dotdir-assets-${Date.now()}`;
const ASSET_BODY = '<!DOCTYPE html><title>dotdir</title><p>asset body</p>';

let tmpRoot: string;
let server: http.Server | undefined;
let baseUrl: string;
let previousDataDir: string | undefined;

beforeAll(async () => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'od-dotdir-'));
  // The dot-prefixed segment is the whole point of the fixture.
  const dataDir = path.join(tmpRoot, '.od');
  const entryDir = path.join(dataDir, 'design-templates', ENTRY_ID);
  mkdirSync(path.join(entryDir, 'assets'), { recursive: true });
  mkdirSync(path.join(entryDir, 'fonts'), { recursive: true });
  writeFileSync(path.join(entryDir, 'assets', 'index.html'), ASSET_BODY);
  writeFileSync(path.join(entryDir, 'assets', 'styles.css'), 'body { color: rebeccapurple; }');
  writeFileSync(
    path.join(entryDir, 'fonts', 'fonts.css'),
    '@font-face { font-family: "Fixture"; src: url("./fixture.woff2") format("woff2"); }',
  );
  writeFileSync(path.join(entryDir, 'fonts', 'fixture.woff2'), Buffer.from('wOF2fixture'));
  writeFileSync(path.join(entryDir, 'fonts', 'notes.txt'), 'not a font resource');
  // A skill folder is user-supplied content, so the route must not follow a
  // symlink out of the entry, and must not hand over a dot-prefixed leaf.
  writeFileSync(path.join(tmpRoot, 'outside-the-entry.txt'), 'SECRET');
  symlinkSync(
    path.join(tmpRoot, 'outside-the-entry.txt'),
    path.join(entryDir, 'assets', 'leak.txt'),
  );
  symlinkSync(
    path.join(tmpRoot, 'outside-the-entry.txt'),
    path.join(entryDir, 'fonts', 'leak.woff2'),
  );
  writeFileSync(path.join(entryDir, 'assets', '.env'), 'TOKEN=secret');
  // A dot-prefixed DIRECTORY, not just a dot-prefixed leaf. `dotfiles: 'allow'`
  // tolerates every dot segment in the path, and a basename check only ever
  // sees `secret.txt` — so this is the case the leaf check cannot cover.
  mkdirSync(path.join(entryDir, 'assets', '.hidden'), { recursive: true });
  writeFileSync(path.join(entryDir, 'assets', '.hidden', 'secret.txt'), 'NESTED-SECRET');
  writeFileSync(
    path.join(entryDir, 'example.html'),
    '<!DOCTYPE html><body><iframe src="./assets/index.html"></iframe></body>',
  );
  writeFileSync(
    path.join(entryDir, 'SKILL.md'),
    [
      '---',
      `name: ${ENTRY_ID}`,
      'description: dot-directory asset fixture',
      'od:',
      '  mode: template',
      '  preview:',
      '    type: html',
      '    entry: assets/index.html',
      '---',
      '',
      '# fixture',
      '',
    ].join('\n'),
  );

  previousDataDir = process.env.OD_DATA_DIR;
  process.env.OD_DATA_DIR = dataDir;
  const vitest = await import('vitest');
  vitest.vi.resetModules();
  const { startServer } = await import('../src/server.js');
  const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
  server = started.server;
  baseUrl = started.url;
  // Booting the whole daemon (and, on a cold worktree, building the contracts
  // package first) overruns Vitest's 10s default hook timeout.
}, 120_000);

afterAll(async () => {
  await new Promise((resolve, reject) => {
    if (!server) return resolve(undefined);
    server.close((error?: Error) => (error ? reject(error) : resolve(undefined)));
  });
  if (previousDataDir === undefined) delete process.env.OD_DATA_DIR;
  else process.env.OD_DATA_DIR = previousDataDir;
  rmSync(tmpRoot, { force: true, recursive: true });
});

it('serves assets for an entry under a dot-prefixed data directory', async () => {
  const resp = await fetch(`${baseUrl}/api/skills/${ENTRY_ID}/assets/index.html`);
  expect(resp.status).toBe(200);
  await expect(resp.text()).resolves.toContain('asset body');
});

it('serves passive subresources requested by a sandboxed template preview', async () => {
  const resp = await fetch(`${baseUrl}/api/skills/${ENTRY_ID}/assets/styles.css`, {
    headers: {
      'Sec-Fetch-Dest': 'style',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site',
    },
  });

  expect(resp.status).toBe(200);
  await expect(resp.text()).resolves.toBe('body { color: rebeccapurple; }');
});

it('serves vendored font stylesheets and binaries to a sandboxed template preview', async () => {
  const cssResp = await fetch(`${baseUrl}/api/skills/${ENTRY_ID}/fonts/fonts.css`, {
    headers: {
      Origin: 'null',
      'Sec-Fetch-Dest': 'style',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
    },
  });

  expect(cssResp.status).toBe(200);
  expect(cssResp.headers.get('content-type')).toContain('text/css');
  expect(cssResp.headers.get('access-control-allow-origin')).toBe('*');
  await expect(cssResp.text()).resolves.toContain('./fixture.woff2');

  const fontResp = await fetch(`${baseUrl}/api/skills/${ENTRY_ID}/fonts/fixture.woff2`, {
    headers: {
      Origin: 'null',
      'Sec-Fetch-Dest': 'font',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
    },
  });

  expect(fontResp.status).toBe(200);
  expect(fontResp.headers.get('content-type')).toContain('font/woff2');
  expect(fontResp.headers.get('access-control-allow-origin')).toBe('*');
  expect(Buffer.from(await fontResp.arrayBuffer())).toEqual(Buffer.from('wOF2fixture'));
});

it('keeps the vendored-font route passive and confined', async () => {
  const [scripted, traversal, escapedSymlink, disallowed] = await Promise.all([
    fetch(`${baseUrl}/api/skills/${ENTRY_ID}/fonts/fonts.css`, {
      headers: {
        Origin: 'null',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
      },
    }),
    fetch(`${baseUrl}/api/skills/${ENTRY_ID}/fonts/..%2F..%2FSKILL.md`),
    fetch(`${baseUrl}/api/skills/${ENTRY_ID}/fonts/leak.woff2`),
    fetch(`${baseUrl}/api/skills/${ENTRY_ID}/fonts/notes.txt`),
  ]);

  expect(scripted.status).toBe(403);
  expect(traversal.status).not.toBe(200);
  expect(escapedSymlink.status).not.toBe(200);
  expect(disallowed.status).not.toBe(200);
});

it('still rejects scripted reads from a sandboxed template origin', async () => {
  const resp = await fetch(`${baseUrl}/api/skills/${ENTRY_ID}/assets/styles.css`, {
    headers: {
      Origin: 'null',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'cross-site',
    },
  });

  expect(resp.status).toBe(403);
  await expect(resp.json()).resolves.toEqual({
    error: 'Origin: null not allowed for this route',
  });
});

it('still refuses traversal out of the entry assets directory', async () => {
  const resp = await fetch(
    `${baseUrl}/api/skills/${ENTRY_ID}/assets/..%2F..%2FSKILL.md`,
  );
  expect(resp.status).not.toBe(200);
});

it('refuses a symlink that resolves outside the entry assets directory', async () => {
  const resp = await fetch(`${baseUrl}/api/skills/${ENTRY_ID}/assets/leak.txt`);
  expect(resp.status).not.toBe(200);
  await expect(resp.text()).resolves.not.toContain('SECRET');
});

it('refuses a dot-prefixed leaf inside the entry assets directory', async () => {
  const resp = await fetch(`${baseUrl}/api/skills/${ENTRY_ID}/assets/.env`);
  expect(resp.status).not.toBe(200);
});

// The route is reachable from a sandboxed template iframe, which carries
// `Origin: null` and is answered with `Access-Control-Allow-Origin: *`. So one
// template's script can read another template's assets, and a dot-prefixed
// directory must be as unreachable as a dot-prefixed file.
it('refuses a file nested inside a dot-prefixed directory in the entry assets', async () => {
  const resp = await fetch(`${baseUrl}/api/skills/${ENTRY_ID}/assets/.hidden/secret.txt`);
  expect(resp.status).not.toBe(200);
  await expect(resp.text()).resolves.not.toContain('NESTED-SECRET');
});
