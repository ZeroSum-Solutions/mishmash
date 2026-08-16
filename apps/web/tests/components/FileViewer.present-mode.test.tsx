// @vitest-environment jsdom
//
// Coverage for the deck/HTML `HtmlFileViewer` presentation surface in
// apps/web/src/components/FileViewer.tsx: the three present targets (in-tab,
// fullscreen, new tab), the deck speaker-notes presenter popup, and how
// present mode interacts with the deck slide controls.
//
// jsdom implements neither the real Fullscreen API nor real `window.open`
// navigation, so every spec here stubs at that boundary and asserts we CALL
// the right browser API with the right arguments — it does not (and cannot)
// prove the browser actually entered fullscreen or actually navigated a new
// tab. Each `it()` block says explicitly which half it proves.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deckFile(): ProjectFile {
  return {
    name: 'deck.html',
    path: 'deck.html',
    type: 'file',
    size: 512,
    mtime: 1710000000,
    kind: 'html',
    mime: 'text/html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Deck',
      entry: 'deck.html',
      renderer: 'html',
      exports: ['html'],
    },
  } as ProjectFile;
}

const DECK_HTML = "<html><body><section class='slide active'>one</section><section class='slide'>two</section></body></html>";

function renderDeckViewer() {
  return render(
    <FileViewer
      projectId="project-1"
      projectKind="prototype"
      file={deckFile()}
      isDeck
      liveHtml={DECK_HTML}
    />,
  );
}

async function getOverlayIframe() {
  return waitFor(() => {
    const frame = document.body.querySelector<HTMLIFrameElement>('.present-overlay iframe');
    expect(frame).toBeTruthy();
    return frame!;
  });
}

function enterPresentInTab() {
  fireEvent.click(screen.getByRole('button', { name: /present/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: /in this tab/i }));
}

function makePopupMock() {
  return {
    closed: false,
    close: vi.fn(),
    focus: vi.fn(),
    postMessage: vi.fn(),
    document: {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
    },
  };
}

describe('FileViewer present mode — fullscreen target', () => {
  it('requests fullscreen on the present overlay element, not the main preview iframe', async () => {
    // Boundary: jsdom has no real Fullscreen API, so we stub
    // Element.requestFullscreen and assert it was CALLED on the right
    // element — we cannot observe an actual OS-level fullscreen transition.
    const requestFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });

    const { container } = renderDeckViewer();

    fireEvent.click(screen.getByRole('button', { name: /present/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /fullscreen/i }));

    await waitFor(() => {
      expect(requestFullscreen).toHaveBeenCalledTimes(1);
    });
    const calledOn = requestFullscreen.mock.instances[0] as HTMLElement;
    expect(calledOn.classList.contains('present-overlay')).toBe(true);
    expect(container.querySelector('.html-viewer.is-tab-present')).toBeTruthy();
  });

  it('auto-exits in-tab presentation when the browser reports fullscreen exited outside the Esc handler', async () => {
    // Simulates the OS/browser "exit fullscreen" gesture (e.g. green-dot,
    // swipe-down) firing a native `fullscreenchange` event with no matching
    // `document.fullscreenElement` — distinct from the Escape-key path,
    // which the deck in-tab test already covers.
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });

    const { container } = renderDeckViewer();

    fireEvent.click(screen.getByRole('button', { name: /present/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /fullscreen/i }));

    await waitFor(() => {
      expect(container.querySelector('.html-viewer.is-tab-present')).toBeTruthy();
    });

    // jsdom's `document.fullscreenElement` is always falsy (it never really
    // enters fullscreen), so dispatching this native event now reproduces
    // exactly the "user backed out of fullscreen" branch in the component's
    // `onFullscreenChange` handler.
    fireEvent(document, new Event('fullscreenchange'));

    await waitFor(() => {
      expect(container.querySelector('.html-viewer.is-tab-present')).toBeNull();
    });
  });
});

describe('FileViewer present mode — new tab target', () => {
  it('opens the artifact through a sandboxed blob URL rather than a raw project URL', async () => {
    // Boundary: jsdom has no real navigation, so we assert the exact
    // `window.open` call — not that a tab actually opened. This is the
    // dedicated HtmlFileViewer path (openSandboxedPreviewInNewTab), which
    // wraps the deck HTML in a fresh blob: URL — unlike LiveArtifactViewer's
    // presentNewTab, which opens the live artifact's raw preview URL
    // directly. Proving THIS call shape is the point of this spec.
    const createObjectURL = vi.fn(() => 'blob:mock-preview-url');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const openMock = vi.fn();
    vi.stubGlobal('open', openMock);

    renderDeckViewer();

    fireEvent.click(screen.getByRole('button', { name: /present/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /new tab/i }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(openMock).toHaveBeenCalledWith('blob:mock-preview-url', '_blank', 'noopener,noreferrer');
    // Presenting in a new tab must not flip the viewer into in-tab
    // presentation chrome.
    expect(screen.queryByRole('button', { name: /exit fullscreen/i })).toBeNull();
  });
});

describe('FileViewer present mode — deck speaker-notes presenter popup', () => {
  it('opens a named presenter popup and writes the speaker-notes document when presenting a deck in-tab', async () => {
    const popup = makePopupMock();
    const openMock = vi.fn(() => popup as unknown as Window);
    vi.stubGlobal('open', openMock);

    renderDeckViewer();
    enterPresentInTab();

    await getOverlayIframe();

    expect(openMock).toHaveBeenCalledWith(
      '',
      'od-presenter-project-1-deck.html',
      expect.stringMatching(/^popup,width=\d+,height=\d+,minWidth=\d+,minHeight=\d+$/),
    );
    expect(popup.document.open).toHaveBeenCalledTimes(1);
    expect(popup.document.write).toHaveBeenCalledTimes(1);
    const written = popup.document.write.mock.calls[0]![0] as string;
    // exportTitle strips the .html extension ("deck.html" -> "deck"); the
    // presenter document's <title> is built as `${title} - Presenter view`.
    expect(written).toContain('<title>deck - Presenter view</title>');
    expect(popup.document.close).toHaveBeenCalledTimes(1);
    expect(popup.focus).toHaveBeenCalledTimes(1);
  });

  it('closes the presenter popup together with the fullscreen overlay on Escape', async () => {
    const popup = makePopupMock();
    vi.stubGlobal('open', vi.fn(() => popup as unknown as Window));

    const { container } = renderDeckViewer();
    enterPresentInTab();
    await getOverlayIframe();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(container.querySelector('.html-viewer.is-tab-present')).toBeNull();
    });
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it('tears down the whole presentation when the presenter popup itself reports Escape', async () => {
    // The presenter popup is a separate top-level window; its own Esc key
    // handler posts `od:presenter-close` back to the opener rather than
    // relying on this document's keydown listener.
    const popup = makePopupMock();
    vi.stubGlobal('open', vi.fn(() => popup as unknown as Window));

    const { container } = renderDeckViewer();
    enterPresentInTab();
    await getOverlayIframe();

    fireEvent(window, new MessageEvent('message', {
      data: { type: 'od:presenter-close', projectId: 'project-1', fileName: 'deck.html' },
      source: popup as unknown as Window,
    }));

    await waitFor(() => {
      expect(container.querySelector('.html-viewer.is-tab-present')).toBeNull();
    });
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it('forwards slide navigation reported by the presenter popup into the fullscreen overlay', async () => {
    // Proves the deck-slide-control interaction the popup is FOR: a
    // presenter driving from the notes window moves the big presented
    // slide. We assert the host calls postMessage on the overlay iframe
    // with the adopted index — not that the overlay's own script actually
    // repainted (jsdom never runs the deck's real slide script).
    const popup = makePopupMock();
    vi.stubGlobal('open', vi.fn(() => popup as unknown as Window));

    renderDeckViewer();
    enterPresentInTab();
    const overlayFrame = await getOverlayIframe();
    const overlayPostMessage = vi.spyOn(overlayFrame.contentWindow!, 'postMessage');

    fireEvent(window, new MessageEvent('message', {
      data: { type: 'od:presenter-slide-go', projectId: 'project-1', fileName: 'deck.html', index: 1 },
      source: popup as unknown as Window,
    }));

    await waitFor(() => {
      expect(overlayPostMessage).toHaveBeenCalledWith(
        { type: 'od:slide', action: 'go', index: 1 },
        '*',
      );
    });
  });
});

describe('FileViewer present mode — deck chrome while presenting', () => {
  it('hides the floating deck navigation controls while presenting in-tab', async () => {
    vi.stubGlobal('open', vi.fn(() => makePopupMock() as unknown as Window));

    const { container } = renderDeckViewer();

    // The floating prev/next deck controls are visible on the normal canvas
    // before presenting starts.
    expect(container.querySelector('.deck-floating-nav')).toBeTruthy();

    enterPresentInTab();
    await getOverlayIframe();

    expect(container.querySelector('.deck-floating-nav')).toBeNull();
  });
});
