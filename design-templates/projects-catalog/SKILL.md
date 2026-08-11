---
name: projects-catalog
description: |
  Dark, monochrome projects/case-study catalog for three fictional agency
  engagements, built as a single self-contained page. A gradient-clipped
  "Project" heading sits above three sticky, scroll-stacking cards — each
  numbered (01/02/03), labeled by category (Client/Personal), and paired with
  a 40/60 image grid (two stacked photos left, one tall photo right) and a
  pill-shaped "Live Project" link. As the page scrolls, each card locks in
  place and the ones ahead of it scale down slightly, so later cards visibly
  layer on top of earlier ones.
tags:
  - "component"
  - "motionsites"
  - "projects"
  - "portfolio"
  - "case-studies"
  - "dark-theme"
triggers:
  - "projects catalog"
  - "project catalog"
  - "portfolio section"
  - "case studies"
  - "sticky stacking cards"
  - "stacking project cards"
  - "project showcase"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=projects-catalog"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build the Projects Catalog stacking-card section as a self-contained page in this template's own visual system. Follow the build spec below exactly — palette, numbering, and the scroll-linked stacking motion are part of the identity. Ask only for the missing essentials first: the real project names, categories, and images to swap in."
---

# Projects Catalog — Sticky Stacking Case Studies

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A pure black-and-silver projects/portfolio section built to stand alone as its
own page. The section itself is the deliverable — a plain white strip above
it gives the section's negative-margin, rounded-top overlap something to
overlap, and dark breathing room below keeps the last card from ending
abruptly. No invented hero, nav, or filler sections were added.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real project names,
   categories, images, and destination URLs. Keep the 3-card shape unless the
   user explicitly wants more or fewer — the `data-index` / `data-target-scale`
   pair and the `top` offset on `.project-card[data-index]` all assume the
   card count matches `totalCards` in the inline `<script>`; adding a 4th card
   means updating the scale-target math (`1 - (totalCards-1-index)*0.03`) and
   adding a 4th `top: {index*28}px` rule.
3. **Preserve the design system.** The palette is deliberately grayscale
   (silver ink on near-black); don't introduce brand color into the cards,
   button, or heading gradient. The one chromatic token (`--accent`) is
   reserved for the focus ring — see Palette below — and should stay that way
   even when rebranding.
4. **Extend by duplicating a card**, never by importing a layout from another
   template. Update the card's `<li>`/`<article>` markup, its three `<img>`
   sources, and the JS `data-index`/`data-target-scale`/CSS `top` offset
   together.
5. **Keep motion accessible.** The scroll-linked scale and the heading's
   fade-up both read `prefers-reduced-motion` and fall back to a static,
   final-state render — preserve that when extending.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="projects-catalog" type="text/html" title="Projects Catalog — Sticky Stacking Case Studies">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page — see `example.html` for the exact values.

### Palette

- `--bg: #0C0C0C` — page and card background.
- `--ink: #D7E2EA` — all card text, the card border, the number, and the
  button (text, border, and its transparent-to-tinted hover/active fill).
- `--heading-grad-start: #646973` / `--heading-grad-end: #BBCCD7` — the
  top-to-bottom gradient clipped to the "Project" heading text.
- `--accent: #4C8DFF` — the one genuinely chromatic root token, used **only**
  as the `:focus-visible` outline color on the "Live Project" links. The
  source design has no color anywhere in it (silver-on-black, intentionally
  monochrome), so this token is additive accessibility plumbing, not a design
  element: it never appears in the resting-state render, only on keyboard
  focus, which is why it can exist without breaking fidelity to the
  monochrome original.

### Type

Kanit (weights 300–900) for all text. `font-weight: 900` uppercase on the
heading and the big card numbers; `500` uppercase on the category label and
button; `300` on the project name.

### Layout

- `<section class="projects">`: `#0C0C0C` background, horizontal padding
  20/32/40px (mobile/≥640/≥768), top corners rounded 40/50/60px, pulled up
  `-40/-48/-56px` over the plain white strip above it (`position: relative;
  z-index: 10`).
- **Heading:** centered "Project", `font-size: clamp(3rem, 12vw, 160px)`,
  gradient-clipped text, inside a `py-80/96/128px` wrapper.
- **Card list:** a semantic `<ol>` of three `<li class="project-sticky">`
  wrappers (`height: 85vh`, `position: sticky`, `top: 24px`/`32px` at ≥768px),
  each centering one absolutely-positioned `<article class="project-card">`
  (`max-width: 1760px`, `transform-origin: top`). Each card carries a `top`
  offset of `index * 28px` (0/28/56px) so earlier cards' top edge peeks above
  the card currently in front — this offset is what produces the stack; a
  page that reuses this pattern with a different card count must recompute
  it.
- **Card interior:** `2px solid var(--ink)` border, radius 40/50/60px,
  padding 16/24/32px. Top row: big number (`01`/`02`/`03`, `aria-hidden`,
  since the `<ol>` already conveys order/count) + category + project-name
  stack on the left, "Live Project" pill on the right. Below it, an image
  grid: a 40%-wide left column of two stacked photos (heights `clamp(130px,
  16vw, 230px)` and `clamp(160px, 22vw, 340px)`), and a 60%-wide right photo
  that `align-self: stretch`es to match their combined height (mobile stacks
  all three full-width, right photo at its natural aspect ratio).

### Motion inventory

- **Heading fade-up:** `opacity: 0, translateY(40px)` → `opacity: 1,
  translateY(0)` over `0.7s cubic-bezier(0.25, 0.1, 0.25, 1)`, triggered once
  by an `IntersectionObserver` (`threshold: 0`, `rootMargin: 50px`).
- **Scroll-linked card stacking:** a single scroll/resize listener
  (rAF-throttled) computes one `progress` value for the whole `.projects`
  section — `(scrollY - sectionTop) / (sectionHeight - viewportHeight)`,
  clamped to `[0, 1]`, mirroring the source's framer-motion
  `useScroll(offset: ['start start', 'end end'])`. Each card interpolates its
  own `scale` from `1` to a `targetScale` of `1 - (totalCards-1-index)*0.03`
  (card 1 → 0.94, card 2 → 0.97, card 3 → 1) over the range `[index/totalCards,
  1]` of that shared progress, applied as `transform: scale(...)` with
  `transform-origin: top`. Combined with each card's static `top` stagger
  (above), this is what makes an earlier card visibly shrink and recede
  behind the card sliding up over it.
- Both are neutralized under `prefers-reduced-motion: reduce`: the JS never
  attaches the scroll listener (cards render at `scale(1)`, no transition),
  and the heading shows in its final state immediately. The sticky-stacking
  *layout* itself (cards pinning and overlapping as you scroll) is left in
  place under reduced motion — it's a position algorithm driven 1:1 by user
  scroll input, not an autonomous animation, the same distinction drawn for
  `position: sticky` navs and TOCs generally.

### Accessibility affordances

- Semantic `<ol>`/`<li>` for the three catalog entries (order and count are
  announced by the list itself), each card is an `<article>` with a real
  `<h2>` for the project name; the page's single `<h1>` is the "Project"
  heading.
- Meaningful, distinct `alt` text per image (what the photo shows + which
  project it belongs to), not "image 1/2/3".
- Visible `:focus-visible` ring (the one chromatic accent token) on every
  "Live Project" link — the only interactive control in this section.
- The "Live Project" links point to `#` by design (the source prompt: "All
  cards link to `#`"); the inline `<script>` intercepts their click with
  `preventDefault()` so a keyboard or mouse click doesn't jump-scroll the
  page — this is additive plumbing around a non-functional demo link, not a
  visual change.
- The big `01`/`02`/`03` numbers are `aria-hidden="true"` (decorative,
  duplicate of list order); the white `chrome-top` backdrop strip above the
  section is `aria-hidden="true"` (empty, decorative).

## Deviations from the source prompt

- The source specifies React + Tailwind + framer-motion (`useScroll`,
  `useTransform`, `motion`); this is translated to semantic HTML, vanilla
  CSS, and vanilla JS producing the same visual result and porting the exact
  scale-target formula (multi-file → single file; React/Tailwind → semantic
  HTML + vanilla CSS/JS — both permitted translations).
- This is a mid-page section from a larger site, built here as a standalone
  page (SPEC-BATCH2 §2): a plain, content-free white strip stands in for "the
  previous white section" the prompt says this section overlaps, and dark
  padding below the last card gives it breathing room. No hero, nav, or other
  section was invented.
- The three project images per card were fetched from the prompt's own
  higgs.ai-proxied URLs and vendored locally (remote → local asset, a
  permitted translation); nothing was substituted.
- `--accent` is an additive accessibility token with no source equivalent
  (the source design has no color); see Palette above.
- The project names in the prompt ("Nextlevel Studio", "Aura Brand Identity",
  "Solaris Digital") read as fictional/generic already — no real company or
  trademark was found in the prompt text or the reference preview, so no
  de-branding was necessary.
