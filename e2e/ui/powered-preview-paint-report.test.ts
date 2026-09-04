// W2H.1 — the powered cross-origin preview's paint report crosses back.
//
// W2G.1 left the powered transport settling on the frame's own `load` event
// with a stated reason: the daemon injects the same `od:preview-content-size`
// producer into the powered response, but that frame is deliberately
// cross-origin (a host-swapped loopback origin carrying
// `Document-Isolation-Policy: isolate-and-credentialless`) and nothing had
// confirmed the report reaches the app window from there. A report that never
// arrives looks exactly like a preview that never ran, so the transport could
// not be moved onto real paint evidence on a guess.
//
// D-17 / GPT-5.6 condition 4 asks for that confirmation in a real browser, not
// an argument. This is it: a powered artifact is opened through the production
// route, and the app window is watched for the report the frame posts. The
// jsdom half — what the host does with the report, and what it does when none
// arrives — is apps/web/tests/components/FileViewer.preview-powered-paint.test.tsx.

import { expect, test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { waitForLoadingToClear } from '@/playwright/amr';
import { T } from '@/timeouts';
import type { Page } from '@playwright/test';

const POWERED_PREVIEW = '[data-testid="artifact-preview-frame"]';
const PAINT_REPORT = 'od:preview-content-size';

interface CapturedReport {
  painted?: unknown;
  token?: unknown;
  width?: unknown;
}

declare global {
  interface Window {
    __odCapturedPaintReports?: CapturedReport[];
  }
}

test.describe.configure({ timeout: T.long });

/**
 * Records every paint report the APP window receives, before the app loads, so
 * nothing about the host's own handling can hide whether the message arrived.
 */
async function capturePaintReports(page: Page): Promise<void> {
  await page.addInitScript((reportType: string) => {
    window.__odCapturedPaintReports = [];
    window.addEventListener('message', (event) => {
      const data = event.data as { type?: string } | null;
      if (data?.type !== reportType) return;
      window.__odCapturedPaintReports?.push(data as CapturedReport);
    });
  }, PAINT_REPORT);
}

/** Wants SharedArrayBuffer, so the render-mode decision routes it to /powered. */
function poweredHtml(): string {
  return `<!doctype html>
<html>
<head><title>Powered paint report</title>
<style>body { margin: 0; min-height: 100vh; background: #0f172a; color: #f8fafc; font-family: sans-serif; }</style>
</head>
<body>
  <main><h1>Powered paint report</h1></main>
  <script>
    try { new SharedArrayBuffer(8); } catch (_) {}
  </script>
</body>
</html>`;
}

async function createProject(page: Page, name: string): Promise<string> {
  const id = `w2h1-powered-${Date.now()}`;
  const response = await page.request.post('/api/projects', {
    data: { id, name, skillId: null, designSystemId: null, metadata: { kind: 'prototype' } },
    timeout: 15_000,
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { project?: { id?: string } };
  const projectId = body.project?.id;
  if (!projectId) throw new Error(`project create response missing id: ${JSON.stringify(body)}`);
  return projectId;
}

async function seedHtmlArtifact(page: Page, projectId: string, fileName: string, content: string) {
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
    timeout: 15_000,
  });
  expect(response.ok()).toBeTruthy();
}

test('[P1] the powered preview reports its paint back across the isolated origin', async ({ page }) => {
  await applyStandardMocks(page);
  await capturePaintReports(page);

  await page.goto('/');
  await waitForLoadingToClear(page);
  const projectId = await createProject(page, 'Powered paint report');
  await seedHtmlArtifact(page, projectId, 'powered-paint.html', poweredHtml());

  await page.goto(`/projects/${projectId}/files/powered-paint.html`);
  await waitForLoadingToClear(page);

  const preview = page.locator(POWERED_PREVIEW).first();
  await expect(preview).toBeVisible({ timeout: T.medium });
  await expect(preview).toHaveAttribute('data-od-powered', 'true', { timeout: T.medium });
  await expect(preview).toHaveAttribute(
    'src',
    new RegExp(`/api/projects/${projectId}/powered/powered-paint\\.html`),
    { timeout: T.medium },
  );

  // The claim under test: the producer the daemon injected into the powered
  // response posts to the app window, and the message crosses the origin.
  await expect
    .poll(
      async () =>
        page.evaluate(() =>
          (window.__odCapturedPaintReports ?? []).filter((report) => report.painted === true).length,
        ),
      {
        message:
          'the powered frame is cross-origin and isolated; this is the evidence that its paint report still reaches the host',
        timeout: T.medium,
      },
    )
    .toBeGreaterThan(0);

  // A report the watchdog can act on names the arming it answers.
  const tokened = await page.evaluate(() =>
    (window.__odCapturedPaintReports ?? []).filter(
      (report) => report.painted === true && typeof report.token === 'string',
    ).length,
  );
  expect(tokened).toBeGreaterThan(0);

  // And because it arrived, the watchdog settled: no preview-error was filed.
  const anomalies = await page.request.get('/api/anomalies?kind=preview-error', { timeout: 15_000 });
  expect(anomalies.ok()).toBeTruthy();
  const body = (await anomalies.json()) as { anomalies?: Array<{ detail?: { surface?: string } }> };
  const poweredErrors = (body.anomalies ?? []).filter(
    (record) => record.detail?.surface === 'file_viewer_preview_powered',
  );
  expect(poweredErrors).toHaveLength(0);
});
