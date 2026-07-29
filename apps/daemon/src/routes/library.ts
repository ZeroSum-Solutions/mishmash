// OD Library HTTP surface.
//
// Three classes of caller:
//   - The OD web UI (loopback / same-origin): list, detail, raw, delete,
//     pairing start, connection status, live events.
//   - The browser extension (cross-origin `chrome-extension://…`, library
//     token): ingest. Its origin is allowlisted at pairing time so the
//     global `/api` origin middleware lets the POST through.
//   - The pairing handshake (`/pair/confirm`): reachable from the not-yet-
//     allowlisted extension origin, gated by the short-lived pairing code.
//
// Routes that mutate stay token- or loopback-gated; reads ride the daemon's
// loopback binding + same-origin middleware like the rest of `/api`.

import { createReadStream } from 'node:fs';
import { copyFile, readFile, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Express, Request, Response } from 'express';
import type {
  LibraryAsset,
  LibraryAssetFilter,
  LibraryAssetKind,
  LibraryEditAsPageResponse,
  LibrarySourceKind,
} from '@open-design/contracts';
import { LIBRARY_UPLOAD_MAX_BYTES, isLibraryUploadMimeAllowed } from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import {
  addLibraryAssetSource,
  deleteLibraryAsset,
  getLibraryAsset,
  listLibraryAssets,
  updateLibraryAsset,
  type LibraryAssetRecord,
} from '../library-store.js';
import {
  detectMime,
  extForMime,
  registerLibraryAsset,
  resolveAssetBytesPath,
  resolveAssetElementSidecarPath,
  resolveAssetFigmaSidecarPath,
  writeElementSidecar,
  writeFigmaSidecar,
} from '../library.js';
import { reconcileLibrary, type ReconcileLibraryResult } from '../library-sync.js';
import { fetchExternalBrandAsset } from '../brands/safe-fetch.js';
import { ensureProjectSubdir } from '../projects.js';
import {
  confirmPairing,
  libraryConnectionStatus,
  startPairing,
  validateLibraryToken,
} from '../library-tokens.js';
import { revokeLibraryTokenByHash, rotateLibraryToken } from '../security/library-token-lifecycle.js';
import { registerBackupRoutes } from '../backup/routes.js';

export interface RegisterLibraryRoutesDeps
  extends RouteDeps<
    'db' | 'http' | 'paths' | 'projectStore' | 'projectFiles' | 'conversations' | 'auth'
  > {}

const MAX_REMOTE_BYTES = 25 * 1024 * 1024;

// `LIBRARY_UPLOAD_MAX_BYTES` (packages/contracts) + the MIME allowlist apply
// only to `sourceKind === 'manual-upload'`; a URL-based ingest is capped at
// `MAX_REMOTE_BYTES` above via `fetchRemoteBytes`, but neither cap applies to
// the clipper/token caller class's `dataUrl`/`text` bodies, which were
// otherwise bounded only by the daemon's blanket 128 MB
// `express.json({ limit })` for this route (server.ts). This closes that gap
// for the clipper class specifically.
const CLIPPER_INGEST_MAX_BYTES = 5_000_000;

// `CLIPPER_INGEST_MAX_BYTES` bounds TOTAL persisted bytes for a clipper
// ingest request. Round 1 (b6d963ef4, 0922a4416) hand-listed the fields to
// sum (bytes/text/figmaCapture/elementHtml/metadata); round 2 found that
// list missed sourceTitle/sourceUrl/tags, which also reach
// registerLibraryAsset and get persisted on the asset row. A hand-listed
// set is exactly the wrong shape here -- it can only ever be checked
// against the fields someone remembered, and a THIRD reviewer would find a
// fourth field the same way. This sums every key of the parsed request body
// instead, so a caller-supplied field is counted BY CONSTRUCTION the moment
// it exists in the request, with no matching edit required at the call site
// that starts persisting it.
//
// The only deliberate exclusions are `dataUrl` and `url`, and the reason is
// stated here because that is where the exclusion lives: neither is what
// actually ends up persisted. `dataUrl` is base64 (~1.33x larger than the
// bytes it decodes to) and is never itself stored; `url` is merely a fetch
// source, and the fetched response -- not the URL string -- is what's
// stored. Both are correctly represented instead by the caller's own
// resolved `bytes` (see the `sourceKind === 'clipper'` check below).
const CLIPPER_BYTE_VOLUME_EXCLUDED_BODY_FIELDS = new Set(['dataUrl', 'url']);

// `clipperIngestByteVolume` must be a TOTAL function. The call site (below,
// `sourceKind === 'clipper'`) runs it synchronously and only THEN decides
// whether to call `sendApiError` -- there is no `try`/`catch` around the
// call itself. A throw here is not caught by the route's own error handling
// at all: it becomes a rejection of this `async` handler that Express's
// generic error handling takes instead, producing an unstructured response
// instead of the mandated 413 -- a caller could crash the accounting
// instead of merely being refused by it. `JSON.stringify` is recursive in
// V8 and overflows the call stack on a deeply-nested value well before
// `JSON.parse` does (the daemon's dedicated 128mb body-parser limit for this
// route, server.ts, has no depth limit), so a parser-valid body reaches this
// summation with a value `JSON.stringify` cannot handle.
//
// The guard below is deliberately NOT narrowed to `RangeError`: the
// requirement is "never throws, for any value an Express JSON body can
// contain," not "never throws for the one failure mode we found." Any value
// this function cannot measure is unmeasurable, full stop, and an
// unmeasurable value fails CLOSED -- returning `Infinity` routes it through
// the EXACT SAME `payloadSize > CLIPPER_INGEST_MAX_BYTES` comparison and 413
// response the call site already uses for an ordinary oversized body, with
// no new branch and no change to the counting semantics for any ordinary,
// measurable value.
function clipperIngestByteVolume(body: Record<string, unknown>): number {
  let total = 0;
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || CLIPPER_BYTE_VOLUME_EXCLUDED_BODY_FIELDS.has(key)) continue;
    try {
      total += Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch {
      return Infinity;
    }
  }
  return total;
}

/** Strip the internal absolute `filePath` before returning an asset to a client. */
function toPublicAsset(record: LibraryAssetRecord): LibraryAsset {
  const { filePath: _filePath, ...rest } = record;
  return rest;
}

function bearerToken(req: Request): string | undefined {
  const header = req.get('authorization') ?? '';
  return /^Bearer\s+(.+)$/i.exec(header.trim())?.[1];
}

/**
 * Bounded per-process fixed-window request counter. Closes the "no request-
 * or byte-volume control on any /api/library/* route" gap documented in
 * docs/security/daemon-threat-model.md's Wave 9 section: every call site in
 * `registerLibraryRoutes` gets its own fresh counter map (one per daemon
 * boot, since the factory is invoked from inside that function's closure),
 * keyed by caller (e.g. Origin header) where a meaningful per-caller key
 * exists, or a fixed key for routes with no such identity. A window resets
 * on the first call after it elapses; the request that starts a new window
 * always counts as call #1 of that window.
 */
function createFixedWindowLimiter(limit: number, windowMs: number): (key: string) => boolean {
  const windows = new Map<string, { count: number; windowStart: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const entry = windows.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      windows.set(key, { count: 1, windowStart: now });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

/**
 * Echo an extension Origin back as the CORS allow-origin. MV3 service-worker
 * fetches with host_permissions bypass CORS, but desktop/Firefox paths and
 * preflights are happier with an explicit allow-origin, so set it whenever the
 * caller presents an extension origin.
 */
function applyExtensionCors(req: Request, res: Response): void {
  const origin = req.get('origin');
  if (origin && (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
}

/** A filesystem-safe `<title>.od-figma.json` download name for a capture. */
function figmaDownloadName(asset: LibraryAssetRecord): string {
  const raw = (asset.sourceTitle || asset.sourceDomain || 'capture').slice(0, 60);
  const slug = raw.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'capture';
  return `${slug}.od-figma.json`;
}

function parseDataUrl(dataUrl: string): { bytes: Buffer; mime: string | undefined } | null {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] || undefined;
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? '';
  const bytes = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');
  return { bytes, mime };
}

async function fetchRemoteBytes(url: string): Promise<{ bytes: Buffer; mime: string | undefined }> {
  // Route the client-supplied URL through the same SSRF guard the brand-asset
  // path uses (assertPublicBrandUrl): reject cloud-metadata (169.254.169.254),
  // loopback, RFC1918/CGNAT, and link-local hosts, re-validating on every
  // redirect hop (redirect:'manual'). Without this a caller could make the
  // privileged daemon fetch an internal/loopback URL and read the response back
  // via GET /api/library/assets/:id/raw — SSRF + response exfiltration. Sibling
  // to the loopback-SSRF class in #5478.
  const resp = await fetchExternalBrandAsset(url);
  if (!resp.ok) throw new Error(`remote fetch failed: ${resp.status}`);
  const declared = Number(resp.headers.get('content-length') ?? '0');
  if (declared && declared > MAX_REMOTE_BYTES) throw new Error('remote resource too large');
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > MAX_REMOTE_BYTES) throw new Error('remote resource too large');
  const mime = resp.headers.get('content-type')?.split(';')[0]?.trim() || undefined;
  return { bytes: buf, mime };
}

/**
 * Stream a file to the HTTP response with an `error` handler on the read stream.
 * `.pipe()` does NOT forward the source's errors, so without this a mid-stream
 * read failure (file deleted/truncated mid-read, EIO, an fd race) emits an
 * unhandled `error` on the Readable, which Node escalates to an uncaughtException
 * that takes the whole daemon down. On error we fall back to `onOpenError`
 * (a 404) when nothing has been written yet, else tear the response down.
 */
export function streamAssetFileToResponse(
  abs: string,
  res: Response,
  onOpenError: () => void,
): void {
  const stream = createReadStream(abs);
  stream.on('error', () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    // The route sets success-only headers (Content-Type/-Length, Cache-Control,
    // Content-Disposition) before streaming. Strip them before the JSON error
    // fallback so a transient open/read failure isn't returned with stale asset
    // metadata — in particular the `max-age=3600` directive, which would cache
    // the 404 for an hour and mask the file once it becomes available again.
    for (const header of ['Cache-Control', 'Content-Disposition', 'Content-Type', 'Content-Length']) {
      res.removeHeader(header);
    }
    onOpenError();
  });
  stream.pipe(res);
}

export function registerLibraryRoutes(app: Express, ctx: RegisterLibraryRoutesDeps): void {
  const { db } = ctx;
  const { sendApiError, createSseResponse, requireLocalDaemonRequest, isLocalSameOrigin, resolvedPortRef } =
    ctx.http;
  const { LIBRARY_DIR, PROJECTS_DIR, USER_DESIGN_SYSTEMS_DIR } = ctx.paths;
  const { getProject, insertProject } = ctx.projectStore;
  const { writeProjectFile } = ctx.projectFiles;
  const { insertConversation } = ctx.conversations;
  const { authorizeToolRequest } = ctx.auth;

  // Copy an asset's bytes into a project (under a `library/` subdir) and record
  // the project usage as a source back-link. Shared by the loopback apply route
  // and the agent tool-token route.
  async function applyAssetToProject(
    asset: LibraryAssetRecord,
    projectId: string,
    sourceKind: LibrarySourceKind,
    dir?: string,
    includeElement = false,
  ): Promise<{ relPath: string; elementRelPath?: string }> {
    const bytesPath = resolveAssetBytesPath(asset, PROJECTS_DIR);
    if (!bytesPath) throw new Error('asset bytes not available');
    const project = getProject(db, projectId);
    if (!project) throw new Error('project not found');
    const subdir = dir && dir.trim() ? dir.trim() : 'library';
    const { absDir, relDir } = await ensureProjectSubdir(
      PROJECTS_DIR,
      projectId,
      subdir,
      project.metadata,
    );
    const stem = asset.contentHash.slice(0, 12);
    const ext = extForMime(asset.mime, undefined);
    const name = `${stem}${ext}`;
    await copyFile(bytesPath, path.join(absDir, name));
    addLibraryAssetSource(db, { assetId: asset.id, sourceKind, projectId });
    const relPath = relDir ? `${relDir}/${name}` : name;

    // Element-pick captures carry the picked node's outerHTML in a sidecar.
    // When requested, materialize it next to the screenshot so the element's
    // markup is consumable as a file (not just the flat image).
    let elementRelPath: string | undefined;
    if (includeElement) {
      const sidecar = resolveAssetElementSidecarPath(asset, LIBRARY_DIR);
      if (sidecar) {
        const elName = `${stem}.element.html`;
        try {
          await copyFile(sidecar, path.join(absDir, elName));
          elementRelPath = relDir ? `${relDir}/${elName}` : elName;
        } catch {
          // No stored markup (older capture / missing sidecar) — image only.
        }
      }
    }
    return elementRelPath ? { relPath, elementRelPath } : { relPath };
  }

  // Reconcile design systems + agent project deliverables into the Library as
  // referenced rows. Throttled so opening the Library (which lists assets) keeps
  // it current without re-scanning on every keystroke-driven re-fetch; a single
  // in-flight pass is shared by concurrent callers. `force` (the Sync button /
  // `od library sync`) bypasses the throttle.
  const RECONCILE_THROTTLE_MS = 10_000;
  let lastReconcileAt = 0;
  let reconcileInFlight: Promise<ReconcileLibraryResult> | null = null;

  // --- rate/volume controls -------------------------------------------------
  // Ground-facts gap this closes: "There is no request- or byte-volume
  // control on any /api/library/* route" (docs/plans/waves/
  // W9-ingest-tranche.md). Each limiter below is a fresh, independent
  // fixed-window counter created for this daemon boot; see
  // createFixedWindowLimiter's own docblock. Numbers are deliberately
  // generous for legitimate single-user local usage while still closing a
  // real, previously-unbounded gap; see docs/security/daemon-threat-
  // model.md's Wave 9 section for the per-route rationale.
  const pairConfirmAttemptOk = createFixedWindowLimiter(5, 60_000);
  const assetsListOk = createFixedWindowLimiter(20, 10_000);
  const clipperProbeOk = createFixedWindowLimiter(30, 10_000);
  const connectionOk = createFixedWindowLimiter(50, 10_000);
  const syncOk = createFixedWindowLimiter(10, 60_000);
  const deleteAssetOk = createFixedWindowLimiter(50, 10_000);
  const applyAssetOk = createFixedWindowLimiter(50, 10_000);
  const toolSearchOk = createFixedWindowLimiter(50, 10_000);
  const toolApplyOk = createFixedWindowLimiter(50, 10_000);
  const EMPTY_RECONCILE: ReconcileLibraryResult = {
    designSystems: 0,
    projectAssets: 0,
    deduped: 0,
    total: 0,
  };
  async function runReconcile(force: boolean): Promise<ReconcileLibraryResult> {
    if (reconcileInFlight) return reconcileInFlight;
    if (!force && Date.now() - lastReconcileAt < RECONCILE_THROTTLE_MS) {
      return EMPTY_RECONCILE;
    }
    reconcileInFlight = reconcileLibrary(db, {
      LIBRARY_DIR,
      PROJECTS_DIR,
      USER_DESIGN_SYSTEMS_DIR,
    }).finally(() => {
      lastReconcileAt = Date.now();
      reconcileInFlight = null;
    });
    return reconcileInFlight;
  }

  // Live ingest/enrichment feed. Clipper captures flow through this route, so
  // the web grid can update without polling.
  const sseClients = new Set<(event: string, data: unknown) => void>();
  const emit = (event: string, data: unknown) => {
    for (const send of sseClients) {
      try {
        send(event, data);
      } catch {
        // a dead client must not block the rest
      }
    }
  };

  // --- pairing -------------------------------------------------------------

  // Loopback-only: the OD UI mints a pairing code to show the user.
  app.post('/api/library/pair', requireLocalDaemonRequest, (_req, res) => {
    const { code, expiresAt } = startPairing();
    res.json({ code, expiresAt });
  });

  // Reachable from the (not-yet-allowlisted) extension origin — gated by the
  // pairing code. server.ts's global `/api` origin middleware exempts this
  // exact path via isZeroConfigClipperLibraryRequest
  // (apps/daemon/src/origin-validation.ts), the same zero-config bypass
  // /library/ingest uses. CORS preflight handled below.
  app.options('/api/library/pair/confirm', (req, res) => {
    applyExtensionCors(req, res);
    res.status(204).end();
  });
  app.post('/api/library/pair/confirm', (req, res) => {
    applyExtensionCors(req, res);
    // Bounded pairing-attempt throttle (C9-6 P0 control): startPairing()
    // mints a 6-digit code with no attempt counter of its own
    // (library-tokens.ts), and this route is reachable pre-pairing from any
    // extension-shaped origin (the zero-config bypass) -- a genuine, narrow
    // brute-force window. Counts every attempt (valid or not), globally,
    // since library-tokens.ts's `pendingPairing` is itself a single
    // outstanding code -- there is only ever one code to guess against at a
    // time. See docs/security/daemon-threat-model.md's Wave 9 section.
    if (!pairConfirmAttemptOk('global')) {
      return sendApiError(
        res,
        429,
        'PAIR_CONFIRM_RATE_LIMITED',
        'too many pairing confirmation attempts; try again shortly',
      );
    }
    const body = req.body ?? {};
    const code = String(body.code ?? '');
    const extensionOrigin = String(body.extensionOrigin ?? '');
    if (!code || !extensionOrigin) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'code and extensionOrigin are required');
    }
    const result = confirmPairing(db, { code, extensionOrigin, label: body.label });
    if (!result.ok) {
      return sendApiError(res, 401, 'PAIRING_FAILED', result.error);
    }
    res.json({ token: result.token, label: result.label });
  });

  // Loopback-only: web UI connection status.
  app.get('/api/library/connection', requireLocalDaemonRequest, (_req, res) => {
    if (!connectionOk('global')) {
      return sendApiError(
        res,
        429,
        'LIBRARY_CONNECTION_RATE_LIMITED',
        'too many connection status requests; try again shortly',
      );
    }
    res.json(libraryConnectionStatus(db));
  });

  // --- token lifecycle (revoke / rotate) ------------------------------------
  //
  // Self-service: the caller authenticates with the SAME bearer token it
  // wants to act on (proof of possession), not requireLocalDaemonRequest --
  // a real extension's own revoke/rotate call carries its normal
  // `Origin: chrome-extension://…` header, which requireLocalDaemonRequest
  // would reject outright (it only accepts a loopback-or-absent Origin). If
  // an Origin IS present it must still match the token's bound identity, so
  // one extension can never revoke or rotate another's token. See
  // docs/security/daemon-threat-model.md [C0-6].
  //
  // The POST handler is registered BEFORE its OPTIONS preflight sibling
  // (deliberately, not incidentally): daemon.routeInventory reports routes
  // in registration order, and anything doing endpoint discovery by path
  // pattern alone (e.g. "find the revoke/rotate route for this path") needs
  // the real action route to be the first match, not the CORS preflight
  // stub. Express itself dispatches by method regardless of registration
  // order, so this reordering changes nothing about runtime request
  // handling -- only which route a path-only lookup finds first.
  app.post('/api/library/pair/revoke', (req, res) => {
    applyExtensionCors(req, res);
    const token = bearerToken(req);
    const check = validateLibraryToken(db, token);
    if (!check.ok) {
      return sendApiError(res, 401, 'LIBRARY_TOKEN_INVALID', 'a valid library token is required to revoke it');
    }
    const origin = req.get('origin');
    if (origin && check.row.extensionOrigin !== origin) {
      return sendApiError(res, 403, 'LIBRARY_TOKEN_ORIGIN_MISMATCH', 'token is not bound to the presenting origin');
    }
    const result = revokeLibraryTokenByHash(db, check.row.tokenHash);
    res.json({ ok: true, revoked: result.revoked });
  });
  app.options('/api/library/pair/revoke', (req, res) => {
    applyExtensionCors(req, res);
    res.status(204).end();
  });

  app.post('/api/library/pair/rotate', (req, res) => {
    applyExtensionCors(req, res);
    const token = bearerToken(req);
    const check = validateLibraryToken(db, token);
    if (!check.ok) {
      return sendApiError(res, 401, 'LIBRARY_TOKEN_INVALID', 'a valid library token is required to rotate it');
    }
    const origin = req.get('origin');
    if (origin && check.row.extensionOrigin !== origin) {
      return sendApiError(res, 403, 'LIBRARY_TOKEN_ORIGIN_MISMATCH', 'token is not bound to the presenting origin');
    }
    const result = rotateLibraryToken(db, check.row.tokenHash);
    if (!result.ok) {
      return sendApiError(res, 500, 'LIBRARY_TOKEN_ROTATE_FAILED', result.error);
    }
    res.json({ ok: true, token: result.token });
  });
  app.options('/api/library/pair/rotate', (req, res) => {
    applyExtensionCors(req, res);
    res.status(204).end();
  });

  // --- backup / restore ------------------------------------------------------
  //
  // Registered here (not from server.ts) because apps/daemon/src/server.ts is
  // outside this wave's write lease -- see backup/routes.ts's file header for
  // the full rationale. Functionally identical to any other
  // `register*Routes(app, deps)` call.
  registerBackupRoutes(app, {
    getRuntimeDataDir: () => ctx.paths.RUNTIME_DATA_DIR,
    requireLocalDaemonRequest,
    sendApiError,
  });

  // --- ingest --------------------------------------------------------------

  app.options('/api/library/ingest', (req, res) => {
    applyExtensionCors(req, res);
    res.status(204).end();
  });
  app.post('/api/library/ingest', async (req, res) => {
    applyExtensionCors(req, res);
    // A browser-extension origin string is unforgeable by a web page, but it
    // is NOT an identity by itself -- ANY installed extension (paired or
    // not) can present it. The capability token IS the identity: it must be
    // valid AND bound to the SAME extension origin presenting it (round-trip
    // established at /pair/confirm). An extension-shaped Origin with no
    // token, or with a token minted for a DIFFERENT extension, is rejected
    // -- see docs/security/daemon-threat-model.md [C0-5]/[C0-6]. The local
    // CLI / web UI (loopback / same-origin) still needs no token →
    // 'manual-upload'.
    const origin = req.get('origin') ?? '';
    const isExtensionOrigin =
      origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://');
    const tokenCheck = validateLibraryToken(db, bearerToken(req));
    const tokenBoundToThisOrigin = tokenCheck.ok && tokenCheck.row.extensionOrigin === origin;
    let sourceKind: LibrarySourceKind;
    if (isExtensionOrigin && tokenBoundToThisOrigin) {
      sourceKind = 'clipper';
    } else if (isLocalSameOrigin(req, resolvedPortRef.current)) {
      sourceKind = 'manual-upload';
    } else {
      return sendApiError(
        res,
        401,
        'LIBRARY_INGEST_FORBIDDEN',
        'ingest must come from the local UI/CLI, or the browser extension with a valid token bound to its own origin',
      );
    }

    const body = req.body ?? {};
    let bytes: Buffer | undefined;
    let mime: string | undefined = typeof body.mime === 'string' ? body.mime : undefined;
    const text = typeof body.text === 'string' ? body.text : undefined;
    const filename = typeof body.filename === 'string' ? body.filename : undefined;

    // Clipper page captures may ship an OD Figma capture IR (a JSON node-tree)
    // alongside the HTML. It is stored as a sidecar of the HTML asset and a
    // marker is stamped onto the asset metadata so the Library can offer a
    // Figma export. The daemon never parses the (potentially large) IR — the
    // clipper supplies the node count.
    const figmaIr =
      typeof body.figmaCapture === 'string' && body.figmaCapture ? body.figmaCapture : undefined;
    const figmaMeta = figmaIr
      ? {
          version: 1,
          size: Buffer.byteLength(figmaIr, 'utf8'),
          nodeCount: Number.isFinite(body.figmaNodeCount) ? Number(body.figmaNodeCount) : 0,
        }
      : undefined;
    const reqMetadata =
      body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : undefined;
    const metadata =
      reqMetadata || figmaMeta
        ? { ...(reqMetadata ?? {}), ...(figmaMeta ? { figmaCapture: figmaMeta } : {}) }
        : undefined;
    // Element-pick captures ship the element's outerHTML; it is stored as a
    // sidecar of the screenshot (the summary travels in metadata.element).
    const elementHtml =
      typeof body.elementHtml === 'string' && body.elementHtml ? body.elementHtml : undefined;

    try {
      if (typeof body.dataUrl === 'string') {
        const parsed = parseDataUrl(body.dataUrl);
        if (!parsed) return sendApiError(res, 400, 'BAD_REQUEST', 'invalid dataUrl');
        bytes = parsed.bytes;
        mime = mime ?? parsed.mime;
      } else if (typeof body.url === 'string') {
        const fetched = await fetchRemoteBytes(body.url);
        bytes = fetched.bytes;
        mime = mime ?? fetched.mime;
      } else if (text === undefined) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'one of dataUrl, url, or text is required');
      }
    } catch (err) {
      return sendApiError(res, 502, 'INGEST_FETCH_FAILED', err instanceof Error ? err.message : String(err));
    }

    // Byte-volume cap for the clipper/token caller class (C9-6 P0 control):
    // `LIBRARY_UPLOAD_MAX_BYTES` below applies only to manual-upload, and a
    // `dataUrl`/`text` clipper payload previously had no cap at all (only a
    // URL-sourced fetch was bounded, via fetchRemoteBytes's MAX_REMOTE_BYTES
    // above). See CLIPPER_INGEST_MAX_BYTES's own docblock and
    // `clipperIngestByteVolume`'s for why this sums the whole parsed body
    // instead of naming fields.
    if (sourceKind === 'clipper') {
      const payloadSize = clipperIngestByteVolume(body) + (bytes ? bytes.length : 0);
      if (payloadSize > CLIPPER_INGEST_MAX_BYTES) {
        return sendApiError(
          res,
          413,
          'PAYLOAD_TOO_LARGE',
          `clipper ingest payload exceeds the ${Math.round(CLIPPER_INGEST_MAX_BYTES / 1_000_000)} MB limit`,
        );
      }
    }

    // Manual uploads (local web UI / `od library import`) are restricted to a
    // safe inline size and design-relevant formats — images, fonts, text/HTML,
    // and JSON/design data. Audio, video, and other binaries are turned away.
    // Clipper captures are exempt: the extension curates its own payloads
    // (including page video) and arrives on a trusted extension origin. Text-
    // only payloads are always a text-family asset, so they skip the check.
    if (sourceKind === 'manual-upload' && bytes) {
      if (bytes.length > LIBRARY_UPLOAD_MAX_BYTES) {
        return sendApiError(
          res,
          413,
          'PAYLOAD_TOO_LARGE',
          `file is too large to upload (max ${Math.round(LIBRARY_UPLOAD_MAX_BYTES / 1_000_000)} MB)`,
        );
      }
      const effectiveMime = mime ?? detectMime(bytes, filename);
      if (!isLibraryUploadMimeAllowed(effectiveMime, filename)) {
        return sendApiError(
          res,
          415,
          'UNSUPPORTED_MEDIA_TYPE',
          'this file type cannot be uploaded to the Library — images, fonts, text, HTML, and JSON/design data only',
        );
      }
    }

    try {
      const result = await registerLibraryAsset({
        db,
        libraryDir: LIBRARY_DIR,
        storage: 'owned',
        bytes,
        text,
        kind: typeof body.kind === 'string' ? (body.kind as LibraryAssetKind) : undefined,
        mime,
        filename,
        sourceUrl: typeof body.sourceUrl === 'string' ? body.sourceUrl : undefined,
        sourceTitle: typeof body.sourceTitle === 'string' ? body.sourceTitle : undefined,
        tags: Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === 'string') : undefined,
        metadata,
        source: { sourceKind },
      });

      // Persist derived sidecars (idempotent overwrite). On dedup the registrar
      // ignores `metadata`, so stamp the marker explicitly when an existing
      // asset gains a capture it didn't have before.
      let assetRecord = result.asset;
      if (figmaIr) {
        await writeFigmaSidecar(LIBRARY_DIR, assetRecord.contentHash, figmaIr);
        if (result.deduped && !assetRecord.metadata?.figmaCapture && figmaMeta) {
          updateLibraryAsset(db, assetRecord.id, {
            metadata: { ...(assetRecord.metadata ?? {}), figmaCapture: figmaMeta },
          });
          assetRecord = getLibraryAsset(db, assetRecord.id) ?? assetRecord;
        }
      }
      if (elementHtml) {
        await writeElementSidecar(LIBRARY_DIR, assetRecord.contentHash, elementHtml);
        if (result.deduped && !assetRecord.metadata?.element && reqMetadata?.element) {
          updateLibraryAsset(db, assetRecord.id, {
            metadata: { ...(assetRecord.metadata ?? {}), element: reqMetadata.element },
          });
          assetRecord = getLibraryAsset(db, assetRecord.id) ?? assetRecord;
        }
      }

      const asset = toPublicAsset(assetRecord);
      emit('ingest', { assetId: asset.id, deduped: result.deduped });
      res.json({ asset, taskId: result.taskId, deduped: result.deduped });
    } catch (err) {
      return sendApiError(res, 500, 'INGEST_FAILED', err instanceof Error ? err.message : String(err));
    }
  });

  app.get('/api/library/clipper-probe', (_req, res) => {
    if (!clipperProbeOk('global')) {
      return sendApiError(res, 429, 'CLIPPER_PROBE_RATE_LIMITED', 'too many probe requests; try again shortly');
    }
    res.json({ ok: true });
  });

  // --- assets --------------------------------------------------------------

  app.get('/api/library/assets', async (req, res) => {
    // Per-caller request-rate limit (C9-6 P0 control): `runReconcile` below
    // is already throttled program-wide (RECONCILE_THROTTLE_MS), but that
    // throttle is shared across every caller and never rejects the request
    // itself -- an unauthenticated caller (this route carries no route-level
    // gate; see docs/security/daemon-threat-model.md's Wave 9 section) could
    // still hit the route itself at any rate. Keyed by Origin where present
    // (a stable per-caller-class identity; requests with no Origin --
    // ordinary local UI/CLI callers -- share one bucket).
    const originKey = req.get('origin') || '(no-origin)';
    if (!assetsListOk(originKey)) {
      return sendApiError(res, 429, 'LIBRARY_ASSETS_RATE_LIMITED', 'too many list requests; try again shortly');
    }
    // Keep the Library current with design systems / agent output before
    // listing, so an opened grid already shows them. Throttled + best-effort —
    // never blocks the list on a reconcile error.
    await runReconcile(false).catch(() => {});
    const q = req.query;
    const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length ? v : undefined);
    // Build conditionally — exactOptionalPropertyTypes rejects explicit
    // `undefined` on the optional filter fields.
    const filter: LibraryAssetFilter = {};
    if (str(q.kind)) filter.kind = str(q.kind) as LibraryAssetKind;
    if (str(q.tag)) filter.tag = str(q.tag)!;
    if (str(q.domain)) filter.domain = str(q.domain)!;
    if (str(q.date)) filter.date = str(q.date)!;
    if (str(q.q)) filter.q = str(q.q)!;
    if (str(q.source)) filter.source = str(q.source) as LibrarySourceKind;
    if (str(q.projectId)) filter.projectId = str(q.projectId)!;
    if (str(q.designSystemId)) filter.designSystemId = str(q.designSystemId)!;
    if (q.limit) filter.limit = Number(q.limit);
    const assets = listLibraryAssets(db, filter).map(toPublicAsset);
    res.json({ assets });
  });

  // Force a full reconcile pass (the web "Sync" button + `od library sync`).
  // Backfills design systems and agent deliverables that predate this feature,
  // and is the explicit "pull in everything now" entry point. Loopback-only.
  app.post('/api/library/sync', requireLocalDaemonRequest, async (_req, res) => {
    if (!syncOk('global')) {
      return sendApiError(
        res,
        429,
        'LIBRARY_SYNC_RATE_LIMITED',
        'too many forced sync requests; try again shortly',
      );
    }
    try {
      const summary = await runReconcile(true);
      res.json(summary);
    } catch (err) {
      return sendApiError(res, 500, 'LIBRARY_SYNC_FAILED', err instanceof Error ? err.message : String(err));
    }
  });

  // Loopback-only (C9-6/C9-8 hardening): per the file header's own
  // documented split ("reads ride the daemon's loopback binding + same-
  // origin middleware like the rest of /api"), this read had no route-level
  // gate of its own, relying entirely on server.ts's global /api origin
  // middleware -- which lets any request with no Origin header through
  // (every non-browser local caller). Not a documented extension
  // capability (only /ingest is); explicit requireLocalDaemonRequest
  // matches the file's own stated intent for reads.
  app.get('/api/library/assets/:id', requireLocalDaemonRequest, (req, res) => {
    const asset = getLibraryAsset(db, req.params.id);
    if (!asset) return sendApiError(res, 404, 'NOT_FOUND', 'asset not found');
    res.json({ asset: toPublicAsset(asset) });
  });

  app.delete('/api/library/assets/:id', requireLocalDaemonRequest, async (req, res) => {
    if (!deleteAssetOk('global')) {
      return sendApiError(res, 429, 'LIBRARY_DELETE_RATE_LIMITED', 'too many delete requests; try again shortly');
    }
    const asset = getLibraryAsset(db, req.params.id);
    if (!asset) return sendApiError(res, 404, 'NOT_FOUND', 'asset not found');
    // Only unlink bytes we own and that live under LIBRARY_DIR.
    if (asset.storage === 'owned' && asset.filePath) {
      const abs = path.resolve(asset.filePath);
      if (abs.startsWith(path.resolve(LIBRARY_DIR))) {
        await unlink(abs).catch(() => {});
      }
    }
    deleteLibraryAsset(db, asset.id);
    emit('delete', { assetId: asset.id });
    res.json({ ok: true });
  });

  // Loopback-only -- see GET /api/library/assets/:id's comment above; the
  // same reasoning applies to every read below that serves stored bytes
  // back to the caller.
  app.get('/api/library/assets/:id/raw', requireLocalDaemonRequest, async (req, res) => {
    const asset = getLibraryAsset(db, req.params.id);
    if (!asset) return sendApiError(res, 404, 'NOT_FOUND', 'asset not found');
    const abs = resolveAssetBytesPath(asset, PROJECTS_DIR);
    if (!abs) return sendApiError(res, 404, 'NOT_FOUND', 'asset bytes not available');
    try {
      const info = await stat(abs);
      if (!info.isFile()) return sendApiError(res, 404, 'NOT_FOUND', 'asset bytes not available');
      res.setHeader('Content-Type', asset.mime ?? 'application/octet-stream');
      res.setHeader('Content-Length', String(info.size));
      res.setHeader('Cache-Control', 'private, max-age=3600');
      streamAssetFileToResponse(abs, res, () =>
        sendApiError(res, 404, 'NOT_FOUND', 'asset bytes not available'),
      );
    } catch {
      return sendApiError(res, 404, 'NOT_FOUND', 'asset bytes not available');
    }
  });

  // --- figma capture export ------------------------------------------------
  // Serve the OD Figma capture IR sidecar (clipper-captured `html` assets) as a
  // downloadable JSON, importable via the OD Figma plugin. Reads ride loopback
  // same-origin like /raw; the clipper downloads its own captures directly.
  app.get('/api/library/assets/:id/figma', requireLocalDaemonRequest, async (req, res) => {
    const asset = getLibraryAsset(db, req.params.id);
    if (!asset) return sendApiError(res, 404, 'NOT_FOUND', 'asset not found');
    const sidecar = resolveAssetFigmaSidecarPath(asset, LIBRARY_DIR);
    if (!sidecar) return sendApiError(res, 404, 'NOT_FOUND', 'no figma capture for this asset');
    try {
      const info = await stat(sidecar);
      if (!info.isFile()) return sendApiError(res, 404, 'NOT_FOUND', 'no figma capture for this asset');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Length', String(info.size));
      res.setHeader('Content-Disposition', `attachment; filename="${figmaDownloadName(asset)}"`);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      streamAssetFileToResponse(sidecar, res, () =>
        sendApiError(res, 404, 'NOT_FOUND', 'no figma capture for this asset'),
      );
    } catch {
      return sendApiError(res, 404, 'NOT_FOUND', 'no figma capture for this asset');
    }
  });

  // --- captured element markup --------------------------------------------
  // Serve the outerHTML sidecar of an element-pick screenshot. Read on demand
  // by the Library preview's "Element HTML" panel.
  app.get('/api/library/assets/:id/element', requireLocalDaemonRequest, async (req, res) => {
    const asset = getLibraryAsset(db, req.params.id);
    if (!asset) return sendApiError(res, 404, 'NOT_FOUND', 'asset not found');
    const sidecar = resolveAssetElementSidecarPath(asset, LIBRARY_DIR);
    if (!sidecar) return sendApiError(res, 404, 'NOT_FOUND', 'no element markup for this asset');
    try {
      const info = await stat(sidecar);
      if (!info.isFile()) return sendApiError(res, 404, 'NOT_FOUND', 'no element markup for this asset');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Length', String(info.size));
      res.setHeader('Cache-Control', 'private, max-age=3600');
      streamAssetFileToResponse(sidecar, res, () =>
        sendApiError(res, 404, 'NOT_FOUND', 'no element markup for this asset'),
      );
    } catch {
      return sendApiError(res, 404, 'NOT_FOUND', 'no element markup for this asset');
    }
  });

  // --- apply to project (web / Insert from Library) ------------------------

  app.post('/api/library/assets/:id/apply', requireLocalDaemonRequest, async (req, res) => {
    if (!applyAssetOk('global')) {
      return sendApiError(res, 429, 'LIBRARY_APPLY_RATE_LIMITED', 'too many apply requests; try again shortly');
    }
    const asset = getLibraryAsset(db, req.params.id);
    if (!asset) return sendApiError(res, 404, 'NOT_FOUND', 'asset not found');
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : '';
    if (!projectId) return sendApiError(res, 400, 'BAD_REQUEST', 'projectId is required');
    try {
      const includeElement = req.body?.includeElement === true;
      const result = await applyAssetToProject(asset, projectId, 'manual-upload', req.body?.dir, includeElement);
      res.json({
        relPath: result.relPath,
        ...(result.elementRelPath ? { elementRelPath: result.elementRelPath } : {}),
      });
    } catch (err) {
      return sendApiError(res, 500, 'APPLY_FAILED', err instanceof Error ? err.message : String(err));
    }
  });

  // --- edit as page (clipper capture → editable OD project) ----------------
  // Turn a captured `html` asset into a brand-new project whose `index.html`
  // is the captured page, seed a conversation, and back-link the asset to the
  // new project. The web client then opens the project on `index.html` so the
  // user can edit it (srcDoc bridge + agent surgical edits) right away. This is
  // the clipper "capture → editable OD page" exit, driven from the Library.
  app.post('/api/library/assets/:id/edit-as-page', requireLocalDaemonRequest, async (req, res) => {
    const asset = getLibraryAsset(db, req.params.id);
    if (!asset) return sendApiError(res, 404, 'NOT_FOUND', 'asset not found');
    if (asset.kind !== 'html') {
      return sendApiError(res, 400, 'NOT_HTML', 'only html captures can be opened as an editable page');
    }
    const bytesPath = resolveAssetBytesPath(asset, PROJECTS_DIR);
    if (!bytesPath) return sendApiError(res, 404, 'NOT_FOUND', 'asset bytes not available');
    try {
      const html = await readFile(bytesPath, 'utf8');
      const now = Date.now();
      const projectId = randomUUID();
      const conversationId = randomUUID();
      const baseName = (asset.sourceTitle || asset.sourceDomain || 'Captured page').trim().slice(0, 80);
      // `prototype` keeps the new project in the design/canvas surface; the
      // back-link to the source asset rides on metadata so the asset's "Open
      // project" affordance can resolve it.
      const metadata = { kind: 'prototype', odLibraryAssetId: asset.id };
      insertProject(db, {
        id: projectId,
        name: baseName || 'Captured page',
        skillId: null,
        designSystemId: null,
        pendingPrompt: null,
        metadata,
        createdAt: now,
        updatedAt: now,
      });
      insertConversation(db, {
        id: conversationId,
        projectId,
        title: null,
        sessionMode: 'design',
        createdAt: now,
        updatedAt: now,
      });
      // writeProjectFile ensures the project dir; write the capture as the
      // editable entry file. No artifact manifest — a plain HTML file avoids
      // the publication/stub guards (a captured page is arbitrary markup) while
      // still rendering and editing like any project HTML.
      await writeProjectFile(PROJECTS_DIR, projectId, 'index.html', Buffer.from(html, 'utf8'), {}, metadata);
      addLibraryAssetSource(db, { assetId: asset.id, sourceKind: 'manual-upload', projectId });
      const body: LibraryEditAsPageResponse = { projectId, conversationId, relPath: 'index.html' };
      res.json(body);
    } catch (err) {
      return sendApiError(res, 500, 'EDIT_AS_PAGE_FAILED', err instanceof Error ? err.message : String(err));
    }
  });

  // --- agent tool track (tool-token) ---------------------------------------
  // Lets a chat agent search and apply library assets mid-task. Mirrors the
  // /api/tools/media/* authorizer shape.

  app.post('/api/tools/library/search', async (req, res) => {
    const grant = authorizeToolRequest(req, res, 'library:search');
    if (!grant) return;
    if (!toolSearchOk('global')) {
      return sendApiError(res, 429, 'TOOL_LIBRARY_SEARCH_RATE_LIMITED', 'too many search requests; try again shortly');
    }
    const body = req.body ?? {};
    const filter: LibraryAssetFilter = {};
    if (typeof body.query === 'string' && body.query.trim()) filter.q = body.query.trim();
    if (typeof body.kind === 'string') filter.kind = body.kind as LibraryAssetKind;
    if (typeof body.date === 'string') filter.date = body.date;
    filter.limit = Number.isFinite(body.limit) ? Number(body.limit) : 20;
    const results = listLibraryAssets(db, filter).map((asset) => ({ asset: toPublicAsset(asset), score: 0 }));
    res.json({ results, semantic: false });
  });

  app.post('/api/tools/library/apply', async (req, res) => {
    const grant = authorizeToolRequest(req, res, 'library:apply');
    if (!grant) return;
    if (!toolApplyOk('global')) {
      return sendApiError(res, 429, 'TOOL_LIBRARY_APPLY_RATE_LIMITED', 'too many apply requests; try again shortly');
    }
    const assetId = typeof req.body?.assetId === 'string' ? req.body.assetId : '';
    if (!assetId) return sendApiError(res, 400, 'BAD_REQUEST', 'assetId is required');
    const asset = getLibraryAsset(db, assetId);
    if (!asset) return sendApiError(res, 404, 'NOT_FOUND', 'asset not found');
    const projectId = grant.projectId ?? (typeof req.body?.projectId === 'string' ? req.body.projectId : '');
    if (!projectId) return sendApiError(res, 400, 'BAD_REQUEST', 'projectId is required');
    try {
      const includeElement = req.body?.includeElement === true;
      const result = await applyAssetToProject(asset, projectId, 'agent-task', req.body?.dir, includeElement);
      res.json({
        relPath: result.relPath,
        ...(result.elementRelPath ? { elementRelPath: result.elementRelPath } : {}),
      });
    } catch (err) {
      return sendApiError(res, 500, 'APPLY_FAILED', err instanceof Error ? err.message : String(err));
    }
  });

  // --- live events ---------------------------------------------------------

  // Loopback-only -- see GET /api/library/assets/:id's comment above. No
  // persisted mutation (impact floor 0), but still a read of live ingest
  // activity, so the same "reads ride the loopback binding" intent applies.
  app.get('/api/library/events', requireLocalDaemonRequest, (req, res) => {
    const sse = createSseResponse(res);
    const listener = (event: string, data: unknown) => sse.send(event, data);
    sseClients.add(listener);
    sse.send('ready', { ok: true });
    req.on('close', () => {
      sseClients.delete(listener);
      sse.cleanup();
    });
  });
}
