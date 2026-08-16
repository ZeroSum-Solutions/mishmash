// @vitest-environment jsdom

// CANVAS-13. Annotation (Mark / Draw) capture had no working path in a browser.
// It could not take the fix Copy screenshot took, because it is the one caller
// that composites onto the image it gets back: PreviewDrawOverlay re-paints the
// user's marks scaled by the preview frame's rect against the snapshot's pixel
// dimensions, so a full-page render would put every mark somewhere the user did
// not draw it. With no Electron compositor in this fork, capture fell through to
// the in-iframe foreignObject bridge, which fails on real artifacts.
//
// The fix is a viewport-clipped render: same document, same viewport size, same
// scroll offset. These specs pin the request the viewer sends, because that
// request is what makes the overlay's arithmetic true.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFile } from '../../src/types';

const {
  captureHostIframeSnapshotMock,
  exportProjectImageDataUrlMock,
  isOpenDesignHostAvailableMock,
  requestPreviewSnapshotMock,
} = vi.hoisted(() => ({
  captureHostIframeSnapshotMock: vi.fn(),
  exportProjectImageDataUrlMock: vi.fn(),
  // The web Studio: no Electron shell, so no host compositor.
  isOpenDesignHostAvailableMock: vi.fn(() => false),
  requestPreviewSnapshotMock: vi.fn(),
}));

vi.mock('../../src/runtime/exports', async () => {
  const actual = await vi.importActual<typeof import('../../src/runtime/exports')>(
    '../../src/runtime/exports',
  );
  return {
    ...actual,
    captureHostIframeSnapshot: captureHostIframeSnapshotMock,
    exportProjectImageDataUrl: exportProjectImageDataUrlMock,
    isOpenDesignHostAvailable: isOpenDesignHostAvailableMock,
    requestPreviewSnapshot: requestPreviewSnapshotMock,
  };
});

import { FileViewer } from '../../src/components/FileViewer';

const FRAME_WIDTH = 900;
const FRAME_HEIGHT = 640;

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

const stubbed: Array<() => void> = [];

/** jsdom reports every layout box as 0x0. `readPreviewViewportRect` treats that
 * as "nothing to capture" and refuses, which is correct in a browser and useless
 * in a test, so the preview frame is given browser-like dimensions. */
function giveFramesRealDimensions() {
  for (const prop of ['clientWidth', 'clientHeight'] as const) {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLIFrameElement.prototype, prop, {
      configurable: true,
      get: () => (prop === 'clientWidth' ? FRAME_WIDTH : FRAME_HEIGHT),
    });
    stubbed.push(() => {
      delete (HTMLIFrameElement.prototype as unknown as Record<string, unknown>)[prop];
      if (original) Object.defineProperty(HTMLElement.prototype, prop, original);
    });
  }
}

/** Puts the embedded document at a scroll offset, the way a user reading past
 * the fold would. Applied to every mounted preview frame: the viewer keeps both
 * the URL-load and srcDoc transports mounted and swaps which one is active, and
 * entering capture mode is one of the swaps. */
function scrollPreviewTo(offset: number) {
  const frames = Array.from(document.querySelectorAll('iframe'));
  expect(frames.length).toBeGreaterThan(0);
  for (const frame of frames) {
    const win = frame.contentWindow;
    if (!win) continue;
    Object.defineProperty(win, 'scrollY', { configurable: true, value: offset });
  }
}

function drawSelectionBox() {
  const canvas = document.querySelector<HTMLCanvasElement>('.preview-draw-canvas, canvas');
  if (!canvas) throw new Error('annotation canvas not mounted');
  const rectSpy = vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 320,
    height: 200,
    right: 320,
    bottom: 200,
    toJSON: () => ({}),
  } as DOMRect);
  stubbed.push(() => rectSpy.mockRestore());
  fireEvent.pointerDown(canvas, { clientX: 40, clientY: 30, pointerId: 1 });
  fireEvent.pointerMove(canvas, { clientX: 220, clientY: 150, pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX: 220, clientY: 150, pointerId: 1 });
}

async function startAnnotationAndSend(scrollOffset: number) {
  fireEvent.click(screen.getByTestId('draw-overlay-toggle'));
  await waitFor(() => expect(document.querySelector('canvas')).toBeTruthy());
  // After activation, not before: entering capture mode swaps which transport is
  // active, and the capture reads the offset from whichever frame that is.
  scrollPreviewTo(scrollOffset);
  drawSelectionBox();
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

function renderPreview() {
  return render(
    <FileViewer
      projectId="project-1"
      projectKind="prototype"
      file={htmlFile()}
      liveHtml="<html><body><main>Workspace</main></body></html>"
    />,
  );
}

describe('FileViewer annotation capture (CANVAS-13)', () => {
  beforeEach(() => {
    giveFramesRealDimensions();
    exportProjectImageDataUrlMock.mockResolvedValue({ ok: false, unavailable: true });
  });

  afterEach(() => {
    cleanup();
    while (stubbed.length > 0) stubbed.pop()!();
    vi.resetAllMocks();
  });

  it('asks the renderer for the visible band at the preview frame’s scroll offset', async () => {
    exportProjectImageDataUrlMock.mockResolvedValue({
      ok: true,
      snapshot: { dataUrl: 'data:image/png;base64,band', w: FRAME_WIDTH, h: FRAME_HEIGHT },
    });

    renderPreview();
    await startAnnotationAndSend(1_600);

    await waitFor(() => {
      expect(exportProjectImageDataUrlMock).toHaveBeenCalledWith(expect.objectContaining({
        projectId: 'project-1',
        fileName: 'workspace.html',
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
        viewportScrollY: 1_600,
        // "What is on screen" is a viewport question even for a deck, so this
        // never asks for per-slide rendering.
        deck: false,
      }));
    });
  });

  it('treats an unscrolled preview as offset 0 rather than omitting the field', async () => {
    // Omitting it would be read by the daemon as "no clip", which returns the
    // whole document — the exact full-page render this mode exists to avoid, and
    // silently so for the most common case of all.
    exportProjectImageDataUrlMock.mockResolvedValue({
      ok: true,
      snapshot: { dataUrl: 'data:image/png;base64,top', w: FRAME_WIDTH, h: FRAME_HEIGHT },
    });

    renderPreview();
    await startAnnotationAndSend(0);

    await waitFor(() => {
      expect(exportProjectImageDataUrlMock).toHaveBeenCalledWith(expect.objectContaining({
        viewportScrollY: 0,
      }));
    });
  });

  it('falls back to the snapshot bridge when the runtime has no renderer', async () => {
    // A 501 from a runtime with no off-screen renderer reads as `unavailable`,
    // and the pre-existing fallback chain must still run behind it.
    exportProjectImageDataUrlMock.mockResolvedValue({ ok: false, unavailable: true });

    renderPreview();
    await startAnnotationAndSend(0);

    await waitFor(() => {
      expect(exportProjectImageDataUrlMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(
        captureHostIframeSnapshotMock.mock.calls.length + requestPreviewSnapshotMock.mock.calls.length,
      ).toBeGreaterThan(0);
    });
  });
});
