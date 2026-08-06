// /api/routing/* -- routing capability HTTP surface (WR wave, plan
// docs/plans/2026-08-05-model-routing-system.md §3.4 capability closure).
// Contracts: packages/contracts/src/api/routing-{policy,decision,
// telemetry}.ts. /decision/preview now calls the real advisory decision
// engine (apps/daemon/src/routing/decision.ts, t5) over the loaded policy +
// live lane meters; admission control (budgets, t6) and dispatch-time
// enforcement (t9) still land in later WR tranches -- see
// docs/plans/waves/WR-routing.md's Tranche register.
import type Database from 'better-sqlite3';
import type { Express, Request, Response } from 'express';
import type {
  RoutingDataClassification,
  RoutingDecisionPreviewResponse,
  RoutingKey,
  RoutingMetersResponse,
  RoutingPolicyResponse,
  RoutingTelemetryListResponse,
} from '@open-design/contracts';
import { decideRouting, estimatePromptTokens, loadRoutingPolicy } from '../routing/index.js';
import { computeLaneMeters, listRoutingTelemetry } from '../routing/telemetry.js';

const ROUTING_DATA_CLASSIFICATIONS: readonly RoutingDataClassification[] = ['client-confidential', 'internal', 'public'];

function isRoutingDataClassification(value: string): value is RoutingDataClassification {
  return (ROUTING_DATA_CLASSIFICATIONS as readonly string[]).includes(value);
}

function queryStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Sol review MED-5: a query param that is PRESENT but unparseable (e.g.
 * `?limit=abc`) must be rejected with a 400, not silently coerced into
 * "absent -> use the default" the way `queryIntOrUndefined` used to. Absent
 * (`undefined`) is genuinely fine and returns `{ ok: true, value: undefined
 * }` so the caller's own default applies. */
type QueryIntResult = { ok: true; value: number | undefined } | { ok: false; message: string };

/** The maximum epoch-millisecond value `Date`/`Date#toISOString` can
 * represent (ECMA-262 Date Time String Format, ±100,000,000 days from the
 * epoch); the minimum is its negation. Sol review MED-5 (fix round 2): a
 * value that is finite (passes the basic parse) but outside this range
 * still crashes `new Date(v).toISOString()` in
 * apps/daemon/src/routing/telemetry.ts's `buildFilterClause` with an
 * uncaught RangeError -- a 500, not a 400 -- so an epoch-shaped param must
 * be range-checked here at the boundary, not just finiteness-checked. */
const MAX_ECMASCRIPT_DATE_MS = 8_640_000_000_000_000;

function parseOptionalQueryInt(raw: unknown, name: string, opts: { min?: number; max?: number } = {}): QueryIntResult {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'string' || raw.length === 0 || !Number.isFinite(Number(raw))) {
    return { ok: false, message: `\`${name}\` must be a finite number` };
  }
  const n = Number(raw);
  if (opts.min !== undefined && n < opts.min) {
    return { ok: false, message: `\`${name}\` must be >= ${opts.min}` };
  }
  if (opts.max !== undefined && n > opts.max) {
    return { ok: false, message: `\`${name}\` must be <= ${opts.max}` };
  }
  return { ok: true, value: n };
}

/** Bounds for an epoch-milliseconds query param that ultimately reaches
 * `new Date(v).toISOString()` (sinceMs/untilMs directly; windowMs via
 * `Date.now() - windowMs` in `fetchRowsForAggregation`) -- see
 * MAX_ECMASCRIPT_DATE_MS's doc comment. */
const EPOCH_MS_BOUNDS = { min: 0, max: MAX_ECMASCRIPT_DATE_MS } as const;

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

  // GET /api/routing/decision/preview -- runs the real advisory decision
  // engine (apps/daemon/src/routing/decision.ts, t5) over the loaded policy
  // + live lane meters + the caller's query params. Query params mirror
  // RoutingKey's discriminated fallback shape (docs/plans/waves/
  // WR-routing.md's "Routing-key fallback (normative)"): buildClass may
  // only be supplied alongside templateId -- WR-routing.md's fallback table
  // never defines a build-class-only key, so that combination is rejected
  // here rather than silently coerced. All four frozen key shapes are
  // expressible: primary (templateId+buildClass), fallback A (templateId
  // only), fallback B (neither -- stage defaults to 'chat'), fallback C
  // (templateId + a non-web stage, e.g. an ingestion pipeline stage id).
  app.get('/api/routing/decision/preview', (req: Request, res: Response) => {
    const templateId = queryStringOrNull(req.query.templateId);
    const buildClass = queryStringOrNull(req.query.buildClass);
    const stage = queryStringOrNull(req.query.stage) ?? 'chat';
    const taskClass = queryStringOrNull(req.query.taskClass);

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

    const sensitivityClassRaw = queryStringOrNull(req.query.sensitivityClass);
    // Fail-closed placeholder (plan §3.2 L2): an unresolved sensitivity
    // class defaults to the MOST restrictive value rather than the least.
    let sensitivityClass: RoutingDataClassification = 'client-confidential';
    if (sensitivityClassRaw !== null) {
      if (!isRoutingDataClassification(sensitivityClassRaw)) {
        return respondInvalidQuery(
          res,
          `\`sensitivityClass\` must be one of: ${ROUTING_DATA_CLASSIFICATIONS.join(', ')}`,
        );
      }
      sensitivityClass = sensitivityClassRaw;
    }

    const promptText = queryStringOrNull(req.query.promptText);
    const contextTokensResult = parseOptionalQueryInt(req.query.contextEstimateTokens, 'contextEstimateTokens', {
      min: 0,
    });
    if (!contextTokensResult.ok) return respondInvalidQuery(res, contextTokensResult.message);
    const contextEstimateTokens = contextTokensResult.value ?? (promptText !== null ? estimatePromptTokens(promptText) : 0);

    const policy = loadRoutingPolicy();
    const laneMeters = db ? computeLaneMeters(db) : [];
    const laneMetersRecord = Object.fromEntries(laneMeters.map((m) => [m.lane, m.throttleEvents]));

    const key: RoutingKey =
      templateId !== null && buildClass !== null
        ? { templateId, buildClass, stage, contextEstimateTokens, laneMeters: laneMetersRecord }
        : { templateId, buildClass: null, stage, contextEstimateTokens, laneMeters: laneMetersRecord };

    const decision = decideRouting({ policy, key, sensitivityClass, laneMeters, taskClass });
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
    const windowMsResult = parseOptionalQueryInt(req.query.windowMs, 'windowMs', EPOCH_MS_BOUNDS);
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
    const sinceMsResult = parseOptionalQueryInt(req.query.sinceMs, 'sinceMs', EPOCH_MS_BOUNDS);
    if (!sinceMsResult.ok) return respondInvalidQuery(res, sinceMsResult.message);
    const untilMsResult = parseOptionalQueryInt(req.query.untilMs, 'untilMs', EPOCH_MS_BOUNDS);
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
