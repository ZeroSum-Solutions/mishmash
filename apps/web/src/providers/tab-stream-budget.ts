import { useEffect, useRef, useState } from 'react';

/**
 * Per-tab stream budget.
 *
 * A browser allows six concurrent HTTP/1.1 connections per origin, and every
 * long-lived stream a tab holds spends one of those six for as long as the tab
 * stays open. A request that finds the pool full waits inside the browser and
 * never reaches the daemon at all — it is invisible to daemon-side timing and
 * shows up only as a slow request in the web observer.
 *
 * Measured against a real tools-dev runtime: a project tab held
 * `/api/memory/events` plus `/api/projects/:id/events`, three tabs held all six
 * sockets, and a message PUT issued from the third tab never arrived at the
 * daemon.
 *
 * This module owns the invariant that keeps a tab inside the budget:
 *
 *   A tab holds at most one connection per stream URL, and holds none while
 *   the document is hidden.
 *
 * Subscribers are reference-counted per URL, so two surfaces that want the same
 * stream share one connection instead of opening two. The connection closes
 * when the last subscriber unmounts and whenever the document becomes hidden,
 * and reopens on the next `visible`. A subscriber that mirrors server state
 * resyncs through `onReopen`, because events emitted while the tab held no
 * connection are not replayed.
 */

/**
 * The daemon's memory change/extraction stream. Both the global toast and the
 * Settings → Memory panel subscribe to it, so it is named once here and shared
 * through the pool rather than opened twice per tab.
 */
export const MEMORY_EVENTS_URL = '/api/memory/events';

export interface SharedStreamHandlers {
  /** SSE event name to handler, in the shape `EventSource.addEventListener` takes. */
  events: Record<string, (event: MessageEvent) => void>;
  /**
   * Called when this tab reopens the stream after releasing it. Subscribers
   * that mirror daemon state re-read it here; purely transient surfaces (a
   * toast) can leave it unset.
   */
  onReopen?: () => void;
}

interface Subscriber {
  current: SharedStreamHandlers;
}

interface StreamPool {
  source: EventSource | null;
  /** Event names already bound on the current `source`. */
  bound: Set<string>;
  subscribers: Set<Subscriber>;
  /** True once this pool has closed a connection it may later reopen. */
  released: boolean;
}

const pools = new Map<string, StreamPool>();
let visibilityBound = false;

function documentIsVisible(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}

/** Binds one listener per event name, fanned out to every current subscriber. */
function bindEventNames(pool: StreamPool): void {
  const source = pool.source;
  if (!source) return;
  for (const subscriber of pool.subscribers) {
    for (const name of Object.keys(subscriber.current.events)) {
      if (pool.bound.has(name)) continue;
      pool.bound.add(name);
      source.addEventListener(name, (event) => {
        for (const target of [...pool.subscribers]) {
          target.current.events[name]?.(event as MessageEvent);
        }
      });
    }
  }
}

function openPool(url: string, pool: StreamPool): void {
  if (pool.source || pool.subscribers.size === 0) return;
  if (!documentIsVisible()) return;
  if (typeof EventSource === 'undefined') return;
  pool.source = new EventSource(url);
  pool.bound.clear();
  bindEventNames(pool);
  if (pool.released) {
    pool.released = false;
    for (const subscriber of [...pool.subscribers]) subscriber.current.onReopen?.();
  }
}

function closePool(pool: StreamPool, reopenable: boolean): void {
  if (!pool.source) return;
  pool.source.close();
  pool.source = null;
  pool.bound.clear();
  pool.released = reopenable;
}

function bindVisibility(): void {
  if (visibilityBound || typeof document === 'undefined') return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    for (const [url, pool] of pools) {
      if (documentIsVisible()) openPool(url, pool);
      else closePool(pool, true);
    }
  });
}

/**
 * Subscribes this tab to `url` through the shared pool above. Pass `null` to
 * hold no connection — that is how a page-scoped stream stays closed while its
 * page is not open.
 */
export function useSharedEventStream(url: string | null, handlers: SharedStreamHandlers): void {
  const subscriber = useRef(handlers);
  subscriber.current = handlers;

  useEffect(() => {
    if (!url) return;
    bindVisibility();
    let pool = pools.get(url);
    if (!pool) {
      pool = { source: null, bound: new Set(), subscribers: new Set(), released: false };
      pools.set(url, pool);
    }
    const held = pool;
    held.subscribers.add(subscriber);
    openPool(url, held);
    bindEventNames(held);
    return () => {
      held.subscribers.delete(subscriber);
      if (held.subscribers.size > 0) return;
      closePool(held, false);
      pools.delete(url);
    };
  }, [url]);
}

/**
 * `true` while the document is visible. A surface that owns its own stream
 * lifecycle gates on this so it too holds nothing while the tab is hidden.
 */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(documentIsVisible);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setVisible(documentIsVisible());
    document.addEventListener('visibilitychange', onChange);
    onChange();
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}
