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
import {
  createProjectFolder,
  deleteProjectFile,
  deleteProjectFolder,
  ensureProject,
  listFiles,
  listProjectFolders,
  parseByteRange,
  readProjectFile,
  renameProjectFile,
  resolveProjectDir,
  resolveProjectFilePath,
  sanitizeName,
  sanitizePath,
  searchProjectFiles,
  writeProjectFile,
} from '../src/projects.js';
import { buildDocumentPreview } from '../src/document-preview.js';
import { validateArtifactManifestInput } from '../src/artifacts/manifest.js';
import { registerLiveArtifactRoutes } from '../src/routes/live-artifact.js';
import { registerProjectFileRoutes } from '../src/routes/project/index.js';

const PROJECT_ID = 'w24-relative-assets';
const RELATIVE_REF = 'assets/pic.png';
const DISK_PAGE = 'agent-written.html';
const PAGE_HTML = `<!doctype html><html><body><img src="${RELATIVE_REF}" alt="shot"></body></html>`;
// The same page, plus a `<base>` of its own written before `<html>`. The parser
// hoists that tag into the head ahead of anything inside it, so a document in
// this shape is the one place the page could take the resolution root back.
const REBASING_PAGE_HTML = `<base href="/evil/"><html><body><img src="${RELATIVE_REF}" alt="shot"></body></html>`;
const ASSET_BYTES = 'fake-png-bytes';

/**
 * The URL a relative ref in `html` resolves against: the document's own
 * `<base href>` when it has one, otherwise the document URL itself. That is the
 * only thing that decides whether a relative `<img src>` names the project file
 * it means to.
 *
 * A deliberate approximation of the browser, not a copy of it: this takes the
 * first `<base href>` in SOURCE order, while a browser resolves against the
 * first one in TREE order, and the two differ for a `<base>` written before
 * `<head>` — the parser hoists that one. The case below that carries such a base
 * is the reason they agree here: `withProjectAssetBaseHref` drops a base ahead
 * of its insertion point, so after the fix no shipped document can put the two
 * orders out of step. A document shape that could would need a real parser here.
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
  let rebasingArtifactId: string;

  beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w24-relative-assets-'));
    projectsDir = path.join(tempRoot, 'projects');

    // The project holds the asset both pages reference, plus the page an agent
    // wrote straight to disk.
    const projectDir = path.join(projectsDir, PROJECT_ID);
    fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, RELATIVE_REF), ASSET_BYTES, 'utf8');
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

    const rebasing = await createLiveArtifact({
      projectsRoot: projectsDir,
      projectId: PROJECT_ID,
      input: {
        title: 'Headshot drafts, self-rebasing',
        slug: 'headshot-drafts-rebasing',
        preview: { type: 'html', entry: 'index.html' },
        document: {
          format: 'html_template_v1',
          templatePath: 'template.html',
          generatedPreviewPath: 'index.html',
          dataPath: 'data.json',
          dataJson: {},
        },
      },
      templateHtml: REBASING_PAGE_HTML,
    });
    rebasingArtifactId = rebasing.artifact.id;

    const daemonPaths = {
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
    };

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
      paths: daemonPaths,
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

    // The real raw-file route, so the disk-written half of the parity assertion
    // is an HTTP response rather than a filesystem read. `getProject` returning
    // undefined is the managed-project case: no imported-folder metadata, so
    // paths resolve under PROJECTS_DIR.
    registerProjectFileRoutes(app, {
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
      paths: daemonPaths,
      uploads: {
        // Upload middleware belongs to routes this test never calls; the raw
        // GET handler takes none.
        upload: {
          any: () => (_req: unknown, _res: unknown, next: () => void) => next(),
          array: () => (_req: unknown, _res: unknown, next: () => void) => next(),
          single: () => (_req: unknown, _res: unknown, next: () => void) => next(),
        },
        importUpload: {
          any: () => (_req: unknown, _res: unknown, next: () => void) => next(),
          single: () => (_req: unknown, _res: unknown, next: () => void) => next(),
        },
        handleProjectUpload: () => undefined,
      },
      node: { fs },
      projectStore: { getProject: () => undefined },
      projectFiles: {
        createProjectFolder,
        deleteProjectFile,
        deleteProjectFolder,
        ensureProject,
        listFiles,
        listProjectFolders,
        parseByteRange,
        readProjectFile,
        renameProjectFile,
        resolveProjectDir,
        resolveProjectFilePath,
        sanitizeName,
        sanitizePath,
        searchProjectFiles,
        writeProjectFile,
      },
      documents: { buildDocumentPreview },
      artifacts: { validateArtifactManifestInput },
      projectPreviewScopes: { mint: () => 'unused-scope', validate: () => false },
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

    // The injected base only takes effect if this response's CSP admits it.
    // Under `base-uri 'none'` the browser drops the tag and the ref stays
    // broken, so the directive is half the fix and is pinned here rather than
    // left to a manual probe.
    expect(response.headers.get('content-security-policy')).toContain("base-uri 'self'");

    const previewHtml = await response.text();
    expect(previewHtml).toContain(`src="${RELATIVE_REF}"`);

    const resolved = new URL(RELATIVE_REF, assetBaseUrl(previewUrl, previewHtml));

    expect(resolved.pathname).toBe(
      `/api/projects/${encodeURIComponent(PROJECT_ID)}/raw/${RELATIVE_REF}`,
    );

    // Not just "a path that looks right": fetch it. The raw-file route is
    // registered on this same app, so a 200 with the fixture's bytes is the
    // whole claim — the ref reaches the project file.
    const asset = await fetch(resolved);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toMatch(/^image\/png/);
    expect(await asset.text()).toBe(ASSET_BYTES);
  });

  it('keeps the project raw base over one the artifact declares before <html>', async () => {
    const previewUrl = `${baseUrl}/api/live-artifacts/${encodeURIComponent(rebasingArtifactId)}/preview?projectId=${encodeURIComponent(PROJECT_ID)}`;
    const response = await fetch(previewUrl);
    expect(response.status).toBe(200);
    const previewHtml = await response.text();
    expect(previewHtml).not.toContain('/evil/');

    const resolved = new URL(RELATIVE_REF, assetBaseUrl(previewUrl, previewHtml));

    expect(resolved.pathname).toBe(
      `/api/projects/${encodeURIComponent(PROJECT_ID)}/raw/${RELATIVE_REF}`,
    );

    const asset = await fetch(resolved);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe(ASSET_BYTES);
  });

  it('resolves that ref to the same URL as the identical page written to disk', async () => {
    const previewUrl = `${baseUrl}/api/live-artifacts/${encodeURIComponent(artifactId)}/preview?projectId=${encodeURIComponent(PROJECT_ID)}`;
    const previewHtml = await (await fetch(previewUrl)).text();

    // The disk-written page comes over HTTP from the raw-file route, so both
    // halves of the parity assertion are real responses: each ref resolves
    // against the URL its own document was served from.
    const diskPageUrl = `${baseUrl}/api/projects/${encodeURIComponent(PROJECT_ID)}/raw/${DISK_PAGE}`;
    const diskPageResponse = await fetch(diskPageUrl);
    expect(diskPageResponse.status).toBe(200);
    const diskPageHtml = await diskPageResponse.text();
    expect(diskPageHtml).toContain(`src="${RELATIVE_REF}"`);

    const fromArtifact = new URL(RELATIVE_REF, assetBaseUrl(previewUrl, previewHtml));
    const fromDisk = new URL(RELATIVE_REF, assetBaseUrl(diskPageResponse.url, diskPageHtml));

    expect(fromArtifact.pathname).toBe(fromDisk.pathname);

    // And both reach the same bytes.
    for (const url of [fromArtifact, fromDisk]) {
      const asset = await fetch(url);
      expect(asset.status).toBe(200);
      expect(await asset.text()).toBe(ASSET_BYTES);
    }
  });
});
