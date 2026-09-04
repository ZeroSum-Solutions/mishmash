// W2I.2 — a preview whose document arrives before the watchdog does is still
// asked to prove it painted.
//
// The watchdog never accepts a frame's `load` as proof; it asks the document to
// report itself, and it only asks a document it knows is in the frame. It
// learns that from the incoming `load`, or from the host, which saw the frame
// load it. A srcDoc document is inline bytes: it can commit between the render
// that handed it to the frame and the passive effect that installs the
// watchdog, so the watchdog's own `load` listener never fires and the host is
// the only one left who can answer.
//
// The reviewer of 2H.1b asked for this case in a real browser, and it has to be
// one: the gap it turns on is React's commit-to-passive-effect window against
// Chromium's actual srcDoc load timing, and jsdom cannot schedule either. The
// deterministic version of the race — the `load` placed inside that window by
// hand — is `apps/web/tests/components/preview-committed-document-fast-load.test.tsx`.
//
// The oracle is the protocol's own token. The host mints one per navigation and
// discloses it ONLY to a document it knows has committed; the producer echoes
// whatever it was last asked with (`rememberToken` ignores an ask that carries
// none, which is how the zoom-fit measurement stays out of it). So a report
// carrying a non-empty token is the frame saying "the watchdog asked me" —
// exactly the disclosure that goes missing when the host's answer is stale.

import type { Page } from '@playwright/test';

import { APP_LOADING_TEXT } from '@/playwright/loading';
import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';

const PAGE = 'tiny.html';
const HEADING = 'Tiny artifact';
const REPORT = 'od:preview-content-size';

// FileViewer keeps both preview transports mounted and moves this testid onto
// whichever is active, so it always names the frame the user is looking at.
const ACTIVE_PREVIEW = '[data-testid="artifact-preview-frame"]';
const NO_RENDER_NOTICE = 'preview-no-render-notice';

const CONFIG_STORAGE_KEY = 'mishmash:config';

// Five sections put the page over COMPOSITION_METRICS_SECTION_THRESHOLD, which
// is the disqualifier in `shouldUrlLoadHtmlPreview` that turns on page SHAPE
// rather than on page weight. It selects the srcDoc transport while leaving the
// document a few hundred bytes — which is the point: it loads immediately.
const TINY_HTML =
  '<!doctype html><html><head><title>Tiny</title></head><body>'
  + `<h1>${HEADING}</h1>`
  + '<section>a</section><section>b</section><section>c</section>'
  + '<section>d</section><section>e</section>'
  + '</body></html>';

test.describe.configure({ timeout: T.xlong });

test('[P1] a srcDoc preview that loads before the watchdog installs is still asked to report', async ({ page }) => {
  // Recorded before anything navigates, so no report can be missed. The
  // producer posts to `window.parent`, which is this page.
  await page.addInitScript((reportType: string) => {
    const seen: Array<string> = [];
    (window as unknown as { __odSeenPaintTokens: Array<string> }).__odSeenPaintTokens = seen;
    window.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { type?: string; token?: unknown } | null;
      if (data?.type !== reportType) return;
      seen.push(typeof data.token === 'string' ? data.token : '');
    });
  }, REPORT);

  await seedDaemonConfig(page);
  const projectId = await seedTinyPage(page);

  await openWorkspaceTab(page, projectId, PAGE);

  await expect
    .poll(
      async () => page.locator(ACTIVE_PREVIEW).evaluate((node) => node.hasAttribute('srcdoc')),
      { message: 'the active preview never became the srcDoc transport', timeout: T.long },
    )
    .toBe(true);

  // The positive control: this document really did render, so a watchdog that
  // reports otherwise is reporting a healthy preview as broken.
  await expect(page.frameLocator(ACTIVE_PREVIEW).getByText(HEADING)).toBeVisible({ timeout: T.long });

  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          (window as unknown as { __odSeenPaintTokens?: Array<string> }).__odSeenPaintTokens?.some(
            (token) => token.length > 0,
          ) ?? false,
        ),
      {
        message:
          'no paint report carried a host token: the watchdog never disclosed to this document, '
          + 'so every report it makes is thrown away as unsolicited',
        timeout: T.long,
      },
    )
    .toBe(true);

  await expect(
    page.getByTestId(NO_RENDER_NOTICE),
    'the preview told the user it did not render a document that is on screen',
  ).toHaveCount(0);
});

async function seedDaemonConfig(page: Page) {
  const response = await page.request.put('/api/app-config', {
    data: {
      agentId: 'codex',
      agentModels: { codex: { model: 'default', reasoning: 'default' } },
      designSystemId: null,
      onboardingCompleted: true,
      skillId: null,
    },
  });
  expect(response.ok(), `configure the daemon: ${await response.text()}`).toBeTruthy();
  await page.addInitScript(({ key }) => {
    window.localStorage.setItem(key, JSON.stringify({
      agentId: 'codex',
      agentModels: { codex: { model: 'default', reasoning: 'default' } },
      designSystemId: null,
      mode: 'daemon',
      model: 'default',
      onboardingCompleted: true,
      skillId: null,
    }));
  }, { key: CONFIG_STORAGE_KEY });
}

async function seedTinyPage(page: Page) {
  const projectId = `w2i2-fast-srcdoc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await page.request.post('/api/projects', {
    data: {
      designSystemId: null,
      id: projectId,
      metadata: { kind: 'prototype' },
      name: 'Fast srcDoc preview',
      skillId: null,
    },
  });
  expect(created.ok(), `create project: ${await created.text()}`).toBeTruthy();
  const html = await page.request.post(`/api/projects/${projectId}/files`, {
    data: { content: TINY_HTML, name: PAGE },
  });
  expect(html.ok(), `seed ${PAGE}: ${await html.text()}`).toBeTruthy();
  return projectId;
}

async function openWorkspaceTab(page: Page, projectId: string, tabId: string) {
  await page.goto(
    `/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(tabId)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.getByText(APP_LOADING_TEXT).first().waitFor({ state: 'hidden', timeout: T.long });
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve MishMash' });
  if (await privacyDialog.isVisible()) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
    await expect(privacyDialog).toHaveCount(0);
  }
  await expect(page.getByTestId('file-workspace')).toBeVisible({ timeout: T.long });
}
