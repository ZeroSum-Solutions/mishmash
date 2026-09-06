// W3E.2 — D-21 option D against a real tools-dev daemon.
//
// Two silences the D-21 investigation recorded on restart 15, both of them the
// same shape: the product knew a request had failed and told the user nothing.
//
//  1. `POST /api/runs` answered 413. The pane raised a card, but nothing named
//     the cause, so the user read a generic "something went wrong" over an HTML
//     error page and could not tell that their message was simply too big.
//  2. The conversation's message read never answered. `ProjectView`'s Loading
//     pane had no bound at all, so the pane sat on "Loading…" with Send disabled
//     for 7.7 minutes and the prompt was lost (project 61059571: conversation
//     present, 0 messages, no run).
//
// The bar for both: the named error surface, with a Retry, inside the D-21
// budget — and a Retry that actually works once the daemon is answering again.
//
// Wire provenance (D-18). `REFUSED_413_BODY` below is the response a real
// daemon produced for an oversized create body, recorded 2026-09-06 off a
// tools-dev daemon on namespace `gauntlet-w3fix-3e-2`:
// `HTTP/1.1 413 Payload Too Large`, `Content-Type: text/html; charset=utf-8`,
// `Content-Security-Policy: default-src 'none'`, `X-Content-Type-Options:
// nosniff`, and this body. No daemon route runs for it — the global
// `express.json({ limit: '4mb' })` in `apps/daemon/src/server.ts` rejects the
// body before routing — so there is no `ApiErrorResponse` envelope to build
// from contracts, and the dev-mode stack lines inside the `<pre>` are elided
// because they are absolute paths of the recording machine.
//
// Why the 413 is served by an interception rather than by a 4 MiB prompt: the
// composer would have to carry a four-megabyte message for the real limit to
// fire, which is a payload-design defect of its own (FU-35), not this track's.
// Everything else here is the real app against the real daemon.
//
// No serial mode: each case creates its own project and its own routes and
// removes them again, so both hold order independence under the sharded pool.

import { createProjectViaApi, gotoProject, putAppConfig, STORAGE_KEY } from '@/playwright/amr';
import { runErrorCard } from '@/playwright/chat';
import { createFakeAgentRuntimes } from '@/playwright/fake-agents';
import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';

/** INV-3.13's bar, and the budget both surfaces below are judged against. */
const D21_BUDGET_MS = 10_000;

/** `chat.runError.title.payloadTooLarge` — the name the card must carry. */
const NAMED_413_TITLE = 'Message too large to send';
/** `chat.runError.title.generic` — the unnamed fallback it must no longer use. */
const GENERIC_FAILURE_TITLE = 'Task failed';

/** The recorded 413 body; see the wire-provenance note above. */
const REFUSED_413_BODY =
  '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>PayloadTooLargeError: request entity too large</pre>\n</body>\n</html>\n';

const BROWSER_CONFIG = {
  mode: 'daemon',
  apiKey: '',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  agentId: 'claude',
  skillId: null,
  designSystemId: null,
  onboardingCompleted: true,
};

/** Daemon app config that leaves no fake agent behind for the next file on this worker. */
const NEUTRAL_APP_CONFIG = {
  onboardingCompleted: true,
  agentId: 'mock',
  agentModels: {},
  agentCliEnv: {},
  skillId: null,
  designSystemId: null,
};

let fakeRuntimes: Awaited<ReturnType<typeof createFakeAgentRuntimes>>;

test.beforeAll(async () => {
  fakeRuntimes = await createFakeAgentRuntimes();
});

async function useFakeClaude(page: import('@playwright/test').Page): Promise<void> {
  await putAppConfig(page, {
    onboardingCompleted: true,
    agentId: 'claude',
    agentModels: { claude: { model: 'default', reasoning: 'default' } },
    agentCliEnv: { claude: fakeRuntimes.claude.env },
    skillId: null,
    designSystemId: null,
  });
}

test('[P1] a 413 on run creation names the failure and Retry then creates the run', async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(T.xlong);

  await context.addInitScript(({ key, config }) => {
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, JSON.stringify(config));
  }, { key: STORAGE_KEY, config: BROWSER_CONFIG });

  const projectId = `run-create-413-${testInfo.workerIndex}-${Date.now().toString(36)}`;
  await createProjectViaApi(page, projectId, 'Run create 413 smoke');
  await useFakeClaude(page);

  // Exactly one create request is refused; every later one reaches the daemon,
  // so Retry is judged against the real route.
  let refused = false;
  const createRunRequests: number[] = [];
  await page.route('**/api/runs', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.fallback();
      return;
    }
    createRunRequests.push(Date.now());
    if (refused) {
      await route.fallback();
      return;
    }
    refused = true;
    await route.fulfill({
      status: 413,
      contentType: 'text/html; charset=utf-8',
      headers: { 'content-security-policy': "default-src 'none'", 'x-content-type-options': 'nosniff' },
      body: REFUSED_413_BODY,
    });
  });

  try {
    await gotoProject(page, projectId);
    const input = page.getByTestId('chat-composer-input');
    await expect(input).toBeVisible({ timeout: T.medium });
    await input.click();
    await input.fill('Design a landing page for a bakery');
    const sendButton = page.getByTestId('chat-send');
    await expect(sendButton).toBeEnabled();

    const sentAt = Date.now();
    await sendButton.click();

    // The bar's first half: the refusal is NAMED, inside the budget. The raw
    // wire always contained the words 'too large' in the card's collapsed
    // source area — what was missing is the card TITLE saying so, which is the
    // only part a user reads without expanding anything.
    const card = runErrorCard(page);
    await expect(card).toBeVisible({ timeout: D21_BUDGET_MS });
    await expect(card).toContainText(NAMED_413_TITLE, { timeout: D21_BUDGET_MS });
    await expect(card).not.toContainText(GENERIC_FAILURE_TITLE);
    expect(Date.now() - sentAt).toBeLessThan(D21_BUDGET_MS);

    // The bar's second half: Retry re-issues the same turn, and this time the
    // create reaches the real daemon and is accepted.
    const retry = card.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    const [created] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST'
          && new URL(response.url()).pathname === '/api/runs'
          && response.status() !== 413,
        { timeout: T.long },
      ),
      retry.click(),
    ]);
    expect(created.ok(), await created.text()).toBeTruthy();
    expect(createRunRequests.length).toBeGreaterThanOrEqual(2);
  } finally {
    await page.unroute('**/api/runs');
    await putAppConfig(page, NEUTRAL_APP_CONFIG);
  }
});

test('[P1] a conversation read that never answers ends in a bounded error with Retry', async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(T.xlong);

  await context.addInitScript(({ key, config }) => {
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, JSON.stringify(config));
  }, { key: STORAGE_KEY, config: BROWSER_CONFIG });

  const projectId = `conversation-load-bound-${testInfo.workerIndex}-${Date.now().toString(36)}`;
  await createProjectViaApi(page, projectId, 'Conversation load bound smoke');
  await useFakeClaude(page);

  // The D-21 shape exactly: the read is issued and never answered, the way a
  // request queued behind an exhausted per-host connection budget is never
  // answered. One read is held; the retry's read goes through.
  let held = false;
  const messageReads: number[] = [];
  await page.route('**/conversations/*/messages*', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    messageReads.push(Date.now());
    if (held) {
      await route.fallback();
      return;
    }
    held = true;
    // Never fulfilled, never aborted: the request simply hangs.
    await new Promise(() => {});
  });

  try {
    const openedAt = Date.now();
    await page.goto(`/projects/${projectId}`, { waitUntil: 'domcontentloaded' });

    // The bar: the pane stops loading and says why, inside the budget. Before
    // the bound it stayed on "Loading…" indefinitely.
    const card = runErrorCard(page);
    await expect(card).toBeVisible({ timeout: D21_BUDGET_MS + T.short });
    await expect(card).toContainText('did not load', { timeout: T.short });
    expect(Date.now() - openedAt).toBeLessThan(D21_BUDGET_MS + T.short);

    // And the surface carries an action: Retry re-issues the read, which now
    // answers, and the composer becomes usable again.
    const retry = card.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.getByTestId('chat-composer-input')).toBeVisible({ timeout: T.medium });
    await expect(card).toBeHidden({ timeout: T.medium });
    expect(messageReads.length).toBeGreaterThanOrEqual(2);
  } finally {
    await page.unroute('**/conversations/*/messages*');
    await putAppConfig(page, NEUTRAL_APP_CONFIG);
  }
});
