import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMockOpenDesignHost } from '@open-design/host/testing';

// W2K.1 — the cached reader behind `GET /api/export/capabilities`.
//
// `canRequestOffscreenImageRender` is the gate the FileViewer capture path
// consults before it asks the daemon to rasterize an image. Its whole job is to
// stop a guaranteed 501 from being sent on every "Export as image" click in a
// daemon with no desktop renderer, so what matters is: it believes a definitive
// `false`, it does not invent one when the daemon never answered, and it asks
// only once.
//
// The module caches at module scope, so each case imports a fresh copy.
async function loadExports() {
  vi.resetModules();
  return import('../../src/runtime/exports');
}

function capabilitiesResponse(image: boolean): Response {
  return new Response(JSON.stringify({ image }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('daemonScreenshotExportAvailable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports the daemon answer and reads it once per session', async () => {
    const fetchMock = vi.fn(async () => capabilitiesResponse(false));
    vi.stubGlobal('fetch', fetchMock);
    const { daemonScreenshotExportAvailable } = await loadExports();

    await expect(daemonScreenshotExportAvailable()).resolves.toBe(false);
    await expect(daemonScreenshotExportAvailable()).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/export/capabilities');
  });

  it('reports true when the daemon has a renderer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => capabilitiesResponse(true)));
    const { daemonScreenshotExportAvailable } = await loadExports();

    await expect(daemonScreenshotExportAvailable()).resolves.toBe(true);
  });

  it('does not turn "no answer" into "cannot", and re-asks next time', async () => {
    // A daemon that is offline, or older than the capability route, has told us
    // nothing. Suppressing the export there would silently downgrade a runtime
    // that can render; the request itself is still the honest way to find out.
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('nope', { status: 404 }))
      .mockResolvedValueOnce(capabilitiesResponse(false));
    vi.stubGlobal('fetch', fetchMock);
    const { daemonScreenshotExportAvailable } = await loadExports();

    await expect(daemonScreenshotExportAvailable()).resolves.toBe(true);
    await expect(daemonScreenshotExportAvailable()).resolves.toBe(true);
    await expect(daemonScreenshotExportAvailable()).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('canRequestOffscreenImageRender', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is false in a browser whose daemon has no renderer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => capabilitiesResponse(false)));
    const { canRequestOffscreenImageRender } = await loadExports();

    await expect(canRequestOffscreenImageRender()).resolves.toBe(false);
  });

  it('is true in a browser whose daemon has a renderer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => capabilitiesResponse(true)));
    const { canRequestOffscreenImageRender } = await loadExports();

    await expect(canRequestOffscreenImageRender()).resolves.toBe(true);
  });

  it('is true inside a desktop host without asking the daemon at all', async () => {
    // The host reaches the renderer its own daemon wired, so every host capture
    // path keeps the behaviour it had before this gate existed.
    const fetchMock = vi.fn(async () => capabilitiesResponse(false));
    vi.stubGlobal('fetch', fetchMock);
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
