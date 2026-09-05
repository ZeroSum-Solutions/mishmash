import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import {
  PREVIEW_PROXY_MOUNT,
  createPreviewRootAssetFallback,
} from '../src/preview-proxy.js';
import { createPreviewService } from '../src/previews.js';
import { registerPreviewRoutes } from '../src/routes/preview.js';

/**
 * Red spec for W2I.3 (finding F2 in `proof/w2/codex-wave-r3.json`).
 *
 * A proxied preview is announced as a path under the daemon's own front, and
 * the page's root-absolute assets (`/assets/x.js`) are answered from whichever
 * preview page the browser named in `Referer`. A page that suppresses its own
 * referrer — `<meta name="referrer" content="no-referrer">`, a privacy
 * extension — names nothing, so the fallback declines and the request ends in
 * the daemon's ordinary answer for a path it does not own: a bare 404 in this
 * fixture, `index.html` in the shipped runtime. Either way the reader is told
 * nothing, and the panel offering the link says it "works for anyone who can
 * open this workspace".
 *
 * The bar is a NAMED failure for exactly that request, and copy on both
 * surfaces that stops promising the link is unconditional. The cases that must
 * NOT change are pinned alongside it: an ordinary navigation, a page on
 * another site, and a daemon with no preview running are all still the
 * daemon's own 404.
 */

const CLI = path.join(__dirname, '..', 'src', 'cli.ts');
const TSX = path.join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');

/** A loopback-only dev server: the shape every framework preview child has. */
const SERVER_FIXTURE = `
const http = require('node:http');
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/css' });
  res.end('body{color:red}');
}).listen(Number(process.env.PORT), '127.0.0.1');
`;

/** The Accept a browser sends for a script, a stylesheet, and a navigation. */
const SCRIPT_ACCEPT = '*/*';
const NAVIGATION_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

type Reply = { status: number; body: string };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

function runCli(args: string[]): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    execFile(TSX, [CLI, ...args], { timeout: 30_000 }, (error, stdout) => {
      resolve({ code: error && typeof error.code === 'number' ? error.code : error ? 1 : 0, stdout });
    });
  });
}

describe('a root-absolute preview asset the daemon cannot attribute to a page', () => {
  const services: Array<ReturnType<typeof createPreviewService>> = [];
  const servers: http.Server[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(services.map((s) => s.shutdown().catch(() => {})));
    services.length = 0;
    await Promise.all(
      servers.map((s) => new Promise<void>((resolve) => {
        s.closeAllConnections?.();
        s.close(() => resolve());
      })),
    );
    servers.length = 0;
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  /**
   * The daemon's own wiring for the fallback, with a real preview child behind
   * it. Loopback and no `OD_API_TOKEN`: the membership rule is not what this
   * spec is about, and a loopback peer passes it by definition.
   */
  async function boot(): Promise<{ apiPort: number; previewId: string; base: string }> {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-preview-no-referrer-'));
    tempDirs.push(tempDir);
    writeFileSync(path.join(tempDir, 'server.js'), SERVER_FIXTURE);

    const previews = createPreviewService();
    services.push(previews);
    const app = express();
    app.use(PREVIEW_PROXY_MOUNT, express.raw({ type: () => true, limit: '4mb' }));
    app.use(express.json());
    registerPreviewRoutes(app, {
      previews,
      projectStore: { getProject: (id: string) => (id === 'p1' ? { id: 'p1' } : null) },
      resolvePreviewCwd: () => tempDir,
    });
    app.use(createPreviewRootAssetFallback({
      getPreview: (id) => previews.get(id),
      hasLivePreview: () => previews.list().length > 0,
    }));
    const server = http.createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const apiPort = (server.address() as AddressInfo).port;

    const started = await get(apiPort, '/api/projects/p1/previews', {
      method: 'POST',
      body: JSON.stringify({ command: [process.execPath, 'server.js'], port: await freePort() }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(started.status).toBe(200);
    const previewId = (JSON.parse(started.body) as { id: string }).id;
    return { apiPort, previewId, base: `/api/projects/p1/previews/${previewId}/proxy/` };
  }

  // node:http rather than fetch: these cases turn on the exact `Referer` and
  // `Accept` a browser sends, including their ABSENCE, which fetch supplies
  // defaults for.
  function get(
    apiPort: number,
    pathname: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
  ): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: apiPort,
          method: options.method ?? 'GET',
          path: pathname,
          headers: {
            Host: `127.0.0.1:${apiPort}`,
            ...(options.headers ?? {}),
            ...(options.body ? { 'Content-Length': Buffer.byteLength(options.body) } : {}),
          },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            text += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
        },
      );
      req.on('error', reject);
      if (options.body) req.write(options.body);
      req.end();
    });
  }

  it('names the missing page referrer instead of answering nothing', async () => {
    const { apiPort } = await boot();

    // The `no-referrer` page's script request: no `Referer` at all, and the
    // Accept a browser sends for a subresource rather than a page.
    const answered = await get(apiPort, '/assets/x.js', { headers: { Accept: SCRIPT_ACCEPT } });

    // THE BAR. The reader who opens this response sees why the file did not
    // arrive, not an empty 404 body.
    expect(answered.body).toMatch(/referrer/i);
    expect(answered.body).toContain('PREVIEW_REFERRER_REQUIRED');
  }, 30_000);

  /**
   * Red spec for W2J.1 (finding W2-R3-F2 / W2-R4-F2 in
   * `proof/w2/codex-wave-r4.json`).
   *
   * The classifier above reads only the headers, so while any preview is
   * running EVERY unattributable same-site GET matched it — including one
   * addressed to a namespace the daemon's own routes own. `/api/nope` is an
   * unknown daemon endpoint, `/artifacts/...` and `/frames/...` are static
   * mounts that call `next()` on a miss, and all three used to leave as
   * `PREVIEW_REFERRER_REQUIRED`: an explanation about a preview to a caller
   * who asked for a daemon resource and never mentioned one.
   *
   * The bar is that a daemon-owned path keeps the daemon's ordinary answer.
   * The positive case above pins the other half — a root-absolute preview
   * asset with no `Referer` is still named.
   */
  it('leaves an unknown daemon-owned path to the daemon instead of naming a preview', async () => {
    const { apiPort } = await boot();

    // The prefixes `server.ts` registers for the daemon's own routes, which
    // `static-spa.ts` already excludes from the SPA fallback for the same
    // reason. Each is asked for in the exact shape that used to be
    // misclassified: no `Referer`, and a subresource `Accept`.
    //
    // The upper-case spellings are the same namespaces: Express matches routes
    // case-insensitively by default, so `/API/nope` enters the `/api` router
    // and misses exactly as `/api/nope` does, and the daemon owes it the same
    // answer.
    for (const pathname of [
      '/api/nope',
      '/artifacts/nope.css',
      '/frames/nope.html',
      '/API/nope',
      '/Artifacts/nope.css',
      '/FRAMES/nope.html',
    ]) {
      const answered = await get(apiPort, pathname, { headers: { Accept: SCRIPT_ACCEPT } });

      expect(answered.body, pathname).not.toContain('PREVIEW_REFERRER_REQUIRED');
      expect(answered.body, pathname).not.toMatch(/referrer/i);
    }
  }, 30_000);

  it('still serves the asset for a page that names itself', async () => {
    const { apiPort, base } = await boot();

    const served = await get(apiPort, '/style.css', {
      headers: { Accept: SCRIPT_ACCEPT, Referer: `http://127.0.0.1:${apiPort}${base}` },
    });

    expect(served.status).toBe(200);
    expect(served.body).toBe('body{color:red}');
  }, 30_000);

  it('leaves an ordinary navigation to the daemon', async () => {
    const { apiPort } = await boot();

    // A person opening the app on a deep link sends no `Referer` either. That
    // request belongs to the daemon's own SPA fallback, and a preview must not
    // answer it.
    const answered = await get(apiPort, '/projects/p1', { headers: { Accept: NAVIGATION_ACCEPT } });

    expect(answered.body).not.toMatch(/referrer/i);
    expect(answered.body).not.toContain('PREVIEW_REFERRER_REQUIRED');
  }, 30_000);

  it('says nothing about previews when none is running', async () => {
    const { apiPort, previewId } = await boot();
    const stopped = await get(apiPort, `/api/projects/p1/previews/${previewId}`, { method: 'DELETE' });
    expect(stopped.status).toBe(200);

    const answered = await get(apiPort, '/assets/x.js', { headers: { Accept: SCRIPT_ACCEPT } });

    expect(answered.body).not.toMatch(/referrer/i);
    expect(answered.body).not.toContain('PREVIEW_REFERRER_REQUIRED');
  }, 30_000);

  it('says nothing to a subresource asked for by another site', async () => {
    const { apiPort } = await boot();

    // The same unattributable shape as the named case above, but the fetch is
    // made by a page on another origin. The daemon must not tell it that a
    // preview is running here, so the answer stays the ordinary one.
    const answered = await get(apiPort, '/assets/x.js', {
      headers: { Accept: SCRIPT_ACCEPT, Origin: 'https://attacker.example' },
    });

    expect(answered.body).not.toContain('PREVIEW_REFERRER_REQUIRED');
    expect(answered.body).not.toContain('body{color:red}');
  }, 30_000);

  it('says nothing to a page on another site', async () => {
    const { apiPort, base } = await boot();

    // A `Referer` any site can write must not be told a preview is running
    // here, and must not be answered as one either.
    const answered = await get(apiPort, '/assets/x.js', {
      headers: { Accept: SCRIPT_ACCEPT, Referer: `https://attacker.example${base}` },
    });

    expect(answered.body).not.toContain('PREVIEW_REFERRER_REQUIRED');
    expect(answered.body).not.toContain('body{color:red}');
  }, 30_000);
});

/**
 * The CLI half of the same claim (AGENTS.md, "Capability exposure"): `od
 * preview` help describes the announced link to an external agent the same way
 * the web panel describes it to a reader, so an unconditional promise there is
 * the same defect.
 */
describe('od preview help describes the shared link honestly', () => {
  it('states the referrer limit instead of promising the link works for anyone', async () => {
    const { code, stdout } = await runCli(['preview', '--help']);

    expect(code).toBe(0);
    expect(stdout).not.toMatch(/works for anyone/i);
    expect(stdout).toMatch(/referrer/i);
  }, 60_000);
});
