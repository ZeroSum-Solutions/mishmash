import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * Returns a function whose identity never changes and which always calls the
 * `handler` from the latest render. For a parent that re-renders often (the
 * home shell re-renders on every route switch) it lets a memoized child keep
 * receiving the same callback prop while the closure behind it stays current.
 *
 * The latest handler is stored in a layout effect, so a call made during a
 * render (which React forbids for event handlers anyway) would see the
 * previous one; calls from events and effects always see the newest.
 */
export function useStableHandler<Args extends unknown[], R>(handler: (...args: Args) => R): (...args: Args) => R {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
