// Red spec for W3B (PRD 3.2, item B-08 point 5, INV-3.3, web half).
//
// The home grid re-lists every project's files on a 15 s timer. Three things
// make that walk cost more than it has to:
//
//   1. `fetchProjectFiles` has no `since` parameter, so every poll asks the
//      daemon for the whole tree even though the daemon route has accepted
//      `since` all along. INV-3.3: after the initial load, polling must send
//      `since=<last observed mtime>` and an unchanged file must be ABSENT from
//      the delta response — which means the client has to merge the delta into
//      the tree it already holds.
//   2. `App.tsx`'s `setProjects` hands `DesignsTab` a fresh array on every
//      poll even when the list is byte-for-byte the same, so the cover effect
//      (`useEffect([projects])`) re-walks every card's files on every tick.
//   3. Nothing throttles concurrent list requests for the same project.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFile } from '@open-design/contracts';

import type { Project } from '../../src/types';

// Both modules are loaded through a dynamic import and looked up by name, so a
// missing export fails as an assertion about the symptom rather than as a
// module resolution error.
const registry = (await import('../../src/providers/registry')) as Record<string, unknown>;
const appModule = (await import('../../src/App')) as Record<string, unknown>;

const preserveProjectListIdentity = appModule.preserveProjectListIdentity as (
  current: Project[],
  next: Project[],
) => Project[];

const fetchProjectFiles = registry.fetchProjectFiles as (
  projectId: string,
  options?: { since?: number },
) => Promise<ProjectFile[]>;

function projectFile(name: string, mtime: number): ProjectFile {
  return {
    name,
    path: name,
    type: 'file',
    size: 12,
    mtime,
    kind: 'html',
    mime: 'text/html',
  };
}

function filesResponse(files: ProjectFile[]): Response {
  return new Response(JSON.stringify({ files }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function requestedUrls(fetchMock: { mock: { calls: unknown[][] } }): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

function project(id: string, updatedAt: number): Project {
  return { id, name: `Project ${id}`, createdAt: 1, updatedAt } as unknown as Project;
}

describe('fetchProjectFiles incremental listing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends the last observed mtime as a since cursor', async () => {
    const fetchMock = vi.fn(async () => filesResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchProjectFiles('project-1', { since: 1720000000123 });

    // Red on base: `fetchProjectFiles` takes only a project id and always asks
    // for the whole tree.
    expect(requestedUrls(fetchMock)).toEqual([
      '/api/projects/project-1/files?since=1720000000123',
    ]);
  });

  it('omits the cursor on the first full load', async () => {
    const fetchMock = vi.fn(async () => filesResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await fetchProjectFiles('project-1');

    expect(requestedUrls(fetchMock)).toEqual(['/api/projects/project-1/files']);
  });

  it('shares one in-flight list per project instead of re-walking concurrently', async () => {
    const fetchMock = vi.fn(async () => filesResponse([projectFile('a.html', 10)]));
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([
      fetchProjectFiles('project-1'),
      fetchProjectFiles('project-1'),
    ]);

    // Red on base: every caller opens its own request, so the 15 s grid tick
    // and a focus refresh both walk the same tree.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it('does not share an in-flight full load with a delta request', async () => {
    const fetchMock = vi.fn(async () => filesResponse([]));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([
      fetchProjectFiles('project-1'),
      fetchProjectFiles('project-1', { since: 500 }),
    ]);

    expect(requestedUrls(fetchMock).sort()).toEqual([
      '/api/projects/project-1/files',
      '/api/projects/project-1/files?since=500',
    ]);
  });
});

describe('project file delta merge', () => {
  const mergeProjectFileDelta = registry.mergeProjectFileDelta as (
    current: ProjectFile[],
    delta: ProjectFile[],
  ) => ProjectFile[];
  const latestProjectFileMtime = registry.latestProjectFileMtime as (
    files: ProjectFile[],
  ) => number;

  it('keeps a file the delta response omitted because it did not change', () => {
    expect(typeof mergeProjectFileDelta).toBe('function');

    const held = [projectFile('index.html', 100), projectFile('style.css', 90)];
    const delta = [projectFile('index.html', 140)];

    const merged = mergeProjectFileDelta(held, delta);

    expect(merged.map((file) => [file.path, file.mtime])).toEqual([
      ['index.html', 140],
      ['style.css', 90],
    ]);
  });

  it('adds a file the delta introduced and keeps newest first', () => {
    const held = [projectFile('index.html', 100)];
    const merged = mergeProjectFileDelta(held, [projectFile('new.html', 200)]);

    expect(merged.map((file) => file.path)).toEqual(['new.html', 'index.html']);
  });

  it('reads the cursor for the next poll off the tree it already holds', () => {
    expect(typeof latestProjectFileMtime).toBe('function');
    expect(latestProjectFileMtime([projectFile('a', 10), projectFile('b', 42)])).toBe(42);
    expect(latestProjectFileMtime([])).toBe(0);
  });
});

describe('project list identity', () => {
  it('returns the held array when a poll produced a content-equal list', () => {
    expect(typeof preserveProjectListIdentity).toBe('function');
    const current = [project('a', 10), project('b', 20)];
    const polled = [project('a', 10), project('b', 20)];

    // Red on base: `setProjects(visibleList)` stores the freshly fetched array
    // every tick, so `DesignsTab`'s `useEffect([projects])` re-walks every
    // card's files even when nothing changed.
    expect(preserveProjectListIdentity(current, polled)).toBe(current);
  });

  it('returns the polled array when anything actually changed', () => {
    const current = [project('a', 10)];
    const reordered = [project('a', 10), project('b', 20)];
    expect(preserveProjectListIdentity(current, reordered)).toBe(reordered);

    const touched = [project('a', 11)];
    expect(preserveProjectListIdentity(current, touched)).toBe(touched);
  });
});
