// W3E.2 — D-21 option D against a real tools-dev daemon.
//
// Four silences the D-21 investigation and its Sol r1 fix round recorded, all
// of them the same shape: the product knew a request had failed and told the
// user nothing.
//
//  1. `POST /api/runs` answered 413. The pane raised a card, but nothing named
//     the cause, so the user read a generic "something went wrong" over an HTML
//     error page and could not tell that their message was simply too big.
//  2. The conversation's message read never answered. `ProjectView`'s Loading
//     pane had no bound at all, so the pane sat on "Loading…" with Send disabled
//     for 7.7 minutes and the prompt was lost (project 61059571: conversation
//     present, 0 messages, no run).
//  3. `POST /api/runs` was torn down at the transport — a per-host connection
//     budget an extra tab exhausted, a dropped connection, a navigation — with
//     no `AbortSignal` of the caller's own involved. The daemon may already have
//     accepted the request, so the honest first move is to look the run up
//     before naming anything; once the lookup finds no run under either of this
//     client's own ids, the honest verdict is a named "could not be started"
//     failure with a Retry that carries no double-send hazard.
//  4. The SAME transport-level create abort, but this time the lookup's own
//     reads — the conversation's active runs, the stored messages — never
//     answer either. `fetchActiveChatRuns` and `fetchMessages` carry no
//     `AbortSignal` of their own, so before the Sol r1 fix a read stuck the
//     same way could stall the lookup's whole schedule forever. The honest
//     outcome here is never a guessed Retry — a run that may still be running
//     must never risk a double send (B-02) — but the notice must still turn
//     over to say the daemon is not answering, in bounded time, rather than
//     hang on its first wording forever.
//
// The bar for 1 and 2: the named error surface, with a Retry, inside the D-21
// budget — and a Retry that actually works once the daemon is answering again.
// The bar for 3 is the same, reached through the lookup instead of directly.
// The bar for 4 is narrower and deliberately so: a bounded, honest "not
// answering" notice with no Retry, never an indefinite hang and never a
// guessed Retry against a run that may still be executing.
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
// removes them again, so all four hold order independence under the sharded
// pool.

import { createProjectViaApi, gotoProject, putAppConfig, STORAGE_KEY } from '@/playwright/amr';
import { runCheckingNotice, runErrorCard } from '@/playwright/chat';
import { createFakeAgentRuntimes } from '@/playwright/fake-agents';
import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';

/** INV-3.13's bar, and the budget both surfaces below are judged against. */
const D21_BUDGET_MS = 10_000;

/** `chat.runError.title.payloadTooLarge` — the name the card must carry. */
const NAMED_413_TITLE = 'Message too large to send';
/** `chat.runError.title.generic` — the unnamed fallback it must no longer use. */
const GENERIC_FAILURE_TITLE = 'Task failed';
/** `chat.runError.title.notStarted` — the name a lost-create lookup that found no run must carry. */
const RUN_NOT_STARTED_TITLE = 'The run could not be started';

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
    // Evidence for the PR body's "after" screenshot — a real tools-dev daemon,
    // the real app, the named card on screen.
    await page.screenshot({ path: '../.github/screenshots/w3e2-413-after.png' });

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
    await page.goto(`/projects/${projectId}`, { waitUntil: 'domcontentloaded' });

    // Anchor the budget on the read itself, not on page navigation: hydration
    // and page load are not part of the ten seconds `CONVERSATION_LOAD_BUDGET_MS`
    // bounds in `ProjectView.tsx`, so timing from `page.goto` folds an unrelated
    // and unbounded delay into the same window a regression there should trip.
    await expect.poll(() => messageReads.length, { timeout: T.medium }).toBeGreaterThanOrEqual(1);
    const firstReadAt = messageReads[0]!;

    // The bar: the pane stops loading and says why, inside the budget. Before
    // the bound it stayed on "Loading…" indefinitely. The assertion is on the
    // card's own visible TITLE with `toBeVisible` — not `toContainText` on the
    // whole card, which also matches the longer sentence sitting inert in the
    // collapsed details and would pass even if the title stayed the generic
    // "Task failed" fallback.
    const card = runErrorCard(page);
    const title = card.getByText('This conversation did not load', { exact: true });
    await expect(title).toBeVisible({ timeout: D21_BUDGET_MS + T.short });
    // A small, CI-scaled allowance for setTimeout/IPC scheduling slop — not the
    // multi-second page-load slack the anchor above already removed.
    const timingMarginMs = process.env.CI ? 2_000 : 1_000;
    expect(Date.now() - firstReadAt).toBeLessThan(D21_BUDGET_MS + timingMarginMs);
    await expect(card).toContainText('did not answer in time');
    // Evidence for the PR body's "after" screenshot — a real tools-dev daemon,
    // the real app, the named card on screen.
    await page.screenshot({ path: '../.github/screenshots/w3e2-loading-after.png' });

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

test('[P1] an involuntary create abort the daemon never received ends in the named could-not-start failure with Retry', async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(T.xlong);

  await context.addInitScript(({ key, config }) => {
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, JSON.stringify(config));
  }, { key: STORAGE_KEY, config: BROWSER_CONFIG });

  const projectId = `run-create-abort-${testInfo.workerIndex}-${Date.now().toString(36)}`;
  await createProjectViaApi(page, projectId, 'Run create abort smoke');
  await useFakeClaude(page);

  // The transport tears the create down — no caller-owned `AbortSignal` fired
  // this — before the daemon ever sees it. Every read the lost-create lookup
  // makes afterward reaches the real daemon and truthfully answers: no such
  // run.
  let createAborted = false;
  await page.route('**/api/runs', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST' || createAborted) {
      await route.fallback();
      return;
    }
    createAborted = true;
    await route.abort();
  });

  try {
    await gotoProject(page, projectId);
    const input = page.getByTestId('chat-composer-input');
    await expect(input).toBeVisible({ timeout: T.medium });
    await input.click();
    await input.fill('Design a landing page for a bakery');
    const sendButton = page.getByTestId('chat-send');
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    // The lookup answers truthfully within its own bound (about six seconds of
    // real reads; see `runtime/lost-run-create.ts`), and the honest outcome is
    // a named failure — never the generic "Task failed" a random error gets.
    const card = runErrorCard(page);
    await expect(card).toBeVisible({ timeout: T.long });
    await expect(card).toContainText(RUN_NOT_STARTED_TITLE);
    await expect(card).not.toContainText(GENERIC_FAILURE_TITLE);

    // No run exists, so Retry carries no double-send hazard: it re-issues the
    // same turn, and this time the create reaches the real daemon.
    const retry = card.getByRole('button', { name: 'Retry' });
    await expect(retry).toHaveCount(1);
    const [created] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST'
          && new URL(response.url()).pathname === '/api/runs',
        { timeout: T.long },
      ),
      retry.click(),
    ]);
    expect(created.ok(), await created.text()).toBeTruthy();
  } finally {
    await page.unroute('**/api/runs');
    await putAppConfig(page, NEUTRAL_APP_CONFIG);
  }
});

test('[P1] an involuntary create abort whose lookup cannot read the daemon settles to the not-answering notice instead of hanging', async ({
  context,
  page,
}, testInfo) => {
  // Three consecutive unanswered probes, each up to two bounded reads at
  // `LOST_RUN_CREATE_PROBE_INTERVAL_MS`, land around 25-30s before setup and
  // assertion overhead — well past the file's usual `T.xlong` test budget.
  test.setTimeout(T.xlong + T.long);

  await context.addInitScript(({ key, config }) => {
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, JSON.stringify(config));
  }, { key: STORAGE_KEY, config: BROWSER_CONFIG });

  const projectId = `run-create-abort-unreachable-${testInfo.workerIndex}-${Date.now().toString(36)}`;
  await createProjectViaApi(page, projectId, 'Run create abort unreachable smoke');
  await useFakeClaude(page);

  // The create is torn down exactly as above, but this time neither of the
  // lookup's own reads ever answers either — the D-21 shape carried all the
  // way through: a per-host connection budget can starve any request, not
  // only the first one. Sol r1 finding 1: before the fix, a probe read that
  // cannot even SETTLE stalls `scheduleLostRunCreateLookup`'s whole schedule,
  // so the notice never turns over at all. The fix bounds each probe read to
  // `LOST_RUN_CREATE_PROBE_INTERVAL_MS`, so the honest "not answering" wording
  // still arrives in bounded time even though these reads never do.
  //
  // Only the reads the LOOKUP makes are held — anything before the create is
  // aborted falls through untouched, because the composer's own readiness
  // depends on an unrelated `/api/runs` read of its own (see the UI test
  // stability rules on a control's readiness depending on a streamed
  // precondition), and holding that one too would leave Send disabled and the
  // create never sent at all.
  // The trailing `*` matters: `fetchActiveChatRuns` requests
  // `/api/runs?projectId=...&status=active`, and a bare `**/api/runs` glob
  // (no wildcard after the literal path) does not match a URL with a query
  // string appended — that read would reach the real daemon and answer
  // truthfully every probe, resetting the "unanswered" count `unreachable`
  // needs and leaving this case unable to reach the wording it tests.
  let createAborted = false;
  await page.route('**/api/runs*', async (route) => {
    if (route.request().method() === 'POST') {
      createAborted = true;
      await route.abort();
      return;
    }
    if (!createAborted) {
      await route.fallback();
      return;
    }
    // Never fulfilled, never aborted: the request simply hangs.
    await new Promise(() => {});
  });
  await page.route('**/conversations/*/messages*', async (route) => {
    if (route.request().method() !== 'GET' || !createAborted) {
      await route.fallback();
      return;
    }
    await new Promise(() => {});
  });

  try {
    await gotoProject(page, projectId);
    const input = page.getByTestId('chat-composer-input');
    await expect(input).toBeVisible({ timeout: T.medium });
    await input.click();
    await input.fill('Design a landing page for a bakery');
    const sendButton = page.getByTestId('chat-send');
    await expect(sendButton).toBeEnabled();
    await sendButton.click();

    // The bar: the notice reaches "not answering" in bounded time — not an
    // indefinite hang on its first ("Checking this run") wording. Each of the
    // lookup's two reads per probe is now bounded to
    // `LOST_RUN_CREATE_PROBE_INTERVAL_MS` (3s) and both hang here, so three
    // consecutive unanswered probes at the probe interval land around 25-30s —
    // `T.xlong` leaves real headroom above that rather than racing `T.long`.
    const checkingNotice = runCheckingNotice(page);
    await expect(checkingNotice).toBeVisible({ timeout: T.long });
    await expect(checkingNotice).toContainText('MishMash is not answering', {
      timeout: T.xlong,
    });
    // The run may still be running for all this client can tell, so Retry
    // stays absent even once the daemon is named unreachable (B-02).
    await expect(checkingNotice.getByRole('button', { name: /retry/i })).toHaveCount(0);
    await expect(runErrorCard(page)).toHaveCount(0);
  } finally {
    await page.unroute('**/api/runs*');
    await page.unroute('**/conversations/*/messages*');
    await putAppConfig(page, NEUTRAL_APP_CONFIG);
  }
});
