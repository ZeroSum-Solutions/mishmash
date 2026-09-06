// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useStableHandler } from '../../src/hooks/useStableHandler';

describe('useStableHandler', () => {
  it('keeps one identity across renders and always calls the latest handler', () => {
    const seen: string[] = [];
    const { result, rerender } = renderHook(({ tag }: { tag: string }) => useStableHandler((x: number) => { seen.push(`${tag}:${x}`); return x * 2; }), {
      initialProps: { tag: 'a' },
    });
    const first = result.current;
    expect(first(1)).toBe(2);
    rerender({ tag: 'b' });
    expect(result.current).toBe(first);
    expect(first(2)).toBe(4);
    expect(seen).toEqual(['a:1', 'b:2']);
  });
});
