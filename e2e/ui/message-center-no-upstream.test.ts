// F005 — the Message Center must not talk to anyone but this daemon.
//
// It used to proxy the AMR vendor's message feed and present it as MishMash's
// own: a team demo opened the bell and read someone else's product
// announcements. Worse, the sync ran on mount, every 60 seconds, and on every
// visibility change, whether or not the panel was ever opened — so the traffic
// was not something a user could avoid by not looking.
//
// A point-in-time check gated on "the panel is open" is not enough, and
// neither is a single aggregate request count taken after the fact: deleting
// the mount, interval, or visibility-change sync entirely would still leave
// that count positive once the panel is opened, so it would prove nothing
// about the three syncs that matter most (the ones a user never asked for).
// This checkpoints the request count separately after each trigger — mount,
// the interval (driven with a fake clock rather than a real 60-second wait),
// a visibility change, and the panel actually being opened — so every trigger
// has to prove it fired. It also runs across both a fresh profile and one
// with the vendor feed already cached, and both signed-in and signed-out
// (via deterministic status mocks, not whatever the local daemon happens to
// report), since none of those four combinations should behave differently.

import { expect, test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { T } from '@/timeouts';
import type { Locator, Page, Request, Route } from '@playwright/test';

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

// Deterministic sign-in state. The real daemon's own `/status` answer depends
// on whatever `~/.amr/config.json` the machine running the suite happens to
// have, which is exactly what a scenario meant to cover "signed in" must not
// depend on.
function mockVelaStatus(page: Page, loggedIn: boolean) {
  return page.route('**/api/integrations/vela/status', async (route: Route) => {
    const body = loggedIn
      ? {
          loggedIn: true,
          profile: 'local',
          configPath: '/tmp/.amr/config.json',
          user: { id: 'e2e-user', email: 'message-center-e2e@example.com', name: 'E2E User', plan: 'free' },
        }
      : { loggedIn: false, profile: 'local', user: null, configPath: '/tmp/.amr/config.json' };
    await route.fulfill({ json: body });
  });
}

async function seedVendorCache(page: Page) {
  await page.addInitScript(
    (input: { messagesKey: string; readKey: string; windowKey: string; messages: unknown }) => {
      window.localStorage.setItem(input.messagesKey, JSON.stringify(input.messages));
      window.localStorage.setItem(input.readKey, JSON.stringify([]));
      window.localStorage.setItem(input.windowKey, '2026-07-16T00:00:00.000Z');
    },
    { messagesKey: MESSAGES_KEY, readKey: READ_KEY, windowKey: LEGACY_WINDOW_KEY, messages: CACHED_VENDOR_MESSAGES },
  );
}

interface LifecycleResult {
  messageCenterRequests: string[];
  dialog: Locator;
  checkpoints: { afterMount: number; afterInterval: number; afterVisibility: number; afterOpen: number };
}

async function runLifecycle(
  page: Page,
  options: { seeded: boolean; loggedIn: boolean },
): Promise<LifecycleResult> {
  await applyStandardMocks(page);
  await mockVelaStatus(page, options.loggedIn);
  if (options.seeded) await seedVendorCache(page);

  const messageCenterRequests: string[] = [];
  page.on('request', (request: Request) => {
    const url = request.url();
    if (/message-center/i.test(url)) messageCenterRequests.push(url);
  });

  await page.clock.install();
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // 0. Mount. Without this checkpoint proving the sync ran at all, every
  //    checkpoint below passes trivially on a sync that silently never fires.
  await expect
    .poll(() => messageCenterRequests.length, {
      timeout: T.long,
      message: 'no message-center request was captured on mount — the sync never fired',
    })
    .toBeGreaterThan(0);
  const afterMount = messageCenterRequests.length;

  // 1. The 60-second interval, independent of the panel ever being opened.
  await page.clock.runFor(65_000);
  await expect
    .poll(() => messageCenterRequests.length, {
      message: 'the request count did not increase after the interval tick — the interval sync never fired',
    })
    .toBeGreaterThan(afterMount);
  const afterInterval = messageCenterRequests.length;

  // 2. A visibility change, still independent of the panel being opened.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect
    .poll(() => messageCenterRequests.length, {
      message: 'the request count did not increase after a visibility change — that sync never fired',
    })
    .toBeGreaterThan(afterInterval);
  const afterVisibility = messageCenterRequests.length;

  // 3. Opening the panel.
  const trigger = page.getByTestId('message-center-trigger');
  await expect(trigger).toBeVisible({ timeout: T.long });
  await trigger.click();
  const dialog = page.getByTestId('message-center-dialog');
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => messageCenterRequests.length, {
      message: 'the request count did not increase after opening the panel',
    })
    .toBeGreaterThan(afterVisibility);
  const afterOpen = messageCenterRequests.length;

  return { messageCenterRequests, dialog, checkpoints: { afterMount, afterInterval, afterVisibility, afterOpen } };
}

async function assertNoLeak(page: Page, result: LifecycleResult, baseURL: string | undefined) {
  const { messageCenterRequests, dialog } = result;

  // Every message-center request went to this daemon and nowhere else.
  const daemonOrigin = new URL(baseURL ?? 'http://127.0.0.1').origin;
  const offDaemon = messageCenterRequests.filter((url) => new URL(url).origin !== daemonOrigin);
  expect(offDaemon, `off-daemon message-center requests: ${offDaemon.join(', ')}`).toEqual([]);

  // And none of them went through the generic AMR proxy, which is the route
  // the anonymous path used to reach the vendor through.
  const viaAmrProxy = messageCenterRequests.filter((url) => url.includes('/api-proxy/'));
  expect(viaAmrProxy, `message-center requests via the AMR proxy: ${viaAmrProxy.join(', ')}`).toEqual([]);

  // The proxy route itself refuses message-center, not just this client.
  // Checking only what the app happens to request cannot catch a capability
  // that is still open to anything else asking — a stale bundle mid-deploy,
  // an extension, a curl.
  const directProbe = await page.request.get(
    '/api/integrations/vela/api-proxy/api/v1/message-center/messages?locale=en-US&limit=100',
  );
  expect(directProbe.status(), 'the AMR proxy still serves the vendor message feed').toBe(404);
  expect(await directProbe.json()).toEqual({ error: 'message_center_is_local' });

  // The cached vendor feed, if any, is gone from storage and was never
  // rendered.
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

  // The panel says what it now actually is, in the exact words R4 specifies.
  await expect(dialog).toContainText('Messages from your team and the tasks you create.');
  await expect(dialog).toContainText('Team messages and tasks will appear here.');
}

for (const seeded of [false, true]) {
  for (const loggedIn of [false, true]) {
    const profile = seeded ? 'a seeded profile carrying a cached vendor feed' : 'a fresh profile';
    const session = loggedIn ? 'signed in' : 'signed out';
    test(`[P0] the message center syncs on mount, interval, visibility change, and open with no off-daemon request (${profile}, ${session})`, async ({
      page,
      baseURL,
    }) => {
      const result = await runLifecycle(page, { seeded, loggedIn });
      await assertNoLeak(page, result, baseURL);
    });
  }
}
