// @vitest-environment jsdom
//
// Scenario-card rail coverage.
//   - The default create rail renders illustrated scenario cards carrying a
//     title AND a one-line description.
//   - The rail leads with Build a website, then Website clone, per the
//     curated create order (see CREATE_RAIL_ORDER in home-hero/chips.ts).
//   - The finer-grained scenarios (wireframe / mobile / document) exist and
//     route to a working scenario plugin.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const placeholderCarouselMock = vi.hoisted(() => ({
  reportScenario: false,
  reportedScenarioId: null as string | null,
}));

vi.mock('../../src/components/home-hero/PlaceholderCarousel', () => ({
  PlaceholderCarousel: ({
    scenarios,
    active,
    onScenarioChange,
  }: {
    scenarios: Array<{ id: string; chipId?: string | null; text: string }>;
    active: boolean;
    onScenarioChange: (scenario: { id: string; chipId?: string | null; text: string }) => void;
  }) => {
    const scenario = scenarios[0];
    if (
      placeholderCarouselMock.reportScenario &&
      active &&
      scenario &&
      placeholderCarouselMock.reportedScenarioId !== scenario.id
    ) {
      placeholderCarouselMock.reportedScenarioId = scenario.id;
      queueMicrotask(() => onScenarioChange(scenario));
    }
    return null;
  },
}));

import { HomeHero } from '../../src/components/HomeHero';
import { CREATE_RAIL_ORDER, findChip, orderedCreateChips } from '../../src/components/home-hero/chips';

afterEach(() => {
  placeholderCarouselMock.reportScenario = false;
  placeholderCarouselMock.reportedScenarioId = null;
  cleanup();
});

function renderHero(overrides: Partial<React.ComponentProps<typeof HomeHero>> = {}) {
  const props = {
    prompt: '',
    onPromptChange: () => undefined,
    onSubmit: () => undefined,
    activePluginTitle: null,
    activeChipId: null,
    onClearActivePlugin: () => undefined,
    pluginOptions: [],
    pluginsLoading: false,
    pendingPluginId: null,
    pendingChipId: null,
    onPickPlugin: () => undefined,
    onPickChip: () => undefined,
    contextItemCount: 0,
    error: null,
    ...overrides,
  } as React.ComponentProps<typeof HomeHero>;
  render(<HomeHero {...props} />);
}

describe('HomeHero scenario cards', () => {
  it('renders each create scenario card with a title and a description', () => {
    renderHero();
    const webClone = screen.getByTestId('home-hero-rail-web-clone');
    expect(webClone.textContent).toContain('Website clone');
    expect(webClone.textContent).toContain('Source-first site reproduction');

    const webgl = screen.getByTestId('home-hero-rail-webgl');
    expect(webgl.textContent).toContain('Shaders, 3D & generative GPU visuals');
  });

  it('leads the create rail with Build a website, then Website clone', () => {
    const ordered = orderedCreateChips();
    expect(ordered[0]?.id).toBe('template');
    expect(ordered[1]?.id).toBe('web-clone');
  });

  it('orders the full create rail: user chips first, then the powered/motion specialisations', () => {
    expect(CREATE_RAIL_ORDER).toEqual([
      'template',
      'web-clone',
      'scroll-film',
      'hero-creation',
      'clone-rebrand',
      'scroll-animations',
      'webgl',
      'hyperframes',
      'live-artifact',
    ]);
  });

  it('keeps the finer-grained scenarios reachable from the overflow menu, routed to a working scenario plugin', () => {
    renderHero();
    fireEvent.click(screen.getByTestId('home-hero-shortcuts-trigger'));
    const menu = screen.getByTestId('home-hero-shortcuts-menu');
    for (const id of ['wireframe', 'mobile', 'document']) {
      const card = screen.getByTestId(`home-hero-rail-${id}`);
      expect(menu.contains(card)).toBe(true);
      expect(findChip(id)?.action.kind).toBe('apply-scenario');
    }
    // Wireframe reuses the web-prototype seed at lo-fi fidelity.
    expect(findChip('wireframe')?.action).toMatchObject({
      pluginId: 'example-web-prototype',
      projectKind: 'prototype',
      projectMetadata: { kind: 'prototype', fidelity: 'wireframe' },
    });
    expect(findChip('document')?.action).toMatchObject({
      pluginId: 'od-new-generation',
      projectKind: 'other',
    });
  });

  it('keeps empty carousel scenario submit disabled while plugins are loading', async () => {
    placeholderCarouselMock.reportScenario = true;
    const onSubmit = vi.fn();
    const onSubmitScenario = vi.fn();
    renderHero({
      pluginsLoading: true,
      onSubmit,
      onSubmitScenario,
    });

    await waitFor(() => expect(placeholderCarouselMock.reportedScenarioId).not.toBeNull());
    const submit = screen.getByTestId('home-hero-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onSubmitScenario).not.toHaveBeenCalled();
  });
});
