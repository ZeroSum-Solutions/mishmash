// W2H.1b — D-17 landing condition 3, the browser half.
//
// The daemon skips HTML transformation above `HTML_PREVIEW_BRIDGE_MAX_BYTES`
// (2 MiB), so a powered artifact larger than that used to be served with no
// paint producer. The host watches that frame like every other visible
// preview, waits 15 s for a report the document was never given the means to
// make, and then tells the user "Preview did not render" over a preview that
// rendered perfectly. The route half is pinned in
// `apps/daemon/tests/powered-preview-large-paint-producer.test.ts`; this file
// is the claim that matters to a user, in a real browser: a large powered
// preview that paints settles quietly, and one that paints nothing reaches the
// named failure and files exactly one `preview-error`.

import { expect, test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { waitForLoadingToClear } from '@/playwright/amr';
import { T } from '@/timeouts';
import type { Page } from '@playwright/test';

const POWERED_PREVIEW = '[data-testid="artifact-preview-frame"]';
const NO_RENDER_NOTICE = '[data-testid="preview-no-render-notice"]';
const BRIDGE_CAP_BYTES = 2 * 1024 * 1024;

test.describe.configure({ timeout: T.xlong });

/** Padding that pushes the response past the bridge cap without nesting. */
function padding(): string {
  const chunk = `<p data-filler>${'x'.repeat(1024)}</p>\n`;
  return chunk.repeat(Math.ceil((2.5 * 1024 * 1024) / chunk.length));
}

/** Wants SharedArrayBuffer, so the render-mode decision routes it to /powered. */
function largePoweredHtml(visible: boolean): string {
  const content = visible
    ? '<main><h1 style="color:#f8fafc">Large powered artifact</h1></main>'
    : '<main style="visibility:hidden"><h1>Large powered artifact</h1></main>';
  return `<!doctype html>
<html>
<head><title>Large powered artifact</title>
<style>body { margin: 0; font-family: sans-serif; }</style>
</head>
<body>
  ${content}
  ${padding()}
  <script>
    try { new SharedArrayBuffer(8); } catch (_) {}
  </script>
</body>
</html>`;
}

async function createProject(page: Page, name: string): Promise<string> {
  const id = `w2h1b-powered-${Date.now()}`;
  const response = await page.request.post('/api/projects', {
    data: { id, name, skillId: null, designSystemId: null, metadata: { kind: 'prototype' } },
    timeout: 30_000,
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { project?: { id?: string } };
  const projectId = body.project?.id;
  if (!projectId) throw new Error(`project create response missing id: ${JSON.stringify(body)}`);
  return projectId;
}

async function seedHtmlArtifact(page: Page, projectId: string, fileName: string, content: string) {
  expect(content.length).toBeGreaterThan(BRIDGE_CAP_BYTES);
  const response = await page.request.post(`/api/projects/${projectId}/files`, {
    data: {
      name: fileName,
      content,
      artifactManifest: {
        version: 1,
        kind: 'html',
        title: fileName,
        entry: fileName,
        renderer: 'html',
        exports: ['html'],
      },
    },
    timeout: 60_000,
  });
  expect(response.ok()).toBeTruthy();
}

async function previewErrorCount(page: Page): Promise<number> {
  const anomalies = await page.request.get('/api/anomalies?kind=preview-error', { timeout: 30_000 });
  expect(anomalies.ok()).toBeTruthy();
  const body = (await anomalies.json()) as { anomalies?: Array<{ detail?: { surface?: string } }> };
  return (body.anomalies ?? []).filter(
    (record) => record.detail?.surface === 'file_viewer_preview_powered',
  ).length;
}

async function openPoweredPreview(page: Page, projectId: string, fileName: string) {
  await page.goto(`/projects/${projectId}/files/${fileName}`);
  await waitForLoadingToClear(page);
  const preview = page.locator(POWERED_PREVIEW).first();
  await expect(preview).toBeVisible({ timeout: T.medium });
  await expect(preview).toHaveAttribute('data-od-powered', 'true', { timeout: T.medium });
  return preview;
}

test('[P1] a 2.5 MiB powered preview that paints settles without a preview-error', async ({ page }) => {
  await applyStandardMocks(page);
  await page.goto('/');
  await waitForLoadingToClear(page);
  const projectId = await createProject(page, 'Large powered paint');
  await seedHtmlArtifact(page, projectId, 'large-visible.html', largePoweredHtml(true));

  await openPoweredPreview(page, projectId, 'large-visible.html');

  // The watchdog gives a preview 15 s; wait past it, then check that nothing
  // was filed and no notice is showing.
  await page.waitForTimeout(18_000);
  await expect(page.locator(NO_RENDER_NOTICE)).toHaveCount(0);
  expect(
    await previewErrorCount(page),
    'a large powered preview that paints must not be reported as never rendered',
  ).toBe(0);
});

test('[P1] a 2.5 MiB powered preview that paints nothing reaches the named failure once', async ({ page }) => {
  await applyStandardMocks(page);
  await page.goto('/');
  await waitForLoadingToClear(page);
  const projectId = await createProject(page, 'Large powered blank');
  await seedHtmlArtifact(page, projectId, 'large-blank.html', largePoweredHtml(false));

  await openPoweredPreview(page, projectId, 'large-blank.html');

  await expect(page.locator(NO_RENDER_NOTICE)).toBeVisible({ timeout: T.long });
  expect(
    await previewErrorCount(page),
    'one failure is one record, however many reports the epoch rejected on the way',
  ).toBe(1);
});
