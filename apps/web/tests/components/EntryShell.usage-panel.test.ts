import { describe, expect, it } from 'vitest';
import { formatUsageTotal, parseUsageProjectIdFromSearch } from '../../src/components/EntryShell';

/**
 * C1-8: the home topbar's Usage panel reads the project id to query from a
 * `?usageProject=<id>` query param (the gate's own `verify.path` spec
 * navigates to exactly this shape after substituting `{projectId}`), and
 * renders the project's total cost through the same GET
 * /api/projects/:id/usage contract the `od usage` CLI reads. These are the
 * two pure decision points, tested directly per VERIFICATION-CONTRACT.md's
 * "cheapest layer" guidance -- the panel's own render wiring is exercised by
 * the gate's real-browser check.
 */
describe('parseUsageProjectIdFromSearch', () => {
  it('reads the usageProject query param', () => {
    expect(parseUsageProjectIdFromSearch('?usageProject=abc123')).toBe('abc123');
  });

  it('returns null when the param is absent', () => {
    expect(parseUsageProjectIdFromSearch('')).toBeNull();
    expect(parseUsageProjectIdFromSearch('?other=1')).toBeNull();
  });

  it('decodes URL-encoded values', () => {
    expect(parseUsageProjectIdFromSearch('?usageProject=a%20b')).toBe('a b');
  });
});

describe('formatUsageTotal', () => {
  it('renders a real cost with a currency marker', () => {
    const text = formatUsageTotal({ totalCostUsd: 0.005994, pricingVersion: 'estimated' });
    expect(text).toMatch(/\$0\.0060|\$0\.0059/);
  });

  it('never renders a bare confident zero -- unpriced projects say "unavailable"', () => {
    const text = formatUsageTotal({ totalCostUsd: null, pricingVersion: 'unavailable' });
    expect(text).toMatch(/unavailable/i);
    expect(text).not.toMatch(/\$\s?0(\.0{1,2})?(?!\d)/);
  });

  it('flags a partial total so a mixed project never looks confidently complete', () => {
    const text = formatUsageTotal({ totalCostUsd: 0.006, pricingVersion: 'partial' });
    expect(text).toMatch(/\$0\.006/);
    expect(text).toMatch(/partial/i);
  });
});
