// Route-level coverage for GET /api/routing/policy, /decision/preview, and
// /meters (WR wave, P0 skeleton). A bare express() app with just this route
// module registered -- no full daemon boot needed since the P0 policy
// loader has no SQLite/project dependency (mirrors
// host-tools-open-in-route.test.ts's lightweight harness).

import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isRoutingDecisionPreviewResponse,
  isRoutingMetersResponse,
  isRoutingPolicyResponse,
} from '@open-design/contracts';

import { registerRoutingRoutes } from '../src/routes/routing.js';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  registerRoutingRoutes(app);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('GET /api/routing/policy', () => {
  it('returns a well-shaped RoutingPolicyResponse', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/policy`);
    expect(resp.status).toBe(200);
    const body: unknown = await resp.json();
    expect(isRoutingPolicyResponse(body)).toBe(true);
    const response = body as { policyVersion: number; policy: { modelTable: unknown[]; hardConstraints: unknown[] } };
    // v1 policy content landed (CWR-P1-1): routing-policy.json now carries
    // the real §2 model table + PRD §15 hard constraints, so this is no
    // longer the empty P0 stub -- see
    // packages/contracts/tests/routing-policy-drift.test.ts for the actual
    // content assertions this route's response only has to echo faithfully.
    expect(response.policyVersion).toBe(1);
    expect(response.policy.modelTable.length).toBeGreaterThan(0);
    expect(response.policy.hardConstraints.length).toBeGreaterThan(0);
  });
});

describe('GET /api/routing/decision/preview', () => {
  it('echoes the routing key and returns a well-shaped RoutingDecisionPreviewResponse (primary shape)', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/decision/preview?templateId=t1&buildClass=landing-page&stage=prototype`);
    expect(resp.status).toBe(200);
    const body: unknown = await resp.json();
    expect(isRoutingDecisionPreviewResponse(body)).toBe(true);
    const response = body as {
      key: { templateId: string | null; buildClass: string | null; stage: string };
      decision: { rationale: string; policyVersion: number; admissionVerdict: string; promptComposition: unknown[]; sensitivityClass: string };
    };
    expect(response.key).toMatchObject({ templateId: 't1', buildClass: 'landing-page', stage: 'prototype' });
    expect(response.decision.rationale).toBe('policy-stub-v0');
    // currentRoutingPolicyVersion() now reads the v1 policy (CWR-P1-1); the
    // decision *content* itself is still the P2 stub -- only the echoed
    // version number tracks the loaded policy document.
    expect(response.decision.policyVersion).toBe(1);
    expect(response.decision.admissionVerdict).toBe('admitted');
    expect(response.decision.promptComposition).toEqual([]);
    expect(response.decision.sensitivityClass).toBe('client-confidential');
  });

  it('falls back to null templateId/buildClass and stage "chat" when omitted (fallback B)', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/decision/preview`);
    expect(resp.status).toBe(200);
    const body: unknown = await resp.json();
    expect(isRoutingDecisionPreviewResponse(body)).toBe(true);
    const response = body as { key: { templateId: string | null; buildClass: string | null; stage: string } };
    expect(response.key).toMatchObject({ templateId: null, buildClass: null, stage: 'chat' });
  });

  it('accepts a templateId with no buildClass (fallback A)', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/decision/preview?templateId=saved-prompt`);
    expect(resp.status).toBe(200);
    const body: unknown = await resp.json();
    expect(isRoutingDecisionPreviewResponse(body)).toBe(true);
    const response = body as { key: { templateId: string | null; buildClass: string | null } };
    expect(response.key).toMatchObject({ templateId: 'saved-prompt', buildClass: null });
  });

  it('rejects buildClass supplied without templateId -- the one shape WR-routing.md\'s fallback table forbids', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/decision/preview?buildClass=landing-page`);
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid-routing-key');
  });
});

describe('GET /api/routing/meters', () => {
  it('returns a well-shaped, empty RoutingMetersResponse until telemetry/dispatch land', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/meters`);
    expect(resp.status).toBe(200);
    const body: unknown = await resp.json();
    expect(isRoutingMetersResponse(body)).toBe(true);
    expect((body as { laneMeters: unknown[] }).laneMeters).toEqual([]);
  });
});
