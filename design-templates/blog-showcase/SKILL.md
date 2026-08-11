---
name: blog-showcase
description: |
  "Behind the Lens" photography blog section for a fictional photographer,
  built as a single self-contained page: a header with a "Blog" pill, a large
  Outfit headline, and a "View all posts" pill button, followed by a
  full-width featured post (autoplaying looped video on the left, a "Must
  Read" badge, title, description, author, and category pill on the right)
  and a three-card grid of shorter posts below it. Every video container
  carries the same hover language — an 8% zoom, a dark overlay, a centered
  "+" reveal icon, and white L-shaped corner brackets — reachable by both
  mouse hover and keyboard focus.
tags:
  - "component"
  - "motionsites"
  - "blog"
  - "photography"
  - "video-grid"
triggers:
  - "blog"
  - "blog showcase"
  - "behind the lens"
  - "photography blog"
  - "featured post"
  - "blog grid"
  - "video cards"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=blog-showcase"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build the Behind the Lens blog showcase section as a self-contained page in this template's own visual system. Follow the build spec below exactly — palette, typography, the featured-post-plus-grid structure, and the hover language are part of the identity. Ask only for the missing essentials first: the photographer's name, real post copy, and the post videos or images."
---

# Behind the Lens — Blog Showcase

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A white-background photography blog section built to stand alone as its own
page. The section itself — header, featured post, three-card grid — is the
deliverable; the page wrapper is only the 60px/20px padding and centered
1200px column the section already calls for. There is no invented nav, hero,
or filler section around it.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real photographer name,
   post titles/descriptions/author line, and category names. Keep the
   featured-post-plus-three-card shape unless the user explicitly wants more
   cards — the grid is `repeat(3, 1fr)` and assumes exactly three siblings at
   desktop width.
3. **Swap the videos**, not the layout. Each `<video>` is `autoplay loop muted
   playsinline` and fills a `.media-frame` via `object-fit: cover`; drop in a
   same-aspect-ratio replacement (16/10 for grid cards, full-bleed for the
   featured post) and the hover treatment keeps working unmodified.
4. **Preserve the design system.** The palette is white/black/near-black text
   with four assigned category colors — don't introduce a new brand color
   into the badges or overlay; the category hex values are root tokens
   specifically so MishMash's recolor pass can retint them without a hand
   edit.
5. **Keep motion accessible.** The hover zoom/overlay/icon reveal is
   reachable by keyboard (`:focus-visible` mirrors `:hover` on every
   `.media-link`) and neutralized under `prefers-reduced-motion` — preserve
   both paths when extending.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="blog-showcase" type="text/html" title="Behind the Lens — Blog Showcase">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page — see `example.html` for the exact values.

### Palette

- White page background (`#ffffff`) throughout; ink text `#111111`.
- `--pill-bg: #f4f4f4` — the "Blog" badge fill.
- `--subtitle: #666666` — subtitle/description copy.
- `--border-hairline: #f0f0f0` / `--card-bg: #fcfcfc` — the featured post's
  1px border and background.
- `--overlay-dark: rgba(0,0,0,0.25)` / `--icon-circle: rgba(255,255,255,0.2)`
  — the video hover overlay and "+" icon circle.
- Four chromatic category tokens, the genuinely-colorful part of the page:
  `--cat-gear: #7d1a4a`, `--cat-lighting: #2c4c34`, `--cat-editing: #a63e2d`,
  `--cat-business: #1a2b8c`.

### Type

Inter (400/500/600) for body copy, subtitle, author line, and badges. Outfit
(500/600/700) for the page heading (64px/500/-2.5px letter-spacing), the
featured title (48px/500/-1.5px), and grid card titles (17px/600).

### Layout

- `<main class="page">`, max-width 1200px, centered, `padding: 60px 20px`.
- **Header:** "Blog" pill badge above the 64px heading "Behind the lens";
  below that, a flex row pairing the 480px-max subtitle paragraph with the
  black pill "View all posts" button.
- **Featured post:** `<article>`, 2-column grid (1fr 1fr), 20px radius, 1px
  `#f0f0f0` border, `#fcfcfc` background, 520px min-height. Left column is a
  full-bleed `.media-frame`; right column is 60px-padded content in a column
  flex — a black "Must Read" pill, the 48px title, a 17px `#666` description,
  then a footer (author left, category pill right) pinned to the bottom via
  `margin-top: auto`.
- **Post grid:** three `<article class="post-card">` in a `repeat(3, 1fr)`
  grid, 25px gap. Each card is a 16/10 `.media-frame` with a title-plus-badge
  footer row below it (title left, category pill right).
- **Breakpoints:** at ≤1024px the featured post collapses to one column
  (media above content, content padding 40px) and the grid becomes 2 columns;
  at ≤768px the heading drops to 48px, the header's subtitle/button row
  stacks vertically, the grid becomes 1 column, and the featured title drops
  to 32px.

### Motion inventory

- **Video hover/focus reveal**, on every `.media-link` (the featured post and
  all three grid cards): the `<video>` scales to `1.08` over `0.5s
  cubic-bezier(0.33,1,0.68,1)`; a `rgba(0,0,0,0.25)` overlay fades in over
  `0.4s`; a centered 70px circle (`rgba(255,255,255,0.2)`) holding a "+" glyph
  scales from `0.7` to `1.0` and fades in over `0.3s` on the same easing.
  Triggered by `:hover` **and** `:focus-visible` on the `.media-link` anchor,
  so keyboard Tab reaches the identical state a mouse hover does.
- **Corner brackets:** four static white L-shaped marks (12px, 1.5px border),
  15px inset from each corner of every `.media-frame` — decorative, always
  visible, not part of the hover transition.
- **Button hover:** "View all posts" scales to `1.02` over `0.3s` on the same
  easing, on both `:hover` and `:focus-visible`.
- **Reduced motion:** the inline `<script>` checks
  `prefers-reduced-motion: reduce` on load and on change. When reduced, every
  `<video>` loses `autoplay`/`loop` and is paused at its current frame (a
  static poster-like fallback) instead of looping; the CSS reduced-motion
  block additionally zeroes out the hover scale/opacity transitions so a
  keyboard/mouse focus still reveals the overlay and icon, just without
  animating into place.

### Accessibility affordances

- Every video container is wrapped in a real `<a class="media-link" href="#"
  aria-label="Read: …">` — the hover-only visual reveal (overlay, "+" icon,
  zoom) is decoration on top of a control that is already keyboard-reachable
  and has an accessible name; hover enhances, it never gates.
- All decorative layers inside `.media-frame` — the `<video>` itself, the dark
  overlay, the "+" icon, and the four corner brackets — carry
  `aria-hidden="true"` so a screen reader announces only the link's
  `aria-label`.
- Card and featured titles repeat as a second, separately focusable `<a
  href="#">` inside their `<h2>`/`<h3>`, giving keyboard and screen-reader
  users a text-labeled path to the same post alongside the media link.
- `.btn-view-all` and every `.media-link`/title link get a visible
  `:focus-visible` outline; the outline is additive and does not change the
  resting-state appearance.

## Deviations from the source prompt

- The source specifies React + TypeScript + Vite + Tailwind CSS with a
  Supabase `blog_posts` table driving the render; this is translated to
  semantic HTML with the four posts' data baked directly into the markup
  (multi-file → single file; React/Tailwind/Supabase-fetch → static semantic
  HTML — both permitted translations). The "Tech Stack" and "Data Source"
  sections describe implementation plumbing, not the visual design, so they
  are not reproduced.
- The four category hex values are declared as `:root` custom properties
  (`--cat-gear` etc.) purely so MishMash's recolor pass can retint them; the
  variables hold the prompt's exact original hex values, so the rendered
  result is pixel-identical to a literal value.
- The prompt's four videos are re-encoded from their original 1080p H.264
  source to muted 720p MP4s (720p height, `libx264`, no audio) so each stays
  well under a few MB; same crop, same content, same loop — only the file
  size changed. See `template.json` for the vendored filenames.
