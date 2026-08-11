---
name: racing-driver-profile
description: |
  Full-viewport motorsport driver profile hero for **Mateo Rourke** of the
  fictional **Solstice Racing** team in the fictional **Apex GP** series. A
  bottom-anchored driver photograph sits inside a backdrop-blurred, masked
  photo well behind a huge two-line name wordmark, a location/circuit
  heading, a hand-drawn circuit map, a roster filter, and a stacked
  "Season Points" column. A translucent giant numeral floats behind the
  composition. Desktop widens the photo well and repositions it right of
  center; mobile reverts to the source spec's literal full-bleed, bottom-
  anchored photo mechanic. One self-contained viewport, no scroll.
tags:
  - "landing-page"
  - "motionsites"
  - "motorsport"
  - "driver-profile"
  - "hero"
  - "photo-overlay"
  - "sports"
triggers:
  - "racing driver profile"
  - "driver profile hero"
  - "motorsport hero"
  - "f1 style profile page"
  - "season points stats"
  - "circuit map"
  - "roster filter"
  - "bottom anchored photo hero"
  - "blur mask photo"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=f1-driver-profile"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build a racing driver profile hero like Mateo Rourke's — a bottom-anchored, blur-masked photo well behind a huge two-line name, a circuit heading, a roster filter and a stacked points column — as a self-contained responsive page in this template's own visual system. Follow the build spec exactly: the photo mechanic, the type scale, and the motion are part of the identity. Ask only for the missing essentials first: the driver's real name and number, team/series names, headshot, and the season stats to display."
---

# Mateo Rourke — Racing Driver Profile

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

Full-viewport motorsport driver profile hero for **Mateo Rourke** of the
fictional **Solstice Racing** team in the fictional **Apex GP** series. A
bottom-anchored driver photograph sits inside a backdrop-blurred, masked photo
well behind a huge two-line name wordmark, a location/circuit heading, a
hand-drawn circuit map, a roster filter, and a stacked "Season Points" column.
A translucent giant numeral floats behind the composition. Desktop widens the
photo well and repositions it right of center; mobile reverts to the source
spec's literal full-bleed, bottom-anchored photo mechanic. One self-contained
viewport, no scroll, no sections below the fold.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace placeholder content** with the real driver's name, number,
   team/series names, headshot (same crop role — head-to-crossed-arms,
   bottom-anchored, bleeding past the container's left/right edges), circuit
   name/flag, and season numbers.
3. **Preserve the design system.** The photo mechanic's custom properties
   (`--photo-width`, `--photo-bottom`, `--container-top`, the blur/mask
   values), the type scale, and the stacked-numeral stats motif in the build
   spec below are the identity — do not flatten the name to a single line,
   remove the blur well, or restyle the stats as a table.
4. **Extend by duplicating patterns**, never by importing chrome from another
   template. If more sections are needed below the hero (biography, full
   career stats), design them fresh in this template's own vocabulary — the
   hero itself should stay exactly this spare, matching the source's own
   single-viewport scope.
5. **Keep motion accessible.** The load-in reveals, the ghost-numeral
   breathing loop, and the circuit pulse all collapse under
   `prefers-reduced-motion`; preserve that when extending the page.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="racing-driver-profile" type="text/html" title="Mateo Rourke — Racing Driver Profile">
<!doctype html>
<html>...</html>
</artifact>
```

## Build spec

Described from the finished page, not the source prompt.

### Palette & type

- **Base:** `--bg: #111111` and the hero scrim `rgba(15, 15, 15, 0.6)` are
  copied verbatim from the source spec's own mobile test markup.
- **Chromatic root token:** `--accent: #EDB40B`, also copied verbatim — it was
  the highlight color in the source spec's own dev-tuning panel and matches
  the gold "Season Points" figure visible in the reference screenshot. Used
  for the primary stat, the circuit's highlighted turn, the primary button
  gradient, and every `:focus-visible` ring.
- **Gradient:** the "Sign in / Continue" primary button uses
  `linear-gradient(135deg, var(--accent), var(--accent-deep))` — a genuine
  brand-surface gradient with `var()` stops, not literal hex.
- **Type:** Barlow Condensed (500–800) for the display wordmark, numerals and
  headings; Inter (400–700) for nav, labels and body. The source's own CSS
  only specifies a system-font stack for its tiny mobile test page, so this
  pairing is a judgment call sized to the reference screenshot's condensed,
  tall-x-height display type — noted here as a substitution rather than an
  exact-match font.

### Section-by-section layout

1. **Nav (page chrome)** — a fictional "Apex GP" wordmark + season badge on
   the left, `Biography` / `Statistics` / `Career` anchor links centered
   (hidden below 640px), and a "Sign in" pill button on the right that opens
   an accessible popover form.
2. **Ghost numeral** — the driver's number ("08"), rendered as a huge
   outlined, fill-transparent numeral behind everything else, breathing
   slowly in opacity.
3. **Photo well** — the section's core mechanic, ported from the source
   spec's own literal CSS: a `photo-container` clipped between `top` and the
   viewport bottom, holding a bottom-anchored, oversized, horizontally
   centered `<img>`, with a `backdrop-filter: blur()` panel masked by a
   `linear-gradient` fading the lower half of the photo toward black. All six
   of the source's tuning values (photo width, photo bottom offset, container
   top offset, blur panel height, blur radius, mask start/end) are wired to
   CSS custom properties and carry the source's exact mobile numbers as the
   base rule; a `min-width: 900px` override adjusts width/offset/position
   only, so desktop frames the same head-to-arms crop the reference
   screenshot shows instead of clipping it (see Deviations below).
4. **Location heading** — a small flag + country line ("Solmara") above a
   two-line circuit name ("Meridian Circuit").
5. **Circuit map** — a decorative inline SVG track outline with waypoint dots
   and one pulsing highlighted turn, hidden below 640px.
6. **Driver footer** — a roster filter (three initialed avatar buttons plus
   an "All" pill) above the huge two-line driver name, using the source
   spec's exact `name-overlay h1` typography (`font-size: min(19vw, 12svh)`,
   `font-weight: 600`, `line-height: 0.82`, `letter-spacing: -0.05em`).
7. **Stats column** — a small "Season Points" label above three stacked
   numerals of increasing size and emphasis (faint grey → grey → gold),
   hidden below 640px to avoid crowding the mobile crop.
8. **Sign-in popover** — anchored under the nav button; a real `<form>` with
   a labeled email field, intercepted submit, and an inline success message.

### Motion inventory

- Page-load reveals: nav, location block, driver footer and stats each fade
  up (`opacity 0 → 1`, `translateY(18px) → 0`) on an 0.8s
  `cubic-bezier(0.23, 1, 0.32, 1)` ease-out with staggered delays
  (0.05s/0.15s/0.25s/0.35s) — the repo's standard entrance curve, since
  everything sits above the fold and triggers on load rather than scroll.
- Ghost numeral: opacity breathes `0.6 → 1 → 0.6` over 9s, ease-in-out,
  infinite.
- Circuit highlighted turn: opacity/scale pulse (`0.55/1 → 1/1.35`) over
  2.4s, ease-in-out, infinite.
- Nav links: underline wipes in from the left on hover/focus, 200ms.
- Buttons: `translateY(-1px)` lift on hover, 160ms.
- Sign-in popover: scale (`0.94 → 1`) + opacity, 200ms, transform-origin top
  right.
- `prefers-reduced-motion: reduce` collapses every animation/transition to
  near-zero, forces the reveal elements to their final visible state, and
  freezes the ghost numeral and circuit pulse at a static mid-opacity instead
  of looping.

### Accessibility affordances

- Nav links are real in-page anchors (`#bio`, `#stats`, `#career`) with a
  visible underline-on-focus indicator and native keyboard operability.
- "Sign in" is a real `<button>` with `aria-haspopup`, `aria-expanded`, and
  `aria-controls`; opening moves focus into the email field, `Escape` and an
  outside click close it and return focus to the trigger button.
- The sign-in form has a visible `<label>`, `type="email"`, and
  `autocomplete="email"`; submit is intercepted (no live endpoint) and swaps
  the form for an inline `role="status"` success message.
- The roster filter is a `role="group"` of real `<button>`s with
  `aria-pressed` reflecting single-select state and roving `tabindex` driven
  by Left/Right arrow keys, so it behaves like a proper toggle group rather
  than a set of unlabeled clickable circles.
- Every interactive element carries a visible `:focus-visible` ring using the
  chromatic `--accent` token, additive-only against the resting design.
- Decorative-only elements (`ghost-number`, `blur-overlay`, `circuit-map`,
  crest icon) are `aria-hidden`; the driver photo carries real descriptive
  `alt` text.

### De-branding note

This template carried the heaviest de-brand duty in the batch — the source
prompt's `prompt_text` field is a small "F1 Hero Mobile — Photo & Blur
Preview" test harness naming a real driver, and the `preview_url` screenshot
of the actual rendered site layered a real racing series' 75th-season
wordmark, a real team's paddock livery and shield crest, half a dozen real
sponsor marks printed on the suit, and a real circuit outline on top of it.
Everything real was invented fresh, keeping only the layout, type roles and
spatial composition:

- **Driver:** the real name in both the test-harness markup and the
  screenshot → **Mateo Rourke**, a fictional driver, fictional number "08".
- **Series:** the real 75th-anniversary wordmark badge → **Apex GP**, an
  original wordmark (two overlapping chevrons + "GP" badge) drawn fresh as
  inline SVG.
- **Team:** the real team's livery/crest → **Solstice Racing**, a fictional
  shield crest drawn fresh as inline SVG; the suit's own white/black/red
  color-blocking (generic across many real teams, not exclusive to one) was
  kept as-is.
- **Circuit:** the real circuit name and its recognizable track outline →
  **Meridian Circuit, Solmara** (fictional place), with an original track
  shape drawn fresh as inline SVG — not traced from the real layout.
- **Flag:** the real country flag → an abstract three-band flag (navy/gold/
  crimson) for the fictional Solmara, drawn as inline SVG rather than any
  real nation's colors or proportions.
- **Season figures:** the real screenshot's point/stat figures → new fictional
  numbers (96 / 154 / 2,238) chosen to not coincide with any real driver's
  published statistics.
- **Roster avatars:** the screenshot's real teammate headshots → two
  initialed placeholder avatars ("AK", "TN") with no photographic likeness.
- **Driver photograph:** the source used an actual photograph of the real
  driver. It was replaced with a licensed Pexels stock photo of an
  unidentified adult model in a plain racing suit (Pexels photo 30587045),
  matching the original's pose role (three-quarter turn, arms crossed,
  looking off-camera) and crop role (head-to-torso, bottom-anchored). The
  model's cap patch, its small national-flag patch, a shoulder sponsor tag,
  and a collar logo were removed with a feathered Gaussian blur (mask-composited,
  not a hard rectangle) before vendoring, so no real brand or place-name text
  survives in the asset. Verified by re-inspecting the de-branded crop at
  full resolution.
- **Background photo:** the source's `.hero` background-image pointed at
  another remote photo of unknown/unverifiable provenance (same host as the
  real driver photo). Rather than risk vendoring an un-vetted real photo, the
  hero background was rebuilt as a CSS-only radial-gradient wash (dark,
  warmed at the upper right) — the one deliberate "unreachable photograph"
  substitution in this build, per `FIDELITY.md`'s allowance for assets that
  cannot be safely obtained.

### Deviations from a literal reading

- **Desktop photo-mechanic values are inferred, not given.** The source
  `prompt_text` is explicitly titled "F1 Hero Mobile" and only supplies one
  set of photo/blur numbers. Applied literally at a desktop viewport, a 140%-
  wide portrait image bottom-anchored under a ~100px top offset clips well
  above the subject's face (confirmed by rendering it before adjusting). The
  `preview_url` screenshot is unambiguously a desktop capture showing the
  full head-to-arms crop, so a `min-width: 900px` override narrows the photo
  width and shifts it right of center to match that screenshot's proportions.
  The blur/mask values themselves (height, radius, start/end) are never
  overridden — they hold the source's exact numbers at every breakpoint.
- **The dev-only "Photo & Blur Controls" panel in the source markup was not
  shipped.** It is a build-time tuning harness (range sliders for the same
  six values above) and is absent from the `preview_url` screenshot of the
  actual rendered site, which is this build's ground truth for what ships.
- **Stats and roster content are invented**, since the source `prompt_text`
  doesn't specify them and the screenshot only shows finished numbers/avatars
  with no underlying data model.

### Assets

- `assets/driver-portrait.jpg` — licensed Pexels stock photo (id 30587045),
  de-branded per above, cropped to a head-to-arms bust, downscaled to 1100px
  wide (~170KB).

### Fonts

- Barlow Condensed (500/600/700/800) and Inter (400/500/600/700), both via
  Google Fonts — judgment substitutions for the source's unspecified display
  face; see Palette & type above.
