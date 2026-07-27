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

test('scores an arbitrary-motion-label-only trio below the diversity floor (Sol-N4/F8)', () => {
  // Sol's exact repro: arbitrary motion labels a/b/c used to score 1.0 on
  // the motion-timeline axis purely because the raw strings differ, with
  // zero real transition evidence behind any of them. Structure (domPath,
  // breakpoint) is held IDENTICAL across all three -- the only variation is
  // the motionSignature label -- so if motion-timeline is genuinely
  // evidence-gated, none of the four axes should clear the floor.
  const withLabel = (label: string): DiversityElement[] => base.map((e) => ({ ...e, motionSignature: label }));
  const trio = [withLabel('timeline-a'), withLabel('timeline-b'), withLabel('timeline-c')];
  const result = scoreDiversity(trio);
  assert.ok(result.score < FLOOR, `expected arbitrary-motion-label-only trio score ${result.score} < ${FLOOR} (unverifiable labels must not count as distinct)`);
});

test('scores a trio with genuinely differing real transition durations at or above the diversity floor', () => {
  // The positive control for the same fix: real `transition:<ms>ms`
  // evidence with genuinely different durations DOES count as distinct.
  const withDuration = (ms: number): DiversityElement[] => base.map((e) => ({ ...e, motionSignature: `transition:${ms}ms` }));
  const trio = [withDuration(120), withDuration(220), withDuration(320)];
  const result = scoreDiversity(trio);
  assert.ok(result.score >= FLOOR, `expected genuinely-differing-transition-duration trio score ${result.score} >= ${FLOOR}`);
});
