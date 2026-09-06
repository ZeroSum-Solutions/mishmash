// @vitest-environment jsdom

import { Profiler } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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

  it('marks the gallery busy until the whole catalogue has been committed', async () => {
    const commits: Array<{ cards: number; busy: string | null }> = [];
    render(
      <Profiler
        id="templates"
        onRender={() => {
          commits.push({
            cards: document.querySelectorAll('[data-testid="templates-card"]').length,
            busy: document.querySelector('.templates-view__sections')?.getAttribute('aria-busy') ?? null,
          });
        }}
      >
        <TemplatesSection templates={CATALOGUE} active onUseTemplate={vi.fn()} />
      </Profiler>,
    );
    await waitFor(() => expect(screen.getAllByTestId('templates-card')).toHaveLength(CATALOGUE.length));

    // Assistive technology is told the list is still filling while the header
    // already reports the full count; once every card is in, the flag drops.
    for (const commit of commits) {
      if (commit.cards < CATALOGUE.length) expect(commit).toEqual({ cards: commit.cards, busy: 'true' });
    }
    expect(document.querySelector('.templates-view__sections')?.getAttribute('aria-busy')).toBe('false');
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

  it('restarts the two idle stages on every activation and cancels a pending one on deactivation', async () => {
    // Deterministic idle scheduling: the section must not fill or mount
    // previews until the browser reports idle, and a callback pending when
    // the view deactivates must be cancelled, never applied to the next visit.
    type Idle = { handle: number; fn: () => void };
    const queue: Idle[] = [];
    const cancelled: number[] = [];
    let next = 1;
    const originalRequest = (globalThis as any).requestIdleCallback;
    const originalCancel = (globalThis as any).cancelIdleCallback;
    (globalThis as any).requestIdleCallback = (fn: () => void) => {
      const handle = next++;
      queue.push({ handle, fn });
      return handle;
    };
    (globalThis as any).cancelIdleCallback = (handle: number) => {
      cancelled.push(handle);
      const i = queue.findIndex((q) => q.handle === handle);
      if (i >= 0) queue.splice(i, 1);
    };
    const runIdle = () => act(() => { queue.splice(0).forEach((q) => q.fn()); });
    const cards = () => document.querySelectorAll('[data-testid="templates-card"]').length;
    const frames = () => document.querySelectorAll('[data-testid="templates-card"] iframe').length;
    try {
      const view = (active: boolean) => <TemplatesSection templates={CATALOGUE} active={active} onUseTemplate={vi.fn()} />;
      const { rerender } = render(view(true));
      expect(cards()).toBe(24);
      expect(queue).toHaveLength(1);
      runIdle();
      expect(cards()).toBe(CATALOGUE.length);
      expect(frames()).toBe(0);
      runIdle();
      expect(frames()).toBe(CATALOGUE.length);

      // Leave while a fresh visit's fill is still pending.
      rerender(view(false));
      expect(cards()).toBe(0);
      rerender(view(true));
      expect(cards()).toBe(24);
      const pending = queue[0]!.handle;
      rerender(view(false));
      expect(cancelled).toContain(pending);
      expect(queue).toHaveLength(0);

      // The next visit starts from the bounded commit again and fills on its own idle callbacks.
      rerender(view(true));
      expect(cards()).toBe(24);
      expect(frames()).toBe(0);
      runIdle();
      expect(cards()).toBe(CATALOGUE.length);
      runIdle();
      expect(frames()).toBe(CATALOGUE.length);
    } finally {
      // Unmount while the stubs are still installed, whether or not an
      // assertion failed: the effect cleanup cancels through them.
      cleanup();
      (globalThis as any).requestIdleCallback = originalRequest;
      (globalThis as any).cancelIdleCallback = originalCancel;
    }
  });
});
