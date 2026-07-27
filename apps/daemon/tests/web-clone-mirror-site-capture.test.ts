import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

// Capture-hardening (docket mishmash-docket-1-7), round-3 adversarial review
// findings F6 and F9/N6: subprocess-level reproductions of mirror-site.mjs
// itself against a real fixture HTTP server + cached Playwright, per the
// round-3 instruction that every fix needs a test reproducing the reviewer's
// exact probe (their sandbox could not run vitest, so prior verdicts came
// from direct node probes, not this suite).
//
//   F6: a 202/403 response whose ONLY bot-wall signal is the response BODY
//       (no recognized header) must still be detected during capture -- not
//       missed because nothing reads a non-2xx body.
//   F9/N6: a mirror that still has known-missing same-origin assets after
//       capture -- whether from hitting the recursive-fetch safety cap, OR
//       from a permanently-unreachable (404) referenced asset that the
//       recursive-fetch rounds exhaust without ever resolving -- must exit
//       non-zero and must NOT print "Mirror complete".
//
// Skipped (not failed) when no cached Playwright install is resolvable, same
// convention as web-clone-verify-mirror-server.test.ts's F17 subprocess test.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const mirrorSiteScriptPath = path.join(repoRoot, 'skills', 'web-clone', 'scripts', 'mirror-site.mjs');

function resolveCachedPlaywrightPath(): string | null {
  const pnpmDir = path.join(repoRoot, 'node_modules', '.pnpm');
  if (!fs.existsSync(pnpmDir)) return null;
  const match = fs.readdirSync(pnpmDir).find((name) => /^playwright@/.test(name));
  if (!match) return null;
  const candidate = path.join(pnpmDir, match, 'node_modules', 'playwright');
  return fs.existsSync(candidate) ? candidate : null;
}

const cachedPlaywrightPath = resolveCachedPlaywrightPath();

// mirror-site.mjs's own bot-wall hard-fail treats a captured root document
// under 512 bytes as itself a challenge page (see mirror-site.mjs's "captured
// page is an anti-bot challenge" check) -- an honest guard for a real site,
// but it means a minimal fixture body must be padded past that floor, or
// every subprocess test below would trip it and stop before ever reaching
// the behavior under test.
const FILLER = 'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(12);

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function startFixtureServer(routes: Record<string, Handler>): Promise<{ origin: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const handler = routes[url.pathname];
      if (handler) {
        handler(req, res);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

// Deliberately `execFile` (async), NOT `execFileSync`: the fixture HTTP
// server above runs on this SAME process's event loop, and mirror-site.mjs's
// child process needs it to keep answering requests while the child runs. A
// synchronous exec call blocks this process's event loop for its entire
// duration, so the fixture server could never respond -- a self-deadlock
// (the child hangs waiting on a parent that's frozen waiting on the child),
// not a product bug. `execFile`'s callback-based/awaited form keeps this
// process's event loop free to service the fixture server concurrently.
async function runMirrorSite(url: string, outDir: string): Promise<{ status: number; stdout: string; stderr: string }> {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [mirrorSiteScriptPath, '--url', url, '--out', outDir, '--max-ms', '20000', '--settle', '500'],
      {
        env: { ...process.env, OD_PLAYWRIGHT_PATH: cachedPlaywrightPath ?? '' },
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const execError = error as { code?: number; stdout?: string; stderr?: string };
    return { status: execError.code ?? 1, stdout: execError.stdout ?? '', stderr: execError.stderr ?? '' };
  }
}

describe.skipIf(!cachedPlaywrightPath)('mirror-site.mjs (F6/F9/N6: real subprocess run, cached Playwright)', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clone-mirror-site-'));
  });

  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('(F6) detects a body-only bot-wall signature on a non-200 response with no recognized header', async () => {
    const server = await startFixtureServer({
      '/': (_req, res) => {
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end(
            '<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title></head>' +
              '<body><script src="/blocked.js"></script><h1>Fixture</h1><p>' +
              FILLER +
              '</p></body></html>',
          );
      },
      '/blocked.js': (_req, res) => {
        // Status 403 with NO recognized bot-wall header -- the reviewer's
        // exact F6 probe: the ONLY signal is the response body itself.
        res.writeHead(403, { 'content-type': 'text/html' }).end('<html><body>cf-browser-verification</body></html>');
      },
    });

    try {
      const result = await runMirrorSite(`${server.origin}/`, outDir);

      expect(result.stdout + result.stderr).toMatch(/Bot-wall signature detected/);
    } finally {
      await server.close();
    }
  }, 60_000);

  it('(F9/N6) exits non-zero and does not print "Mirror complete" when a referenced same-origin asset 404s permanently', async () => {
    const server = await startFixtureServer({
      '/': (_req, res) => {
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end(
            '<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title>' +
              '<link rel="stylesheet" href="/permanently-missing.css"></head>' +
              '<body><h1>Fixture</h1><p>' +
              FILLER +
              '</p></body></html>',
          );
      },
      // /permanently-missing.css is intentionally never registered -- every
      // request for it 404s, every round, forever.
    });

    try {
      const result = await runMirrorSite(`${server.origin}/`, outDir);
      const combined = result.stdout + result.stderr;

      expect(result.status).not.toBe(0);
      expect(combined).not.toMatch(/Mirror complete/);
      expect(combined).toMatch(/INCOMPLETE/);
    } finally {
      await server.close();
    }
  }, 60_000);

  it('produces a complete mirror (exit 0, "Mirror complete") when every referenced asset is reachable', async () => {
    const server = await startFixtureServer({
      '/': (_req, res) => {
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end(
            '<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title>' +
              '<link rel="stylesheet" href="/styles.css"></head><body><h1>Fixture</h1><p>' +
              FILLER +
              '</p></body></html>',
          );
      },
      '/styles.css': (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/css' }).end('body{font-family:sans-serif}');
      },
    });

    try {
      const result = await runMirrorSite(`${server.origin}/`, outDir);
      const combined = result.stdout + result.stderr;

      expect(result.status).toBe(0);
      expect(combined).toMatch(/Mirror complete/);
    } finally {
      await server.close();
    }
  }, 60_000);
});

// --- Class-A close-out (wave W-C, criterion CC-2) ---
//
// A1, the false-green completion path. The F9/N6 test above passes only
// because its missing asset is EAGERLY requested by the browser (a <link>
// stylesheet), which lands the 404 in the `responses` map that the final
// tally iterates. A reference that only the post-capture discovery scan can
// see -- an unused CSS background url() with no matching element, so the
// browser never fires a request for it -- never enters `responses` at all.
// The recursive-fetch rounds claim it, fail to fetch it, exhaust with no
// progress, and exit the loop WITHOUT setting `mirrorIncomplete`; the tally
// then can't see it either, and the run prints "Mirror complete" with exit
// 0 over a mirror that is provably missing a referenced same-origin asset.
describe.skipIf(!cachedPlaywrightPath)('mirror-site.mjs (A1/CC-2: no-progress exhaustion must not report complete)', () => {
  let outDir: string;

  beforeEach(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clone-mirror-site-a1-'));
  });

  afterEach(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('(A1/CC-2) exits non-zero when a discovery-only reference (never browser-requested) is permanently unfetchable', async () => {
    const server = await startFixtureServer({
      '/': (_req, res) => {
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end(
            '<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title>' +
              '<link rel="stylesheet" href="/styles.css"></head>' +
              '<body><h1>Fixture</h1><p>' +
              FILLER +
              '</p></body></html>',
          );
      },
      '/styles.css': (_req, res) => {
        // The .unused rule matches no element, so no browser request is
        // ever fired for lazy-bg.png -- only the discovery scan can see it.
        res
          .writeHead(200, { 'content-type': 'text/css' })
          .end('body{font-family:sans-serif} .unused-hover-sprite{background-image:url(/assets/lazy-bg.png)}');
      },
      // /assets/lazy-bg.png is intentionally never registered: 404 forever.
    });

    try {
      const result = await runMirrorSite(`${server.origin}/`, outDir);
      const combined = result.stdout + result.stderr;

      expect(result.status).not.toBe(0);
      expect(combined).not.toMatch(/Mirror complete/);
      expect(combined).toMatch(/INCOMPLETE/);
    } finally {
      await server.close();
    }
  }, 60_000);
});
