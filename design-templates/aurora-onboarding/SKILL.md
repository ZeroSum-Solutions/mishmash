---
name: aurora-onboarding
description: |
  Two-column sign-up page for the fictional product **Aurora**, built as a
  single self-contained HTML page. A looping violet aurora-gradient video
  fills the left 52% panel with no overlay; the right panel holds a "Create
  New Profile" registration form — social buttons, name/email/password
  fields, a password-visibility toggle, and a full-width submit — that fades
  in on load. A vertical 3-step onboarding checklist (step 1 active) sits
  over the video as a static progress illustration.
tags:
  - "web-app"
  - "motionsites"
  - "sign-up"
  - "registration"
  - "onboarding"
  - "auth"
  - "form"
triggers:
  - "aurora"
  - "aurora onboard"
  - "sign up"
  - "sign-up page"
  - "registration form"
  - "create account"
  - "onboarding page"
  - "auth form"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=aurora-onboard"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "web-app"
  scenario: "marketing"
  example_prompt: "Build a sign-up page like this one, in this template's own visual system, but for my real product. Follow the build spec exactly — the 52/48 split, the looping hero video with no overlay, and the staggered reveal are part of the identity. Ask only for the missing essentials first: brand name, background footage, and where a real sign-up should post."
---

# Aurora — Create New Profile

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Two-column sign-up page for the fictional product **Aurora**, built as a
single self-contained HTML page. A looping violet aurora-gradient video fills
the left 52% panel with no overlay; the right panel holds a "Create New
Profile" registration form — social buttons, name/email/password fields, a
password-visibility toggle, and a full-width submit — that fades in on load.
A vertical 3-step onboarding checklist (step 1 active) sits over the video as
a static progress illustration.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** — swap the background video, the "Aurora"
   wordmark, and the step copy for the user's real brand and onboarding
   phases. Wire the intercepted `submit` handler to a real signup endpoint if
   the user wants live registration — the shipped version only reveals an
   inline success state and never posts anywhere.
3. **Preserve the design system.** The 52/48 split, the black / white /
   `#1A1A1A` palette, the violet aurora accent, and the stagger timings are
   the identity — do not restyle the hero as a flat color block or collapse
   the two-column layout.
4. **Extend by duplicating the field pattern** (`<label>` → `.input-group`)
   rather than importing a different form component.
5. **Keep motion accessible.** The hero and form reveals collapse to an
   instant, fully-visible render, and the background video is replaced by a
   static gradient, under `prefers-reduced-motion`, as the build spec below
   requires.

## Build spec

### Palette

- Neutral scaffolding, literal: `#000` (page, panels, inputs' resting
  border-less surface via `--color-brand-gray: #1A1A1A`), white at opacity
  `0.1`/`0.2`/`0.4`/`0.6`/`0.9` for borders, placeholders, muted copy, and
  hover states — literal per Tailwind's white-opacity utilities in the source
  prompt (`white/10` … `white/90`).
- **Chromatic tokens** — `--aurora-1: #d6c2ec`, `--aurora-2: #8a5cd6`,
  `--aurora-3: #3a2470`. These were sampled directly from the prompt's own
  preview footage (a grainy violet-to-black vertical gradient) and are used
  as `var()` gradient stops in the hero's `prefers-reduced-motion` / video-
  `error` fallback, and reused as `--aurora-accent` for the focus-visible ring
  on controls the prompt leaves silent (social buttons, the password toggle,
  the submit button, the footer link) — additive-only, the resting appearance
  is untouched.

### Type

Inter (300/400/500/600/700) from Google Fonts. "Join Aurora" — `2.25rem`,
weight 500, `letter-spacing: -0.025em`, `white-space: nowrap`. "Create New
Profile" — `1.875rem`, weight 500, same tracking. Brand wordmark "Aurora" —
`1.25rem`, weight 600, same tracking. Hero description and step labels —
`0.875rem`–`1rem`, body copy at `line-height: 1.625` and `white/60`. Divider
label "Or" — `0.75rem`, weight 500, uppercase, `letter-spacing: 0.1em`,
`white/40`.

### Layout

`.shell` is `flex` (`column` under 1024px, `row` at ≥1024px), padding `8px` →
`16px` at ≥1024px. Hero: `flex: 0 0 52%`, `height: 100%`, `border-radius:
24px`, `box-shadow: 0 25px 50px -12px rgba(0,0,0,.25)` (Tailwind `shadow-2xl`),
padding `0 48px 128px`, `justify-content: flex-end`, hidden below 1024px.
`<video>` is `position: absolute; inset: 0; object-fit: cover`, `autoplay
muted loop playsinline`, **no overlay of any kind** — the prompt is explicit
that the footage plays unmasked. Hero content: `max-width: 320px`, `gap:
32px`. Form column: `flex: 1 1 auto`, responsive padding (`16px` → `48px`
(≥640px) → `64px`/`24px` vertical (≥1024px) → `96px` horizontal (≥1280px));
form card: `max-width: 576px`, gap `32px` → `40px` (≥640px) → `24px`
(≥1024px).

### Motion inventory

1. **Hero stagger reveal** — three groups (brand row, heading block, the
   3-step list) fade up (`translateY(10px) → 0`, opacity `0 → 1`, `500ms`,
   `cubic-bezier(0.23, 1, 0.32, 1)`) on a `0.2s / 0.35s / 0.5s` delay ladder —
   the prompt's `staggerChildren: 0.15` + `delayChildren: 0.2` ported to CSS
   `animation-delay`.
2. **Form fade-in** — the form card opacity `0 → 1` over `800ms` `ease-out`,
   matching the prompt's `motion.div` duration exactly.
3. **Interactive micro-transitions** — social-button hover background
   (`200ms`), submit-button hover background + `active: scale(0.98)`,
   input focus ring (`box-shadow` in `white/20`), password-toggle icon swap,
   and a `--aurora-accent` focus-visible ring on every control the prompt
   leaves silent on focus styling.
4. `prefers-reduced-motion: reduce` disables both reveal animations (final
   state renders immediately), swaps the hero video for its gradient
   fallback (same aurora palette, no motion), and turns off every hover/active
   transition.

### Accessibility affordances

- A real `<form>` with a visible `<label for>` on every field, correct
  `type`/`autocomplete` (`given-name`, `family-name`, `email`,
  `new-password`), and `required` + `minlength="8"` on password — native
  constraint validation blocks an incomplete or too-short submit before the
  page's own handler runs (verified via `checkValidity()`/`reportValidity()`
  in a headless run).
- **No `action` attribute.** Submit is intercepted with `preventDefault()`; a
  valid submission hides the field set (`#form-fields[hidden]`) and reveals a
  focus-managed `#success-panel` (`tabindex="-1"`, `aria-live="polite"`) with
  a "Back to form" reset control. The `[hidden]` toggle uses a
  class+attribute selector with higher specificity than the flex `display`
  rule on the same element, so the hide actually takes effect — this exact
  "`display:flex` outranks `[hidden]`" failure mode is called out in the
  batch brief and was checked directly with a driven click-through, not just
  a static render.
- Password visibility toggle is a real `<button aria-pressed>` whose
  `aria-label` swaps "Show password" / "Hide password", `aria-controls`
  pointing at the password field.
- The two social buttons are real, focusable `<button type="button">`
  elements with no live destination; clicking either surfaces a transient
  `aria-live="polite"` toast ("Google/Github sign-in is disabled in this
  preview") instead of doing nothing.
- The 3-step list is a static onboarding-progress illustration in the source
  design — the prompt gives it no forward/back control — marked up as an
  `<ol>` for semantic order rather than as an interactive stepper.
- Every added focus-visible ring is additive only; it does not restyle any
  control's resting appearance.

### Deviations from a literal reading of the prompt (all permitted, all additive)

- React + Tailwind v4 + `motion/react` + `lucide-react` → semantic HTML +
  vanilla CSS and inline JS, translating the implementation only (SPEC.md's
  translation rule) — the same visuals and motion.
- `lucide-react`'s `Circle`, `Chrome`, `Github`, `Eye`/`EyeOff` icons are
  hand-redrawn as inline SVG (stroke-based, `24×24`, `stroke-width: 2`) — no
  icon library ships with the page.
- The hero video is re-encoded locally (CRF 19, `1248×1664`, ~6.3MB, no audio
  track) from the prompt's exact CloudFront source URL. A poster frame and a
  `var()`-driven gradient fallback (sampled from the same clip) stand in
  while the video loads, if its `error` event fires, or under reduced motion.
- The hero column uses `flex: 0 0 52%` rather than a bare `width: 52%`. A flex
  item with the browser's default `flex-shrink: 1` gets squeezed below its
  stated width once the sibling column's content establishes a large `auto`
  flex-basis — confirmed by measuring the rendered box, not by eyeballing a
  screenshot. This is a layout-robustness fix, not a design change: the
  rendered proportion is exactly the prompt's 52/48 split.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="aurora-onboarding" type="text/html" title="Aurora — Create New Profile">
<!doctype html>
<html>...</html>
</artifact>
```
