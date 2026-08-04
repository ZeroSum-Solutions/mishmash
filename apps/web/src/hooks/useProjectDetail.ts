// Fetches `GET /api/projects/:id` once on mount and caches the response,
// surfacing the `resolvedDir` field added in PR #451 prereq commit. The
// daemon route returns `ProjectDetailResponse` (project + resolvedDir)
// for current builds; older daemons may return `ProjectResponse` (no
// resolvedDir), so we fall back to `metadata.baseDir` when present and
// emit `null` otherwise so callers can degrade their UI gracefully.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project, ProjectDetailResponse } from '@open-design/contracts';

export interface ProjectDetailState {
  project: Project | null;
  resolvedDir: string | null;
  /** Daemon-resolved workspace canvas file (see ProjectDetailResponse). */
  resolvedCanvasFile: string | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useProjectDetail(projectId: string): ProjectDetailState {
  const [project, setProject] = useState<Project | null>(null);
  const [resolvedDir, setResolvedDir] = useState<string | null>(null);
  const [resolvedCanvasFile, setResolvedCanvasFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  // Latest-wins guard: refreshes overlap (mount fetch vs. workspace
  // refresh cadence), and an older response completing last must not
  // overwrite a newer resolvedCanvasFile/resolvedDir.
  const generationRef = useRef(0);

  const fetchOnce = useCallback(
    async (signal?: AbortSignal) => {
      const generation = ++generationRef.current;
      const isCurrent = () => generationRef.current === generation && !signal?.aborted;
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
          signal,
        });
        if (!resp.ok) {
          throw new Error(`GET /api/projects/${projectId} → HTTP ${resp.status}`);
        }
        const body = (await resp.json()) as Partial<ProjectDetailResponse>;
        if (!isCurrent()) return;
        const nextProject = body.project ?? null;
        setProject(nextProject);
        const reported = typeof body.resolvedDir === 'string' ? body.resolvedDir : null;
        const fallback =
          typeof nextProject?.metadata?.baseDir === 'string'
            ? nextProject.metadata.baseDir
            : null;
        setResolvedDir(reported ?? fallback);
        setResolvedCanvasFile(typeof body.resolvedCanvasFile === 'string' ? body.resolvedCanvasFile : null);
      } catch (err) {
        if (!isCurrent()) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchOnce(controller.signal);
    return () => controller.abort();
  }, [fetchOnce]);

  const refresh = useCallback(() => fetchOnce(), [fetchOnce]);

  return { project, resolvedDir, resolvedCanvasFile, loading, error, refresh };
}
