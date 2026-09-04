// W2H.1 red spec (D-17 option A) — the live-artifact preview response admits
// exactly one nonce'd paint producer, and nothing else.
//
// Before this track the response was served under `script-src 'none'` and a CSP
// `sandbox allow-same-origin`, whose intersection with the iframe attribute
// (`allow-scripts allow-popups allow-downloads`) ran no script at all. That is
// why the host settled the live-artifact frame on its own `load` event, which
// `apps/web/src/observability/iframe-error.ts` calls weak: it fires for a 200
// that rendered nothing.
//
// Option A flips exactly two CSP controls and nothing else:
//   - `script-src 'nonce-<cryptographically random per response>'`, so only the
//     producer the daemon injected can run;
//   - `allow-scripts` added to the CSP `sandbox` directive, because the
//     effective sandbox is the intersection with the iframe attribute and both
//     halves have to allow scripts.
// `allow-same-origin` stays out of the effective sandbox, and
// `connect-src 'none'`, `object-src 'none'`, `form-action 'none'` stay.
//
// Route-level Vitest against a real express app + http.Server with the
// live-artifact store rooted in a temp PROJECTS_DIR; the daemon never writes
// into a real data root here. The extracted producer then runs in a sandbox so
// the report it makes is checked, not assumed.
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
import { registerLiveArtifactRoutes } from '../src/routes/live-artifact.js';

const PROJECT_ID = 'w2h1-live-artifact-paint';
const PAGE_HTML = '<!doctype html><html><body><h1>Preview</h1></body></html>';
const REPORT = 'od:preview-content-size';
const REPORT_REQUEST = 'od:preview-content-size-request';

interface ServedScript {
  nonce: string | null;
  body: string;
}

/** Every `<script>` in the served document, with the nonce it declared. */
function servedScripts(html: string): ServedScript[] {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((match) => {
    const attrs = match[1] ?? '';
    const nonce = attrs.match(/\bnonce\s*=\s*"([^"]*)"/i)?.[1] ?? null;
    return { nonce, body: match[2] ?? '' };
  });
}

function cspDirective(csp: string, name: string): string | null {
  for (const directive of csp.split(';')) {
    const trimmed = directive.trim();
    if (trimmed === name || trimmed.startsWith(`${name} `)) return trimmed;
  }
  return null;
}

interface ProducerRun {
  parentMessages: Array<Record<string, unknown>>;
  send: (data: unknown) => void;
}

/**
 * Runs a producer against a document stub whose elements have (or do not have)
 * a laid-out box, so what the producer reports about paint is observed rather
 * than assumed.
 */
function runProducer(script: string, opts: { area: boolean }): ProducerRun {
  const parentMessages: Array<Record<string, unknown>> = [];
  const listeners: Record<string, Array<(ev: unknown) => void>> = {};
  const box = opts.area
    ? { width: 1280, height: 720 }
    : { width: 0, height: 0 };
  const element = {
    tagName: 'DIV',
    scrollWidth: opts.area ? 1280 : 0,
    offsetWidth: opts.area ? 1280 : 0,
    clientWidth: opts.area ? 1280 : 0,
    getBoundingClientRect: () => box,
    querySelectorAll: () => [],
  };
  const win: Record<string, unknown> = {
    parent: { postMessage: (data: unknown) => parentMessages.push(data as Record<string, unknown>) },
    addEventListener(type: string, listener: (ev: unknown) => void) {
      (listeners[type] ??= []).push(listener);
    },
    requestAnimationFrame: () => 1,
  };
  const documentStub = {
    readyState: 'complete',
    documentElement: { ...element, querySelectorAll: () => [] },
    body: { ...element, querySelectorAll: () => [] },
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

describe('the live-artifact preview admits exactly one nonce’d paint producer', () => {
  let server: http.Server;
  let baseUrl: string;
  let tempRoot: string;
  let artifactId: string;

  beforeAll(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-w2h1-live-paint-'));
    const projectsDir = path.join(tempRoot, 'projects');
    fs.mkdirSync(path.join(projectsDir, PROJECT_ID), { recursive: true });

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
        resolvedPortRef: { get current() { return 0; } },
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

  function previewUrl(): string {
    return `${baseUrl}/api/live-artifacts/${encodeURIComponent(artifactId)}/preview?projectId=${encodeURIComponent(PROJECT_ID)}`;
  }

  it('authorizes scripts by nonce only, and lets the CSP sandbox run them', async () => {
    const response = await fetch(previewUrl());
    expect(response.status).toBe(200);
    const csp = response.headers.get('content-security-policy') ?? '';

    const scriptSrc = cspDirective(csp, 'script-src');
    expect(scriptSrc, 'script-src must authorize the producer by nonce').toMatch(
      /^script-src 'nonce-[A-Za-z0-9+/=_-]{16,}'$/,
    );

    const sandbox = cspDirective(csp, 'sandbox') ?? '';
    expect(
      sandbox.includes('allow-scripts'),
      'the effective sandbox is the intersection with the iframe attribute, so the header has to allow scripts too',
    ).toBe(true);
    expect(
      sandbox.includes('allow-same-origin'),
      'the preview document must keep its opaque origin',
    ).toBe(false);

    expect(cspDirective(csp, 'connect-src')).toBe("connect-src 'none'");
    expect(cspDirective(csp, 'object-src')).toBe("object-src 'none'");
    expect(cspDirective(csp, 'form-action')).toBe("form-action 'none'");
  });

  it('mints a fresh nonce per response and stamps it on the one script it serves', async () => {
    const first = await fetch(previewUrl());
    const firstCsp = first.headers.get('content-security-policy') ?? '';
    const firstHtml = await first.text();
    const second = await fetch(previewUrl());
    const secondCsp = second.headers.get('content-security-policy') ?? '';

    const nonceOf = (csp: string) => csp.match(/'nonce-([^']+)'/)?.[1] ?? null;
    const firstNonce = nonceOf(firstCsp);
    expect(firstNonce).not.toBeNull();
    expect(nonceOf(secondCsp)).not.toBe(firstNonce);

    const scripts = servedScripts(firstHtml);
    expect(scripts, 'exactly one producer, so the nonce authorizes nothing else').toHaveLength(1);
    expect(scripts[0]?.nonce).toBe(firstNonce);
  });

  it('serves a producer that answers a tokened request with the paint evidence it measured', async () => {
    const html = await (await fetch(previewUrl())).text();
    const producer = servedScripts(html)[0]?.body ?? '';
    expect(producer).toContain(REPORT);

    const painted = runProducer(producer, { area: true });
    painted.send({ type: REPORT_REQUEST, token: 'nav-1' });
    const paintedReport = painted.parentMessages.find((message) => message?.type === REPORT);
    expect(paintedReport).toBeDefined();
    expect(paintedReport?.token).toBe('nav-1');
    expect(paintedReport?.painted).toBe(true);

    const blank = runProducer(producer, { area: false });
    blank.send({ type: REPORT_REQUEST, token: 'nav-2' });
    const blankReport = blank.parentMessages.find((message) => message?.type === REPORT);
    expect(blankReport).toBeDefined();
    expect(blankReport?.token).toBe('nav-2');
    expect(
      blankReport?.painted,
      'a document that ran and laid out to nothing must not read as painted',
    ).toBe(false);
  });
});
