import { describe, expect, it } from 'vitest';
import { shouldSubmitNewsletterEmail } from '../../src/components/EntryShell';

/**
 * C2-1a: NEWSLETTER_SUBSCRIBE_URL used to default to the upstream Open
 * Design marketing site (`open-design.ai/subscribe`) whenever
 * NEXT_PUBLIC_NEWSLETTER_URL was unset -- silently POSTing a MishMash
 * user's email to a third party unrelated to this product. MishMash has no
 * newsletter endpoint of its own configured by default, so the fix is to
 * skip the submission entirely when no MishMash-owned URL is configured,
 * rather than fall back anywhere. This pins the guard's decision logic
 * directly (the actual fetch call lives in a closure deep inside the
 * EntryShell component and is exercised by the gate's own static check on
 * the source, per VERIFICATION-CONTRACT.md's "cheapest layer" guidance).
 */
describe('shouldSubmitNewsletterEmail', () => {
  it('is false when no newsletter URL is configured, even for a valid email', () => {
    expect(shouldSubmitNewsletterEmail('person@example.com', undefined)).toBe(false);
    expect(shouldSubmitNewsletterEmail('person@example.com', '')).toBe(false);
  });

  it('is true only when a URL is configured AND the email is well-formed', () => {
    expect(shouldSubmitNewsletterEmail('person@example.com', 'https://mishmash.dev/subscribe')).toBe(true);
    expect(shouldSubmitNewsletterEmail('not-an-email', 'https://mishmash.dev/subscribe')).toBe(false);
    expect(shouldSubmitNewsletterEmail('', 'https://mishmash.dev/subscribe')).toBe(false);
  });

  it('normalizes case and surrounding whitespace before validating', () => {
    expect(shouldSubmitNewsletterEmail('  Person@Example.COM  ', 'https://mishmash.dev/subscribe')).toBe(true);
  });
});
