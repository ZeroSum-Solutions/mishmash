import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const homeHeroSource = read('../../src/components/HomeHero.tsx');
const entryNavRailSource = read('../../src/components/EntryNavRail.tsx');
const logoSvg = read('../../public/logo.svg');
const brandIconSvg = read('../../public/brand-icon.svg');

// The current MishMash brand glyph is a minimal neutral monogram placeholder
// (P6 replaces it with a designed mark). Every export carries this marker
// comment so this spec can confirm the swap without depending on path data.
const CURRENT_GLYPH_MARKER = 'MishMash monogram mark';
// Retired glyphs: the pre-fork Open Design 444x444 dark tile (#202020, cursor
// arrow path 'M212.059'), and the later Open Design ink superellipse tile
// ('M41 0.726562') replaced by this fork's de-brand pass.
const RETIRED_GLYPH_MARKERS = ['#202020', 'M212.059', 'width="444"', 'M41 0.726562'];

describe('Home logo assets', () => {
  it('ships the current brand glyph in the public logo assets', () => {
    expect(logoSvg).toContain(CURRENT_GLYPH_MARKER);
    expect(brandIconSvg).toContain(CURRENT_GLYPH_MARKER);
    // Marker comments alone can lie — require the rendered MM monogram too.
    expect(logoSvg).toContain('>MM<');
    expect(brandIconSvg).toContain('>MM<');
    for (const marker of RETIRED_GLYPH_MARKERS) {
      expect(logoSvg).not.toContain(marker);
      expect(brandIconSvg).not.toContain(marker);
    }
  });

  it('keeps brand-icon.svg maskable (theme color comes from CSS)', () => {
    expect(brandIconSvg).toContain('currentColor');
  });

  it('renders the brand glyph on both Home entry surfaces', () => {
    expect(homeHeroSource).toContain('od-brand-glyph');
    expect(homeHeroSource).not.toContain('src="/app-icon.svg"');

    expect(entryNavRailSource).toContain('od-brand-glyph');
    expect(entryNavRailSource).not.toContain('src="/app-icon.svg"');
  });
});
