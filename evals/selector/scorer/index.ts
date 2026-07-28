// index.ts -- evals/selector/scorer entrypoint. scoreComposition(input)
// scores ONE composition (a candidate output for one corpus case) against
// the 11 axes named in the PRD (S7-3), returning {overall, axes} with every
// value a finite number in [0,1].
//
// v3 (deliverable-review fix round 2): round 1 made palette/type/motion
// genuinely evidence-gated (styleFingerprint/motionSignature required,
// verified against the resolved node) but Sol's round-2 re-review found the
// SAME provenance-membership bug still alive in the other five axes and in
// coverage itself:
//
//   F9 (coverage): "coverage awards a hit using only sourceId plus domPath.
//     It ignores claim axis, claim breakpoint, and whether the claimed
//     rendered property was realized; bare provenance and opposite-
//     breakpoint provenance both score directive_claim_coverage=1.0."
//   N1 (rendered evidence): "CompositionElement still has no rendered
//     geometry, asset, focus, or responsive-behavior evidence. Layout/
//     section read the resolved source snapshot; responsiveness counts
//     breakpoint presence; broken_assets is groundedness; a11y reads source
//     colors. Bare docs-api-reference provenance scores 0.7909 overall with
//     those axes at 1.0."
//   N4/constraints_unscored: "findNode ignores captured state, coverage
//     ignores directive breakpoint, resolve-conflicts.ts groups solely by
//     axis and ignores scopeOverlap, constraints are not loaded or
//     evaluated."
//
// Fixes, all keyed off ONE new concept -- hasSelfReportedEvidence(el):
// does the composition element carry ANY of the two fields it is actually
// able to self-report (styleFingerprint, motionSignature)? A bare-IR-
// provenance dump (elementId/sourceId/nodeId/domPath/breakpoint only, no
// self-report at all) has hasSelfReportedEvidence=false for every element --
// this is the single, high-signal distinguishing test between "a real
// composition attempt, however imperfect" and "citing the IR back at
// itself." verify-w7.ts's own sealed fixture builders (faithfulComposition/
// houseStyleComposition) always set motionSignature, so this gate does not
// move their scores -- only a genuinely evidence-free composition is
// affected.
//
//   1. layout_geometry / section_identity / responsiveness / broken_assets /
//      a11y now ALL require hasSelfReportedEvidence before counting ANY
//      resolved-node evidence as verified -- a bare-provenance element
//      contributes the near-zero "absent" tier on every one of these axes,
//      regardless of groundedness. (a11y additionally requires the
//      self-report to specifically be a verified styleFingerprint, since
//      color evidence has nowhere else to live -- motionSignature alone does
//      not unlock a11y.)
//   2. layout_geometry / section_identity / responsiveness now evaluate the
//      case's OWN IR constraints (grid-integrity / responsive-behavior
//      predicates) via regex against the resolved node's real computedStyle,
//      instead of a hardcoded allowed-value set -- constraints loaded AND
//      evaluated, not dead weight (Grok constraints_unscored). a11y
//      evaluates the contrast-minimum predicate against the COMPOSITION's
//      own claimed fingerprint color.
//   3. section_identity is state-aware (Sol-N4): distinct from
//      layout_geometry in that it additionally rewards a genuine
//      'scrolled'-state sibling capture at the same domPath -- a real
//      section is state-differentiated, a generic layout container is not.
//   4. directive_claim_coverage now requires claim-breakpoint match (not
//      just domPath+source) AND the claim's own axis-specific evidence to
//      be VERIFIED (not merely resolved) -- closes both of Sol's repros:
//      bare provenance (nothing verifies) and opposite-breakpoint
//      provenance (breakpoint mismatch) no longer score 1.0.
//
// v3.1 (independent-audit + gate-amendment remediation round, round 3):
// round 2's coverage/axisRealized carried two documented compromises,
// BOTH forced by sealed-harness quirks the gate amendment (verify-w7.ts
// commit 76f493f59) has since fixed at the root: findRealNode() now
// PREFERS the claim's own breakpoint, and faithfulComposition()/
// houseStyleComposition() now emit a REAL styleFingerprint (built from the
// resolved node's own captured computedStyle) alongside a real
// motionSignature. With both root causes fixed, both compromises are
// removed: BREAKPOINT_MISMATCH_CREDIT (a 0.3 partial credit for a
// wrong-breakpoint citation) is gone -- breakpoint mismatch is now a hard
// coverage veto (score 0); axisRealized's palette/typography check is
// tightened from "not an active contradiction" back to "=== VERIFIED",
// uniformly with every other axis.
//
// v3.2 (deliverable-review fix round 4, F9/N4 re-review -- final authorized
// round, decision-round tiebreaker): round 3's generic hasSelfReportedEvidence
// gate (EITHER styleFingerprint OR motionSignature) was itself axis-agnostic
// -- Sol's exact repro: "arbitrary non-empty motionSignature on real docs
// provenance clears directive_claim_coverage at 0.707 without style
// evidence." Removed; each axis now gates on the evidence KIND it actually
// needs (hasStyleEvidence for layout_geometry/section_identity/
// responsiveness/interaction; motion_timing and palette/typography already
// gated on their own dedicated field directly, unaffected; broken_assets
// requires genuinely VERIFIED evidence in either field, not just presence --
// see hasVerifiedEvidence). resolve-conflicts.ts's grouping now consults
// ir.conflictResolution[].scopeOverlap as the PRIMARY signal (was previously
// declared in the IR but never read, approximated instead via an independent
// role-key string heuristic). findNode requires an EXPLICIT
// CANONICAL_EVIDENCE_STATE ('default') match, not just an implicit
// consequence of nodeId's own naming convention -- a real hover/scrolled-
// state node's own nodeId no longer resolves as equivalent evidence to the
// claim's genuine default-state capture.
//
// v3.3 (founder-authorized F9 micro-round, post-decision-round): round 4's
// hasStyleEvidence gate narrowed the evidence KIND correctly (styleFingerprint,
// not motionSignature) but still only checked PRESENCE -- Sol's binding
// REJECT: "styleFingerprint:'x' on real provenance restores exact
// 0.7073170731707317 coverage; hasStyleEvidence checks presence, not
// verification" and "N1 STILL-OPEN: arbitrary non-empty styleFingerprint
// unlocks layout_geometry=1, section_identity=1, and responsiveness=1
// without verified style evidence." hasStyleEvidence removed; every axis
// that gated on it (layout_geometry, section_identity, responsiveness,
// interaction, and coverage's axisRealized dispatch for those axes) now
// gates on hasVerifiedStyleEvidence, which reuses the EXISTING real-evidence
// VERIFIED machinery (paletteEvidenceFactor/typeEvidenceFactor -- the same
// functions palette_fidelity/type_fidelity already verify against) rather
// than a parallel mechanism: the claimed styleFingerprint must genuinely
// match the resolved node's real captured computedStyle. An arbitrary/
// unparseable/mismatched fingerprint (e.g. "x") no longer unlocks anything.
//
// v3.3.1 (founder-authorized F9 micro-round, Sol HIGH REJECT of v3.3): the
// v3.3 hasVerifiedStyleEvidence used OR (palette VERIFIED OR type VERIFIED)
// -- a PARTIAL-fingerprint check. Sol's repro: real font + forged colors, or
// real colors + forged font, each independently restored the exploit (one
// verified component was enough; the OTHER half of the fingerprint was
// silently forged and never checked). Changed OR to AND -- both components
// must independently verify, equivalent to full-fingerprint equality against
// real evidence. Every call site inherits this automatically (none
// re-implement verification; they all call hasVerifiedStyleEvidence itself).
//
// v2 (deliverable-review fix round 1, carried forward): groundedness 2/1/0
// classification; palette/type/motion evidence-gated against
// styleFingerprint/motionSignature; strength-weighted, conflict-aware
// coverage (resolve-conflicts.ts's core selection logic untouched, per the
// dual-APPROVED F4 constraint); structural_variant_diversity wired to the
// real diversity.ts pairwise metric.

import { buildSnapshotsBySource, loadCase, loadCaseIR, type CapturedNode, type CaseConstraint } from './corpus-loader.ts';
import { scoreDiversity, type DiversityElement } from './diversity.ts';
import { resolveConflicts } from './resolve-conflicts.ts';
import { scoreSourceBleed, type BleedCompositionElement } from './source-bleed.ts';

export const SCORER_VERSION = '3.3.1';

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

// Sol-N4 (round 4): "state is not explicitly matched." CompositionElement has
// no state field (the sealed blindInput() shape doesn't carry one -- see
// CompositionElement above), so a composition can only ever cite a node's
// identity via (nodeId, domPath, breakpoint). Before this fix, findNode
// resolved purely on those three fields and never referenced
// CapturedNode.state at all, even though every v3+ node carries one and this
// corpus's own evidencePointers (generate-corpus.ts) record it explicitly
// (`<domPath>@<breakpoint>@<state>`). That left state-matching IMPLICIT --
// accidentally correct only because nodeId happens to embed the state as a
// naming-convention suffix (e.g. "-hover"/"-default"/"-scrolled"), never
// verified as a real constraint. CANONICAL_EVIDENCE_STATE makes it explicit:
// a claim's evidence must resolve against the node's 'default' capture --
// the ONE state every real corpus node has, and the state
// generate-corpus.ts's own provenance construction exclusively uses (see
// `n.state === 'default'` there). A composition that cites a real,
// self-consistent HOVER- or SCROLLED-state node's own nodeId (instead of the
// same domPath+breakpoint's 'default' capture) no longer resolves at all --
// that specific node genuinely exists, but not in the state this resolution
// path requires, so it must not be credited as equivalent to a genuine
// default-state citation.
const CANONICAL_EVIDENCE_STATE = 'default';

function findNode(nodes: CapturedNode[], el: { nodeId: string; domPath: string; breakpoint: string }, expectedState: string = CANONICAL_EVIDENCE_STATE): CapturedNode | undefined {
  return nodes.find((n) => n.nodeId === el.nodeId && n.domPath === el.domPath && n.breakpoint === el.breakpoint && n.state === expectedState);
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
const EVIDENCE_ABSENT_NODE = 0.1; // no resolved node, or no self-reported evidence at all -- nothing to verify against

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

// Round 4: broken_assets' "specific kind" (per the fix scope: "broken_assets/
// a11y -> their specific kinds") isn't ONE dedicated field the way palette/
// type/motion are -- asset integrity is demonstrated by EITHER a genuinely
// VERIFIED style fingerprint OR a genuinely VERIFIED motion signature,
// whichever the element actually carries. Critically this requires
// VERIFICATION, not mere presence: an arbitrary/unverified value in either
// field no longer counts (closing the same class of gap Sol's coverage
// repro exposed -- an unverified label must not unlock an unrelated axis).
function hasVerifiedEvidence(el: CompositionElement, node: CapturedNode | undefined): boolean {
  return paletteEvidenceFactor(el, node) === EVIDENCE_VERIFIED || motionEvidenceFactor(el, node) === EVIDENCE_VERIFIED;
}

// v3.3 (founder-authorized F9 micro-round): round 4's hasStyleEvidence gate
// (isNonEmpty(el.styleFingerprint)) checked PRESENCE, not verification. Sol's
// binding REJECT: "styleFingerprint:'x' on real provenance restores exact
// 0.7073170731707317 coverage; hasStyleEvidence checks presence, not
// verification" and "N1 STILL-OPEN: arbitrary non-empty styleFingerprint
// unlocks layout_geometry=1, section_identity=1, and responsiveness=1
// without verified style evidence." hasStyleEvidence is REMOVED (along with
// its own isNonEmpty helper, now unused). hasVerifiedStyleEvidence replaces
// it everywhere layout_geometry/section_identity/responsiveness/interaction
// (and coverage's axisRealized dispatch for those axes) previously gated on
// mere presence -- it reuses the EXACT SAME real-evidence VERIFIED machinery
// palette/typography already use (paletteEvidenceFactor/typeEvidenceFactor,
// both of which parse the claimed styleFingerprint and compare it against
// the resolved node's REAL captured computedStyle), rather than inventing a
// parallel verification mechanism.
//
// v3.3.1 (founder-authorized F9 micro-round, Sol HIGH REJECT of the v3.3
// fix): the FIRST v3.3 draft used OR (palette VERIFIED OR type VERIFIED),
// which is a PARTIAL-fingerprint check, not a full one -- Sol's exact repro:
// "Real font + forged colors restored layout_geometry=1, section_identity=1,
// responsiveness=1, and exact coverage 0.7073170731707317. Real colors +
// forged font produced all three axes at 1 and coverage 1." A single
// genuinely-matching component (either half of the 3-part fingerprint) was
// enough to satisfy OR while the OTHER half was silently forged --
// "a lazy single-field forgery, not deliberate multi-step evasion," per
// Sol's own characterization, but still exploitable. Changed OR to AND: the
// claimed styleFingerprint only counts once BOTH the palette component
// (color+backgroundColor) AND the typography component (fontFamily)
// independently verify against the resolved node's real captured
// computedStyle -- equivalent to full-fingerprint equality against real
// evidence, since parseFingerprint already requires the exact 3-part shape.
// Every call site (layoutEvidenceFactor, sectionEvidenceFactor,
// axisRealized's 'interaction' case via axisScoreFor's gate parameter,
// computeResponsiveness) inherits the tightened gate automatically, since
// none of them re-implement verification -- they all call
// hasVerifiedStyleEvidence itself.
function hasVerifiedStyleEvidence(el: CompositionElement, node: CapturedNode | undefined): boolean {
  return paletteEvidenceFactor(el, node) === EVIDENCE_VERIFIED && typeEvidenceFactor(el, node) === EVIDENCE_VERIFIED;
}

// Grok constraints_unscored / Sol-N4 (deliverable-review fix round 2):
// constraints were generated per case but never loaded or evaluated by
// anything -- dead weight. constraintMatches evaluates a real IR constraint
// predicate (regex `pattern` against `computedStyle[property]`) against a
// resolved node, replacing round 1's hardcoded LAYOUT_VALUES/POSITION_VALUES
// allowed-set with the case's OWN declared rule.
function findConstraint(constraints: CaseConstraint[] | undefined, typeSuffix: string): CaseConstraint | undefined {
  return constraints?.find((c) => c.type.endsWith(typeSuffix));
}
function constraintMatches(computedStyle: Record<string, string> | undefined, predicate: { property: string; pattern: string } | undefined): boolean {
  if (!computedStyle || !predicate) return false;
  const value = computedStyle[predicate.property];
  if (value === undefined) return false;
  try {
    return new RegExp(predicate.pattern).test(value);
  } catch {
    return false;
  }
}

// N1 (deliverable-review fix round 2, TIGHTENED round 4, VERIFIED round 4.1
// F9 micro-round): layout_geometry requires evidence -- Sol's original repro
// was bare IR provenance (no styleFingerprint/motionSignature at all)
// scoring layout_geometry=1.0 purely because the resolved SOURCE node
// happened to be a real container. Round 2/3 gated on
// hasSelfReportedEvidence (EITHER field); round 4 narrowed that to
// hasStyleEvidence (styleFingerprint specifically, since motionSignature has
// nothing to do with geometry) but that gate still checked mere PRESENCE --
// Sol's round-4.1 REJECT: "styleFingerprint:'x' on real provenance restores
// exact 0.7073170731707317 coverage; hasStyleEvidence checks presence, not
// verification." Gates on hasVerifiedStyleEvidence now -- the claimed
// styleFingerprint must genuinely match the resolved node's real captured
// computedStyle (color+backgroundColor or fontFamily), not merely be
// non-empty. When evidence IS verified, the case's own grid-integrity
// constraint predicate is evaluated against the resolved node (replacing
// round 1's hardcoded allowed-value set).
function layoutEvidenceFactor(el: CompositionElement, node: CapturedNode | undefined, gridConstraint: CaseConstraint | undefined): number {
  if (!node) return EVIDENCE_ABSENT_NODE;
  if (!hasVerifiedStyleEvidence(el, node)) return EVIDENCE_ABSENT_NODE;
  return constraintMatches(node.computedStyle, gridConstraint?.predicate) ? EVIDENCE_VERIFIED : EVIDENCE_UNVERIFIABLE;
}

// Sol-N4 (deliverable-review fix round 2): section_identity is now STATE-
// AWARE and genuinely distinct from layout_geometry (round 1 reused the
// exact same function for both axes). A real "section" is additionally
// state-differentiated -- it has a genuine 'scrolled'-state capture at the
// same domPath (this corpus's real scroll-lock pattern; see
// generate-corpus.ts's buildSourceNodes) -- while a generic layout container
// claim does not need one. Same hasVerifiedStyleEvidence gate as layout
// (round 4.1 F9 micro-round -- see layoutEvidenceFactor's comment for why
// mere presence no longer qualifies).
function sectionEvidenceFactor(el: CompositionElement, node: CapturedNode | undefined, gridConstraint: CaseConstraint | undefined, bySource: Record<string, CapturedNode[]>): number {
  if (!node) return EVIDENCE_ABSENT_NODE;
  if (!hasVerifiedStyleEvidence(el, node)) return EVIDENCE_ABSENT_NODE;
  const constraintOk = constraintMatches(node.computedStyle, gridConstraint?.predicate);
  if (!constraintOk) return EVIDENCE_MISMATCH;
  const hasScrolledSibling = (bySource[el.sourceId] ?? []).some((n) => n.domPath === node.domPath && n.breakpoint === node.breakpoint && n.state === 'scrolled');
  return hasScrolledSibling ? EVIDENCE_VERIFIED : EVIDENCE_UNVERIFIABLE;
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

// N1 (deliverable-review fix round 2): a11y previously read the RESOLVED
// SOURCE's own captured colors -- Sol's repro scored a11y=1.0 for bare
// provenance purely because the cited real node happened to have decent
// contrast, regardless of anything the composition itself claims to have
// rendered. a11y now scores the COMPOSITION's OWN claimed styleFingerprint
// color pair (contrast-minimum constraint evaluated against the CLAIMED
// color, not the source's) -- motionSignature alone does not unlock this
// axis, since color evidence has nowhere else to live. No verified color
// evidence anywhere in the composition -> near-zero default, not the old
// neutral 0.7.
function computeA11y(graded: GradedElement[], contrastConstraint: CaseConstraint | undefined): number {
  const ratios: number[] = [];
  for (const g of graded) {
    const parsed = parseFingerprint(g.el.styleFingerprint);
    if (!parsed || !parsed.color || !parsed.backgroundColor) continue;
    if (contrastConstraint?.predicate && !constraintMatches({ [contrastConstraint.predicate.property]: parsed.color }, contrastConstraint.predicate)) continue;
    const ratio = contrastRatio(parsed.color, parsed.backgroundColor);
    if (ratio === null) continue;
    ratios.push(clamp01(ratio / 4.5));
  }
  return ratios.length > 0 ? avg(ratios) : 0.15;
}

export function scoreComposition(input: ScoringInput, siblings?: CompositionElement[][]): ScoringResult {
  const c = loadCase(input.caseId);
  const bySource = buildSnapshotsBySource(c);
  const graded = gradeComposition(input.composition, bySource);
  const ir = loadCaseIR(c);

  // Grok constraints_unscored: load once per call, looked up by rule-type
  // suffix (stable across cases -- every case's constraints array follows
  // the same generate-corpus.ts convention: #grid-integrity,
  // #contrast-minimum, #responsive-behavior).
  const gridConstraint = findConstraint(ir.constraints, '#grid-integrity');
  const contrastConstraint = findConstraint(ir.constraints, '#contrast-minimum');
  const responsiveConstraint = findConstraint(ir.constraints, '#responsive-behavior');

  // Sol-N3/coordinator item 2 (round 1): consume resolveConflicts' output. A
  // claim resolve-conflicts.ts declares LOSING at a contested scope earns
  // zero directive_claim_coverage for the losing source -- the winner still
  // can. resolve-conflicts.ts's core grouping/selection algorithm is
  // untouched by this file (round 2 made it scopeOverlap/role-key-aware,
  // Sol-N4, but that change lives entirely in resolve-conflicts.ts); this
  // only reads its output.
  const conflictResult = resolveConflicts({ directives: ir.directives, conflictResolution: ir.conflictResolution });
  const losingClaimKeys = new Set(conflictResult.losingClaims.map((lc) => `${lc.axis}::${lc.losingSource}`));
  function isLosingClaim(claim: { axis: string; source: string }): boolean {
    return losingClaimKeys.has(`${claim.axis}::${claim.source}`);
  }

  // Per-axis "was this claim's rendered property actually realized"
  // dispatcher -- Sol-N9 (F9): coverage must require MORE than domPath+
  // sourceId membership; it must require the axis-specific evidence to be
  // genuinely VERIFIED (not merely resolved). Reuses the exact same evidence
  // functions the fidelity axes below are built from, so "realized" means
  // the identical thing in both places.
  //
  // Round 3 (gate-amendment enabling item): palette/typography previously
  // used a deliberately looser bar here ("not an active contradiction"
  // rather than "=== VERIFIED"), documented as a bounded compromise forced
  // by the sealed verify-w7.ts's faithfulComposition()/houseStyleComposition()
  // never setting styleFingerprint. The gate amendment (commit 76f493f59)
  // fixed that root cause -- both builders now emit a REAL styleFingerprint
  // (styleFingerprintOf, built from the resolved node's own captured
  // computedStyle) alongside a real motionSignature. The relaxation is no
  // longer needed and is removed: every axis now requires "=== VERIFIED",
  // uniformly.
  function axisRealized(axis: string, el: CompositionElement, node: CapturedNode | undefined): boolean {
    switch (axis) {
      case 'palette':
        return paletteEvidenceFactor(el, node) === EVIDENCE_VERIFIED;
      case 'typography':
        return typeEvidenceFactor(el, node) === EVIDENCE_VERIFIED;
      case 'motion':
        return motionEvidenceFactor(el, node) === EVIDENCE_VERIFIED;
      case 'layout':
        return layoutEvidenceFactor(el, node, gridConstraint) === EVIDENCE_VERIFIED;
      case 'section':
        return sectionEvidenceFactor(el, node, gridConstraint, bySource) === EVIDENCE_VERIFIED;
      case 'interaction':
        // 'interaction' maps to the responsiveness scorer axis
        // (DIRECTIVE_AXIS_TO_SCORER_AXIS) -- per-breakpoint rendered
        // evidence, same evidence kind as layout_geometry (round 4.1 F9
        // micro-round: gates on hasVerifiedStyleEvidence, not mere presence).
        return hasVerifiedStyleEvidence(el, node) && !!node && constraintMatches(node.computedStyle, responsiveConstraint?.predicate);
      default:
        return false;
    }
  }

  // directive_claim_coverage -- every NON-LOSING IR claim must resolve to
  // attributed evidence at the CLAIMED source, CLAIMED scope, AND CLAIMED
  // BREAKPOINT, AND the claim's own axis-specific rendered property must be
  // genuinely VERIFIED, not merely resolved (Sol-N9: "bare provenance scores
  // 1.0" / "opposite-breakpoint provenance scores 1.0" -- resolution alone
  // is no longer sufficient, and a wrong-breakpoint citation is no longer
  // partial-credited). Weighted by strength. A losing claim contributes
  // ZERO regardless of how well it resolves (it lost; the user's request
  // was to honor the WINNER at that scope) and does not count in the
  // denominator either -- coverage measures "were the claims that should
  // have won, honored," not "were all claims, including declared losers,
  // honored."
  //
  // Round 3 (gate-amendment enabling item): breakpoint mismatch is now a
  // HARD veto (score 0), not a discount (previously
  // BREAKPOINT_MISMATCH_CREDIT=0.3). The discount existed only because the
  // sealed faithfulComposition() resolved every element's breakpoint via
  // "first breakpoint where the domPath happens to be captured," ignoring
  // directiveInventory's own breakpoint field -- an exact-match veto drove
  // the sealed harness's own honest "faithful" control below the coverage
  // floor. The gate amendment (commit 76f493f59) fixed the root cause:
  // findRealNode() now PREFERS the claim's own breakpoint field. The
  // compromise is no longer needed.
  const coveragePairs: Array<{ score: number; weight: number }> = [];
  for (const claim of c.directiveInventory) {
    if (isLosingClaim(claim)) continue;
    const match = graded.find((g) => g.el.domPath === claim.scope && g.el.sourceId === claim.source && (claim.breakpoint === undefined || g.el.breakpoint === claim.breakpoint));
    const hit = !!match && match.groundedness === 2 && axisRealized(claim.axis, match.el, match.resolvedNode);
    coveragePairs.push({ score: hit ? 1 : 0, weight: claim.strength });
  }
  const directive_claim_coverage = coveragePairs.length > 0 ? weightedAvg(coveragePairs) : graded.length > 0 ? avg(graded.map((g) => (g.groundedness === 2 ? 1 : 0))) : 0;

  // Per-axis fidelity: strength-weighted average of groundScore(groundedness)
  // * evidenceFactor(claim, resolvedNode) over every directiveInventory claim
  // on that axis (losing claims INCLUDED here -- a losing claim can still be
  // genuinely well-rendered; fidelity measures rendering quality, coverage
  // measures directive obedience, and conflating them was never the ask).
  // Falls back to a case-wide groundedness average when the case has no
  // claim on that axis at all -- gated by the SAME axis-specific evidence
  // predicate the axis's own evidenceFactor uses (round 4.1 F9 micro-round:
  // the caller passes hasVerifiedStyleEvidence for layout/section, which
  // needs the resolved node, not just the element, to verify against), so a
  // bare-provenance OR arbitrary-non-empty-fingerprint composition doesn't
  // get a free pass on axes the case happens not to have a claim for, via a
  // field that axis doesn't even use.
  function axisScoreFor(axis: DirectiveAxis, evidenceFactor: (el: CompositionElement, node: CapturedNode | undefined) => number, gate?: (el: CompositionElement, node: CapturedNode | undefined) => boolean): number {
    const claims = c.directiveInventory.filter((d) => d.axis === axis);
    if (claims.length === 0) {
      const pool = gate ? graded.filter((g) => gate(g.el, g.resolvedNode)) : graded;
      return pool.length > 0 ? avg(pool.map((g) => groundScore(g.groundedness))) : gate ? 0.15 : 0.5;
    }
    const pairs = claims.map((claim) => {
      const match = graded.find((g) => g.el.domPath === claim.scope);
      const score = match ? groundScore(match.groundedness) * evidenceFactor(match.el, match.resolvedNode) : EVIDENCE_ABSENT_NODE;
      return { score: clamp01(score), weight: claim.strength };
    });
    return weightedAvg(pairs);
  }

  // N1 (deliverable-review fix round 2, TIGHTENED round 4, VERIFIED round 4.1
  // F9 micro-round): responsiveness requires "per-breakpoint rendered
  // evidence" and evaluates the case's OWN responsive-behavior constraint
  // against the resolved node at each breakpoint, instead of counting mere
  // breakpoint-tag presence. Responsiveness is fundamentally about whether
  // LAYOUT genuinely differs per breakpoint, so it gates on the same
  // evidence kind as layout_geometry (hasVerifiedStyleEvidence) -- an
  // arbitrary/unverified styleFingerprint (irrelevant, since it doesn't
  // genuinely match the resolved node) no longer unlocks this axis either. A
  // bare-provenance OR unverified-fingerprint composition contributes 0
  // coverage for every breakpoint.
  function computeResponsiveness(): number {
    if (c.breakpoints.length === 0) return 0.5;
    let covered = 0;
    for (const bp of c.breakpoints) {
      const ok = graded.some((g) => g.el.breakpoint === bp && g.groundedness >= 1 && hasVerifiedStyleEvidence(g.el, g.resolvedNode) && constraintMatches(g.resolvedNode?.computedStyle, responsiveConstraint?.predicate));
      if (ok) covered++;
    }
    return covered / c.breakpoints.length;
  }

  // N1 (round 2, TIGHTENED round 4): broken_assets requires
  // hasVerifiedEvidence -- mere resolution (groundedness > 0) is real-node
  // membership, not proof the composition rendered a genuine, verifiable
  // asset, and (round 4) an UNVERIFIED/arbitrary self-report doesn't prove
  // it either -- only a genuinely VERIFIED palette or motion evidence factor
  // counts (broken_assets' "specific kind" is EITHER, verified; see
  // hasVerifiedEvidence's own comment).
  const broken_assets = graded.length > 0 ? avg(graded.map((g) => (g.groundedness > 0 && hasVerifiedEvidence(g.el, g.resolvedNode) ? 1 : 0))) : 1;
  const a11y = computeA11y(graded, contrastConstraint);

  const sourceDomPaths: Record<string, string[]> = {};
  const sourceStyleFingerprints: Record<string, string[]> = {};
  // Sol-N2 (round 2): region-bound bleed mapping -- sourceId -> domPath ->
  // the fingerprint that source genuinely renders AT that specific domPath,
  // so scoreSourceBleed can require a match at the CLAIMED region, not just
  // source-wide membership.
  const sourceRegionFingerprints: Record<string, Record<string, string>> = {};
  for (const [sourceId, nodes] of Object.entries(bySource)) {
    sourceDomPaths[sourceId] = nodes.map((n) => n.domPath);
    const fps = new Set<string>();
    const regionMap: Record<string, string> = {};
    for (const n of nodes) {
      const parts = ['color', 'backgroundColor', 'fontFamily'].map((k) => n.computedStyle[k]).filter((v): v is string => typeof v === 'string' && v.length > 0);
      if (parts.length === 3) {
        const fp = parts.join('|');
        fps.add(fp);
        regionMap[n.domPath] = fp;
      }
    }
    sourceStyleFingerprints[sourceId] = [...fps];
    sourceRegionFingerprints[sourceId] = regionMap;
  }
  const bleedInput: BleedCompositionElement[] = input.composition.map((el) => {
    const out: BleedCompositionElement = { elementId: el.elementId, sourceId: el.sourceId, domPath: el.domPath };
    if (el.styleFingerprint !== undefined) out.styleFingerprint = el.styleFingerprint;
    return out;
  });
  const bleedResult = scoreSourceBleed({ composition: bleedInput, sourceDomPaths, sourceStyleFingerprints, sourceRegionFingerprints });
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
    layout_geometry: clamp01(axisScoreFor('layout', (el, node) => layoutEvidenceFactor(el, node, gridConstraint), hasVerifiedStyleEvidence)),
    palette_fidelity: clamp01(axisScoreFor('palette', paletteEvidenceFactor)),
    type_fidelity: clamp01(axisScoreFor('typography', typeEvidenceFactor)),
    motion_timing: clamp01(axisScoreFor('motion', motionEvidenceFactor)),
    section_identity: clamp01(axisScoreFor('section', (el, node) => sectionEvidenceFactor(el, node, gridConstraint, bySource), hasVerifiedStyleEvidence)),
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
