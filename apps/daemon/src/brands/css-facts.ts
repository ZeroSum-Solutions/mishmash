// Deterministic design facts from a stylesheet, via @projectwallace/css-analyzer.
//
// The brand-import flow's hardest question is "what IS this site's design
// system" — which colours matter, which are incidental, what the type scale
// is. `prefetch.ts` answers it with regexes over raw CSS, which can find
// colour-shaped substrings but cannot weight them by use, cannot tell one
// colour written two ways from two colours, and cannot tell a text colour
// from a background colour.
//
// css-analyzer parses the sheet and reports usage counts per property, and
// `color-space.ts` collapses spelling variants. Together they turn the
// palette from a guess into a measurement.
//
// Everything here is total: extraction runs over third-party CSS, so
// malformed input returns empty facts rather than throwing into the import.

import { analyze } from '@projectwallace/css-analyzer';
import { canonicalizeColor } from './color-space.js';

export interface RankedValue {
  value: string;
  count: number;
}

export interface CssColorRoles {
  text: RankedValue[];
  background: RankedValue[];
  border: RankedValue[];
}

export interface CssFacts {
  /** Every colour in the sheet, canonicalised and ranked by usage. */
  colors: RankedValue[];
  /** The same colours split by the role their property implies. */
  colorsByRole: CssColorRoles;
  fontFamilies: RankedValue[];
  /** Ordered smallest-first; values without a comparable length go last. */
  fontSizes: RankedValue[];
  lineHeights: RankedValue[];
  borderRadii: RankedValue[];
  /**
   * Total declarations parsed. A palette derived from a handful of rules
   * deserves less confidence than one derived from a full site stylesheet,
   * and only the caller can decide what to do about that.
   */
  declarationCount: number;
}

/** css-analyzer's per-value shape: `{ unique: { value: count } }`. */
interface AnalyzedValues {
  unique?: Record<string, number> | undefined;
  itemsPerContext?: Record<string, { unique?: Record<string, number> }> | undefined;
}

const EMPTY_FACTS: CssFacts = {
  colors: [],
  colorsByRole: { text: [], background: [], border: [] },
  fontFamilies: [],
  fontSizes: [],
  lineHeights: [],
  borderRadii: [],
  declarationCount: 0,
};

/**
 * Which CSS properties imply which design role.
 *
 * Matched as prefixes so `border-top-color` lands with `border-color`, and
 * shorthand `background` with `background-color`.
 */
const ROLE_PROPERTY_PREFIXES: Record<keyof CssColorRoles, readonly string[]> = {
  text: ['color'],
  background: ['background'],
  border: ['border', 'outline'],
};

/** Absolute CSS length units, in px, for ordering a type scale. */
const PX_PER_UNIT: Record<string, number> = {
  px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6,
};

function rank(counts: Record<string, number>): RankedValue[] {
  return Object.entries(counts)
    .map(([value, count]) => ({ value, count }))
    // Ties broken by value so the output is stable across runs — this feeds
    // a written DESIGN.md, and a palette that reorders itself between
    // identical imports would produce meaningless diffs.
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Merge spelling variants (`#fff` / `#FFFFFF` / `white`) into one entry. */
function rankColors(counts: Record<string, number> | undefined): RankedValue[] {
  if (!counts) return [];
  // Null-prototype throughout this module: a stylesheet can legitimately
  // contain `color: constructor` or `font-family: toString`, and on a plain
  // object literal those keys resolve to inherited Object.prototype members,
  // so `(merged[key] ?? 0) + count` would concatenate onto a function instead
  // of counting.
  const merged: Record<string, number> = Object.create(null);
  for (const [raw, count] of Object.entries(counts)) {
    const canonical = canonicalizeColor(raw);
    // `var(--x)`, `currentColor`, `inherit`: colour-valued syntactically,
    // but they carry no colour to put in a palette.
    if (canonical === null) continue;
    merged[canonical] = (merged[canonical] ?? 0) + count;
  }
  return rank(merged);
}

/**
 * Canonicalise a font stack so spelling variants merge.
 *
 * `Inter,sans-serif`, `Inter, sans-serif`, and `"Inter", sans-serif` are one
 * stack written three ways — the same identity problem hex colours have.
 * Quotes are dropped for comparison because they affect parsing, not which
 * font is asked for.
 */
function normalizeFontFamily(raw: string): string | null {
  const families = raw
    .split(',')
    .map((part) => part.trim().replace(/^(['"])(.*)\1$/u, '$2').trim())
    .filter((part) => part.length > 0);
  return families.length === 0 ? null : families.join(', ');
}

function rankFontFamilies(counts: Record<string, number> | undefined): RankedValue[] {
  if (!counts) return [];
  const merged: Record<string, number> = Object.create(null);
  for (const [raw, count] of Object.entries(counts)) {
    const canonical = normalizeFontFamily(raw);
    if (canonical === null) continue;
    merged[canonical] = (merged[canonical] ?? 0) + count;
  }
  return rank(merged);
}

function roleFor(property: string): keyof CssColorRoles | null {
  const prop = property.toLowerCase();
  for (const [role, prefixes] of Object.entries(ROLE_PROPERTY_PREFIXES)) {
    if (prefixes.some((p) => prop === p || prop.startsWith(`${p}-`))) {
      return role as keyof CssColorRoles;
    }
  }
  return null;
}

function colorsByRole(values: AnalyzedValues | undefined): CssColorRoles {
  const buckets: Record<keyof CssColorRoles, Record<string, number>> = {
    text: Object.create(null),
    background: Object.create(null),
    border: Object.create(null),
  };
  for (const [property, entry] of Object.entries(values?.itemsPerContext ?? {})) {
    const role = roleFor(property);
    if (role === null) continue;
    for (const [raw, count] of Object.entries(entry?.unique ?? {})) {
      const canonical = canonicalizeColor(raw);
      if (canonical === null) continue;
      buckets[role][canonical] = (buckets[role][canonical] ?? 0) + count;
    }
  }
  return {
    text: rank(buckets.text),
    background: rank(buckets.background),
    border: rank(buckets.border),
  };
}

/** Length in px, or null when the value has no unit we can compare. */
function toPx(value: string): number | null {
  const match = /^(-?\d*\.?\d+)([a-z%]*)$/iu.exec(value.trim());
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  const unit = (match[2] ?? '').toLowerCase();
  if (unit === '') return magnitude;
  const factor = PX_PER_UNIT[unit];
  return factor === undefined ? null : magnitude * factor;
}

/**
 * Order by rendered length. Values with no absolute length (`2rem`,
 * `clamp(...)`) keep their place after the comparable ones rather than being
 * dropped — they are part of the scale even when they cannot be sorted into
 * it without a root font size.
 */
function orderByLength(counts: Record<string, number> | undefined): RankedValue[] {
  if (!counts) return [];
  const entries = Object.entries(counts).map(([value, count]) => ({
    value,
    count,
    px: toPx(value),
  }));
  entries.sort((a, b) => {
    if (a.px !== null && b.px !== null) return a.px - b.px;
    if (a.px !== null) return -1;
    if (b.px !== null) return 1;
    return a.value.localeCompare(b.value);
  });
  return entries.map(({ value, count }) => ({ value, count }));
}

/**
 * Extract design facts from a stylesheet.
 *
 * Returns empty facts for input that cannot be parsed; brand extraction runs
 * over whatever a third-party origin serves, and a truncated stylesheet must
 * degrade the import rather than fail it.
 */
export function analyzeCssFacts(css: string): CssFacts {
  if (typeof css !== 'string' || css.trim().length === 0) return EMPTY_FACTS;

  let result;
  try {
    result = analyze(css);
  } catch {
    return EMPTY_FACTS;
  }

  const values = (result?.values ?? {}) as Record<string, AnalyzedValues>;

  return {
    colors: rankColors(values.colors?.unique),
    colorsByRole: colorsByRole(values.colors),
    fontFamilies: rankFontFamilies(values.fontFamilies?.unique),
    fontSizes: orderByLength(values.fontSizes?.unique),
    lineHeights: rank(values.lineHeights?.unique ?? {}),
    borderRadii: orderByLength(values.borderRadiuses?.unique),
    declarationCount: Number(result?.declarations?.total ?? 0),
  };
}
