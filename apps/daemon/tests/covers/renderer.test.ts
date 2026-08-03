// Bounded renderer (S4-2/S4-3/C4-5/C4-6). Real Chromium via Playwright --
// no mocked browser. These are the slowest tests in the covers/ suite
// (real browser launches), so each carries an explicit generous timeout.

import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
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
  return abs;
}

describe('renderCoverImage', () => {
  it(
    'renders a valid project to the exact target dimensions',
    async () => {
      const entry = await writeEntry(
        `<!doctype html><html><body style="margin:0;width:1280px;height:1600px;background:linear-gradient(#111,#eee)"></body></html>`,
      );
      const result = await renderCoverImage(entry);
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
      await expect(renderCoverImage(entry)).rejects.toBeInstanceOf(RenderTimeoutError);
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
      await expect(renderCoverImage(entry)).rejects.toBeInstanceOf(RenderMemoryLimitError);
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
        const result = await renderCoverImage(entry);
        expect(result.imageBytes.length).toBeGreaterThan(0);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(hits).toEqual([]);
      } finally {
        await new Promise<void>((resolve) => canary.close(() => resolve()));
      }
    },
    30_000,
  );
});
