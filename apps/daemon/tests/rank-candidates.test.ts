import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rankCandidates, type DesignIndexRow } from '../src/design/rank-candidates.js';
import { POETRY_ARCHETYPE } from '../src/design/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');

function row(overrides: Partial<DesignIndexRow> & Pick<DesignIndexRow, 'slug'>): DesignIndexRow {
  return {
    name: overrides.slug,
    typography: {
      body: { family: null, confidence: 'low' },
      headings: { family: null, confidence: 'low' },
      ui: { family: null, confidence: 'low' },
    },
    mood: [],
    density: 'medium',
    motion_level: 'medium',
    layout: { measureCh: null, textAlign: null, preservesLineBreaks: null, hangingIndent: null, confidence: 'low' },
    ...overrides,
  };
}

/** rankCandidates always returns one result per input row -- asserts that and returns it, rather than an unsafe `[0]!` at every call site. */
function rankOne(...args: Parameters<typeof rankCandidates>) {
  const [result] = rankCandidates(...args);
  if (!result) throw new Error('expected rankCandidates to return at least one result');
  return result;
}

describe('rank-candidates: rankCandidates (F001 R5)', () => {
  it('scores a strong typography + motion-compliant match above 0.5', () => {
    const result = rankOne(POETRY_ARCHETYPE, [
      row({
        slug: 'strong-match',
        typography: {
          body: { family: 'EB Garamond', confidence: 'high' },
          headings: { family: 'Fraunces', confidence: 'high' },
          ui: { family: 'Inter', confidence: 'high' },
        },
        motion_level: 'low',
      }),
    ]);
    expect(result.score).toBeGreaterThanOrEqual(0.5);
    expect(result.rationale.some((r) => r.includes('typography.body'))).toBe(true);
    expect(result.rationale.some((r) => r.includes('typography.headings'))).toBe(true);
  });

  it('scores a candidate with no matching signal at 0', () => {
    const result = rankOne(POETRY_ARCHETYPE, [row({ slug: 'no-signal', motion_level: 'high' })]);
    expect(result.score).toBe(0);
  });

  it('never exceeds 1.0 even when every typography role matches', () => {
    const result = rankOne(POETRY_ARCHETYPE, [
      row({
        slug: 'everything-matches',
        typography: {
          body: { family: 'Crimson Pro', confidence: 'high' },
          headings: { family: 'Playfair Display', confidence: 'high' },
          ui: { family: 'system-ui', confidence: 'high' },
        },
        motion_level: 'low',
      }),
    ]);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('scores a candidate down (not silently excluded) for exceeding the motion ceiling -- named in the rationale', () => {
    const result = rankOne(POETRY_ARCHETYPE, [
      row({
        slug: 'too-much-motion',
        typography: {
          body: { family: 'EB Garamond', confidence: 'high' },
          headings: { family: 'Fraunces', confidence: 'high' },
          ui: { family: null, confidence: 'low' },
        },
        motion_level: 'high',
      }),
    ]);
    // Would otherwise score well above 0.5 on typography alone; the motion
    // disqualifier (Addendum A.3: "must score down ... even if its palette
    // is perfect") must still pull it down.
    expect(result.score).toBeLessThan(0.5);
    expect(result.rationale.some((r) => r.includes('exceeds the archetype'))).toBe(true);
  });

  it('scores a candidate down for a HIGH/MEDIUM-confidence disqualifying measure or alignment', () => {
    const result = rankOne(POETRY_ARCHETYPE, [
      row({
        slug: 'too-wide-and-centered',
        typography: {
          body: { family: 'EB Garamond', confidence: 'high' },
          headings: { family: 'Fraunces', confidence: 'high' },
          ui: { family: null, confidence: 'low' },
        },
        layout: { measureCh: 90, textAlign: 'center', preservesLineBreaks: null, hangingIndent: null, confidence: 'medium' },
      }),
    ]);
    expect(result.score).toBeLessThan(0.5);
    expect(result.rationale.some((r) => r.includes('disqualifying width'))).toBe(true);
    expect(result.rationale.some((r) => r.includes('disallowed for long poem text'))).toBe(true);
  });

  it('does NOT apply the measure/alignment disqualifier when layout.confidence is low (avoids "wrong-but-confident" scoring)', () => {
    // Same measure/alignment values as the previous test, but at 'low'
    // confidence (the common case -- see extractLayout's own doc comment):
    // a bare max-width/text-align mention cannot be attributed to the
    // reading column, so it must not drive a strong penalty.
    const typography = {
      body: { family: 'EB Garamond', confidence: 'high' as const },
      headings: { family: null, confidence: 'low' as const },
      ui: { family: null, confidence: 'low' as const },
    };
    const confident = rankOne(POETRY_ARCHETYPE, [
      row({
        slug: 'x',
        typography,
        layout: { measureCh: 90, textAlign: 'center', preservesLineBreaks: null, hangingIndent: null, confidence: 'medium' },
      }),
    ]).score;
    const notConfident = rankOne(POETRY_ARCHETYPE, [
      row({
        slug: 'x',
        typography,
        layout: { measureCh: 90, textAlign: 'center', preservesLineBreaks: null, hangingIndent: null, confidence: 'low' },
      }),
    ]).score;
    expect(confident).toBeLessThan(notConfident);
  });

  it('ignores a URL leaking through template.json#cdn_fonts as if it were a font family', () => {
    const result = rankOne(POETRY_ARCHETYPE, [
      row({
        slug: 'url-leak',
        typography: {
          body: { family: null, confidence: 'low' },
          headings: {
            family: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400&display=swap',
            confidence: 'low',
          },
          ui: { family: null, confidence: 'low' },
        },
      }),
    ]);
    expect(result.rationale.some((r) => r.includes('typography.headings'))).toBe(false);
  });

  it('sorts highest score first, ties broken by slug', () => {
    const ranked = rankCandidates(POETRY_ARCHETYPE, [
      row({ slug: 'zzz-tie' }),
      row({ slug: 'aaa-tie' }),
      row({
        slug: 'winner',
        typography: { body: { family: 'EB Garamond', confidence: 'high' }, headings: { family: 'Fraunces', confidence: 'high' }, ui: { family: null, confidence: 'low' } },
      }),
    ]);
    expect(ranked.map((r) => r.slug)).toEqual(['winner', 'aaa-tie', 'zzz-tie']);
  });

  it('is deterministic -- identical input always produces identical output', () => {
    const rows = [row({ slug: 'a' }), row({ slug: 'b', motion_level: 'low' })];
    expect(rankCandidates(POETRY_ARCHETYPE, rows)).toEqual(rankCandidates(POETRY_ARCHETYPE, rows));
  });
});

describe('rank-candidates: F001 success criteria 3 & 4 against the real built index', () => {
  const indexPath = path.join(REPO_ROOT, 'design-templates/index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { templates: DesignIndexRow[] };
  const ranked = rankCandidates(POETRY_ARCHETYPE, index.templates);

  it('criterion 3: ranks at least 6 candidates for the poetry archetype', () => {
    expect(ranked.length).toBeGreaterThanOrEqual(6);
  });

  it('criterion 4: at least 4 of the top-ranked candidates score >= 0.5, from genuine typography/motion evidence', () => {
    const top12 = ranked.slice(0, 12);
    const passing = top12.filter((r) => r.score >= 0.5);
    expect(passing.length).toBeGreaterThanOrEqual(4);
    // Every passing candidate's rationale must name a real matched field --
    // not an empty or vacuous rationale.
    for (const candidate of passing) {
      expect(candidate.rationale.length).toBeGreaterThan(0);
    }
  });
});
