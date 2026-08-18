# Typography craft rules

Universal typography rules that apply on top of any `DESIGN.md`. The
active design system decides *which* fonts; this file decides *how* they
behave at every size.

> Adapted from [refero_skill](https://github.com/referodesign/refero_skill)
> (MIT) — distilled and re-tuned for MishMash's token system.

## Type scale

Use a multiplicative scale (1.2 or 1.25). Cap at 6–8 sizes per artifact.

| Role | Range |
|---|---|
| Display | 48–72 px |
| H1 | 32–48 px |
| H2 | 24–32 px |
| H3 | 20–24 px |
| Body | 15–18 px |
| Small | 13–14 px |
| Caption | 11–12 px |

**The Display row is a section-heading ceiling, not a hero ceiling.** It
sizes in-page headings — the H1 introducing a features section, a card
title, an H2 above a pricing table. A page's single first-viewport hero
line (`composition.md`'s "First-viewport composition" rule) is a distinct
role with its own, larger allowance: when scale is the vector chosen to
carry the hero, size that one line against the ratio guidance in
`typography-hierarchy.md`'s "Hero display ratio" section, not against this
table. Capping a hero line at 72px because that is what "Display" says
here produces exactly the failure that rule warns about — an oversized
in-page heading standing in for a hero, which reads as a bigger paragraph,
not an authored dominant move.

## Line height (leading)

| Text size | Line height |
|---|---|
| Display / H1 (≥32 px) | `1.0`–`1.2` (tight) |
| Body (15–18 px) | `1.5`–`1.6` |
| Small (≤14 px) | `1.5` |

## Letter-spacing — the rule that makes or breaks craft

This is the single most-skipped rule in AI-generated design. **No
exceptions.**

| Context | Letter-spacing |
|---|---|
| Body text (14–18 px) | `0` (default) |
| Small text (11–13 px) | `0.01em` to `0.02em` (positive) |
| UI labels and button text | `0.02em` |
| **ALL CAPS** | **`0.06em` to `0.1em` (required)** |
| Headings 32 px+ | `-0.01em` to `-0.02em` |
| Display 48 px+ | `-0.02em` to `-0.03em` |

ALL CAPS without positive tracking looks cramped and amateur. Display
text without negative tracking looks loose and weak. These two failures
are the most reliable AI-slop tells.

The `0.06em` floor is not arbitrary: it is the empirical lower bound
that print and web typographers have converged on for uppercase
tracking (cf. Bringhurst's *Elements of Typographic Style* §3.2.7,
which recommends 5–10% of the em for caps; modern screen practice
rounds the lower end to 0.06em). Anything tighter and the counters
collide on screen; the upper bound `0.1em` keeps the word from
disintegrating into letters.

## Font pairing

- Maximum 2 typefaces per artifact (display + body, or one variable face
  used at multiple weights).
- Always declare a system fallback chain. If the active `DESIGN.md`
  ships a webfont URL, the fallback must still produce a coherent look.
- Never set `font-family: system-ui` alone on a heading — that is the
  textbook AI default; always pair it with an intentional first choice.

## Line length

Limit body copy to **50–75 characters** per line. In CSS:
`max-width: 65ch` is a safe default.

## Three-weight system

Most well-crafted UIs use exactly 3 weights:
- **Read** (400 / 450) — body copy
- **Emphasize** (510 / 550) — UI text, labels, navigation
- **Announce** (590 / 600) — headlines, buttons

Weight 700+ is rarely needed. If your design uses bold for "emphasis on
emphasis," it likely lacks weight discipline elsewhere.

## Inline emphasis inside a display line

Mixing weight or face *within* one display line is a real authority move
that spends zero additional vertical space — cheaper than a bigger font
size, and it reads as considered rather than loud. A hero line set
entirely in one weight leans on scale as the only lever; letting one word
or phrase carry a different weight, an italic aside, or the secondary
face against the primary gives the line internal hierarchy the way a
print masthead does.

- Vary weight, not size, within the line — e.g. a light "We build" next
  to a heavy "quiet confidence."
- A single italic word or short phrase inside an upright line reads as a
  spoken aside without breaking the line's scale.
- One inline variation per line, not several. A line with a weight change
  *and* an italic *and* a color change reads as noise — the same failure
  `typography-hierarchy.md`'s Noise hierarchy names for whole surfaces,
  compressed into one line.
- This is additive to, not a substitute for, the scale ratio in
  `typography-hierarchy.md`'s "Hero display ratio" section — a
  correctly-sized hero line with no inline mixing still passes; inline
  mixing does not rescue an undersized one.

## Common mistakes (lint these)

- ALL CAPS without `letter-spacing` ≥ `0.06em`.
- Display text (≥32 px) without negative tracking.
- More than 3 type sizes visible above the fold.
- Mixed serif and slab on the same screen without a clear role split.
- Body copy in `text-align: justify` (creates rivers; never use on the web).
