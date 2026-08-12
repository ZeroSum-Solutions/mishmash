import { describe, expect, it, vi } from 'vitest';
import {
  createProjectFileIndex,
  type IndexedProjectFile,
} from '../../src/services/project-file-index.js';

const INDEX_FILE: IndexedProjectFile = {
  name: 'index.html',
  path: 'index.html',
  localPath: '/projects/project-1/index.html',
  type: 'file',
  size: 128,
  mtime: 1_000,
  kind: 'html',
  mime: 'text/html',
};

const UPDATED_INDEX_FILE: IndexedProjectFile = {
  ...INDEX_FILE,
  size: 256,
  mtime: 2_000,
};

describe('project file index', () => {
  it('reuses one project scan for repeated listings', async () => {
    const scanProjectFiles = vi.fn(async () => [INDEX_FILE]);
    const index = createProjectFileIndex({
      scanProjectFiles,
      readProjectFileEntry: vi.fn(),
      resolveProjectDir: () => '/projects/project-1',
      now: () => 1_000,
    });

    await expect(index.list({ projectsRoot: '/projects', projectId: 'project-1' })).resolves.toEqual([INDEX_FILE]);
    await expect(index.list({ projectsRoot: '/projects', projectId: 'project-1' })).resolves.toEqual([INDEX_FILE]);

    expect(scanProjectFiles).toHaveBeenCalledTimes(1);
  });

  it('applies a watcher change without rescanning the project', async () => {
    const scanProjectFiles = vi.fn(async () => [INDEX_FILE]);
    const readProjectFileEntry = vi.fn(async () => UPDATED_INDEX_FILE);
    const index = createProjectFileIndex({
      scanProjectFiles,
      readProjectFileEntry,
      resolveProjectDir: () => '/projects/project-1',
      now: () => 1_000,
    });

    await index.list({ projectsRoot: '/projects', projectId: 'project-1' });
    await index.applyWatchEvent({
      projectsRoot: '/projects',
      projectId: 'project-1',
      event: { type: 'file-changed', path: 'index.html', kind: 'change' },
    });

    await expect(index.list({ projectsRoot: '/projects', projectId: 'project-1' })).resolves.toEqual([
      UPDATED_INDEX_FILE,
    ]);
    expect(scanProjectFiles).toHaveBeenCalledTimes(1);
    expect(readProjectFileEntry).toHaveBeenCalledWith('/projects', 'project-1', 'index.html', undefined);
  });

  it('removes a watcher unlink without reading the missing file', async () => {
    const scanProjectFiles = vi.fn(async () => [INDEX_FILE]);
    const readProjectFileEntry = vi.fn();
    const index = createProjectFileIndex({
      scanProjectFiles,
      readProjectFileEntry,
      resolveProjectDir: () => '/projects/project-1',
    });

    await index.list({ projectsRoot: '/projects', projectId: 'project-1' });
    await index.applyWatchEvent({
      projectsRoot: '/projects',
      projectId: 'project-1',
      event: { type: 'file-changed', path: 'index.html', kind: 'unlink' },
    });

    await expect(index.list({ projectsRoot: '/projects', projectId: 'project-1' })).resolves.toEqual([]);
    expect(scanProjectFiles).toHaveBeenCalledTimes(1);
    expect(readProjectFileEntry).not.toHaveBeenCalled();
  });

  it('refreshes the surfaced file when its artifact manifest changes', async () => {
    const readProjectFileEntry = vi.fn(async () => UPDATED_INDEX_FILE);
    const index = createProjectFileIndex({
      scanProjectFiles: vi.fn(async () => [INDEX_FILE]),
      readProjectFileEntry,
      resolveProjectDir: () => '/projects/project-1',
    });

    await index.list({ projectsRoot: '/projects', projectId: 'project-1' });
    await index.applyWatchEvent({
      projectsRoot: '/projects',
      projectId: 'project-1',
      event: { type: 'file-changed', path: 'index.html.artifact.json', kind: 'change' },
    });

    expect(readProjectFileEntry).toHaveBeenCalledWith('/projects', 'project-1', 'index.html', undefined);
    await expect(index.list({ projectsRoot: '/projects', projectId: 'project-1' })).resolves.toEqual([
      UPDATED_INDEX_FILE,
    ]);
  });

  it('reconciles from disk after the freshness window expires', async () => {
    let now = 1_000;
    const scanProjectFiles = vi
      .fn<() => Promise<IndexedProjectFile[]>>()
      .mockResolvedValueOnce([INDEX_FILE])
      .mockResolvedValueOnce([UPDATED_INDEX_FILE]);
    const index = createProjectFileIndex({
      scanProjectFiles,
      readProjectFileEntry: vi.fn(),
      resolveProjectDir: () => '/projects/project-1',
      now: () => now,
      reconcileAfterMs: 1_000,
    });

    await index.list({ projectsRoot: '/projects', projectId: 'project-1' });
    now = 1_999;
    await index.list({ projectsRoot: '/projects', projectId: 'project-1' });
    now = 2_001;

    await expect(index.list({ projectsRoot: '/projects', projectId: 'project-1' })).resolves.toEqual([
      UPDATED_INDEX_FILE,
    ]);
    expect(scanProjectFiles).toHaveBeenCalledTimes(2);
  });

  it('evicts least-recently-used projects when the cache reaches its bound', async () => {
    const scanProjectFiles = vi.fn(async (_projectsRoot: string, projectId: string) => [
      { ...INDEX_FILE, path: `${projectId}.html`, name: `${projectId}.html` },
    ]);
    const index = createProjectFileIndex({
      scanProjectFiles,
      readProjectFileEntry: vi.fn(),
      resolveProjectDir: (_projectsRoot, projectId) => `/projects/${projectId}`,
      maxProjects: 1,
    });

    await index.list({ projectsRoot: '/projects', projectId: 'project-1' });
    await index.list({ projectsRoot: '/projects', projectId: 'project-2' });
    await index.list({ projectsRoot: '/projects', projectId: 'project-1' });

    expect(scanProjectFiles).toHaveBeenCalledTimes(3);
  });

  it('rescans an expired project if another listing evicts it during refresh', async () => {
    let now = 1_000;
    const scanProjectFiles = vi.fn(async (_projectsRoot: string, projectId: string) => [
      { ...INDEX_FILE, path: `${projectId}.html`, name: `${projectId}.html` },
    ]);
    const index = createProjectFileIndex({
      scanProjectFiles,
      readProjectFileEntry: vi.fn(),
      resolveProjectDir: (_projectsRoot, projectId) => `/projects/${projectId}`,
      now: () => now,
      reconcileAfterMs: 1_000,
      maxProjects: 1,
    });

    await index.list({ projectsRoot: '/projects', projectId: 'project-1' });
    now = 2_001;
    const refresh = index.list({ projectsRoot: '/projects', projectId: 'project-1' });
    await index.list({ projectsRoot: '/projects', projectId: 'project-2' });

    await expect(refresh).resolves.toMatchObject([{ path: 'project-1.html' }]);
  });

  it('applies watcher changes in event order for the same project', async () => {
    let resolveFirstRead!: (file: IndexedProjectFile) => void;
    const firstRead = new Promise<IndexedProjectFile>((resolve) => {
      resolveFirstRead = resolve;
    });
    const newestFile = { ...UPDATED_INDEX_FILE, size: 512, mtime: 3_000 };
    const readProjectFileEntry = vi
      .fn<() => Promise<IndexedProjectFile | null>>()
      .mockImplementationOnce(() => firstRead)
      .mockResolvedValueOnce(newestFile);
    const index = createProjectFileIndex({
      scanProjectFiles: vi.fn(async () => [INDEX_FILE]),
      readProjectFileEntry,
      resolveProjectDir: () => '/projects/project-1',
    });

    await index.list({ projectsRoot: '/projects', projectId: 'project-1' });
    const firstChange = index.applyWatchEvent({
      projectsRoot: '/projects',
      projectId: 'project-1',
      event: { type: 'file-changed', path: 'index.html', kind: 'change' },
    });
    const secondChange = index.applyWatchEvent({
      projectsRoot: '/projects',
      projectId: 'project-1',
      event: { type: 'file-changed', path: 'index.html', kind: 'change' },
    });

    await vi.waitFor(() => expect(readProjectFileEntry).toHaveBeenCalledTimes(1));
    resolveFirstRead(UPDATED_INDEX_FILE);
    await Promise.all([firstChange, secondChange]);

    await expect(index.list({ projectsRoot: '/projects', projectId: 'project-1' })).resolves.toEqual([
      newestFile,
    ]);
  });

  it('evicts a project after a failed delta so the next listing repairs from disk', async () => {
    const scanProjectFiles = vi
      .fn<() => Promise<IndexedProjectFile[]>>()
      .mockResolvedValueOnce([INDEX_FILE])
      .mockResolvedValueOnce([UPDATED_INDEX_FILE]);
    const index = createProjectFileIndex({
      scanProjectFiles,
      readProjectFileEntry: vi.fn(async () => {
        throw new Error('transient stat failure');
      }),
      resolveProjectDir: () => '/projects/project-1',
    });

    await index.list({ projectsRoot: '/projects', projectId: 'project-1' });
    await expect(index.applyWatchEvent({
      projectsRoot: '/projects',
      projectId: 'project-1',
      event: { type: 'file-changed', path: 'index.html', kind: 'change' },
    })).resolves.toBeUndefined();

    await expect(index.list({ projectsRoot: '/projects', projectId: 'project-1' })).resolves.toEqual([
      UPDATED_INDEX_FILE,
    ]);
    expect(scanProjectFiles).toHaveBeenCalledTimes(2);
  });
});
