// Routing policy document contract (WR wave, P0 skeleton -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.2 L2, PRD §15).
//
// This is the DTO shape only. `apps/daemon/src/routing/routing-policy.json`
// (P0) ships a minimal empty-but-typed stub against this shape; the real
// model table, hard constraints, and the drift-failing policy test land in
// a later WR tranche -- see docs/plans/waves/WR-routing.md's Tranche
// register (CWR-P1-1).

/** One row of the §2 model table, keyed by task class. */
export interface RoutingPolicyModelTableEntry {
  taskClass: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh';
  lane: string;
}

/** A priced model, carried with the effective date it started applying --
 * plan §3.2 L2: "Both Sonnet prices carried with an effective date." */
export interface RoutingPolicyPriceRow {
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  /** ISO 8601 date the price took effect. */
  effectiveDate: string;
}

/** Data classification is part of the policy (plan §3.2 L2, Sol v2-HIGH-1):
 * every dispatch carries a sensitivity class, and each class has a provider
 * allowlist. Fallback for an exhausted class is fail-closed by construction
 * (see RoutingAdmissionVerdict in routing-decision.ts) -- never expressed
 * here as a "next allowed lane" field. */
export interface RoutingPolicyDataClassAllowlist {
  classification: 'client-confidential' | 'internal' | 'public';
  allowedLanes: string[];
}

/** A hard rule the drift-failing policy test enforces (plan §3.2 L2's
 * `check-context-isolation`-style test) -- e.g. PRD §15's "no Anthropic
 * model may use API credits, Nous, or OpenRouter for this program." */
export interface RoutingPolicyHardConstraint {
  id: string;
  description: string;
}

export interface RoutingPolicyDocument {
  /** Bumped on every policy revision; carried through to every
   * RoutingDecision/telemetry row so a dispatch is traceable to the policy
   * that produced it. */
  policyVersion: number;
  modelTable: RoutingPolicyModelTableEntry[];
  hardConstraints: RoutingPolicyHardConstraint[];
  /** Per-runtime fallback chain (plan §3.2 L1), keyed by lane id. */
  laneChains: Record<string, string[]>;
  dataClassificationAllowlists: RoutingPolicyDataClassAllowlist[];
  /**
   * Both Sonnet price rows (current + the post-2026-08-31 price), each with
   * its own effective date. A later tranche's drift test is the place that
   * enforces "exactly two, in effective-date order" -- this type stays a
   * plain array so the P0 stub can ship empty-but-typed (t3 fills content).
   */
  sonnetPriceRows: RoutingPolicyPriceRow[];
}

function isRoutingPolicyPriceRow(value: unknown): value is RoutingPolicyPriceRow {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.model === 'string' &&
    typeof row.inputPerMillion === 'number' &&
    typeof row.outputPerMillion === 'number' &&
    typeof row.effectiveDate === 'string'
  );
}

/** Structural shape guard for a loaded `routing-policy.json` -- checks every
 * top-level field is present with the right container type. Does not
 * validate model-table/constraint *content*; that is the later drift-failing
 * policy test's job (CWR-P1-1), not this shape guard's. */
export function isRoutingPolicyDocument(value: unknown): value is RoutingPolicyDocument {
  if (value === null || typeof value !== 'object') return false;
  const doc = value as Record<string, unknown>;
  return (
    typeof doc.policyVersion === 'number' &&
    Array.isArray(doc.modelTable) &&
    Array.isArray(doc.hardConstraints) &&
    typeof doc.laneChains === 'object' &&
    doc.laneChains !== null &&
    !Array.isArray(doc.laneChains) &&
    Array.isArray(doc.dataClassificationAllowlists) &&
    Array.isArray(doc.sonnetPriceRows) &&
    doc.sonnetPriceRows.every(isRoutingPolicyPriceRow)
  );
}
