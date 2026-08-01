---
name: pricing-spring-tiers
description: |
  A pricing page whose first viewport breathes: staggered tier-card reveals
  loop as a slow breathing cycle, a real spring-damped monthly/yearly toggle
  self-flips on a timer, and the recommended tier pulses with a
  velocity-driven skew — full comparison table and FAQ included. Use when the
  brief asks for "pricing", "plans", "subscription tiers", a "compare plans"
  page, or wants a pricing screen with continuous, tasteful motion instead of
  a static layout.
triggers:
  - "pricing"
  - "pricing page"
  - "plans"
  - "subscription"
  - "compare plans"
  - "animated pricing"
  - "spring toggle"
od:
  mode: prototype
  platform: desktop
  scenario: sales
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, layout, components]
  craft:
    requires: [laws-of-ux]
---

# Spring Tiers Pricing Skill

Produce a single-screen pricing page that respects the active DESIGN.md **and**
is in constant, restrained motion from the first frame — no one-shot fade-in,
no idle static cards.

## Motion techniques (read first)

Read `example.html` end to end before writing your own version. Four
techniques compose the feel; none of them use GSAP/Lenis source, only the
underlying math, reimplemented in vanilla JS/CSS.

1. **Global reveal-stagger contract.** Every element that should enter in
   sequence gets `data-reveal`. On load, JS walks
   `document.querySelectorAll('[data-reveal]')` and writes an auto-indexed
   `--reveal-index` custom property onto each. CSS reads that index to offset
   `animation-delay`, so adding or removing an element never requires
   re-numbering delays by hand. A one-shot `revealIn` keyframe (opacity
   0 → 1, translateY 28px → 0, `both` fill) plays once per element; the tier
   cards additionally get an infinite `breathe` keyframe — listed AFTER
   `revealIn` in the `animation` shorthand so it takes over cleanly once
   active — that oscillates opacity only (≈1 → 0.88 → 1) forever. That
   ordering matters: because `breathe`'s `0%` matches `revealIn`'s held
   forwards value, and same-property conflicts between simultaneously-active
   CSS animations resolve in animation-list order, the handoff between the
   two is invisible. This is the "reveal → linger → soft re-dim → re-reveal"
   loop instead of a dead-still card.
2. **Exponential-damping toggle.** The monthly/yearly knob is not a CSS
   transition — it is a real damped follower running every
   `requestAnimationFrame`: `pos += (target - pos) * (1 - Math.exp(-lambda *
   dt))`, `dt` in seconds, `lambda ≈ 9`. This is frame-rate independent
   (unlike `pos += (target-pos)*0.1` per frame, which changes speed with the
   refresh rate) and gives a genuine spring-settle rather than a linear
   slide. Because the gallery card has no visitor to click it, a self-timer
   flips `target` every ~4.2s so the toggle stays alive on its own; a real
   click flips it immediately and resets the timer.
3. **Velocity-driven pulse on the recommended tier.** Compute a slow
   synthetic oscillator `vel = cos(ω·t) · ω` (the *derivative* of
   `sin(ω·t)`, not the position itself) and drive `scale`/`skewY` from
   `vel`. Driving off the derivative keeps the motion smooth and continuous
   with no sudden direction change at the extremes — a position-driven pulse
   snaps at its turning points, a velocity-driven one glides through them.
   Apply this transform to an **inner** content wrapper, never the card
   element that already owns the reveal/breathe animation: two
   `transform`-driven animation sources fighting over one element's cascade
   is fragile; nested elements compose cleanly instead. A normalized
   `|vel|` also drives the outer card's `box-shadow` opacity through a CSS
   custom property, so the whole card reads as "pulsing," not just its text.
4. **Discrete ease-out arrival for the price digits.** On every toggle flip,
   swap the price text immediately, start it from a small offset (`opacity
   0`, `translateY(6px)`, `scale(0.94)`), then drive it to rest over ~450ms
   with `1 - 2^(-10t)` (clamped at `t≥1`) — the same easing family as the
   toggle's damping, applied as a one-shot tween instead of a continuous
   follower. This is what makes a flipped price feel like it *arrived*
   rather than just changed.
5. **IQ cosine-gradient ambient blobs.** Two background blobs get their
   color from `a + b·cos(2π(c·t + d))` (Inigo Quilez's public palette
   formula), evaluated once at load with small per-channel amplitudes and
   closely-spaced phases (roughly `a≈[0.78,0.76,0.94]`, `b≈[0.10,0.10,0.06]`,
   `d≈[0.60,0.62,0.65]`) so the blue channel stays dominant at every sampled
   `t` and the result never drifts toward pink or green — it stays inside a
   pale lavender/periwinkle range and reads as atmosphere, never a hero
   effect. They drift via CSS `transform` keyframes only (cheap,
   GPU-composited) on 26s/32s cycles with a non-linear easing curve — never
   `linear`.

## Workflow

1. **Read the active DESIGN.md** (injected above). Use its colors, type
   tokens, and component patterns; the palette in this reference
   (porcelain-lavender canvas, indigo-ink type, one periwinkle-violet
   accent) is this example's own placeholder, not a rule to reuse verbatim.
2. **Classify** the product from the brief and pick a tier shape:
   - 3-tier (most common, and what this reference uses): Starter / Studio /
     Enterprise-style naming.
   - 4-tier when the brief says "scale" or "enterprise plus".
   - 2-tier when it says "individual / business" or "personal / pro".
3. **Sections**, in order:
   1. **Hero** — kicker + page title, one-line subhead, the monthly/yearly
      toggle. Every hero element carries `data-reveal`.
   2. **Plan cards** — one card per tier, each `data-reveal`. Tier name,
      price (bigger display scale, `data-monthly`/`data-yearly` attributes
      so the toggle can re-render it), 1-line positioning, 4–6 bullet
      features, primary CTA. Mark the recommended tier with the accent
      border, a small badge, **and** the velocity-pulse inner wrapper from
      technique #3 above.
   3. **Comparison table** — feature rows × tier columns, ✓ / — / value
      cells, grouped into 2–3 sections (Core, Collaboration, Security &
      Support). Wrap in a horizontally-scrollable container for narrow
      viewports.
   4. **FAQ** — 4–6 `<details><summary>` items (no JS dependency for the
      collapse itself).
   5. **Footer CTA** — one line + button.
4. **Write** one self-contained HTML document: `<!doctype html>` through
   `</html>`, one inline `<style>`, one inline `<script>`. `data-od-id` on
   the hero, the tier grid, the comparison table, and the FAQ.
5. **Money rendering**: bigger display size for the numeral, body weight for
   `/mo` and billing-period text, per DESIGN.md scale. Never animate the
   number by literally counting between the two values — swap the text and
   let technique #4 handle the arrival.
6. **Self-check (P0)**:
   - The **first viewport** (hero + toggle + tier cards, no scrolling) is in
     continuous, self-driven motion from `t=0` — reveal stagger, toggle
     spring, blob drift, all running without any click.
   - `prefers-reduced-motion: reduce` gets a fully static, fully legible
     composed layout: no reveal/breathe/blob-drift animation, no
     `requestAnimationFrame` loop started, toggle still clickable and swaps
     instantly with no easing.
   - The comparison table and FAQ still read as a real, complete pricing
     page — motion never hides content or blocks scanability.
   - Prices are plausible for the product (not "$X / month"); no fake
     feature names — every row reads as something a real product would
     actually offer.
   - Zero external requests: no CDN, no remote fonts, no remote images. No
     `fetch`/`XHR`/storage APIs — this renders inside a scripts-only
     sandboxed iframe.

## Output contract

Emit between `<artifact>` tags:

```
<artifact identifier="pricing-slug" type="text/html" title="Pricing — Product Name">
<!doctype html>
<html>...</html>
</artifact>
```

One sentence before the artifact, nothing after.
