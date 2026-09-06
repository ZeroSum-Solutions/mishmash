// @vitest-environment jsdom

import { Profiler } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplatesSection } from '../../src/components/TemplatesSection';
import type { SkillSummary } from '../../src/types';

vi.mock('../../src/runtime/exports', () => ({
  openSandboxedUrlInNewTab: vi.fn(),
}));

class EagerIntersectionObserver {
  #callback: (entries: Pick<IntersectionObserverEntry, 'target' | 'isIntersecting'>[]) => void;
  constructor(callback: (entries: Pick<IntersectionObserverEntry, 'target' | 'isIntersecting'>[]) => void) {
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
  globalThis.IntersectionObserver = originalIntersectionObserver;
});

function skill(id: string, category: string): SkillSummary {
  return {
    id,
    name: `Template ${id}`,
    description: `${id} example`,
    triggers: [],
    mode: 'template',
    surface: 'web',
    platform: 'desktop',
    scenario: 'general',
    category,
    previewType: 'html',
    designSystemRequired: false,
    defaultFor: [],
    upstream: null,
    featured: null,
    fidelity: null,
    speakerNotes: null,
    animations: null,
    craftRequires: [],
    hasBody: true,
    examplePrompt: `Build ${id}.`,
    aggregatesExamples: false,
    hasPoster: false,
  };
}

// The live catalogue holds 561 templates. Mounting every card in the commit
// that activates the view costs 17-35 ms of React work on the route switch,
// which is the whole gap between /templates and the other home routes.
// The first commit must stay bounded to what fits above the fold; the rest
// of the catalogue follows in a deferred commit.
const CATALOGUE = Array.from({ length: 120 }, (_, i) => skill(`tpl-${String(i).padStart(3, '0')}`, i % 3 === 0 ? 'landing' : 'dashboard'));

describe('TemplatesSection progressive mount', () => {
  it('commits at most the above-the-fold cards first, then the whole catalogue', async () => {
    const cardsPerCommit: number[] = [];
    render(
      <Profiler
        id="templates"
        onRender={() => {
          cardsPerCommit.push(document.querySelectorAll('[data-testid="templates-card"]').length);
        }}
      >
        <TemplatesSection templates={CATALOGUE} active onUseTemplate={vi.fn()} />
      </Profiler>,
    );

    expect(cardsPerCommit[0]).toBeGreaterThan(0);
    expect(cardsPerCommit[0]).toBeLessThanOrEqual(24);
    await waitFor(() => expect(screen.getAllByTestId('templates-card')).toHaveLength(CATALOGUE.length));
  });

  it('mounts no preview frame until the whole catalogue has been committed', async () => {
    const commits: Array<{ cards: number; frames: number }> = [];
    render(
      <Profiler
        id="templates"
        onRender={() => {
          commits.push({
            cards: document.querySelectorAll('[data-testid="templates-card"]').length,
            frames: document.querySelectorAll('[data-testid="templates-card"] iframe').length,
          });
        }}
      >
        <TemplatesSection templates={CATALOGUE} active onUseTemplate={vi.fn()} />
      </Profiler>,
    );
    await waitFor(() => expect(document.querySelectorAll('[data-testid="templates-card"] iframe').length).toBe(CATALOGUE.length));

    // The eager IntersectionObserver stub reports every card visible at once,
    // so a frame in any commit before the full catalogue landed means the
    // route-switch paint waited on iframe documents.
    for (const commit of commits) {
      if (commit.cards < CATALOGUE.length) expect(commit).toEqual({ cards: commit.cards, frames: 0 });
    }
    expect(commits.some((commit) => commit.cards === CATALOGUE.length && commit.frames === 0)).toBe(true);
  });

  it('reports the whole catalogue in the header count from the first commit', () => {
    const countsPerCommit: string[] = [];
    render(
      <Profiler
        id="templates"
        onRender={() => {
          countsPerCommit.push(document.querySelector('.templates-view__count')?.textContent ?? '');
        }}
      >
        <TemplatesSection templates={CATALOGUE} active onUseTemplate={vi.fn()} />
      </Profiler>,
    );

    expect(countsPerCommit[0]).toContain(String(CATALOGUE.length));
  });
});
