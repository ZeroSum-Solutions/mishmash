// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplatesSection } from '../../src/components/TemplatesSection';
import { openSandboxedUrlInNewTab } from '../../src/runtime/exports';
import type { SkillSummary } from '../../src/types';

vi.mock('../../src/runtime/exports', () => ({
  openSandboxedUrlInNewTab: vi.fn(),
}));

// TemplateThumb gates its rendered preview behind an IntersectionObserver so
// off-screen cards never spin up 300 iframes at once. Report every observed
// node as intersecting immediately, so cards render their real preview
// synchronously in tests instead of staying on `visible: false`.
type IntersectionCallback = (entries: Pick<IntersectionObserverEntry, 'target' | 'isIntersecting'>[]) => void;

class EagerIntersectionObserver {
  #callback: IntersectionCallback;
  constructor(callback: IntersectionCallback) {
    this.#callback = callback;
  }
  observe(target: Element) {
    this.#callback([{ target, isIntersecting: true }]);
  }
  unobserve() {}
  disconnect() {}
}
const originalIntersectionObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  globalThis.IntersectionObserver = EagerIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  globalThis.IntersectionObserver = originalIntersectionObserver;
});

function skill(overrides: Partial<SkillSummary> & Pick<SkillSummary, 'id' | 'name'>): SkillSummary {
  return {
    id: overrides.id,
    name: overrides.name,
    description: overrides.description ?? `${overrides.name} example`,
    triggers: overrides.triggers ?? [],
    mode: overrides.mode ?? 'template',
    surface: overrides.surface ?? 'web',
    platform: overrides.platform ?? 'desktop',
    scenario: overrides.scenario ?? 'general',
    category: overrides.category ?? null,
    previewType: overrides.previewType ?? 'html',
    designSystemRequired: overrides.designSystemRequired ?? false,
    defaultFor: overrides.defaultFor ?? [],
    upstream: overrides.upstream ?? null,
    featured: overrides.featured ?? null,
    fidelity: overrides.fidelity ?? null,
    speakerNotes: overrides.speakerNotes ?? null,
    animations: overrides.animations ?? null,
    craftRequires: overrides.craftRequires ?? [],
    hasBody: overrides.hasBody ?? true,
    examplePrompt: overrides.examplePrompt ?? `Build ${overrides.name}.`,
    aggregatesExamples: overrides.aggregatesExamples ?? false,
  };
}

describe('TemplatesSection card contract', () => {
  it('renders the full card shape: cover, single-line title, clamped description, metadata row, and reachable actions', async () => {
    const templates = [
      skill({
        id: 'landing-hero',
        name: 'Landing Hero',
        description: 'A bold above-the-fold hero for product landing pages.',
        mode: 'prototype',
      }),
    ];
    render(<TemplatesSection templates={templates} active onUseTemplate={vi.fn()} />);

    const card = screen.getByTestId('templates-card');
    expect(card.querySelector('.templates-card__thumb')).toBeTruthy();
    expect(card.querySelector('.templates-card__title')?.textContent).toBe('Landing Hero');
    expect(card.querySelector('.templates-card__description')?.textContent).toBe(
      'A bold above-the-fold hero for product landing pages.',
    );
    expect(card.querySelector('.templates-card__meta')).toBeTruthy();

    // The card is the single entry point into its actions (Open live preview,
    // Start a project) — the master-detail pattern this gallery uses.
    fireEvent.click(card);
    const dialog = await screen.findByTestId('templates-viewer');
    expect(within(dialog).getByTestId('templates-open-live')).toBeTruthy();
    expect(within(dialog).getByTestId('templates-use')).toBeTruthy();

    fireEvent.click(within(dialog).getByTestId('templates-open-live'));
    expect(openSandboxedUrlInNewTab).toHaveBeenCalled();
  });

  it('swaps a failed poster image to the live preview fallback instead of a broken-image glyph', () => {
    const templates = [skill({ id: 'broken-poster', name: 'Broken Poster' })];
    render(<TemplatesSection templates={templates} active onUseTemplate={vi.fn()} />);

    const card = screen.getByTestId('templates-card');
    // The poster/frame are decorative (alt=""), so they never expose an
    // accessible "img" role — query the element directly.
    const poster = card.querySelector('img') as HTMLImageElement;
    expect(poster).toBeTruthy();
    expect(card.querySelector('iframe')).toBeNull();

    fireEvent.error(poster);

    // Never a broken-image glyph, never an empty collapse: the poster's
    // onError swaps to the live rendered preview, which still fills the
    // 16/10 cover slot.
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('iframe')).toBeTruthy();
  });

  it('keeps the poster hidden until it decodes, so a failed load never flashes a broken-image glyph', () => {
    const templates = [skill({ id: 'loading-poster', name: 'Loading Poster' })];
    render(<TemplatesSection templates={templates} active onUseTemplate={vi.fn()} />);

    const card = screen.getByTestId('templates-card');
    const poster = card.querySelector('img') as HTMLImageElement;
    expect(poster.classList.contains('is-loaded')).toBe(false);

    fireEvent.load(poster);
    expect(poster.classList.contains('is-loaded')).toBe(true);
  });

  it('renders the shared fallback immediately for an entry with no rendered example, without ever mounting an img', () => {
    const templates = [
      skill({ id: 'no-preview', name: 'Docs Only Template', previewType: 'markdown' }),
    ];
    render(<TemplatesSection templates={templates} active onUseTemplate={vi.fn()} />);

    const card = screen.getByTestId('templates-card');
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('iframe')).toBeNull();
    expect(within(card).getByText('This template ships no rendered example.')).toBeTruthy();
  });
});

// PRD C12: the tab leads with websites (landing-page), splits out web-app
// and dashboard as their own sections, then groups everything else in a
// fixed order. See scripts/design-taxonomy.mjs for the canonical taxonomy
// this section order is derived from.
describe('TemplatesSection category sections', () => {
  function sectionCategories() {
    return screen.getAllByTestId('templates-section').map((el) => el.getAttribute('data-category'));
  }

  it('renders sections in the specified order with landing-page first', () => {
    const templates = [
      skill({ id: 'tool-1', name: 'Tool One', category: 'tool' }),
      skill({ id: 'deck-1', name: 'Deck One', category: 'deck' }),
      skill({ id: 'landing-1', name: 'Landing One', category: 'landing-page' }),
      skill({ id: 'email-1', name: 'Email One', category: 'email' }),
    ];
    render(<TemplatesSection templates={templates} active onUseTemplate={vi.fn()} />);

    // Fixed taxonomy order (scripts/design-taxonomy.mjs / SECTION_ORDER):
    // landing-page leads, tool is always last, deck/email fall in between.
    expect(sectionCategories()).toEqual(['landing-page', 'deck', 'email', 'tool']);
  });

  it('renders web-app and dashboard as separate sections, immediately after landing-page', () => {
    const templates = [
      skill({ id: 'dash-1', name: 'Dash One', category: 'dashboard' }),
      skill({ id: 'web-1', name: 'Web One', category: 'web-app' }),
      skill({ id: 'landing-1', name: 'Landing One', category: 'landing-page' }),
    ];
    render(<TemplatesSection templates={templates} active onUseTemplate={vi.fn()} />);

    expect(sectionCategories()).toEqual(['landing-page', 'web-app', 'dashboard']);
    const dashboardSection = screen
      .getAllByTestId('templates-section')
      .find((el) => el.getAttribute('data-category') === 'dashboard')!;
    expect(within(dashboardSection).getAllByTestId('templates-card')).toHaveLength(1);
    const webAppSection = screen
      .getAllByTestId('templates-section')
      .find((el) => el.getAttribute('data-category') === 'web-app')!;
    expect(within(webAppSection).getAllByTestId('templates-card')).toHaveLength(1);
  });

  it('filters to one category when it is chosen', () => {
    // The category facet is a labelled select rather than a row of chips
    // (F007 R1): same behaviour, one control, and it no longer overflows.
    const templates = [
      skill({ id: 'landing-1', name: 'Landing One', category: 'landing-page' }),
      skill({ id: 'deck-1', name: 'Deck One', category: 'deck' }),
    ];
    render(<TemplatesSection templates={templates} active onUseTemplate={vi.fn()} />);

    expect(sectionCategories()).toEqual(['landing-page', 'deck']);

    const categorySelect = screen.getByTestId('templates-category-select') as HTMLSelectElement;
    fireEvent.change(categorySelect, { target: { value: 'deck' } });

    expect(sectionCategories()).toEqual(['deck']);
    expect(categorySelect.value).toBe('deck');
    expect(screen.getByTestId('templates-card').getAttribute('data-template-id')).toBe('deck-1');
  });

  it('offers no option for a category with zero templates', () => {
    const templates = [skill({ id: 'landing-1', name: 'Landing One', category: 'landing-page' })];
    render(<TemplatesSection templates={templates} active onUseTemplate={vi.fn()} />);

    expect(sectionCategories()).toEqual(['landing-page']);
    const options = Array.from(
      (screen.getByTestId('templates-category-select') as HTMLSelectElement).options,
    ).map((option) => option.value);
    // Only "all" and the one populated category are offered — every other
    // taxonomy category (dashboard, web-app, deck, tool, ...) is absent.
    expect(options).toEqual(['all', 'landing-page']);
  });
});

// F007 R2: search is a facet like source/category — it must surface in the
// active-filters summary, and "Clear filters" must reset it along with
// everything else. Regression coverage for a bug where Clear filters reset
// source+category but left `query` (and its chip) untouched.
describe('TemplatesSection active filters', () => {
  it('shows a chip for an active search query and clears it on "Clear filters"', () => {
    const templates = [
      skill({ id: 'landing-1', name: 'Landing One', category: 'landing-page' }),
      skill({ id: 'deck-1', name: 'Deck One', category: 'deck' }),
    ];
    render(<TemplatesSection templates={templates} active onUseTemplate={vi.fn()} />);

    const search = screen.getByTestId('templates-search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'deck' } });
    expect(search.value).toBe('deck');

    const summary = screen.getByRole('group', { name: 'Active filters' });
    expect(within(summary).getByText('deck')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(search.value).toBe('');
    // Every chip — including the search chip — is gone, so the summary
    // itself renders nothing.
    expect(screen.queryByRole('group', { name: 'Active filters' })).toBeNull();
  });
});

// PRD C8 — the create-from-template action opens the shared GuidedCreateDialog
// in front of the existing single-click create, instead of creating directly.
describe('TemplatesSection guided create wiring', () => {
  it('opens the guided create dialog from Start, and Skip all creates with no brief', async () => {
    const onUseTemplate = vi.fn().mockResolvedValue(true);
    const templates = [skill({ id: 'landing-hero', name: 'Landing Hero' })];
    render(<TemplatesSection templates={templates} active onUseTemplate={onUseTemplate} />);

    fireEvent.click(screen.getByTestId('templates-card'));
    const viewer = await screen.findByTestId('templates-viewer');
    fireEvent.click(within(viewer).getByTestId('templates-use'));

    const dialog = await screen.findByTestId('guided-create-dialog');
    fireEvent.click(within(dialog).getByTestId('guided-create-skip'));

    await waitFor(() => expect(onUseTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'landing-hero' }),
      undefined,
    ));
  });

  it('collects guided create answers into the brief forwarded to onUseTemplate', async () => {
    const onUseTemplate = vi.fn().mockResolvedValue(true);
    const templates = [skill({ id: 'landing-hero', name: 'Landing Hero' })];
    render(<TemplatesSection templates={templates} active onUseTemplate={onUseTemplate} />);

    fireEvent.click(screen.getByTestId('templates-card'));
    const viewer = await screen.findByTestId('templates-viewer');
    fireEvent.click(within(viewer).getByTestId('templates-use'));

    const dialog = await screen.findByTestId('guided-create-dialog');
    const fidelityButtons = within(dialog).getAllByTestId('guided-create-fidelity');
    fireEvent.click(fidelityButtons.find((el) => el.getAttribute('data-value') === 'wireframe')!);
    fireEvent.click(within(dialog).getByTestId('guided-create-start'));

    await waitFor(() => expect(onUseTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'landing-hero' }),
      { fidelity: 'wireframe' },
    ));
  });

  it('keeps the originating template preview locked while project creation is in flight', async () => {
    let resolveCreate!: (value: boolean) => void;
    const onUseTemplate = vi.fn(
      () => new Promise<boolean>((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const templates = [skill({ id: 'landing-hero', name: 'Landing Hero' })];
    render(<TemplatesSection templates={templates} active onUseTemplate={onUseTemplate} />);

    fireEvent.click(screen.getByTestId('templates-card'));
    const viewer = await screen.findByTestId('templates-viewer');
    fireEvent.click(within(viewer).getByTestId('templates-use'));
    fireEvent.click(await screen.findByTestId('guided-create-skip'));

    const close = within(viewer).getByRole('button', { name: 'Close preview' }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('templates-viewer')).toBeTruthy();

    resolveCreate(true);
    await waitFor(() => expect(screen.queryByTestId('templates-viewer')).toBeNull());
  });
});
