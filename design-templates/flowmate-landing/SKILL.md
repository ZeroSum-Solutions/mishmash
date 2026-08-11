---
name: flowmate-landing
description: |
  Full landing page for the fictional AI workflow-automation platform
  **FlowMate** — a fixed left sidebar with a logo mark and section nav, a
  translucent blurred navbar, a large serif hero headline, a liquid-glass
  chat-composer card overlaid on a looping ambient video, a six-card feature
  grid, and an auto-rotating three-up cards carousel, all on an off-white
  minimalist palette with one indigo-violet chromatic accent.
tags:
  - "landing-page"
  - "motionsites"
  - "saas"
  - "sidebar-navigation"
  - "glassmorphism"
  - "carousel"
  - "off-white"
triggers:
  - "flowmate"
  - "flow mate"
  - "workflow automation"
  - "ai workflow platform"
  - "sidebar navigation landing page"
  - "liquid glass card"
  - "glassmorphism chat overlay"
  - "typewriter effect"
  - "cards carousel"
  - "saas landing page"
  - "off white minimalist"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=flowmate-landing"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build FlowMate — AI Workflow Automation Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage or screenshots to swap in."
---

# FlowMate — AI Workflow Automation Landing Page

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A full marketing landing page for FlowMate, a fictional AI platform that
turns plain-English requests into automated workflows. Desktop gets a fixed
240px sidebar (logo mark, four-item section nav with scroll-tracked active
state) alongside a fixed, blurred navbar; mobile and tablet drop the sidebar
and run a single full-width navbar. Below that: a big serif hero headline
with a staggered load-in, a rounded video panel wearing a liquid-glass
chat-composer card with a scroll-triggered typewriter line, a six-card
feature grid, and an auto-rotating three-up cards carousel with manual
prev/next controls.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, hero
   copy, feature titles/descriptions, and carousel labels. Swap the sidebar
   logo mark, the ambient video loop, and the five carousel backdrop images
   for assets of matching dimensions and mood.
3. **Preserve the design system.** The off-white background, the near-black
   text scale, the faint green-grey borders, the serif display headline
   paired with a system-sans body, and the single indigo-violet accent are
   the identity — do not swap in a saturated background, a heavier body
   weight, or a different accent hue without being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. If the user wants more sections, design them from
   scratch in this template's own vocabulary (off-white surfaces, 2px
   faint-green borders, rounded-2xl cards, one chromatic accent).
5. **Keep motion accessible.** Every animation — the hero load-in, the
   navbar blur/shadow, the video reveal and typewriter line, the feature
   stagger, and the carousel — must stay behind `prefers-reduced-motion`,
   exactly as the build spec below requires.

## Build spec

### Palette tokens

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#fefffc` | Page and card background |
| `--fg` | `#2c2c2c` | Primary text, headings |
| `--fg-secondary` | `#444141` | Hero subhead, navbar links |
| `--fg-tertiary` | `#646464` | Feature card body copy |
| `--fg-muted` | `#b4b8b4` | Inactive sidebar nav labels |
| `--border` / `--border-soft` / `--border-faint` | `#dde3dd` / `#dee2de` / `#e8e8e8` | Sidebar/section rules, card borders, section dividers |
| `--border-hover` | `#b8beb8` | Card/button border on hover |
| `--hover-bg` | `#eef1ed` | Active sidebar item, feature icon chips |
| `--btn-black` / `--btn-black-hover` | `#000000` / `#2c2c2c` | Sign-up and hero CTA buttons |
| `--accent` / `--accent-2` | `#4f5bff` / `#8f7bff` | The one chromatic pair — send-button gradient, video glow |
| `--accent-glow-soft` / `--accent-glow-strong` | `rgba(79,91,255,0.16)` / `rgba(79,91,255,0.28)` | Radial glow behind the glass-morphism video card |

The decorative glow behind the video's glass card
(`radial-gradient(circle at 50% 40%, var(--accent-glow-strong) ...)`) and the
send-button fill (`linear-gradient(135deg, var(--accent), var(--accent-2))`)
are the page's two chromatic gradients. The glass card's own white
translucency gradient and the carousel's black text-legibility overlay stay
on literal white/black stops since they're neutral scaffolding, not brand
accent surfaces.

### Typography

Headline font is **Fraunces** (Google Fonts, weights 500/600), substituted
for the prompt's original `PPMondwest` — a proprietary display serif served
from a third-party CDN, not available on Google Fonts. Fraunces was chosen
as the nearest open equivalent: a soft, slightly eccentric serif that reads
as a distinct display face against the plain-sans body, matching the
original's "custom serif wordmark + headline" role. Letter-spacing is
tightened to `-0.02em` (softer than the prompt's `-0.04em`, since Fraunces'
metrics are looser than PPMondwest's and the tighter value caused glyph
crowding). Body copy, nav labels, buttons, and card text use a system-font
stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica,
Arial, sans-serif`), matching the prompt's "system fonts as fallback" note.

### Layout

1. **Sidebar** (`≥1024px` only) — fixed, 240px, full height, 2px right
   border, logo mark + wordmark at top, four nav links (Home/Video/
   Features/Cards). Active item gets `--hover-bg` fill and `--fg` text;
   inactive items are `--fg-muted`. An `IntersectionObserver` with a
   `-40%/-50%` root margin band tracks which section is centered in the
   viewport and toggles `.active` accordingly.
2. **Navbar** — fixed top, `left: 0` on mobile/tablet, `left: 240px` on
   desktop, translucent `rgba(254,255,252,0.9)` background with
   `backdrop-filter: blur(10px)`, gains a bottom border once the page
   scrolls. Wordmark left; Pricing/Community links (hidden below 768px),
   Log-in (outline pill) and Sign-up (solid black pill) right.
3. **Hero** (`#home`) — serif headline (`clamp(2rem, 0.6rem + 6vw,
   4.375rem)`, line-height 0.95, max-width 900px/700px on desktop), a
   `--fg-secondary` subhead (max-width 620px/520px), and a solid-black CTA
   pill with a hand-drawn arrow icon that anchors to `#video`.
4. **Video / liquid-glass section** (`#video`) — a `16:9` rounded video
   panel (the vendored ambient loop) with a radial accent glow layered
   beneath a centered glass card: `backdrop-filter: blur(16px)`, a white
   translucency gradient, a 6px semi-transparent white border, and glass
   shadow/inset-highlight. Inside: a typewriter-revealed line of chat text
   and a faux composer row (paperclip icon button, gradient-filled circular
   send button with an up-arrow).
5. **Features grid** (`#features`) — section title, then a responsive grid
   (1/2/3 columns) of six cards: 2px `--border-soft` border, `--border-hover`
   on hover, generic circular icon chips at the bottom of five of the six
   cards (one card ships no icon, matching the source spec). The two
   multi-icon cards use generic task-board/chat-bubble and mail/calendar
   glyphs rather than any specific third-party product's marks.
6. **Cards carousel** (`#cards`) — section title plus round prev/next
   buttons, then a 500px-tall (420px mobile) three-up carousel (one-up under
   768px) of five backdrop-image cards with a bottom gradient scrim and
   overlay label/heading. Auto-advances every 4s, pauses on hover, and wraps
   seamlessly via a tripled card array.

### Motion inventory

- **Hero load-in**: headline, subhead, and CTA fade up
  (`opacity 0→1`, `translateY(18px)→0`) over 700ms, staggered 0.05s/0.2s/0.35s,
  `cubic-bezier(0.23, 1, 0.32, 1)` — pure CSS, plays on load.
- **Navbar**: gains a bottom border once `scrollY > 4`; sidebar active state
  updates via `IntersectionObserver` as the user scrolls.
- **Video reveal**: the video panel fades/scales in
  (`opacity 0→1`, `translateY(24px)→0`, `scale(0.98)→1`, 700ms) once 35% in
  view; the glass card's message types out at 50ms/character via `setInterval`
  the first time the panel is observed.
- **Feature cards**: each card fades up individually on scroll, staggered
  70ms apart per card, once 15% visible.
- **Carousel**: autoplay advances one card every 4000ms
  (`transform: translateX(...)`, 600ms, `cubic-bezier(0.32, 0.72, 0, 1)`),
  pauses on hover, and both autoplay and the manual prev/next buttons drive
  the same tripled-array index with a no-transition snap-back once the index
  drifts past the middle copy — so the loop never visibly jumps.
- **`prefers-reduced-motion: reduce`**: hero fade-up elements render fully
  visible with no transform; the video panel, feature cards, and carousel
  viewport lose their opacity/transform transitions and render in their
  final state immediately; the background video is hidden in favor of its
  vendored poster frame; the typewriter caret stops blinking and the message
  is set in one shot instead of typed; the carousel track's transform still
  moves on manual/auto advance but without a CSS transition (instant snap).

### Assets

- `assets/logo.webp` (240×240) — the vendored sidebar/wordmark mark.
- `assets/card-everyone.webp`, `card-teams.webp`, `card-enterprises.webp`,
  `card-platform.webp`, `card-security.webp` (640×857 each) — the five
  vendored carousel backdrop images.
- `assets/video.mp4` — the source clip transcoded locally to a muted,
  720p H.264 loop (~1.7MB, 10s), referenced with a plain `<video>` tag (no
  hls.js).
- `assets/video-poster.jpg` — poster frame for the video, doubling as the
  reduced-motion static fallback.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="flowmate-landing" type="text/html" title="FlowMate — AI Workflow Automation Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```
