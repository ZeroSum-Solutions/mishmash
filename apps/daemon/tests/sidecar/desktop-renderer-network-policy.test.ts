import type http from "node:http";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { DesktopRenderSlidesInput } from "@open-design/sidecar-proto";

import { renderSlides } from "../../src/sidecar/desktop-renderer/render.js";

// ---------------------------------------------------------------------------
// Adversarial network-policy specs (t4b review response). The happy-path
// specs in desktop-renderer-ipc.test.ts and desktop-renderer-http-export.test.ts
// never assert that a HOSTILE render input is actually confined -- this file
// proves the negative: a render given HTML that tries to reach a SECOND real
// local HTTP server (different port, different path on the SAME origin, a
// WebSocket, and an off-origin redirect target) never lets any of those
// requests land, while the render itself still completes and returns the
// legitimate same-prefix asset content.
//
// "Never lands" is measured at the TCP layer (`server.on('connection')`),
// not just "did our handler get called" -- a raw TCP connection is the
// weakest, most protocol-agnostic signal of "did egress happen at all", so
// it catches an HTTP fetch, a WebSocket handshake attempt, or anything else
// Chromium's network stack might have tried.
// ---------------------------------------------------------------------------

const PROJECT_ID = "net-policy-test";
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
  });
}

describe("desktop renderer network policy (adversarial)", () => {
  let runtimeDataDir: string;
  let allowedServer: http.Server;
  let blockedServer: http.Server;
  let allowedPort: number;
  let blockedPort: number;
  let blockedConnectionCount = 0;
  let pixelHitCount = 0;
  let otherRouteHitCount = 0;

  beforeAll(async () => {
    runtimeDataDir = await mkdtemp(join(tmpdir(), "od-desktop-renderer-netpolicy-"));

    // Stands in for a SECOND local service the daemon does not own -- e.g. a
    // different port on the same loopback interface. Tracks raw TCP
    // connections, not just handled HTTP requests, so a WebSocket handshake
    // attempt is caught even though this plain http.Server never upgrades it.
    blockedServer = createServer((_req, res) => res.writeHead(200).end("should never be reached"));
    blockedServer.on("connection", () => {
      blockedConnectionCount += 1;
    });
    blockedPort = await listen(blockedServer);

    // Stands in for the daemon's own raw-asset origin (deck-export.ts's
    // rawBaseHref shape: /api/projects/<id>/raw/...).
    allowedServer = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);
      if (url.pathname === `/api/projects/${PROJECT_ID}/raw/pixel.png`) {
        pixelHitCount += 1;
        res.writeHead(200, { "Content-Type": "image/png" });
        res.end(TINY_PNG);
        return;
      }
      if (url.pathname === `/api/projects/${PROJECT_ID}/raw/redirect`) {
        // Off-allowlist redirect target: the request TO this route is
        // in-prefix and allowed, but the 302 Location is the blocked
        // server -- proves each redirect hop is re-evaluated on its own.
        res.writeHead(302, { Location: `http://127.0.0.1:${blockedPort}/redirected-here` });
        res.end();
        return;
      }
      if (url.pathname === `/api/projects/${PROJECT_ID}/raw/same-origin-redirect`) {
        // Round 2 review finding: the request TO this route is in-prefix
        // and allowed, but the 302 Location is SAME host:port, off-prefix
        // (the daemon's own /api/other-route, e.g. chat/export/project
        // management) -- proves the redirect target is validated by PATH,
        // not just by host:port, closing the gap the round-1 test (which
        // only redirected cross-port) did not cover.
        res.writeHead(302, { Location: `http://127.0.0.1:${allowedPort}/api/other-route` });
        res.end();
        return;
      }
      if (url.pathname === "/api/other-route") {
        // Same origin/port as the allowed asset prefix, but OUTSIDE
        // /api/projects/<id>/raw/ -- proves the allowlist is path-scoped,
        // not origin-wide (review finding 2).
        otherRouteHitCount += 1;
        res.writeHead(200).end("should never be reached either");
        return;
      }
      if (url.pathname === `/api/projects/${PROJECT_ID}-prime-redirect/raw/`) {
        // This bare path IS the priming URL itself (baseHref with no
        // trailing dir) for a DIFFERENT project id than PROJECT_ID, so it
        // does not affect the other tests in this file, whose priming
        // request hits PROJECT_ID's own bare raw/ path (a harmless 404,
        // matched by the final fallback below). Round 3 review finding 2:
        // redirects a daemon-controlled priming URL off-prefix, same
        // origin -- the "did the off-prefix handler run" signal is
        // otherRouteHitCount, since the Location points there.
        res.writeHead(302, { Location: `http://127.0.0.1:${allowedPort}/api/other-route` });
        res.end();
        return;
      }
      res.writeHead(404).end();
    });
    allowedPort = await listen(allowedServer);
  }, 30_000);

  afterEach(() => {
    blockedConnectionCount = 0;
    pixelHitCount = 0;
    otherRouteHitCount = 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => allowedServer.close(() => resolve()));
    await new Promise<void>((resolve) => blockedServer.close(() => resolve()));
    await rm(runtimeDataDir, { recursive: true, force: true });
  });

  it("blocks a different-port fetch, a same-origin off-prefix fetch, a WebSocket, and an off-origin redirect target -- while the legitimate same-prefix asset still loads", async () => {
    const baseHref = `http://127.0.0.1:${allowedPort}/api/projects/${PROJECT_ID}/raw/`;
    const html = [
      "<html><body>",
      // Legitimate: same prefix as baseHref -- must succeed.
      '<img src="pixel.png">',
      // Attack 1: a different loopback PORT entirely.
      `<img src="http://127.0.0.1:${blockedPort}/evil-pixel.png">`,
      // Attack 2: SAME origin/port as the allowed asset, but off-prefix.
      '<img src="/api/other-route">',
      // Attack 3: an allowed-prefix request whose response redirects
      // off-origin.
      '<img src="redirect">',
      // Attack 4: WebSocket to the blocked server -- context.route() does
      // not mediate this; must be caught by routeWebSocket()/the proxy gate.
      `<script>try{new WebSocket('ws://127.0.0.1:${blockedPort}/ws');}catch(e){}</script>`,
      "</body></html>",
    ].join("");

    const input: DesktopRenderSlidesInput = { html, deck: false, baseHref, width: 320, height: 200 };
    const result = await renderSlides(runtimeDataDir, input);

    // The render itself still completes successfully -- blocked
    // subresources fail closed like ordinary broken images, they do not
    // fail the whole page load (matches real browser behavior).
    expect(result.ok, result.error).toBe(true);
    expect(result.mode).toBe("page");

    // Nothing about this render EVER reached the second server, across all
    // four attack vectors (different port, off-prefix same-origin, redirect
    // target, WebSocket).
    expect(blockedConnectionCount).toBe(0);
    expect(otherRouteHitCount).toBe(0);
    // The legitimate same-prefix asset DID load -- proves the tightened
    // path-scoped allowlist did not also break real asset resolution.
    expect(pixelHitCount).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("blocks a same-host:port redirect from an in-prefix path to an off-prefix path (round 2 review finding)", async () => {
    // Distinct from the test above: THAT redirect target was a different
    // PORT (proxy/host-resolver territory, round 1). THIS one stays on the
    // exact same host:port as the allowed asset prefix -- the only thing
    // that changes is the PATH -- so it can only be caught by validating
    // the redirect target's path, not by any host:port-level mechanism.
    const baseHref = `http://127.0.0.1:${allowedPort}/api/projects/${PROJECT_ID}/raw/`;
    const html = '<html><body><img src="same-origin-redirect"></body></html>';
    const input: DesktopRenderSlidesInput = { html, deck: false, baseHref, width: 320, height: 200 };

    const result = await renderSlides(runtimeDataDir, input);

    // The render itself still completes -- a blocked subresource fails
    // closed like an ordinary broken image; it does not fail the whole
    // page load.
    expect(result.ok, result.error).toBe(true);
    // The off-prefix redirect target's own handler is never observed
    // serving content into the page: it never ran at all, not "ran and
    // was detected after the fact".
    expect(otherRouteHitCount).toBe(0);
  }, 30_000);

  it("fails closed when the priming baseHref URL itself redirects off-prefix, same origin (round 3 review finding 1)", async () => {
    // Distinct from both tests above: those redirect an AGENT-triggered
    // subresource request, which fulfillAllowedRequest fully validates
    // per-hop. THIS redirect is on `baseHref` itself -- the EXACT URL the
    // priming `page.goto()` navigates to before `setContent()` ever runs.
    // That one navigation is deliberately exempted from per-hop validation
    // (isUnusedPrimingNavigation) because routing it through the same
    // validated-fetch path breaks Playwright's navigation-commit timing --
    // see render.ts's RenderNetworkPolicy docblock for the accepted,
    // documented residual this test exercises: a DAEMON-controlled 302 on
    // the exact prime URL is followed unvalidated (its target's handler
    // runs once -- confirmed below), but the render must not silently
    // proceed as if the origin were still the validated one.
    const primeRedirectProjectId = `${PROJECT_ID}-prime-redirect`;
    const baseHref = `http://127.0.0.1:${allowedPort}/api/projects/${primeRedirectProjectId}/raw/`;
    const input: DesktopRenderSlidesInput = {
      html: "<html><body>should never render -- the priming navigation itself is redirected off-prefix</body></html>",
      deck: false,
      baseHref,
      width: 320,
      height: 200,
    };

    const result = await renderSlides(runtimeDataDir, input);

    // The post-navigation URL check (render.ts, right after the priming
    // `page.goto`) refuses to proceed once the committed URL no longer
    // matches the validated href -- the render fails closed rather than
    // running agent HTML (`setContent`, which never even executes here)
    // against an unvalidated origin.
    expect(result.ok).toBe(false);
    expect(result.error).toContain("priming navigation");
    // Empirically confirms the documented residual precisely: the daemon
    // redirected its OWN priming URL, so the off-prefix target's handler
    // DOES run once (this is accepted -- daemon-controlled input, not
    // agent-controlled) -- but exactly once, and the render never returns
    // that content as a successful result.
    expect(otherRouteHitCount).toBe(1);
  }, 30_000);
});
