#!/usr/bin/env node
// verify-mirror.mjs -- the mandatory pass/fail gate a mirror must clear before
// it may be reported complete or served to the user (see SKILL.md's capture
// -> finish -> verify recipe). Promoted from the ad-hoc gate.mjs that
// rescued a stalled designbybrandin.com mirror: serve the mirror on an
// ephemeral localhost port, headless-load it at each captured viewport with
// the same stepped-scroll pass mirror-site.mjs uses, and fail loudly on
// anything a "done" clone must not ship with: a same-origin request that
// 404s/fails, a broken <img>, scrollWidth/scrollHeight drifting more than 5%
// from the capture-time baseline, or a runtime global/count the baseline
// recorded that the clone doesn't reproduce.
//
// The pass/fail rules themselves are pure (lib/gate-decision.mjs) so they are
// unit-testable without a live browser; this file is the Playwright-dependent
// glue that collects the data those rules run over.
//
// Usage:
//   node scripts/verify-mirror.mjs --site <mirror>/site [--baseline <mirror>/mirror-baseline-metrics.json] [--json]
//
// Without --baseline, only the same-origin-failure and broken-image checks
// run (no drift/runtime-global/count gating) -- pass mirror-site.mjs's
// mirror-baseline-metrics.json for the full gate.
// Exit 0 only on a full pass; exit 1 on any failing check.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { loadPlaywright, launchChromium } from "./lib/playwright-loader.mjs";
import { DEFAULT_VIEWPORTS, forceLazyMarkup, steppedScroll, collectRuntimeMetrics } from "./lib/viewport-capture.mjs";
import { evaluateGate } from "./lib/gate-decision.mjs";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

function parseArgs(argv) {
  const o = { site: "", baseline: "", json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--site") o.site = argv[++i] || "";
    else if (a === "--baseline") o.baseline = argv[++i] || "";
    else if (a === "--json") o.json = true;
  }
  return o;
}

function usage() {
  console.log(`verify-mirror.mjs -- mandatory pass/fail gate for a finished mirror

  node scripts/verify-mirror.mjs --site <mirror>/site [--baseline <mirror>/mirror-baseline-metrics.json] [--json]

--site      mirrored web root (the directory containing index.html)
--baseline  mirror-baseline-metrics.json produced by mirror-site.mjs at capture time;
            without it, only same-origin-failure and broken-image checks run
--json      also print the full machine-readable result

Serves --site on an ephemeral localhost port, headless-loads it at each captured
viewport with a stepped scroll pass, and FAILS (exit 1) on: any same-origin
failed/404 request, any broken image, scrollWidth/scrollHeight drift beyond 5% vs
the baseline, or a runtime global/count the baseline recorded that the clone does
not reproduce. Exit 0 only on a full pass. A clone may not be reported complete or
served to the user until this exits 0.`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.site) {
  usage();
  process.exit(args.help ? 0 : 1);
}

const siteDir = path.resolve(args.site);
if (!fs.existsSync(siteDir)) {
  console.error(`✗ No mirrored site at ${siteDir}`);
  process.exit(1);
}

const baselineDoc = args.baseline ? JSON.parse(fs.readFileSync(path.resolve(args.baseline), "utf8")) : null;
const baselineByLabel = baselineDoc
  ? Object.fromEntries(baselineDoc.metrics.map((m) => [m.viewport.label, m]))
  : null;
const viewports = baselineDoc ? baselineDoc.metrics.map((m) => m.viewport) : DEFAULT_VIEWPORTS;

function contentTypeFor(file) {
  return MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function resolveRequestPath(pathname) {
  const decoded = decodeURIComponent(pathname.split("?")[0] || "/");
  let rel = decoded.replace(/^\/+/, "");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const resolved = path.resolve(siteDir, rel);
  if (!resolved.startsWith(path.resolve(siteDir) + path.sep) && resolved !== path.resolve(siteDir)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  const file = resolveRequestPath(req.url || "/");
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": contentTypeFor(file) });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

const pw = loadPlaywright();
const browser = await launchChromium(pw.chromium);

const viewportResults = [];
for (const viewport of viewports) {
  console.log(`▸ [${viewport.label}] Verifying: ${base}/`);
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr,
  });
  const page = await context.newPage();
  const sameOriginFailures = [];
  const crossOriginFailures = [];
  page.on("requestfailed", (request) => {
    const entry = { url: request.url(), error: request.failure()?.errorText || "" };
    (request.url().startsWith(base) ? sameOriginFailures : crossOriginFailures).push(entry);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      const entry = { url: response.url(), status: response.status() };
      (response.url().startsWith(base) ? sameOriginFailures : crossOriginFailures).push(entry);
    }
  });

  await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("load", { timeout: 45000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await forceLazyMarkup(page);
  await steppedScroll(page, viewport);
  const metrics = await collectRuntimeMetrics(page, viewport);
  await context.close();

  viewportResults.push({
    label: viewport.label,
    sameOriginFailures,
    crossOriginFailures,
    scrollWidth: metrics.scrollWidth,
    scrollHeight: metrics.scrollHeight,
    frameworks: metrics.frameworks,
    canvasCount: metrics.canvasCount,
    imageCount: metrics.imageCount,
    videoCount: metrics.videoCount,
    brokenImages: metrics.brokenImages,
  });
}

await browser.close();
await new Promise((resolve) => server.close(resolve));

const gate = evaluateGate({ viewports: viewportResults, baselineByLabel });

for (const check of gate.checks) {
  const status = check.pass ? "PASS" : "FAIL";
  console.log(`[${status}] ${check.label}`);
  if (!check.sameOriginFailures.pass) {
    console.log(`   same-origin failures: ${check.sameOriginFailures.count}`);
    for (const failure of check.sameOriginFailures.items.slice(0, 10)) {
      console.log(`     ${failure.status ?? ""} ${failure.url} ${failure.error ?? ""}`.trim());
    }
  }
  if (!check.brokenImages.pass) {
    console.log(`   broken images: ${check.brokenImages.count}`);
    for (const src of check.brokenImages.items.slice(0, 10)) console.log(`     ${src}`);
  }
  if (check.scrollWidth && !check.scrollWidth.pass) {
    console.log(`   scrollWidth drift: baseline ${check.scrollWidth.baseline} -> actual ${check.scrollWidth.actual}`);
  }
  if (check.scrollHeight && !check.scrollHeight.pass) {
    console.log(`   scrollHeight drift: baseline ${check.scrollHeight.baseline} -> actual ${check.scrollHeight.actual}`);
  }
  if (check.runtimeGlobals && !check.runtimeGlobals.pass) {
    console.log(`   missing runtime globals: ${check.runtimeGlobals.missing.join(", ")}`);
  }
  if (check.counts) {
    for (const [key, count] of Object.entries(check.counts)) {
      if (!count.pass) console.log(`   ${key} mismatch: baseline ${count.baseline} -> actual ${count.actual}`);
    }
  }
}

if (!gate.baselineProvided) {
  console.log("\n(no --baseline supplied: only same-origin-failure and broken-image checks ran)");
}
console.log(`\n${gate.pass ? "✅ PASS" : "✗ FAIL"}: mirror ${gate.pass ? "may" : "may NOT"} be reported complete or served to the user.`);

if (args.json) console.log(JSON.stringify(gate, null, 2));

process.exit(gate.pass ? 0 : 1);
