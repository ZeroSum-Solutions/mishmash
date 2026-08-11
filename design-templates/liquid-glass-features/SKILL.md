---
name: liquid-glass-features
description: |
  A "Features Chess" section on a solid black backdrop: a centered
  "Capabilities" badge and italic-serif heading, then two alternating
  text/media rows (text left / video right, then reversed) introducing an
  AI-design product's capabilities. Liquid-glassmorphism surfaces (a subtle
  border-sheen badge, a strong-blur CTA pill, and a glass-framed preview
  video) carry the whole section — no page background, no scroll animation,
  only a button hover state.
tags:
  - "motionsites"
  - "component"
  - "features"
  - "glassmorphism"
  - "dark-mode"
  - "chess-layout"
  - "video-preview"
triggers:
  - "liquid glass features"
  - "liquid glass"
  - "features chess"
  - "glassmorphism features section"
  - "alternating feature rows"
  - "dark features section"
  - "capabilities section"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=liquid-glass-features"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build the Liquid Glass Features section as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, section order, and the liquid-glass surface treatment are part of the identity. Ask only for the missing essentials first: the two row headlines, body copy, and the preview media to swap in."
---

# Liquid Glass Features — Features Chess Section

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A "Features Chess" section on a solid black backdrop: a centered
"Capabilities" badge and italic-serif heading, then two alternating
text/media rows (text left / video right, then reversed) introducing an
AI-design product's capabilities. Liquid-glassmorphism surfaces (a subtle
border-sheen badge, a strong-blur CTA pill, and a glass-framed preview video)
carry the whole section — no page background, no scroll animation, only a
button hover state.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real row headlines, body
   copy, button labels, and preview footage. Match the existing video
   dimensions/crop when swapping media.
3. **Preserve the design system.** The black/white/glass palette, the serif
   italic + light sans type pairing, and the liquid-glass surface treatment
   in the build spec below are the identity — do not substitute fonts,
   recolor the neutral scaffolding, or strip the glass border sheen.
4. **Extend by duplicating rows**, never by importing a layout from another
   template. A third feature would alternate back to text-left/media-right.
5. **Keep motion accessible.** The preview videos stay behind
   `prefers-reduced-motion`, as the build spec requires.

## Build spec

### Palette

The design is genuinely monochrome — black background, white and white/70%
text, and glass surfaces built entirely from translucent white and black. No
brand-color gradient exists anywhere in the resting-state render, so no
chromatic accent was invented to decorate one.

| Token | Value | Use |
|---|---|---|
| `--focus-ring` | `hsl(213 90% 65%)` | The one chromatic root token, deliberately scoped to `:focus-visible` only — it never appears in the resting-state render, only when a sighted keyboard user tabs to the badge, a button, or the skip link. |

Everything else — `#000` background, `#fff` text, `rgba(255,255,255,*)` glass
fills and borders — stays literal, exactly as the neutral-scaffolding rule in
`SPEC.md` intends: this is the near-black/near-white surface the
`chromatic()` recolor filter is meant to leave alone. Injecting a visible
accent to satisfy the "chromatic token" checklist item would have changed
what the page looks like, which fidelity forbids.

### Typography

Two Google Fonts, an exact match to the source spec:

- **Instrument Serif** (italic) — the section heading and both row
  headings, `font-style: italic`.
- **Barlow** (300/400/500/600) — body copy, the badge, and button labels;
  body paragraphs use weight 300.

### Layout

1. **Header** — centered: a `liquid-glass` "Capabilities" pill badge, then
   an italic-serif `Pro features. Zero complexity.` heading
   (`clamp`-free responsive sizing: 36px → 48px → 60px at the 768px/1024px
   breakpoints).
2. **Row 1** — text left / media right. Heading `Designed to convert. Built
   to perform.`, a body paragraph, and a `liquid-glass-strong` "Learn more"
   pill with a trailing arrow icon. The media side is a `liquid-glass`
   rounded-2xl frame around a muted looping preview video.
3. **Row 2** — media left / text right (the same row markup, laid out with
   `flex-direction: row-reverse` at the desktop breakpoint). Heading `It gets
   smarter. Automatically.`, body copy, and a "See how it works" pill.
4. **Mobile** — both rows stack to a single column; content always renders
   above its media, matching the source spec's stated mobile behavior.

The two rows are marked up as an ordered `<ul>`/`<li>` pair (each row is one
feature), list-styled away visually — this is additive semantic structure,
not a rendering change.

### Motion inventory

- **Button hover** — `background-color` fades to `rgba(255,255,255,0.1)`
  over 150ms `cubic-bezier(0.4, 0, 0.2, 1)` (Tailwind's own `transition-all`
  default, ported literally rather than substituted with a house easing
  curve). No transform, no scale.
- **Preview videos** — the two feature previews were sourced as animated
  GIFs; their own internal motion (not a MishMash-authored animation) plays
  as a muted, looping, autoplaying video.
- **No scroll reveal, no parallax, no marquee.** The source spec states
  explicitly: "No animations beyond button hover transitions." Nothing was
  added.
- **`prefers-reduced-motion: reduce`** — an inline script strips
  `autoplay`/`loop` from both preview videos and pauses them on load (and on
  a live media-query change), leaving each poster frame as a static image.
  The button's hover transition is also disabled. The default (motion-on)
  experience is unchanged.

### Assets

- `assets/feature-1.mp4` / `assets/feature-1-poster.jpg` — the prompt's
  "AI-designed website preview" GIF
  (`hero-grow-ai-preview-BlQ8tAQ-.gif`, 800×573, ~5.0MB) transcoded to a
  muted H.264 loop at its native resolution (~370KB, ~9.7s) with `ffmpeg`;
  the poster is a frame pulled from that transcode.
- `assets/feature-2.mp4` / `assets/feature-2-poster.jpg` — the prompt's
  "Adaptive AI system" GIF
  (`hero-glassmorphism-agency-preview-CGqeRoqP.gif`, 800×559, ~5.3MB)
  transcoded the same way (~401KB, ~8.3s).
- No logos, fonts, or other media needed vendoring beyond the two preview
  clips; the `ArrowUpRight` icon is an inline SVG matching lucide-react's
  glyph (two paths, `24×24` viewbox), since `lucide-react` itself is a
  React/npm dependency this template does not carry.

### Accessibility affordances (additive, per `SPEC-BATCH2.md` §4)

- A visually-hidden `<h1>` gives the page a real heading root above the
  section's own `<h2>`/`<h3>` hierarchy, without adding visible chrome.
- The two feature rows are a semantic `<ul>`/`<li>` list.
- Both preview `<video>` elements carry an `aria-label` equivalent to the
  source spec's `alt` text, since `<video>` has no native `alt`.
- `:focus-visible` renders a visible outline (the one chromatic token above)
  on the skip link, the badge, and both buttons.
- The button icon SVGs are `aria-hidden`, so each button's accessible name
  stays its visible label ("Learn more" / "See how it works").
- A skip link jumps straight to the section heading for keyboard users,
  since the page has no other landmark to skip past.

### Deviations from the literal prompt spec

- **GIF → MP4.** Both preview images were specified as external animated
  GIFs (~5MB each); per `SPEC.md`'s vendoring rule they were transcoded to
  muted looping MP4 at the same crop, position, and resolution — same
  visual result at roughly 8% of the original file weight.
- **React/Tailwind → semantic HTML + vanilla CSS.** The component was a
  single React function using Tailwind utility classes; layout, spacing,
  and color values were translated one-for-one into plain CSS. The
  `liquid-glass` / `liquid-glass-strong` rules are copied verbatim.
- **Page chrome.** The prompt describes a mid-page component ("This section
  sits on a `bg-black` parent container"), not a standalone page. This
  template wraps it in a bare `<main>` on the same black background with no
  invented nav, hero, or filler section — the section's own `py-24`
  (96px top/bottom) padding is the only breathing room, matching how it
  would sit between two other sections on the real site.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="liquid-glass-features" type="text/html" title="Liquid Glass Features — Features Chess Section">
<!doctype html>
<html>...</html>
</artifact>
```
