// /api/routing/* -- routing capability HTTP surface (WR wave, plan
// docs/plans/2026-08-05-model-routing-system.md §3.4 capability closure).
// Contracts: packages/contracts/src/api/routing-{policy,decision,
// telemetry}.ts. /decision/preview now calls the real advisory decision
// engine (apps/daemon/src/routing/decision.ts, t5) over the loaded policy +
// live lane meters; admission control (budgets, t6) and dispatch-time
// enforcement (t9) still land in later WR tranches -- see
// docs/plans/waves/WR-routing.md's Tranche register.
import type Database from 'better-sqlite3';
import express, { type Express, type Request, type Response } from 'express';
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

/** Sol review MED-4 (fix commit): a token-count query/body value must be an
 * INTEGER within a sane bound, not just any finite number -- `integer: true`
 * rejects `3.5`; `max` (used by the `contextEstimateTokens` bound below,
 * 8,000,000) rejects an absurd value before it ever reaches the engine. */
function parseOptionalQueryInt(
  raw: unknown,
  name: string,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): QueryIntResult {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && raw.length > 0) {
    n = Number(raw);
  } else {
    return { ok: false, message: `\`${name}\` must be a finite number` };
  }
  if (!Number.isFinite(n)) {
    return { ok: false, message: `\`${name}\` must be a finite number` };
  }
  if (opts.integer === true && !Number.isInteger(n)) {
    return { ok: false, message: `\`${name}\` must be an integer` };
  }
  if (opts.min !== undefined && n < opts.min) {
    return { ok: false, message: `\`${name}\` must be >= ${opts.min}` };
  }
  if (opts.max !== undefined && n > opts.max) {
    return { ok: false, message: `\`${name}\` must be <= ${opts.max}` };
  }
  return { ok: true, value: n };
}

/** Sol review MED-4: `contextEstimateTokens` is a token COUNT, never
 * arbitrary -- bounded well above any realistic composed-prompt size so a
 * malicious/malformed caller can't force a pathological allocation or
 * comparison downstream, while staying far above what any real prompt would
 * ever estimate to. */
const MAX_CONTEXT_ESTIMATE_TOKENS = 8_000_000;

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
 * Sol review MED-5: raw (unvalidated, `unknown`-typed) input to the decision
 * preview, sourced from EITHER `req.query` (GET, values always strings) OR
 * `req.body` (POST, values may already be the right JS type). Kept as a
 * plain object so `runDecisionPreview` below is the ONE place that parses/
 * validates -- GET and POST never duplicate that logic.
 */
interface RawDecisionPreviewInput {
  templateId: unknown;
  buildClass: unknown;
  stage: unknown;
  taskClass: unknown;
  sensitivityClass: unknown;
  contextEstimateTokens: unknown;
  promptText: unknown;
}

type DecisionPreviewResult =
  | { status: 200; body: RoutingDecisionPreviewResponse }
  | { status: 400; body: { error: { code: string; message: string } } };

/**
 * Shared body for GET and POST `/api/routing/decision/preview` (Sol review
 * MED-5): validates the routing-key shape, the sensitivity class, and the
 * context-token bound, then calls the real `decideRouting` engine. Neither
 * HTTP verb duplicates this logic -- only how they SOURCE `raw` differs.
 */
function runDecisionPreview(raw: RawDecisionPreviewInput, db: Database.Database | undefined): DecisionPreviewResult {
  const templateId = queryStringOrNull(raw.templateId);
  const buildClass = queryStringOrNull(raw.buildClass);
  const stage = queryStringOrNull(raw.stage) ?? 'chat';
  const taskClass = queryStringOrNull(raw.taskClass);

  if (buildClass !== null && templateId === null) {
    return {
      status: 400,
      body: {
        error: {
          code: 'invalid-routing-key',
          message:
            'buildClass may only be supplied together with templateId -- WR-routing.md\'s fallback table has no build-class-only shape.',
        },
      },
    };
  }

  const sensitivityClassRaw = queryStringOrNull(raw.sensitivityClass);
  // Fail-closed placeholder (plan §3.2 L2): an unresolved sensitivity class
  // defaults to the MOST restrictive value rather than the least.
  let sensitivityClass: RoutingDataClassification = 'client-confidential';
  if (sensitivityClassRaw !== null) {
    if (!isRoutingDataClassification(sensitivityClassRaw)) {
      return {
        status: 400,
        body: { error: { code: 'invalid-query-param', message: `\`sensitivityClass\` must be one of: ${ROUTING_DATA_CLASSIFICATIONS.join(', ')}` } },
      };
    }
    sensitivityClass = sensitivityClassRaw;
  }

  const promptText = queryStringOrNull(raw.promptText);
  const contextTokensResult = parseOptionalQueryInt(raw.contextEstimateTokens, 'contextEstimateTokens', {
    min: 0,
    max: MAX_CONTEXT_ESTIMATE_TOKENS,
    integer: true,
  });
  if (!contextTokensResult.ok) {
    return { status: 400, body: { error: { code: 'invalid-query-param', message: contextTokensResult.message } } };
  }
  const contextEstimateTokens = contextTokensResult.value ?? (promptText !== null ? estimatePromptTokens(promptText) : 0);

  const policy = loadRoutingPolicy();
  const laneMeters = db ? computeLaneMeters(db) : [];
  const laneMetersRecord = Object.fromEntries(laneMeters.map((m) => [m.lane, m.throttleEvents]));

  const key: RoutingKey =
    templateId !== null && buildClass !== null
      ? { templateId, buildClass, stage, contextEstimateTokens, laneMeters: laneMetersRecord }
      : { templateId, buildClass: null, stage, contextEstimateTokens, laneMeters: laneMetersRecord };

  const decision = decideRouting({ policy, key, sensitivityClass, laneMeters, taskClass });
  return { status: 200, body: { key, decision } };
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
  //
  // Sol review MED-5 (confidentiality): `promptText` is REJECTED over GET --
  // a query string is logged (access logs, proxy logs, shell/browser
  // history) far more readily than a request body, and a composed prompt
  // preview can carry client-confidential content. GET stays for
  // param-only previews (no prompt text involved); a caller that needs
  // `promptText`-derived estimation uses POST below instead.
  app.get('/api/routing/decision/preview', (req: Request, res: Response) => {
    // Key-presence check, not a scalar check: repeated query params arrive as
    // arrays and would bypass a string-typed rejection (Sol t5 confirm, M5).
    if (Object.prototype.hasOwnProperty.call(req.query, 'promptText')) {
      return respondInvalidQuery(
        res,
        '`promptText` is not accepted over GET (query strings are logged in access/proxy/shell history) -- POST JSON to this same path instead.',
      );
    }
    const result = runDecisionPreview(
      {
        templateId: req.query.templateId,
        buildClass: req.query.buildClass,
        stage: req.query.stage,
        taskClass: req.query.taskClass,
        sensitivityClass: req.query.sensitivityClass,
        contextEstimateTokens: req.query.contextEstimateTokens,
        promptText: undefined,
      },
      db,
    );
    res.status(result.status).json(result.body);
  });

  // POST /api/routing/decision/preview -- same engine, JSON body instead of
  // query params, so `promptText` (potentially client-confidential) never
  // touches a URL. Sol review MED-5: a narrow `express.json({ limit:
  // '256kb' })` scoped to just this route (mirrors attribution.ts's
  // per-route body-limit pattern) -- generous for a composed-prompt
  // preview, far below the daemon's blanket 4mb default. Also mounted
  // path-scoped in apps/daemon/src/server.ts AHEAD of that blanket parser
  // so the narrower limit actually applies in the real daemon (a body
  // parser is a no-op once an earlier one already consumed the body); this
  // inline copy is what makes the route self-contained for the bare-express
  // test harness other routing tests already use.
  app.post('/api/routing/decision/preview', express.json({ limit: '256kb' }), (req: Request, res: Response) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};
    const result = runDecisionPreview(
      {
        templateId: body.templateId,
        buildClass: body.buildClass,
        stage: body.stage,
        taskClass: body.taskClass,
        sensitivityClass: body.sensitivityClass,
        contextEstimateTokens: body.contextEstimateTokens,
        promptText: body.promptText,
      },
      db,
    );
    res.status(result.status).json(result.body);
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
