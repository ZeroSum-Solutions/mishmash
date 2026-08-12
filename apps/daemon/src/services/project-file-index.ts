import type { ProjectFile } from '@open-design/contracts';
import type { ProjectWatchEvent } from '../project-watchers.js';

const ARTIFACT_MANIFEST_SUFFIX = '.artifact.json';
export type IndexedProjectFile = ProjectFile & { name: string; path: string; mtime: number };

interface ProjectFileListOptions {
  metadata?: unknown;
  since?: number;
}

interface ProjectFileListInput extends ProjectFileListOptions {
  projectsRoot: string;
  projectId: string;
}

interface ProjectFileWatchInput {
  projectsRoot: string;
  projectId: string;
  metadata?: unknown;
  event: ProjectWatchEvent;
}

interface ProjectFileIndexDeps {
  scanProjectFiles: (
    projectsRoot: string,
    projectId: string,
    options?: ProjectFileListOptions,
  ) => Promise<IndexedProjectFile[]>;
  readProjectFileEntry: (
    projectsRoot: string,
    projectId: string,
    path: string,
    metadata?: unknown,
  ) => Promise<IndexedProjectFile | null>;
  resolveProjectDir: (projectsRoot: string, projectId: string, metadata?: unknown) => string;
  now?: () => number;
  reconcileAfterMs?: number;
  maxProjects?: number;
}

export interface ProjectFileIndex {
  list(input: ProjectFileListInput): Promise<IndexedProjectFile[]>;
  applyWatchEvent(input: ProjectFileWatchInput): Promise<void>;
  invalidate(input: Pick<ProjectFileListInput, 'projectsRoot' | 'projectId' | 'metadata'>): void;
}

export function createProjectFileIndex(deps: ProjectFileIndexDeps): ProjectFileIndex {
  interface IndexedProject {
    files: Map<string, IndexedProjectFile>;
    scannedAt: number;
    updates: Promise<void>;
  }

  const listings = new Map<string, Promise<IndexedProject>>();
  const now = deps.now ?? Date.now;
  const reconcileAfterMs = deps.reconcileAfterMs ?? 30_000;
  const maxProjects = Math.max(1, deps.maxProjects ?? 12);

  const keyFor = (input: Pick<ProjectFileListInput, 'projectsRoot' | 'projectId' | 'metadata'>) =>
    deps.resolveProjectDir(input.projectsRoot, input.projectId, input.metadata);

  const sortFiles = (files: Iterable<IndexedProjectFile>) =>
    Array.from(files).sort((left, right) => Number(right.mtime) - Number(left.mtime));

  const remember = (key: string, pending: Promise<IndexedProject>) => {
    if (listings.has(key)) listings.delete(key);
    while (listings.size >= maxProjects) {
      const oldest = listings.keys().next().value;
      if (typeof oldest !== 'string') break;
      listings.delete(oldest);
    }
    listings.set(key, pending);
  };

  const scan = (key: string, input: ProjectFileListInput) => {
    const pending = deps
      .scanProjectFiles(input.projectsRoot, input.projectId, { metadata: input.metadata })
      .then((files): IndexedProject => ({
        files: new Map(files.map((file) => [file.path, file])),
        scannedAt: now(),
        updates: Promise.resolve(),
      }));
    remember(key, pending);
    void pending.catch(() => {
      if (listings.get(key) === pending) listings.delete(key);
    });
    return pending;
  };

  const getFreshListing = async (key: string, input: ProjectFileListInput) => {
    let pending = listings.get(key);
    if (!pending) pending = scan(key, input);
    else remember(key, pending);
    let listing = await pending;
    await listing.updates;
    if (now() - listing.scannedAt < reconcileAfterMs) return listing;
    const current = listings.get(key);
    if (current !== pending) return current ?? scan(key, input);
    pending = scan(key, input);
    listing = await pending;
    return listing;
  };

  return {
    async list(input) {
      const key = keyFor(input);
      const listing = await getFreshListing(key, input);
      const files = sortFiles(listing.files.values());
      const since = Number(input.since);
      return Number.isFinite(since) && since > 0
        ? files.filter((file) => Number(file.mtime) > since)
        : files;
    },

    async applyWatchEvent(input) {
      const key = keyFor(input);
      const listing = listings.get(key);
      if (!listing) return;
      remember(key, listing);
      const indexedProject = await listing;
      const update = indexedProject.updates.then(async () => {
        const isManifest = input.event.path.endsWith(ARTIFACT_MANIFEST_SUFFIX);
        const surfacedPath = isManifest
          ? input.event.path.slice(0, -ARTIFACT_MANIFEST_SUFFIX.length)
          : input.event.path;
        if (input.event.kind === 'unlink' && !isManifest) {
          indexedProject.files.delete(surfacedPath);
          return;
        }
        const file = await deps.readProjectFileEntry(
          input.projectsRoot,
          input.projectId,
          surfacedPath,
          input.metadata,
        );
        if (file) indexedProject.files.set(file.path, file);
        else indexedProject.files.delete(surfacedPath);
      });
      indexedProject.updates = update.catch(() => {
        if (listings.get(key) === listing) listings.delete(key);
      });
      await indexedProject.updates;
    },

    invalidate(input) {
      listings.delete(keyFor(input));
    },
  };
}
