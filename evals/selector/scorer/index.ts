// index.ts -- evals/selector/scorer entrypoint. scoreComposition(input)
// scores ONE composition (a candidate output for one corpus case) against
// the 11 axes named in the PRD (S7-3), returning {overall, axes} with every
// value a finite number in [0,1].
//
// v2 (deliverable-review fix round 1): both lanes' convergent finding was
// that v1's fidelity axes were provenance-MEMBERSHIP proxies -- resolving
// (nodeId, domPath, breakpoint) against a source's real captured data and
// stopping there, never reading what the composition actually claims was
// RENDERED (Sol-N1: "score docs-api-reference using its four IR provenance
// records as the composition, omit rendered-property evidence... returns
// overall 0.954545 with ten axes at 1.0"). Every fidelity axis below now
// reads real evidence FROM the composition (styleFingerprint, motionSignature)
// and compares it against the CLAIMED source's real captured computedStyle,
// not just checking that SOME real node resolves:
//
//   groundedness 2/1/0 (unchanged) -- still the base classification: does
//     (nodeId, domPath, breakpoint) resolve against the claimed source (2),
//     a DIFFERENT real source in the case (1), or nothing in the case (0).
//   evidenceFactor (NEW, per axis) -- given a resolved node, does the
//     composition's OWN claimed evidence (styleFingerprint for palette/type,
//     motionSignature for motion, the resolved node's own display/position
//     for layout/section) actually match reality? A resolved-but-unverified
//     claim (no styleFingerprint/motionSignature at all) is NOT scored the
//     same as a verified match -- see Sol-N2 on source-bleed.ts for the twin
//     fix. This is what lets a composition built from bare provenance
//     records (Sol-N1's repro) no longer default to 1.0 everywhere.
//
// directive_claim_coverage additionally now (Sol-N3/coordinator item 2):
// consumes resolve-conflicts.ts's output -- a claim resolve-conflicts.ts
// declares LOSING at a contested scope earns zero coverage credit for the
// losing source, regardless of how well it resolves, and every claim
// (winning or single-claimant) is weighted by its `strength` rather than
// counted 1-for-1 (Grok-N8: strength was parsed and then ignored).

import { buildSnapshotsBySource, loadCase, loadCaseIR, type CapturedNode } from './corpus-loader.ts';
import { scoreDiversity, type DiversityElement } from './diversity.ts';
import { resolveConflicts } from './resolve-conflicts.ts';
import { scoreSourceBleed, type BleedCompositionElement } from './source-bleed.ts';

export const SCORER_VERSION = '2.0.0';

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

// Strength-weighted average -- Grok-N8: directive `strength` is consumed,
// not stored and ignored. Falls back to a plain average when every weight
// is zero (degenerate input), never divides by zero.
function weightedAvg(pairs: ReadonlyArray<{ score: number; weight: number }>): number {
  const totalWeight = pairs.reduce((sum, p) => sum + Math.max(0, p.weight), 0);
  if (totalWeight <= 0) return avg(pairs.map((p) => p.score));
  return pairs.reduce((sum, p) => sum + p.score * Math.max(0, p.weight), 0) / totalWeight;
}

type Groundedness = 0 | 1 | 2;

interface GradedElement {
  el: CompositionElement;
  groundedness: Groundedness;
  // The node the element ACTUALLY resolves to (under its claimed source if
  // groundedness 2, under whichever other real source if groundedness 1,
  // undefined if groundedness 0) -- this is the "ground truth" evidenceFactor
  // formulas below compare the composition's claimed evidence against.
  resolvedNode: CapturedNode | undefined;
}

function groundScore(g: Groundedness): number {
  if (g === 2) return 1.0;
  if (g === 1) return 0.55;
  return 0.15;
}

function findNode(nodes: CapturedNode[], el: { nodeId: string; domPath: string; breakpoint: string }): CapturedNode | undefined {
  return nodes.find((n) => n.nodeId === el.nodeId && n.domPath === el.domPath && n.breakpoint === el.breakpoint);
}

function gradeComposition(composition: CompositionElement[], bySource: Record<string, CapturedNode[]>): GradedElement[] {
  return composition.map((el) => {
    const claimedNodes = bySource[el.sourceId] ?? [];
    const claimedMatch = findNode(claimedNodes, el);
    if (claimedMatch) return { el, groundedness: 2 as const, resolvedNode: claimedMatch };
    for (const [sourceId, nodes] of Object.entries(bySource)) {
      if (sourceId === el.sourceId) continue;
      const match = findNode(nodes, el);
      if (match) return { el, groundedness: 1 as const, resolvedNode: match };
    }
    return { el, groundedness: 0 as const, resolvedNode: undefined };
  });
}

// --- palette/type evidence: styleFingerprint format is "<color>|<backgroundColor>|<fontFamily>",
// the SAME convention verify-w7.ts's own styleFingerprintOf() and this
// corpus's snapshot data use (only present keys joined by "|", in that key
// order). Every corpus node carries all three keys, so a 3-part fingerprint
// is the expected shape; anything else (missing, or a different arity) is
// treated as unverifiable, per Sol-N2 -- never silently "clean".
function parseFingerprint(fp: string | undefined): { color: string | undefined; backgroundColor: string | undefined; fontFamily: string | undefined } | null {
  if (fp === undefined || fp.length === 0) return null;
  const parts = fp.split('|');
  if (parts.length !== 3) return null;
  return { color: parts[0], backgroundColor: parts[1], fontFamily: parts[2] };
}

const EVIDENCE_VERIFIED = 1.0;
// Calibrated (not arbitrary) so that groundScore(1) * EVIDENCE_UNVERIFIABLE
// clears floors.json's documented house-style floor of 0.35 for
// palette_fidelity/type_fidelity: "misattributed-but-real content is still
// genuinely captured page content ... stays >= 0.35" -- 0.55 * 0.7 = 0.385.
// Still well below EVIDENCE_VERIFIED (an omitted claim is never scored as if
// verified -- that was the whole point of Sol-N1/N2) and above
// EVIDENCE_MISMATCH (an omitted claim is not the same as a contradicted one).
const EVIDENCE_UNVERIFIABLE = 0.7; // claim present but no evidence to check it against, or evidence field omitted entirely
const EVIDENCE_MISMATCH = 0.25; // evidence present and contradicts the real captured data
const EVIDENCE_ABSENT_NODE = 0.1; // no resolved node at all (groundedness 0) -- nothing to verify against

function paletteEvidenceFactor(el: CompositionElement, node: CapturedNode | undefined): number {
  if (!node) return EVIDENCE_ABSENT_NODE;
  const parsed = parseFingerprint(el.styleFingerprint);
  if (!parsed) return EVIDENCE_UNVERIFIABLE;
  const realColor = node.computedStyle['color'];
  const realBg = node.computedStyle['backgroundColor'];
  if (parsed.color === realColor && parsed.backgroundColor === realBg) return EVIDENCE_VERIFIED;
  return EVIDENCE_MISMATCH;
}

function typeEvidenceFactor(el: CompositionElement, node: CapturedNode | undefined): number {
  if (!node) return EVIDENCE_ABSENT_NODE;
  const parsed = parseFingerprint(el.styleFingerprint);
  if (!parsed) return EVIDENCE_UNVERIFIABLE;
  const realFont = node.computedStyle['fontFamily'];
  if (parsed.fontFamily === realFont) return EVIDENCE_VERIFIED;
  return EVIDENCE_MISMATCH;
}

// Sol-N1: layout/section fidelity must read real display/position evidence,
// not just confirm SOME node resolved. A resolved node whose computedStyle
// carries no genuine layout-defining value (display or position, from the
// closed set real containers in this corpus use) is weak evidence even
// though it "resolved" -- e.g. a claim pointed at a plain content role
// instead of the case's actual layout container.
const LAYOUT_VALUES = new Set(['grid', 'flex', 'block']);
const POSITION_VALUES = new Set(['absolute', 'fixed', 'sticky']);
function layoutEvidenceFactor(node: CapturedNode | undefined): number {
  if (!node) return EVIDENCE_ABSENT_NODE;
  const display = node.computedStyle['display'];
  const position = node.computedStyle['position'];
  if ((display && LAYOUT_VALUES.has(display)) || (position && POSITION_VALUES.has(position))) return EVIDENCE_VERIFIED;
  return EVIDENCE_UNVERIFIABLE;
}

// Sol-N1/Grok-N1: motion_timing validates motionSignature against REAL
// snapshot-derived transition evidence -- the convention this corpus's
// generator uses is motionSignature === `transition:${transitionDuration}`
// for whichever node the claim resolves to. An arbitrary/unvalidated label
// (verify-w7.ts's own synthetic fixtures use fixed strings like
// "timeline-a"/"timeline-b"/"timeline-c", which validate against nothing)
// no longer scores as verified motion evidence -- that is the explicit
// point of this fix, not an oversight: "unvalidated free-form labels may
// not score."
function motionEvidenceFactor(el: CompositionElement, node: CapturedNode | undefined): number {
  if (!node) return EVIDENCE_ABSENT_NODE;
  if (el.motionSignature === undefined || el.motionSignature.length === 0) return EVIDENCE_MISMATCH;
  const realDuration = node.computedStyle['transitionDuration'];
  if (!realDuration) return EVIDENCE_UNVERIFIABLE; // claim made, but this node carries no transition evidence to check it against
  return el.motionSignature === `transition:${realDuration}` ? EVIDENCE_VERIFIED : EVIDENCE_MISMATCH;
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

function computeA11y(graded: GradedElement[]): number {
  const ratios: number[] = [];
  for (const g of graded) {
    const color = g.resolvedNode?.computedStyle['color'];
    const bg = g.resolvedNode?.computedStyle['backgroundColor'];
    if (!color || !bg) continue;
    const ratio = contrastRatio(color, bg);
    if (ratio === null) continue;
    ratios.push(clamp01(ratio / 4.5));
  }
  return ratios.length > 0 ? avg(ratios) : 0.7;
}

export function scoreComposition(input: ScoringInput, siblings?: CompositionElement[][]): ScoringResult {
  const c = loadCase(input.caseId);
  const bySource = buildSnapshotsBySource(c);
  const graded = gradeComposition(input.composition, bySource);
  const ir = loadCaseIR(c);

  // Sol-N3/coordinator item 2: consume resolveConflicts' output. A claim
  // resolve-conflicts.ts declares LOSING at a contested axis earns zero
  // directive_claim_coverage for the losing source -- the winner still can.
  // resolve-conflicts.ts's core grouping/selection algorithm is untouched
  // (dual-APPROVED under F4); this only reads its output.
  const conflictResult = resolveConflicts({ directives: ir.directives, conflictResolution: ir.conflictResolution });
  const losingClaimKeys = new Set(conflictResult.losingClaims.map((lc) => `${lc.axis}::${lc.losingSource}`));
  function isLosingClaim(claim: { axis: string; source: string }): boolean {
    return losingClaimKeys.has(`${claim.axis}::${claim.source}`);
  }

  // directive_claim_coverage -- every NON-LOSING IR claim must resolve to
  // attributed evidence at the CLAIMED source and CLAIMED scope
  // specifically, weighted by strength. A losing claim contributes ZERO
  // regardless of how well it resolves (it lost; the user's request was to
  // honor the WINNER at that scope) and does not count in the denominator
  // either -- coverage measures "were the claims that should have won,
  // honored," not "were all claims, including declared losers, honored."
  const coveragePairs: Array<{ score: number; weight: number }> = [];
  for (const claim of c.directiveInventory) {
    if (isLosingClaim(claim)) continue;
    const match = graded.find((g) => g.el.domPath === claim.scope && g.el.sourceId === claim.source);
    const hit = !!match && match.groundedness === 2;
    coveragePairs.push({ score: hit ? 1 : 0, weight: claim.strength });
  }
  const directive_claim_coverage = coveragePairs.length > 0 ? weightedAvg(coveragePairs) : graded.length > 0 ? avg(graded.map((g) => (g.groundedness === 2 ? 1 : 0))) : 0;

  // Per-axis fidelity: strength-weighted average of groundScore(groundedness)
  // * evidenceFactor(claim, resolvedNode) over every directiveInventory claim
  // on that axis (losing claims INCLUDED here -- a losing claim can still be
  // genuinely well-rendered; fidelity measures rendering quality, coverage
  // measures directive obedience, and conflating them was never the ask).
  // Falls back to a case-wide groundedness average when the case has no
  // claim on that axis at all.
  function axisScoreFor(axis: DirectiveAxis, evidenceFactor: (el: CompositionElement, node: CapturedNode | undefined) => number): number {
    const claims = c.directiveInventory.filter((d) => d.axis === axis);
    if (claims.length === 0) {
      return graded.length > 0 ? avg(graded.map((g) => groundScore(g.groundedness))) : 0.5;
    }
    const pairs = claims.map((claim) => {
      const match = graded.find((g) => g.el.domPath === claim.scope);
      const score = match ? groundScore(match.groundedness) * evidenceFactor(match.el, match.resolvedNode) : EVIDENCE_ABSENT_NODE;
      return { score: clamp01(score), weight: claim.strength };
    });
    return weightedAvg(pairs);
  }

  // Grok-N1: responsiveness is now ITS OWN measurement over per-breakpoint
  // evidence -- fraction of the case's declared breakpoints for which the
  // composition has at least one element that genuinely resolves (real
  // content, groundedness >= 1) AT that breakpoint. Previously this was
  // wired to axisScoreFor('interaction'), which measures interaction
  // directives, not viewport/breakpoint behavior -- a plain bug, not a
  // naming choice.
  function computeResponsiveness(): number {
    if (c.breakpoints.length === 0) return 0.5;
    const covered = c.breakpoints.filter((bp) => graded.some((g) => g.el.breakpoint === bp && g.groundedness >= 1));
    return covered.length / c.breakpoints.length;
  }

  const broken_assets = graded.length > 0 ? avg(graded.map((g) => (g.groundedness > 0 ? 1 : 0))) : 1;
  const a11y = computeA11y(graded);

  const sourceDomPaths: Record<string, string[]> = {};
  const sourceStyleFingerprints: Record<string, string[]> = {};
  for (const [sourceId, nodes] of Object.entries(bySource)) {
    sourceDomPaths[sourceId] = nodes.map((n) => n.domPath);
    const fps = new Set<string>();
    for (const n of nodes) {
      const parts = ['color', 'backgroundColor', 'fontFamily'].map((k) => n.computedStyle[k]).filter((v): v is string => typeof v === 'string' && v.length > 0);
      if (parts.length === 3) fps.add(parts.join('|'));
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

  // Grok-N2: structural_variant_diversity now calls the REAL pairwise trio
  // metric (diversity.ts's scoreDiversity), not a single-composition
  // richness proxy. scoreComposition only ever sees ONE composition unless
  // the caller supplies `siblings` (peer variants to compare against); with
  // no siblings, scoreDiversity([composition]) correctly returns 0 by
  // construction (its own <2-compositions early return) -- an honest "not
  // measured, no peers available," not a self-graded proxy score.
  const diversityElements: DiversityElement[] = input.composition.map((el) => {
    const out: DiversityElement = { elementId: el.elementId, domPath: el.domPath, breakpoint: el.breakpoint };
    if (el.motionSignature !== undefined) out.motionSignature = el.motionSignature;
    return out;
  });
  const siblingElements: DiversityElement[][] = (siblings ?? []).map((comp) =>
    comp.map((el) => {
      const out: DiversityElement = { elementId: el.elementId, domPath: el.domPath, breakpoint: el.breakpoint };
      if (el.motionSignature !== undefined) out.motionSignature = el.motionSignature;
      return out;
    }),
  );
  const structural_variant_diversity = scoreDiversity([diversityElements, ...siblingElements]).score;

  const axes: ScoringResult['axes'] = {
    layout_geometry: clamp01(axisScoreFor('layout', (_el, node) => layoutEvidenceFactor(node))),
    palette_fidelity: clamp01(axisScoreFor('palette', paletteEvidenceFactor)),
    type_fidelity: clamp01(axisScoreFor('typography', typeEvidenceFactor)),
    motion_timing: clamp01(axisScoreFor('motion', motionEvidenceFactor)),
    section_identity: clamp01(axisScoreFor('section', (_el, node) => layoutEvidenceFactor(node))),
    responsiveness: clamp01(computeResponsiveness()),
    broken_assets: clamp01(broken_assets),
    a11y: clamp01(a11y),
    source_bleed: clamp01(source_bleed),
    structural_variant_diversity: clamp01(structural_variant_diversity),
    directive_claim_coverage: clamp01(directive_claim_coverage),
  };

  const overall = clamp01(avg(Object.values(axes)));
  return { overall, axes };
}
