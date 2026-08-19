// F004 — the browser half. `apps/web/tests/components/FileViewer.inline-asset-flicker.test.tsx`
// proves the state machine; this proves what a real canvas actually paints.
//
// A preview whose assets need inlining used to be written to the iframe twice:
// once as the raw document (relative <link> refs, so it renders unstyled) and
// once, a beat later, as the rewritten one. A component test can assert the
// intermediate state is gone, but only a browser can prove no such document
// ever reached the iframe — so this test watches every `srcdoc` mutation from
// before navigation and checks each value it sees.
//
// Two generations are exercised, both against the SAME iframe/mutation
// history:
//   - Gen 1 (fresh mount): the file is opened for the first time.
//   - Gen 2 (subsequent edit / "Path A"): the SAME file is rewritten through
//     the production file-write API after Gen 1 already painted correctly.
//     A prior version of this test only covered Gen 1 — Gen 1 staying green
//     said nothing about whether a later same-file update regresses back to
//     painting the raw document (pre-land audit finding).

import { expect, test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { openAllProjectFiles } from '@/playwright/workspace';
import { T } from '@/timeouts';

const ACTIVE_ARTIFACT_PREVIEW_SELECTOR =
  '[data-testid="artifact-preview-frame"]:visible, [data-testid="artifact-preview-frame-srcdoc"]:visible';

const HEADING = 'F004 Inline Flicker Fixture';
const HEADING_GEN2 = 'F004 Inline Flicker Fixture Gen2';
const INLINE_MARKER = 'data-od-inline-asset';
const ACCENT = 'rgb(1, 2, 3)';

// Five <section> elements clear COMPOSITION_METRICS_SECTION_THRESHOLD, which
// disqualifies the URL-load path and forces srcDoc — the only render mode that
// inlines assets at all. Both generations keep this shape so the edit stays
// on the srcDoc path throughout (Path A is a same-mode content update, not a
// mode transition).
const SECTIONS = Array.from({ length: 5 }, (_, i) => `<section>${i + 1}</section>`).join('');
const pageHtml = (heading: string) =>
  `<!doctype html><html><head><meta charset="utf-8">` +
  `<link rel="stylesheet" href="styles.css"></head>` +
  `<body><h1>${heading}</h1>${SECTIONS}</body></html>`;
const PAGE_HTML = pageHtml(HEADING);
const PAGE_HTML_GEN2 = pageHtml(HEADING_GEN2);

interface SrcdocMutation {
  matchedHeadings: string[];
  hasInlineMarker: boolean;
  length: number;
}

test.describe.configure({ timeout: T.xlong });

test.beforeEach(async ({ page }) => {
  // Without the standard config + mocked agents the app parks on sign-in and
  // never renders a canvas.
  await applyStandardMocks(page);
});

test('[P0] the canvas never paints the un-inlined document before the inlined one', async ({
  page,
}) => {
  const projectId = `f004-inline-flicker-${Date.now().toString(36)}`;

  const created = await page.request.post('/api/projects', {
    data: {
      id: projectId,
      name: 'F004 inline flicker',
      skillId: null,
      designSystemId: null,
      metadata: { kind: 'prototype', animations: false },
    },
  });
  expect(created.ok(), `create project: ${await created.text()}`).toBeTruthy();

  for (const [name, content] of [
    ['home.html', PAGE_HTML],
    ['styles.css', `h1 { color: ${ACCENT}; }`],
  ] as const) {
    const written = await page.request.post(`/api/projects/${projectId}/files`, {
      data: { name, content },
    });
    expect(written.ok(), `write ${name}: ${await written.text()}`).toBeTruthy();
  }

  // Armed before any app script runs, so the very first document written to a
  // preview iframe is seen. Both halves matter: React sets `srcdoc` on the
  // element BEFORE inserting it, so the initial paint is only visible as a
  // childList insertion, while every later rewrite arrives as an attribute
  // mutation. Kept live for the whole test (never re-armed), so the Gen 2
  // edit below is captured in the same history as Gen 1.
  await page.addInitScript(
    ({ headings, marker }: { headings: string[]; marker: string }) => {
      const seen: Array<{ matchedHeadings: string[]; hasInlineMarker: boolean; length: number }> =
        [];
      (window as unknown as { __odSrcdocMutations: typeof seen }).__odSrcdocMutations = seen;
      const record = (element: Element) => {
        const value =
          element.getAttribute('srcdoc') ?? (element as HTMLIFrameElement).srcdoc ?? '';
        if (!value) return;
        seen.push({
          matchedHeadings: headings.filter((heading) => value.includes(heading)),
          hasInlineMarker: value.includes(marker),
          length: value.length,
        });
      };
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'srcdoc') {
            record(mutation.target as Element);
            continue;
          }
          for (const added of Array.from(mutation.addedNodes)) {
            if (!(added instanceof Element)) continue;
            if (added.tagName === 'IFRAME') record(added);
            for (const nested of Array.from(added.querySelectorAll('iframe'))) record(nested);
          }
        }
      });
      observer.observe(document, {
        attributes: true,
        attributeFilter: ['srcdoc'],
        childList: true,
        subtree: true,
      });
    },
    { headings: [HEADING, HEADING_GEN2], marker: INLINE_MARKER },
  );

  await page.goto(`/projects/${projectId}`, { waitUntil: 'domcontentloaded' });
  await openAllProjectFiles(page);
  await page.getByRole('tab', { name: /home\.html/i }).first().click();

  const preview = page.locator(ACTIVE_ARTIFACT_PREVIEW_SELECTOR).first();
  await expect(preview).toBeVisible({ timeout: T.long });

  const frame = page.frameLocator(ACTIVE_ARTIFACT_PREVIEW_SELECTOR);
  const paintedHeading = frame.getByRole('heading', { name: HEADING, exact: true });
  await expect(paintedHeading).toBeVisible({ timeout: T.long });

  // The stylesheet was inlined, so the heading is styled — proof the document
  // on screen is the rewritten one and not the raw file.
  await expect(paintedHeading).toHaveCSS('color', ACCENT, { timeout: T.long });

  const mutationsAfterMount = await page.evaluate(
    () => (window as unknown as { __odSrcdocMutations: SrcdocMutation[] }).__odSrcdocMutations,
  );

  // The observer must have caught the paint it is here to judge; an empty
  // record would let this test pass on a page that never rendered.
  const gen1WithContent = mutationsAfterMount.filter((m) => m.matchedHeadings.includes(HEADING));
  expect(gen1WithContent.length).toBeGreaterThan(0);

  // The assertion Gen 1 (fresh mount) turns on: not one of those writes was
  // the raw, un-inlined document. On main the first one always is.
  expect(gen1WithContent.filter((m) => !m.hasInlineMarker)).toEqual([]);

  // Gen 2 (Path A / subsequent edit): rewrite the SAME file through the same
  // production file-write API used for the initial seed above — a
  // source-level backdoor would prove nothing about the real agent-edit
  // path. The srcDoc transport does not change (still 5+ sections), so this
  // isolates the "edit after a prior successful inline" trigger from the
  // URL-load <-> srcDoc transition trigger (covered separately in
  // FileViewer.tsx / the Vitest R5 matrix).
  const rewritten = await page.request.post(`/api/projects/${projectId}/files`, {
    data: { name: 'home.html', content: PAGE_HTML_GEN2 },
  });
  expect(rewritten.ok(), `rewrite home.html: ${await rewritten.text()}`).toBeTruthy();

  const paintedHeadingGen2 = frame.getByRole('heading', { name: HEADING_GEN2, exact: true });
  await expect(paintedHeadingGen2).toBeVisible({ timeout: T.long });
  await expect(paintedHeadingGen2).toHaveCSS('color', ACCENT, { timeout: T.long });

  const mutationsAfterEdit = await page.evaluate(
    () => (window as unknown as { __odSrcdocMutations: SrcdocMutation[] }).__odSrcdocMutations,
  );
  const gen2WithContent = mutationsAfterEdit.filter((m) =>
    m.matchedHeadings.includes(HEADING_GEN2),
  );
  expect(gen2WithContent.length).toBeGreaterThan(0);

  // The assertion the finding turns on: across the FULL mutation history —
  // Gen 1's fresh mount and Gen 2's same-file edit alike — no write for
  // either generation was ever the raw, un-inlined document.
  const anyGenerationWithContent = mutationsAfterEdit.filter((m) => m.matchedHeadings.length > 0);
  expect(anyGenerationWithContent.filter((m) => !m.hasInlineMarker)).toEqual([]);
});
