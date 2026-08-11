---
name: solace-sign-in
description: |
  Fullscreen sign-in page for the fictional wellness brand **Solace**, built as
  a single self-contained HTML page. A looping night lavender-field video fills
  the viewport; a centered glass card floats above it with a genuine per-pixel
  canvas refraction effect — not a CSS blur — that bends and brightens the live
  video frame behind it in real time. Logo, gradient heading, email/password
  fields, a custom checkbox, a Sign In button, a Google button, and a join link
  fade up in a staggered sequence on load.
tags:
  - "web-app"
  - "motionsites"
  - "sign-in"
  - "login"
  - "auth"
  - "liquid-glass"
  - "form"
triggers:
  - "solace"
  - "sign in"
  - "sign-in page"
  - "login page"
  - "liquid glass"
  - "glass refraction"
  - "wellness login"
  - "auth form"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=solace-sign-in"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "web-app"
  scenario: "marketing"
  example_prompt: "Build a sign-in page like this one, in this template's own visual system, but for my real product. Follow the build spec exactly — the looping background video, the per-pixel liquid-glass card, and the staggered fade-up reveal are part of the identity. Ask only for the missing essentials first: brand name, logo mark, and where a real sign-in should go."
---

# Solace — Liquid Glass Sign-In

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Fullscreen sign-in page for the fictional wellness brand **Solace**, built as a
single self-contained HTML page. A looping night lavender-field video fills the
viewport; a centered glass card floats above it with a genuine per-pixel canvas
refraction effect — not a CSS blur or `backdrop-filter` — that bends and
brightens the live video frame behind it in real time. Logo, gradient heading,
email/password fields, a custom checkbox, a Sign In button, a Google button,
and a join link fade up in a staggered sequence on load.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** — swap the background video, the logo mark,
   and the "Solace" framing (`<title>`, meta description) for the user's real
   brand. Wire the intercepted `submit` handler to a real auth endpoint if the
   user wants live sign-in — the shipped version only reveals an inline
   success state and never posts anywhere.
3. **Preserve the design system.** The glass card's refraction math, the white
   → purple-300 gradient heading, the white-on-transparent form palette, and
   the fade-up stagger are the identity — do not restyle the card as a flat
   panel or swap the refraction engine for a CSS blur.
4. **Extend by duplicating the field pattern** (`<label>` → `.field-input`)
   rather than importing a different form component.
5. **Keep motion accessible.** The fade-up stagger collapses to an instant,
   fully-visible render, and the background video pauses, under
   `prefers-reduced-motion`, as the build spec below requires.

## Build spec

### Palette

- Neutral scaffolding: `#0a0a0f` page background, white text and surfaces at
  varying opacity (`rgba(255,255,255,0.05)` through `0.9`) for fields, borders,
  and secondary text — these are literal per Tailwind's white-opacity utility
  values in the source prompt (`white/5` … `white/90`).
- `#111827` (Tailwind `gray-900`) — Sign In button text.
- **Chromatic tokens** — `--purple-300: #d8b4fe`, `--purple-400: #c084fc`,
  `--purple-500: #a855f7`. `--purple-500`/`--purple-400` drive the checked
  checkbox fill/border; `--grad-to` (aliased to `--purple-300`) is the cool end
  of the heading's `linear-gradient(to right, var(--grad-from), var(--grad-to))`
  text gradient — the one gradient in the page, and it is `var()`-driven so
  MishMash's recolor pass can shift it.
- The Google "G" mark keeps its real 4-color brand palette (`#4285F4`,
  `#34A853`, `#FBBC05`, `#EA4335`) — that is the actual Google logo, not a
  design accent, so it is not tokenized.

### Type

Inter (400/500/600/700) from Google Fonts, `-webkit-font-smoothing:
antialiased`. Heading `"Step back in!"`: `1.875rem` → `2.25rem` (≥640px) →
`3rem` (≥768px), weight 500, `letter-spacing: -0.025em`, gradient-clipped text.
Subtitle: `0.75rem` → `0.875rem` (≥640px) → `1rem` (≥768px), `line-height:
1.625`, `rgba(255,255,255,0.6)`. Field labels `0.875rem` weight 500. Inputs and
buttons `0.875rem`–`1rem`.

### Layout

`.scene` is a `min-height: 100vh` relative container holding the background
`<video>` (`position: absolute; inset: 0; object-fit: cover`) and a flex
centering wrapper. The card: `width: 100%; max-width: 32rem` (512px),
`border-radius: 1rem`, padding `24px` → `40px` (≥640px) → `56px` (≥768px),
`box-shadow` (Tailwind `shadow-2xl`). The `<canvas>` refraction layer is the
card's first child, absolutely positioned to fill it at `z-index: 0`; all form
content sits in a `position: relative; z-index: 1` wrapper above it. Form
controls stack with `1.25rem` gaps (Tailwind `space-y-5`).

### Motion inventory

1. **Liquid-glass per-pixel refraction (the signature effect).** Ported
   verbatim from the prompt's `LiquidGlass` class — same LUT-based
   radial-distortion formula, same bilinear sampling, same specular/border
   overlay math, same constants (`distort: 0.06`, `edgeCurl: 0.04`,
   `brightness: 0.06`, `specular: 0.20`, `border: 0.18`, shape
   `roundedrect`/`rx: 16`). On every `requestAnimationFrame`, it crops the
   current video frame under the card's screen position, bends each pixel's
   sample point through the lookup table, and redraws the card's `<canvas>` —
   a real-time refraction of the *actual* moving background, not a static
   image or a CSS filter. Re-initializes on `resize`.
2. **Fade-up entrance.** Ten elements (logo, heading, subtitle, email field,
   password field, remember/reset row, Sign In button, divider, Google button,
   join line) reveal on a `0/100/200/…/900ms` stagger, each transitioning
   `opacity` and `translateY(20px) → translateY(0)` over `700ms` with
   `cubic-bezier(0.16, 1, 0.3, 1)` — the prompt's exact `FadeUp` component
   timing, ported from `setTimeout` + CSS transition into a `data-fade-delay`
   attribute + class toggle.
3. **Interactive micro-transitions**: input border/background on focus
   (`150ms`), Sign In / Google button `active:scale(0.98)`, checkbox
   border/fill on check, password-toggle icon color on hover.
4. `prefers-reduced-motion: reduce` disables the fade-up stagger (everything
   renders at its final state immediately) and pauses the background video
   after its first frame — the refraction canvas still renders that single
   static frame, so the card keeps its glass look without anything moving.

### Accessibility affordances (additive only — the rendered look is unchanged)

- A real `<form>` with a visible `<label for>` on both the email and password
  inputs, correct `type` (`email`/`password`) and `autocomplete`
  (`email`/`current-password`).
- Native `required` on both fields plus `minlength="6"` on password carries
  the error state: an empty or too-short submit is blocked by the browser's
  own constraint validation (verified via `validationMessage` /
  `validity.valid`) before our `submit` handler ever runs — no invented error
  UI on top of the source design.
- **No `action` attribute — the form never posts anywhere.** `submit` is
  intercepted with `preventDefault()`; a valid submission (verified via
  Playwright) swaps the Sign In button to a disabled "Signed in ✓" state with
  an `aria-live="polite"` status message, then reverts after ~2.2s.
  Google/Reset/Join buttons are real, focusable, keyboard-operable `<button
  type="button">` elements with no live destination.
- Password visibility toggle is a labeled icon button (`aria-label` toggles
  "Show password" / "Hide password", `aria-pressed` tracks state).
- The custom checkbox is a real `<input type="checkbox">` wrapped in its
  `<label>` (native check semantics, full keyboard support) with a decorative
  box/checkmark layered via CSS sibling selectors — verified via
  `el.checked` after a click.

### Deviations from a literal reading of the prompt (all permitted, all additive)

- **Background video embedded as a base64 `data:` URI, not `assets/…mp4`
  referenced by relative path.** The glass canvas calls
  `ctx.getImageData()` on a crop of the video frame every animation frame.
  Under a `file://` origin (and, by the same taint rule, inside an opaque-
  origin `srcdoc` iframe), any video loaded from a distinct URL — even a
  same-folder relative path — taints the canvas and `getImageData()` throws
  `SecurityError`; this was verified directly (confirmed with a minimal
  Playwright repro before writing the real file) and is the same class of
  bug the batch brief flags for `mask-image` CORS failures, here applying to
  the asset the refraction engine itself depends on. A `data:` URI sidesteps
  the taint check entirely and was confirmed working. The original clip is
  still vendored on disk at `assets/lavender-night-loop.mp4` (re-encoded
  1280×720 h264, ~1.4MB, 10s muted loop) for provenance/editing even though
  `example.html` references the inline copy for correctness.
- **`crossorigin="anonymous"` dropped from the `<video>` tag.** The prompt's
  React version sets it, but under `file://` it makes Chromium refuse to fetch
  the video at all (CORS policy blocks `file:` as a fetch scheme) — confirmed
  with the same repro above. It served no purpose once the source is a
  same-document `data:` URI, so it is omitted rather than causing a load
  failure.
- **Error state relies on native HTML5 constraint validation** rather than a
  custom inline error message, since the prompt's design never specifies one
  — inventing new error-state visuals would be an unrequested addition, and
  the native browser behavior already satisfies "a real error state renders."

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="solace-sign-in" type="text/html" title="Solace — Liquid Glass Sign-In">
<!doctype html>
<html>...</html>
</artifact>
```
