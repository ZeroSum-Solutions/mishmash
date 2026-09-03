// @vitest-environment jsdom
//
// W2.6 / T-09 — the project grids must not point an <img> at
// `GET /api/projects/:id/cover` for a project whose cover the daemon has
// never rendered.
//
// That endpoint is frozen as "raw image bytes 200, or 404"
// (apps/daemon/src/routes/covers.ts:1-6, packages/contracts/src/api/covers.ts,
// scripts/waves/verify-w4.ts), so before the first render the request is a
// guaranteed 404 — and apps/web/src/observability/request-health.ts records
// every one of them as a `resource-failed` anomaly. Ordinary, healthy use
// therefore fills the anomaly log with one row per project card.
//
// The daemon publishes `Project.hasCover`; the grids must consult it and show
// the glyph without touching the network when it is not true.

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesignsTab } from '../../src/components/DesignsTab';
import { RecentProjectsStrip } from '../../src/components/RecentProjectsStrip';
import type { Project } from '../../src/types';

vi.mock('../../src/providers/registry', () => ({
  deleteLiveArtifact: vi.fn(),
  fetchLiveArtifacts: vi.fn(async () => []),
  fetchProjectFiles: vi.fn(async () => [
    { name: 'index.html', path: 'index.html', kind: 'html', mtime: 200 },
  ]),
  fetchProjectFileText: vi.fn(async () => null),
  liveArtifactPreviewUrl: (projectId: string, artifactId: string) =>
    `/api/projects/${projectId}/live-artifacts/${artifactId}/preview`,
  projectFileUrl: (projectId: string, fileName: string) =>
    `/api/projects/${projectId}/files/${fileName}`,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function htmlProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-html',
    name: 'Landing refresh',
    skillId: null,
    designSystemId: null,
    createdAt: 1,
    updatedAt: 2,
    status: { value: 'not_started' },
    metadata: { kind: 'other', entryFile: 'index.html' },
    ...overrides,
  };
}

/** Every `<img>` in the tree that requests the frozen cover endpoint. */
function coverRequests(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('img'))
    .map((img) => img.getAttribute('src') ?? '')
    .filter((src) => /\/api\/projects\/[^/]+\/cover$/.test(src));
}

describe('W2.6 / T-09 — no cover request before the daemon has rendered one', () => {
  it('DesignsTab renders no cover <img> for a project with no rendered cover', async () => {
    const { container } = render(
      <DesignsTab
        projects={[htmlProject()]}
        skills={[]}
        designSystems={[]}
        onOpen={vi.fn()}
        onOpenLiveArtifact={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('.design-card-thumb')).not.toBeNull();
    });
    expect(coverRequests(container)).toEqual([]);
  });

  it('RecentProjectsStrip renders no cover <img> for a project with no rendered cover', async () => {
    const { container } = render(
      <RecentProjectsStrip projects={[htmlProject()]} onOpen={vi.fn()} onViewAll={vi.fn()} />,
    );

    await waitFor(() => {
      expect(container.querySelector('.recent-projects__card-thumb')).not.toBeNull();
    });
    expect(coverRequests(container)).toEqual([]);
  });

  it('DesignsTab still requests the cover once the daemon reports one', async () => {
    const { container } = render(
      <DesignsTab
        projects={[htmlProject({ hasCover: true })]}
        skills={[]}
        designSystems={[]}
        onOpen={vi.fn()}
        onOpenLiveArtifact={vi.fn()}
        onDelete={vi.fn()}
        onRename={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(coverRequests(container)).toEqual(['/api/projects/project-html/cover']);
    });
  });

  it('RecentProjectsStrip still requests the cover once the daemon reports one', async () => {
    const { container } = render(
      <RecentProjectsStrip
        projects={[htmlProject({ hasCover: true })]}
        onOpen={vi.fn()}
        onViewAll={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(coverRequests(container)).toEqual(['/api/projects/project-html/cover']);
    });
  });
});
