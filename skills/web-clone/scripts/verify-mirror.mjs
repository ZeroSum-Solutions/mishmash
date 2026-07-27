#!/usr/bin/env node
// verify-mirror.mjs -- the mandatory pass/fail gate a mirror must clear before
// it may be reported complete or served to the user (see SKILL.md's capture
// -> finish -> verify recipe). Promoted from the ad-hoc gate.mjs that
// rescued a stalled designbybrandin.com mirror: serve the mirror on an
// ephemeral localhost port, headless-load it at each captured viewport with
// the same stepped-scroll pass mirror-site.mjs uses, and fail loudly on
// anything a "done" clone must not ship with: a same-origin request that
// 404s/fails, a request that leaked back to the mirror's original live
// origin instead of loading from the served local mirror, a broken <img>,
// scrollWidth/scrollHeight drifting more than 5% from the capture-time
// baseline, or a runtime global/count the baseline recorded that the clone
// doesn't reproduce.
//
// The pass/fail rules (lib/gate-decision.mjs), baseline validation
// (lib/gate-decision.mjs's validateBaselineDocument), request classification
// (lib/request-classification.mjs), and the static server + path guard
// (lib/static-server.mjs) are all pure/importable modules, unit-tested on
// their own without a live browser. This file is the thin Playwright-
// dependent glue that wires them together against a real served mirror.
//
// Usage:
//   node scripts/verify-mirror.mjs --site <mirror>/site [--baseline <mirror>/mirror-baseline-metrics.json] [--json]
//
// Without --baseline, only the same-origin-failure and broken-image checks
// run (no drift/runtime-global/count/origin-leak gating) -- pass
// mirror-site.mjs's mirror-baseline-metrics.json for the full gate.
// Exit 0 only on a full pass; exit 1 on any failing check or invalid input.

import fs from "node:fs";
import path from "node:path";

import { loadPlaywright, launchChromium } from "./lib/playwright-loader.mjs";
import { DEFAULT_VIEWPORTS, forceLazyMarkup, steppedScroll, collectRuntimeMetrics } from "./lib/viewport-capture.mjs";
import { evaluateGate, validateBaselineDocument } from "./lib/gate-decision.mjs";
import { bucketForRequestIssue, classifyRequestOrigin } from "./lib/request-classification.mjs";
import { startStaticServer } from "./lib/static-server.mjs";

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
failed/404 request, any request that leaked back to the mirror's original live
origin, any broken image, scrollWidth/scrollHeight drift beyond 5% vs the
baseline, or a runtime global/count the baseline recorded that the clone does
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

const requiredLabels = DEFAULT_VIEWPORTS.map((v) => v.label);
let baselineDoc = null;
let baselineByLabel = null;
if (args.baseline) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.resolve(args.baseline), "utf8"));
  } catch (error) {
    console.error(`✗ Could not read/parse --baseline ${args.baseline}: ${error.message}`);
    process.exit(1);
  }
  // Fail closed: an empty, malformed, or partial baseline (e.g. only
  // covering one of the three captured viewports) must not silently narrow
  // or skip the gate -- see lib/gate-decision.mjs's validateBaselineDocument.
  const validation = validateBaselineDocument(parsed, requiredLabels);
  if (!validation.ok) {
    console.error(`✗ Invalid --baseline ${args.baseline}: ${validation.error}`);
    process.exit(1);
  }
  baselineDoc = parsed;
  baselineByLabel = validation.baselineByLabel;
}

const viewports = baselineDoc ? baselineDoc.metrics.map((m) => m.viewport) : DEFAULT_VIEWPORTS;

let gate;
const localServer = await startStaticServer(siteDir);
try {
  const pw = loadPlaywright();
  const browser = await launchChromium(pw.chromium);
  try {
    const viewportResults = [];
    for (const viewport of viewports) {
      console.log(`▸ [${viewport.label}] Verifying: ${localServer.baseUrl}/`);
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.dpr,
      });
      try {
        const page = await context.newPage();
        const buckets = {
          sameOriginFailures: [],
          crossOriginFailures: [],
          originLeaks: [],
        };
        const { sameOriginFailures, crossOriginFailures, originLeaks } = buckets;
        const classify = (url) => classifyRequestOrigin(url, { localBase: localServer.baseUrl, originalOrigin: baselineDoc?.origin });
        page.on("requestfailed", (request) => {
          const url = request.url();
          // A2: a FAILED request routes through the same bucket rule as an
          // error response -- an origin-leak-classified URL is a leak
          // whether or not the origin answered. The previous handler
          // reasoned "a failed request can't be a leak (the origin didn't
          // answer)" and filed it under the ignored cross-origin bucket,
          // which let a mirror that still referenced its origin PASS the
          // gate whenever that origin happened to be offline -- the exact
          // situation (origin gone) the gate exists to protect against.
          buckets[bucketForRequestIssue(classify(url))].push({ url, error: request.failure()?.errorText || "" });
        });
        page.on("response", (response) => {
          const url = response.url();
          const kind = classify(url);
          // Origin-leak must be checked for EVERY response, not only
          // failing ones: the common shape is an asset the capture never
          // downloaded, still absolute after rewrite, loading fine (200)
          // from the still-live original origin -- a request that never
          // fails and would otherwise leave `originLeaks` empty even though
          // the mirror is silently still proxying the live site.
          if (kind === "origin-leak") {
            originLeaks.push({ url, status: response.status() });
            return;
          }
          if (response.status() >= 400) {
            buckets[bucketForRequestIssue(kind)].push({ url, status: response.status() });
          }
        });

        await page.goto(`${localServer.baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForLoadState("load", { timeout: 45000 }).catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await forceLazyMarkup(page);
        await steppedScroll(page, viewport);
        const metrics = await collectRuntimeMetrics(page, viewport);

        viewportResults.push({
          label: viewport.label,
          sameOriginFailures,
          crossOriginFailures,
          originLeaks,
          scrollWidth: metrics.scrollWidth,
          scrollHeight: metrics.scrollHeight,
          frameworks: metrics.frameworks,
          canvasCount: metrics.canvasCount,
          imageCount: metrics.imageCount,
          videoCount: metrics.videoCount,
          brokenImages: metrics.brokenImages,
        });
      } finally {
        await context.close().catch(() => {});
      }
    }

    gate = evaluateGate({ viewports: viewportResults, baselineByLabel });
  } finally {
    await browser.close().catch(() => {});
  }
} finally {
  await localServer.close();
}

for (const check of gate.checks) {
  const status = check.pass ? "PASS" : "FAIL";
  console.log(`[${status}] ${check.label}`);
  if (!check.sameOriginFailures.pass) {
    console.log(`   same-origin failures: ${check.sameOriginFailures.count}`);
    for (const failure of check.sameOriginFailures.items.slice(0, 10)) {
      console.log(`     ${failure.status ?? ""} ${failure.url} ${failure.error ?? ""}`.trim());
    }
  }
  if (check.originLeaks && !check.originLeaks.pass) {
    console.log(`   requests leaked to the original live origin: ${check.originLeaks.count} (mirror is not self-contained)`);
    for (const leak of check.originLeaks.items.slice(0, 10)) {
      console.log(`     ${leak.status ?? ""} ${leak.url} ${leak.error ?? ""}`.trim());
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
  // Origin-leak classification needs a recorded original origin
  // (`baselineDoc.origin`) to compare requests against -- with no
  // `--baseline`, there is nothing to compare, so that check cannot run
  // either. Only claim what actually executes.
  console.log("\n(no --baseline supplied: only same-origin-failure and broken-image checks ran)");
}
console.log(`\n${gate.pass ? "✅ PASS" : "✗ FAIL"}: mirror ${gate.pass ? "may" : "may NOT"} be reported complete or served to the user.`);

if (args.json) console.log(JSON.stringify(gate, null, 2));

process.exit(gate.pass ? 0 : 1);
