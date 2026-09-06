// @vitest-environment jsdom
//
// The aurora backdrop draws ~30 times a second for as long as the home view
// is mounted, which is the whole session: EntryShell keeps the home view
// behind `display: none` while another route is on screen. Each draw called
// `getBoundingClientRect()` on the canvas, a forced style+layout pass, and
// so did every pointer move anywhere in the app. On a route switch that
// forced layout landed between the first two frames (see the 3P
// attribution). Sizing must come from the ResizeObserver, and the loop must
// stop while the canvas is not on screen.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeAmbientBackdrop } from '../../src/components/home-hero/HomeAmbientBackdrop';

type Frame = (now: number) => void;
const frames: Frame[] = [];
let now = 0;
let resizeCallback: ResizeObserverCallback | null = null;
let intersectionCallback: IntersectionObserverCallback | null = null;
let drawCalls = 0;

const originals = {
  raf: globalThis.requestAnimationFrame,
  caf: globalThis.cancelAnimationFrame,
  ro: globalThis.ResizeObserver,
  io: globalThis.IntersectionObserver,
  matchMedia: window.matchMedia,
  getContext: HTMLCanvasElement.prototype.getContext,
  webgl2: (globalThis as any).WebGL2RenderingContext,
};

function fakeGl(): WebGL2RenderingContext {
  const target: Record<string, unknown> = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, TRIANGLES: 5,
    createShader: () => ({}), shaderSource: () => {}, compileShader: () => {}, getShaderParameter: () => true, deleteShader: () => {},
    createProgram: () => ({}), attachShader: () => {}, linkProgram: () => {}, getProgramParameter: () => true, useProgram: () => {},
    deleteProgram: () => {}, getUniformLocation: () => ({}), uniform2f: () => {}, uniform1f: () => {}, viewport: () => {},
    drawArrays: () => { drawCalls += 1; },
  };
  return new Proxy(target, { get: (t, key) => (key in t ? t[key as string] : () => undefined) }) as unknown as WebGL2RenderingContext;
}

function runFrames(count: number, stepMs = 40) {
  for (let i = 0; i < count; i++) {
    now += stepMs;
    const pending = frames.splice(0);
    act(() => { pending.forEach((fn) => fn(now)); });
  }
}

beforeEach(() => {
  frames.length = 0; now = 0; drawCalls = 0; resizeCallback = null; intersectionCallback = null;
  (globalThis as any).WebGL2RenderingContext = class {};
  HTMLCanvasElement.prototype.getContext = (() => fakeGl()) as any;
  globalThis.requestAnimationFrame = ((fn: Frame) => { frames.push(fn); return frames.length; }) as any;
  globalThis.cancelAnimationFrame = ((id: number) => { frames.splice(id - 1, 1); }) as any;
  (globalThis as any).ResizeObserver = class { constructor(cb: ResizeObserverCallback) { resizeCallback = cb; } observe() {} disconnect() {} unobserve() {} };
  (globalThis as any).IntersectionObserver = class { constructor(cb: IntersectionObserverCallback) { intersectionCallback = cb; } observe() {} disconnect() {} unobserve() {} };
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as any;
});

afterEach(() => {
  cleanup();
  globalThis.requestAnimationFrame = originals.raf; globalThis.cancelAnimationFrame = originals.caf;
  (globalThis as any).ResizeObserver = originals.ro; (globalThis as any).IntersectionObserver = originals.io;
  window.matchMedia = originals.matchMedia; HTMLCanvasElement.prototype.getContext = originals.getContext;
  (globalThis as any).WebGL2RenderingContext = originals.webgl2;
});

function mountVisible() {
  render(<HomeAmbientBackdrop />);
  const canvas = screen.getByTestId('home-ambient-canvas') as HTMLCanvasElement;
  const rect = vi.spyOn(canvas, 'getBoundingClientRect');
  act(() => {
    resizeCallback?.([{ target: canvas, contentRect: { width: 1200, height: 800, left: 0, top: 0 } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    intersectionCallback?.([{ target: canvas, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
  });
  return { canvas, rect };
}

describe('HomeAmbientBackdrop layout discipline', () => {
  it('sizes the drawing buffer from the ResizeObserver and never reads layout on a frame or a pointer move', () => {
    const { canvas, rect } = mountVisible();
    rect.mockClear();
    runFrames(5);
    act(() => { window.dispatchEvent(new PointerEvent('pointermove', { clientX: 300, clientY: 20 })); });
    runFrames(2);
    expect(drawCalls).toBeGreaterThan(0);
    expect(canvas.width).toBe(1200);
    expect(rect).not.toHaveBeenCalled();
  });

  it('stops drawing while the canvas is off screen and resumes when it is back', () => {
    const { canvas } = mountVisible();
    runFrames(3);
    const drawnWhileVisible = drawCalls;
    expect(drawnWhileVisible).toBeGreaterThan(0);

    act(() => { intersectionCallback?.([{ target: canvas, isIntersecting: false } as unknown as IntersectionObserverEntry], {} as IntersectionObserver); });
    runFrames(5);
    expect(drawCalls).toBe(drawnWhileVisible);

    act(() => { intersectionCallback?.([{ target: canvas, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver); });
    runFrames(3);
    expect(drawCalls).toBeGreaterThan(drawnWhileVisible);
  });

  it('keeps its drawing buffer when the observer reports a zero-size box (the view was hidden)', () => {
    const { canvas } = mountVisible();
    expect(canvas.width).toBe(1200);
    // EntryShell hides the home view with display:none on a route switch; the
    // canvas box collapses to 0x0. Reallocating the buffer for that is a
    // GPU realloc on every switch, and the next reveal would realloc again.
    act(() => {
      resizeCallback?.([{ target: canvas, contentRect: { width: 0, height: 0, left: 0, top: 0 } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
      intersectionCallback?.([{ target: canvas, isIntersecting: false } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(canvas.width).toBe(1200);
    act(() => {
      resizeCallback?.([{ target: canvas, contentRect: { width: 1200, height: 800, left: 0, top: 0 } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
      intersectionCallback?.([{ target: canvas, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(canvas.width).toBe(1200);
  });

  it('measures once and on window resize when ResizeObserver is unavailable', () => {
    (globalThis as any).ResizeObserver = undefined;
    let box = { width: 1000, height: 600, left: 0 };
    const rectSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => box as DOMRect);
    try {
      render(<HomeAmbientBackdrop />);
      const canvas = screen.getByTestId('home-ambient-canvas') as HTMLCanvasElement;
      act(() => { intersectionCallback?.([{ target: canvas, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver); });
      expect(canvas.width).toBe(1000);
      const readsAfterMount = rectSpy.mock.calls.length;
      runFrames(3);
      expect(rectSpy.mock.calls.length).toBe(readsAfterMount);

      box = { width: 800, height: 500, left: 0 };
      act(() => { window.dispatchEvent(new Event('resize')); });
      expect(canvas.width).toBe(800);
    } finally {
      rectSpy.mockRestore();
    }
  });

  it('re-sizes the buffer from cached bounds when only devicePixelRatio changes', () => {
    const { canvas, rect } = mountVisible();
    expect(canvas.width).toBe(1200);
    rect.mockClear();
    const originalRatio = window.devicePixelRatio;
    try {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1.25 });
      act(() => { window.dispatchEvent(new Event('resize')); });
      expect(canvas.width).toBe(1500);
      expect(rect).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: originalRatio });
    }
  });
});
