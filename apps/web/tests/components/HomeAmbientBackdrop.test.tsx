import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeAmbientBackdrop } from '../../src/components/home-hero/HomeAmbientBackdrop';

describe('HomeAmbientBackdrop', () => {
  it('renders a non-interactive canvas sourced from the bundled aurora example', () => {
    const markup = renderToStaticMarkup(<HomeAmbientBackdrop />);

    expect(markup).toContain('data-testid="home-ambient-canvas"');
    expect(markup).toContain('data-source="webgl-aurora-veil"');
    expect(markup).toContain('aria-hidden="true"');
  });
});
