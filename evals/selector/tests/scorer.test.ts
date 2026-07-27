// scorer.test.ts -- encodes Sol's two round-2 F9/N1 repros as tests, against
// the REAL corpus (not synthetic fixtures) so these tests exercise the exact
// same loadCase/loadCaseIR/buildSnapshotsBySource machinery scoreComposition
// itself uses.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCaseIR, loadManifest, buildSnapshotsBySource } from '../scorer/corpus-loader.ts';
import { scoreComposition, type CompositionElement } from '../scorer/index.ts';

const CASE_ID = 'docs-api-reference';

test('Sol-N9 (F9): bare IR-provenance composition does not score directive_claim_coverage=1.0', () => {
  // Sol's exact repro: "score docs-api-reference using its four IR
  // provenance records as the composition, omit rendered-property evidence."
  // A provenance record has ONLY elementId/sourceId/nodeId/domPath/breakpoint
  // -- no styleFingerprint, no motionSignature -- so this composition
  // literally cannot self-report ANY rendering evidence.
  const ir = loadCaseIR(loadManifest().cases.find((c) => c.id === CASE_ID)!);
  assert.ok(ir.provenance.length > 0, 'fixture sanity: case has provenance entries');
  const bareComposition: CompositionElement[] = ir.provenance.map((p) => ({
    elementId: p.elementId,
    sourceId: p.sourceId,
    domPath: p.domPath,
    nodeId: p.nodeId,
    breakpoint: p.breakpoint,
  }));
  const result = scoreComposition({ caseId: CASE_ID, composition: bareComposition });
  assert.equal(result.axes.directive_claim_coverage, 0, `expected bare-provenance directive_claim_coverage to be EXACTLY 0 (was 1.0 before the fix), got ${result.axes.directive_claim_coverage}`);
});

test('Sol-N1: bare IR-provenance composition scores near zero on layout_geometry/section_identity/responsiveness/broken_assets/a11y', () => {
  // Sol's exact repro: "Bare docs-api-reference provenance scores 0.7909
  // overall with those axes at 1.0." A composition with zero self-reported
  // evidence (no styleFingerprint, no motionSignature anywhere) must not be
  // scored as if every axis it happens to resolve against were verified.
  const ir = loadCaseIR(loadManifest().cases.find((c) => c.id === CASE_ID)!);
  const bareComposition: CompositionElement[] = ir.provenance.map((p) => ({
    elementId: p.elementId,
    sourceId: p.sourceId,
    domPath: p.domPath,
    nodeId: p.nodeId,
    breakpoint: p.breakpoint,
  }));
  const result = scoreComposition({ caseId: CASE_ID, composition: bareComposition });
  const NEAR_ZERO = 0.2;
  for (const axis of ['layout_geometry', 'section_identity', 'responsiveness', 'broken_assets', 'a11y'] as const) {
    assert.ok(result.axes[axis] < NEAR_ZERO, `expected bare-provenance axes.${axis} = ${result.axes[axis]} < ${NEAR_ZERO} (was 1.0 before the fix)`);
  }
  assert.ok(result.overall < 0.5, `expected bare-provenance overall ${result.overall} well below the pre-fix 0.7909`);
});

test('Sol-N9 (F9): opposite-breakpoint provenance does not score directive_claim_coverage=1.0', () => {
  // Sol's exact repro: substitute each claim's REAL data with the SAME
  // domPath/source's node from the OPPOSITE breakpoint -- self-consistent
  // (genuinely resolves, groundedness 2) but citing the wrong capture
  // session. Round 1's coverage (domPath+sourceId membership only) could not
  // tell the difference; round 2's coverage discounted a mismatch to 0.3
  // rather than veto it outright. Round 3 (gate-amendment enabling item):
  // hard veto, expects exactly 0.
  //
  // Uses marketing-hero-grid, not docs-api-reference (CASE_ID) -- docs-api-
  // reference deliberately has its layout AND section claims scoped to the
  // SAME domPath (a docs page's toc-panel genuinely has both a layout and a
  // structural identity) at DIFFERENT breakpoints; swapping every claim to
  // its opposite breakpoint then makes one claim's swapped element
  // coincidentally land on another claim's ORIGINAL (domPath, sourceId,
  // breakpoint) triple, which coverage's find() legitimately (and
  // correctly, for a real composition) treats as a match for THAT other
  // claim -- a false negative of this specific test's construction, not a
  // scorer defect. marketing-hero-grid's 4 claims are all on distinct
  // domPaths, so no such collision is possible.
  const OPPOSITE_CASE_ID = 'marketing-hero-grid';
  const manifest = loadManifest();
  const c = manifest.cases.find((cc) => cc.id === OPPOSITE_CASE_ID)!;
  const ir = loadCaseIR(c);
  const bySource = buildSnapshotsBySource(c);
  const opposite: CompositionElement[] = [];
  for (const p of ir.provenance) {
    const otherBp = p.breakpoint === 'mobile' ? 'desktop' : 'mobile';
    const otherNode = (bySource[p.sourceId] ?? []).find((n) => n.domPath === p.domPath && n.breakpoint === otherBp && n.state === 'default');
    assert.ok(otherNode, `fixture sanity: ${p.domPath} must have a real capture at the opposite breakpoint ${otherBp}`);
    opposite.push({
      elementId: p.elementId,
      sourceId: p.sourceId,
      domPath: p.domPath,
      nodeId: otherNode!.nodeId,
      breakpoint: otherBp,
      motionSignature: 'timeline-a',
    });
  }
  const result = scoreComposition({ caseId: OPPOSITE_CASE_ID, composition: opposite });
  assert.equal(result.axes.directive_claim_coverage, 0, `expected opposite-breakpoint directive_claim_coverage to be EXACTLY 0 (hard veto), got ${result.axes.directive_claim_coverage}`);
});
