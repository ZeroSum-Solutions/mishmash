// Deterministic design facts extracted from a stylesheet.
//
// `brands/prefetch.ts` currently derives a brand's palette and type scale
// with regexes over raw CSS text. That approach cannot weight a colour by
// how much of the page actually uses it, cannot tell `#fff` from `#ffffff`,
// and cannot separate a text colour from a background colour. Those are the
// three facts that decide what a design system looks like, so the import
// flow was guessing at exactly the part that matters most.
//
// This module answers those questions from parsed CSS instead.

import { describe, expect, it } from 'vitest';
import { analyzeCssFacts } from '../src/brands/css-facts.js';

const SITE_CSS = `
  :root { --brand: #0a5cff; }
  body { color: #111827; background: #ffffff; font-family: Inter, sans-serif; font-size: 16px; }
  p { color: #111827; font-size: 16px; line-height: 1.6; }
  small { color: #6b7280; font-size: 14px; }
  h1 { color: #111827; font-size: 48px; font-family: Inter, sans-serif; }
  h2 { color: #111827; font-size: 32px; }
  .btn { background: #0a5cff; color: #FFF; border-radius: 8px; }
  .btn:hover { background: rgb(8, 71, 204); }
  .card { background: #ffffff; border-radius: 12px; border-color: #e5e7eb; }
`;

describe('analyzeCssFacts — colour identity', () => {
  it('merges every spelling of one colour into a single ranked entry', () => {
    // #ffffff (body background, .card background) and #FFF (.btn colour)
    // are the same colour written three ways. A palette that lists them
    // separately misrepresents the design.
    const facts = analyzeCssFacts(SITE_CSS);
    const whites = facts.colors.filter((c) => c.value === '#ffffff');
    expect(whites).toHaveLength(1);
    expect(whites[0]!.count).toBe(3);
  });

  it('merges functional syntax with hex', () => {
    const facts = analyzeCssFacts('a{color:#0847cc}b{color:rgb(8, 71, 204)}');
    expect(facts.colors).toEqual([{ value: '#0847cc', count: 2 }]);
  });

  it('ranks colours by real usage, most-used first', () => {
    const facts = analyzeCssFacts(SITE_CSS);
    const counts = facts.colors.map((c) => c.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    // #111827 is the body/paragraph/heading colour — four uses, the most of
    // any colour in the sheet.
    expect(facts.colors[0]).toEqual({ value: '#111827', count: 4 });
  });

  it('drops values that carry no colour of their own', () => {
    const facts = analyzeCssFacts('a{color:var(--brand)}b{color:currentColor}c{color:inherit}');
    expect(facts.colors).toEqual([]);
  });
});

describe('analyzeCssFacts — colour roles', () => {
  it('separates text colours from background colours', () => {
    const facts = analyzeCssFacts(SITE_CSS);
    const text = facts.colorsByRole.text.map((c) => c.value);
    const background = facts.colorsByRole.background.map((c) => c.value);

    expect(text).toContain('#111827');
    expect(background).toContain('#0a5cff');
    // White is used as both, so it must appear under both roles.
    expect(background).toContain('#ffffff');
    expect(text).toContain('#ffffff');
    // The body text colour is never used as a background in this sheet.
    expect(background).not.toContain('#111827');
  });

  it('collects border colours separately', () => {
    const facts = analyzeCssFacts(SITE_CSS);
    expect(facts.colorsByRole.border.map((c) => c.value)).toEqual(['#e5e7eb']);
  });
});

describe('analyzeCssFacts — type scale', () => {
  it('orders font sizes by computed length, not lexically', () => {
    // Sorted as strings, '14px' < '16px' < '32px' < '48px' happens to work,
    // but '8px' would sort after '48px'. Order must come from the number.
    const facts = analyzeCssFacts('a{font-size:48px}b{font-size:8px}c{font-size:16px}');
    expect(facts.fontSizes.map((f) => f.value)).toEqual(['8px', '16px', '48px']);
  });

  it('reports how often each size is used', () => {
    const facts = analyzeCssFacts(SITE_CSS);
    const base = facts.fontSizes.find((f) => f.value === '16px');
    expect(base?.count).toBe(2);
  });

  it('keeps sizes it cannot convert to px, ordered after the ones it can', () => {
    // rem/em/clamp() are real and common; dropping them would hide part of
    // the scale, but they cannot be ordered against px without a root size.
    const facts = analyzeCssFacts('a{font-size:16px}b{font-size:2rem}c{font-size:clamp(1rem,2vw,3rem)}');
    const values = facts.fontSizes.map((f) => f.value);
    expect(values[0]).toBe('16px');
    expect(values).toContain('2rem');
    expect(values).toContain('clamp(1rem,2vw,3rem)');
  });

  it('ranks font families by usage', () => {
    const facts = analyzeCssFacts(SITE_CSS);
    expect(facts.fontFamilies[0]!.value).toBe('Inter, sans-serif');
    expect(facts.fontFamilies[0]!.count).toBe(2);
  });

  it('merges font stacks that differ only in spacing or quoting', () => {
    // Same identity problem as #fff vs #ffffff: one stack, three spellings.
    const facts = analyzeCssFacts(
      `a{font-family:Inter,sans-serif}b{font-family:Inter, sans-serif}c{font-family:"Inter", sans-serif}`,
    );
    expect(facts.fontFamilies).toEqual([{ value: 'Inter, sans-serif', count: 3 }]);
  });
});

describe('analyzeCssFacts — other scales', () => {
  it('collects border radii ordered by length', () => {
    const facts = analyzeCssFacts(SITE_CSS);
    expect(facts.borderRadii.map((r) => r.value)).toEqual(['8px', '12px']);
  });

  it('collects line heights', () => {
    const facts = analyzeCssFacts(SITE_CSS);
    expect(facts.lineHeights.map((l) => l.value)).toContain('1.6');
  });

  it('reports declaration volume as a confidence signal', () => {
    // A palette derived from nine declarations deserves less trust than one
    // derived from nine thousand; the caller needs to be able to tell.
    const facts = analyzeCssFacts(SITE_CSS);
    expect(facts.declarationCount).toBeGreaterThan(10);
  });
});

describe('analyzeCssFacts — hostile input', () => {
  it('returns empty facts for an empty stylesheet', () => {
    const facts = analyzeCssFacts('');
    expect(facts.colors).toEqual([]);
    expect(facts.fontSizes).toEqual([]);
    expect(facts.declarationCount).toBe(0);
  });

  it('does not throw on malformed css', () => {
    // Extraction runs over whatever a third-party site serves, including
    // truncated or minified-and-broken stylesheets.
    expect(() => analyzeCssFacts('a{color:#fff')).not.toThrow();
    expect(() => analyzeCssFacts('}}}{{{')).not.toThrow();
    expect(() => analyzeCssFacts('@media screen and')).not.toThrow();
  });

  it('does not throw on non-string input', () => {
    expect(() => analyzeCssFacts(undefined as unknown as string)).not.toThrow();
    expect(analyzeCssFacts(null as unknown as string).colors).toEqual([]);
  });
});
