// @vitest-environment jsdom
//
// Coverage for the connector-backed / data-bearing side of the Live
// Artifact viewer: how it resolves its data source from the daemon API,
// how a manual refresh round-trips, and what it renders when the
// connector-backed refresh is unavailable or fails outright.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LiveArtifactViewer } from '../../src/components/FileViewer';
import { en } from '../../src/i18n/locales/en';
import type { LiveArtifact, LiveArtifactWorkspaceEntry } from '../../src/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function baseLiveArtifact(overrides: Partial<LiveArtifact> = {}): LiveArtifact {
  const artifact: LiveArtifact = {
    schemaVersion: 1,
    id: 'la_1',
    projectId: 'proj_1',
    title: 'Launch Metrics',
    slug: 'launch-metrics',
    status: 'active',
    pinned: false,
    preview: { type: 'html', entry: 'index.html' },
    refreshStatus: 'idle',
    createdAt: '2026-04-29T12:00:00.000Z',
    updatedAt: '2026-04-29T12:00:00.000Z',
    document: {
      format: 'html_template_v1',
      templatePath: 'template.html',
      generatedPreviewPath: 'index.html',
      dataPath: 'data.json',
      dataJson: { headline: 'Launch Metrics', mrr: 42000 },
      sourceJson: {
        type: 'connector_tool',
        input: {},
        connector: {
          connectorId: 'stripe',
          accountLabel: 'Acme Inc',
          toolName: 'get_mrr_summary',
        },
        refreshPermission: 'manual_refresh_granted_for_read_only',
      },
    },
  };
  return { ...artifact, ...overrides, document: overrides.document ?? artifact.document };
}

function baseEntry(overrides: Partial<LiveArtifactWorkspaceEntry> = {}): LiveArtifactWorkspaceEntry {
  const entry: LiveArtifactWorkspaceEntry = {
    kind: 'live-artifact',
    tabId: 'live:la_1',
    artifactId: 'la_1',
    projectId: 'proj_1',
    title: 'Launch Metrics',
    slug: 'launch-metrics',
    status: 'active',
    refreshStatus: 'idle',
    pinned: false,
    preview: { type: 'html', entry: 'index.html' },
    hasDocument: true,
    updatedAt: '2026-04-29T12:00:00.000Z',
  };
  return { ...entry, ...overrides };
}

/** Builds a fetch mock that serves the detail + refreshes GETs from a fixed
 * `LiveArtifact`, and delegates refresh POSTs to `onRefresh`. */
function stubLiveArtifactFetch(
  artifact: LiveArtifact,
  onRefresh?: (url: string) => Promise<Response> | Response,
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url === '/api/live-artifacts/la_1?projectId=proj_1' && method === 'GET') {
      return new Response(JSON.stringify({ artifact }), { status: 200 });
    }
    if (url === '/api/live-artifacts/la_1/refreshes?projectId=proj_1') {
      return new Response(JSON.stringify({ refreshes: [] }), { status: 200 });
    }
    if (url.startsWith('/api/live-artifacts/la_1/refresh?projectId=proj_1') && method === 'POST') {
      if (onRefresh) return onRefresh(url);
      return new Response(JSON.stringify({}), { status: 500 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  });
}

describe('LiveArtifactViewer — data source resolution', () => {
  it('fetches the artifact detail from the daemon API keyed by projectId + artifactId', async () => {
    const fetchMock = stubLiveArtifactFetch(baseLiveArtifact());
    vi.stubGlobal('fetch', fetchMock);

    render(<LiveArtifactViewer projectId="proj_1" liveArtifact={baseEntry()} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/live-artifacts/la_1?projectId=proj_1');
    });
  });

  it('renders the resolved data.json payload in the Data tab, not a loading or empty placeholder', async () => {
    const fetchMock = stubLiveArtifactFetch(baseLiveArtifact());
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<LiveArtifactViewer projectId="proj_1" liveArtifact={baseEntry()} />);

    await screen.findByRole('link', { name: /^open$/i }); // detail fetch has resolved
    fireEvent.click(screen.getByRole('button', { name: en['liveArtifact.viewer.tabData'] }));

    await waitFor(() => {
      const pre = container.querySelector('.viewer-source');
      expect(pre?.textContent).toContain('"mrr": 42000');
    });
    expect(screen.queryByText(en['liveArtifact.viewer.dataEmpty'])).toBeNull();
  });

  it('shows a loading placeholder in the Data tab while the detail fetch is in flight', async () => {
    let resolveDetail!: (value: Response) => void;
    const pendingDetail = new Promise<Response>((resolve) => { resolveDetail = resolve; });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/live-artifacts/la_1?projectId=proj_1') return pendingDetail;
      if (url === '/api/live-artifacts/la_1/refreshes?projectId=proj_1') {
        return new Response(JSON.stringify({ refreshes: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LiveArtifactViewer projectId="proj_1" liveArtifact={baseEntry()} />);
    fireEvent.click(screen.getByRole('button', { name: en['liveArtifact.viewer.tabData'] }));

    expect(screen.getByText(en['fileViewer.loading'])).toBeTruthy();
    expect(screen.queryByText(en['liveArtifact.viewer.dataEmpty'])).toBeNull();

    // Unblock the pending detail fetch so the test doesn't leak a dangling promise/timer.
    resolveDetail(new Response(JSON.stringify({ artifact: baseLiveArtifact() }), { status: 200 }));
    await waitFor(() => {
      expect(screen.queryByText(en['fileViewer.loading'])).toBeNull();
    });
  });

  it('falls back to the empty-data placeholder when the detail source cannot be resolved (connector/API failure)', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/live-artifacts/la_1?projectId=proj_1') {
        // Detail fetch fails outright — the daemon/connector could not resolve
        // the document. `fetchLiveArtifact` swallows this to `null`.
        return new Response(JSON.stringify({ error: { message: 'upstream unavailable' } }), { status: 502 });
      }
      if (url === '/api/live-artifacts/la_1/refreshes?projectId=proj_1') {
        return new Response(JSON.stringify({ refreshes: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LiveArtifactViewer projectId="proj_1" liveArtifact={baseEntry()} />);
    fireEvent.click(screen.getByRole('button', { name: en['liveArtifact.viewer.tabData'] }));

    await waitFor(() => {
      expect(screen.getByText(en['liveArtifact.viewer.dataEmpty'])).toBeTruthy();
    });
  });
});

describe('LiveArtifactViewer — refresh lifecycle', () => {
  it('reloads the preview iframe and shows a success notice after a successful refresh', async () => {
    const refreshedArtifact = baseLiveArtifact({
      lastRefreshedAt: '2026-05-01T00:00:00.000Z',
      document: { ...baseLiveArtifact().document, dataJson: { headline: 'Launch Metrics', mrr: 51000 } },
    });
    const fetchMock = stubLiveArtifactFetch(baseLiveArtifact(), () =>
      new Response(
        JSON.stringify({
          artifact: refreshedArtifact,
          refresh: { id: 'ref_1', status: 'succeeded', refreshedSourceCount: 1 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<LiveArtifactViewer projectId="proj_1" liveArtifact={baseEntry()} />);
    await screen.findByRole('link', { name: /^open$/i });

    const iframeBefore = container.querySelector<HTMLIFrameElement>(
      '[data-testid="live-artifact-preview-frame"]',
    );
    const srcBefore = iframeBefore?.getAttribute('src');
    expect(srcBefore).toContain('v=0');

    fireEvent.click(screen.getByRole('button', { name: en['liveArtifact.refresh.button'] }));

    await screen.findByText(en['liveArtifact.refresh.successOne']);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/live-artifacts/la_1/refresh?projectId=proj_1',
      { method: 'POST' },
    );
    const iframeAfter = container.querySelector<HTMLIFrameElement>(
      '[data-testid="live-artifact-preview-frame"]',
    );
    expect(iframeAfter?.getAttribute('src')).toContain('v=1');
    expect(iframeAfter?.getAttribute('src')).not.toBe(srcBefore);
  });

  it('shows the "no refresh source" notice when the connector refuses the refresh (unavailable)', async () => {
    const fetchMock = stubLiveArtifactFetch(baseLiveArtifact(), () =>
      new Response(
        JSON.stringify({ error: { code: 'LIVE_ARTIFACT_REFRESH_UNAVAILABLE', message: 'no connector configured' } }),
        { status: 409 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<LiveArtifactViewer projectId="proj_1" liveArtifact={baseEntry()} />);
    await screen.findByRole('link', { name: /^open$/i });

    fireEvent.click(screen.getByRole('button', { name: en['liveArtifact.refresh.button'] }));

    const notice = await screen.findByRole('alert');
    // The connector's raw error text ("no connector configured") is
    // deliberately swapped for the canned "no source" copy — the raw
    // connector message is not shown to the user for this error code.
    expect(notice.textContent).toContain(en['liveArtifact.refresh.noSourceTitle']);
    expect(notice.textContent).not.toContain('no connector configured');
  });

  it('shows a network-failure notice when the refresh request cannot reach the connector at all', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/live-artifacts/la_1?projectId=proj_1') {
        return new Response(JSON.stringify({ artifact: baseLiveArtifact() }), { status: 200 });
      }
      if (url === '/api/live-artifacts/la_1/refreshes?projectId=proj_1') {
        return new Response(JSON.stringify({ refreshes: [] }), { status: 200 });
      }
      if (url.startsWith('/api/live-artifacts/la_1/refresh') && init?.method === 'POST') {
        throw new TypeError('Failed to fetch');
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<LiveArtifactViewer projectId="proj_1" liveArtifact={baseEntry()} />);
    await screen.findByRole('link', { name: /^open$/i });

    fireEvent.click(screen.getByRole('button', { name: en['liveArtifact.refresh.button'] }));

    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain(en['liveArtifact.refresh.networkFailure']);
  });

  it('surfaces a previous-refresh-failed notice on load, before any manual refresh is triggered', async () => {
    const fetchMock = stubLiveArtifactFetch(
      baseLiveArtifact({ refreshStatus: 'failed', lastRefreshedAt: '2026-04-30T00:00:00.000Z' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LiveArtifactViewer
        projectId="proj_1"
        liveArtifact={baseEntry({ refreshStatus: 'failed' })}
      />,
    );

    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain(en['liveArtifact.refresh.genericFailure']);
    // No refresh was ever triggered from this render.
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/refresh?projectId='),
      expect.anything(),
    );
  });
});
