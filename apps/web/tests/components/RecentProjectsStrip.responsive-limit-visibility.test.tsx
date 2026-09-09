// @vitest-environment jsdom
//
// RecentProjectsStrip's responsive-limit effect recomputes purely from
// getBoundingClientRect() on its own row, driven by a ResizeObserver (and a
// window-resize fallback). EntryShell keeps every inactive tab mounted
// behind `display:none` (inactiveViewProps, EntryShell.tsx) instead of
// unmounting it, so the row's box goes "not rendered" on every home
// activation and deactivation -- a real ResizeObserver still reports that
// transition, and the box reads back 0x0. Treating a 0-width read as
// "narrow" flips responsiveLimit (7 visible <-> 6 hidden) on every switch,
// which changes `recent`'s identity and re-fires the cover-fetch
// Promise.all below for no visible reason (FU-49-attribution.md, "What's
// firing the leaked fetches").
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecentProjectsStrip } from '../../src/components/RecentProjectsStrip';
import type { Project } from '../../src/types';

const fetchProjectFiles = vi.fn(async (id: string) => [
  { name: `${id}.png`, path: `${id}.png`, kind: 'image', mtime: 1 },
]);

vi.mock('../../src/providers/registry', () => ({
  fetchProjectFiles: (id: string) => fetchProjectFiles(id),
  fetchProjectFileText: vi.fn(async () => null),
  projectFileUrl: (projectId: string, fileName: string) =>
    `/api/projects/${projectId}/files/${fileName}`,
}));

let resizeCallback: ResizeObserverCallback | null = null;
// `undefined` stands in for a row whose box cannot be read at all
// (rowRef.current gone): the effect must then keep the current limit.
let rowWidth: number | undefined = 1332; // wide enough for 7 cards
const originalResizeObserver = globalThis.ResizeObserver;

function project(id: string, updatedAt: number): Project {
  return {
    id,
    name: id,
    skillId: null,
    designSystemId: null,
    createdAt: updatedAt,
    updatedAt,
    status: { value: 'not_started' },
  } as Project;
}

function projects(count: number): Project[] {
  return Array.from({ length: count }, (_, index) => project(`project-${index + 1}`, count - index));
}

describe('RecentProjectsStrip responsive-limit visibility', () => {
  beforeEach(() => {
    resizeCallback = null;
    rowWidth = 1332;
    fetchProjectFiles.mockClear();
    (globalThis as any).ResizeObserver = class {
      constructor(cb: ResizeObserverCallback) {
        resizeCallback = cb;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect(
      this: HTMLElement,
    ) {
      return {
        x: 0,
        y: 0,
        width: this.classList.contains('recent-projects__row') ? (rowWidth as number) : 180,
        height: 100,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        toJSON: () => ({}),
      } as DOMRect;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    (globalThis as any).ResizeObserver = originalResizeObserver;
  });

  it('does not narrow the row or refetch covers when the row is measured while display:none', async () => {
    const { container } = render(
      <RecentProjectsStrip projects={projects(8)} onOpen={() => {}} onViewAll={() => {}} />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll('.recent-projects__card')).toHaveLength(7);
    });
    const fetchesAfterMount = fetchProjectFiles.mock.calls.length;
    expect(fetchesAfterMount).toBeGreaterThan(0);

    // Simulate the row going behind `display:none` (an inactive EntryShell
    // view): the box is unrendered, so a real ResizeObserver reports a
    // 0x0 contentRect.
    rowWidth = 0;
    await act(async () => {
      resizeCallback?.([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    });

    // A hidden read must not permanently narrow the row, and must not
    // re-run the cover-fetch Promise.all for a different card set.
    expect(container.querySelectorAll('.recent-projects__card')).toHaveLength(7);
    expect(fetchProjectFiles.mock.calls.length).toBe(fetchesAfterMount);
  });

  it('still narrows a genuinely narrow visible row and fetches covers for the new card set', async () => {
    rowWidth = 800;
    const { container } = render(
      <RecentProjectsStrip projects={projects(8)} onOpen={() => {}} onViewAll={() => {}} />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll('.recent-projects__card')).toHaveLength(6);
    });
    expect(fetchProjectFiles.mock.calls.length).toBeGreaterThan(0);
  });

  it('follows real resizes in both directions (wide -> narrow -> wide)', async () => {
    const { container } = render(
      <RecentProjectsStrip projects={projects(8)} onOpen={() => {}} onViewAll={() => {}} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll('.recent-projects__card')).toHaveLength(7);
    });
    const fetchesAfterMount = fetchProjectFiles.mock.calls.length;

    // A real narrow layout has a nonzero width: the limit must still drop
    // and the cover fetch must run again for the new card set.
    rowWidth = 800;
    await act(async () => {
      resizeCallback?.([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    });
    await waitFor(() => {
      expect(container.querySelectorAll('.recent-projects__card')).toHaveLength(6);
    });
    expect(fetchProjectFiles.mock.calls.length).toBeGreaterThan(fetchesAfterMount);

    rowWidth = 1332;
    await act(async () => {
      resizeCallback?.([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    });
    await waitFor(() => {
      expect(container.querySelectorAll('.recent-projects__card')).toHaveLength(7);
    });
  });

  it('keeps the current limit when the row box cannot be read at all', async () => {
    const { container } = render(
      <RecentProjectsStrip projects={projects(8)} onOpen={() => {}} onViewAll={() => {}} />,
    );
    await waitFor(() => {
      expect(container.querySelectorAll('.recent-projects__card')).toHaveLength(7);
    });
    const fetchesAfterMount = fetchProjectFiles.mock.calls.length;

    // Before FU-49 an unreadable box forced the limit back to the narrow
    // default (6); now it must leave the wide limit (7) untouched.
    rowWidth = undefined;
    await act(async () => {
      resizeCallback?.([] as unknown as ResizeObserverEntry[], {} as ResizeObserver);
    });

    expect(container.querySelectorAll('.recent-projects__card')).toHaveLength(7);
    expect(fetchProjectFiles.mock.calls.length).toBe(fetchesAfterMount);
  });
});
