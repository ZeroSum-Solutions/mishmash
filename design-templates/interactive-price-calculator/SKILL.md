---
name: interactive-price-calculator
description: |
  A dark, full-width project-estimation calculator section for a fictional
  web studio, Webfluin Studio. A four-part form on the left (service type,
  page-count slider, add-on checkboxes, delivery timeline) drives a live
  cost-estimation panel on the right that compares the studio's price
  against a stand-in agency and freelancer quote. Built as a standalone
  page with slim nav chrome so the section previews on its own.
tags:
  - "component"
  - "motionsites"
  - "pricing"
  - "calculator"
  - "form"
  - "saas"
triggers:
  - "price calculator"
  - "pricing calculator"
  - "project estimator"
  - "cost calculator"
  - "quote calculator"
  - "webfluin"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=price-calculator"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "component"
  scenario: "marketing"
  example_prompt: "Build this project-estimation calculator section as a self-contained page in this template's own visual system, keeping the same four form fields, live-updating math, and three-card cost comparison. Ask only for the missing essentials first: the studio's real name, its actual pricing rules, and any copy changes."
---

# Interactive Price Calculator

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A dark two-column calculator section (`#calculator-section`) that lets a
visitor configure a website project and see its price update live, next to
what an agency or freelancer would typically charge for the same scope. The
prompt described a component, so this page ships minimum chrome — a slim
wordmark nav — around the full-fidelity section itself; no invented hero or
filler sections were added.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the real studio name, real base
   prices, real add-on costs, and real comparison figures. The pricing
   formulas live in the inline `<script>` — update `SERVICE_RATES` and the
   `calculatePrice` / `calculateAgencyCost` / `calculateFreelancerCost`
   functions together so the math and the displayed numbers stay in sync.
3. **Preserve the design system.** The palette, spacing rhythm, and card
   shapes in the build spec below are the identity — do not substitute
   fonts, recolor the palette, or strip the custom radio/checkbox visuals.
4. **Extend by duplicating sections**, never by importing a layout from
   another template.
5. **Keep motion and interaction accessible.** Every control is a real,
   labeled, keyboard-reachable form element; do not replace them with
   div-based fakes when adapting this template.

## Build spec

### Palette

- `--background` / `.calc-result` surface: `#0a0a0a` (near-black; the
  prompt's `bg-background` token has no literal value, so a conventional
  shadcn dark-theme near-black was used).
- `--panel` (left form column): `#0d0d0d`, exactly as specified.
- `--divider`: `#1e1e1e`, exactly as specified — separates the form's four
  fields (`divide-y`).
- `--accent`: `#ff5656`, exactly as specified — drives every radio dot,
  checkbox fill, and price figure in the form.
- `--accent-a` / `--accent-b`: `#ec4899` / `#f97316` (Tailwind `pink-500` /
  `orange-500`, exactly as specified) — the "Your price" card's gradient,
  built from `linear-gradient(90deg, var(--accent-a), var(--accent-b))` so
  MishMash's recolor pass can retint it.
- Neutral card fill (`bg-muted/50` in the prompt): `rgba(38, 38, 38, 0.5)`,
  literal per SPEC.md (neutral scaffolding stays literal, not a var()).
- `--muted-foreground`: `#a3a3a3` for the eyebrow label and helper text.

### Typography

Google Fonts substitutes for the prompt's unstated font stack: **Inter**
for body/heading text (the prompt's default sans class) and **JetBrains
Mono** for every `font-mono` element (the eyebrow label, the live page-count
value, and the red price tags). Both are common defaults for a
shadcn/ui-styled dark SaaS page, matching the prompt's utility-class intent.

- Eyebrow label: JetBrains Mono, uppercase, 0.75rem, `letter-spacing: 0.15em`.
- `<h2>`: Inter 400, `1.875rem` → `2.25rem` at 768px → `3rem` at 1024px
  (the prompt's `text-3xl md:text-4xl lg:text-5xl` steps, reproduced as
  exact breakpoint jumps rather than a fluid clamp, since the prompt
  specified discrete Tailwind sizes).
- Card prices: Inter 700, `2.25rem` (agency/freelancer) and `3rem`
  ("Your price"), matching `text-4xl font-bold` / `text-5xl font-bold`.

### Layout

- Section: `max-width: 80rem` centered, `padding: 4rem 1rem` → `7rem 4rem`
  at 768px (the prompt's `py-16 md:py-28 px-4 md:px-16`).
- Header: centered eyebrow + `<h2>`, `max-width: 42rem`.
- `.calc-grid`: single column below 1024px, `1fr 1fr` at 1024px+,
  `border-radius: 1rem`, `overflow: hidden`, no gap — exactly as specified.
- Left column (`.calc-form`, a real `<form>`): `padding: 2rem` → `3rem` at
  1024px, four `.calc-field` blocks separated by `border-top` dividers
  (the prompt's `divide-y divide-[#1E1E1E]`).
- Right column (`.calc-result`, an `<aside>`): `padding` matching the form,
  `border: 1px solid rgba(255,255,255,0.1)`, `min-height: 717.98px` (the
  prompt's literal value), right-corner rounding at 1024px+.

### Sections (top to bottom, left column)

1. **Service type** — 3 radio options (`Only Design` / `Only Development`
   / `Design + Development`, the last checked by default), each with a
   custom `w-5 h-5` circular indicator that fills with the accent color
   when active.
2. **Number of pages** — a real `<input type="range">`, `min=1 max=30
   step=1`, default `5`, with the live value shown in accent color next to
   the field heading and `1` / `30` scale labels below the track.
3. **Add-ons** — 2 checkboxes (`I will need help with content`, `I want to
   optimize my website for SEO`), each with an inline accent price tag
   (`+$50/pages`) and a custom square indicator with a white checkmark SVG
   when checked.
4. **Timeline** — 3 radio options (`Within 7 Days` +$100/pages, `Within 14
   Days` +$25/pages, `Regular Speed (Based on discussion)` no extra cost,
   default checked).

### Right column — Estimated Cost

Three stacked cards: **Typical Agency charges minimum** and **Regular
Freelancer charges minimum** (both on the translucent neutral card fill),
and **With Webfluin Studio** (the pink-to-orange gradient hero card). All
three prices recompute live on every form change.

### Pricing logic (ported exactly)

```
calculatePrice(serviceType, pages, needContent, needSEO, timeline):
  rates = { design: {base:399, perPage:100},
            development: {base:199, perPage:100},
            both: {base:499, perPage:200} }
  total = max(base, base + (pages - 1) * perPage)
  if needContent: total += pages * 50
  if needSEO:      total += pages * 50
  if timeline == "rush": total += pages * 100
  if timeline == "fast": total += pages * 25

calculateAgencyCost(pages, serviceType):
  perPage = serviceType == "both" ? 1000 : 400
  return 8000 + (pages - 1) * perPage

calculateFreelancerCost(pages, serviceType):
  perPage = serviceType == "both" ? 500 : 200
  return 3000 + (pages - 1) * perPage
```

All figures render through `toLocaleString()` with a `$` prefix, exactly
as specified.

### Motion

Minimal and functional, not decorative: radio dots and checkbox fills
transition on state change (`160ms`, the repo's ease-out curve), the range
thumb grows slightly under `:active`, and every transition is neutralized
under `prefers-reduced-motion: reduce`.

### Accessibility affordances

- Radio groups use native `<input type="radio">` in a `role="radiogroup"`
  wrapper, so arrow-key navigation between options is native browser
  behavior; the visual dot is a sibling `<span aria-hidden="true">`.
- The page-count slider is a native `<input type="range">` — Left/Right and
  Up/Down arrows, Home/End, and Page Up/Down all work without extra script.
  `aria-valuetext` updates live to announce "N pages".
- Checkboxes are native `<input type="checkbox">` with the checkmark SVG
  marked `aria-hidden`, so the accessible state comes from the input itself.
- The whole form has no server `action`; `input`/`change` listeners drive a
  pure client-side recompute — there is nothing to "submit".
- Every control sits inside a `<label>`, so clicking or tapping the text
  toggles the control, and each has a visible `:focus-visible` outline in
  the accent color.

### Deviation note

The prompt lists `useToast hook` as a dependency but never describes a
toast trigger or its copy. Since FIDELITY.md forbids inventing content the
prompt doesn't specify, no toast was added — nothing in the spec describes
what it would say or when it would fire.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="interactive-price-calculator" type="text/html" title="Interactive Price Calculator">
<!doctype html>
<html>...</html>
</artifact>
```
