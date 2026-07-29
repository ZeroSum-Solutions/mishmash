import { describe, expect, it } from 'vitest';
import {
  buildModelRouting,
  computeModelRoutingDisplayState,
  normalizeModelForRouting,
} from '../src/api/model-routing';

// Shared "routing truth" vocabulary (W1 / NM-13a). One authoritative model
// badge is not achievable -- some lanes (Codex, Antigravity) cannot always
// echo what ran -- so the goal is truthful uncertainty: `requested` (what the
// user picked), `resolved` (what the daemon chose after fallback), `reported`
// (what the CLI echoed, if it did), and a derived `displayState`.

describe('normalizeModelForRouting', () => {
  it('returns the trimmed value when present', () => {
    expect(normalizeModelForRouting('claude-sonnet-4-5')).toBe('claude-sonnet-4-5');
    expect(normalizeModelForRouting('  gpt-5.5  ')).toBe('gpt-5.5');
  });

  it('falls back to the "default" sentinel for null/undefined/empty/whitespace', () => {
    expect(normalizeModelForRouting(null)).toBe('default');
    expect(normalizeModelForRouting(undefined)).toBe('default');
    expect(normalizeModelForRouting('')).toBe('default');
    expect(normalizeModelForRouting('   ')).toBe('default');
  });
});

describe('computeModelRoutingDisplayState', () => {
  it('is "substituted" whenever resolved differs from requested, regardless of the echo', () => {
    expect(
      computeModelRoutingDisplayState('gpt-5.6-codex-legacy', 'gpt-5.6-codex-current', null),
    ).toBe('substituted');
    expect(
      computeModelRoutingDisplayState(
        'gpt-5.6-codex-legacy',
        'gpt-5.6-codex-current',
        'gpt-5.6-codex-current',
      ),
    ).toBe('substituted');
  });

  it('is "verified" when resolved matches requested and the CLI echoed the same model', () => {
    expect(
      computeModelRoutingDisplayState('claude-sonnet-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4-5'),
    ).toBe('verified');
  });

  it('is "unverified" when resolved matches requested but no echo is available', () => {
    expect(
      computeModelRoutingDisplayState('claude-sonnet-4-5', 'claude-sonnet-4-5', null),
    ).toBe('unverified');
  });

  it('is "unverified" (not "verified") when an echo disagrees with a resolved value that matched the request', () => {
    // An echo that does not match resolved is not proof of anything better
    // than "we don't know" -- it must never fall back to 'verified'.
    expect(
      computeModelRoutingDisplayState('claude-sonnet-4-5', 'claude-sonnet-4-5', 'some-other-model'),
    ).toBe('unverified');
  });
});

describe('buildModelRouting', () => {
  it('keeps resolved as-is when the daemon picked a concrete model, even once an echo arrives', () => {
    const routing = buildModelRouting({
      requestedRaw: 'claude-sonnet-4-5',
      resolvedRaw: 'claude-sonnet-4-5',
      reportedRaw: 'claude-sonnet-4-5',
    });
    expect(routing).toEqual({
      requested: 'claude-sonnet-4-5',
      resolved: 'claude-sonnet-4-5',
      reported: 'claude-sonnet-4-5',
      displayState: 'verified',
    });
  });

  it('backfills resolved from the echo when the daemon deferred to the CLI default (resolvedRaw null)', () => {
    // This is the "invalid custom model id" shape: sanitizeCustomModel nulls
    // the request out, resolveModelForAgent leaves it null for a def that
    // lists its own 'default' fallback, and the spawned CLI silently used
    // its own internal default -- the only ground truth for "resolved" is
    // whatever the CLI echoes back.
    const routing = buildModelRouting({
      requestedRaw: 'not a valid model id',
      resolvedRaw: null,
      reportedRaw: 'claude-opus-4-8-fake-default',
    });
    expect(routing.resolved).toBe('claude-opus-4-8-fake-default');
    expect(routing.reported).toBe('claude-opus-4-8-fake-default');
    expect(routing.requested).toBe('not a valid model id');
    expect(routing.displayState).toBe('substituted');
  });

  it('falls back resolved to the default sentinel when neither the daemon nor an echo names a model', () => {
    const routing = buildModelRouting({ requestedRaw: null, resolvedRaw: null, reportedRaw: null });
    expect(routing.requested).toBe('default');
    expect(routing.resolved).toBe('default');
    expect(routing.reported).toBeNull();
    expect(routing.displayState).toBe('unverified');
  });

  it('never returns a null/empty requested or resolved -- every successful run must have both populated', () => {
    const routing = buildModelRouting({
      requestedRaw: undefined,
      resolvedRaw: undefined,
      reportedRaw: undefined,
    });
    expect(typeof routing.requested).toBe('string');
    expect(typeof routing.resolved).toBe('string');
    expect(routing.requested.length).toBeGreaterThan(0);
    expect(routing.resolved.length).toBeGreaterThan(0);
  });
});
