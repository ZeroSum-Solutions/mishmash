// Routing module surface (WR wave, P0 skeleton -- plan §3.4 capability
// closure). `apps/daemon/src/routes/routing.ts` is the only consumer today;
// real dispatch-time routing (P2) and telemetry persistence (P1) land in
// later WR tranches -- see docs/plans/waves/WR-routing.md's Tranche register.

export { currentRoutingPolicyVersion, loadRoutingPolicy } from './policy.js';
