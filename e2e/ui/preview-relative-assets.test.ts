// W2G.4b red spec (B-10): a preview iframe must load its relative project
// assets inside the app, while a cross-site request to a JSON API route is
// still refused.
//
// Track 2.4 made both creation paths resolve `assets/pic.png` to the same
// project raw-file URL. That request is then issued by a document in an
// iframe sandboxed WITHOUT `allow-same-origin`, so it carries
// `Sec-Fetch-Site: cross-site` and no `Origin`, and the shared `/api` origin
// gate answered 403 — Chrome reports `ERR_BLOCKED_BY_ORB` and the image stays
// at `naturalWidth` 0. The 2.4 acceptance test could not see that: it replaced
// `requireLocalDaemonRequest` with a pass-through and fetched the asset from
// Node, which sends no Fetch Metadata at all (Codex F8).
//
// This spec runs the real app through the production middleware. It asserts
// the positive half in a real browser context on BOTH creation paths — an
// agent-written page on disk and a live artifact minted by an agent run — and
// the negative half from inside the same sandboxed frame: an identically
// shaped cross-site GET to a JSON API route is still refused.
//
// What the browser can and cannot see. A refused subresource never reaches the
// page: Chrome blocks the daemon's 403 JSON body with `ERR_BLOCKED_BY_ORB`, and
// neither Playwright's `response` event nor CDP `Network.responseReceived`
// reports a status for it. So the STATUS CODE of the refusal is asserted where
// it is observable — `apps/daemon/tests/preview-asset-origin-exception.test.ts`,
// which boots the real daemon and sends the same `Sec-Fetch-*` metadata over
// raw HTTP through the same production middleware. Here the assertion is the
// user-visible half: the raw-asset GET returns bytes, and the JSON-route GET
// with the identical destination returns nothing the page can read.
import { expect, test } from '@/playwright/suite';
import { APP_LOADING_TEXT } from '@/playwright/loading';
import { createFakeAgentRuntimes } from '@/playwright/fake-agents';
import { T } from '@/timeouts';
import type { Locator, Page } from '@playwright/test';

const DISK_PAGE = 'agent-written.html';
const RELATIVE_REF = 'assets/pic.png';
// A 4x4 PNG, so a load that really decoded reports naturalWidth 4 while a load
// the daemon refused reports 0.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGN4YOAARwzEcQAsUhUBJmYoNwAAAABJRU5ErkJggg==';
const ASSET_NATURAL_WIDTH = 4;
const DISK_PAGE_HTML =
  '<!doctype html><html><head><title>Agent written page</title></head><body><main>'
  + '<h1>Agent written page</h1>'
  + `<img id="relative-asset" src="${RELATIVE_REF}" alt="seeded relative asset" width="240" height="160">`
  + '</main></body></html>';
const LIVE_ARTIFACT_PROMPT = 'Create a relative-asset Live Artifact.';

// FileViewer keeps both preview transports mounted and moves this one testid
// onto whichever is active, so it always names the frame the user is looking at.
const ACTIVE_PREVIEW = '[data-testid="artifact-preview-frame"]';
const LIVE_ARTIFACT_PREVIEW = '[data-testid="live-artifact-preview-frame"]';

const CONFIG_STORAGE_KEY = 'mishmash:config';

let fakeRuntimes: Awaited<ReturnType<typeof createFakeAgentRuntimes>>;

test.describe.configure({ timeout: T.xlong * 3 });

test.beforeAll(async () => {
  fakeRuntimes = await createFakeAgentRuntimes({ runtimeIds: ['codex'] });
});

// Each case performs its own complete setup. The tools-dev runtime is shared
// across a Playwright worker while the browser context is not, so both halves
// of "onboarding is done and the agent is the fake CLI" are seeded here rather
// than inherited from whichever case happened to run first.
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

test('[P0] a disk-written page loads its relative project asset inside the app preview iframe', async ({ page }) => {
  const { projectId } = await seedProject(page, 'w2g4b-disk');
  await seedRelativeAsset(page, projectId);
  await seedDiskPage(page, projectId);

  await openWorkspaceTab(page, projectId, DISK_PAGE);

  const asset = page.frameLocator(ACTIVE_PREVIEW).locator('#relative-asset');
  await expect(asset).toBeAttached({ timeout: T.long });
  await expectAssetDecoded(asset);
});

test('[P0] a live-artifact page loads its relative project asset inside the app preview iframe', async ({ page }) => {
  const { conversationId, projectId } = await seedProject(page, 'w2g4b-live');
  await seedRelativeAsset(page, projectId);
  const artifactId = await mintLiveArtifactThroughAgentRun(page, projectId, conversationId);

  await openWorkspaceTab(page, projectId, `live:${artifactId}`);

  const asset = page.frameLocator(LIVE_ARTIFACT_PREVIEW).locator('#relative-asset');
  await expect(asset).toBeAttached({ timeout: T.long });
  await expectAssetDecoded(asset);
});

test('[P0] a cross-site request from the preview iframe to a JSON API route is still refused', async ({ page }) => {
  const { projectId } = await seedProject(page, 'w2g4b-refused');
  await seedRelativeAsset(page, projectId);
  await seedDiskPage(page, projectId);

  await openWorkspaceTab(page, projectId, DISK_PAGE);
  const body = page.frameLocator(ACTIVE_PREVIEW).locator('body');
  await expect(body).toBeAttached({ timeout: T.long });

  // Positive control, issued from the same document as the negative one: a
  // project raw asset comes back with real bytes. Without it a green negative
  // half would prove only that the probe never left the page.
  const asset = await probeFromPreview(page, body, `/api/projects/${projectId}/raw/${RELATIVE_REF}`, 'w2g4b-raw');
  expect(asset.status, `the raw-asset probe was refused: ${asset.failure}`).toBe(200);

  // Same frame, same `Sec-Fetch-Dest: image`, JSON API route: only the path
  // differs, and the path is what keeps it out. The daemon answers 403 (pinned
  // in the daemon spec); the browser turns that into a blocked load, so what is
  // assertable here is that no readable response reached the page.
  const json = await probeFromPreview(page, body, `/api/projects/${projectId}/files`, 'w2g4b-json');
  expect(json.status, 'a cross-site image GET to a JSON API route was served').toBeNull();
  expect(json.failure, 'the JSON-route probe neither answered nor failed').not.toBeNull();
});

async function expectAssetDecoded(asset: Locator) {
  await expect
    .poll(
      async () => asset.evaluate((node) => (node as HTMLImageElement).naturalWidth),
      {
        message:
          `the preview iframe never decoded ${RELATIVE_REF}: naturalWidth stayed 0, which is what the daemon refusing the`
          + ' cross-site subresource GET looks like in the browser',
        timeout: T.long,
      },
    )
    .toBe(ASSET_NATURAL_WIDTH);
}

/**
 * Load one cross-site subresource from inside the sandboxed preview document
 * and report what came back.
 *
 * `<img>` is the shape under test: it is the destination a previewed page's
 * relative asset ref actually produces, and the one the exception admits. A
 * scripted `fetch` cannot stand in for it — the preview response's own CSP
 * carries `connect-src 'none'`, so the request is blocked in the page and never
 * reaches the daemon; the scripted-fetch shape (`Sec-Fetch-Dest: empty`) is
 * pinned in the daemon spec instead.
 *
 * `status` is the daemon's status when the browser accepted the response, and
 * `null` when it refused to hand one over; `failure` carries the network error
 * in that case, so a blocked load is distinguishable from a probe that never
 * left the page. The `probe` marker is unique per call, so the wait can never
 * latch onto a request the app made on its own.
 */
async function probeFromPreview(page: Page, body: Locator, url: string, marker: string) {
  const probed = `${url}${url.includes('?') ? '&' : '?'}probe=${marker}`;
  const [request] = await Promise.all([
    page.waitForRequest((candidate) => candidate.url().includes(`probe=${marker}`), { timeout: T.long }),
    body.evaluate((node, argument) => {
      const image = node.ownerDocument.createElement('img');
      image.src = argument;
      node.appendChild(image);
    }, probed),
  ]);
  await expect
    .poll(async () => (await request.response()) !== null || request.failure() !== null, {
      message: `the ${marker} probe never settled: the daemon neither answered it nor failed it`,
      timeout: T.long,
    })
    .toBe(true);
  const response = await request.response();
  return { failure: request.failure()?.errorText ?? null, status: response?.status() ?? null };
}

async function seedProject(page: Page, slug: string) {
  const projectId = `${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await page.request.post('/api/projects', {
    data: {
      designSystemId: null,
      id: projectId,
      metadata: { kind: 'prototype' },
      name: 'Preview relative assets',
      skillId: null,
    },
  });
  expect(response.ok(), `create project: ${await response.text()}`).toBeTruthy();
  const { conversationId } = (await response.json()) as { conversationId: string };
  return { conversationId, projectId };
}

async function seedRelativeAsset(page: Page, projectId: string) {
  const response = await page.request.post(`/api/projects/${projectId}/files`, {
    data: { content: PNG_BASE64, encoding: 'base64', name: RELATIVE_REF },
  });
  expect(response.ok(), `seed ${RELATIVE_REF}: ${await response.text()}`).toBeTruthy();
}

async function seedDiskPage(page: Page, projectId: string) {
  const response = await page.request.post(`/api/projects/${projectId}/files`, {
    data: { content: DISK_PAGE_HTML, name: DISK_PAGE },
  });
  expect(response.ok(), `seed ${DISK_PAGE}: ${await response.text()}`).toBeTruthy();
}

/**
 * Mint a live artifact the way the product does: a real daemon run whose agent
 * calls `POST /api/tools/live-artifacts/create` under its own run-scoped
 * grant. The agent is the repository's fake CLI, so no provider account is
 * involved, but the creation path is the production one.
 */
async function mintLiveArtifactThroughAgentRun(page: Page, projectId: string, conversationId: string) {
  const requestId = `w2g4b-${Date.now()}`;
  const runResponse = await page.request.post('/api/runs', {
    data: {
      agentId: 'codex',
      assistantMessageId: `assistant-${requestId}`,
      clientRequestId: requestId,
      conversationId,
      designSystemId: null,
      message: LIVE_ARTIFACT_PROMPT,
      model: 'default',
      projectId,
      reasoning: 'default',
      skillId: null,
    },
  });
  expect(runResponse.ok(), `start run: ${await runResponse.text()}`).toBeTruthy();
  const { runId } = (await runResponse.json()) as { runId: string };

  await expect
    .poll(async () => {
      const status = await page.request.get(`/api/runs/${runId}`);
      if (!status.ok()) return `http-${status.status()}`;
      return ((await status.json()) as { status: string }).status;
    }, { message: 'the fake agent run that mints the live artifact never succeeded', timeout: T.xlong })
    .toBe('succeeded');

  let artifactId = '';
  await expect
    .poll(async () => {
      const listed = await page.request.get(`/api/live-artifacts?projectId=${encodeURIComponent(projectId)}`);
      if (!listed.ok()) return 0;
      const { artifacts } = (await listed.json()) as { artifacts: Array<{ id: string }> };
      artifactId = artifacts[0]?.id ?? '';
      return artifacts.length;
    }, { message: 'the succeeded run registered no live artifact', timeout: T.long })
    .toBeGreaterThan(0);

  return artifactId;
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
