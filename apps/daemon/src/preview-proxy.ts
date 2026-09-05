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

export type PreviewRootAssetFallbackDeps = PreviewProxyDeps & {
  /** Whether any preview session is running on this daemon right now. */
  hasLivePreview: () => boolean;
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

/**
 * The preview page a browser attributes this request to, or null when it
 * attributes it to no preview page.
 *
 * `Referer` is the attribution, and its HOST must name this daemon front: a
 * `Referer` written by some other site names some other site's page, whatever
 * path it carries, so the path alone must never be enough to claim a session.
 */
function referringPreviewPage(headers: IncomingHttpHeaders): ParsedPreviewProxyPath | null {
  const raw = headerText(headers.referer).trim();
  if (!raw) return null;
  let referer: URL;
  try {
    referer = new URL(raw);
  } catch {
    return null;
  }
  if (!frontHosts(headers).includes(referer.host)) return null;
  return parsePreviewProxyPath(`${referer.pathname}${referer.search}`);
}

/**
 * A preview page is somebody else's program served from the daemon's own
 * origin, so it must not be able to act as the Open Design app: every `/api`
 * request a browser attributes to a preview page is confined to THAT
 * preview's own subtree, and any other `/api` path is refused.
 *
 * This is the containment the daemon already applies to the powered-preview
 * surface (`_POWERED_PREVIEW_SAFE_RE`, `server.ts`), restated for the shape
 * where a sibling origin is not available: a collaborator reaches the daemon
 * under exactly one name, so a preview cannot be handed a second one the way
 * `poweredPreviewHost()` hands one to a loopback caller.
 *
 * What it does NOT do: `Referer` is attribution, not a sandbox. A preview page
 * that suppresses its own `Referer` (`referrerPolicy: 'no-referrer'`) is
 * attributed to nothing and is then held only by the daemon's ordinary gates,
 * which admit any loopback peer on the daemon's own machine. A CSP sandbox
 * would be browser-enforced instead, but only without `allow-same-origin`,
 * which puts the preview in an opaque origin and breaks every dev server that
 * calls its own API. So serving a preview from the daemon's origin trusts the
 * preview's code as far as the session that started it — which is the audience
 * D-14 fixed, authenticated Open Design sessions. `PreviewInfo.url` records
 * that where a reader meets the URL.
 *
 * And under `tools-dev` it is inert. The Next dev front forwards `/api` with
 * its own upstream `Host` and no `X-Forwarded-Host`, so `frontHosts()` never
 * holds the host the browser used, `referringPreviewPage` attributes every
 * request to nothing, and a preview page is held only by the daemon's ordinary
 * gates. That is the same front behaviour `preview-origin.ts` records for HMR.
 * The runtime this rule guards is the shipped one, where the daemon serves the
 * web app itself and a preview page's `Referer` reaches it intact.
 */
export function isPreviewProxyOriginEscape(headers: IncomingHttpHeaders, apiPath: string): boolean {
  const page = referringPreviewPage(headers);
  if (!page) return false;
  const target = parsePreviewProxyPath(apiPath);
  return !target || target.projectId !== page.projectId || target.previewId !== page.previewId;
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

/**
 * Every host that names THIS daemon front from the caller's side: the `Host`
 * it arrived with, and — for a front that rewrites `Host` to its own upstream
 * address, which is what `tailscale serve` does — the first
 * `X-Forwarded-Host` entry, the original client's.
 */
function frontHosts(headers: IncomingHttpHeaders): string[] {
  const hosts: string[] = [];
  const host = headerText(headers.host).trim();
  if (host) hosts.push(host);
  const forwarded = (headerText(headers['x-forwarded-host']).split(',')[0] ?? '').trim();
  if (forwarded) hosts.push(forwarded);
  return hosts;
}

function headerText(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? '');
  return value === undefined || value === null ? '' : String(value);
}

/**
 * A browser-initiated request whose `Origin` names a different site.
 *
 * Compared against every host that names this front, not against `Host`
 * alone: behind a front that rewrites `Host` to its own upstream address the
 * browser still sends the tailnet `Origin`, and a `Host`-only comparison would
 * refuse the very collaborator this route exists for.
 */
function isCrossSiteOrigin(headers: IncomingHttpHeaders): boolean {
  const origin = headerText(headers.origin).trim();
  if (!origin || origin === 'null') return false;
  try {
    return !frontHosts(headers).includes(new URL(origin).host);
  } catch {
    return true;
  }
}

/**
 * The headers the child sees. `body` is the request body as the daemon holds
 * it: the raw parser in front of the mount decodes a compressed body, so when
 * one was read the framing headers must describe THOSE bytes — a forwarded
 * `Content-Encoding` would tell the child to decode plaintext, and a forwarded
 * `Content-Length` would name the compressed size. Passing `null` (the
 * streamed path, and every bodyless request) leaves the caller's framing
 * alone.
 */
function upstreamRequestHeaders(
  headers: IncomingHttpHeaders,
  port: number,
  keepUpgrade: boolean,
  body: Buffer | null,
): IncomingHttpHeaders {
  const forwarded: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (NEVER_FORWARDED_HEADERS.has(name)) continue;
    if (HOP_BY_HOP_HEADERS.has(name) && !(keepUpgrade && (name === 'connection' || name === 'upgrade'))) continue;
    if (body && (name === 'content-encoding' || name === 'content-length')) continue;
    forwarded[name] = value;
  }
  if (body) forwarded['content-length'] = String(body.length);
  forwarded.host = `${LOOPBACK_HOST}:${port}`;
  return forwarded;
}

/**
 * Every name the preview child's own origin answers to. The daemon binds the
 * child to a loopback interface on the machine it runs on, but the child
 * chooses how to spell that interface when it writes a redirect: a dev server
 * echoes back the `localhost` it was configured with, an IPv6 stack writes
 * `[::1]`, and a wildcard bind reports `0.0.0.0`. All of them mean the same
 * unreachable address to a collaborator.
 */
const CHILD_LOOPBACK_HOSTNAMES = new Set([LOOPBACK_HOST, 'localhost', '::1', '0.0.0.0']);

/** An absolute or scheme-relative target, read for the origin it names. */
function parseLocationOrigin(location: string): URL | null {
  try {
    // A scheme-relative target carries no scheme, so it needs a base to parse
    // against. Which base does not matter: only the host and port it names
    // decide the answer, and both are written in the target itself.
    return location.startsWith('//') ? new URL(location, 'http://scheme-relative.invalid') : new URL(location);
  } catch {
    return null;
  }
}

/** The registered session's own origin, under any loopback spelling. */
function isPreviewChildOrigin(url: URL, port: number): boolean {
  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  return CHILD_LOOPBACK_HOSTNAMES.has(hostname) && url.port === String(port);
}

/**
 * A redirect that leaves the proxy leaves the collaborator's reach, so every
 * target that names the child itself comes back re-anchored on the preview's
 * base path: a root-absolute path, which resolves to the daemon's root rather
 * than the preview's, and any spelling of the child's own loopback origin on
 * the port this session registered — written absolutely or scheme-relatively
 * (`//127.0.0.1:<port>/next`). Anything else (an off-site redirect, a
 * loopback port that is not this session's, a relative target) is already
 * correct and passes through untouched.
 */
export function rewriteUpstreamLocation(location: string, basePath: string, port: number): string {
  if (location.startsWith('/') && !location.startsWith('//')) return `${basePath}${location.slice(1)}`;
  const url = parseLocationOrigin(location);
  if (!url || !isPreviewChildOrigin(url, port)) return location;
  return `${basePath}${url.pathname.replace(/^\//, '')}${url.search}${url.hash}`;
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

/**
 * A preview failure said in words, in the shape the caller asked for. A reader
 * meets these in a browser tab or a devtools response body, so the cause has to
 * be IN the answer: a status alone names nothing.
 */
function sendPreviewFailure(req: Request, res: Response, code: string, title: string, message: string): void {
  if (req.accepts(['json', 'html']) === 'html') {
    res.status(404).type('html').send(
      `<!doctype html><meta charset="utf-8"><title>${title}</title><p>${message}</p>`,
    );
    return;
  }
  res.status(404).json({ error: code, message });
}

/** The named answer for a chat link whose preview has since stopped. */
function sendPreviewGone(req: Request, res: Response): void {
  sendPreviewFailure(
    req,
    res,
    'PREVIEW_NOT_FOUND',
    'Preview stopped',
    'This preview server is no longer running. Previews stop when they are stopped by hand or when the daemon restarts; start a new one to get a fresh link.',
  );
}

/** The named answer for a preview asset no page claimed. */
function sendPreviewNeedsReferrer(req: Request, res: Response): void {
  sendPreviewFailure(
    req,
    res,
    'PREVIEW_REFERRER_REQUIRED',
    'Preview asset needs a page referrer',
    'This file was asked for by site root, and the page that asked sent no referrer, so Open Design cannot tell which preview it belongs to. A preview page that suppresses its referrer — a no-referrer policy, a privacy extension — cannot load its root-absolute assets through this link; ask for the file under the preview path instead.',
  );
}

/**
 * One proxied exchange: request headers minus this hop's, the body verbatim,
 * the response streamed back as it arrives, and the two headers that carry a
 * URL re-anchored on the preview's base path.
 */
function proxyToPreview(req: Request, res: Response, session: PreviewInfo, upstreamPath: string): void {
  const basePath = previewProxyPath(session.projectId, session.id);
  // The raw body parser in front of this mount has already read the request,
  // so it arrives as bytes; the stream form is kept for callers mounted
  // without it, and for the bodyless asset fallback.
  const body = Buffer.isBuffer(req.body) ? req.body : null;
  const upstream = http.request({
    host: LOOPBACK_HOST,
    port: session.port,
    method: req.method,
    path: upstreamPath,
    headers: upstreamRequestHeaders(req.headers, session.port, false, body),
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

  if (body) upstream.end(body.length ? body : undefined);
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
 * The path prefixes the daemon's own routes answer, read from `server.ts`'s
 * route registrations: `/api` (every REST and SSE endpoint, the preview proxy
 * mount included), `/artifacts` and `/frames` (the two static mounts).
 * `static-spa.ts` keeps the same list for the SPA fallback registered after
 * this one, and for the same reason.
 */
const DAEMON_OWNED_PATH_PREFIXES = ['/api', '/artifacts', '/frames'] as const;

/**
 * A path inside a namespace the daemon owns, whether or not a route under it
 * matched.
 *
 * A miss there is still the daemon's own answer to give: an unknown `/api`
 * endpoint has no handler, and the `/artifacts` and `/frames` static mounts
 * call `next()` on a file they do not hold. Such a request named a daemon
 * resource, so it can never be a preview page's root-absolute asset — a
 * preview's own bytes are reached through `previewProxyPath()`, and a dev
 * server asks for its assets by SITE root, outside every namespace above.
 * Classifying one as an unattributable preview asset would explain a preview
 * to a caller who never asked about one.
 *
 * Compared case-insensitively, because that is how the routes themselves
 * match: Express's `caseSensitive` setting is off by default, so `/API/nope`
 * enters the same `/api` router `/api/nope` does and falls through the same
 * way. A case-sensitive test here would hand the daemon's own namespaces back
 * to the classifier under any other spelling.
 */
function isDaemonOwnedPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return DAEMON_OWNED_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * The one fall-through the daemon owes an explanation for: a preview page's
 * root-absolute asset that no page claimed.
 *
 * `Referer` is how the fallback above attributes an asset to a session, and a
 * page under a `no-referrer` policy (or behind a privacy extension) sends
 * none. Such a request is indistinguishable from any other path the daemon
 * does not own, so it used to leave through the daemon's ordinary answer —
 * a bare 404, or the app's own `index.html` where the daemon serves the web
 * app — and the preview half-rendered with nothing said. It cannot be SERVED
 * without body rewriting or a per-preview origin, so it is NAMED instead.
 *
 * Five conditions, each keeping a different request out of that answer:
 *
 * - the path lies outside every namespace the daemon's own routes own
 *   (`isDaemonOwnedPath` above), because a miss inside one of those is the
 *   daemon's answer, not a preview's;
 * - a preview is running, because otherwise the explanation would name
 *   something that does not exist;
 * - no `Referer` at all, because a `Referer` that names another site or
 *   another path is somebody else's page and gets told nothing about the
 *   previews on this daemon;
 * - the caller asked for a subresource, not a page. A browser admits
 *   `text/html` when it navigates and does not when it fetches a script,
 *   stylesheet, image or font, and a navigation with no `Referer` is the
 *   ordinary way a person opens the app — that one belongs to the SPA
 *   fallback registered after this one (`static-spa.ts`);
 * - and the membership rule this handler already applies, so the existence of
 *   a running preview is disclosed to the same audience its bytes are.
 */
function isUnattributablePreviewAsset(req: Request, hasLivePreview: boolean): boolean {
  if (isDaemonOwnedPath(req.path)) return false;
  if (!hasLivePreview) return false;
  if (headerText(req.headers.referer).trim()) return false;
  const accept = headerText(req.headers.accept).toLowerCase();
  if (!accept || accept.includes('text/html')) return false;
  return !isCrossSiteOrigin(req.headers) && isAuthorizedPreviewProxyRequest(req);
}

/**
 * A dev server asks for its assets by site root (`/_next/static/…`), which
 * resolves to the daemon's root rather than the preview's base path. The
 * browser names the page that asked in `Referer`, and `Referer` cannot be
 * forged from script, so a root-absolute GET whose referring page IS a live
 * preview on this front is answered from that preview.
 *
 * Registered last, after every daemon route, so it can only claim paths the
 * daemon does not own. It carries no more authority than the proxy route it
 * borrows its session from, and it applies the same membership rule, because
 * paths outside `/api` do not pass through the bearer middleware.
 *
 * It can only answer requests that reach the daemon. That is every request in
 * the shipped runtime, where the daemon serves the web app too; under
 * `tools-dev` the front is the Next dev server, which forwards only `/api`,
 * `/artifacts` and `/frames`, so a root-absolute asset asked for through that
 * front stops there. Which front a caller is on is reported to them on
 * `PreviewInfo.frontServesRootAbsoluteAssets` (`preview-origin.ts`), so the
 * surface offering the link can say so rather than half-render in silence.
 * A request that reaches the daemon and still names no page is answered in
 * words instead (`isUnattributablePreviewAsset` above).
 */
export function createPreviewRootAssetFallback(deps: PreviewRootAssetFallbackDeps): RequestHandler {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const referred = referringPreviewPage(req.headers);
    if (!referred) {
      if (isUnattributablePreviewAsset(req, deps.hasLivePreview())) return sendPreviewNeedsReferrer(req, res);
      return next();
    }
    const session = deps.getPreview(referred.previewId);
    if (!session || session.projectId !== referred.projectId) return next();
    if (isCrossSiteOrigin(req.headers) || !isAuthorizedPreviewProxyRequest(req)) return next();
    proxyToPreview(req, res, session, req.originalUrl);
  };
}

/**
 * Close an upgrade the child would not carry, saying so on the wire. A socket
 * destroyed in silence reaches the browser as a bare network error, which
 * names nothing the reader can act on.
 */
function refusePreviewUpgrade(socket: Duplex, reason: string): void {
  if (socket.writable) {
    const body = `preview upgrade refused: ${reason}`;
    socket.write(
      'HTTP/1.1 502 Bad Gateway\r\n'
      + 'Content-Type: text/plain\r\n'
      + `Content-Length: ${Buffer.byteLength(body)}\r\n`
      + 'Connection: close\r\n\r\n'
      + body,
    );
  }
  socket.destroy();
}

/**
 * An upgrade socket this handler touches always has an `error` listener, and
 * it is attached before anything can await.
 *
 * Node removes its own `error` listener from the socket before it emits
 * `upgrade`, so from that moment the socket belongs to whoever took the event.
 * A socket held with none of its own turns an ordinary client reset — a browser
 * that reloads or closes the tab while the preview child is still compiling and
 * has not answered the handshake — into an unheard `error` event, which Node
 * raises as an `uncaughtException`. The daemon's fatal handler
 * (`registerTelemetryRoutes`, `routes/telemetry.ts`) escalates that to
 * `process.exit(1)`, so one abandoned HMR connect would take down every session
 * on the machine. `streamAssetFileToResponse` (`routes/library.ts`) names the
 * same class on the HTTP side, where the request object carries the listener.
 */
function ownUpgradeSocket(socket: Duplex): void {
  socket.on('error', () => socket.destroy());
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
    ownUpgradeSocket(socket);
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
      headers: upstreamRequestHeaders(req.headers, session.port, true, null),
    });

    // A child that accepts the connection and then says nothing must not hold
    // the caller's socket open forever; the HTTP path is bounded the same way.
    upstream.setTimeout(PREVIEW_PROXY_IDLE_TIMEOUT_MS, () => {
      upstream.destroy(new Error('preview server stopped responding'));
    });

    // The mirror of the HTTP path's `res.on('close')`: a caller who leaves
    // must not leave the child holding a connection. Before the handshake that
    // is the pending request, which would otherwise sit until the idle
    // timeout; after it, the same call destroys the piped upstream socket,
    // which by then has nowhere left to write.
    socket.on('close', () => upstream.destroy());

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

    // The child answered an upgrade with an ordinary response: it does not
    // speak this protocol. Say so on the wire rather than closing silently,
    // which a browser can only report as a network error.
    upstream.on('response', (upstreamRes) => refusePreviewUpgrade(socket, `preview answered ${upstreamRes.statusCode}`));
    upstream.on('error', (error) => refusePreviewUpgrade(socket, error.message));
    if (head?.length) socket.unshift(head);
    upstream.end();
  };
}
