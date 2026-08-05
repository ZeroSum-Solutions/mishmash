// End-to-end proof that the a11y-audit atom detects real accessibility
// defects, not just that its arithmetic is right.
//
// `plugins-a11y-audit.test.ts` covers signal derivation with an injected
// analyzer. This suite drives the production path — real chromium, real
// axe-core, real DOM — because the gate is only worth anything if the
// analyzer actually fires on a broken page.
//
// One browser is launched for the whole file and shared across cases; a
// launch per assertion would dominate the runtime.

import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Browser } from 'playwright';
import { chromium } from 'playwright';
import { runA11yAudit } from '../src/plugins/atoms/a11y-audit.js';
import { playwrightAxeAnalyzer } from '../src/plugins/atoms/a11y-audit-playwright.js';

const BROWSER_TIMEOUT = 120_000;

let browser: Browser;
let tmp: string;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, BROWSER_TIMEOUT);

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'od-a11y-e2e-'));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function artifact(name: string, html: string): Promise<string> {
  await writeFile(path.join(tmp, name), html, 'utf8');
  return name;
}

/** Fails image-alt (critical) and html-has-lang (serious). */
const BROKEN_PAGE = `<!doctype html>
<html>
  <head><title>Broken</title></head>
  <body>
    <main>
      <h1>Report</h1>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
      <p style="color:#bbbbbb;background:#ffffff">Low contrast body copy.</p>
    </main>
  </body>
</html>`;

/** Same content, accessible. */
const CLEAN_PAGE = `<!doctype html>
<html lang="en">
  <head><title>Clean</title></head>
  <body>
    <main>
      <h1>Report</h1>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Quarterly revenue chart">
      <p style="color:#1a1a1a;background:#ffffff">Readable body copy.</p>
    </main>
  </body>
</html>`;

describe('a11y-audit browser lifecycle', () => {
  it('closes a browser it launched when the audit is aborted', async () => {
    // The runner abandons the analyzer promise when it times out, so if this
    // teardown regresses, every hung audit leaks a headless Chromium for the
    // life of the daemon. Asserted through the launch seam rather than the
    // host process table so the result does not depend on what else is running.
    const target = await artifact('clean.html', CLEAN_PAGE);
    let closed = 0;
    const fakeBrowser = {
      newContext: async () => {
        // Hang here so the abort lands mid-audit, which is the real shape of
        // the leak: launch succeeded, work never finished.
        await new Promise(() => {});
        throw new Error('unreachable');
      },
      close: async () => { closed += 1; },
    } as unknown as Browser;

    const controller = new AbortController();
    const analyze = playwrightAxeAnalyzer({ launchBrowser: async () => fakeBrowser });
    const pending = analyze(path.join(tmp, target), {
      timeoutMs: 30_000,
      signal: controller.signal,
    });

    // Let the analyzer reach newContext before aborting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await pending.catch(() => { /* expected */ });

    expect(closed).toBe(1);
  });

  it('does not close a caller-supplied browser', async () => {
    // A shared browser outlives the call; closing it would break every
    // subsequent audit in a batch.
    const target = await artifact('clean.html', CLEAN_PAGE);
    let closed = 0;
    const shared = {
      ...browser,
      newContext: browser.newContext.bind(browser),
      close: async () => { closed += 1; },
    } as unknown as Browser;

    await playwrightAxeAnalyzer({ browser: shared })(path.join(tmp, target), {
      timeoutMs: 30_000,
      signal: new AbortController().signal,
    });

    expect(closed).toBe(0);
  });
});

/** Renders nothing at load; injects an inaccessible image ~250ms later. */
const DEFERRED_PAGE = `<!doctype html>
<html lang="en">
  <head><title>Deferred</title></head>
  <body>
    <main id="root"></main>
    <script>
      setTimeout(function () {
        var img = document.createElement('img');
        img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
        document.getElementById('root').appendChild(img);
      }, 250);
    </script>
  </body>
</html>`;

describe('a11y-audit waits for the page to render', () => {
  it(
    'catches a violation introduced after the load event',
    async () => {
      // Auditing at `load` measures whatever the server sent, which for a
      // client-rendered artifact is an empty shell. axe then finds nothing
      // and reports a pass for a page it never actually saw — the same
      // "unmeasured counted as passing" failure this atom exists to prevent,
      // just relocated from the runner into the browser.
      const target = await artifact('deferred.html', DEFERRED_PAGE);
      const report = await runA11yAudit({
        cwd: tmp,
        target,
        analyzeFn: playwrightAxeAnalyzer({ browser }),
      });

      expect(report.violations.map((v) => v.id)).toContain('image-alt');
      expect(report.signals['a11y.passing']).toBe(false);
    },
    BROWSER_TIMEOUT,
  );
});

describe('a11y-audit against real chromium + axe-core', () => {
  it(
    'fails the gate on a page with genuine WCAG violations',
    async () => {
      const target = await artifact('broken.html', BROKEN_PAGE);
      const report = await runA11yAudit({
        cwd: tmp,
        target,
        analyzeFn: playwrightAxeAnalyzer({ browser }),
      });

      expect(report.status).toBe('failing');
      expect(report.signals['a11y.passing']).toBe(false);
      expect(report.blockingCount).toBeGreaterThan(0);
      expect(report.signals['critique.score']).toBe(1);

      const ids = report.violations.map((v) => v.id);
      expect(ids).toContain('image-alt');
      expect(ids).toContain('html-has-lang');

      // Provenance: the report must name the engine that produced it.
      expect(report.engine?.name).toBe('axe-core');
    },
    BROWSER_TIMEOUT,
  );

  it(
    'passes the gate on an accessible page',
    async () => {
      const target = await artifact('clean.html', CLEAN_PAGE);
      const report = await runA11yAudit({
        cwd: tmp,
        target,
        analyzeFn: playwrightAxeAnalyzer({ browser }),
      });

      expect(report.violations.map((v) => v.id)).toEqual([]);
      expect(report.status).toBe('passing');
      expect(report.signals['a11y.passing']).toBe(true);
      expect(report.signals['a11y.violations']).toBe(0);
    },
    BROWSER_TIMEOUT,
  );

  it(
    'detects the contrast failure craft/accessibility-baseline.md describes',
    async () => {
      // Contrast is the rule the repo's own baseline doc leads with, and the
      // one an LLM self-critique is least able to judge. #999 on #fff is
      // ~2.8:1 — comfortably under the 4.5:1 AA floor for body text.
      const target = await artifact(
        'contrast.html',
        `<!doctype html><html lang="en"><head><title>C</title></head>
         <body><main><p style="color:#999999;background:#ffffff;font-size:16px">
         Body copy that fails AA.</p></main></body></html>`,
      );
      const report = await runA11yAudit({
        cwd: tmp,
        target,
        analyzeFn: playwrightAxeAnalyzer({ browser }),
      });

      expect(report.violations.map((v) => v.id)).toContain('color-contrast');
      expect(report.signals['a11y.passing']).toBe(false);
    },
    BROWSER_TIMEOUT,
  );
});
