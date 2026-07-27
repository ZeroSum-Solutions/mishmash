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
  assert.ok(result.axes.directive_claim_coverage < 0.5, `expected bare-provenance directive_claim_coverage ${result.axes.directive_claim_coverage} < 0.5 (was 1.0 before the fix)`);
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
  // tell the difference.
  const manifest = loadManifest();
  const c = manifest.cases.find((cc) => cc.id === CASE_ID)!;
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
  const result = scoreComposition({ caseId: CASE_ID, composition: opposite });
  assert.ok(result.axes.directive_claim_coverage < 0.5, `expected opposite-breakpoint directive_claim_coverage ${result.axes.directive_claim_coverage} < 0.5 (was 1.0 before the fix)`);
});
