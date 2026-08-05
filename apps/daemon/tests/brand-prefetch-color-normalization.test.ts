// Colour normalisation inside brand prefetch.
//
// `extractColors` matches `oklch(...)` with its scanning regex, but the
// hand-rolled `normalizeColor` only understood hex / rgb / hsl. Anything
// else fell through to `raw.trim().toLowerCase()` in `addColorCandidate`,
// so an unrecognised colour entered the palette as a literal source string
// rather than a colour — and two spellings of one colour competed as two
// entries.
//
// That matters more every year: the premium sites this product is pointed
// at increasingly ship `oklch()` and named colours, which is exactly the
// input the old parser could not read.

import { describe, expect, it } from 'vitest';
import { extractColors, normalizeColor } from '../src/brands/prefetch.js';

describe('normalizeColor — formats the old parser could not read', () => {
  it('resolves CSS named colours', () => {
    expect(normalizeColor('white')).toBe('#ffffff');
    expect(normalizeColor('rebeccapurple')).toBe('#663399');
  });

  it('resolves oklch(), the format the scanner already matched', () => {
    const hex = normalizeColor('oklch(0.55 0.25 262)');
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('resolves the other modern colour functions', () => {
    expect(normalizeColor('hwb(0 0% 0%)')).toBe('#ff0000');
    expect(normalizeColor('lab(54% 81 70)')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('normalizeColor — formats it already handled stay handled', () => {
  it('expands short hex', () => {
    expect(normalizeColor('#FFF')).toBe('#ffffff');
    expect(normalizeColor('#0A5CFF')).toBe('#0a5cff');
  });

  it('drops the alpha channel from 8-digit hex', () => {
    // Palette identity is the colour, not its opacity at one call site.
    expect(normalizeColor('#0a5cff80')).toBe('#0a5cff');
  });

  it('resolves legacy and modern rgb syntax to the same colour', () => {
    expect(normalizeColor('rgb(10, 92, 255)')).toBe('#0a5cff');
    expect(normalizeColor('rgb(10 92 255)')).toBe('#0a5cff');
    expect(normalizeColor('rgba(10, 92, 255, 0.5)')).toBe('#0a5cff');
  });

  it('resolves hsl', () => {
    expect(normalizeColor('hsl(0, 100%, 50%)')).toBe('#ff0000');
    expect(normalizeColor('hsl(120deg 100% 50%)')).toBe('#00ff00');
  });

  it('still refuses what carries no colour', () => {
    expect(normalizeColor('var(--brand)')).toBeNull();
    expect(normalizeColor('currentColor')).toBeNull();
    expect(normalizeColor('')).toBeNull();
    expect(normalizeColor('not-a-color')).toBeNull();
  });
});

describe('extractColors', () => {
  it('does not admit an unparsed colour function as a palette entry', () => {
    const candidates = extractColors('a{color:oklch(0.55 0.25 262)}');
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('counts two spellings of one colour as one candidate', () => {
    const candidates = extractColors('a{color:#ffffff}b{color:#FFF}c{background:rgb(255 255 255)}');
    const whites = candidates.filter((c) => c.hex === '#ffffff');
    expect(whites).toHaveLength(1);
    expect(whites[0]!.count).toBe(3);
  });

  it('drops a value it could not resolve instead of storing the raw literal', () => {
    // `addColorCandidate` used to fall back to `raw.trim().toLowerCase()`
    // whenever normalisation failed, which was deliberate while the parser
    // could not read oklch(). Now that it can, the only values that still
    // fail to normalise are ones carrying no colour — and admitting those as
    // palette keys puts source text where a hex belongs.
    const candidates = extractColors(
      'a{color:rgba(255,0,0,0)}b{color:#ff000000}c{color:#0a5cff}',
    );
    expect(candidates.map((c) => c.hex)).toEqual(['#0a5cff']);
  });

  it('never emits a candidate whose hex is not a canonical hex', () => {
    const candidates = extractColors(
      'a{color:oklch(0.55 0.25 262)}b{color:rgba(0,0,0,0)}c{background:hsl(120deg 100% 50%)}',
    );
    for (const candidate of candidates) {
      expect(candidate.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
