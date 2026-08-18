# Typography hierarchy craft rules

Shared hierarchy contracts that layer on top of `typography.md`. This file does
not repeat scale ranges or tracking values — those live in `typography.md`.
This file defines how hierarchy *behaves*: entry points, rhythm, tension, and
the conditions under which controlled violations are allowed. This contract
applies per-surface (a page with multiple pacing resets may establish new
primaries at intentional intervals), not globally.

> Opt in via `od.craft.requires: [typography, typography-hierarchy]`.
> Aesthetic-specific variants (e.g. `typography-hierarchy-editorial`) extend this.

---

## The core contract

Every typographic surface must satisfy all three:

1. **One dominant entry point.** The eye needs a place to start. One element
   wins the hierarchy — not two, not three. If everything competes, nothing leads.
2. **Intentional rhythm between levels.** Hierarchy is not a list of sizes.
   It is the *contrast* between them. Adjacent levels that are too close
   in scale, weight, or spacing produce a flat, undifferentiated surface.
3. **Recoverable information flow.** Hierarchy may be inverted, collapsed,
   or disrupted — but a reader must still be able to reconstruct the content
   structure without re-reading. If they can't, it's chaos, not tension.

---

## Hierarchy vectors

Scale is one lever. Use all five.

| Vector | What it controls | Hierarchy direction |
|---|---|---|
| Scale | Size contrast between levels | Large → small reads as primary → secondary |
| Weight | Mass contrast between levels | Heavier reads as primary (see Controlled violations for weight inversion) |
| Spacing | Breathing room around an element | More space = more visual importance |
| Tracking | Tension and velocity | Tighter = faster; wider = ceremonial, slower |
| Alignment | Relationship to the grid/edge | Breaking alignment signals importance |

No single vector is required. A heading may lead through spacing alone if
scale is deliberately suppressed. A pull quote may lead through alignment
break. Identify which vectors are active and make sure at least two are
working in the same direction for the dominant element.

---

## Semantic role ≠ visual role

Allowed. Not an error. Not a lint violation.

An `<h1>` may render visually quieter than a nearby `<p>` if the
composition requires it. Body copy may behave like display typography.
A label may visually outrank a heading.

**The condition:** information flow must remain intact. A user who reads
linearly must still understand what is important, what supports it, and
what is incidental — regardless of which element "wins" visually.

---

## Hierarchy rhythm — the two failure modes

### Flat hierarchy

Everything lands at roughly the same visual weight. The surface reads as
a wall. Usually caused by:
- Scale steps that are too close (e.g. 18 / 20 / 22 px for three levels)
- Weight used only once (everything is regular, or everything is medium)
- Uniform spacing between all elements

Fix: increase contrast between levels. Use at least two vectors simultaneously.

### Noise hierarchy

Too many elements fighting for dominance. Everything is bold, large, or
accented. The eye has no resting point and no path.

Fix: promote one element deliberately. Demote everything else — including
things that feel important. Hierarchy is relative, not absolute.

---

## Controlled violations

The following are explicitly allowed when the three core contracts are met:

| Violation | Allowed when |
|---|---|
| Body copy at display scale | It is the intended entry point and nothing else competes |
| Heading rendered lighter than body | Intentional visual inversion with intact information flow |
| Zero scale contrast between levels | Hierarchy is carried entirely by spacing or tracking |
| No heading-level element visible | Hierarchy is emergent from layout/spacing alone |
| Primary-level spacing applied to secondary element | Creates deliberate tension while maintaining information flow |

**"Information flow remains intact" safeguards:**
- DOM/reading order still matches content meaning (no layout inversion breaks narrative)
- Proximity groups the inverted element with its parent/context
- Only one primary exists in the visual region (no competing co-primaries)
- A quick scan can identify entry point / support / incidental roles without rereading

---

## Spacing as hierarchy

Spacing is a full hierarchy vector. A typographic level can be elevated
entirely through surrounding whitespace without changing its size or weight.

Rules:
- Space above an element signals its relationship to what came before.
- Space below an element signals its relationship to what follows.
- An isolated element with large surrounding space reads as display-level
  regardless of its font size.
- Uniform spacing between all elements destroys spatial hierarchy.

---

## Three-level working model

Most surfaces can be mapped to three functional levels:

| Level | Role | Typical vectors |
|---|---|---|
| **Primary** | Entry point. One at a time per visual region; long-form surfaces may re-establish at intentional pacing resets. | Scale, spacing, or alignment break |
| **Secondary** | Structure. Subdivides or supports primary. | Weight, scale step, or tracking shift |
| **Tertiary** | Incidental. Labels, captions, metadata. | Scale reduction, weight reduction, or positive tracking |

More than three visible levels above the fold is usually a composition problem,
not a hierarchy opportunity. Collapse or demote before adding a fourth level.

**Long-form surfaces:** May re-establish a primary at intentional pacing resets
(e.g. a new section with its own headline and breathing room). Never maintain
two simultaneous primaries within the same visual region.

---

## Hero display ratio

When scale is the vector chosen to carry the hero (`composition.md`'s
First-viewport composition rule — "when type carries the hero, size it
against a stated ratio, not a feeling"), the ratio that makes the display
line read as an event rather than an oversized paragraph is genre-dependent,
not one number repeated across every brief. This repository has no house
aesthetic (see `AGENTS.md` "Design authority"); the bands below are where a
*quiet* direction and a *loud* one legitimately diverge, and each should sit
in its own band rather than be pulled toward a single default.

| Direction (idiom) | Typical hero ratio | Grounding |
|---|---|---|
| Loud / maximal / physical — "wants to be the boldest thing in the room," oversized type, real graphic risk | 8:1–12:1+, sometimes far higher for a wordmark-led hero | A single-word loud hero can clear 30:1+ on real commercial templates |
| Confident default — SaaS, product, most agency/portfolio work | 6.5:1–8:1 | Matches most professionally sold marketplace templates measured against this rubric |
| Quiet / restrained / editorial — "Nordic restraint," quiet-luxury, architecture/photography studios | 5:1–7:1 | Real, commercially sold restrained templates ship around 5:1, not 8:1+ |

**Restraint is a color and ornament discipline, not a scale discipline.** A
brief asking for quiet, confident, Nordic restraint is asking the generator
to spend less on saturated color, gradients, and chrome — not to shrink the
one line carrying the hero. `composition.md`'s "mirror image" anti-pattern
names the failure directly: a modest caption next to a contained photo, with
no display-scale line anywhere, "reads as timid, not restrained." A
restrained direction still needs its hero line to be the single largest,
most isolated type on the page; the direction changes how loud everything
*around* that line gets, not whether the line itself commits.

**The floor does not disappear below 8:1 — it moves.** Even in the quietest
band, a ratio under roughly 4:1 is still a flat hierarchy by this file's own
definition (see "Hierarchy rhythm" above): the "headline" sits too close in
scale to ordinary body/section-heading sizes to read as a distinct tier, no
matter how much whitespace surrounds it. Whitespace and tracking can
substitute for scale entirely (see "Controlled violations" above — "Zero
scale contrast... carried entirely by spacing or tracking") but that is a
deliberate, all-in substitution, not a reason to land at a fraction of a
scale-led hero's ratio and call it restraint.

**Never close the gap by shrinking body copy.** Body-copy readability
(`typography.md`'s 15–18px range) is independent of the hero ratio; widen
the gap by growing the display line, not by shrinking body toward 12px to
hit a number cheaply.

---

## Anti-patterns

- **Graduated weight ladder** — regular → medium → semibold → bold → extrabold,
  each level one step heavier. Reads as a default scale, not authored hierarchy.
  Weight should jump, not step.
- **Uniform section spacing** — every section gap is the same value. No
  hierarchy information is carried by spacing. Vary it deliberately.
- **Heading as the only hierarchy vector** — the heading is large and bold;
  everything else is flat. The heading does all the work. This is a sign
  that spacing and tracking are not being used as vectors.
- **Symmetrical emphasis** — two elements receive equal visual weight as
  co-primaries. Pick one. The other becomes secondary.
- **Size-only hierarchy** — all contrast is in font size alone. Weight,
  spacing, tracking, and alignment are uniform across levels. Fragile —
  any layout constraint that collapses the size contrast destroys the hierarchy.

---

## Lint

- [ ] One element is unambiguously dominant above the fold.
- [ ] At least two hierarchy vectors are active on the dominant element.
- [ ] No two adjacent levels share the same scale, weight, AND spacing.
- [ ] Spacing between levels varies — at least one gap is ≥1.5× the others or
      represents one typographic scale step (e.g. one token unit like `gap-md` vs `gap-sm`). (guidance)
- [ ] Semantic/visual role inversions remain structurally readable.
- [ ] Flat hierarchy: scale steps between levels are ≥1.25× apart OR compensated by a weight or spacing jump. (guidance)
- [ ] Noise hierarchy: no more than one element reads as primary above the fold.
- [ ] When a display line carries the hero, its ratio against the page's own
      body copy size falls inside the band for the active direction (see
      "Hero display ratio" above) — quiet/restrained work still clears
      roughly 4:1, loud work runs materially higher. (guidance)
