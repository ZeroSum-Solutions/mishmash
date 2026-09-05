// W2K.2 red spec (FU-31 / D-22): a sandboxed srcdoc preview must be able to
// read a sibling file of its own project AND must never fail silently.
//
// Driven use on 2026-09-05 (project 61059571) showed a multi-file artifact
// whose entry HTML loads `data.json` sitting on "Loading store data…" forever
// under the srcdoc preview, with no `preview-error` anomaly and no visible
// cause; the same files over `python3 -m http.server` rendered in 6 s.
//
// The audit's suspect was the daemon's origin gate refusing the scripted
// fetch. It does not: the recorded wire (see the track proof file) is
// `GET /api/projects/:id/raw/data.json`, `Origin: null`,
// `Sec-Fetch-Dest: empty`, `Sec-Fetch-Mode: cors`,
// `Sec-Fetch-Site: cross-site` → 200 with `Access-Control-Allow-Origin: *`.
// The sibling read already works. What kills the artifact is the NEXT line of
// its boot function: the srcdoc document is sandboxed without
// `allow-same-origin`, so its origin is opaque, while `buildSrcdoc` states the
// project asset base (`withProjectAssetBaseHref`) that the sibling fetch needs
// — so `history.replaceState(null, '', '#/overview')` resolves to an
// `http://…/raw/` URL and throws `SecurityError`. The real artifact's
// `app.js:617-627` runs exactly that sequence: `await fetch('data.json')`,
// render, then a hash-router bootstrap. The throw rejects the boot promise and
// nothing reports it, because the preview document's uncaught failures never
// reach the host (`observability/error-tracking.ts` listens on the parent
// window only).
//
// So this spec pins the two halves the criterion names:
//   1. the two-file artifact reaches its own application-ready signal — not a
//      paint report, the artifact's own "I finished booting" marker;
//   2. a sibling fetch that IS refused (a path escaping the project's raw
//      tree) still gets refused AND raises a named `preview-error` anomaly
//      within 10 s.
//
// The refusal STATUS is asserted where a browser can see it — the daemon spec
// `apps/daemon/tests/preview-sibling-fetch-origin.test.ts`, which replays the
// recorded header set through the real production middleware. A refused
// subresource never reaches the page: Chrome reports it to the document only
// as a rejected fetch.
import { expect, test } from '@/playwright/suite';
import { APP_LOADING_TEXT } from '@/playwright/loading';
import { T } from '@/timeouts';
import type { Page } from '@playwright/test';

// FileViewer keeps both preview transports mounted and moves this testid onto
// whichever is active, so it always names the frame the user is looking at.
const ACTIVE_PREVIEW = '[data-testid="artifact-preview-frame"]';

const READY_PAGE = 'index.html';
const REFUSED_PAGE = 'escape.html';
const DATA_FILE = 'data.json';
const DATA_LABEL = '14 stores loaded';
// Escapes the project's own raw-file tree into its JSON file-list route, so
// the daemon's `/api` origin gate has no preview scope to admit it under and
// answers 403. Relative, exactly as an artifact would write it.
const ESCAPING_REF = '../files';

const CONFIG_STORAGE_KEY = 'mishmash:config';

// The srcdoc transport has to be the one under test, so the fixture carries
// the multi-section shape that disqualifies the URL-load path
// (`htmlLooksMeasurableForCompositionMetrics`, five sections or more). Every
// case additionally asserts the active frame really is the srcdoc one.
const SECTIONS = [1, 2, 3, 4, 5, 6]
  .map((n) => `<section id="s${n}"><h2>Section ${n}</h2><p>Store ${n} summary.</p></section>`)
  .join('');

function artifactHtml(screenText: string, script: string) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Operations</title></head>'
    + `<body><main><div id="screen">${screenText}</div>${SECTIONS}</main>`
    + `<script src="${script}"></script></body></html>`;
}

const READY_HTML = artifactHtml('Loading store data…', 'app.js');
const REFUSED_HTML = artifactHtml('Loading store data…', 'escape.js');

// Same boot shape as the real artifact: read the sibling data file, render it,
// then bootstrap the hash router.
const READY_JS = `(function () {
  'use strict';
  var screenEl = document.getElementById('screen');
  async function boot() {
    var res = await fetch('${DATA_FILE}', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    screenEl.textContent = data.label;
    if (!location.hash) history.replaceState(null, '', '#/overview');
    screenEl.setAttribute('data-app-ready', 'true');
  }
  boot();
})();`;

// No catch, exactly like the real artifact's optional-data path: a refused
// sibling read leaves the page on its loading copy and tells the user nothing.
const REFUSED_JS = `(function () {
  'use strict';
  fetch('${ESCAPING_REF}').then(function (res) {
    document.getElementById('screen').textContent = 'unexpectedly served: ' + res.status;
  });
})();`;

test.describe.configure({ timeout: T.xlong * 3 });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, JSON.stringify({
      agentId: 'codex',
      designSystemId: null,
      mode: 'daemon',
      model: 'default',
      onboardingCompleted: true,
      skillId: null,
    }));
  }, CONFIG_STORAGE_KEY);
});

test('[P0] a srcdoc preview reads its sibling project file and the artifact reaches ready', async ({ page }) => {
  const projectId = await seedProject(page, 'w2k2-ready');
  await seedFile(page, projectId, DATA_FILE, JSON.stringify({ label: DATA_LABEL }));
  await seedFile(page, projectId, 'app.js', READY_JS);
  await seedFile(page, projectId, READY_PAGE, READY_HTML);

  await openWorkspaceTab(page, projectId, READY_PAGE);
  await expectSrcdocTransport(page);

  const screen = page.frameLocator(ACTIVE_PREVIEW).locator('#screen');
  await expect(screen).toBeAttached({ timeout: T.long });
  // The artifact's OWN ready marker, set as the last statement of its boot
  // function. A paint report would be green here even when boot died: the
  // shell and its sections render either way.
  await expect(screen, 'the artifact never finished booting after its sibling data file loaded')
    .toHaveAttribute('data-app-ready', 'true', { timeout: T.long });
  await expect(screen).toHaveText(DATA_LABEL);
});

test('[P0] a refused sibling fetch raises a named preview-error anomaly within 10 s', async ({ page }) => {
  const projectId = await seedProject(page, 'w2k2-refused');
  await seedFile(page, projectId, DATA_FILE, JSON.stringify({ label: DATA_LABEL }));
  await seedFile(page, projectId, 'escape.js', REFUSED_JS);
  await seedFile(page, projectId, REFUSED_PAGE, REFUSED_HTML);

  await openWorkspaceTab(page, projectId, REFUSED_PAGE);
  await expectSrcdocTransport(page);
  const screen = page.frameLocator(ACTIVE_PREVIEW).locator('#screen');
  await expect(screen).toBeAttached({ timeout: T.long });

  await expect
    .poll(async () => (await previewErrors(page, projectId))
      .filter((row) => row.detail?.cause === 'subresource-refused')
      .map((row) => row.summary), {
      message:
        'the preview refused a sibling fetch and filed no named preview-error: a silent failure is exactly'
        + ' what the wave-2 bar forbids',
      timeout: 10_000,
    })
    .toEqual([expect.stringContaining('Preview of escape.html reported a refused request')]);

  // The refusal itself is unchanged: nothing outside the project's raw tree is
  // served to the preview, so the page never reports a served status.
  await expect(screen).not.toContainText('unexpectedly served');
});

/**
 * The `preview-error` rows this project produced.
 *
 * Matched on `projectId` rather than on the URL in the summary: the anomaly log
 * redacts what looks like personal data on write, and a project id carrying a
 * millisecond timestamp is redacted as a phone number.
 */
async function previewErrors(page: Page, projectId: string) {
  const response = await page.request.get('/api/anomalies?kind=preview-error&limit=200');
  if (!response.ok()) return [];
  const { anomalies } = (await response.json()) as {
    anomalies: Array<{ detail?: { cause?: string; filePath?: string }; projectId?: string; summary: string }>;
  };
  return anomalies.filter((row) => row.projectId === projectId);
}

/**
 * The case is only meaningful on the srcdoc transport: the URL-load iframe
 * serves the document from the raw route, whose own CSP carries
 * `connect-src 'none'`, so a scripted sibling fetch is blocked in the page and
 * never reaches the daemon at all.
 */
async function expectSrcdocTransport(page: Page) {
  await expect(page.locator(ACTIVE_PREVIEW), 'the preview did not mount on the srcdoc transport')
    .toHaveAttribute('data-od-render-mode', 'srcdoc', { timeout: T.long });
}

async function seedProject(page: Page, slug: string) {
  const projectId = `${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await page.request.post('/api/projects', {
    data: {
      designSystemId: null,
      id: projectId,
      metadata: { kind: 'prototype' },
      name: 'Preview srcdoc sibling fetch',
      skillId: null,
    },
  });
  expect(response.ok(), `create project: ${await response.text()}`).toBeTruthy();
  return projectId;
}

async function seedFile(page: Page, projectId: string, name: string, content: string) {
  const response = await page.request.post(`/api/projects/${projectId}/files`, { data: { content, name } });
  expect(response.ok(), `seed ${name}: ${await response.text()}`).toBeTruthy();
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
