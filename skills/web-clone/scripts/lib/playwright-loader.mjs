import path from "node:path";
import { createRequire } from "node:module";

// Resolve Playwright from wherever it can actually be found:
//   1. relative to this script (covers a checkout that has its own dep);
//   2. relative to the process cwd (covers `npm i -D playwright` in the
//      project — the normal fix inside Open Design, where these scripts are
//      staged under `.od-skills/<plugin>/scripts/` but run from the project
//      root);
//   3. OD_PLAYWRIGHT_PATH — an explicit package-dir escape hatch.
export function loadPlaywright() {
  const requireFromScript = createRequire(import.meta.url);
  const requireFromCwd = createRequire(path.join(process.cwd(), "noop.js"));
  const attempts = [
    () => requireFromScript("playwright"),
    () => requireFromCwd("playwright"),
    () => {
      const p = process.env.OD_PLAYWRIGHT_PATH;
      if (!p) throw new Error("OD_PLAYWRIGHT_PATH unset");
      return requireFromScript(p);
    },
  ];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      // Try next candidate.
    }
  }
  throw new Error(
    "Playwright not found. Fix (run in the project root, once per project):\n" +
      "  npm install -D playwright\n" +
      "Then re-run this script. If launch later fails with a missing-browser " +
      "error AND no local Chrome exists, also run: npx playwright install chromium " +
      "(with a system Chrome installed the scripts fall back to channel:\"chrome\" " +
      "automatically — no download needed). OD_PLAYWRIGHT_PATH=<playwright package dir> " +
      "also works when a shared install exists.",
  );
}

// Args for a real, visible Chrome that doesn't announce itself as automated.
// `--disable-blink-features=AutomationControlled` plus masking
// `navigator.webdriver` (see `maskAutomationSignals` below) is the combination
// that cleared a live SiteGround bot-wall challenge that was 403/202-ing
// headless Chrome by fingerprint alone, not just by request shape.
const HEADFUL_STEALTH_ARGS = ["--disable-blink-features=AutomationControlled"];

/**
 * Launches Chromium. Pass `{ headful: true }` when a headless run hit a
 * bot-wall (see lib/bot-wall.mjs) -- it launches a real, visible Chrome
 * window instead of a headless one, which is what a fingerprint-based
 * challenge actually discriminates on. Every headful context should also call
 * `maskAutomationSignals` below.
 */
export async function launchChromium(chromium, { headful = false } = {}) {
  if (headful) {
    try {
      return await chromium.launch({ headless: false, channel: "chrome", args: HEADFUL_STEALTH_ARGS });
    } catch (firstError) {
      try {
        const browser = await chromium.launch({ headless: false, args: HEADFUL_STEALTH_ARGS });
        // --headful exists specifically to get real Chrome's fingerprint past
        // a bot wall; silently handing back bundled Chromium instead would
        // let a caller/operator believe that happened when it didn't. This
        // must be reported, not swallowed -- a different fingerprint may not
        // clear the same challenge.
        console.warn(
          `⚠️ --headful requested real Chrome (channel:"chrome") but it failed to launch ` +
            `(${firstError.message}); falling back to Playwright's bundled Chromium in headful ` +
            `mode instead. This has a different fingerprint than real Chrome and may not clear ` +
            `the same bot-wall challenge.`,
        );
        return browser;
      } catch {
        throw firstError;
      }
    }
  }
  try {
    return await chromium.launch({ headless: true });
  } catch (firstError) {
    try {
      return await chromium.launch({ headless: true, channel: "chrome" });
    } catch {
      throw firstError;
    }
  }
}

/**
 * Masks `navigator.webdriver` on every page a headful context creates. Real
 * Chrome sets this to `undefined`; Playwright-launched Chrome (headful or
 * not) sets it `true` unless masked, which is one of the signals a bot-wall
 * fingerprints on. Only meaningful paired with `launchChromium(chromium,
 * { headful: true })` -- a headless context has no fingerprint to salvage.
 */
export async function maskAutomationSignals(context) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
}
