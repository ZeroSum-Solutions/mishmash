---
name: veloce-finance-landing
description: |
  Four-section fintech landing page for **veloce**, a payments app, built on a
  pure-white canvas with one signature three-stop brand gradient (rust →
  plum → indigo) reserved for gradient-text moments. A full-viewport hero
  layers a muted looping product-shot video behind a blur-in headline and a
  pair of app-download badges; a white insights section stacks two large
  rounded stat cards with looping abstract-motion video backdrops; a closing
  section reveals a paragraph-length line of copy in the brand gradient as
  the visitor scrolls past it, letter by letter, left to right.
tags:
  - "landing-page"
  - "motionsites"
  - "fintech"
  - "saas"
  - "gradient-text"
  - "video-background"
  - "scroll-reveal"
triggers:
  - "veloce"
  - "fintech landing page"
  - "payments app landing"
  - "finance app hero"
  - "gradient text reveal"
  - "scroll fill text"
  - "stat cards video"
  - "app download badges"
  - "blur in headline"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=veloce-finance-landing"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build veloce — Fintech Landing Page as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage to swap in."
---

# veloce — Fintech Landing Page

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single-scroll landing page for veloce, a fictional payments app. Four
sections run top to bottom: a sticky header nested inside a full-viewport
video hero, a white insights block built from three large stat cards, and a
closing section where a full line of copy fills in with the brand gradient
as the visitor scrolls past it. The palette stays white-and-navy throughout,
with one rust-to-plum-to-indigo gradient reserved for the two moments that
need emphasis — the hero's closing word and the final scroll-fill line — so
it reads as a deliberate accent rather than a decoration.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headline,
   subhead, stat numbers/descriptions, and the closing scroll-fill line.
   Swap the four vendored clips (hero background, three stat-card loops) for
   footage of matching aspect ratio and mood — keep the hero clip muted/
   looped and the stat-card clips short ambient loops.
3. **Preserve the design system.** The white background, the navy ink text,
   the single three-stop brand gradient, and the generous rounded-corner
   (40px) stat cards are the identity — do not introduce a second accent
   hue, a dark theme, or sharp corners without being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. If the user wants more sections, design them from
   scratch in this template's own vocabulary (white canvas, navy ink, one
   chromatic gradient, generous rounded corners).
5. **Keep motion accessible.** The blur-in reveals, the staggered stat-card
   fade-ups, the mobile-menu slide-in, and the scroll-driven gradient fill
   must all stay behind `prefers-reduced-motion`, exactly as the build spec
   below requires.

## Build spec

### Palette tokens

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--ink` | `#00041F` | Body text, logo, headline, stat numbers, CTA fill |
| `--gray` | `#49484F` | Subhead and description copy |
| `--light` | `#EFF4FF` | Sign-up button label color |
| `--white` | `#ffffff` | Page and card background |
| `--accent-a` | `#B56939` | Brand gradient, stop 1 (rust) |
| `--accent-b` | `#5C3779` | Brand gradient, stop 2 (plum) — the only place this hue appears; the rest of the page is white/navy/gray by design |
| `--accent-c` | `#454BBB` | Brand gradient, stop 3 (indigo) |
| `--fill-base` | `#B8B7BA` | Resting (unfilled) color of the closing scroll-fill line |

The two `.gradient-text` / `.fill-top` treatments (`linear-gradient(90deg,
var(--accent-a), var(--accent-b), var(--accent-c))`, clipped to text) are the
page's only chromatic gradients. The hero's bottom fade-out
(`linear-gradient(to top, var(--white), transparent)`) is neutral scaffolding
and stays literal white by design.

### Typography

**Manrope** (Google Fonts, weights 400–800) carries the logo. **Inter**
(Google Fonts, weights 400–700) is used everywhere else — body copy, nav,
buttons, the hero headline, stat numbers, and the scroll-fill line. The
source prompt specified five families (Manrope, Helvetica, Helvetica Neue,
Inter, Product Sans, SF Compact Display); only Manrope and Inter are on
Google Fonts. The other four were used solely for secondary/small text
(nav links, badge micro-copy, headline weight) in the original spec, so they
are consolidated onto Inter — the nearest neutral grotesque equivalent —
rather than adding three more font files for text that reads the same at
these sizes and weights.

### Layout

**Header** (`position: sticky`, nested inside the hero so it scrolls away
with it) — logo left; centered nav (`Home` / `About us` / `Faq`) and `Log
in` / `Sign up` pill button on the right at desktop widths; a two-icon
hamburger toggle below 1024px opens a white dropdown panel with staggered
nav links and the same login/signup actions below a divider.

**Hero** — full-viewport section with a muted looping video filling the
frame edge to edge (`object-fit: cover`, cropped further right on mobile to
keep the subject centered), a bottom white-to-transparent fade for
legibility, a centered two-line headline ("Fast payments, your way at
**lightspeed.**" — the second phrase in the brand gradient), a subtitle, and
two app-download badges (generic download/device glyphs — see De-branding
below).

**Insights section** — white background; a left-aligned heading + paragraph
block, then three stat cards in a row (stacked on mobile): each is a
2.5rem-radius rounded panel with a looping video backdrop, a tinted color
overlay, and a stat number + description pinned to the bottom-left. The
middle card runs shorter (350px vs. 450px min-height) so the row reads as
uneven, matching the source composition.

**Scroll-fill section** — a centered paragraph-length line of copy rendered
twice, stacked: a light-gray base layer always visible, and a brand-gradient
layer clipped by an inline `clip-path` inset that grows from 0% to 100% as
the section crosses the middle of the viewport. A 30vh bottom margin closes
the page with deliberate white space rather than a footer — the source spec
has no footer, so none was invented.

### Motion inventory

- **Blur-in reveal**: the hero headline and the insights heading start at
  `filter: blur(20px); opacity: 0` and settle to sharp/opaque over 1.2s
  (`cubic-bezier(0.23, 1, 0.32, 1)`), triggered once via
  `IntersectionObserver` at 15% visibility.
- **Stat-card stagger**: the three cards start `opacity: 0,
  translateY(30px)` and animate to visible over 0.6s, staggered 0.2s apart,
  triggered once when the card row crosses 20% visibility.
- **Mobile menu**: the panel fades/slides in (`opacity 0, translateY(-20px)`
  → visible) over 0.3s; its nav links stagger 0.1s apart via a
  `transition-delay` custom property. The hamburger's two icon glyphs
  cross-fade/rotate over 0.2s.
- **Scroll-driven gradient fill**: an `rAF`-throttled `scroll`/`resize`
  listener recomputes the closing line's `clip-path` inset every frame the
  section is between 80%/20% of the viewport height from the top, so the
  gradient sweeps in sync with scroll position rather than playing once.
- **`prefers-reduced-motion: reduce`**: all four reveal animations resolve
  to their end state instantly (no blur, no translate, no scroll listener —
  the gradient line renders fully filled), and every autoplaying `<video>`
  is paused and hidden in favor of its vendored poster-frame `<img>`
  fallback.

### De-branding

The source prompt's two app-download badges used the literal Google Play
triangle mark and the bitten-apple App Store mark as baked-in images. Both
are real trademarks, so this build replaces them with two original inline
SVG glyphs (a generic download arrow, a generic device outline) and generic
copy ("Marketplace" / "App Gallery") instead of vendoring the marks.

### Assets

- `assets/hero-bg.mp4` / `assets/hero-poster.jpg` — the hero's looping
  background clip (floating debit-card product shot, no visible branding),
  downscaled to 720p and re-encoded (~167KB) from the original 5.2MB source.
- `assets/card-members.mp4`, `assets/card-transfers.mp4`,
  `assets/card-nations.mp4` — the three stat-card background loops
  (abstract gradient-blob motion), each downscaled to 720p and re-encoded to
  90–140KB from 7.6–8.7MB sources, plus a matching `-poster.jpg` for each.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="veloce-finance-landing" type="text/html" title="veloce — Fintech Landing Page">
<!doctype html>
<html>...</html>
</artifact>
```
