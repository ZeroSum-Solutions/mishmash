// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamplesTab } from '../../src/components/ExamplesTab';
import { fetchSkillExample } from '../../src/providers/registry';
import type { SkillSummary } from '../../src/types';

vi.mock('../../src/providers/registry', () => ({
  fetchSkillExample: vi.fn(),
}));

const mockedFetch = fetchSkillExample as unknown as ReturnType<typeof vi.fn>;

function skill(overrides: Partial<SkillSummary> & Pick<SkillSummary, 'id' | 'name'>): SkillSummary {
  const { id, name, ...rest } = overrides;
  return {
    id,
    name,
    description: `${name} description`,
    triggers: [id],
    mode: 'prototype',
    surface: 'web',
    platform: 'desktop',
    scenario: 'general',
    previewType: 'web',
    designSystemRequired: false,
    defaultFor: [],
    upstream: null,
    aggregatesExamples: false,
    hasBody: true,
    examplePrompt: `Build ${name}`,
    ...rest,
  };
}

function renderExamples(skills: SkillSummary[]) {
  render(<ExamplesTab skills={skills} onUsePrompt={() => {}} />);
}

// Reads the visible option labels of a FilterSelect. Options render as
// `Label (N)` when the option carries a count.
function optionLabels(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole('option')
    .map((option) => (option.textContent ?? '').trim());
}

describe('ExamplesTab filter counts', () => {
  beforeEach(() => {
    mockedFetch.mockResolvedValue({ html: '<main>preview</main>' });
  });

  afterEach(() => {
    cleanup();
    mockedFetch.mockReset();
  });

  it('keeps the Scenario All count scoped to surface and type, not the selected scenario', () => {
    renderExamples([
      skill({ id: 'eng-desktop', name: 'Engineering desktop', scenario: 'engineering' }),
      skill({ id: 'eng-deck', name: 'Engineering deck', mode: 'deck', scenario: 'engineering' }),
      skill({ id: 'product-desktop', name: 'Product desktop', scenario: 'product' }),
      skill({ id: 'product-mobile', name: 'Product mobile', platform: 'mobile', scenario: 'product' }),
    ]);

    // F007 migrated these filters from pill tablists to the shared FilterSelect
    // primitive, which renders a native select whose options read "Label (N)".
    // The count semantics under test are unchanged; only the control differs.
    const scenarioFilters = screen.getByRole('combobox', { name: 'Scenario' });
    expect(optionLabels(scenarioFilters)).toContain('All (4)');

    const typeFilters = screen.getByRole('combobox', { name: 'Type' });
    fireEvent.change(typeFilters, { target: { value: 'prototype-desktop' } });

    expect(optionLabels(scenarioFilters)).toContain('All (2)');
    expect(optionLabels(scenarioFilters)).toContain('Engineering (1)');
    expect(optionLabels(scenarioFilters)).toContain('Product (1)');

    fireEvent.change(scenarioFilters, { target: { value: 'product' } });

    expect(optionLabels(scenarioFilters)).toContain('All (2)');
    expect(optionLabels(scenarioFilters)).toContain('Product (1)');
  });

  it('uses media tags for media examples so visible tags do not imply zero-count prototype types', () => {
    renderExamples([
      skill({ id: 'web-prototype', name: 'Web prototype' }),
      skill({
        id: 'image-example',
        name: 'Image example',
        mode: 'image',
        surface: 'image',
        platform: null,
        previewType: 'image',
      }),
    ]);

    const surfaceFilters = screen.getByRole('combobox', { name: 'Surface' });
    fireEvent.change(surfaceFilters, { target: { value: 'image' } });

    const typeFilters = screen.getByRole('combobox', { name: 'Type' });
    expect(optionLabels(typeFilters)).toContain('All (1)');
    expect(optionLabels(typeFilters)).toContain('Prototypes · Desktop (0)');
    const imageCard = screen.getByTestId('example-card-image-example');
    expect(within(imageCard).getByText('Image')).toBeTruthy();
    expect(within(imageCard).queryByText('Desktop prototype')).toBeNull();
  });
});
