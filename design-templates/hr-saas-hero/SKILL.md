---
name: hr-saas-hero
description: |
  Editorial, white-background SaaS hero for the fictional remote-team HR
  platform **Loopwork**. A vertically flipped ambient video loop fills the
  backdrop and fades into pure white through a soft vertical gradient, sitting
  behind a heavily top-padded, centered content column: a large Geist
  headline that swaps in an oversized italic Instrument Serif accent word, a
  slate description, and a pill-shaped email-capture bar paired with a
  high-gloss dark "Create Free Account" button and a five-star social-proof
  line. Motion is a single staggered fade-and-slide-up entrance on load,
  fully static under reduced motion.
tags:
  - "landing-page"
  - "motionsites"
  - "saas"
  - "hero-section"
  - "light-mode"
  - "video-background"
  - "email-capture"
triggers:
  - "loopwork"
  - "hr saas hero"
  - "hr software"
  - "remote team management"
  - "editorial hero"
  - "serif italic accent headline"
  - "email capture pill"
  - "social proof reviews badge"
  - "white saas hero"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=16"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build Loopwork — HR SaaS Hero as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, spacing, and motion are part of the identity. Ask only for the missing essentials first: brand name, real copy, and any footage to swap in for the backdrop loop."
---

# Loopwork — HR SaaS Hero

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single full-viewport hero for Loopwork, a fictional HR platform for
distributed teams. The page is one `<section>` on a white backdrop: a muted,
looping ambient video sits mirrored behind the content and dissolves into
solid white through a vertical gradient, an editorial column drops in 290px
from the top of the viewport, and a pill-shaped email-capture bar with a
high-gloss dark CTA and a five-star review line closes the composition.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headline,
   body copy, and CTA label. Swap the vendored background loop for footage of
   a similar mood (soft, abstract, non-distracting) and matching aspect
   ratio — keep it muted, looped, and mirrored, or drop the `scaleY(-1)`
   transform if the replacement footage is already oriented correctly.
3. **Preserve the design system.** The white backdrop, the 290px editorial
   top padding, the Geist/Instrument Serif pairing, the pill-shaped
   email-capture bar, and the dark high-gloss CTA are the identity — do not
   swap in a dark backdrop, a different serif accent, or a flat CTA fill
   without being asked.
4. **Extend by duplicating sections**, never by importing a layout from
   another template. This template ships one hero section by design; if the
   user wants more sections below it, design them from scratch in this
   template's own vocabulary (white/near-black/slate neutrals, one chromatic
   accent, editorial serif-accented type).
5. **Keep motion accessible.** The load-in fade-and-slide-up and the CTA/
   input hover-focus states must stay behind `prefers-reduced-motion`, exactly
   as the build spec below requires.

## Build spec

### Palette tokens

All chromatic and gradient colors live on `:root` so the recolor tooling can
retint the page without touching markup:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#ffffff` | Section background, overlay target color |
| `--fg` | `#14151a` | Headline, star-badge label |
| `--slate` | `#373a46` | Description text (rendered at 80% opacity) |
| `--accent` | `#4b5eff` | The one chromatic token — star-rating fill, input focus ring |
| `--accent-soft` | `rgba(75, 94, 255, 0.16)` | Focus-ring glow behind the accent |
| `--pill-bg` / `--pill-border` / `--pill-shadow` | `#fcfcfc` / `rgba(20,21,26,0.08)` / `rgba(194,194,194,0.25)` | Email-capture pill fill, hairline border, ambient drop shadow |
| `--cta-a` / `--cta-b` | `#33343c` / `#050506` | CTA button's dark vertical gradient |
| `--cta-highlight` / `--cta-innershadow` | `rgba(201,201,201,0.08)` / `rgba(29,29,29,0.24)` | The CTA's inset highlight/shadow pair for the high-gloss tactile finish |

`--bg` and `--fg` stay literal near-white/near-black neutral scaffolding by
design. `--accent` is the page's one genuinely chromatic token — it drives the
star-rating icons and the email pill's focus-ring glow, so the color knob has
a real, visible surface to retint.

### Typography

- **Geist** (Google Fonts, weights 400/500/600) for the headline, body, input,
  and CTA — medium weight, `letter-spacing: -0.04em` on the headline, exactly
  as specified.
- **Instrument Serif** italic (Google Fonts) for the single accent word
  "management" inside the headline, set larger than the surrounding text
  (`clamp(2.9rem, 8vw, 100px)` vs. the headline's `clamp(2.4rem, 6.4vw, 80px)`)
  so it reads as an inline oversized flourish rather than a matched line.
  Both fonts are the prompt's originals — no substitution was needed.
- Description copy: Geist regular, 18px, `color: var(--slate)` at 0.8 opacity,
  `max-width: 554px`, centered.

### Layout

One `<section class="hero">`, white, flex column, `min-height: 100vh`:

1. **Background video** — full-bleed `<video>` (`position: absolute; inset:
   0; object-fit: cover`), vertically mirrored with `transform: scaleY(-1)`
   per the brief, no audio. A poster `<img>` (a still frame from the same
   clip, mirrored identically) sits behind it for the reduced-motion path.
2. **White gradient overlay** — `linear-gradient(to bottom, rgba(255,255,255,0)
   26.416%, var(--bg) 66.943%)`, laid directly over the video so it blends
   into the page's white background by roughly two-thirds down the viewport.
3. **Content column** — centered, `max-width: 1200px`, `padding-top: 290px`
   on desktop (stepping down to 180px / 128px under 900px / 640px width so
   copy doesn't clip on short or narrow viewports), `gap: 32px` between the
   headline, description, and signup block.
4. **Headline (`<h1>`)** — "Simple **management** for your remote team", with
   "management" wrapped in the oversized italic serif accent described above.
5. **Description (`<p>`)** — one sentence describing Loopwork's time-off,
   payroll, and performance tools for distributed teams.
6. **Signup block** — a `<form class="email-pill">` (40px border radius,
   `#fcfcfc` fill, hairline border, the specified ambient drop shadow)
   containing a borderless email `<input>` and the dark gradient CTA button
   ("Create Free Account") with the brief's exact inset highlight/shadow
   pair. Submitting (client-side only, `preventDefault`) swaps the button
   label to a confirmation state for a few seconds. Below the pill: a small
   overlapping avatar cluster, a five-star rating row, and a "1,020+ Reviews
   from HR teams" label.

### Motion inventory

- **Load-in fade-and-slide-up**: the headline, description, and signup block
  each animate `opacity 0 → 1` with `translateY(24px) → 0` over 800ms,
  staggered at `0.1s` / `0.3s` / `0.5s`, easing
  `cubic-bezier(0.23, 1, 0.32, 1)` — never scaling from 0.
  The description's keyframe resolves to its resting `0.8` opacity rather
  than `1`, matching the brief's 80%-opacity slate text.
- **Email pill focus state**: a soft `--accent-soft` ring blooms in on
  `:focus-within`, transitioning with the same easing.
- **CTA hover/active**: a 1px lift on hover, a slight scale-down on active,
  both well inside the "never scale from 0" rule.
- **Ambient loop**: the background video autoplays, loops, and stays muted
  via HTML attributes; an inline script calls `.play()` defensively and pauses/
  hides the video in favor of its poster under `prefers-reduced-motion`.
- **`prefers-reduced-motion: reduce`**: the load-in animation is skipped
  (content renders fully visible, no transform), the CTA/input transitions
  are disabled, and the `<video>` is hidden and paused in favor of its
  vendored poster-frame `<img>` — a fully static page.

### Assets

- `assets/hero-bg-loop.mp4` — the prompt's CloudFront MP4 downloaded and
  transcoded locally to a muted, 720p (1294×720), ~7s H.264 loop (~0.5MB),
  referenced with a plain `<video>` tag (no HLS, no external player).
- `assets/hero-poster.jpg` — a still frame pulled from the same clip, used as
  the `poster` attribute and as the full `<img>` fallback under reduced
  motion (both share the same `scaleY(-1)` mirroring as the video).

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="hr-saas-hero" type="text/html" title="Loopwork — HR SaaS Hero">
<!doctype html>
<html>...</html>
</artifact>
```
