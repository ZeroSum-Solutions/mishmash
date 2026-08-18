import { describe, expect, it } from 'vitest';

import { fontFaceCss, parseWebfontFaces, webfontFileSlug } from '../src/brands/webfonts.js';

describe('shared webfont harvesting primitives', () => {
  it('retains subset comments, resolves relative URLs, and prefers woff2 sources', () => {
    const css = `
/* latin-ext */
@font-face {
  font-family: 'Example Sans';
  font-style: normal;
  font-weight: 100 900;
  src: url('./example.woff') format('woff'), url('./example.woff2') format('woff2-variations');
  unicode-range: U+0100-02BA;
}
/* latin */
@font-face {
  font-family: 'Example Sans';
  src: url('/fonts/example-latin.woff2') format('woff2');
}
`;

    const faces = parseWebfontFaces(css, 'https://font.example/css/main.css');

    expect(faces).toHaveLength(2);
    expect(faces[0]).toMatchObject({
      family: 'Example Sans',
      weight: '100 900',
      style: 'normal',
      subset: 'latin-ext',
      format: 'woff2',
      url: 'https://font.example/css/example.woff2',
      unicodeRange: 'U+0100-02BA',
    });
    expect(faces[1]?.subset).toBe('latin');
    expect(faces[1]?.url).toBe('https://font.example/fonts/example-latin.woff2');
  });

  it('parses icon faces for catalogue vendoring and emits stable local CSS', () => {
    const [face] = parseWebfontFaces(
      `@font-face { font-family: 'Material Symbols Rounded'; src: url(font.woff2) format('woff2'); }`,
      'https://fonts.example/styles.css',
    );
    expect(face?.family).toBe('Material Symbols Rounded');

    const file = `${webfontFileSlug(face!)}.woff2`;
    const css = fontFaceCss([{ ...face!, file }], './');
    expect(css).toContain(`src: url("./${file}") format("woff2")`);
    expect(webfontFileSlug(face!)).toBe(webfontFileSlug(face!));
  });

  it('does not treat a provider family-label comment as a language subset', () => {
    const [face] = parseWebfontFaces(
      `/* Gambarino */\n@font-face { font-family: 'Gambarino'; src: url(font.woff2) format('woff2'); }`,
      'https://api.fontshare.com/v2/css',
    );
    expect(face?.subset).toBeUndefined();
  });
});
