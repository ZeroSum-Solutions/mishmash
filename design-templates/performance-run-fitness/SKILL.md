---
name: performance-run-fitness
description: |
  Full-bleed single-viewport hero landing page for **RunPulse**, a fictional
  running-analytics app. A looping muted background video of a runner fills
  the screen behind left-aligned white copy, a frosted-glass navbar, and a
  mobile hamburger drawer with staggered link reveals. One self-contained
  HTML page, no scroll, no sections below the fold.
tags:
  - "landing-page"
  - "motionsites"
  - "hero"
  - "video-background"
  - "fitness"
  - "dark"
  - "minimal"
triggers:
  - "runpulse"
  - "running app"
  - "fitness landing"
  - "running analytics"
  - "video hero"
  - "full-bleed video"
  - "frosted glass nav"
  - "mobile hamburger drawer"
  - "athlete landing page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=performance-run"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build RunPulse — a running-analytics hero landing page — as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — the full-bleed video, left-aligned copy, palette, typography, and motion are part of the identity. Ask only for the missing essentials first: real brand name, app copy, and a background video or photo to swap in."
---

# RunPulse — Running Analytics Hero Landing

> Rebuilt from a licensed MotionSites prompt as a self-contained page.

Single-viewport hero for **RunPulse**, a fictional running-analytics app. A
full-bleed, muted, looping background video of a runner fills the entire
screen; there is no dark overlay or scrim on top of it. Left-aligned white
copy (headline, subcopy, primary CTA, a three-item feature checklist) sits
over the video's readable left side while the runner occupies the right.
The page is intentionally one viewport tall — no sections load below the
fold, matching the original design's own scope.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headline,
   subcopy, feature bullets, and a real background video or photo sized the
   same way (full-bleed, subject weighted to one side, opposite side left
   clear for copy).
3. **Preserve the design system.** The monochrome white-on-video palette, the
   type scale, the frosted-glass nav treatment, and the motion timings in the
   build spec below are the identity — do not add a color overlay, swap in a
   tinted theme, or introduce cards/stat strips on top of the video.
4. **Extend by duplicating patterns**, never by importing chrome from another
   template. If more sections are needed below the hero, design them fresh in
   this template's own vocabulary — the hero itself should stay exactly this
   spare.
5. **Keep motion accessible.** The hamburger crossfade, the staggered mobile
   menu reveal, and the CTA hover scale all collapse under
   `prefers-reduced-motion`, and the background video pauses on its poster
   frame in that mode — preserve both when extending the page.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="performance-run-fitness" type="text/html" title="RunPulse — Running Analytics Hero Landing">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page, not the source prompt.

### Palette & type

- **Palette:** monochrome white-on-video. Text and UI chrome are white at
  varying opacity (100/90/80/70/60/50/40%) plus one solid white (the primary
  CTA background) and `#111827` (its text). No overlay gradient or scrim sits
  between the video and the copy.
- **Chromatic root token:** `--accent: #ff6a3d`, a warm amber pulled from the
  video's own sunglasses-lens highlight. It is used only additively — the
  `:focus-visible` ring and the text-selection color — so MishMash's recolor
  knob has a real chromatic token to grab without changing the resting,
  monochrome look the source design specifies.
- **Type:** Inter (400/500/600) for all UI and body copy; Playfair Display
  (500/600/700, incl. italic) for the single italic wordmark in the partner-
  logo row. Both load from Google Fonts. Headline is `clamp`-free, exact
  breakpoint sizing: 1.875rem (mobile) → 2.25rem (≥640px) → 3rem (≥768px) →
  3.4rem (≥1024px), weight 600, line-height 1.15, tracking tight.

### Section-by-section layout

1. **Video layer** — `<video>` absolutely positioned full-bleed, `object-fit:
   cover`, `object-position: right`, autoplay/loop/muted/playsinline, with a
   vendored poster frame as both the pre-play state and the broken-video
   fallback.
2. **Navbar** — logo left (`RunPulse`), four in-page nav links center-left
   (Features/Pricing/FAQ/Download, `hidden` below 768px), a frosted
   `background: rgba(255,255,255,.1)` pill CTA on the right (`hidden` below
   768px), and a 40×40 circular hamburger button that only appears below
   768px.
3. **Mobile menu overlay** — fixed full-screen `rgba(0,0,0,.8)` scrim with
   24px backdrop blur, toggled by `opacity`/`pointer-events` (500ms ease-out).
   Four centered links plus the same frosted CTA pill, each staggered in on
   open (`100ms + i·80ms` delay) and snapping back instantly on close.
4. **Hero copy** — left column, max-width 36rem: two-line serif-free headline,
   a subcopy paragraph with one bold inline emphasis, a white pill primary
   CTA with a hover scale + shadow lift, and a three-item checklist with
   inline check icons.
5. **Bottom bar** — social-proof label plus a five-name partner-logo row (text
   wordmarks, not images) on the left, and a "find your next PR" scroll-hint
   link with a down-arrow glyph on the right (hidden below 640px).

### Motion inventory

- Hamburger icon crossfade: `Menu`→`X`, opacity + 90° rotation, 300ms ease-out,
  reversed on close.
- Mobile overlay: opacity/pointer-events transition, 500ms ease-out.
- Mobile links + CTA: `translateY(32px)→0` + `opacity 0→1`, 500ms ease-out,
  staggered `100/180/260/340/420ms` on open, all `0ms` on close.
- Primary CTA: `scale(1.03)` + shadow lift on hover, `scale(0.98)` on active,
  150ms, Tailwind's default ease.
- Nav link / CTA pill color and background transitions: 150ms, Tailwind's
  default ease.
- `prefers-reduced-motion: reduce` collapses every transition/animation
  duration to near-zero, disables the CTA hover scale, and pauses the
  background video on its poster frame via a `matchMedia` listener — a fully
  static, non-animating page.

### Accessibility affordances

- Hamburger is a real `<button>` with `aria-expanded`, `aria-controls`,
  and an `aria-label` that flips between "Open menu" / "Close menu".
- The mobile overlay is `role="dialog"` `aria-modal="true"`, carries the
  `inert` attribute while closed (removes it from the tab order and from
  assistive tech), and receives focus on its first link when opened.
- `Escape` closes the menu and returns focus to the hamburger button;
  clicking the scrim (but not the inner panel) also closes it.
- Body scroll is locked while the menu is open and restored on close.
- Resizing past the desktop breakpoint while the mobile menu is open closes
  it automatically.
- Every interactive element has a visible `:focus-visible` ring (the
  chromatic `--accent` token) that does not alter the resting appearance.

### De-branding note

The source prompt's partner-logo row and account-link CTA named five real
athletic/fitness brands (a shoe brand, a training app, and three watch
brands) plus a real phone health platform. All were replaced with invented
names that preserve the original's typographic treatment (font, weight,
style, letter-spacing) at each position: **Solene** (italic serif, was the
shoe brand), **PACELINE** (bold caps, was the training app — also reused for
the "Link PaceLine / VitalSync" account CTA and the feature-list sync line,
mirroring the source's own reuse of that name in two places), **VERTEX.**
(bold caps with trailing period, was a watch brand), **Meridian** (medium
weight, was a watch brand), **ORBYTE** (semi-bold caps, was a watch brand),
and **VitalSync** (was the real phone health platform). The background video
itself (a close-up of a runner in wraparound sunglasses) carries no visible
logos or wordmarks on the glasses, apparel, or skin — vendored as-is, no
pixel-level de-branding was needed.

### Assets

- `assets/hero-video.mp4` — vendored, transcoded to 720p/muted/H.264 from the
  prompt's exact specified CloudFront source URL, ≤10MB, faststart.
- `assets/hero-poster.jpg` — a frame extracted from the same source video,
  used as the `<video poster>` and as the dignified fallback if the video
  fails to load.

### Fonts

- Inter (400/500/600) and Playfair Display (500/600/700, incl. italic) via
  the exact Google Fonts URL the prompt specifies.
