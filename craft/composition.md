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

## Sibling-instance variation — the strongest composed-vs-tiled signal measured so far

The vectors above govern section-to-section variation. A second, independent
axis governs variation *within* one section: consecutive instances of a
repeated component that carries its own identity per instance — a
portfolio/case-study row, a gallery entry, a timeline item, an alternating
features row. This is the "reuse one card class for every list item" half of
the failure mode named at the top of this file; earlier drafts of this
document only ever operationalized the section-level half.

Two blind comparisons, run to try to break this claim rather than confirm
it, converged on it as the stronger signal — ahead of both grid-cell shape
variety and the out-of-flow/transform evidence `layout-risk-flat` checks
for. A page with zero elements ever leaving document flow still read as
composed because each work-sample row alternated which side its image sat
on and how wide the text column ran. A competing page with *more* distinct
rectangle shapes and *more* boundary-crossing elements still read as tiled,
because the row underneath its hero repeated one stat-card arrangement
down the page with no positional variation. The critic's own framing:
repetition count beat both shape variety and boundary-crossing.

**The rule:** for a repeated component that appears 3+ times as siblings
and carries per-instance identity (each row is about a different project,
person, moment, or story — not an interchangeable slot), consecutive
instances must not share an identical internal arrangement. Vary at least
one of:

- which side the media sits on (`flex-direction: row` vs `row-reverse`, or
  swap the grid column order)
- the text column's width relative to the media
- where the caption/label sits relative to the media (above, below, beside,
  overlapping a corner)
- the media's own aspect ratio or crop

```css
.work-row:nth-child(even) { flex-direction: row-reverse; }
.work-row:nth-child(3n)   { --media-width: 62%; }   /* vary the split too, not only the side */
```

There is no single prescribed alternation pattern to reuse project to
project — per this repository's design authority, a rule that stamps the
same alternation rhythm on every generated page just relocates the tiling
one level down. Pick a variation that fits the content (odd/even, a fixed
cycle of three, or content-driven — the row for the largest project runs
wider).

**This does not apply to every repeated grid.** A pricing-tier row, an
icon+label feature grid, or a testimonial card wall is *supposed* to read
as uniform — that repetition is what makes it scannable, and alternating
those would read as broken, not composed. This rule targets content with
per-instance identity, not an interchangeable card slot.

**Grid-breaking moves (below) are a secondary, complementary tool — not a
substitute for this.** An overlapping hero card or a full-bleed plate can
sit directly above six identically-arranged work rows; the hero reads as
composed and the list beneath it still tiles. Fix the repetition first;
reach for a grid-breaking move to mark a genuine tonal shift on top of it,
not instead of it.

## Grid-breaking moves — named, and when each earns its place

**Read the sibling-instance rule above first.** These five moves are a
legitimate, page-level tool for marking a real tonal shift — they are not
the primary fix for a page that reads as tiled, and pushing a generated
page toward overlap/bleed on every build is its own uniformity problem.
Reach for one of these to punctuate a page whose repeated components
already vary internally, not as a substitute for that variation.

| Move | Definition | Appropriate when | Gratuitous when |
|---|---|---|---|
| Full-bleed against contained | A section runs edge-to-edge immediately next to a section that sits inside a margin | Marking a real tonal shift — a statement block, a stat, a color break | Applied to every section — "full-bleed" becomes the new uniform margin |
| Overlap | An element crosses its own container's boundary and sits on or beside a neighboring element | The overlapping element carries real content and stays legible at every breakpoint | Decorative only, or it clips content it overlaps |
| Offset / asymmetric columns | A two-column section whose split isn't 50/50, or whose columns don't align to the page's outer margins | The asymmetry mirrors content weight — a large image against a short caption | Every two-column section uses the same ratio — a narrower version of the equal-margins tell |
| Edge-bleeding type | Display type sized or placed so a glyph, word, or wordmark crops at the viewport edge or crowds a corner instead of centering | Once, on the section carrying the page's single dominant first-viewport move | On every headline — then nothing reads as a bleed, everything just looks cropped |
| Cross-boundary element | One element (a photo, headline, or mockup) visually spans two adjacent sections, breaking the section-as-box assumption | It does real compositional work — anchoring a scroll transition, tying two ideas together | Present without a legible reason — reads as something that didn't fit, not a decision |

### CSS starting points — so "break the grid" isn't just a mood

Four measured generation rounds landed on more grid-cell shapes and
aspect ratios each time, but zero elements ever left document flow and
zero transforms ever appeared — including a round built under an
explicit grid-breaking instruction. Naming the moves in prose wasn't
enough for the model to reach for the right primitive. These are
minimal, adapt-in-place starting points for the moves above — swap in
the page's own tokens (`var(--surface)`, `var(--accent)`, real spacing
scale), not the literal values shown.

**Overlap** — a positioned ancestor plus a negative offset that pulls
the child up onto the section above it:

```css
.section { position: relative; }        /* the ancestor the overlap positions against */
.stat-card {
  position: relative;
  margin-top: -4rem;                    /* pulls the card up over the section boundary */
  z-index: 2;
}
```

**Cross-boundary element** — take the element out of flow entirely so
it can render past its own section's edge:

```css
.hero { position: relative; overflow: visible; }
.hero-mockup {
  position: absolute;
  bottom: -12%;                         /* hangs past the hero's own bottom edge */
  z-index: 3;
}
```

**Full-bleed against contained** — vary the container, not just the
section's background color:

```css
.section--contained { max-width: 1120px; margin-inline: auto; padding-inline: 2rem; }
.section--bleed { width: 100vw; margin-inline: calc(50% - 50vw); }
```

**Offset / asymmetric columns** — an intentionally uneven split, not
50/50:

```css
.split { display: grid; grid-template-columns: 7fr 3fr; gap: 2rem; }
```

**Edge-bleeding type** — let the display line ignore the page's own
container instead of centering inside it:

```css
.display-line {
  font-size: clamp(96px, 12vw, 200px);
  line-height: 0.9;
  margin-inline: -2rem;                 /* crowds/crops the frame edge instead of centering */
}
```

`transform: translateY(...)` (or `rotate`/`scale`) is a second route to
overlap or edge-bleeding when a negative margin would fight the
surrounding grid/flex layout — either primitive counts as evidence to
the auto-check below.

**Layout risk (binary, verifiable from a screenshot):** a page scores 1 when
at least one of the five moves above appears anywhere on it. A page where
every section sits in a centered, equal-margin container — nothing
overlapping, rotating, offsetting, or bleeding — scores 0, regardless of how
refined the typography or color inside those containers is. This is a
pass/fail floor, not a per-section requirement: one deliberate break on an
otherwise orderly page clears it.

**The absence half of this floor is auto-checked (P1, `layout-risk-flat`
in `apps/daemon/src/lint-artifact.ts`).** A rendered layout engine can see
whether a move landed; static source inspection cannot — so the linter
checks only for the CSS primitives every one of the five moves needs to
exist at all: `position: absolute` paired with `z-index` (overlap,
cross-boundary elements), or a non-hover `transform` (offset/edge-bleeding
moves). `position: sticky` does not count as evidence — it pins an
element in place during scroll (nav bars, table headers) and never
crosses a section boundary or overlaps a neighbor, so a page whose only
positioned element is a sticky nav is exactly as flat as one with none;
an earlier version of this check credited sticky and a measured
generated page slipped through on a sticky nav alone. It fires only
when a page carries 5+ `<section>` elements (below that, total
uniformity is an expected shape, not a finding — see the file-level
scoping note in `craft/README.md`) and neither primitive appears
anywhere in the artifact — proof no move could have been used even
once. Presence of the primitive is not proof a move was used well; the
linter cannot tell a deliberate overlap from a modal's own `position` +
`z-index`, so it only ever flags demonstrated absence. Web-clone runs
are exempt (a clone reproducing a uniform target is not a defect) the
same way `resolveRequestedCraft` in `craft.ts` already skips this
file's injection for those runs.

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

**A second anti-pattern, the mirror image (checkable):** a modest,
contained photo, a small caption line (~12–14px, often set in caps), and a
section label sized the same as every other section heading on the page —
with no headline anywhere. This reads as timid, not restrained: the photo
never goes full-bleed or oversized enough to itself be the dominant move,
and there is no display-scale line to compensate, so the first viewport
carries zero dominant moves instead of one. A photo-led hero only
satisfies this rule when the photo is genuinely full-bleed or large enough
to anchor the viewport by itself — a bordered, contained image sitting at
the same width as body content, next to a caption-sized headline, is not a
dominant move regardless of how good the photo is. Two independent blind
critiques of MishMash-generated output named exactly this shape: measured
max display size across three generated builds was 104px/82px/109px
against ~12–14px body (9.0×, 6.8×, 7.8× ratios) versus 140px/~13px (10.8×)
for a professionally sold reference template — and the ratio did not
improve when section count did, confirming this is a distinct gap from the
grid-breaking one above, not a side effect of it.

**Which vector should carry the hero is genre-dependent, not universal.** A
portfolio or agency hero can carry the moment through scale alone — an
oversized wordmark or a single-line statement. A product/SaaS hero more
often carries it through a detailed, interactive-looking mockup, because the
product itself is the credibility signal. `typography.md` and
`typography-hierarchy.md` govern the actual scale ratios and vectors once a
vector has been chosen to carry the hero; this file only requires that some
vector actually does.

**When type carries the hero, size it against a stated ratio, not a
feeling.** A display line only reads as the dominant move at roughly an
**8:1 ratio or higher** against the page's own body copy size — for
example a 120–160px display line against 14–16px body. Below that ratio
the "headline" reads as a slightly larger paragraph, not a hero, which is
exactly the failure named above: a 48–56px line is the same size as an
ordinary section heading elsewhere on the page, so it cannot also be the
one thing that makes the first viewport dominant. Let the display line
bleed to the frame edge instead of sitting inside the same centered
container as the rest of the page — that placement is this file's
Edge-bleeding type grid-breaking move (see the table above), applied
specifically to the hero's dominant line.

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
- [ ] A repeated component with per-instance identity (work sample,
      case study, timeline entry, alternating features row) varies its
      internal arrangement — media side, column width, or caption
      placement — across consecutive instances. A uniform pricing tier,
      feature-icon, or testimonial grid is exempt; that repetition is the
      point there.
- [ ] At least one grid-breaking move (full-bleed-against-contained,
      overlap, offset columns, edge-bleeding type, cross-boundary element)
      appears somewhere on the page. *(Its absence half is auto-checked
      on pages with 5+ `<section>`s — see `layout-risk-flat` above.)*
- [ ] The hero resolves to one dominant move within the first viewport, not
      two competing ones and not zero. A contained, body-width photo next
      to a section-heading-sized label is zero, not one.
- [ ] When type carries the hero, the display line sits at roughly an 8:1
      ratio or higher against the page's own body copy size, and bleeds to
      the frame edge rather than sitting in the same centered container as
      the rest of the page.
- [ ] At least one meaningfully dense section sits near at least one
      meaningfully sparse one — whitespace varies, it isn't a flat line.
- [ ] No block of empty space exists without content on both sides that
      explains it.
- [ ] Not every section is centered with equal left/right margins.
