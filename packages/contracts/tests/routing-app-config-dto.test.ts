// Amendment 2, item 3 (WR wave).
//
// `GET /api/app-config` has been returning `routingPolicyVersion` on the wire
// since the P1 tranche, but the shared DTO never declared it: the daemon's own
// `AppConfigPrefs` (apps/daemon/src/app-config.ts) grew the field while
// packages/contracts' copy -- the one both sides are supposed to agree on --
// did not. A shared contract that under-describes the response is exactly the
// divergence packages/contracts exists to prevent.
//
// The correction has to thread a needle, and these assertions pin both sides
// of it. The naive fix (add the field to `AppConfigPrefs`) would silently make
// it writable, because `UpdateAppConfigRequest` is defined as
// `Partial<AppConfigPrefs>` -- which would re-open, at the contract level, the
// exact write surface Amendment 2 item 2 closes in the daemon. So the response
// shape must gain the field while the request shape must not.
//
// These are compile-time assertions: they fail `tsc`, not the runtime
// assertion below. The runtime case exists so the behaviour is also exercised.

import { describe, expect, it } from 'vitest';

import type {
  AppConfigResponse,
  UpdateAppConfigRequest,
} from '../src/api/app-config.js';

// 1. The response shape must describe what the daemon actually sends.
function readsMarkerOffTheWire(response: AppConfigResponse): number | null | undefined {
  return response.config.routingPolicyVersion;
}

// 2. The request shape must NOT accept it. If someone "fixes" the divergence by
//    adding the field to AppConfigPrefs without omitting it from the update
//    type, this @ts-expect-error goes unused and tsc fails -- which is the
//    point: the contract must not advertise a server-owned key as writable.
// @ts-expect-error routingPolicyVersion is server-owned; clients cannot set it.
const rejectedUpdate: UpdateAppConfigRequest = { routingPolicyVersion: 5 };
void rejectedUpdate;

// 3. Ordinary preferences stay writable -- the omission must be surgical.
const acceptedUpdate: UpdateAppConfigRequest = { onboardingCompleted: true };
void acceptedUpdate;

describe('AppConfigPrefs declares the server-owned routing policy marker', () => {
  it('carries the marker through the response shape', () => {
    expect(readsMarkerOffTheWire({ config: { routingPolicyVersion: 3 } })).toBe(3);
  });

  it('models the "policy version unavailable" case as null, matching the daemon', () => {
    expect(readsMarkerOffTheWire({ config: { routingPolicyVersion: null } })).toBeNull();
  });
});
