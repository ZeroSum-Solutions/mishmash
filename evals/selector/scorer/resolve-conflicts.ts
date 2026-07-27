// resolve-conflicts.ts -- applies the IR's OWN declared precedence to its OWN
// directive claims. This is not a pass-through of ir.conflictResolution: it
// independently groups ir.directives by axis, and for any axis two or more
// DISTINCT sources claim, looks up the declared winner for that axis and
// computes which claims lose -- so a resolver that just echoed
// ir.conflictResolution back verbatim (without ever looking at the actual
// competing directives) would not produce a losingClaims record for an axis
// that has no real second claimant, and would produce more than one
// losingClaims record if a third source piled onto an already-contested
// axis. Determinism: pure function, no I/O, no clock, no randomness -- the
// same ir produces byte-identical output on every call.

export interface DirectiveClaim {
  axis: string;
  source: string;
  scope: string;
  strength: number;
}

export interface ConflictResolutionRecord {
  axis: string;
  winningSource: string;
  losingSource?: string;
  losingClaim?: string;
  rationale?: string;
}

export interface CompositionIRForConflicts {
  directives: DirectiveClaim[];
  conflictResolution: ConflictResolutionRecord[];
}

export interface LosingClaim {
  axis: string;
  winningSource: string;
  losingSource: string;
}

export interface ConflictResolutionResult {
  result: Record<string, DirectiveClaim | null>;
  losingClaims: LosingClaim[];
}

export function resolveConflicts(ir: CompositionIRForConflicts): ConflictResolutionResult {
  const byAxis = new Map<string, DirectiveClaim[]>();
  for (const d of ir.directives) {
    const existing = byAxis.get(d.axis);
    if (existing) existing.push(d);
    else byAxis.set(d.axis, [d]);
  }

  const result: Record<string, DirectiveClaim | null> = {};
  const losingClaims: LosingClaim[] = [];

  const axisNames = [...byAxis.keys()].sort();
  for (const axis of axisNames) {
    const claims = byAxis.get(axis) ?? [];
    const distinctSources = [...new Set(claims.map((c) => c.source))];

    if (distinctSources.length <= 1) {
      // No contention on this axis -- the sole claim (if any) wins by
      // default. No losingClaims entry: there is nothing to record as lost.
      result[axis] = claims[0] ?? null;
      continue;
    }

    const declared = ir.conflictResolution.find((r) => r.axis === axis);
    if (!declared) {
      // A real conflict with no declared precedence is a data-authoring
      // defect, not something this resolver may paper over by guessing --
      // fall back to the first claim deterministically (stable: claims
      // preserves ir.directives' own order) and record every OTHER claim on
      // this axis as losing against it, so the absence of a declared
      // precedence is still visible in the output rather than silently
      // dropped.
      const fallbackWinner = claims[0]!;
      result[axis] = fallbackWinner;
      for (const c of claims) {
        if (c.source !== fallbackWinner.source) losingClaims.push({ axis, winningSource: fallbackWinner.source, losingSource: c.source });
      }
      continue;
    }

    const winner = claims.find((c) => c.source === declared.winningSource) ?? claims[0]!;
    result[axis] = winner;
    for (const c of claims) {
      if (c.source !== declared.winningSource) {
        losingClaims.push({ axis, winningSource: declared.winningSource, losingSource: c.source });
      }
    }
  }

  return { result, losingClaims };
}
