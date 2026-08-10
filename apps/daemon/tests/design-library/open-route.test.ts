import type http from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { designLibraryTreeSha256 } from '../../src/design-library/rights.js';

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
import { createBrowserOpenInvocation } from '../../src/browser/browser-open.js';

// Both routes hand off through the platform's own opener, so the expected
// argv is `open` on macOS and `xdg-open` on the Linux CI runner. Deriving it
// from the same helper the routes use keeps this from re-pinning the
// macOS-only hardcode these tests were originally written against.
function openerCallsFor(target: string): { command: string; args: string[] }[] {
  const expected = createBrowserOpenInvocation(process.platform, target);
  return spawnMock.mock.calls
    .filter(([cmd]) => cmd === expected.command)
    .map(([command, args]) => ({ command: command as string, args: args as string[] }));
}

function openerCallCount(): number {
  const opener = createBrowserOpenInvocation(process.platform, 'probe').command;
  return spawnMock.mock.calls.filter(([cmd]) => cmd === opener).length;
}

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
    const target = path.join(fixtureDir, 'catalog.json');
    const calls = openerCallsFor(target);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(createBrowserOpenInvocation(process.platform, target).args);
  });

  // Live preview builds a rights-bearing fixture of its own: the route
  // re-authorizes against the private record + public ceiling, so a catalog
  // alone is not enough to reach the spawn.
  async function makeLivePreviewFixture(): Promise<string> {
    const dir = mkdtempSync(path.join(tmpdir(), 'od-design-library-live-preview-'));
    const licensed = path.join(dir, '01 Kits', 'licensed-kit');
    const figOnly = path.join(dir, '01 Kits', 'fig-only-kit');
    const unlicensed = path.join(dir, '01 Kits', 'unlicensed-kit');
    const capture = path.join(dir, '01 Kits', 'capture-kit');
    mkdirSync(capture, { recursive: true });
    mkdirSync(licensed, { recursive: true });
    mkdirSync(figOnly, { recursive: true });
    mkdirSync(unlicensed, { recursive: true });
    writeFileSync(path.join(licensed, 'reference.html'), '<!doctype html><title>Live</title>', 'utf8');
    writeFileSync(path.join(figOnly, 'source.fig'), 'not html', 'utf8');
    writeFileSync(path.join(unlicensed, 'reference.html'), '<!doctype html><title>No rights</title>', 'utf8');
    writeFileSync(path.join(capture, 'index.html'), '<!doctype html><title>Third-party capture</title>', 'utf8');

    const catalog = {
      library: 'Live Preview Fixture',
      rights_ledger: 'RIGHTS.md',
      note: '',
      total_collections: 4,
      groups: [{
        title: 'Kits',
        folder: '01 Kits',
        blurb: '',
        items: [
          { id: 'a', label: 'Licensed', rel: '01 Kits/licensed-kit', thumb: null, kind: 'html', files: 1, size: '1 KB', category: 'Kits', domains: [], allowed_use: 'licensed-source-review' },
          { id: 'b', label: 'Fig only', rel: '01 Kits/fig-only-kit', thumb: null, kind: 'fig', files: 1, size: '1 KB', category: 'Kits', domains: [], allowed_use: 'licensed-source-review' },
          { id: 'd', label: 'Capture', rel: '01 Kits/capture-kit', thumb: null, kind: 'html', files: 1, size: '1 KB', category: 'Kits', domains: [], allowed_use: 'human-local-only' },
          { id: 'c', label: 'Unlicensed', rel: '01 Kits/unlicensed-kit', thumb: null, kind: 'html', files: 1, size: '1 KB', category: 'Kits', domains: [], allowed_use: 'blocked-pending-license' },
        ],
      }],
    };
    writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(catalog), 'utf8');

    // `unlicensed-kit` deliberately gets NO record, so it resolves blocked.
    const ceiling = {
      '01 Kits/licensed-kit': 'licensed-source-review',
      '01 Kits/fig-only-kit': 'licensed-source-review',
      '01 Kits/capture-kit': 'human-local-only',
    } as const;
    const records = Object.fromEntries(await Promise.all(
      Object.entries(ceiling).map(async ([rel, allowedUse]) => [rel, {
        tree_sha256: await designLibraryTreeSha256(path.join(dir, rel)),
        allowed_use: allowedUse,
        licence_ref: allowedUse === 'licensed-source-review' ? 'synthetic-test-licence' : null,
        source_url: null,
        captured_at: '2026-08-09T00:00:00.000Z',
        notes: 'Synthetic live-preview record.',
      }]),
    ));
    mkdirSync(path.join(dir, '.catalog'), { recursive: true });
    writeFileSync(path.join(dir, '.catalog', 'rights.json'), JSON.stringify({ version: 1, records }), 'utf8');
    writeFileSync(path.join(dir, 'RIGHTS.md'), [
      '# Synthetic rights ceiling',
      '<!-- OD_RIGHTS_SOURCE_LEDGER_V1',
      JSON.stringify({ version: 1, prefixes: {}, items: ceiling }),
      'OD_RIGHTS_SOURCE_LEDGER_V1 -->',
      '',
    ].join('\n'), 'utf8');
    return dir;
  }

  async function startWithFixture(): Promise<string> {
    fixtureDir = await makeLivePreviewFixture();
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
      shutdown?: () => Promise<void> | void;
    };
    server = started.server;
    shutdown = started.shutdown;
    spawnMock.mockClear();
    return started.url;
  }

  async function livePreview(daemonUrl: string, rel: string): Promise<Response> {
    return fetch(`${daemonUrl}/api/design-library/live-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel }),
    });
  }

  it('opens a licensed collection\'s entry HTML and reports which file it opened', async () => {
    const daemonUrl = await startWithFixture();

    const res = await livePreview(daemonUrl, '01 Kits/licensed-kit');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, entryFile: 'reference.html' });

    // The entry FILE, not the containing folder — and as an argv entry, never
    // interpolated into a shell string.
    const target = path.join(fixtureDir!, '01 Kits', 'licensed-kit', 'reference.html');
    const calls = openerCallsFor(target);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual(createBrowserOpenInvocation(process.platform, target).args);
  });

  it('reports the catalog\'s live-preview entry so the UI only offers the action where it works', async () => {
    const daemonUrl = await startWithFixture();

    const res = await fetch(`${daemonUrl}/api/design-library/catalog`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { groups: { items: { rel: string; entry_html: string | null }[] }[] };
    const entries = Object.fromEntries(body.groups[0]!.items.map((i) => [i.rel, i.entry_html]));
    expect(entries['01 Kits/licensed-kit']).toBe('reference.html');
    // A .fig-only collection has nothing to render, so no button is offered.
    expect(entries['01 Kits/fig-only-kit']).toBeNull();
  });

  it('404s a collection with no renderable HTML instead of opening its folder', async () => {
    const daemonUrl = await startWithFixture();

    const res = await livePreview(daemonUrl, '01 Kits/fig-only-kit');
    expect(res.status).toBe(404);
    expect(openerCallCount()).toBe(0);
  });

  it('403s a collection with no rights record even though the catalog lists it', async () => {
    const daemonUrl = await startWithFixture();

    const res = await livePreview(daemonUrl, '01 Kits/unlicensed-kit');
    expect(res.status).toBe(403);
    expect(openerCallCount()).toBe(0);
  });

  // Rendering runs the author's scripts, so the reference-only tier that
  // covers third-party captures and site mirrors stays open-folder-only —
  // a narrower gate than `start-project`'s referenceable set.
  it('403s a human-local-only collection rather than executing a third-party capture', async () => {
    const daemonUrl = await startWithFixture();

    const res = await livePreview(daemonUrl, '01 Kits/capture-kit');
    expect(res.status).toBe(403);
    expect(openerCallCount()).toBe(0);
  });

  it('400s a path-traversal rel without spawning anything', async () => {
    const daemonUrl = await startWithFixture();

    for (const rel of ['../escape', '/etc', '01 Kits/../../escape']) {
      const res = await livePreview(daemonUrl, rel);
      expect(res.status).toBe(400);
    }
    expect(openerCallCount()).toBe(0);
  });
});
