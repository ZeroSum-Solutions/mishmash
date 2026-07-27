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
//
// Sol-N4 (deliverable-review fix round 2): grouping by axis ALONE is too
// coarse -- two claims can share an axis without genuinely competing for the
// same slot (this corpus's own hostile-heavy-dom-catalog case has multiple
// same-axis claims scattered across unrelated catalog rows). Two claims are
// only a REAL contest when they share both the axis AND a role key -- the
// scope with its source-id prefix stripped, so `ecom-flex-a-reviews-panel`
// and `ecom-grid-b-reviews-panel` collapse to the same role
// (`reviews-panel`) while `ecom-flex-a-reviews-panel` and
// `ecom-flex-a-price-badge` do not. Claims that share an axis but NOT a role
// key are independent sole-claimants within their own role, never pitted
// against each other. This mirrors the scopeOverlap semantics
// (`same-role-different-source` vs `single-claimant`) the IR's own
// conflictResolution entries already record (see generate-corpus.ts) -- the
// grouping now actually uses that distinction instead of ignoring it.
// Selection logic within a genuine contest (declared-winner lookup,
// fallback-to-first-claim-when-undeclared) is UNCHANGED from the
// dual-APPROVED (F4) round-1 algorithm.

// Strips a known source id from a domPath-shaped scope to recover the shared
// "role" identity two different sources' claims on the same slot would both
// reduce to. This corpus's domPath convention embeds the source id TWICE
// (`body > div.<source>-shell > role.<source>-role`) -- a single-occurrence
// strip leaves the second copy in place and two different sources' claims on
// the identical role never collapse to the same key (verified: this was
// wrong on first pass, caught by re-running C7-3's own real-corpus check
// against all 4 conflict cases before committing). split/join strips EVERY
// occurrence. Falls back to the raw scope when the source id isn't present
// at all (unrecognized shape) -- never throws, worst case treats the claim
// as its own singleton role, which is the SAME (safe, non-contesting)
// behavior as before this fix for any scope this heuristic can't parse.
function roleKeyFor(scope: string, sourceId: string): string {
  if (!scope.includes(sourceId)) return scope;
  return scope.split(sourceId).join('');
}

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
  // Sol-N4: group by (axis, roleKey), not axis alone -- two claims on the
  // same axis but unrelated scopes (e.g. two different catalog rows) are
  // independent sole-claimants, not competitors. groupKey is used only to
  // bucket claims for selection below; `result` is re-keyed by that same
  // composite string (nothing downstream reads `result` by bare axis --
  // every consumer either checks non-null presence or reads `losingClaims`).
  const byGroup = new Map<string, DirectiveClaim[]>();
  for (const d of ir.directives) {
    const groupKey = `${d.axis}::${roleKeyFor(d.scope, d.source)}`;
    const existing = byGroup.get(groupKey);
    if (existing) existing.push(d);
    else byGroup.set(groupKey, [d]);
  }

  const result: Record<string, DirectiveClaim | null> = {};
  const losingClaims: LosingClaim[] = [];

  const groupKeys = [...byGroup.keys()].sort();
  for (const groupKey of groupKeys) {
    const claims = byGroup.get(groupKey) ?? [];
    const axis = claims[0]!.axis;
    const distinctSources = [...new Set(claims.map((c) => c.source))];

    if (distinctSources.length <= 1) {
      // No contention in this axis+role group -- the sole claim (if any)
      // wins by default. No losingClaims entry: there is nothing to record
      // as lost.
      result[groupKey] = claims[0] ?? null;
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
      result[groupKey] = fallbackWinner;
      for (const c of claims) {
        if (c.source !== fallbackWinner.source) losingClaims.push({ axis, winningSource: fallbackWinner.source, losingSource: c.source });
      }
      continue;
    }

    const winner = claims.find((c) => c.source === declared.winningSource) ?? claims[0]!;
    result[groupKey] = winner;
    for (const c of claims) {
      if (c.source !== declared.winningSource) {
        losingClaims.push({ axis, winningSource: declared.winningSource, losingSource: c.source });
      }
    }
  }

  return { result, losingClaims };
}
