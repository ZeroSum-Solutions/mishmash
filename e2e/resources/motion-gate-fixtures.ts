// Motion-gate fixture pages, inlined as strings.
//
// These are HTML documents, but they live here as a flat TypeScript module
// because `scripts/guard.ts` requires every file under `e2e/resources/` to be a
// flat `*.ts` file (no subdirectories, no other extensions), and every file
// under `e2e/tests/` to be a `*.test.ts`. There is therefore nowhere in this
// package to keep a loose `.html` fixture — so the markup is exported as
// template literals and loaded via `page.setContent()`.
//
// GOOD_FIXTURE_HTML animates only `transform` and `opacity` and batches its
// scroll reads through requestAnimationFrame — compositor-only work.
//
// JANKY_FIXTURE_HTML reproduces a real anti-pattern from generated scroll code:
// a synchronous (unbatched) scroll handler that interleaves a layout READ
// (getBoundingClientRect) with a layout-triggering WRITE (`top`) for every card,
// forcing a synchronous layout flush per card per scroll tick.
//
// REFERENCE_FIXTURE_HTML is the executable form of
// `docs/decisions/motion-stack.md`: a richer page than GOOD_FIXTURE_HTML,
// layering a pinned/sticky hero, a scrubbed progress indicator, a parallax
// layer, staggered card reveals, a scroll-driven mask wipe, and a
// scroll-driven scale — all through the ADR's six invariants (one
// rAF-batched driver, native scroll as the only scroll owner,
// transform/opacity only, no layout reads in the scroll handler,
// prefers-reduced-motion honored). It is hand-written vanilla JS
// reproducing the *patterns* GSAP/ScrollTrigger would produce, not the
// library itself — fixtures load over file:// with no network access, so
// no CDN import is possible here.

export const GOOD_FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Motion Gate Fixture — Good</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: sans-serif; background: #0b0d12; color: #eee; }
  .section { min-height: 100vh; padding: 48px; position: relative; }
  .card-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
  .card {
    height: 90px;
    border-radius: 8px;
    background: linear-gradient(135deg, #2b3350, #1a1f33);
    will-change: transform, opacity;
    opacity: 0;
    transform: translate3d(0, 24px, 0);
  }
  .layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    will-change: transform;
  }
</style>
</head>
<body>
  <div id="app"></div>
  <script>
    const app = document.getElementById('app');
    const SECTION_COUNT = 24;
    const CARDS_PER_SECTION = 220;
    const sections = [];
    for (let s = 0; s < SECTION_COUNT; s++) {
      const section = document.createElement('div');
      section.className = 'section';
      const layer = document.createElement('div');
      layer.className = 'layer';
      section.appendChild(layer);
      const grid = document.createElement('div');
      grid.className = 'card-grid';
      const cards = [];
      for (let c = 0; c < CARDS_PER_SECTION; c++) {
        const card = document.createElement('div');
        card.className = 'card';
        grid.appendChild(card);
        cards.push(card);
      }
      section.appendChild(grid);
      app.appendChild(section);
      sections.push({ layer, cards });
    }

    // All motion below only ever touches \`transform\` and \`opacity\` —
    // compositor-only properties that Chromium can animate without
    // triggering main-thread layout or paint. Scroll position is read
    // once per animation frame (batched via rAF), never inside the
    // 'scroll' event itself, so the handler cannot pile up synchronous
    // work faster than the display can paint.
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(render);
    }

    function render() {
      ticking = false;
      const y = window.scrollY;
      const vh = window.innerHeight;
      sections.forEach((entry, i) => {
        const sectionTop = i * vh;
        const local = (y - sectionTop + vh) / vh; // -1..2 roughly while in view
        const parallax = (y - sectionTop) * 0.15;
        entry.layer.style.transform = 'translate3d(0, ' + parallax + 'px, 0)';
        entry.cards.forEach((card, ci) => {
          const reveal = Math.min(1, Math.max(0, local - ci * 0.02));
          card.style.opacity = String(reveal);
          card.style.transform = 'translate3d(0, ' + (1 - reveal) * 24 + 'px, 0)';
        });
      });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    render();
  </script>
</body>
</html>
`;

export const JANKY_FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Motion Gate Fixture — Janky</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: sans-serif; background: #0b0d12; color: #eee; }
  .section { min-height: 100vh; padding: 48px; position: relative; }
  .card-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; position: relative; }
  .card {
    height: 90px;
    border-radius: 8px;
    background: linear-gradient(135deg, #2b3350, #1a1f33);
    position: relative;
    top: 24px;
    opacity: 0;
  }
  .layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
</style>
</head>
<body>
  <div id="app"></div>
  <script>
    const app = document.getElementById('app');
    const SECTION_COUNT = 24;
    const CARDS_PER_SECTION = 220;
    const sections = [];
    for (let s = 0; s < SECTION_COUNT; s++) {
      const section = document.createElement('div');
      section.className = 'section';
      const layer = document.createElement('div');
      layer.className = 'layer';
      section.appendChild(layer);
      const grid = document.createElement('div');
      grid.className = 'card-grid';
      const cards = [];
      for (let c = 0; c < CARDS_PER_SECTION; c++) {
        const card = document.createElement('div');
        card.className = 'card';
        grid.appendChild(card);
        cards.push(card);
      }
      section.appendChild(grid);
      app.appendChild(section);
      sections.push({ layer, cards });
    }

    // This handler reproduces a real anti-pattern seen in generated
    // scroll-motion code: it runs synchronously on every native 'scroll'
    // event (no rAF batching), and for every card it interleaves a
    // layout READ (getBoundingClientRect) with a layout-triggering WRITE
    // (\`top\`, not \`transform\`). Reading geometry right after writing it
    // forces Chromium to flush layout synchronously — once per card,
    // every scroll tick — instead of once per frame on the compositor.
    function onScroll() {
      const y = window.scrollY;
      const vh = window.innerHeight;
      sections.forEach((entry, i) => {
        const sectionTop = i * vh;
        const parallax = (y - sectionTop) * 0.15;
        // Layout-triggering write on a positioned element.
        entry.layer.style.top = parallax + 'px';

        entry.cards.forEach((card, ci) => {
          // READ: forces a synchronous layout flush because prior writes
          // in this same pass are still pending.
          const rect = card.getBoundingClientRect();
          const local = (y - sectionTop + vh) / vh;
          const reveal = Math.min(1, Math.max(0, local - ci * 0.02));
          // WRITE: layout-triggering properties (top/opacity mixed with
          // a read-derived value keeps the read from being optimized away).
          card.style.top = ((1 - reveal) * 24 + rect.top * 0) + 'px';
          card.style.opacity = String(reveal);
        });
      });
    }
    window.addEventListener('scroll', onScroll);
    onScroll();
  </script>
</body>
</html>
`;

export const REFERENCE_FIXTURE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Motion Gate Fixture — Reference</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: sans-serif; background: #0b0d12; color: #eee; }
  .progress-bar {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.08);
    z-index: 50;
  }
  .progress-fill {
    height: 100%;
    width: 100%;
    background: linear-gradient(90deg, #6d8cff, #b06dff);
    transform-origin: left center;
    transform: scaleX(0);
    will-change: transform;
  }
  .hero { position: relative; height: 250vh; }
  .hero-pin {
    position: sticky;
    top: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    will-change: transform, opacity;
  }
  .hero-pin h1 { font-size: 64px; margin: 0 0 16px; }
  .hero-pin p { font-size: 20px; opacity: 0.7; margin: 0; max-width: 40ch; }
  .section { min-height: 100vh; padding: 48px; position: relative; }
  .card-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
  .card {
    height: 90px;
    border-radius: 8px;
    background: linear-gradient(135deg, #2b3350, #1a1f33);
    will-change: transform, opacity;
    opacity: 0;
    transform: translate3d(0, 24px, 0);
  }
  .layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    will-change: transform;
  }
  .mask-section {
    min-height: 100vh;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .mask-content { font-size: 48px; max-width: 30ch; text-align: center; }
  .mask-overlay {
    position: absolute;
    inset: 0;
    background: #0b0d12;
    transform-origin: left center;
    will-change: transform;
  }
  .scale-section { min-height: 100vh; display: flex; align-items: center; justify-content: center; }
  .scale-badge {
    width: 220px;
    height: 220px;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 30%, #6d8cff, #241b4a);
    will-change: transform, opacity;
    opacity: 0.3;
    transform: scale(0.6);
  }
</style>
</head>
<body>
  <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
  <section class="hero" id="hero">
    <div class="hero-pin" id="heroPin">
      <h1>Reference fixture</h1>
      <p>A pinned hero, scrubbed by scroll position instead of a scroll-jacking library.</p>
    </div>
  </section>
  <div id="app"></div>
  <section class="mask-section" id="maskSection">
    <div class="mask-content">Wiped into view by a scaling overlay, not a mask/clip-path property.</div>
    <div class="mask-overlay" id="maskOverlay"></div>
  </section>
  <section class="scale-section" id="scaleSection">
    <div class="scale-badge" id="scaleBadge"></div>
  </section>
  <script>
    // This fixture is hand-written vanilla JS implementing the SCROLL-LINKED
    // PATTERNS that GSAP + ScrollTrigger would produce (pin, scrub,
    // stagger, parallax, scroll-driven scale/mask-wipe) — not the library
    // itself. Fixtures load over file:// with no network access, so no CDN
    // import is possible; this demonstrates the invariants from
    // docs/decisions/motion-stack.md, not GSAP's actual API.
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const app = document.getElementById('app');
    const hero = document.getElementById('hero');
    const heroPin = document.getElementById('heroPin');
    const progressFill = document.getElementById('progressFill');
    const maskSection = document.getElementById('maskSection');
    const maskOverlay = document.getElementById('maskOverlay');
    const scaleSection = document.getElementById('scaleSection');
    const scaleBadge = document.getElementById('scaleBadge');

    const SECTION_COUNT = 24;
    const CARDS_PER_SECTION = 220;
    const sections = [];
    for (let s = 0; s < SECTION_COUNT; s++) {
      const section = document.createElement('div');
      section.className = 'section';
      const layer = document.createElement('div');
      layer.className = 'layer';
      section.appendChild(layer);
      const grid = document.createElement('div');
      grid.className = 'card-grid';
      const cards = [];
      for (let c = 0; c < CARDS_PER_SECTION; c++) {
        const card = document.createElement('div');
        card.className = 'card';
        grid.appendChild(card);
        cards.push(card);
      }
      section.appendChild(grid);
      app.appendChild(section);
      sections.push({ el: section, layer: layer, cards: cards, top: 0 });
    }

    // Cached geometry, populated by measure(): read ONCE at load and on
    // resize, never inside the scroll handler. This is the invariant
    // 'never read layout inside a scroll handler; cache geometry, recompute
    // on resize' from docs/decisions/motion-stack.md.
    let heroTop = 0;
    let heroHeight = 0;
    let maskTop = 0;
    let maskHeight = 0;
    let scaleTop = 0;
    let scaleHeight = 0;
    let docScrollable = 0;

    function measure() {
      heroTop = hero.offsetTop;
      heroHeight = hero.offsetHeight;
      sections.forEach(function (entry) {
        entry.top = entry.el.offsetTop;
      });
      maskTop = maskSection.offsetTop;
      maskHeight = maskSection.offsetHeight;
      scaleTop = scaleSection.offsetTop;
      scaleHeight = scaleSection.offsetHeight;
      docScrollable = document.documentElement.scrollHeight - window.innerHeight;
    }

    function clamp01(v) {
      return Math.min(1, Math.max(0, v));
    }

    function easeOutCubic(t) {
      const inv = 1 - t;
      return 1 - inv * inv * inv;
    }

    function setFinalRestingState() {
      heroPin.style.transform = 'none';
      heroPin.style.opacity = '1';
      sections.forEach(function (entry) {
        entry.layer.style.transform = 'none';
        entry.cards.forEach(function (card) {
          card.style.opacity = '1';
          card.style.transform = 'none';
        });
      });
      maskOverlay.style.transform = 'scaleX(0)';
      scaleBadge.style.transform = 'scale(1)';
      scaleBadge.style.opacity = '1';
      progressFill.style.transform = 'scaleX(1)';
    }

    // Single motion clock: one requestAnimationFrame-batched render()
    // driven by one native 'scroll' listener. Every technique below
    // (progress bar, pin, parallax, stagger, mask wipe, scale) is computed
    // inside this same function on the same tick — no competing rAF loop,
    // no per-effect scroll listener. This is the invariant 'one rAF-batched
    // driver; no competing loops' and 'native scroll as the single scroll
    // owner' from docs/decisions/motion-stack.md.
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(render);
    }

    function render() {
      ticking = false;
      const y = window.scrollY;
      const vh = window.innerHeight;

      // Scrubbed progress indicator — transform: scaleX only.
      const progress = docScrollable > 0 ? clamp01(y / docScrollable) : 0;
      progressFill.style.transform = 'scaleX(' + progress + ')';

      // Pinned hero: scales and fades while its (taller) spacer scrolls
      // past — the vanilla-JS shape of a GSAP ScrollTrigger
      // 'pin: true, scrub: true'. transform + opacity only.
      const heroRange = Math.max(1, heroHeight - vh);
      const heroLocal = clamp01((y - heroTop) / heroRange);
      heroPin.style.transform = 'translate3d(0, 0, 0) scale(' + (1 - heroLocal * 0.2) + ')';
      heroPin.style.opacity = String(1 - heroLocal);

      // Parallax layer + staggered card reveal per section, batched in this
      // same render tick. transform + opacity only, geometry read from the
      // cache populated by measure(), never from a live layout read here.
      sections.forEach(function (entry) {
        const sectionTop = entry.top;
        const local = (y - sectionTop + vh) / vh;
        const parallax = (y - sectionTop) * 0.15;
        entry.layer.style.transform = 'translate3d(0, ' + parallax + 'px, 0)';
        entry.cards.forEach(function (card, ci) {
          const reveal = clamp01(local - ci * 0.02);
          card.style.opacity = String(reveal);
          card.style.transform = 'translate3d(0, ' + (1 - reveal) * 24 + 'px, 0)';
        });
      });

      // Scroll-driven mask wipe: an opaque overlay scaled away from its
      // left edge — the vanilla-JS shape of an animated clip-path/mask
      // reveal without ever touching the 'mask'/'clip-path' CSS properties.
      const maskLocal = clamp01((y - maskTop + vh * 0.5) / Math.max(1, maskHeight));
      maskOverlay.style.transform = 'scaleX(' + (1 - easeOutCubic(maskLocal)) + ')';

      // Scroll-driven scale: badge grows in as it nears viewport center.
      const scaleLocal = clamp01((y - scaleTop + vh * 0.5) / Math.max(1, scaleHeight));
      const eased = easeOutCubic(scaleLocal);
      scaleBadge.style.transform = 'translate3d(0, 0, 0) scale(' + (0.6 + eased * 0.8) + ')';
      scaleBadge.style.opacity = String(0.3 + eased * 0.7);
    }

    measure();
    if (prefersReducedMotion) {
      // prefers-reduced-motion is honored by disabling scroll-linked motion
      // entirely (native scroll itself stays untouched) rather than merely
      // shortening it — content resolves straight to its final resting
      // state instead. This is the invariant 'prefers-reduced-motion is
      // honored, and smooth scroll is disabled under it rather than
      // shortened' from docs/decisions/motion-stack.md.
      setFinalRestingState();
    } else {
      render();
      window.addEventListener('scroll', onScroll, { passive: true });
    }

    window.addEventListener('resize', function () {
      measure();
      if (prefersReducedMotion) {
        setFinalRestingState();
      } else {
        render();
      }
    });
  </script>
</body>
</html>
`;
