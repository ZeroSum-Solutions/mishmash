// Brief -> catalogue matcher — pure ranking engine contract tests.
//
// See src/api/catalogue-match.ts for the defect this exists to fix: 561
// design templates + 164 skills carry curated `triggers`, but nothing ever
// compared a user's brief against them. Fixtures below mirror two real
// entries (slate-stone-architectural-h73, valmax-photography-landing) so
// this test proves the ranking algorithm's properties in isolation; the
// end-to-end proof against the real catalogue lives in
// apps/daemon/tests/routes/catalogue-match.test.ts.

import { describe, expect, it } from 'vitest';
import {
  CATALOGUE_MATCH_DEFAULT_LIMIT,
  CATALOGUE_MATCH_MAX_LIMIT,
  matchCatalogue,
  type CatalogueMatchCandidate,
} from '../src/api/catalogue-match.js';
import { renderCatalogueMatchBlock } from '../src/prompts/catalogue-match-block.js';

const slateStone: CatalogueMatchCandidate = {
  id: 'slate-stone-architectural-h73',
  kind: 'design-template',
  name: 'slate-stone-architectural-h73',
  description:
    'A single-page marketing landing site for "Slate & Stone", a fictional ultra-high-net-worth architectural real-estate advisory. Gallery Minimalism aesthetic — hairline rules, generous whitespace, oversized condensed uppercase display type.',
  triggers: ['slate & stone', 'slate', 'stone', 'architectural', 'real-estate', 'advisory', 'landing', 'landing-page'],
};

const valmax: CatalogueMatchCandidate = {
  id: 'valmax-photography-landing',
  kind: 'design-template',
  name: 'valmax-photography-landing',
  description:
    'Valmax is a single-page React landing site for the fictional cinematic photography studio of Ralph Edwards. A visually striking photography portfolio landing page suited to creative studios, cinematographers, and visual artists.',
  triggers: ['valmax', 'ralph', 'edwards', 'cinematic', 'photography', 'studio', 'landing', 'landing-page'],
};

// A distractor with the exact same generic triggers as the two above but no
// specific overlap with the architectural-photography brief — proves the
// ranking doesn't just reward "is a landing page template".
const genericLanding: CatalogueMatchCandidate = {
  id: 'generic-saas-landing',
  kind: 'design-template',
  name: 'generic-saas-landing',
  description: 'A clean, modern landing page template for a SaaS product.',
  triggers: ['saas', 'landing', 'landing-page', 'hero', 'section'],
};

const scheduleSkill: CatalogueMatchCandidate = {
  id: 'employee-onboarding-deck',
  kind: 'skill',
  name: 'employee-onboarding-deck',
  description: 'Build an employee onboarding slide deck covering benefits, culture, and first-week logistics.',
  triggers: ['employee-onboarding-deck', 'onboarding', 'hr', 'training-deck'],
};

const CATALOGUE = [slateStone, valmax, genericLanding, scheduleSkill];

const ARCHITECTURAL_PHOTOGRAPHY_BRIEF =
  "I run an architectural photography studio and need a landing page — moody, cinematic, editorial black-and-white portfolio showcasing real estate and residential architecture work, elegant serif typography, minimal navigation.";

describe('matchCatalogue', () => {
  it('surfaces slate-stone-architectural-h73 and valmax-photography-landing for an architectural-photography brief, ranked above a generic distractor', () => {
    const matches = matchCatalogue(CATALOGUE, ARCHITECTURAL_PHOTOGRAPHY_BRIEF);
    const ids = matches.map((m) => m.id);

    expect(ids).toContain('slate-stone-architectural-h73');
    expect(ids).toContain('valmax-photography-landing');
    expect(ids).not.toContain('generic-saas-landing');
    expect(ids).not.toContain('employee-onboarding-deck');

    // Every returned match must carry the evidence that earned it a slot.
    for (const match of matches) {
      expect(match.score).toBeGreaterThan(0);
      expect(match.matchedTerms.length).toBeGreaterThan(0);
    }

    const slate = matches.find((m) => m.id === 'slate-stone-architectural-h73');
    expect(slate?.matchedTerms).toEqual(expect.arrayContaining(['architectural']));
    const val = matches.find((m) => m.id === 'valmax-photography-landing');
    expect(val?.matchedTerms).toEqual(expect.arrayContaining(['cinematic', 'photography', 'studio']));
  });

  it('returns an empty shortlist for a brief built only from generic/stopword vocabulary', () => {
    const matches = matchCatalogue(CATALOGUE, 'Build me a landing page template for my website');
    expect(matches).toEqual([]);
  });

  it('returns an empty shortlist for a nonsense brief with no catalogue overlap', () => {
    const matches = matchCatalogue(CATALOGUE, 'Xyzzy qwerty foobar plugh grault');
    expect(matches).toEqual([]);
  });

  it('returns an empty shortlist for empty or whitespace-only text', () => {
    expect(matchCatalogue(CATALOGUE, '')).toEqual([]);
    expect(matchCatalogue(CATALOGUE, '   ')).toEqual([]);
  });

  it('is case- and punctuation-insensitive', () => {
    const lower = matchCatalogue(CATALOGUE, ARCHITECTURAL_PHOTOGRAPHY_BRIEF.toLowerCase());
    const upper = matchCatalogue(CATALOGUE, ARCHITECTURAL_PHOTOGRAPHY_BRIEF.toUpperCase());
    const punctuated = matchCatalogue(
      CATALOGUE,
      'Architectural?! photography... studio, cinematic — real estate.',
    );
    expect(lower.map((m) => m.id).sort()).toEqual(upper.map((m) => m.id).sort());
    expect(punctuated.map((m) => m.id)).toEqual(expect.arrayContaining(['slate-stone-architectural-h73', 'valmax-photography-landing']));
  });

  it('scores a multi-word trigger phrase higher than an equivalent single-word match, and only on a real phrase hit', () => {
    const single: CatalogueMatchCandidate = {
      id: 'single-word-candidate',
      kind: 'skill',
      name: 'single-word-candidate',
      description: 'A candidate matched on one single-word trigger.',
      triggers: ['architectural'],
    };
    const phrase: CatalogueMatchCandidate = {
      id: 'phrase-candidate',
      kind: 'skill',
      name: 'phrase-candidate',
      description: 'A candidate matched on one multi-word trigger phrase.',
      triggers: ['real estate'],
    };
    const [singleMatch] = matchCatalogue([single], ARCHITECTURAL_PHOTOGRAPHY_BRIEF);
    const [phraseMatch] = matchCatalogue([phrase], ARCHITECTURAL_PHOTOGRAPHY_BRIEF);
    expect(singleMatch?.score).toBeDefined();
    expect(phraseMatch?.score).toBeDefined();
    expect((phraseMatch?.score ?? 0)).toBeGreaterThan(singleMatch?.score ?? 0);

    // A trigger word embedded inside a longer brief word must not fire
    // (word-boundary safety) — "art" must not match inside "architectural".
    const artTrigger: CatalogueMatchCandidate = {
      id: 'art-candidate',
      kind: 'skill',
      name: 'art-candidate',
      description: 'An unrelated fine-art candidate that should not fire on a word fragment.',
      triggers: ['art'],
    };
    expect(matchCatalogue([artTrigger], ARCHITECTURAL_PHOTOGRAPHY_BRIEF)).toEqual([]);
  });

  it('never pads the list with a hyphenated/spaced trigger variant mismatch', () => {
    // "real-estate" (hyphenated) must still match a brief that writes it
    // "real estate" (spaced) — both normalize to the same phrase.
    const hyphenated: CatalogueMatchCandidate = {
      id: 'hyphen-candidate',
      kind: 'skill',
      name: 'hyphen-candidate',
      description: 'Hyphenated trigger candidate.',
      triggers: ['real-estate'],
    };
    const matches = matchCatalogue([hyphenated], 'I need a site for my real estate photography business.');
    expect(matches.map((m) => m.id)).toEqual(['hyphen-candidate']);
  });

  it('ranks by score descending, tie-breaking by id ascending', () => {
    const a: CatalogueMatchCandidate = {
      id: 'zzz-tie',
      kind: 'skill',
      name: 'zzz-tie',
      description: 'A tie candidate.',
      triggers: ['cinematic'],
    };
    const b: CatalogueMatchCandidate = {
      id: 'aaa-tie',
      kind: 'skill',
      name: 'aaa-tie',
      description: 'A tie candidate.',
      triggers: ['cinematic'],
    };
    const matches = matchCatalogue([a, b], ARCHITECTURAL_PHOTOGRAPHY_BRIEF);
    expect(matches.map((m) => m.id)).toEqual(['aaa-tie', 'zzz-tie']);
  });

  it('defaults the shortlist to CATALOGUE_MATCH_DEFAULT_LIMIT and clamps a requested limit to CATALOGUE_MATCH_MAX_LIMIT', () => {
    const many: CatalogueMatchCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      id: `studio-${i}`,
      kind: 'skill' as const,
      name: `studio-${i}`,
      description: `Studio candidate number ${i}.`,
      triggers: ['photography', 'cinematic', 'studio'],
    }));
    expect(matchCatalogue(many, ARCHITECTURAL_PHOTOGRAPHY_BRIEF)).toHaveLength(CATALOGUE_MATCH_DEFAULT_LIMIT);
    expect(matchCatalogue(many, ARCHITECTURAL_PHOTOGRAPHY_BRIEF, { limit: 100 })).toHaveLength(CATALOGUE_MATCH_MAX_LIMIT);
    expect(matchCatalogue(many, ARCHITECTURAL_PHOTOGRAPHY_BRIEF, { limit: 1 })).toHaveLength(1);
  });

  it('is deterministic — same inputs produce the same ranked output', () => {
    const first = matchCatalogue(CATALOGUE, ARCHITECTURAL_PHOTOGRAPHY_BRIEF);
    const second = matchCatalogue(CATALOGUE, ARCHITECTURAL_PHOTOGRAPHY_BRIEF);
    expect(first).toEqual(second);
  });
});

describe('renderCatalogueMatchBlock', () => {
  it('returns an empty string for no matches', () => {
    expect(renderCatalogueMatchBlock([])).toBe('');
  });

  it('renders a ranked, labeled shortlist that names every match id', () => {
    const matches = matchCatalogue(CATALOGUE, ARCHITECTURAL_PHOTOGRAPHY_BRIEF);
    const block = renderCatalogueMatchBlock(matches);
    expect(block).toContain('## Library shortlist');
    for (const match of matches) {
      expect(block).toContain(match.id);
    }
    expect(block).toContain('Nothing here was auto-applied');
  });
});
