// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DECK_PREVIEW_DESIGN_WIDTH, useDeckPreviewScale } from '../../src/lib/use-deck-preview-scale';

// Deterministic ResizeObserver stand-in: real jsdom has no ResizeObserver, and
// the fire-and-forget stubs used elsewhere in this repo (observe() as a no-op)
// can't exercise the resize-driven re-apply path. This one records the
// callback per instance so a test can trigger it manually, mirroring a real
// resize notification.
class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  observedElements: Element[] = [];
  disconnected = false;
  constructor(private readonly cb: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observedElements.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  trigger() {
    this.cb([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
  }
}

function elementWithWidth(width: number): HTMLDivElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: width });
  return el;
}

function refTo(el: HTMLElement | null): RefObject<HTMLElement | null> {
  return { current: el };
}

afterEach(() => {
  cleanup();
  MockResizeObserver.instances = [];
  vi.unstubAllGlobals();
});

describe('useDeckPreviewScale', () => {
  it('publishes the measured/design width ratio as --deck-preview-scale on mount', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    const el = elementWithWidth(640);

    renderHook(() => useDeckPreviewScale(refTo(el), true));

    expect(el.style.getPropertyValue('--deck-preview-scale')).toBe(String(640 / DECK_PREVIEW_DESIGN_WIDTH));
  });

  it('re-publishes the scale when the observed element resizes', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    const el = elementWithWidth(640);

    renderHook(() => useDeckPreviewScale(refTo(el), true));
    expect(el.style.getPropertyValue('--deck-preview-scale')).toBe(String(640 / DECK_PREVIEW_DESIGN_WIDTH));

    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 1280 });
    MockResizeObserver.instances[0]!.trigger();

    expect(el.style.getPropertyValue('--deck-preview-scale')).toBe('1');
  });

  it('does nothing when disabled: no observer is created and no property is set', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    const el = elementWithWidth(640);

    renderHook(() => useDeckPreviewScale(refTo(el), false));

    expect(el.style.getPropertyValue('--deck-preview-scale')).toBe('');
    expect(MockResizeObserver.instances).toHaveLength(0);
  });

  it('does nothing when the ref has no element yet', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    expect(() => renderHook(() => useDeckPreviewScale(refTo(null), true))).not.toThrow();
    expect(MockResizeObserver.instances).toHaveLength(0);
  });

  it('does nothing when ResizeObserver is unavailable (SSR / older jsdom)', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const el = elementWithWidth(640);

    expect(() => renderHook(() => useDeckPreviewScale(refTo(el), true))).not.toThrow();
    expect(el.style.getPropertyValue('--deck-preview-scale')).toBe('');
  });

  it('skips publishing when the measured width is zero (element not yet laid out)', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    const el = elementWithWidth(0);

    renderHook(() => useDeckPreviewScale(refTo(el), true));

    expect(el.style.getPropertyValue('--deck-preview-scale')).toBe('');
  });

  it('disconnects the observer on unmount', () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    const el = elementWithWidth(640);

    const { unmount } = renderHook(() => useDeckPreviewScale(refTo(el), true));
    const instance = MockResizeObserver.instances[0]!;
    expect(instance.disconnected).toBe(false);

    unmount();

    expect(instance.disconnected).toBe(true);
  });
});
