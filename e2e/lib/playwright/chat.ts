import type { Locator, Page } from '@playwright/test';

/** Where the failure-card watcher below records its sightings, in the page. */
const CARD_SIGHTINGS_KEY = 'od-e2e-failure-card-sightings';

/** Part of the neutral notice a pane shows while a stream failure carries no
 *  run verdict, in the shipped English copy (`chat.runChecking.message`). */
export const CHECKING_NOTICE_TEXT = 'Checking its result';

/** The alert a pane paints for a run failure ("Task failed"). */
export function runErrorCard(scope: Page | Locator): Locator {
  return scope.locator('[data-user-action-card="run-recovery"]').last();
}

/** The neutral notice a pane shows while a stream failure carries no verdict. */
export function runCheckingNotice(scope: Page | Locator): Locator {
  return scope.locator('[data-user-action-card="run-checking"]').last();
}

/**
 * Record EVERY appearance of the failure card in this document, from the moment
 * the watcher starts until its sightings are read.
 *
 * A single `toHaveCount(0)` at the end of a run cannot see a card that was
 * painted and then retracted, which is exactly the shape the retraction tracks
 * shipped and the checking-state tracks forbid. The watcher lives in the page —
 * a MutationObserver plus a 50 ms sweep — so it observes the DOM continuously
 * rather than whenever the test process happens to look.
 *
 * Top-level documents only: `addInitScript` also runs in the artifact preview
 * iframe, which shares this origin and would otherwise keep its own tally that
 * nothing reads.
 */
function startRunFailureCardWatcher(key: string): void {
  if (window.top !== window.self) return;
  const scope = window as unknown as Record<string, unknown>;
  if (scope[key]) return;
  const sightings: string[] = [];
  scope[key] = sightings;
  const scan = () => {
    document.querySelectorAll('[data-user-action-card="run-recovery"]').forEach((node) => {
      sightings.push((node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160));
    });
  };
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  window.setInterval(scan, 50);
}

/**
 * Start the watcher in the CURRENT document. A document load drops it, so
 * install it after the last navigation.
 */
export async function watchRunFailureCard(page: Page): Promise<void> {
  await page.evaluate(startRunFailureCardWatcher, CARD_SIGHTINGS_KEY);
}

/**
 * Start the watcher in every document this page loads from now on, before any
 * of that document's own script runs.
 *
 * This is the form a reload-driven case needs: the card it must never see is
 * painted by the reloaded document itself, within a beat of the reattached
 * stream failing, so a watcher installed after the reload settles can arrive
 * too late to have seen it.
 */
export async function armRunFailureCardWatcher(page: Page): Promise<void> {
  await page.addInitScript(startRunFailureCardWatcher, CARD_SIGHTINGS_KEY);
}

/** The distinct failure-card texts the watcher has seen, at most five of them. */
export async function runFailureCardSightings(page: Page): Promise<string[]> {
  return page.evaluate((key) => {
    const seen = (window as unknown as Record<string, string[] | undefined>)[key] ?? [];
    return [...new Set(seen)].slice(0, 5);
  }, CARD_SIGHTINGS_KEY);
}
