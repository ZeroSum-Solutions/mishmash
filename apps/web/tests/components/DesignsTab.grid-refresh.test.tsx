// @vitest-environment jsdom
//
// The home grid's per-card fan-outs must keep polling once the project list
// stops changing identity on every tick.
//
// `preserveProjectListIdentity` (App.tsx) hands `DesignsTab` the SAME array
// back when a poll produced a content-equal list, which is what stops the grid
// re-walking every card's files. Both per-card effects are keyed on that
// array, so the component owns the schedule now: `gridScanEpoch` ticks every
// `PROJECTS_AUTO_REFRESH_MS`. Live artifacts need that tick most, because an
// agent creating one does not move `project.updatedAt` and the grid does not
// open the per-project event stream that announces it.

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DesignsTab } from '../../src/components/DesignsTab';
import * as registry from '../../src/providers/registry';

vi.mock('../../src/providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/providers/registry')>();
  return {
    ...actual,
    fetchLiveArtifacts: vi.fn(async () => []),
    fetchProjectFiles: vi.fn(async () => []),
  };
});

const fetchLiveArtifactsMock = vi.mocked(registry.fetchLiveArtifacts);
const fetchProjectFilesMock = vi.mocked(registry.fetchProjectFiles);

const PROJECTS_AUTO_REFRESH_MS = 15000;

const PROJECTS = [
  {
    id: 'project-1',
    name: 'Landing refresh',
    skillId: null,
    designSystemId: null,
    createdAt: 1,
    updatedAt: 2,
    status: { value: 'not_started' },
  },
] as unknown as Parameters<typeof DesignsTab>[0]['projects'];

function renderGrid() {
  return render(
    <DesignsTab
      projects={PROJECTS}
      skills={[]}
      designSystems={[]}
      onOpen={vi.fn()}
      onOpenLiveArtifact={vi.fn()}
      onDelete={vi.fn()}
      onRename={vi.fn()}
    />,
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DesignsTab per-card refresh schedule', () => {
  beforeAll(() => {
    if (window.localStorage) return;
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        clear: () => store.clear(),
        getItem: (key: string) => store.get(key) ?? null,
        removeItem: (key: string) => store.delete(key),
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    fetchLiveArtifactsMock.mockClear();
    fetchProjectFilesMock.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('re-lists live artifacts on the poll tick when the project list did not change', async () => {
    // The SAME array on every render, exactly what a content-equal poll now
    // hands the grid.
    const { rerender } = renderGrid();
    await flush();
    expect(fetchLiveArtifactsMock).toHaveBeenCalledWith('project-1');
    fetchLiveArtifactsMock.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(PROJECTS_AUTO_REFRESH_MS);
    });
    rerender(
      <DesignsTab
        projects={PROJECTS}
        skills={[]}
        designSystems={[]}
        onOpen={vi.fn()}
        onOpenLiveArtifact={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
      />,
    );
    await flush();

    // Red without the poll epoch in the effect's dependencies: the grid would
    // never notice a live artifact an agent created after the first paint.
    expect(fetchLiveArtifactsMock).toHaveBeenCalledWith('project-1');
  });

  it('re-scans covers on the same tick', async () => {
    renderGrid();
    await flush();
    expect(fetchProjectFilesMock).toHaveBeenCalled();
    fetchProjectFilesMock.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(PROJECTS_AUTO_REFRESH_MS);
    });
    await flush();

    expect(fetchProjectFilesMock).toHaveBeenCalled();
    // A held tree with no entries carries no cursor, so the next scan is a
    // full listing and must be sent as one -- not as a `since` request the
    // delta bound would then count.
    expect(fetchProjectFilesMock.mock.calls.at(-1)).toEqual(['project-1']);
  });
});
