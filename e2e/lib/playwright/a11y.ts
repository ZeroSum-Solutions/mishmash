import { AxeBuilder } from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Derived from AxeBuilder rather than imported from `axe-core` directly:
 * `axe-core` is a transitive dependency of `@axe-core/playwright`, so under
 * pnpm's strict node_modules layout it is not resolvable from this package
 * and a direct import would fail `pnpm typecheck`.
 */
type AxeViolation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];

/**
 * WCAG 2.0/2.1 Level AA, deliberately excluding AAA and 2.2.
 *
 * AA matches the bar `ui/settings-hover-contrast.test.ts` already asserts
 * against, and its reasoning carries over: the codebase has historically
 * targeted AA, and a regression guard should not silently commit the team to
 * a level they have not chosen. WCAG 2.2 adds rules (notably `target-size`)
 * that would land as a wall of pre-existing failures rather than as signal —
 * opt into it per-scan with `extraTags` once someone owns the remediation.
 */
export const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] as const;

export type A11yScanOptions = {
  /** Restrict the scan to a subtree. Defaults to the whole document. */
  include?: string;
  /**
   * CSS selectors to exclude. Use for third-party content the product does
   * not own — not to hide a real violation in first-party markup.
   */
  exclude?: readonly string[];
  /** Extra axe tags to add on top of {@link WCAG_AA_TAGS}, e.g. 'wcag22aa'. */
  extraTags?: readonly string[];
  /**
   * Rule IDs that are known-failing on this surface and are NOT asserted.
   *
   * This is accepted technical debt, enumerated in the test that owns the
   * surface so it stays visible in review. A rule listed here that no longer
   * fires is reported as stale by {@link expectNoNewA11yViolations}, so the
   * list ratchets down instead of rotting.
   */
  knownViolations?: readonly string[];
};

/** Run axe against the current page state and return raw violations. */
export async function scanA11y(page: Page, options: A11yScanOptions = {}): Promise<AxeViolation[]> {
  let builder = new AxeBuilder({ page }).withTags([...WCAG_AA_TAGS, ...(options.extraTags ?? [])]);

  if (options.include != null) {
    builder = builder.include(options.include);
  }
  for (const selector of options.exclude ?? []) {
    builder = builder.exclude(selector);
  }

  const { violations } = await builder.analyze();
  return violations;
}

/**
 * Assert no accessibility violations beyond the surface's declared
 * `knownViolations`, and fail loudly if a known rule has been fixed.
 *
 * The failure message names the rule, its impact, the help URL, and the
 * offending selectors, so a CI-only failure is diagnosable without a local
 * repro — the same reason `sendPrompt` in `ui/real-daemon-run.test.ts` tracks
 * why it failed rather than letting a timeout speak for it.
 */
export async function expectNoNewA11yViolations(
  page: Page,
  options: A11yScanOptions = {},
): Promise<void> {
  const known = new Set(options.knownViolations ?? []);
  const violations = await scanA11y(page, options);

  const unexpected = violations.filter((violation) => !known.has(violation.id));
  expect(unexpected, formatViolations(unexpected)).toEqual([]);

  const stillFailing = new Set(violations.map((violation) => violation.id));
  const stale = [...known].filter((id) => !stillFailing.has(id));
  expect(
    stale,
    `These rules are listed in knownViolations but now pass. Remove them so the ` +
      `baseline keeps ratcheting down: ${stale.join(', ')}`,
  ).toEqual([]);
}

function formatViolations(violations: readonly AxeViolation[]): string {
  if (violations.length === 0) return 'No accessibility violations.';

  const lines = violations.map((violation) => {
    const targets = violation.nodes
      .slice(0, 5)
      .map((node) => `      - ${node.target.join(' ')}`)
      .join('\n');
    const overflow =
      violation.nodes.length > 5 ? `\n      ...and ${violation.nodes.length - 5} more` : '';
    return [
      `  [${violation.impact ?? 'unknown'}] ${violation.id}: ${violation.help}`,
      `    ${violation.helpUrl}`,
      `    ${violation.nodes.length} element(s):`,
      `${targets}${overflow}`,
    ].join('\n');
  });

  return `${violations.length} accessibility violation(s):\n${lines.join('\n\n')}`;
}
