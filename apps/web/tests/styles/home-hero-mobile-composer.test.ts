import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  new URL('../../src/styles/home/home-hero.css', import.meta.url),
  'utf8',
);

describe('home hero mobile composer', () => {
  it('stacks the composer tool groups instead of overlapping them', () => {
    const mobileStart = css.indexOf('@media (max-width: 560px)');
    const mobileEnd = css.indexOf('/* ------------------------------------------------------------', mobileStart);
    const mobile = css.slice(mobileStart, mobileEnd);

    expect(mobile).toMatch(
      /\.home-hero__input-foot\s*\{[^}]*flex-direction:\s*column;[^}]*align-items:\s*stretch;/s,
    );
    expect(mobile).toMatch(
      /\.home-hero__foot-right\s*\{[^}]*width:\s*100%;[^}]*justify-content:\s*flex-end;/s,
    );
  });
});
