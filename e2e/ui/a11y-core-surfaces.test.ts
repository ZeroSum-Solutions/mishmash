import { expectNoNewA11yViolations } from '@/playwright/a11y';
import { gotoEntryHome, openSettingsDialog } from '@/playwright/amr';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { test } from '@/playwright/suite';

test.describe.configure({ timeout: 45_000 });

/**
 * Rules known to fail on this surface today, asserted as an exact set: a new
 * rule fails the test, and a rule that starts passing fails it too, so the
 * list cannot quietly rot into a blanket suppression.
 *
 * Captured 2026-08-05 against `main`'s entry home. These are pre-existing —
 * this test is a ratchet against new debt, not a claim that the surface is
 * accessible. Shrink this list; do not grow it.
 *
 * - nested-interactive: the `.workspace-tab` `role="tab"` elements wrap
 *   focusable descendants.
 * - aria-required-children, aria-allowed-attr: related tablist/tab wiring.
 * - color-contrast: muted-on-subtle text below 4.5:1 (e.g. `.hint` at
 *   #8a8d92 on #f5f5f5 = 3.05:1). `settings-hover-contrast` already guards
 *   specific instances of this at the same AA threshold.
 */
const ENTRY_HOME_KNOWN = [
  'aria-allowed-attr',
  'aria-required-children',
  'color-contrast',
  'nested-interactive',
] as const;

/** See ENTRY_HOME_KNOWN for the policy. Contrast only, inside the modal. */
const SETTINGS_DIALOG_KNOWN = ['color-contrast'] as const;

test.beforeEach(async ({ page }) => {
  await applyStandardMocks(page);
});

test('[P1] entry home has no new accessibility violations', async ({ page }) => {
  await gotoEntryHome(page);

  await expectNoNewA11yViolations(page, { knownViolations: ENTRY_HOME_KNOWN });
});

test('[P1] settings dialog has no new accessibility violations', async ({ page }) => {
  await gotoEntryHome(page);
  await openSettingsDialog(page);

  // Scope to the dialog: a modal's own contract (labelling, focus containment,
  // contrast) is what opening it puts at risk, and a document-wide scan would
  // re-report the entry-home findings the test above already owns.
  await expectNoNewA11yViolations(page, {
    include: '[role="dialog"]',
    knownViolations: SETTINGS_DIALOG_KNOWN,
  });
});
