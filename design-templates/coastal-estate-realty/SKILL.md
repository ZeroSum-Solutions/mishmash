---
name: coastal-estate-realty
description: |
  Full-viewport Mediterranean-resort hero landing page for the fictional
  coastal residence brand **AVALEA — Coast Homes**, built as a single
  self-contained HTML file with inline CSS and vanilla JS. A sky-blue hero
  frames a giant centered wordmark behind a coral-and-terracotta resort
  building photo, a glass-pill nav with an accessible mobile overlay menu,
  and a pair of mirrored palm-leaf images that part on scroll into a white
  intro section. Inter plus a display monospace headline face, scroll
  parallax, and a staggered mobile-menu entrance make up the full
  interactive experience.
tags:
  - "landing-page"
  - "motionsites"
  - "real-estate"
  - "hero"
  - "resort"
triggers:
  - "real estate landing page"
  - "coastal real estate"
  - "resort residence"
  - "property landing"
  - "luxury condo landing"
  - "mediterranean resort"
  - "vacation home brand"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=coastal-estate"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build AVALEA — Coast Homes as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, layout, and motion are part of the identity. Ask only for the missing essentials first: the real brand name, real copy, and any imagery to swap in."
---

# AVALEA — Coast Homes

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained
> page. The upstream prompt named its brand "MAREA" — an active Miami Beach
> luxury condo development and a well-known NYC restaurant — so this build
> replaces it with an original fictional brand name. See "Real-estate
> de-branding notes" below.

A single-scene hero landing page: a full-viewport sky photo carries a giant
white centered wordmark behind a Mediterranean-style resort building photo,
topped by a glass-pill nav and cut off by a white bottom fade. A pair of
mirrored palm-leaf images sit at the seam between hero and the page's one
other section — a centered white intro line — and part apart from each other
as the page scrolls, via independent parallax speeds.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace the brand and copy.** Swap the `AVALEA` wordmark (both the SVG
   hero mark and the nav logo), the nav pill labels, the intro eyebrow/title,
   and the CTA label for the user's real brand name, navigation, and voice.
3. **Preserve the design system.** The sky-blue/terracotta palette, the
   Inter + display-monospace type pairing, the one-hero-one-intro structure,
   and the motion choreography below are the identity — do not add extra
   sections, swap fonts, or turn this into a multi-scene scrolling page
   without deliberately redesigning the layout.
4. **Swap the media deliberately.** `assets/hero-sky.jpg` (full-bleed sky),
   `assets/hero-building.webp` (foreground resort building, transparent
   background), and `assets/leaf.webp` (used twice, mirrored) are sized and
   positioned to an exact composition — replace with real vendored media of
   matching aspect ratio and transparency.
5. **Extend by duplicating the page's own vocabulary**, never by importing a
   section from another template. If the user wants more content (listings,
   amenities, footer), design new sections in this page's own type scale and
   palette rather than pasting one in from elsewhere.
6. **Keep motion accessible.** The leaf parallax and mobile-menu animation
   both stay behind `prefers-reduced-motion`, as the build spec below
   requires.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="coastal-estate-realty" type="text/html" title="AVALEA — Coast Homes">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished `example.html`.

### Palette

| Token | Value | Use |
| --- | --- | --- |
| `--sky` | `#29bee4` | Hero background, `theme-color`, menu overlay gradient start |
| `--sky-deep` | `#1496be` | Menu overlay gradient midpoint |
| `--ink` | `#0d2b3a` | Body text, active-pill/CTA label color, menu overlay gradient end |
| `--terracotta` | `#c9705f` | Intro eyebrow color |
| `--nav-glass` / `--nav-glass-border` | `rgba(255,255,255,.22)` / `rgba(255,255,255,.45)` | Glass nav pills and burger button |
| `--sky-glass` / `--sky-deep-glass` / `--ink-glass` | alpha-blended copies of the three tokens above | `var()` stops for the mobile-menu gradient (kept as separate tokens so the alpha channel survives the recolor pass — see MishMash's `var()`-stop rule) |

All hex/rgba values are copied verbatim from the source prompt's design-token
block, digit for digit.

### Type

**Inter** (300/400/500/600/700) for all body, nav, and intro-eyebrow text.
**Iosevka Charon** (700) for the hero wordmark and nav logo — the source
prompt's exact display face, with `"Archivo Black", "Arial Black"` as its
declared system-font fallback (Archivo Black is not loaded from Google Fonts
in this build, matching the prompt). The intro title's bold "calm" also uses
that Archivo Black / Arial Black fallback stack at weight 400, per spec.

### Layout

`.page` → `section.hero` → two mirrored `img.leaf` → `section.intro`, exact
DOM order from the source prompt:

1. **Hero** — `100vh`/`100svh`, `overflow:hidden`, background `var(--sky)`,
   `isolation:isolate`. Layer order (z-index): sky photo (0) → SVG wordmark
   (1) → building photo (2) → white bottom fade (3) → glass nav (60).
2. **Wordmark** — an SVG `<text>` "AVALEA", centered, `top:13%` (percentages
   and breakpoint overrides copied from the source's five-letter original);
   the `viewBox` was widened from the source's `0 0 1000 300` to
   `0 0 1300 300` (x-center `650`) purely to fit AVALEA's extra letters
   without clipping — same font-size, same vertical position, same visual
   role, `overflow:visible` added as a safety net.
3. **Building photo** — absolutely centered, bottom-anchored, with the
   source's exact `min-aspect-ratio`/breakpoint/landscape-short overrides for
   width/height/bottom-offset.
4. **Nav** — glass logo + pill link row (`Stay` active, `Broker`, `Own/Rent`,
   `List`, `Ask Broker`) + solid-white `Reserve Now` CTA, all `href="#"`;
   collapses to logo + burger under 780px.
5. **Mobile menu** — fixed fullscreen overlay, diagonal `--sky→--sky-deep→
   --ink` glass gradient, staggered link entrance, CTA pill.
6. **Leaves** — the same image used twice (`leaf--left` plain, `leaf--right`
   mirrored via `rotate(180deg)`), anchored at the hero/intro seam,
   vertically centered on that seam via `translate3d(x, calc(-50% + y), 0)`.
7. **Intro** — centered white section: a terracotta uppercase eyebrow
   ("Riviera Living Style") and a light-weight two-line title ("Where the
   shoreline becomes **calm**") with only "calm" set in the bold display
   face.

### Motion inventory

- **Leaf scroll parallax** — rAF-throttled, passive `scroll` listener sets
  `--parallax-x`/`--parallax-y` per leaf (left: `scrollY * -0.06` /
  `scrollY * -0.28`; right: `scrollY * 0.08` / `scrollY * -0.48`), ported
  from the source prompt's exact constants. Skipped entirely under
  `prefers-reduced-motion: reduce`, leaving both leaves at their resting
  (scroll-0) position.
- **Nav pill hover** — glass pills lighten to `rgba(255,255,255,.4)`; the
  active pill / CTA lighten to `rgba(255,255,255,.88)`.
- **Burger → X** — three bars rotate/translate/scale into a close glyph;
  translate animates first, rotate delayed `0.14s` on open, timing reversed
  (no delay) on close, `0.55s`/`0.35s` open/close durations with the source's
  exact ease curves.
- **Mobile menu open** — backdrop scales from `1.12` to `1` over `0.7s`
  ease-out; each link fades/rises in with a `calc(var(--i) * 55ms + 140ms)`
  stagger; the CTA pill follows at a flat `420ms` delay. Closing reverses
  with the `0.35s` ease-in duration and no stagger.
- **Menu link press** — `translateX(6px)` on `:active`.

All motion is vanilla CSS transitions/custom-property-driven transforms plus
a small vanilla-JS controller — no GSAP, no WebGL. Under `@media
(prefers-reduced-motion: reduce)`, every transition collapses to `0.01ms`,
the burger/menu still function (just without animation), and the leaves hold
their static resting position instead of tracking scroll.

### Accessibility affordances

- Burger toggle carries `aria-expanded`, `aria-controls="mobile-menu"`, and
  a label that flips between "Open menu"/"Close menu".
- Mobile menu closes and returns focus to the burger on `Escape`, closes (no
  refocus) on any link click, on a click outside `.menu__inner`, or
  automatically when the viewport crosses back above the 780px desktop
  breakpoint (verified live via a `matchMedia` listener, not just on load).
- The active nav pill carries `aria-current="page"`.
- Decorative imagery (hero sky, hero wordmark SVG, both leaves) carries
  empty `alt`/`aria-hidden="true"`; the building photo has a real
  descriptive `alt`.
- All images set `user-select:none` / `-webkit-user-drag:none` per spec, with
  no effect on assistive-tech semantics.
- Full keyframe/transition set neutralizes under `prefers-reduced-motion:
  reduce` (see Motion inventory).

### Assets vendored

| File | Role | Size |
| --- | --- | --- |
| `hero-sky.jpg` | Full-bleed hero sky background | 48 KB |
| `hero-building.webp` | Foreground resort-building photo, transparent background | 224 KB |
| `leaf.webp` | Palm-leaf image, reused mirrored for both sides | 380 KB |

Total ≈ 652 KB. All three were fetched directly from the exact asset URLs
the source prompt specified (two `cloudfront.net` PNGs and one
`figma.site`-hosted PNG through a Higgs CDN wrapper); the two large PNGs were
re-encoded to WebP (same pixels, alpha preserved) to bring their footprint
down from ~1.5 MB / ~2.1 MB combined to ~600 KB combined.

### Real-estate de-branding notes

Per the batch's vertical de-branding duty:

- **Brand name changed.** The source prompt's brand, "MAREA — Coast Homes,"
  is a real, currently-marketed luxury condo development (801 South Pointe
  Drive, Miami Beach, developed by Related Group) and also the name of a
  Michelin-starred NYC restaurant. Both are real, active, and unrelated to
  this fictional page, so the wordmark, nav logo, page title, and alt text
  were all renamed to the invented brand **AVALEA**, checked against web
  search for collisions before use. "Coast Homes" (a generic descriptor, not
  a distinctive mark) was kept.
- **No real address is presented as a listing.** The page carries no address,
  price, or unit count — it is a single hero + intro scene with no listing
  content to de-brand.
- **No invented facts about a real place.** "Riviera Living Style" is a
  style descriptor, not a claim about any specific real coastline.
- **Vendored media checked for baked-in branding.** All three photos (sky,
  building, leaf) were inspected for visible signage, logos, or address
  markers; none carry any.

### Verified against the preview

`get_prompt` returned a `preview_url` screenshot (a static PNG/WebP, not a
GIF or video, so no frame extraction was needed) of the actual rendered
design. It was downloaded to session scratch (never into this repo), read
visually, and compared against a 1440×900 headless render of this
`example.html`.

**What matched immediately:** the sky-blue gradient (sampled hero pixel
`#28BBD8`, within compression tolerance of the spec's `#29bee4`), the nav
pill set and its active/CTA styling, the giant centered wordmark sitting
behind the building photo, the coral/terracotta Mediterranean building
composition, and both mirrored palm leaves overlapping the hero/intro seam
at the resting scroll position.

**What was adjusted for the de-branded name:** the wordmark's SVG `viewBox`
was widened (see "Layout" above) purely so seven letters render at the same
font-size/position as the original five without clipping — a mechanical
accommodation, not a design change.

**Bug found only by driving the interactive states (not visible in any
static screenshot):** the mobile menu's `Reserve Now` CTA reused the desktop
nav's `.nav__cta` class for its base pill styling. That class is hidden by a
`display:none` rule at the same ≤780px breakpoint where the mobile menu
itself becomes visible, so the CTA silently disappeared from the open mobile
menu — invisible in a load-and-screenshot pass, only caught by actually
opening the menu at a mobile viewport and querying the element. Fixed by
scoping the desktop hide rule to `.nav > .nav__cta` so the reused class in
the mobile menu is unaffected.

**Everything else** — spacing, nav breakpoints (1100px/900px/780px/420px,
short-landscape), the bottom-fade gradient stops, and the intro section's
type scale — was ported at the prompt's exact stated values with no
adjustment needed.
