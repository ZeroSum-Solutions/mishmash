// Headless capture core for the desktop-renderer sidecar (MM-005).
//
// Sidecar-boundary-agnostic per apps/daemon/AGENTS.md ("app business logic
// must not know about sidecar/control-plane concepts"): this module knows
// nothing about JSON-IPC, sockets, or process stamps -- it is a pure
// input -> output function over the sidecar-proto render/export shapes.
// server.ts owns every IPC concern.
//
// Adapted from apps/daemon/src/covers/renderer.ts's bounded-Playwright
// pattern (launchServer for a real OS pid, a per-job timeout race, an
// out-of-process RSS memory ceiling, orphan-pid reaping), but NOT a shared
// instance of it: covers/ renders TRUSTED PROJECT FILES over a project-
// scoped local file server with a full network deny. This module renders
// AGENT-SUPPLIED HTML received over IPC from the daemon, which legitimately
// needs one thing covers never did -- read access to the daemon's own
// loopback HTTP origin (`baseHref`, for relative asset URLs) -- so the
// network policy here is a single-origin allowlist derived from a
// validated `baseHref`, not a blanket deny. See resolveRenderNetworkPolicy
// below for the exact guarantee and how it is enforced across every
// network entry point Chromium exposes to the page, not only ordinary
// HTTP subresource fetches.

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Route } from "playwright";
import sharp from "sharp";

import { DECK_SLIDE_SELECTOR } from "@open-design/contracts/runtime/deck-stage-fallback";
import { withProjectAssetBaseHref } from "@open-design/contracts/runtime/project-asset-base";
import type {
  DesktopExportArtifactInput,
  DesktopExportArtifactResult,
  DesktopRenderSlidesInput,
  DesktopRenderSlidesResult,
} from "@open-design/sidecar-proto";

import { RenderMemoryLimitError, RenderTimeoutError } from "../../covers/errors.js";
import { createLimiter } from "../../covers/limiter.js";
import { aggregateProcessTreeRssKb } from "../../covers/process-rss.js";
import { registerRenderPid, unregisterRenderPid } from "../../covers/render-pid-registry.js";

/** Concurrency cap for this renderer's own browser jobs. A fresh instance
 * of the covers/limiter.ts primitive, deliberately not the SAME limiter
 * object covers uses -- this process never shares state with covers'. */
export const RENDER_CONCURRENCY = 2;

/** Per-job hard deadline. Agent-authored decks/pages can be heavier than a
 * cover capture (embedded base64 images, web fonts), so this sits well
 * above covers' 20s -- still comfortably inside the daemon's 600s IPC
 * timeout headroom (sidecar/server.ts). */
export const PER_JOB_TIMEOUT_MS = 60_000;

const MEMORY_POLL_INTERVAL_MS = 150;
/** Same ceiling covers/renderer.ts uses. Spec risk note: agent HTML may
 * warrant a different real-world value; kept identical pending empirical
 * re-tuning, not because the two workloads are assumed equivalent. */
const MEMORY_GROWTH_CEILING_KB = 1024 * 1024; // 1 GB

const DEFAULT_DECK_WIDTH = 1920;
const DEFAULT_DECK_HEIGHT = 1080;
const DEFAULT_PAGE_WIDTH = 1280;
const DEFAULT_PAGE_HEIGHT = 800;

class DesktopRenderError extends Error {
  readonly errorCode?: DesktopRenderSlidesResult["errorCode"];
  constructor(message: string, errorCode?: DesktopRenderSlidesResult["errorCode"]) {
    super(message);
    this.name = "DesktopRenderError";
    this.errorCode = errorCode;
  }
}

/** The renderer's per-job network guarantee, derived once from a validated
 * `baseHref`. Everything downstream (`route()`'s controlled-fetch
 * redirect-chain validation, `routeWebSocket()`, and the response
 * safety-net) is driven off this one object.
 *
 * **The actual guarantee (review round 3 finding 2 -- state this exactly,
 * do not overclaim):**
 *
 * - Every HTTP(S)-shaped request Playwright's `context.route()` intercepts
 *   (fetch/XHR, EventSource, subresources, ordinary/iframe navigation) is
 *   validated against `assetPrefix` PER HOP before it is ever fetched --
 *   an off-prefix target, including one reached by redirect from an
 *   in-prefix URL (review round 2), is never fetched at all.
 * - WebSocket is unconditionally banned via `routeWebSocket()` --
 *   `connectToServer()` is never called, so no real connection is ever
 *   opened for any WebSocket the page attempts, allowed origin or not.
 * - Service Workers are disabled outright (`serviceWorkers: "block"`).
 * - `--host-resolver-rules=MAP * 0.0.0.0` blackholes HOSTNAME-based DNS
 *   lookups only.
 * - One narrow, documented exception: the priming navigation (see
 *   `isUnusedPrimingNavigation` and the call site in
 *   `runBoundedRenderOnce`) uses plain `route.continue()`, so a
 *   DAEMON-controlled redirect on that exact URL is followed and its
 *   target's handler runs once before the render notices -- covered by a
 *   post-navigation URL check, not by `route()`.
 *
 * **What this guarantee explicitly does NOT cover, since the dead-proxy
 * backstop was removed (`route.fetch()` does not honor Chromium's proxy
 * bypass list -- see the removal note in `runBoundedRenderOnce`):** any
 * network path that opens a socket WITHOUT going through
 * `context.route()`/`routeWebSocket()` -- most notably WebRTC (ICE
 * candidate gathering can probe literal loopback IPs directly; mitigated
 * cheaply below via `--force-webrtc-ip-handling-policy`, not eliminated by
 * `route()`), and in general any literal IP-literal or non-HTTP(S)/WS
 * channel Chromium might expose that this module has not identified.
 * There is no process-level "nothing reaches the network without
 * `context.route()`" backstop for those. The threat model this renderer
 * actually defends is "Playwright-intercepted HTTP(S) + WS", not "every
 * socket the browser process could ever open".
 */
export interface RenderNetworkPolicy {
  /** The exact validated `http://127.0.0.1:<port>` origin. */
  readonly origin: string;
  /** `<origin>` + the daemon's raw-asset route prefix for THIS project
   * (`/api/projects/<id>/raw/`) -- the only absolute URL prefix
   * `context.route()` ever fulfills with real content. Deliberately
   * narrower than `origin`: the daemon's other `/api/*` routes (chat,
   * export, project management, ...) on the same origin stay unreachable
   * even though they share a host/port with the legitimate asset route
   * (review finding 2 -- "origin-wide allowlist enables same-origin
   * read+screenshot exfil"), INCLUDING when reached via a redirect from an
   * in-prefix URL (review round 2). Falls back to the exact `baseHref`
   * string (never the bare origin) when the daemon's raw-route shape isn't
   * recognized -- narrower-than-expected is always the safe failure mode
   * here. */
  readonly assetPrefix: string;
  /** The parsed, re-serialized `baseHref` (`URL#href`) the rendered document
   * states as its asset base through `withProjectAssetBaseHref` -- the same
   * rule the srcDoc preview and the live-artifact route apply, so a deck
   * exported from a page resolves that page's relative CSS/JS/image URLs
   * exactly where the preview did. Always an http URL, never a filesystem
   * path, and never the raw caller string, so an unusual encoding in the
   * input can't smuggle a different string past validation (review finding 9). */
  readonly injectedHref: string;
}

const RAW_ROUTE_PREFIX_PATTERN = /^\/api\/projects\/[^/]+\/raw\//;

/** Validates `baseHref` (when present) is an http loopback origin -- the
 * daemon's own listen address (apps/daemon/src/daemon-startup.ts binds
 * literally `127.0.0.1`; `::1`/`localhost` are deliberately NOT accepted,
 * since the daemon never produces them (review finding 3) -- and derives
 * the full {@link RenderNetworkPolicy}. Never trusts the string blindly:
 * an unexpected scheme/host is rejected rather than silently allow-listed
 * (review finding 4). */
function resolveRenderNetworkPolicy(baseHref: string | undefined): RenderNetworkPolicy | null {
  if (baseHref == null) return null;
  let url: URL;
  try {
    url = new URL(baseHref);
  } catch {
    throw new DesktopRenderError("baseHref must be a valid absolute URL", "RENDER_FAILED");
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") {
    throw new DesktopRenderError(
      "baseHref must be an http://127.0.0.1 origin -- refusing to allow-list an untrusted origin",
      "RENDER_FAILED",
    );
  }
  const rawRouteMatch = RAW_ROUTE_PREFIX_PATTERN.exec(url.pathname);
  return {
    origin: url.origin,
    assetPrefix: rawRouteMatch != null ? `${url.origin}${rawRouteMatch[0]}` : url.href,
    injectedHref: url.href,
  };
}

/** True when `url` is one of the non-network schemes `page.setContent`
 * needs for inline content (never a live egress channel). */
function isNonNetworkUrl(url: string): boolean {
  const scheme = url.split(":")[0];
  return scheme === "data" || scheme === "blob" || scheme === "about";
}

/** True when `url` falls inside this job's validated asset allowlist. */
function isAllowedAssetUrl(url: string, policy: RenderNetworkPolicy | null): boolean {
  return policy != null && (url === policy.assetPrefix || url.startsWith(policy.assetPrefix));
}

/** The daemon's raw-asset route only ever needs to be read, never written
 * to (review round 2, secondary finding 1: the route handler previously
 * `continue()`d any method under the allowed prefix). */
function isSafeReadMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

const MAX_REDIRECT_HOPS = 10;

/**
 * True only for the SINGLE exempted request: the priming navigation this
 * module itself issues (`page.goto(policy.injectedHref)` below), never
 * anything agent-influenced. Narrowed by predicate, not by "whichever
 * request wins the first intercept" (review round 3 finding 2) -- a
 * request only qualifies when it is a main-frame navigation, method GET,
 * the URL is an EXACT match for `policy.injectedHref`, and the exemption
 * has not already been consumed this job. Any other first packet --
 * including one that merely arrives first for some unrelated reason --
 * falls through to the fully validated `fulfillAllowedRequest` path.
 */
function isUnusedPrimingNavigation(route: Route, policy: RenderNetworkPolicy | null, used: boolean): boolean {
  if (used || policy == null) return false;
  const request = route.request();
  if (request.method() !== "GET") return false;
  if (request.url() !== policy.injectedHref) return false;
  if (!request.isNavigationRequest()) return false;
  return request.frame().parentFrame() === null;
}

/**
 * PRIMARY gate #1's actual implementation. `route.continue()` on an
 * in-prefix first hop is NOT enough on its own: Chromium follows any
 * redirect the response returns WITHOUT re-entering `context.route()`
 * (verified empirically -- see the comment at the call site), so an
 * in-prefix request that 302s to an off-prefix path on the SAME host:port
 * (e.g. the daemon's own /api/chat) would otherwise reach that route's
 * handler directly (review round 2 finding).
 *
 * This performs the request itself via `route.fetch({maxRedirects: 0})`
 * instead, which returns each redirect hop's response WITHOUT following
 * it, so every `Location` target is validated against `policy` BEFORE it
 * is ever fetched -- an off-prefix target's own route handler never runs,
 * not "runs and gets detected after the fact". Only once a hop resolves to
 * a non-redirect (or an already-allowed target runs out of hops) does this
 * fulfill the ORIGINAL route with that final response.
 */
async function fulfillAllowedRequest(route: Route, policy: RenderNetworkPolicy | null): Promise<void> {
  const initialUrl = route.request().url();
  if (isNonNetworkUrl(initialUrl)) {
    await route.continue();
    return;
  }
  if (!isSafeReadMethod(route.request().method()) || !isAllowedAssetUrl(initialUrl, policy)) {
    await route.abort("blockedbyclient");
    return;
  }

  let currentUrl = initialUrl;
  for (let hop = 0; ; hop += 1) {
    let response: Awaited<ReturnType<Route["fetch"]>>;
    try {
      response = hop === 0 ? await route.fetch({ maxRedirects: 0 }) : await route.fetch({ url: currentUrl, maxRedirects: 0 });
    } catch {
      await route.abort("blockedbyclient");
      return;
    }
    const status = response.status();
    const location = status >= 300 && status < 400 ? response.headers()["location"] : null;
    if (location == null) {
      await route.fulfill({ response });
      return;
    }
    if (hop >= MAX_REDIRECT_HOPS) {
      await route.abort("blockedbyclient");
      return;
    }
    let nextUrl: string;
    try {
      nextUrl = new URL(location, currentUrl).href;
    } catch {
      await route.abort("blockedbyclient");
      return;
    }
    // The redirect target is validated -- and, if it fails, discarded --
    // BEFORE the next loop iteration ever calls route.fetch() on it. The
    // off-prefix handler's own logic never executes.
    if (!isAllowedAssetUrl(nextUrl, policy)) {
      await route.abort("blockedbyclient");
      return;
    }
    currentUrl = nextUrl;
  }
}

type BrowserJob<T> = (page: Awaited<ReturnType<Browser["newPage"]>>) => Promise<T>;

const limiter = createLimiter<unknown>(RENDER_CONCURRENCY);

/** Launches a bounded, single-job headless Chromium instance, runs `job`
 * against a page navigated to `about:blank` with `html` injected via
 * `page.setContent`, and tears the whole browser down in `finally` --
 * mirrors covers/renderer.ts's per-job launch/kill shape exactly (a fresh
 * browser per render, not a long-lived singleton: simpler crash/leak
 * semantics, and each job's network allowlist is scoped to that job's own
 * validated baseHref). */
async function runBoundedRender<T>(
  runtimeDataDir: string,
  html: string,
  policy: RenderNetworkPolicy | null,
  job: BrowserJob<T>,
): Promise<T> {
  return (await limiter(() => runBoundedRenderOnce(runtimeDataDir, html, policy, job))) as T;
}

async function runBoundedRenderOnce<T>(
  runtimeDataDir: string,
  html: string,
  policy: RenderNetworkPolicy | null,
  job: BrowserJob<T>,
): Promise<T> {
  let server: Awaited<ReturnType<typeof chromium.launchServer>> | undefined;
  let timedOut = false;
  let memoryExceeded = false;
  // Safety net (review finding 5 / "assert final-response URLs"): route()
  // and routeWebSocket() below are the PREVENTIVE gates -- they run before
  // any request leaves the process. This flag is the DETECTIVE backstop --
  // if any response ever resolves from outside the allowlist despite that
  // (a Playwright network-API gap neither gate anticipated), the job fails
  // loudly instead of returning a screenshot that might have painted
  // exfiltrated content.
  let networkViolationUrl: string | null = null;
  let pollHandle: ReturnType<typeof setInterval> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let pollInFlight = false;
  let registeredPid: number | undefined;

  try {
    server = await chromium.launchServer({
      headless: true,
      args: [
        // Still worth keeping as a backstop against any HOSTNAME-based
        // egress attempt (this render's own allowlist is always a literal
        // 127.0.0.1 origin, which this rule does not rewrite). The real
        // preventive enforcement is route()'s controlled-fetch validation
        // and routeWebSocket()'s outright ban below -- see
        // RenderNetworkPolicy's docblock for why a process-level proxy is
        // deliberately NOT part of this renderer's network policy.
        "--host-resolver-rules=MAP * 0.0.0.0",
        // Closes the cheapest named non-HTTP probe (review round 3 finding
        // 3): WebRTC's ICE candidate gathering opens UDP sockets directly
        // -- including to literal loopback IPs -- and is mediated by
        // neither `context.route()` nor `routeWebSocket()`. With no proxy
        // configured (see RenderNetworkPolicy's docblock for why), "only
        // proxied UDP" means "no UDP", so this disables non-proxied UDP
        // candidate gathering outright rather than leaving WebRTC as an
        // unmediated loopback-probing channel. `--force-` is deliberate,
        // not a typo: the bare `--webrtc-ip-handling-policy` switch is
        // silently ignored on the command line (it is meant to be read via
        // the `chrome.privacy` extension API) -- verified empirically
        // against the pinned Playwright Chromium (playwright@1.60.0) with
        // a real `RTCPeerConnection` ICE-gathering probe: the bare switch
        // still produced a `typ host` UDP candidate; `--force-` produced
        // none.
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--disable-background-networking",
        "--disable-sync",
        "--disable-default-apps",
        "--no-first-run",
      ],
    });

    const browserPid = server.process().pid;
    if (browserPid !== undefined) {
      await registerRenderPid(runtimeDataDir, browserPid);
      registeredPid = browserPid;
    }
    let baselineRssKb: number | null = browserPid === undefined ? null : await aggregateProcessTreeRssKb(browserPid);

    pollHandle = setInterval(() => {
      if (browserPid === undefined || pollInFlight) return;
      pollInFlight = true;
      void aggregateProcessTreeRssKb(browserPid)
        .then((rss) => {
          if (rss === null) return;
          if (baselineRssKb === null) {
            baselineRssKb = rss;
            return;
          }
          if (rss - baselineRssKb > MEMORY_GROWTH_CEILING_KB) {
            memoryExceeded = true;
            void server?.kill().catch(() => undefined);
          }
        })
        .finally(() => {
          pollInFlight = false;
        });
    }, MEMORY_POLL_INTERVAL_MS);

    const deadline = new Promise<never>((_resolve, reject) => {
      killTimer = setTimeout(() => {
        timedOut = true;
        reject(new RenderTimeoutError());
      }, PER_JOB_TIMEOUT_MS);
    });

    const renderWork = (async (): Promise<T> => {
      const browser = await chromium.connect(server!.wsEndpoint());
      const context = await browser.newContext({
        // No render input has a legitimate need for a persistent
        // background worker; disabling it removes a whole class of
        // network entry points (its own fetch/postMessage/push surface)
        // outright rather than trying to police it per-request.
        serviceWorkers: "block",
        // Network egress is enforced entirely by route()/routeWebSocket()
        // below -- never by Content-Security-Policy, which this renderer
        // does not control and must not depend on for security.
        // Necessary in practice, not just principled: navigating to the
        // real `baseHref` origin below can pick up an ordinary response's
        // CSP (e.g. the daemon's default error-page CSP is
        // `default-src 'none'`), and because `page.setContent()` replaces
        // the document WITHOUT a new top-level navigation, that CSP would
        // otherwise silently carry over and block the injected HTML's own
        // inline styles/scripts -- turning a real render into a blank
        // page. `bypassCSP` removes that unrelated, accidental coupling.
        bypassCSP: true,
      });
      // PRIMARY gate #1 (HTTP-shaped requests: fetch/XHR, EventSource,
      // subresources, ordinary navigation, iframe/nested-frame
      // navigation -- Chromium routes every one of these through the same
      // context-level interceptor). Only the exact validated asset prefix
      // (or a non-network data:/blob:/about: URL) is ever fulfilled with
      // real content; everything else, including a same-tab
      // self-navigation to an attacker URL embedded in the agent HTML, is
      // aborted. When no baseHref was given, network is fully closed.
      //
      // A plain `route.continue()` on an in-prefix first hop is NOT enough
      // on its own (review round 2 finding): Chromium follows any redirect
      // the response returns WITHOUT re-entering this handler, verified
      // empirically in desktop-renderer-network-policy.test.ts, so an
      // in-prefix request that 302s to an off-prefix path on the SAME
      // host:port would otherwise reach the daemon's own other `/api/*`
      // routes directly. fulfillAllowedRequest closes that by performing
      // the request itself and validating every redirect hop before
      // fetching it -- see its docblock.
      //
      // Exception, scoped by PREDICATE not by arrival order (review round 3
      // finding 2 -- the prior "whichever request wins the first intercept"
      // shape was URL/method-agnostic): `isUnusedPrimingNavigation` grants
      // plain `route.continue()` ONLY to the priming `page.goto` below --
      // main-frame navigation, method GET, URL an EXACT match for
      // `policy.injectedHref`, not already used this job. Anything else,
      // including a first packet that merely arrives before the real prime
      // for some unrelated reason, falls through to the fully validated
      // `fulfillAllowedRequest` path below.
      //
      // The priming navigation itself is issued by THIS module (never
      // agent-influenced), purely to give the document a real security
      // origin -- see the comment at that call. Routing it through
      // fetch()+fulfill() instead of continue() disrupts Playwright's own
      // navigation-commit timing (observed as "Execution context was
      // destroyed" from the very next `page.setContent()` call), so it
      // must take the plain `continue()` path, which means a
      // DAEMON-controlled redirect on that exact URL is followed
      // unvalidated -- an accepted, narrow residual (daemon-controlled
      // input, not agent-controlled) closed by the post-navigation URL
      // check at the `page.goto` call site instead of by `route()`.
      let primingUsed = false;
      await context.route("**/*", (route) => {
        if (isUnusedPrimingNavigation(route, policy, primingUsed)) {
          primingUsed = true;
          void route.continue();
          return;
        }
        void fulfillAllowedRequest(route, policy);
      });
      // PRIMARY gate #2 (WebSocket -- route() above does not reliably
      // mediate it; review finding 1's named gap). The daemon's raw-asset
      // origin only ever serves static GET requests, so there is no
      // legitimate WebSocket use case to preserve: every WebSocket the
      // page attempts is closed without ever calling connectToServer(),
      // which means Playwright never opens a real network connection for
      // it at all -- not "allowed then dropped", never connected.
      await context.routeWebSocket("**/*", (ws) => {
        void ws.close({ code: 1008, reason: "desktop renderer: WebSocket egress is not permitted" });
      });
      // Detective safety net: record (never trust as the sole gate) any
      // response whose URL falls outside the allowlist.
      context.on("response", (response) => {
        const responseUrl = response.url();
        if (responseUrl === "about:blank" || isNonNetworkUrl(responseUrl) || isAllowedAssetUrl(responseUrl, policy)) {
          return;
        }
        networkViolationUrl = responseUrl;
      });
      const page = await context.newPage();
      if (policy != null) {
        // Navigate to the REAL baseHref origin first, rather than staying
        // on about:blank. Not cosmetic: `page.setContent()` on top of
        // about:blank leaves the document with an opaque/null security
        // origin, and Chromium blocks ANY cross-origin fetch from a
        // null-origin document (net::ERR_FAILED) before context.route()
        // ever gets a say -- `<base href>` only affects relative-URL
        // RESOLUTION, never the document's security origin, so injecting
        // it alone cannot fix this. Navigating here first gives the
        // document Chromium's normal same-origin semantics against
        // `policy.origin`, which is what makes the allowed asset prefix
        // actually fetchable. A non-2xx/timeout response here is fine --
        // `setContent` below replaces the body regardless -- so failures
        // are swallowed rather than failing the whole render.
        await page.goto(policy.injectedHref, { timeout: PER_JOB_TIMEOUT_MS }).catch(() => undefined);
        // Closes the accepted residual from the priming exemption above:
        // that navigation used plain `continue()`, so a daemon-controlled
        // redirect on `policy.injectedHref` would have been followed
        // un-validated and its target's handler would have run once. This
        // does not undo that (it already happened, if it happened) -- it
        // makes sure the render never silently proceeds as if it hadn't.
        // If the committed URL no longer matches the validated href, the
        // daemon's own response moved the document's origin out from
        // under the allowlist, and the render fails closed rather than
        // running agent HTML (`setContent` below) against an unvalidated
        // location.
        if (page.url() !== policy.injectedHref) {
          throw new DesktopRenderError(
            "render blocked: the priming navigation's committed URL diverged from the validated baseHref",
            "RENDER_FAILED",
          );
        }
      } else {
        await page.goto("about:blank", { timeout: PER_JOB_TIMEOUT_MS });
      }
      await page.setContent(html, { waitUntil: "load", timeout: PER_JOB_TIMEOUT_MS });
      await page.waitForTimeout(150).catch(() => undefined);
      return job(page);
    })();
    renderWork.catch(() => undefined);

    let value: T;
    try {
      value = await Promise.race([renderWork, deadline]);
    } catch (err) {
      if (memoryExceeded) throw new RenderMemoryLimitError();
      if (timedOut || err instanceof RenderTimeoutError) throw new RenderTimeoutError();
      throw err;
    }
    if (memoryExceeded) throw new RenderMemoryLimitError();
    if (networkViolationUrl != null) {
      throw new DesktopRenderError(
        `render blocked: a response resolved outside the allowed network policy (${networkViolationUrl})`,
        "RENDER_FAILED",
      );
    }
    return value;
  } finally {
    if (killTimer) clearTimeout(killTimer);
    if (pollHandle) clearInterval(pollHandle);
    if (server) await server.kill().catch(() => undefined);
    if (registeredPid !== undefined) await unregisterRenderPid(runtimeDataDir, registeredPid);
  }
}

type CapturedImage = { buffer: Buffer; jpeg: boolean };

function encodeDataUrl(image: CapturedImage): string {
  return `data:image/${image.jpeg ? "jpeg" : "png"};base64,${image.buffer.toString("base64")}`;
}

async function writeCapturedImages(outputDir: string, images: CapturedImage[]): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });
  const paths: string[] = [];
  for (const [index, image] of images.entries()) {
    // File names are entirely renderer-controlled literals (never derived
    // from request input), so there is no path-traversal surface here even
    // though outputDir itself is caller-supplied -- normalizeDesktopRenderSlidesInput
    // already rejects a non-absolute outputDir before this module sees it.
    const fileName = `slide-${index}.${image.jpeg ? "jpeg" : "png"}`;
    const filePath = path.join(outputDir, fileName);
    await writeFile(filePath, image.buffer);
    paths.push(filePath);
  }
  return paths;
}

async function stitchVertically(images: CapturedImage[]): Promise<CapturedImage> {
  const metas = await Promise.all(images.map((image) => sharp(image.buffer).metadata()));
  const width = Math.max(...metas.map((meta) => meta.width ?? 0));
  const totalHeight = metas.reduce((sum, meta) => sum + (meta.height ?? 0), 0);
  let offsetTop = 0;
  const composite: sharp.OverlayOptions[] = [];
  for (const [index, image] of images.entries()) {
    composite.push({ input: image.buffer, left: 0, top: offsetTop });
    offsetTop += metas[index]?.height ?? 0;
  }
  const buffer = await sharp({
    create: { width, height: totalHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composite)
    .png()
    .toBuffer();
  return { buffer, jpeg: false };
}

async function captureDeckSlides(
  page: Awaited<ReturnType<Browser["newPage"]>>,
  request: { index?: number; width: number; height: number },
): Promise<CapturedImage[]> {
  await page.setViewportSize({ width: request.width, height: request.height });
  const count = await page.locator(DECK_SLIDE_SELECTOR).count();
  if (count === 0) throw new DesktopRenderError("no slide surfaces found in this deck", "NO_SLIDES");
  if (request.index != null) {
    if (request.index >= count) {
      throw new DesktopRenderError(
        `slide index ${request.index} is out of range (deck has ${count} slide(s))`,
        "SLIDE_INDEX_OUT_OF_RANGE",
      );
    }
    const buffer = await page.locator(DECK_SLIDE_SELECTOR).nth(request.index).screenshot({ type: "png" });
    return [{ buffer, jpeg: false }];
  }
  const images: CapturedImage[] = [];
  for (let i = 0; i < count; i += 1) {
    const buffer = await page.locator(DECK_SLIDE_SELECTOR).nth(i).screenshot({ type: "png" });
    images.push({ buffer, jpeg: false });
  }
  return images;
}

async function capturePage(
  page: Awaited<ReturnType<Browser["newPage"]>>,
  request: {
    width: number;
    height: number;
    jpeg: boolean;
    paginate: boolean;
    /** Presence (not truthiness -- 0 is the top of the document) switches this
     * from a full-page render to the one viewport-sized band at that offset.
     * See DesktopExportArtifactInput.viewportScrollY. */
    viewportScrollY?: number;
  },
): Promise<CapturedImage[]> {
  await page.setViewportSize({ width: request.width, height: request.height });
  const type = request.jpeg ? ("jpeg" as const) : ("png" as const);
  if (request.viewportScrollY != null) {
    const top = Math.max(0, Math.round(request.viewportScrollY));
    // Scroll before clipping rather than clipping a full-page capture: elements
    // that position themselves against the viewport (sticky headers, fixed
    // toolbars) must land where the user sees them, and only a real scroll puts
    // them there. A string expression keeps this browser-context snippet out of
    // the daemon's Node-only (no-DOM-lib) type-check surface.
    await page.evaluate(`window.scrollTo(0, ${top})`);
    // The clip is viewport-relative (Playwright rejects a region outside the
    // viewport unless `fullPage` is set), so the scroll above is what selects the
    // band and this clip is simply "the whole viewport". A document shorter than
    // the requested offset scrolls to its own end instead, which is what the
    // browser shows the user too.
    const buffer = await page.screenshot({
      clip: { x: 0, y: 0, width: request.width, height: request.height },
      type,
      ...(request.jpeg ? { quality: 90 } : {}),
    });
    return [{ buffer, jpeg: request.jpeg }];
  }
  if (!request.paginate) {
    const buffer = await page.screenshot({ fullPage: true, type, ...(request.jpeg ? { quality: 90 } : {}) });
    return [{ buffer, jpeg: request.jpeg }];
  }
  // A string expression (rather than a closure) keeps this browser-context
  // snippet out of the daemon's Node-only (no-DOM-lib) type-check surface.
  const fullHeight = await page.evaluate<number>("document.documentElement.scrollHeight");
  const pageCount = Math.max(1, Math.ceil(fullHeight / request.height));
  const images: CapturedImage[] = [];
  for (let i = 0; i < pageCount; i += 1) {
    const top = i * request.height;
    const height = Math.min(request.height, fullHeight - top);
    const buffer = await page.screenshot({
      clip: { x: 0, y: top, width: request.width, height },
      type,
      ...(request.jpeg ? { quality: 90 } : {}),
    });
    images.push({ buffer, jpeg: request.jpeg });
  }
  return images;
}

/** Renders a `RENDER_SLIDES` request: the real handler behind the desktop
 * renderer's `render-slides` IPC message (packages/sidecar-proto). */
export async function renderSlides(
  runtimeDataDir: string,
  input: DesktopRenderSlidesInput,
): Promise<DesktopRenderSlidesResult> {
  if (input.editable) {
    return {
      ok: false,
      error: "editable PPTX export is not implemented in the headless renderer (dom-to-pptx is not present in this fork)",
      errorCode: "RENDER_FAILED",
    };
  }
  try {
    const policy = resolveRenderNetworkPolicy(input.baseHref);
    const html =
      policy == null ? input.html : withProjectAssetBaseHref(input.html, policy.injectedHref);
    const jpeg = input.pageImageFormat === "jpeg";

    const result = await runBoundedRender(runtimeDataDir, html, policy, async (page) => {
      const wantsPage = input.deck === false;
      let deckDetected = input.deck === true;
      if (input.deck == null) {
        const count = await page.locator(DECK_SLIDE_SELECTOR).count();
        deckDetected = count > 0;
      }
      // A viewport-clipped request asks for what is on screen, which is a
      // page-shaped question even when the artifact is a deck — so it takes the
      // page path rather than the per-slide one.
      if (wantsPage || !deckDetected || input.viewportScrollY != null) {
        const images = await capturePage(page, {
          width: input.width ?? DEFAULT_PAGE_WIDTH,
          height: input.height ?? DEFAULT_PAGE_HEIGHT,
          jpeg,
          paginate: input.paginate === true,
          ...(input.viewportScrollY != null ? { viewportScrollY: input.viewportScrollY } : {}),
        });
        return { images, mode: "page" as const };
      }
      let images = await captureDeckSlides(page, {
        ...(input.index == null ? {} : { index: input.index }),
        width: input.width ?? DEFAULT_DECK_WIDTH,
        height: input.height ?? DEFAULT_DECK_HEIGHT,
      });
      if (input.stitch === true && images.length > 1) images = [await stitchVertically(images)];
      return { images, mode: "deck" as const };
    });

    const meta = await sharp(result.images[0]?.buffer).metadata();
    const base: DesktopRenderSlidesResult = {
      ok: true,
      mode: result.mode,
      ...(meta.width == null ? {} : { width: meta.width }),
      ...(meta.height == null ? {} : { height: meta.height }),
    };
    if (input.outputDir != null) {
      return { ...base, slideFiles: await writeCapturedImages(input.outputDir, result.images) };
    }
    return { ...base, slides: result.images.map(encodeDataUrl) };
  } catch (err) {
    return renderErrorResult(err);
  }
}

function renderErrorResult(err: unknown): DesktopRenderSlidesResult {
  if (err instanceof DesktopRenderError) {
    return { ok: false, error: err.message, ...(err.errorCode ? { errorCode: err.errorCode } : {}) };
  }
  if (err instanceof RenderTimeoutError) return { ok: false, error: err.message, errorCode: "RENDER_FAILED" };
  if (err instanceof RenderMemoryLimitError) return { ok: false, error: err.message, errorCode: "RENDER_FAILED" };
  return { ok: false, error: err instanceof Error ? err.message : String(err), errorCode: "RENDER_FAILED" };
}

/** Renders an `EXPORT_ARTIFACT` request. Only `format: 'image'` has a real
 * daemon call site today (import-export-routes.ts's desktopSlideRenderer-
 * absent fallback) -- `format: 'pdf'` (Electron `printToPDF` parity) is
 * explicitly out of scope per the spec's own risk note, so it returns a
 * typed, explicit error rather than a silent wrong success. */
export async function exportArtifact(
  runtimeDataDir: string,
  input: DesktopExportArtifactInput,
): Promise<DesktopExportArtifactResult> {
  if (input.format !== "image") {
    return {
      ok: false,
      error: "format 'pdf' is not implemented in the headless renderer -- callers should use render-slides instead",
    };
  }
  try {
    const policy = resolveRenderNetworkPolicy(input.baseHref);
    const html =
      policy == null ? input.html : withProjectAssetBaseHref(input.html, policy.injectedHref);
    const jpeg = input.imageFormat === "jpeg";

    const image = await runBoundedRender(runtimeDataDir, html, policy, async (page) => {
      const wantsPage = input.deck === false;
      let deckDetected = input.deck === true;
      if (input.deck == null) {
        const count = await page.locator(DECK_SLIDE_SELECTOR).count();
        deckDetected = count > 0;
      }
      // A viewport-clipped request is asking for what is on screen, which is a
      // page-shaped question even when the artifact is a deck — so it takes the
      // page path rather than the per-slide one.
      if (wantsPage || !deckDetected || input.viewportScrollY != null) {
        const [captured] = await capturePage(page, {
          width: input.width ?? DEFAULT_PAGE_WIDTH,
          height: input.height ?? DEFAULT_PAGE_HEIGHT,
          jpeg,
          paginate: false,
          ...(input.viewportScrollY != null ? { viewportScrollY: input.viewportScrollY } : {}),
        });
        return captured!;
      }
      const [captured] = await captureDeckSlides(page, {
        width: input.width ?? DEFAULT_DECK_WIDTH,
        height: input.height ?? DEFAULT_DECK_HEIGHT,
      });
      return captured!;
    });

    const dir = await mkdtemp(path.join(os.tmpdir(), "od-desktop-artifact-"));
    const filePath = path.join(dir, `artifact.${image.jpeg ? "jpeg" : "png"}`);
    await writeFile(filePath, image.buffer);
    return {
      ok: true,
      path: filePath,
      mime: image.jpeg ? "image/jpeg" : "image/png",
      bytes: image.buffer.byteLength,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
