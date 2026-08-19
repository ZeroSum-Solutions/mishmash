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
  extractMoods,
  extractStructuredPalette,
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
