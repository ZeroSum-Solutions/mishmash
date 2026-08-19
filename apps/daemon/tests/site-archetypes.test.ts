import { describe, expect, it } from 'vitest';
import { ARCHETYPES, POETRY_ARCHETYPE } from '../src/design/index.js';

describe('site-archetypes: poetry archetype (F001 R3)', () => {
  it('is registered under ARCHETYPES.poetry', () => {
    expect(ARCHETYPES.poetry).toBe(POETRY_ARCHETYPE);
  });

  it('carries all four Addendum A.3 directions with their exact hexes', () => {
    const byId = Object.fromEntries(POETRY_ARCHETYPE.directions.map((d) => [d.id, d]));
    expect(Object.keys(byId).sort()).toEqual(
      ['literary-journal', 'poet-portfolio', 'small-press-bookshop', 'zine-risograph'].sort(),
    );
    expect(byId['literary-journal']?.palette).toMatchObject({
      background: '#FAF7F2',
      text: '#1A1A18',
      muted: '#6B6862',
      rule: '#E0DAD0',
      accent: '#8A3324',
    });
    expect(byId['zine-risograph']?.palette.accent).toEqual(['#FF4A1C', '#2B44FF']);
  });

  it("derives requiredSections as the union of every direction's sections", () => {
    expect(POETRY_ARCHETYPE.requiredSections.slice().sort()).toEqual(
      [
        'about', 'bio', 'contact', 'featured-poems', 'hero', 'mailing-list',
        'poem-layout', 'readings-calendar', 'shop-grid',
      ].sort(),
    );
  });

  it('carries the exact typesetting constraints from Addendum A.3', () => {
    expect(POETRY_ARCHETYPE.typesetting).toEqual({
      bodySizePx: [19, 21],
      lineHeight: [1.65, 1.75],
      measureCh: 62,
      measureCss: 'max-width: 34rem',
      poemAlignment: 'left',
      disallowedAlignment: ['center', 'justify'],
      preserveLineBreaks: true,
      hangingIndentOnWrap: true,
    });
  });

  it('names the R5 80ch/centering example in its disqualifiers', () => {
    const descriptions = POETRY_ARCHETYPE.disqualifiers.map((d) => d.description).join(' ');
    expect(descriptions).toMatch(/80ch/);
    expect(descriptions.toLowerCase()).toMatch(/center/);
  });
});
