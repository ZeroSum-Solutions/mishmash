// css-analyzer facts feeding the live brand-extraction path.
//
// `extractColors` infers a colour's role by regex-scanning the ~900 chars of
// CSS text before the match (`colorSourceForMatch`). That guess is wrong
// whenever the declaration is minified, spans a line break, or sits inside a
// shorthand — and the role is what decides whether a colour becomes the
// brand's text colour or its background.
//
// `analyzeCssFacts` parses the sheet and knows the actual property. These
// tests pin that the parsed answer reaches real candidates, so the extractor
// is no longer relying only on the guess.

import { describe, expect, it } from 'vitest';
import { annotateColorRoles, extractColors } from '../src/brands/prefetch.js';

const CSS = `
  body { color: #111827; background: #ffffff; }
  .btn { background: #0a5cff; color: #FFF; }
  .card { border-color: #e5e7eb; }
`;

function sourcesFor(hex: string, css = CSS): string[] {
  const annotated = annotateColorRoles(extractColors(css), css);
  return annotated.find((c) => c.hex === hex)?.sources ?? [];
}

describe('annotateColorRoles', () => {
  it('tags a text colour with the role parsed CSS observed', () => {
    expect(sourcesFor('#111827')).toContain('role:text');
  });

  it('tags a background colour with the background role', () => {
    expect(sourcesFor('#0a5cff')).toContain('role:background');
  });

  it('tags a border colour with the border role', () => {
    expect(sourcesFor('#e5e7eb')).toContain('role:border');
  });

  it('records both roles for a colour used as text and as background', () => {
    // White is `background` on body and `color` on .btn. A single-role answer
    // would misrepresent it, and which role wins would depend on which
    // declaration the regex happened to reach first.
    const sources = sourcesFor('#ffffff');
    expect(sources).toContain('role:background');
    expect(sources).toContain('role:text');
  });

  it('preserves the evidence the extractor already gathered', () => {
    const before = extractColors(CSS);
    const after = annotateColorRoles(before, CSS);
    for (const candidate of before) {
      const match = after.find((c) => c.hex === candidate.hex);
      for (const source of candidate.sources ?? []) {
        expect(match?.sources).toContain(source);
      }
    }
  });

  it('does not invent, drop, or reorder candidates', () => {
    // Role evidence is additive. Changing the candidate set here would
    // silently re-rank a brand's palette.
    const before = extractColors(CSS);
    const after = annotateColorRoles(before, CSS);
    expect(after.map((c) => c.hex)).toEqual(before.map((c) => c.hex));
    expect(after.map((c) => c.count)).toEqual(before.map((c) => c.count));
  });

  it('returns the candidates unchanged when the CSS cannot be parsed', () => {
    const before = extractColors('a{color:#0a5cff}');
    const after = annotateColorRoles(before, '}}}{{{ not css');
    expect(after.map((c) => c.hex)).toEqual(before.map((c) => c.hex));
  });

  it('is safe on an empty candidate list', () => {
    expect(annotateColorRoles([], CSS)).toEqual([]);
  });
});
