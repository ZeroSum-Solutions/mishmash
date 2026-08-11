---
name: feedback-slider
description: |
  White testimonial section titled "What builders say", built as a single
  self-contained HTML page. A right-aligned header pairs a serif-accented
  heading with a 5-star Clutch rating; below it, a two-up card carousel
  auto-advances through five builder quotes (tripled to fifteen cards for a
  seamless loop), each card showing a quote glyph, testimonial copy, and an
  avatar/name/role byline. Circular prev/next buttons sit under the track.
  Cards fade and scale down as they exit past the left edge, and every
  header block reveals with a staggered scroll fade-in.
tags:
  - "component"
  - "motionsites"
  - "testimonials"
  - "carousel"
  - "slider"
triggers:
  - "feedback slider"
  - "testimonial slider"
  - "testimonial carousel"
  - "what builders say"
  - "quote carousel"
  - "clutch rating testimonials"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=feedback-slider"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build a testimonial carousel section like this one, in this template's own visual system, but for my real business. Follow the build spec exactly — the tripled infinite-loop track, the per-card exit fade/scale, and the staggered header reveal are part of the identity. Ask only for the missing essentials first: brand name, real quotes, and headshots to swap in."
---

# Feedback Slider — "What Builders Say" Testimonial Carousel

> Section-only template derived from a licensed MotionSites prompt; rebuilt as a self-contained page per the batch-2 build spec (SPEC.md / SPEC-BATCH2.md / FIDELITY.md).

The page ships nothing but the section itself, vertically centered in the viewport with no invented nav, hero, or filler — the carousel is the whole deliverable, matching how the verified preview render shows it with no surrounding page chrome either.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace the five testimonials** — quote, author, role, company, avatar —
   with the user's real quotes and headshots. Keep the same five-item count
   and card structure; the tripled-array loop only works cleanly with equal
   copies.
3. **Preserve the design system.** The palette, type scale, spacing, card
   shadow, and motion in the build spec below are the identity — do not
   substitute fonts, recolour the palette, or strip the exit fade/scale.
4. **Keep the carousel math intact** when extending: `cardWidth`, `gap`, and
   the offset wrap-around in the inline `<script>` are ported from the
   original prompt's formula. Change the data, not the arithmetic.
5. **Keep motion and controls accessible.** Auto-advance must keep stopping
   on hover, focus, and `prefers-reduced-motion`, and prev/next must stay
   real `<button>` elements with accessible names.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="feedback-slider" type="text/html" title="Feedback Slider — What Builders Say">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page (own words — the upstream MotionSites prompt text is not reproduced here per the rights rules in SPEC.md).

### Palette (intentionally monochrome)

- Background: `#ffffff` (both the page shell and the section — the page adds
  no separate chrome color).
- Primary text / heading: `#0d212c`.
- Muted text (role/company line): `#273c46`.
- Card: `#ffffff` on `#ffffff`, distinguished only by
  `box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08)` and a rounded corner — this is
  a deliberately low-contrast, shadow-only card style, not a rendering bug.
- `--accent: #2f6fed` is the one chromatic root token, scoped **only** to the
  prev/next buttons' `:focus-visible` ring. The resting-state design has no
  visible accent color anywhere; the build brief's "genuinely monochrome —
  don't inject a visible accent" carve-out applies here, so the required
  chromatic token lives on a state (focus) that never appears in the
  resting-state render.

### Typography

- Body font: **Inter** (400/500/600), substituting for the prompt's
  **PP Neue Montreal** — not on Google Fonts, so Inter is the nearest
  grotesque-sans equivalent (per SPEC.md's font-substitution rule).
- Accent serif: **Fraunces**, substituting for the prompt's **PP Mondwest**
  on the single word "builders" in the heading — same substitution rule;
  Fraunces is the closest widely-used Google Fonts analog for Mondwest's
  expressive rounded-serif character.
- Heading: `32px` / `1.1` line-height, up to `40px` at `≥768px` and `44px`
  at `≥1024px`, weight 400.
- Quote body copy: `16px`, `1.625` line-height.
- Author name: `14px` / weight 600. Role/company line: `14px`, muted color,
  prefixed with a `↳` glyph.

### Layout

- `<main>` page shell: `min-height: 100vh`, flex-centered, so the section
  reads as placed with breathing room above and below without any invented
  content.
- `<section>`: full width, `80px` vertical padding, white background —
  matches the verified preview exactly (see Fidelity comparison below).
- Container: `max-width: 80rem` (`max-w-7xl`), `24px` side padding.
- Header row: heading block left, 5-star row + "Clutch 5/5" rating block
  right; stacks on mobile, right-aligned pair (`max-width: 56rem`,
  `margin-left: auto`) from `768px` up.
- Carousel: `overflow: hidden`, bleeds to the viewport edge below `768px`
  (negative side margins), right-aligned `max-width: 56rem` container above
  it. Track is a flex row, `24px` gap, cards `427.5px` wide on desktop or
  `viewport − 48px` on mobile.
- Prev/next buttons: `48px` circular, `1px` border at 20% ink opacity, sit
  in their own row under the track (right-aligned to match the carousel
  above `768px`).

### Cards (5 testimonials, tripled to 15 in the DOM)

Each card: white, `32px` radius (`40px` at `≥768px`), asymmetric padding
(`40px` left / `96px` right at desktop, giving the quote column its
right-side breathing room seen in the reference), a quote-mark SVG (the
prompt's exact custom path, not a stock icon), the quote text, then an
avatar/name/role byline. Author avatars are vendored Pexels headshots.

Testimonials: Marcus Anderson (CEO, Data.storage), alexwu (Founder,
Nexgate), James Mitchell (VP Product, LaunchPad), Rachel Foster
(Co-founder, Nexus Labs), David Zhang (Head of Design, Paradigm Labs). Copy
is carried verbatim from the prompt, including the lowercase "alexwu"
byline — not a typo to fix.

### Motion inventory

- **Scroll reveal** — `IntersectionObserver` (threshold `0.1`, fires once),
  driving a `fadeInUp` keyframe (`opacity 0 → 1`, `translateY(30px) → 0`,
  `0.8s ease-out`) on four blocks with staggered delays: heading `0.1s`,
  rating block `0.2s`, carousel `0.3s`, nav row `0.4s`.
- **Auto-advance carousel** — every `3000ms`, `offset` increases by
  `cardWidth + 24px`; once `offset` reaches `cardWidth+24 × 5` it resets to
  `0` (the same-content tripled array makes that reset visually seamless).
  Track transform: `translateX(-offset)`, `transition: transform 0.8s
  cubic-bezier(0.4, 0, 0.2, 1)`.
- **Per-card exit fade/scale** — as a card's position crosses past half its
  own width beyond the left edge, it fades toward `opacity: 0` and scales
  toward `0.85` (`opacity/transform 0.4s ease-out`), ported from the
  prompt's exact `exitProgress` formula.
- **Prev/next buttons** — decrement/increment `offset` by the same
  `cardWidth + 24px` step, with mirrored wrap-around.
- Every animation is neutralized under `prefers-reduced-motion: reduce`
  (instant fade-in, no transitions, and the auto-advance interval never
  starts).

### Accessibility affordances (additive — SPEC-BATCH2 §4)

- Prev/next are real `<button type="button">` elements with
  `aria-label="Previous testimonial"` / `"Next testimonial"`, reachable by
  Tab, with a visible `:focus-visible` ring (the one chromatic accent, see
  Palette above).
- Auto-advance stops on `mouseenter`/`focusin` of the carousel or nav row
  and resumes on `mouseleave`/`focusout` (verified with headless
  before/after offset checks), and never starts at all under
  `prefers-reduced-motion: reduce`.
- Quotes use `<blockquote>`; author names use `<cite>`.
- A visually-hidden `aria-live="polite"` region announces which testimonial
  is showing after every advance, for screen-reader users who can't see the
  slide.
- Decorative SVGs (quote mark, stars, chevrons) carry `aria-hidden="true"`;
  the star row is wrapped with `role="img" aria-label="5 out of 5 stars"`.

## Fidelity comparison (verified against `preview_url`)

The prompt's `preview_url` is a 75-frame animated WebP of the real render.
Frames were extracted and inspected directly, then compared against a
1440×900 headless screenshot of this page.

**Matched:** two-card layout with no third card peeking (`max-w-4xl` at
`427.5px` cards + `24px` gap accounts for exactly that), header row
composition and alignment, serif accent on "builders", 5-star + "Clutch
5/5" rating block, card shadow/radius/padding asymmetry, quote-glyph
placement, avatar/name/role byline with the `↳` glyph, prev/next button
position and shape, and the one-card-per-tick auto-advance cadence.

**Deviation, reasoned:** the preview's decoded frames read as a uniform
off-white/grey (`#ebebeb`, ~82% of all pixels, background and card
indistinguishable) rather than pure white. The prompt's color spec states
"Background: white" twice, unambiguously, with no hex to round or "improve"
— and dark pixels in the same frames are not proportionally shifted, which
is consistent with WebP/thumbnail compression rather than a deliberate
off-white design choice. Per the fidelity rule's own carve-out ("the
screenshot outranks *ambiguous* prose"), this is not an ambiguous-prose
case, so the page ships the prompt's literal white. Flagged here rather
than silently resolved.

## Fonts

`cdn_fonts`: Inter (400/500/600) and Fraunces (default weight) via the
Google Fonts CDN — see `template.json`. Both substitute for non-Google
fonts named in the prompt (PP Neue Montreal, PP Mondwest); see Typography
above.
