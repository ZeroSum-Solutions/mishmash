// Bounded local project-cover renderer (S4-2 / S4-3 / C4-5 / C4-6).
//
// Hard constraints from the wave PRD (docs/plans/waves/W4-project-covers.md):
//  - Local renderer over TRUSTED PROJECT FILES ONLY -- never coupled to, or
//    reusing, remote URL capture. The entry is always loaded via a `file://`
//    URL resolved from the project's own directory, never an http(s) URL.
//  - Bounded: a concurrency cap, a per-job timeout, and a real, enforced
//    memory ceiling -- each proven independently, including against a
//    deliberately pathological project (infinite loop / unbounded
//    allocation).
//  - Cannot reach the network: PROCESS-LEVEL denial (a dead proxy + a
//    blackhole host-resolver rule), not interception on one HTTP client
//    while the browser itself egresses freely.
//
// Crop: sharp's built-in `attention` salience strategy (S4-3) picks the
// TARGET_WIDTH x TARGET_HEIGHT window out of a full-page screenshot in one
// step -- no bespoke crop-window math needed.

import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { createLimiter } from './limiter.js';
import { RenderMemoryLimitError, RenderTimeoutError } from './errors.js';
import { aggregateProcessTreeRssKb } from './process-rss.js';

/** Concurrency cap -- a runaway/pathological project must not take the
 * daemon with it, and a fixed cap keeps throughput measurably flat under
 * load (C4-5's plateau-ratio proof). */
export const RENDER_CONCURRENCY = 4;

/** Per-job hard deadline. Comfortably above any real render (including a
 * few seconds of blocking JS on load) and comfortably below the >90s window
 * a hostile infinite-loop project would otherwise consume. */
export const PER_JOB_TIMEOUT_MS = 20_000;

/** How often the OUT-OF-PROCESS memory poller samples the job's own browser
 * process tree. Short enough to catch a fast-allocating hostile page well
 * before it threatens the host. */
const MEMORY_POLL_INTERVAL_MS = 150;

/** Growth ABOVE this job's own baseline (Chromium's fixed startup
 * footprint) kills the job with a typed RENDER_MEMORY_LIMIT. */
const MEMORY_GROWTH_CEILING_KB = 400 * 1024; // 400 MB

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 960;

export const COVER_TARGET_WIDTH = 1280;
export const COVER_TARGET_HEIGHT = 800;

// A loopback port nothing listens on. Every HTTP(S)/WS request Chromium's
// network stack issues is routed through this dead proxy and fails closed
// immediately -- true process-level denial, not a per-route JS interception
// that a WebSocket or beacon request could slip past. `file://` navigation
// and same-directory relative resource loads never go through an HTTP
// proxy at all, so the project's own local files still render normally.
const DEAD_PROXY_SERVER = 'http://127.0.0.1:1';

export interface RenderResult {
  imageBytes: Buffer;
  width: number;
  height: number;
}

const limiter = createLimiter<RenderResult>(RENDER_CONCURRENCY);

/** Renders `entryFileAbsPath` (a trusted, on-disk project HTML file) into a
 * cropped COVER_TARGET_WIDTH x COVER_TARGET_HEIGHT PNG. Bounded by the
 * module-level concurrency cap; call sites do not need their own queueing. */
export async function renderCoverImage(entryFileAbsPath: string): Promise<RenderResult> {
  return limiter(() => renderOnce(entryFileAbsPath));
}

async function renderOnce(entryFileAbsPath: string): Promise<RenderResult> {
  // launchServer() (rather than launch()) is what exposes the browser's
  // real OS process (`.process().pid`) -- the plain `Browser` object
  // `chromium.launch()` returns has no such accessor. The memory-ceiling
  // poller needs that pid to sample this job's OWN process tree from
  // outside the browser entirely (never a JS-heap self-report).
  let server: Awaited<ReturnType<typeof chromium.launchServer>> | undefined;
  let timedOut = false;
  let memoryExceeded = false;
  let pollHandle: ReturnType<typeof setInterval> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    server = await chromium.launchServer({
      headless: true,
      proxy: { server: DEAD_PROXY_SERVER },
      args: [
        // Defense-in-depth alongside the dead proxy: force every hostname
        // lookup to resolve nowhere, in case anything ever bypasses the
        // configured proxy.
        '--host-resolver-rules=MAP * 0.0.0.0',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-default-apps',
        '--no-first-run',
      ],
    });

    const browserPid = server.process().pid;
    let baselineRssKb: number | null = browserPid === undefined ? null : aggregateProcessTreeRssKb(browserPid);

    pollHandle = setInterval(() => {
      if (browserPid === undefined) return;
      const rss = aggregateProcessTreeRssKb(browserPid);
      if (rss === null) return;
      if (baselineRssKb === null) {
        baselineRssKb = rss;
        return;
      }
      if (rss - baselineRssKb > MEMORY_GROWTH_CEILING_KB) {
        memoryExceeded = true;
        void server?.kill().catch(() => undefined);
      }
    }, MEMORY_POLL_INTERVAL_MS);

    const deadline = new Promise<never>((_resolve, reject) => {
      killTimer = setTimeout(() => {
        timedOut = true;
        reject(new RenderTimeoutError());
      }, PER_JOB_TIMEOUT_MS);
    });

    const renderWork = (async (): Promise<Buffer> => {
      const browser = await chromium.connect(server!.wsEndpoint());
      const context = await browser.newContext({
        viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
        proxy: { server: DEAD_PROXY_SERVER },
      });
      const page = await context.newPage();
      const fileUrl = pathToFileURL(entryFileAbsPath).href;
      await page.goto(fileUrl, { waitUntil: 'load', timeout: PER_JOB_TIMEOUT_MS });
      // Brief settle window for deferred/async layout. Best-effort only --
      // it races against `deadline` below so it can never itself blow the
      // per-job budget.
      await page.waitForTimeout(150).catch(() => undefined);
      return page.screenshot({ fullPage: true, type: 'png' });
    })();
    // Promise.race attaches a rejection handler to every racer up front, so
    // a losing promise that rejects later (e.g. after the browser is killed
    // out from under it) is always "handled" -- this can never surface as
    // an unhandled rejection even though its outer race already settled.
    renderWork.catch(() => undefined);

    let raw: Buffer;
    try {
      raw = await Promise.race([renderWork, deadline]);
    } catch (err) {
      if (memoryExceeded) throw new RenderMemoryLimitError();
      if (timedOut || err instanceof RenderTimeoutError) throw new RenderTimeoutError();
      throw err;
    }
    if (memoryExceeded) throw new RenderMemoryLimitError();

    const { data, info } = await sharp(raw)
      .resize(COVER_TARGET_WIDTH, COVER_TARGET_HEIGHT, { fit: 'cover', position: 'attention' })
      .png()
      .toBuffer({ resolveWithObject: true });

    return { imageBytes: data, width: info.width, height: info.height };
  } finally {
    if (killTimer) clearTimeout(killTimer);
    if (pollHandle) clearInterval(pollHandle);
    if (server) await server.kill().catch(() => undefined);
  }
}
