import { useCallback, useEffect, useRef, useState } from 'react';
import type { CritiqueConformanceResponse } from '@open-design/contracts';

export interface CritiqueConformanceState {
  conformance: CritiqueConformanceResponse | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Fetches `GET /api/critique/conformance` once on mount — the fleet-wide
 * conformance window (shipped rate / clean-parse rate per day) and the
 * ratchet's current hold/promote/demote decision. Unlike
 * `useCritiqueStatus`, this is not project-scoped: it reflects the whole
 * fleet's rollout health, so it fetches unconditionally.
 *
 * Same fetch-once / abort-on-unmount shape as `useCritiqueStatus`.
 */
export function useCritiqueConformance(): CritiqueConformanceState {
  const [conformance, setConformance] = useState<CritiqueConformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const generationRef = useRef(0);

  const fetchOnce = useCallback(async (signal?: AbortSignal) => {
    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation && !signal?.aborted;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/critique/conformance', { signal });
      if (!resp.ok) {
        throw new Error(`GET /api/critique/conformance → HTTP ${resp.status}`);
      }
      const body = (await resp.json()) as CritiqueConformanceResponse;
      if (!isCurrent()) return;
      setConformance(body);
    } catch (err) {
      if (!isCurrent()) return;
      setConformance(null);
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchOnce(controller.signal);
    return () => controller.abort();
  }, [fetchOnce]);

  return { conformance, loading, error };
}
