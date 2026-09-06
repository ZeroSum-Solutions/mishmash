import { describe, expect, it } from 'vitest';

import type { PromptTemplateSummary } from '@open-design/contracts';

import { metadataForHomeMediaComposer } from '../../../src/components/home-hero/media-surfaces';

// `PromptTemplateSummary.aspect` describes the wire and the shipped catalogue
// serves `2:3`; `PromptTemplateMetadata.aspect` describes what the media
// surfaces can act on and is persisted on the project, where the agent reads it
// every turn. The narrowing between them is what keeps a ratio the product
// cannot offer out of that persisted record — and the system prompt prints
// "(unknown — ask: …)" for an unset field, so dropping it makes the agent ask
// rather than act on a value it cannot use.
//
// Pinning it here because the previous web-private copy of this type declared
// `aspect: MediaAspect` and was simply wrong about the wire: the assignment
// typechecked and the unsupported ratio was persisted anyway.

function template(overrides: Partial<PromptTemplateSummary> = {}): PromptTemplateSummary {
  return {
    category: 'portrait',
    id: 'studio-portrait',
    source: { license: 'CC-BY-4.0', repo: 'example/prompts' },
    summary: 'A softly lit studio portrait.',
    surface: 'image',
    title: 'Studio portrait',
    ...overrides,
  };
}

describe('metadataForHomeMediaComposer prompt-template aspect', () => {
  it('persists a ratio the media surfaces offer', () => {
    const metadata = metadataForHomeMediaComposer(
      'image',
      { template: 'studio-portrait' },
      [template({ aspect: '16:9' })],
    );
    expect(metadata.promptTemplate?.aspect).toBe('16:9');
  });

  it('leaves aspect unset for a catalogue ratio the surfaces do not offer', () => {
    const metadata = metadataForHomeMediaComposer(
      'image',
      { template: 'studio-portrait' },
      [template({ aspect: '2:3' })],
    );
    expect(metadata.promptTemplate).toBeDefined();
    expect(metadata.promptTemplate).not.toHaveProperty('aspect');
  });

  it('leaves aspect unset when the template declares none', () => {
    const metadata = metadataForHomeMediaComposer(
      'image',
      { template: 'studio-portrait' },
      [template()],
    );
    expect(metadata.promptTemplate).not.toHaveProperty('aspect');
  });
});
