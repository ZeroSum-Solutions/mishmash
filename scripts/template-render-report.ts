/**
 * C1 baseline — template render harness.
 *
 * Goal-run task t1 (feat/creative-loop-and-morph): pure measurement, no
 * fixes. Renders every entry in the design-templates catalogue through the
 * two surfaces a user actually sees them on, and records what happened.
 *
 * Surface A — gallery card: `/api/skills/:id/example` in a
 * `sandbox="allow-scripts"` iframe, exactly as `TemplatesSection.tsx`
 * embeds it (`exampleUrl()` + the `templates-viewer__stage` frame).
 *
 * Surface B — canvas / FileViewer: fetches the daemon-declared entry HTML in
 * the parent, runs FileViewer's shared text/binary asset inliner, builds the
 * same srcdoc wrapper, and mounts it with
 * `sandbox="allow-scripts allow-downloads"`. A project is materialized through
 * the REAL `POST /api/projects` code path used by
 * `EntryShell.startProjectFromTemplate` (metadata `{kind:'template'}`,
 * skillId = template id) — no `autoSendFirstMessage`, so no agent turn ever
 * runs; this script only exercises the synchronous file-copy step.
 *
 * If the daemon returns no `project.metadata.entryFile`, this harness may
 * upload the template's own `example.html` as `index.html` through the real
 * `POST /api/projects/:id/upload` endpoint. Every record says which path it
 * took (`htmlSource`) so fallback seeding and normal project materialization
 * are never conflated in the counts. A full-scale acceptance census should
 * report (and normally require) zero fallback-seeded rows.
 *
 * Run: pnpm tsx scripts/template-render-report.ts [--json] [--limit=N]
 *   --json                  print a machine-readable summary object to stdout
 *   --limit=N               cap catalogue items processed per surface (debugging only)
 *   --surface=both|gallery|canvas
 *   --canvas=sample|all     use the stratified sample or every API catalogue entry
 *   --artifact-prefix=NAME  select clean JSONL/TXT output names in the proof directory
 *
 * Output:
 *   ~/.claude/goal-state/mishmash-creative-loop/proof/C1-baseline.jsonl
 *   ~/.claude/goal-state/mishmash-creative-loop/proof/C1-baseline.txt
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  prepareCanvasRenderDocument,
  projectEntryFile,
  replaceJsonLinesAtomically,
  summarizeBlockedEvents,
  type BlockedResourceEvent,
} from "./template-render-report-lib.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DAEMON_ORIGIN = process.env.OD_BASELINE_DAEMON_ORIGIN ?? "http://127.0.0.1:59919";
const WEB_ORIGIN = process.env.OD_BASELINE_WEB_ORIGIN ?? "http://127.0.0.1:59920";
const BASELINE_DATA_DIR = process.env.OD_BASELINE_DATA_DIR ?? path.join(REPO_ROOT, ".od");

const DESIGN_TEMPLATES_DIR = path.join(REPO_ROOT, "design-templates");
const OD_DESIGN_TEMPLATES_DIR = path.join(BASELINE_DATA_DIR, "design-templates");

const PROOF_DIR = path.join(os.homedir(), ".claude", "goal-state", "mishmash-creative-loop", "proof");

const PER_ITEM_TIMEOUT_MS = 20_000;
const NETWORK_IDLE_TIMEOUT_MS = 12_000;
const SETTLE_DELAY_MS = 1_200;
const CONCURRENCY = 6;
const PER_KIND_SAMPLE_TARGET = 10;

const argv = process.argv.slice(2);
const jsonFlag = argv.includes("--json");
const limitArg = argv.find((a) => a.startsWith("--limit="));
const ITEM_LIMIT = limitArg ? Number(limitArg.slice("--limit=".length)) : null;
const surfaceArg = argv.find((a) => a.startsWith("--surface="))?.slice("--surface=".length) ?? "both";
const canvasArg = argv.find((a) => a.startsWith("--canvas="))?.slice("--canvas=".length) ?? "sample";
const artifactPrefix =
  argv.find((a) => a.startsWith("--artifact-prefix="))?.slice("--artifact-prefix=".length) ?? "C1-baseline";
if (!new Set(["both", "gallery", "canvas"]).has(surfaceArg)) throw new Error(`invalid --surface: ${surfaceArg}`);
if (!new Set(["sample", "all"]).has(canvasArg)) throw new Error(`invalid --canvas: ${canvasArg}`);
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(artifactPrefix)) {
  throw new Error(`invalid --artifact-prefix: ${artifactPrefix}`);
}
const RUN_GALLERY = surfaceArg === "both" || surfaceArg === "gallery";
const RUN_CANVAS = surfaceArg === "both" || surfaceArg === "canvas";
const JSONL_PATH = path.join(PROOF_DIR, `${artifactPrefix}.jsonl`);
const TXT_PATH = path.join(PROOF_DIR, `${artifactPrefix}.txt`);

// ---------------------------------------------------------------------------
// Playwright — only e2e/package.json declares @playwright/test as a
// dependency (see e2e/playwright.config.ts). Resolve it from that package's
// own node_modules rather than adding a new root dependency for a
// measurement-only script.
// ---------------------------------------------------------------------------

const pwRequire = createRequire(path.join(REPO_ROOT, "e2e", "package.json"));

interface PWRequest {
  url(): string;
  failure(): { errorText: string } | null;
}
interface PWResponse {
  url(): string;
  status(): number;
}
interface PWConsoleMessage {
  type(): string;
  text(): string;
}
interface PWFrame {
  url(): string;
  // Accepts a source string in addition to a function: the browser-side
  // measurement script below is passed as a raw string (see the comment on
  // MEASURE_FRAME_SCRIPT) rather than a real TS function, so Playwright
  // evaluates the exact source text with no tsx/esbuild transform involved.
  evaluate<T>(fn: string | ((...fnArgs: never[]) => T)): Promise<T>;
}
interface PWPage {
  setContent(html: string, opts?: { waitUntil?: string }): Promise<void>;
  evaluate<T>(fn: string | (() => T)): Promise<T>;
  waitForLoadState(state?: string, opts?: { timeout?: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  frames(): PWFrame[];
  exposeFunction(name: string, fn: (...fnArgs: never[]) => unknown): Promise<void>;
  addInitScript(fn: string | (() => void)): Promise<void>;
  on(event: "console", handler: (msg: PWConsoleMessage) => void): void;
  on(event: "requestfailed", handler: (req: PWRequest) => void): void;
  on(event: "response", handler: (res: PWResponse) => void): void;
  close(): Promise<void>;
}
interface PWContext {
  newPage(): Promise<PWPage>;
  close(): Promise<void>;
}
interface PWBrowser {
  newContext(): Promise<PWContext>;
  close(): Promise<void>;
}
interface PWModule {
  chromium: { launch(opts?: { headless?: boolean }): Promise<PWBrowser> };
}

const pw = pwRequire("@playwright/test") as PWModule;

// ---------------------------------------------------------------------------
// Catalogue + on-disk reconciliation
// ---------------------------------------------------------------------------

interface CatalogueEntry {
  id: string;
  name: string;
  previewType: string;
  mode: string;
  source: string;
}

async function fetchCatalogue(): Promise<CatalogueEntry[]> {
  const res = await fetch(`${DAEMON_ORIGIN}/api/design-templates`);
  if (!res.ok) throw new Error(`GET /api/design-templates failed: ${res.status}`);
  const json = (await res.json()) as { designTemplates: CatalogueEntry[] };
  return json.designTemplates;
}

interface OnDiskEntry {
  id: string;
  hasExampleHtml: boolean;
  hasAssetsDir: boolean;
  kind: string | null;
}

async function scanOnDisk(dir: string): Promise<OnDiskEntry[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out: OnDiskEntry[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const templateDir = path.join(dir, e.name);
    const hasExampleHtml = existsSync(path.join(templateDir, "example.html"));
    const hasAssetsDir = existsSync(path.join(templateDir, "assets"));
    let kind: string | null = null;
    const templateJsonPath = path.join(templateDir, "template.json");
    if (existsSync(templateJsonPath)) {
      try {
        const raw = JSON.parse(await readFile(templateJsonPath, "utf8")) as { kind?: unknown };
        kind = typeof raw.kind === "string" ? raw.kind : null;
      } catch {
        // malformed template.json — leave kind unknown, not a harness concern
      }
    }
    out.push({ id: e.name, hasExampleHtml, hasAssetsDir, kind });
  }
  return out;
}

type TemplateSourceRoot = "design-templates" | ".od/design-templates" | "derived";

function resolveTemplateSource(
  id: string,
): { dir: string; examplePath: string; root: TemplateSourceRoot } | null {
  const rootDir = path.join(DESIGN_TEMPLATES_DIR, id);
  const rootExample = path.join(rootDir, "example.html");
  if (existsSync(rootExample)) return { dir: rootDir, examplePath: rootExample, root: "design-templates" };
  const odDir = path.join(OD_DESIGN_TEMPLATES_DIR, id);
  const odExample = path.join(odDir, "example.html");
  if (existsSync(odExample)) return { dir: odDir, examplePath: odExample, root: ".od/design-templates" };

  const separator = id.indexOf(":");
  if (separator > 0 && separator < id.length - 1) {
    const parentId = id.slice(0, separator);
    const childKey = id.slice(separator + 1);
    if (/^[A-Za-z0-9._-]+$/.test(childKey) && !childKey.startsWith(".")) {
      for (const parentRoot of [DESIGN_TEMPLATES_DIR, OD_DESIGN_TEMPLATES_DIR]) {
        const parentDir = path.join(parentRoot, parentId);
        const examplePath = path.join(parentDir, "examples", `${childKey}.html`);
        if (existsSync(examplePath)) return { dir: parentDir, examplePath, root: "derived" };
      }
    }
  }
  return null;
}

async function usesExternalCdn(exampleHtmlPath: string | null): Promise<boolean> {
  if (!exampleHtmlPath || !existsSync(exampleHtmlPath)) return false;
  const html = await readFile(exampleHtmlPath, "utf8");
  return /(?:src|href)\s*=\s*["']https:\/\//i.test(html) || /url\(\s*['"]?https:\/\//i.test(html);
}

// ---------------------------------------------------------------------------
// Shared render measurement
// ---------------------------------------------------------------------------

type BlockedEntry = BlockedResourceEvent;

interface FrameMetrics {
  textLen: number;
  canvasCount: number;
  paintedCanvasCount: number;
  imgCount: number;
  loadedImgCount: number;
  videoCount: number;
  loadedVideoCount: number;
}

type Verdict = "ok" | "degraded" | "blank" | "timeout" | "error";

interface RenderRecord {
  id: string;
  surface: "gallery-card" | "canvas-raw-file";
  renderedUrl: string;
  attempted: boolean;
  timedOut: boolean;
  errorMessage: string | null;
  httpStatus: number | null;
  blockedSubresources: BlockedEntry[];
  blockedEventCount: number;
  blockedDistinctUrlCount: number;
  blockedCspCount: number;
  blockedRemoteCount: number;
  blockedLocalCount: number;
  blockedLocal404Count?: number;
  blockedLocalProbeStatusCounts?: Record<string, number>;
  consoleErrorCount: number;
  consoleErrorSample: string[];
  renderedTextLength: number;
  canvasCount: number;
  paintedCanvasCount: number;
  imgCount: number;
  loadedImgCount: number;
  videoCount: number;
  loadedVideoCount: number;
  painted: boolean;
  verdict: Verdict;
  notes: string[];
  // catalogue / on-disk metadata (surface A) or materialization metadata (surface B)
  previewType?: string;
  mode?: string;
  source?: string;
  onDiskRoot?: string | null;
  kind?: string | null;
  usesExternalCdnInSource?: boolean;
  projectId?: string;
  materializationGap?: boolean;
  htmlSource?: "materialized" | "manually-seeded-example.html" | "no-html-available";
  copiedFileCount?: number;
  sourceExampleAvailable?: boolean;
}

// Raw source string, NOT a real TS function: Playwright's frame.evaluate()
// normally serializes a function via .toString() and re-evaluates it in the
// browser, but tsx/esbuild's "keep names" transform injects `__name(fn, "x")`
// helper calls into compiled function bodies for .name preservation — those
// calls reference a helper that only exists in the Node module that compiled
// this file, so the re-evaluated source throws `__name is not defined`
// inside the browser. Writing the browser-side code as a plain string sends
// the exact source text with no compiler transform in between, sidestepping
// the issue entirely. It runs INSIDE the (sandboxed, opaque-origin) iframe's
// browser context, so it is plain untyped JS by design, not TS checked here.
const MEASURE_FRAME_SCRIPT = `(() => {
  const canvasHasPaint = (canvas) => {
    if (canvas.width === 0 || canvas.height === 0) return false;
    try {
      const w = Math.min(canvas.width, 96);
      const h = Math.min(canvas.height, 96);
      const tmp = document.createElement("canvas");
      tmp.width = w;
      tmp.height = h;
      const tctx = tmp.getContext("2d");
      if (!tctx) return false;
      tctx.drawImage(canvas, 0, 0, w, h);
      const data = tctx.getImageData(0, 0, w, h).data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0 || data[i + 3] !== 0) return true;
      }
      return false;
    } catch (e) {
      // Tainted canvas (cross-origin content drawn without CORS): we can't
      // read pixels back, but something WAS drawn onto it. Count as painted.
      return true;
    }
  };
  const canvases = Array.from(document.querySelectorAll("canvas"));
  const paintedCanvases = canvases.filter(canvasHasPaint);
  const imgs = Array.from(document.querySelectorAll("img"));
  const loadedImgs = imgs.filter((img) => img.naturalWidth > 0);
  const videos = Array.from(document.querySelectorAll("video"));
  const loadedVideos = videos.filter((v) => v.readyState >= 2 && v.videoWidth > 0);
  return {
    textLen: ((document.body && document.body.innerText) || "").trim().length,
    canvasCount: canvases.length,
    paintedCanvasCount: paintedCanvases.length,
    imgCount: imgs.length,
    loadedImgCount: loadedImgs.length,
    videoCount: videos.length,
    loadedVideoCount: loadedVideos.length,
  };
})()`;

async function measureFrame(frame: PWFrame): Promise<FrameMetrics> {
  return frame.evaluate<FrameMetrics>(MEASURE_FRAME_SCRIPT);
}

async function probeLocalFailures(
  blocked: BlockedEntry[],
): Promise<{ local404Count: number; statusCounts: Record<string, number> }> {
  const origin = new URL(WEB_ORIGIN).origin;
  const candidates = [...summarizeBlockedEvents(blocked).byUrl.values()]
    .filter((entry) => entry.reason !== "csp")
    .map((entry) => entry.url)
    .filter((url) => {
      try {
        return new URL(url).origin === origin;
      } catch {
        return false;
      }
    });
  let local404Count = 0;
  const statusCounts: Record<string, number> = {};
  await runPool([...new Set(candidates)], 12, async (url) => {
    try {
      const response = await fetch(url, { method: "HEAD" });
      const key = String(response.status);
      statusCounts[key] = (statusCounts[key] ?? 0) + 1;
      if (response.status === 404) local404Count++;
    } catch {
      statusCounts["network-error"] = (statusCounts["network-error"] ?? 0) + 1;
      // The original browser observation remains a non-CSP failure. This
      // follow-up only labels local failures whose 404 status is confirmed.
    }
  });
  return { local404Count, statusCounts };
}

async function renderUrl(
  browser: PWBrowser,
  targetUrl: string,
  sandbox: string,
  prepared?: { srcdoc: string; httpStatus: number },
): Promise<{
  metrics: FrameMetrics | null;
  blocked: BlockedEntry[];
  consoleErrors: string[];
  httpStatus: number | null;
  timedOut: boolean;
  errorMessage: string | null;
}> {
  const context = await browser.newContext();
  const blocked: BlockedEntry[] = [];
  const consoleErrors: string[] = [];
  let httpStatus: number | null = prepared?.httpStatus ?? null;
  let timedOut = false;
  let errorMessage: string | null = null;
  let metrics: FrameMetrics | null = null;

  const hardTimeout = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), PER_ITEM_TIMEOUT_MS);
  });

  const work = (async () => {
    const page = await context.newPage();
    await page.exposeFunction("__odCspViolation", (payload: {
      blockedURI: string;
      violatedDirective: string;
      effectiveDirective: string;
      disposition: string;
    }) => {
      blocked.push({
        url: payload.blockedURI || "(inline)",
        reason: "csp",
        detail: `${payload.effectiveDirective || payload.violatedDirective} (${payload.disposition})`,
      });
    });
    // Raw source string for the same reason as MEASURE_FRAME_SCRIPT above
    // (tsx/esbuild's __name() injection breaks re-evaluation in the browser).
    await page.addInitScript(`(() => {
      window.addEventListener("securitypolicyviolation", (e) => {
        if (window.__odCspViolation) {
          window.__odCspViolation({
            blockedURI: e.blockedURI,
            violatedDirective: e.violatedDirective,
            effectiveDirective: e.effectiveDirective,
            disposition: e.disposition,
          });
        }
      });
    })()`);
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("requestfailed", (req) => {
      blocked.push({
        url: req.url(),
        reason: "requestfailed",
        detail: req.failure()?.errorText ?? "unknown",
      });
    });
    page.on("response", (res) => {
      if (res.url() === targetUrl) httpStatus = res.status();
      if (res.status() >= 400) {
        blocked.push({ url: res.url(), reason: "http-error", detail: String(res.status()) });
      }
    });

    const wrapper = `<!doctype html><html><body style="margin:0;background:#fff">` +
      `<iframe id="od-render-frame" sandbox="${sandbox}" ` +
      `style="width:1280px;height:900px;border:0"` +
      `${prepared ? "" : ` src="${targetUrl}"`}></iframe></body></html>`;
    await page.setContent(wrapper, { waitUntil: "domcontentloaded" });
    if (prepared) {
      await page.evaluate(
        `document.getElementById("od-render-frame").srcdoc = ${JSON.stringify(prepared.srcdoc)}`,
      );
    }
    try {
      await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS });
    } catch {
      // Network never settled (e.g. a hung CDN request) — still measure
      // whatever rendered so far rather than treating this as a hard failure.
    }
    await page.waitForTimeout(SETTLE_DELAY_MS);

    // Some catalogue entries (multipage-kind templates) serve /example as a
    // thin wrapper that itself embeds another iframe pointing at the real
    // content (e.g. .../assets/index.html) — a real, server-generated nested
    // structure, not a harness artifact. page.frames() flattens the whole
    // chain in outer-to-inner attachment order, so the deepest (last) frame
    // is always the one carrying whatever content actually reached the
    // user, whether or not there is nesting.
    const frames = page.frames();
    const iframeFrame = frames.length > 0 ? (frames[frames.length - 1] ?? null) : null;
    if (iframeFrame) {
      try {
        metrics = await measureFrame(iframeFrame);
      } catch (err) {
        errorMessage = `frame measure failed: ${String(err)}`;
      }
    }
  })();

  const outcome = await Promise.race([work.then(() => "done" as const), hardTimeout]);
  if (outcome === "timeout") timedOut = true;

  try {
    await context.close();
  } catch {
    // best-effort teardown
  }

  return { metrics, blocked, consoleErrors, httpStatus, timedOut, errorMessage };
}

function computeVerdict(opts: {
  timedOut: boolean;
  errorMessage: string | null;
  metrics: FrameMetrics | null;
  blockedCount: number;
}): Verdict {
  if (opts.timedOut) return "timeout";
  if (opts.errorMessage && !opts.metrics) return "error";
  if (!opts.metrics) return "blank";
  const painted = opts.metrics.paintedCanvasCount > 0 || opts.metrics.loadedImgCount > 0 || opts.metrics.loadedVideoCount > 0;
  const hasContent = opts.metrics.textLen > 0 || painted;
  if (!hasContent) return "blank";
  if (opts.blockedCount > 0) return "degraded";
  return "ok";
}

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

async function runPool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  async function runner(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i];
      if (item === undefined) return;
      await worker(item, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
}

// ---------------------------------------------------------------------------
// Surface A — gallery card
// ---------------------------------------------------------------------------

async function runSurfaceA(
  browser: PWBrowser,
  catalogue: CatalogueEntry[],
  onDiskById: Map<string, { root: string; kind: string | null }>,
): Promise<RenderRecord[]> {
  const items = ITEM_LIMIT ? catalogue.slice(0, ITEM_LIMIT) : catalogue;
  const results: RenderRecord[] = new Array(items.length);

  await runPool(items, CONCURRENCY, async (entry, index) => {
    const targetUrl = `${WEB_ORIGIN}/api/skills/${encodeURIComponent(entry.id)}/example`;
    const disk = onDiskById.get(entry.id) ?? null;
    let out: Awaited<ReturnType<typeof renderUrl>>;
    try {
      out = await renderUrl(browser, targetUrl, "allow-scripts");
    } catch (err) {
      out = { metrics: null, blocked: [], consoleErrors: [], httpStatus: null, timedOut: false, errorMessage: String(err) };
    }
    const blockedSummary = summarizeBlockedEvents(out.blocked);
    const verdict = computeVerdict({
      timedOut: out.timedOut,
      errorMessage: out.errorMessage,
      metrics: out.metrics,
      blockedCount: blockedSummary.distinctUrlCount,
    });
    const record: RenderRecord = {
      id: entry.id,
      surface: "gallery-card",
      renderedUrl: targetUrl,
      attempted: true,
      timedOut: out.timedOut,
      errorMessage: out.errorMessage,
      httpStatus: out.httpStatus,
      blockedSubresources: out.blocked,
      blockedEventCount: blockedSummary.eventCount,
      blockedDistinctUrlCount: blockedSummary.distinctUrlCount,
      blockedCspCount: blockedSummary.cspCount,
      blockedRemoteCount: blockedSummary.remoteCount,
      blockedLocalCount: blockedSummary.localCount,
      consoleErrorCount: out.consoleErrors.length,
      consoleErrorSample: out.consoleErrors.slice(0, 3),
      renderedTextLength: out.metrics?.textLen ?? 0,
      canvasCount: out.metrics?.canvasCount ?? 0,
      paintedCanvasCount: out.metrics?.paintedCanvasCount ?? 0,
      imgCount: out.metrics?.imgCount ?? 0,
      loadedImgCount: out.metrics?.loadedImgCount ?? 0,
      videoCount: out.metrics?.videoCount ?? 0,
      loadedVideoCount: out.metrics?.loadedVideoCount ?? 0,
      painted: (out.metrics?.paintedCanvasCount ?? 0) > 0 || (out.metrics?.loadedImgCount ?? 0) > 0 || (out.metrics?.loadedVideoCount ?? 0) > 0,
      verdict,
      notes: entry.previewType !== "html" ? [`previewType=${entry.previewType} (no rendered example expected)`] : [],
      previewType: entry.previewType,
      mode: entry.mode,
      source: entry.source,
      onDiskRoot: disk?.root ?? (entry.id.includes(":") ? "derived" : "unmatched"),
      kind: disk?.kind ?? null,
    };
    results[index] = record;
    if ((index + 1) % 50 === 0) {
      process.stderr.write(`  surface A: ${index + 1}/${items.length}\n`);
    }
  });

  return results;
}

// ---------------------------------------------------------------------------
// Surface B — canvas / FileViewer (shared srcdoc pipeline, real materialization)
// ---------------------------------------------------------------------------

function sanitizeForProjectId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60);
}

async function materializeProject(
  id: string,
  examplePath: string | null,
): Promise<{
  projectId: string;
  createOk: boolean;
  materializedEntryFile: string | null;
  materializationGap: boolean;
  htmlSource: "materialized" | "manually-seeded-example.html" | "no-html-available";
  renderEntryFile: string | null;
  copiedFileCount: number;
  projectFilePaths: string[];
  errorMessage: string | null;
}> {
  const projectId = `t1b-${sanitizeForProjectId(id)}-${Math.random().toString(36).slice(2, 8)}`;
  const createRes = await fetch(`${DAEMON_ORIGIN}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: projectId,
      name: `t1-baseline ${id}`,
      skillId: id,
      designSystemId: null,
      metadata: { kind: "template" },
    }),
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "");
    return {
      projectId,
      createOk: false,
      materializedEntryFile: null,
      materializationGap: true,
      htmlSource: "no-html-available",
      renderEntryFile: null,
      copiedFileCount: 0,
      projectFilePaths: [],
      errorMessage: `create failed (${createRes.status}): ${text.slice(0, 300)}`,
    };
  }

  const createJson = (await createRes.json()) as { project?: unknown };
  const materializedEntryFile = projectEntryFile(createJson.project);
  const filesRes = await fetch(`${DAEMON_ORIGIN}/api/projects/${projectId}/files`);
  const filesJson = filesRes.ok ? ((await filesRes.json()) as { files: { name: string }[] }) : { files: [] };
  const names = filesJson.files.map((f) => f.name);
  const copiedFileCount = names.length;
  const materializationGap = materializedEntryFile === null;

  let htmlSource: "materialized" | "manually-seeded-example.html" | "no-html-available" = "materialized";
  let renderEntryFile = materializedEntryFile;

  if (materializationGap) {
    if (examplePath && existsSync(examplePath)) {
      const buf = await readFile(examplePath);
      const form = new FormData();
      form.append("files", new Blob([buf], { type: "text/html" }), "index.html");
      const uploadRes = await fetch(`${DAEMON_ORIGIN}/api/projects/${projectId}/upload`, { method: "POST", body: form });
      if (uploadRes.ok) {
        htmlSource = "manually-seeded-example.html";
        renderEntryFile = "index.html";
        names.push("index.html");
      } else {
        htmlSource = "no-html-available";
        renderEntryFile = null;
      }
    } else {
      htmlSource = "no-html-available";
      renderEntryFile = null;
    }
  }

  return {
    projectId,
    createOk: true,
    materializedEntryFile,
    materializationGap,
    htmlSource,
    renderEntryFile,
    copiedFileCount,
    projectFilePaths: names,
    errorMessage: null,
  };
}

async function deleteProject(projectId: string): Promise<void> {
  try {
    await fetch(`${DAEMON_ORIGIN}/api/projects/${projectId}`, { method: "DELETE" });
  } catch {
    // best-effort cleanup — stray .od/projects/* entries are harmless dev state
  }
}

interface SampleItem {
  id: string;
  kind: string | null;
  examplePath: string | null;
  onDiskRoot: TemplateSourceRoot | "unmatched";
  sourceExampleAvailable: boolean;
}

async function buildSurfaceBSample(onDiskRoot: OnDiskEntry[], catalogueIds: Set<string>): Promise<{ items: SampleItem[]; method: string[] }> {
  const eligible = onDiskRoot.filter((e) => e.hasExampleHtml && catalogueIds.has(e.id));
  const byKind = new Map<string, OnDiskEntry[]>();
  for (const e of eligible) {
    const k = e.kind ?? "unknown";
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)?.push(e);
  }

  const sampledIds = new Set<string>();
  const method: string[] = [];

  const explicitWebgl = ["webgl-experience", "woven-light-hero"];
  for (const id of explicitWebgl) {
    if (catalogueIds.has(id)) {
      sampledIds.add(id);
      method.push(`explicit include (WebGL): ${id}`);
    }
  }

  for (const [kind, entries] of [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
    const step = Math.max(1, Math.floor(sorted.length / PER_KIND_SAMPLE_TARGET));
    let picked = 0;
    for (let i = 0; i < sorted.length && picked < PER_KIND_SAMPLE_TARGET; i += step) {
      const entry = sorted[i];
      if (!entry) continue;
      sampledIds.add(entry.id);
      picked++;
    }
    method.push(`kind="${kind}": ${picked} of ${sorted.length} on-disk entries, stride ${step} over alphabetical order`);
  }

  const items: SampleItem[] = [];
  for (const id of sampledIds) {
    const resolved = resolveTemplateSource(id);
    if (!resolved) continue;
    const onDisk = eligible.find((e) => e.id === id);
    items.push({
      id,
      kind: onDisk?.kind ?? null,
      examplePath: resolved.examplePath,
      onDiskRoot: resolved.root,
      sourceExampleAvailable: true,
    });
  }
  return { items: items.sort((a, b) => a.id.localeCompare(b.id)), method };
}

function buildSurfaceBFull(
  catalogue: CatalogueEntry[],
  onDiskById: Map<string, { root: string; kind: string | null }>,
): { items: SampleItem[]; method: string[] } {
  return {
    items: catalogue.map((entry) => {
      const resolved = resolveTemplateSource(entry.id);
      return {
        id: entry.id,
        kind: onDiskById.get(entry.id)?.kind ?? null,
        examplePath: resolved?.examplePath ?? null,
        onDiskRoot: resolved?.root ?? "unmatched",
        sourceExampleAvailable: resolved != null,
      };
    }),
    method: [`all ${catalogue.length} entries returned by GET /api/design-templates`],
  };
}

async function runSurfaceB(browser: PWBrowser, sample: SampleItem[]): Promise<RenderRecord[]> {
  const items = ITEM_LIMIT ? sample.slice(0, ITEM_LIMIT) : sample;
  const results: RenderRecord[] = new Array(items.length);

  await runPool(items, CONCURRENCY, async (item, index) => {
    const cdn = await usesExternalCdn(item.examplePath);
    const mat = await materializeProject(item.id, item.examplePath);

    if (!mat.createOk || !mat.renderEntryFile) {
      const record: RenderRecord = {
        id: item.id,
        surface: "canvas-raw-file",
        renderedUrl: mat.renderEntryFile
          ? `${WEB_ORIGIN}/api/projects/${mat.projectId}/raw/${mat.renderEntryFile}`
          : "(none — no html entry file available)",
        attempted: false,
        timedOut: false,
        errorMessage: mat.errorMessage,
        httpStatus: null,
        blockedSubresources: [],
        blockedEventCount: 0,
        blockedDistinctUrlCount: 0,
        blockedCspCount: 0,
        blockedRemoteCount: 0,
        blockedLocalCount: 0,
        blockedLocal404Count: 0,
        blockedLocalProbeStatusCounts: {},
        consoleErrorCount: 0,
        consoleErrorSample: [],
        renderedTextLength: 0,
        canvasCount: 0,
        paintedCanvasCount: 0,
        imgCount: 0,
        loadedImgCount: 0,
        videoCount: 0,
        loadedVideoCount: 0,
        painted: false,
        verdict: "blank",
        notes: [
          mat.createOk
            ? "materialization gap: no HTML entry file after project create, and no example.html could be seeded"
            : "project create failed",
        ],
        kind: item.kind,
        usesExternalCdnInSource: cdn,
        projectId: mat.projectId,
        materializationGap: mat.materializationGap,
        htmlSource: mat.htmlSource,
        copiedFileCount: mat.copiedFileCount,
        onDiskRoot: item.onDiskRoot,
        sourceExampleAvailable: item.sourceExampleAvailable,
      };
      results[index] = record;
      await deleteProject(mat.projectId);
      return;
    }

    const targetUrl = `${WEB_ORIGIN}/api/projects/${mat.projectId}/raw/${mat.renderEntryFile}`;
    let out: Awaited<ReturnType<typeof renderUrl>>;
    try {
      const prepared = await prepareCanvasRenderDocument({
        projectId: mat.projectId,
        entryFile: mat.renderEntryFile,
        projectFilePaths: new Set(mat.projectFilePaths),
        webOrigin: WEB_ORIGIN,
        fetch: globalThis.fetch.bind(globalThis),
      });
      out = await renderUrl(browser, targetUrl, "allow-scripts allow-downloads", prepared);
    } catch (err) {
      out = { metrics: null, blocked: [], consoleErrors: [], httpStatus: null, timedOut: false, errorMessage: String(err) };
    }
    const blockedSummary = summarizeBlockedEvents(out.blocked);
    const localProbe = await probeLocalFailures(out.blocked);
    const verdict = computeVerdict({
      timedOut: out.timedOut,
      errorMessage: out.errorMessage,
      metrics: out.metrics,
      blockedCount: blockedSummary.distinctUrlCount,
    });
    const notes: string[] = [];
    if (mat.htmlSource === "manually-seeded-example.html") {
      notes.push(
        "html seeded from the template's raw example.html (materialization did not copy it); " +
          "relative asset paths inside example.html (e.g. assets/x) assume /api/skills/:id/assets/ " +
          "rewriting and may 404 in this project context — such 404s are NOT CSP blocks",
      );
    }
    const record: RenderRecord = {
      id: item.id,
      surface: "canvas-raw-file",
      renderedUrl: targetUrl,
      attempted: true,
      timedOut: out.timedOut,
      errorMessage: out.errorMessage,
      httpStatus: out.httpStatus,
      blockedSubresources: out.blocked,
      blockedEventCount: blockedSummary.eventCount,
      blockedDistinctUrlCount: blockedSummary.distinctUrlCount,
      blockedCspCount: blockedSummary.cspCount,
      blockedRemoteCount: blockedSummary.remoteCount,
      blockedLocalCount: blockedSummary.localCount,
      blockedLocal404Count: localProbe.local404Count,
      blockedLocalProbeStatusCounts: localProbe.statusCounts,
      consoleErrorCount: out.consoleErrors.length,
      consoleErrorSample: out.consoleErrors.slice(0, 3),
      renderedTextLength: out.metrics?.textLen ?? 0,
      canvasCount: out.metrics?.canvasCount ?? 0,
      paintedCanvasCount: out.metrics?.paintedCanvasCount ?? 0,
      imgCount: out.metrics?.imgCount ?? 0,
      loadedImgCount: out.metrics?.loadedImgCount ?? 0,
      videoCount: out.metrics?.videoCount ?? 0,
      loadedVideoCount: out.metrics?.loadedVideoCount ?? 0,
      painted: (out.metrics?.paintedCanvasCount ?? 0) > 0 || (out.metrics?.loadedImgCount ?? 0) > 0 || (out.metrics?.loadedVideoCount ?? 0) > 0,
      verdict,
      notes,
      kind: item.kind,
      usesExternalCdnInSource: cdn,
      projectId: mat.projectId,
      materializationGap: mat.materializationGap,
      htmlSource: mat.htmlSource,
      copiedFileCount: mat.copiedFileCount,
      onDiskRoot: item.onDiskRoot,
      sourceExampleAvailable: item.sourceExampleAvailable,
    };
    results[index] = record;
    await deleteProject(mat.projectId);
    if ((index + 1) % 10 === 0) {
      process.stderr.write(`  surface B: ${index + 1}/${items.length}\n`);
    }
  });

  return results;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function tally(records: RenderRecord[]): Record<Verdict, number> {
  const out: Record<Verdict, number> = { ok: 0, degraded: 0, blank: 0, timeout: 0, error: 0 };
  for (const r of records) out[r.verdict]++;
  return out;
}

function topBlockedReasons(records: RenderRecord[], n: number): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of records) {
    const { byUrl } = summarizeBlockedEvents(r.blockedSubresources);
    for (const entry of byUrl.values()) {
      const key = entry.reason === "csp" ? `csp: ${entry.detail}` : `${entry.reason}: ${entry.detail}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([reason, count]) => ({ reason, count }));
}

function countHttpsBlocks(records: RenderRecord[], kind: "font" | "img" | "script" | "style" | "media" | "connect"): number {
  let count = 0;
  for (const r of records) {
    const { byUrl } = summarizeBlockedEvents(r.blockedSubresources);
    for (const entry of byUrl.values()) {
      if (entry.reason !== "csp") continue;
      if (!entry.detail.includes(`${kind}-src`)) continue;
      if (!entry.url.startsWith("https://")) continue;
      count++;
      break;
    }
  }
  return count;
}

async function main(): Promise<void> {
  await mkdir(PROOF_DIR, { recursive: true });
  process.stderr.write(`fetching catalogue from ${DAEMON_ORIGIN}/api/design-templates ...\n`);
  const catalogue = await fetchCatalogue();

  const onDiskRoot = await scanOnDisk(DESIGN_TEMPLATES_DIR);
  const onDiskOd = await scanOnDisk(OD_DESIGN_TEMPLATES_DIR);
  const onDiskById = new Map<string, { root: string; kind: string | null }>();
  for (const e of onDiskRoot) onDiskById.set(e.id, { root: "design-templates", kind: e.kind });
  for (const e of onDiskOd) if (!onDiskById.has(e.id)) onDiskById.set(e.id, { root: ".od/design-templates", kind: e.kind });

  const catalogueIds = new Set(catalogue.map((c) => c.id));
  const derivedCount = catalogue.filter((c) => c.id.includes(":")).length;
  const matchedRoot = catalogue.filter((c) => onDiskById.get(c.id)?.root === "design-templates").length;
  const matchedOd = catalogue.filter((c) => onDiskById.get(c.id)?.root === ".od/design-templates").length;
  const unmatched = catalogue.filter((c) => !c.id.includes(":") && !onDiskById.has(c.id)).length;
  const rootWithExampleHtml = onDiskRoot.filter((e) => e.hasExampleHtml).length;

  process.stderr.write(
    `catalogue: ${catalogue.length} total | design-templates/: ${onDiskRoot.length} dirs (${rootWithExampleHtml} with example.html) | ` +
      `.od/design-templates/: ${onDiskOd.length} dirs | derived ids: ${derivedCount}\n`,
  );

  const browser = await pw.chromium.launch({ headless: true });
  let surfaceA: RenderRecord[] = [];
  let surfaceB: RenderRecord[] = [];
  let canvasItems: SampleItem[] = [];
  let canvasMethod: string[] = [];
  try {
    if (RUN_GALLERY) {
      process.stderr.write(`surface A: rendering ${ITEM_LIMIT ?? catalogue.length} catalogue entries via gallery-card path ...\n`);
      surfaceA = await runSurfaceA(browser, catalogue, onDiskById);
    }
    if (RUN_CANVAS) {
      const selection = canvasArg === "all"
        ? buildSurfaceBFull(catalogue, onDiskById)
        : await buildSurfaceBSample(onDiskRoot, catalogueIds);
      canvasItems = selection.items;
      canvasMethod = selection.method;
      process.stderr.write(
        `surface B: rendering ${ITEM_LIMIT ?? canvasItems.length} ${canvasArg === "all" ? "catalogue" : "sampled"} ` +
          `templates via canvas/shared-srcdoc path ...\n`,
      );
      surfaceB = await runSurfaceB(browser, canvasItems);
    }
  } finally {
    await browser.close();
  }
  await replaceJsonLinesAtomically(JSONL_PATH, [...surfaceA, ...surfaceB]);

  const tallyA = tally(surfaceA);
  const tallyB = tally(surfaceB);
  const blockedA = surfaceA.filter((r) => r.blockedDistinctUrlCount > 0).length;
  const blockedB = surfaceB.filter((r) => r.blockedDistinctUrlCount > 0).length;
  const cspBlockedA = surfaceA.filter((r) => r.blockedCspCount > 0).length;
  const cspBlockedB = surfaceB.filter((r) => r.blockedCspCount > 0).length;
  const rawEventCountA = surfaceA.reduce((total, record) => total + record.blockedEventCount, 0);
  const rawEventCountB = surfaceB.reduce((total, record) => total + record.blockedEventCount, 0);
  const distinctUrlCountA = surfaceA.reduce((total, record) => total + record.blockedDistinctUrlCount, 0);
  const distinctUrlCountB = surfaceB.reduce((total, record) => total + record.blockedDistinctUrlCount, 0);
  const cspUrlCountB = surfaceB.reduce((total, record) => total + record.blockedCspCount, 0);
  const remoteUrlCountB = surfaceB.reduce((total, record) => total + record.blockedRemoteCount, 0);
  const localUrlCountB = surfaceB.reduce((total, record) => total + record.blockedLocalCount, 0);
  const remoteBlockedB = surfaceB.filter((record) => record.blockedRemoteCount > 0).length;
  const localBlockedB = surfaceB.filter((record) => record.blockedLocalCount > 0).length;
  const local404CountB = surfaceB.reduce((total, record) => total + (record.blockedLocal404Count ?? 0), 0);
  const local404TemplateCountB = surfaceB.filter((record) => (record.blockedLocal404Count ?? 0) > 0).length;
  const localProbeStatusCountsB: Record<string, number> = {};
  for (const record of surfaceB) {
    for (const [status, count] of Object.entries(record.blockedLocalProbeStatusCounts ?? {})) {
      localProbeStatusCountsB[status] = (localProbeStatusCountsB[status] ?? 0) + count;
    }
  }
  const zeroBlockedB = surfaceB.filter((record) => record.blockedDistinctUrlCount === 0).length;
  const zeroRemoteB = surfaceB.filter((record) => record.blockedRemoteCount === 0).length;
  const zeroLocalB = surfaceB.filter((record) => record.blockedLocalCount === 0).length;
  const zeroCspB = surfaceB.filter((record) => record.blockedCspCount === 0).length;
  const rootExampleB = surfaceB.filter(
    (record) => record.onDiskRoot === "design-templates" && record.sourceExampleAvailable,
  );
  const rootExampleZeroBlockedB = rootExampleB.filter(
    (record) => record.blockedDistinctUrlCount === 0,
  ).length;
  const rootExampleZeroRemoteB = rootExampleB.filter(
    (record) => record.blockedRemoteCount === 0,
  ).length;
  const rootExampleZeroLocalB = rootExampleB.filter(
    (record) => record.blockedLocalCount === 0,
  ).length;
  const rootExampleZeroCspB = rootExampleB.filter((record) => record.blockedCspCount === 0).length;

  const httpsFontsA = countHttpsBlocks(surfaceA, "font");
  const httpsImgA = countHttpsBlocks(surfaceA, "img");
  const httpsScriptA = countHttpsBlocks(surfaceA, "script");
  const httpsStyleA = countHttpsBlocks(surfaceA, "style");
  const httpsFontsB = countHttpsBlocks(surfaceB, "font");
  const httpsImgB = countHttpsBlocks(surfaceB, "img");
  const httpsScriptB = countHttpsBlocks(surfaceB, "script");
  const httpsStyleB = countHttpsBlocks(surfaceB, "style");

  const materializationGapCount = surfaceB.filter((r) => r.materializationGap).length;
  const seededCount = surfaceB.filter((r) => r.htmlSource === "manually-seeded-example.html").length;
  const noHtmlCount = surfaceB.filter((r) => r.htmlSource === "no-html-available").length;

  const topBlockedA = topBlockedReasons(surfaceA, 5);
  const topBlockedAll = topBlockedReasons([...surfaceA, ...surfaceB], 5);

  const command = `pnpm tsx scripts/template-render-report.ts${argv.length > 0 ? ` ${argv.join(" ")}` : ""}`;

  const lines: string[] = [];
  lines.push(`${artifactPrefix} — template render census`);
  lines.push("=".repeat(72));
  lines.push(`command: ${command}`);
  lines.push(`daemon: ${DAEMON_ORIGIN}  web: ${WEB_ORIGIN}`);
  lines.push(`daemon data snapshot: ${BASELINE_DATA_DIR}`);
  lines.push(`run at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("Catalogue reconciliation");
  lines.push("-".repeat(72));
  lines.push(`GET /api/design-templates entries: ${catalogue.length}`);
  lines.push(`  matched design-templates/ (git-tracked, on-disk set): ${matchedRoot}`);
  lines.push(`  matched .od/design-templates/ (untracked runtime data dir): ${matchedOd}`);
  lines.push(`  derived <parent>:<child> ids (examples/ subfolders): ${derivedCount}`);
  lines.push(`  unaccounted for: ${unmatched}`);
  lines.push(`design-templates/ on disk: ${onDiskRoot.length} dirs, ${rootWithExampleHtml} with example.html (task-stated baseline: 352 / 344)`);
  lines.push(`daemon-data design-templates/: ${onDiskOd.length} dirs from the explicit census data snapshot above.`);
  lines.push(`  This is the second DESIGN_TEMPLATE_ROOTS entry and is reported separately from the repo-tracked`);
  lines.push(`  352/344 cohort used by C2.`);
  lines.push("");
  lines.push("Surface A — gallery card (/api/skills/:id/example, sandbox=\"allow-scripts\", no CSP header set)");
  lines.push("-".repeat(72));
  if (!RUN_GALLERY) {
    lines.push("skipped by --surface=canvas");
  } else {
    lines.push(`rendered: ${surfaceA.length}`);
    lines.push(`  ok: ${tallyA.ok}  degraded: ${tallyA.degraded}  blank: ${tallyA.blank}  timeout: ${tallyA.timeout}  error: ${tallyA.error}`);
    lines.push(`  with >=1 blocked subresource: ${blockedA}`);
    lines.push(`  raw blocked events: ${rawEventCountA}; distinct URL observations: ${distinctUrlCountA}`);
    lines.push(`  with >=1 CSP-attributed block: ${cspBlockedA} (this route sets no CSP header)`);
    lines.push(`  https: blocked by CSP — font-src: ${httpsFontsA}  img-src: ${httpsImgA}  script-src: ${httpsScriptA}  style-src: ${httpsStyleA}`);
  }
  lines.push("");
  lines.push("Surface B — canvas/FileViewer (parent fetch -> shared text/binary inlining -> buildSrcdoc,");
  lines.push("  sandbox=\"allow-scripts allow-downloads\")");
  lines.push("-".repeat(72));
  if (!RUN_CANVAS) {
    lines.push("skipped by --surface=gallery");
  } else {
    lines.push(`${canvasArg === "all" ? "full catalogue" : "stratified sample"} size: ${surfaceB.length}`);
    lines.push(`  ok: ${tallyB.ok}  degraded: ${tallyB.degraded}  blank: ${tallyB.blank}  timeout: ${tallyB.timeout}  error: ${tallyB.error}`);
    lines.push(`  with >=1 blocked subresource: ${blockedB}; zero blocked: ${zeroBlockedB}/${surfaceB.length}`);
    lines.push(`  raw blocked events: ${rawEventCountB}; distinct URL observations: ${distinctUrlCountB}`);
    lines.push(`  remote distinct URLs: ${remoteUrlCountB} across ${remoteBlockedB} templates; zero remote: ${zeroRemoteB}/${surfaceB.length}`);
    lines.push(`  local distinct URLs: ${localUrlCountB} across ${localBlockedB} templates; zero local: ${zeroLocalB}/${surfaceB.length}`);
    lines.push(`  CSP-attributed distinct URLs: ${cspUrlCountB} across ${cspBlockedB} templates; zero CSP: ${zeroCspB}/${surfaceB.length}`);
    lines.push(`  confirmed local 404 subset: ${local404CountB} distinct URLs across ${local404TemplateCountB} templates`);
    lines.push(`  local failed-request HEAD probe statuses: ${JSON.stringify(localProbeStatusCountsB)}`);
    lines.push(`  repo example.html cohort: ${rootExampleB.length}; zero blocked: ${rootExampleZeroBlockedB}/${rootExampleB.length}; zero remote: ${rootExampleZeroRemoteB}/${rootExampleB.length}; zero local: ${rootExampleZeroLocalB}/${rootExampleB.length}; zero CSP: ${rootExampleZeroCspB}/${rootExampleB.length}`);
    lines.push(`  https: blocked by CSP — font-src: ${httpsFontsB}  img-src: ${httpsImgB}  script-src: ${httpsScriptB}  style-src: ${httpsStyleB}`);
  }
  lines.push("");
  lines.push("  Materialization (POST /api/projects with skillId=<template>, metadata.kind='template' — the exact");
  lines.push("  path EntryShell.startProjectFromTemplate takes):");
  lines.push(`    projects where materialization produced NO html entry file: ${materializationGapCount} / ${surfaceB.length}`);
  lines.push(`      -> of those, example.html seeded via real POST /api/projects/:id/upload: ${seededCount}`);
  lines.push(`      -> of those, no html available at all (no example.html on disk): ${noHtmlCount}`);
  lines.push("");
  lines.push("  Surface B selection method:");
  for (const method of canvasMethod) lines.push(`    - ${method}`);
  if (canvasArg === "sample") lines.push(`  sampled ids: ${canvasItems.map((item) => item.id).join(", ")}`);
  lines.push("");
  lines.push("Top 5 blocked-resource reasons by frequency (surface A)");
  lines.push("-".repeat(72));
  for (const { reason, count } of topBlockedA) lines.push(`  ${count}x  ${reason}`);
  if (topBlockedA.length === 0) lines.push("  (none — zero deduplicated blocked-resource entries across surface A)");
  lines.push("");
  lines.push("Top 5 blocked-resource reasons by frequency (both surfaces combined)");
  lines.push("-".repeat(72));
  for (const { reason, count } of topBlockedAll) lines.push(`  ${count}x  ${reason}`);
  lines.push("");
  lines.push("Blocked-resource buckets — distinct by URL, measured, not assumed");
  lines.push("-".repeat(72));
  lines.push(`  Surface A: ${cspBlockedA}/${surfaceA.length} templates have CSP-attributed blocks; this surface has no CSP header.`);
  lines.push(`  Surface B: ${remoteUrlCountB} remote and ${localUrlCountB} local distinct URL observations.`);
  lines.push(`  CSP attribution overlaps host buckets: ${cspUrlCountB} distinct URLs were CSP-attributed.`);
  lines.push(`  Raw retry/event noise is diagnostic only: ${rawEventCountB} events produced ${distinctUrlCountB} per-entry distinct URL observations.`);
  lines.push("");
  lines.push("Exit");
  lines.push("-".repeat(72));
  lines.push("exit code: 0");
  lines.push(`proof files: ${JSONL_PATH}`);
  lines.push(`             ${TXT_PATH}`);
  lines.push("");

  await writeFile(TXT_PATH, lines.join("\n"), "utf8");
  process.stderr.write(lines.join("\n"));
  process.stderr.write("\n");

  if (jsonFlag) {
    process.stdout.write(
      JSON.stringify(
        {
          catalogueTotal: catalogue.length,
          onDiskRootDirs: onDiskRoot.length,
          onDiskRootWithExampleHtml: rootWithExampleHtml,
          onDiskOdDirs: onDiskOd.length,
          surfaceA: {
            total: surfaceA.length,
            ...tallyA,
            blockedCount: blockedA,
            cspBlockedCount: cspBlockedA,
            blockedEventCount: rawEventCountA,
            blockedDistinctUrlCount: distinctUrlCountA,
          },
          surfaceB: {
            total: surfaceB.length,
            ...tallyB,
            blockedCount: blockedB,
            zeroBlockedCount: zeroBlockedB,
            blockedEventCount: rawEventCountB,
            blockedDistinctUrlCount: distinctUrlCountB,
            blockedRemoteCount: remoteUrlCountB,
            blockedRemoteTemplateCount: remoteBlockedB,
            zeroRemoteCount: zeroRemoteB,
            blockedLocalCount: localUrlCountB,
            blockedLocalTemplateCount: localBlockedB,
            zeroLocalCount: zeroLocalB,
            cspBlockedTemplateCount: cspBlockedB,
            cspBlockedDistinctUrlCount: cspUrlCountB,
            zeroCspCount: zeroCspB,
            confirmedLocal404Count: local404CountB,
            confirmedLocal404TemplateCount: local404TemplateCountB,
            localFailedRequestProbeStatusCounts: localProbeStatusCountsB,
            materializationGapCount,
            repoExampleCohort: {
              total: rootExampleB.length,
              zeroBlockedCount: rootExampleZeroBlockedB,
              zeroRemoteCount: rootExampleZeroRemoteB,
              zeroLocalCount: rootExampleZeroLocalB,
              zeroCspCount: rootExampleZeroCspB,
            },
          },
          proof: { jsonl: JSONL_PATH, txt: TXT_PATH },
        },
        null,
        2,
      ),
    );
    process.stdout.write("\n");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
