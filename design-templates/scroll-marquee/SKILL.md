---
name: scroll-marquee
description: |
  Dark, scroll-driven two-row image marquee. Eleven project-preview clips
  drift right and ten drift left as the page scrolls, each row's offset tied
  directly to scroll position (not a self-running CSS loop) via a vanilla-JS
  parallax formula. Wrapped in a slim page shell so the section reads as
  placed on its own page rather than stranded on a blank canvas.
tags:
  - "component"
  - "motionsites"
  - "marquee"
  - "parallax"
  - "scroll-driven"
triggers:
  - "scroll marquee"
  - "image marquee"
  - "parallax rows"
  - "scroll driven gallery"
  - "kinetic image strip"
  - "project preview marquee"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=scroll-marquee"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build a scroll-driven image marquee like this one, in this template's own visual system, but with my own project previews. Follow the build spec exactly — the two opposite-direction rows, the exact 420x270 card size, and the scroll-position-driven parallax formula are part of the identity. Ask only for the missing essentials first: how many preview images per row and what they should show."
---

# Scroll Marquee — Scroll-Driven Parallax Image Rows

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Dark, scroll-driven two-row image marquee. Eleven project-preview clips drift
right and ten drift left as the page scrolls, each row's offset tied directly
to scroll position (not a self-running CSS loop) via a vanilla-JS parallax
formula. Wrapped in a slim page shell — a one-line wordmark bar above, a quiet
scroll-room spacer below — so the section reads as placed on its own page
rather than stranded on a blank canvas.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace the preview clips** in `assets/` with the user's own project
   previews, keeping the same `420×270` card footprint, `16px` corner radius,
   and `12px` gap. Update the two `data-row` arrays in the inline `<script>`
   to match.
3. **Preserve the design system.** The `#0C0C0C` background, the Kanit
   type family, the row gap, the fixed card size, and — most importantly —
   the exact parallax formula (`scrolled = scrollY - sectionTop + innerHeight;
   offset = scrolled * 0.3`) are the identity. Do not swap the formula for a
   CSS `@keyframes` loop; the whole point of this component is that it tracks
   scroll position, not time.
4. **Extend by duplicating a `.marquee-card`** inside either
   `.marquee-track[data-row="1"]` or `data-row="2"`, keeping each row's array
   tripled so the track never runs out of width mid-scroll.
5. **Keep motion accessible.** The scroll-driven transform freezes at its
   initial offset and the decorative preview clips stay paused on their first
   frame under `prefers-reduced-motion`, as the build spec below requires.

## Build spec

### Palette

- `#0C0C0C` — page and section background (the only background in the
  design; genuinely neutral, not injected).
- `#F5F5F5` — primary text (wordmark).
- `--panel: #151515` — the card's own background, showing briefly behind a
  video while it buffers.
- **Chromatic tokens (added page chrome, not part of the licensed section):**
  `--accent: #7C5CFC` and `--accent-b: #22D3EE`, used only for the top bar's
  "View the work" pill (a `linear-gradient(90deg, var(--accent-a),
  var(--accent-b))`) and the shared `:focus-visible` ring. The marquee section
  itself stays exactly as specified — pure neutrals, no chroma — so this
  page-chrome accent is what gives MishMash's recolor pass a genuinely
  chromatic token to act on without touching the licensed design.

### Type

**Kanit** (Google Fonts, weights 300–900) on `html`/`body`, loaded via the
exact `<link>` markup the prompt specifies (`preconnect` ×2 +
`css2?family=Kanit:wght@300;400;500;600;700;800;900&display=swap`). No other
font family appears anywhere in the page.

### Layout

Full-width `<section class="marquee-section" aria-label="…">` with
`overflow: hidden`, background `#0C0C0C`, padding `pt-24 sm:pt-32 md:pt-40
pb-10` ported literally to `96px` / `128px` (≥640px) / `160px` (≥768px) top
padding and `40px` bottom padding. Inside, two rows stacked with a `12px` gap
(`.marquee-rows`), each row an `overflow: hidden; width: 100%` wrapper around
a `.marquee-track` (`display: flex; gap: 12px; width: max-content`). Every
card is exactly `420×270px`, `flex-shrink: 0`, `border-radius: 16px`,
`overflow: hidden`. Row 1 holds 11 unique previews tripled to 33 cards; Row 2
holds 10 unique previews tripled to 30 cards — the tripling is what keeps each
track wide enough that the scroll-driven offset never exposes empty track
edge-to-edge on this page's own scroll range.

Above the section: a slim `.topbar` (wordmark + one CTA pill) — the minimum
chrome needed for the marquee to read as "placed on a page," not a fabricated
hero. Below: a quiet full-bleed spacer (`min-height: 70vh`, same background,
one small caption) that exists purely to give the parallax formula scroll
room to demonstrate itself; it is not a fabricated content section.

### Motion inventory

1. **Scroll-driven row parallax (vanilla JS, not a CSS animation).** On every
   `scroll` event (`{ passive: true }`), the handler reads the section's
   `getBoundingClientRect().top + window.scrollY` as `sectionTop`, computes
   `scrolled = window.scrollY - sectionTop + window.innerHeight`, then
   `offset = scrolled * 0.3`. Row 1's track gets
   `transform: translateX(${offset - 200}px)`; Row 2's gets
   `translateX(${-(offset - 200)}px)` — the same constants and formula as the
   prompt, ported exactly. `willChange: 'transform'` is set on both tracks;
   the handler also runs once immediately on load to set the true initial
   offset (not just the `-200px`/`+200px` CSS default, which is what shows
   for the one frame before the handler's first run).
2. **Decorative preview-clip playback.** Each card holds a muted, looping,
   `playsinline` `<video>` (the vendored translation of the prompt's GIF
   previews — see Deviations). Playback is started via JS `.play()` rather
   than the `autoplay` attribute, specifically so it can be gated by
   `prefers-reduced-motion`.
3. **`prefers-reduced-motion: reduce`** — the scroll listener is never
   attached, so both tracks stay at their literal initial transform
   (`translateX(-200px)` / `translateX(200px)`) regardless of how far the
   user scrolls; every preview `<video>` stays paused on its first frame
   instead of looping. Verified by sampling `getBoundingClientRect()` on six
   cards before and ~700ms after a simulated scroll: identical `x` in both
   samples.
4. **CTA pill hover** (added page chrome only) — `translateY(-1px)` +
   opacity dip, `200ms cubic-bezier(0.23, 1, 0.32, 1)`.

### Accessibility affordances (additive only — the rendered look is unchanged)

- Every preview `<video>` is `aria-hidden="true"` with no `controls` (mirrors
  the prompt's `alt=""` on every marquee `<img>` — the row is decorative
  motion, not content).
- A visually-hidden `<h1>` ("Scroll marquee — kinetic image rows") gives the
  page a real document-outline landmark without altering the visible design.
- `:focus-visible` ring (`2px solid var(--accent-b)`, `3px` offset) on the two
  real interactive elements in the page chrome (wordmark link, CTA pill).
- Decorative clips pause under `prefers-reduced-motion` instead of merely
  slowing down, per the marquee-specific rule in this batch's spec.
- No `target="_blank"`, no live external `href` anywhere on the page — the
  wordmark links to the in-page `#top` anchor and the CTA pill points to `#`.

### Deviations from a literal reading of the prompt (all permitted, all additive)

- **GIF previews vendored as muted MP4 loops, not `<img>` GIFs.** The
  prompt's 21 image URLs are all Motionsites-hosted animated GIFs; downloaded
  verbatim they ranged from 1.3 MB to 14.5 MB each (~175 MB total), far past
  `SPEC.md`'s ~2 MB/image budget and unworkable for a page meant to load
  instantly. Each was transcoded with `ffmpeg` (scale to 480px wide, 20fps,
  10s cap, H.264/`yuv420p`, no audio, `+faststart`) to a local MP4 — same
  crop, same content, same loop, same visual position in the grid — landing
  at 6 KB–167 KB each (~1.8 MB total for all 21). This is the multi-file→
  single-file / remote-asset→local-asset translation `FIDELITY.md` and
  `SPEC.md` both permit, applied to genuinely video-shaped content (looping
  site-preview animations) rather than static images. One source file
  (`hero-skyelite-preview-DHaZIgUv.gif`) turned out to be a single-frame GIF;
  its MP4 is a static one-frame clip, which renders identically to the
  source's non-animation.
- **Page chrome added around the licensed section** (slim top bar, quiet
  bottom spacer) per this batch's rule for section-type prompts — no
  fabricated hero, no invented filler sections; both additions are pure
  layout/whitespace plus one nav CTA, never new marquee content.
- **A page-level chromatic accent + `var()` gradient** were added to the top
  bar's CTA pill only, to satisfy MishMash's recolor-pass requirement for at
  least one genuinely chromatic root token — the marquee section's own
  palette stays pure neutral, exactly as specified.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="scroll-marquee" type="text/html" title="Scroll Marquee — Scroll-Driven Parallax Image Rows">
<!doctype html>
<html>...</html>
</artifact>
```
