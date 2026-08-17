// Anomaly log HTTP surface, plus the daemon's own detector.
//
// Read/write/clear so a person or an agent can work the log during a testing
// session, and one middleware that turns the daemon's own HTTP behaviour into
// records. The middleware is where most anomalies come from without anyone
// writing a probe: every failing or slow API call is caught in one place,
// whether the caller was the web UI, the `od` CLI, or an MCP client.

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import {
  type AnomalyKind,
  type AnomalySeverity,
  type ReportAnomalyRequest,
  isAnomalyKind,
  isAnomalySeverity,
} from '@open-design/contracts';

import { type AnomalyLog, createAnomalyLog } from '../anomaly-log.js';
import type { createFilesystemWriteGateway } from '../filesystem/write-gateway.js';

/**
 * A request slower than this is recorded. Chosen as the point where a person
 * waiting on the UI stops reading it as "working" and starts reading it as
 * "stuck". Long-lived transports are exempted below, not measured against this.
 */
export const SLOW_REQUEST_MS = 4_000;

/**
 * Endpoints whose responses are long-lived BY DESIGN — server-sent event
 * streams, agent runs, terminal attachments. Their duration measures how long
 * the user kept the stream open, so timing them would fill the log with
 * "anomalies" that are the feature working correctly.
 */
const LONG_LIVED_PATH_PATTERNS: readonly RegExp[] = [
  /^\/api\/[^/]*events/i,
  /^\/api\/runs\/[^/]+\/stream/i,
  /^\/api\/chat\b/i,
  /^\/api\/terminal\b/i,
  /^\/api\/library\/events/i,
  /^\/api\/observability\/event/i,
  // The anomaly surface itself, so a slow write can never manufacture a record
  // about being slow — which would then be written, timed, and recorded again.
  /^\/api\/anomalies/i,
];

function isLongLived(path: string): boolean {
  return LONG_LIVED_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Express route patterns keep the caller's ids out of the log's summaries
 * (`/api/projects/:id/files` rather than a specific project's path), so records
 * group by the endpoint that misbehaved instead of fragmenting per request.
 * Falls back to the concrete path when no route matched — a 404 has no route.
 */
function routeLabel(req: Request): string {
  const pattern = (req.route as { path?: string } | undefined)?.path;
  const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  if (typeof pattern === 'string' && pattern.length > 0) return `${base}${pattern}`;
  // `req.path` excludes the query string, which is where tokens tend to live.
  return req.path;
}

/**
 * Records the daemon's own HTTP failures and stalls.
 *
 * Mounted before the route handlers and reporting on `finish`, so it observes
 * every registered route without any of them knowing it exists. It only ever
 * reads response metadata — status and elapsed time — so it cannot alter a
 * response or delay one.
 */
export function createAnomalyHttpObserver(log: AnomalyLog) {
  return function anomalyHttpObserver(req: Request, res: Response, next: NextFunction): void {
    // Only the API surface. Static assets and preview bytes are served in bulk
    // and their timings say more about file size than about product health.
    if (!req.path.startsWith('/api/')) {
      next();
      return;
    }
    if (isLongLived(req.path)) {
      next();
      return;
    }
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const elapsedMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
      const status = res.statusCode;
      const label = routeLabel(req);

      if (status >= 500) {
        void log.append(
          {
            kind: 'request-failed',
            severity: 'error',
            summary: `${req.method} ${label} answered ${status}`,
            detail: { method: req.method, route: label, status, durationMs: elapsedMs },
          },
          'daemon',
        );
        return;
      }
      // A 4xx is usually the caller being told "no" correctly, which is not an
      // anomaly. 408 and 429 are the exceptions: both mean the daemon could not
      // serve a request it should have been able to serve.
      if (status === 408 || status === 429) {
        void log.append(
          {
            kind: 'request-failed',
            severity: 'warn',
            summary: `${req.method} ${label} answered ${status}`,
            detail: { method: req.method, route: label, status, durationMs: elapsedMs },
          },
          'daemon',
        );
        return;
      }
      if (elapsedMs >= SLOW_REQUEST_MS) {
        void log.append(
          {
            kind: 'request-slow',
            severity: 'warn',
            summary: `${req.method} ${label} took ${(elapsedMs / 1000).toFixed(1)}s`,
            detail: { method: req.method, route: label, status, durationMs: elapsedMs },
          },
          'daemon',
        );
      }
    });
    next();
  };
}

export interface AnomalySurfaceOptions {
  /** The daemon's resolved data root — see the data-directory contract. */
  dataDir: string;
  /**
   * The daemon's audit-wrapped write-gateway factory, so this log's writes join
   * the same audit stream as every other daemon write.
   */
  createGateway?: typeof createFilesystemWriteGateway;
}

export interface DaemonAnomalies {
  log: AnomalyLog;
  /**
   * Mount with `app.use` as early as possible. Express matches its stack in
   * registration order, so an observer added after a route never runs for that
   * route — mounting it late would silently narrow what it can see.
   */
  observer: ReturnType<typeof createAnomalyHttpObserver>;
}

/**
 * Builds the log and its observer WITHOUT registering routes, so the observer
 * can be mounted early (before every route) while the endpoints register later,
 * behind the API auth middleware, alongside the other route modules.
 */
export function createAnomalySurface(options: AnomalySurfaceOptions): DaemonAnomalies {
  const log = createAnomalyLog({
    dataDir: options.dataDir,
    ...(options.createGateway ? { createGateway: options.createGateway } : {}),
  });
  return { log, observer: createAnomalyHttpObserver(log) };
}

function parsePositiveInt(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function registerAnomalyRoutes(app: Express, deps: { log: AnomalyLog }): void {
  const { log } = deps;

  app.post('/api/anomalies', express.json({ limit: '64kb' }), async (req, res) => {
    const body = (req.body ?? {}) as Partial<ReportAnomalyRequest>;
    if (!isAnomalyKind(body.kind)) {
      res.status(400).json({ ok: false, error: 'unknown or missing `kind`' });
      return;
    }
    if (!isAnomalySeverity(body.severity)) {
      res.status(400).json({ ok: false, error: 'unknown or missing `severity`' });
      return;
    }
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
    if (summary === '') {
      res.status(400).json({ ok: false, error: 'missing `summary`' });
      return;
    }
    // `source` is stamped, not accepted: a web client cannot file a record as
    // though the daemon had observed it.
    const id = await log.append(
      {
        kind: body.kind,
        severity: body.severity,
        summary,
        ...(typeof body.projectId === 'string' ? { projectId: body.projectId } : {}),
        ...(typeof body.runId === 'string' ? { runId: body.runId } : {}),
        ...(body.detail != null && typeof body.detail === 'object' && !Array.isArray(body.detail)
          ? { detail: body.detail as Record<string, unknown> }
          : {}),
      },
      'web',
    );
    res.json({ ok: true, id });
  });

  app.get('/api/anomalies', async (req, res) => {
    const kindParam = typeof req.query.kind === 'string' ? req.query.kind : undefined;
    const severityParam = typeof req.query.severity === 'string' ? req.query.severity : undefined;
    if (kindParam != null && !isAnomalyKind(kindParam)) {
      res.status(400).json({ ok: false, error: `unknown kind: ${kindParam}` });
      return;
    }
    if (severityParam != null && !isAnomalySeverity(severityParam)) {
      res.status(400).json({ ok: false, error: `unknown severity: ${severityParam}` });
      return;
    }
    const result = await log.list({
      ...(parsePositiveInt(req.query.limit) != null ? { limit: parsePositiveInt(req.query.limit) as number } : {}),
      ...(typeof req.query.since === 'string' && req.query.since ? { since: req.query.since } : {}),
      ...(kindParam ? { kind: kindParam as AnomalyKind } : {}),
      ...(severityParam ? { severity: severityParam as AnomalySeverity } : {}),
    });
    res.json(result);
  });

  app.delete('/api/anomalies', async (_req, res) => {
    const cleared = await log.clear();
    res.json({ ok: true, cleared });
  });
}
