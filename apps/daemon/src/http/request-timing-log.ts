// All-observations request timing capture.
//
// The anomaly log records only what went WRONG — a failure, or a request over
// its 4 s budget (`routes/anomalies.ts`). That is the property that makes it
// skimmable, and it is also why it can never yield a p95: every healthy
// observation is absent from it by design, so the percentile it would report is
// the percentile of the outliers. Filling it with healthy rows to fix that
// would destroy the log.
//
// This module is the separate sink the 24 h endpoint-latency proof needs: one
// JSONL row per COMPLETED request, healthy ones included, measured from
// middleware entry to the response's `finish` event. It is off unless
// `OD_REQUEST_TIMING_LOG` turns it on, so an ordinary run pays nothing and
// writes nothing.
//
// Data-directory contract: the capture file descends from the data root handed
// in by the caller (the daemon's resolved `RUNTIME_DATA_DIR`). The env value is
// a path RELATIVE to that root; an absolute path, or one that climbs out of the
// root, leaves the capture off rather than writing daemon data outside it. This
// module never reads `process.env.OD_DATA_DIR` and never falls back to cwd.

import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import {
  createFilesystemWriteGateway,
  type FilesystemWriteCapability,
} from '../filesystem/write-gateway.js';

/** Env var that turns the capture on. Absent or empty means off. */
export const REQUEST_TIMING_LOG_ENV = 'OD_REQUEST_TIMING_LOG';

/** Where the capture lands when the env var only says "on". */
export const DEFAULT_REQUEST_TIMING_LOG_PATH = join('request-timing', 'requests.jsonl');

/** Env values that mean "on, at the default path". */
const ENABLE_TOKENS: readonly string[] = ['1', 'true', 'on', 'yes'];

/** Env values that mean "deliberately off". Distinguished so turning the capture off is not diagnosed as a mistake. */
const DISABLE_TOKENS: readonly string[] = ['0', 'false', 'off', 'no'];

function isExplicitOff(value: string | undefined): boolean {
  const raw = (value ?? '').trim().toLowerCase();
  return raw === '' || DISABLE_TOKENS.includes(raw);
}

/**
 * One completed request.
 *
 * `route` is the Express route pattern the request matched, exactly as the
 * anomaly observer records it, so the two sinks group on the same string and a
 * capture can be cross-checked against the anomaly log. Ids are NOT collapsed
 * here: a request that matched no route falls back to its concrete path, and
 * turning either spelling into the proof's normalized key is the capture
 * script's job (`e2e/lib/w3-performance-proof.ts`), not the daemon's.
 */
export interface RequestTimingRow {
  method: string;
  route: string;
  status: number;
  /** Middleware entry to response `finish`, whole milliseconds. */
  durationMs: number;
  atUtc: string;
}

export interface RequestTimingLogOptions {
  /** The daemon's resolved data root. Required; there is deliberately no default. */
  dataDir: string;
  /** Raw `OD_REQUEST_TIMING_LOG` value. Defaults to the live environment. */
  value?: string | undefined;
  /**
   * Gateway factory used to mint the write capability. Pass the daemon's
   * audit-wrapped factory so this capture's writes join the same audit stream
   * as every other daemon write.
   */
  createGateway?: typeof createFilesystemWriteGateway;
  /** Where refusals and failed writes are reported. Defaults to the console. */
  warn?: (message: string, detail?: unknown) => void;
}

/**
 * Resolves the capture file, or `null` when the capture stays off.
 *
 * Off is the answer for an absent, empty, or explicitly-false value. It is also
 * the answer for a value that would put daemon data outside the resolved data
 * root: refusing is the only response that keeps the data-directory contract
 * true no matter what an operator exports.
 */
export function resolveRequestTimingLogPath(options: {
  dataDir: string;
  value: string | undefined;
}): string | null {
  const raw = (options.value ?? '').trim();
  if (isExplicitOff(raw)) return null;
  const requested = ENABLE_TOKENS.includes(raw.toLowerCase())
    ? DEFAULT_REQUEST_TIMING_LOG_PATH
    : raw;
  if (isAbsolute(requested)) return null;
  const resolved = join(options.dataDir, normalize(requested));
  const inside = relative(options.dataDir, resolved);
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return null;
  }
  return resolved;
}

/**
 * Express route patterns keep the caller's ids out of the recorded label
 * (`/api/projects/:id/files` rather than one project's path), which is what
 * makes rows group by endpoint. Falls back to the concrete path when no route
 * matched — a 404 has no route, and a raw path is still a truthful observation.
 *
 * Mirrors `routeLabel` in `routes/anomalies.ts` on purpose: the proof is
 * cross-checked against the anomaly log, and two sinks that spelled the same
 * endpoint differently could not be compared. That file is another track's to
 * edit, so the rule is restated here rather than exported from there.
 */
function routeLabel(req: Request): string {
  const pattern = (req.route as { path?: string } | undefined)?.path;
  const base = typeof req.baseUrl === 'string' ? req.baseUrl : '';
  if (typeof pattern === 'string' && pattern.length > 0) return `${base}${pattern}`;
  // `req.path` excludes the query string, which is where tokens tend to live.
  return req.path;
}

/**
 * Builds the timing middleware.
 *
 * Returns a pass-through when the capture is off, so the caller mounts one line
 * unconditionally and an ordinary run carries no branch of its own. Like the
 * anomaly observer it only reads response metadata on `finish`, so it can
 * neither alter nor delay a response, and a failed write is reported and
 * dropped rather than raised at the request.
 */
export function createRequestTimingObserver(options: RequestTimingLogOptions): RequestHandler {
  const value = options.value ?? process.env[REQUEST_TIMING_LOG_ENV];
  const warn = options.warn ?? ((message, detail) => console.warn(message, detail ?? ''));
  const path = resolveRequestTimingLogPath({ dataDir: options.dataDir, value });

  if (path == null) {
    // Only a value that MEANT to name a file is worth diagnosing; an operator
    // who exported an off token got exactly what they asked for.
    if (!isExplicitOff(value)) {
      warn(
        `[request-timing] ${REQUEST_TIMING_LOG_ENV} must name a path inside the daemon data root; capture stays off:`,
        value,
      );
    }
    return function requestTimingDisabled(_req, _res, next: NextFunction): void {
      next();
    };
  }

  const append = createAppender(path, options, warn);

  return function requestTimingObserver(req: Request, res: Response, next: NextFunction): void {
    // Only the API surface, matching the anomaly observer's scope: static asset
    // and preview timings say more about file size than about endpoint health.
    if (!req.path.startsWith('/api/')) {
      next();
      return;
    }
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      append({
        method: req.method,
        route: routeLabel(req),
        status: res.statusCode,
        durationMs: Number((process.hrtime.bigint() - startedAt) / 1_000_000n),
        atUtc: new Date().toISOString(),
      });
    });
    next();
  };
}

/**
 * Serialises appends onto one chain. `appendFile` is not atomic across
 * concurrent callers, and a torn line is a row nobody can parse back — the one
 * failure mode that would make a capture untrustworthy.
 */
function createAppender(
  path: string,
  options: RequestTimingLogOptions,
  warn: (message: string, detail?: unknown) => void,
): (row: RequestTimingRow) => void {
  const gateway = (options.createGateway ?? createFilesystemWriteGateway)({
    runtimeDataRoot: options.dataDir,
  });
  let capabilityPromise: Promise<FilesystemWriteCapability> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let directoryReady = false;

  return function appendRow(row: RequestTimingRow): void {
    const line = `${JSON.stringify(row)}\n`;
    const next = chain.then(async () => {
      try {
        capabilityPromise ??= gateway.runtimeData();
        const capability = await capabilityPromise;
        if (!directoryReady) {
          await gateway.mkdir(capability, join(path, '..'), { recursive: true });
          directoryReady = true;
        }
        await gateway.appendFile(capability, path, line, 'utf8');
      } catch (error) {
        warn('[request-timing] could not append:', error);
      }
    });
    // Keep the chain alive after a rejection so one failed write cannot wedge
    // every later append.
    chain = next.catch(() => undefined);
  };
}
