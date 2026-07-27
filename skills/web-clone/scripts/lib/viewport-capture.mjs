#!/usr/bin/env node
// viewport-capture.mjs -- shared Playwright viewport/scroll/metrics helpers
// used by both the capture path (mirror-site.mjs, recording a baseline) and
// the verification gate (verify-mirror.mjs, checking a served mirror against
// that baseline). One definition means a capture-time viewport and a
// verify-time viewport can never silently drift apart.
//
// Multi-viewport capture (1440/768/390) is one of the proven techniques from
// the designbybrandin.com rescue: a single-viewport scroll-through misses
// content that only renders (or only lazy-loads) at a narrower breakpoint.
//
// Playwright-dependent (every export takes a live `page`) -- not unit
// tested directly; see lib/gate-decision.mjs for the pure decision this data
// feeds into.

export const DEFAULT_VIEWPORTS = [
  { width: 1440, height: 900, dpr: 1, label: "1440" },
  { width: 768, height: 900, dpr: 1, label: "768" },
  { width: 390, height: 844, dpr: 2, label: "390" },
];

/**
 * Forces lazy-loaded markup to resolve before a scroll/metrics pass reads it.
 * Real themes (Nectar/Salient, WPBakery, generic lazysizes forks) gate the
 * real `src`/`srcset` behind `data-*` attributes and an IntersectionObserver;
 * a scripted scroll can outrun the observer's callback, so this copies the
 * lazy attributes onto the live ones directly and nudges the runtime with a
 * resize/scroll event.
 */
export async function forceLazyMarkup(page) {
  await page.evaluate(() => {
    const copy = (node, from, to) => {
      const value = node.getAttribute(from);
      if (value && !node.getAttribute(to)) node.setAttribute(to, value);
    };
    for (const image of document.querySelectorAll("img")) {
      image.loading = "eager";
      for (const attr of ["data-src", "data-lazy-src", "data-nectar-img-src"]) copy(image, attr, "src");
      for (const attr of ["data-srcset", "data-lazy-srcset", "data-nectar-img-srcset"]) copy(image, attr, "srcset");
    }
    for (const source of document.querySelectorAll("source")) {
      copy(source, "data-src", "src");
      copy(source, "data-srcset", "srcset");
    }
    for (const video of document.querySelectorAll("video")) {
      video.preload = "auto";
      copy(video, "data-src", "src");
      try {
        video.load();
      } catch {
        // Some hosts reject a manual load() before the element is attached long enough; harmless.
      }
    }
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("scroll"));
  });
}

/**
 * Scrolls the full page in fixed steps, re-checking scrollHeight (and
 * re-forcing lazy markup) periodically as new content can grow the page, then
 * settles at the bottom before returning to the top.
 */
export async function steppedScroll(page, viewport, { stepPx = 700, settleMs = 2000 } = {}) {
  let total = await page.evaluate(() => document.documentElement.scrollHeight);
  const step = Math.max(200, stepPx);
  const recheckEvery = step * 8;
  for (let y = 0; y <= total + viewport.height; y += step) {
    await page.evaluate((position) => window.scrollTo({ top: position, behavior: "instant" }), y);
    await page.waitForTimeout(180);
    if (y % recheckEvery < step) {
      total = Math.max(total, await page.evaluate(() => document.documentElement.scrollHeight));
      await forceLazyMarkup(page);
    }
  }
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await page.waitForTimeout(settleMs);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(Math.min(settleMs, 1200));
}

/**
 * Runtime DOM/metric snapshot at the given viewport: dimensions used for the
 * verify-mirror drift gate, plus the same framework-detection shape
 * recon-site.mjs already uses (window.THREE/gsap/Lenis, ...), so a baseline
 * captured here and a clone checked by verify-mirror.mjs speak the same
 * vocabulary.
 *
 * `frameworks` records ONLY the actual runtime global (`Boolean(window.THREE)`,
 * etc.) -- this is what the verify-mirror gate checks a clone against.
 * `frameworkScriptHints` is a separate, non-gating diagnostic: whether a
 * script tag whose URL merely *looks like* the library is present. A script
 * that 200s but fails to execute (syntax error, wrong MIME, truncated body)
 * leaves its `<script>` tag in the DOM without ever setting the real global
 * -- conflating the two (as `Boolean(window.X) || scripts.some(...)` did)
 * let a broken script masquerade as "the library loaded", passing the gate
 * on a clone that doesn't actually run it.
 */
export async function collectRuntimeMetrics(page, viewport) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(800);
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  return page.evaluate(
    ({ width, height, dpr, label }) => {
      const win = window;
      const scripts = [...document.scripts].map((s) => s.src).filter(Boolean);
      return {
        viewport: { width, height, dpr, label },
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        frameworks: {
          three: Boolean(win.THREE),
          gsap: Boolean(win.gsap),
          lenis: Boolean(win.Lenis),
        },
        frameworkScriptHints: {
          three: scripts.some((src) => /three(\.module)?(\.min)?\.js/i.test(src)),
          gsap: scripts.some((src) => src.toLowerCase().includes("gsap")),
          lenis: scripts.some((src) => src.toLowerCase().includes("lenis")),
        },
        canvasCount: document.querySelectorAll("canvas").length,
        imageCount: document.images.length,
        videoCount: document.querySelectorAll("video").length,
        brokenImages: [...document.images]
          .filter((image) => image.complete && image.naturalWidth === 0)
          .map((image) => image.currentSrc || image.src),
      };
    },
    viewport,
  );
}
