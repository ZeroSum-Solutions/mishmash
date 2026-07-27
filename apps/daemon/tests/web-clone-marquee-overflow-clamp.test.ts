import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
// This file also covers an adversary review pass on the first version of the
// fix, which confirmed four scoping/correctness bugs against the module
// directly (see the fixtures below, one per finding):
//   1. Over-clamping: matching on `data-scroll-animation="true"` alone (no
//      movement check) would touch `transform_y`/`fade_in`/etc rows too, even
//      ones with an intentionally bleeding child. -> transformYFixtureHtml.
//   2. Skip-guard false negative: a substring check for "overflow" wrongly
//      treated `text-overflow: ellipsis` as "already constrained" and skipped
//      a row that genuinely needed clamping. -> textOverflowFixtureHtml.
//   3. Single-quoted `style='...'` attributes produced a *second*,
//      double-quoted `style="..."` attribute -- the browser drops the real
//      one, including its initial transform. -> singleQuotedStyleFixtureHtml.
//   4. `overflow-x: hidden` alone forces computed `overflow-y` to `auto` per
//      CSS Overflow L3's visible/non-visible coercion rule, risking an
//      unwanted vertical scrollbar; `overflow-x: clip` is exempt from that
//      coercion. The coercion behavior was verified in live headless Chrome
//      during review; this file asserts the emitted `overflow-x:clip` markup.
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

// Finding 1: a scroll-animation row on a NON-transform_x axis, wrapping a
// child that intentionally bleeds wider than its row. Must be left
// byte-for-byte untouched -- this axis cannot produce the runaway-width bug,
// and clamping it would silently alter a deliberate layout.
const transformYFixtureHtml = `<!doctype html><html><body>
<div class="vc_col-sm-12 feature-banner wpb_column column_container" data-scroll-animation="true" data-scroll-animation-movement="transform_y" data-scroll-animation-intensity="3">
  <div class="vc_column-inner" style="width: 140%; transform: translateY(30px);">Intentionally wide decorative banner</div>
</div>
</body></html>`;

// Finding 2: a transform_x row whose *pre-existing* style declares
// `text-overflow: ellipsis`, not `overflow`/`overflow-x`. A substring check
// for "overflow" would wrongly treat this as already constrained and skip
// it; the row must still get clamped.
const textOverflowFixtureHtml = `<!doctype html><html><body>
<div class="vc_col-sm-12 milestone-container wpb_column column_container" data-scroll-animation="true" data-scroll-animation-movement="transform_x" style="text-overflow:ellipsis;white-space:nowrap">
  <div class="vc_column-inner" style="transform: translateX(3000px);">Overlong stat label</div>
</div>
</body></html>`;

// Finding 3: a transform_x row whose pre-existing style attribute is
// single-quoted. The clamp must merge into that same attribute (preserving
// its quote style and original declarations), not add a second `style="..."`
// attribute alongside it.
const singleQuotedStyleFixtureHtml =
  `<!doctype html><html><body>\n` +
  `<div class='vc_col-sm-12 milestone-container' data-scroll-animation='true' data-scroll-animation-movement='transform_x' style='transform: translateX(4499.95px) translateZ(0px);'>\n` +
  `  <div class="wpb_wrapper">85+ Brands Directed</div>\n` +
  `</div>\n` +
  `</body></html>`;

// LOW (optional, cheap): unquoted attribute values are valid HTML5. Confirms
// the matcher isn't accidentally quote-dependent.
const unquotedAttributesFixtureHtml = `<!doctype html><html><body>
<div class="vc_col-sm-12 milestone-container" data-scroll-animation=true data-scroll-animation-movement=transform_x>
  <div class="vc_column-inner" style="transform: translateX(4499.95px);">Unquoted attrs</div>
</div>
</body></html>`;

let siteDir: string;

beforeEach(() => {
  siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clone-marquee-clamp-'));
});

afterEach(() => {
  fs.rmSync(siteDir, { recursive: true, force: true });
});

async function loadClamp() {
  return (await import(pathToFileURL(clampScriptPath).href)) as {
    clampScrollAnimationOverflow: (opts: { siteDir: string; dryRun?: boolean }) => {
      clamped: number;
      filesChanged: number;
    };
  };
}

describe('clamp-scroll-animation-overflow (P7 mirror width fidelity)', () => {
  it('scopes an overflow-x clip to the exact scroll-animation row that overflows', async () => {
    const { clampScrollAnimationOverflow } = await loadClamp();
    const file = path.join(siteDir, 'index.html');
    fs.writeFileSync(file, regressionFixtureHtml);

    const before = fs.readFileSync(file, 'utf8');
    expect(before).not.toMatch(/milestone-container[^>]*overflow/i);
    expect(before).not.toMatch(/overflow[^>]*milestone-container/i);

    const result = clampScrollAnimationOverflow({ siteDir });
    const after = fs.readFileSync(file, 'utf8');

    expect(result.clamped).toBe(1);
    expect(result.filesChanged).toBe(1);
    // The row carrying both attributes now clips its own overflow on the x
    // axis only (see finding 4 -- overflow-x: clip, not overflow-x: hidden,
    // so the y axis is never coerced)...
    expect(after).toMatch(/<div style="overflow-x:clip;" class="vc_col-sm-12 milestone-container/);
    expect(after).toMatch(/data-scroll-animation="true"/);
    // ...while the element and its animation-driving transform are left
    // fully intact: nothing here hides the marquee or stops it animating.
    expect(after).toContain('data-scroll-animation-movement="transform_x"');
    expect(after).toContain('transform: translateX(4499.95px) translateZ(0px);');
    expect(after).toContain('18+');
    expect(after).toContain('Different Sectors Served');
  });

  it('leaves a legitimate horizontal scroller byte-for-byte untouched', async () => {
    const { clampScrollAnimationOverflow } = await loadClamp();
    const file = path.join(siteDir, 'index.html');
    fs.writeFileSync(file, legitimateScrollerFixtureHtml);

    const result = clampScrollAnimationOverflow({ siteDir });
    const after = fs.readFileSync(file, 'utf8');

    expect(result.clamped).toBe(0);
    expect(result.filesChanged).toBe(0);
    expect(after).toBe(legitimateScrollerFixtureHtml);
  });

  it('(finding 1) leaves a transform_y row with an intentionally bleeding child byte-for-byte untouched', async () => {
    const { clampScrollAnimationOverflow } = await loadClamp();
    const file = path.join(siteDir, 'index.html');
    fs.writeFileSync(file, transformYFixtureHtml);

    const result = clampScrollAnimationOverflow({ siteDir });
    const after = fs.readFileSync(file, 'utf8');

    expect(result.clamped).toBe(0);
    expect(result.filesChanged).toBe(0);
    expect(after).toBe(transformYFixtureHtml);
  });

  it('(finding 2) clamps a transform_x row even when its style already declares text-overflow: ellipsis', async () => {
    const { clampScrollAnimationOverflow } = await loadClamp();
    const file = path.join(siteDir, 'index.html');
    fs.writeFileSync(file, textOverflowFixtureHtml);

    const result = clampScrollAnimationOverflow({ siteDir });
    const after = fs.readFileSync(file, 'utf8');

    expect(result.clamped).toBe(1);
    expect(result.filesChanged).toBe(1);
    // The clamp is prepended; text-overflow/white-space survive unchanged.
    expect(after).toMatch(/style="overflow-x:clip;text-overflow:ellipsis;white-space:nowrap"/);
  });

  it('(finding 3) merges the clamp into a pre-existing single-quoted style attribute, keeping one style attribute', async () => {
    const { clampScrollAnimationOverflow } = await loadClamp();
    const file = path.join(siteDir, 'index.html');
    fs.writeFileSync(file, singleQuotedStyleFixtureHtml);

    const result = clampScrollAnimationOverflow({ siteDir });
    const after = fs.readFileSync(file, 'utf8');

    expect(result.clamped).toBe(1);
    expect(result.filesChanged).toBe(1);
    // Exactly one `style=` attribute on the clamped element -- never two.
    const styleAttrCount = (after.match(/\sstyle\s*=/g) ?? []).length;
    expect(styleAttrCount).toBe(1);
    // Single-quoted, with the clamp prepended and the original transform
    // (the real inline style the theme's JS wrote) preserved verbatim.
    expect(after).toContain(
      `style='overflow-x:clip;transform: translateX(4499.95px) translateZ(0px);'`,
    );
    expect(after).toContain('85+ Brands Directed');
  });

  it('(LOW, optional) clamps a row whose data-scroll-animation attributes are unquoted', async () => {
    const { clampScrollAnimationOverflow } = await loadClamp();
    const file = path.join(siteDir, 'index.html');
    fs.writeFileSync(file, unquotedAttributesFixtureHtml);

    const result = clampScrollAnimationOverflow({ siteDir });
    const after = fs.readFileSync(file, 'utf8');

    expect(result.clamped).toBe(1);
    expect(result.filesChanged).toBe(1);
    expect(after).toContain('style="overflow-x:clip;"');
    expect(after).toContain('data-scroll-animation=true');
    expect(after).toContain('data-scroll-animation-movement=transform_x');
  });

  it('is idempotent across every fixture: a second pass changes nothing further', async () => {
    const { clampScrollAnimationOverflow } = await loadClamp();
    const fixtures = [
      regressionFixtureHtml,
      legitimateScrollerFixtureHtml,
      transformYFixtureHtml,
      textOverflowFixtureHtml,
      singleQuotedStyleFixtureHtml,
      unquotedAttributesFixtureHtml,
    ];

    for (const html of fixtures) {
      const file = path.join(siteDir, 'index.html');
      fs.writeFileSync(file, html);

      clampScrollAnimationOverflow({ siteDir });
      const onceClamped = fs.readFileSync(file, 'utf8');
      const second = clampScrollAnimationOverflow({ siteDir });
      const stillClamped = fs.readFileSync(file, 'utf8');

      expect(second.clamped).toBe(0);
      expect(second.filesChanged).toBe(0);
      expect(stillClamped).toBe(onceClamped);
    }
  });
});
