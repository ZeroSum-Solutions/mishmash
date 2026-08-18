# Animation discipline craft rules

Universal rules for when motion earns its place in a UI and what numbers
constrain it. The active `DESIGN.md` decides brand-specific motion
personality; this file decides whether motion should run at all and at
what duration, easing, and accessibility floor.

> Grounded in primary sources: Tversky/Morrison/Bétrancourt 2002
> (IJHCS), Heer & Robertson TVCG 2007, Harrison/Yeo/Hudson CHI 2010,
> Doherty & Thadani IBM Systems Journal 1982, Chang & Ungar UIST 1993,
> Material 3 motion tokens, IBM `@carbon/motion`, Apple SwiftUI
> Animation API, W3C View Transitions, WCAG 2.2.2 + 2.3.3, WebKit's
> 2017 `prefers-reduced-motion` rationale.

## When motion earns its place

Tversky/Morrison/Bétrancourt's 2002 meta-analysis (IJHCS 57, pp. 247-262)
found that every study claiming animation aids comprehension had a
broken control — the static version had less information, different
procedures, or hidden interactivity. When equalised, animation does
**not** beat static for teaching complex systems. The single use case
the paper endorses is real-time spatial or temporal reorientation:
page transitions, container morphs, viewpoint changes, progress
indicators (p. 257).

A follow-on hazard: Palmiter & Elkerton found animation-trained users
*declined* one week after training, while text-trained users *improved*
(Tversky 2002, p. 255). Animation's apparent short-term parity hides
worse retention.

So animate when the user is moving through space, time, or state —
navigation, container expansion, progress feedback, gesture
follow-through. Don't animate to teach, decorate, signal "premium",
or fill silence.

## Duration thresholds

The cross-design-system convergence is **150 ms** — Material 3 `short3`,
IBM Carbon `moderate-01`, Shopify Polaris `150`, Tailwind default,
SLDS `duration-fast` all land here. Use it as the default duration for
state-confirmation feedback.

| Duration | Use |
|---|---|
| 50–100 ms | Instant feedback (button press, toggle commit, hover) |
| 150 ms | Default for state-confirmation |
| 200–300 ms | Entering UI (modals, sheets, dropdowns) |
| 300–500 ms | Cross-screen transitions, container morphs |
| > 500 ms | Reserved for cross-screen, staged, or platform-native transitions (e.g. M3 `long2`-`extraLong4`, Heer & Robertson 2007's per-stage recommendation). |

Non-navigation microinteractions — hover, press, toggle, validation,
chip selection, row expansion — should stay under 500 ms. Past that the
user notices the motion as motion and waits on the UI rather than
working through it. Two qualifications: frequent animations (a hover
effect seen 50 times per session) need to stay ≤200 ms; mobile
animations should run 20–30% shorter than desktop equivalents because
travel distances are shorter.

## Curve vs spring

Use a curve for opacity, color, and any property that changes value
between two known points. Use a spring for position, scale, rotation,
and gesture-driven motion — anything that should feel physical.

Material 3 standard easing is `cubic-bezier(0.2, 0, 0, 1)` — front-loaded;
the trailing zero makes the curve hit its target instantly and settle.
M2 standard was the symmetric `cubic-bezier(0.4, 0, 0.2, 1)`, preserved
in M3 under the name `legacy`. Anyone shipping the M2 curve and calling
it "M3" is on legacy tokens. M3 `emphasized` is a **two-segment Bézier
path**, not a single cubic-bezier; single-cubic approximations silently
lose the front-loaded character. CSS `linear()` (Chrome 113+) is the
only way to replicate it on a single property.

Apple's published SwiftUI default spring is
`(response: 0.5, dampingFraction: 0.825, blendDuration: 0)`. The widely
cited `.snappy = 0.25 s, .smooth = 0.35 s` numbers are wrong — Apple's
docs assign all three presets a 0.5 s base, differing only in bounce
(0 / 0.15 / 0.3).

Spring framework defaults disagree. motion.dev's physics-mode default
is ζ ≈ 0.5 (bouncy). React Spring's `default` is ζ = 0.997 (critically
damped). Same word "default", opposite feel — React Spring's `wobbly`
is the actual feel-equivalent of motion.dev's `default`. Pick
consciously.

## Reduced motion

Every animation that translates, scales, rotates, or parallaxes must
respect `@media (prefers-reduced-motion: reduce)`. WebKit shipped this
in 2017 to address vestibular triggers; the W3C MQ5 spec lets the UA
or author **strip motion entirely or substitute static imagery** —
the spec does not mandate which.

Working rule: strip motion-on-an-axis (translate, scale, rotate,
parallax). Keep opacity/color crossfades as substitutes when a state
change still needs to be conveyed. Be explicit — the View Transitions
API does **not** apply `prefers-reduced-motion` automatically; the
author must add a query override on the pseudo-elements or skip
`startViewTransition` entirely.

WCAG calibration: 2.2.2 (Pause/Stop/Hide) is Level A — the legal floor
under ADA Title II 2024 / EN 301 549 / EAA — but it names cognitive,
attentional, and reading populations, not vestibular. Vestibular
language lives in 2.3.3, which is **AAA**. Don't conflate the two.
Building for vestibular users is a craft commitment beyond the legal
floor, not a WCAG mandate.

**Flashing limits.** WCAG 2.3.1 (Level A) permits flashing only when
there are no more than three flashes within any one-second period, or
the flashing area stays below the general and red flash thresholds.
WCAG 2.3.2 (AAA) forbids flashing more than three times within any
one-second period, regardless of area or brightness. The protected
concern is photosensitive epilepsy; the legal floor isn't negotiable. For gamified UI, onboarding celebrations, sparkles,
confetti, level-up bursts, and shimmer: avoid rapid flashing unless
tested against the thresholds, and prefer one-shot animations over
loops.

## Scroll-triggered entrance

Composition-governed pages (`craft/composition.md`: landing pages,
marketing sites, portfolios, blogs — any surface built from multiple
sections a visitor scrolls through) need this by default. Dashboards,
forms, and other app chrome (`state-coverage.md` territory) do not — that
content must be usable the instant it renders, not paced by a scroll
trigger. Skip it on a page with only one or two sections; there isn't
enough scroll distance for pacing to read as anything but a flicker. A
version of this pattern already appears, unspecified, across some of this
repository's own generated and vendored output — this section turns that
ad hoc convention into a named default and fixes the bug the ad hoc
version carries (below).

**Granularity: the section, not the element.** Give each section one
reveal trigger. Where a section legitimately has an internal group (a
3-4 card row, a stat block), that group may stagger with each child
offset 60-90ms from the previous, capped around 5-6 children — past that
cap, treat the row as one shared block instead of continuing to stagger
individual items. Reveal-per-element across an entire page is the worst
outcome measured: a page where every one of 300 elements pops in
individually reads busier than a page with no motion at all. Restraint
here is the craft, not the mechanism.

**Motion shape.** `translateY(16-24px)` + `opacity: 0 → 1`; opacity-only
for dense text blocks where a vertical shift would jostle reading. Use
the 200-300ms "Entering UI" duration band from the table above and the
M3 standard ease-out curve — a section arriving is UI entering, not a
gesture, so it takes a curve, never a spring (see "Curve vs spring").
Never scale from 0 (existing rule; applies here too). Fire once, on
first entry, and `unobserve` the element once it has — never re-hide on
scroll-up. A one-shot reveal means "the reader arrived here," not a
toggle.

**Mechanism: `IntersectionObserver` + a CSS class — not GSAP, not
`animation-timeline: view()`.** This is the default motion for an
ordinary generated page, not authored choreography. GSAP is the
deliberate, opt-in path for a page that wants real scroll-scrubbed
motion (`plugins/_official/scenarios/od-scroll-animations`) and carries
the vendoring/pinning obligations `docs/decisions/gsap-licensing.md`
sets out; reaching for it here would put a licensed, pinned, vendored
dependency on every generated page's default path for what is, in the
default case, a one-shot fade. `animation-timeline: view()` is the
right long-term primitive — no JS at all — but as of August 2026
Firefox still ships it disabled by default while Chromium and Safari
both support it; a feature with no universal fallback is not a safe
default yet.

**The failure mode this must not ship: content stuck invisible.** The
naive version of this pattern sets the pre-reveal state as the
element's *only* CSS rule — `opacity: 0` outside of any conditional —
so a blocked script, a CSP violation, or a JS error anywhere upstream
of the observer leaves the content permanently invisible. This exact
bug already exists in generated output in this repository. The base
state must always be visible; JavaScript's job is to opt elements
*into* the hidden pre-reveal state, never the reverse:

```css
/* Base state: fully visible. No JS required to read this page. */
.reveal { opacity: 1; transform: none; }

/* Only once JS has confirmed it can run the reveal, hide-then-restore. */
.js-reveal-ready .reveal {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 250ms cubic-bezier(0.2, 0, 0, 1),
    transform 250ms cubic-bezier(0.2, 0, 0, 1);
}
.js-reveal-ready .reveal.is-visible { opacity: 1; transform: none; }
```

```js
// Reduced motion and "IntersectionObserver missing" both take the same
// exit: skip adding the ready class, so .reveal never leaves its
// visible base state and nothing needs undoing.
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reduced && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('js-reveal-ready');
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-visible');
        io.unobserve(e.target);
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -10% 0px' },
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
}
```

Three independent failure paths — JS never runs, `IntersectionObserver`
is unavailable, `prefers-reduced-motion` is set — all resolve to the
same state: the base CSS, fully visible, nothing to strip. That is also
why this pattern needs no separate reduced-motion CSS override, unlike
other motion in this file: the reveal was never applied in the first
place.

## Repeated and ambient motion

The rules above target one-shot transitions. Looping motion (skeleton
shimmer, idle backgrounds, autoplay, reward bursts) has different
constraints.

- Cap iteration count: carousels at 3-5 cycles then pause; skeleton shimmer until content lands, never indefinitely.
- WCAG 2.2.2 (Level A) requires a pause control for any motion running longer than 5 seconds — moving, blinking, or scrolling content, not only video.
- Cancel ambient motion on route change.
- Reward animations are one-shot. Confetti, sparkles, level-up bursts fire once and dismiss; no looping timer.
- Spinners must not run indefinitely. Escalate to progress/cancel states and stop animation at 60 s, matching `state-coverage.md`.

## Cross-platform handoff

Native conventions diverge.

- **iOS** uses spring physics with perceptual `(response, dampingFraction)` parameters. Apple HIG documents principles, not numerical curves; the SwiftUI Animation API JSON is the source for actual numbers. UIView curve cubic-beziers commonly cited online are reverse-engineered, not Apple-published.
- **Android** uses cubic-bezier curves through M3 motion tokens (50–1000 ms range, 16 named durations). Predictive back is a *gesture-progress primitive*, not a transition primitive — `BackEvent.progress` is sampled per-frame from the touch stream and the destination is rendered behind the current surface while still on it. Cancellation is a first-class lifecycle state.
- **Web** has the View Transitions API (default 0.25 s, no easing specified by the spec — falls through to CSS `ease`). Same-document support 90.94%; cross-document 87.82%. Cross-document is same-origin and user-initiated only.

A "one curve fits all platforms" approach loses on each. If the brief
specifies platform fidelity, follow the platform; if it specifies brand
consistency, pick one motion vocabulary and apply it everywhere.

## Common mistakes (lint these)

- "Skeleton screens feel 11% faster" — Harrison/Yeo/Hudson CHI 2010 measured *backwards-decelerating ribbed determinate progress bars* (n=16). The induced-motion mechanism doesn't transfer to skeletons.
- "Heer & Robertson recommend 300–1000 ms eased transitions" — they tested 1.25 s and 2 s only. Their recommendation is "~1 second per stage".
- "Doherty Threshold = 400 ms" — the 1982 paper does not contain "400". The lowest threshold actually measured is 300 ms.
- M2 standard easing `cubic-bezier(0.4, 0, 0.2, 1)` labelled as "Material 3". M3's standard is `cubic-bezier(0.2, 0, 0, 1)`.
- Animations that *perform* a state change rather than *confirming* one that has already happened. Optimistic UI first; motion second.
- More than 500 ms on any non-cross-screen transition.
- Animation as the only signal of state change. Reduced-motion users miss it; always pair with a static affordance (color, position, label).
- Ignoring `prefers-reduced-motion` on transform-based animations — the highest-cost vestibular triggers.
- Curve-based animation on a `transform: scale()` that should feel physical. Use a spring.
- Hero choreography in productivity tools. Motion budget belongs inside the product on functional micro-feedback, not on landing-page sequences.
- Decorative motion in the working canvas of a productivity tool.
- A scroll-reveal element's hidden state (`opacity: 0`) written as its unconditional base CSS rule instead of gated behind a script-confirmed class — any JS failure between page load and the observer wiring leaves the content invisible forever.
- Scroll-reveal applied per element instead of per section. Busier and worse than no motion at all.
- A whole page with zero scroll-triggered motion. On a page long enough to have multiple sections, that reads as inert next to any competitor whose sections arrive as the reader reaches them — see "Scroll-triggered entrance" above.
