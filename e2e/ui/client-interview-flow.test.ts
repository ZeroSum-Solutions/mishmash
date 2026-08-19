// F002 — client discovery interview. Drives the real interview UI
// (apps/web/src/components/interview/InterviewView.tsx) against a real
// booted daemon (apps/daemon/src/routes/interviews.ts,
// apps/daemon/src/interview/engine.ts): pick the quick tier, answer every
// question across its 5 turns of 1-2 questions each, reach a "complete"
// brief, and start a real project from it with zero re-typing (R6).
//
// PRD success criterion 1 (each tier runs natively end-to-end without
// leaving MishMash) is covered here for the real browser path; the
// scripted-turn conversation-harness assertions for all three tiers live in
// apps/daemon/tests/interview-routes.test.ts (cheaper, no browser needed).
import { expect, test } from '@/playwright/suite';
import { applyStandardMocks } from '@/playwright/mock-factory';
import { APP_LOADING_TEXT } from '@/playwright/loading';
import type { Page } from '@playwright/test';
import { T } from '@/timeouts';

test.beforeEach(async ({ page }) => {
  await applyStandardMocks(page);
});

// The quick tier's question order (packages/contracts/src/api/interviews.ts
// `questionsForTier`), one entry per question, answered in order regardless
// of how QuestionFormView paginates them across turns.
const QUICK_TIER_ANSWERS = [
  'Tampa, FL', // hqLocation
  'Tampa, Clearwater, St. Petersburg', // serviceArea
  'none', // certifications — the source's own confirmed-none rule
  'Structured cabling, fiber splicing', // services
  'Commercial property managers', // idealCustomer
  'light background', // backgroundPreference
  'clean and professional', // threeWordsFeel
  '(813) 555-0100', // phone
  'owner@example.com', // email
  'Call for an estimate', // primaryCta
];

test('[P2] client discovery interview runs the quick tier end-to-end and starts a project with zero re-typing', async ({ page }) => {
  await gotoInterview(page);

  await expect(page.getByTestId('interview-tier-quick')).toBeVisible();
  await page.getByTestId('interview-tier-quick').click();
  await expect(page.getByTestId('interview-turn')).toBeVisible();

  for (const answer of QUICK_TIER_ANSWERS) {
    await answerCurrentQuestion(page, answer);
  }

  await expect(page.getByTestId('interview-terminal')).toBeVisible({ timeout: T.long });
  await expect(page.getByTestId('interview-status')).toContainText('All required information collected');
  // Zero re-typing check starts here: nothing on this screen re-asks for the
  // service/customer/visual-direction answers already given.
  await expect(page.getByTestId('interview-force-incomplete')).toHaveCount(0);

  await page.getByTestId('interview-project-name').fill('Interview e2e project');
  const startBtn = page.getByTestId('interview-start-project');
  await expect(startBtn).toBeEnabled();
  await startBtn.click();

  await expect(page).toHaveURL(/\/projects\//, { timeout: T.long });
  await expect(page.getByTestId('chat-composer')).toBeVisible({ timeout: T.long });
});

test('[P2] pushes back on a vague REQUIRED answer without leaving the interview', async ({ page }) => {
  await gotoInterview(page);
  await page.getByTestId('interview-tier-quick').click();
  await expect(page.getByTestId('interview-turn')).toBeVisible();

  // The quick tier's first turn is [hqLocation, serviceArea], both REQUIRED.
  // A turn only reaches the daemon once BOTH of its questions are filled
  // (QuestionFormView paginates a 2-question turn locally; onSubmit fires
  // once, on the second question's "Send answers").
  await currentAnswerInput(page).fill('n/a'); // hqLocation — vague
  await clickSubmitLike(page);
  await currentAnswerInput(page).fill('Tampa, Clearwater'); // serviceArea — fine
  await clickSubmitLike(page);

  await expect(page.getByTestId('interview-pushback')).toBeVisible({ timeout: T.medium });
  // Still mid-interview — the vague REQUIRED answer did not silently pass.
  await expect(page.getByTestId('interview-terminal')).toHaveCount(0);

  // Correcting the REQUIRED field and resubmitting the same turn clears the
  // push-back and advances normally (Back returns to the rejected question;
  // serviceArea's earlier answer is retained by the still-mounted form).
  // Scoped to the turn container: the page ALSO has a top-level "Back to
  // home" nav button with the same accessible name once localized generically.
  await page.getByTestId('interview-turn').getByRole('button', { name: 'Back' }).click();
  await currentAnswerInput(page).fill('Tampa, FL');
  await clickSubmitLike(page);
  await clickSubmitLike(page); // serviceArea's retained answer, straight to "Send answers"

  await expect(page.getByTestId('interview-pushback')).toHaveCount(0);
});

async function gotoInterview(page: Page) {
  await page.goto('/interview', { waitUntil: 'domcontentloaded' });
  await page.getByText(APP_LOADING_TEXT).first().waitFor({ state: 'hidden', timeout: T.long }).catch(() => {});
  const privacyDialog = page.getByRole('dialog').filter({ hasText: 'Help us improve MishMash' });
  if (await privacyDialog.isVisible().catch(() => false)) {
    await privacyDialog.getByRole('button', { name: /I get it|not now|got it|don't share/i }).click();
    await expect(privacyDialog).toHaveCount(0);
  }
  await expect(page.getByTestId('interview-view')).toBeVisible();
}

/** The active question's input/textarea. Scoped to non-disabled elements:
 * right after a submit, QuestionFormView briefly re-renders its just-
 * submitted questions in a locked (disabled) read-only state before the
 * next turn's fresh, enabled field replaces it — matching on `:not([disabled])`
 * lets Playwright's auto-waiting ride out that transition instead of hitting
 * a strict-mode "resolved to 2 elements" violation against the stale one. */
function currentAnswerInput(page: Page) {
  return page
    .getByTestId('interview-turn')
    .locator('input:not([disabled]), textarea:not([disabled])')
    .first();
}

/** Fills the currently visible question's textbox and answers it, driving
 * the shared "Next step" (mid-turn) / "Send answers" (end of turn) button —
 * QuestionFormView shows exactly one question at a time whenever a turn
 * carries more than one. */
async function answerCurrentQuestion(page: Page, value: string) {
  await currentAnswerInput(page).fill(value);
  await clickSubmitLike(page);
}

async function clickSubmitLike(page: Page) {
  const nextStep = page.getByTestId('interview-turn').getByRole('button', { name: 'Next step' });
  if (await nextStep.isVisible().catch(() => false)) {
    await nextStep.click();
    return;
  }
  await page.getByTestId('interview-turn').getByRole('button', { name: 'Send answers' }).click();
}
