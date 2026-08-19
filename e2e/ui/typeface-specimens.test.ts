// F008 — the typefaces grid renders each visible family in its own face, a
// failed face load is visibly marked (never silently faked via a same-named
// local system font), and the grid never eagerly loads every family (R1-R7).
// Runs against the real design-templates/ catalogue and never writes into
// it -- the specific family exercised is discovered from the live
// /api/typefaces response, not hardcoded, since the catalogue is a growing
// tree (see F010 in the cross-cutting doc).
import { expect, test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { gotoEntryHome } from '@/playwright/amr';
import { ensureRailOpen } from '@/playwright/rail';
import { T } from '@/timeouts';

test.describe.configure({ timeout: T.xlong });

test.beforeEach(async ({ page }) => {
  await applyStandardMocks(page);
});

test('[P0] the typefaces grid renders the first visible family in its own face, aliased and cache-friendly', async ({ page }) => {
  const listResponse = page.waitForResponse(
    (res) => /\/api\/typefaces(\?|$)/.test(res.url()) && res.request().method() === 'GET',
  );
  await gotoEntryHome(page);
  await ensureRailOpen(page);
  await page.getByTestId('entry-nav-typefaces').click();
  await expect(page.getByTestId('typefaces-section')).toBeVisible();

  const listBody = (await (await listResponse).json()) as { typefaces: Array<{ id: string }> };
  expect(listBody.typefaces.length).toBeGreaterThan(0);
  const firstId = listBody.typefaces[0]!.id;

  const specimen = page.getByTestId(new RegExp(`^typeface-specimen-${firstId}-\\d+$`)).first();
  await expect(specimen).toBeVisible({ timeout: T.long });
  // The alias is `od-specimen-<id>-<weight>` (TypefacesSection.tsx's
  // specimenAlias()), not just `od-specimen-<id>` -- derive it from the
  // rendered testid (`typeface-specimen-<id>-<weight>`, same suffix) rather
  // than assuming a weight, since the weight is real catalogue data this
  // test does not hardcode.
  const testId = await specimen.getAttribute('data-testid');
  const alias = testId!.replace(/^typeface-specimen-/, 'od-specimen-');
  // `document.fonts.check()` cannot prove this face genuinely loaded: this
  // Chromium build returns `true` even for a family name with no @font-face
  // declared anywhere (confirmed by direct instrumentation against this
  // exact test), so it can't discriminate "loaded" from "no such font,
  // silently falls back." The real, DOM-observable signal that
  // WeightSpecimen only reveals once `status === 'loaded'` is the specimen
  // phrase text itself (TypefacesSection.tsx: `{status === 'loaded' ?
  // phrase : ''}`) -- wait for that instead.
  await expect(specimen).toContainText('The quick brown fox', { timeout: T.long });
  const computedFamily = await specimen.evaluate((el) => getComputedStyle(el).fontFamily.replace(/["']/g, ''));
  expect(computedFamily).toBe(alias);
});

test('[P0] a face load failure marks that family unavailable instead of rendering a lie', async ({ page }) => {
  const listResponse = page.waitForResponse(
    (res) => /\/api\/typefaces(\?|$)/.test(res.url()) && res.request().method() === 'GET',
  );
  await page.route('**/api/typefaces/*/faces/*', (route) => route.fulfill({ status: 404, body: 'not found' }));
  await gotoEntryHome(page);
  await ensureRailOpen(page);
  await page.getByTestId('entry-nav-typefaces').click();
  await expect(page.getByTestId('typefaces-section')).toBeVisible();

  const listBody = (await (await listResponse).json()) as { typefaces: Array<{ id: string }> };
  const firstId = listBody.typefaces[0]!.id;

  const unavailable = page.getByTestId(new RegExp(`^typeface-specimen-${firstId}-\\d+-unavailable$`)).first();
  await expect(unavailable).toBeVisible({ timeout: T.long });
  // `document.fonts.check()` cannot verify "this face failed to load": this
  // Chromium build returns `true` for a family name that was never declared
  // anywhere at all (confirmed by direct instrumentation -- check() against
  // a nonsense, never-declared family also returned true), so it can never
  // distinguish "loaded" from "no such font, silently falls back" and the
  // plan's original `expect(check(...)).toBe(false)` assertion could never
  // pass regardless of implementation correctness. The real, DOM-verifiable
  // claim of R6 ("never render a lie") is that the *loaded* specimen for
  // this family is never rendered alongside the unavailable marker -- assert
  // that directly, the same property D.2's unit test already verifies via
  // `queryByTestId(...).not.toBeInTheDocument()`.
  const testId = await unavailable.getAttribute('data-testid');
  const loadedTestId = testId!.replace(/-unavailable$/, '');
  await expect(page.getByTestId(loadedTestId)).toHaveCount(0);
});

test('[P0] the grid never fires more than one face request per visible family, and offscreen families stay unloaded', async ({ page }) => {
  const listResponse = page.waitForResponse(
    (res) => /\/api\/typefaces(\?|$)/.test(res.url()) && res.request().method() === 'GET',
  );
  const faceRequests: string[] = [];
  page.on('request', (req) => {
    if (/\/api\/typefaces\/[^/]+\/faces\//.test(req.url())) faceRequests.push(req.url());
  });

  await gotoEntryHome(page);
  await ensureRailOpen(page);
  await page.getByTestId('entry-nav-typefaces').click();
  await expect(page.getByTestId('typefaces-section')).toBeVisible();
  const listBody = (await (await listResponse).json()) as { typefaces: Array<{ id: string }> };
  expect(listBody.typefaces.length).toBeGreaterThan(1);
  const lastId = listBody.typefaces[listBody.typefaces.length - 1]!.id;

  await expect(page.getByTestId(/^typeface-specimen-.*-\d+$/).first()).toBeVisible({ timeout: T.long });
  await page.waitForTimeout(500); // let in-flight face requests for the visible rows settle

  const perFamily = new Map<string, number>();
  for (const url of faceRequests) {
    const match = /\/api\/typefaces\/([^/]+)\/faces\//.exec(url);
    if (match) perFamily.set(match[1]!, (perFamily.get(match[1]!) ?? 0) + 1);
  }
  for (const count of perFamily.values()) expect(count).toBeLessThanOrEqual(1);
  // The catalogue-final family, never scrolled into view, must not have fired a face request.
  expect(perFamily.has(lastId)).toBe(false);
});
