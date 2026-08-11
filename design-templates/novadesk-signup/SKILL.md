---
name: novadesk-signup
description: |
  Full-viewport sign-up page for the fictional workspace product NovaDesk,
  built as a single self-contained HTML page. A muted, looping, full-screen
  video plays behind a centered two-column card: a dark opaque form panel on
  the left (email, password with a show/hide toggle, a custom checkbox terms
  agreement, a primary submit button, and three social sign-in buttons) and a
  translucent glass panel on the right that lets the video show through,
  desktop only. Submitting the form never leaves the page — it validates
  in-browser and swaps the form for an inline confirmation state.
tags:
  - "web-app"
  - "motionsites"
  - "signup"
  - "auth"
  - "video-background"
triggers:
  - "novadesk"
  - "sign up"
  - "signup"
  - "sign-up page"
  - "video background login"
  - "auth form"
  - "create account"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=novadesk-signup"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "web-app"
  scenario: "marketing"
  example_prompt: "Build NovaDesk — Sign Up as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — the video background, the two-column card, and the form behavior are part of the identity. Ask only for the missing essentials first: real brand name, real copy, and a background video or image to swap in."
---

# NovaDesk — Sign Up

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Full-viewport sign-up page for the fictional workspace product NovaDesk. A
muted, looping, full-screen video plays behind a centered two-column card: a
dark opaque form panel on the left and a translucent glass panel on the right
that lets the video show through (desktop only, hidden below the `sm`
breakpoint). Submitting the form never leaves the page — it validates
in-browser and swaps the form for an inline confirmation state.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, logo
   mark, background video, and legal copy. Keep the same field set and card
   proportions when swapping content.
3. **Preserve the design system.** The palette, type scale, spacing, and
   two-panel card layout in the build spec below are the identity — do not
   substitute fonts, recolor the palette, or strip the glass panel.
4. **Extend by duplicating sections**, never by importing a layout from
   another template.
5. **Keep motion accessible.** The background video pauses and rests on its
   poster frame under `prefers-reduced-motion`, as the build spec requires.
6. **Wire the form to a real backend** by replacing the inline `submit`
   handler in the `<script>` block; keep the client-side validation and the
   inline success state as the fallback UX while a request is in flight.

## Build spec

Described from the finished page.

### Palette

- Brand accent: `#DA3F23` (logo mark, submit success icon, focus-visible
  outline color).
- Left form panel surface: `rgba(10, 10, 10, 0.92)` over the video.
- Right glass panel surface: `rgba(255, 255, 255, 0.05)` with a
  `rgba(255, 255, 255, 0.08)` 1px border — a deliberately subtle frosted
  overlay on top of the video, not a solid fill.
- Inputs and social buttons: `rgba(39, 39, 42, 0.7)` / `rgba(39, 39, 42, 0.6)`
  zinc surfaces, lightening on hover.
- Text: white for headings, a zinc-400/500/600 ramp for body copy, labels,
  and placeholders.
- The submit button and its hover/active states are the only near-white
  surfaces — everything else stays dark so the button reads as the primary
  action against the video.

### Typography

System font stack (no custom font imports — the source design specifies
default Tailwind system fonts, so none are vendored here). Headings and the
brand wordmark use `font-weight: 600` with tight letter-spacing; secondary UI
text uses `500`; body/placeholder text is regular weight at `0.75–0.875rem`.

### Layout

- Page root: full-viewport, video pinned behind everything (`position:
  absolute; inset: 0`), card centered with flexbox. Below the `640px`
  breakpoint the page scrolls and the card takes its natural height; at and
  above `640px` the page is a fixed `100vh` and the card locks to `660px`
  tall.
- Card: `max-width: 56rem`, rounded `1rem`, `overflow: hidden`, stacked
  column on mobile, row layout (`flex-direction: row`) at `640px` and up.
- **Left panel (form, 50% width on desktop, full width on mobile):** brand
  lockup (logo mark + "NovaDesk" wordmark) pinned to the top; the form group
  pinned to the bottom on desktop via `margin-top: auto`, top-anchored under
  the brand on mobile.
- **Right panel (glass, desktop only):** centered logo mark offset upward by
  `70px` from true center, matching the source spec's inline
  `margin-top: -70px`. Hidden entirely below `640px` — on mobile the form
  panel takes the full card width.

### Sections, top to bottom in the left panel

1. Brand lockup — inline SVG mark (a stylized interlocking "N/loop" glyph,
   `viewBox 0 0 256 256`) at `36px`, plus the "NovaDesk" wordmark in the
   brand accent color.
2. Heading ("Join us") and one-line subtext.
3. Email field — single text input, visually-hidden `<label>`, real
   `type="email"` and `autocomplete="email"`.
4. Password field — `type="password"` toggling to `type="text"`, a trailing
   icon button that swaps between an open-eye and a slashed-eye glyph,
   `aria-pressed` and `aria-label` updating with the state,
   `autocomplete="new-password"`.
5. Terms checkbox — a real checkbox wrapped in its own `<label>` so clicking
   anywhere on the visible custom box (not just the text) toggles it; checked
   state fills white with a black check glyph; a `:focus-visible` outline in
   the brand accent shows on keyboard focus without altering the resting
   look. The adjoining text label carries its own "Rules" / "Privacy Notice"
   links.
6. Submit button — "Launch Account", full-width, white on black text.
7. Divider — "or join us via" between two hairlines.
8. Three social sign-in buttons (Google, Apple, Twitter) in an equal-width
   row, monochrome outline icons plus label text.
9. Footer line — "Already Hold An Account? Enter".
10. Inline success state (hidden until submit) — a filled accent checkmark
    badge, a "You're in" heading, a confirmation line echoing the submitted
    email, and a "Back to sign up" button that clears and re-shows the form.

### Motion inventory

- Background video: autoplaying, muted, looped, `playsinline`, paused and
  parked on its poster frame under `prefers-reduced-motion` (and resumed if
  the preference flips back at runtime via a `matchMedia` change listener).
- All interactive affordances (inputs, the submit button, the password
  toggle, social buttons, links, the checkbox) use `transition-colors`-style
  CSS transitions only — no keyframe animation, matching the source spec.
- No scroll-triggered reveals; the page is a single fixed-height view on
  desktop.

### Form behavior (accessibility- and rights-critical)

- The `<form>` carries no `action` or `method` — nothing is ever posted
  anywhere. `submit` is intercepted with `preventDefault()`.
- Client-side validation runs on submit (`checkValidity()` on the email and
  password fields, plus the checkbox's own `required` state) before the
  inline success state is shown; an invalid attempt calls
  `reportValidity()` and stops.
- On a valid submit, the form is hidden, the success panel is shown with
  `role="status" aria-live="polite"`, and focus moves to the "Back to sign
  up" button.
- Every control has a real associated label (visible or `sr-only`) — email,
  password, and the checkbox — plus correct `type`/`autocomplete` per SPEC
  §4.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="novadesk-signup" type="text/html" title="NovaDesk — Sign Up">
<!doctype html>
<html>...</html>
</artifact>
```
