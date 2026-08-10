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
// Crop (S4-3): see crop.ts -- a sharp-backed hero/salient window selection
// over the full-page screenshot.

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { cropToHeroWindow } from './crop.js';
import { createLimiter } from './limiter.js';
import { RenderMemoryLimitError, RenderTimeoutError } from './errors.js';
import { aggregateProcessTreeRssKb } from './process-rss.js';
import { startLocalProjectFileServer } from './local-file-server.js';
import { registerRenderPid, unregisterRenderPid } from './render-pid-registry.js';

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

/** Growth ABOVE this job's own baseline kills the job with a typed
 * RENDER_MEMORY_LIMIT. The baseline is sampled right after launchServer(),
 * BEFORE the renderer/GPU processes spawn, so their fixed startup cost plus
 * rasterization transients count as "growth": a trivial 52KB page measures
 * ~430MB peak growth on macOS arm64. The ceiling must sit above that
 * legitimate transient while still catching unbounded allocators (the C4-5
 * memory-hog proof blows past 1GB within a couple of seconds). */
const MEMORY_GROWTH_CEILING_KB = 1024 * 1024; // 1 GB

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 960;

export const COVER_TARGET_WIDTH = 1280;
export const COVER_TARGET_HEIGHT = 800;

// A loopback port nothing listens on. Every HTTP(S)/WS request Chromium's
// network stack issues is routed through this dead proxy and fails closed
// immediately -- true process-level denial, not a per-route JS interception
// that a WebSocket or beacon request could slip past. The project's own
// files are served from a project-scoped loopback server (see
// local-file-server.ts) rather than `file://`; PROXY_BYPASS exempts that
// server's own origin from the dead proxy without opening up anything else.
const DEAD_PROXY_SERVER = 'http://127.0.0.1:1';
const PROXY_BYPASS = '127.0.0.1';

export interface RenderResult {
  imageBytes: Buffer;
  width: number;
  height: number;
}

const limiter = createLimiter<RenderResult>(RENDER_CONCURRENCY);

/** Renders `entryRelPath` (a trusted, on-disk project HTML file, relative
 * to `projectRootAbs`) into a cropped COVER_TARGET_WIDTH x
 * COVER_TARGET_HEIGHT PNG. Bounded by the module-level concurrency cap;
 * call sites do not need their own queueing. `runtimeDataDir` scopes the
 * orphan-reaper PID registry (render-pid-registry.ts, security-review
 * finding 6) -- never a rendering data path itself. */
export async function renderCoverImage(
  runtimeDataDir: string,
  projectRootAbs: string,
  entryRelPath: string,
): Promise<RenderResult> {
  return limiter(() => renderOnce(runtimeDataDir, projectRootAbs, entryRelPath));
}

async function renderOnce(runtimeDataDir: string, projectRootAbs: string, entryRelPath: string): Promise<RenderResult> {
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
  let fileServer: Awaited<ReturnType<typeof startLocalProjectFileServer>> | undefined;
  let pollInFlight = false;
  let registeredPid: number | undefined;

  try {
    // realpath, not just path.resolve: a symlink planted inside the
    // project dir must not be able to widen what the render is allowed to
    // read (security-review finding 1).
    const projectRootReal = await fs.realpath(projectRootAbs);
    fileServer = await startLocalProjectFileServer(projectRootReal);
    const entryUrl = `${fileServer.origin}/${entryRelPath.split(path.sep).map(encodeURIComponent).join('/')}`;

    server = await chromium.launchServer({
      headless: true,
      proxy: { server: DEAD_PROXY_SERVER, bypass: PROXY_BYPASS },
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
    // Orphan reaper registration (security-review finding 6): if THIS
    // daemon process is SIGKILL'd between here and the `finally` below
    // (which unregisters + kills normally), the marker written now is what
    // lets the NEXT daemon startup's sweepOrphanedRenderProcesses find and
    // kill the resulting orphaned Chromium tree.
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

    const renderWork = (async (): Promise<Buffer> => {
      const browser = await chromium.connect(server!.wsEndpoint());
      const context = await browser.newContext({
        viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
        proxy: { server: DEAD_PROXY_SERVER, bypass: PROXY_BYPASS },
      });
      // Defense in depth beyond the dead proxy + host-resolver-rules
      // (security-review finding 1): those two govern only the network
      // stack and do nothing about `file://` or a same-tab self-navigation
      // during the settle window below. This interceptor is scheme- and
      // origin-agnostic -- it allow-lists ONLY requests (including
      // top-frame navigations) that already resolve to this job's own
      // project-scoped loopback origin, and aborts everything else,
      // `file://` included.
      const entryOrigin = fileServer!.origin;
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(`${entryOrigin}/`) || url === entryOrigin) {
          void route.continue();
        } else {
          void route.abort('blockedbyclient');
        }
      });
      const page = await context.newPage();
      await page.goto(entryUrl, { waitUntil: 'load', timeout: PER_JOB_TIMEOUT_MS });
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

    const cropped = await cropToHeroWindow(raw, COVER_TARGET_WIDTH, COVER_TARGET_HEIGHT);
    return { imageBytes: cropped.data, width: cropped.width, height: cropped.height };
  } finally {
    if (killTimer) clearTimeout(killTimer);
    if (pollHandle) clearInterval(pollHandle);
    if (server) await server.kill().catch(() => undefined);
    if (fileServer) await fileServer.close().catch(() => undefined);
    if (registeredPid !== undefined) await unregisterRenderPid(runtimeDataDir, registeredPid);
  }
}
