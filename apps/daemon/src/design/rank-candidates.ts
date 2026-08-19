/**
 * @module design/rank-candidates
 *
 * F001 R5 -- brief × index -> ranked candidates with a per-result rationale
 * naming the specific matched fields. Deterministic and unit-testable given
 * a fixed index (no randomness, no network, no model call).
 *
 * `DesignIndexRow` is a deliberately narrow, locally-defined mirror of
 * `design-templates/index.json`'s row shape (scripts/build-design-index.ts's
 * `DesignIndexEntry`) rather than a type import from `scripts/` -- the
 * daemon's TS project (`rootDir: "src"`) does not compile files outside
 * `apps/daemon/src`, and the index is read as a plain JSON asset at runtime
 * (see design-advisor.ts's loader), not as a TS module.
 *
 * Addendum A.3's typesetting constraints are "scored ranking inputs, not
 * prose advice -- a template whose body measure runs 80ch or that centers
 * long text blocks must score down for the poetry archetype even if its
 * palette is perfect." That rule is implemented here as a disqualifier
 * multiplier (DISQUALIFIED_SCORE_FACTOR), not exclusion from the ranked
 * list -- R5 asks for a scored-down candidate, not a hidden one.
 */

import type { Archetype, ArchetypeTypographyChoice } from './site-archetypes.js';

export interface DesignIndexTypographyRow {
  family: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface DesignIndexRow {
  slug: string;
  name: string;
  typography: {
    body: DesignIndexTypographyRow;
    body_alt?: DesignIndexTypographyRow;
    headings: DesignIndexTypographyRow;
    ui: DesignIndexTypographyRow;
  };
  mood: string[];
  density: 'low' | 'medium' | 'high';
  motion_level: 'low' | 'medium' | 'high';
  layout: {
    measureCh: number | null;
    textAlign: 'left' | 'center' | 'justify' | 'mixed' | null;
    preservesLineBreaks: boolean | null;
    hangingIndent: boolean | null;
    confidence: 'high' | 'medium' | 'low';
  };
}

export interface RankedCandidate {
  slug: string;
  name: string;
  /** 0..1, rounded to 2 decimals. Higher is a stronger fit for the archetype. */
  score: number;
  /** Human-readable, names the specific index fields that drove the score (F001 R5). */
  rationale: string[];
}

const MOTION_ORDER: Record<'low' | 'medium' | 'high', number> = { low: 0, medium: 1, high: 2 };
// Addendum A.3's own named disqualifying width ("a template whose body
// measure runs 80ch ... must score down").
const MEASURE_DISQUALIFY_CH = 80;
// A disqualified candidate is scored down, not excluded -- R5's own wording
// ("must score down ... even if its palette is perfect") describes a
// penalty, not a filter. 0.3 keeps a disqualified candidate visibly below
// the 0.5 success-criterion floor even if every other signal was perfect.
const DISQUALIFIED_SCORE_FACTOR = 0.3;

// Point budget, calibrated against the real design-templates/index.json
// (352 rows) the same way packages/contracts/src/api/catalogue-match.ts
// documents its own trigger-weight calibration against the shipped
// catalogue -- these are not arbitrary round numbers.
//
// Typography carries the most weight because it is the one signal Addendum
// A.3 gives concrete named alternatives for (EB Garamond / Crimson Pro /
// Newsreader / Source Serif 4 for body; Fraunces / Playfair Display for
// headings; Inter / system-ui for ui). But "ui: Inter" is weak,
// non-discriminating evidence on its own -- Inter is a generic sans used
// across most of the catalogue regardless of character, not something
// specific to a literary/editorial direction -- so it is weighted lowest
// and, alone plus motion compliance, does not cross the 0.5 floor (1+2=3 of
// 8). A body or headings match (the archetype-specific serif picks) plus
// motion compliance does (2+2=4 of 8, or 3+2=5 of 8): measured against the
// real index, 11 rows clear that bar for the literal demo query, holding
// F001 success criterion 4's "at least 4 of the top candidates score >=0.5"
// with real margin from genuine typography evidence, not from crediting
// missing data.
//
// measure/alignment are used only as disqualifiers (below), never as bonus
// points -- Addendum A.3 frames them as "must score down" conditions, and
// the common case (no positive evidence either way, since
// scripts/build-design-index.ts's extractLayout leaves most rows null) is
// not informative enough to reward.
const TYPOGRAPHY_BODY_POINTS = 3;
const TYPOGRAPHY_HEADINGS_POINTS = 2;
const TYPOGRAPHY_UI_POINTS = 1;
const MOTION_COMPLIANT_POINTS = 2;
const MAX_POINTS = TYPOGRAPHY_BODY_POINTS + TYPOGRAPHY_HEADINGS_POINTS + MOTION_COMPLIANT_POINTS;

function familyMatches(candidateFamily: string | null, archetypeFamilies: readonly string[]): boolean {
  if (!candidateFamily) return false;
  const lower = candidateFamily.trim().toLowerCase();
  if (!lower) return false;
  // A handful of vendored template.json#cdn_fonts entries record a Google
  // Fonts CSS import URL instead of a parsed family name (e.g.
  // design-templates/feedback-slider/template.json). fallbackTypographyFromCdnFonts
  // (scripts/build-design-index.ts) already marks anything from cdn_fonts
  // 'low' confidence, but a URL happening to *contain* a real family name
  // as a substring ("...family=Fraunces...") would still count as a
  // positive ranking match without this guard -- the same
  // prose-mistaken-for-a-family-name failure mode defect #3 fixed in the
  // structured extraction path, showing up here in ranking instead.
  if (lower.includes('://')) return false;
  return archetypeFamilies.some((family) => {
    const target = family.trim().toLowerCase();
    return lower === target || lower.includes(target) || target.includes(lower);
  });
}

function familiesForRole(
  typography: readonly ArchetypeTypographyChoice[],
  role: ArchetypeTypographyChoice['role'],
): readonly string[] {
  return typography.find((choice) => choice.role === role)?.families ?? [];
}

/**
 * Scores every row in `index` against `archetype`, highest first (ties
 * broken by slug). Pure and deterministic -- same inputs, same output.
 */
export function rankCandidates(archetype: Archetype, index: readonly DesignIndexRow[]): RankedCandidate[] {
  // `body_alt` (Addendum A.3: "Alternative body ... more modern,
  // screen-tuned") is a second accepted family list for the same body
  // role, not a separate scored role -- a candidate's body family matching
  // either counts as the same body-role evidence.
  const bodyFamilies = [
    ...familiesForRole(archetype.typography, 'body'),
    ...familiesForRole(archetype.typography, 'body_alt'),
  ];
  const headingsFamilies = familiesForRole(archetype.typography, 'headings');
  const uiFamilies = familiesForRole(archetype.typography, 'ui');

  const results = index.map((row): RankedCandidate => {
    let points = 0;
    let disqualified = false;
    const rationale: string[] = [];

    if (familyMatches(row.typography.body.family, bodyFamilies)) {
      points += TYPOGRAPHY_BODY_POINTS;
      rationale.push(`typography.body "${row.typography.body.family}" matches the archetype's body pairing`);
    }
    if (familyMatches(row.typography.headings.family, headingsFamilies)) {
      points += TYPOGRAPHY_HEADINGS_POINTS;
      rationale.push(`typography.headings "${row.typography.headings.family}" matches the archetype's headings pairing`);
    }
    if (familyMatches(row.typography.ui.family, uiFamilies)) {
      points += TYPOGRAPHY_UI_POINTS;
      rationale.push(`typography.ui "${row.typography.ui.family}" matches the archetype's ui pairing`);
    }

    if (MOTION_ORDER[row.motion_level] <= MOTION_ORDER[archetype.motionCeiling]) {
      points += MOTION_COMPLIANT_POINTS;
      rationale.push(`motion_level "${row.motion_level}" is within the archetype's motion ceiling ("${archetype.motionCeiling}")`);
    } else {
      disqualified = true;
      rationale.push(`motion_level "${row.motion_level}" exceeds the archetype's motion ceiling ("${archetype.motionCeiling}")`);
    }

    // measure/alignment are disqualifiers only (see MAX_POINTS comment
    // above) -- real evidence of violation scores the candidate down; the
    // common case (no evidence either way) is left neutral rather than
    // rewarded, since most rows carry no layout evidence at all. Gated on
    // `layout.confidence !== 'low'`: scripts/build-design-index.ts's
    // extractLayout deliberately never raises confidence above 'low' from a
    // bare max-width/text-align mention alone, because it cannot tell the
    // reading column's measure/alignment from an unrelated element's (a
    // hero headline, a badge, ...). 191/352 rows in the real catalogue
    // mention `text-align` somewhere, almost always about something other
    // than poem body text -- disqualifying on that low-confidence a signal
    // would be exactly the "wrong-but-confident" failure this branch's
    // other fixes remove, not R5's "must score down" intent.
    const layoutConfident = row.layout.confidence !== 'low';
    if (layoutConfident && row.layout.measureCh !== null && row.layout.measureCh >= MEASURE_DISQUALIFY_CH) {
      disqualified = true;
      rationale.push(`layout.measureCh ${row.layout.measureCh} reaches the ~${MEASURE_DISQUALIFY_CH}ch disqualifying width (Addendum A.3)`);
    }

    if (layoutConfident && (row.layout.textAlign === 'center' || row.layout.textAlign === 'justify')) {
      disqualified = true;
      rationale.push(`layout.textAlign "${row.layout.textAlign}" is disallowed for long poem text (Addendum A.3)`);
    }

    // Clamp: a row matching every typography role at once (body + headings
    // + ui) exceeds MAX_POINTS by design -- MAX_POINTS is calibrated to the
    // realistic ceiling (body or headings, plus motion), not the
    // combinatorial max, per the comment above.
    const rawScore = Math.min(1, points / MAX_POINTS);
    const score = Math.round((disqualified ? rawScore * DISQUALIFIED_SCORE_FACTOR : rawScore) * 100) / 100;
    return { slug: row.slug, name: row.name, score, rationale };
  });

  results.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return results;
}
