#!/usr/bin/env node
// mirror-site.mjs -- mirrors the entire deployed asset set of a "static-build site"
// (Astro / Vite SSG / Hugo etc.) for a 1:1 faithful clone.
// Principle: for this class of site, the "real source" isn't on GitHub, but the
//       deployed static assets (HTML + bundle + CSS + runtime-fetched
//       .sog/.buf/.wasm/.riv/fonts/images) are the ground truth. Use a real browser
//       to scroll through the whole page at multiple viewports, capturing every real
//       request, then mirror same-origin assets by path.
// Usage:
//   node scripts/mirror-site.mjs --url <URL> --out <dir> [--scroll-step 700] [--settle 2500] [--max-ms 90000] [--headful]
// Output:
//   <dir>/site/...                     mirrored same-origin assets (paths preserved; directory URLs saved as index.html)
//   <dir>/mirror-manifest.json         every request (same-origin + third-party) + its status
//   <dir>/own-asset-urls.txt           same-origin asset path manifest
//   <dir>/third-party.json             third-party hosts + hints for webfont CSS (typekit/google) that needs self-hosting
//   <dir>/mirror-baseline-metrics.json per-viewport capture-time metrics (scrollWidth/Height, runtime
//                                      globals, canvas/image/video counts) -- feed this to
//                                      verify-mirror.mjs --baseline once the mirror is finished/rewritten.
//                                      When the scroll-animation clamp (below) changed anything, this
//                                      also carries a re-measured `expectedScrollWidth` per viewport --
//                                      see lib/gate-decision.mjs's clamp contract.
// Discipline: never fabricate a path. A same-origin asset is either captured from a
//       real request or read back off the mirror's own markup; a reference is only
//       localised once the file it points at exists on disk.
//       Runs to completion on its own: multi-viewport capture (1440/768/390) with
//       response-body capture during load -> recursive in-page fetch() rounds for
//       anything the markup/CSS references but no request ever fired for -> bot-wall
//       detection (with --headful escalation guidance) -> absolute-URL rewrite ->
//       scroll-animation overflow clamp.
//       Third-party CDNs (fonts/wasm/video) are still manual, per third-party.json:
//       self-host domain-locked fonts (typically Typekit @import) and strip tracking.
//       Full recipe in references/static-mirror.md.
//
// --headful: launches a real, visible Chrome (channel:"chrome",
//   --disable-blink-features=AutomationControlled, navigator.webdriver masked)
//   instead of headless, and fetches missed assets via genuine in-page fetch().
//   Real cookies/fingerprint/Referer are what clears a bot wall that has started
//   403/202-challenging headless Chrome by fingerprint alone -- see
//   lib/bot-wall.mjs. A headless run prints explicit re-run guidance the moment
//   it sees a bot-wall signature; never fall back to a plain HTTP re-fetch for
//   same-origin assets instead, that is what gets 403'd wholesale. (If real
//   Chrome itself fails to launch, lib/playwright-loader.mjs falls back to
//   bundled Chromium in headful mode and prints an explicit warning -- it does
//   not silently claim real Chrome was used.)

import fs from "node:fs";
import path from "node:path";

import { loadPlaywright, launchChromium, maskAutomationSignals } from "./lib/playwright-loader.mjs";
import {
  collectSameOriginRefs,
  localPathForUrl,
  originHosts,
  reportRewrite,
  rewriteMirror,
} from "./rewrite-mirror.mjs";
import { clampScrollAnimationOverflow, reportClamp } from "./clamp-scroll-animation-overflow.mjs";
import { DEFAULT_VIEWPORTS, forceLazyMarkup, steppedScroll, collectRuntimeMetrics } from "./lib/viewport-capture.mjs";
import { fetchInPage } from "./lib/in-page-fetch.mjs";
import { looksLikeBotWallBody, looksLikeBotWallResponse, headfulEscalationGuidance } from "./lib/bot-wall.mjs";
import { startStaticServer } from "./lib/static-server.mjs";

const FETCH_THROTTLE_MS = 140;
// Safety valve against a pathological reference cycle or discovery bug, NOT
// a normal-case round cap -- a legitimately deep reference chain (five-plus
// nested CSS @imports, say) must be allowed to finish, so this only stops a
// runaway loop, and only after logging loudly (see `hitSafetyCap` below).
const MAX_FETCH_ATTEMPTS = 200;

function parseArgs(argv) {
  const o = { url: "", out: "", scrollStep: 700, settle: 2500, maxMs: 90000, headful: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--url") o.url = argv[++i] || "";
    else if (a === "--out") o.out = argv[++i] || "";
    else if (a === "--scroll-step") o.scrollStep = parseInt(argv[++i] || "700", 10);
    else if (a === "--settle") o.settle = parseInt(argv[++i] || "2500", 10);
    else if (a === "--max-ms") o.maxMs = parseInt(argv[++i] || "90000", 10);
    else if (a === "--headful") o.headful = true;
  }
  return o;
}

function usage() {
  console.log(`mirror-site.mjs -- full asset mirroring for static-build sites (1:1 faithful clone)

  node scripts/mirror-site.mjs --url <URL> --out <dir> [--scroll-step 700] [--settle 2500] [--max-ms 90000] [--headful]

Applies to: Astro / Vite SSG / Hugo / any site whose client runtime output ships as
downloadable static assets (including WebGL/Canvas heavy frontends).
Does not apply to: true server-side rendering / data-driven SPAs (use network-capture.mjs for an API stand-in).
Captures at three viewports (1440/768/390) and runs recursive in-page fetch() rounds
for assets the markup/CSS references but no request fired for.
--headful: real visible Chrome + anti-automation masking; re-run with this the moment
a plain headless run reports a bot-wall signature (see the printed guidance).
Recipe and follow-up steps (self-host fonts/strip tracking/verify/serve) -> references/static-mirror.md
Mandatory before reporting a clone complete: node scripts/verify-mirror.mjs --site <dir>/site --baseline <dir>/mirror-baseline-metrics.json`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.url || !args.out) {
  usage();
  process.exit(args.help ? 0 : 1);
}

const origin = new URL(args.url).origin;
const outRoot = path.resolve(args.out);
const siteDir = path.join(outRoot, "site");
fs.mkdirSync(siteDir, { recursive: true });
const hosts = originHosts(origin);

function isOwnUrl(url) {
  return url.startsWith(origin + "/") || url === origin || url === origin + "/";
}

const responses = new Map(); // url -> {status, type, ct}
const botWallHits = [];
const destinationLocks = new Map();
const pending = new Set();

async function settlePending() {
  while (pending.size) await Promise.allSettled([...pending]);
}

/**
 * Saves a same-origin response's body directly from the load that requested
 * it, instead of deferring to a separate re-fetch pass afterwards (the
 * "response-body capture during load" technique). A second, standalone
 * request for the same URL is strictly less trusted by a bot wall than the
 * one the real page navigation already made, so the fewer follow-up requests
 * this needs, the fewer chances to get challenged.
 */
function persistOwnResponse(resp) {
  const url = resp.url();
  if (!isOwnUrl(url)) return;
  const status = resp.status();
  const headers = resp.headers();
  responses.set(url, { status, type: resp.request().resourceType(), ct: headers["content-type"] || "" });

  // Classify bot-wall on headers/status for EVERY response, before the
  // "only 200 is a complete asset" early return below. The most common
  // real-world challenge shape pairs a 403/202 status with its own header
  // (see lib/bot-wall.mjs -- the header name is the actual signal, status
  // alone is not) -- if detection only ran for 200/206 responses, that
  // header would never even get inspected and `botWallHits` (and the
  // --headful escalation guidance) would stay empty for the case that
  // matters most.
  if (looksLikeBotWallResponse({ status, headers })) {
    botWallHits.push({ url, status, phase: "capture" });
    return;
  }

  // 206 (Partial Content) must not stand in for the whole asset -- this
  // pipeline never reassembles byte ranges, so persisting a range response
  // as if it were the complete file would silently ship a truncated asset
  // (e.g. a video whose first request only asked for the first megabyte).
  if (status !== 200) return;

  const rel = localPathForUrl(url, hosts);
  if (!rel) return;
  const dest = path.join(siteDir, rel);

  // Already have a real (non-empty) copy from an earlier attempt -- this,
  // not `destinationLocks`, is the authoritative "already captured" gate.
  // The lock below is only an in-flight dedupe for concurrent 'response'
  // events within the current pass; it must not permanently block a LATER
  // viewport's genuine complete response just because an earlier attempt
  // for the same URL failed, was empty, or was a bot-wall challenge.
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  if (destinationLocks.has(dest)) return destinationLocks.get(dest);

  const operation = (async () => {
    try {
      const body = await resp.body();
      if (!body.length) return;
      if (looksLikeBotWallResponse({ status, headers, body: body.toString("utf8", 0, Math.min(body.length, 4096)) })) {
        botWallHits.push({ url, status, phase: "capture" });
        return;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, body);
    } catch {
      // Left unsaved; the final disk-existence pass below reports it as failed.
    } finally {
      // Release the lock once this attempt settles, success or not, so a
      // later pass can retry instead of being permanently skipped.
      destinationLocks.delete(dest);
    }
  })();
  destinationLocks.set(dest, operation);
  pending.add(operation);
  operation.finally(() => pending.delete(operation));
  return operation;
}

const pw = loadPlaywright();
const browser = await launchChromium(pw.chromium, { headful: args.headful });

try {
  async function captureViewport(viewport) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.dpr,
    });
    try {
      if (args.headful) await maskAutomationSignals(context);
      const page = await context.newPage();
      page.on("response", (resp) => {
        try {
          persistOwnResponse(resp);
        } catch {}
      });

      console.log(`▸ [${viewport.label}] Loading + scrolling: ${args.url}`);
      await page
        .goto(args.url, { waitUntil: "networkidle", timeout: args.maxMs })
        .catch((e) => console.warn(`  [${viewport.label}] goto:`, e.message));
      await forceLazyMarkup(page);
      await steppedScroll(page, viewport, { stepPx: args.scrollStep, settleMs: args.settle });
      const metrics = await collectRuntimeMetrics(page, viewport);
      await settlePending();
      return metrics;
    } finally {
      // Guarantees the context (and its page) is released even if
      // forceLazyMarkup/steppedScroll/collectRuntimeMetrics throws mid-viewport.
      await context.close().catch(() => {});
    }
  }

  const baselineMetrics = [];
  for (const viewport of DEFAULT_VIEWPORTS) {
    baselineMetrics.push(await captureViewport(viewport));
  }

  // Bot-wall hard fail: if the captured homepage is a challenge/interstitial
  // rather than the real site, every downstream stage would otherwise treat it
  // as a successful (if small) mirror, and the clone would render a blank page
  // with nothing upstream explaining why. `process.exit()` here bypasses the
  // outer try/finally's cleanup (it terminates before a pending async finally
  // can run), so the browser is closed explicitly before exiting.
  const rootIndex = path.join(siteDir, "index.html");
  if (fs.existsSync(rootIndex)) {
    const rootHtml = fs.readFileSync(rootIndex, "utf8");
    if (looksLikeBotWallBody(rootHtml) || rootHtml.length < 512) {
      console.error(
        `\n✗ The captured page is an anti-bot challenge, not ${origin}.\n` +
          `  Captured ${rootHtml.length} bytes at site/index.html. Mirroring stopped so this\n` +
          `  does not get reported as a successful clone.\n\n${headfulEscalationGuidance({ url: args.url })}\n`,
      );
      await browser.close().catch(() => {});
      process.exit(2);
    }
  }

  // Recursive fetch rounds: assets the markup/CSS references but no request
  // ever fired for (lazy media, hover-state sprites, unused @font-face format
  // alternates). Each round re-scans the mirror's own files -- fetching one
  // referenced CSS/JS file can reveal further references inside it -- so this
  // keeps going until a round makes no progress, with a total-attempt safety
  // valve (not a round cap) against a pathological reference cycle.
  console.log("▸ Recursive fetch rounds for referenced-but-uncaptured assets");
  const fetchContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  let totalRefetched = 0;
  const refetchFailed = [];
  let hitSafetyCap = false;
  try {
    if (args.headful) await maskAutomationSignals(fetchContext);
    const fetchPage = await fetchContext.newPage();
    await fetchPage
      .goto(args.url, { waitUntil: "domcontentloaded", timeout: args.maxMs })
      .catch((e) => console.warn("  fetch-round goto:", e.message));
    await fetchPage.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    // Materialize a redirect stub for the requested entrypoint when the
    // origin redirects it elsewhere (e.g. "/" -> "/home/") and nothing was
    // ever captured AT the requested path -- otherwise a bare GET / against
    // the served mirror 404s even though the mirror is otherwise complete.
    const requestedRel = localPathForUrl(args.url, hosts);
    const landedRel = localPathForUrl(fetchPage.url(), hosts);
    if (requestedRel && landedRel && requestedRel !== landedRel) {
      const requestedDest = path.join(siteDir, requestedRel);
      if (!fs.existsSync(requestedDest)) {
        const landedDest = path.join(siteDir, landedRel);
        let relTarget = path.relative(path.dirname(requestedDest), landedDest).split(path.sep).join("/");
        if (!relTarget.startsWith(".")) relTarget = `./${relTarget}`;
        fs.mkdirSync(path.dirname(requestedDest), { recursive: true });
        fs.writeFileSync(
          requestedDest,
          `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${relTarget}"><link rel="canonical" href="${relTarget}"></head><body>Redirecting to <a href="${relTarget}">${relTarget}</a>…</body></html>\n`,
        );
        console.log(`▸ Wrote redirect stub ${requestedRel} -> ${landedRel} (origin redirects the requested entrypoint)`);
      }
    }

    for (let round = 1; ; round += 1) {
      const missing = [...collectSameOriginRefs(siteDir, hosts, origin)].filter(
        (rel) => !fs.existsSync(path.join(siteDir, rel)),
      );
      if (!missing.length) break;
      console.log(`  round ${round}: ${missing.length} referenced asset(s) missing on disk`);
      let progress = 0;
      for (const rel of missing) {
        if (totalRefetched + refetchFailed.length >= MAX_FETCH_ATTEMPTS) {
          hitSafetyCap = true;
          break;
        }
        const dest = path.join(siteDir, rel);
        // Keep the write inside site/ even if a reference contains traversal segments.
        if (!path.resolve(dest).startsWith(path.resolve(siteDir) + path.sep)) continue;
        const url = `${origin}/${rel}`;
        const result = await fetchInPage(fetchPage, url);
        if (result.ok && result.body?.length) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, result.body);
          totalRefetched += 1;
          progress += 1;
        } else {
          refetchFailed.push(`${result.error || `HTTP${result.status ?? "?"}`} ${rel}`);
          if (result.error === "bot-wall-challenge") {
            botWallHits.push({ url, status: result.status, phase: "recursive-fetch" });
          }
        }
        await fetchPage.waitForTimeout(FETCH_THROTTLE_MS);
      }
      if (hitSafetyCap || !progress) break;
    }
    if (hitSafetyCap) {
      const stillMissing = [...collectSameOriginRefs(siteDir, hosts, origin)].filter(
        (rel) => !fs.existsSync(path.join(siteDir, rel)),
      );
      console.error(
        `✗ Hit the ${MAX_FETCH_ATTEMPTS}-attempt recursive-fetch safety cap with ${stillMissing.length} ` +
          `referenced asset(s) still missing. This likely means a reference cycle or an unusually deep ` +
          `asset chain -- do not treat this mirror as complete without investigating.`,
      );
    }
  } finally {
    await fetchContext.close().catch(() => {});
  }

  if (totalRefetched || refetchFailed.length) {
    console.log(`▸ Referenced-but-uncaptured assets: ${totalRefetched} fetched / ${refetchFailed.length} failed`);
    if (refetchFailed.length) console.log("   " + refetchFailed.slice(0, 12).join("\n   "));
  }

  // Final tally: same-origin URLs captured vs. actually present on disk.
  // Redirects (3xx) are excluded -- they are never expected to have a body
  // of their own (the final landed document/asset is what gets persisted),
  // so counting them as "should exist as a file" always reports a false
  // failure for every redirect the capture followed.
  let ok = 0;
  let fail = 0;
  const failed = [];
  for (const [url, meta] of responses) {
    if (!isOwnUrl(url)) continue;
    if (meta.status >= 300 && meta.status < 400) continue;
    const rel = localPathForUrl(url, hosts);
    if (!rel) continue;
    const dest = path.join(siteDir, rel);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) ok++;
    else {
      fail++;
      failed.push(`HTTP${meta.status} ${rel}`);
    }
  }

  const all = [...responses.entries()].map(([url, m]) => ({ url, ...m }));
  const ownUrls = all.filter((r) => isOwnUrl(r.url));
  const thirdHosts = [
    ...new Set(
      all
        .filter((r) => !isOwnUrl(r.url))
        .map((r) => {
          try {
            return new URL(r.url).host;
          } catch {
            return r.url;
          }
        }),
    ),
  ];
  const webfontCss = all
    .map((r) => r.url)
    .filter((u) => /use\.typekit\.net\/[a-z0-9]+\.css|fonts\.googleapis\.com\/css/i.test(u));

  fs.writeFileSync(path.join(outRoot, "mirror-manifest.json"), JSON.stringify(all, null, 2));
  fs.writeFileSync(
    path.join(outRoot, "own-asset-urls.txt"),
    ownUrls
      .map((r) => localPathForUrl(r.url, hosts))
      .filter(Boolean)
      .sort()
      .join("\n") + "\n",
  );
  fs.writeFileSync(
    path.join(outRoot, "third-party.json"),
    JSON.stringify({ hosts: thirdHosts, webfont_css_to_selfhost: webfontCss }, null, 2),
  );

  console.log(`✅ Mirror complete: ${ok} succeeded / ${fail} failed -> ${siteDir}`);
  if (failed.length) console.log("  ⚠️ Failed:\n   " + failed.slice(0, 20).join("\n   "));
  console.log(`▸ Third-party hosts: ${thirdHosts.join(", ") || "(none)"}`);
  if (webfontCss.length) {
    console.log(`▸ webfont CSS that needs self-hosting (domain-locked, see static-mirror.md): \n   ${webfontCss.join("\n   ")}`);
  }

  if (botWallHits.length && !args.headful) {
    console.warn(`\n${headfulEscalationGuidance({ url: botWallHits[0].url, status: botWallHits[0].status })}\n`);
    console.warn(`  (${botWallHits.length} bot-wall response(s) seen during capture; the mirror may be missing assets.)\n`);
  }

  // Point the mirror at its own files. Until this runs, every absolute reference
  // still resolves to the origin, so the mirror silently proxies the live site and
  // breaks the moment that host is unreachable.
  console.log(`▸ Rewriting absolute ${origin} references to local paths`);
  reportRewrite(rewriteMirror({ siteDir, origin }), origin, false);

  // Salient/WPBakery scroll-linked parallax rows on the transform_x movement
  // axis (data-scroll-animation="true" data-scroll-animation-movement=
  // "transform_x") can latch a stale in-view flag before the mirror's layout
  // settles, applying a JS transform of several thousand pixels and inflating
  // the served document's scrollWidth. Contain those rows to their own box so a
  // faithful mirror doesn't present a document far wider than its viewport on
  // first paint. See clamp-scroll-animation-overflow.mjs for the full
  // mechanism. This stage runs after everything the mirror needs has already
  // been downloaded and rewritten, so a bug in its regex-based tag matching
  // must not cost the whole mirror -- report it and let the mirror stand as
  // already produced rather than throwing the run away.
  console.log(`▸ Clamping scroll-linked overflow`);
  let clampResult = { clamped: 0, filesChanged: 0 };
  try {
    clampResult = clampScrollAnimationOverflow({ siteDir });
    reportClamp(clampResult, false);
  } catch (e) {
    console.warn(`⚠️ Clamping scroll-linked overflow failed, leaving the mirror as-is: ${e.message}`);
  }

  // The clamp deliberately makes the LOCAL mirror's scrollWidth different
  // from the raw live-page baseline for sites that need it (that is the fix
  // working, not drift -- see lib/gate-decision.mjs's clamp contract). When
  // it changed anything, re-measure the clamped mirror once per viewport and
  // record that as `expectedScrollWidth`, so verify-mirror.mjs's gate checks
  // the clone against the clamp's own intended result instead of rejecting
  // the fix it exists to preserve. When nothing was clamped, no
  // `expectedScrollWidth` is recorded and the gate falls back to the raw
  // baseline exactly as before -- a genuinely wide/broken mirror still fails.
  if (clampResult.clamped > 0) {
    console.log("▸ Clamp applied -- re-measuring the clamped mirror's own scrollWidth per viewport for the gate baseline");
    const localServer = await startStaticServer(siteDir);
    try {
      for (const metric of baselineMetrics) {
        const viewport = metric.viewport;
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: viewport.dpr,
        });
        try {
          const page = await context.newPage();
          await page
            .goto(`${localServer.baseUrl}/`, { waitUntil: "domcontentloaded", timeout: args.maxMs })
            .catch(() => {});
          await page.waitForLoadState("load", { timeout: 45000 }).catch(() => {});
          await forceLazyMarkup(page);
          await steppedScroll(page, viewport, { stepPx: args.scrollStep, settleMs: args.settle });
          const remeasured = await collectRuntimeMetrics(page, viewport);
          metric.expectedScrollWidth = remeasured.scrollWidth;
        } finally {
          await context.close().catch(() => {});
        }
      }
    } finally {
      await localServer.close();
    }
  }

  fs.writeFileSync(
    path.join(outRoot, "mirror-baseline-metrics.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        origin,
        clampInfo: { clamped: clampResult.clamped, filesChanged: clampResult.filesChanged },
        metrics: baselineMetrics,
      },
      null,
      2,
    ),
  );

  console.log(
    `▸ Next: serve locally (cd ${siteDir} && python3 -m http.server 8124), then run the mandatory gate:\n` +
      `   node scripts/verify-mirror.mjs --site ${siteDir} --baseline ${path.join(outRoot, "mirror-baseline-metrics.json")}\n` +
      `   A clone may not be reported complete or served to the user until that gate exits 0.`,
  );
} finally {
  // Guarantees the browser is closed on every path that reaches here,
  // including an unexpected throw from anywhere above (a captureViewport
  // failure, a recursive-fetch error, a filesystem error while writing
  // manifests). The bot-wall hard-fail branch above already closes the
  // browser explicitly before calling `process.exit()`, since exiting
  // bypasses this `finally` (see its comment).
  await browser.close().catch(() => {});
}
