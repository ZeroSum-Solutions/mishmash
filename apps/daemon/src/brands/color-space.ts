// Colour primitives for brand extraction and token derivation, backed by
// culori.
//
// `prefetch.ts` parses colours with regexes, which cannot recognise that
// `#fff`, `#ffffff`, `white`, and `rgb(255 255 255)` are one colour. That
// matters the moment a palette is ranked by usage: four spellings of white
// competing as four entries produces a palette that reflects the source
// stylesheet's typing habits rather than its design.
//
// Every function here returns `null` on input it cannot parse. Brand
// extraction runs over third-party CSS full of `var(--x)`, `currentColor`,
// and vendor junk; a silent fallback colour would quietly become part of a
// client's design system.

import { converter, formatHex, parse, wcagContrast, clampChroma } from 'culori';

const toOklch = converter('oklch');
const toRgb = converter('rgb');

export interface OklchTriplet {
  l: number;
  c: number;
  h: number;
}

export interface RampStop {
  /** Conventional 50..950 token label. */
  stop: number;
  hex: string;
}

export type ContrastLevel = 'AA' | 'AAA';
export type TextSize = 'normal' | 'large';

/**
 * WCAG 2.x contrast floors. Large text (>=18.66px bold or >=24px) is held to
 * a lower bar than body copy, so callers must say which they mean rather
 * than getting one blanket "accessible" answer.
 */
const CONTRAST_FLOORS: Record<ContrastLevel, Record<TextSize, number>> = {
  AA: { normal: 4.5, large: 3 },
  AAA: { normal: 7, large: 4.5 },
};

/** Light/dark foreground candidates. Pure black is avoided: it reads harsh. */
const FOREGROUND_CANDIDATES = ['#ffffff', '#111111'] as const;

const RAMP_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/**
 * Target OKLCH lightness per stop. Fixed rather than derived from the seed so
 * two brand colours produce ramps that sit at the same visual levels — a
 * `blue-600` and a `red-600` must be interchangeable in a layout.
 */
const RAMP_LIGHTNESS: Record<(typeof RAMP_STOPS)[number], number> = {
  50: 0.97, 100: 0.94, 200: 0.88, 300: 0.80, 400: 0.71, 500: 0.63,
  600: 0.55, 700: 0.47, 800: 0.39, 900: 0.31, 950: 0.24,
};

/**
 * Reduce a CSS colour to one canonical `#rrggbb` key.
 *
 * Returns null for anything unparseable, including `var(--x)` and
 * `currentColor`, which carry no colour on their own.
 *
 * Partial alpha is dropped — palette identity is the colour, not its opacity
 * at one call site — but `alpha: 0` returns null. culori resolves
 * `transparent` to `#000000` at zero alpha, and admitting that would put
 * black into the palette of every site that uses `transparent` anywhere,
 * which is all of them.
 */
export function canonicalizeColor(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = parse(trimmed);
  if (parsed === undefined) return null;
  if (parsed.alpha === 0) return null;
  const hex = formatHex(parsed);
  return typeof hex === 'string' ? hex.toLowerCase() : null;
}

/** OKLCH components, or null if the colour cannot be parsed. */
export function toOklchTriplet(raw: string): OklchTriplet | null {
  const parsed = parse(raw);
  if (parsed === undefined) return null;
  const ok = toOklch(parsed);
  if (!ok) return null;
  return {
    l: ok.l ?? 0,
    c: ok.c ?? 0,
    // Achromatic colours have no hue; 0 keeps the value finite for callers.
    h: Number.isFinite(ok.h) ? (ok.h as number) : 0,
  };
}

/** WCAG 2.x contrast ratio (1..21), or null if either colour is unparseable. */
export function contrastRatio(a: string, b: string): number | null {
  if (parse(a) === undefined || parse(b) === undefined) return null;
  const ratio = wcagContrast(a, b);
  return Number.isFinite(ratio) ? ratio : null;
}

/** Whether `foreground` on `background` clears the given WCAG floor. */
export function meetsContrast(
  foreground: string,
  background: string,
  level: ContrastLevel = 'AA',
  size: TextSize = 'normal',
): boolean {
  const ratio = contrastRatio(foreground, background);
  if (ratio === null) return false;
  return ratio >= CONTRAST_FLOORS[level][size];
}

/**
 * The higher-contrast of white / near-black against `background`.
 *
 * Always returns the better candidate, even when neither clears AA — a
 * mid-tone brand colour has no accessible text colour, and reporting the
 * best available option plus a `meetsContrast` check tells the caller more
 * than returning null would.
 */
export function pickAccessibleForeground(background: string): string | null {
  if (parse(background) === undefined) return null;
  let best: string | null = null;
  let bestRatio = -1;
  for (const candidate of FOREGROUND_CANDIDATES) {
    const ratio = contrastRatio(candidate, background);
    if (ratio !== null && ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  return best;
}

/**
 * Derive a 50..950 tint/shade ramp from one seed colour.
 *
 * Hue and chroma come from the seed; lightness is pinned to the shared
 * ladder above. Chroma is clamped into sRGB per stop, because a saturated
 * hue at an extreme lightness is frequently outside the gamut a browser can
 * render — without the clamp those stops would silently round-trip to a
 * different colour than the one computed.
 */
export function deriveRamp(seed: string): RampStop[] | null {
  const base = toOklchTriplet(seed);
  if (base === null) return null;

  const ramp: RampStop[] = [];
  for (const stop of RAMP_STOPS) {
    const target = { mode: 'oklch' as const, l: RAMP_LIGHTNESS[stop], c: base.c, h: base.h };
    const inGamut = clampChroma(target, 'oklch', 'rgb');
    const hex = formatHex(toRgb(inGamut));
    // No substitute colour. Falling back to black here would ship a swatch
    // that is not a tint of the seed at all, and it would ship it silently
    // into a client's design tokens — the one failure this module exists to
    // prevent. A ramp that cannot be fully derived is not a ramp.
    if (typeof hex !== 'string') return null;
    ramp.push({ stop, hex: hex.toLowerCase() });
  }
  return ramp;
}
