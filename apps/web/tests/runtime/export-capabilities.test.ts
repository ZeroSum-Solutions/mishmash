import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockOpenDesignHost } from '@open-design/host/testing';
import type { ExportCapabilitiesResponse } from '@open-design/contracts';

// W2K.1 / W2K.3 — the cached reader behind `GET /api/export/capabilities`.
//
// W2K.1 gave the reader one flag (`image`) and cached it forever, on the
// argument that renderers are wired at boot and cannot appear later. That is
// true of one daemon PROCESS and false of one browser SESSION: a web tab
// outlives `tools-dev restart`, so a reader that never re-asks keeps serving the
// dead process's answer and either hides an export that now works or offers one
// that no longer does (FU-34, D-23). The cache is therefore keyed on the daemon
// boot id from `GET /api/health`, and W2K.3 splits the answer into the four
// formats the daemon actually serves.
//
// The module caches at module scope, so each case imports a fresh copy.
async function loadExports() {
  vi.resetModules();
  return import('../../src/runtime/exports');
}

const RENDERER_LESS: ExportCapabilitiesResponse = {
  nativePdf: false,
  rasterPdf: false,
  pptx: false,
  image: false,
};

const FULLY_WIRED: ExportCapabilitiesResponse = {
  nativePdf: true,
  rasterPdf: true,
  pptx: true,
  image: true,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

// One daemon, answering the two routes the reader uses. `bootId` and
// `capabilities` are mutable so a case can restart the daemon underneath a
// still-running session.
let bootId: string | null;
let capabilities: Partial<ExportCapabilitiesResponse> | null;
let capabilitiesResponse: () => Response;
let healthResponse: () => Response;
let fetchMock: ReturnType<typeof vi.fn>;

function capabilityReads(): number {
  return fetchMock.mock.calls.filter((call) => call[0] === '/api/export/capabilities').length;
}

beforeEach(() => {
  bootId = 'boot-1';
  capabilities = RENDERER_LESS;
  capabilitiesResponse = () => jsonResponse(capabilities);
  healthResponse = () =>
    jsonResponse({ ok: true, version: '0.0.0-test', ...(bootId === null ? {} : { bootId }) });
  fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url === '/api/health') return healthResponse();
    if (url === '/api/export/capabilities') return capabilitiesResponse();
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('daemonExportCapabilities', () => {
  it('reports the daemon answer and reads the capability route once per daemon boot', async () => {
    // SUPERSEDES the W2K.1 assertion `expect(fetchMock).toHaveBeenCalledTimes(1)`,
    // which claimed the reader issues exactly one request for the whole session.
    // That was wrong: it made "one probe" the invariant when the real invariant
    // is "one probe per daemon process". The cheap `/api/health` read is what
    // tells the reader which process it is talking to.
    const { daemonExportCapabilities } = await loadExports();

    await expect(daemonExportCapabilities()).resolves.toEqual(RENDERER_LESS);
    await expect(daemonExportCapabilities()).resolves.toEqual(RENDERER_LESS);
    expect(capabilityReads()).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/export/capabilities');
  });

  it('re-probes after a daemon restart and reports the new answer', async () => {
    const { daemonExportCapabilities } = await loadExports();

    await expect(daemonExportCapabilities()).resolves.toEqual(RENDERER_LESS);
    expect(capabilityReads()).toBe(1);

    // The daemon this tab is talking to restarted, now with renderers wired.
    bootId = 'boot-2';
    capabilities = FULLY_WIRED;

    await expect(daemonExportCapabilities()).resolves.toEqual(FULLY_WIRED);
    expect(capabilityReads()).toBe(2);
  });

  it('reads once per session against a daemon that reports no boot id', async () => {
    // A daemon older than the boot id cannot be told apart from itself, so the
    // reader must not spin: "no boot id" is one stable identity, not a change.
    bootId = null;
    capabilities = FULLY_WIRED;
    const { daemonExportCapabilities } = await loadExports();

    await expect(daemonExportCapabilities()).resolves.toEqual(FULLY_WIRED);
    await expect(daemonExportCapabilities()).resolves.toEqual(FULLY_WIRED);
    expect(capabilityReads()).toBe(1);
  });

  it('treats a format the daemon did not answer as available', async () => {
    // A daemon older than W2K.3 answers `image` only. "It did not say" is not
    // "it cannot", so the other three stay offered and the client keeps the
    // behaviour it had before this split.
    capabilities = { image: false };
    const { daemonExportCapabilities } = await loadExports();

    await expect(daemonExportCapabilities()).resolves.toEqual({
      nativePdf: true,
      rasterPdf: true,
      pptx: true,
      image: false,
    });
  });

  it('does not turn "no answer" into "cannot", and re-asks next time', async () => {
    // A daemon that is offline, or older than the capability route, has told us
    // nothing. Suppressing the export there would silently downgrade a runtime
    // that can render; the request itself is still the honest way to find out.
    const outcomes: Array<'throw' | 'notFound' | 'ok'> = ['throw', 'notFound', 'ok'];
    capabilitiesResponse = () => {
      const outcome = outcomes.shift() ?? 'ok';
      if (outcome === 'throw') throw new Error('offline');
      if (outcome === 'notFound') return new Response('nope', { status: 404 });
      return jsonResponse(RENDERER_LESS);
    };
    const { daemonExportCapabilities } = await loadExports();

    await expect(daemonExportCapabilities()).resolves.toEqual(FULLY_WIRED);
    await expect(daemonExportCapabilities()).resolves.toEqual(FULLY_WIRED);
    await expect(daemonExportCapabilities()).resolves.toEqual(RENDERER_LESS);
    expect(capabilityReads()).toBe(3);
  });
});

describe('daemonScreenshotExportAvailable', () => {
  it('re-probes after a daemon restart instead of serving the dead process answer', async () => {
    // The symptom, on the reader W2K.1 shipped: this tab asked a renderer-less
    // daemon once, cached `false`, and kept answering `false` after that daemon
    // was replaced by one that can rasterize. The user's "Export as image" is
    // then silently downgraded to the visible-preview capture for the life of
    // the tab, on a runtime that would have rendered it.
    const { daemonScreenshotExportAvailable } = await loadExports();

    await expect(daemonScreenshotExportAvailable()).resolves.toBe(false);

    bootId = 'boot-2';
    capabilities = FULLY_WIRED;

    await expect(daemonScreenshotExportAvailable()).resolves.toBe(true);
  });

  it('reports the daemon image answer', async () => {
    const { daemonScreenshotExportAvailable } = await loadExports();

    await expect(daemonScreenshotExportAvailable()).resolves.toBe(false);
  });

  it('reports true when the daemon has a renderer', async () => {
    capabilities = FULLY_WIRED;
    const { daemonScreenshotExportAvailable } = await loadExports();

    await expect(daemonScreenshotExportAvailable()).resolves.toBe(true);
  });
});

describe('clientExportCapabilities', () => {
  it('reports the daemon answer per format in a browser', async () => {
    // The slide renderer is missing but the artifact exporter is wired: image
    // works, pptx and the raster PDF do not. One `image` flag could not say this.
    capabilities = { nativePdf: false, rasterPdf: false, pptx: false, image: true };
    const { clientExportCapabilities } = await loadExports();

    await expect(clientExportCapabilities()).resolves.toEqual({
      nativePdf: false,
      rasterPdf: false,
      pptx: false,
      image: true,
    });
  });

  it('reports every format available inside a desktop host without asking the daemon', async () => {
    // The host reaches the renderers its own daemon wired, so every host export
    // path keeps the behaviour it had before this gate existed.
    const uninstallHost = installMockOpenDesignHost();
    try {
      const { clientExportCapabilities } = await loadExports();

      await expect(clientExportCapabilities()).resolves.toEqual(FULLY_WIRED);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      uninstallHost();
    }
  });
});

describe('canRequestOffscreenImageRender', () => {
  it('is false in a browser whose daemon has no renderer', async () => {
    const { canRequestOffscreenImageRender } = await loadExports();

    await expect(canRequestOffscreenImageRender()).resolves.toBe(false);
  });

  it('is true in a browser whose daemon has a renderer', async () => {
    capabilities = FULLY_WIRED;
    const { canRequestOffscreenImageRender } = await loadExports();

    await expect(canRequestOffscreenImageRender()).resolves.toBe(true);
  });

  it('is true inside a desktop host without asking the daemon at all', async () => {
    const uninstallHost = installMockOpenDesignHost();
    try {
      const { canRequestOffscreenImageRender } = await loadExports();

      await expect(canRequestOffscreenImageRender()).resolves.toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      uninstallHost();
    }
  });
});
