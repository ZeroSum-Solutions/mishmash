// W2K.1 red spec: "Export as image" must not ask a daemon that cannot rasterize.
//
// `POST /api/projects/:id/export/image` answers 501 `UPSTREAM_UNAVAILABLE`
// whenever the daemon was booted with no desktop renderer — a plain
// `od daemon` boot, which is exactly how the team's shared daemon runs. The web
// Studio asked anyway on every Download → Export as image → Save, then fell
// through to the visible-preview capture. The user got an image, but each click
// wrote a 501 row into BOTH anomaly sources: the daemon's own 5xx observer
// (`apps/daemon/src/routes/anomalies.ts`) and the web fetch wrapper
// (`apps/web/src/observability/request-health.ts`). The W2.6 acceptance bar
// counts those rows, so a working feature still failed the bar (FU-33, anomaly
// ids 35e634db / 45e5162e, 2026-09-05T07:06:23Z).
//
// Which daemon this suite boots matters, and it is NOT the renderer-less one:
// `tools-dev` starts the daemon through its sidecar
// (`apps/daemon/src/sidecar/server.ts`), which wires all three renderer
// closures, so this runtime really does rasterize and really does answer
// `{ image: true }`. That is the second case below, and it runs on the whole
// real wire: the fix must not stop a daemon that works from being asked.
//
// The first case is the renderer-less daemon the bug was reported against. The
// ONE value a tools-dev runtime cannot produce is that daemon's boot-time
// answer, so it is substituted here and nothing else is: the body is the
// contracts DTO, and `apps/daemon/tests/screenshot-export-availability.test.ts`
// asserts a real plain-boot daemon returns exactly this and 501s the export
// route it describes. Every other hop — the menu, the modal, the capture, the
// save — is the product's own.
//
// RED on `ea2eee96d`: the first case counts one `POST */export/image`.
import { expect, test } from '@/playwright/suite';
import { APP_LOADING_TEXT } from '@/playwright/loading';
import { createFakeAgentRuntimes } from '@/playwright/fake-agents';
import { T } from '@/timeouts';
import type { ExportCapabilitiesResponse } from '@open-design/contracts';
import type { Page, Request } from '@playwright/test';

const ARTIFACT = 'poster.html';
const ARTIFACT_HTML =
  '<!doctype html><html><head><title>Export probe poster</title></head><body>'
  + '<main><h1>Export probe poster</h1><p>Visible preview capture source.</p></main>'
  + '</body></html>';

/** What a daemon booted without a desktop renderer answers. */
const NO_RENDERER_CAPABILITIES: ExportCapabilitiesResponse = { image: false };

const CONFIG_STORAGE_KEY = 'mishmash:config';

let fakeRuntimes: Awaited<ReturnType<typeof createFakeAgentRuntimes>>;

test.describe.configure({ timeout: T.xlong * 2 });

test.beforeAll(async () => {
  fakeRuntimes = await createFakeAgentRuntimes({ runtimeIds: ['codex'] });
});

// The workspace sits behind onboarding, and CI runners have no real agent CLI,
// so both halves of "onboarding is done and the agent is the fake CLI" are
// seeded here rather than inherited from whichever case ran first on this
// worker.
test.beforeEach(async ({ page }) => {
  const response = await page.request.put('/api/app-config', {
    data: {
      agentCliEnv: { codex: fakeRuntimes.codex.env },
      agentId: 'codex',
      agentModels: { codex: { model: 'default', reasoning: 'default' } },
      designSystemId: null,
      onboardingCompleted: true,
      skillId: null,
    },
  });
  expect(response.ok(), `configure the fake agent: ${await response.text()}`).toBeTruthy();
  await page.addInitScript(({ env, key }) => {
    window.localStorage.setItem(key, JSON.stringify({
      agentCliEnv: { codex: env },
      agentId: 'codex',
      agentModels: { codex: { model: 'default', reasoning: 'default' } },
      designSystemId: null,
      mode: 'daemon',
      model: 'default',
      onboardingCompleted: true,
      skillId: null,
    }));
  }, { env: fakeRuntimes.codex.env, key: CONFIG_STORAGE_KEY });
});

test('[P1] a daemon with no desktop renderer is never asked to render the image', async ({ page }) => {
  await page.route('**/api/export/capabilities', async (route) => {
    await route.fulfill({
      body: JSON.stringify(NO_RENDERER_CAPABILITIES),
      contentType: 'application/json',
      status: 200,
    });
  });

  const projectId = await seedProject(page, 'w2k1-no-renderer');
  await seedArtifact(page, projectId);
  await openWorkspaceTab(page, projectId, ARTIFACT);
  const probes = watchImageExportRequests(page);

  const download = await runExportAsImage(page);

  expect(
    probes.map((request) => request.url()),
    'the client asked a renderer-less daemon to render the image; every such call is a 501 row on both anomaly sources',
  ).toEqual([]);
  expect(download, 'Export as image saved nothing after skipping the renderer probe').not.toBeNull();
  expect(download!).toMatch(/\.png$/);
});

test('[P1] a daemon with a desktop renderer is still asked, and still serves the render', async ({ page }) => {
  // No substitution: this runtime's daemon really does have renderers, and the
  // assertion below is what stops the fix from suppressing an export that works.
  const capabilities = await page.request.get('/api/export/capabilities');
  expect(capabilities.ok(), `read export capabilities: ${await capabilities.text()}`).toBeTruthy();
  expect(
    ((await capabilities.json()) as ExportCapabilitiesResponse).image,
    'the tools-dev daemon is expected to wire a renderer through its sidecar',
  ).toBe(true);

  const projectId = await seedProject(page, 'w2k1-renderer');
  await seedArtifact(page, projectId);
  await openWorkspaceTab(page, projectId, ARTIFACT);
  const probes = watchImageExportRequests(page);

  const download = await runExportAsImage(page);

  expect(probes.length, 'a daemon that can rasterize was not asked to').toBeGreaterThan(0);
  const statuses = await Promise.all(probes.map(async (request) => (await request.response())?.status() ?? null));
  expect(statuses, 'the renderer-backed image export did not answer 200').toEqual(
    statuses.map(() => 200),
  );
  expect(download, 'the renderer-backed Export as image saved nothing').not.toBeNull();
  expect(download!).toMatch(/\.png$/);
});

/**
 * Collect every image-export request the page issues from now on.
 *
 * Watching the whole flow rather than just the Save click is deliberate: the
 * menu, the modal and the capture all run through the same client, and any of
 * them asking is a 501 row on a daemon that cannot serve it.
 */
function watchImageExportRequests(page: Page): Request[] {
  const probes: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/export\/image(?:\?|$)/.test(request.url())) {
      probes.push(request);
    }
  });
  return probes;
}

/**
 * Drive Download → Export as image → PNG → Save and report the saved file name.
 *
 * Returns `null` when nothing was saved, so a failure separates "the probe was
 * skipped but the fallback capture broke" from "the probe still happened".
 */
async function runExportAsImage(page: Page): Promise<string | null> {
  await page.getByRole('button', { name: 'Download' }).click();
  await page.getByRole('menuitem', { name: 'Export as image' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Export as image' });
  await expect(dialog).toBeVisible({ timeout: T.medium });
  await dialog.getByRole('radio', { name: 'PNG' }).check();

  const downloadPromise = page.waitForEvent('download', { timeout: T.long }).catch(() => null);
  await dialog.getByRole('button', { name: 'Save' }).click();
  const download = await downloadPromise;
  return download ? download.suggestedFilename() : null;
}

async function seedProject(page: Page, slug: string) {
  const projectId = `${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await page.request.post('/api/projects', {
    data: {
      designSystemId: null,
      id: projectId,
      metadata: { kind: 'prototype' },
      name: 'Export image probe',
      skillId: null,
    },
  });
  expect(response.ok(), `create project: ${await response.text()}`).toBeTruthy();
  return projectId;
}

async function seedArtifact(page: Page, projectId: string) {
  const response = await page.request.post(`/api/projects/${projectId}/files`, {
    data: { content: ARTIFACT_HTML, name: ARTIFACT },
  });
  expect(response.ok(), `seed ${ARTIFACT}: ${await response.text()}`).toBeTruthy();
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
