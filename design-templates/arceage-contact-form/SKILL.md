---
name: arceage-contact-form
description: |
  White-on-black contact-form section for the fictional precision-harvesting
  brand **Arceage Ag**, built as a single self-contained HTML page. A two-line
  heading and subhead type themselves out character by character, then five
  underlined fields (name, email, phone, farm/company, message) fade and lift
  into view in a staggered cascade. Each required field gets a live green
  check or red cross on blur, and a black pill submit button turns green on
  hover. Wrapped in the site's own black page shell so the white section reads
  as placed rather than stranded.
tags:
  - "component"
  - "motionsites"
  - "contact-form"
  - "form"
  - "validation"
triggers:
  - "arceage"
  - "contact form"
  - "contact us"
  - "get in touch"
  - "farm contact form"
  - "harvesting contact"
  - "validation form"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=arceage-contact-us"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build a contact-form section like this one, in this template's own visual system, but for my real business. Follow the build spec exactly — the typewriter reveal, the underlined fields, and the green/red validation icons are part of the identity. Ask only for the missing essentials first: brand name, the fields I actually need, and where a real submission should go."
---

# Arceage Ag Contact Us — Typewriter Validation Form

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

White-on-black contact-form section for the fictional precision-harvesting
brand **Arceage Ag**, built as a single self-contained HTML page. A two-line
heading and subhead type themselves out character by character, then five
underlined fields (name, email, phone, farm/company, message) fade and lift
into view in a staggered cascade. Each required field gets a live green check
or red cross on blur, and a black pill submit button turns green on hover.
Wrapped in the site's own black page shell so the white section reads as
placed rather than stranded.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** — there is no brand name in the copy to
   swap (the original design never names the company in its visible text),
   so start with the field labels/placeholders and the inline success copy.
   Wire the intercepted `submit` handler to a real endpoint if the user wants
   live delivery — the shipped version only reveals an inline success state
   and never posts anywhere.
3. **Preserve the design system.** The black page shell, the white section,
   the underlined field style, the Barlow/Instrument Serif pairing, the
   typewriter reveal, and the green/red validation colors are the identity —
   do not restyle the inputs as boxed fields or swap the validation colors
   for a house accent.
4. **Extend by duplicating the field pattern** (`.field` wrapper → `<label>` →
   `.field-input-wrap` → `<input>` → `.field-icon`) rather than importing a
   different form component.
5. **Keep motion accessible.** The typewriter reveal and the field/button
   stagger both collapse to an instant, fully-visible render under
   `prefers-reduced-motion`, as the build spec below requires.

## Build spec

### Palette

- `#000000` black / `#ffffff` white — the section itself is genuinely
  monochrome at rest (nothing touched, no hover, no keyboard focus).
- `#1f2937` (gray-800) subtitle text.
- `#D9D9D9` field underline + resting placeholder color.
- `#6b7280` (gray-500) placeholder color once the field is focused.
- **Chromatic tokens** — `--valid-green: #27BD09` and `--invalid-red: #FF1F1F`.
  These are not injected decoration: they are the design's own interaction
  colors (the validation icons and the button's hover state), and neither
  one is visible until a field is touched or the button is hovered.
  `--focus-ring` reuses `--valid-green` and drives the one visible-focus
  outline in the page — it never appears in the resting render either, only
  on `:focus-visible`.

### Type

Barlow (`--font-sans`, weights 100–900 plus italics) for the subtitle,
labels, inputs, and button. Instrument Serif italic (`--font-dm-serif`) for
the "Let's grow!" accent phrase only — the rest of the heading stays Barlow
medium. Both are genuine Google Fonts; the exact CDN URL from the prompt is
used verbatim, no substitution needed. Heading:
`clamp(1.5rem, 4vw, 3.5rem)`, weight 500, `letter-spacing: -0.025em`,
`line-height: 1.1`. Subtitle: `1.125rem` (`1.25rem` from 768px), gray-800.

### Layout

Full-bleed white `<section id="contact">`: `96px` vertical padding, `24px`
horizontal padding (`48px` from 768px, `120px` from 1024px). Centered content
column capped at `48rem` (768px); the `<form>` itself caps at `42rem` (672px).
Each field: label above input, `1px solid #D9D9D9` bottom border, `8px` gap,
`8px` bottom padding; hover and focus-within darken the border to black. The
validation icon is an absolutely positioned `20×20px` CSS mask, vertically
centered on the input's right edge. The submit button is a black pill
(`999px` radius) that hugs its own text — verified with
`getBoundingClientRect()` at 1440px (138×37px, not stretched to the 672px
form width).

### Motion inventory

1. **Typewriter character reveal** — heading in three segments ("Let's
   grow!" delay `0s` speed `0.012s`, italic serif; " Fill in the form" delay
   `0.2s` speed `0.012s`; "and we'll be in touch" delay `0.4s` speed
   `0.012s`) and the subtitle ("Ask us about our precision harvesting
   services" delay `0.6s` speed `0.012s`). Ported as one `<span>` per
   character with `transition-delay = delay + index * speed`, fading
   opacity 0→1 over `0.2s` — the same constants as the source component's
   `staggerChildren`/`delayChildren`.
2. **Field/button stagger reveal** — the 5 fields plus the submit button
   fade and lift (`translateY(20px)` → `0`) over `0.6s ease-out`, each
   `0.1s` after the last, triggered once via `IntersectionObserver` at a
   `-100px` root margin the first time the section scrolls into view. Ports
   the source's outer `whileInView` wrapper with `staggerChildren: 0.1`.
3. **Border and placeholder color transitions** on hover/focus-within,
   `300ms`.
4. **Button background transition**, black → `--valid-green`, `300ms`, on
   hover.
5. **Validation icon swap** (green check / red cross) on blur — instant, as
   in the source (no transition was specified for the icon itself).
6. `prefers-reduced-motion: reduce` collapses (1) and (2) to their finished
   state immediately; nothing else in the page animates.

### Accessibility affordances (additive only — the rendered look is unchanged)

- A real `<form>` with a visible `<label for>` on every one of the five
  inputs (not `sr-only` — the source design already shows them).
- Correct input `type` (text/email/tel) and `autocomplete` values
  (`name`/`email`/`tel`/`organization`).
- Native `required` (name, email, phone) plus a native `pattern` on phone
  carry the required-field gating, per the batch brief's preference for
  native attributes over JS. The JS validators mirror the same rules only to
  drive the green/red icon and `aria-invalid` — they never substitute for
  native validation.
- `aria-invalid` plus a per-field `sr-only` status message once a required
  field is touched and still invalid.
- The animated typewriter spans are `aria-hidden`, paired with a
  visually-hidden full-sentence span, so assistive tech reads the real
  sentence instead of letter-by-letter noise.
- Visible focus ring (`2px solid var(--focus-ring)`) on every input and the
  submit button via `:focus-visible` only.
- **No `action` attribute** — `submit` is intercepted, native
  `checkValidity()`/`reportValidity()` gates it, and a valid submit swaps the
  form for an `aria-live="polite"` inline success message. Nothing is ever
  posted anywhere.

### Deviations from a literal reading of the prompt (all permitted, all additive)

- **Icons inlined as data URIs, not vendored to `assets/`.** The prompt
  points the CSS `mask-image` at two GitHub-hosted SVGs (a generic green
  check circle and red cross circle). Downloading them to `assets/` and
  referencing them by relative path renders correctly over HTTP, but
  Chromium's `file://` origin refuses the same `mask-image` fetch as
  cross-origin — a real, reproducible console error, not a hypothetical
  one. Base64-inlining the identical SVG content into the CSS keeps the
  vendored artwork (no remote dependency, no live GitHub fetch) while
  working under every serving context. No `assets/` directory ships because
  there is no other media to vendor.
- **`#contact-form[hidden] { display: none; }`** was added after the first
  interactive pass showed the success state rendering *next to* the still-
  visible form: `#contact-form { display: flex; }` (same ID, lower
  specificity than an ID-plus-attribute selector) was winning over the
  browser's default `[hidden]` rule, so setting `form.hidden = true` did
  nothing. This is additive plumbing to make the required accessibility
  behavior (real inline success state) actually work — it does not change
  the resting appearance.
- **The fifth field ("Tell Us More") is a single-line `<input>`, not a
  `<textarea>`,** even though its placeholder invites a longer answer. The
  prompt is explicit that all five fields are `<input>` elements; that is
  reproduced verbatim rather than "corrected" to a textarea.
- No brand name appears anywhere in the section's own copy — the prompt
  never puts one there. "Arceage Ag" is used only in this file's own
  description (for cross-reference with the sibling `arceage-testimonials`
  and `arceage-services-grid` templates, drawn from that shared MotionSites
  design system, not copied from either sibling file) and in the `<title>`
  tag; it does not appear as visible page copy.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="arceage-contact-form" type="text/html" title="Arceage Ag Contact Us — Typewriter Validation Form">
<!doctype html>
<html>...</html>
</artifact>
```
