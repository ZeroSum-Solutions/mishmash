# Composition craft rules

Universal rules for how a multi-section surface is assembled — not how one
section looks internally (that's `typography.md`, `color.md`,
`state-coverage.md`) but how sections relate to each other, and how the page
reads as the user scrolls through all of them. The active `DESIGN.md` decides
brand visual language; this file decides the structural moves that make a
page feel authored section-by-section instead of assembled from one repeated
shape.

> Opt in via `od.craft.requires: [composition]`. Compose with
> `typography-hierarchy` for a single surface's internal hierarchy and
> `laws-of-ux` for what content a screen should carry — this file governs the
> relationship between sections, not what happens inside one of them.

> Distilled from a structural census of independently designed, commercially
> sold template-marketplace listings across portfolio, agency, and SaaS
> genres — real shipped products, examined section by section — paired with
> a blind critique of MishMash's own generated output against that bar.

## Why this file exists — the generator failure mode

A model's default is one grid, one alignment axis, one background field,
repeated section after section with only copy and images swapped. This is
not a style choice, it's consistency bias — the same mechanism that makes a
model reuse one card class for every list item makes it reuse one section
shape for every band of content on a page. A human designer treats each
section as its own small problem to solve. This file gives a generator the
same discipline without prescribing a look: uniform, centered, equal-margin
sections are the single loudest machine-made tell a reviewer can spot
without reading a word of copy.

## Composition vectors — what must change between adjacent sections

| Vector | What it controls | Changes when |
|---|---|---|
| Ground | The section's dominant background — flat color, image, or a full-bleed block | The hue/tone family shifts, or flat-vs-imagery kind changes — not a one-step shade within the same neutral |
| Grid / column count | 1-column, 2-column, asymmetric split, or a card grid | The column count or split ratio differs from the section before it |
| Alignment axis | Where content anchors — centered, left, right; text-left/image-right vs the reverse | The anchor point or text/image order flips |
| Content type | Type-led statement, photo/video-led, data/table-led, quote/testimonial | The dominant content kind changes |
| Density | Ratio of content to whitespace | The whitespace-to-content ratio visibly shifts, not just a padding token bump |

**The rule:** for every pair of vertically adjacent sections, at least two of
the five vectors above must differ. Count how many consecutive sections
share all five before calling a page varied — a page where every section is
centered, single-column, on the same field, at the same density, differing
only in copy, is the single most diagnostic sign of generated output,
independent of how good any one section looks in isolation.

**Ground changes must be owned.** A section only counts as a ground change
if the shift comes from the page's own surface tokens. A section that looks
different only because it embeds a full-color screenshot or a third-party
image is not compositionally varied — the page's own palette never moved.
Four sections carrying four unrelated saturated images produce noise, not
section variety.

`anti-ai-slop.md`'s P1 "Hero → Features → Pricing → FAQ → CTA with no
variation" soft tell is the section-*order* case of this rule. The vectors
above are what must vary regardless of which sequence of section types a
page uses — reordering the same five identical sections doesn't satisfy this
rule any more than keeping the default order does.

## Grid-breaking moves — named, and when each earns its place

| Move | Definition | Appropriate when | Gratuitous when |
|---|---|---|---|
| Full-bleed against contained | A section runs edge-to-edge immediately next to a section that sits inside a margin | Marking a real tonal shift — a statement block, a stat, a color break | Applied to every section — "full-bleed" becomes the new uniform margin |
| Overlap | An element crosses its own container's boundary and sits on or beside a neighboring element | The overlapping element carries real content and stays legible at every breakpoint | Decorative only, or it clips content it overlaps |
| Offset / asymmetric columns | A two-column section whose split isn't 50/50, or whose columns don't align to the page's outer margins | The asymmetry mirrors content weight — a large image against a short caption | Every two-column section uses the same ratio — a narrower version of the equal-margins tell |
| Edge-bleeding type | Display type sized or placed so a glyph, word, or wordmark crops at the viewport edge or crowds a corner instead of centering | Once, on the section carrying the page's single dominant first-viewport move | On every headline — then nothing reads as a bleed, everything just looks cropped |
| Cross-boundary element | One element (a photo, headline, or mockup) visually spans two adjacent sections, breaking the section-as-box assumption | It does real compositional work — anchoring a scroll transition, tying two ideas together | Present without a legible reason — reads as something that didn't fit, not a decision |

**Layout risk (binary, verifiable from a screenshot):** a page scores 1 when
at least one of the five moves above appears anywhere on it. A page where
every section sits in a centered, equal-margin container — nothing
overlapping, rotating, offsetting, or bleeding — scores 0, regardless of how
refined the typography or color inside those containers is. This is a
pass/fail floor, not a per-section requirement: one deliberate break on an
otherwise orderly page clears it.

## First-viewport composition

The hero must resolve to **one dominant move** that reads before any
scrolling, in the time it takes to glance at a screenshot. A dominant move
is: an oversized type element that anchors most of the viewport, a
full-bleed image/video/render that carries the tone, or a working UI/product
mockup detailed enough to read as real rather than illustrative. Composing
two or more competing dominant moves in the hero — a large headline *and* a
large image both fighting for primary weight — fails the same way as having
none; this is `typography-hierarchy.md`'s Noise hierarchy failure mode,
extended from one surface to the whole first viewport.

**Anti-pattern (checkable):** a centered headline, a subhead, and two
buttons over a flat or gradient ground, with no image, mockup, or
oversized-type element carrying visible weight. This composes to the same
silhouette regardless of brand and is the most replicable hero shape there
is.

**Which vector should carry the hero is genre-dependent, not universal.** A
portfolio or agency hero can carry the moment through scale alone — an
oversized wordmark or a single-line statement. A product/SaaS hero more
often carries it through a detailed, interactive-looking mockup, because the
product itself is the credibility signal. `typography.md` and
`typography-hierarchy.md` govern the actual scale ratios and vectors once a
vector has been chosen to carry the hero; this file only requires that some
vector actually does.

## Density rhythm

A page with at least one meaningfully dense section — a data table,
comparison grid, spec sheet, or dense card grid — needs at least one
meaningfully sparse section near it: a section whose whitespace-to-content
ratio reads as visibly higher than the page's own average, not merely "has
padding."

**Uniform generous padding is not rhythm.** Comfortable whitespace applied
identically to every section is one density value repeated down the page —
it reads as consistent, not paced. Rhythm requires variance: at least one
section that reads noticeably fuller and one that reads noticeably emptier
than the page's own average.

**Broken gaps are not pacing.** An empty region only counts as a deliberate
pacing choice when content on both sides explains its presence — it sits at
a resolved boundary between two sections that make sense on either side of
it. An empty region with no visible cause — inside a single section, between
a heading and the body copy that should follow it — reads as a broken
component, most often a reserved height for a scroll-triggered animation
that never fired, not as a whitespace decision. Before crediting a large gap
as pacing, check whether a `min-height` or transform-on-scroll rule is
sitting under it unresolved.

## Lint

- [ ] For every pair of vertically adjacent sections, at least two of the
      five composition vectors (ground, grid, alignment, content type,
      density) differ.
- [ ] Every apparent ground change comes from the page's own surface tokens,
      not from an embedded screenshot or third-party image.
- [ ] At least one grid-breaking move (full-bleed-against-contained,
      overlap, offset columns, edge-bleeding type, cross-boundary element)
      appears somewhere on the page.
- [ ] The hero resolves to one dominant move within the first viewport, not
      two competing ones and not zero.
- [ ] At least one meaningfully dense section sits near at least one
      meaningfully sparse one — whitespace varies, it isn't a flat line.
- [ ] No block of empty space exists without content on both sides that
      explains it.
- [ ] Not every section is centered with equal left/right margins.
