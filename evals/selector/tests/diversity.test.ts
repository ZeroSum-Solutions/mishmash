import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreDiversity, type DiversityElement } from '../scorer/diversity.ts';

const FLOOR = 0.25; // matches evals/selector/floors.json's structural_variant_diversity floor

const base: DiversityElement[] = [
  { elementId: 'e0', domPath: 'body > header.a', breakpoint: 'mobile', motionSignature: 'timeline-a' },
  { elementId: 'e1', domPath: 'body > section.hero.a', breakpoint: 'mobile', motionSignature: 'timeline-a' },
  { elementId: 'e2', domPath: 'body > section.features.a', breakpoint: 'desktop', motionSignature: 'timeline-a' },
  { elementId: 'e3', domPath: 'body > footer.a', breakpoint: 'desktop', motionSignature: 'timeline-a' },
];

test('scores an identical trio below the diversity floor', () => {
  const trio = [base, base.map((e) => ({ ...e })), base.map((e) => ({ ...e }))];
  const result = scoreDiversity(trio);
  assert.ok(result.score < FLOOR, `expected identical trio score ${result.score} < ${FLOOR}`);
});

test('scores a recolor-only trio below the diversity floor', () => {
  // "Recolor" has no representation anywhere in DiversityElement -- there is
  // no color/background field on a diversity element at all (color lives
  // only on the bleed-fingerprint side of the scorer, never here). A trio
  // that only differs in a field this metric doesn't even look at cannot
  // move any of the four pre-registered axes, which is the whole point:
  // "diverse" cannot be redefined to mean "different border-radius."
  const recolored = base.map((e) => ({ ...e })); // structurally identical; "color" isn't a field to vary
  const trio = [base, recolored, base.map((e) => ({ ...e }))];
  const result = scoreDiversity(trio);
  assert.ok(result.score < FLOOR, `expected recolor-only trio score ${result.score} < ${FLOOR}`);
});

test('scores a class-names-only trio below the diversity floor', () => {
  // Same argument as recolor: CSS class names are not part of domPath's
  // structural identity in this schema (domPath is a DOM/selector path, not
  // a className list) and DiversityElement carries no className field.
  // Varying only elementId -- an identifier the metric never reads --
  // models "same structure, different label" and must not move the score.
  const relabeled = base.map((e, i) => ({ ...e, elementId: `relabeled-${i}` }));
  const trio = [base, relabeled, base.map((e, i) => ({ ...e, elementId: `also-relabeled-${i}` }))];
  const result = scoreDiversity(trio);
  assert.ok(result.score < FLOOR, `expected class-names-only trio score ${result.score} < ${FLOOR}`);
});

test('scores a genuinely section-order-diverse trio at or above the diversity floor', () => {
  const rotated = [base[1]!, base[2]!, base[3]!, base[0]!];
  const reversed = [...base].reverse();
  const trio = [base, rotated, reversed];
  const result = scoreDiversity(trio);
  assert.ok(result.score >= FLOOR, `expected order-diverse trio score ${result.score} >= ${FLOOR}`);
});
