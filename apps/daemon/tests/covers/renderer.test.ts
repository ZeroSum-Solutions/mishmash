// Bounded renderer (S4-2/S4-3/C4-5/C4-6). Real Chromium via Playwright --
// no mocked browser. These are the slowest tests in the covers/ suite
// (real browser launches), so each carries an explicit generous timeout.

import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COVER_TARGET_HEIGHT,
  COVER_TARGET_WIDTH,
  renderCoverImage,
} from '../../src/covers/renderer.js';
import { RenderMemoryLimitError, RenderTimeoutError } from '../../src/covers/errors.js';

let dir = '';

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'od-covers-renderer-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function writeEntry(html: string): Promise<string> {
  const abs = path.join(dir, 'index.html');
  await fs.writeFile(abs, html);
  return 'index.html';
}

describe('renderCoverImage', () => {
  it(
    'renders a valid project to the exact target dimensions',
    async () => {
      const entry = await writeEntry(
        `<!doctype html><html><body style="margin:0;width:1280px;height:1600px;background:linear-gradient(#111,#eee)"></body></html>`,
      );
      const result = await renderCoverImage(dir, dir, entry);
      expect(result.width).toBe(COVER_TARGET_WIDTH);
      expect(result.height).toBe(COVER_TARGET_HEIGHT);
      expect(result.imageBytes.length).toBeGreaterThan(0);
      // PNG signature.
      expect(result.imageBytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    },
    30_000,
  );

  it(
    'kills a pathological infinite-loop project with a typed RENDER_TIMEOUT, well under 90s',
    async () => {
      const entry = await writeEntry('<!doctype html><html><body><script>while(true){}</script></body></html>');
      const start = Date.now();
      await expect(renderCoverImage(dir, dir, entry)).rejects.toBeInstanceOf(RenderTimeoutError);
      expect(Date.now() - start).toBeLessThan(60_000);
    },
    70_000,
  );

  it(
    'kills a pathological memory-hog project with a typed RENDER_MEMORY_LIMIT',
    async () => {
      const entry = await writeEntry(
        '<!doctype html><html><body><script>let a=[];while(true){a.push(new Array(2000000).fill(7));}</script></body></html>',
      );
      await expect(renderCoverImage(dir, dir, entry)).rejects.toBeInstanceOf(RenderMemoryLimitError);
    },
    60_000,
  );

  it(
    'cannot reach the network: a project referencing a real local listener produces zero outbound hits',
    async () => {
      const hits: string[] = [];
      const canary = http.createServer((req, res) => {
        hits.push(req.url ?? '');
        res.writeHead(200);
        res.end('canary-ok');
      });
      await new Promise<void>((resolve) => canary.listen(0, '127.0.0.1', resolve));
      const address = canary.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      const canaryUrl = `http://127.0.0.1:${port}`;

      try {
        const entry = await writeEntry(`<!doctype html><html><head>
          <link rel="stylesheet" href="${canaryUrl}/tracker.css">
        </head><body>
          <img src="${canaryUrl}/pixel.gif">
          <script>fetch(${JSON.stringify(canaryUrl)} + '/xhr').catch(()=>{});</script>
        </body></html>`);
        const result = await renderCoverImage(dir, dir, entry);
        expect(result.imageBytes.length).toBeGreaterThan(0);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(hits).toEqual([]);
      } finally {
        await new Promise<void>((resolve) => canary.close(() => resolve()));
      }
    },
    30_000,
  );

  // Security-review finding 1: the renderer used to navigate straight at a
  // `file://` URL, so a hostile project's own HTML could pull in ANY local
  // file the daemon process can read -- a plain reference, a symlink
  // planted inside the project dir, or a same-tab self-navigation during
  // the render's settle window -- and have it baked into the screenshot
  // this daemon then serves back over HTTP as that project's cover. Fixed
  // by navigating through a project-root-scoped loopback server plus a
  // page.route() allowlist. This test plants a secret file OUTSIDE the
  // project dir with an unmistakable full-viewport marker color and
  // attempts to surface it via all three vectors at once; if containment
  // ever regresses on any of them the marker color would dominate the
  // frame, so the assertion is a full pixel scan for zero occurrences.
  it(
    'containment: a file:// reference outside the project dir, a same-tab file:// self-navigation, and a symlink escaping the project dir never appear in the rendered cover',
    async () => {
      const secretDir = await fs.mkdtemp(path.join(os.tmpdir(), 'od-covers-secret-'));
      const secretHtmlAbs = path.join(secretDir, 'secret.html');
      const MARKER_RGB = [255, 0, 220] as const; // distinctive magenta, vanishingly unlikely by chance
      await fs.writeFile(
        secretHtmlAbs,
        `<!doctype html><html><body style="margin:0;width:100vw;height:100vh;background:rgb(${MARKER_RGB.join(',')})"></body></html>`,
      );
      const secretFileUrl = `file://${secretHtmlAbs}`;

      // A symlink INSIDE the project dir pointing at the secret, referenced
      // via an ORDINARY relative src (never a file:// literal) -- proves
      // the loopback server's realpath containment specifically, not just
      // the page-level route interceptor.
      const symlinkRel = 'escape-link.html';
      let symlinkOk = true;
      try {
        await fs.symlink(secretHtmlAbs, path.join(dir, symlinkRel));
      } catch {
        symlinkOk = false; // e.g. no symlink permission in this environment -- skip that vector only
      }

      const entry = await writeEntry(`<!doctype html><html><body style="margin:0">
        <iframe src="${secretFileUrl}" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>
        ${symlinkOk ? `<iframe src="${symlinkRel}" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>` : ''}
        <script>
          try { top.location.href = ${JSON.stringify(secretFileUrl)}; } catch (e) {}
        </script>
      </body></html>`);

      try {
        const result = await renderCoverImage(dir, dir, entry);
        const { data, info } = await sharp(result.imageBytes)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        let markerPixels = 0;
        for (let i = 0; i + 2 < data.length; i += info.channels) {
          if (data[i] === MARKER_RGB[0] && data[i + 1] === MARKER_RGB[1] && data[i + 2] === MARKER_RGB[2]) {
            markerPixels += 1;
          }
        }
        expect(markerPixels).toBe(0);
      } finally {
        await fs.rm(secretDir, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
