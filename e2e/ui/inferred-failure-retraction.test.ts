import { createFakeAgentRuntimes } from '@/playwright/fake-agents';
import type { FakeAgentId } from '@/playwright/fake-agents';
import { APP_LOADING_TEXT } from '@/playwright/loading';
import { openNewProjectModal as openNewProjectModalFromProjects } from '@/playwright/rail';
import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';
import type { Locator, Page, Response } from '@playwright/test';

const STORAGE_KEY = 'mishmash:config';
const LOAD_COUNTER_KEY = 'od-e2e-document-loads';
// The fake runtime holds this prompt's turn for 1.2s and then exits 0
// (`e2e/lib/fake-agents.ts`), so the run reaches `succeeded` on its own while
// this spec holds the client's event stream open at the transport.
const RUN_PROMPT = 'Create a delayed deterministic smoke artifact';
// What the fake runtime answers that prompt with (`e2e/lib/fake-agents.ts`).
// Asserted after the retraction so a build that merely drops the alert — leaving
// a permanently running, content-less row — cannot pass as a build that
// retracted the failure.
const RUN_ANSWER = 'I recovered the delayed reasoning path';

let fakeRuntimes: Awaited<ReturnType<typeof createFakeAgentRuntimes>>;

test.beforeAll(async () => {
  fakeRuntimes = await createFakeAgentRuntimes();
});

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000);
  await resetDaemonAppConfig(page);
  // Counts documents, not navigations, and survives them: each load bumps a
  // sessionStorage tally, so the assertions below can prove the alert left the
  // DOM of the SAME document that painted it. Top-level documents only —
  // `addInitScript` also runs in the artifact preview iframe, which shares this
  // origin's sessionStorage and would otherwise read as a page reload.
  await page.addInitScript((key) => {
    if (window.top !== window.self) return;
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

// W1G.1 browser-level regression, the two halves W1F.1 left open.
//
// `run-failure-retraction.test.ts` covers the REATTACHED stream: a client that
// reloads onto a run in flight, whose reattached stream then answers non-OK.
// That path already schedules one conversation refresh, and W1F.1 taught the
// refresh to retract the pane's error string alongside the row.
//
// Two paths reach the same symptom without that refresh:
//
//   * the LIVE send loop. `consumeDaemonRun` answers a non-OK event-stream
//     response with a plain `daemon <status>` error carrying no disconnect code
//     (apps/web/src/providers/daemon.ts). ProjectView's live `onError` then
//     takes its ordinary branch: it paints the pane's error string, writes a
//     `failed` row, SEALS the run in `completedReattachRunsRef` — so no
//     reattach re-queries it — and schedules no refresh, because only the two
//     generic-disconnect retry-cap branches set that flag.
//   * Side Chat (`useConversationChat`), which holds its own error slot and its
//     own row write and has no reconciliation of any kind.
//
// In both cases the client never receives the run's terminal, while the daemon
// records the run as succeeded and stamps the stored assistant row with that
// terminal (`reconcileAssistantMessageOnRunEnd`, `followRunTerminalOnMessage`).
// The user reads "Task failed" for a turn that succeeded until a page reload.
//
// Ordering is forced at the transport, not faked in state, exactly as the
// sibling spec does it:
//   1. the run's event stream is answered 503 the moment the client OPENS it,
//      which is when this fails in the wild — at the start of a turn that then
//      runs on for seconds or minutes. The client paints the alert while the
//      run is still going, so a pane that looked once and gave up would leave
//      it there for the whole run;
//   2. every later request for that same stream is answered 503 too, so nothing
//      recovers by reattaching: following the run is the only route left;
//   3. the client's own conversation read — which it makes only once the run
//      reports a terminal — is HELD until this spec has observed the alert on
//      screen, so the assertion is never a race with the retraction.
// Nothing writes message state from the test: the failed row is the client's
// own production PUT, and the daemon's write-side hold
// (`holdTerminalRunStatusOnMessageWrite`) is what keeps the stored row on its
// terminal.

test('[P0] a non-ok live event stream leaves no failure alert once the run reaches succeeded', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Live run failure retraction smoke');
  await expectWorkspaceReady(page);

  const { conversationId, projectId } = await currentProjectContext(page);
  const streamHold = holdRunEventStream(page);
  const refreshGate = holdConversationRead(page, () => streamHold.failed);

  streamHold.arm();
  const runResponse = await sendPrompt(page, page.getByTestId('chat-composer').first(), RUN_PROMPT);
  const { runId } = (await runResponse.json()) as { runId: string };

  const failureAlert = runRecoveryCard(page);
  await expect(failureAlert, 'the non-ok live event stream must paint the run-recovery alert')
    .toBeVisible({ timeout: 120_000 });
  await expect(failureAlert).toContainText('Task failed');

  // The alert is already on screen while the run is still going. Let the run
  // finish under it; that is the state the client has to notice on its own.
  await waitForDaemonRunStatus(page, runId, 'succeeded');

  // Preconditions for the assertion below, asserted separately so a failure
  // names its own cause: the run really did succeed, the stored row really is
  // on that terminal, and the alert is up in the document about to receive it.
  expect(await daemonRunStatus(page, runId), 'precondition: the run must have succeeded').toBe('succeeded');
  expect(
    await storedAssistantRunStatus(page, projectId, conversationId),
    'precondition: the daemon must hold the stored assistant row on the run terminal',
  ).toBe('succeeded');
  const documentLoads = await documentLoadCount(page);

  refreshGate.release();

  // The alert must leave the DOM on the authoritative terminal alone: no page
  // reload, no manual refetch, nothing but the re-check the client schedules
  // for itself.
  await expect(failureAlert, 'the retracted run failure must leave the DOM')
    .toHaveCount(0, { timeout: T.long });
  // The pane must land on the turn the run actually delivered, not on a blank
  // row that merely stopped saying "failed".
  await expect(
    page.getByText(RUN_ANSWER).first(),
    'the retracted turn must show the answer the run delivered',
  ).toBeVisible({ timeout: T.long });
  expect(await documentLoadCount(page), 'the alert must clear without a page reload').toBe(documentLoads);
  expect(await storedAssistantRunStatus(page, projectId, conversationId)).toBe('succeeded');
});

test('[P0] a non-ok Side Chat event stream leaves no failure alert once the run reaches succeeded', async ({ page }) => {
  await page.goto('/');
  await createProject(page, 'Side chat run failure retraction smoke');
  await expectWorkspaceReady(page);

  const { conversationId, projectId } = await currentProjectContext(page);
  // A Side Chat tab is only ever restored from persisted tab state — the
  // workspace has no launcher affordance for one (`FileWorkspace.tsx`). Open it
  // the way the product does, through the same `PUT /api/projects/:id/tabs`
  // endpoint the client writes, on a conversation of its own so the tab runs
  // its own `useConversationChat` rather than mirroring the primary chat.
  const sideConversationId = await createConversation(page, projectId, 'Side chat');
  await openSideChatTab(page, projectId, conversationId, sideConversationId);

  const sideChat = page.getByTestId('side-chat-tab');
  await expect(sideChat, 'the persisted side chat tab must mount').toBeVisible({ timeout: T.long });

  const streamHold = holdRunEventStream(page);
  const refreshGate = holdConversationRead(page, () => streamHold.failed);

  streamHold.arm();
  const runResponse = await sendPrompt(page, await composerInside(page, sideChat), RUN_PROMPT);
  const { runId } = (await runResponse.json()) as { runId: string };

  const failureAlert = runRecoveryCard(sideChat);
  await expect(failureAlert, 'the non-ok Side Chat event stream must paint the run-recovery alert')
    .toBeVisible({ timeout: 120_000 });
  await expect(failureAlert).toContainText('Task failed');

  await waitForDaemonRunStatus(page, runId, 'succeeded');

  expect(await daemonRunStatus(page, runId), 'precondition: the run must have succeeded').toBe('succeeded');
  expect(
    await storedAssistantRunStatus(page, projectId, sideConversationId),
    'precondition: the daemon must hold the stored assistant row on the run terminal',
  ).toBe('succeeded');
  const documentLoads = await documentLoadCount(page);

  refreshGate.release();

  await expect(failureAlert, 'the retracted Side Chat run failure must leave the DOM')
    .toHaveCount(0, { timeout: T.long });
  await expect(
    sideChat.getByText(RUN_ANSWER).first(),
    'the retracted Side Chat turn must show the answer the run delivered',
  ).toBeVisible({ timeout: T.long });
  expect(await documentLoadCount(page), 'the alert must clear without a page reload').toBe(documentLoads);
  expect(await storedAssistantRunStatus(page, projectId, sideConversationId)).toBe('succeeded');
});

interface RunEventStreamHold {
  /** Start refusing the next run event stream this page opens. */
  arm: () => void;
  /** True once the stream has been answered non-OK at least once. */
  readonly failed: boolean;
}

/**
 * Answer the held run's event stream 503, starting with the very first request —
 * the client's own live stream, opened the moment the run is created and long
 * before the run finishes. Later requests for the same stream are refused too,
 * so no reattach can recover what following the run is supposed to.
 *
 * Armed BEFORE the send, not after the create-run response, because the client
 * opens the stream the moment that response lands.
 */
function holdRunEventStream(page: Page): RunEventStreamHold {
  let armed = false;
  let heldRunId: string | null = null;
  let failed = false;
  void page.route(
    (url) => /^\/api\/runs\/[^/]+\/events$/.test(url.pathname),
    async (route) => {
      const requestedRunId = new URL(route.request().url()).pathname.split('/')[3] ?? '';
      if (!armed || (heldRunId !== null && requestedRunId !== heldRunId)) {
        await route.continue();
        return;
      }
      heldRunId = heldRunId ?? requestedRunId;
      failed = true;
      await route.fulfill({ status: 503, body: '' });
    },
  );
  return {
    arm: () => {
      armed = true;
    },
    get failed() {
      return failed;
    },
  };
}

/**
 * Hold the conversation read the client schedules for itself after the stream
 * failed, so the alert can be observed on screen before the retraction lands.
 * Reads issued before the failure (the pane's own initial load) pass through.
 */
function holdConversationRead(page: Page, isArmed: () => boolean): { release: () => void } {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  void page.route(
    (url) => /^\/api\/projects\/[^/]+\/conversations\/[^/]+\/messages$/.test(url.pathname),
    async (route) => {
      if (!isArmed() || route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      await gate;
      await route.continue();
    },
  );
  return { release: () => release() };
}

function runRecoveryCard(scope: Page | Locator): Locator {
  return scope.locator('[data-user-action-card="run-recovery"]').last();
}

/**
 * The composer laid out inside `container`.
 *
 * Every `ChatPane` portals its composer to `document.body`
 * (`chat-composer-fixed-layer` in `ChatPane.tsx`), so the side chat's composer
 * is not a DOM descendant of its tab and cannot be reached by scoping. Two
 * panes are on screen here, so pick by geometry: the one whose box sits inside
 * the container's own box.
 */
async function composerInside(page: Page, container: Locator): Promise<Locator> {
  const containerBox = await container.boundingBox();
  if (!containerBox) throw new Error('the container has no layout box');
  const composers = page.getByTestId('chat-composer');
  await expect(composers.first()).toBeVisible({ timeout: T.medium });
  const count = await composers.count();
  for (let index = 0; index < count; index += 1) {
    const box = await composers.nth(index).boundingBox();
    if (!box) continue;
    const centre = box.x + box.width / 2;
    if (centre >= containerBox.x && centre <= containerBox.x + containerBox.width) {
      return composers.nth(index);
    }
  }
  throw new Error(`no composer is laid out inside the container (${count} on screen)`);
}

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
  return messages.filter((message) => message.role === 'assistant').pop()?.runStatus ?? null;
}

async function documentLoadCount(page: Page): Promise<number> {
  return page.evaluate((key) => Number(window.sessionStorage.getItem(key) ?? '0'), LOAD_COUNTER_KEY);
}

async function createConversation(page: Page, projectId: string, title: string): Promise<string> {
  const response = await page.request.post(`/api/projects/${projectId}/conversations`, {
    data: { title },
  });
  expect(response.ok()).toBeTruthy();
  const { conversation } = (await response.json()) as { conversation: { id: string } };
  return conversation.id;
}

async function openSideChatTab(
  page: Page,
  projectId: string,
  primaryConversationId: string,
  sideConversationId: string,
) {
  const tabId = `chat:${sideConversationId}`;
  const response = await page.request.put(`/api/projects/${projectId}/tabs`, {
    data: { tabs: [tabId], active: tabId, updatedAt: Date.now() },
  });
  expect(response.ok()).toBeTruthy();
  // `loadTabs` reconciles the daemon record against a per-project localStorage
  // cache by `updatedAt`; dropping the cache leaves the daemon record as the
  // only claim, which is what a browser that never opened this project sees.
  await page.evaluate(
    (id) => window.localStorage.removeItem(`mishmash:tabs:${id}`),
    projectId,
  );
  // Deep-link the PRIMARY conversation back into the route. The side chat is
  // newer, and a project opened without a conversation segment selects the
  // newest one — which would make the tab mirror the primary chat's state
  // (`activeConversationChat` in `SideChatTab`) instead of running its own
  // `useConversationChat`.
  await page.goto(`/projects/${projectId}/conversations/${primaryConversationId}`, {
    waitUntil: 'domcontentloaded',
  });
  await expectWorkspaceReady(page);
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
  await expect(page.getByTestId('chat-composer').first()).toBeVisible();
  await expect(page.getByTestId('file-workspace')).toBeVisible();
}

async function waitForLoadingToClear(page: Page) {
  await page.getByText(APP_LOADING_TEXT).first().waitFor({ state: 'hidden', timeout: T.long });
}

async function sendPrompt(page: Page, composer: Locator, prompt: string) {
  const input = composer.getByTestId('chat-composer-input').first();
  const sendButton = composer.getByTestId('chat-send').first();
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
