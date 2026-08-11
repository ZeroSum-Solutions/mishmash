---
name: mouse-trail-cta
description: |
  A standalone CTA section: a large rounded white card carrying a giant serif
  "Partner with us" heading and a dark pill button (portrait avatar + label).
  Moving the cursor inside the card drops a trail of fading, randomly rotated
  project thumbnails behind the content. The trail has a real keyboard path
  (a focus-revealed trigger that replays the same effect) and a real touch
  path (dragging a finger across the card), and goes fully still under
  prefers-reduced-motion.
tags:
  - "component"
  - "motionsites"
  - "cta"
  - "cursor-trail"
  - "mouse-trail"
triggers:
  - "mouse trail"
  - "cursor trail"
  - "hover trail"
  - "partner with us"
  - "cta card"
  - "trailing thumbnails"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=mouse-trail-cta"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build a Mouse Trail CTA section as a self-contained page in this template's own visual system. Keep the palette, type, card geometry, and the exact cursor-trail motion math — swap in the real brand name, headline, and avatar."
---

# Mouse Trail CTA

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** — the heading, the avatar image, the CTA
   label, and the eight trail thumbnails — with the user's real brand name,
   portrait, and imagery. Keep the avatar and trail images roughly square /
   rectangular to match the existing crop.
3. **Preserve the design system.** The palette, type scale, card geometry,
   shadows, and the trail's spawn/fade math in the build spec below are the
   identity — do not substitute fonts, recolor the palette, or change the
   motion constants.
4. **Extend by duplicating**, never by importing a layout from another
   template. This template is intentionally one section; if it needs to sit
   inside a larger page, drop it in as-is rather than reshaping it.
5. **Keep motion accessible.** The trail's keyboard path (the focus-revealed
   trigger), its touch path (drag-to-spawn), and the `prefers-reduced-motion`
   fully-still fallback must all survive any edit.

## Build spec

The finished page, described from what was actually built.

### Layout

A single `<main class="page">` centers one `<section class="partner">` on a
soft off-white page background (`--page-bg: #EEF2F4`) so the white card reads
as deliberately placed rather than stranded on a blank canvas — this page
chrome is the only content not in the original prompt; no hero, no extra
sections were invented around it.

Inside, `.partner-card` is the card itself: `max-width: 1280px`, full width,
`padding: 12rem 0`, white (`--paper: #F6FCFF`) background, `border-radius:
40px`, and the shadow `0 0 0 0.5px rgba(0,0,0,0.05), 0 4px 30px rgba(0,0,0,0.08)`.
A centered content block (`.partner-content`, `pointer-events: none` except
its button) sits above an absolutely positioned `.trail-layer`
(`z-index: 0`) that holds the spawned thumbnails.

### Palette

- `--ink: #051A24` — CTA button background; also the sole focus-visible
  outline color (additive, does not restyle resting states).
- `--ink-2: #0D212C` — heading color and the button's hover background.
- `--paper: #F6FCFF` — card surface.
- `--mute: #E0EBF0` — unused surface neutral kept for extension.
- `--page-bg: #EEF2F4` — page chrome only, not part of the card itself.

`--ink` is a genuinely chromatic (non-grey) parseable color, so it is the
template's recolor-compatible root token; there is no gradient in this design
to convert to `var()` stops.

### Type

- Heading ("Partner with us"): `font-family: 'Fraunces', serif`, weight 400,
  `48px` base / `64px` at `≥768px` / `80px` at `≥1024px`, `line-height: 1.1`,
  `letter-spacing: -0.025em`, color `--ink-2`.
- Body / button label: `font-family: 'Inter', sans-serif`. Button label is
  `14px` / weight 500.

**Font substitution:** the prompt specifies PP Neue Montreal (body) and PP
Mondwest (serif display) via non-Google `@font-face` URLs. Neither is on
Google Fonts. Nearest Google equivalents were used instead — **Inter** for
the neutral grotesque body face, **Fraunces** for the wonky serif display
face — loaded via a Google Fonts `<link>` (`cdn_fonts` in `template.json`).

### CTA button

Dark pill (`--ink` background, white text), `padding: 0.875rem 1.5rem`,
`border-radius: 9999px`, `display: inline-flex; gap: 0.75rem`, a 40×40px
circular avatar, label "Start chat with Viktor", the layered shadow from the
prompt verbatim, `hover` background `--ink-2`, `200ms` color transition. On
click it shows an inline `aria-live="polite"` status line ("Chat request
sent — Viktor will reply shortly.") and disables itself for 2.6s to prevent
double-fires — there is no live endpoint, per spec.

### Motion — scroll reveal

Ports `useInViewAnimation`: an `IntersectionObserver` at `threshold: 0.1` on
the outer `<section>`, sticky once true. On first intersection the heading
and button swap `opacity-0` for `.animate-fade-in-up`
(`fadeInUp 0.8s ease-out forwards`, `translateY(30px) → 0`), heading delayed
`0.1s`, button `0.2s` — exact values from the prompt.

### Motion — mouse trail

Exact port of the prompt's constants and formulas, translated from React
state/refs to vanilla arrays and `requestAnimationFrame`:

- Spawn throttle: `80ms` between spawns (`Date.now() - lastSpawnTime`).
- Cleanup sweep: every `50ms`, removing any trail item older than `1000ms`.
- Per-item fade (recomputed every animation frame, same as the prompt's
  inline-style approach): `age = now - timestamp`, `progress = min(age /
  1000, 1)`, `opacity = 1 - progress`, `scale = 1 - progress * 0.15`,
  `transform: scale(${scale}) rotate(${rotation}deg)`.
- Rotation on spawn: `(Math.random() - 0.5) * 20` degrees.
- Position: `left = x - 50`, `top = y - 50` (thumbnail is 96px / `w-24`,
  centered on the cursor).
- Thumbnails: `border-radius: 12px`, Tailwind `shadow-lg` equivalent,
  `pointer-events: none`.

**Non-pointer paths (binding manifest requirement):**

- **Touch:** `touchmove` on the card calls the same spawn function with the
  touch point, so dragging a finger across the card is the literal touch
  equivalent of hovering with a mouse.
- **Keyboard:** a visually-hidden button ("Preview the hover-trail effect…"),
  positioned first inside the card, becomes visible on `:focus-visible`
  (standard skip-link pattern). Activating it (click, or Enter/Space via
  native button semantics) replays the same `spawnTrailImage` function along
  a preset 6-point arc, so a keyboard-only user reaches the same decorative
  content the hover effect reveals.
- **Reduced motion:** under `prefers-reduced-motion: reduce`, none of
  mousemove, touchmove, or the keyboard trigger spawn anything — the trigger
  button is `disabled` (removed from the tab order) rather than left as a
  dead control. The scroll-reveal still runs but with a near-zero animation
  duration, so the page resolves to a fully static final state.

### Trail imagery

The prompt's `images` prop is "any 8+ rectangular assets... the same
GIF/animation URLs you have on the rest of the page" — this template is a
standalone extraction with no "rest of the page" to draw from, so eight
abstract project-preview thumbnails were designed for it instead (`assets/
thumb-{dashboard,portfolio,commerce,analytics,mobile,brand,network,
editorial}.svg`), in the card's own navy/white palette. They are original
vector compositions, not photographs of any real product or site.

### Avatar

`assets/avatar.jpg` — a royalty-free stock photo of an unidentified person
(Pexels), cropped square, used only as a generic portrait per the "Start
chat with Viktor" CTA. No real person's name, likeness, or identity is
implied beyond the fictional "Viktor" persona already established as
fictional brand content.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="mouse-trail-cta" type="text/html" title="Mouse Trail CTA">
<!doctype html>
<html>...</html>
</artifact>
```

## Source & rights

Generated output under a MotionSites unlimited-plan subscription; the
upstream prompt text is not included in this repository. `example.html` is
this template's own rebuild, translated from the prompt's React + Tailwind
spec to a single self-contained file (semantic HTML, inline CSS/JS, no
frameworks, no CDN JS/CSS beyond Google Fonts).
