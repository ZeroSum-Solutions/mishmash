import http from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import type { Request, RequestHandler, Response } from 'express';

import { apiTokenFromEnv, isApiTokenMiddlewareEnabled, isMatchingApiToken } from './api-token-auth.js';
import { isLoopbackPeerAddress } from './http/local-daemon-request.js';
import type { PreviewInfo } from './previews.js';

/**
 * A preview server is reachable exactly where the daemon is (decision D-14,
 * option A).
 *
 * The daemon spawns preview children with `PORT` and nothing else, so it
 * cannot make one bind anywhere but its own machine, and it proves readiness
 * over `127.0.0.1`. Announcing that port on the caller's hostname produced a
 * URL nobody was listening on. The daemon therefore serves each preview from
 * its OWN origin instead: a collaborator who can reach Open Design can reach
 * every preview it is running, over the same scheme, the same front, and the
 * same authentication — and the child stays loopback-bound, never published.
 *
 * The upstream is derived only from the registered session and the fixed
 * loopback address. Nothing in a proxied request can name a different one.
 */

const LOOPBACK_HOST = '127.0.0.1';

/** Express mount for the proxy; `app.use` strips it and leaves the child's path. */
export const PREVIEW_PROXY_MOUNT = '/api/projects/:id/previews/:previewId/proxy';

/** Bounds a stalled upstream. Keep-alived streams (SSE, HMR) reset it. */
const PREVIEW_PROXY_IDLE_TIMEOUT_MS = 300_000;

/**
 * Headers that describe THIS hop and must not be relayed to the next one
 * (RFC 9110 §7.6.1). `upgrade` and `connection` are re-added by name on the
 * WebSocket path, which is the one hop that is deliberately end-to-end.
 */
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Never handed to a preview child: `host` is replaced with the loopback
 * upstream, and `authorization` carries the daemon's own OD_API_TOKEN, which
 * a project's dev server has no business seeing.
 */
const NEVER_FORWARDED_HEADERS = new Set(['host', 'authorization']);

export type PreviewLookup = (previewId: string) => PreviewInfo | undefined;

export type PreviewProxyDeps = {
  /** The registered session, or undefined once it has stopped. */
  getPreview: PreviewLookup;
};

/** The daemon-origin path a preview is served under. Always ends in `/`. */
export function previewProxyPath(projectId: string, previewId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/previews/${encodeURIComponent(previewId)}/proxy/`;
}

export type ParsedPreviewProxyPath = {
  projectId: string;
  previewId: string;
  /** The child's own path, always absolute and starting with `/`. */
  upstreamPath: string;
};

const PREVIEW_PROXY_PATH_RE = /^\/api\/projects\/([^/]+)\/previews\/([^/]+)\/proxy(\/.*)?$/;

/** Read a daemon-origin proxy URL back into the session it names. */
export function parsePreviewProxyPath(pathAndQuery: string | null | undefined): ParsedPreviewProxyPath | null {
  if (typeof pathAndQuery !== 'string' || !pathAndQuery.startsWith('/')) return null;
  const [rawPath = '', ...rest] = pathAndQuery.split('?');
  const match = PREVIEW_PROXY_PATH_RE.exec(rawPath);
  if (!match) return null;
  const query = rest.length ? `?${rest.join('?')}` : '';
  let projectId: string;
  let previewId: string;
  try {
    projectId = decodeURIComponent(match[1]!);
    previewId = decodeURIComponent(match[2]!);
  } catch {
    return null;
  }
  return { projectId, previewId, upstreamPath: `${match[3] || '/'}${query}` };
}

/** The path part of a same-origin `Referer`, or null when there is none. */
function refererPath(referer: unknown): string | null {
  const raw = Array.isArray(referer) ? referer[0] : referer;
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const url = new URL(raw);
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * The membership rule the rest of `/api` already enforces, applied by hand on
 * the two entry points Express middleware cannot cover: the WebSocket upgrade,
 * which never enters the router, and the root-absolute asset fallback, which
 * answers paths outside `/api`. Loopback peers pass (the desktop UI and the
 * web front both reach the daemon that way); everyone else presents the
 * bearer. With no token configured the daemon has no membership rule to
 * enforce and this mirrors that.
 */
export function isAuthorizedPreviewProxyRequest(req: { socket?: { remoteAddress?: unknown }; headers: IncomingHttpHeaders }): boolean {
  if (!isApiTokenMiddlewareEnabled()) return true;
  if (isLoopbackPeerAddress(req.socket?.remoteAddress)) return true;
  const authorization = req.headers.authorization ?? '';
  const presented = /^Bearer\s+(\S+)\s*$/i.exec(Array.isArray(authorization) ? authorization[0] ?? '' : authorization);
  return Boolean(presented && isMatchingApiToken(presented[1]!, apiTokenFromEnv()));
}

/** A browser-initiated request whose `Origin` names a different site. */
function isCrossSiteOrigin(headers: IncomingHttpHeaders): boolean {
  const origin = Array.isArray(headers.origin) ? headers.origin[0] : headers.origin;
  if (typeof origin !== 'string' || !origin || origin === 'null') return false;
  try {
    return new URL(origin).host !== String(headers.host ?? '');
  } catch {
    return true;
  }
}

function upstreamRequestHeaders(headers: IncomingHttpHeaders, port: number, keepUpgrade: boolean): IncomingHttpHeaders {
  const forwarded: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (NEVER_FORWARDED_HEADERS.has(name)) continue;
    if (HOP_BY_HOP_HEADERS.has(name) && !(keepUpgrade && (name === 'connection' || name === 'upgrade'))) continue;
    forwarded[name] = value;
  }
  forwarded.host = `${LOOPBACK_HOST}:${port}`;
  return forwarded;
}

/**
 * A redirect the child wrote against its own root would send the browser to
 * the daemon's root instead, so root-absolute and loopback-absolute targets
 * are re-anchored on the preview's base path. Anything else (an off-site
 * redirect, a relative one) is already correct.
 */
export function rewriteUpstreamLocation(location: string, basePath: string, port: number): string {
  if (location.startsWith('//')) return location;
  if (location.startsWith('/')) return `${basePath}${location.slice(1)}`;
  try {
    const url = new URL(location);
    if (url.hostname !== LOOPBACK_HOST || url.port !== String(port)) return location;
    return `${basePath}${url.pathname.replace(/^\//, '')}${url.search}${url.hash}`;
  } catch {
    return location;
  }
}

/**
 * A preview cookie must not ride along on the daemon's own API calls, so its
 * `Path` is pinned to the preview's base path. A cookie the child scoped to a
 * sub-path keeps that scope, re-anchored the same way.
 */
export function rewriteUpstreamSetCookie(setCookie: string, basePath: string): string {
  const parts = setCookie.split(';');
  const kept = parts.filter((part) => !/^\s*path\s*=/i.test(part));
  const declared = parts.find((part) => /^\s*path\s*=/i.test(part));
  const declaredPath = declared ? declared.split('=').slice(1).join('=').trim() : '/';
  const scoped = declaredPath.startsWith('/')
    ? `${basePath}${declaredPath.replace(/^\//, '')}`
    : basePath;
  return [...kept, ` Path=${scoped}`].join(';');
}

/** The named answer for a chat link whose preview has since stopped. */
function sendPreviewGone(req: Request, res: Response): void {
  const message =
    'This preview server is no longer running. Previews stop when they are stopped by hand or when the daemon restarts; start a new one to get a fresh link.';
  if (req.accepts(['json', 'html']) === 'html') {
    res.status(404).type('html').send(
      `<!doctype html><meta charset="utf-8"><title>Preview stopped</title><p>${message}</p>`,
    );
    return;
  }
  res.status(404).json({ error: 'PREVIEW_NOT_FOUND', message });
}

/**
 * One proxied exchange: request headers minus this hop's, the body verbatim,
 * the response streamed back as it arrives, and the two headers that carry a
 * URL re-anchored on the preview's base path.
 */
function proxyToPreview(req: Request, res: Response, session: PreviewInfo, upstreamPath: string): void {
  const basePath = previewProxyPath(session.projectId, session.id);
  const upstream = http.request({
    host: LOOPBACK_HOST,
    port: session.port,
    method: req.method,
    path: upstreamPath,
    headers: upstreamRequestHeaders(req.headers, session.port, false),
  });

  upstream.setTimeout(PREVIEW_PROXY_IDLE_TIMEOUT_MS, () => {
    upstream.destroy(new Error('preview server stopped responding'));
  });

  upstream.on('response', (upstreamRes) => {
    for (const [name, value] of Object.entries(upstreamRes.headers)) {
      if (value === undefined || HOP_BY_HOP_HEADERS.has(name)) continue;
      if (name === 'location' && typeof value === 'string') {
        res.setHeader(name, rewriteUpstreamLocation(value, basePath, session.port));
        continue;
      }
      if (name === 'set-cookie') {
        const cookies = Array.isArray(value) ? value : [String(value)];
        res.setHeader(name, cookies.map((cookie) => rewriteUpstreamSetCookie(cookie, basePath)));
        continue;
      }
      res.setHeader(name, value);
    }
    res.status(upstreamRes.statusCode ?? 502);
    upstreamRes.pipe(res);
  });

  upstream.on('error', (error) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(502).json({
      error: 'PREVIEW_UNREACHABLE',
      message: `the preview server on port ${session.port} did not answer: ${error.message}`,
    });
  });

  // A reader who navigates away must not leave a request running against the
  // child, and a stream the child is still writing must be cut at the source.
  res.on('close', () => {
    if (!res.writableEnded) upstream.destroy();
  });

  // The raw body parser in front of this mount has already read the request,
  // so it arrives as bytes; the stream form is kept for callers mounted
  // without it.
  if (Buffer.isBuffer(req.body)) upstream.end(req.body.length ? req.body : undefined);
  else req.pipe(upstream);
}

/**
 * `ALL /api/projects/:id/previews/:previewId/proxy/*` — the preview, served
 * from the daemon's own origin. Mounted inside `/api`, so it inherits the
 * daemon's origin gate and its bearer policy; project and preview ownership
 * are checked here.
 */
export function createPreviewProxyHandler(deps: PreviewProxyDeps): RequestHandler {
  return (req, res) => {
    const parsed = parsePreviewProxyPath(req.originalUrl);
    if (!parsed) {
      res.status(404).json({ error: 'PREVIEW_NOT_FOUND' });
      return;
    }
    const session = deps.getPreview(parsed.previewId);
    if (!session || session.projectId !== parsed.projectId) {
      sendPreviewGone(req, res);
      return;
    }
    proxyToPreview(req, res, session, parsed.upstreamPath);
  };
}

/**
 * A dev server asks for its assets by site root (`/_next/static/…`), which
 * resolves to the daemon's root rather than the preview's base path. The
 * browser names the page that asked in `Referer`, and `Referer` cannot be
 * forged from script, so a root-absolute GET whose referring page IS a live
 * preview is answered from that preview.
 *
 * Registered last, after every daemon route, so it can only claim paths the
 * daemon does not own. It carries no more authority than the proxy route it
 * borrows its session from, and it applies the same membership rule, because
 * paths outside `/api` do not pass through the bearer middleware.
 */
export function createPreviewRootAssetFallback(deps: PreviewProxyDeps): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const referred = parsePreviewProxyPath(refererPath(req.headers.referer));
    if (!referred) return next();
    const session = deps.getPreview(referred.previewId);
    if (!session || session.projectId !== referred.projectId) return next();
    if (isCrossSiteOrigin(req.headers) || !isAuthorizedPreviewProxyRequest(req)) return next();
    proxyToPreview(req, res, session, req.originalUrl);
  };
}

/**
 * The WebSocket half of the same route: a dev server's HMR channel. An
 * upgrade never enters the Express router, so the membership rule and the
 * same-site check are applied here, and a request that names no live preview
 * closes the socket rather than answering.
 */
export function createPreviewProxyUpgradeHandler(
  deps: PreviewProxyDeps,
): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  return (req, socket, head) => {
    const parsed = parsePreviewProxyPath(req.url);
    if (!parsed) {
      socket.destroy();
      return;
    }
    const session = deps.getPreview(parsed.previewId);
    if (!session || session.projectId !== parsed.projectId) {
      socket.destroy();
      return;
    }
    if (isCrossSiteOrigin(req.headers) || !isAuthorizedPreviewProxyRequest(req)) {
      socket.destroy();
      return;
    }

    const upstream = http.request({
      host: LOOPBACK_HOST,
      port: session.port,
      method: req.method,
      path: parsed.upstreamPath,
      headers: upstreamRequestHeaders(req.headers, session.port, true),
    });

    upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
      const statusLine = `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\n`;
      const headerLines = upstreamRes.rawHeaders
        .reduce<string[]>((lines, value, index) => {
          if (index % 2 === 0) lines.push(value);
          else lines[lines.length - 1] = `${lines[lines.length - 1]}: ${value}`;
          return lines;
        }, [])
        .join('\r\n');
      socket.write(`${statusLine}${headerLines}\r\n\r\n`);
      if (upstreamHead?.length) upstreamSocket.unshift(upstreamHead);
      upstreamSocket.on('error', () => socket.destroy());
      socket.on('error', () => upstreamSocket.destroy());
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
    });

    upstream.on('response', () => socket.destroy());
    upstream.on('error', () => socket.destroy());
    if (head?.length) socket.unshift(head);
    upstream.end();
  };
}
