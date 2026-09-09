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

import fs from 'node:fs';
import path from 'node:path';

import { FRAGMENT_SHADER, HomeAmbientBackdrop } from '../../src/components/home-hero/HomeAmbientBackdrop';

type Frame = (now: number) => void;
const frames: Frame[] = [];
let now = 0;
let resizeCallback: ResizeObserverCallback | null = null;
let intersectionCallback: IntersectionObserverCallback | null = null;
let drawCalls = 0;
let contextAttrs: Record<string, unknown> | undefined;

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
  contextAttrs = undefined;
  HTMLCanvasElement.prototype.getContext = ((_: string, attrs?: Record<string, unknown>) => { contextAttrs = attrs; return fakeGl(); }) as any;
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

// FU-51: every route switch away from and back to Home hides and reveals
// this canvas (EntryShell keeps the view behind display:none). Two costs
// landed on the frames after the reveal, and on the NEXT route's frames
// too, because the compositor was still busy with them: a CSS filter on the
// WebGL canvas that forced the whole 1408x846 layer through a filter
// re-raster (57 ms of raster + 15 ms of commit measured on the live app,
// 2026-09-09), and a fresh shader draw under reduced motion even though the
// picture is static. The look is baked into the shader instead, and a frame
// already drawn survives a hide/reveal.
describe('HomeAmbientBackdrop reveal cost (FU-51)', () => {
  it('carries no CSS filter on the canvas; the look is in the shader', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '../../src/components/home-hero/HomeAmbientBackdrop.module.css'),
      'utf8',
    );
    const canvasRule = css.match(/\.canvas\s*\{[^}]*\}/g) ?? [];
    expect(canvasRule.length).toBeGreaterThan(0);
    for (const rule of canvasRule) expect(rule).not.toMatch(/\bfilter\s*:/);
    // No filter anywhere in the module: a filter on the wrapper would put the
    // same re-raster back one layer up.
    expect(css).not.toMatch(/(^|[^-])filter\s*:/m);
    // The lift lives in the fragment shader: the CSS filter matrix luma
    // (0.213, 0.715, 0.072), saturate 1.15, contrast 1.05 around 0.5.
    expect(FRAGMENT_SHADER).toMatch(/dot\(color, vec3\(0\.213, 0\.715, 0\.072\)\)/);
    expect(FRAGMENT_SHADER).toMatch(/mix\(vec3\(luma\), color, 1\.15\)/);
    expect(FRAGMENT_SHADER).toMatch(/\(color - 0\.5\) \* 1\.05 \+ 0\.5/);
  });

  it('preserves the drawing buffer only for a static (reduced-motion) picture', () => {
    window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as any;
    mountVisible();
    expect(contextAttrs?.preserveDrawingBuffer).toBe(true);
  });

  it('does not preserve the drawing buffer when the loop animates (a copy per frame)', () => {
    mountVisible();
    expect(contextAttrs?.preserveDrawingBuffer).toBe(false);
  });

  it('redraws on reveal when motion turns off after mount (the buffer was never preserved)', () => {
    let reduce = false;
    const listeners: Array<() => void> = [];
    window.matchMedia = (() => ({
      get matches() { return reduce; },
      addEventListener(_: string, fn: () => void) { listeners.push(fn); },
      removeEventListener() {},
    })) as any;
    const { canvas } = mountVisible();
    runFrames(2);
    const drawnAnimated = drawCalls;
    reduce = true;
    act(() => { listeners.forEach((fn) => fn()); });
    const drawnAtSwitch = drawCalls;
    expect(drawnAtSwitch).toBeGreaterThanOrEqual(drawnAnimated);
    act(() => {
      intersectionCallback?.([{ target: canvas, isIntersecting: false } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      intersectionCallback?.([{ target: canvas, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(drawCalls).toBe(drawnAtSwitch + 1);
  });

  it('under reduced motion draws once per buffer size, not once per reveal', () => {
    window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as any;
    const { canvas } = mountVisible();
    // Mount paints the static frame (on main it painted it twice: once in
    // resize(), once in start()); what this case pins is the reveal below.
    expect(drawCalls).toBeGreaterThan(0);
    const drawnAfterMount = drawCalls;

    // Route switch away (hidden: 0x0 box, off screen) and back.
    act(() => {
      resizeCallback?.([{ target: canvas, contentRect: { width: 0, height: 0, left: 0, top: 0 } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
      intersectionCallback?.([{ target: canvas, isIntersecting: false } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    act(() => {
      resizeCallback?.([{ target: canvas, contentRect: { width: 1200, height: 800, left: 0, top: 0 } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
      intersectionCallback?.([{ target: canvas, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(drawCalls).toBe(drawnAfterMount);

    // A real size change clears the buffer, so that reveal must draw again.
    act(() => {
      resizeCallback?.([{ target: canvas, contentRect: { width: 900, height: 700, left: 0, top: 0 } } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    });
    expect(canvas.width).toBe(900);
    expect(drawCalls).toBe(drawnAfterMount + 1);

    // A lost context takes the preserved frame with it: the next reveal
    // must draw again rather than trust an empty buffer.
    act(() => { canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })); });
    act(() => {
      intersectionCallback?.([{ target: canvas, isIntersecting: false } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      intersectionCallback?.([{ target: canvas, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    expect(drawCalls).toBe(drawnAfterMount + 2);
  });
});
