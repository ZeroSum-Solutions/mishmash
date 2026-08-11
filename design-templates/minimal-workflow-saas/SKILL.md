---
name: minimal-workflow-saas
description: |
  Single-viewport light SaaS hero for the fictional workflow-training platform
  **Script**. A full-bleed, pale cinematic video of a calm portrait ringed by
  concentric halos sits behind a minimal navbar, a three-line navy headline,
  a two-line subhead, a dark gradient "Register Now!" pill, and a frosted
  glass card that auto-cycles through nine workflow-learning tasks with a
  soft depth-blur queue trailing beneath it. Motion is a staggered load-in
  fade plus a slow, spring-like task-list scroll; everything degrades to a
  static portrait poster and a frozen task queue under reduced motion.
tags:
  - "landing-page"
  - "motionsites"
  - "saas"
  - "hero-section"
  - "light-mode"
  - "glass-ui"
  - "video-background"
triggers:
  - "script"
  - "minimal workflow saas"
  - "workflow saas hero"
  - "light saas hero"
  - "glass task list"
  - "auto scrolling task queue"
  - "onboarding saas"
  - "training platform hero"
  - "pale video background hero"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=minimal-workflow-saas"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Script — Minimal Workflow SaaS Hero as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage to swap in."
---

# Minimal Workflow SaaS — Script Hero

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single full-viewport hero for Script, a fictional workflow-training SaaS.
The page is one screen: a muted, looping video of a calm portrait ringed by
soft concentric halos fills the frame edge to edge under a light white wash,
a minimal navbar sits on top, and a centered content column carries the
headline, subhead, CTA, and an auto-cycling glass task queue that stands in
for the product's own workflow-tracking UI.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headline
   lines, subhead copy, CTA label, and the nine task-queue strings. Swap the
   background video and its poster frame for footage of matching mood
   (light, calm, portrait-led) and dimensions.
3. **Preserve the design system.** The slate/white/charcoal-navy palette,
   type scale, glass-card treatment, and motion timings in the build spec
   below are the identity — do not substitute fonts, introduce a saturated
   accent color, or strip the glass/blur treatment.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. If a section is missing (e.g. a footer or logo strip),
   design it from scratch in this template's own vocabulary.
5. **Keep motion accessible.** Every animation — the load-in fades, the
   task-list scroll, and the video itself — must stay behind
   `prefers-reduced-motion`, as the build spec requires.

## Build spec

### Palette & tokens

- `--bg` `#f8fafc` — page background (near-white, shows through at the video's edges).
- `--ink` `#0f172a` — headline, nav wordmark, primary text (slate-900; chromatic navy, drives the recolor knob).
- `--ink-soft` `#1e293b` — body text default.
- `--muted` `#64748b` / `--nav-link` `#475569` — subhead and nav-link color (slate-500/slate-600).
- `--border` `#e2e8f0` — nav CTA border (slate-200).
- `--cta-from` `#252a38` / `--cta-to` `#1a1e29` (hover `--cta-hover-from` `#1d212c` / `--cta-hover-to` `#12151e`) — the Register button's dark gradient; both stops are chromatic charcoal-navy.
- `--glass-bg` `rgba(15,23,42,.72)`, `--glass-border` `rgba(255,255,255,.14)` — the task-list's frosted glass card.
- `--tagline` `rgba(15,23,42,.48)` — the closing "All people aligned." line.
- `--ease-out` `cubic-bezier(0.23,1,0.32,1)` for load-in fades; `--ease-task` `cubic-bezier(0.16,1,0.3,1)` for the task-queue's slide (its own distinct, slower-settling curve — part of its character).

No purple/indigo anywhere; the palette is entirely slate, white, and
charcoal-navy, matching the source spec. The one deliberate deviation: the
source prompt specifies a near-white glass tint (`bg-white/[0.08]`) for the
task-list card. The vendored background footage is uniformly pale across its
whole 10-second loop (a light portrait study, not a dark scene), so a
near-white glass card with white text on top of it would be illegible.
The card was rebuilt as a dark slate glass (`--glass-bg`) instead, which
keeps the "frosted card floating on the video" concept and the exact
opacity hierarchy the source spec calls for (1.0 / 0.7 / 0.55 → 0.04 as
distance from the active row increases) while staying legible. The tagline
line below the card was darkened for the same reason.

### Type

Google Inter (400/500/600/700), matching the source spec exactly — no
substitution needed. Headline `clamp(2.25rem, 45px)`, subhead
`clamp(12px, 13px)`, task-queue active row `clamp(12.5px, 13px)` / inactive
`clamp(11.5px, 12px)`.

### Layout, top to bottom

1. **Background layer** — absolute, full-bleed `<video>` (muted, looped,
   `object-fit: cover; object-position: bottom`, 98% opacity) with a poster
   fallback image, plus a `rgba(255,255,255,.05)` wash + 2px blur overlay on
   top of it.
2. **Navbar** — brand wordmark "Script" with a small three-bar mark rotated
   −15°; five centered nav links (Resources / Service / Support / Developers
   / Updates, hidden below 768px); a pill "Join us" button (translucent
   white, blurred, bordered) on the right.
3. **Hero column** (centered, fills the remaining viewport height):
   - Three-line navy headline.
   - Two-line muted subhead.
   - "Register Now!" pill button with a chevron, dark gradient fill and an
     inset highlight + drop shadow.
   - The glass task-list widget (see below).
   - A small "All people aligned." closing line.
4. **No footer, no logo strip** — the source prompt documents a `LogoCloud`
   component but marks it as not rendered by the current page, so this
   build stays a single-screen hero, matching what actually ships.

### The task-list widget

A 340px (420px ≥768px) wide, 220px tall window. A static frosted glass strip
sits at the top with a small white icon chip (a mini three-bar mark). Behind
it, nine fictional workflow-learning tasks scroll upward one at a time: the
active task shows an uppercase "Learn the step" label plus the full-opacity
task text; the next five rows recede in a fixed opacity/blur/offset table
(0.55/0.36/0.22/0.11/0.04, blur 0.2px→1.1px) that reproduces the source
spec's depth cue exactly. The list is a tripled 27-item loop (9 tasks × 3)
that advances one row every 4.5s over a 1s `--ease-task` transition, then
silently teleports back to the start once it clears the second copy so the
motion reads as infinite. The nine tasks are the source spec's tool-tutorial
style ("How to X in Y") with the real third-party product names
(Python/Excel/GitHub/Asana/Sheets/Slack/Canva/Jira) replaced by fictional
stand-ins (Forge/Ledger/DevHub/Flowboard/Gridspace/Huddle/Palette/Trackly)
per the de-branding rule.

### Motion inventory

- Load-in: headline / subhead / CTA fade up (`translateY(20px)→0`,
  `--ease-out`, staggered 0s/0.2s/0.4s); task-list scales in from 0.95→1 at
  0.6s; tagline fades in at 1s. All `both`-filled so nothing flashes before
  its delay.
- Task queue: JS-driven position/opacity/blur cross-fade on a 4.5s cadence,
  `--ease-task` easing, with the `is-active` class (and its "Learn the
  step" label) following the currently-centered row every tick — not fixed
  to the DOM element that started active.
- Interaction: Register button presses to `scale(0.96)`; nav CTA and links
  cross-fade color on hover.
- `prefers-reduced-motion: reduce` swaps the video for its poster frame,
  removes every load-in/scale/fade animation (elements render in their
  final state immediately), and freezes the task queue on its first row
  (the JS scheduler never starts, so no rows cycle).

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="minimal-workflow-saas" type="text/html" title="Minimal Workflow SaaS — Script Hero">
<!doctype html>
<html>...</html>
</artifact>
```
