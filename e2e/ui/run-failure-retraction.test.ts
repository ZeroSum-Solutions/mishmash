import { runErrorCard } from '@/playwright/chat';
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

// W1F.1 browser-level regression: a mounted chat client may not keep painting a
// failure the run itself retracted.
//
// The client cannot tell a dead run from a dead connection. When the event
// stream it REATTACHED to (after a reload, onto a run still in flight) answers
// non-OK, `consumeDaemonRun` surfaces a plain `daemon <status>` error with no
// disconnect code (apps/web/src/providers/daemon.ts:1097), and ProjectView's
// reattach `onError` both marks its own assistant row `failed` and raises the
// chat pane's own run-error string. `ChatPane` paints the `run-recovery` alert
// ("Task failed") from EITHER carrier, so reconciling only the row leaves the
// alert on screen for a turn the daemon recorded as succeeded.
//
// The same `onError` schedules exactly one conversation refresh 150ms later
// (ProjectView.tsx -> scheduleConversationMessageRefresh ->
// refreshConversationMessagesFromServer). That refresh is how the run's
// authoritative terminal reaches an already-mounted client, and it is the seam
// the fix reconciles. This spec drives that loop through production HTTP only.
//
// Ordering is forced at the transport, not faked in state:
//   1. the reattached stream request is HELD until the daemon's own
//      /api/runs/:id record reports `succeeded` — so the run's terminal is
//      already authoritative, and the daemon has already stamped the stored
//      assistant row (`reconcileAssistantMessageOnRunEnd`), before the client
//      ever sees a transport failure;
//   2. then, and only then, it is answered 503, which is what makes the client
//      paint the alert for a turn that succeeded;
//   3. the client's own post-error refresh is HELD until this spec has observed
//      the alert on screen, because on a fixed build the alert's whole life is
//      the ~150ms between those two events.
// Nothing writes message state from the test: the failed row the client
// persists is its own production PUT, and the daemon's write-side hold
// (`holdTerminalRunStatusOnMessageWrite`) is what keeps the stored row on its
// terminal.
test('[P0] a dropped reattached stream leaves no failure alert once the run reaches succeeded', async ({ page }) => {
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
  let heldReattachedStream = false;
  let reattachedStreamFailed = false;
  let releaseRefresh: () => void = () => {};
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });

  // The run's event stream. Only the first request the RELOADED document makes
  // is treated as the reattach; every other one — including the pre-reload
  // page's own live-stream reconnect to the same URL — passes through
  // untouched.
  await page.route(
    (url) => /^\/api\/runs\/[^/]+\/events$/.test(url.pathname),
    async (route) => {
      if (heldReattachedStream || documentsSeen < holdFromDocument) {
        await route.continue();
        return;
      }
      heldReattachedStream = true;
      await waitForDaemonRunStatus(page, runId, 'succeeded');
      reattachedStreamFailed = true;
      await route.fulfill({ status: 503, body: '' });
    },
  );

  // The conversation refresh the reattach `onError` schedules. Held only after
  // the stream has failed, so the reload's own message load is untouched.
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

  holdFromDocument = documentsSeen + 1;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectWorkspaceReady(page);

  const failureAlert = runErrorCard(page);
  await expect(failureAlert, 'the dropped reattached stream must paint the run-recovery alert')
    .toBeVisible({ timeout: 120_000 });
  await expect(failureAlert).toContainText('Task failed');

  // Preconditions for the assertion below, asserted separately so a failure
  // names its own cause: the run really did succeed, the stored row really is
  // on that terminal (so the held refresh carries a succeeded row), and the
  // alert is up in the document that is about to receive it.
  expect(await daemonRunStatus(page, runId), 'precondition: the run must have succeeded').toBe('succeeded');
  expect(
    await storedAssistantRunStatus(page, projectId, conversationId),
    'precondition: the daemon must hold the stored assistant row on the run terminal',
  ).toBe('succeeded');
  const documentLoads = await documentLoadCount(page);

  releaseRefresh();

  // The alert must leave the DOM on the authoritative terminal alone: no page
  // reload, no manual refetch, nothing but the refresh the client scheduled
  // for itself.
  await expect(failureAlert, 'the retracted run failure must leave the DOM')
    .toHaveCount(0, { timeout: T.long });
  expect(await documentLoadCount(page), 'the alert must clear without a page reload').toBe(documentLoads);
  expect(await storedAssistantRunStatus(page, projectId, conversationId)).toBe('succeeded');
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
