import { APP_LOADING_TEXT } from '@/playwright/loading';
import { expect, test } from '@/playwright/suite';
import { runErrorCard } from '@/playwright/chat';
import { createFakeAgentRuntimes } from '@/playwright/fake-agents';
import { T } from '@/timeouts';
import type { Page } from '@playwright/test';

// W1F.4 red spec — the end-to-end chain.
//
// A real daemon runs a real agent process, the agent fails the way the team
// daemon's run log recorded, the daemon classifies it, and the chat the user
// actually opens must name that exact cause, the step that stopped, and whether
// their files changed. Nothing is pre-injected and no route is mocked: the only
// thing this spec supplies is the raw agent output, through the fake agent CLI
// (`e2e/lib/fake-agents.ts`, REPORTED_AGENT_FAILURE_OUTPUT). Everything asserted
// below is resolved by the daemon and carried to the browser by the production
// transport.
//
// The project and run are seeded through the production HTTP APIs
// (`POST /api/projects`, `POST /api/runs`) rather than the composer, because
// the surface under test is the alert a user meets on the chat, not the send
// path — see AGENTS.md, "Stage human verification for visible bugs".
//
// Layer split: the daemon-side classification and persistence for every one of
// these causes (plus the inactivity stall and the shutdown cancel, neither of
// which is reachable without owning the daemon's lifetime) is
// `apps/daemon/tests/run-failure-alert-facts.test.ts`; the sentence each
// carried fact becomes is `apps/web/tests/components/ChatPane.failure-alert.test.tsx`.

const STORAGE_KEY = 'mishmash:config';

let fakeRuntimes: Awaited<ReturnType<typeof createFakeAgentRuntimes>>;

// The endpoint-unreachable case is only that case when the run really was
// pointed at a custom endpoint, so the claude env carries one that refuses.
const UNREACHABLE_ENDPOINT = 'http://127.0.0.1:1';

interface ReportedCause {
  label: string;
  prompt: string;
  /** The alert's title, in the shipped English copy. */
  title: string;
  /** The lifecycle stage the daemon reports, as the alert's step marker. */
  stage: string;
  step: string;
  /** Part of the daemon's own error text, which the alert shows verbatim. */
  detail: string;
}

const REPORTED_CAUSES: ReportedCause[] = [
  {
    label: 'the machine slept mid-response',
    prompt: 'Return the reported sleep-drop failure',
    title: 'Connection dropped',
    stage: 'child_close',
    step: 'It failed while the agent was responding.',
    detail: 'went to sleep mid-response',
  },
  {
    label: 'the configured endpoint refused the connection',
    prompt: 'Return the reported endpoint-unreachable failure',
    title: 'Connection dropped',
    stage: 'first_token_wait',
    step: 'It failed while waiting for the first response.',
    detail: 'could not reach the configured custom Anthropic endpoint',
  },
  {
    label: 'the provider refused the request for exceeded quota',
    prompt: 'Return the reported quota failure',
    title: 'Quota exhausted',
    stage: 'session_init',
    step: 'It failed while opening the agent session.',
    detail: 'quota',
  },
  {
    label: 'the user denied a write_file permission prompt',
    prompt: 'Return the reported denied-permission failure',
    title: 'Blocked by a permission check',
    stage: 'tool_execution',
    step: 'It failed while the agent was running a tool.',
    detail: 'user denied permission for write_file',
  },
];

test.beforeAll(async () => {
  fakeRuntimes = await createFakeAgentRuntimes(['claude']);
});

test.beforeEach(async ({ page }) => {
  test.setTimeout(T.xlong);
  await configureClaudeRuntime(page);
  await seedBrowserConfig(page);
});

test.afterEach(async ({ page }) => {
  await resetDaemonAppConfig(page);
});

for (const cause of REPORTED_CAUSES) {
  test(`[P1] the failure alert names the cause, the step and the file-change state when ${cause.label}`, async ({ page }) => {
    const { projectId, conversationId } = await createProjectViaApi(page, `alert-${slug(cause.prompt)}`);
    await runToTerminal(page, { projectId, conversationId, message: cause.prompt, expected: 'failed' });

    await openProjectChat(page, projectId);

    const card = runErrorCard(page);
    await expect(card).toBeVisible({ timeout: T.medium });
    // The exact name the user reads — not merely "a title other than the
    // generic one", which three of these causes satisfied while naming the
    // wrong thing.
    await expect(card).toContainText(cause.title);
    await expect(card).not.toContainText('Task failed');
    await expect(card.locator('[data-run-failure-step]')).toHaveAttribute(
      'data-run-failure-step',
      cause.stage,
    );
    await expect(card.locator('[data-run-failure-step]')).toHaveText(cause.step);
    await expect(card.locator('[data-run-failure-files]')).toHaveAttribute(
      'data-run-failure-files',
      '0',
    );
    await expect(card.locator('[data-run-failure-files]')).toHaveText('No files were changed.');

    // The daemon's own words for what happened stay under the title.
    await expect(card).toContainText(cause.detail);
  });
}

test('[P1] the chat stays silent about a Stop the user pressed', async ({ page }) => {
  const { projectId, conversationId } = await createProjectViaApi(page, 'alert-user-stop');
  const runId = await startRun(page, {
    projectId,
    conversationId,
    message: 'Hold the daemon run open until canceled',
  });
  await expect
    .poll(async () => (await runStatus(page, runId)).status, { timeout: T.medium })
    .not.toBe('queued');

  const cancel = await page.request.post(`/api/runs/${runId}/cancel`);
  expect(cancel.ok()).toBeTruthy();
  await expect
    .poll(async () => (await runStatus(page, runId)).status, { timeout: T.medium })
    .toBe('canceled');

  await openProjectChat(page, projectId);
  // The user ended this turn themselves. Reporting their own action back to
  // them as a failure is the regression this guards.
  await expect(page.getByTestId('chat-composer-input')).toBeVisible();
  await expect(runErrorCard(page)).toHaveCount(0);
});

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function configureClaudeRuntime(page: Page) {
  const response = await page.request.put('/api/app-config', {
    data: {
      onboardingCompleted: true,
      agentId: 'claude',
      agentModels: { claude: { model: 'default', reasoning: 'default' } },
      agentCliEnv: {
        claude: { ...fakeRuntimes.claude.env, ANTHROPIC_BASE_URL: UNREACHABLE_ENDPOINT },
      },
      skillId: null,
      designSystemId: null,
    },
  });
  expect(response.ok()).toBeTruthy();
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

async function seedBrowserConfig(page: Page) {
  await page.addInitScript(({ key, env }) => {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        mode: 'daemon',
        apiKey: '',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-5',
        agentId: 'claude',
        skillId: null,
        designSystemId: null,
        onboardingCompleted: true,
        agentModels: { claude: { model: 'default', reasoning: 'default' } },
        agentCliEnv: { claude: env },
      }),
    );
  }, {
    key: STORAGE_KEY,
    env: { ...fakeRuntimes.claude.env, ANTHROPIC_BASE_URL: UNREACHABLE_ENDPOINT },
  });
}

async function createProjectViaApi(page: Page, name: string) {
  const projectId = `${name}-${Date.now()}`.replace(/[^A-Za-z0-9._-]/g, '-');
  const response = await page.request.post('/api/projects', {
    data: {
      id: projectId,
      name,
      skillId: null,
      designSystemId: null,
      pendingPrompt: null,
      metadata: { kind: 'prototype' },
      skipDiscoveryBrief: true,
    },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { conversationId: string };
  return { projectId, conversationId: body.conversationId };
}

async function startRun(
  page: Page,
  options: { projectId: string; conversationId: string; message: string },
): Promise<string> {
  const requestId = `alert-cause-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = await page.request.post('/api/runs', {
    data: {
      agentId: 'claude',
      message: options.message,
      currentPrompt: options.message,
      projectId: options.projectId,
      conversationId: options.conversationId,
      assistantMessageId: `assistant-${requestId}`,
      clientRequestId: requestId,
      skillId: null,
      designSystemId: null,
      model: 'default',
      reasoning: 'default',
    },
  });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { runId: string }).runId;
}

async function runStatus(page: Page, runId: string): Promise<{ status: string }> {
  const response = await page.request.get(`/api/runs/${runId}`);
  if (!response.ok()) return { status: `http-${response.status()}` };
  return (await response.json()) as { status: string };
}

async function runToTerminal(
  page: Page,
  options: { projectId: string; conversationId: string; message: string; expected: string },
) {
  const runId = await startRun(page, options);
  await expect
    .poll(async () => (await runStatus(page, runId)).status, { timeout: T.long })
    .toBe(options.expected);
}

async function openProjectChat(page: Page, projectId: string) {
  await page.goto(`/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
  await page.getByText(APP_LOADING_TEXT).first().waitFor({ state: 'hidden', timeout: T.long });
  await expect(page.getByTestId('chat-composer')).toBeVisible({ timeout: T.medium });
}
