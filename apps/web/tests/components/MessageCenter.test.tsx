// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageCenter } from '../../src/components/MessageCenter';
import { I18nProvider } from '../../src/i18n';
import type { MessageCenterMessage } from '../../src/message-center-client';

// First-party fixture content for tests that opt in via `messages:`. Never
// the implicit default (see `mockFetch` below) — a test that renders the
// panel without asking for messages must see the same empty state a real,
// unmodified install does.
const defaultMessages: MessageCenterMessage[] = [
  { id: 'release', audienceType: 'global', typeName: 'Product update', title: 'MishMash 0.14 is available', body: 'The new release is ready.', ctaLabel: 'View update', ctaUrl: 'https://mishmash.dev/updates/0.14', publishedAt: '2026-07-16T12:00:00.000Z', readAt: null },
  { id: 'benefit', audienceType: 'targeted', typeName: 'Benefit', title: 'Credits added', body: 'Your credits are ready.', ctaLabel: null, ctaUrl: null, publishedAt: '2026-07-15T12:00:00.000Z', readAt: '2026-07-16T01:00:00.000Z' },
];

function mockFetch(
  options: {
    messages?: MessageCenterMessage[];
    onStatus?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    onMessages?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    onRead?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  } = {},
) {
  // Empty unless a test explicitly opts in with `messages:`. The panel's
  // backend answers empty regardless of sign-in state, and the default mock
  // here matches that on purpose — a test that wants to render first-party
  // content has to ask for it, the same way a real message would have to
  // come from a real, first-party source before the panel shows anything.
  const { messages = [], onStatus, onMessages, onRead } = options;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/status')) return onStatus ? onStatus(input, init) : Response.json({ loggedIn: false });
    if (url.includes('/messages?')) return onMessages ? onMessages(input, init) : Response.json({ messages, nextCursor: null, unreadCount: messages.length });
    if (url.includes('/read')) return onRead ? onRead(input, init) : Response.json({ ok: true });
    return new Response(null, { status: 404 });
  }));
}

function renderMessageCenter() {
  const onOpenNotificationSettings = vi.fn();
  const result = render(<I18nProvider initial="en"><MessageCenter onOpenNotificationSettings={onOpenNotificationSettings}/></I18nProvider>);
  return { ...result, onOpenNotificationSettings };
}

async function openCenter(unreadCount = 1) {
  await waitFor(() => expect(screen.getByLabelText(new RegExp(`Open message center \\(${unreadCount} unread\\)`))).toBeTruthy());
  fireEvent.click(screen.getByTestId('message-center-trigger'));
  return screen.getByTestId('message-center-dialog');
}

beforeEach(() => {
  localStorage.clear();
  mockFetch();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MessageCenter', () => {
  it('formats published dates using the active locale', async () => {
    mockFetch({ messages: defaultMessages });
    const publishedAt = new Date(defaultMessages[0]!.publishedAt);
    const enDate = new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(publishedAt);
    renderMessageCenter();
    fireEvent.click(screen.getByTestId('message-center-trigger'));

    await waitFor(() => {
      expect(screen.getByText(enDate)).toBeTruthy();
    });
  });

  it('pulls anonymous messages from the local route, never the AMR proxy', async () => {
    mockFetch({ messages: defaultMessages });
    renderMessageCenter();
    const dialog = await openCenter();
    expect(within(dialog).getByText('MishMash 0.14 is available')).toBeTruthy();
    expect(localStorage.getItem('open-design.message-center.anonymous-started-at.v1')).toBeNull();
    // Assert on the request that was actually made. Looking for an /api-proxy/
    // call and then asserting something about it is vacuous once that call is
    // gone — `find` returns undefined and every assertion on it passes.
    const messagePulls = vi
      .mocked(fetch)
      .mock.calls.map(([url]) => String(url))
      .filter((url) => url.includes('/messages?'));
    expect(messagePulls.length).toBeGreaterThan(0);
    for (const url of messagePulls) {
      expect(url).toContain('/api/integrations/vela/message-center/messages?');
      expect(url).not.toContain('/api-proxy/');
      expect(url).not.toContain('startedAt=');
    }
  });

  it('marks a message read in the panel without caching anything locally', async () => {
    // The local cache existed to hold the vendor feed between loads. The feed
    // is first-party and empty now, so nothing is written — and read state
    // that outlived a reload was only ever meaningful for cached vendor
    // messages.
    mockFetch({ messages: defaultMessages });
    renderMessageCenter();
    await openCenter();
    fireEvent.click(screen.getByRole('button', { name: /MishMash 0\.14 is available/ }));
    await waitFor(() => expect(screen.queryByLabelText(/unread/)).toBeNull());
    expect(localStorage.getItem('open-design.message-center.anonymous-read-ids.v1')).toBeNull();
    expect(localStorage.getItem('open-design.message-center.anonymous-messages.v1')).toBeNull();
  });

  it('always uses the local read endpoint when a message is opened', async () => {
    // There is no more account/anonymous split to gate on — R1 made the
    // backend answer the same way regardless of sign-in state, so the read
    // endpoint is called unconditionally rather than behind a login check.
    mockFetch({ messages: defaultMessages });
    renderMessageCenter();
    await openCenter();
    fireEvent.click(screen.getByRole('button', { name: /MishMash 0\.14 is available/ }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).includes('/release/read') && init?.method === 'POST')).toBe(true));
  });

  it('filters messages and marks all read', async () => {
    mockFetch({ messages: defaultMessages });
    renderMessageCenter();
    await openCenter();
    fireEvent.click(screen.getByRole('button', { name: 'Unread' }));
    expect(screen.getByText('MishMash 0.14 is available')).toBeTruthy();
    expect(screen.queryByText('Credits added')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(screen.getByText('All caught up')).toBeTruthy());
  });

  it('opens CTA URLs with the existing external-link behavior', async () => {
    mockFetch({ messages: defaultMessages });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderMessageCenter();
    await openCenter();
    fireEvent.click(screen.getByRole('button', { name: /MishMash 0\.14 is available/ }));
    fireEvent.click(screen.getByRole('button', { name: 'View update' }));
    expect(open).toHaveBeenCalledWith('https://mishmash.dev/updates/0.14', '_blank', 'noopener,noreferrer');
  });

  it('keeps both anonymous reads when two expands resolve out of order', async () => {
    const concurrentMessages = [
      { ...defaultMessages[0]!, id: 'release', title: 'Release update', readAt: null, ctaLabel: null, ctaUrl: null },
      { ...defaultMessages[0]!, id: 'security', title: 'Security notice', readAt: null, ctaLabel: null, ctaUrl: null },
    ] satisfies MessageCenterMessage[];
    let resolveFirst: (() => void) | undefined;
    let resolveSecond: (() => void) | undefined;
    const readRequests: string[] = [];
    mockFetch({
      messages: concurrentMessages,
      onRead: (input) =>
        new Promise<Response>((resolve) => {
          readRequests.push(String(input));
          if (!resolveFirst) {
            resolveFirst = () => resolve(Response.json({ read: true, markedCount: 1 }));
            return;
          }
          resolveSecond = () => resolve(Response.json({ read: true, markedCount: 1 }));
        }),
    });
    renderMessageCenter();
    await openCenter(2);

    fireEvent.click(screen.getByRole('button', { name: /Release update/ }));
    fireEvent.click(screen.getByRole('button', { name: /Security notice/ }));
    await waitFor(() => expect(readRequests).toEqual(expect.arrayContaining([
      expect.stringContaining('/messages/release/read'),
      expect.stringContaining('/messages/security/read'),
    ])));
    resolveSecond?.();
    await waitFor(() => expect(screen.queryByLabelText(/2 unread/)).toBeNull());
    resolveFirst?.();
    await waitFor(() => {
      expect(screen.queryByLabelText(/unread/)).toBeNull();
      expect(localStorage.getItem('open-design.message-center.anonymous-read-ids.v1')).toBeNull();
    });
  });

  it('purges cached vendor messages on mount and never renders them', async () => {
    // The regression this guards: the panel used to hydrate from localStorage
    // synchronously on mount, before the network sync resolved. On an install
    // that had already cached the vendor feed that was a real flash of
    // someone else's announcements on every load — so the sync here is held
    // open deliberately, which is exactly the window the flash happened in.
    const cachedMessages = [
      { ...defaultMessages[0]!, id: 'release', title: 'Cached vendor update', readAt: null },
    ] satisfies MessageCenterMessage[];
    localStorage.setItem('open-design.message-center.anonymous-started-at.v1', '2026-07-16T00:00:00.000Z');
    localStorage.setItem('open-design.message-center.anonymous-messages.v1', JSON.stringify(cachedMessages));
    localStorage.setItem('open-design.message-center.anonymous-read-ids.v1', JSON.stringify([]));
    mockFetch({ onMessages: () => new Promise<Response>(() => {}) });

    renderMessageCenter();

    await waitFor(() =>
      expect(localStorage.getItem('open-design.message-center.anonymous-messages.v1')).toBeNull(),
    );
    expect(localStorage.getItem('open-design.message-center.anonymous-read-ids.v1')).toBeNull();
    expect(localStorage.getItem('open-design.message-center.anonymous-started-at.v1')).toBeNull();
    expect(screen.queryByText('Cached vendor update')).toBeNull();
    expect(screen.queryByLabelText(/unread/)).toBeNull();
  });

  it('never checks login status while syncing or marking messages read', async () => {
    // The regression this guards: the sync used to call
    // `/api/integrations/vela/status` before every pull, which — for a
    // signed-in account — runs real AMR billing/model probes and could 500
    // and abort the sync before the local, always-empty endpoint was ever
    // reached. The backend answers the same way regardless of sign-in state
    // now, so nothing in this component has a reason to ask.
    const cachedMessages = [
      { ...defaultMessages[0]!, id: 'release', title: 'Release update', readAt: null, ctaLabel: null, ctaUrl: null },
      { ...defaultMessages[0]!, id: 'security', title: 'Security notice', readAt: null, ctaLabel: null, ctaUrl: null },
    ] satisfies MessageCenterMessage[];
    let statusCalls = 0;
    mockFetch({
      onStatus: async () => {
        statusCalls += 1;
        return Response.json({ loggedIn: true });
      },
      messages: cachedMessages,
    });

    renderMessageCenter();
    await openCenter(2);
    fireEvent.click(screen.getByRole('button', { name: /Release update/ }));
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some(
          ([url, init]) => String(url).includes('/messages/release/read') && init?.method === 'POST',
        ),
      ).toBe(true),
    );
    // One message is still unread, so "Mark all read" stays enabled.
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/read-all')),
      ).toBe(true),
    );

    expect(statusCalls).toBe(0);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/status'))).toBe(false);
  });

  it('shows a loading state instead of the empty copy during the first empty sync', async () => {
    let messageRequests = 0;
    let releaseFirstRequest: (() => void) | undefined;
    mockFetch({
      messages: [],
      onMessages: () =>
        new Promise<Response>((resolve) => {
          messageRequests += 1;
          if (messageRequests === 1) {
            releaseFirstRequest = () => resolve(Response.json({ messages: [], nextCursor: null, unreadCount: 0 }));
            return;
          }
          resolve(Response.json({ messages: [], nextCursor: null, unreadCount: 0 }));
        }),
    });

    renderMessageCenter();
    fireEvent.click(screen.getByTestId('message-center-trigger'));

    expect(screen.getByRole('status')).toHaveTextContent('Checking for updates...');
    expect(screen.queryByText('No messages yet')).toBeNull();

    releaseFirstRequest?.();
    await waitFor(() => expect(screen.getByText('No messages yet')).toBeTruthy());
  });

  it('shows retry controls instead of the empty copy when the first empty sync fails', async () => {
    let messageRequests = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/status')) return Response.json({ loggedIn: false });
      if (url.includes('/messages?')) {
        messageRequests += 1;
        if (messageRequests <= 2) return new Response(null, { status: 500 });
        return Response.json({ messages: [], nextCursor: null, unreadCount: 0 });
      }
      if (url.includes('/read')) return Response.json({ read: true, markedCount: 1 });
      return new Response(null, { status: 404 });
    }));

    renderMessageCenter();
    fireEvent.click(screen.getByTestId('message-center-trigger'));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Check failed. Please retry.'));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('No messages yet')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('No messages yet')).toBeTruthy());
    expect(messageRequests).toBeGreaterThanOrEqual(2);
  });

  it('does not fall back to cached vendor messages when the sync fails', async () => {
    // A failing sync is the one case where showing something stale is
    // tempting. It must still show the retry affordance rather than the
    // vendor's last known feed.
    const cachedMessages = [
      { ...defaultMessages[0]!, id: 'release', title: 'Cached vendor update', readAt: null },
      { ...defaultMessages[0]!, id: 'security', title: 'Cached security notice', readAt: null },
    ] satisfies MessageCenterMessage[];
    localStorage.setItem('open-design.message-center.anonymous-messages.v1', JSON.stringify(cachedMessages));
    localStorage.setItem('open-design.message-center.anonymous-read-ids.v1', JSON.stringify([]));
    mockFetch({ onMessages: async () => new Response(null, { status: 500 }) });

    renderMessageCenter();

    await waitFor(() => expect(screen.getByTestId('message-center-trigger')).toBeTruthy());
    fireEvent.click(screen.getByTestId('message-center-trigger'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Check failed. Please retry.'),
    );
    expect(screen.queryByText('Cached vendor update')).toBeNull();
    expect(screen.queryByText('Cached security notice')).toBeNull();
    expect(localStorage.getItem('open-design.message-center.anonymous-messages.v1')).toBeNull();
  });

  it('keeps a message marked read across a later sync that still reports it unread', async () => {
    // There is no login state left to reset this on: the read overlay is
    // purely local and must survive every resync (mount, interval,
    // visibility change) for as long as the (mocked, still-empty-in-P0)
    // server keeps echoing the message back without a readAt.
    mockFetch({
      messages: [{ ...defaultMessages[0]!, id: 'release', title: 'Release update', readAt: null }],
    });

    renderMessageCenter();
    await openCenter(1);
    fireEvent.click(screen.getByRole('button', { name: /Release update/ }));
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some(
          ([url, init]) => String(url).includes('/messages/release/read') && init?.method === 'POST',
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(screen.queryByLabelText(/unread/)).toBeNull());

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    fireEvent(document, new Event('visibilitychange'));

    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/messages?')).length).toBeGreaterThanOrEqual(2),
    );
    expect(screen.queryByLabelText(/unread/)).toBeNull();
  });

  it('reports mark-read failures without throwing an unhandled rejection', async () => {
    const rejection = new Error('mark-read failed');
    mockFetch({
      messages: defaultMessages,
      onRead: async () => {
        throw rejection;
      },
    });
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    renderMessageCenter();
    await openCenter();

    fireEvent.click(screen.getByRole('button', { name: /MishMash 0\.14 is available/ }));
    await waitFor(() => expect(screen.getByText('MishMash 0.14 is available')).toBeTruthy());
    expect(unhandled).not.toHaveBeenCalled();
    window.removeEventListener('unhandledrejection', unhandled);
  });

  it('shows an inline sync error banner when mark-read fails with visible messages', async () => {
    let readAttempts = 0;
    mockFetch({
      messages: defaultMessages,
      onRead: async () => {
        readAttempts += 1;
        throw new Error('mark-read failed');
      },
    });
    renderMessageCenter();
    await openCenter();
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/messages?')).length,
      ).toBeGreaterThanOrEqual(2),
    );

    fireEvent.click(screen.getByRole('button', { name: /MishMash 0\.14 is available/ }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Check failed. Please retry.'));
    expect(screen.getByText('MishMash 0.14 is available')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(readAttempts).toBe(1);
  });

  it('hides CTA actions for non-http URLs', async () => {
    mockFetch({
      messages: [{ ...defaultMessages[0]!, ctaUrl: 'javascript:alert(1)' }],
    });
    renderMessageCenter();
    await openCenter();
    fireEvent.click(screen.getByRole('button', { name: /MishMash 0\.14 is available/ }));
    expect(screen.queryByRole('button', { name: 'View update' })).toBeNull();
  });

  it('closes with Escape and restores trigger focus', async () => {
    mockFetch({ messages: defaultMessages });
    renderMessageCenter();
    const trigger = screen.getByTestId('message-center-trigger');
    await openCenter();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('message-center-dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
