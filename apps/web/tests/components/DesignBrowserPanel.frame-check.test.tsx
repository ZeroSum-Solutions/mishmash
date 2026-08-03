// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesignBrowserPanel } from '../../src/components/DesignBrowserPanel';
import { checkFrameEmbeddable, openExternalUrl } from '../../src/providers/registry';

// The panel reaches the network through the providers registry; stub it so
// jsdom rendering never fetches. `checkFrameEmbeddable` is re-stubbed per test.
vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    checkFrameEmbeddable: vi.fn(async () => null),
    openExternalUrl: vi.fn(async () => true),
    writeProjectTextFile: vi.fn(async () => null),
    writeProjectBase64File: vi.fn(async () => null),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const checkFrameEmbeddableMock = vi.mocked(checkFrameEmbeddable);
const openExternalUrlMock = vi.mocked(openExternalUrl);

beforeEach(() => {
  checkFrameEmbeddableMock.mockReset();
  openExternalUrlMock.mockClear();
});

afterEach(() => {
  cleanup();
});

function renderPanel(url: string) {
  return render(
    <DesignBrowserPanel
      projectId="proj-frame-check"
      initialTitle="GSAP"
      initialUrl={url}
      onOpenFile={() => {}}
      onRefreshFiles={() => {}}
    />,
  );
}

describe('DesignBrowserPanel iframe fallback frame-check', () => {
  it('shows an explicit blocked state instead of a silent blank iframe when the site refuses embedding', async () => {
    checkFrameEmbeddableMock.mockResolvedValue({
      verdict: 'blocked',
      finalUrl: 'https://gsap.com/',
      blockedBy: 'x-frame-options',
      header: 'sameorigin',
    });

    const view = renderPanel('https://gsap.com');

    await screen.findByText('This site refuses to be embedded');
    expect(view.container.querySelector('.db-fallback iframe')).toBeNull();
    expect(checkFrameEmbeddableMock).toHaveBeenCalledWith('https://gsap.com', expect.anything());
  });

  it('offers Open in Browser from the blocked state', async () => {
    checkFrameEmbeddableMock.mockResolvedValue({
      verdict: 'blocked',
      finalUrl: 'https://gsap.com/',
      blockedBy: 'x-frame-options',
      header: 'sameorigin',
    });

    renderPanel('https://gsap.com');

    const openButton = await screen.findByRole('button', { name: 'Open in Browser' });
    openButton.click();
    await waitFor(() => expect(openExternalUrlMock).toHaveBeenCalledWith('https://gsap.com'));
  });

  it('keeps the iframe for embeddable sites', async () => {
    checkFrameEmbeddableMock.mockResolvedValue({
      verdict: 'embeddable',
      finalUrl: 'https://example.com/',
    });

    const view = renderPanel('https://example.com');

    await waitFor(() => expect(checkFrameEmbeddableMock).toHaveBeenCalled());
    expect(view.container.querySelector('.db-fallback iframe')).not.toBeNull();
    expect(screen.queryByText('This site refuses to be embedded')).toBeNull();
  });

  it('keeps the iframe when the check cannot decide (unknown verdict)', async () => {
    checkFrameEmbeddableMock.mockResolvedValue({
      verdict: 'unknown',
      finalUrl: 'https://flaky.example/',
      reason: 'fetch-failed',
    });

    const view = renderPanel('https://flaky.example');

    await waitFor(() => expect(checkFrameEmbeddableMock).toHaveBeenCalled());
    expect(view.container.querySelector('.db-fallback iframe')).not.toBeNull();
  });

  it('never applies a stale blocked verdict after navigating to a different URL', async () => {
    let resolveFirst: (v: Awaited<ReturnType<typeof checkFrameEmbeddable>>) => void = () => {};
    checkFrameEmbeddableMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ verdict: 'embeddable', finalUrl: 'https://open.example/' });

    const view = render(
      <DesignBrowserPanel
        projectId="proj-frame-check-race"
        initialTitle="Blocked"
        initialUrl="https://blocked.example"
        onOpenFile={() => {}}
        onRefreshFiles={() => {}}
      />,
    );
    await waitFor(() => expect(checkFrameEmbeddableMock).toHaveBeenCalledTimes(1));

    view.rerender(
      <DesignBrowserPanel
        projectId="proj-frame-check-race"
        initialTitle="Blocked"
        initialUrl="https://blocked.example"
        navigateRequest={{ url: 'https://open.example', nonce: 1 }}
        onOpenFile={() => {}}
        onRefreshFiles={() => {}}
      />,
    );
    await waitFor(() => expect(checkFrameEmbeddableMock).toHaveBeenCalledTimes(2));

    // The first URL's verdict lands late — it must not brand the new URL.
    resolveFirst({
      verdict: 'blocked',
      finalUrl: 'https://blocked.example/',
      blockedBy: 'x-frame-options',
      header: 'deny',
    });
    await waitFor(() =>
      expect(view.container.querySelector('.db-fallback iframe')).not.toBeNull());
    expect(screen.queryByText('This site refuses to be embedded')).toBeNull();
  });

  it('keeps the blocked state through a reload instead of flashing the refused iframe', async () => {
    let resolveRecheck: (v: Awaited<ReturnType<typeof checkFrameEmbeddable>>) => void = () => {};
    checkFrameEmbeddableMock
      .mockResolvedValueOnce({
        verdict: 'blocked',
        finalUrl: 'https://gsap.com/',
        blockedBy: 'x-frame-options',
        header: 'sameorigin',
      })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRecheck = resolve; }));

    const view = renderPanel('https://gsap.com');
    await screen.findByText('This site refuses to be embedded');

    screen.getByRole('button', { name: 'Reload' }).click();
    await waitFor(() => expect(checkFrameEmbeddableMock).toHaveBeenCalledTimes(2));

    // While the re-check is in flight the blocked panel must stay up.
    expect(screen.queryByText('This site refuses to be embedded')).not.toBeNull();
    expect(view.container.querySelector('.db-fallback iframe')).toBeNull();

    // A verdict flip clears it.
    resolveRecheck({ verdict: 'embeddable', finalUrl: 'https://gsap.com/' });
    await waitFor(() =>
      expect(screen.queryByText('This site refuses to be embedded')).toBeNull());
    expect(view.container.querySelector('.db-fallback iframe')).not.toBeNull();
  });
});
