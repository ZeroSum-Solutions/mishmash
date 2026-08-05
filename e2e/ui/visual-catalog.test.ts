// Visual baselines for the statically renderable design catalogue.
//
// Before this lane, the repository had one `toHaveScreenshot` assertion in
// total (`critique-theater.test.ts`). The `visual-*.test.ts` files that look
// like a regression lane are a *capture* lane: `captureVisual` writes a PNG
// for a human to look at and asserts nothing. So a CSS refactor could change
// how any of ~150 design systems or ~100 design templates render and no test
// would notice.
//
// This lane closes that. It renders each catalogue fixture and compares it to
// a committed baseline, which is the only mechanism that catches a change
// nobody thought to look for.
//
// Hermetic by construction: roughly half the template examples reference
// external fonts, images, or scripts, so every non-`file:` request is
// aborted. A fixture then renders identically with or without a network,
// which is both a determinism requirement and the e2e rule against depending
// on real external services.

import type { Page } from '@playwright/test';
import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';
import {
  catalogTargetUrl,
  discoverCatalogTargets,
  selectCatalogShard,
} from '@/playwright/catalog';

const targets = selectCatalogShard(discoverCatalogTargets());

/**
 * Antialiasing and subpixel layout differ slightly between runs even on one
 * machine. A small ratio absorbs that without hiding a real change: at 0.2%
 * of a full-page shot, a restyled button still fails while font-rendering
 * jitter does not.
 */
const MAX_DIFF_PIXEL_RATIO = 0.002;

async function blockExternalRequests(page: Page): Promise<void> {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    return route.abort();
  });
}

/**
 * Make the page's own sources of nondeterminism deterministic, before any of
 * its script runs.
 *
 * Pausing CSS animations is not sufficient. Several fixtures
 * (`worker-visualizer`, `sprite-animation`, the WebGL and particle examples)
 * drive a canvas from `Math.random`, `Date.now`, and `requestAnimationFrame`,
 * so two runs of an unchanged file would capture different pixels and the
 * lane would flake instead of regress.
 */
async function freezeNondeterminism(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Deterministic PRNG (mulberry32) with a fixed seed, so a fixture that
    // scatters particles scatters them the same way every run.
    let seed = 0x2f6e2b1;
    Math.random = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // Freeze the clock. `Date.now`-driven layouts (countdowns, "today")
    // would otherwise render differently on every run.
    const FIXED = 1767225600000; // 2026-01-01T00:00:00Z
    // A plain constructor function rather than `class extends Date`: the
    // subclass form makes TypeScript pick one Date overload and then reject
    // the pass-through spread. Returning an object from a constructor call
    // overrides `this`, so `new Date(...)` still yields a real Date.
    const RealDate = Date;
    const FakeDate = function (...args: unknown[]) {
      return args.length === 0
        ? new RealDate(FIXED)
        : new (RealDate as unknown as new (...a: unknown[]) => Date)(...args);
    } as unknown as DateConstructor;
    const fake = FakeDate as unknown as Record<string, unknown>;
    fake.now = () => FIXED;
    fake.parse = RealDate.parse;
    fake.UTC = RealDate.UTC;
    // `prototype` is read-only on the typed DateConstructor, so it is set
    // through the untyped view; instanceof checks in fixtures depend on it.
    fake.prototype = RealDate.prototype;
    // eslint-disable-next-line no-global-assign
    Date = FakeDate;
    performance.now = () => 0;

    // Run a bounded number of animation frames so a fixture that renders its
    // first paint inside rAF still draws, then stop — an unbounded loop would
    // keep mutating the canvas underneath the screenshot.
    let frames = 0;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      if (frames >= 3) return 0;
      frames += 1;
      return window.setTimeout(() => cb(frames * 16), 0);
    }) as typeof window.requestAnimationFrame;
  });
}

async function settle(page: Page): Promise<void> {
  // `document.fonts.ready` resolves once every @font-face has loaded or
  // failed. With external requests aborted the failures are immediate and
  // identical every run, so this is a determinism guarantee, not a wait.
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  // Pin anything driven by time so a scroll-triggered or looping animation
  // cannot be captured mid-frame.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-play-state: paused !important;
      animation-delay: 0ms !important;
      transition: none !important;
      caret-color: transparent !important;
    }`,
  });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
}

test.describe('design catalogue visual baselines', () => {
  test.describe.configure({ mode: 'parallel' });

  // The inventory guard for this lane — that discovery found the catalogue
  // at all, and that shards partition it exactly once — lives in
  // `e2e/tests/visual-catalog-coverage.test.ts`. It needs no browser, and
  // keeping it there means a collapsed discovery fails loudly instead of
  // turning this file into zero silently-passing tests.
  for (const target of targets) {
    test(`[P2] ${target.kind} ${target.id} renders unchanged`, async ({ page }) => {
      test.setTimeout(T.xlong);

      await blockExternalRequests(page);
      await freezeNondeterminism(page);
      await page.goto(catalogTargetUrl(target), {
        waitUntil: 'load',
        timeout: T.medium,
      });
      await settle(page);

      await expect(page).toHaveScreenshot(target.snapshot, {
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
      });
    });
  }
});
