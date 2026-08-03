// @vitest-environment jsdom
//
// S4-6 / C4-9 — DesignsTab's per-project fetchLiveArtifacts/fetchProjectFiles
// fan-out must be bounded (not one request per project), isolate a single
// project's failure from the rest, and paginate a large grid rather than
// rendering one .design-card per project. See
// scripts/waves/verify-w4.ts's C4-9 for the exhaustive, randomized version
// of this same proof; this is the permanent, repo-owned counterpart.

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignsTab } from '../../src/components/DesignsTab';
import type { Project } from '../../src/types';

const DELAY_MS = 20;
let concurrentLiveArtifacts = 0;
let peakLiveArtifacts = 0;
let concurrentFiles = 0;
let peakFiles = 0;
let liveArtifactCallLog: { projectId: string; failed: boolean }[] = [];
let FAIL_PROJECT_ID = '__none__';

vi.mock('../../src/providers/registry', () => ({
  deleteLiveArtifact: vi.fn(),
  fetchLiveArtifacts: vi.fn(async (projectId: string) => {
    concurrentLiveArtifacts++;
    peakLiveArtifacts = Math.max(peakLiveArtifacts, concurrentLiveArtifacts);
    await new Promise((r) => setTimeout(r, DELAY_MS));
    concurrentLiveArtifacts--;
    if (projectId === FAIL_PROJECT_ID) {
      liveArtifactCallLog.push({ projectId, failed: true });
      throw new Error('simulated mid-page failure');
    }
    liveArtifactCallLog.push({ projectId, failed: false });
    return [];
  }),
  fetchProjectFiles: vi.fn(async () => {
    concurrentFiles++;
    peakFiles = Math.max(peakFiles, concurrentFiles);
    await new Promise((r) => setTimeout(r, DELAY_MS));
    concurrentFiles--;
    return [];
  }),
  liveArtifactPreviewUrl: (projectId: string, artifactId: string) =>
    `/api/projects/${projectId}/live-artifacts/${artifactId}/preview`,
  projectFileUrl: (projectId: string, fileName: string) =>
    `/api/projects/${projectId}/files/${fileName}`,
}));

function resetCounters(): void {
  concurrentLiveArtifacts = 0;
  peakLiveArtifacts = 0;
  concurrentFiles = 0;
  peakFiles = 0;
  liveArtifactCallLog = [];
  FAIL_PROJECT_ID = '__none__';
}

function makeProjects(n: number): Project[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `project-${i}`,
    name: `Project ${i}`,
    skillId: null,
    designSystemId: null,
    createdAt: i,
    updatedAt: i,
    status: { value: 'not_started' as const },
  }));
}

async function waitForQuiescence(timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  let stableStreak = 0;
  while (Date.now() - start < timeoutMs) {
    if (concurrentLiveArtifacts === 0 && concurrentFiles === 0) {
      stableStreak++;
      if (stableStreak >= 10) return;
    } else {
      stableStreak = 0;
    }
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('waitForQuiescence timed out');
}

afterEach(() => {
  cleanup();
  resetCounters();
});

describe('DesignsTab fan-out bound (S4-6 / C4-9)', () => {
  it('bounds concurrent fetchLiveArtifacts/fetchProjectFiles calls regardless of project count', async () => {
    const n = 30;
    render(
      <DesignsTab
        projects={makeProjects(n)}
        skills={[]}
        designSystems={[]}
        onOpen={vi.fn()}
        onOpenLiveArtifact={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(peakLiveArtifacts).toBeGreaterThan(0);
      expect(peakFiles).toBeGreaterThan(0);
    });
    await waitForQuiescence();

    expect(peakLiveArtifacts).toBeLessThanOrEqual(12);
    expect(peakFiles).toBeLessThanOrEqual(12);
    expect(peakLiveArtifacts).not.toBe(n);
  }, 15_000);

  it('a single mid-page fetch failure does not block the other projects from completing', async () => {
    const projects = makeProjects(6);
    FAIL_PROJECT_ID = 'project-3';
    render(
      <DesignsTab
        projects={projects}
        skills={[]}
        designSystems={[]}
        onOpen={vi.fn()}
        onOpenLiveArtifact={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
      />,
    );
    await waitFor(() => expect(peakLiveArtifacts).toBeGreaterThan(0));
    await waitForQuiescence();

    const failingEntry = liveArtifactCallLog.find((e) => e.projectId === FAIL_PROJECT_ID);
    expect(failingEntry?.failed).toBe(true);
    const otherIds = projects.map((p) => p.id).filter((id) => id !== FAIL_PROJECT_ID);
    for (const id of otherIds) {
      expect(liveArtifactCallLog.some((e) => e.projectId === id && !e.failed)).toBe(true);
    }
    for (const id of otherIds) {
      const project = projects.find((p) => p.id === id);
      expect(document.body.textContent).toContain(project?.name);
    }
  }, 15_000);

  it('paginates a large project list instead of rendering every project into the DOM', async () => {
    const n = 200;
    const { container } = render(
      <DesignsTab
        projects={makeProjects(n)}
        skills={[]}
        designSystems={[]}
        onOpen={vi.fn()}
        onOpenLiveArtifact={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
      />,
    );
    await waitFor(() => expect(peakLiveArtifacts).toBeGreaterThan(0));
    await waitForQuiescence();

    const text = container.textContent ?? '';
    const foundIndices = new Set([...text.matchAll(/Project (\d+)/g)].map((m) => Number(m[1])));
    expect(foundIndices.size).toBeLessThan(n);
  }, 15_000);
});
