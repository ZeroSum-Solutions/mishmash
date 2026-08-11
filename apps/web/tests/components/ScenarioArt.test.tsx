import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ScenarioArt } from '../../src/components/home-hero/ScenarioArt';

const MOTIONSITE_CHIPS = [
  'template',
  'scroll-film',
  'hero-creation',
  'clone-rebrand',
  'scroll-animations',
  'webgl',
] as const;

describe('ScenarioArt', () => {
  it.each(MOTIONSITE_CHIPS)('renders a large two-tone illustration for %s', (chipId) => {
    const markup = renderToStaticMarkup(
      <ScenarioArt chipId={chipId} fallbackIcon="sparkles" />,
    );

    expect(markup).toContain(`data-scenario-art="${chipId}"`);
    expect(markup).toContain('width="72"');
    expect(markup).toContain('var(--text-muted)');
    expect(markup).toContain('var(--accent)');
  });
});
