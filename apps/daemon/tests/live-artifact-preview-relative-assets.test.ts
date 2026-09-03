// W2.4 red spec (B-10): a relative asset ref in a previewed project HTML page
// must resolve to the same project raw URL whichever way the page arrived --
// written to disk by an agent, or rendered from a live artifact.
//
// The disk-written page is served from `/api/projects/:id/raw/<file>`, so the
// browser resolves `assets/pic.png` against that file's own directory. The
// live-artifact preview is served from `/api/live-artifacts/:artifactId/
// preview`, whose directory has no relation to the project's files, so the
// same ref points at a route that serves nothing.
//
// Route-level Vitest against a real express app + http.Server (mirrors
// typefaces-serve-face.test.ts), with the live-artifact store rooted in a temp
// PROJECTS_DIR -- the daemon never writes into a real data root here.
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sendApiError } from '../src/http/api-errors.js';
import {
  sendLiveArtifactRouteError,
  setLiveArtifactCodeHeaders,
  setLiveArtifactPreviewHeaders,
} from '../src/live-artifacts/http-helpers.js';
import {
  createLiveArtifact,
  deleteLiveArtifact,
  ensureLiveArtifactPreview,
  getLiveArtifact,
  listLiveArtifactRefreshLogEntries,
  listLiveArtifacts,
  readLiveArtifactCode,
  updateLiveArtifact,
} from '../src/live-artifacts/store.js';
import { isLocalSameOrigin } from '../src/origin-validation.js';
import { resolveProjectFilePath } from '../src/projects.js';
import { registerLiveArtifactRoutes } from '../src/routes/live-artifact.js';

const PROJECT_ID = 'w24-relative-assets';
const RELATIVE_REF = 'assets/pic.png';
const DISK_PAGE = 'agent-written.html';
const PAGE_HTML = `<!doctype html><html><body><img src="${RELATIVE_REF}" alt="shot"></body></html>`;

/**
 * The URL a relative ref in `html` resolves against: the document's own
 * `<base href>` when it has one, otherwise the document URL itself. This is
 * exactly what a browser does, and it is the only thing that decides whether a
 * relative `<img src>` reaches the project file it names.
 */
function assetBaseUrl(documentUrl: string, html: string): string {
  const declaredBase = /<base\b[^>]*\bhref\s*=\s*["']([^"']*)["']/i.exec(html)?.[1];
  return declaredBase === undefined ? documentUrl : new URL(declaredBase, documentUrl).href;
}

describe('relative asset resolution across the two page-creation paths', () => {
  let server: http.Server;
  let baseUrl: string;
  let tempRoot: string;
  let projectsDir: string;
  let artifactId: string;

  beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w24-relative-assets-'));
    projectsDir = path.join(tempRoot, 'projects');

    // The project holds the asset both pages reference, plus the page an agent
    // wrote straight to disk.
    const projectDir = path.join(projectsDir, PROJECT_ID);
    fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, RELATIVE_REF), 'fake-png-bytes', 'utf8');
    fs.writeFileSync(path.join(projectDir, DISK_PAGE), PAGE_HTML, 'utf8');

    const created = await createLiveArtifact({
      projectsRoot: projectsDir,
      projectId: PROJECT_ID,
      input: {
        title: 'Headshot drafts',
        slug: 'headshot-drafts',
        preview: { type: 'html', entry: 'index.html' },
        document: {
          format: 'html_template_v1',
          templatePath: 'template.html',
          generatedPreviewPath: 'index.html',
          dataPath: 'data.json',
          dataJson: {},
        },
      },
      templateHtml: PAGE_HTML,
    });
    artifactId = created.artifact.id;

    const app = express();
    registerLiveArtifactRoutes(app, {
      db: {},
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
        sendApiError,
        sendLiveArtifactRouteError,
        sendMulterError: () => undefined,
      },
      paths: {
        ARTIFACTS_DIR: path.join(tempRoot, 'artifacts'),
        BRANDS_DIR: path.join(tempRoot, 'brands'),
        BUNDLED_PETS_DIR: path.join(tempRoot, 'pets'),
        CRAFT_DIR: path.join(tempRoot, 'craft'),
        DESIGN_SYSTEMS_DIR: path.join(tempRoot, 'design-systems'),
        DESIGN_TEMPLATES_DIR: path.join(tempRoot, 'design-templates'),
        LIBRARY_DIR: path.join(tempRoot, 'library'),
        OD_BIN: path.join(tempRoot, 'od'),
        PROJECT_ROOT: tempRoot,
        PROJECTS_DIR: projectsDir,
        PROMPT_TEMPLATES_DIR: path.join(tempRoot, 'prompt-templates'),
        RUNTIME_DATA_DIR: path.join(tempRoot, 'data'),
        RUNTIME_DATA_DIR_CANONICAL: path.join(tempRoot, 'data'),
        SKILLS_DIR: path.join(tempRoot, 'skills'),
        USER_DESIGN_SYSTEMS_DIR: path.join(tempRoot, 'user-design-systems'),
        USER_DESIGN_TEMPLATES_DIR: path.join(tempRoot, 'user-design-templates'),
        USER_SKILLS_DIR: path.join(tempRoot, 'user-skills'),
      },
      auth: {
        authorizeToolRequest: () => undefined,
        requestProjectOverride: () => false,
        requestRunOverride: () => false,
      },
      liveArtifacts: {
        createLiveArtifact,
        listLiveArtifacts,
        updateLiveArtifact,
        refreshLiveArtifact: () => undefined,
        emitLiveArtifactEvent: () => undefined,
        emitLiveArtifactRefreshEvent: () => undefined,
        readLiveArtifactCode,
        setLiveArtifactCodeHeaders,
        ensureLiveArtifactPreview,
        setLiveArtifactPreviewHeaders,
        getLiveArtifact,
        listLiveArtifactRefreshLogEntries,
        deleteLiveArtifact,
      },
      projectStore: { updateProject: () => undefined },
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          resolve();
        });
      }),
  );

  it('resolves a relative <img src> in a live-artifact preview to the project file it names', async () => {
    const previewUrl = `${baseUrl}/api/live-artifacts/${encodeURIComponent(artifactId)}/preview?projectId=${encodeURIComponent(PROJECT_ID)}`;
    const response = await fetch(previewUrl);
    expect(response.status).toBe(200);
    const previewHtml = await response.text();
    expect(previewHtml).toContain(`src="${RELATIVE_REF}"`);

    const resolved = new URL(RELATIVE_REF, assetBaseUrl(previewUrl, previewHtml));

    expect(resolved.pathname).toBe(
      `/api/projects/${encodeURIComponent(PROJECT_ID)}/raw/${RELATIVE_REF}`,
    );

    // Not just "a path that looks right": run the resolved URL's splat through
    // resolveProjectFilePath, the same resolver the raw route uses
    // (apps/daemon/src/routes/project/index.ts), so the assertion is about a
    // file that route would actually serve.
    const rawSplat = decodeURIComponent(resolved.pathname.split('/raw/')[1] ?? '');
    const served = await resolveProjectFilePath(projectsDir, PROJECT_ID, rawSplat);
    expect(served.name).toBe(RELATIVE_REF);
    expect(served.mime).toBe('image/png');
    expect(served.size).toBeGreaterThan(0);
  });

  it('resolves that ref to the same URL as the identical page written to disk', async () => {
    const previewUrl = `${baseUrl}/api/live-artifacts/${encodeURIComponent(artifactId)}/preview?projectId=${encodeURIComponent(PROJECT_ID)}`;
    const previewHtml = await (await fetch(previewUrl)).text();

    // The disk-written page is served by the raw-file route, so its own
    // document URL is what its relative refs resolve against. That URL shape is
    // the route's own: app.get(/^\/api\/projects\/([^/]+)\/raw\/(.+)$/u) in
    // apps/daemon/src/routes/project/index.ts, built web-side by projectRawUrl
    // (apps/web/src/providers/registry.ts). Registering that route here would
    // pull in the whole project-file dependency set; the first test already
    // proves the resolved path is one the route's resolver serves.
    const diskPageUrl = `${baseUrl}/api/projects/${encodeURIComponent(PROJECT_ID)}/raw/${DISK_PAGE}`;
    const diskPageHtml = fs.readFileSync(path.join(projectsDir, PROJECT_ID, DISK_PAGE), 'utf8');

    const fromArtifact = new URL(RELATIVE_REF, assetBaseUrl(previewUrl, previewHtml));
    const fromDisk = new URL(RELATIVE_REF, assetBaseUrl(diskPageUrl, diskPageHtml));

    expect(fromArtifact.pathname).toBe(fromDisk.pathname);
  });
});
