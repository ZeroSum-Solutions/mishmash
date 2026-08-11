---
name: liquid-glass-agency
description: |
  Dark, editorial single-page landing for **Lucent Studio**, a fictional
  AI-powered web design agency. Black backdrop, white type, and a
  glassmorphism ("liquid glass") surface system carry six cinematic muted
  video backgrounds — a hero that hangs a floating video card below a
  fixed pill navbar, a "How It Works" strip, an alternating feature-chess
  pair, a 4-card "Why Us" grid, a desaturated stats band, a 3-card
  testimonial grid, and a closing CTA + footer. A serif-italic display face
  pairs with a light sans body face throughout, and one chromatic periwinkle
  accent drives the ambient glow, logo mark, and glass-button hover ring.
tags:
  - "landing-page"
  - "motionsites"
  - "agency"
  - "glassmorphism"
  - "dark-mode"
  - "video-background"
  - "editorial"
triggers:
  - "liquid glass"
  - "liquid glass agency"
  - "glassmorphism landing page"
  - "web design agency landing"
  - "ai agency hero"
  - "video background landing page"
  - "dark editorial landing"
  - "studio landing page"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=liquid-glass-agency"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Lucent Studio — Liquid Glass Agency Landing as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage to swap in."
---

# Lucent Studio — Liquid Glass Agency Landing

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Dark, editorial single-page landing for **Lucent Studio**, a fictional
AI-powered web design agency. Black backdrop, white type, and a
glassmorphism ("liquid glass") surface system carry six cinematic muted
video backgrounds — a hero that hangs a floating video card below a fixed
pill navbar, a "How It Works" strip, an alternating feature-chess pair, a
4-card "Why Us" grid, a desaturated stats band, a 3-card testimonial grid,
and a closing CTA + footer. A serif-italic display face pairs with a light
sans body face throughout, and one chromatic periwinkle accent drives the
ambient glow, logo mark, and glass-button hover ring.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headline,
   body copy, stats, testimonials, and footage. Match existing video
   dimensions/durations when swapping backgrounds.
3. **Preserve the design system.** The black/white/glass palette, the serif
   italic + light sans type pairing, the liquid-glass surface treatment, and
   the section rhythm in the build spec below are the identity — do not
   substitute fonts, recolor the neutral scaffolding, or strip the glass
   border sheen.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. If a section is missing, design it from scratch in this
   template's own vocabulary.
5. **Keep motion accessible.** Every animation must stay behind
   `prefers-reduced-motion`, as the build spec requires.

## Build spec

### Palette

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` / `--bg-elevated` | `#060708` / `#0b0d10` | Page background; video-fallback backdrop |
| `--fg` | `#ffffff` | Headlines, body-on-dark, solid white buttons |
| `--fg-muted` / `--fg-dim` / `--fg-faint` | `rgba(255,255,255,.62/.42/.24)` | Lede copy, labels, footer text |
| `--accent` | `hsl(213 45% 67%)` | The one chromatic token — logo gradient, ambient glow, badge dot, hover glow |
| `--accent-soft` / `--accent-deep` | `hsl(213 55% 82%)` / `hsl(213 50% 40%)` | Logo-mark gradient stops |
| `--accent-glow` / `--accent-ring` | `hsl(213 60% 65% / .32)` / `hsl(213 60% 72% / .45)` | Ambient radial glow and glass-button hover ring — both `var()`-driven gradients on a brand surface |
| `--glass-bg` / `--glass-border-a` / `--glass-border-b` | `rgba(255,255,255,.01)` / `.45` / `.15` | Liquid-glass fill plus its `mask-composite` border-sheen gradient |

The neutral black/white/grey scaffolding (page background, glass fill, the
video top/bottom fade overlays) stays literal by design — it is the
"near-black/near-white" surface the `chromatic()` filter is meant to leave
alone. The single periwinkle `--accent` family is what a client recolor
actually retints: the logo diamond, the ambient glow blobs behind the hero
and the CTA fallback, and the soft glow that appears behind glass buttons on
hover.

### Typography

Two Google Fonts, an exact match to the source spec (no substitution
needed — both ship natively on Google Fonts):

- **Instrument Serif** (italic) — every heading, at `font-style: italic`,
  used via a `.heading` class.
- **Barlow** (300/400/500/600) — all body copy, labels, nav, and buttons,
  default weight 300.

### Layout

1. **Nav** — fixed floating header: a diamond glass-mark logo + "Lucent"
   wordmark on the left, a centered `liquid-glass` pill (Home, Services,
   Work, Process, Pricing, then a solid-white "Get Started" pill as the
   pill's last item) on desktop, collapsing to logo + a standalone "Get
   Started" button on mobile.
2. **Hero** — a `clamp(680px, 94vh, 1000px)` section holding a muted MP4
   that hangs from `top: 20%` at natural aspect ratio (so it visually
   extends past the section's own bottom edge), a subtle dark overlay, a
   black bottom fade, and a slow-pulsing chromatic ambient glow behind the
   content. Centered content: a "New — Introducing AI-powered web design."
   glass badge, a word-by-word blur-in `<h1>` ("The Website Your Brand
   Deserves"), a blur-in subhead, two CTAs (`liquid-glass-strong` "Get
   Started" and a ghost "Watch the Film"), and a bottom-anchored "Trusted by
   the teams behind" partner row.
3. **Start / "How It Works"** — a video-background band with top/bottom
   fades, a centered badge + heading ("You dream it. We ship it.") + lede +
   glass CTA.
4. **Features chess** — a "Capabilities" badge + heading, then two
   alternating text/video rows (text left / video right, then reversed),
   each row pairing a headline, a lede paragraph, a glass CTA, and a looping
   muted preview video in a rounded glass frame.
5. **Features grid / "Why Us"** — a badge + heading, then a responsive
   4→2→1 column grid of glass cards, each with an icon in a glass-strong
   circle: Days Not Months (Zap), Obsessively Crafted (Palette), Built to
   Convert (bar chart), Secure by Default (Shield).
6. **Stats** — a video background rendered `filter: saturate(0)` behind a
   single glass card holding a 4-column (2-column on mobile) stat grid:
   200+ Sites launched, 98% Client satisfaction, 3.2x More conversions,
   5 days Average delivery — each value count-up-animated on scroll.
7. **Testimonials** — a badge + heading, then a responsive 3→1 column grid
   of glass quote cards (Sarah Chen/Luminary, Marcus Webb/Arcline, Elena
   Voss/Helix).
8. **CTA + footer** — a final video-background band ("Your next website
   starts here.") with two CTAs (glass "Book a Call", solid-white "View
   Pricing"), followed by a plain `<footer>` with the copyright line and
   Privacy/Terms/Contact links.

### Motion inventory

- **Hero headline (`BlurText` translation)**: each word of the `<h1>` is a
  `<span>` with a staggered `animation-delay`, running a single CSS
  keyframe on load that carries it through `blur(10px)/opacity 0/translateY
  50px` → `blur(5px)/opacity .5/translateY -5px` → `blur(0)/opacity
  1/translateY 0`.
- **Hero subhead + CTA row**: a simpler fade-blur-in (`blur(10px)→0`,
  `opacity 0→1`, `translateY 20px→0`) at `0.8s` and `1.1s` delays.
- **Scroll reveal**: an `IntersectionObserver` adds `.is-visible` once to
  every `.reveal` element (section badges/headings, chess rows, grid cards,
  stat card, testimonial cards, CTA heading) — `opacity 0→1` +
  `translateY(28px)→0` over 700ms, `cubic-bezier(0.23, 1, 0.32, 1)`, with
  grid children staggered via `transition-delay`.
- **Stat counters**: a `requestAnimationFrame` ease-out count-up from 0 to
  each stat's target value, triggered once the stats card is 40% in view.
- **Ambient glow**: a slow (`8s`) opacity/scale pulse on the chromatic glow
  blobs behind the hero and the video-fallback background.
- **Glass button hover**: `translateY(-2px)` plus a soft `var(--accent-glow)`
  box-shadow bloom, 200ms ease-out; buttons never scale from 0.
- **`prefers-reduced-motion: reduce`**: the blur-word keyframe, the hero
  fade-blur-ins, the ambient-glow pulse, and every `.reveal` transition are
  disabled outright (content renders fully visible, untransformed); button
  hover transforms are removed; and an inline script additionally strips
  `autoplay`/`loop` from every background `<video>` and pauses it, leaving
  its poster frame as a fully static page.

### Assets

- `assets/hero-bg.mp4` / `assets/hero-poster.jpg` — the prompt's CloudFront
  hero MP4 (1664×1244, ~10.5MB) downscaled to a muted 720p H.264 loop
  (~725KB, 10s) with `ffmpeg`; the poster is a frame pulled from that
  transcode, since the prompt's own poster path (`/images/hero_bg.jpeg`)
  named a local project file with no independently fetchable URL.
- `assets/start-section.mp4`, `assets/stats-section.mp4`,
  `assets/cta-footer.mp4` (with matching `*-poster.jpg` frames) — the
  prompt's three Mux HLS (`.m3u8`) streams, read directly by `ffmpeg` (no
  `hls.js`) and transcoded to muted 720p H.264 loops, 12s each
  (176KB–820KB). The stats video keeps its prompt-specified desaturation via
  a CSS `filter: saturate(0)` on the `<video>` element rather than a
  re-encode.
- `assets/feature-1.mp4` / `assets/feature-2.mp4` — the two "feature
  preview" assets the prompt specified as GIFs (~9.6MB and ~7.4MB) are
  converted to muted looping MP4 instead, cutting combined weight by roughly
  85% (to ~1.2MB total) while keeping the same animated-preview effect.
- Logo mark — an original inline SVG (a glass diamond in the `--accent`
  gradient), since the prompt's logo (`src/assets/logo-icon.png`) named a
  local project file with no fetchable URL.

### Deviations from the literal prompt spec

- **De-branded partner row.** The prompt's "Trusted by" row named five real,
  trademarked companies (Stripe, Vercel, Linear, Notion, Figma); this build
  uses five fictional names instead (Northfold, Kaskade, Anchorpoint,
  Meridian, Glasswave).
- **Agency name.** The prompt never named this agency beyond a generic
  "Studio" in the footer copyright and an unspecified logo icon; this build
  names it "Lucent Studio" (nav wordmark, page title, footer) to fit the
  liquid-glass identity.
- **Mobile nav CTA.** The prompt's spec hides the entire nav pill — including
  its "Get Started" button — below the desktop breakpoint, leaving mobile
  with no visible call-to-action. This build keeps a standalone "Get
  Started" button next to the logo on mobile so the page stays usable on
  small screens; the desktop pill is unchanged.
- **CTA destinations.** The prompt specifies no booking/pricing URLs (unlike
  a router-backed original app). Every CTA ("Get Started," "Book a Call,"
  "View Pricing," footer "Contact") routes to a `mailto:hello@lucentstudio.ai`
  placeholder; in-page nav links scroll to their matching section instead.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="liquid-glass-agency" type="text/html" title="Lucent Studio — Liquid Glass Agency Landing">
<!doctype html>
<html>...</html>
</artifact>
```
