// /api/routing/* -- routing capability HTTP surface (WR wave, P0 skeleton,
// plan docs/plans/2026-08-05-model-routing-system.md §3.4 capability
// closure). Contracts: packages/contracts/src/api/routing-{policy,decision,
// telemetry}.ts. Every response here is a documented stub: real policy
// content, admission control, and dispatch-time routing land in later WR
// tranches (P1/P2) -- see docs/plans/waves/WR-routing.md's Tranche register.
import type Database from 'better-sqlite3';
import type { Express, Request, Response } from 'express';
import type {
  RoutingDecision,
  RoutingDecisionPreviewResponse,
  RoutingKey,
  RoutingMetersResponse,
  RoutingPolicyResponse,
  RoutingTelemetryListResponse,
} from '@open-design/contracts';
import { currentRoutingPolicyVersion, loadRoutingPolicy } from '../routing/index.js';
import { computeLaneMeters, listRoutingTelemetry } from '../routing/telemetry.js';

function queryStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Sol review MED-5: a query param that is PRESENT but unparseable (e.g.
 * `?limit=abc`) must be rejected with a 400, not silently coerced into
 * "absent -> use the default" the way `queryIntOrUndefined` used to. Absent
 * (`undefined`) is genuinely fine and returns `{ ok: true, value: undefined
 * }` so the caller's own default applies. */
type QueryIntResult = { ok: true; value: number | undefined } | { ok: false; message: string };

function parseOptionalQueryInt(raw: unknown, name: string, opts: { min?: number } = {}): QueryIntResult {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'string' || raw.length === 0 || !Number.isFinite(Number(raw))) {
    return { ok: false, message: `\`${name}\` must be a finite number` };
  }
  const n = Number(raw);
  if (opts.min !== undefined && n < opts.min) {
    return { ok: false, message: `\`${name}\` must be >= ${opts.min}` };
  }
  return { ok: true, value: n };
}

/** House 400 error shape -- matches `/decision/preview`'s existing
 * `invalid-routing-key` envelope below rather than inventing a second one. */
function respondInvalidQuery(res: Response, message: string): void {
  res.status(400).json({ error: { code: 'invalid-query-param', message } });
}

/**
 * `db` is optional so a route-level test (or a future caller with no
 * durable telemetry yet) can register these routes without a database --
 * `/api/routing/meters` and `/api/routing/telemetry` degrade to an honest
 * empty result rather than throwing. The real daemon boot
 * (apps/daemon/src/server.ts) always passes its resolved db.
 */
export function registerRoutingRoutes(app: Express, db?: Database.Database): void {
  // GET /api/routing/policy -- the loaded policy document + its version.
  app.get('/api/routing/policy', (_req: Request, res: Response) => {
    const policy = loadRoutingPolicy();
    const response: RoutingPolicyResponse = { policy, policyVersion: policy.policyVersion };
    res.json(response);
  });

  // GET /api/routing/decision/preview -- a stub RoutingDecision for a given
  // routing key. Query params mirror RoutingKey's discriminated fallback
  // shape (docs/plans/waves/WR-routing.md's "Routing-key fallback
  // (normative)"): buildClass may only be supplied alongside templateId --
  // WR-routing.md's fallback table never defines a build-class-only key, so
  // that combination is rejected here rather than silently coerced. The
  // decision itself is always a fixed stub until P2 lands real dispatch
  // logic; only the echoed `key` reflects the caller's input.
  app.get('/api/routing/decision/preview', (req: Request, res: Response) => {
    const templateId = queryStringOrNull(req.query.templateId);
    const buildClass = queryStringOrNull(req.query.buildClass);
    const stage = queryStringOrNull(req.query.stage) ?? 'chat';

    if (buildClass !== null && templateId === null) {
      res.status(400).json({
        error: {
          code: 'invalid-routing-key',
          message:
            'buildClass may only be supplied together with templateId -- WR-routing.md\'s fallback table has no build-class-only shape.',
        },
      });
      return;
    }

    const key: RoutingKey =
      templateId !== null && buildClass !== null
        ? { templateId, buildClass, stage, contextEstimateTokens: 0, laneMeters: {} }
        : { templateId, buildClass: null, stage, contextEstimateTokens: 0, laneMeters: {} };

    const decision: RoutingDecision = {
      runtimeId: 'stub-runtime',
      modelFlag: 'default',
      effort: 'medium',
      lane: 'stub-lane',
      rationale: 'policy-stub-v0',
      admissionVerdict: 'admitted',
      policyVersion: currentRoutingPolicyVersion(),
      promptComposition: [],
      // Fail-closed placeholder (plan §3.2 L2): an unresolved sensitivity
      // class defaults to the MOST restrictive value rather than the least,
      // until a later tranche wires this from the real request/brief
      // context.
      sensitivityClass: 'client-confidential',
    };
    const response: RoutingDecisionPreviewResponse = { key, decision };
    res.json(response);
  });

  // GET /api/routing/meters -- per-lane routing meters, aggregated from the
  // L5 telemetry table (CWR-P2-4's lane-meter closure). `?windowMs=` scopes
  // the aggregation to the trailing window; omit for all-time. Real content
  // once telemetry rows exist (CWR-P1-2); an empty array when `db` was not
  // supplied (see registerRoutingRoutes's doc comment) or no rows are in
  // range yet -- same well-shaped-empty-array contract the P0 stub shipped.
  app.get('/api/routing/meters', (req: Request, res: Response) => {
    const windowMsResult = parseOptionalQueryInt(req.query.windowMs, 'windowMs', { min: 0 });
    if (!windowMsResult.ok) return respondInvalidQuery(res, windowMsResult.message);
    const laneMeters = db ? computeLaneMeters(db, windowMsResult.value) : [];
    const response: RoutingMetersResponse = { laneMeters };
    res.json(response);
  });

  // GET /api/routing/telemetry -- filtered, paginated read of the L5
  // telemetry table (plan §3.2 L5's weekly-policy-review purpose). Optional
  // per WR t4's deliverable list; wired here because the response-envelope
  // pattern (RoutingTelemetryListResponse) is already cheap to reuse.
  app.get('/api/routing/telemetry', (req: Request, res: Response) => {
    const sinceMsResult = parseOptionalQueryInt(req.query.sinceMs, 'sinceMs');
    if (!sinceMsResult.ok) return respondInvalidQuery(res, sinceMsResult.message);
    const untilMsResult = parseOptionalQueryInt(req.query.untilMs, 'untilMs');
    if (!untilMsResult.ok) return respondInvalidQuery(res, untilMsResult.message);
    const limitResult = parseOptionalQueryInt(req.query.limit, 'limit', { min: 1 });
    if (!limitResult.ok) return respondInvalidQuery(res, limitResult.message);
    const offsetResult = parseOptionalQueryInt(req.query.offset, 'offset', { min: 0 });
    if (!offsetResult.ok) return respondInvalidQuery(res, offsetResult.message);

    if (!db) {
      const empty: RoutingTelemetryListResponse = { rows: [], total: 0, limit: 0, offset: 0 };
      res.json(empty);
      return;
    }
    const response = listRoutingTelemetry(
      db,
      {
        projectId: queryStringOrNull(req.query.projectId) ?? undefined,
        runId: queryStringOrNull(req.query.runId) ?? undefined,
        stage: queryStringOrNull(req.query.stage) ?? undefined,
        sinceMs: sinceMsResult.value,
        untilMs: untilMsResult.value,
      },
      {
        limit: limitResult.value,
        offset: offsetResult.value,
      },
    );
    res.json(response);
  });
}
