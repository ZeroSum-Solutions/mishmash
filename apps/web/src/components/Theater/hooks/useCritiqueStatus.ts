import { useCallback, useEffect, useRef, useState } from 'react';
import type { CritiqueStatusResponse } from '@open-design/contracts';

export interface CritiqueStatusState {
  status: CritiqueStatusResponse | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Fetches `GET /api/projects/:projectId/critique/status` — the resolved
 * rollout-policy answer for whether Critique Theater would run for this
 * project, and which factor (skill policy, project override, env
 * override, or rollout phase default) decided it. See
 * `apps/daemon/src/critique/status-handler.ts` for what the response
 * does and does not promise.
 *
 * `projectId: null` means no project is open (the Settings dialog can be
 * opened from the entry gallery). The endpoint requires a real project
 * id, so the hook reports no data and no error rather than firing a
 * request that would 400.
 *
 * Follows the fetch-once-per-id / abort-on-change shape of
 * `useProjectDetail`: a monotonic generation counter discards a stale
 * response that resolves after a newer request has started.
 */
export function useCritiqueStatus(projectId: string | null): CritiqueStatusState {
  const [status, setStatus] = useState<CritiqueStatusResponse | null>(null);
  const [loading, setLoading] = useState(projectId !== null);
  const [error, setError] = useState<Error | null>(null);
  const generationRef = useRef(0);

  const fetchOnce = useCallback(async (id: string, signal?: AbortSignal) => {
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation && !signal?.aborted;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/projects/${encodeURIComponent(id)}/critique/status`, {
        signal,
      });
      if (!resp.ok) {
        throw new Error(`GET /api/projects/${id}/critique/status → HTTP ${resp.status}`);
      }
      const body = (await resp.json()) as CritiqueStatusResponse;
      if (!isCurrent()) return;
      setStatus(body);
    } catch (err) {
      if (!isCurrent()) return;
      setStatus(null);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (projectId === null) {
      // Invalidate any in-flight fetch from a previous projectId so its
      // late response can't clobber this "no project" state.
      generationRef.current += 1;
      setStatus(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void fetchOnce(projectId, controller.signal);
    return () => controller.abort();
  }, [projectId, fetchOnce]);

  return { status, loading, error };
}
