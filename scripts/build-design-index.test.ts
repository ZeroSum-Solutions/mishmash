// F001 R1 — the structured design index's extractors.
//
// The index's whole value is that a low-confidence field is marked rather than
// silently guessed, so these tests pin both halves: a template that declares a
// real palette section is read structurally at high confidence, and one that
// only scatters hexes through prose falls back to accent/low rather than
// inventing roles for them.
import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateDensity,
  estimateMotionLevel,
  extractFallbackPalette,
  extractLayout,
  extractMoods,
  extractStructuredPalette,
  extractStructuredTypography,
  looksLikeFontFamily,
} from "./build-design-index.ts";
import { MOODS } from "./design-taxonomy.ts";

const STRUCTURED_SKILL = `# Almond Hours

## COLOR PALETTE

- Background: \`#FAF7F2\` warm paper
- Text: \`#1B1B1B\`
- Accent: \`#8A3324\`

## TYPOGRAPHY

- Body: Source Serif
`;

const PROSE_SKILL = `# Loose Notes

The hero uses #1B1B1B on #FAF7F2, with #8A3324 for links.
`;

test("extractStructuredPalette reads roles and marks them high confidence", () => {
  const palette = extractStructuredPalette(STRUCTURED_SKILL);
  assert.ok(palette, "expected a structured palette");
  const text = palette.find((entry) => entry.hex === "#1B1B1B");
  assert.ok(text, "expected the text colour to be extracted");
  assert.equal(text.role, "text");
  assert.equal(text.confidence, "high");
  assert.match(text.provenance, /Text:/);
  assert.equal(palette.find((entry) => entry.hex === "#FAF7F2")?.role, "background");
  assert.equal(palette.find((entry) => entry.hex === "#8A3324")?.role, "accent");
});

test("extractStructuredPalette returns null when there is no palette section", () => {
  assert.equal(extractStructuredPalette(PROSE_SKILL), null);
});

test("extractFallbackPalette marks every guess accent/low rather than hiding it", () => {
  const palette = extractFallbackPalette(PROSE_SKILL);
  assert.ok(palette.length > 0);
  for (const entry of palette) {
    assert.equal(entry.role, "accent");
    assert.equal(entry.confidence, "low");
    assert.ok(entry.provenance.length > 0, "every entry cites the line it came from");
  }
  assert.deepEqual(
    palette.map((entry) => entry.hex),
    ["#1B1B1B", "#FAF7F2", "#8A3324"],
  );
});

test("extractFallbackPalette de-duplicates and caps its guesses", () => {
  const many = Array.from({ length: 12 }, (_, i) => `#0000${i.toString(16).padStart(2, "0")}`);
  const entries = extractFallbackPalette(`${many.join(" ")} ${many.join(" ")}`);
  assert.ok(entries.length <= 5, `expected at most 5 guesses, got ${entries.length}`);
  assert.equal(new Set(entries.map((e) => e.hex)).size, entries.length);
});

test("extractMoods only ever returns vocabulary terms", () => {
  const moods = extractMoods("An editorial, warm layout", ["playful"], "brutalist rules");
  assert.ok(moods.length > 0);
  for (const mood of moods) assert.ok(MOODS.includes(mood), `${mood} is outside the vocabulary`);
  assert.deepEqual(extractMoods("nothing to see", [], ""), []);
});

test("motion and density estimates stay inside their three-point scales", () => {
  for (const value of [estimateMotionLevel(""), estimateMotionLevel("parallax hover marquee scroll reveal cursor animation")]) {
    assert.ok(["low", "medium", "high"].includes(value), value);
  }
  for (const value of [estimateDensity(""), estimateDensity("dense grid of cards ".repeat(40))]) {
    assert.ok(["low", "medium", "high"].includes(value), value);
  }
});

// ---------------------------------------------------------------------------
// Palette role precedence (pre-land audit F001-PR140 defect #4) --
// explicit role words ("ACCENT") must win over a generic qualifier
// ("SECONDARY") that merely modifies some other, unnamed role. Fixture is
// the exact label from design-templates/aegis-console-h39/SKILL.md that the
// audit cited as producing a confidently-wrong "muted" role.
// ---------------------------------------------------------------------------

const AEGIS_CONSOLE_PALETTE = `# Aegis Console

## COLOR PALETTE (EXACT)

- INK / PRIMARY TEXT & SURFACES: \`#1D1D1D\` -- NEAR-BLACK CHARCOAL.
- ACCENT LIME: \`#DCF986\` -- THE SINGLE BRAND ACCENT.
- SECONDARY WARM ACCENT (USE RARELY, FOR ONE ALERT STATE): \`#FF8C42\`.
- BACKGROUND: PURE WHITE \`#FFFFFF\`.
- SECONDARY TEXT / GRAY: \`#464646\`.
- UNLABELLED SWATCH: \`#00AACC\`.
- BRAND DARK (CHARCOAL): \`#111214\`.
`;

// Verbatim from design-templates/citron-atlas-h79/SKILL.md's "## COLOR
// SYSTEM (EXACT)" section -- the real committed row the previous commit on
// this branch fixed ("stop the index labelling muted greys as the primary
// text colour"). Must not regress back to 'text' while fixing the
// SECONDARY-vs-ACCENT defect below.
const CITRON_ATLAS_PALETTE = `# Citron Atlas

## COLOR SYSTEM (EXACT)
- BRAND PRIMARY / TEXT-PRIMARY: \`#F3FFC9\` (PALE PHOSPHOR CITRON).
- TEXT-SECONDARY / SAGE: \`#A9AD9B\` (MUTED SAGE-GREY -- BODY COPY).
- TEXT-INVERSE: \`#000000\` (FOR USE ON CITRON BUTTONS).
`;

test("extractStructuredPalette resolves an explicit ACCENT word over a co-occurring SECONDARY qualifier", () => {
  const palette = extractStructuredPalette(AEGIS_CONSOLE_PALETTE);
  assert.ok(palette);
  const secondaryAccent = palette.find((entry) => entry.hex === "#FF8C42");
  assert.ok(secondaryAccent, "expected the SECONDARY WARM ACCENT hex to be extracted");
  assert.equal(secondaryAccent.role, "accent", "SECONDARY WARM ACCENT must resolve via the explicit ACCENT word, not the generic SECONDARY qualifier");
  assert.equal(secondaryAccent.confidence, "high");
});

test("extractStructuredPalette resolves a SECONDARY qualifier over a co-occurring bare TEXT word (prior-fix regression guard)", () => {
  const palette = extractStructuredPalette(AEGIS_CONSOLE_PALETTE);
  assert.ok(palette);
  const secondaryText = palette.find((entry) => entry.hex === "#464646");
  assert.ok(secondaryText, "expected the SECONDARY TEXT / GRAY hex to be extracted");
  assert.equal(secondaryText.role, "muted", "SECONDARY TEXT / GRAY must resolve 'muted', not the primary text colour");
  assert.equal(secondaryText.confidence, "medium", "a qualifier-only inference is not the same certainty as an explicit role word");
});

test("extractStructuredPalette still resolves the real citron-atlas TEXT-SECONDARY row as muted, not the primary text colour", () => {
  const palette = extractStructuredPalette(CITRON_ATLAS_PALETTE);
  assert.ok(palette);
  const primaryText = palette.find((entry) => entry.hex === "#F3FFC9");
  assert.ok(primaryText);
  assert.equal(primaryText.role, "text", "BRAND PRIMARY / TEXT-PRIMARY is the real primary text colour");
  const secondaryText = palette.find((entry) => entry.hex === "#A9AD9B");
  assert.ok(secondaryText);
  assert.equal(secondaryText.role, "muted", "TEXT-SECONDARY / SAGE (MUTED SAGE-GREY) must not become the primary text colour");
  const inverseText = palette.find((entry) => entry.hex === "#000000");
  assert.ok(inverseText);
  assert.equal(inverseText.role, "text", "TEXT-INVERSE has no SECONDARY/MUTED qualifier and should still resolve via bare TEXT");
});

test("extractStructuredPalette marks a label with no role evidence at all low confidence, not high", () => {
  const palette = extractStructuredPalette(AEGIS_CONSOLE_PALETTE);
  assert.ok(palette);
  const unlabelled = palette.find((entry) => entry.hex === "#00AACC");
  assert.ok(unlabelled, "expected the unlabelled swatch to be extracted");
  assert.equal(unlabelled.role, "accent");
  assert.equal(unlabelled.confidence, "low", "an unmapped label must not retain high confidence");
});

test("extractStructuredPalette does not treat the generic BRAND prefix alone as an accent signal", () => {
  const palette = extractStructuredPalette(AEGIS_CONSOLE_PALETTE);
  assert.ok(palette);
  const brandDark = palette.find((entry) => entry.hex === "#111214");
  assert.ok(brandDark, "expected the BRAND DARK hex to be extracted");
  assert.equal(brandDark.confidence, "low", "BRAND alone is not real evidence for any specific role");
});

// ---------------------------------------------------------------------------
// Typography prose-vs-family (pre-land audit F001-PR140 defect #3) --
// fixtures lifted verbatim from design-templates/citron-atlas-h79/SKILL.md
// and design-templates/helix-strata-h76/SKILL.md, the exact rows the audit
// cited as emitting "18PX" / "WEIGHT 300" as font families at high
// confidence.
// ---------------------------------------------------------------------------

const CITRON_ATLAS_TYPOGRAPHY = `# Citron Atlas

## TYPOGRAPHY
- ONE FAMILY THROUGHOUT: **INTER** (VENDORED LOCALLY AS WOFF2), WEIGHTS 400 / 500 / 600 / 700.
- BODY: 18PX, SAGE-GREY, RELAXED LEADING.
- EYEBROWS / META: SMALL, SAGE, NOT UPPERCASE UNLESS ON CLIENT LOGO TILES.
`;

const HELIX_STRATA_TYPOGRAPHY = `# Helix Strata

## TYPOGRAPHY

- DISPLAY HEADLINES: WEIGHT 400 (NORMAL), VERY TIGHT NEGATIVE TRACKING.
- BODY: WEIGHT 300 (LIGHT), 16-18PX, COMFORTABLE LINE-HEIGHT.
- EYEBROW LABELS: WEIGHT 700, UPPERCASE, WIDE LETTER-SPACING, ~12PX.
`;

const ALMOND_HOURS_TYPOGRAPHY = `# Almond Hours

## TYPOGRAPHY
- DISPLAY / HEADINGS: PLUS JAKARTA SANS (700/800)
- BODY: INTER (300/400/500)
- NAV / LABELS / EYEBROWS: INTER TIGHT
`;

test("extractStructuredTypography never emits a CSS size as a font family (citron-atlas fixture)", () => {
  const typography = extractStructuredTypography(CITRON_ATLAS_TYPOGRAPHY);
  assert.equal(typography.body, undefined, `expected no structured "body" family, got ${JSON.stringify(typography.body)}`);
  assert.equal(typography.ui, undefined, `expected no structured "ui" family, got ${JSON.stringify(typography.ui)}`);
});

test("extractStructuredTypography never emits a font-weight instruction as a font family (helix-strata fixture)", () => {
  const typography = extractStructuredTypography(HELIX_STRATA_TYPOGRAPHY);
  assert.equal(typography.body, undefined, `expected no structured "body" family, got ${JSON.stringify(typography.body)}`);
  assert.equal(typography.headings, undefined, `expected no structured "headings" family, got ${JSON.stringify(typography.headings)}`);
  assert.equal(typography.ui, undefined, `expected no structured "ui" family, got ${JSON.stringify(typography.ui)}`);
});

test("extractStructuredTypography still resolves real family names at high confidence (no over-rejection)", () => {
  const typography = extractStructuredTypography(ALMOND_HOURS_TYPOGRAPHY);
  assert.equal(typography.headings?.family, "PLUS JAKARTA SANS");
  assert.equal(typography.headings?.confidence, "high");
  assert.equal(typography.body?.family, "INTER");
  assert.equal(typography.ui?.family, "INTER TIGHT", "a real family containing a size/weight-ish word (TIGHT) must not be rejected");
});

test("looksLikeFontFamily rejects CSS sizes, weight instructions, and bare casing/weight words", () => {
  for (const prose of ["18PX", "13PX", "16-18PX", "WEIGHT 300", "WEIGHT 700", "UPPERCASE", "SMALL", "300"]) {
    assert.equal(looksLikeFontFamily(prose), false, `expected "${prose}" to be rejected as a font family`);
  }
});

test("looksLikeFontFamily accepts real family names, including ones containing a weight/size-ish word", () => {
  for (const name of ["Inter", "PLUS JAKARTA SANS", "Inter Tight", "EB Garamond", "Fraunces"]) {
    assert.equal(looksLikeFontFamily(name), true, `expected "${name}" to be accepted as a font family`);
  }
});

// ---------------------------------------------------------------------------
// Layout / typesetting extraction (pre-land audit F001-PR140 defect #2)
// ---------------------------------------------------------------------------

test("extractLayout reads a max-width measure and converts rem/px onto the ch scale", () => {
  assert.equal(extractLayout("body copy uses max-width: 62ch for the reading column").measureCh, 62);
  assert.equal(extractLayout("prose column: max-width: 34rem").measureCh, 34 * (62 / 34));
  assert.equal(extractLayout(".prose { max-width: 640px; }").measureCh, 640 / 8);
});

test("extractLayout reads text-align signals, including a mixed-signal document", () => {
  assert.equal(extractLayout(".hero { text-align: center; }").textAlign, "center");
  assert.equal(extractLayout(".hero { text-align: justify; }").textAlign, "justify");
  assert.equal(extractLayout(".hero { text-align: left; }").textAlign, "left");
  assert.equal(extractLayout(".hero { text-align: center; } .body { text-align: left; }").textAlign, "mixed");
  assert.equal(extractLayout("no alignment mentioned anywhere").textAlign, null);
});

test("extractLayout finds pre-wrap / hanging-indent as unambiguous signals and raises confidence to medium", () => {
  const layout = extractLayout("poem blocks use white-space: pre-wrap with a hanging indent on wrapped lines");
  assert.equal(layout.preservesLineBreaks, true);
  assert.equal(layout.hangingIndent, true);
  assert.equal(layout.confidence, "medium");
});

test("extractLayout defaults to null fields and low confidence when the body gives no evidence", () => {
  const layout = extractLayout("Just a generic marketing paragraph with no typesetting detail at all.");
  assert.deepEqual(layout, {
    measureCh: null,
    textAlign: null,
    preservesLineBreaks: null,
    hangingIndent: null,
    confidence: "low",
  });
});

test("extractLayout never raises confidence above low from a bare max-width/text-align mention alone", () => {
  // A max-width or text-align mention alone cannot be attributed to the
  // reading column with confidence -- it could just as easily describe an
  // unrelated element (a logo, a card, a hero image). Only the unambiguous
  // pre-wrap/hanging-indent terms raise confidence.
  const layout = extractLayout(".watermark { max-width: 1100px; text-align: center; }");
  assert.equal(layout.confidence, "low");
});
