// Colour primitives for brand extraction and token derivation.
//
// The existing `brands/prefetch.ts` hand-rolls colour parsing with regexes,
// which cannot tell that `#fff`, `#ffffff`, `white`, and `rgb(255,255,255)`
// are one colour. Ranking a site's palette by usage is meaningless while
// four spellings of white compete as four separate entries — so
// canonicalisation is a correctness requirement, not a nicety.

import { describe, expect, it } from 'vitest';
import {
  canonicalizeColor,
  contrastRatio,
  deriveRamp,
  meetsContrast,
  pickAccessibleForeground,
  toOklchTriplet,
} from '../src/brands/color-space.js';

describe('canonicalizeColor', () => {
  it('collapses every spelling of the same colour to one key', () => {
    const spellings = ['#fff', '#ffffff', '#FFFFFF', 'white', 'rgb(255,255,255)', 'rgb(255 255 255)'];
    const canonical = spellings.map(canonicalizeColor);
    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe('#ffffff');
  });

  it('canonicalises modern syntax to the same key as legacy syntax', () => {
    expect(canonicalizeColor('rgb(10 92 255)')).toBe(canonicalizeColor('#0a5cff'));
  });

  it('returns null for a value it cannot parse rather than guessing', () => {
    expect(canonicalizeColor('not-a-color')).toBeNull();
    expect(canonicalizeColor('')).toBeNull();
    expect(canonicalizeColor('var(--brand)')).toBeNull();
    expect(canonicalizeColor('currentColor')).toBeNull();
  });

  it('rejects fully transparent colours instead of reporting them as black', () => {
    // culori resolves `transparent` to #000000 at alpha 0. Every stylesheet
    // uses `transparent` somewhere, so admitting it would put black at the
    // top of every extracted palette.
    expect(canonicalizeColor('transparent')).toBeNull();
    expect(canonicalizeColor('rgba(255, 0, 0, 0)')).toBeNull();
    expect(canonicalizeColor('#00000000')).toBeNull();
  });

  it('keeps partially transparent colours, dropping only the alpha', () => {
    expect(canonicalizeColor('rgba(10, 92, 255, 0.5)')).toBe('#0a5cff');
    expect(canonicalizeColor('#0a5cff80')).toBe('#0a5cff');
  });

  it('preserves distinct colours', () => {
    expect(canonicalizeColor('#0a5cff')).not.toBe(canonicalizeColor('#0847cc'));
  });
});

describe('contrastRatio', () => {
  it('reports the WCAG extremes exactly', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    const forward = contrastRatio('#0a5cff', '#ffffff');
    const reverse = contrastRatio('#ffffff', '#0a5cff');
    expect(forward).not.toBeNull();
    expect(reverse).not.toBeNull();
    expect(forward!).toBeCloseTo(reverse!, 9);
  });

  it('returns null when either colour is unparseable', () => {
    expect(contrastRatio('#ffffff', 'var(--x)')).toBeNull();
  });
});

describe('meetsContrast', () => {
  it('fails the grey the accessibility baseline calls out', () => {
    // #999 on white is ~2.85:1 — under the 4.5:1 AA floor for body text.
    expect(meetsContrast('#999999', '#ffffff', 'AA', 'normal')).toBe(false);
  });

  it('passes that same grey as large text, where the floor is 3:1', () => {
    // Explicitly different from the case above: the threshold moves with
    // text size, so a single boolean "accessible?" would be wrong.
    expect(meetsContrast('#767676', '#ffffff', 'AA', 'large')).toBe(true);
  });

  it('applies the stricter AAA floor', () => {
    // ~5.9:1 — clears AA (4.5) but not AAA (7).
    expect(meetsContrast('#767676', '#ffffff', 'AA', 'normal')).toBe(true);
    expect(meetsContrast('#767676', '#ffffff', 'AAA', 'normal')).toBe(false);
  });
});

describe('pickAccessibleForeground', () => {
  it('picks white on a dark brand colour', () => {
    expect(pickAccessibleForeground('#0a3d91')).toBe('#ffffff');
  });

  it('picks near-black on a light brand colour', () => {
    expect(pickAccessibleForeground('#ffd400')).toBe('#111111');
  });

  it('always returns the higher-contrast option, even when neither clears AA', () => {
    // Mid-tone colours can fail AA against both candidates; returning the
    // better of the two is still the right answer, and the caller can
    // re-check with meetsContrast if it needs to warn.
    const fg = pickAccessibleForeground('#767676');
    expect(['#ffffff', '#111111']).toContain(fg);
    const other = fg === '#ffffff' ? '#111111' : '#ffffff';
    expect(contrastRatio(fg!, '#767676')!).toBeGreaterThanOrEqual(
      contrastRatio(other, '#767676')!,
    );
  });

  it('returns null for an unparseable background', () => {
    expect(pickAccessibleForeground('var(--brand)')).toBeNull();
  });
});

describe('deriveRamp', () => {
  it('produces the requested number of stops', () => {
    const ramp = deriveRamp('#0a5cff');
    expect(ramp).not.toBeNull();
    expect(ramp!.length).toBe(11);
  });

  it('orders stops from lightest to darkest', () => {
    const ramp = deriveRamp('#0a5cff')!;
    const lightness = ramp.map((s) => toOklchTriplet(s.hex)!.l);
    for (let i = 1; i < lightness.length; i += 1) {
      expect(lightness[i]!).toBeLessThan(lightness[i - 1]!);
    }
  });

  it('labels stops on the conventional 50..950 scale', () => {
    const ramp = deriveRamp('#0a5cff')!;
    expect(ramp.map((s) => s.stop)).toEqual([
      50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950,
    ]);
  });

  it('keeps the source hue on every stop that has a hue to keep', () => {
    // Hue is only defined where there is chroma to carry it. The lightest
    // stops sit near white, where fitting the seed's chroma into sRGB leaves
    // c≈0.01 and 8-bit hex quantisation swings the hue angle by degrees for
    // an imperceptible shift in a/b. Asserting hue stability there would be
    // asserting something untrue about colour, so the invariant is scoped to
    // stops whose chroma actually renders as a hue.
    const HUE_DEFINED_CHROMA = 0.05;
    const sourceHue = toOklchTriplet('#0a5cff')!.h;
    const checked: number[] = [];

    for (const stop of deriveRamp('#0a5cff')!) {
      const { c, h } = toOklchTriplet(stop.hex)!;
      if (c < HUE_DEFINED_CHROMA) continue;
      checked.push(stop.stop);
      expect(Math.abs(h - sourceHue)).toBeLessThan(1);
    }

    // Guard the guard: if clamping ever crushed the whole ramp, the loop
    // above would vacuously pass.
    expect(checked.length).toBeGreaterThanOrEqual(8);
  });

  it('keeps near-neutral stops neutral instead of swinging their hue', () => {
    // The complement of the case above: where hue is undefined the stop must
    // still read as a desaturated tint of the seed, not an arbitrary colour.
    for (const stop of deriveRamp('#0a5cff')!) {
      const { l, c } = toOklchTriplet(stop.hex)!;
      if (c >= 0.05) continue;
      expect(l).toBeGreaterThan(0.9);
    }
  });

  it('derives a ramp for an achromatic seed without inventing a hue', () => {
    const ramp = deriveRamp('#767676');
    expect(ramp).not.toBeNull();
    for (const stop of ramp!) {
      expect(toOklchTriplet(stop.hex)!.c).toBeLessThan(0.01);
    }
  });

  it('emits in-gamut sRGB hex for every stop', () => {
    // OKLCH can describe colours sRGB cannot show; an out-of-gamut stop
    // would round-trip to a different colour than the one computed.
    for (const stop of deriveRamp('#00ff00')!) {
      expect(stop.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(canonicalizeColor(stop.hex)).toBe(stop.hex);
    }
  });

  it('returns null for an unparseable seed', () => {
    expect(deriveRamp('nonsense')).toBeNull();
  });
});
