import { describe, expect, it } from 'vitest';
import {
  formatUsageCredits,
  formatUsageTotal,
  parseUsageProjectIdFromSearch,
} from '../../src/components/EntryShell';

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

  it('never renders a bare confident zero even when the API sends the real totalCostUsd:0 shape', () => {
    // C1-7: projectUsageSummary's totalCostUsd is always a real number now
    // (the honest sum of whatever IS priced, 0 when nothing is) -- this is
    // the shape the API actually sends for an unpriced project, not the
    // totalCostUsd:null placeholder the case above pins defensively.
    // pricingVersion is the sole "is this confident/complete" signal.
    const text = formatUsageTotal({ totalCostUsd: 0, pricingVersion: 'unavailable' });
    expect(text).toMatch(/unavailable/i);
    expect(text).not.toMatch(/\$\s?0(\.0{1,2})?(?!\d)/);
  });

  it('flags a partial total so a mixed project never looks confidently complete', () => {
    const text = formatUsageTotal({ totalCostUsd: 0.006, pricingVersion: 'partial' });
    expect(text).toMatch(/\$0\.006/);
    expect(text).toMatch(/partial/i);
  });
});

/**
 * C1-8 workspace aggregate (GET /api/usage): the Home topbar usage widget's
 * only real case, since no project is ever open there. Credits is
 * best-effort per registerUsageRoutes's GET /api/usage handler -- a wallet
 * read failure degrades to null rather than blocking the cost aggregate, so
 * this must render "unavailable" rather than a fake balance.
 */
describe('formatUsageCredits', () => {
  it('renders a real balance with a currency marker', () => {
    expect(
      formatUsageCredits({
        status: 'available',
        profile: 'default',
        user: null,
        balanceUsd: '12.50',
        updatedAt: null,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        stale: false,
        source: 'vela_api',
      }),
    ).toBe('$12.50');
  });

  it('renders "unavailable" when there is no credits snapshot', () => {
    expect(formatUsageCredits(null)).toMatch(/unavailable/i);
    expect(formatUsageCredits(undefined)).toMatch(/unavailable/i);
  });

  it('renders "unavailable" when the wallet has no balance figure', () => {
    expect(
      formatUsageCredits({
        status: 'unavailable',
        profile: 'default',
        user: null,
        balanceUsd: null,
        updatedAt: null,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        stale: false,
        source: 'unavailable',
        error: { code: 'network', message: 'timeout' },
      }),
    ).toMatch(/unavailable/i);
  });
});
