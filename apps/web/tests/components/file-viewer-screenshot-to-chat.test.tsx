// @vitest-environment jsdom
//
// The Screenshot control captures the preview and must hand the result to the
// chat composer, not only to the system clipboard. A capture the user has to
// re-paste by hand is a capture that never reaches the agent.
//
// It rides the SAME transport the Mark/Draw overlay already uses to stage its
// annotation: an `opendesign:annotation` event with `action: 'draft'`, which
// ChatComposer answers by uploading the file and appending it to the draft.
// These assertions pin the contract at the dispatch boundary, so they hold
// without mounting the whole chat pane.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFile } from '../../src/types';
import { ANNOTATION_EVENT, type AnnotationEventDetail } from '../../src/components/PreviewDrawOverlay';

const { captureHostIframeSnapshotMock, copyImageDataUrlToClipboardMock } = vi.hoisted(() => ({
  captureHostIframeSnapshotMock: vi.fn(),
  copyImageDataUrlToClipboardMock: vi.fn(),
}));

vi.mock('../../src/runtime/exports', async () => {
  const actual = await vi.importActual<typeof import('../../src/runtime/exports')>(
    '../../src/runtime/exports',
  );
  return {
    ...actual,
    captureHostIframeSnapshot: captureHostIframeSnapshotMock,
    copyImageDataUrlToClipboard: copyImageDataUrlToClipboardMock,
  };
});

import { FileViewer } from '../../src/components/FileViewer';

// A real 1x1 PNG: `dataUrlToBlob` base64-decodes the payload, so a placeholder
// string would throw before the staging path is reached.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';

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

/**
 * Stands in for ChatComposer: claims the annotation synchronously (as the real
 * composer does, so the dispatcher knows a composer exists) and then answers.
 */
function listenForStagedAnnotation(ackWith: { ok: boolean; message?: string } = { ok: true }) {
  const seen: AnnotationEventDetail[] = [];
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<AnnotationEventDetail>).detail;
    if (!detail) return;
    detail.claim?.();
    seen.push(detail);
    detail.ack?.(ackWith);
  };
  window.addEventListener(ANNOTATION_EVENT, handler);
  return {
    seen,
    dispose: () => window.removeEventListener(ANNOTATION_EVENT, handler),
  };
}

function stubAnimationFrames() {
  const queue: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  return async function flushFrame() {
    const callbacks = queue.splice(0);
    for (const cb of callbacks) cb(0);
    await Promise.resolve();
  };
}

function renderViewer() {
  return render(
    <FileViewer
      projectId="project-1"
      projectKind="prototype"
      file={htmlFile()}
      liveHtml="<html><body><main>Workspace</main></body></html>"
    />,
  );
}

async function clickScreenshot(flushFrame: () => Promise<void>) {
  fireEvent.click(screen.getByTestId('screenshot-copy-button'));
  await flushFrame();
  await flushFrame();
}

describe('FileViewer screenshot routes into the chat composer', () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it('stages the captured frame as a draft annotation carrying a PNG file', async () => {
    captureHostIframeSnapshotMock.mockResolvedValue({ dataUrl: PNG_DATA_URL, w: 800, h: 600 });
    copyImageDataUrlToClipboardMock.mockResolvedValue('copied');
    const flushFrame = stubAnimationFrames();
    const composer = listenForStagedAnnotation();

    try {
      renderViewer();
      await clickScreenshot(flushFrame);

      await waitFor(() => {
        expect(composer.seen).toHaveLength(1);
      });

      const [detail] = composer.seen;
      if (!detail) throw new Error('no annotation reached the composer');
      // 'draft' is the append-to-composer branch — it must not send or queue a
      // turn on the user's behalf.
      expect(detail.action).toBe('draft');
      expect(detail.file).toBeInstanceOf(File);
      expect(detail.file?.type).toBe('image/png');
      expect(detail.file?.name).toMatch(/^screenshot-.*\.png$/);
      expect(detail.file?.size).toBeGreaterThan(0);
      // A bare screenshot marks no region, so it must not fabricate the
      // structured visual-comment fields that anchor a Mark annotation.
      expect(detail.markKind).toBeUndefined();
      expect(detail.bounds).toBeUndefined();
      // Nothing is typed on the user's behalf either.
      expect(detail.note).toBe('');
    } finally {
      composer.dispose();
    }
  });

  it('still copies to the clipboard so the shot can be pasted elsewhere', async () => {
    captureHostIframeSnapshotMock.mockResolvedValue({ dataUrl: PNG_DATA_URL, w: 800, h: 600 });
    copyImageDataUrlToClipboardMock.mockResolvedValue('copied');
    const flushFrame = stubAnimationFrames();
    const composer = listenForStagedAnnotation();

    try {
      renderViewer();
      await clickScreenshot(flushFrame);

      await waitFor(() => {
        expect(copyImageDataUrlToClipboardMock).toHaveBeenCalledWith(PNG_DATA_URL);
      });
      expect(composer.seen).toHaveLength(1);
    } finally {
      composer.dispose();
    }
  });

  it('reports the chat as the destination once the composer acknowledges', async () => {
    captureHostIframeSnapshotMock.mockResolvedValue({ dataUrl: PNG_DATA_URL, w: 800, h: 600 });
    copyImageDataUrlToClipboardMock.mockResolvedValue('copied');
    const flushFrame = stubAnimationFrames();
    const composer = listenForStagedAnnotation();

    try {
      renderViewer();
      await clickScreenshot(flushFrame);

      await waitFor(() => {
        expect(screen.getByText('Screenshot added to chat')).toBeTruthy();
      });
    } finally {
      composer.dispose();
    }
  });

  it('reports the clipboard instead when no composer claims the capture', async () => {
    captureHostIframeSnapshotMock.mockResolvedValue({ dataUrl: PNG_DATA_URL, w: 800, h: 600 });
    copyImageDataUrlToClipboardMock.mockResolvedValue('copied');
    const flushFrame = stubAnimationFrames();

    // No listener at all. Because the claim is synchronous, the dispatcher knows
    // immediately that nothing took the capture and settles on the clipboard
    // result rather than waiting on an acknowledgement that will never arrive.
    renderViewer();
    await clickScreenshot(flushFrame);

    await waitFor(() => {
      expect(screen.getByText('Screenshot copied to clipboard')).toBeTruthy();
    });
  });

  it('surfaces the composer failure when staging is claimed but fails', async () => {
    captureHostIframeSnapshotMock.mockResolvedValue({ dataUrl: PNG_DATA_URL, w: 800, h: 600 });
    copyImageDataUrlToClipboardMock.mockResolvedValue('copied');
    const flushFrame = stubAnimationFrames();
    const composer = listenForStagedAnnotation({ ok: false, message: 'Attachment upload failed' });

    try {
      renderViewer();
      await clickScreenshot(flushFrame);

      await waitFor(() => {
        expect(screen.getByText('Attachment upload failed')).toBeTruthy();
      });
    } finally {
      composer.dispose();
    }
  });
});
