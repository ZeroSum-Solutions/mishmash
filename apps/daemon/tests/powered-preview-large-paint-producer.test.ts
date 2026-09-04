// W2H.1b red spec — D-17 landing condition 3. A powered preview larger than
// HTML_PREVIEW_BRIDGE_MAX_BYTES (2 MiB) is served with no paint producer at
// all, so the host watchdog waits 15 seconds for a report the document was
// never given the means to make and then tells the user "Preview did not
// render" over a preview that rendered perfectly.
//
// GPT-5.6 round 1: "Cover powered HTML above the 2 MiB injection cap. Today the
// daemon deliberately skips transformation ... causing a healthy large preview
// to receive the false statement 'Preview did not render'." Round 2 fixed the
// rule: separate the DEDICATED paint producer from the optional
// scroll/selection/snapshot rewrites, inject the producer into every powered
// HTML response including those over the cap, keep the optional rewrites
// capped, and make the injection marker-based so a bridge cannot duplicate it.
//
// Route-level Vitest against a real express app + http.Server with a temp
// PROJECTS_DIR; the daemon never writes into a real data root here.
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sendApiError } from '../src/http/api-errors.js';
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
import { registerProjectFileRoutes } from '../src/routes/project/index.js';

const PROJECT_ID = 'w2h1b-powered-large';
const SMALL_PAGE = 'small.html';
const LARGE_PAGE = 'large.html';
const REPORT = 'od:preview-content-size';
const REPORT_REQUEST = 'od:preview-content-size-request';
const BRIDGE_CAP_BYTES = 2 * 1024 * 1024;

/** Every `<script>` body that implements the paint-report protocol. */
function producerScripts(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1] ?? '')
    .filter((body) => body.includes(REPORT_REQUEST) && body.includes(REPORT));
}

/** A document whose bytes exceed the bridge cap by padding, not by nesting. */
function largeHtml(): string {
  const filler = `<p data-filler>${'x'.repeat(1024)}</p>\n`;
  const repeats = Math.ceil((2.5 * 1024 * 1024) / filler.length);
  return `<!doctype html><html><head><title>Large powered artifact</title></head><body><h1>Large</h1>\n${filler.repeat(repeats)}</body></html>`;
}

describe('a powered preview over the bridge cap can still prove it painted', () => {
  let server: http.Server;
  let baseUrl: string;
  let tempRoot: string;

  beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w2h1b-powered-large-'));
    const projectsDir = path.join(tempRoot, 'projects');
    const projectDir = path.join(projectsDir, PROJECT_ID);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, SMALL_PAGE),
      '<!doctype html><html><body><h1>Small</h1></body></html>',
      'utf8',
    );
    fs.writeFileSync(path.join(projectDir, LARGE_PAGE), largeHtml(), 'utf8');
    expect(fs.statSync(path.join(projectDir, LARGE_PAGE)).size).toBeGreaterThan(BRIDGE_CAP_BYTES);

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
        sendLiveArtifactRouteError: () => undefined,
        sendMulterError: () => undefined,
      },
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
    } as any);

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

  async function poweredHtml(file: string, query = ''): Promise<string> {
    const url = `${baseUrl}/api/projects/${encodeURIComponent(PROJECT_ID)}/powered/${file}${query}`;
    const response = await fetch(url);
    expect(response.status).toBe(200);
    return response.text();
  }

  it('serves a 2.5 MiB powered document with exactly one paint producer', async () => {
    const html = await poweredHtml(LARGE_PAGE);
    expect(html.length).toBeGreaterThan(BRIDGE_CAP_BYTES);

    const producers = producerScripts(html);
    expect(
      producers,
      'over the cap the host still watches this frame, so the document must be able to answer',
    ).toHaveLength(1);
  });

  it('keeps the producer single when a bridge is requested alongside it', async () => {
    const html = await poweredHtml(SMALL_PAGE, '?odPreviewBridge=scroll');
    expect(
      producerScripts(html),
      'the bridge rewrite must not duplicate the dedicated producer',
    ).toHaveLength(1);
  });

  it('still serves the powered isolation headers with the producer attached', async () => {
    const url = `${baseUrl}/api/projects/${encodeURIComponent(PROJECT_ID)}/powered/${LARGE_PAGE}`;
    const response = await fetch(url);
    expect(response.headers.get('document-isolation-policy')).toBe('isolate-and-credentialless');
    // The powered response carries no CSP at all (it is removed so the
    // isolated origin can run the artifact's own scripts), so the producer
    // rides the same inline-script permission the artifact already has — there
    // is no nonce to pair here, unlike the live-artifact route.
    expect(response.headers.get('content-security-policy')).toBeNull();
    await response.text();
  });

  it('transforms a 2.5 MiB powered response in bounded time and memory', async () => {
    // D-17 condition 3: "Measure transform latency and peak memory on the large
    // fixture and record them." The numbers are logged for the proof file; the
    // assertions are ceilings a regression would cross, not the measurement.
    const url = `${baseUrl}/api/projects/${encodeURIComponent(PROJECT_ID)}/powered/${LARGE_PAGE}`;
    const rawUrl = `${baseUrl}/api/projects/${encodeURIComponent(PROJECT_ID)}/raw/${LARGE_PAGE}`;

    // Warm the file cache so the comparison is transform cost, not first read.
    await (await fetch(rawUrl)).text();

    const streamedStart = performance.now();
    const streamed = await (await fetch(rawUrl)).text();
    const streamedMs = performance.now() - streamedStart;

    const before = process.memoryUsage();
    const transformedStart = performance.now();
    const transformed = await (await fetch(url)).text();
    const transformedMs = performance.now() - transformedStart;
    const after = process.memoryUsage();

    expect(transformed.length).toBeGreaterThan(streamed.length);
    // eslint-disable-next-line no-console
    console.log(
      `[W2H.1b] powered 2.5 MiB transform: ${transformedMs.toFixed(1)} ms ` +
        `(untransformed /raw baseline ${streamedMs.toFixed(1)} ms); ` +
        `heapUsed delta ${((after.heapUsed - before.heapUsed) / (1024 * 1024)).toFixed(1)} MiB, ` +
        `rss delta ${((after.rss - before.rss) / (1024 * 1024)).toFixed(1)} MiB`,
    );
    expect(transformedMs, 'the transform is one decode, one scan and one splice').toBeLessThan(2000);
    expect(
      after.rss - before.rss,
      'buffering the response holds about two copies of it, not the whole file cache',
    ).toBeLessThan(64 * 1024 * 1024);
  });

  it('leaves the optional bridge rewrites capped over the cap', async () => {
    const html = await poweredHtml(LARGE_PAGE, '?odPreviewBridge=scroll,selection');
    expect(
      html.includes('data-od-url-selection-bridge'),
      'the selection bridge is an optional rewrite and stays capped; only the producer is unconditional',
    ).toBe(false);
  });
});
