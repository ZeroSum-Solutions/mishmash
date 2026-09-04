import {
  CHECKING_NOTICE_TEXT,
  armRunFailureCardWatcher,
  runCheckingNotice,
  runErrorCard,
  runFailureCardSightings,
} from '@/playwright/chat';
import { createFakeAgentRuntimes } from '@/playwright/fake-agents';
import type { FakeAgentId } from '@/playwright/fake-agents';
import { APP_LOADING_TEXT } from '@/playwright/loading';
import { openNewProjectModal as openNewProjectModalFromProjects } from '@/playwright/rail';
import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';
import type { Page, Response } from '@playwright/test';

const STORAGE_KEY = 'mishmash:config';
const LOAD_COUNTER_KEY = 'od-e2e-document-loads';
// The fake runtime holds this prompt's turn open for 15s before it emits its
// artifact and exits 0 (`e2e/lib/fake-agents.ts`), which is the window this
// spec reloads into and then holds the reattached stream across.
const SLOW_RUN_PROMPT = 'Create a slow reload deterministic smoke artifact';
// The fake runtime holds this prompt's turn open for the same 15s and then
// reports the daemon-classified sleep-drop failure (`e2e/lib/fake-agents.ts`),
// so a spec can reload onto the run and still be attached when it really fails.
const SLOW_FAILING_RUN_PROMPT = 'Return the slow reload reported sleep-drop failure';
// What the fake runtime answers SLOW_RUN_PROMPT with. Asserted after the run
// settles so a build that merely drops the notice — leaving a permanently
// running, content-less row — cannot pass as a build that resolved the check.
const SLOW_RUN_ANSWER = 'I stayed attached after the reload';

let fakeRuntimes: Awaited<ReturnType<typeof createFakeAgentRuntimes>>;

test.beforeAll(async () => {
  fakeRuntimes = await createFakeAgentRuntimes();
});

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000);
  await resetDaemonAppConfig(page);
  // Counts documents, not navigations, and survives them: each load bumps a
  // sessionStorage tally, so the assertion at the end can prove the alert left
  // the DOM of the SAME document that painted it.
  await page.addInitScript((key) => {
    const previous = Number(window.sessionStorage.getItem(key) ?? '0');
    window.sessionStorage.setItem(key, String((Number.isFinite(previous) ? previous : 0) + 1));
  }, LOAD_COUNTER_KEY);
  await installBrowserAgentConfig(page, 'codex');
  await configureFakeAgent(page, 'codex');
});

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await resetDaemonAppConfig(page);
});

// SUPERSESSION (W1F.1 -> W1I.3). W1F.1 asserted that the generic "Task failed"
// card was PAINTED on a dropped REATTACHED stream and then retracted —
// `expect(failureAlert).toBeVisible()` followed by `toContainText('Task failed')`,
// before waiting for the same run to reach `succeeded`. W1I.1 made that
// impossible in the live send loop and in Side Chat; W1I.3 closes the reattach
// path the same way. A stream failure the daemon has not adjudicated is an
// unresolved state, so the pane shows the neutral checking notice and never the
// failure card. The retraction W1F.1 proved is now the notice LEAVING, and every
// terminal assertion it carried is kept unchanged below.
//
// W1I.3 browser-level regression: the reattach path is a checking state too.
//
// After a reload onto a run in flight, `attachRecoverableRuns` re-opens the
// run's event stream (`ProjectView.tsx`). When that stream answers non-OK,
// `consumeDaemonRun` surfaces a plain `daemon <status>` error marked
// unadjudicated (`apps/web/src/providers/daemon.ts`), and no terminal event ever
// arrives. The reattach `onError` used to both raise the pane's error string and
// stamp its own assistant row `failed`, so `ChatPane` painted "Task failed" for a
// turn the daemon went on to record as succeeded.
//
// Ordering is forced at the transport, not faked in state:
//   1. the reattached stream is answered 503 the moment the reloaded document
//      OPENS it, which is when this fails in the wild — at the start of a turn
//      that then runs on for seconds. Every later request for that same stream is
//      answered 503 too, so nothing recovers by reattaching: following the run is
//      the only route left;
//   2. the run is then left alone to reach its own `succeeded` terminal;
//   3. the client's own conversation read is HELD until this spec has observed
//      the notice on screen, so the assertion is never a race with the terminal.
// The failure card is watched CONTINUOUSLY from before the reload rather than
// sampled at the end, because a card that is painted and then retracted is
// exactly what this track forbids and a single count cannot see it.
// Nothing writes message state from the test: the row is the client's own
// production PUT, and the daemon's write-side hold
// (`holdTerminalRunStatusOnMessageWrite`) is what keeps the stored row on its
// terminal.
test('[P0] a dropped reattached stream shows the checking state and never the failure card', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Retracted run failure smoke');
  await expectWorkspaceReady(page);

  const runResponse = await sendPrompt(page, SLOW_RUN_PROMPT);
  const { runId } = (await runResponse.json()) as { runId: string };
  const { conversationId, projectId } = await currentProjectContext(page);

  // Documents, not navigations: the reattach must be the stream the RELOADED
  // page opens. The pre-reload page reconnects its own live stream to the same
  // URL, so a flag armed before the reload catches that one instead.
  // `framenavigated` commits the new document before it issues any request.
  let documentsSeen = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) documentsSeen += 1;
  });
  let holdFromDocument = Number.POSITIVE_INFINITY;
  let reattachedStreamFailed = false;
  let releaseRefresh: () => void = () => {};
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });

  // The run's event stream. Only requests the RELOADED document makes are
  // treated as the reattach; the pre-reload page's own live-stream reconnect to
  // the same URL passes through untouched. Every reattach request is refused, so
  // no later attach can recover what following the run has to.
  await page.route(
    (url) => /^\/api\/runs\/[^/]+\/events$/.test(url.pathname),
    async (route) => {
      if (documentsSeen < holdFromDocument) {
        await route.continue();
        return;
      }
      reattachedStreamFailed = true;
      await route.fulfill({ status: 503, body: '' });
    },
  );

  // The conversation read the client makes for itself once the stream failed.
  // Held so the notice can be observed on screen before the answer lands; reads
  // issued before the failure (the reload's own message load) pass through.
  await page.route(
    (url) => /^\/api\/projects\/[^/]+\/conversations\/[^/]+\/messages$/.test(url.pathname),
    async (route) => {
      if (!reattachedStreamFailed || route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await refreshGate;
      await route.continue();
    },
  );

  // Armed BEFORE the reload: the card this track forbids would be painted by the
  // reloaded document within a beat of the 503, too early for a watcher
  // installed after the workspace settles.
  await armRunFailureCardWatcher(page);
  holdFromDocument = documentsSeen + 1;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectWorkspaceReady(page);

  const failureAlert = runErrorCard(page);
  const checkingNotice = runCheckingNotice(page);

  // The client has answered the dropped reattached stream one way or the other.
  await expect
    .poll(
      async () =>
        (await runFailureCardSightings(page)).length > 0
        || (await failureAlert.count()) > 0
        || (await checkingNotice.count()) > 0,
      { intervals: [250], timeout: 120_000 },
    )
    .toBe(true);
  expect(
    await runFailureCardSightings(page),
    'a reattached stream with no run verdict must not paint the failure card',
  ).toEqual([]);
  await expect(checkingNotice, 'the dropped reattached stream must paint the neutral checking notice')
    .toBeVisible({ timeout: T.long });
  await expect(checkingNotice).toContainText(CHECKING_NOTICE_TEXT);

  // The notice is already on screen while the run is still going. Let the run
  // finish under it; that is the state the client has to notice on its own.
  await waitForDaemonRunStatus(page, runId, 'succeeded');

  // Preconditions for the assertions below, asserted separately so a failure
  // names its own cause: the run really did succeed, the stored row really is
  // on that terminal (so the held read carries a succeeded row), and the notice
  // is up in the document that is about to receive it.
  expect(await daemonRunStatus(page, runId), 'precondition: the run must have succeeded').toBe('succeeded');
  expect(
    await storedAssistantRunStatus(page, projectId, conversationId),
    'precondition: the daemon must hold the stored assistant row on the run terminal',
  ).toBe('succeeded');
  const documentLoads = await documentLoadCount(page);

  releaseRefresh();

  // The notice must leave the DOM on the authoritative terminal alone: no page
  // reload, no manual refetch, nothing but the re-check the client scheduled
  // for itself.
  await expect(checkingNotice, 'the checking notice must leave once the run answers')
    .toHaveCount(0, { timeout: T.long });
  await expect(failureAlert, 'no failure alert may stand for a run that succeeded')
    .toHaveCount(0, { timeout: T.long });
  // The pane must land on the turn the run actually delivered, not on a blank
  // row that merely stopped checking.
  await expect(
    page.getByText(SLOW_RUN_ANSWER).first(),
    'the settled turn must show the answer the run delivered',
  ).toBeVisible({ timeout: T.long });
  expect(
    await runFailureCardSightings(page),
    'the failure card must never have appeared, not merely be gone by the end',
  ).toEqual([]);
  expect(await documentLoadCount(page), 'the notice must clear without a page reload').toBe(documentLoads);
  expect(await storedAssistantRunStatus(page, projectId, conversationId)).toBe('succeeded');
});

// The other half of the rule: a verdict is still a verdict. The reattached
// stream is refused exactly as above, but this run really fails, so the card
// must appear carrying the daemon's own facts rather than a neutral notice.
test('[P0] a dropped reattached stream whose run then really fails adopts the daemon verdict', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Reattached failed run smoke');
  await expectWorkspaceReady(page);

  await sendPrompt(page, SLOW_FAILING_RUN_PROMPT);

  let documentsSeen = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) documentsSeen += 1;
  });
  let holdFromDocument = Number.POSITIVE_INFINITY;
  await page.route(
    (url) => /^\/api\/runs\/[^/]+\/events$/.test(url.pathname),
    async (route) => {
      if (documentsSeen < holdFromDocument) {
        await route.continue();
        return;
      }
      await route.fulfill({ status: 503, body: '' });
    },
  );

  holdFromDocument = documentsSeen + 1;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectWorkspaceReady(page);

  const failureAlert = runErrorCard(page);
  await expect(failureAlert, "the run's own failed verdict must still reach the user")
    .toBeVisible({ timeout: 120_000 });
  await expect(
    failureAlert.locator('[data-run-failure-step]'),
    'the adopted card must carry the daemon facts, not a client-invented one',
  ).toHaveCount(1);
  await expect(runCheckingNotice(page), 'the verdict ends the checking state').toHaveCount(0);
});

async function waitForDaemonRunStatus(page: Page, runId: string, status: string): Promise<void> {
  await expect
    .poll(async () => daemonRunStatus(page, runId), { intervals: [250], timeout: 120_000 })
    .toBe(status);
}

async function daemonRunStatus(page: Page, runId: string): Promise<string> {
  const response = await page.request.get(`/api/runs/${runId}`);
  if (!response.ok()) return `http-${response.status()}`;
  return ((await response.json()) as { status: string }).status;
}

async function storedAssistantRunStatus(
  page: Page,
  projectId: string,
  conversationId: string,
): Promise<string | null> {
  const response = await page.request.get(
    `/api/projects/${projectId}/conversations/${conversationId}/messages`,
  );
  expect(response.ok()).toBeTruthy();
  const { messages } = (await response.json()) as {
    messages: Array<{ role: string; runStatus?: string }>;
  };
  return messages.find((message) => message.role === 'assistant')?.runStatus ?? null;
}

async function documentLoadCount(page: Page): Promise<number> {
  return page.evaluate((key) => Number(window.sessionStorage.getItem(key) ?? '0'), LOAD_COUNTER_KEY);
}

async function createProject(page: Page, name: string, agentId: FakeAgentId = 'codex') {
  await configureFakeAgent(page, agentId);
  await installBrowserAgentConfig(page, agentId);
  await gotoEntryHome(page);
  await setBrowserAgentConfig(page, agentId);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  await setBrowserAgentConfig(page, agentId);
  await configureFakeAgent(page, agentId);
  await dismissPrivacyDialog(page);
  await openNewProjectModalFromProjects(page);
  await page.getByTestId('new-project-tab-prototype').click();
  await page.getByTestId('new-project-name').fill(name);
  await page.getByTestId('create-project').click();
}

async function gotoEntryHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForLoadingToClear(page);
  await dismissPrivacyDialog(page);
  await expect(page.getByTestId('home-hero')).toBeVisible();
  await expect(page.getByTestId('home-hero-input')).toBeVisible();
}

async function dismissPrivacyDialog(page: Page) {
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve MishMash' });
  if (await privacyDialog.isVisible()) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
    await expect(privacyDialog).toHaveCount(0);
  }
}

async function expectWorkspaceReady(page: Page) {
  await waitForLoadingToClear(page);
  await expect(page).toHaveURL(/\/projects\//);
  await expect(page.getByTestId('chat-composer')).toBeVisible();
  await expect(page.getByTestId('chat-composer-input')).toBeVisible();
  await expect(page.getByTestId('file-workspace')).toBeVisible();
}

async function waitForLoadingToClear(page: Page) {
  await page.getByText(APP_LOADING_TEXT).first().waitFor({ state: 'hidden', timeout: T.long });
}

async function sendPrompt(page: Page, prompt: string) {
  const input = page.getByTestId('chat-composer-input');
  const sendButton = page.getByTestId('chat-send');
  await expect(input).toBeVisible({ timeout: T.medium });
  await input.click();
  await input.fill(prompt);
  await expect(input).toHaveText(prompt);
  await expect(sendButton).toBeEnabled();
  const response = await Promise.race([
    page.waitForResponse(isCreateRunResponse, { timeout: T.medium }),
    (async () => {
      await sendButton.click();
      return page.waitForResponse(isCreateRunResponse, { timeout: T.medium });
    })(),
  ]);
  expect(response.ok()).toBeTruthy();
  return response;
}

function isCreateRunResponse(response: Response): boolean {
  const url = new URL(response.url());
  return url.pathname === '/api/runs' && response.request().method() === 'POST';
}

async function configureFakeAgent(page: Page, agentId: FakeAgentId) {
  const runtime = fakeRuntimes[agentId];
  const response = await page.request.put('/api/app-config', {
    data: {
      onboardingCompleted: true,
      agentId,
      agentModels: { [agentId]: { model: 'default', reasoning: 'default' } },
      agentCliEnv: { [agentId]: runtime.env },
      skillId: null,
      designSystemId: null,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function setBrowserAgentConfig(page: Page, agentId: FakeAgentId) {
  await installBrowserAgentConfig(page, agentId);
  await page.evaluate(installConfig, { key: STORAGE_KEY, id: agentId, env: fakeRuntimes[agentId].env });
}

async function installBrowserAgentConfig(page: Page, agentId: FakeAgentId) {
  await page.addInitScript(installConfig, {
    key: STORAGE_KEY,
    id: agentId,
    env: fakeRuntimes[agentId].env,
  });
}

function installConfig({ key, id, env }: { key: string; id: FakeAgentId; env: Record<string, string> }) {
  window.localStorage.setItem(
    key,
    JSON.stringify({
      mode: 'daemon',
      apiKey: '',
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-5',
      agentId: id,
      skillId: null,
      designSystemId: null,
      onboardingCompleted: true,
      agentModels: { [id]: { model: 'default', reasoning: 'default' } },
      agentCliEnv: { [id]: env },
    }),
  );
}

async function resetDaemonAppConfig(page: Page) {
  const response = await page.request.put('/api/app-config', {
    data: {
      onboardingCompleted: true,
      agentId: 'mock',
      agentModels: {},
      agentCliEnv: {},
      skillId: null,
      designSystemId: null,
    },
  });
  expect(response.ok()).toBeTruthy();
}

async function currentProjectContext(
  page: Page,
): Promise<{ conversationId: string; projectId: string }> {
  const current = new URL(page.url());
  const [, projects, projectId] = current.pathname.split('/');
  if (projects !== 'projects' || !projectId) {
    throw new Error(`unexpected project route: ${current.pathname}`);
  }
  const response = await page.request.get(`/api/projects/${projectId}/conversations`);
  expect(response.ok()).toBeTruthy();
  const { conversations } = (await response.json()) as {
    conversations: Array<{ id: string; updatedAt: number }>;
  };
  const active = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!active) {
    throw new Error(`no conversations found for project ${projectId}`);
  }
  return { conversationId: active.id, projectId };
}
