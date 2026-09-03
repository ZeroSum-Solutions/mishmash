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
//   - the live-artifact preview route serves its response under
//     `script-src 'none'` and a CSP sandbox without `allow-scripts`
//     (`setLiveArtifactPreviewHeaders`), so no producer it carried could ever
//     run. That route therefore carries none, and the host settles its frame on
//     the outer load event instead. The last case pins header and payload
//     together: a producer may only be added to that response by relaxing the
//     header that refuses it.
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

interface HiddenTabRun {
  parentMessages: Array<{ type?: string; width?: number | null }>;
  send: (data: unknown) => void;
}

/**
 * Runs a producer in a document whose animation frames never run — what a
 * browser does for a hidden tab. Timers are inert too, so an answer can only
 * arrive if the producer posts synchronously.
 */
function runProducerInHiddenTab(script: string, measures = 1280): HiddenTabRun {
  const parentMessages: Array<{ type?: string; width?: number | null }> = [];
  const listeners: Record<string, Array<(ev: unknown) => void>> = {};
  const win: Record<string, unknown> = {
    parent: { postMessage: (data: unknown) => parentMessages.push(data as never) },
    addEventListener(type: string, listener: (ev: unknown) => void) {
      (listeners[type] ??= []).push(listener);
    },
    requestAnimationFrame() {
      // Queued and never invoked: the tab is hidden.
      return 1;
    },
  };
  const documentStub = {
    readyState: 'complete',
    visibilityState: 'hidden',
    hidden: true,
    documentElement: { scrollWidth: measures, offsetWidth: measures, clientWidth: measures },
    body: { scrollWidth: measures, offsetWidth: measures, clientWidth: measures },
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
    run.send({ type: REPORT_REQUEST });

    const report = run.parentMessages.find((message) => message?.type === REPORT);
    expect(report).toBeDefined();
    expect(report?.width).toBe(1280);
  });

  it('answers for a document that measured nothing, because a report means the document ran', async () => {
    // The report says "this document is the one running in the frame", which
    // the frame's own load event does not. It is not a claim about pixels: a
    // document that runs and lays out to nothing still answers, carrying a null
    // measurement. Pinned so the semantics are on the record — the host's
    // matching case is in
    // apps/web/tests/observability/iframe-preview-watchdog.test.ts.
    const url = `${baseUrl}/api/projects/${encodeURIComponent(PROJECT_ID)}/raw/${DISK_PAGE}?odPreviewBridge=scroll`;
    const producer = extractPaintReportProducer(await (await fetch(url)).text());
    expect(producer, 'the served document must carry an od:preview-content-size producer').not.toBeNull();

    const run = runProducerInHiddenTab(producer as string, 0);
    run.send({ type: REPORT_REQUEST });

    const report = run.parentMessages.find((message) => message?.type === REPORT);
    expect(report).toBeDefined();
    expect(report?.width).toBeNull();
  });

  it('serves the live-artifact preview with neither a producer nor a policy that would run one', async () => {
    // Header and payload pinned together, in one assertion pair, because they
    // only make sense as a pair. The response refuses scripts, so it carries no
    // producer, so the host watchdog settles that frame on `load`
    // (LiveArtifactViewer in apps/web/src/components/FileViewer.tsx, and
    // apps/web/tests/components/LiveArtifactViewer.preview-paint.test.tsx).
    // Injecting a producer here without first relaxing the policy would give
    // the host a report that can never arrive, and every healthy live-artifact
    // preview would file a false `preview-error` 15 seconds after it loaded.
    const url = `${baseUrl}/api/live-artifacts/${encodeURIComponent(artifactId)}/preview?projectId=${encodeURIComponent(PROJECT_ID)}`;
    const response = await fetch(url);
    expect(response.status).toBe(200);

    const csp = response.headers.get('content-security-policy') ?? '';
    const refusesScripts = csp.includes("script-src 'none'") && !/sandbox[^;]*allow-scripts/.test(csp);
    expect(refusesScripts, 'this route is expected to refuse scripts; see the assertion below').toBe(true);

    const producer = extractPaintReportProducer(await response.text());
    expect(
      producer,
      'a response served under script-src none must not carry an od:preview-content-size producer: it could never run, and the host would time out every healthy preview waiting for it',
    ).toBeNull();
  });
});
