// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomeAmbientBackdrop } from '../../src/components/home-hero/HomeAmbientBackdrop';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('HomeAmbientBackdrop', () => {
  it('renders a non-interactive canvas sourced from the bundled aurora example', () => {
    const markup = renderToStaticMarkup(<HomeAmbientBackdrop />);

    expect(markup).toContain('data-testid="home-ambient-canvas"');
    expect(markup).toContain('data-source="webgl-aurora-veil"');
    expect(markup).toContain('aria-hidden="true"');
  });

  it('fills the responsive home stage instead of stopping at the old fixed desktop size', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/home-hero/HomeAmbientBackdrop.module.css'),
      'utf8',
    );

    expect(css).not.toMatch(/width:\s*min\(1180px/);
    expect(css).toMatch(/width:\s*min\(1440px,\s*calc\(100vw - 32px\)\)/);
    expect(css).toMatch(/height:\s*clamp\(680px,\s*78dvh,\s*920px\)/);
  });

  it('resizes the WebGL drawing buffer when its rendered backdrop changes size', () => {
    let resizeCallback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }
        observe = observe;
        disconnect = disconnect;
        unobserve() {}
      },
    );
    vi.stubGlobal('WebGL2RenderingContext', class {});
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );

    const viewport = vi.fn();
    const gl = {
      VERTEX_SHADER: 1,
      FRAGMENT_SHADER: 2,
      COMPILE_STATUS: 3,
      LINK_STATUS: 4,
      TRIANGLES: 5,
      createShader: vi.fn(() => ({})),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn(() => true),
      deleteShader: vi.fn(),
      createProgram: vi.fn(() => ({})),
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn(() => true),
      useProgram: vi.fn(),
      getUniformLocation: vi.fn(() => ({})),
      viewport,
      uniform2f: vi.fn(),
      uniform1f: vi.fn(),
      drawArrays: vi.fn(),
      deleteProgram: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      gl as unknown as WebGL2RenderingContext,
    );

    const { getByTestId, unmount } = render(<HomeAmbientBackdrop />);
    const canvas = getByTestId('home-ambient-canvas') as HTMLCanvasElement;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      width: 1240,
      height: 760,
      top: 0,
      right: 1240,
      bottom: 760,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    expect(observe).toHaveBeenCalledWith(canvas);
    resizeCallback?.([], {} as ResizeObserver);

    expect(canvas.width).toBe(1240);
    expect(canvas.height).toBe(760);
    expect(viewport).toHaveBeenLastCalledWith(0, 0, 1240, 760);

    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
