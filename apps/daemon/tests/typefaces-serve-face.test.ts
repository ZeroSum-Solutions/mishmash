// F008 R1: GET /api/typefaces/:id/faces/:file. Route-level Vitest against a
// real express app + http.Server (mirrors static-resource-routes.test.ts's
// pattern), fixture catalogues in a temp dir -- never apps/daemon writes into
// the real design-templates/ tree.
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { isLocalSameOrigin } from '../src/origin-validation.js';
import { registerTypefaceRoutes } from '../src/routes/typefaces.js';
import { resetTypefaceIndexCache } from '../src/typefaces/catalogue.js';

const GOOGLE_FONT_FACE = (family: string, weight: string, file: string, unicodeRange: string) => `
@font-face {
  font-family: "${family}";
  src: url("./${file}") format("woff2");
  font-weight: ${weight};
  font-style: normal;
  unicode-range: ${unicodeRange};
  font-display: swap;
}`;

describe('GET /api/typefaces/:id/faces/:file', () => {
  let server: http.Server;
  let baseUrl: string;
  let tempRoot: string;
  let designTemplatesDir: string;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-typeface-faces-'));
        designTemplatesDir = path.join(tempRoot, 'design-templates');
        const app = express();
        registerTypefaceRoutes(app, {
          http: {
            createSseResponse: () => undefined,
            isLocalSameOrigin,
            requireLocalDaemonRequest: (_req: unknown, _res: unknown, next: () => void) => next(),
            resolvedPortRef: {
              get current() {
                const address = server.address();
                return typeof address === 'object' && address ? address.port : 0;
              },
            },
            sendApiError: (res: express.Response, status: number, code: string, message: string) =>
              res.status(status).json({ error: { code, message } }),
            sendLiveArtifactRouteError: () => undefined,
            sendMulterError: () => undefined,
          },
          db: {},
          paths: {
            ARTIFACTS_DIR: path.join(tempRoot, 'artifacts'),
            BRANDS_DIR: path.join(tempRoot, 'brands'),
            BUNDLED_PETS_DIR: path.join(tempRoot, 'pets'),
            CRAFT_DIR: path.join(tempRoot, 'craft'),
            DESIGN_SYSTEMS_DIR: path.join(tempRoot, 'design-systems'),
            DESIGN_TEMPLATES_DIR: designTemplatesDir,
            LIBRARY_DIR: path.join(tempRoot, 'library'),
            OD_BIN: path.join(tempRoot, 'od'),
            PROJECT_ROOT: tempRoot,
            PROJECTS_DIR: path.join(tempRoot, 'projects'),
            PROMPT_TEMPLATES_DIR: path.join(tempRoot, 'prompt-templates'),
            RUNTIME_DATA_DIR: path.join(tempRoot, 'data'),
            RUNTIME_DATA_DIR_CANONICAL: path.join(tempRoot, 'data'),
            SKILLS_DIR: path.join(tempRoot, 'skills'),
            USER_DESIGN_SYSTEMS_DIR: path.join(tempRoot, 'user-design-systems'),
            USER_DESIGN_TEMPLATES_DIR: path.join(tempRoot, 'user-design-templates'),
            USER_SKILLS_DIR: path.join(tempRoot, 'user-skills'),
          },
          projectStore: { getProject: () => undefined },
          projectFiles: { resolveProjectDir: () => tempRoot },
        });
        server = app.listen(0, '127.0.0.1', () => {
          const addr = server.address() as { port: number };
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      }),
  );

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          resolve();
        });
      }),
  );

  beforeEach(async () => {
    resetTypefaceIndexCache(designTemplatesDir);
    fs.rmSync(designTemplatesDir, { recursive: true, force: true });
    const fontsDir = path.join(designTemplatesDir, 'template-a', 'fonts');
    fs.mkdirSync(fontsDir, { recursive: true });
    fs.writeFileSync(
      path.join(fontsDir, 'fonts.css'),
      [
        GOOGLE_FONT_FACE('Archivo', '400', 'archivo-latin-aaa1111111.woff2', 'U+0000-00FF'),
        GOOGLE_FONT_FACE('Archivo', '700', 'archivo-latin-bbb2222222.woff2', 'U+0000-00FF'),
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(path.join(fontsDir, 'archivo-latin-aaa1111111.woff2'), 'fake-400-bytes', 'utf8');
    fs.writeFileSync(path.join(fontsDir, 'archivo-latin-bbb2222222.woff2'), 'fake-700-bytes', 'utf8');

    const otherFontsDir = path.join(designTemplatesDir, 'template-b', 'fonts');
    fs.mkdirSync(otherFontsDir, { recursive: true });
    fs.writeFileSync(
      path.join(otherFontsDir, 'fonts.css'),
      GOOGLE_FONT_FACE('Archivo Black', '400', 'archivo-black-latin-ccc3333333.woff2', 'U+0000-00FF'),
      'utf8',
    );
    fs.writeFileSync(path.join(otherFontsDir, 'archivo-black-latin-ccc3333333.woff2'), 'fake-black-bytes', 'utf8');
  });

  afterEach(() => {
    resetTypefaceIndexCache(designTemplatesDir);
  });

  it('serves the exact bytes with the correct content-type and an immutable cache header', async () => {
    const resp = await fetch(`${baseUrl}/api/typefaces/archivo/faces/archivo-latin-aaa1111111.woff2`);
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toBe('font/woff2');
    expect(resp.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await resp.text()).toBe('fake-400-bytes');
  });

  it('404s for an unknown family', async () => {
    const resp = await fetch(`${baseUrl}/api/typefaces/not-a-real-family/faces/archivo-latin-aaa1111111.woff2`);
    expect(resp.status).toBe(404);
  });

  it('404s for a real filename requested under the wrong family (cross-family)', async () => {
    const resp = await fetch(`${baseUrl}/api/typefaces/archivo/faces/archivo-black-latin-ccc3333333.woff2`);
    expect(resp.status).toBe(404);
  });

  it('404s for a traversal-shaped filename instead of resolving it against the filesystem', async () => {
    const resp = await fetch(`${baseUrl}/api/typefaces/archivo/faces/${encodeURIComponent('../../../../etc/passwd')}`);
    expect(resp.status).toBe(404);
  });

  it('404s once the indexed file has been deleted from disk after the index was built', async () => {
    fs.rmSync(path.join(designTemplatesDir, 'template-a', 'fonts', 'archivo-latin-bbb2222222.woff2'));
    const resp = await fetch(`${baseUrl}/api/typefaces/archivo/faces/archivo-latin-bbb2222222.woff2`);
    expect(resp.status).toBe(404);
  });

  it('rejects a symlink inside fonts/ that resolves outside the template directory', async () => {
    const secretPath = path.join(tempRoot, 'outside-secret.txt');
    fs.writeFileSync(secretPath, 'do-not-serve-me', 'utf8');
    const fontsDir = path.join(designTemplatesDir, 'template-a', 'fonts');
    const evilName = 'archivo-latin-eee5555555.woff2';
    fs.symlinkSync(secretPath, path.join(fontsDir, evilName));
    fs.appendFileSync(path.join(fontsDir, 'fonts.css'), GOOGLE_FONT_FACE('Archivo', '900', evilName, 'U+0000-00FF'));
    resetTypefaceIndexCache(designTemplatesDir);

    const resp = await fetch(`${baseUrl}/api/typefaces/archivo/faces/${evilName}`);
    expect(resp.status).toBe(400);
    expect(await resp.text()).not.toContain('do-not-serve-me');
  });
});
