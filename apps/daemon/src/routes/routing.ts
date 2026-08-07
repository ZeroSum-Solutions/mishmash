// /api/routing/* -- routing capability HTTP surface (WR wave, plan
// docs/plans/2026-08-05-model-routing-system.md §3.4 capability closure).
// Contracts: packages/contracts/src/api/routing-{policy,decision,
// telemetry}.ts. /decision/preview now calls the real advisory decision
// engine (apps/daemon/src/routing/decision.ts, t5) over the loaded policy +
// live lane meters; admission control (budgets, t6) and dispatch-time
// enforcement (t9) still land in later WR tranches -- see
// docs/plans/waves/WR-routing.md's Tranche register.
//
// t8 addition (plan §3.2 L3): GET /api/routing/gates (registry) and POST
// /api/routing/gates/run (execute selected deterministic gates + classify
// the cascade trigger). `projectsRoot`, a new optional 4th
// `registerRoutingRoutes` parameter, is the ONLY root `/gates/run`'s
// `artifactDir` may resolve within -- see `resolveArtifactDirWithinRoot`'s
// own doc comment for the traversal check. Omitting `projectsRoot` (the
// bare-express test harness other routing tests already use, when it does
// not care about gates) makes `/gates/run` respond 400 rather than ever
// running a gate against an unvalidated path.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import express, { type Express, type Request, type Response } from 'express';
import type {
  GateRunResultDTO,
  RoutingDataClassification,
  RoutingDecisionPreviewResponse,
  RoutingGatesRegistryResponse,
  RoutingGatesRunResponse,
  RoutingKey,
  RoutingMetersResponse,
  RoutingPolicyResponse,
  RoutingRatesResponse,
  RoutingTelemetryListResponse,
} from '@open-design/contracts';
import {
  advanceGateCascadeState,
  classifyCascadeTrigger,
  computeRoutingRates,
  DETERMINISTIC_GATE_IDS,
  decideRouting,
  estimatePromptTokens,
  GATE_REGISTRY,
  GateRunnerInputError,
  GateSelectionError,
  getGateCascadeState,
  headroomFractionOf,
  loadRoutingPolicy,
  nextEscalationTier,
  recordGateOutcomes,
  runGates,
  verificationCostForTierUsd,
  type DeterministicGateId,
} from '../routing/index.js';
import {
  computeBuildSpendUsd,
  computeDaySpendUsd,
  computeStageSpendUsd,
  computeLaneMeters,
  ensureRoutingTelemetryTable,
  getRoutingTelemetryByRunId,
  listRoutingTelemetry,
  recordRoutingTelemetry,
} from '../routing/telemetry.js';
import { computeCooldownStatuses, resolveCooldownConfig } from '../routing/reliability.js';

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
  /** t6 (plan §3.1/§3.2 L4 admission control): optional -- omit for
   * non-build-scoped previews (general chat). When supplied, the preview
   * engages real budget admission control (see `runDecisionPreview`'s own
   * comment on why `db` gates this). */
  buildId: unknown;
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

  // t6 (plan §3.1/§3.2 L4 admission control): only engaged when `db` is
  // available -- the real daemon boot always passes one (see
  // registerRoutingRoutes's own doc comment), but the bare-express test
  // harness other routing tests already use may omit it. Without a `db`
  // there is no spend to look up, so admission stays 'not-evaluated' the
  // same way `/api/routing/meters` degrades to an empty array without one.
  //
  // t7 fix-round (Sol MED-3): the preview endpoint engaged admission control
  // but never cooldown -- a candidate could be actively cooling (plan §3.2
  // L1) and the preview would still show it as freely selectable, since
  // `decideRouting`'s optional `cooldown` input was never populated here.
  // One timestamped `computeCooldownStatuses` snapshot per request, the same
  // "arrives as a plain argument" shape `admission`/`laneMeters` already
  // use -- gated on `db` for the identical reason admission is (no db, no
  // cooldown table to query).
  const buildId = queryStringOrNull(raw.buildId);
  const now = new Date();
  const decision = decideRouting({
    policy,
    key,
    sensitivityClass,
    laneMeters,
    taskClass,
    ...(db
      ? {
          admission: {
            buildId,
            spendLookup: {
              stageSpentUsd: buildId !== null ? computeStageSpendUsd(db, buildId, key.stage).totalCostUsd : 0,
              buildSpentUsd: buildId !== null ? computeBuildSpendUsd(db, buildId).totalCostUsd : 0,
              daySpentUsd: computeDaySpendUsd(db, ...utcDayWindowMs(new Date())).totalCostUsd,
            },
            now,
          },
          cooldown: { statuses: computeCooldownStatuses(db, resolveCooldownConfig(policy), now) },
        }
      : {}),
  });
  return { status: 200, body: { key, decision } };
}

/** `[dayStartMs, dayEndMsExclusive)` for the UTC calendar day containing
 * `now` -- the day-cap window `computeDaySpendUsd` aggregates over. A fixed,
 * deterministic definition of "today" rather than a rolling trailing-24h
 * window, so two previews issued moments apart against the same day agree
 * on which rows count. */
function utcDayWindowMs(now: Date): [number, number] {
  const dayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return [dayStartMs, dayStartMs + 24 * 60 * 60 * 1000];
}

/**
 * t8 addition (hardened, Sol HIGH-1 fix-round): resolves `requested`
 * (absolute or project-relative) and confirms its CANONICAL (symlink-
 * resolved) form stays within `root`'s own canonical form -- the daemon
 * data contract's "stay under resolved roots" rule (AGENTS.md).
 *
 * A purely LEXICAL check (`path.relative`/`startsWith` over
 * `path.resolve`d strings, this function's pre-fix-round shape) is
 * defeated by a symlink: e.g. `projectsRoot/proj-1` could itself be a
 * symlink to `/etc`, in which case `proj-1/anything` looks lexically
 * contained but resolves on disk to `/etc/anything`. `fs.realpathSync` on
 * BOTH sides before comparing closes that gap. This also means
 * `artifactDir` must actually EXIST (realpath fails on a missing path) --
 * a gate run against a directory that doesn't exist has no legitimate use
 * case, so requiring existence here (rather than a more complex
 * longest-existing-ancestor walk) is a deliberate simplification, not an
 * oversight.
 */
function resolveArtifactDirWithinRoot(root: string, requested: unknown): { ok: true; resolved: string } | { ok: false; message: string } {
  if (typeof requested !== 'string' || requested.length === 0) {
    return { ok: false, message: '`artifactDir` must be a nonempty string.' };
  }
  let canonicalRoot: string;
  try {
    canonicalRoot = fs.realpathSync(path.resolve(root));
  } catch (err) {
    return { ok: false, message: `configured project root is not resolvable: ${(err as Error).message}` };
  }
  const lexicallyResolved = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(canonicalRoot, requested);
  let canonicalRequested: string;
  try {
    canonicalRequested = fs.realpathSync(lexicallyResolved);
  } catch (err) {
    return { ok: false, message: `\`artifactDir\` does not exist or is not accessible: ${(err as Error).message}` };
  }
  const relative = path.relative(canonicalRoot, canonicalRequested);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return {
      ok: false,
      message: '`artifactDir` must resolve within the configured project root (canonical-path check, symlink-safe) -- traversal outside it is rejected.',
    };
  }
  return { ok: true, resolved: canonicalRequested };
}

function isDeterministicGateId(value: unknown): value is DeterministicGateId {
  return typeof value === 'string' && (DETERMINISTIC_GATE_IDS as readonly string[]).includes(value);
}

/**
 * `db` is optional so a route-level test (or a future caller with no
 * durable telemetry yet) can register these routes without a database --
 * `/api/routing/meters` and `/api/routing/telemetry` degrade to an honest
 * empty result rather than throwing. The real daemon boot
 * (apps/daemon/src/server.ts) always passes its resolved db.
 *
 * `projectsRoot` (t8 addition) is optional for the same reason: a caller
 * that never exercises `/gates/run` can omit it, and that route responds
 * 400 rather than resolving `artifactDir` against an undefined root.
 */
export function registerRoutingRoutes(app: Express, db?: Database.Database, projectsRoot?: string): void {
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
        buildId: req.query.buildId,
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
        buildId: body.buildId,
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
  //
  // t7 addition (plan §3.2 L1 reliability): `cooldowns` -- per-runtime/
  // per-lane cooldown status from `apps/daemon/src/routing/reliability.ts`.
  // Additive envelope field (RoutingMetersResponse#cooldowns is optional),
  // omitted entirely (not a fabricated empty array) when `db` is absent --
  // same "not evaluated" spirit as `laneMeters` degrading to `[]` only
  // because an empty lane list IS a meaningful answer for that field, while
  // omitting `cooldowns` distinguishes "no db to ask" from "asked, found
  // none."
  app.get('/api/routing/meters', (req: Request, res: Response) => {
    const windowMsResult = parseOptionalQueryInt(req.query.windowMs, 'windowMs', EPOCH_MS_BOUNDS);
    if (!windowMsResult.ok) return respondInvalidQuery(res, windowMsResult.message);
    const laneMeters = db ? computeLaneMeters(db, windowMsResult.value) : [];
    const response: RoutingMetersResponse = {
      laneMeters,
      ...(db ? { cooldowns: computeCooldownStatuses(db, resolveCooldownConfig(loadRoutingPolicy()), new Date()) } : {}),
    };
    res.json(response);
  });

  // GET /api/routing/rates -- escalation rate + gate pass rate (overall and
  // by stage/template) + every lane's own meter, in one response (t9, plan
  // §5 P2 gate: "escalation/pass rates visible"; WR-routing.md CWR-P2-4's
  // lane-meter closure). `?windowMs=` scopes the aggregation to the trailing
  // window, same convention as `/api/routing/meters`. `od route rates
  // --json` (and a bare `od route --json` with no subcommand) reads this
  // exact shape -- see apps/daemon/src/routing/dispatch.ts's
  // `computeRoutingRates` for why `laneMeters` is guaranteed non-empty even
  // against a brand-new daemon data dir with zero routed runs yet.
  app.get('/api/routing/rates', (req: Request, res: Response) => {
    const windowMsResult = parseOptionalQueryInt(req.query.windowMs, 'windowMs', EPOCH_MS_BOUNDS);
    if (!windowMsResult.ok) return respondInvalidQuery(res, windowMsResult.message);
    if (!db) {
      const empty: RoutingRatesResponse = {
        windowMs: windowMsResult.value ?? null,
        totalRuns: 0,
        escalationRate: 0,
        passRate: 0,
        gateCascadeRuns: 0,
        gateCascadeEscalationRate: 0,
        gateCascadePassRate: 0,
        laneMeters: {},
        byStage: [],
      };
      return res.json(empty);
    }
    const response: RoutingRatesResponse = computeRoutingRates(db, windowMsResult.value);
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

  // GET /api/routing/gates -- the L3 gate registry (deterministic +
  // stochastic class definitions, t8, plan §3.2 L3). `runnable` mirrors
  // gates.ts's own split: every deterministic entry is executable by
  // POST /gates/run below; every stochastic entry is advisory-only and has
  // no run() anywhere in the daemon (never executed by this surface).
  app.get('/api/routing/gates', (_req: Request, res: Response) => {
    const response: RoutingGatesRegistryResponse = {
      gates: GATE_REGISTRY.map((gate) => ({
        id: gate.id,
        class: gate.class,
        label: gate.label,
        description: gate.description,
        runnable: gate.class === 'deterministic',
      })),
    };
    res.json(response);
  });

  // POST /api/routing/gates/run -- executes selected deterministic gates
  // against a lane-A artifact directory, then classifies the cascade
  // trigger. `artifactDir` is validated to resolve within `projectsRoot`
  // (see resolveArtifactDirWithinRoot's own doc comment, symlink-safe) --
  // no traversal, and no `db`/`projectsRoot` configured is an honest 400,
  // never a run against an unvalidated path or a silent no-op.
  //
  // t8 fix-round (Sol HIGH-5): `currentTier`/`gateSpendSoFarUsd` are NO
  // LONGER accepted as client input (a caller could otherwise always
  // assert "cheap"/"$0 spent" and evade both the frontier ceiling and the
  // gate-tax cap). Cascade state is tracked server-side per `buildId`
  // (`getGateCascadeState`/`advanceGateCascadeState`, apps/daemon/src/
  // routing/gates.ts) -- this route reads it, classifies, and (only when
  // it actually decides to escalate) persists the advance.
  //
  // t8 fix-round residue (Sol HIGH-5 residue): `nextEstimatedVerificationCostUsd`
  // is ALSO no longer accepted as client input -- it defaulted to `0` when
  // omitted, letting a caller understate (or entirely skip) the persisted
  // gate-tax spend and evade the cap that way instead. The route now prices
  // the NEXT tier's verification attempt itself, server-side, via
  // `verificationCostForTierUsd(policy, nextEscalationTier(cascadeState.tier))`
  // -- `RoutingPolicyBudgetCeilings#verificationCostPerTierUsd`, an
  // additive operator-tunable policy field.
  //
  // t8 fix-round (Sol MED-8): gate outcomes are now wired into telemetry.
  // `runId`/`attempt` may be supplied (a real dispatch's identifiers, whose
  // telemetry row must already exist) or omitted (a standalone gate probe
  // with no real dispatch behind it gets a SERVER-SYNTHESIZED
  // `gates-run-<uuid>` id, `runIdSynthetic: true` in the response) -- the
  // synthetic case inserts its own minimal telemetry row (sentinel
  // `routedModel`/`routedLane: 'none'`) so `recordGateOutcomes` always has
  // a row to attach to. Both writes happen inside one `db.transaction`.
  //
  // Scope note (Sol HIGH-4b): this route NEVER calls `recordBootstrapBaseline`
  // or `runNegativeControlCheck` -- SSIM baseline promotion stays
  // programmatic-only. See gates.ts's `recordBootstrapBaseline` doc comment
  // for why (an HTTP request has no trustworthy way to assert "this is the
  // designated first render," and this tranche adds no per-buildId
  // concurrency control a promotion race would need).
  app.post('/api/routing/gates/run', express.json({ limit: '64kb' }), async (req: Request, res: Response) => {
    if (!projectsRoot) {
      return res.status(400).json({
        error: { code: 'gates-run-unavailable', message: 'this daemon instance has no configured project root -- POST /api/routing/gates/run is unavailable.' },
      });
    }
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : {};

    let gateSelection: readonly DeterministicGateId[] | 'all' = 'all';
    if (body.gates !== undefined) {
      if (!Array.isArray(body.gates) || body.gates.length === 0 || !body.gates.every(isDeterministicGateId)) {
        return respondInvalidQuery(
          res,
          `\`gates\` must be a nonempty array drawn from: ${DETERMINISTIC_GATE_IDS.join(', ')}.`,
        );
      }
      gateSelection = body.gates;
    }

    const buildId = body.buildId === undefined ? null : queryStringOrNull(body.buildId);

    if (body.currentTier !== undefined || body.gateSpendSoFarUsd !== undefined || body.nextEstimatedVerificationCostUsd !== undefined) {
      return respondInvalidQuery(
        res,
        '`currentTier`/`gateSpendSoFarUsd`/`nextEstimatedVerificationCostUsd` are no longer accepted -- cascade tier and cumulative gate-tax spend are tracked server-side per `buildId`, and the verification cost is priced server-side from policy (RoutingPolicyBudgetCeilings#verificationCostPerTierUsd); a client can no longer assert its own progress or understate its cost.',
      );
    }

    let runId: string | undefined;
    let attempt = 0;
    if (db) {
      const suppliedRunId = queryStringOrNull(body.runId);
      if (body.attempt !== undefined) {
        const attemptResult = parseOptionalQueryInt(body.attempt, 'attempt', { min: 0, integer: true });
        if (!attemptResult.ok) return respondInvalidQuery(res, attemptResult.message);
        attempt = attemptResult.value ?? 0;
      }
      runId = suppliedRunId ?? undefined;
    }

    // Sol review MED-7 (fix-round): `artifactDir`, `buildId`, and
    // `(runId, attempt)` were each independently caller-selected -- nothing
    // stopped one request from naming a REAL `runId` belonging to build A
    // while supplying build B's `buildId` (advancing build B's cascade tier
    // off of build A's artifact/gate results) or an `artifactDir` under a
    // project the named run never touched (attaching another project's
    // artifact evidence to this run's telemetry row). When `runId` is
    // supplied, this binds ownership BEFORE ever resolving `artifactDir` or
    // running a single gate: the existing telemetry row for
    // `(runId, attempt)` is the source of truth for which build/project
    // this request is allowed to touch, not the caller's own claims about
    // them.
    let artifactRoot = projectsRoot;
    if (db && runId !== undefined) {
      const existingRow = getRoutingTelemetryByRunId(db, runId, attempt);
      if (!existingRow) {
        return respondInvalidQuery(
          res,
          `no routing_telemetry row for (runId=${runId}, attempt=${attempt}) -- a supplied \`runId\` must already have a recorded dispatch (recordDispatchIntent) before gate outcomes/ownership can be bound to it; omit \`runId\` for a standalone probe.`,
        );
      }
      if (existingRow.buildId !== buildId) {
        return respondInvalidQuery(
          res,
          `\`buildId\` ("${buildId ?? 'null'}") does not match the buildId ("${existingRow.buildId ?? 'null'}") already recorded for (runId=${runId}, attempt=${attempt}) -- refusing to advance a different build's cascade state or attach outcomes under a mismatched buildId.`,
        );
      }
      const requestedProjectId = queryStringOrNull(body.projectId);
      if (requestedProjectId !== null && requestedProjectId !== existingRow.projectId) {
        return respondInvalidQuery(
          res,
          `\`projectId\` ("${requestedProjectId}") does not match the projectId ("${existingRow.projectId}") already recorded for (runId=${runId}, attempt=${attempt}).`,
        );
      }
      // The daemon data contract's project root shape (AGENTS.md, "Daemon
      // data directory contract"): every managed project's own artifacts
      // live under `PROJECTS_DIR/<projectId>/...`. Scoping `artifactDir`'s
      // containment check to THIS run's owning project subtree (rather than
      // the global `projectsRoot`) closes the cross-project artifact
      // injection this finding describes -- a caller can no longer name a
      // real `(runId, attempt)` from project A while pointing `artifactDir`
      // into project B's directory.
      artifactRoot = path.join(projectsRoot, existingRow.projectId);
    }

    const pathResult = resolveArtifactDirWithinRoot(artifactRoot, body.artifactDir);
    if (!pathResult.ok) {
      return respondInvalidQuery(res, pathResult.message);
    }

    let results;
    try {
      results = await runGates(pathResult.resolved, gateSelection, {
        buildId,
        ...(db ? { db } : {}),
      });
    } catch (err) {
      if (err instanceof GateRunnerInputError || err instanceof GateSelectionError) {
        return respondInvalidQuery(res, err.message);
      }
      throw err;
    }

    const policy = loadRoutingPolicy();
    // Server-persisted cascade state, keyed by buildId -- NEVER client
    // input (Sol HIGH-5). No db or no buildId means there is nothing to
    // persist against, so every such call is evaluated fresh at cheap/$0.
    const cascadeState = db && buildId !== null ? getGateCascadeState(db, buildId) : { tier: 'cheap' as const, spentUsd: 0 };
    // Sol HIGH-5 residue: priced SERVER-SIDE from policy, never accepted
    // from the client -- the price of the tier THIS call would escalate TO
    // if it decides to escalate at all (classifyCascadeTrigger itself
    // decides whether escalation actually happens; this is only the
    // candidate cost fed into its gate-tax check).
    const nextEstimatedVerificationCostUsd = verificationCostForTierUsd(policy, nextEscalationTier(cascadeState.tier));
    const cascade = classifyCascadeTrigger({
      gateResults: results,
      currentTier: cascadeState.tier,
      gateTaxCapUsd: policy.budgetCeilings.gateTaxCapUsd ?? null,
      gateSpendSoFarUsd: cascadeState.spentUsd,
      nextEstimatedVerificationCostUsd,
      headroomFraction: headroomFractionOf(policy),
    });
    // Advance ONLY when actually escalating -- an over-cap or already-at-
    // frontier classification must never move the persisted tier or add
    // to spend, since nothing was actually escalated in that case.
    if (cascade.escalate && buildId !== null && db) {
      advanceGateCascadeState(db, buildId, cascade.tier, nextEstimatedVerificationCostUsd);
    }

    let runIdSynthetic: boolean | undefined;
    if (db) {
      runIdSynthetic = runId === undefined;
      const resolvedRunId = runId ?? `gates-run-${randomUUID()}`;
      const resolvedAttempt = attempt;
      try {
        const persist = db.transaction(() => {
          if (runIdSynthetic) {
            ensureRoutingTelemetryTable(db);
            const nowIso = new Date().toISOString();
            recordRoutingTelemetry(db, {
              runId: resolvedRunId,
              attempt: resolvedAttempt,
              projectId: 'gates-run',
              buildId,
              stage: 'gates-run',
              templateId: null,
              designSystem: null,
              routedModel: 'none',
              observedModel: null,
              routedLane: 'none',
              observedLane: null,
              tokens: { input: 0, output: 0, cacheReadInput: 0 },
              cacheHits: 0,
              latencyMs: 0,
              costUsd: 0,
              costEstimated: true,
              gateOutcomes: {},
              escalated: cascade.escalate,
              policyVersion: policy.policyVersion,
              createdAt: nowIso,
              recordedAt: nowIso,
            });
          }
          recordGateOutcomes(db, resolvedRunId, resolvedAttempt, results, cascade.escalate);
        });
        persist();
        runId = resolvedRunId;
        attempt = resolvedAttempt;
      } catch (err) {
        return respondInvalidQuery(
          res,
          `could not record gate outcomes for (runId=${resolvedRunId}, attempt=${resolvedAttempt}): ${(err as Error).message}`,
        );
      }
    }

    const resultDtos: GateRunResultDTO[] = results.map((r) => ({ id: r.id, class: r.class, status: r.status, evidence: r.evidence, durationMs: r.durationMs }));
    const response: RoutingGatesRunResponse = {
      artifactDir: path.relative(projectsRoot, pathResult.resolved) || '.',
      results: resultDtos,
      cascade,
      ...(runId !== undefined ? { runId, attempt, runIdSynthetic: runIdSynthetic ?? false } : {}),
    };
    res.json(response);
  });
}
