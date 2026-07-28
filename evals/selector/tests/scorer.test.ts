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

test('Sol-N9/F9 (round 4): arbitrary motion self-report on real provenance does not clear coverage at 0.707', () => {
  // Sol's exact round-4 repro: "arbitrary non-empty motionSignature on real
  // docs provenance clears directive_claim_coverage at 0.707 without style
  // evidence." docs-api-reference's real provenance (every domPath/nodeId/
  // breakpoint genuinely correct, groundedness=2 for all 4 elements) plus an
  // ARBITRARY, non-empty motionSignature on every element (no
  // styleFingerprint anywhere) used to satisfy the generic
  // hasSelfReportedEvidence gate for the case's layout AND section claims
  // (axes that have nothing to do with motion), while its palette claim
  // correctly stayed unrealized -- weighted average landed at exactly 0.707
  // (0.8*1[section] + 0.65*1[layout] + 0.6*0[palette]) / 2.05. Axis-specific
  // gating (hasStyleEvidence, not the removed generic hasSelfReportedEvidence)
  // must drop coverage to 0: motionSignature is not the evidence kind
  // layout/section need.
  const ir = loadCaseIR(loadManifest().cases.find((c) => c.id === CASE_ID)!);
  const composition: CompositionElement[] = ir.provenance.map((p) => ({
    elementId: p.elementId,
    sourceId: p.sourceId,
    domPath: p.domPath,
    nodeId: p.nodeId,
    breakpoint: p.breakpoint,
    motionSignature: 'arbitrary-nonempty-label',
  }));
  const result = scoreComposition({ caseId: CASE_ID, composition });
  assert.notEqual(result.axes.directive_claim_coverage, 0.7073170731707317, 'must not still be the pre-fix 0.707 value');
  assert.equal(result.axes.directive_claim_coverage, 0, `expected coverage to drop to EXACTLY 0 (motionSignature does not evidence layout/section claims), got ${result.axes.directive_claim_coverage}`);
});

test('Sol-N4: a wrong-state citation (real hover-state nodeId cited where the claim needs default) is not credited', () => {
  // ecommerce-product-flex's real 'motion' claim (source=ecom-grid-b, scope=
  // add-to-cart, breakpoint=mobile) has TWO real captures at that exact
  // (domPath, breakpoint): a 'default' state (transitionDuration=240ms) and
  // a 'hover' state (transitionDuration=180ms). Both nodeIds are genuinely
  // real, self-consistent captures -- citing the hover one is not a
  // fabrication, just the WRONG state for this resolution path (which
  // requires 'default' -- see CANONICAL_EVIDENCE_STATE in scorer/index.ts).
  // A composition element built from the hover nodeId, even with a
  // motionSignature that correctly matches THAT node's own real duration,
  // must not resolve as if it were the claim's genuine default-state
  // evidence.
  const MOTION_CASE_ID = 'ecommerce-product-flex';
  const manifest = loadManifest();
  const c = manifest.cases.find((cc) => cc.id === MOTION_CASE_ID)!;
  const bySource = buildSnapshotsBySource(c);
  const motionClaim = c.directiveInventory.find((d) => d.axis === 'motion')!;
  assert.ok(motionClaim, 'fixture sanity: ecommerce-product-flex has a motion claim');

  const defaultNode = (bySource[motionClaim.source] ?? []).find((n) => n.domPath === motionClaim.scope && n.breakpoint === motionClaim.breakpoint && n.state === 'default');
  const hoverNode = (bySource[motionClaim.source] ?? []).find((n) => n.domPath === motionClaim.scope && n.breakpoint === motionClaim.breakpoint && n.state === 'hover');
  assert.ok(defaultNode && hoverNode, 'fixture sanity: the motion claim scope has both a real default and a real hover capture');
  assert.notEqual(defaultNode!.computedStyle['transitionDuration'], hoverNode!.computedStyle['transitionDuration'], 'fixture sanity: default and hover carry genuinely different real durations');

  const buildComposition = (motionNodeId: string, motionDuration: string): CompositionElement[] =>
    c.directiveInventory.map((d, i) => {
      const node = (bySource[d.source] ?? []).find((n) => n.domPath === d.scope && n.breakpoint === d.breakpoint && n.state === 'default');
      const isMotionClaim = d.axis === 'motion';
      const nodeId = isMotionClaim ? motionNodeId : (node?.nodeId ?? `unknown-${i}`);
      const parts = ['color', 'backgroundColor', 'fontFamily'].map((k) => node?.computedStyle[k]).filter((v): v is string => typeof v === 'string' && v.length > 0);
      const el: CompositionElement = { elementId: `wc-${i}-${d.axis}`, sourceId: d.source, domPath: d.scope, nodeId, breakpoint: d.breakpoint ?? 'mobile' };
      if (parts.length === 3) el.styleFingerprint = parts.join('|');
      if (isMotionClaim) el.motionSignature = `transition:${motionDuration}`;
      return el;
    });

  const correctDefault = buildComposition(defaultNode!.nodeId, defaultNode!.computedStyle['transitionDuration']!);
  const wrongState = buildComposition(hoverNode!.nodeId, hoverNode!.computedStyle['transitionDuration']!);

  const correctResult = scoreComposition({ caseId: MOTION_CASE_ID, composition: correctDefault });
  const wrongResult = scoreComposition({ caseId: MOTION_CASE_ID, composition: wrongState });

  assert.equal(correctResult.axes.motion_timing, 1, `expected the correct default-state citation to fully verify motion_timing, got ${correctResult.axes.motion_timing}`);
  assert.ok(wrongResult.axes.motion_timing < correctResult.axes.motion_timing, `expected wrong-state motion_timing (${wrongResult.axes.motion_timing}) < correct-state motion_timing (${correctResult.axes.motion_timing})`);
  assert.ok(wrongResult.axes.directive_claim_coverage < correctResult.axes.directive_claim_coverage, `expected wrong-state coverage (${wrongResult.axes.directive_claim_coverage}) < correct-state coverage (${correctResult.axes.directive_claim_coverage})`);
});

test('Sol-F9 (founder-authorized micro-round): arbitrary non-verified styleFingerprint on real provenance does not restore coverage at 0.707', () => {
  // Sol's binding REJECT of round 4: "styleFingerprint:'x' on real
  // provenance restores exact 0.7073170731707317 coverage; hasStyleEvidence
  // checks presence, not verification" and "N1 STILL-OPEN: arbitrary
  // non-empty styleFingerprint unlocks layout_geometry=1, section_identity=1,
  // and responsiveness=1 without verified style evidence." Round 4's
  // hasStyleEvidence gate correctly narrowed the evidence KIND to
  // styleFingerprint (fixing the motionSignature exploit), but only checked
  // NON-EMPTINESS -- an arbitrary, unparseable/unverifiable value like "x"
  // still satisfied it. docs-api-reference's real provenance (every
  // domPath/nodeId/breakpoint genuinely correct, groundedness=2 for all 4
  // elements) plus styleFingerprint:"x" on every element reproduces the
  // EXACT SAME 0.707 math as round 4's motionSignature repro, because "x" is
  // just as non-empty as "arbitrary-nonempty-label" was -- the gate never
  // looked past presence. hasVerifiedStyleEvidence must drop coverage to 0
  // and must NOT unlock layout_geometry/section_identity/responsiveness,
  // since "x" does not parse to a 3-part fingerprint and so verifies against
  // nothing.
  const ir = loadCaseIR(loadManifest().cases.find((c) => c.id === CASE_ID)!);
  const composition: CompositionElement[] = ir.provenance.map((p) => ({
    elementId: p.elementId,
    sourceId: p.sourceId,
    domPath: p.domPath,
    nodeId: p.nodeId,
    breakpoint: p.breakpoint,
    styleFingerprint: 'x',
  }));
  const result = scoreComposition({ caseId: CASE_ID, composition });
  assert.notEqual(result.axes.directive_claim_coverage, 0.7073170731707317, 'must not still be the pre-fix 0.707 value');
  assert.equal(result.axes.directive_claim_coverage, 0, `expected coverage to drop to EXACTLY 0 (unverified styleFingerprint does not evidence layout/section claims), got ${result.axes.directive_claim_coverage}`);
  const NEAR_ZERO = 0.2;
  for (const axis of ['layout_geometry', 'section_identity', 'responsiveness'] as const) {
    assert.ok(result.axes[axis] < NEAR_ZERO, `expected axes.${axis} = ${result.axes[axis]} < ${NEAR_ZERO} (an arbitrary, non-verified styleFingerprint must not unlock it to 1.0)`);
  }
});

test('Sol-F9 (founder-authorized micro-round): a genuinely correct, verified styleFingerprint still fully verifies -- honest satisfiability', () => {
  // Binding calibration standard: tightening a gate to require genuine
  // VERIFICATION must not make honest, correctly-evidenced compositions
  // unscoreable. Builds docs-api-reference's real provenance with a
  // styleFingerprint DERIVED FROM the resolved node's own real captured
  // computedStyle (color|backgroundColor|fontFamily, the same convention
  // paletteEvidenceFactor/typeEvidenceFactor verify against and
  // verify-w7.ts's own styleFingerprintOf uses) -- a genuinely honest claim,
  // not an arbitrary label. This must fully verify: coverage=1 and every
  // axis hasVerifiedStyleEvidence gates reaches its ceiling.
  const c = loadManifest().cases.find((cc) => cc.id === CASE_ID)!;
  const ir = loadCaseIR(c);
  const bySource = buildSnapshotsBySource(c);
  const composition: CompositionElement[] = ir.provenance.map((p) => {
    const node = (bySource[p.sourceId] ?? []).find((n) => n.nodeId === p.nodeId && n.domPath === p.domPath && n.breakpoint === p.breakpoint && n.state === 'default');
    assert.ok(node, `fixture sanity: provenance entry ${p.elementId} must resolve to a real default-state node`);
    const parts = ['color', 'backgroundColor', 'fontFamily'].map((k) => node!.computedStyle[k]).filter((v): v is string => typeof v === 'string' && v.length > 0);
    assert.equal(parts.length, 3, `fixture sanity: ${p.elementId}'s resolved node must carry all 3 style keys`);
    const el: CompositionElement = { elementId: p.elementId, sourceId: p.sourceId, domPath: p.domPath, nodeId: p.nodeId, breakpoint: p.breakpoint, styleFingerprint: parts.join('|') };
    return el;
  });
  const result = scoreComposition({ caseId: CASE_ID, composition });
  assert.equal(result.axes.directive_claim_coverage, 1, `expected a genuinely honest, verified styleFingerprint to fully cover, got ${result.axes.directive_claim_coverage}`);
  for (const axis of ['layout_geometry', 'section_identity', 'responsiveness'] as const) {
    assert.equal(result.axes[axis], 1, `expected axes.${axis} to fully verify with honest evidence, got ${result.axes[axis]}`);
  }
});
