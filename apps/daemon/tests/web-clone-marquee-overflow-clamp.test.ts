import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// P7 (mirror width fidelity, docket #7): a mirrored Salient/WPBakery site can
// present document.scrollWidth far wider than its viewport on first paint,
// because rows carrying `data-scroll-animation="true"
// data-scroll-animation-movement="transform_x"` get a JS-computed
// `transform: translateX(...)` that can latch onto a stale (unsettled-layout)
// offset before the page's true height is known. Verified against a live
// mirror of designbybrandin.com: unclamped, this reads ~6025px at a 1440px
// viewport; clamped, ~1441px. The fix lives in the clone pipeline
// (skills/web-clone/scripts/clamp-scroll-animation-overflow.mjs, wired into
// mirror-site.mjs), not a hand-edit of any one mirror -- these tests exercise
// that shared module directly, mirroring the existing
// web-clone-skill-ref.test.ts convention of referencing skills/web-clone from
// the daemon test suite.
//
// Fixture pair (goal-run amendment 33):
//   - regressionFixtureHtml reproduces the real overflow pattern (a
//     data-scroll-animation row with an already-wild inline transform and no
//     overflow containment) and must come back changed, with the row's own
//     overflow-x scoped to hidden.
//   - legitimateScrollerFixtureHtml is a genuine horizontal carousel
//     (overflow-x: auto, no data-scroll-animation attribute) and must come
//     back byte-for-byte unchanged -- the fix must not touch scrollers that
//     were never the bug.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const clampScriptPath = path.join(
  repoRoot,
  'skills',
  'web-clone',
  'scripts',
  'clamp-scroll-animation-overflow.mjs',
);

const regressionFixtureHtml = `<!doctype html><html><body>
<div id="clients" class="wpb_row vc_row-fluid vc_row full-width-content">
  <div class="row_col_wrap_12"><div class="vc_col-sm-12 milestone-container wpb_column column_container" data-padding-pos="all" data-scroll-animation="true" data-scroll-animation-movement="transform_x" data-scroll-animation-intensity="3">
    <div class="vc_column-inner" style="transform: translateX(4499.95px) translateZ(0px);">
      <div class="wpb_wrapper"><div class="nectar-milestone"><div class="number">18+</div>Different Sectors Served</div></div>
    </div>
  </div></div>
</div>
</body></html>`;

const legitimateScrollerFixtureHtml = `<!doctype html><html><body>
<div class="nectar-carousel-flickity-fixed-content" style="overflow-x:auto; white-space:nowrap;">
  <div class="slide">Case study one</div><div class="slide">Case study two</div><div class="slide">Case study three</div>
</div>
</body></html>`;

let siteDir: string;

beforeEach(() => {
  siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clone-marquee-clamp-'));
});

afterEach(() => {
  fs.rmSync(siteDir, { recursive: true, force: true });
});

describe('clamp-scroll-animation-overflow (P7 mirror width fidelity)', () => {
  it('scopes an overflow-x clip to the exact scroll-animation row that overflows', async () => {
    const { clampScrollAnimationOverflow } = await import(pathToFileUrl(clampScriptPath));
    const file = path.join(siteDir, 'index.html');
    fs.writeFileSync(file, regressionFixtureHtml);

    const before = fs.readFileSync(file, 'utf8');
    expect(before).not.toMatch(/milestone-container[^>]*overflow/i);
    expect(before).not.toMatch(/overflow[^>]*milestone-container/i);

    const result = clampScrollAnimationOverflow({ siteDir });
    const after = fs.readFileSync(file, 'utf8');

    expect(result.clamped).toBe(1);
    expect(result.filesChanged).toBe(1);
    // The row carrying the attribute now clips its own overflow...
    expect(after).toMatch(/<div style="overflow-x:hidden;" class="vc_col-sm-12 milestone-container/);
    expect(after).toMatch(/data-scroll-animation="true"/);
    // ...while the element and its animation-driving transform are left
    // fully intact: nothing here hides the marquee or stops it animating.
    expect(after).toContain('data-scroll-animation-movement="transform_x"');
    expect(after).toContain('transform: translateX(4499.95px) translateZ(0px);');
    expect(after).toContain('18+');
    expect(after).toContain('Different Sectors Served');
  });

  it('leaves a legitimate horizontal scroller byte-for-byte untouched', async () => {
    const { clampScrollAnimationOverflow } = await import(pathToFileUrl(clampScriptPath));
    const file = path.join(siteDir, 'index.html');
    fs.writeFileSync(file, legitimateScrollerFixtureHtml);

    const result = clampScrollAnimationOverflow({ siteDir });
    const after = fs.readFileSync(file, 'utf8');

    expect(result.clamped).toBe(0);
    expect(result.filesChanged).toBe(0);
    expect(after).toBe(legitimateScrollerFixtureHtml);
  });

  it('is idempotent: a second pass over an already-clamped mirror changes nothing', async () => {
    const { clampScrollAnimationOverflow } = await import(pathToFileUrl(clampScriptPath));
    const file = path.join(siteDir, 'index.html');
    fs.writeFileSync(file, regressionFixtureHtml);

    clampScrollAnimationOverflow({ siteDir });
    const onceClamped = fs.readFileSync(file, 'utf8');
    const second = clampScrollAnimationOverflow({ siteDir });
    const stillClamped = fs.readFileSync(file, 'utf8');

    expect(second.clamped).toBe(0);
    expect(second.filesChanged).toBe(0);
    expect(stillClamped).toBe(onceClamped);
  });
});

function pathToFileUrl(p: string): string {
  return new URL(`file://${p}`).href;
}
