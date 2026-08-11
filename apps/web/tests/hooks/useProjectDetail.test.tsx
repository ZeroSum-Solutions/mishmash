// @vitest-environment jsdom

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useProjectDetail } from '../../src/hooks/useProjectDetail';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOnce(body: unknown, init?: { ok?: boolean; status?: number }) {
  const ok = init?.ok ?? true;
  const status = init?.status ?? 200;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
}

describe('useProjectDetail', () => {
  it('surfaces resolvedDir when the daemon includes it in the response', async () => {
    mockFetchOnce({
      project: { id: 'p1', name: 'Acme', skillId: null, designSystemId: null, createdAt: 1, updatedAt: 1 },
      resolvedDir: '/tmp/od/projects/p1',
    });

    const { result } = renderHook(() => useProjectDetail('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.resolvedDir).toBe('/tmp/od/projects/p1');
    expect(result.current.project?.id).toBe('p1');
  });

  it('falls back to metadata.baseDir when the daemon omits resolvedDir', async () => {
    mockFetchOnce({
      project: {
        id: 'p2',
        name: 'Imported',
        skillId: null,
        designSystemId: null,
        createdAt: 1,
        updatedAt: 1,
        metadata: { kind: 'prototype', baseDir: '/Users/me/projects/imported' },
      },
    });

    const { result } = renderHook(() => useProjectDetail('p2'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.resolvedDir).toBe('/Users/me/projects/imported');
  });

  it('returns resolvedDir: null when neither resolvedDir nor metadata.baseDir is present', async () => {
    mockFetchOnce({
      project: { id: 'p3', name: 'Stale daemon', skillId: null, designSystemId: null, createdAt: 1, updatedAt: 1 },
    });

    const { result } = renderHook(() => useProjectDetail('p3'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.resolvedDir).toBeNull();
  });

  it('captures error state when the request returns non-OK', async () => {
    mockFetchOnce({}, { ok: false, status: 500 });

    const { result } = renderHook(() => useProjectDetail('p4'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
  });

  it('does not expose the previous project detail while the next project is loading', async () => {
    let resolveSecond!: (response: Response) => void;
    const secondResponse = new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        project: { id: 'p1', name: 'First', skillId: null, designSystemId: null, createdAt: 1, updatedAt: 1 },
        resolvedDir: '/tmp/od/projects/p1',
        resolvedCanvasFile: 'first.html',
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockImplementationOnce(() => secondResponse);

    const { result, rerender } = renderHook(
      ({ projectId }) => useProjectDetail(projectId),
      { initialProps: { projectId: 'p1' } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.resolvedCanvasFile).toBe('first.html');

    rerender({ projectId: 'p2' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(result.current.loading).toBe(true);
    expect(result.current.project).toBeNull();
    expect(result.current.resolvedDir).toBeNull();
    expect(result.current.resolvedCanvasFile).toBeNull();

    resolveSecond(new Response(JSON.stringify({
      project: { id: 'p2', name: 'Second', skillId: null, designSystemId: null, createdAt: 2, updatedAt: 2 },
      resolvedDir: '/tmp/od/projects/p2',
      resolvedCanvasFile: 'second.html',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
