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
// the negative half from inside the same sandboxed frame: a cross-site GET to
// a JSON API route still answers 403, whether it is a scripted fetch or an
// image load.
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
  + `<img id="relative-asset" src="${RELATIVE_REF}" alt="seeded relative asset">`
  + '</main></body></html>';
const LIVE_ARTIFACT_PROMPT = 'Create a relative-asset Live Artifact.';

const URL_LOAD_PREVIEW = '[data-testid="artifact-preview-frame"], [data-testid="artifact-preview-frame-url-load"]';
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

  const asset = page.frameLocator(URL_LOAD_PREVIEW).locator('#relative-asset');
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
  const body = page.frameLocator(URL_LOAD_PREVIEW).locator('body');
  await expect(body).toBeAttached({ timeout: T.long });

  // A scripted fetch carries `Sec-Fetch-Dest: empty`, which no asset
  // destination covers. The frame cannot read the response across the opaque
  // origin, so the status is observed at the network level instead.
  const fetchStatus = await probeFromPreview(page, body, `/api/projects/${projectId}/files?probe=w2g4b-json-fetch`, 'fetch');
  expect(fetchStatus, 'cross-site scripted GET to a JSON API route').toBe(403);

  // An image load carries a destination the exception admits, so only the path
  // keeps it out: the exception covers project raw-asset paths, never a JSON
  // route.
  const imageStatus = await probeFromPreview(page, body, `/api/projects/${projectId}/files?probe=w2g4b-json-image`, 'image');
  expect(imageStatus, 'cross-site image GET to a JSON API route').toBe(403);
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
 * Issue one cross-site GET from inside the sandboxed preview document and
 * return the status the daemon answered with. The document holds an opaque
 * origin and cannot read the response itself, so the status comes off the
 * network. The probe query string is unique to this spec, so the wait can
 * never latch onto a request the app made on its own.
 */
async function probeFromPreview(page: Page, body: Locator, url: string, as: 'fetch' | 'image') {
  const probe = new URL(url, 'http://probe.invalid').search;
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().includes(probe), { timeout: T.long }),
    body.evaluate((node, argument) => {
      if (argument.as === 'fetch') {
        void fetch(argument.url).catch(() => {});
        return;
      }
      const image = node.ownerDocument.createElement('img');
      image.src = argument.url;
      node.appendChild(image);
    }, { as, url }),
  ]);
  return response.status();
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
