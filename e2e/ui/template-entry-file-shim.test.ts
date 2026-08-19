// F011 — the render half. `apps/daemon/tests/template-entry-file-shim.test.ts`
// proves which file a template project resolves to; this proves what the canvas
// actually paints, which is the claim the finding was opened on ("why didn't
// this show up like it's supposed to? it's all html").
//
// A user-installed template ships its real site under `assets/` behind a root
// `example.html` that is one `<iframe>` and nothing else. Handed that wrapper,
// the preview surface renders it with an opaque origin, the nested frame loads
// un-injected, every asset it references is blocked, and the canvas paints
// nothing. So a test that only checks `metadata.entryFile` cannot close this —
// it has to look at the rendered document.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { openAllProjectFiles } from '@/playwright/workspace';
import { T } from '@/timeouts';

const ACTIVE_ARTIFACT_PREVIEW_SELECTOR =
  '[data-testid="artifact-preview-frame"]:visible, [data-testid="artifact-preview-frame-url-load"]:visible, [data-testid="artifact-preview-frame-srcdoc"]:visible, [data-testid="live-artifact-preview-frame"]:visible';

const SITE_HEADING = 'F011 Real Site Painted';
const WRAPPER_TITLE = 'F011 Wrapper Should Not Render';

test.describe.configure({ timeout: T.xlong });

test.beforeEach(async ({ page }) => {
  // Standard config + mocked agents: this test is about what the canvas paints,
  // not about sign-in, and without it the app parks on the sign-in screen.
  await applyStandardMocks(page);
});

test('[P0] a project started from a wrapper-shaped template paints the real site', async ({
  page,
  toolsDev,
}) => {
  const skillId = `f011-shim-${Date.now().toString(36)}`;
  const projectId = `f011-project-${Date.now().toString(36)}`;

  // The fixture goes into this worker's own data root, which is what the daemon
  // was started with as OD_DATA_DIR — so it lands in the user-installed
  // template catalogue without touching the operator's real one. The skill
  // scan is on-demand, so a template written after boot is still discovered.
  const templateDir = path.join(toolsDev.dataDir, 'design-templates', skillId);
  await mkdir(path.join(templateDir, 'assets', 'css'), { recursive: true });
  await writeFile(
    path.join(templateDir, 'SKILL.md'),
    [
      '---',
      `name: ${skillId}`,
      'description: "F011 render fixture."',
      'od:',
      '  category: "landing-page"',
      '  mode: template',
      '  preview:',
      '    type: html',
      '    entry: assets/index.html',
      '  design_system:',
      '    requires: false',
      '---',
      '',
      `# ${skillId}`,
      '',
      'Fixture used by the F011 render regression test.',
      '',
    ].join('\n'),
    'utf8',
  );
  // The real site: a stylesheet reference makes it representative of the 199,
  // whose assets are exactly what the opaque-origin nested frame cannot fetch.
  await writeFile(
    path.join(templateDir, 'assets', 'index.html'),
    `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="./css/site.css"></head><body><main><h1>${SITE_HEADING}</h1></main></body></html>`,
    'utf8',
  );
  await writeFile(
    path.join(templateDir, 'assets', 'css', 'site.css'),
    'h1{font-family:system-ui}',
    'utf8',
  );
  // The wrapper, byte-shaped like all 199: lone iframe, no content of its own.
  await writeFile(
    path.join(templateDir, 'example.html'),
    `<!doctype html><html><head><meta charset="utf-8"><title>${WRAPPER_TITLE}</title><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style></head><body><iframe src="./assets/index.html" title="${WRAPPER_TITLE}"></iframe></body></html>`,
    'utf8',
  );

  const created = await page.request.post('/api/projects', {
    data: {
      id: projectId,
      name: 'F011 template render',
      skillId,
      designSystemId: null,
      metadata: { kind: 'template', animations: false },
    },
  });
  expect(created.ok(), `create project: ${await created.text()}`).toBeTruthy();

  // Red on main: this is 'example.html', the wrapper.
  const detail = await page.request.get(`/api/projects/${projectId}`);
  expect(detail.ok()).toBeTruthy();
  const detailBody = (await detail.json()) as {
    project: { metadata: { entryFile?: string } };
    resolvedCanvasFile: string | null;
  };
  expect(detailBody.project.metadata.entryFile).toBe('assets/index.html');
  expect(detailBody.resolvedCanvasFile).toBe('assets/index.html');

  await page.goto(`/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
  await openAllProjectFiles(page);
  await page.getByRole('tab', { name: /index\.html/i }).first().click();

  const preview = page.locator(ACTIVE_ARTIFACT_PREVIEW_SELECTOR).first();
  await expect(preview).toBeVisible({ timeout: T.long });

  // The assertion the whole finding turns on: the canvas shows the site's own
  // heading. On main the preview is the wrapper, so this heading lives one
  // opaque-origin frame down and never paints.
  const frame = page.frameLocator(ACTIVE_ARTIFACT_PREVIEW_SELECTOR);
  await expect(frame.getByRole('heading', { name: SITE_HEADING })).toBeVisible({
    timeout: T.long,
  });

  // And the wrapper itself is not what is on screen.
  await expect(page.locator(`iframe[title="${WRAPPER_TITLE}"]`)).toHaveCount(0);
});
