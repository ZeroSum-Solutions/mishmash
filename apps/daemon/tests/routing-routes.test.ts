// Route-level coverage for GET /api/routing/policy, /decision/preview, and
// /meters (WR wave, P0 skeleton). A bare express() app with just this route
// module registered -- no full daemon boot needed since the P0 policy
// loader has no SQLite/project dependency (mirrors
// host-tools-open-in-route.test.ts's lightweight harness).

import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  it('returns the loaded policy and its version', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/policy`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { policy: unknown; policyVersion: number };
    expect(body.policyVersion).toBe(0);
    expect(body.policy).toMatchObject({ policyVersion: 0, modelTable: [], hardConstraints: [] });
  });
});

describe('GET /api/routing/decision/preview', () => {
  it('echoes the routing key and returns a stub decision with the P0 rationale', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/decision/preview?templateId=t1&buildClass=landing-page&stage=prototype`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      key: { templateId: string | null; buildClass: string | null; stage: string };
      decision: { rationale: string; policyVersion: number; admissionVerdict: string };
    };
    expect(body.key).toMatchObject({ templateId: 't1', buildClass: 'landing-page', stage: 'prototype' });
    expect(body.decision.rationale).toBe('policy-stub-v0');
    expect(body.decision.policyVersion).toBe(0);
    expect(body.decision.admissionVerdict).toBe('admitted');
  });

  it('falls back to null templateId/buildClass and stage "chat" when omitted (fallback B)', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/decision/preview`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      key: { templateId: string | null; buildClass: string | null; stage: string };
    };
    expect(body.key).toMatchObject({ templateId: null, buildClass: null, stage: 'chat' });
  });
});

describe('GET /api/routing/meters', () => {
  it('returns an empty lane-meters array until telemetry/dispatch land', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/meters`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { laneMeters: unknown[] };
    expect(body.laneMeters).toEqual([]);
  });
});
