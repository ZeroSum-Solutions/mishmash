// INV-3.13 — the per-tab stream budget, measured across three real app tabs.
//
// A browser allows six concurrent HTTP/1.1 connections per origin, and every
// long-lived stream a tab holds spends one of those six for as long as the tab
// stays open. Before the budget existed, a MishMash project tab held two of its
// own — the app-wide memory toast's `/api/memory/events` and the project file
// SSE — so three open tabs held all six sockets. A request that finds the pool
// full waits inside the browser and never reaches the daemon at all: it is
// invisible to daemon-side timing, and the tab that issued it simply stops
// working. Measured on this harness before the fix, the third tab never finished
// booting and its message PUT was still queued when a ceiling aborted it.
//
// The bar this case pins: with three app tabs open against one tools-dev daemon,
// the third tab boots and a message write from it completes within 10 s and
// persists. The wave's own budget for the write is 2,000 ms; 10 s is INV-3.13's
// number and the one a loaded CI runner is judged against.
//
// Background tabs. Headless Chromium reports every page `visible`, which a real
// browser does not: `Page.setWebLifecycleState('frozen')` does not change it and
// the protocol has no visibility override. This case therefore emulates the one
// signal the harness cannot produce — a tab going into the background — by
// overriding `document.visibilityState` in the two tabs behind and dispatching
// the real `visibilitychange` event. That is the only thing supplied. Every
// request, response and stream below is the app's own against the real daemon.
//
// No serial mode: the case creates its own project through the daemon HTTP API
// and its own pages, and closes the pages it opened, so it holds order
// independence under the sharded pool.

import type { ChatMessage, MessagesResponse } from '@open-design/contracts';
import type { Page } from '@playwright/test';

import { createProjectViaApi, gotoProject, putAppConfig, STORAGE_KEY } from '@/playwright/amr';
import { createFakeAgentRuntimes } from '@/playwright/fake-agents';
import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';

/** A request still in flight after this long is holding a socket, not using it. */
const LONG_LIVED_MS = 3_000;
/** INV-3.13's bar for the third tab's write. */
const MESSAGE_WRITE_BUDGET_MS = 10_000;

/**
 * The fake `claude` runtime answers this prompt by opening its turn and then
 * holding it (`e2e/lib/fake-agents.ts`, `emitClaudeHeldNoWriteRun`), which is
 * how this case gets a genuinely active daemon run for the conversation it
 * writes to. The run is started through the daemon's own `POST /api/runs` and
 * has no stored assistant row to attach to, so no tab opens a run stream for
 * it: the conversation's run is active daemon-side while the socket census
 * below stays the one three project tabs actually produce.
 */
const HOLD_OPEN_PROMPT = 'Hold the daemon run open without writing any file';

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

const BROWSER_CONFIG = {
  mode: 'daemon',
  apiKey: '',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  agentId: 'codex',
  skillId: null,
  designSystemId: null,
  onboardingCompleted: true,
};

/**
 * A long-lived stream: an SSE endpoint or a fetch-streamed feed. These are the
 * requests that hold a socket for the life of the tab, and the ones the budget
 * is about. An ordinary request that is merely slow on a loaded runner is not
 * one, which is why the assertion below counts these and not everything pending.
 */
function isStreamRequest(target: string): boolean {
  const url = new URL(target);
  return url.pathname.endsWith('/events') || url.searchParams.get('stream') === '1';
}

/** Requests this tab has held open for longer than `LONG_LIVED_MS`. */
function trackLongLivedRequests(page: Page): () => string[] {
  const inFlight = new Map<unknown, { startedAt: number; url: string }>();
  page.on('request', (request) => {
    inFlight.set(request, { startedAt: Date.now(), url: request.url() });
  });
  page.on('requestfinished', (request) => inFlight.delete(request));
  page.on('requestfailed', (request) => inFlight.delete(request));
  return () => [...inFlight.values()]
    .filter((entry) => Date.now() - entry.startedAt > LONG_LIVED_MS)
    .map((entry) => new URL(entry.url).pathname + new URL(entry.url).search);
}

/** Puts a tab into the background the way a real browser does. */
async function sendTabToBackground(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test('[P0] a third app tab boots and persists a message while two tabs sit in the background', async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(T.xlong * 2);

  await context.addInitScript(({ key, config }) => {
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, JSON.stringify(config));
  }, { key: STORAGE_KEY, config: BROWSER_CONFIG });

  const projectId = `tab-stream-budget-${testInfo.workerIndex}-${Date.now().toString(36)}`;
  const { conversationId } = await createProjectViaApi(page, projectId, 'Tab stream budget smoke');

  const opened: Page[] = [];
  const pending: Array<() => string[]> = [];
  let heldRunId: string | null = null;
  let appConfigChanged = false;
  try {
    // Two tabs already open on the project, then backgrounded, exactly as a
    // person leaves them while they work in a third.
    for (const tab of [page, await context.newPage()]) {
      opened.push(tab);
      pending.push(trackLongLivedRequests(tab));
      await gotoProject(tab, projectId);
      await sendTabToBackground(tab);
    }

    const third = await context.newPage();
    opened.push(third);
    pending.push(trackLongLivedRequests(third));

    // The bar's first half: the third tab boots at all. Before the budget, its
    // ordinary boot requests never got a socket and the workspace never
    // rendered.
    await gotoProject(third, projectId);

    // The criterion is a write that lands while this conversation's own run is
    // active, so start one on the real wire before measuring. Started here, a
    // few seconds before the write, rather than up front: the fixture holds its
    // turn for 60 s, and three tab boots on a loaded runner can spend most of
    // that window.
    await putAppConfig(third, {
      onboardingCompleted: true,
      agentId: 'claude',
      agentModels: { claude: { model: 'default', reasoning: 'default' } },
      agentCliEnv: { claude: fakeRuntimes.claude.env },
      skillId: null,
      designSystemId: null,
    });
    appConfigChanged = true;
    const created = await third.request.post('/api/runs', {
      data: {
        agentId: 'claude',
        message: HOLD_OPEN_PROMPT,
        projectId,
        conversationId,
        clientRequestId: `tab-stream-budget-${testInfo.workerIndex}-${Date.now()}`,
        skillId: null,
        designSystemId: null,
        model: 'default',
        reasoning: 'default',
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    heldRunId = ((await created.json()) as { runId: string }).runId;
    // Precondition, not the bar: the run really reached the agent, so the write
    // below lands against an active run rather than an already-dead one.
    await expect
      .poll(async () => {
        const status = await third.request.get(`/api/runs/${heldRunId}`);
        if (!status.ok()) return `http-${status.status()}`;
        return ((await status.json()) as { status: string }).status;
      }, { intervals: [250], timeout: T.long })
      .toBe('running');

    const heldPerTab = pending.map((read) => read());
    await testInfo.attach('long-lived-requests-per-tab', {
      body: JSON.stringify(heldPerTab, null, 2),
      contentType: 'application/json',
    });
    // A guard, not the trigger. A request queued inside the browser is never
    // sent, so Playwright never sees it and this count reads the same on a tree
    // without the budget as on one with it. What separates the two is the write
    // below. This line catches a future regression that holds MORE streams than
    // it should — a fourth surface subscribing app-wide, say — which the write
    // alone would not name.
    const streamsHeld = heldPerTab.flat().filter((held) => isStreamRequest(new URL(held, 'http://tab').href));
    expect(
      streamsHeld.length,
      `the three tabs must not hold the whole six-connection budget between them; held: ${JSON.stringify(heldPerTab)}`,
    ).toBeLessThan(6);

    // The bar's second half: a message write issued from inside the third tab —
    // through the browser's own connection pool, not Playwright's API context —
    // persists and answers under budget.
    const message: ChatMessage = {
      id: `tab-stream-budget-${testInfo.workerIndex}-${Date.now()}`,
      role: 'user',
      content: 'tab stream budget smoke',
      createdAt: Date.now(),
    };
    const write = await third.evaluate(async ({ budgetMs, conversation, project, body }) => {
      const controller = new AbortController();
      const ceiling = setTimeout(() => controller.abort(), budgetMs);
      const startedAt = performance.now();
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(project)}/conversations/${encodeURIComponent(conversation)}/messages/${encodeURIComponent(body.id)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );
        return { elapsedMs: Math.round(performance.now() - startedAt), status: response.status };
      } catch (error) {
        return {
          elapsedMs: Math.round(performance.now() - startedAt),
          status: 0,
          error: String(error),
        };
      } finally {
        clearTimeout(ceiling);
      }
    }, { budgetMs: MESSAGE_WRITE_BUDGET_MS, conversation: conversationId, project: projectId, body: message });

    expect(
      write,
      `the third tab's message write must answer inside ${MESSAGE_WRITE_BUDGET_MS} ms`,
    ).toMatchObject({ status: 200 });
    expect(write.elapsedMs).toBeLessThan(MESSAGE_WRITE_BUDGET_MS);

    // And it persisted: the conversation answers a contract-valid
    // MessagesResponse carrying the row the third tab wrote.
    const listed = await third.evaluate(async ({ conversation, project }) => {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(project)}/conversations/${encodeURIComponent(conversation)}/messages`,
      );
      return { status: response.status, body: (await response.json()) as MessagesResponse };
    }, { conversation: conversationId, project: projectId });

    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.messages)).toBe(true);
    expect(listed.body.messages.map((entry) => entry.id)).toContain(message.id);
  } finally {
    if (heldRunId) await page.request.post(`/api/runs/${heldRunId}/cancel`).catch(() => {});
    if (appConfigChanged) {
      await page.request.put('/api/app-config', { data: NEUTRAL_APP_CONFIG }).catch(() => {});
    }
    for (const tab of opened) {
      if (tab !== page) await tab.close().catch(() => {});
    }
  }
});
