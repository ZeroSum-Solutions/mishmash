---
name: rocket-pricing-tiers
description: |
  Dark, monochrome two-tier pricing section for a fictional AI design-education
  product, built as a single self-contained page. Two cards ("Course" and
  "Course + Lovable Templates") sit side by side in a centered grid, each
  wrapped in a cursor-tracked 1px spotlight ring, with a one-time-price row,
  strikethrough original price, a feature checklist of included/excluded
  rows, and a pill-shaped CTA whose label slides up on hover. Scroll-triggered
  fade-up motion staggers the header and every element inside each card.
tags:
  - "component"
  - "motionsites"
  - "pricing"
  - "dark-theme"
triggers:
  - "pricing"
  - "pricing table"
  - "pricing cards"
  - "pricing section"
  - "rocket pricing"
  - "ui rocket"
  - "two-tier pricing"
  - "best value"
  - "dark pricing section"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=rocket-pricing"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build the Rocket Pricing two-tier pricing section as a self-contained page in this template's own visual system. Follow the build spec below exactly — palette, card structure, and motion are part of the identity. Ask only for the missing essentials first: brand name, real plan names/prices/features, and the signup destination."
---

# Rocket Pricing — Two-Tier Pricing Section

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A pure black-and-white pricing section built to stand alone as its own page.
The section itself is the deliverable — a slim page wrapper centers it
vertically so it reads as placed rather than stranded, with no invented hero,
nav, or filler sections around it.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real plan names, prices,
   descriptions, feature rows, and signup link. Keep the 2-card shape unless
   the user explicitly wants more tiers — the `max-width: 768px` grid and
   `md:grid-cols-2` breakpoint both assume exactly two cards.
3. **Preserve the design system.** The palette is deliberately grayscale
   except for the two literal card background shades (`#161616` / `#252525`);
   don't introduce brand color into the cards, badge, or text. The one
   chromatic token (`--accent`) is reserved for the focus ring — see Palette
   below — and should stay that way even when rebranding.
4. **Extend by duplicating a card or a feature row**, never by importing a
   layout from another template. If a third tier is added, widen
   `.pricing-grid`'s `max-width` and `grid-template-columns` together so the
   new column doesn't get squeezed.
5. **Keep motion accessible.** The fade-up entrances, the spotlight ring, and
   the button hover-text animation all read `prefers-reduced-motion` and fall
   back to an instant, static state — preserve that when extending.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="rocket-pricing-tiers" type="text/html" title="Rocket Pricing — Two-Tier Pricing Section">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page — see `example.html` for the exact values.

### Palette

- `--background: #000000`, `--foreground: #ffffff` with `/85`, `/80`, `/70`,
  `/60`, `/50`, `/40` opacity steps used across eyebrow, description, and
  excluded-feature text.
- `--landing-surface: rgba(255,255,255,0.10)` / `--landing-surface-hover:
  rgba(255,255,255,0.16)` / `--landing-border: rgba(255,255,255,0.10)` — pill,
  secondary-button, and card-border fills.
- Card backgrounds are literal, non-token hex values by design (`#161616` for
  the "Course" card, `#252525` for the featured "Course + Lovable Templates"
  card) — matching the source spec's explicit instruction that these two
  hexes, plus `#000000`, are the only hardcoded colors on the page.
- `--accent: #4e85bf` — the one genuinely chromatic root token, used **only**
  as the `:focus-visible` outline color. The source design has no color
  anywhere in it (it's intentionally grayscale), so this token is additive
  accessibility plumbing, not a design element: it never appears in the
  resting-state render, only on keyboard focus, which is why it can exist
  without breaking fidelity to the monochrome original.

### Type

Inter (400/500/600) for all text. Material Symbols Outlined (Google Fonts,
default static instance) for the feature-row check/close glyphs, rendered at
12px inside a 20px circular badge.

### Layout

- `<section id="pricing">`, max-width 1080px container, `padding-block: 48px`
  (`64px` at ≥640px).
- **Header:** pill badge ("• Pricing") + heading ("Clear pricing plans / that
  scale with you.") on the left (max-width 672px), a short paragraph
  (max-width 384px) that bottom-aligns with the heading on desktop (≥1024px,
  `align-items: flex-end`) and stacks below it on mobile.
- **Cards grid:** `max-width: 768px`, centered, single column below 768px,
  two equal columns at ≥768px, `gap: 24px`.
- **Each card** is a `SpotlightBorder`-style wrapper (1px cursor-tracked ring,
  `border-radius: 16px`) around the actual card (`border-radius: 16px`,
  `padding: 28px` / `32px` at ≥640px, background = the card's literal hex).
  Card 2 additionally carries an absolutely positioned "Best Value" pill
  (`top: -12px`, centered, white background, black text) since it's the
  featured plan.
  - Content order inside each card: uppercase eyebrow (plan name, `11px`,
    `letter-spacing: 0.2em`) → hairline divider → price row (`44px` current
    price + line-through original price) → one-line description → CTA button
    → feature checklist.
  - Feature rows: `padding-block: 16px`, divided by a hairline top border
    except the first row. Included rows show a filled 20px circle with a
    check glyph and `text-foreground/85`; excluded rows show an
    outline-only circle with a close glyph and `text-foreground/40`.
  - CTA: card 1 (non-featured) uses the **secondary** button style (dark
    translucent fill); card 2 (featured) uses the **primary** button style
    (white/80 fill, black text, brightens to solid white on hover).

### Motion inventory

- **Fade-up entrance:** the header pill/heading/paragraph and every element
  inside each card (eyebrow, price row, description, CTA, feature list) start
  `opacity:0, translateY(24px)` and reveal via `IntersectionObserver`
  (threshold 0.3, fires once), transitioning `0.6s cubic-bezier(0.22,1,0.36,1)`
  with a staggered `transition-delay` matching the source's `FadeUp` props:
  header 0/0.1/0.2s; inside each card, eyebrow 0s, price 0.1s, description
  0.2s, CTA 0.3s, feature list 0.4s.
- **Spotlight ring:** each card's outer wrapper gets an absolutely positioned
  1px ring whose `radial-gradient` position follows `--spot-x`/`--spot-y`,
  written on `pointermove` relative to the card's own bounding rect (size
  460px, intensity 0.5, defaults to off-canvas at `-9999px` so it's invisible
  until hovered) — ported from the source `SpotlightBorder` component's
  double-mask-composite-exclude technique.
- **Button hover text:** each CTA's label is duplicated in a two-row stack
  inside an `overflow: hidden` wrapper; on hover the stack slides up
  `translateY(-50%)` over `0.3s`, revealing the second (identical) row —
  the source's "hover text-up-from-below animation."
- Everything above is neutralized under `prefers-reduced-motion: reduce`:
  reveal transitions collapse to near-zero duration and render in their final
  state immediately; the spotlight ring and button hover-text transitions are
  disabled outright.

### Accessibility affordances

- Each feature row carries a visually-hidden "Included:" / "Not included:"
  prefix (`.feature-status`) ahead of the visible label, so the included/
  excluded state isn't conveyed by icon and color alone — additive markup,
  no change to the rendered appearance.
- Visible `:focus-visible` ring on both CTA links, using the one chromatic
  accent token, `outline-offset: 2px`.
- The check/close glyphs and the decorative pill dot are `aria-hidden`; the
  feature text itself (plus the hidden status prefix) carries the meaning.

## Deviations from the source prompt

- The source specifies React + TypeScript + Vite + Tailwind + `framer-motion`
  + `clsx`/`tailwind-merge`; this is translated to semantic HTML, vanilla CSS,
  and vanilla JS producing the same visual result (multi-file → single file;
  React/Tailwind → semantic HTML + vanilla CSS/JS — both permitted
  translations).
- The Material Symbols Outlined font is loaded via the plain
  `family=Material+Symbols+Outlined` Google Fonts query (a static default
  instance at `wght 400, FILL 0, GRAD 0, opsz 24`) rather than the full
  variable-axis range. The page only ever renders those exact default axis
  values for the `check`/`close` glyphs, so the visual result is identical;
  the narrower request is a smaller payload, not a design change.
- `--accent` is an additive accessibility token with no source equivalent
  (the source design has no color); see Palette above.
- Both CTAs keep the source's literal `href="/auth?mode=signup"`. It is not a
  live endpoint in this static file — a fictional signup destination, not a
  form submission, so no submit-interception behavior applies.
