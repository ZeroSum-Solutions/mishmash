import type http from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { startServer } from '../../src/server.js';

// Mirrors tests/media/tasks-routes.test.ts: boot the REAL server via
// startServer({port:0, returnServer:true}) and hit it with plain fetch().
//
// Fixture data below is entirely invented -- no bytes from the real local
// Design Assets library ever enter this repo (hard rule).
const SYNTHETIC_CATALOG = {
  library: 'Synthetic Test Library',
  rights_ledger: 'synthetic-ledger-fixture',
  note: 'allowed_use per collection mirrors a synthetic RIGHTS.md fixture',
  total_collections: 1,
  groups: [
    {
      title: 'Synthetic Group',
      folder: '00 Synthetic',
      blurb: 'A synthetic group for tests.',
      items: [
        {
          id: 'synthetic-item-1',
          label: 'Synthetic Item',
          rel: '00 Synthetic/item-1',
          thumb: '.catalog/thumbs/synthetic-item-1.png',
          kind: 'Synthetic kind',
          files: 3,
          size: '1 KB',
          category: '00 Synthetic',
          domains: ['test-domain'],
          allowed_use: 'human-local-only',
          description: 'Synthetic style blurb. Best for passthrough tests.',
        },
      ],
    },
  ],
};

// A tiny (67-byte) but structurally valid 1x1 transparent PNG -- enough for
// the route to serve a real file with a real image/png Content-Type.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

// Windows non-admin runners can't create symlinks; probe once and skip the
// symlink-escape cases there instead of failing.
const canSymlink = (() => {
  try {
    const probeDir = mkdtempSync(path.join(tmpdir(), 'od-symlink-probe-'));
    writeFileSync(path.join(probeDir, 'a'), '');
    symlinkSync(path.join(probeDir, 'a'), path.join(probeDir, 'b'));
    rmSync(probeDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
})();

// A second synthetic catalog, used by the start-project tests below: one
// permitted kit (licensed-source-review, two files) and one restricted item
// (human-local-only) that must never be copyable.
const START_PROJECT_CATALOG = {
  library: 'Synthetic Test Library',
  rights_ledger: 'synthetic-ledger-fixture',
  note: 'allowed_use per collection mirrors a synthetic RIGHTS.md fixture',
  total_collections: 2,
  groups: [
    {
      title: 'Synthetic Kits',
      folder: '01 Kits',
      blurb: 'Synthetic kits for start-project tests.',
      items: [
        {
          id: 'permitted-kit-1',
          label: 'Permitted Kit',
          rel: '01 Kits/permitted-kit',
          thumb: null,
          kind: 'HTML kit',
          files: 2,
          size: '1 KB',
          category: '01 Kits',
          domains: ['test-domain'],
          allowed_use: 'licensed-source-review',
        },
        {
          id: 'restricted-kit-1',
          label: 'Restricted Kit',
          rel: '01 Kits/restricted-kit',
          thumb: null,
          kind: 'HTML kit',
          files: 1,
          size: '1 KB',
          category: '01 Kits',
          domains: ['test-domain'],
          allowed_use: 'human-local-only',
          description: 'Synthetic private reference.',
          aspects: ['WebGL', 'Hero'],
          stacks: ['React', 'Three.js'],
          reference: {
            source: 'Synthetic private source',
            design: 'DESIGN.md',
            html: 'reference.html',
            design_sha256: 'synthetic-design-sha',
            html_sha256: 'synthetic-html-sha',
          },
        },
        {
          id: 'escape-kit-1',
          label: 'Escape Kit',
          rel: '01 Kits/escape-kit',
          thumb: null,
          kind: 'HTML kit',
          files: 1,
          size: '1 KB',
          category: '01 Kits',
          domains: ['test-domain'],
          allowed_use: 'licensed-source-review',
        },
        {
          id: 'symlinked-kit-1',
          label: 'Symlinked Kit',
          rel: '01 Kits/symlinked-kit',
          thumb: null,
          kind: 'HTML kit',
          files: 2,
          size: '1 KB',
          category: '01 Kits',
          domains: ['test-domain'],
          allowed_use: 'licensed-source-review',
        },
        // Its OWN directory entry is a symlink to restricted-kit, another
        // collection inside the SAME fixture library -- realpath(target)
        // still resolves inside root, so containment alone (withinReal)
        // would pass it, but the bytes actually copied would be
        // restricted-kit's under this item's licensed-source-review label.
        {
          id: 'in-root-symlinked-kit-1',
          label: 'In-Root Symlinked Kit',
          rel: '01 Kits/in-root-symlinked-kit',
          thumb: null,
          kind: 'HTML kit',
          files: 1,
          size: '1 KB',
          category: '01 Kits',
          domains: ['test-domain'],
          allowed_use: 'licensed-source-review',
        },
        // Reached only through a symlinked INTERMEDIATE directory
        // (nested-link -> permitted-kit); the final path segment (assets)
        // is a real directory, not a symlink itself, so a leaf-only symlink
        // check would miss this.
        {
          id: 'nested-symlink-kit-1',
          label: 'Nested Symlink Kit',
          rel: '01 Kits/nested-link/assets',
          thumb: null,
          kind: 'HTML kit',
          files: 1,
          size: '1 KB',
          category: '01 Kits',
          domains: ['test-domain'],
          allowed_use: 'licensed-source-review',
        },
        // Ships its design content next to a derived build cache
        // (.next/cache/webpack/*.pack), the way real UI8 Next.js kits do.
        // The cache must not count against the copy caps or reach the
        // copied project.
        {
          id: 'cached-kit-1',
          label: 'Cached Kit',
          rel: '01 Kits/cached-kit',
          thumb: null,
          kind: 'HTML kit',
          files: 3,
          size: '9 KB',
          category: '01 Kits',
          domains: ['test-domain'],
          allowed_use: 'licensed-source-review',
        },
      ],
    },
  ],
};

describe('design library routes', () => {
  let server: http.Server | null = null;
  let shutdown: (() => Promise<void> | void) | undefined;
  let fixtureDir: string | null = null;
  let outsideDir: string | null = null;
  const PREV_ROOT = process.env.OD_DESIGN_LIBRARY_DIR;
  const PREV_MAX_FILES = process.env.OD_DESIGN_LIBRARY_COPY_MAX_FILES;
  const PREV_MAX_BYTES = process.env.OD_DESIGN_LIBRARY_COPY_MAX_BYTES;

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
    if (outsideDir) {
      rmSync(outsideDir, { recursive: true, force: true });
      outsideDir = null;
    }
    if (PREV_ROOT === undefined) delete process.env.OD_DESIGN_LIBRARY_DIR;
    else process.env.OD_DESIGN_LIBRARY_DIR = PREV_ROOT;
    if (PREV_MAX_FILES === undefined) delete process.env.OD_DESIGN_LIBRARY_COPY_MAX_FILES;
    else process.env.OD_DESIGN_LIBRARY_COPY_MAX_FILES = PREV_MAX_FILES;
    if (PREV_MAX_BYTES === undefined) delete process.env.OD_DESIGN_LIBRARY_COPY_MAX_BYTES;
    else process.env.OD_DESIGN_LIBRARY_COPY_MAX_BYTES = PREV_MAX_BYTES;
  });

  async function start(): Promise<string> {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
      shutdown?: () => Promise<void> | void;
    };
    server = started.server;
    shutdown = started.shutdown;
    return started.url;
  }

  function makeFixture(): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'od-design-library-test-'));
    writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(SYNTHETIC_CATALOG, null, 2), 'utf8');
    const thumbsDir = path.join(dir, '.catalog', 'thumbs');
    mkdirSync(thumbsDir, { recursive: true });
    writeFileSync(path.join(thumbsDir, 'synthetic-item-1.png'), Buffer.from(TINY_PNG_BASE64, 'base64'));
    return dir;
  }

  // Backs START_PROJECT_CATALOG above with real files on disk: a permitted
  // two-file kit, a restricted one-file kit, an escape kit whose own
  // directory entry is a symlink pointing outside the root, and a permitted
  // kit whose contents include an internal symlinked file.
  function makeStartProjectFixture(): { dir: string; outside: string } {
    const dir = mkdtempSync(path.join(tmpdir(), 'od-design-library-start-project-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'od-design-library-start-project-outside-'));
    writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(START_PROJECT_CATALOG, null, 2), 'utf8');

    const kitsRoot = path.join(dir, '01 Kits');
    mkdirSync(kitsRoot, { recursive: true });

    const permittedKit = path.join(kitsRoot, 'permitted-kit');
    mkdirSync(path.join(permittedKit, 'assets'), { recursive: true });
    mkdirSync(path.join(permittedKit, '.catalog', 'nested'), { recursive: true });
    mkdirSync(path.join(permittedKit, 'assets', '.CATALOG'), { recursive: true });
    mkdirSync(path.join(permittedKit, 'metadata-link'), { recursive: true });
    writeFileSync(path.join(permittedKit, 'index.html'), '<!doctype html><title>Permitted</title>', 'utf8');
    writeFileSync(path.join(permittedKit, 'assets', 'app.js'), 'console.log("kit");', 'utf8');
    writeFileSync(path.join(permittedKit, '.catalog', 'nested', 'private.json'), '{"private":true}', 'utf8');
    writeFileSync(path.join(permittedKit, 'assets', '.CATALOG', 'private.json'), '{"private":true}', 'utf8');
    writeFileSync(path.join(permittedKit, 'RIGHTS.JSON'), '{"private":true}', 'utf8');
    writeFileSync(path.join(permittedKit, 'assets', 'rights.json'), '{"private":true}', 'utf8');
    writeFileSync(path.join(permittedKit, '.design-library-item.json'), '{"private":true}', 'utf8');
    writeFileSync(path.join(permittedKit, 'assets', '.DESIGN-LIBRARY-ITEM.JSON'), '{"private":true}', 'utf8');
    if (canSymlink) {
      symlinkSync(outside, path.join(permittedKit, 'metadata-link', '.CaTaLoG'));
    }

    const restrictedKit = path.join(kitsRoot, 'restricted-kit');
    mkdirSync(restrictedKit, { recursive: true });
    writeFileSync(path.join(restrictedKit, 'reference.html'), '<!doctype html><title>Restricted</title>', 'utf8');
    writeFileSync(
      path.join(restrictedKit, 'DESIGN.md'),
      '---\nname: Synthetic\n---\n\n## Overview\nPrivate test design.\n\n## WebGL\nUse a particle field.\n',
      'utf8',
    );

    // cached-kit: two small real files plus a webpack cache pack file that
    // is larger than the byte cap the cache-skipping test sets. Mirrors the
    // production shape of a Next.js kit shipped with its .next/ droppings.
    const cachedKit = path.join(kitsRoot, 'cached-kit');
    mkdirSync(path.join(cachedKit, 'assets'), { recursive: true });
    mkdirSync(path.join(cachedKit, '.next', 'cache', 'webpack', 'client-development'), { recursive: true });
    writeFileSync(path.join(cachedKit, 'index.html'), '<!doctype html><title>Cached</title>', 'utf8');
    writeFileSync(path.join(cachedKit, 'assets', 'app.js'), 'console.log("kit");', 'utf8');
    writeFileSync(
      path.join(cachedKit, '.next', 'cache', 'webpack', 'client-development', '29.pack'),
      Buffer.alloc(8192),
    );

    writeFileSync(path.join(outside, 'secret.txt'), 'secret', 'utf8');

    if (canSymlink) {
      symlinkSync(outside, path.join(kitsRoot, 'escape-kit'));

      const symlinkedKit = path.join(kitsRoot, 'symlinked-kit');
      mkdirSync(symlinkedKit, { recursive: true });
      writeFileSync(path.join(symlinkedKit, 'index.html'), '<!doctype html><title>Symlinked</title>', 'utf8');
      writeFileSync(path.join(outside, 'linked-target.txt'), 'asset', 'utf8');
      symlinkSync(path.join(outside, 'linked-target.txt'), path.join(symlinkedKit, 'linked.txt'));

      // in-root-symlinked-kit: its own directory entry is a symlink to
      // restricted-kit, a DIFFERENT (restricted) collection inside this
      // same fixture library -- see FIX 3.
      symlinkSync(restrictedKit, path.join(kitsRoot, 'in-root-symlinked-kit'));

      // nested-link -> permitted-kit: a symlinked intermediate directory.
      // The catalog item's rel resolves through it to a real subdirectory
      // (permitted-kit/assets), which is not itself a symlink.
      symlinkSync(permittedKit, path.join(kitsRoot, 'nested-link'));
    }

    return { dir, outside };
  }

  it('round-trips the synthetic catalog with its resolved root', async () => {
    fixtureDir = makeFixture();
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/catalog`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof SYNTHETIC_CATALOG & { root: string };
    expect(body).toMatchObject({
      library: 'Synthetic Test Library',
      total_collections: 1,
      root: fixtureDir,
    });
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]?.items[0]).toMatchObject({
      id: 'synthetic-item-1',
      allowed_use: 'human-local-only',
      // Curated per-item descriptions authored in the external catalog must
      // reach consumers (web cards, preview dialog, `od design-library show`).
      description: 'Synthetic style blurb. Best for passthrough tests.',
    });
  });

  it('serves a thumb file directly under the thumbs directory', async () => {
    fixtureDir = makeFixture();
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/thumb/synthetic-item-1.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('rejects a path-traversal thumb request with 400', async () => {
    fixtureDir = makeFixture();
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    // encodeURIComponent keeps this a single path segment so it reaches the
    // `:file` route param intact instead of being collapsed by URL dot-
    // segment normalization -- same technique as the containment tests for
    // /api/skills/:id/assets/*.
    const traversal = encodeURIComponent('../../../../../../etc/passwd');
    const res = await fetch(`${daemonUrl}/api/design-library/thumb/${traversal}`);
    expect(res.status).toBe(400);
  });

  it('404s a thumb request for a file that does not exist', async () => {
    fixtureDir = makeFixture();
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/thumb/does-not-exist.png`);
    expect(res.status).toBe(404);
  });

  it('404s the catalog endpoint when the library root does not exist on this machine', async () => {
    const missingRoot = path.join(tmpdir(), `od-design-library-missing-${Date.now()}`);
    process.env.OD_DESIGN_LIBRARY_DIR = missingRoot;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/catalog`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'design library not found' });
  });

  it('rejects a thumb request for a non-image extension with 400', async () => {
    fixtureDir = makeFixture();
    writeFileSync(path.join(fixtureDir, '.catalog', 'thumbs', 'page.html'), '<script>alert(1)</script>', 'utf8');
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/thumb/page.html`);
    expect(res.status).toBe(400);
  });

  it.runIf(canSymlink)('rejects a thumb symlink that escapes the library root with 400', async () => {
    fixtureDir = makeFixture();
    outsideDir = mkdtempSync(path.join(tmpdir(), 'od-design-library-outside-'));
    const secret = path.join(outsideDir, 'secret.png');
    writeFileSync(secret, Buffer.from(TINY_PNG_BASE64, 'base64'));
    // The symlink's own path sits inside thumbs/, so the lexical prefix
    // check alone would pass -- only realpath re-validation catches it.
    symlinkSync(secret, path.join(fixtureDir, '.catalog', 'thumbs', 'evil.png'));
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/thumb/evil.png`);
    expect(res.status).toBe(400);
  });

  it('rejects an open request without rel with 400', async () => {
    fixtureDir = makeFixture();
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a path-traversal open request with 400', async () => {
    fixtureDir = makeFixture();
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel: '../../../../etc' }),
    });
    expect(res.status).toBe(400);
  });

  it('404s an open request for a path that does not exist under the root', async () => {
    fixtureDir = makeFixture();
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel: 'does-not-exist' }),
    });
    expect(res.status).toBe(404);
  });

  it.runIf(canSymlink)('rejects an open request whose target symlinks outside the root with 400', async () => {
    fixtureDir = makeFixture();
    outsideDir = mkdtempSync(path.join(tmpdir(), 'od-design-library-outside-'));
    symlinkSync(outsideDir, path.join(fixtureDir, 'escape'));
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel: 'escape' }),
    });
    expect(res.status).toBe(400);
  });

  it('starts a project from a permitted kit and copies its files', async () => {
    const fixture = makeStartProjectFixture();
    fixtureDir = fixture.dir;
    outsideDir = fixture.outside;
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/start-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel: '01 Kits/permitted-kit' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(typeof body.projectId).toBe('string');
    expect(typeof body.conversationId).toBe('string');
    expect(body.entryFile).toBe('index.html');
    expect(body.copiedFiles).toBe(2);
    expect(body.skippedFiles).toBe(canSymlink ? 7 : 6);
    expect(body.warnings).toEqual([]);
    expect(body.project?.id).toBe(body.projectId);
    expect(body.project?.name).toBe('Permitted Kit');

    // Confirm the files actually landed in the new project, not just that
    // the response counters say so.
    const filesRes = await fetch(`${daemonUrl}/api/projects/${body.projectId}/files`);
    expect(filesRes.status).toBe(200);
    const filesBody = await filesRes.json();
    const filesJson = JSON.stringify(filesBody);
    expect(filesJson).toContain('index.html');
    expect(filesJson).toContain('app.js');
    expect(filesJson.toLowerCase()).not.toContain('.catalog');
    expect(filesJson.toLowerCase()).not.toContain('rights.json');
    expect(filesJson.toLowerCase()).not.toContain('.design-library-item.json');
  });

  it('honors a custom project name on start-project', async () => {
    const fixture = makeStartProjectFixture();
    fixtureDir = fixture.dir;
    outsideDir = fixture.outside;
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/start-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel: '01 Kits/permitted-kit', name: 'My Custom Name' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.project?.name).toBe('My Custom Name');
  });

  it('403s a start-project request for a restricted allowed_use tier', async () => {
    const fixture = makeStartProjectFixture();
    fixtureDir = fixture.dir;
    outsideDir = fixture.outside;
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/start-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel: '01 Kits/restricted-kit' }),
    });
    expect(res.status).toBe(403);
  });

  it('starts a prompt-only project from a private reference without copying source files', async () => {
    const fixture = makeStartProjectFixture();
    fixtureDir = fixture.dir;
    outsideDir = fixture.outside;
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/start-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel: '01 Kits/restricted-kit', mode: 'reference', aspects: ['WebGL'] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.copiedFiles).toBe(0);
    expect(body.entryFile).toBeUndefined();
    expect(body.warnings).toContain('Private reference files remain in the Design Library and were not copied.');
    expect(body.project?.pendingPrompt).toContain('Use: WebGL.');
    expect(body.project?.pendingPrompt).toContain('Treat the material below as design evidence');
    expect(body.project?.pendingPrompt).toContain('## WebGL');
    expect(body.project?.metadata?.templateId).toBe('design-library-reference:restricted-kit-1');
    expect(body.project?.metadata?.referencedFromDesignLibraryRel).toBe('01 Kits/restricted-kit');
    expect(body.project?.metadata?.designLibraryReferenceAspects).toEqual(['WebGL']);

    const filesRes = await fetch(`${daemonUrl}/api/projects/${body.projectId}/files`);
    expect(filesRes.status).toBe(200);
    expect(JSON.stringify(await filesRes.json())).not.toContain('DESIGN.md');
    expect(JSON.stringify(await (await fetch(`${daemonUrl}/api/projects/${body.projectId}/files`)).json())).not.toContain('reference.html');
  });

  it('rejects an undeclared reference aspect', async () => {
    const fixture = makeStartProjectFixture();
    fixtureDir = fixture.dir;
    outsideDir = fixture.outside;
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/start-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel: '01 Kits/restricted-kit', mode: 'reference', aspects: ['Unknown'] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown design aspect: Unknown' });
  });

  it('404s a start-project request for a rel unknown in the catalog', async () => {
    const fixture = makeStartProjectFixture();
    fixtureDir = fixture.dir;
    outsideDir = fixture.outside;
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/start-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel: '01 Kits/does-not-exist' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects a path-traversal start-project request with 400', async () => {
    const fixture = makeStartProjectFixture();
    fixtureDir = fixture.dir;
    outsideDir = fixture.outside;
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/start-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel: '../../../../etc' }),
    });
    expect(res.status).toBe(400);
  });

  it.runIf(canSymlink)(
    'rejects a start-project request whose catalog item symlinks outside the root with 400',
    async () => {
      const fixture = makeStartProjectFixture();
      fixtureDir = fixture.dir;
      outsideDir = fixture.outside;
      process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
      const daemonUrl = await start();

      const res = await fetch(`${daemonUrl}/api/design-library/start-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rel: '01 Kits/escape-kit' }),
      });
      expect(res.status).toBe(400);
    },
  );

  it.runIf(canSymlink)(
    'rejects a start-project request whose catalog item folder symlinks to a restricted collection inside the same library with 400',
    async () => {
      const fixture = makeStartProjectFixture();
      fixtureDir = fixture.dir;
      outsideDir = fixture.outside;
      process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
      const daemonUrl = await start();

      const res = await fetch(`${daemonUrl}/api/design-library/start-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rel: '01 Kits/in-root-symlinked-kit' }),
      });
      expect(res.status).toBe(400);

      // Nothing was copied -- confirm no project got created for it either.
      const listRes = await fetch(`${daemonUrl}/api/projects`);
      const listBody = await listRes.json();
      const names = JSON.stringify(listBody);
      expect(names).not.toContain('In-Root Symlinked Kit');
    },
  );

  it.runIf(canSymlink)(
    'rejects a start-project request whose rel path resolves through a symlinked intermediate directory with 400',
    async () => {
      const fixture = makeStartProjectFixture();
      fixtureDir = fixture.dir;
      outsideDir = fixture.outside;
      process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
      const daemonUrl = await start();

      const res = await fetch(`${daemonUrl}/api/design-library/start-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rel: '01 Kits/nested-link/assets' }),
      });
      expect(res.status).toBe(400);
    },
  );

  it.runIf(canSymlink)(
    'rejects a start-project copy that would skip an internal symlinked file with 422',
    async () => {
      const fixture = makeStartProjectFixture();
      fixtureDir = fixture.dir;
      outsideDir = fixture.outside;
      process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
      const daemonUrl = await start();

      const res = await fetch(`${daemonUrl}/api/design-library/start-project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rel: '01 Kits/symlinked-kit' }),
      });
      expect(res.status).toBe(422);
    },
  );

  // Red spec for the "large kit fails import blaming a cache file" bug:
  // real UI8 Next.js kits ship their .next/ webpack cache (hundreds of MB),
  // which counted against the copy byte cap and aborted the whole import
  // with "size limit would skip a required file (.next/.../NN.pack)" even
  // though the kit's actual design content fit comfortably.
  it('copies a kit whose derived build cache alone would breach the byte cap', async () => {
    const fixture = makeStartProjectFixture();
    fixtureDir = fixture.dir;
    outsideDir = fixture.outside;
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    // Smaller than the 8 KB cache pack file, larger than the two real
    // files: import only succeeds if the cache never enters the walk.
    process.env.OD_DESIGN_LIBRARY_COPY_MAX_BYTES = '4096';
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/start-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel: '01 Kits/cached-kit' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { copiedFiles: number; skippedFiles: number };
    // Both real files arrive; the .next tree is skipped, not copied and
    // not counted against the caps.
    expect(body.copiedFiles).toBe(2);
    expect(body.skippedFiles).toBeGreaterThanOrEqual(1);
  });

  it('enforces the copy file cap during start-project', async () => {
    const fixture = makeStartProjectFixture();
    fixtureDir = fixture.dir;
    outsideDir = fixture.outside;
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    // The permitted-kit fixture has two files; capping at one forces the
    // copy engine's onIncomplete path without needing a 6000-file fixture.
    process.env.OD_DESIGN_LIBRARY_COPY_MAX_FILES = '1';
    const daemonUrl = await start();

    const res = await fetch(`${daemonUrl}/api/design-library/start-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rel: '01 Kits/permitted-kit' }),
    });
    expect(res.status).toBe(422);
  });
});
