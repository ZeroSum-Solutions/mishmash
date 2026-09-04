// W2G.1 red spec — a daemon-served preview whose document can report must be
// able to do so from a hidden tab, and a response whose headers forbid scripts
// must not be asked for a report at all.
//
// The host watchdog (`apps/web/src/observability/iframe-error.ts`) settles a
// visible preview only on `od:preview-content-size` posted from inside the
// document, and gives it 15 seconds. Two daemon-served transports feed that
// watchdog, and they answer to it differently:
//
//   - the project raw route injects `URL_PREVIEW_SCROLL_BRIDGE` when the
//     preview URL carries `odPreviewBridge=scroll`, and that producer can run
//     (F12: its answer to an explicit request used to go through
//     `requestAnimationFrame`, and animation frames are paused in a hidden tab
//     while the host timeout keeps running);
//   - the live-artifact preview route (W2H.1 / D-17 option A) serves its
//     response under `script-src 'nonce-<per response>'` with `allow-scripts`
//     in the CSP sandbox, so exactly one producer runs in it. That pairing —
//     header and payload together — is pinned in
//     `live-artifact-preview-paint-producer.test.ts`; the case here checks only
//     that the two daemon-served transports report the same shape.
//
// Route-level Vitest against a real express app + http.Server, with the
// live-artifact store rooted in a temp PROJECTS_DIR — the daemon never writes
// into a real data root here. The extracted producer then runs in a sandbox
// whose `requestAnimationFrame` never fires, which is the hidden-tab condition.
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
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

const PROJECT_ID = 'w2g1-preview-paint-report';
const DISK_PAGE = 'page.html';
const PAGE_HTML = '<!doctype html><html><body><h1>Preview</h1></body></html>';
const REPORT = 'od:preview-content-size';
const REPORT_REQUEST = 'od:preview-content-size-request';

/**
 * The producer script inside a served preview document: every `<script>` whose
 * body answers `od:preview-content-size-request`. Found by behaviour rather
 * than by marker attribute, so the two transports can carry different bridges.
 * `null` when the served document carries no producer at all.
 */
function extractPaintReportProducer(html: string): string | null {
  const bodies = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1] ?? '')
    .filter((body) => body.includes(REPORT_REQUEST) && body.includes(REPORT));
  return bodies.length === 0 ? null : bodies.join('\n');
}

/**
 * A computed style that hides nothing. The producer reads visibility, opacity,
 * clipping and paint sources off `getComputedStyle`, so a stub document needs
 * one for its elements to count as visible output.
 */
const VISIBLE_STYLE = {
  display: 'block',
  visibility: 'visible',
  opacity: '1',
  color: 'rgb(0, 0, 0)',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  backgroundImage: 'none',
  overflow: 'visible',
  overflowX: 'visible',
  overflowY: 'visible',
  clipPath: 'none',
  borderTopStyle: 'none',
  borderRightStyle: 'none',
  borderBottomStyle: 'none',
  borderLeftStyle: 'none',
  fill: 'none',
  stroke: 'none',
  strokeWidth: '0',
};

interface HiddenTabRun {
  parentMessages: Array<Record<string, unknown>>;
  send: (data: unknown) => void;
}

/**
 * Runs a producer in a document whose animation frames never run — what a
 * browser does for a hidden tab. Timers are inert too, so an answer can only
 * arrive if the producer posts synchronously.
 */
function runProducerInHiddenTab(script: string, measures = 1280): HiddenTabRun {
  const parentMessages: Array<Record<string, unknown>> = [];
  const listeners: Record<string, Array<(ev: unknown) => void>> = {};
  const win: Record<string, unknown> = {
    parent: { postMessage: (data: unknown) => parentMessages.push(data as Record<string, unknown>) },
    addEventListener(type: string, listener: (ev: unknown) => void) {
      (listeners[type] ??= []).push(listener);
    },
    requestAnimationFrame() {
      // Queued and never invoked: the tab is hidden.
      return 1;
    },
    innerWidth: 1280,
    innerHeight: 720,
    getComputedStyle: () => VISIBLE_STYLE,
  };
  const laidOut = {
    tagName: 'BODY',
    scrollWidth: measures,
    offsetWidth: measures,
    clientWidth: measures,
    parentElement: null,
    childNodes: measures > 0 ? [{ nodeType: 3, nodeValue: 'Preview' }] : [],
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: measures,
      height: measures > 0 ? 720 : 0,
    }),
  };
  const documentStub = {
    readyState: 'complete',
    visibilityState: 'hidden',
    hidden: true,
    documentElement: laidOut,
    body: laidOut,
    addEventListener: () => {},
    querySelector: () => null,
    scrollingElement: null,
  };
  const sandbox: Record<string, unknown> = {
    window: win,
    document: documentStub,
    setTimeout: () => 0,
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return {
    parentMessages,
    send: (data: unknown) => {
      for (const listener of listeners.message ?? []) listener({ data });
    },
  };
}

describe('daemon-served previews can prove they painted, hidden tab included', () => {
  let server: http.Server;
  let baseUrl: string;
  let tempRoot: string;
  let projectsDir: string;
  let artifactId: string;

  beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w2g1-paint-report-'));
    projectsDir = path.join(tempRoot, 'projects');

    const projectDir = path.join(projectsDir, PROJECT_ID);
    fs.mkdirSync(projectDir, { recursive: true });
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

    const httpDeps = {
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
    };

    const app = express();
    registerLiveArtifactRoutes(app, {
      db: {},
      http: httpDeps,
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

    registerProjectFileRoutes(app, {
      db: {},
      http: httpDeps,
      paths: daemonPaths,
      uploads: {
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

  it('answers a report request from the url-load transport without an animation frame', async () => {
    const url = `${baseUrl}/api/projects/${encodeURIComponent(PROJECT_ID)}/raw/${DISK_PAGE}?odPreviewBridge=scroll`;
    const response = await fetch(url);
    expect(response.status).toBe(200);

    const producer = extractPaintReportProducer(await response.text());
    expect(producer, 'the served document must carry an od:preview-content-size producer').not.toBeNull();
    const run = runProducerInHiddenTab(producer as string);
    run.send({ type: REPORT_REQUEST, token: 'nav-1' });

    const report = run.parentMessages.find((message) => message?.type === REPORT);
    expect(report).toBeDefined();
    expect(report?.width).toBe(1280);
    expect(report?.painted).toBe(true);
    expect(report?.token).toBe('nav-1');
  });

  it('reports a document that laid out to nothing as not painted', async () => {
    // W2H.1 flipped what this case pins. A report used to settle the host
    // watchdog on any measurement, which meant a document that ran and laid
    // out to nothing read as a healthy preview. The report now carries the
    // paint evidence separately: `painted` is false when no element in the
    // document has a box with area, and the host refuses to settle on it. The
    // matching host case is in
    // apps/web/tests/observability/iframe-preview-paint-evidence.test.ts.
    const url = `${baseUrl}/api/projects/${encodeURIComponent(PROJECT_ID)}/raw/${DISK_PAGE}?odPreviewBridge=scroll`;
    const producer = extractPaintReportProducer(await (await fetch(url)).text());
    expect(producer, 'the served document must carry an od:preview-content-size producer').not.toBeNull();

    const run = runProducerInHiddenTab(producer as string, 0);
    run.send({ type: REPORT_REQUEST, token: 'nav-2' });

    const report = run.parentMessages.find((message) => message?.type === REPORT);
    expect(report).toBeDefined();
    expect(report?.width).toBeNull();
    expect(report?.painted).toBe(false);
  });

  it('serves the live-artifact preview with one producer, admitted by nonce', async () => {
    // Header and payload pinned together, because they only make sense as a
    // pair: the response authorizes exactly one script by nonce and allows
    // scripts in its CSP sandbox, and the script it carries is that producer.
    // Removing either half without the other gives the host a report that can
    // never arrive, and every healthy live-artifact preview would file a false
    // `preview-error` 15 seconds after it loaded. The full CSP shape is pinned
    // in apps/daemon/tests/live-artifact-preview-paint-producer.test.ts.
    const url = `${baseUrl}/api/live-artifacts/${encodeURIComponent(artifactId)}/preview?projectId=${encodeURIComponent(PROJECT_ID)}`;
    const response = await fetch(url);
    expect(response.status).toBe(200);

    const csp = response.headers.get('content-security-policy') ?? '';
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1] ?? null;
    expect(nonce, 'the producer is authorized by nonce, not by unsafe-inline').not.toBeNull();
    expect(/sandbox[^;]*allow-scripts/.test(csp)).toBe(true);
    expect(/sandbox[^;]*allow-same-origin/.test(csp)).toBe(false);

    const html = await response.text();
    expect(html).toContain(`nonce="${nonce}"`);
    const producer = extractPaintReportProducer(html);
    expect(
      producer,
      'this response admits one producer; without it the host has no evidence the preview rendered',
    ).not.toBeNull();
  });
});
