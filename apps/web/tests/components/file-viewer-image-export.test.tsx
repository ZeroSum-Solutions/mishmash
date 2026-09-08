// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAnomalyKind } from '@open-design/contracts';
import { exportErrorCode } from '../../src/analytics/export-error-code';
import type { ProjectFile } from '../../src/types';

const {
  analyticsTrackMock,
  canRequestOffscreenImageRenderMock,
  captureHostIframeSnapshotMock,
  downloadImageDataUrlMock,
  exportProjectImageDataUrlMock,
  imageDataUrlToBlobMock,
  isOpenDesignHostAvailableMock,
  prepareImageExportTargetMock,
  requestPreviewSnapshotMock,
  saveImageBlobMock,
} = vi.hoisted(() => ({
  analyticsTrackMock: vi.fn(),
  canRequestOffscreenImageRenderMock: vi.fn(async () => true),
  captureHostIframeSnapshotMock: vi.fn(),
  downloadImageDataUrlMock: vi.fn(),
  exportProjectImageDataUrlMock: vi.fn(),
  imageDataUrlToBlobMock: vi.fn(),
  // Default: no desktop host, so existing tests exercise the host-snapshot
  // fallback path exactly as before. The runtime-deck test flips this on.
  isOpenDesignHostAvailableMock: vi.fn(() => false),
  prepareImageExportTargetMock: vi.fn(),
  requestPreviewSnapshotMock: vi.fn(),
  saveImageBlobMock: vi.fn(),
}));

vi.mock('../../src/analytics/provider', async () => {
  const actual = await vi.importActual<typeof import('../../src/analytics/provider')>(
    '../../src/analytics/provider',
  );
  return {
    ...actual,
    useAnalytics: () => ({
      track: analyticsTrackMock,
      setConsent: () => undefined,
      setIdentity: () => undefined,
      setConfigureGlobals: () => undefined,
      setUserId: () => undefined,
      anonymousId: 'test-anon',
      sessionId: 'test-session',
      newRequestId: () => 'test-request',
    }),
  };
});

vi.mock('../../src/runtime/exports', async () => {
  const actual = await vi.importActual<typeof import('../../src/runtime/exports')>(
    '../../src/runtime/exports',
  );
  return {
    ...actual,
    canRequestOffscreenImageRender: canRequestOffscreenImageRenderMock,
    captureHostIframeSnapshot: captureHostIframeSnapshotMock,
    downloadImageDataUrl: downloadImageDataUrlMock,
    exportProjectImageDataUrl: exportProjectImageDataUrlMock,
    imageDataUrlToBlob: imageDataUrlToBlobMock,
    isOpenDesignHostAvailable: isOpenDesignHostAvailableMock,
    prepareImageExportTarget: prepareImageExportTargetMock,
    requestPreviewSnapshot: requestPreviewSnapshotMock,
  };
});

import { FileViewer } from '../../src/components/FileViewer';

const CAPTURE_FAILED_TEXT =
  "Image capture failed. Please try again or use your browser's screenshot tool.";

function htmlFile(): ProjectFile {
  return {
    name: 'workspace.html',
    path: 'workspace.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    kind: 'html',
    mime: 'text/html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Workspace',
      entry: 'workspace.html',
      renderer: 'html',
      exports: ['html'],
    },
  };
}

function deckFile(): ProjectFile {
  return {
    ...htmlFile(),
    name: 'pitch.deck.html',
    path: 'pitch.deck.html',
    kind: 'presentation',
    artifactManifest: {
      version: 1,
      kind: 'deck',
      title: 'Pitch Deck',
      entry: 'pitch.deck.html',
      renderer: 'deck-html',
      exports: ['html'],
    },
  };
}

function renderHtmlPreview(
  liveHtml = '<html><body><main>Workspace</main></body></html>',
  expectedRenderMode: 'url-load' | 'srcdoc' = 'url-load',
) {
  const view = render(
    <FileViewer
      projectId="project-1"
      projectKind="prototype"
      file={htmlFile()}
      liveHtml={liveHtml}
    />,
  );
  const { container } = view;
  const activeFrame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
  expect(activeFrame.getAttribute('data-od-render-mode')).toBe(expectedRenderMode);
  const srcDocFrame = container.querySelector<HTMLIFrameElement>('iframe[data-od-render-mode="srcdoc"]');
  expect(srcDocFrame).toBeTruthy();
  fireEvent.load(srcDocFrame as HTMLIFrameElement);
  return { ...view, activeFrame, srcDocFrame: srcDocFrame as HTMLIFrameElement };
}

async function openImageExportDialog() {
  fireEvent.click(screen.getByRole('button', { name: /download/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: /export as image/i }));
  expect(await screen.findByRole('dialog', { name: /export as image/i })).toBeTruthy();
}

async function waitForSaveButton() {
  const button = await screen.findByRole('button', { name: /^save$/i });
  await waitFor(() => {
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
  return button;
}

// The modal no longer renders eagerly on open: the user picks a format, then
// Save closes the modal and runs the capture → download/save behind the portaled
// export toast (unified with the PPTX/PDF flow). Each test drives Save explicitly.
async function clickSave() {
  fireEvent.click(await waitForSaveButton());
}

describe('FileViewer image export', () => {
  beforeEach(() => {
    // `vi.resetAllMocks()` leaves this returning `undefined`, which is not a
    // shape the real function can produce — it always resolves a discriminated
    // result. Defaulting it to the honest "this runtime has no off-screen
    // renderer" answer is what lets the bridge-precedence specs below keep
    // meaning what they say: they pin the fallback chain that runs when the
    // renderer is unavailable, not a claim that the renderer is never asked.
    exportProjectImageDataUrlMock.mockResolvedValue({ ok: false, unavailable: true });
    canRequestOffscreenImageRenderMock.mockResolvedValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('portals the image export dialog above fixed chat composer layers', async () => {
    requestPreviewSnapshotMock.mockResolvedValueOnce({
      dataUrl: 'data:image/png;base64,ok',
      w: 800,
      h: 600,
    });
    imageDataUrlToBlobMock.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));

    const { container } = renderHtmlPreview();
    await openImageExportDialog();

    const backdrop = document.body.querySelector('.viewer-modal-backdrop');
    expect(backdrop).toBeTruthy();
    expect(backdrop?.classList.contains('image-export-backdrop')).toBe(true);
    expect(backdrop?.parentElement).toBe(document.body);
    expect(container.querySelector('.viewer-modal-backdrop')).toBeNull();

    // Capture runs on Save (not eagerly on open).
    await clickSave();
    await waitFor(() => {
      expect(imageDataUrlToBlobMock).toHaveBeenCalledWith('data:image/png;base64,ok', 'png');
    });
  });

  it('waits for the download menu to close before capturing host pixels', async () => {
    captureHostIframeSnapshotMock.mockImplementationOnce(async () => {
      expect(screen.queryByRole('menu')).toBeNull();
      return {
        dataUrl: 'data:image/png;base64,host',
        w: 800,
        h: 600,
      };
    });
    imageDataUrlToBlobMock.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));

    renderHtmlPreview();
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: /export as image/i }));

    expect(screen.queryByRole('menu')).toBeNull();
    // Opening the dialog must not capture; capture is deferred until Save.
    expect(captureHostIframeSnapshotMock).not.toHaveBeenCalled();

    expect(await screen.findByRole('dialog', { name: /export as image/i })).toBeTruthy();
    await clickSave();
    await waitFor(() => {
      expect(captureHostIframeSnapshotMock).toHaveBeenCalledTimes(1);
      expect(imageDataUrlToBlobMock).toHaveBeenCalledWith('data:image/png;base64,host', 'png');
    });
  });

  it('lets users choose an image format before saving URL-loaded HTML previews', async () => {
    const pngBlob = new Blob(['png'], { type: 'image/png' });
    const imageBlob = new Blob(['jpeg'], { type: 'image/jpeg' });
    requestPreviewSnapshotMock.mockResolvedValueOnce({
      dataUrl: 'data:image/png;base64,ok',
      w: 800,
      h: 600,
    });
    imageDataUrlToBlobMock.mockImplementation(async (_dataUrl: string, format: 'png' | 'jpeg' | 'webp') => {
      if (format === 'jpeg') return imageBlob;
      return pngBlob;
    });
    prepareImageExportTargetMock.mockResolvedValueOnce({
      filename: 'workspace.jpg',
      method: 'picker',
      save: saveImageBlobMock,
    });

    const { activeFrame } = renderHtmlPreview();
    await openImageExportDialog();
    expect(screen.getByRole('radio', { name: 'PNG' })).toBeTruthy();

    // Pick the format BEFORE saving — the chosen format drives the single capture.
    fireEvent.click(screen.getByRole('radio', { name: 'JPEG' }));
    await clickSave();

    await waitFor(() => {
      expect(requestPreviewSnapshotMock).toHaveBeenCalledWith(activeFrame, 1500, undefined, expect.any(Function));
      expect(imageDataUrlToBlobMock).toHaveBeenCalledWith('data:image/png;base64,ok', 'jpeg');
      expect(prepareImageExportTargetMock).toHaveBeenCalledWith('workspace', 'jpeg', { useNativePicker: false });
    });
    // Captured exactly once — no eager capture on open or on format change.
    expect(requestPreviewSnapshotMock).toHaveBeenCalledTimes(1);
    expect(saveImageBlobMock).toHaveBeenCalledWith(imageBlob);
    expect(await screen.findByText('Image saved')).toBeTruthy();
  });

  it('does not capture eagerly on open or on format change', async () => {
    // The old modal captured a preview on open and re-rendered it on every format
    // switch (a "preparing" state that disabled Save). The new modal defers all
    // capture work to Save, so switching format is free and Save stays ready.
    renderHtmlPreview();
    await openImageExportDialog();

    const save = await waitForSaveButton();
    expect((save as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('radio', { name: 'JPEG' }));

    expect(requestPreviewSnapshotMock).not.toHaveBeenCalled();
    expect(captureHostIframeSnapshotMock).not.toHaveBeenCalled();
    expect(imageDataUrlToBlobMock).not.toHaveBeenCalled();

    const saveAfter = screen.getByRole('button', { name: /^save$/i });
    expect((saveAfter as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: /saving image/i })).toBeNull();
  });

  it('retries the srcDoc snapshot bridge before giving up on URL-loaded previews', async () => {
    const pngBlob = new Blob(['png'], { type: 'image/png' });
    let srcDocAttempts = 0;
    requestPreviewSnapshotMock.mockImplementation(async (iframe: HTMLIFrameElement) => {
      if (iframe.getAttribute('data-od-render-mode') === 'url-load') return null;
      srcDocAttempts += 1;
      if (srcDocAttempts === 1) return null;
      return {
        dataUrl: 'data:image/png;base64,recovered',
        w: 800,
        h: 600,
      };
    });
    imageDataUrlToBlobMock.mockResolvedValueOnce(pngBlob);

    const { srcDocFrame } = renderHtmlPreview();
    await openImageExportDialog();
    await clickSave();

    await waitFor(() => {
      expect(requestPreviewSnapshotMock).toHaveBeenCalledWith(srcDocFrame, 1500, undefined, expect.any(Function));
      expect(requestPreviewSnapshotMock).toHaveBeenCalledWith(srcDocFrame, 3000, undefined, expect.any(Function));
      expect(imageDataUrlToBlobMock).toHaveBeenCalledWith('data:image/png;base64,recovered', 'png');
    }, { timeout: 4000 });
  });

  it('captures the visible URL-loaded preview before falling back to the hidden srcDoc transport', async () => {
    const pngBlob = new Blob(['png'], { type: 'image/png' });
    requestPreviewSnapshotMock.mockImplementation(async (iframe: HTMLIFrameElement) => {
      if (iframe.getAttribute('data-od-render-mode') === 'url-load') {
        return {
          dataUrl: 'data:image/png;base64,visible',
          w: 800,
          h: 600,
        };
      }
      return null;
    });
    imageDataUrlToBlobMock.mockResolvedValueOnce(pngBlob);

    const { activeFrame, srcDocFrame } = renderHtmlPreview();
    await openImageExportDialog();
    await clickSave();

    await waitFor(() => {
      expect(requestPreviewSnapshotMock).toHaveBeenCalledWith(activeFrame, 1500, undefined, expect.any(Function));
      expect(imageDataUrlToBlobMock).toHaveBeenCalledWith('data:image/png;base64,visible', 'png');
    });
    expect(requestPreviewSnapshotMock).not.toHaveBeenCalledWith(srcDocFrame, 1500, undefined, expect.any(Function));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('uses the prepared PNG data URL for fallback downloads', async () => {
    const imageBlob = new Blob(['png'], { type: 'image/png' });
    requestPreviewSnapshotMock.mockResolvedValueOnce({
      dataUrl: 'data:image/png;base64,ok',
      w: 800,
      h: 600,
    });
    imageDataUrlToBlobMock.mockResolvedValueOnce(imageBlob);
    prepareImageExportTargetMock.mockResolvedValueOnce({
      filename: 'workspace.png',
      method: 'download',
      save: saveImageBlobMock,
    });

    renderHtmlPreview();
    await openImageExportDialog();
    await clickSave();

    await waitFor(() => {
      expect(prepareImageExportTargetMock).toHaveBeenCalledWith('workspace', 'png', { useNativePicker: false });
      expect(downloadImageDataUrlMock).toHaveBeenCalledWith('data:image/png;base64,ok', 'workspace.png');
    });
    expect(saveImageBlobMock).not.toHaveBeenCalled();
    expect(await screen.findByText('Download started')).toBeTruthy();
  });

  it('passes the selected mobile viewport to the off-screen image exporter', async () => {
    isOpenDesignHostAvailableMock.mockReturnValue(true);
    exportProjectImageDataUrlMock.mockResolvedValueOnce({
      ok: true,
      snapshot: {
        dataUrl: 'data:image/png;base64,mobile',
        w: 390,
        h: 844,
      },
    });
    imageDataUrlToBlobMock.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));
    prepareImageExportTargetMock.mockResolvedValueOnce({
      filename: 'workspace.png',
      method: 'download',
      save: saveImageBlobMock,
    });

    renderHtmlPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Preview viewport' }));
    fireEvent.click(screen.getByRole('option', { name: /mobile/i }));
    await openImageExportDialog();
    await clickSave();

    await waitFor(() => {
      expect(exportProjectImageDataUrlMock).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 'project-1',
        fileName: 'workspace.html',
        deck: false,
        width: 390,
        height: 844,
      }));
    });
  });

  it('keeps desktop page exports on the renderer defaults', async () => {
    isOpenDesignHostAvailableMock.mockReturnValue(true);
    exportProjectImageDataUrlMock.mockResolvedValueOnce({
      ok: true,
      snapshot: {
        dataUrl: 'data:image/png;base64,desktop',
        w: 1440,
        h: 900,
      },
    });
    imageDataUrlToBlobMock.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));

    renderHtmlPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Preview viewport' }));
    fireEvent.click(screen.getByRole('option', { name: /desktop/i }));
    await openImageExportDialog();
    await clickSave();

    await waitFor(() => {
      expect(exportProjectImageDataUrlMock).toHaveBeenCalled();
    });
    const exportOptions = exportProjectImageDataUrlMock.mock.calls.at(-1)?.[0];
    expect(exportOptions).toEqual(expect.objectContaining({
      projectId: 'project-1',
      fileName: 'workspace.html',
      deck: false,
    }));
    expect(exportOptions).not.toHaveProperty('width');
    expect(exportOptions).not.toHaveProperty('height');
  });

  it('keeps deck exports on the renderer defaults when mobile preview is selected', async () => {
    isOpenDesignHostAvailableMock.mockReturnValue(true);
    exportProjectImageDataUrlMock.mockResolvedValueOnce({
      ok: true,
      snapshot: {
        dataUrl: 'data:image/png;base64,deck',
        w: 1440,
        h: 1800,
      },
    });
    imageDataUrlToBlobMock.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));

    renderHtmlPreview(
      '<html><body><div class="deck"><section class="slide">Cover</section></div></body></html>',
      'srcdoc',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview viewport' }));
    fireEvent.click(screen.getByRole('option', { name: /mobile/i }));
    await openImageExportDialog();
    await clickSave();

    await waitFor(() => {
      expect(exportProjectImageDataUrlMock).toHaveBeenCalled();
    });
    const exportOptions = exportProjectImageDataUrlMock.mock.calls.at(-1)?.[0];
    expect(exportOptions).toEqual(expect.objectContaining({
      projectId: 'project-1',
      fileName: 'workspace.html',
      deck: true,
    }));
    expect(exportOptions).not.toHaveProperty('width');
    expect(exportOptions).not.toHaveProperty('height');
  });

  it('does not create a save target when snapshot capture fails', async () => {
    requestPreviewSnapshotMock.mockResolvedValue(null);
    prepareImageExportTargetMock.mockResolvedValueOnce({
      filename: 'workspace.png',
      method: 'picker',
      save: saveImageBlobMock,
    });

    renderHtmlPreview();
    await openImageExportDialog();
    await clickSave();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(CAPTURE_FAILED_TEXT);
    }, { timeout: 4000 });
    expect(prepareImageExportTargetMock).not.toHaveBeenCalled();
    expect(imageDataUrlToBlobMock).not.toHaveBeenCalled();
    expect(saveImageBlobMock).not.toHaveBeenCalled();
  });

  it('does not write the save target when the captured image is empty', async () => {
    requestPreviewSnapshotMock.mockResolvedValueOnce({
      dataUrl: 'data:image/png;base64,ok',
      w: 800,
      h: 600,
    });
    imageDataUrlToBlobMock.mockResolvedValueOnce(new Blob([]));
    prepareImageExportTargetMock.mockResolvedValueOnce({
      filename: 'workspace.png',
      method: 'picker',
      save: saveImageBlobMock,
    });

    renderHtmlPreview();
    await openImageExportDialog();
    await clickSave();

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(CAPTURE_FAILED_TEXT);
    }, { timeout: 4000 });
    expect(imageDataUrlToBlobMock).toHaveBeenCalledWith('data:image/png;base64,ok', 'png');
    expect(prepareImageExportTargetMock).not.toHaveBeenCalled();
    expect(saveImageBlobMock).not.toHaveBeenCalled();
  });

  it('Copy screenshot of a runtime-managed deck uses the visible snapshot, not off-screen slide 0', async () => {
    // A `<deck-stage>` / `data-screen-label` deck is exportable, but the viewer
    // doesn't track its active slide (no `class="slide"` → no slide-state
    // bridge). A current-slide capture must therefore use the visible host
    // snapshot (= the slide on screen), NOT off-screen-render slide 0 — otherwise
    // Copy screenshot always returns the cover regardless of where the user is.
    isOpenDesignHostAvailableMock.mockReturnValue(true);
    captureHostIframeSnapshotMock.mockResolvedValue({ dataUrl: 'data:image/png;base64,host', w: 1280, h: 720 });

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile()}
        liveHtml={
          '<deck-stage><section data-screen-label="01 Cover">A</section>' +
          '<section data-screen-label="02 Next">B</section></deck-stage>'
        }
      />,
    );

    fireEvent.click(await screen.findByTestId('screenshot-copy-button'));

    await waitFor(() => {
      expect(captureHostIframeSnapshotMock).toHaveBeenCalled();
    });
    // The untracked deck must NOT be off-screen-rendered (which would grab slide 0).
    expect(exportProjectImageDataUrlMock).not.toHaveBeenCalled();
  });

  it('exports through the off-screen renderer in a browser, not the snapshot bridge', async () => {
    // CANVAS-17. Export as image shares `captureExportImageSnapshot` with Copy
    // screenshot, and used to reach the daemon renderer only when
    // `isOpenDesignHostAvailable()` was true — a question about whether THIS
    // BROWSER is the Electron shell, asked of a capability that lives in the
    // daemon and answers over plain HTTP. In the web Studio (no Electron shell
    // in this fork) that gate was permanently false, so every export fell to the
    // in-iframe foreignObject bridge, which fails on real artifacts.
    isOpenDesignHostAvailableMock.mockReturnValue(false);
    exportProjectImageDataUrlMock.mockResolvedValue({
      ok: true,
      snapshot: { dataUrl: 'data:image/png;base64,offscreen', w: 1440, h: 900 },
    });
    imageDataUrlToBlobMock.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));
    prepareImageExportTargetMock.mockResolvedValueOnce({
      filename: 'workspace.png',
      method: 'download',
      save: saveImageBlobMock,
    });

    renderHtmlPreview();
    await openImageExportDialog();
    await clickSave();

    await waitFor(() => {
      expect(exportProjectImageDataUrlMock).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 'project-1',
        fileName: 'workspace.html',
      }));
    });
    // The rendered pixels must be what gets saved, and the bridge must not have
    // been consulted at all — reaching it would mean the renderer's answer was
    // discarded.
    await waitFor(() => {
      expect(imageDataUrlToBlobMock).toHaveBeenCalledWith('data:image/png;base64,offscreen', 'png');
    });
    expect(requestPreviewSnapshotMock).not.toHaveBeenCalled();
    expect(captureHostIframeSnapshotMock).not.toHaveBeenCalled();
  });

  it('exports current slide only and names current-slide scope when deck export has no offscreen renderer', async () => {
    canRequestOffscreenImageRenderMock.mockResolvedValue(false);
    requestPreviewSnapshotMock.mockResolvedValueOnce({
      dataUrl: 'data:image/png;base64,current-slide',
      w: 800,
      h: 600,
    });
    imageDataUrlToBlobMock.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));
    prepareImageExportTargetMock.mockResolvedValueOnce({
      filename: 'pitch.png',
      method: 'picker',
      save: saveImageBlobMock,
    });

    const view = render(
      <FileViewer
        projectId="project-1"
        projectKind="slide_deck"
        file={deckFile()}
        isDeck
        liveHtml='<html><body><div class="deck"><section class="slide">Cover</section><section class="slide">Details</section></div></body></html>'
      />,
    );
    const srcDocFrame = view.container.querySelector<HTMLIFrameElement>('iframe[data-od-render-mode="srcdoc"]');
    if (srcDocFrame) fireEvent.load(srcDocFrame);

    await openImageExportDialog();
    await clickSave();

    await waitFor(() => {
      expect(requestPreviewSnapshotMock).toHaveBeenCalled();
    });
    expect(exportProjectImageDataUrlMock).not.toHaveBeenCalled();

    expect(await screen.findByText('Exported current slide only')).toBeTruthy();

    expect(analyticsTrackMock).toHaveBeenCalledWith(
      'artifact_export_result',
      expect.objectContaining({
        result: 'success',
        export_format: 'image',
        scope: 'current-slide',
      }),
      expect.anything(),
    );
  });

  describe('failed export anomaly reporting', () => {
    const anomalyPosts: any[] = [];
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      anomalyPosts.length = 0;
      originalFetch = globalThis.fetch;
      const fetchSpy = vi.fn(async (input: any, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : String(input?.url ?? input);
        if (url.includes('/api/anomalies')) {
          anomalyPosts.push(JSON.parse(String(init?.body ?? '{}')));
          return new Response('{"ok":true,"id":"anomaly-1"}', { status: 200 });
        }
        if (typeof originalFetch === 'function') {
          return originalFetch(input, init);
        }
        return new Response('{}', { status: 200 });
      });
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      if (typeof window !== 'undefined') {
        window.fetch = fetchSpy as unknown as typeof fetch;
      }
    });

    afterEach(() => {
      cleanup();
      globalThis.fetch = originalFetch;
      if (typeof window !== 'undefined') {
        window.fetch = originalFetch;
      }
    });

    it('reports one export-failed anomaly when snapshot capture returns null', async () => {
      requestPreviewSnapshotMock.mockResolvedValue(null);
      prepareImageExportTargetMock.mockResolvedValueOnce({
        filename: 'workspace.png',
        method: 'picker',
        save: saveImageBlobMock,
      });

      renderHtmlPreview();
      await openImageExportDialog();
      await clickSave();

      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toBe(CAPTURE_FAILED_TEXT);
      }, { timeout: 4000 });

      expect(anomalyPosts).toHaveLength(1);
      const [report] = anomalyPosts;
      expect(report.kind).toBe('export-failed');
      expect(report.severity).toBe('warn');
      expect(report.summary).toContain('workspace.html');
      expect(report.summary.toLowerCase()).toContain('capture');
      expect(report.projectId).toBe('project-1');
      expect(report.detail).toEqual(expect.objectContaining({
        exportFormat: 'image',
        errorCode: 'CAPTURE_FAILED',
        fileName: 'workspace.html',
      }));
      expect(typeof report.detail?.durationMs).toBe('number');
    });

    it('reports one export-failed anomaly when captured image is empty', async () => {
      requestPreviewSnapshotMock.mockResolvedValueOnce({
        dataUrl: 'data:image/png;base64,ok',
        w: 800,
        h: 600,
      });
      imageDataUrlToBlobMock.mockResolvedValueOnce(new Blob([]));
      prepareImageExportTargetMock.mockResolvedValueOnce({
        filename: 'workspace.png',
        method: 'picker',
        save: saveImageBlobMock,
      });

      renderHtmlPreview();
      await openImageExportDialog();
      await clickSave();

      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toBe(CAPTURE_FAILED_TEXT);
      }, { timeout: 4000 });

      expect(anomalyPosts).toHaveLength(1);
      const [report] = anomalyPosts;
      expect(report.kind).toBe('export-failed');
      expect(report.severity).toBe('warn');
      expect(report.summary).toContain('workspace.html');
      expect(report.projectId).toBe('project-1');
      expect(report.detail).toEqual(expect.objectContaining({
        exportFormat: 'image',
        errorCode: 'EMPTY_IMAGE',
        fileName: 'workspace.html',
      }));
      expect(typeof report.detail?.durationMs).toBe('number');
    });

    it('sends no anomaly on a successful export', async () => {
      requestPreviewSnapshotMock.mockResolvedValueOnce({
        dataUrl: 'data:image/png;base64,ok',
        w: 800,
        h: 600,
      });
      imageDataUrlToBlobMock.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));
      prepareImageExportTargetMock.mockResolvedValueOnce({
        filename: 'workspace.png',
        method: 'download',
        save: saveImageBlobMock,
      });

      renderHtmlPreview();
      await openImageExportDialog();
      await clickSave();

      await waitFor(() => {
        expect(downloadImageDataUrlMock).toHaveBeenCalledWith('data:image/png;base64,ok', 'workspace.png');
      });

      expect(anomalyPosts).toHaveLength(0);
    });

    it('sends no anomaly when user dismisses the save picker', async () => {
      requestPreviewSnapshotMock.mockResolvedValueOnce({
        dataUrl: 'data:image/png;base64,ok',
        w: 800,
        h: 600,
      });
      imageDataUrlToBlobMock.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));
      prepareImageExportTargetMock.mockResolvedValueOnce(null);

      renderHtmlPreview();
      await openImageExportDialog();
      await clickSave();

      await waitFor(() => {
        expect(prepareImageExportTargetMock).toHaveBeenCalled();
        expect(screen.queryByRole('alert')).toBeNull();
      });

      expect(anomalyPosts).toHaveLength(0);
    });

    it('reports one export-failed anomaly when save target rejects', async () => {
      requestPreviewSnapshotMock.mockResolvedValueOnce({
        dataUrl: 'data:image/png;base64,ok',
        w: 800,
        h: 600,
      });
      imageDataUrlToBlobMock.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));
      const saveError = new Error('disk write failure');
      const failingSave = vi.fn().mockRejectedValueOnce(saveError);
      prepareImageExportTargetMock.mockResolvedValueOnce({
        filename: 'workspace.png',
        method: 'picker',
        save: failingSave,
      });

      renderHtmlPreview();
      await openImageExportDialog();
      await clickSave();

      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toBe('disk write failure');
      }, { timeout: 4000 });

      expect(anomalyPosts).toHaveLength(1);
      const [report] = anomalyPosts;
      expect(report.kind).toBe('export-failed');
      expect(report.severity).toBe('warn');
      expect(report.summary).toContain('workspace.html');
      expect(report.summary).toMatch(/saving the image failed/);
      expect(report.projectId).toBe('project-1');
      expect(report.detail).toEqual(expect.objectContaining({
        exportFormat: 'image',
        errorCode: exportErrorCode(saveError),
        fileName: 'workspace.html',
        stage: 'save',
      }));
      expect(report.detail?.stage).toBe('save');
      expect(typeof report.detail?.durationMs).toBe('number');
    });

    it('keeps a save-stage SecurityError distinct from a capture-stage CAPTURE_TAINTED code', async () => {
      // Nothing was captured here — the bridge already returned a snapshot and
      // encoding succeeded — so a `SecurityError` thrown by the save target
      // itself (e.g. a file-system permission denial) must NOT read as the
      // bridge's "tainted canvas" capture failure. `exportErrorCode` maps any
      // `SecurityError` to `CAPTURE_TAINTED` regardless of caller; the export
      // flow has to gate that classification on `stage === 'capture'` to avoid
      // misattributing a save failure as a capture one.
      requestPreviewSnapshotMock.mockResolvedValueOnce({
        dataUrl: 'data:image/png;base64,ok',
        w: 800,
        h: 600,
      });
      imageDataUrlToBlobMock.mockResolvedValueOnce(new Blob(['png'], { type: 'image/png' }));
      const saveError = new Error('permission denied writing to the target folder');
      saveError.name = 'SecurityError';
      const failingSave = vi.fn().mockRejectedValueOnce(saveError);
      prepareImageExportTargetMock.mockResolvedValueOnce({
        filename: 'workspace.png',
        method: 'picker',
        save: failingSave,
      });

      renderHtmlPreview();
      await openImageExportDialog();
      await clickSave();

      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toBe('permission denied writing to the target folder');
      }, { timeout: 4000 });
      // The generic capture-failure toast must not appear for a save-stage error.
      expect(screen.getByRole('alert').textContent).not.toBe(CAPTURE_FAILED_TEXT);

      expect(anomalyPosts).toHaveLength(1);
      const [report] = anomalyPosts;
      expect(report.kind).toBe('export-failed');
      expect(report.summary).toContain('workspace.html');
      expect(report.summary).toMatch(/saving the image failed/);
      expect(report.summary).not.toMatch(/tainted/i);
      expect(report.detail).toEqual(expect.objectContaining({
        exportFormat: 'image',
        errorCode: 'SecurityError',
        fileName: 'workspace.html',
        stage: 'save',
      }));
      expect(report.detail?.errorCode).not.toBe('CAPTURE_TAINTED');
      expect(typeof report.detail?.durationMs).toBe('number');
    });

    it('reports one export-failed anomaly with CAPTURE_TIMEOUT when snapshot bridge times out', async () => {
      // The real bridge (`requestPreviewSnapshotResult` in runtime/exports.ts)
      // never rejects: every branch, including its own 1.5/3/6s timeout,
      // RESOLVES `{ ok: false, reason: 'timeout' }` and `requestPreviewSnapshot`
      // reports that reason through its `onFailure` callback before resolving
      // `null`. Mocking a rejection here would exercise a path production
      // traffic can never take.
      requestPreviewSnapshotMock.mockImplementation(
        async (
          _iframe: HTMLIFrameElement,
          _timeout: number,
          _options: unknown,
          onFailure?: (failure: { reason: string; error?: string }) => void,
        ) => {
          onFailure?.({ reason: 'timeout' });
          return null;
        },
      );
      prepareImageExportTargetMock.mockResolvedValueOnce({
        filename: 'workspace.png',
        method: 'picker',
        save: saveImageBlobMock,
      });

      renderHtmlPreview();
      await openImageExportDialog();
      await clickSave();

      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toBe(CAPTURE_FAILED_TEXT);
      }, { timeout: 4000 });

      expect(anomalyPosts).toHaveLength(1);
      const [report] = anomalyPosts;
      expect(report.kind).toBe('export-failed');
      expect(report.severity).toBe('warn');
      expect(report.summary).toContain('workspace.html');
      expect(report.summary).toMatch(/timed out/i);
      expect(report.projectId).toBe('project-1');
      expect(report.detail).toEqual(expect.objectContaining({
        exportFormat: 'image',
        errorCode: 'CAPTURE_TIMEOUT',
        fileName: 'workspace.html',
        stage: 'capture',
      }));
      expect(typeof report.detail?.durationMs).toBe('number');
    });

    it('reports one export-failed anomaly with CAPTURE_EMPTY_RENDER when canvas paints blank', async () => {
      // A blank foreignObject rasterization is caught by `canvasLooksBlank` in
      // srcdoc.ts's captureSnapshot, which rejects the in-iframe promise with
      // `new Error('empty-render')` — but that promise never crosses the
      // postMessage boundary as a rejection. The host's `od:snapshot:result`
      // handler serializes it to `{ error: 'empty-render' }` and
      // `requestPreviewSnapshotResult` resolves `{ ok: false, reason:
      // 'render-error', error: 'empty-render' }`, matching this mock.
      requestPreviewSnapshotMock.mockImplementation(
        async (
          _iframe: HTMLIFrameElement,
          _timeout: number,
          _options: unknown,
          onFailure?: (failure: { reason: string; error?: string }) => void,
        ) => {
          onFailure?.({ reason: 'render-error', error: 'empty-render' });
          return null;
        },
      );
      prepareImageExportTargetMock.mockResolvedValueOnce({
        filename: 'workspace.png',
        method: 'picker',
        save: saveImageBlobMock,
      });

      renderHtmlPreview();
      await openImageExportDialog();
      await clickSave();

      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toBe(CAPTURE_FAILED_TEXT);
      }, { timeout: 4000 });

      expect(anomalyPosts).toHaveLength(1);
      const [report] = anomalyPosts;
      expect(report.kind).toBe('export-failed');
      expect(report.severity).toBe('warn');
      expect(report.summary).toContain('workspace.html');
      expect(report.summary).toMatch(/blank/i);
      expect(report.projectId).toBe('project-1');
      expect(report.detail).toEqual(expect.objectContaining({
        exportFormat: 'image',
        errorCode: 'CAPTURE_EMPTY_RENDER',
        fileName: 'workspace.html',
        stage: 'capture',
      }));
      expect(typeof report.detail?.durationMs).toBe('number');
    });

    it('reports one export-failed anomaly with CAPTURE_FAILED and current-slide scope when deck export without renderer returns null', async () => {
      canRequestOffscreenImageRenderMock.mockResolvedValue(false);
      requestPreviewSnapshotMock.mockResolvedValue(null);
      prepareImageExportTargetMock.mockResolvedValueOnce({
        filename: 'pitch.png',
        method: 'picker',
        save: saveImageBlobMock,
      });

      const view = render(
        <FileViewer
          projectId="project-1"
          projectKind="slide_deck"
          file={deckFile()}
          isDeck
          liveHtml='<html><body><div class="deck"><section class="slide">Cover</section><section class="slide">Details</section></div></body></html>'
        />,
      );
      const srcDocFrame = view.container.querySelector<HTMLIFrameElement>('iframe[data-od-render-mode="srcdoc"]');
      if (srcDocFrame) fireEvent.load(srcDocFrame);

      await openImageExportDialog();
      await clickSave();

      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toBe(CAPTURE_FAILED_TEXT);
      }, { timeout: 4000 });

      expect(anomalyPosts).toHaveLength(1);
      const [report] = anomalyPosts;
      expect(report.kind).toBe('export-failed');
      expect(report.severity).toBe('warn');
      expect(report.summary).toContain('pitch.deck.html');
      expect(report.projectId).toBe('project-1');
      expect(report.detail).toEqual(expect.objectContaining({
        exportFormat: 'image',
        errorCode: 'CAPTURE_FAILED',
        fileName: 'pitch.deck.html',
        stage: 'capture',
        scope: 'current-slide',
      }));
      expect(typeof report.detail?.durationMs).toBe('number');
    });

    it('reports one export-failed anomaly with CAPTURE_TAINTED when the canvas is tainted', async () => {
      // `canvas.toDataURL()` throws a real SecurityError inside the iframe
      // (a cross-origin resource painted into the foreignObject taints the
      // canvas), but the `.name` never survives the postMessage boundary —
      // srcdoc.ts's message handler serializes only `err.message` to the
      // host. The message text itself (Chromium's own wording) is what
      // `exportErrorCode`'s `/tainted/i` check has to key on, so this mock
      // resolves the same `{ reason: 'render-error', error: <message> }`
      // shape the real bridge produces, not a rejection carrying `.name`.
      requestPreviewSnapshotMock.mockImplementation(
        async (
          _iframe: HTMLIFrameElement,
          _timeout: number,
          _options: unknown,
          onFailure?: (failure: { reason: string; error?: string }) => void,
        ) => {
          onFailure?.({
            reason: 'render-error',
            error: "Failed to execute 'toDataURL' on 'HTMLCanvasElement': Tainted canvases may not be exported.",
          });
          return null;
        },
      );
      prepareImageExportTargetMock.mockResolvedValueOnce({
        filename: 'workspace.png',
        method: 'picker',
        save: saveImageBlobMock,
      });

      renderHtmlPreview();
      await openImageExportDialog();
      await clickSave();

      await waitFor(() => {
        expect(screen.getByRole('alert').textContent).toBe(CAPTURE_FAILED_TEXT);
      }, { timeout: 4000 });

      expect(anomalyPosts).toHaveLength(1);
      const [report] = anomalyPosts;
      expect(report.kind).toBe('export-failed');
      expect(report.severity).toBe('warn');
      expect(report.summary).toContain('workspace.html');
      expect(report.summary).toMatch(/tainted/i);
      expect(report.projectId).toBe('project-1');
      expect(report.detail).toEqual(expect.objectContaining({
        exportFormat: 'image',
        errorCode: 'CAPTURE_TAINTED',
        fileName: 'workspace.html',
        stage: 'capture',
      }));
      expect(typeof report.detail?.durationMs).toBe('number');
    });

    it('contracts recognises export-failed as a valid anomaly kind', () => {
      expect(isAnomalyKind('export-failed')).toBe(true);
    });
  });
});

