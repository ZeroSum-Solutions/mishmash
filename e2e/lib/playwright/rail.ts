import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';
import type { Page } from '@playwright/test';
import { T } from '@/timeouts';

/**
 * The entry nav rail is collapsed by default; its destinations
 * (`entry-nav-*`) only become interactable once the rail is expanded via the
 * topbar toggle. This helper is idempotent — when the rail is already docked
 * the toggle is hidden, so it no-ops. Call it before clicking any rail nav
 * item or asserting the rail/logo is visible.
 */
export async function ensureRailOpen(page: Page): Promise<void> {
  const entry = page.locator('.entry');
  // Wait for the shell before reading any state off it. `isVisible()` does not
  // retry, so it answers "false" for a toggle that has not rendered yet — the
  // same answer it gives when the rail is already docked and the toggle is
  // `display:none`. Reading the first as the second is how this helper skipped
  // the click and then failed its own assertion on the line after.
  await expect(entry).toBeVisible();

  // Retry the read-then-click as a unit, and decide on the class — which is the
  // state itself — rather than on the toggle's visibility, which is only a CSS
  // consequence of it. The rail restores `od.entry.railOpen` from localStorage
  // while React hydrates, so a single snapshot of the class can be taken before
  // that lands and send a click the wrong way. Re-reading converges; deciding
  // once would repeat, in a new place, the same non-retried read this helper
  // was fixed to remove.
  const toggle = page.getByTestId('entry-rail-toggle');
  await expect(async () => {
    const open = await entry.evaluate((element) => element.classList.contains('entry--rail-open'));
    if (!open) {
      await expect(toggle).toBeVisible({ timeout: T.short });
      await toggle.scrollIntoViewIfNeeded();
      await toggle.click({ timeout: T.short });
    }
    await expect(entry).toHaveClass(/entry--rail-open/, { timeout: T.short });
  }).toPass({ timeout: T.medium });

  await expect(page.locator('.entry-nav-rail')).not.toHaveAttribute('aria-hidden', 'true');
}

export async function openNewProjectModal(page: Page): Promise<void> {
  if (await page.getByTestId('new-project-panel').isVisible().catch(() => false)) return;
  await ensureRailOpen(page);
  const railCreateButton = page.getByTestId('entry-nav-new-project');
  if (await railCreateButton.isVisible().catch(() => false)) {
    const point = await getActionablePoint(railCreateButton);
    if (point) {
      await page.mouse.click(point.x, point.y);
      await expect(page.getByTestId('new-project-modal')).toBeVisible();
      await expect(page.getByTestId('new-project-panel')).toBeVisible();
      return;
    }
  }

  const projectsNav = page.getByTestId('entry-nav-projects');
  if (await projectsNav.isVisible().catch(() => false)) {
    await projectsNav.scrollIntoViewIfNeeded();
    await projectsNav.click();
  } else if (!/\/projects$/.test(new URL(page.url()).pathname)) {
    await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  }
  const projectsView = page.getByTestId('entry-view-projects');
  await expect(projectsView).toBeVisible();
  const createButton = projectsView
    .getByTestId('designs-new-project')
    .or(projectsView.getByTestId('designs-empty-new-project'))
    .first();
  await expect(createButton).toBeVisible();
  await createButton.click();
  await expect(page.getByTestId('new-project-modal')).toBeVisible();
  await expect(page.getByTestId('new-project-panel')).toBeVisible();
}

async function getActionablePoint(locator: Locator): Promise<{ x: number; y: number } | null> {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    if (
      point.x < 0 ||
      point.y < 0 ||
      point.x > window.innerWidth ||
      point.y > window.innerHeight
    ) {
      return null;
    }
    const hit = document.elementFromPoint(point.x, point.y);
    return hit && element.contains(hit) ? point : null;
  }).catch(() => null);
}
