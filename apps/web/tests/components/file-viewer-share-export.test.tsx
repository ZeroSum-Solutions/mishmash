// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFile } from '../../src/types';

// FU-48: `fireShareExport` (the generic share/download menu handler in
// FileViewer.tsx) must classify its failures with `exportErrorCode`, which
// after this fix can never return a CAPTURE_* code. Only the capture-stage
// path (`bridgeCaptureFailureErrorCode` / `stageAwareExportErrorCode` at
// `stage === 'capture'`) may report CAPTURE_TIMEOUT / CAPTURE_EMPTY_RENDER /
// CAPTURE_TAINTED. This file drives both the outermost non-image share
// caller (PDF export, via the same download-menu `fireShareExport('pdf', ...)`
// call site that `share_link` and `share_page` also use) and the existing
// image-export capture path, and asserts the `artifact_export_result`
// analytics event each one emits.
const {
  analyticsTrackMock,
  canRequestOffscreenImageRenderMock,
  captureHostIframeSnapshotMock,
  exportProjectAsPdfMock,
  exportProjectImageDataUrlMock,
  imageDataUrlToBlobMock,
  isOpenDesignHostAvailableMock,
  requestPreviewSnapshotMock,
} = vi.hoisted(() => ({
  analyticsTrackMock: vi.fn(),
  canRequestOffscreenImageRenderMock: vi.fn(async () => true),
  captureHostIframeSnapshotMock: vi.fn(async () => null),
  exportProjectAsPdfMock: vi.fn(),
  exportProjectImageDataUrlMock: vi.fn(),
  imageDataUrlToBlobMock: vi.fn(),
  isOpenDesignHostAvailableMock: vi.fn(() => false),
  requestPreviewSnapshotMock: vi.fn(),
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
    exportProjectAsPdf: exportProjectAsPdfMock,
    exportProjectImageDataUrl: exportProjectImageDataUrlMock,
    imageDataUrlToBlob: imageDataUrlToBlobMock,
    isOpenDesignHostAvailable: isOpenDesignHostAvailableMock,
    requestPreviewSnapshot: requestPreviewSnapshotMock,
  };
});

import { FileViewer } from '../../src/components/FileViewer';

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

function renderHtmlPreview() {
  const view = render(
    <FileViewer
      projectId="project-1"
      projectKind="prototype"
      file={htmlFile()}
      liveHtml="<html><body><main>Workspace</main></body></html>"
    />,
  );
  const { container } = view;
  const srcDocFrame = container.querySelector<HTMLIFrameElement>('iframe[data-od-render-mode="srcdoc"]');
  expect(srcDocFrame).toBeTruthy();
  fireEvent.load(srcDocFrame as HTMLIFrameElement);
  return view;
}

function exportResultEvents() {
  return analyticsTrackMock.mock.calls.filter(([event]) => event === 'artifact_export_result');
}

describe('FileViewer share export error classification', () => {
  beforeEach(() => {
    canRequestOffscreenImageRenderMock.mockResolvedValue(true);
    // Force the off-screen (daemon) renderer path to report "unavailable" so
    // the capture-path test below exercises the client-bridge fallback chain
    // (`requestPreviewSnapshot`), matching what `file-viewer-image-export.test.tsx`
    // sets up for the same reason.
    exportProjectImageDataUrlMock.mockResolvedValue({ ok: false, unavailable: true });
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it('never records a CAPTURE_* error_code for a non-capture PDF export timeout', async () => {
    // The generic PDF export path (`triggerPdfExport` -> `fireShareExport('pdf', ...)`)
    // is the same call site `share_link` and `share_page` use — nothing about
    // this failure happened during snapshot capture, so it must classify
    // through the plain `exportErrorCode` fallback (the error's own name),
    // never the CAPTURE_* mapping.
    exportProjectAsPdfMock.mockRejectedValueOnce(new Error('share link request timeout'));

    renderHtmlPreview();
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /export as pdf/i }));

    await waitFor(() => {
      expect(exportResultEvents().some(([, props]) => (props as { result?: string }).result === 'failed')).toBe(true);
    }, { timeout: 4000 });

    const [, failedProps] = exportResultEvents().find(
      ([, props]) => (props as { result?: string }).result === 'failed',
    )!;
    expect((failedProps as { export_format?: string }).export_format).toBe('pdf');
    expect((failedProps as { error_code?: string }).error_code).not.toMatch(/^CAPTURE_/);
    expect((failedProps as { error_code?: string }).error_code).toBe('Error');
  });

  it('still records CAPTURE_TIMEOUT for the image-export capture path (guards against over-correction)', async () => {
    // The snapshot-capture bridge never rejects — every branch, including its
    // own timeout, resolves and reports the reason through `onFailure` — so a
    // real timeout is driven the same way the bridge itself reports one.
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

    renderHtmlPreview();
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /export as image/i }));
    const saveButton = await screen.findByRole('button', { name: /^save$/i });
    await waitFor(() => expect((saveButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(exportResultEvents().some(([, props]) => (props as { result?: string }).result === 'failed')).toBe(true);
    }, { timeout: 4000 });

    const [, failedProps] = exportResultEvents().find(
      ([, props]) => (props as { result?: string }).result === 'failed',
    )!;
    expect((failedProps as { export_format?: string }).export_format).toBe('image');
    expect((failedProps as { error_code?: string }).error_code).toBe('CAPTURE_TIMEOUT');
  });
});
