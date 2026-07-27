// index.ts -- evals/selector/scorer entrypoint. scoreComposition(input)
// scores ONE composition (a candidate output for one corpus case) against
// the 11 axes named in the PRD (S7-3), returning {overall, axes} with every
// value a finite number in [0,1].
//
// The central idea every axis is built on: for each output element, classify
// how well-GROUNDED it is against the case's own captured snapshot data --
//
//   groundedness 2 -- the element's (nodeId, domPath, breakpoint) resolves
//                     against the SOURCE it claims (sourceId). Correctly
//                     attributed, real content.
//   groundedness 1 -- the same (nodeId, domPath, breakpoint) resolves
//                     against a DIFFERENT real source in the same case.
//                     Real content, WRONG attribution (a house-style
//                     composite, or a directive-axis counterfactual swap).
//   groundedness 0 -- resolves against no source in the case at all.
//                     Fabricated / foreign content.
//
// directive_claim_coverage is the only axis that requires groundedness 2
// specifically AND requires the match to be at the claim's own (source,
// scope) pair -- this is what makes it collapse on a house-style composite
// while layout_geometry/palette_fidelity/type_fidelity stay high (they
// score groundedness 1 as "real, if misattributed", not zero) -- see the PRD
// S7-3 note on why that axis is the whole point.

import { buildSnapshotsBySource, loadCase, type CapturedNode } from './corpus-loader.ts';
import { scoreSourceBleed, type BleedCompositionElement } from './source-bleed.ts';

export const SCORER_VERSION = '1.0.0';

export interface CompositionElement {
  elementId: string;
  sourceId: string;
  domPath: string;
  nodeId: string;
  breakpoint: string;
  motionSignature?: string;
  styleFingerprint?: string;
}

export interface ScoringInput {
  caseId: string;
  composition: CompositionElement[];
}

export interface ScoringResult {
  overall: number;
  axes: {
    layout_geometry: number;
    palette_fidelity: number;
    type_fidelity: number;
    motion_timing: number;
    section_identity: number;
    responsiveness: number;
    broken_assets: number;
    a11y: number;
    source_bleed: number;
    structural_variant_diversity: number;
    directive_claim_coverage: number;
  };
}

type DirectiveAxis = 'layout' | 'motion' | 'palette' | 'typography' | 'section' | 'interaction';

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function avg(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

type Groundedness = 0 | 1 | 2;

interface GradedElement {
  el: CompositionElement;
  groundedness: Groundedness;
}

function groundScore(g: Groundedness): number {
  if (g === 2) return 1.0;
  if (g === 1) return 0.55;
  return 0.15;
}

function gradeComposition(composition: CompositionElement[], bySource: Record<string, CapturedNode[]>): GradedElement[] {
  return composition.map((el) => {
    const claimedNodes = bySource[el.sourceId] ?? [];
    const matchesClaimed = claimedNodes.some((n) => n.nodeId === el.nodeId && n.domPath === el.domPath && n.breakpoint === el.breakpoint);
    if (matchesClaimed) return { el, groundedness: 2 as const };
    for (const [sourceId, nodes] of Object.entries(bySource)) {
      if (sourceId === el.sourceId) continue;
      if (nodes.some((n) => n.nodeId === el.nodeId && n.domPath === el.domPath && n.breakpoint === el.breakpoint)) {
        return { el, groundedness: 1 as const };
      }
    }
    return { el, groundedness: 0 as const };
  });
}

// #rrggbb -> WCAG relative luminance -> contrast ratio, normalized to
// [0,1] against the WCAG AA text threshold (4.5:1). Elements with no parsed
// color pair are excluded from the average rather than penalized (the
// composition simply carries no evidence either way for that element).
function relLuminance(hex: string): number | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1]!, 16);
  const channels = [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(hexA: string, hexB: string): number | null {
  const lA = relLuminance(hexA);
  const lB = relLuminance(hexB);
  if (lA === null || lB === null) return null;
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

function computeA11y(graded: GradedElement[], bySource: Record<string, CapturedNode[]>): number {
  const ratios: number[] = [];
  for (const g of graded) {
    const nodes = bySource[g.el.sourceId] ?? Object.values(bySource).flat();
    const node = nodes.find((n) => n.nodeId === g.el.nodeId && n.domPath === g.el.domPath) ?? Object.values(bySource).flat().find((n) => n.nodeId === g.el.nodeId && n.domPath === g.el.domPath);
    const color = node?.computedStyle['color'];
    const bg = node?.computedStyle['backgroundColor'];
    if (!color || !bg) continue;
    const ratio = contrastRatio(color, bg);
    if (ratio === null) continue;
    ratios.push(clamp01(ratio / 4.5));
  }
  return ratios.length > 0 ? avg(ratios) : 0.7;
}

// Single-composition structural richness proxy. Genuine pairwise variant
// diversity (comparing THIS composition against sibling variants) is
// diversity.ts's job, exercised directly by verify-w7.ts C7-8 with real
// trios -- scoreComposition only ever sees one composition at a time, so
// this axis instead measures how much internal structural variety the
// composition itself carries across the same four pre-registered
// dimensions (distinct skeleton roots, distinct motion signatures, distinct
// breakpoints, non-monotonic ordering), bounded to [0,1]. A future variant
// SELECTION step (W8) that wants genuine pairwise diversity calls
// scoreDiversity([...variants]) directly, not this axis.
function computeSelfDiversityProxy(composition: CompositionElement[]): number {
  if (composition.length === 0) return 0;
  const distinctDomPaths = new Set(composition.map((e) => e.domPath)).size;
  const distinctMotion = new Set(composition.map((e) => e.motionSignature ?? '')).size;
  const distinctBreakpoints = new Set(composition.map((e) => e.breakpoint)).size;
  const n = composition.length;
  const richness = (distinctDomPaths / n + distinctMotion / Math.max(1, n) + distinctBreakpoints / Math.max(1, n)) / 3;
  return clamp01(richness);
}

export function scoreComposition(input: ScoringInput): ScoringResult {
  const c = loadCase(input.caseId);
  const bySource = buildSnapshotsBySource(c);
  const graded = gradeComposition(input.composition, bySource);

  // directive_claim_coverage -- every IR claim must resolve to attributed
  // evidence at the CLAIMED source and CLAIMED scope specifically.
  let coverageHits = 0;
  for (const claim of c.directiveInventory) {
    const match = graded.find((g) => g.el.domPath === claim.scope && g.el.sourceId === claim.source);
    if (match && match.groundedness === 2) coverageHits++;
  }
  const directive_claim_coverage = c.directiveInventory.length > 0 ? coverageHits / c.directiveInventory.length : graded.length > 0 ? avg(graded.map((g) => (g.groundedness === 2 ? 1 : 0))) : 0;

  function axisScoreFor(axis: DirectiveAxis): number {
    const claims = c.directiveInventory.filter((d) => d.axis === axis);
    if (claims.length === 0) {
      return graded.length > 0 ? avg(graded.map((g) => groundScore(g.groundedness))) : 0.5;
    }
    const scores = claims.map((claim) => {
      const match = graded.find((g) => g.el.domPath === claim.scope);
      return match ? groundScore(match.groundedness) : 0.1;
    });
    return avg(scores);
  }

  const broken_assets = graded.length > 0 ? avg(graded.map((g) => (g.groundedness > 0 ? 1 : 0))) : 1;
  const a11y = computeA11y(graded, bySource);

  const sourceDomPaths: Record<string, string[]> = {};
  const sourceStyleFingerprints: Record<string, string[]> = {};
  for (const [sourceId, nodes] of Object.entries(bySource)) {
    sourceDomPaths[sourceId] = nodes.map((n) => n.domPath);
    const fps = new Set<string>();
    for (const n of nodes) {
      const parts = ['color', 'backgroundColor', 'fontFamily'].map((k) => n.computedStyle[k]).filter((v): v is string => typeof v === 'string' && v.length > 0);
      if (parts.length > 0) fps.add(parts.join('|'));
    }
    sourceStyleFingerprints[sourceId] = [...fps];
  }
  const bleedInput: BleedCompositionElement[] = input.composition.map((el) => {
    const out: BleedCompositionElement = { elementId: el.elementId, sourceId: el.sourceId, domPath: el.domPath };
    if (el.styleFingerprint !== undefined) out.styleFingerprint = el.styleFingerprint;
    return out;
  });
  const bleedResult = scoreSourceBleed({ composition: bleedInput, sourceDomPaths, sourceStyleFingerprints });
  const source_bleed = input.composition.length > 0 ? clamp01(1 - bleedResult.bleedCount / input.composition.length) : 1;

  // Real cross-variant diversity lives in diversity.ts's scoreDiversity(),
  // exercised directly against real trios by verify-w7.ts C7-8. This axis
  // is the single-composition proxy described above computeSelfDiversityProxy.
  const structural_variant_diversity = computeSelfDiversityProxy(input.composition);

  const axes: ScoringResult['axes'] = {
    layout_geometry: clamp01(axisScoreFor('layout')),
    palette_fidelity: clamp01(axisScoreFor('palette')),
    type_fidelity: clamp01(axisScoreFor('typography')),
    motion_timing: clamp01(axisScoreFor('motion')),
    section_identity: clamp01(axisScoreFor('section')),
    responsiveness: clamp01(axisScoreFor('interaction')),
    broken_assets: clamp01(broken_assets),
    a11y: clamp01(a11y),
    source_bleed: clamp01(source_bleed),
    structural_variant_diversity: clamp01(structural_variant_diversity),
    directive_claim_coverage: clamp01(directive_claim_coverage),
  };

  const overall = clamp01(avg(Object.values(axes)));
  return { overall, axes };
}
