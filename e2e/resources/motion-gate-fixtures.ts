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
