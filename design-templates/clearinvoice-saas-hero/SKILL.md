---
name: clearinvoice-saas-hero
description: |
  Full-viewport dark SaaS hero with navbar for the fictional billing platform
  **ClearInvoice**. A muted, looping product-motion video fills the black
  backdrop behind a glassy translucent navbar (logo, centered links, auth
  buttons, hamburger dropdown on mobile), a five-pixel lavender-to-gold-to-
  green gradient strip pinned to the very top, a tight three-word-wrap
  headline, a gradient glass CTA pair (orange gradient primary with a
  sliding arrow, frosted-white secondary), and a three-avatar social-proof
  row. Everything fades up on load with a short stagger; motion collapses to
  a static poster frame under reduced motion.
tags:
  - "landing-page"
  - "motionsites"
  - "saas"
  - "hero-section"
  - "dark-mode"
  - "video-background"
triggers:
  - "clearinvoice"
  - "clear invoice"
  - "saas hero"
  - "billing hero"
  - "invoice landing page"
  - "dark hero section"
  - "video background hero"
  - "gradient button hero"
  - "navbar with hamburger"
  - "social proof avatars"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=3"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build ClearInvoice — SaaS Hero Section as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage to swap in."
---

# ClearInvoice — SaaS Hero Section

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single full-viewport hero for ClearInvoice, a fictional billing SaaS. A
five-pixel gradient strip pins to the very top of the page, a glassy
translucent navbar floats over a muted looping video that fills the frame
edge to edge with no dimming overlay, and the hero content — headline,
subhead, a gradient-and-glass button pair, and a social-proof row — sits
centered over the footage with a short load-in stagger.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, nav
   links, headline, subhead, button labels, and footage. Swap the vendored
   background clip for footage of matching mood — keep it muted, looped,
   and free of a dark overlay.
3. **Preserve the design system.** The black backdrop, the lavender/gold/
   green top-bar gradient, the orange gradient primary button with its
   glassy inner stroke and glow, and the frosted-white secondary button are
   the identity — do not swap in a different accent hue, drop the glass
   strokes, or flatten the gradients to solid fills without being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. This template ships one hero section (with its navbar
   chrome) by design; if the user wants Features/Pricing/Reviews sections
   below it, design them from scratch in this template's own vocabulary
   (black backdrop, one warm gradient accent, glass buttons).
5. **Keep motion accessible.** The load-in stagger, the CTA hover/arrow
   slide, and the hamburger transition must all stay behind
   `prefers-reduced-motion`, exactly as the build spec below requires.

## Build spec

### Palette tokens

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#07070a` | Page/hero background, avatar borders |
| `--fg` | `#ffffff` | Headline, logo, primary-button text |
| `--muted` | `rgba(255,255,255,0.7)` | Nav links, sign-in link, social-proof caption |
| `--subhead` | `rgba(255,255,255,0.9)` | Hero subhead ("white/90" in the source brief) |
| `--grad-a` / `--grad-b` / `--grad-c` | `#ccccff` / `#e7d04c` / `#31fb78` | Top-bar gradient stops (lavender → gold → green) |
| `--accent-a` / `--accent-b` | `#ff3300` / `#ee7926` | Primary-button gradient fill and logo mark |
| `--accent-glow` / `--accent-glow-strong` | `rgba(234,88,12,0.2)` / `rgba(234,88,12,0.6)` | Primary-button backglow, resting vs. hover |
| `--glass-border` | `rgba(255,255,255,0.2)` | Primary button's inner glassy stroke |
| `--glass-border-dark` | `rgba(0,0,0,0.05)` | Secondary button and Sign Up pill's inner stroke |
| `--nav-bg` | `rgba(7,7,10,0.55)` | Translucent navbar fill over the video |

The top bar and both buttons are the page's three `linear-gradient()`
declarations, and all three reference `var()` stops so a client recolor
changes the top-bar hues and the CTA gradient together.

### Typography

Headings use **Manrope** (Google Fonts, weights 500–800) substituted for
the prompt's original **Switzer** — a commercial grotesque not on Google
Fonts. Manrope was chosen as the nearest open equivalent: a geometric sans
with the same tight, medium-weight character. Body copy uses **Geist**,
matching the source brief exactly — Google added it to the Google Fonts
catalog, so no substitution was needed. The hero headline runs at
`font-weight: 600` rather than the brief's "medium" (500): at the
`clamp(2.1rem, 6.4vw, 4.4rem)` display size a true 500 read too thin against
the video backdrop, and 600 keeps the geometric character while holding
contrast. The nav logo and Sign Up label stay closer to the brief's
medium/bold range.

### Layout

1. **Top bar** — a `position: fixed` 5px strip at `z-index: 60`, the page's
   lavender-to-gold-to-green gradient, sitting above everything including
   the navbar.
2. **Navbar** — `position: fixed` just below the top bar, `z-index: 50`.
   Inside a `max-width: 84rem` centered bar with a translucent
   `backdrop-filter: blur(14px)` fill:
   - Logo left: a small gradient-filled mark (orange gradient, three-line
     invoice glyph) plus the wordmark "ClearInvoice".
   - Links centered (absolutely positioned on the same viewport center
     line as the logo/auth flex row): Features, Pricing, Reviews.
   - Auth right: a muted "Sign In" text link and a white pill "Sign Up"
     button.
   - Below 860px, links and auth buttons hide in favor of a hamburger
     button (three bars morphing to an X) that expands a full-width
     dropdown panel containing all five items stacked.
3. **Hero** — one `<section>`, `min-height: 100vh`, flex-centered:
   - **Background video** — full-bleed `<video>` (`position: absolute;
     inset: 0; object-fit: cover; z-index: 0`), autoplay/loop/muted/
     playsinline, no overlay, full opacity, exactly as the brief specifies.
     A poster `<img>` fallback sits behind it for the reduced-motion path.
   - **Headline (`<h1>`)** — single line, `clamp(2.1rem, 6.4vw, 4.4rem)`,
     line-height `1.05`, letter-spacing `-0.02em`.
   - **Subhead (`<p>`)** — one sentence, `max-width: 34rem`,
     `var(--subhead)`.
   - **Button pair**:
     - *Primary* — orange `linear-gradient(var(--accent-a), var(--accent-b))`
       fill, an `inset` 1.5px `var(--glass-border)` stroke for the glassy
       edge, a blurred backglow behind the button (`opacity: 0.2` at rest,
       `0.6` on hover), `scale(1.05)` on hover, and an arrow icon that grows
       in from `width: 0` / `translateX(-8px)` / `opacity: 0` to full width
       and position on hover — the brief's "arrow slides in from the left."
     - *Secondary* — `rgba(255,255,255,0.9)` fill with `backdrop-filter:
       blur(10px)`, an inset 1.5px `var(--glass-border-dark)` stroke,
       `scale(1.05)` and solid-white fill on hover.
   - **Social proof** — three overlapping inline-SVG avatar circles
     (each with a 2px `var(--bg)` border and a `-10px` negative margin for
     the overlap) followed by "Trusted by 210k+ stores worldwide."

### Motion inventory

- **Load-in fade-up**: the headline, subhead, button row, and social-proof
  row each animate `opacity 0 → 1` with `translateY(22px) → 0` over 800ms,
  staggered `0.1s` → `0.55s`, easing `cubic-bezier(0.23, 1, 0.32, 1)`.
- **Primary-button hover**: `scale(1.05)`, backglow opacity `0.2 → 0.6`,
  and the arrow icon growing in from the left, all over ~260ms; `scale(1.01)`
  at 140ms on active. Secondary button scales the same way and swaps to
  solid white.
- **Hamburger toggle**: the three bars rotate into an X (`240ms`) and the
  dropdown panel expands via `max-height` (`320ms`), both eased with the
  same curve; a small inline script toggles the open state, closes on link
  click or `Escape`, and returns focus to the toggle button.
- **Ambient loop**: the background video autoplays, loops, and stays muted
  via HTML attributes; the only script on the page also calls `.play()`
  defensively and wires the hamburger.
- **`prefers-reduced-motion: reduce`**: the load-in animations are skipped
  (content renders fully visible, no transform), the button hover
  transforms and the arrow reveal are disabled, and the `<video>` is hidden
  in favor of its vendored poster-frame `<img>` fallback — a fully static
  page. The hamburger and dropdown keep working (no motion to gate there
  beyond a plain toggle).

### Assets

- `assets/hero-bg.mp4` — the Mux HLS stream transcoded locally to a muted,
  720p, 12s H.264 loop (~0.73MB), referenced with a plain `<video>` tag (no
  hls.js).
- `assets/hero-poster.jpg` — poster frame for the background video and its
  reduced-motion fallback.
- The three social-proof avatars are hand-built inline SVGs (flat-color
  circles with a simple person silhouette), not vendored images — the
  source brief describes only generic "user avatars" with no real photo
  reference.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="clearinvoice-saas-hero" type="text/html" title="ClearInvoice — SaaS Hero Section">
<!doctype html>
<html>...</html>
</artifact>
```
