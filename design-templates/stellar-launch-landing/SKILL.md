---
name: stellar-launch-landing
description: |
  Awards-show landing page for the fictional venture prize **Launchex Prizes**,
  built as a rounded "app-shell" frame — a padded white outer container holds
  a fully scrollable inner page while a floating pill nav, a bottom-left
  scroll hint, and a bottom-right page counter stay fixed above the scroll.
  A full-bleed looping video hero gives way to a three-column submissions
  gallery (chamfered nomination cards flanking a square looping video) and
  closes on a founder stats section with angular clip-path image cards and
  gradient-filled numerals.
tags:
  - "landing-page"
  - "motionsites"
  - "awards"
  - "video-hero"
  - "app-shell-frame"
  - "editorial"
triggers:
  - "launchex"
  - "launchex prizes"
  - "awards landing page"
  - "startup awards"
  - "submissions gallery"
  - "founder stats"
  - "chamfered cards"
  - "rounded app shell"
  - "floating pill nav"
  - "video hero landing"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=stellar-launch"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Launchex Prizes — Awards Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage or imagery to swap in."
---

# Launchex Prizes — Awards Landing Page

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single scrolling page for Launchex Prizes, a fictional awards program for
early-stage ventures. The entire experience lives inside a padded, rounded
white "shell" that mimics a native app frame: an inner absolutely-positioned
panel does the actual scrolling with its scrollbar hidden, while a floating
pill-shaped nav, a bottom-left "Scroll to discover" hint, and a bottom-right
page counter stay pinned to the shell itself so they never move. Three
sections scroll inside that frame — a full-bleed video hero, a three-column
submissions gallery, and a founder stats block — each revealing its content
with a staggered fade-up as it enters view.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, award
   categories, founder copy, and stat figures. Swap the two vendored clips
   (hero background, submissions loop) and the three stat-card images for
   footage/imagery of matching aspect ratio and mood.
3. **Preserve the design system.** The rounded app-shell frame, the pinned
   nav/indicator chrome, the chamfered clip-path cards, and the teal/ocean
   palette are the identity — do not flatten the shell into a normal
   full-bleed page or swap the clip-path corners for plain rounded rectangles
   without being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. The nav references five destinations (About,
   Submissions, Venue, Judges, Connect) but only the first two have sections
   in this build — a "Venue" or "Judges" section should be designed from
   scratch in this template's own vocabulary if the user wants it filled in.
5. **Keep motion accessible.** Every reveal animation and both looping videos
   must stay behind `prefers-reduced-motion`, exactly as the build spec below
   requires.

## Build spec

### Palette tokens

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--primary-dark` | `#154359` | Body copy, headings, nav links' resting ink on light sections |
| `--teal-accent` | `#066377` | Hero CTA chip fill, nomination-card border tint (at 25% alpha) |
| `--grad-a` / `--grad-b` | `#185B7B` / `#4BBDF0` | The stat-value gradient-text stops — the page's one true chromatic gradient |
| `--bg-nominations` | `#F0F0F0` | Submissions section background |
| `--bg-about` | `#F0F5F7` | About/founders section background, and the fade-to-color target both bottom fades resolve into |

Every `.stat-value` uses
`background-image: linear-gradient(294deg, var(--grad-a) 20%, var(--grad-b))`
with `background-clip: text` — the only brand-accent gradient on the page, so
it's the one built entirely from `var()` stops. The hero's video overlay and
the two section-transition fades are neutral black/white-based scrims, left
as literal `rgba()` stops by design (neutral scaffolding, not brand accent).

### Typography

Body font is **Inter** (Google Fonts, weights 300–700). Display headings use
**Space Grotesk** (weights 400–700) substituted for the prompt's original
`TT Firs Neue`, a paid webfont not on Google Fonts — Space Grotesk was chosen
as the nearest open equivalent: a squared-off geometric sans with the same
tight, confident tracking the brief called for at large display sizes.

### Layout

**Outer shell:** `body` carries `12px` padding (`20px` from 640px up); `.shell`
is a `position: relative` box at `calc(100dvh - padding*2)` with
`border-radius: 28px` (`36px` from 640px up) clipping everything inside it.
`.scroll-area` is `position: absolute; inset: 0` with `overflow-y: auto` and
a hidden scrollbar — this is the only element that actually scrolls.

1. **Hero** (`min-height: 100%` of the scroll area, so it fills the shell on
   load) — a full-bleed looping `<video>` (`object-fit: cover`) under a
   soft black top/bottom scrim, a top bar with an inline sparkle-mark
   wordmark ("launchex / awards") on the left and a chamfered teal
   `clip-path` CTA chip on the right ("Send in your entry form", collapsing
   to "Enter" under 640px), and centered hero copy (eyebrow, two-line
   lowercase display heading, uppercase subhead).
2. **Submissions** — a three-column grid (stacks to one column, video-first,
   under 1024px): two three-card nomination columns flank a center column
   with a `[submissions]` eyebrow, a large uppercase heading, and a square
   looping video. Each nomination card is an `<a>` with an inline chamfered-
   rectangle SVG border (a shared `<polygon>` referenced via `<use>`) and
   centered two-line text. A bottom fade blends the section into the next
   section's background color.
3. **About the founders** — a heading/copy split (stacks under 1024px) with
   two paragraphs and a link with a small chamfered arrow box, followed by a
   three-card stat grid. Each stat card is a `<figure>`-like `<article>` with
   a unique angular `clip-path` (matching outer border + inner image), an
   `<img>` blended `mix-blend-mode: plus-darker` against a translucent white
   backing, and an absolutely-positioned text block with a gradient-filled
   numeral. The second card is pushed down `96px` on desktop for the
   staggered-height look. A matching bottom fade closes the section.

**Persistent chrome** (siblings of `.scroll-area`, not inside it): a
`display: none` until 768px floating pill `<nav>` with two `radial-gradient`
mask "notches" that carve an inverted-corner illusion into its underside; a
bottom-right `01 — 05` page counter; a bottom-left "Scroll to discover" hint.
Both bottom-corner elements use `mix-blend-mode: difference` so their white
text stays legible over both the dark video and the light sections beneath
it as the page scrolls.

### Motion inventory

- **Staggered reveals**: every eyebrow, heading, paragraph, nomination card,
  and stat card carries a `.reveal` class (`opacity: 0`, `translateY(24px)`)
  that an `IntersectionObserver` (scoped to `.scroll-area` as its root)
  flips to `.in-view` the first time it crosses 15% visibility — a single
  700ms `cubic-bezier(0.23, 1, 0.32, 1)` fade-up, never repeated.
- **Hover motion**: nomination cards lift `-2px` on hover; the hero CTA chip
  brightens (`filter: brightness(1.25)`) and its arrow icon nudges up-right;
  the about-section link's chamfered arrow box lifts `-2px` — all via CSS
  transitions on `transform`/`filter`, 200–300ms, never scaling from 0.
- **Ambient loops**: the hero and submissions videos autoplay, loop, and stay
  muted via HTML attributes; a small inline script also calls `.play()`
  defensively.
- **`prefers-reduced-motion: reduce`**: all `.reveal` transitions are
  disabled and content renders fully visible with no transform; both videos
  are hidden in favor of their vendored poster-frame `<img>` fallbacks; hover
  transforms on cards and the link arrow box are disabled.

### Assets

- `assets/hero-bg.mp4` — the CloudFront hero clip transcoded locally to a
  muted, 720p, ~8s H.264 loop (~825KB), referenced with a plain `<video>` tag
  (no hls.js needed — this asset was never HLS).
- `assets/hero-poster.jpg` — poster frame for the hero video and its
  reduced-motion fallback.
- `assets/submissions-loop.mp4` — the CloudFront submissions clip transcoded
  to a muted 720×720 loop (~2MB).
- `assets/submissions-poster.jpg` — poster frame for the submissions video
  and its reduced-motion fallback.
- `assets/stat-years.webp`, `assets/stat-ventures.webp`,
  `assets/stat-sessions.webp` — the three founder-stat card images
  (abstract chrome/glass sculpture renders, no logos or identifiable marks),
  downloaded as-served (~40–100KB each).

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="stellar-launch-landing" type="text/html" title="Launchex Prizes — Awards Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```
