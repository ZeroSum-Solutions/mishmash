---
name: freight-command-logistics
description: |
  Dark, three-panel freight-operations dashboard for the fictional logistics
  tech brand **OVERVATECH**, built as a single self-contained HTML file with
  inline CSS and vanilla JS. A near-black "ops terminal" canvas holds a fixed
  1586×992 stage that scales to fit any viewport: a network/shipment nav panel,
  a scrollable, searchable, filterable freight queue table (70 real shipment
  rows from the source spec), and a load-detail inspector panel with a long
  scrollable dossier and a blinking-cursor terminal footer. Motion is limited
  to a pulsing live-fleet dot and a blinking terminal caret, both mono/JetBrains
  Mono telemetry typography, hairline rules, and L-corner panel brackets — no
  gradients, shadows, or glassmorphism.
tags:
  - "landing-page"
  - "motionsites"
  - "dashboard"
  - "logistics"
  - "freight"
  - "dark-ui"
  - "ops-console"
triggers:
  - "overvatech"
  - "freight"
  - "freight queue"
  - "logistics dashboard"
  - "shipment tracker"
  - "ops dashboard"
  - "control room"
  - "terminal ui"
  - "dark dashboard"
  - "supply chain"
  - "trucking"
  - "dispatch"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=freight-command"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build OVERVATECH — Freight Queue as a self-contained responsive page in this template's own visual system. Follow the build spec in this skill exactly — palette, typography, panel layout, telemetry copy, and motion are part of the identity. Ask only for the missing essentials first: the real company name, real fleet/shipment data, and which filters should stay functional."
---

# OVERVATECH — Freight Queue Ops Dashboard

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.
> The upstream prompt's brand (`OVERVATECH`) and carrier names
> (`NORTHSTAR LOGISTICS` / `Northstar Linehaul`) were checked against known
> real carrier and logistics marks (Maersk, DHL, FedEx, Flexport, and similar)
> and found to be generic, non-trademark-colliding placeholder names in the
> same register as the rest of this MotionSites batch — they ship unchanged.
> No vendored media, logos, or livery required de-branding: the prompt's own
> asset list is Google Fonts plus one inline SVG icon, nothing else.

A pixel-measured, near-black freight-operations console: a fixed-canvas
three-panel layout (navigation, freight queue, load inspector) that scales to
fit the viewport rather than reflowing its internals, in the style of a
real-time logistics ops terminal.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace the brand and data.** Swap the `OVERVATECH` wordmark, the
   `North Hub Fleet` / `HUB-2` network labels, the carrier name in the header
   footer and inspector body copy, and the `DATA` array in the inline
   `<script>` (70 shipment rows: id, mode letter, load-ID chip, route
   subject, date, status) for the user's real fleet and shipment data.
3. **Preserve the design system.** The near-black palette, the Instrument
   Sans/JetBrains Mono pairing, the hairline rules and L-corner brackets, the
   fixed 1586×992 scale-to-fit stage, and the two CSS keyframe animations
   (live-dot pulse, terminal caret blink) are the identity — do not add
   gradients, shadows, rounded pill cards, or glassmorphism; the source spec
   explicitly forbids all four.
4. **Extend by duplicating the row template**, never by importing a layout
   from another template. New filters must operate on real data already in
   the `DATA` array — do not fabricate carrier or load-type option lists.
5. **Keep motion accessible.** Both animations already sit behind
   `prefers-reduced-motion`; keep that guard when editing them.

## Build spec

Described from the finished page.

### Palette (`:root` tokens — exact hex from the source spec)

- Page/panel neutrals: `--page:#030303`, `--pnl-l:#060606` (nav),
  `--pnl-c:#080808` → `--pnl-c2:#060606` (queue panel gradient),
  `--pnl-r:#030303` (inspector), `--pnl-rh:#070707` (inspector header strip),
  `--pnl-rt:#000000` (inspector terminal footer).
- Structure: `--edge:#2e2e2e` (panel borders), `--bracket:#6e6e6e` (corner
  brackets), `--rule:#1a1a1a` (hairlines), plus per-control border tones
  (`--btn-line`, `--btn-on-line`, `--chip-line`, `--sort-line`, `--bill-line`,
  `--tag-line`).
- **Chromatic accents** (the recolor-pass anchors): `--green:#06ce8a`
  (on-time status, terminal caret), `--red:#f52a2a` (delayed status),
  `--red-live:#ea2020` (live-fleet indicator). The one background gradient
  (queue panel) references `var(--pnl-c)`/`var(--pnl-c2)`; it stays a literal
  neutral per the source spec, with the chromatic tokens carrying the
  recolor-compatible surface.

### Typography

- Sans (`--sans`): Instrument Sans (400/500/600/700), body/display type.
- Mono (`--mono`): JetBrains Mono (400/500/600/700), all telemetry labels,
  IDs, chips, filters, and terminal lines.
- Both loaded from the exact Google Fonts URL the source spec specifies.

### Layout

A `#viewport` flex-centers a fixed `#stage` (1586×992px) that scales via
`transform: scale(k)` where `k = min(innerWidth/1586, innerHeight/992)` — the
entire canvas shrinks/grows as one unit rather than reflowing internally.
Three bordered `.panel` elements (each with four L-shaped corner brackets)
sit side by side:

1. **`#nav`** (349px) — wordmark header, `OPS_NAV` status row, active
   network title (`North Hub Fleet`), shift/cycle stats, and four operations
   menu rows (`ALL_SHIPMENTS` selected/populated; `DISTRIBUTION` /
   `EXCEPTIONS` / `ALLOCATIONS` shown with an em-dash — no data, matching the
   source).
2. **`#queue`** (650px) — "Freight Queue" title, live shipment count, a
   sort toggle, a search field, MODE/CARRIER/LOAD TYPE/STATE filter controls,
   an active-filters strip with a clear-all action, column headers, and a
   scrollable table of 70 real shipment rows (exact IDs, load-ID chips,
   routes, dates, and on-time/delayed status from the source spec).
3. **`#insp`** (472px) — search-icon header, `LOAD DETAIL` label and `L-186`
   tag, a scrollable five-paragraph load dossier for `LD-1300`, an `ON TIME`
   status pill, and a four-line terminal footer with a blinking caret.
   **The dossier intentionally always shows `LD-1300` / `L-186` regardless of
   which queue row is selected** — this mismatch is explicit in the source
   spec and is preserved rather than "fixed."

Below `480px` width (or `≤480px` height with `≤950px` width) the page
switches to a stacked, natural-flow mobile layout instead of continuing to
shrink the fixed canvas: panels stack vertically, the queue and inspector
become two reachable views via a "VIEW LOAD DETAIL" / "BACK TO QUEUE" toggle,
and every absolutely-positioned pixel coordinate is neutralized so nothing
overflows horizontally. This is a deliberate simplification of the source
spec's more elaborate custom mobile/tablet view-switcher — see Deviations.

### Motion inventory

- `pl` keyframe (1.9s ease-in-out infinite) — the live-fleet dot's opacity
  pulse (1 → 0.4 → 1).
- `bl` keyframe (1.1s steps(1) infinite) — the terminal caret's hard blink
  (opacity 1 → 0.12).
- Both animations are removed under `@media (prefers-reduced-motion: reduce)`,
  leaving the dot and caret static at full opacity.
- No other motion: no page-load fades, no parallax, no GSAP — matching the
  source spec's explicit "NO other motion" constraint.

### Interactivity and accessibility

- **Search** — a real labelled `<input type="search">` filters the 70-row
  dataset live by ID, load-ID chip, or route text.
- **MODE / STATE filters** — `role="group"` button sets with
  `aria-pressed`, mutually exclusive within each group, filtering the real
  dataset (no fabricated carrier/load-type option lists behind the
  `CARRIER`/`LOAD TYPE` buttons — they toggle `aria-expanded` only, since the
  source spec never supplies option data for them).
- **Sort** — toggles ascending/descending by shipment ID with a live label
  update.
- **Table rows** — real `<button role="listitem">` elements, exclusive
  selection state, keyboard-focusable with a visible focus ring; the default
  selection matches the source spec's stated default (ID 186), not whatever
  a screenshot artifact happened to show mid-interaction.
- **Clear all** — resets search, mode, and state filters in one action.
- Every animation, filter, and toggle above was driven end-to-end in a real
  browser (not just screenshotted at rest) before this build was called done.

## Deviations from the source spec (and why)

1. **Mobile/tablet reflow is simplified.** The source spec describes a
   bespoke mobile mode with runtime-injected buttons and named view states
   (`queue` / `filters` / `context` / `inspector`) and a separate tablet
   breakpoint. This build instead ships one stacked mobile layout (queue and
   inspector as two views behind a single toggle) that satisfies the same
   "no horizontal overflow, everything reachable" goal with less bespoke
   state machinery. Desktop — the fidelity-critical, screenshot-verified
   composition — is unaffected.
2. **Viewport "grow extra width into panels" nuance omitted.** The source
   spec's scale-to-fit note mentions stretching panel widths into extra space
   on very wide/tall viewports beyond simple centering. This build centers
   the scaled stage instead. It does not change the pixel-perfect composition
   at the reference aspect ratio; it only affects unusual viewport ratios.
3. **`CARRIER`/`LOAD TYPE` dropdown buttons don't open a real menu.** The
   source spec gives them a caret glyph and a label but no option data. Real
   dropdown content would have to be invented, which the build brief
   forbids, so they toggle `aria-expanded` as an honest placeholder control.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="freight-command-logistics" type="text/html" title="OVERVATECH — Freight Queue Ops Dashboard">
<!doctype html>
<html>...</html>
</artifact>
```
