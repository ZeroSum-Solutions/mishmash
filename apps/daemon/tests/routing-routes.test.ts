// Route-level coverage for GET /api/routing/policy, /decision/preview, and
// /meters (WR wave). A bare express() app with just this route module
// registered -- no full daemon boot needed since the P0 policy loader has
// no SQLite/project dependency (mirrors host-tools-open-in-route.test.ts's
// lightweight harness). /decision/preview now runs the real decideRouting
// engine (apps/daemon/src/routing/decision.ts, t5) -- see
// apps/daemon/tests/routing-decision.test.ts for the engine's own
// table-driven coverage; this file only proves the ROUTE wires it correctly
// (query params -> RoutingKey/taskClass/sensitivityClass -> a real decision)
// and validates malformed query params with a 400, per the established
// `invalid-query-param`/`invalid-routing-key` pattern.

import type http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isRoutingDecisionPreviewResponse,
  isRoutingMetersResponse,
  isRoutingPolicyResponse,
} from '@open-design/contracts';

import { registerRoutingRoutes } from '../src/routes/routing.js';
import { closeDatabase, openDatabase } from '../src/db.js';
import { ensureRoutingTelemetryTable } from '../src/routing/telemetry.js';
import { ensureRoutingCooldownsTable, recordObservedFailure } from '../src/routing/reliability.js';

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
  it('runs the real decision engine end-to-end for the primary key shape (templateId+buildClass) with a taskClass', async () => {
    const resp = await fetch(
      `${baseUrl}/api/routing/decision/preview?templateId=t1&buildClass=landing-page&stage=section-fanout&taskClass=section-component-codegen`,
    );
    expect(resp.status).toBe(200);
    const body: unknown = await resp.json();
    expect(isRoutingDecisionPreviewResponse(body)).toBe(true);
    const response = body as {
      key: { templateId: string | null; buildClass: string | null; stage: string; contextEstimateTokens: number };
      decision: {
        status: string;
        modelFlag: string;
        lane: string;
        admissionVerdict: string;
        promptComposition: unknown[];
        sensitivityClass: string;
        reasons: unknown[];
      };
    };
    expect(response.key).toMatchObject({ templateId: 't1', buildClass: 'landing-page', stage: 'section-fanout' });
    // section-component-codegen's primary (routing-policy.json §2) is
    // claude-sonnet-5 on claude-code-oauth, which survives the default
    // (most-restrictive) client-confidential classification.
    expect(response.decision.status).toBe('ok');
    expect(response.decision.modelFlag).toBe('claude-sonnet-5');
    expect(response.decision.lane).toBe('claude-code-oauth');
    expect(response.decision.admissionVerdict).toBe('not-evaluated');
    expect(response.decision.promptComposition).toEqual([]);
    expect(response.decision.sensitivityClass).toBe('client-confidential');
    expect((response.decision.reasons as unknown[]).length).toBeGreaterThan(0);
  });

  it('falls back to null templateId/buildClass and stage "chat" when omitted (fallback B) -- no taskClass means a typed error, not a stub', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/decision/preview`);
    expect(resp.status).toBe(200);
    const body: unknown = await resp.json();
    expect(isRoutingDecisionPreviewResponse(body)).toBe(true);
    const response = body as {
      key: { templateId: string | null; buildClass: string | null; stage: string };
      decision: { status: string };
    };
    expect(response.key).toMatchObject({ templateId: null, buildClass: null, stage: 'chat' });
    // WR-routing.md Fallback B: "runtime default resolves the model" -- that
    // default belongs to the dispatch layer, not this policy-driven engine,
    // so with no taskClass at all this is an honest typed error.
    expect(response.decision.status).toBe('error');
  });

  it('accepts a templateId with no buildClass (fallback A)', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/decision/preview?templateId=saved-prompt`);
    expect(resp.status).toBe(200);
    const body: unknown = await resp.json();
    expect(isRoutingDecisionPreviewResponse(body)).toBe(true);
    const response = body as { key: { templateId: string | null; buildClass: string | null } };
    expect(response.key).toMatchObject({ templateId: 'saved-prompt', buildClass: null });
  });

  it('accepts a non-web stage with a pipeline-internal templateId and resolves via taskClass (fallback C)', async () => {
    const resp = await fetch(
      `${baseUrl}/api/routing/decision/preview?templateId=ingest-distill-run-1&stage=ingestion&taskClass=token-distill&sensitivityClass=public`,
    );
    expect(resp.status).toBe(200);
    const body: unknown = await resp.json();
    expect(isRoutingDecisionPreviewResponse(body)).toBe(true);
    const response = body as {
      key: { templateId: string | null; buildClass: string | null; stage: string };
      decision: { status: string; modelFlag: string };
    };
    expect(response.key).toMatchObject({ templateId: 'ingest-distill-run-1', buildClass: null, stage: 'ingestion' });
    expect(response.decision.status).toBe('ok');
    // Sol review MED-2 (transport-tier sort): token-distill's burst
    // (kimi-k3/moonshot, prepaid) now wins over the row-declared primary
    // (deepseek/metered) once nothing is throttled -- see
    // apps/daemon/tests/routing-decision.test.ts for the engine-level case.
    expect(response.decision.modelFlag).toBe('moonshotai/kimi-k3');
  });

  it('rejects buildClass supplied without templateId -- the one shape WR-routing.md\'s fallback table forbids', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/decision/preview?buildClass=landing-page`);
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid-routing-key');
  });

  it('rejects an unrecognized sensitivityClass with a 400', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/decision/preview?sensitivityClass=top-secret`);
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('invalid-query-param');
    expect(body.error.message).toContain('sensitivityClass');
  });

  it('rejects a non-numeric contextEstimateTokens with a 400', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/decision/preview?contextEstimateTokens=abc`);
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid-query-param');
  });

  // Sol review MED-5 (confidentiality, t5 fix commit): promptText is a
  // potentially client-confidential composed-prompt excerpt and must never
  // ride a query string (access/proxy/shell-history exposure) -- GET
  // rejects it outright; POST (its own describe block below) is the only
  // way to supply it.
  it('rejects promptText supplied over GET with a 400, pointing the caller at POST', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/decision/preview?promptText=${'a'.repeat(40)}`);
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('invalid-query-param');
    expect(body.error.message).toContain('POST');
  });

  it('rejects repeated promptText GET params (array-valued) the same way (Sol t5 confirm, M5)', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/decision/preview?promptText=a&promptText=b`);
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid-query-param');
  });

  it('rejects a contextEstimateTokens above the 8,000,000-token bound with a 400 (Sol review MED-4)', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/decision/preview?contextEstimateTokens=8000001`);
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid-query-param');
  });

  it('rejects a fractional contextEstimateTokens with a 400 (Sol review MED-4: integer-only)', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/decision/preview?contextEstimateTokens=3.5`);
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid-query-param');
  });

  it('surfaces a fail-closed-stop decision for client-confidential work whose only candidates are non-subscription lanes', async () => {
    // token-distill's primary (deepseek-v4-flash/deepseek-direct, metered)
    // and burst (kimi-k3/moonshot, prepaid) are BOTH outside the
    // client-confidential allowlist (claude-code-oauth/codex-oauth/agy
    // only) -- filtering alone empties the candidate list.
    const resp = await fetch(
      `${baseUrl}/api/routing/decision/preview?taskClass=token-distill&sensitivityClass=client-confidential`,
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { decision: { status: string; modelFlag: string } };
    expect(body.decision.status).toBe('fail-closed-stop');
    expect(body.decision.modelFlag).not.toBe('deepseek-v4-flash');
  });
});

// Sol review MED-5 (t5 fix commit): promptText only ever travels in a POST
// JSON body, never a query string. This describe block is the ONLY place
// that exercises promptText end-to-end at the route level.
describe('POST /api/routing/decision/preview', () => {
  async function postPreview(body: Record<string, unknown>): Promise<Response> {
    return fetch(`${baseUrl}/api/routing/decision/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('estimates contextEstimateTokens from promptText when no explicit numeric value is given', async () => {
    const promptText = 'a'.repeat(40);
    const resp = await postPreview({ promptText });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { key: { contextEstimateTokens: number } };
    expect(body.key.contextEstimateTokens).toBe(Math.ceil(promptText.length / 4));
  });

  it('an explicit contextEstimateTokens takes precedence over promptText estimation', async () => {
    const resp = await postPreview({ promptText: 'a'.repeat(40), contextEstimateTokens: 7 });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { key: { contextEstimateTokens: number } };
    expect(body.key.contextEstimateTokens).toBe(7);
  });

  it('runs the same decision engine as GET for the full field set', async () => {
    const resp = await postPreview({
      templateId: 't1',
      buildClass: 'landing-page',
      stage: 'section-fanout',
      taskClass: 'section-component-codegen',
    });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { decision: { status: string; modelFlag: string; lane: string } };
    expect(body.decision.status).toBe('ok');
    expect(body.decision.modelFlag).toBe('claude-sonnet-5');
    expect(body.decision.lane).toBe('claude-code-oauth');
  });

  it('rejects an unrecognized sensitivityClass in the body with a 400, same as GET', async () => {
    const resp = await postPreview({ sensitivityClass: 'top-secret' });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid-query-param');
  });

  it('rejects buildClass supplied without templateId, same as GET', async () => {
    const resp = await postPreview({ buildClass: 'landing-page' });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid-routing-key');
  });

  it('rejects a contextEstimateTokens above the 8,000,000-token bound, same as GET', async () => {
    const resp = await postPreview({ contextEstimateTokens: 8_000_001 });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: { code: string } };
    expect(body.error.code).toBe('invalid-query-param');
  });

  // Sol review MED-5: the 256kb per-route body limit (registered inline in
  // registerRoutingRoutes for this bare-express harness -- see the route's
  // own doc comment for why the real daemon ALSO needs a path-scoped
  // app.use() ahead of its blanket 4mb parser in server.ts) actually
  // rejects an oversized body rather than silently accepting it.
  it('rejects a promptText body over the 256kb limit', async () => {
    const resp = await postPreview({ promptText: 'a'.repeat(300_000) });
    expect(resp.status).toBe(413);
  });
});

describe('GET /api/routing/meters', () => {
  it('returns a well-shaped, empty RoutingMetersResponse until telemetry/dispatch land', async () => {
    const resp = await fetch(`${baseUrl}/api/routing/meters`);
    expect(resp.status).toBe(200);
    const body: unknown = await resp.json();
    expect(isRoutingMetersResponse(body)).toBe(true);
    expect((body as { laneMeters: unknown[] }).laneMeters).toEqual([]);
    // No db registered on this bare-express app -- `cooldowns` is an
    // additive/optional envelope field, omitted entirely rather than a
    // fabricated empty array (RoutingMetersResponse#cooldowns's own doc
    // comment).
    expect((body as { cooldowns?: unknown[] }).cooldowns).toBeUndefined();
  });
});

// t7 (plan §3.2 L1 reliability): with a real db registered, the additive
// `cooldowns` field on GET /api/routing/meters surfaces recorded reliability
// cooldown state.
describe('GET /api/routing/meters -- cooldowns (t7)', () => {
  it('includes a cooldown status entry once a failure has been recorded against a runtime/lane', async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-meters-cooldowns-'));
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    ensureRoutingCooldownsTable(db);
    recordObservedFailure(db, 'claude', 'claude-code-oauth', 'rate_limit', new Date());

    const app = express();
    registerRoutingRoutes(app, db);
    const cooldownServer = app.listen(0);
    await new Promise<void>((resolve) => cooldownServer.once('listening', () => resolve()));
    const cooldownBaseUrl = `http://127.0.0.1:${(cooldownServer.address() as AddressInfo).port}`;

    try {
      const resp = await fetch(`${cooldownBaseUrl}/api/routing/meters`);
      expect(resp.status).toBe(200);
      const body: unknown = await resp.json();
      expect(isRoutingMetersResponse(body)).toBe(true);
      const { cooldowns } = body as { cooldowns: Array<{ scopeType: string; scopeId: string; inCooldown: boolean }> };
      expect(Array.isArray(cooldowns)).toBe(true);
      expect(cooldowns.some((c) => c.scopeType === 'runtime' && c.scopeId === 'claude' && c.inCooldown)).toBe(true);
      expect(cooldowns.some((c) => c.scopeType === 'lane' && c.scopeId === 'claude-code-oauth' && c.inCooldown)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => cooldownServer.close(() => resolve()));
      closeDatabase();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('GET /api/routing/decision/preview -- admission control engaged with a real db (t6)', () => {
  let tempDir: string;
  let admissionServer: http.Server;
  let admissionBaseUrl: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-preview-admission-'));
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    const app = express();
    registerRoutingRoutes(app, db);
    admissionServer = app.listen(0);
    await new Promise<void>((resolve) => admissionServer.once('listening', () => resolve()));
    admissionBaseUrl = `http://127.0.0.1:${(admissionServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => admissionServer.close(() => resolve()));
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('admits a cheap dispatch and surfaces the per-candidate admissionResults', async () => {
    const resp = await fetch(
      `${admissionBaseUrl}/api/routing/decision/preview?taskClass=mechanical-batch&stage=chat&contextEstimateTokens=100000&buildId=build-preview-1`,
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      decision: { status: string; admissionVerdict: string; admissionResults: Array<{ model: string; verdict: string }> };
    };
    expect(body.decision.status).toBe('ok');
    expect(body.decision.admissionVerdict).toBe('admitted');
    expect(body.decision.admissionResults.length).toBeGreaterThan(0);
    expect(body.decision.admissionResults.at(-1)).toMatchObject({ verdict: 'admit' });
  });

  it('denies dispatch and reports "denied-admission" with a reason per denied candidate when every candidate blows the stage ceiling', async () => {
    const resp = await fetch(
      `${admissionBaseUrl}/api/routing/decision/preview?taskClass=mechanical-batch&stage=chat&contextEstimateTokens=8000000&buildId=build-preview-2`,
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      decision: { status: string; admissionVerdict: string; admissionResults: Array<{ verdict: string }>; reasons: Array<{ step: string }> };
    };
    expect(body.decision.status).toBe('denied-admission');
    expect(body.decision.admissionVerdict).toBe('denied');
    expect(body.decision.admissionResults.length).toBeGreaterThan(0);
    expect(body.decision.admissionResults.every((r) => r.verdict === 'deny-stage-ceiling')).toBe(true);
    expect(body.decision.reasons.some((r) => r.step === 'admission-denied')).toBe(true);
  });
});
