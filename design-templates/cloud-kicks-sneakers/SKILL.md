---
name: cloud-kicks-sneakers
description: |
  Single-viewport ecommerce hero for **SkyRunner Co. (SKR)**, a fictional
  footwear brand. A pearlescent pink-and-lavender sneaker floats, bobbing on
  a slow 4s loop, over full-bleed looping pastel cloudscape video inside a
  white rounded media "portal." A giant white-to-transparent gradient
  wordmark ("In The Clouds") sits behind the shoe, with micro-labels, a black
  pill CTA, and a play/pause control layered on top. Mobile collapses to a
  circular-reveal full-screen menu with staggered link entrances. One
  self-contained page, no scroll, no sections below the fold.
tags:
  - "landing-page"
  - "motionsites"
  - "hero"
  - "video-background"
  - "ecommerce"
  - "fashion"
  - "sneakers"
  - "monochrome"
triggers:
  - "skyrunner"
  - "skr"
  - "sneaker hero"
  - "sneaker landing"
  - "footwear landing page"
  - "floating shoe"
  - "ecommerce hero video"
  - "circular reveal mobile menu"
  - "product hero video background"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=cloud-kicks"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build SkyRunner Co. — a floating-sneaker ecommerce hero — as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — the rounded media portal, the gradient wordmark, the pill CTA, and the shoe's float loop are part of the identity. Ask only for the missing essentials first: real brand name, product photography (or footage) to swap in, and nav labels."
---

# SkyRunner Co. — In The Clouds Hero Landing

> Rebuilt from a licensed MotionSites prompt as a self-contained page.

Single-viewport ecommerce hero for **SkyRunner Co. (SKR)**, a fictional
footwear brand. White page chrome (a slim nav) sits above a full-bleed media
"portal" — a large-radius rounded rectangle that fills the rest of the
viewport. Inside the portal: looping pastel cloudscape video, a floating
product shot bobbing on a slow vertical drift, a giant faded wordmark, two
micro-copy labels, a black pill CTA, and a circular play/pause control. The
page is intentionally one viewport tall, matching the original design's own
scope — no product grid, no footer, no extra sections.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, nav
   labels, product photography (a transparent product cutout sized and
   positioned the same way — centered, `object-fit: contain`, full-bleed over
   the video layer) and background footage.
3. **Preserve the design system.** The white-chrome / rounded-portal
   composition, the gradient wordmark, the pill CTA, and the shoe's float
   timing in the build spec below are the identity — do not add a color
   overlay to the video, introduce a second section, or restyle the CTA off
   its black-pill treatment.
4. **Extend by duplicating patterns**, never by importing chrome from another
   template. If more sections are needed below the hero, design them fresh in
   this template's own vocabulary — the hero itself should stay exactly this
   spare, per the source prompt's explicit "no other sections" instruction.
5. **Keep motion accessible.** The float loop, the hamburger morph, and the
   circular mobile-menu reveal all collapse under `prefers-reduced-motion`,
   and the background video does not autoplay in that mode — preserve both
   when extending the page.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="cloud-kicks-sneakers" type="text/html" title="SkyRunner Co. — In The Clouds Hero Landing">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page, not the source prompt.

### Palette & type

- **Palette:** monochrome white-and-black chrome. Nav, CTA, hamburger, and
  the mobile menu are pure `#ffffff` / `#000000` — all color in the resting
  render comes from the video and product photography, not from CSS.
- **Chromatic root token:** `--accent: #ec9dc0`, a cloud pink pulled from the
  video's own palette. Per the monochrome-design rule, it is scoped
  exclusively to the `:focus-visible` ring — it is never injected into a
  gradient, fill, or the resting UI, so the recolor knob still has a real
  chromatic token to grab without changing the specified look.
- **Type:** Inter (400/600/800) throughout, loaded from Google Fonts — matches
  the source prompt's specified font exactly, no substitution needed.

### Section-by-section layout

1. **Nav (page chrome, not part of the "one section")** — logo (`SKR`) left;
   five uppercase text links centered, hidden below 768px; account icon, cart
   icon with a black "0" badge, and (below 768px only) a 36×36 hamburger on
   the right.
2. **Mobile menu overlay** — fixed full-screen white panel revealed by an
   expanding `clip-path: circle()` anchored at the hamburger's position (top
   right), five links staggered in on open (`150 + i·60ms`) and reset
   instantly on close, plus a bottom tagline that fades in last.
3. **Media stage** — the single hero `<section>`: a large-radius
   rounded-top container holding, back to front: the looping cloud video; the
   giant `In The Clouds` wordmark (white-to-transparent gradient clipped to
   text, `16vw` → `13vw`); the `Aftershock` and `Statement Men's Kick` micro
   labels; the floating product shot (bobbing `±12px` on a 4s ease-in-out
   loop, drop-shadowed); the black `Step Inside` pill CTA; and a white
   circular play/pause control at bottom center.

### Motion inventory

- Shoe float: `translateY(0) → translateY(-12px) → translateY(0)`, 4s
  `ease-in-out`, infinite — exact constants from the source prompt.
- Hamburger bar morph: two bars translate apart at rest, rotate ±45° into an
  X when open, 300ms, `cubic-bezier(0.22, 1, 0.36, 1)`.
- Mobile menu reveal: `clip-path: circle()` from 0% to 150% radius at the
  hamburger's anchor point, 500ms, `cubic-bezier(0.76, 0, 0.24, 1)`.
- Mobile link entrance: `translateY(100%) → translateY(0)` + `opacity 0 → 1`,
  500ms, `cubic-bezier(0.22, 1, 0.36, 1)`, staggered `150 + i·60ms` opening,
  `0ms` closing; the footer tagline fades in on a `500ms` delay.
- CTA hover: `scale(1.05)`; play button hover: `scale(1.1)`; both 200ms,
  the repo's standard ease-out.
- Nav link hover: opacity to `0.6`, 200ms.
- `prefers-reduced-motion: reduce` removes the shoe's float animation
  entirely, collapses every menu/hamburger transition to near-zero, and stops
  the background video from autoplaying (it rests on its poster frame
  instead of looping).

### Accessibility affordances

- Hamburger is a real `<button>` with `aria-expanded`, `aria-controls`, and
  an `aria-label` that flips between "Open menu" / "Close menu".
- The mobile menu is `role="dialog"` `aria-modal="true"`; its open/closed
  state is carried by `aria-hidden` rather than the `hidden` attribute, so it
  never collides with the panel's own `display` rule (a bug called out
  explicitly in this batch's build brief).
- `Escape` closes the mobile menu and returns focus to the hamburger.
  Clicking any menu link also closes it.
- Body scroll is locked (`overflow: hidden`) while the mobile menu is open
  and restored on close.
- The play/pause control is a genuine toggle — not decorative-only — that
  pauses and resumes the background video, with `aria-pressed` and an
  `aria-label` that tracks the real state, while keeping the exact play-glyph
  artwork the source prompt specifies at every state (an additive-only
  accessibility change; the resting appearance never differs from spec).
- Every interactive element carries a visible `:focus-visible` ring (the
  chromatic `--accent` token) that does not alter the resting appearance.
- All nav links are the source prompt's own non-routing placeholders
  (`href="#"`); a page-load script prevents their default jump-to-top
  behavior so keyboard and pointer users don't lose their scroll position.

### De-branding note

Two collisions surfaced in this build, both resolved before shipping:

1. **The MotionSites catalog title, "Cloud Kicks," collides with a real
   fictional brand** — Salesforce uses "Cloud Kicks" as its own fictional
   demo sneaker company across Trailhead and Dreamforce training material
   (confirmed by web search). The prompt text itself never uses that name on
   the page — it specifies the brand throughout as **SkyRunner Co. (SKR)** —
   so no on-page copy needed changing. This template's own name, title, and
   description avoid "Cloud Kicks" entirely and use SkyRunner Co. / SKR
   instead, so the collision does not propagate into anything this repository
   ships.
2. **The vendored product photograph carried a real manufacturer mark.** The
   source shoe PNG (`assets/shoe-floating.png`) had a Nike swoosh molded into
   the lateral panel at full pixel resolution — not a compression artifact,
   a genuine embossed logo. It was removed with OpenCV inpainting (Telea
   algorithm) to rebuild the surrounding panel texture, then a fictional SKR
   mark — an abstract cloud badge, on-theme with "In The Clouds" — was
   painted into the same spot with a matching soft gradient fill, an embossed
   pink rim, a glossy highlight, and a drop shadow, so the panel still reads
   as a deliberate brand mark rather than a blank patch. The panel's
   silhouette, position, scale, and "raised emblem" visual role are
   unchanged; only the mark itself is fictional. No other real-brand marks
   (stripes, wordmarks, box art) were found in the video footage — it is
   abstract cloud atmosphere throughout, confirmed by inspecting three
   extracted frames.

### Assets

- `assets/bg-clouds.mp4` — vendored, transcoded to 720p/muted/H.264 (464KB)
  from the prompt's exact specified CloudFront source URL, faststart.
- `assets/bg-clouds-poster.jpg` — first frame of the same video, used as the
  `<video poster>` and shown at rest under `prefers-reduced-motion`.
- `assets/shoe-floating.png` — the vendored product cutout, de-branded as
  described above and downscaled to 1400px wide (291KB).

### Fonts

- Inter (400/600/800) via the exact Google Fonts URL the prompt specifies —
  no substitution needed, the specified family is already on Google Fonts.

