#!/usr/bin/env node
// mirror-site.mjs -- mirrors the entire deployed asset set of a "static-build site"
// (Astro / Vite SSG / Hugo etc.) for a 1:1 faithful clone.
// Principle: for this class of site, the "real source" isn't on GitHub, but the
//       deployed static assets (HTML + bundle + CSS + runtime-fetched
//       .sog/.buf/.wasm/.riv/fonts/images) are the ground truth. Use a real browser
//       to scroll through the whole page, capturing every real request, then mirror
//       same-origin assets by path.
// Usage:
//   node scripts/mirror-site.mjs --url <URL> --out <dir> [--scroll-step 700] [--settle 2500] [--max-ms 90000]
// Output:
//   <dir>/site/...                mirrored same-origin assets (paths preserved; directory URLs saved as index.html)
//   <dir>/mirror-manifest.json    every request (same-origin + third-party) + its status
//   <dir>/own-asset-urls.txt      same-origin asset path manifest
//   <dir>/third-party.json        third-party hosts + hints for webfont CSS (typekit/google) that needs self-hosting
// Discipline: never fabricate a path. A same-origin asset is either captured from a
//       real request or read back off the mirror's own markup; a reference is only
//       localised once the file it points at exists on disk.
//       Runs to completion on its own: bot-wall detection -> second-pass fetch of
//       referenced-but-uncaptured assets -> absolute-URL rewrite.
//       Third-party CDNs (fonts/wasm/video) are still manual, per third-party.json:
//       self-host domain-locked fonts (typically Typekit @import) and strip tracking.
//       Full recipe in references/static-mirror.md.

import { loadPlaywright, launchChromium } from "./lib/playwright-loader.mjs";
import {
  collectSameOriginRefs,
  originHosts,
  reportRewrite,
  rewriteMirror,
} from "./rewrite-mirror.mjs";
import { clampScrollAnimationOverflow, reportClamp } from "./clamp-scroll-animation-overflow.mjs";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const o = { url: "", out: "", scrollStep: 700, settle: 2500, maxMs: 90000, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--url") o.url = argv[++i] || "";
    else if (a === "--out") o.out = argv[++i] || "";
    else if (a === "--scroll-step") o.scrollStep = parseInt(argv[++i] || "700", 10);
    else if (a === "--settle") o.settle = parseInt(argv[++i] || "2500", 10);
    else if (a === "--max-ms") o.maxMs = parseInt(argv[++i] || "90000", 10);
  }
  return o;
}

function usage() {
  console.log(`mirror-site.mjs -- full asset mirroring for static-build sites (1:1 faithful clone)

  node scripts/mirror-site.mjs --url <URL> --out <dir> [--scroll-step 700] [--settle 2500] [--max-ms 90000]

Applies to: Astro / Vite SSG / Hugo / any site whose client runtime output ships as
downloadable static assets (including WebGL/Canvas heavy frontends).
Does not apply to: true server-side rendering / data-driven SPAs (use network-capture.mjs for an API stand-in).
Recipe and follow-up rewrite steps (self-host fonts/strip tracking/serve) -> references/static-mirror.md`);
}

// Same-origin asset URL -> local relative path (strip query; directory URLs saved as index.html)
function urlToLocalPath(u, origin) {
  let p = u.slice(origin.length);
  const q = p.indexOf("?");
  if (q >= 0) p = p.slice(0, q);
  if (p === "" || p.endsWith("/")) p += "index.html";
  return p.replace(/^\/+/, "");
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.url || !args.out) {
  usage();
  process.exit(args.help ? 0 : 1);
}

const origin = new URL(args.url).origin;
const siteDir = path.join(path.resolve(args.out), "site");
fs.mkdirSync(siteDir, { recursive: true });

const responses = new Map(); // url -> {status, type, ct}
const pw = loadPlaywright();
const browser = await launchChromium(pw.chromium);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("response", (resp) => {
  try {
    const h = resp.headers();
    responses.set(resp.url(), { status: resp.status(), type: resp.request().resourceType(), ct: h["content-type"] || "" });
  } catch {}
});

console.log(`▸ Loading + scrolling through the full page while capturing: ${args.url}`);
await page.goto(args.url, { waitUntil: "networkidle", timeout: args.maxMs }).catch((e) => console.warn("  goto:", e.message));
const total = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y <= total; y += args.scrollStep) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await page.waitForTimeout(180);
}
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(args.settle);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1200);

const all = [...responses.entries()].map(([url, m]) => ({ url, ...m }));
const ownUrls = all.filter((r) => r.url.startsWith(origin + "/") || r.url === origin || r.url === origin + "/");

console.log(`▸ Captured ${all.length} request(s); ${ownUrls.length} same-origin, downloading…`);
let ok = 0, fail = 0;
const failed = [];
for (const r of ownUrls) {
  const rel = urlToLocalPath(r.url, origin);
  const dest = path.join(siteDir, rel);
  try {
    const resp = await ctx.request.get(r.url); // reuse the browser's network stack (same cookies/TUN/proxy)
    if (!resp.ok()) { fail++; failed.push(`HTTP${resp.status()} ${rel}`); continue; }
    const buf = await resp.body();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    ok++;
  } catch (e) {
    fail++; failed.push(`${e.message} ${rel}`);
  }
}

/**
 * True when a captured document is an anti-bot interstitial rather than the site.
 *
 * A challenge answers 200 with a redirect stub, so every downstream stage treats
 * it as a successful mirror: the asset count is small but non-zero, the rewrite
 * finds nothing to do, and the run prints "✅ Mirror complete". The clone then
 * renders a blank page and nothing upstream explains why. Naming it here is the
 * difference between a diagnosable failure and a silent one.
 */
function looksLikeBotWall(html) {
  return /sgcaptcha|cf-browser-verification|challenge-platform|__cf_chl|_Incapsula_|<title>\s*Just a moment/i.test(
    html,
  );
}

const rootIndex = path.join(siteDir, "index.html");
if (fs.existsSync(rootIndex)) {
  const rootHtml = fs.readFileSync(rootIndex, "utf8");
  if (looksLikeBotWall(rootHtml) || rootHtml.length < 512) {
    console.error(
      `\n✗ The captured page is an anti-bot challenge, not ${origin}.\n` +
        `  Captured ${rootHtml.length} bytes at site/index.html. Mirroring stopped so this\n` +
        `  does not get reported as a successful clone.\n` +
        `  Retry from a browser session that has already cleared the challenge, or from a\n` +
        `  different network. Nothing under ${siteDir} is usable as-is.`,
    );
    await browser.close();
    process.exit(2);
  }
}

// Second pass: assets the markup references but the capture never requested.
// A scroll-through only fires what the page actually loads, so lazy-loaded media,
// hover-state sprites, and unused @font-face formats (.eot/.woff alternates) are
// named in the HTML/CSS yet absent from disk. Reading the references back off the
// mirror turns them into a fetchable list. These go through `ctx.request.get` for
// the same reason the first pass does: the origin may sit behind a bot check that
// answers a plain HTTP client with a challenge page instead of the asset.
const binaryExt = /\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mov|m4v|wasm|riv|buf|sog)$/i;
const hosts = originHosts(origin);
let refetched = 0;
const refetchFailed = [];
for (const rel of collectSameOriginRefs(siteDir, hosts)) {
  const dest = path.join(siteDir, rel);
  if (fs.existsSync(dest)) continue;
  // Keep the write inside site/ even if a reference contains traversal segments.
  if (!path.resolve(dest).startsWith(path.resolve(siteDir) + path.sep)) continue;
  try {
    const resp = await ctx.request.get(`${origin}/${rel}`);
    if (!resp.ok()) { refetchFailed.push(`HTTP${resp.status()} ${rel}`); continue; }
    const ct = (resp.headers()["content-type"] || "").toLowerCase();
    const buf = await resp.body();
    // A bot-check interstitial answers 200/202 with a few hundred bytes of HTML.
    // Saving that as `logo.png` would look like a success and render as a broken
    // image, so treat an HTML body for a binary asset as a failure.
    if (binaryExt.test(rel) && ct.includes("text/html")) {
      refetchFailed.push(`challenge-page ${rel}`);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    refetched++;
  } catch (e) {
    refetchFailed.push(`${e.message} ${rel}`);
  }
}
if (refetched || refetchFailed.length) {
  console.log(`▸ Referenced-but-uncaptured assets: ${refetched} fetched / ${refetchFailed.length} failed`);
  if (refetchFailed.length) console.log("   " + refetchFailed.slice(0, 12).join("\n   "));
}

// Third-party + webfont hints
const thirdHosts = [...new Set(all.filter((r) => !r.url.startsWith(origin)).map((r) => { try { return new URL(r.url).host; } catch { return r.url; } }))];
const webfontCss = all.map((r) => r.url).filter((u) => /use\.typekit\.net\/[a-z0-9]+\.css|fonts\.googleapis\.com\/css/i.test(u));
const outRoot = path.resolve(args.out);
fs.writeFileSync(path.join(outRoot, "mirror-manifest.json"), JSON.stringify(all, null, 2));
fs.writeFileSync(path.join(outRoot, "own-asset-urls.txt"), ownUrls.map((r) => urlToLocalPath(r.url, origin)).sort().join("\n") + "\n");
fs.writeFileSync(path.join(outRoot, "third-party.json"), JSON.stringify({ hosts: thirdHosts, webfont_css_to_selfhost: webfontCss }, null, 2));

console.log(`✅ Mirror complete: ${ok} succeeded / ${fail} failed -> ${siteDir}`);
if (failed.length) console.log("  ⚠️ Failed:\n   " + failed.slice(0, 20).join("\n   "));
console.log(`▸ Third-party hosts: ${thirdHosts.join(", ") || "(none)"}`);
if (webfontCss.length) console.log(`▸ webfont CSS that needs self-hosting (domain-locked, see static-mirror.md): \n   ${webfontCss.join("\n   ")}`);
// Point the mirror at its own files. Until this runs, every absolute reference
// still resolves to the origin, so the mirror silently proxies the live site and
// breaks the moment that host is unreachable.
console.log(`▸ Rewriting absolute ${origin} references to local paths`);
reportRewrite(rewriteMirror({ siteDir, origin }), origin, false);

// Salient/WPBakery scroll-linked parallax rows (data-scroll-animation="true")
// can latch a stale in-view flag before the mirror's layout settles, applying
// a JS transform of several thousand pixels and inflating the served
// document's scrollWidth. Contain those rows to their own box so a faithful
// mirror doesn't present a document far wider than its viewport on first
// paint. See clamp-scroll-animation-overflow.mjs for the full mechanism.
console.log(`▸ Clamping scroll-linked overflow`);
reportClamp(clampScrollAnimationOverflow({ siteDir }), false);

console.log(`▸ Next: self-host third-party fonts + strip tracking -> cd ${siteDir} && python3 -m http.server 8124`);
await browser.close();
