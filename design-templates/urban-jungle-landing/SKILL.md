---
name: urban-jungle-landing
description: |
  Scroll-driven, single-hero landing page for **Urban Jungle**, a fictional
  biophilic design studio that reclaims concrete cityscapes with living
  greenery. A fixed full-bleed video of a plant-choked transit car scrubs
  frame-by-frame as the visitor scrolls, a huge display headline ("Unleash
  The Full Power") fades apart character by character over the first
  stretch of scroll, and a frosted glass "About Us" panel slides up from
  below to close the page with a serif mission statement and a looping text
  marquee of fictional studio partners. A pill-shaped floating nav with a
  liquid black hover-fill sits fixed at the top throughout.
tags:
  - "landing-page"
  - "motionsites"
  - "scroll-driven"
  - "video-hero"
  - "glassmorphism"
  - "biophilic"
triggers:
  - "urban jungle"
  - "biophilic design"
  - "scroll driven hero"
  - "scroll scrub video"
  - "glass panel about section"
  - "pill navigation"
  - "liquid hover nav"
  - "landscape studio landing"
  - "green city agency"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=urban-jungle-hero"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Urban Jungle — Biophilic Design Studio as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage to swap in."
---

# Urban Jungle — Biophilic Design Studio

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single scroll-driven experience for Urban Jungle, a fictional studio that
turns concrete cityscapes into living greenery. The page is one tall
(`500vh`) scroll stage on a black backdrop: a fixed full-bleed video scrubs
through its footage as the visitor scrolls, a giant display headline fades
apart into the frame over the first stretch of scroll, and a frosted glass
panel slides up from below to reveal the studio's mission statement and a
looping marquee of partner names. A pill-shaped nav floats fixed at the top
of the viewport for the entire scroll.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headline
   lines, mission statement, and partner/client names. Swap the background
   clip for footage of a similar aspect ratio and pacing — the scroll-scrub
   motion works best with a clip roughly 5–10 seconds long.
3. **Preserve the design system.** The black backdrop, the oversized display
   headline that dissolves on scroll, the frosted glass "about" panel, the
   single green chromatic accent, and the pill nav's liquid-fill hover are
   the identity — do not swap in a bright background, a static (non-scroll)
   hero, or a different nav shape without being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. This template ships one scroll-driven hero and one
   about panel by design; if the user wants more sections below it, design
   them from scratch in this template's own vocabulary (black backdrop,
   serif mission copy, one green accent, glass surfaces).
5. **Keep motion accessible.** The scroll-scrub video, the character fade,
   the panel slide-up, the mouse parallax, and the marquee all fall back to
   a fully static page under `prefers-reduced-motion`, exactly as the build
   spec below requires.

## Build spec

### Palette tokens

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#000000` | Page background |
| `--fg` | `#ffffff` | Headline, panel heading, nav-pill hover text |
| `--muted` | `rgba(255,255,255,0.68)` | "About Us" eyebrow |
| `--panel-bg` / `--panel-border` | `rgba(6,8,7,0.28)` / `rgba(255,255,255,0.12)` | Glass panel fill and hairline border |
| `--nav-pill-bg` / `--nav-pill-fg` | `#f0f0f0` / `#050505` | Nav pill resting state (literal, matches the brief's black/white nav) |
| `--accent` / `--accent-b` | `#8fd35c` / `#3f9e5c` | The one chromatic pair — ambient glow behind the headline and the gradient-text treatment on "urban / nature / bloom" |
| `--accent-glow-soft` / `--accent-glow-strong` | `rgba(143,211,92,0.16)` / `rgba(143,211,92,0.32)` | Radial ambient glow stops behind the hero video |

Two gradients reference these tokens: the radial `ambient-glow` behind the
video (`--accent-glow-strong` → `--accent-glow-soft` → transparent) and the
`linear-gradient(var(--accent), var(--accent-b))` used as a text-fill on the
three italic accent words in the about heading. The dark scrim over the
video and the marquee's edge mask are literal black/transparent gradients —
neutral scaffolding, left literal by design.

### Typography

- **Headline (`Anton`, Google Fonts)** — substituted for the source brief's
  `Dirtyline 36 Days of Type 2022`, a bespoke hand-crafted display face from
  a type-a-day project that isn't on Google Fonts. Anton was chosen as the
  nearest ultra-bold, geometric, all-caps-scale display face that reads with
  the same monumental weight at `clamp(3.2rem, 15vw, 19.8rem)`.
- **Body/UI (`Manrope`, weights 400/500/600/700)** — nav pills, marquee
  items, loading text.
- **Serif accent (`Instrument Serif`, italic + regular)** — the "About Us"
  eyebrow and the mission-statement heading in the glass panel.

### Layout

1. **Fixed video stage** (`z-index: 0`) — a full-bleed `<video>`
   (`object-fit: cover`, scaled up 15% for parallax headroom) with a dark
   scrim gradient for text legibility and a green `ambient-glow` radial
   wash near the bottom. The stage itself carries the poster image as a CSS
   background so a failed/blocked video still shows the scene.
2. **Loading overlay** (`z-index: 50`) — a full-black overlay reading
   "Loading… N%", tracking the video's buffered ranges; hides on `canplay`
   (or a 4s safety timeout) and is force-hidden via `<noscript>`.
3. **Pill navigation** (`z-index: 100`, fixed top-center) — a 48px circular
   logo button with a four-petal SVG mark that spins 360° on hover, plus a
   black pill-list of HOME / ABOUT / SERVICES / CONTACT. Each pill fills
   with black from the bottom on hover/focus while its label swaps to white
   (pure CSS, no JS). Below 768px the pill list is replaced by a hamburger
   button that opens a popover menu.
4. **Hero overlay** (`z-index: 10`, fixed, bottom-anchored) — the headline
   "Unleash The" / "Full Power", split into per-character `<span>`s at
   runtime (with a visually-hidden accessible duplicate for screen
   readers). HOME/ABOUT links point at real `#top` / `#about` anchors.
5. **About panel** (`z-index: 20`, absolutely positioned at the bottom of
   the 500vh scroll stage) — a `max-width: 1250px`, `min(900px, 85vh)`
   glass card (`backdrop-filter: blur(60px)`) that slides up into view over
   the last ~1.4 viewport-heights of scroll. Inside: the "About Us" eyebrow,
   a serif mission statement with three gradient-accented italic words, and
   a bottom marquee of five fictional partner names (Meridian, Northgate,
   Cascadia, Atlasworks, Halcyon — invented to replace the source brief's
   real SaaS-company placeholders).

### Motion inventory

- **Scroll-scrub video**: `video.currentTime` is driven directly by overall
  scroll progress (`0` at the top of the page, full duration at the
  bottom), guarded by a seek-pending pattern so a slow decoder never gets
  hammered with overlapping seeks.
- **Headline dissolve**: each character fades `opacity 1→0` and animates
  `translateY 0→130%`, `scaleY 1→1.2`, `scaleX 1→0.9` over the first ~820px
  of scroll, staggered 14px per character (quadratic ease-in-out).
- **Panel reveal**: the glass panel's wrapper translates from `100%` to `0%`
  over the final 1.4 viewport-heights of scroll.
- **Mouse parallax** (fine-pointer devices only): the video stage drifts
  opposite the cursor (`±26px`); the glass panel gets a subtle 3D tilt
  (`±3deg` rotate, `±12px` translate) via a separate inner element so it
  doesn't fight the scroll-driven slide transform on its wrapper.
- **Nav**: pills fill black from the bottom on hover/focus with a
  synchronized label swap (`0.3s`, repo ease-out); the logo mark spins
  `360deg` over `0.5s`; the whole nav fades/scales in once on load
  (`scale(0.94)→scale(1)`, never from `0`).
- **`prefers-reduced-motion: reduce`**: every transition/animation
  collapses to near-zero duration, the scroll-linked JS updates (video
  scrub, character fade, panel slide, mouse parallax) are skipped entirely,
  the `<video>` is hidden in favor of its poster frame, and the marquee
  stops scrolling — a fully static page that still reads correctly top to
  bottom.

### Assets

- `assets/bg-hero.mp4` — the CloudFront source clip (a plant-overgrown
  transit-car interior) downloaded and transcoded to a muted, 720p,
  ~6-second H.264 loop (~3.7MB) with `ffmpeg`, referenced with a plain
  `<video>` tag (no hls.js). The source prompt's app-assembly snippet wired
  a different Mux `.m3u8` stream for the same shot; the CloudFront `.mp4`
  named in the component spec was used instead, per the resolved
  conflicting-source note for this slug.
- `assets/bg-poster.jpg` — first-frame poster, also used as the video
  stage's CSS background fallback.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="urban-jungle-landing" type="text/html" title="Urban Jungle — Biophilic Design Studio">
<!doctype html>
<html>...</html>
</artifact>
```
