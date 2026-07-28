// parser.ts -- stub NL -> IR parser interface (S7-4/C7-14).
//
// This is a TYPED INTERFACE STUB, not an implementation: S7-4 requires "a
// stub parser interface" alongside the frozen goldens (goldens.json) so a
// later implementer (W8) has a single, real call signature to build against
// instead of inventing one from scratch. The interface is load-bearing --
// exactly one call signature, non-"any" parameter and return types, a
// return type that genuinely matches the committed IR schema -- even though
// the body is not implemented yet.
//
// Deliberately not implemented here: turning free-text English into a
// well-formed IR (axis/source/scope disambiguation, source-name resolution,
// strength inference) is real NLP work with its own test surface, out of
// scope for this wave's spec-and-grader deliverable. See
// docs/specs/selector-feasibility-spike.md for a hand-authored, real,
// end-to-end IR instance proving the SCHEMA itself is expressive enough --
// this file is the parser CONTRACT that a real implementation must satisfy,
// not that implementation.

export type DirectiveAxis = 'layout' | 'motion' | 'palette' | 'typography' | 'section' | 'interaction';

export interface DirectiveClaim {
  axis: DirectiveAxis;
  source: string;
  scope: string;
  strength: number;
}

export interface SourceSlot {
  id: string;
  breakpoints: string[];
  evidencePointers: string[];
}

export interface Constraint {
  type: string;
  rule: string;
}

export interface ConflictResolutionRecord {
  axis: string;
  winningSource: string;
  losingSource?: string;
  losingClaim?: string;
  rationale?: string;
}

export interface ProvenanceEntry {
  elementId: string;
  sourceId: string;
  nodeId: string;
  domPath: string;
  breakpoint: string;
}

export interface VariantAxis {
  name: string;
  distanceMetric: string;
}

export interface CompositionIR {
  sourceSlots: SourceSlot[];
  directives: DirectiveClaim[];
  constraints: Constraint[];
  conflictResolution: ConflictResolutionRecord[];
  provenance: ProvenanceEntry[];
  variantAxes: VariantAxis[];
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

/**
 * Parse a natural-language directive brief into a CompositionIR instance.
 *
 * NOT IMPLEMENTED: this is the frozen call signature (S7-4) a real NL->IR
 * parser must satisfy. evals/selector/nl-to-ir/goldens.json is the frozen
 * set of (nlDirective, expectedIR fragment) pairs a real implementation
 * must reproduce.
 */
export function parse(input: string): CompositionIR {
  throw new NotImplementedError(`parse() is not implemented yet -- stub interface only (S7-4). Received input of length ${input.length}.`);
}
