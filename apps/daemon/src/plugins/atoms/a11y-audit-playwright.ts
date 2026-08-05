// Production analyzer for the a11y-audit atom: axe-core driven through the
// Playwright chromium the daemon already ships for export/screenshot work.
//
// Kept in its own module so `a11y-audit.ts` stays free of browser and
// filesystem-URL concerns and can be unit-tested by injecting `analyzeFn`.
//
// axe-core is loaded through `createRequire` rather than a static import:
// the package is a UMD bundle whose useful export here is `axe.source`, a
// ~1.3 MB string of the whole library that gets injected into the page under
// audit. Importing it as ESM would pull that string into the daemon's module
// graph on every boot even when no audit ever runs.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { Browser } from 'playwright';
import type { A11yAnalyzeFn, AxeRunResult } from './a11y-audit.js';

const require = createRequire(import.meta.url);

/**
 * WCAG 2.1 AA — the conformance target `craft/accessibility-baseline.md`
 * describes in prose. Narrower than axe's default rule set on purpose:
 * best-practice rules are advisory and must not gate a devloop.
 */
export const DEFAULT_AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

export interface PlaywrightAxeAnalyzerOptions {
  /**
   * Reuse an already-launched browser. When omitted the analyzer launches a
   * headless chromium per audit and closes it again — correct but slow, so
   * callers auditing many artifacts should pass one in.
   */
  browser?: Browser;
  /** Rule tags to run. Defaults to `DEFAULT_AXE_TAGS`. */
  tags?: readonly string[];
  /** Viewport for the audit. Layout-dependent rules (contrast) need one. */
  viewport?: { width: number; height: number };
  /**
   * Injection seam for the browser launch, mirroring `build-test`'s
   * `spawnFn`. Exists so the abort/teardown path — the one that leaks a real
   * Chromium if it regresses — can be asserted deterministically instead of
   * by inspecting the host process table.
   */
  launchBrowser?: () => Promise<Browser>;
}

const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

function targetToUrl(target: string): string {
  return /^(?:https?|file):\/\//iu.test(target) ? target : pathToFileURL(target).href;
}

/**
 * Build an `A11yAnalyzeFn` bound to Playwright.
 *
 * The returned function always closes the resources it created: a page it
 * opened, and the browser only when it launched that browser itself. A
 * caller-supplied browser outlives the call.
 */
export function playwrightAxeAnalyzer(
  options: PlaywrightAxeAnalyzerOptions = {},
): A11yAnalyzeFn {
  const tags = options.tags ?? DEFAULT_AXE_TAGS;
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;

  return async (target, { timeoutMs, signal }) => {
    const axeSource: string = require('axe-core').source;

    const ownsBrowser = options.browser === undefined;
    // Resources are tracked in mutable locals and torn down from one place,
    // so the abort listener and the `finally` path close exactly the same
    // set no matter which of them fires first.
    let browser = options.browser;
    let context: Awaited<ReturnType<NonNullable<typeof browser>['newContext']>> | undefined;
    let torn = false;

    const teardown = async () => {
      if (torn) return;
      torn = true;
      await context?.close().catch(() => { /* best-effort teardown */ });
      if (ownsBrowser) {
        await browser?.close().catch(() => { /* best-effort teardown */ });
      }
    };

    // Abort must both tear down AND settle this promise. Tearing down alone
    // would leave the caller holding a promise that never resolves, because
    // the Playwright call it is suspended in has already been orphaned — the
    // hang would simply move from the browser to the promise.
    let onAbort: (() => void) | undefined;
    const abortedPromise = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        void teardown();
        reject(new Error('a11y audit aborted'));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
    // Nothing awaits this rejection on the success path; claiming it keeps
    // Node from reporting an unhandled rejection when the audit wins the race.
    abortedPromise.catch(() => {});

    const runAudit = async () => {
      if (signal.aborted) throw new Error('a11y audit aborted before launch');
      if (browser === undefined) {
        const launch =
          options.launchBrowser ??
          (async () => (await import('playwright')).chromium.launch({ headless: true }));
        browser = await launch();
        // Losing the race with an abort during launch would otherwise leak
        // the browser that finished launching after teardown already ran.
        if (signal.aborted) {
          await browser.close().catch(() => {});
          throw new Error('a11y audit aborted during browser launch');
        }
      }

      context = await browser.newContext({ viewport });
      const page = await context.newPage();

      // The audited artifact is untrusted markup executing inside a browser
      // owned by the privileged daemon. Confining the *target* says nothing
      // about what the page then requests, so a generated artifact could
      // reach a loopback admin endpoint or exfiltrate to a remote host just
      // by carrying an <img src>. Only local schemes are allowed through.
      await page.route('**/*', (route) => {
        const url = route.request().url();
        const local = url.startsWith('file:') || url.startsWith('data:') || url.startsWith('blob:')
          || url.startsWith('about:');
        return local ? route.continue() : route.abort();
      });
      // Bound every in-page operation, not just navigation: a page that loads
      // quickly can still hang inside `axe.run` on a pathological DOM.
      page.setDefaultTimeout(timeoutMs);

      await page.goto(targetToUrl(target), {
        waitUntil: 'load',
        // Leave headroom inside the caller's budget so a slow-but-successful
        // load is not raced by the outer timer and reported as unmeasured.
        timeout: Math.max(1_000, Math.floor(timeoutMs * 0.6)),
      });
      await page.addScriptTag({ content: axeSource });

      // Project the result down inside the page: axe attaches every check's
      // `any`/`all`/`none` evidence to each node, which serializes into
      // megabytes we never persist.
      // `document` is reached through `globalThis` rather than named
      // directly: this callback is serialized into the page, but it is
      // type-checked in the daemon's Node-only tsconfig, which has no DOM lib.
      const result = (await page.evaluate(async (runTags: string[]) => {
        const { axe, document } = globalThis as unknown as {
          document: unknown;
          axe: {
            run: (ctx: unknown, opts: unknown) => Promise<{
              incomplete?: Array<{
                id: string;
                impact: string | null;
                help: string;
                helpUrl: string;
                nodes: Array<{ target: unknown[]; html: string; failureSummary?: string }>;
              }>;
              violations: Array<{
                id: string;
                impact: string | null;
                help: string;
                helpUrl: string;
                nodes: Array<{ target: unknown[]; html: string; failureSummary?: string }>;
              }>;
              testEngine?: { name: string; version: string };
            }>;
          };
        };

        const raw = await axe.run(document, { runOnly: { type: 'tag', values: runTags } });
        const project = (list: typeof raw.violations) => list.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.map((n) => ({
            target: n.target.map((t) => String(t)),
            html: n.html,
            failureSummary: n.failureSummary,
          })),
        }));
        return {
          incomplete: project(raw.incomplete ?? []),
          violations: raw.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            helpUrl: v.helpUrl,
            nodes: v.nodes.map((n) => ({
              target: n.target.map((t) => String(t)),
              html: n.html,
              failureSummary: n.failureSummary,
            })),
          })),
          testEngine: raw.testEngine,
        };
      }, [...tags])) as AxeRunResult;

      return result;
    };

    try {
      // Whichever settles first wins; `finally` closes the resources either
      // way, and the abort branch has already started its own teardown.
      return await Promise.race([runAudit(), abortedPromise]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
      await teardown();
    }
  };
}
