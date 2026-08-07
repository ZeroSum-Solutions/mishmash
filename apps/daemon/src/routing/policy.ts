// Routing policy loader (WR wave, P0 skeleton -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.2 L2). Loads and
// structurally validates the committed routing-policy.json against the
// RoutingPolicyDocument contract shape. Real policy content (the §2 model
// table + PRD §15 hard constraints) and the drift-failing policy test land
// in a later WR tranche -- see docs/plans/waves/WR-routing.md's Tranche
// register (CWR-P1-1). This loader is intentionally minimal: no watch/reload,
// no schema-driven error reporting beyond a thrown message.
//
// The policy document is a static `import ... with { type: 'json' }`
// (resolveJsonModule + NodeNext import attributes) rather than a
// readFileSync() against a path built from import.meta.url: this package's
// tsc build (apps/daemon/tsconfig.json) has no asset-copy step, so a JSON
// file read by a runtime-computed sibling path would exist under
// src/routing/ but NOT get copied to dist/routing/ -- a readFileSync
// version would work under vitest/tsx (which run against src/ directly) and
// then throw ENOENT the moment the compiled dist/cli.js daemon (the actual
// `pnpm tools-dev` / `od` runtime) served a request. A static import makes
// the JSON participate in tsc's own module graph, so it is emitted next to
// its compiled importer like any other build output.
import { isRoutingPolicyDocument, type RoutingPolicyDocument } from '@open-design/contracts';
import routingPolicyRaw from './routing-policy.json' with { type: 'json' };

let cachedPolicy: RoutingPolicyDocument | null = null;

/** Validates the bundled routing-policy.json once per process, caching the
 * result. Throws if it fails the shape guard -- a malformed policy document
 * must fail loudly, not silently fall back to an empty policy that would
 * make every dispatch look "admitted" for the wrong reason. */
export function loadRoutingPolicy(): RoutingPolicyDocument {
  if (cachedPolicy) return cachedPolicy;
  if (!isRoutingPolicyDocument(routingPolicyRaw)) {
    throw new Error('invalid routing policy document in apps/daemon/src/routing/routing-policy.json');
  }
  cachedPolicy = routingPolicyRaw;
  return routingPolicyRaw;
}

export function currentRoutingPolicyVersion(): number {
  return loadRoutingPolicy().policyVersion;
}

/**
 * Every `taskClass` this policy can actually resolve: the §2 model-table rows'
 * own match values plus the §15 program assignments' selectors. Membership
 * only -- this deliberately does NOT reimplement `decideRouting`'s matching
 * (stage, context-window bounds, template narrowing all still apply). It
 * exists so a CALLER-SUPPLIED task class can be checked at the request
 * boundary and dropped when the policy has no row for it.
 *
 * Why that matters: `decideRouting` treats "a task class was named but nothing
 * matched" as a terminal `'error'`, which the dispatch layer surfaces as a
 * BLOCKED run. That is correct for an internal caller naming a class it should
 * know, but wrong for an untrusted `/api/chat` body, where a stale or garbage
 * value would take down an otherwise ordinary chat turn. Filtering to known
 * values at the boundary keeps the unknown case on WR-routing.md Fallback B
 * (plain runtime-default chat) instead.
 */
export function knownTaskClasses(policy: RoutingPolicyDocument): ReadonlySet<string> {
  const known = new Set<string>();
  for (const row of policy.modelTable) {
    const taskClass = row.match.taskClass;
    if (typeof taskClass === 'string' && taskClass.length > 0) known.add(taskClass);
  }
  for (const assignment of policy.programAssignments ?? []) {
    if (typeof assignment.taskSelector === 'string' && assignment.taskSelector.length > 0) {
      known.add(assignment.taskSelector);
    }
  }
  return known;
}
