// F005 — the Message Center must not talk to anyone but this daemon.
//
// It used to proxy the AMR vendor's message feed and present it as MishMash's
// own: a team demo opened the bell and read someone else's product
// announcements. Worse, the sync ran on mount, every 60 seconds, and on every
// visibility change, whether or not the panel was ever opened — so the traffic
// was not something a user could avoid by not looking.
//
// A point-in-time check gated on "the panel is open" would miss most of that.
// This captures every request across the whole lifecycle instead: mount, the
// interval (driven with a fake clock rather than a real 60-second wait), a
// visibility change, and the panel actually being opened.

import { expect, test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { T } from '@/timeouts';

const MESSAGES_KEY = 'open-design.message-center.anonymous-messages.v1';
const READ_KEY = 'open-design.message-center.anonymous-read-ids.v1';
const LEGACY_WINDOW_KEY = 'open-design.message-center.anonymous-started-at.v1';

// Shaped like the vendor payload an existing install would already have on
// disk, with the three names the panel must never show again.
const CACHED_VENDOR_MESSAGES = [
  {
    id: 'vendor-1',
    audienceType: 'global',
    typeName: 'Product update',
    title: 'Open Design 0.14 is available',
    body: 'DeepSeek Harness support has landed.',
    ctaLabel: 'View update',
    ctaUrl: 'https://open-design.ai/update',
    publishedAt: '2026-07-16T12:00:00.000Z',
    readAt: null,
  },
  {
    id: 'vendor-2',
    audienceType: 'targeted',
    typeName: 'Benefit',
    title: 'Seedream credits added',
    body: 'Your credits are ready.',
    ctaLabel: null,
    ctaUrl: null,
    publishedAt: '2026-07-15T12:00:00.000Z',
    readAt: null,
  },
];

const FORBIDDEN_TEXT = ['Open Design 0.14', 'DeepSeek Harness', 'Seedream credits'];

test.describe.configure({ timeout: T.xlong });

test('[P0] the message center makes no off-daemon request and never shows a cached vendor feed', async ({
  page,
  baseURL,
}) => {
  await applyStandardMocks(page);

  // An existing install, mid-upgrade: the vendor feed is already cached.
  await page.addInitScript(
    ({ messagesKey, readKey, windowKey, messages }) => {
      window.localStorage.setItem(messagesKey, JSON.stringify(messages));
      window.localStorage.setItem(readKey, JSON.stringify([]));
      window.localStorage.setItem(windowKey, '2026-07-16T00:00:00.000Z');
    },
    {
      messagesKey: MESSAGES_KEY,
      readKey: READ_KEY,
      windowKey: LEGACY_WINDOW_KEY,
      messages: CACHED_VENDOR_MESSAGES,
    },
  );

  const messageCenterRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/message-center/i.test(url)) messageCenterRequests.push(url);
  });

  await page.clock.install();
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Past the mount sync, then past a full interval tick, then a visibility
  // change — the three triggers the component actually wires up.
  await page.clock.runFor(65_000);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.clock.runFor(65_000);

  const trigger = page.getByTestId('message-center-trigger');
  await expect(trigger).toBeVisible({ timeout: T.long });
  await trigger.click();
  const dialog = page.getByTestId('message-center-dialog');
  await expect(dialog).toBeVisible();
  await page.clock.runFor(65_000);

  // 0. The sync actually ran. Without this, everything below passes trivially
  //    on zero captured requests — a broken clock or a sync that silently
  //    stopped firing would read as green.
  expect(
    messageCenterRequests.length,
    'no message-center request was captured at all — the sync never fired, so nothing below proves anything',
  ).toBeGreaterThan(0);

  // 1. Every message-center request went to this daemon and nowhere else.
  const daemonOrigin = new URL(baseURL ?? 'http://127.0.0.1').origin;
  const offDaemon = messageCenterRequests.filter((url) => new URL(url).origin !== daemonOrigin);
  expect(offDaemon, `off-daemon message-center requests: ${offDaemon.join(', ')}`).toEqual([]);

  // And none of them went through the generic AMR proxy, which is the route
  // the anonymous path used to reach the vendor through.
  const viaAmrProxy = messageCenterRequests.filter((url) => url.includes('/api-proxy/'));
  expect(viaAmrProxy, `message-center requests via the AMR proxy: ${viaAmrProxy.join(', ')}`).toEqual(
    [],
  );

  // 1b. The proxy route itself refuses message-center, not just this client.
  //     Checking only what the app happens to request cannot catch a capability
  //     that is still open to anything else asking — a stale bundle mid-deploy,
  //     an extension, a curl.
  const directProbe = await page.request.get(
    '/api/integrations/vela/api-proxy/api/v1/message-center/messages?locale=en-US&limit=100',
  );
  expect(directProbe.status(), 'the AMR proxy still serves the vendor message feed').toBe(404);
  expect(await directProbe.json()).toEqual({ error: 'message_center_is_local' });

  // 2. The cached vendor feed is gone from storage and was never rendered.
  for (const text of FORBIDDEN_TEXT) {
    await expect(page.getByText(text, { exact: false })).toHaveCount(0);
  }
  const storage = await page.evaluate(
    ({ messagesKey, readKey, windowKey }) => ({
      messages: window.localStorage.getItem(messagesKey),
      read: window.localStorage.getItem(readKey),
      legacy: window.localStorage.getItem(windowKey),
    }),
    { messagesKey: MESSAGES_KEY, readKey: READ_KEY, windowKey: LEGACY_WINDOW_KEY },
  );
  expect(storage).toEqual({ messages: null, read: null, legacy: null });

  // 3. The panel says what it now actually is, in the exact words R4 specifies.
  await expect(dialog).toContainText('Messages from your team and the tasks you create.');
  await expect(dialog).toContainText('Team messages and tasks will appear here.');
});
