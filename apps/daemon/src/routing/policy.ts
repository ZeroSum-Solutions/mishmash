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
