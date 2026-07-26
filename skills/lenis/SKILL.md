---
name: lenis
description: |
  Lenis (darkroomengineering/lenis, npm package "lenis") — the de-facto default smooth-scroll library in modern award-tier reference sites. Covers standalone setup, the canonical Lenis + GSAP ScrollTrigger wiring (gsap.ticker driving Lenis, Lenis driving ScrollTrigger.update), prefers-reduced-motion, and when GSAP ScrollSmoother is the better choice instead. Use when the user asks about Lenis, smooth scroll, inertia scroll, momentum scroll, or scroll-jacking, or when cloning a site that was detected using Lenis.
triggers:
  - "lenis"
  - "smooth scroll"
  - "momentum scroll"
  - "inertia scroll"
  - "scroll jacking"
  - "darkroomengineering"
od:
  mode: prototype
  category: animation-motion
  upstream: "https://github.com/darkroomengineering/lenis"
---

# Lenis

> Smooth-scroll library from darkroomengineering. npm package: `lenis`. Repo: https://github.com/darkroomengineering/lenis

## When to Use This Skill

Apply when a page needs inertial/momentum smooth scroll: content keeps drifting briefly after the user stops scrolling, scroll input is normalized across wheel/touch/trackpad, or the user explicitly asks for Lenis, "smooth scroll," or "buttery scroll." Also apply when cloning a site whose recon signals detected Lenis (`skills/web-clone`'s `dna-scaffold.mjs` / `recon-site.mjs` flag `window.Lenis` or a `lenis` script reference) — reproducing that site's scroll feel means authoring with Lenis here, not approximating it with a different mechanism.

**This repository can already do smooth scroll without this skill.** `skills/gsap-plugins` covers GSAP **ScrollSmoother**, and `skills/gsap-scrolltrigger` documents `scrollerProxy` for bridging ScrollTrigger to any third-party scroller. Lenis closes a **naming and integration gap**, not a raw capability gap: nothing before this skill authored with the literal library that `web-clone` detects and that most reference sites actually ship. Read "Lenis vs. GSAP ScrollSmoother" below before reaching for either.

**Related skills:** For scroll-triggered animation, pinning, and scrub once a smooth scroller is running, use **gsap-scrolltrigger**. For GSAP's own smooth-scroll wrapper, use **gsap-plugins**. For a single element's scroll-linked value inside React without taking over page scroll, use **motion**'s `useScroll`/`useTransform`.

## Lenis vs. GSAP ScrollSmoother

Both solve the same problem — inertial, lerped scroll instead of the browser's native jump-per-wheel-tick — but they are not interchangeable defaults. Pick one per project, not per page.

**Reach for ScrollSmoother when:**
- ✅ The project is already committed to the GSAP plugin set (ScrollTrigger, SplitText, Flip, …) and adding a second npm dependency is unwanted.
- ✅ You want smooth scroll and scroll-triggered choreography to come from one vendor with one support surface.
- ✅ The `#smooth-wrapper` / `#smooth-content` DOM restructuring GSAP requires (see `skills/gsap-plugins`) is acceptable for this page's layout.

**Reach for Lenis when:**
- ✅ The project isn't otherwise using GSAP, or uses only ScrollTrigger without wanting ScrollSmoother's wrapper markup.
- ✅ You are reproducing a specific reference site that ships Lenis — matching the exact library keeps easing/inertia feel closer to the original than an equivalent built from a different primitive.
- ✅ You want a lighter dependency with no required wrapper-DOM surgery (Lenis can smooth the whole document without a content-wrapper rewrite).
- ✅ Lenis is, in practice, the default smooth-scroll choice across current award-tier/reference work — reach for it when no other constraint (see above) points to ScrollSmoother instead.

Either choice is fine on its own. The failure mode is running **both** on the same page — see the rule below.

## Hard Rule: ONE SCROLL OWNER

**Only one of {native scroll, GSAP ScrollSmoother, Lenis} may own scroll on a page. Never two.**

Two smooth-scroll mechanisms fighting over the same scroll position produce visible stutter, wrong `scrollY` reads, and ScrollTrigger positions that drift out of sync with what's on screen. Before adding Lenis, confirm the page has no `#smooth-wrapper`/ScrollSmoother already present, and vice versa. This same rule is stated in **motion** and **react-three-fiber** for their own scroll-reading APIs (`useScroll`, scene-progress feeds) — those may *read* whichever single scroller owns the page, they must never become a second scroll owner themselves.

## Installation

```bash
npm install lenis
```

The package was previously published as `@studio-freight/lenis`; new work should use the current `lenis` package name.

## Standalone Setup (no GSAP on the page)

```javascript
import Lenis from "lenis";

const lenis = new Lenis({
  lerp: 0.1,        // 0–1, lower = smoother/slower catch-up
  duration: 1.2,    // used when easing-based (not lerp-based) smoothing is selected
  smoothWheel: true,
});

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);
```

This is Lenis's own render loop — correct when nothing else on the page needs a synchronized per-frame clock. The moment GSAP is also present, stop using this loop and switch to the canonical integration below; running both `requestAnimationFrame(raf)` here **and** `gsap.ticker` is the double-clock bug.

## ONE MOTION CLOCK — The Canonical Lenis + GSAP ScrollTrigger Integration

Do not run Lenis's own RAF loop (above) alongside GSAP's ticker as two competing drivers. Wire them so **`gsap.ticker` is the single per-frame clock**, driving Lenis, with Lenis in turn notifying ScrollTrigger:

```javascript
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const lenis = new Lenis({
  autoRaf: false, // disable Lenis's own requestAnimationFrame loop — gsap.ticker owns the clock
});

// Lenis scrolled -> tell ScrollTrigger to recompute positions/progress.
lenis.on("scroll", ScrollTrigger.update);

// gsap.ticker drives Lenis's raf, not the other way around, and not a second RAF loop.
gsap.ticker.add((time) => {
  lenis.raf(time * 1000); // gsap.ticker's time is in seconds; lenis.raf expects milliseconds.
});

// GSAP's ticker normally smooths out long frames ("lag smoothing") by skipping time.
// That fights Lenis's own lerp-based smoothing, producing jumps. Disable it.
gsap.ticker.lagSmoothing(0);
```

Three things must all be true, or this reintroduces the double-clock bug the repo is trying to prevent:

1. **`autoRaf: false`** (or, on Lenis versions that predate this option, never call `requestAnimationFrame(() => lenis.raf(...))` yourself) — Lenis must not run its own loop once `gsap.ticker` is driving it.
2. **`gsap.ticker.add((time) => lenis.raf(time * 1000))`** — the tick multiplies by 1000 because `gsap.ticker`'s callback time is in seconds; `lenis.raf()` expects milliseconds, matching `performance.now()`/`requestAnimationFrame`'s native unit.
3. **`gsap.ticker.lagSmoothing(0)`** — without this, GSAP's default lag-smoothing occasionally skips or compresses ticker time after a stall (tab switch, heavy frame), which desyncs from Lenis's own lerped position and produces a visible jump or stutter.

`lenis.on("scroll", ScrollTrigger.update)` is what keeps ScrollTrigger's pinning, scrub, and trigger math correct — without it, ScrollTrigger keeps reading scroll position from wherever it last checked and every pin/scrub drifts out of sync with what Lenis is actually rendering.

## Bridging a Non-Native Scroller: `scrollerProxy`

The integration above is enough for Lenis's default mode, where Lenis smooths the *real* document scroll (it lerps `window.scrollTo`/native scrollTop under the hood) — ScrollTrigger keeps reading `window` scroll position as normal, so no proxy is needed.

If Lenis is configured against a custom `wrapper`/`content` pair instead of the window (e.g. a scoped scrollable panel rather than the whole page), ScrollTrigger no longer sees that scroll position through its default `window`/document read. In that case, bridge it with `ScrollTrigger.scrollerProxy()` — the same mechanism `skills/gsap-scrolltrigger` documents for any third-party scroller:

```javascript
ScrollTrigger.scrollerProxy(wrapperElement, {
  scrollTop(value) {
    if (arguments.length) lenis.scrollTo(value, { immediate: true });
    return lenis.animatedScroll ?? lenis.scroll;
  },
  getBoundingClientRect() {
    return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
  },
});
lenis.on("scroll", ScrollTrigger.update); // still required
```

See `skills/gsap-scrolltrigger`'s **ScrollTrigger.scrollerProxy()** section for the full option reference (`pinType`, `fixedMarkers`, `scrollWidth`/`scrollHeight`).

## Accessibility

### `prefers-reduced-motion`: disable, don't shorten

A user with `prefers-reduced-motion: reduce` is not asking for a quicker version of the smoothing — they are asking for it to not happen. Detect the preference and skip Lenis entirely rather than tuning `lerp`/`duration` down:

```javascript
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const lenis = prefersReducedMotion
  ? null
  : new Lenis({ autoRaf: false });

if (lenis) {
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}
// When lenis is null, the page falls through to plain native scroll — the correct
// reduced-motion behavior, not a Lenis instance with lerp turned down to nearly 0.
```

Re-check the media query on change (`matchMedia(...).addEventListener("change", ...)`) and destroy/recreate Lenis accordingly if the app must respond live rather than only at load.

### The real accessibility cost of hijacking scroll

Smooth-scroll libraries intercept the browser's native scroll handling, which has real costs beyond animation preference — audit all of these before shipping Lenis on a page that isn't purely decorative:

- **Keyboard navigation.** Space, Page Up/Down, arrow keys, and Home/End normally move native scroll directly. A hijacked scroll must still respond correctly to all of them — verify Lenis isn't only listening for wheel/touch and silently dropping keyboard-driven scroll.
- **Focus scrolling.** When focus moves to an off-screen element (tab order, a skip link, form validation focusing an invalid field), the browser's native "scroll into view" behavior must still land the element on screen through Lenis's lerped position, not fight it or leave the focused element out of view.
- **Anchor links.** A same-page `<a href="#section">` normally triggers native instant/smooth scroll. With Lenis active, route anchor navigation through `lenis.scrollTo(target)` explicitly — a native anchor jump underneath a Lenis-managed scroll position will desync the two.
- **Browser find-in-page (Ctrl/Cmd+F).** Native find-in-page scrolls the document to the match using real `scrollTo`. A Lenis instance that intercepts and overrides scroll position can fight this and snap back to its own lerped target, defeating find-in-page. Test this explicitly; it's easy to ship broken and easy to miss in normal QA.

None of these are reasons to avoid Lenis outright — they're the checklist for shipping it responsibly.

## When NOT to Use This

**Smooth scroll on a content or documentation site is usually a downgrade, not a polish pass.** Be blunt with the user about this:

- ❌ Blogs, docs, long-form articles, changelogs — anything where users scan, skim, and use find-in-page or the scrollbar to jump around. Inertial lag makes fast scanning feel laggy and imprecise, and the accessibility costs above hit hardest on exactly this content type.
- ❌ Any page whose primary job is reading, not spectacle — a marketing hero or portfolio piece can justify hijacked scroll as part of the experience; a support article cannot.
- ❌ Pages with heavy keyboard/screen-reader usage where the team cannot commit to auditing the accessibility checklist above.
- ✅ Marketing sites, portfolios, product launches, agency/award-tier sites where scroll itself is part of the choreography and ScrollTrigger-driven sections are already planned.

## Best Practices

- ✅ Pick exactly one scroll owner per page: native, ScrollSmoother, or Lenis — never two.
- ✅ Drive Lenis from `gsap.ticker`, not its own RAF loop, whenever GSAP is also on the page (`autoRaf: false` + `gsap.ticker.add(...)` + `gsap.ticker.lagSmoothing(0)`).
- ✅ Always pair `lenis.on("scroll", ScrollTrigger.update)` with the integration above — without it, ScrollTrigger's pin/scrub positions drift.
- ✅ Skip Lenis entirely (not a shortened version of it) under `prefers-reduced-motion: reduce`.
- ✅ Route anchor-link and focus-driven scrolling through `lenis.scrollTo(...)` instead of relying on native behavior underneath an active Lenis instance.
- ✅ Use `scrollerProxy` only when Lenis targets a custom wrapper/content pair instead of the window.

## Do Not

- ❌ Run Lenis's own `requestAnimationFrame` loop at the same time as `gsap.ticker.add(...)` — that's the double-clock bug: two drivers writing scroll-derived state per frame.
- ❌ Forget `gsap.ticker.lagSmoothing(0)` in the GSAP integration — GSAP's default lag smoothing skips ticker time in a way that fights Lenis's own lerp and produces visible jumps.
- ❌ Run Lenis and GSAP ScrollSmoother, or Lenis and native unhijacked scroll, on the same page.
- ❌ Merely lower `lerp`/`duration` for `prefers-reduced-motion` — disable Lenis outright.
- ❌ Ship Lenis on a content/documentation/long-form-reading page without an explicit reason.
- ❌ Let anchor links (`#section`) or programmatic focus scrolling bypass `lenis.scrollTo` and fight the active Lenis instance.

### Learn More

https://github.com/darkroomengineering/lenis
https://lenis.darkroom.engineering/
