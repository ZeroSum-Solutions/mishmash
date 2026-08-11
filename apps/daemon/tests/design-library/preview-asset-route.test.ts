import type http from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { designLibraryTreeSha256 } from '../../src/design-library/rights.js';

import { startServer } from '../../src/server.js';

// GET /api/design-library/preview-asset/:rel/*file — serves bytes from
// inside one catalog item's own directory so the "Explore kit" canvas can
// load the item's entry HTML plus its relatively-referenced CSS/JS/image
// siblings in a sandboxed iframe. Fixture data is entirely invented, same
// rule as open-route.test.ts.
describe('design library preview-asset route', () => {
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

  function previewAssetUrl(daemonUrl: string, rel: string, filePath: string): string {
    const relSegment = encodeURIComponent(rel);
    const fileSegment = filePath.split('/').map((seg) => encodeURIComponent(seg)).join('/');
    return `${daemonUrl}/api/design-library/preview-asset/${relSegment}/${fileSegment}`;
  }

  async function makeFixture(): Promise<string> {
    const dir = mkdtempSync(path.join(tmpdir(), 'od-design-library-preview-asset-'));
    const licensed = path.join(dir, '01 Kits', 'licensed-kit');
    const unlicensed = path.join(dir, '01 Kits', 'unlicensed-kit');
    const capture = path.join(dir, '01 Kits', 'capture-kit');
    mkdirSync(path.join(licensed, 'css'), { recursive: true });
    mkdirSync(unlicensed, { recursive: true });
    mkdirSync(capture, { recursive: true });
    writeFileSync(
      path.join(licensed, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="css/style.css"></head><body>Kit</body></html>',
      'utf8',
    );
    writeFileSync(path.join(licensed, 'css', 'style.css'), 'body { color: red; }', 'utf8');
    writeFileSync(path.join(licensed, 'rights.json'), '{"secret":true}', 'utf8');
    writeFileSync(path.join(unlicensed, 'index.html'), '<!doctype html><title>No rights</title>', 'utf8');
    writeFileSync(path.join(capture, 'index.html'), '<!doctype html><title>Capture</title>', 'utf8');

    const catalog = {
      library: 'Preview Asset Fixture',
      rights_ledger: 'RIGHTS.md',
      note: '',
      total_collections: 3,
      groups: [{
        title: 'Kits',
        folder: '01 Kits',
        blurb: '',
        items: [
          { id: 'a', label: 'Licensed', rel: '01 Kits/licensed-kit', thumb: null, kind: 'html', files: 3, size: '1 KB', category: 'ui-kit', domains: [], allowed_use: 'licensed-source-review' },
          { id: 'b', label: 'Capture', rel: '01 Kits/capture-kit', thumb: null, kind: 'html', files: 1, size: '1 KB', category: 'capture', domains: [], allowed_use: 'human-local-only' },
          { id: 'c', label: 'Unlicensed', rel: '01 Kits/unlicensed-kit', thumb: null, kind: 'html', files: 1, size: '1 KB', category: 'ui-kit', domains: [], allowed_use: 'blocked-pending-license' },
        ],
      }],
    };
    writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify(catalog), 'utf8');

    const ceiling = {
      '01 Kits/licensed-kit': 'licensed-source-review',
      '01 Kits/capture-kit': 'human-local-only',
    } as const;
    const records = Object.fromEntries(await Promise.all(
      Object.entries(ceiling).map(async ([rel, allowedUse]) => [rel, {
        tree_sha256: await designLibraryTreeSha256(path.join(dir, rel)),
        allowed_use: allowedUse,
        licence_ref: allowedUse === 'licensed-source-review' ? 'synthetic-test-licence' : null,
        source_url: null,
        captured_at: '2026-08-09T00:00:00.000Z',
        notes: 'Synthetic preview-asset record.',
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
    fixtureDir = await makeFixture();
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
      shutdown?: () => Promise<void> | void;
    };
    server = started.server;
    shutdown = started.shutdown;
    return started.url;
  }

  it('serves a licensed item\'s entry HTML with a CSP that allows CDN-hosted mockup assets', async () => {
    const daemonUrl = await startWithFixture();

    const res = await fetch(previewAssetUrl(daemonUrl, '01 Kits/licensed-kit', 'index.html'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<body>Kit</body>');
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    const csp = res.headers.get('content-security-policy');
    expect(csp).toContain("default-src 'self'");
    // Catalog templates are single-file mockups that depend on CDN-hosted
    // CSS/JS (e.g. cdn.tailwindcss.com, code.iconify.design) and images
    // (e.g. Unsplash) -- see the route's own comment for the full rationale.
    // The iframe consuming this stays sandboxed to an opaque origin, so
    // https: egress here can't reach this daemon's own API surface.
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' https:");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https:");
    expect(csp).toContain("img-src 'self' data: blob: https:");
    expect(csp).toContain("font-src 'self' data: https:");
    expect(csp).toContain("media-src 'self' data: blob: https:");
    // Iconify's web component fetches icon JSON over the network.
    expect(csp).toContain("connect-src 'self' https:");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves a relatively-referenced sibling asset from the same item', async () => {
    const daemonUrl = await startWithFixture();

    const res = await fetch(previewAssetUrl(daemonUrl, '01 Kits/licensed-kit', 'css/style.css'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('body { color: red; }');
    expect(res.headers.get('content-type')).toMatch(/^text\/css/);
  });

  it('403s a human-local-only item even though the catalog lists it', async () => {
    const daemonUrl = await startWithFixture();

    const res = await fetch(previewAssetUrl(daemonUrl, '01 Kits/capture-kit', 'index.html'));
    expect(res.status).toBe(403);
  });

  it('403s an item with no rights record', async () => {
    const daemonUrl = await startWithFixture();

    const res = await fetch(previewAssetUrl(daemonUrl, '01 Kits/unlicensed-kit', 'index.html'));
    expect(res.status).toBe(403);
  });

  it('never serves a private-metadata file even inside a licensed item', async () => {
    const daemonUrl = await startWithFixture();

    const res = await fetch(previewAssetUrl(daemonUrl, '01 Kits/licensed-kit', 'rights.json'));
    expect(res.status).toBe(400);
  });

  it('never leaks a file outside the item for a path-traversal file segment', async () => {
    const daemonUrl = await startWithFixture();

    // `fetch`'s URL parser collapses dot-segments against the full request
    // path per RFC 3986 before the request is even sent, so an escape that
    // walks past this route's own prefix (`../../etc/passwd`, two levels up
    // from the item) never reaches this route at all -- Express 404s it as
    // no route matched, which is equally safe: nothing under
    // /api/design-library/etc/passwd exists to serve. A `..` that still
    // resolves to a path this route WOULD match (`../unlicensed-kit/...`,
    // collapsing to a top-level `unlicensed-kit` this fixture never created
    // at that depth) reaches the handler and is rejected by its own
    // containment check.
    const escaped = await fetch(previewAssetUrl(daemonUrl, '01 Kits/licensed-kit', '../../etc/passwd'));
    expect(escaped.status).toBe(404);

    const withinRoute = await fetch(
      previewAssetUrl(daemonUrl, '01 Kits/licensed-kit', '../unlicensed-kit/index.html'),
    );
    expect(withinRoute.status).toBe(400);
  });

  it('reports the catalog gallery as thumb-only when no alternate cover exists on disk', async () => {
    const daemonUrl = await startWithFixture();

    const res = await fetch(`${daemonUrl}/api/design-library/catalog`);
    const body = (await res.json()) as { groups: { items: { rel: string; gallery: string[] }[] }[] };
    const licensed = body.groups[0]!.items.find((i) => i.rel === '01 Kits/licensed-kit')!;
    expect(licensed.gallery).toEqual([]);
  });

  it('includes a Figma-source alternate cover in the gallery when it exists on disk', async () => {
    fixtureDir = await makeFixture();
    mkdirSync(path.join(fixtureDir, '.catalog', 'thumbs'), { recursive: true });
    writeFileSync(path.join(fixtureDir, '.catalog', 'thumbs', 'a.jpg'), 'jpg-bytes', 'utf8');
    writeFileSync(path.join(fixtureDir, '.catalog', 'thumbs', 'a-fig.png'), 'png-bytes', 'utf8');
    const catalogPath = path.join(fixtureDir, 'catalog.json');
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    catalog.groups[0].items[0].thumb = '.catalog/thumbs/a.jpg';
    writeFileSync(catalogPath, JSON.stringify(catalog), 'utf8');
    process.env.OD_DESIGN_LIBRARY_DIR = fixtureDir;
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
      shutdown?: () => Promise<void> | void;
    };
    server = started.server;
    shutdown = started.shutdown;

    const res = await fetch(`${started.url}/api/design-library/catalog`);
    const body = (await res.json()) as { groups: { items: { rel: string; gallery: string[] }[] }[] };
    const licensed = body.groups[0]!.items.find((i) => i.rel === '01 Kits/licensed-kit')!;
    expect(licensed.gallery).toEqual(['.catalog/thumbs/a.jpg', '.catalog/thumbs/a-fig.png']);
  });
});
