// W2H.4 red spec (CANVAS-6 after D-11): the preview's runtime-attached-script
// notice must appear only when the script really cannot load.
//
// W2.5 shipped `htmlBuildsScriptAtRuntime` plus a banner that tells the user
// the sandbox blocked a script the artifact attached at runtime. That was true
// when it landed: the preview iframes are sandboxed without `allow-same-origin`,
// so the script GET carried `Sec-Fetch-Site: cross-site` with no `Origin` and
// the shared `/api` origin gate answered 403.
//
// W2G.4b (decision D-11, option B) then admitted exactly that shape for project
// raw assets — `'script'` is one of the browser-classified destinations the
// exception accepts. So the script loads now, in both preview transports, while
// the banner still says it cannot. This spec pins the user-visible half of that
// contradiction: the artifact's own DOM side effect proves the script ran, and
// the banner must be absent because it did.
//
// Both transports are covered because they resolve the script URL differently
// and were not guaranteed to agree: URL-load serves the document from the raw
// route and the browser resolves `boot.js` against it, while srcDoc holds an
// opaque `about:srcdoc` document whose `<base href>` names the same raw route.
import { expect, test } from '@/playwright/suite';
import { APP_LOADING_TEXT } from '@/playwright/loading';
import { T } from '@/timeouts';
import type { Page } from '@playwright/test';

const PAGE = 'runtime-script.html';
const BOOT = 'boot.js';
// The whole oracle: a DOM side effect only the linked file can produce. If the
// preview refuses the script, `#marker` keeps its authored text.
const BOOT_JS = "document.getElementById('marker').textContent = 'ran';";
const MARKER_BEFORE = 'not-run';
const MARKER_AFTER = 'ran';

// Five `<section>` elements put the page over
// COMPOSITION_METRICS_SECTION_THRESHOLD, the one disqualifier in
// `shouldUrlLoadHtmlPreview` that is about page shape rather than about
// scripts. It is how this spec reaches the srcDoc transport without changing
// the script shape under test — `?forceInline=1` cannot be used, because the
// workspace route rewrites its own URL and drops the query.
const SECTIONS = '<section>a</section><section>b</section><section>c</section><section>d</section><section>e</section>';

// FileViewer keeps both preview transports mounted and moves this one testid
// onto whichever is active, so it always names the frame the user is looking at.
const ACTIVE_PREVIEW = '[data-testid="artifact-preview-frame"]';
const RUNTIME_SCRIPT_NOTICE = 'preview-runtime-script-notice';

const CONFIG_STORAGE_KEY = 'mishmash:config';

test.describe.configure({ timeout: T.xlong * 3 });

// Each case performs its own complete setup. The tools-dev runtime is shared
// across a Playwright worker while the browser context is not, so both halves
// of "onboarding is done" are seeded here rather than inherited from whichever
// case happened to run first.
test.beforeEach(async ({ page }) => {
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
});

test('[P0] the URL-loaded preview runs a runtime-attached project script and shows no blocked-script notice', async ({ page }) => {
  const projectId = await seedRuntimeScriptPage(page, 'w2h4-url', { manySections: false });

  await openWorkspaceTab(page, projectId, PAGE);

  await expect(page.locator(ACTIVE_PREVIEW)).toHaveAttribute('src', /\/raw\/runtime-script\.html/, { timeout: T.long });
  await expectRuntimeScriptRan(page);
  await expectNoBlockedScriptNotice(page);
});

test('[P0] the srcDoc preview runs a runtime-attached project script and shows no blocked-script notice', async ({ page }) => {
  const projectId = await seedRuntimeScriptPage(page, 'w2h4-srcdoc', { manySections: true });

  await openWorkspaceTab(page, projectId, PAGE);

  await expect
    .poll(
      async () => page.locator(ACTIVE_PREVIEW).evaluate((node) => node.hasAttribute('srcdoc')),
      { message: 'the active preview never became the srcDoc transport', timeout: T.long },
    )
    .toBe(true);
  await expectRuntimeScriptRan(page);
  await expectNoBlockedScriptNotice(page);
});

/**
 * The positive control: the linked file executed inside the preview. Asserted
 * before the notice so a preview that genuinely cannot load the script fails
 * here — naming the transport — instead of failing the notice assertion and
 * reading as a copy problem.
 */
async function expectRuntimeScriptRan(page: Page) {
  const marker = page.frameLocator(ACTIVE_PREVIEW).locator('#marker');
  await expect(marker).toBeAttached({ timeout: T.long });
  await expect(marker, `the preview never ran ${BOOT}: #marker kept its authored text`)
    .toHaveText(MARKER_AFTER, { timeout: T.long });
}

/**
 * The notice claims the sandbox blocked the script the assertion above just
 * watched run. It must not be on screen. `toHaveCount(0)` after the marker has
 * settled, so a banner that mounts and then clears cannot pass by timing.
 */
async function expectNoBlockedScriptNotice(page: Page) {
  await expect(
    page.getByTestId(RUNTIME_SCRIPT_NOTICE),
    'the preview told the user the sandbox blocked a script that had already run',
  ).toHaveCount(0);
}

function runtimeScriptPageHtml(manySections: boolean) {
  return '<!doctype html><html><head><title>Runtime script page</title></head><body><main>'
    + '<h1>Runtime attached script</h1>'
    + `<div id="marker">${MARKER_BEFORE}</div>`
    + (manySections ? SECTIONS : '')
    + '</main>'
    // No literal `<script src>` anywhere: that tag is what `htmlNeedsSandboxShim`
    // and the srcDoc asset inliner both read, and its absence is the shape this
    // spec is about.
    + `<script>\nvar s = document.createElement("script");\ns.src = "${BOOT}";\ndocument.head.appendChild(s);\n</script>`
    + '</body></html>';
}

async function seedRuntimeScriptPage(page: Page, slug: string, options: { manySections: boolean }) {
  const projectId = `${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await page.request.post('/api/projects', {
    data: {
      designSystemId: null,
      id: projectId,
      metadata: { kind: 'prototype' },
      name: 'Preview runtime script',
      skillId: null,
    },
  });
  expect(created.ok(), `create project: ${await created.text()}`).toBeTruthy();
  const boot = await page.request.post(`/api/projects/${projectId}/files`, {
    data: { content: BOOT_JS, name: BOOT },
  });
  expect(boot.ok(), `seed ${BOOT}: ${await boot.text()}`).toBeTruthy();
  const html = await page.request.post(`/api/projects/${projectId}/files`, {
    data: { content: runtimeScriptPageHtml(options.manySections), name: PAGE },
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
