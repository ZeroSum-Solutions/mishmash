import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

// Capture-hardening (docket mishmash-docket-1-7), round-2 adversarial review
// finding F17 (the meta-fix): the round-1 gate tests imported only
// gate-decision.mjs and fed it already-classified fixture arrays -- they
// never executed verify-mirror.mjs's actual baseline reader, static server,
// path/traversal guard, or request classification. A reviewer confirmed that
// removing the traversal guard, ignoring the baseline's original origin, or
// mislabeling a MIME type would leave every prior gate test green, because
// none of them imported or launched the real server.
//
// This file closes that gap two ways:
//   1. Extracted pure(-ish) helpers -- lib/static-server.mjs's
//      resolveRequestPath (F13: realpath-based symlink-escape guard, F20:
//      malformed-percent-escape handling) and lib/request-classification.mjs's
//      classifyRequestOrigin (F19: real URL-origin comparison, not string
//      prefix) -- are imported and exercised directly against real
//      files/symlinks on disk. No Playwright needed for these.
//   2. A subprocess-level test actually spawns `verify-mirror.mjs` against a
//      real fixture site using this repo's cached Playwright install (not a
//      workspace dependency; resolved via OD_PLAYWRIGHT_PATH, see
//      lib/playwright-loader.mjs), asserting real exit codes on a complete
//      vs. an intentionally-broken mirror. Skipped (not failed) when no
//      cached Playwright is resolvable, so CI without one still passes.
//
// Round-3 review additions: F19's apex/www aliasing (classifyRequestOrigin
// unit tests below), and a second F17-style subprocess test that is itself
// the wiring test that would have caught F1 -- it stands up a SECOND real
// HTTP server as "the mirror's original live origin", serves a mirror that
// still references it absolutely (an asset the capture never downloaded),
// and asserts the real subprocess actually flags the origin-leak. A prior
// round's origin-leak gate tests only fed pre-classified fixture arrays into
// gate-decision.mjs, so a bug in verify-mirror.mjs's own response handler
// (only checking the leak classification for failing responses, missing the
// common 200-from-the-still-live-origin case) stayed invisible to them.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const staticServerScriptPath = path.join(repoRoot, 'skills', 'web-clone', 'scripts', 'lib', 'static-server.mjs');
const requestClassificationScriptPath = path.join(
  repoRoot,
  'skills',
  'web-clone',
  'scripts',
  'lib',
  'request-classification.mjs',
);
const verifyMirrorScriptPath = path.join(repoRoot, 'skills', 'web-clone', 'scripts', 'verify-mirror.mjs');

async function loadStaticServer() {
  return (await import(pathToFileURL(staticServerScriptPath).href)) as {
    resolveRequestPath: (siteRoot: string, requestPath: string) => string | null;
    contentTypeFor: (file: string) => string;
  };
}

async function loadRequestClassification() {
  return (await import(pathToFileURL(requestClassificationScriptPath).href)) as {
    classifyRequestOrigin: (
      requestUrl: string,
      context: { localBase: string; originalOrigin?: string | null },
    ) => 'local' | 'origin-leak' | 'cross-origin' | 'invalid';
  };
}

describe('resolveRequestPath (lib/static-server.mjs)', () => {
  let siteDir: string;

  beforeEach(() => {
    siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clone-static-server-'));
    fs.writeFileSync(path.join(siteDir, 'index.html'), '<!doctype html><html></html>');
    fs.mkdirSync(path.join(siteDir, 'images'));
    fs.writeFileSync(path.join(siteDir, 'images', 'logo.png'), 'fake-png-bytes');
  });

  afterEach(() => {
    fs.rmSync(siteDir, { recursive: true, force: true });
  });

  it('resolves a real in-root file', async () => {
    const { resolveRequestPath } = await loadStaticServer();

    const resolved = resolveRequestPath(siteDir, '/images/logo.png');

    expect(resolved).toBe(path.join(siteDir, 'images', 'logo.png'));
  });

  it('resolves the root path to index.html', async () => {
    const { resolveRequestPath } = await loadStaticServer();

    expect(resolveRequestPath(siteDir, '/')).toBe(path.join(siteDir, 'index.html'));
  });

  it('(F13) rejects a symlink whose target resolves outside siteRoot, even though it lexically starts with siteRoot', async () => {
    const { resolveRequestPath } = await loadStaticServer();
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clone-outside-'));
    const secretFile = path.join(outsideDir, 'secret.txt');
    fs.writeFileSync(secretFile, 'do not serve this');
    const linkPath = path.join(siteDir, 'private.txt');
    fs.symlinkSync(secretFile, linkPath);

    try {
      const resolved = resolveRequestPath(siteDir, '/private.txt');
      expect(resolved).toBeNull();
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('allows a symlink whose target resolves INSIDE siteRoot', async () => {
    const { resolveRequestPath } = await loadStaticServer();
    const linkPath = path.join(siteDir, 'alias.png');
    fs.symlinkSync(path.join(siteDir, 'images', 'logo.png'), linkPath);

    const resolved = resolveRequestPath(siteDir, '/alias.png');

    expect(resolved).toBe(linkPath);
  });

  it('rejects a lexical directory-traversal attempt', async () => {
    const { resolveRequestPath } = await loadStaticServer();

    expect(resolveRequestPath(siteDir, '/../../../etc/passwd')).toBeNull();
  });

  it('(F20) returns null (not a throw) on a malformed percent-escape', async () => {
    const { resolveRequestPath } = await loadStaticServer();

    expect(() => resolveRequestPath(siteDir, '/%E0%A4%A')).not.toThrow();
    expect(resolveRequestPath(siteDir, '/%E0%A4%A')).toBeNull();
  });

  it('returns null for a path that does not exist', async () => {
    const { resolveRequestPath } = await loadStaticServer();

    expect(resolveRequestPath(siteDir, '/nope.png')).toBeNull();
  });
});

describe('contentTypeFor (lib/static-server.mjs)', () => {
  it('maps common extensions to their MIME types', async () => {
    const { contentTypeFor } = await loadStaticServer();

    expect(contentTypeFor('site/index.html')).toContain('text/html');
    expect(contentTypeFor('site/app.js')).toContain('text/javascript');
    expect(contentTypeFor('site/logo.png')).toBe('image/png');
    expect(contentTypeFor('site/font.woff2')).toBe('font/woff2');
  });

  it('falls back to application/octet-stream for an unknown extension', async () => {
    const { contentTypeFor } = await loadStaticServer();

    expect(contentTypeFor('site/data.unknownext')).toBe('application/octet-stream');
  });
});

describe('classifyRequestOrigin (lib/request-classification.mjs, F19)', () => {
  it('classifies a request to the verifier\'s own local base as "local"', async () => {
    const { classifyRequestOrigin } = await loadRequestClassification();

    const kind = classifyRequestOrigin('http://127.0.0.1:1234/images/logo.png', { localBase: 'http://127.0.0.1:1234' });

    expect(kind).toBe('local');
  });

  // F19: string-prefix matching (`url.startsWith(base)`) would wrongly call
  // this "local" because "http://127.0.0.1:12345" textually starts with
  // "http://127.0.0.1:1234" -- exact URL-origin comparison does not.
  it('(F19) does NOT classify a different port that merely shares the base as a string prefix as "local"', async () => {
    const { classifyRequestOrigin } = await loadRequestClassification();

    const kind = classifyRequestOrigin('http://127.0.0.1:12345/api', { localBase: 'http://127.0.0.1:1234' });

    expect(kind).not.toBe('local');
  });

  // F1: an asset the capture never downloaded stays absolute after the
  // rewrite pass, so it loads fine from the still-live original origin
  // during verification. Recognizing that origin match (not the request's
  // status) is what makes this failure visible.
  it('(F1) classifies a request to the recorded original origin as "origin-leak"', async () => {
    const { classifyRequestOrigin } = await loadRequestClassification();

    const kind = classifyRequestOrigin('https://example.com/app.js', {
      localBase: 'http://127.0.0.1:1234',
      originalOrigin: 'https://example.com',
    });

    expect(kind).toBe('origin-leak');
  });

  it('classifies an unrelated third-party host as "cross-origin"', async () => {
    const { classifyRequestOrigin } = await loadRequestClassification();

    const kind = classifyRequestOrigin('https://fonts.googleapis.com/css', {
      localBase: 'http://127.0.0.1:1234',
      originalOrigin: 'https://example.com',
    });

    expect(kind).toBe('cross-origin');
  });

  it('classifies an unparsable URL as "invalid" rather than throwing', async () => {
    const { classifyRequestOrigin } = await loadRequestClassification();

    expect(() => classifyRequestOrigin('not a url', { localBase: 'http://127.0.0.1:1234' })).not.toThrow();
    expect(classifyRequestOrigin('not a url', { localBase: 'http://127.0.0.1:1234' })).toBe('invalid');
  });

  // F19 (round-3): the mirrored site (or the live original) may answer on
  // both its apex and `www.` host forms. A request to the www-alias of the
  // recorded original origin is still the SAME site leaking through, not an
  // unrelated cross-origin host -- and the reverse (baseline recorded the
  // www form, request lands on the apex) must alias identically.
  it('(F19) classifies a request to the www-alias of the recorded original origin as "origin-leak"', async () => {
    const { classifyRequestOrigin } = await loadRequestClassification();

    const kind = classifyRequestOrigin('https://www.example.com/app.js', {
      localBase: 'http://127.0.0.1:1234',
      originalOrigin: 'https://example.com',
    });

    expect(kind).toBe('origin-leak');
  });

  it('(F19) classifies a request to the apex when the baseline recorded the www form as "origin-leak"', async () => {
    const { classifyRequestOrigin } = await loadRequestClassification();

    const kind = classifyRequestOrigin('https://example.com/app.js', {
      localBase: 'http://127.0.0.1:1234',
      originalOrigin: 'https://www.example.com',
    });

    expect(kind).toBe('origin-leak');
  });
});

// --- F17: subprocess-level verify-mirror.mjs test against real Playwright ---

function resolveCachedPlaywrightPath(): string | null {
  const pnpmDir = path.join(repoRoot, 'node_modules', '.pnpm');
  if (!fs.existsSync(pnpmDir)) return null;
  const match = fs.readdirSync(pnpmDir).find((name) => /^playwright@/.test(name));
  if (!match) return null;
  const candidate = path.join(pnpmDir, match, 'node_modules', 'playwright');
  return fs.existsSync(candidate) ? candidate : null;
}

const cachedPlaywrightPath = resolveCachedPlaywrightPath();

function writeFixtureSite(siteDir: string): void {
  fs.mkdirSync(path.join(siteDir, 'images'), { recursive: true });
  fs.writeFileSync(
    path.join(siteDir, 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title>` +
      `<link rel="stylesheet" href="/styles.css"></head><body>` +
      `<h1>Fixture</h1><img src="/images/logo.png" width="1" height="1"></body></html>`,
  );
  fs.writeFileSync(path.join(siteDir, 'styles.css'), 'body{font-family:sans-serif}');
  // A minimal but valid 1x1 PNG (magic bytes + IHDR/IDAT/IEND), so a real
  // headless load actually decodes it rather than reporting a broken image
  // for an unrelated reason (an invalid file), which would give this test a
  // false failure signal.
  const onePixelPng = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c626060606000000005000160e585590000000049454e44ae426082',
    'hex',
  );
  fs.writeFileSync(path.join(siteDir, 'images', 'logo.png'), onePixelPng);
}

function runVerifyMirror(siteDir: string, extraArgs: string[] = []): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      [verifyMirrorScriptPath, '--site', siteDir, '--json', ...extraArgs],
      {
        env: { ...process.env, OD_PLAYWRIGHT_PATH: cachedPlaywrightPath ?? '' },
        encoding: 'utf8',
        timeout: 60_000,
      },
    );
    return { status: 0, stdout };
  } catch (error) {
    const execError = error as { status?: number; stdout?: string };
    return { status: execError.status ?? 1, stdout: execError.stdout ?? '' };
  }
}

describe.skipIf(!cachedPlaywrightPath)('verify-mirror.mjs (F17: real subprocess run, cached Playwright)', () => {
  let siteDir: string;

  beforeEach(() => {
    siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clone-verify-subprocess-'));
    writeFixtureSite(siteDir);
  });

  afterEach(() => {
    fs.rmSync(siteDir, { recursive: true, force: true });
  });

  it('exits 0 (PASS) against a complete fixture mirror', () => {
    const result = runVerifyMirror(siteDir);

    expect(result.status).toBe(0);
    const gate = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
    expect(gate.pass).toBe(true);
  }, 60_000);

  it('exits 1 (FAIL) once a referenced asset is deleted from the mirror', () => {
    fs.rmSync(path.join(siteDir, 'styles.css'));

    const result = runVerifyMirror(siteDir);

    expect(result.status).toBe(1);
    const gate = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
    expect(gate.pass).toBe(false);
  }, 60_000);

  // F17's own headline finding: this is the wiring test that would have
  // caught F1. A prior round's gate tests fed already-classified fixture
  // arrays straight into gate-decision.mjs and never exercised
  // verify-mirror.mjs's actual page.on('response') handler, so a bug there
  // (only checking the origin-leak classification for failing responses)
  // stayed invisible to every prior test. This spins up a SECOND real HTTP
  // server standing in for "the mirror's original live origin", serves a
  // mirror whose markup references it with an absolute, never-mirrored URL
  // (exactly what capture leaves behind for an asset it never downloaded),
  // and passes a --baseline whose `origin` matches that second server --
  // then asserts the real subprocess actually flags the leak and fails.
  it('(F17/F1) exits 1 and reports an originLeak when a referenced asset resolves against the recorded original origin', async () => {
    // Deliberately async (execFile, not execFileSync): this second server
    // runs on THIS process's event loop, and the verify-mirror.mjs child
    // needs it to keep answering while the child's headless browser loads
    // the mirror -- a synchronous exec would block this process's event
    // loop for the child's entire run, so the second server could never
    // respond (the same self-deadlock class as mirror-site.mjs's own F6/F9
    // subprocess tests).
    const originalOriginServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/javascript' }).end('/* still-live original asset */');
    });
    await new Promise<void>((resolve) => originalOriginServer.listen(0, '127.0.0.1', resolve));
    const address = originalOriginServer.address();
    const originalOrigin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    // A same-origin document (via `<script src>`) referencing the ORIGINAL
    // live origin absolutely -- exactly what capture leaves behind for an
    // asset that was never actually downloaded/rewritten.
    fs.writeFileSync(
      path.join(siteDir, 'index.html'),
      `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title>` +
        `<link rel="stylesheet" href="/styles.css"></head><body>` +
        `<h1>Fixture</h1><img src="/images/logo.png" width="1" height="1">` +
        `<script src="${originalOrigin}/leaked-asset.js"></script></body></html>`,
    );

    // Matches lib/viewport-capture.mjs's DEFAULT_VIEWPORTS shape -- all three
    // labels must be present for validateBaselineDocument's requiredLabels
    // check (F2) to accept this baseline at all.
    const requiredViewports = [
      { width: 1440, height: 900, dpr: 1, label: '1440' },
      { width: 768, height: 900, dpr: 1, label: '768' },
      { width: 390, height: 844, dpr: 2, label: '390' },
    ];
    const baseline = {
      capturedAt: new Date().toISOString(),
      origin: originalOrigin,
      metrics: requiredViewports.map((v) => ({
        viewport: v,
        scrollWidth: 1,
        scrollHeight: 1,
        frameworks: {},
        canvasCount: 0,
        imageCount: 1,
        videoCount: 0,
      })),
    };
    const baselinePath = path.join(siteDir, '..', 'baseline.json');
    fs.writeFileSync(baselinePath, JSON.stringify(baseline));

    try {
      let result: { status: number; stdout: string };
      try {
        const { stdout } = await execFileAsync(
          process.execPath,
          [verifyMirrorScriptPath, '--site', siteDir, '--baseline', baselinePath, '--json'],
          { env: { ...process.env, OD_PLAYWRIGHT_PATH: cachedPlaywrightPath ?? '' }, encoding: 'utf8', timeout: 60_000 },
        );
        result = { status: 0, stdout };
      } catch (error) {
        const execError = error as { code?: number; stdout?: string };
        result = { status: execError.code ?? 1, stdout: execError.stdout ?? '' };
      }

      expect(result.status).toBe(1);
      const gate = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
      expect(gate.pass).toBe(false);
      const originLeakCounts = gate.checks.map((check: { originLeaks?: { count: number } }) => check.originLeaks?.count ?? 0);
      expect(originLeakCounts.some((count: number) => count > 0)).toBe(true);
    } finally {
      fs.rmSync(baselinePath, { force: true });
      await new Promise<void>((resolve) => originalOriginServer.close(() => resolve()));
    }
  }, 60_000);
});
