import { SEND_PAUSED_TEXT } from '@/playwright/chat';
import { createFakeAgentRuntimes } from '@/playwright/fake-agents';
import type { FakeAgentId } from '@/playwright/fake-agents';
import { APP_LOADING_TEXT } from '@/playwright/loading';
import { openNewProjectModal as openNewProjectModalFromProjects } from '@/playwright/rail';
import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';
import type { Locator, Page, Response } from '@playwright/test';

// W1L.2 — a Side Chat MOUNTED while its own run is active.
//
// W1K.3 taught `useConversationChat` to pause Send for any active run of its
// own: the composer is disabled while a persisted assistant row still reads
// `queued`/`running` (`useConversationChat.ts`, `awaitingActiveRunAttach`). The
// pause is correct; its only writer was not. The mount effect lists the
// conversation once and this pane has no reattach of any kind — no stream, no
// recoverable-run pass, no conversation refresh — so a Side Chat that mounts
// onto a run already in flight reads that row exactly once. The daemon then
// reaches the run's terminal and stamps the stored row with it
// (`followRunTerminalOnMessage`), while the mounted pane keeps showing the
// stale active row and keeps Send disabled until something remounts it.
//
// The whole shape is forced on the real wire: a real daemon on this worker's
// tools-dev runtime, a real fake-agent CLI that holds the turn for 15 s before
// succeeding (`e2e/lib/fake-agents.ts`, the slow-reload fixture), and the
// product's own reload as the remount. Nothing here writes message state, mocks
// a route, or seeds a run: the row under test is the daemon's own.

const STORAGE_KEY = 'mishmash:config';
const LOAD_COUNTER_KEY = 'od-e2e-document-loads';
// The fake runtime holds this prompt's turn for 15 s and then answers it
// (`e2e/lib/fake-agents.ts`), which is the window this spec remounts the Side
// Chat inside.
const RUN_PROMPT = 'Create a slow reload deterministic smoke artifact';
// What the fake runtime answers that prompt with. Asserted after the terminal
// so a build that merely flips the row's status — leaving a content-less turn —
// cannot pass as a build that refreshed the conversation.
const RUN_ANSWER = 'I stayed attached after the reload';
// What the user types while the run is active. A draft is required to see the
// pause at all: the Send button is also disabled on an empty composer, so an
// empty one cannot tell "paused" from "nothing to send".
const PAUSED_DRAFT = 'A follow-up turn typed while the mounted run is active';

let fakeRuntimes: Awaited<ReturnType<typeof createFakeAgentRuntimes>>;

test.beforeAll(async () => {
  fakeRuntimes = await createFakeAgentRuntimes();
});

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000);
  await resetDaemonAppConfig(page);
  // Counts documents, not navigations, and survives them: each load bumps a
  // sessionStorage tally, so the assertion below can prove Send was re-enabled
  // in the SAME document that mounted onto the active run. Top-level documents
  // only — `addInitScript` also runs in the artifact preview iframe, which
  // shares this origin's sessionStorage.
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

test('[P0] a Side Chat mounted while its own run is active re-enables Send at the terminal', async ({
  page,
}) => {
  await page.goto('/');
  await createProject(page, 'Side chat mount during run smoke');
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

  const runResponse = await sendPrompt(page, await composerInside(page, sideChat), RUN_PROMPT);
  const { runId } = (await runResponse.json()) as { runId: string };

  // The remount, through the product's own reload. The run is still held by the
  // fake CLI, so the conversation this document mounts onto carries an ACTIVE
  // assistant row and no stream is attached to it.
  expect(
    await daemonRunStatus(page, runId),
    'precondition: the run must still be in flight when the tab remounts',
  ).toMatch(/^(queued|running)$/);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectWorkspaceReady(page);

  const remountedSideChat = page.getByTestId('side-chat-tab');
  await expect(remountedSideChat, 'the side chat tab must come back after the reload').toBeVisible({
    timeout: T.long,
  });
  const composer = await composerInside(page, remountedSideChat);
  const sendButton = composer.getByTestId('chat-send').first();
  const input = composer.getByTestId('chat-composer-input').first();
  await expect(input).toBeVisible({ timeout: T.medium });
  await input.click();
  await input.fill(PAUSED_DRAFT);
  await expect(input).toHaveText(PAUSED_DRAFT);
  await expect(
    sendButton,
    'precondition: the mounted active row must hold the composer',
  ).toBeDisabled({ timeout: T.medium });
  await expect(
    composer.getByText(SEND_PAUSED_TEXT).first(),
    'precondition: the pause must say so',
  ).toBeVisible({ timeout: T.medium });

  // Everything below happens inside this one document.
  const documentLoads = await documentLoadCount(page);

  await waitForDaemonRunStatus(page, runId, 'succeeded');
  expect(
    await storedAssistantRunStatus(page, projectId, sideConversationId),
    'precondition: the daemon must hold the stored assistant row on the run terminal',
  ).toBe('succeeded');

  await expect(
    sendButton,
    'the composer must be usable again once the daemon reaches the terminal',
  ).toBeEnabled({ timeout: T.long });
  await expect(
    composer.getByText(SEND_PAUSED_TEXT),
    'the paused sentence must not outlive the pause',
  ).toHaveCount(0, { timeout: T.long });
  await expect(
    remountedSideChat.getByText(RUN_ANSWER).first(),
    'the settled turn must show the answer the run delivered',
  ).toBeVisible({ timeout: T.long });
  expect(
    await documentLoadCount(page),
    'Send must come back without a remount',
  ).toBe(documentLoads);
});

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
