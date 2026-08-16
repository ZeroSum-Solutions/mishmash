import { defineConfig, devices } from '@playwright/test';

/**
 * Defaults to ONE worker locally, because a worker here is not what Playwright's
 * parallelism normally assumes. Each one owns a whole tools-dev runtime — its own
 * daemon, its own Next dev server, its own data root — so a second worker is a
 * second application, not a second browser context.
 *
 * Measured on a 16-core laptop, `app-manual-edit` + `app-restoration` at
 * `--grep @critical` (13 specs):
 *
 *   workers=1 → 13 passed in 3.7m   (slowest single spec 26.1s)
 *   workers=2 →  5 failed in 8.4m   (all five on 30s timeouts, not assertions)
 *
 * Two workers were 2.3x SLOWER in wall clock as well as red, so the parallelism
 * was costing time rather than saving it, and the "flaky" specs were reporting
 * that honestly. CI overrides this via OD_PLAYWRIGHT_WORKERS (see
 * .github/actions/configure-ci-parallelism), so raising it stays a deliberate,
 * per-runner choice rather than a local default nobody measured.
 */
function parseWorkerCount(value: string | undefined): number {
  if (value == null || value.length === 0) return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`OD_PLAYWRIGHT_WORKERS must be a positive integer, got: ${value}`);
  }
  return parsed;
}

export default defineConfig({
  testDir: './ui',
  // This is the functional config. Strict-visual specs (`visual-*.test.ts`)
  // are owned by `playwright.visual.config.ts` (its own `testMatch`,
  // snapshot/output settings, and the `playwright_visual` CI lane), so they
  // must never be picked up here — otherwise a bare `pnpm test:ui` or the
  // generic full-pool shard run would execute them without their visual
  // config. Excluding them at the config level keeps every functional
  // consumer (full pool, `test:ui*`, ui_p0 groups) aligned.
  testIgnore: 'visual-*.test.ts',
  globalSetup: './lib/artifact-retention.setup.ts',
  outputDir: './ui/reports/test-results',
  timeout: Number(process.env.OD_PLAYWRIGHT_TIMEOUT) || 45_000,
  retries: process.env.CI ? 1 : 0,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: process.env.OD_PLAYWRIGHT_FULLY_PARALLEL === '1',
  workers: parseWorkerCount(process.env.OD_PLAYWRIGHT_WORKERS),
  reporter: process.env.CI
    ? [
        ['github'],
        ['list'],
        ['html', { open: 'never', outputFolder: './ui/reports/playwright-html-report' }],
        ['json', { outputFile: './ui/reports/results.json' }],
        ['junit', { outputFile: './ui/reports/junit.xml' }],
      ]
    : [
        ['list'],
        ['html', { open: 'never', outputFolder: './ui/reports/playwright-html-report' }],
        ['json', { outputFile: './ui/reports/results.json' }],
        ['junit', { outputFile: './ui/reports/junit.xml' }],
      ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
