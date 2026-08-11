---
name: mostar-travel-guide
description: |
  A single-page cinematic scroll story for the city of Mostar, Bosnia and
  Herzegovina. A sticky pinned stage runs over roughly 3700px of scroll,
  choreographed through pointer parallax and scroll-mapped CSS custom
  properties: a giant serif MOSTAR wordmark and intro copy give way to a zoom
  into the Stari Most bridge with a fact panel, then the historic bazaar
  quarter with its own fact panel, before an infinite sights slider of five
  landmark cards flies in from off-screen with keyboard- and pointer-operable
  controls.
tags:
  - "landing-page"
  - "motionsites"
  - "travel"
  - "destination"
  - "scrollytelling"
  - "parallax"
triggers:
  - "mostar"
  - "bosnia"
  - "herzegovina"
  - "travel guide"
  - "destination page"
  - "cinematic scroll"
  - "scrollytelling"
  - "stari most"
  - "bridge"
  - "bazaar"
  - "city guide"
od:
  mode: prototype
  platform: desktop
  upstream: "https://motionsites.ai/?prompt=mostar-guide"
  preview:
    type: html
    entry: example.html
  design_system:
    requires: false
  category: "landing-page"
  scenario: "marketing"
  example_prompt: "Build a Mostar-style cinematic scroll destination page for a different city or landmark in this template's own visual system. Keep the pinned-stage scroll rig, the pointer parallax, and the infinite sights slider — swap in the new destination's photography, wordmark, fact panels, and sight cards."
---

# Mostar — Cinematic Travel Guide

> Derived from a licensed MotionSites prompt; rebuilt as a self-contained page.

A single-page cinematic scroll story for the city of Mostar. The entire
experience lives inside one `position: sticky` stage pinned for the height of
a long scroll track (`100vh + 3700px`); scrolling never moves the visible
frame — it only feeds a scroll-distance value into a `requestAnimationFrame`
loop that writes dozens of CSS custom properties, driving every layer's
opacity, blur, scale, and position. Pointer movement adds a second, lighter
layer of parallax on top.

## Workflow

1. **Clone `example.html`** into the user's workspace as the working file.
2. **Replace the photography and wordmark** with the new destination's own
   images and name. Keep image crops and layer roles (sky, mid-back "bazaar"
   layer, foreground bridge, split-frame halves, close-up) — the choreography
   in the JS block below depends on that layering.
3. **Preserve the scroll rig.** The `:root` custom properties, the
   `requestAnimationFrame` math (`clamp`, `smoothstep`, `lerp`,
   `segmentInOut`), and the pixel breakpoints inside `update()` are the
   identity of this template — do not shorten the scroll track or change the
   easing without re-deriving every dependent pixel range.
4. **Extend by duplicating a story panel or a sight card**, never by
   importing a section from another template.
5. **Keep motion accessible.** The `prefers-reduced-motion` branch in
   `update()` and the CSS media query both stay in place.

## Build spec

The build below describes the finished `example.html`, not the original
prompt text.

### Palette tokens

- `--ink: #111411` — dark text on cream surfaces (pills, cards, buttons).
- `--paper: #fdf1e1` — cream surfaces and all light text over photography.
- `--shadow: rgba(0, 0, 0, 0.32)` — drop shadow under the large serif numerals.
- `--blur-tint: 74, 181, 224` — the blue tint used by the atmospheric shade
  gradient during the bridge/bazaar transitions (kept as the prompt's literal
  R,G,B triplet so the existing `rgba(var(--blur-tint), alpha)` calls are
  unaffected).
- `--accent: #4ab5e0` — a genuinely parseable chromatic root token that
  mirrors `--blur-tint` in hex, added only so MishMash's recolor pass has a
  real color to grab; it is not referenced by any rendered surface, so it
  changes nothing visually.

### Type

- **Fraunces** (Google Fonts, `opsz,wght@9..144,500`) stands in for the
  prompt's licensed "Ogg Medium" display serif, which is not on Google
  Fonts. Used for the site logo, the `MOSTAR` wordmark, the two story-panel
  headings, and the large year numerals in the fact panels.
- **Inter** (400/500/700/800) carries everything else: nav, language switch,
  sight-card copy, pills, and body paragraphs.

### Layout, section by section

1. **Header** — three-column grid: wordmark-as-logo link, a centered nav
   (Intro / Bridge / Bazaar / Routes), and a decorative language switcher.
2. **Hero title** — a 14rem serif `MOSTAR`, scroll-linked to rise, shrink,
   and fade out over the first ~650px of scroll.
3. **Intro copy** — a short line plus three cream highlight pills (Old
   Bridge, Neretva River, UNESCO old city), fading and sinking in the same
   opening scroll range.
4. **Bridge story panel** — fades in as the sticky stage zooms into the
   bridge photo (scroll 560–1620px); a two-column `dl` of facts (1566 /
   original bridge completed, 2005 / UNESCO inscription) sits below the copy.
5. **Bazaar story panel** — the mid-town photo layer sharpens and saturates
   as the bridge recedes (scroll 1760–2700px); its own heading, paragraph,
   and a pill-style "Open old town notes" button fade in and back out.
6. **Sights slider** — five landmark cards (Stari Most, Kujundziluk, Koski
   Mehmed Pasha Mosque, Kajtaz House, War Photo Exhibition), each with a pin
   icon, kicker, heading, and one-line description. The slider flies in from
   off-screen starting at scroll 2760px and is fully seated with working
   prev/next controls by scroll 3660px.

### Motion inventory

- **Scroll rig** — one `requestAnimationFrame` loop reading the sticky
  section's `getBoundingClientRect()`, damping the raw scroll distance with
  `lerp(…, 0.14)` before deriving every other value from it, so parallax
  settles smoothly instead of snapping to the raw scroll position.
- **Segment easing** — `segmentInOut()` (built from two `smoothstep()` calls)
  produces an enter/exit/active triple for the bridge and bazaar transition
  windows, driving opacity, blur, brightness, and saturation together.
- **Pointer parallax** — a second, independently damped `mouseX`/`mouseY`
  pair nudges the back layers, bridge, and split-frame halves opposite the
  cursor.
- **Counter-scaled slider** — the back-stack zooms via CSS `scale()` as the
  user scrolls; the sights slider carries the reciprocal scale so its cards
  stay a constant on-screen size regardless of how far the background has
  zoomed.
- **Infinite sight slider** — the five cards are tripled in the DOM on load;
  clicking a card, using the prev/next buttons, or pressing Enter/Space on a
  focused card moves an index that drives a single `translate3d` on the
  track (`640ms cubic-bezier(0.22, 1, 0.36, 1)`); crossing into the first or
  third copy triggers an instant, transition-free jump back into the middle
  copy so the loop never runs out of cards.
- **`prefers-reduced-motion: reduce`** — the scroll-rig loop snaps
  `smoothScroll` straight to the target instead of damping it, forces the
  pointer-parallax variables to `0`, and a matching CSS media query removes
  the slider's transition and disables `scroll-behavior: smooth`. The
  composition still updates with scroll; it just stops adding inertia.

### Accessibility affordances added

- Each sight card is a focusable `role="button"` (`tabindex="0"`) with an
  `aria-label`; Enter/Space selects it, mirroring the click handler.
- A visible `:focus-visible` outline was added to sight cards — the original
  spec disables outline entirely; this is the one additive accessibility
  change (SPEC's permitted-deviation #6), and it never shows outside
  keyboard focus.
- The nav's `Bridge`, `Bazaar`, and `Routes` links point at real in-page ids
  (`#bridge`, `#bazaar`, `#routes`) added to their target sections — the
  source prompt names the hrefs but not matching ids, so this wires them to
  working anchors without touching layout or paint.
- Prev/next controls are real `<button>`s with accessible names; the slider
  has no autoplay, so there is nothing to pause on hover/focus.

### De-branding

No real trademarks appear in the prompt or in the vendored media — "Bosnia
and Herzegovina" is the country name used as the site wordmark, not a brand.
The five sight names (Stari Most, Kujundziluk, Koski Mehmed Pasha Mosque,
Kajtaz House, War Photo Exhibition) are real place names kept as scenery
description per SPEC-BATCH2 §5, and the two dated facts (1566 bridge
completion, 2005 UNESCO inscription) are accurate public history, not
invented statistics.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="mostar-travel-guide" type="text/html" title="Mostar — Cinematic Travel Guide">
<!doctype html>
<html>...</html>
</artifact>
```
