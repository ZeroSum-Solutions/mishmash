// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GetTypefaceResponse, ListTypefacesResponse, TypefaceFontStyle } from '@open-design/contracts';

import { TypefacesSection } from '../../src/components/TypefacesSection';

const originalFetch = globalThis.fetch;

class FakeFontFace {
  static shouldFail = false;
  constructor(
    public family: string,
    public source: string,
    public descriptors: Record<string, unknown>,
  ) {}
  load(): Promise<this> {
    return FakeFontFace.shouldFail ? Promise.reject(new Error('decode failed')) : Promise.resolve(this);
  }
}

function installFontFaceStub(): Set<unknown> {
  FakeFontFace.shouldFail = false;
  const added = new Set<unknown>();
  (globalThis as any).FontFace = FakeFontFace;
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      add: (f: unknown) => { added.add(f); },
      delete: (f: unknown) => added.delete(f),
      check: () => false,
    },
  });
  return added;
}

function installIntersectionObserverStub(): void {
  class FakeIntersectionObserver {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    disconnect(): void {}
    unobserve(): void {}
  }
  (globalThis as any).IntersectionObserver = FakeIntersectionObserver;
}

const TYPEFACE_SUMMARY = {
  id: 'archivo',
  family: 'Archivo',
  classification: { weights: [400, 700], styles: ['normal'] as TypefaceFontStyle[], monospace: false, nameHints: [] },
  license: { spdx: 'OFL-1.1', sourceLabel: 'Google Fonts' },
  faceCount: 2,
};

const FACES = [
  { weight: '400', style: 'normal', file: 'archivo-latin-aaa.woff2', format: 'woff2', unicodeRange: 'U+0000-00FF' },
  { weight: '700', style: 'normal', file: 'archivo-latin-bbb.woff2', format: 'woff2', unicodeRange: 'U+0000-00FF' },
];

describe('TypefacesSection specimens', () => {
  let addedFaces: Set<unknown>;

  beforeEach(() => {
    installIntersectionObserverStub();
    addedFaces = installFontFaceStub();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith('/api/typefaces/archivo')) {
        const body: GetTypefaceResponse = { typeface: { ...TYPEFACE_SUMMARY, faces: FACES as any } };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.startsWith('/api/typefaces')) {
        const body: ListTypefacesResponse = { typefaces: [TYPEFACE_SUMMARY as any], scannedFamilies: 1 };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.startsWith('/api/projects')) {
        return new Response(JSON.stringify({ projects: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('loads exactly one face for the visible family and applies its own alias as the specimen font-family', async () => {
    render(<TypefacesSection />);
    const specimen = await screen.findByTestId('typeface-specimen-archivo-400');
    // jsdom (and every real browser) normalizes a quoted font-family value's
    // serialization to double quotes via the CSSOM string-serialization
    // algorithm regardless of which quote style set it -- confirmed against
    // this jsdom version by direct instrumentation (raw value observed:
    // '"od-specimen-archivo-400"'). Strip quotes before comparing, mirroring
    // the same defensive stripping the D.3 Playwright test already applies
    // to `getComputedStyle(el).fontFamily`.
    await waitFor(() =>
      expect(specimen.style.fontFamily.replace(/["']/g, '')).toBe('od-specimen-archivo-400'),
    );
    expect(addedFaces.size).toBe(1);
  });

  it('shows the unavailable marker and never applies the alias when the face fails to load', async () => {
    FakeFontFace.shouldFail = true;
    render(<TypefacesSection />);
    await screen.findByTestId('typeface-specimen-archivo-400-unavailable');
    expect(screen.queryByTestId('typeface-specimen-archivo-400')).not.toBeInTheDocument();
  });

  it('frees every registered FontFace on unmount (no leaked specimens)', async () => {
    const { unmount } = render(<TypefacesSection />);
    await waitFor(() => expect(addedFaces.size).toBe(1));
    unmount();
    expect(addedFaces.size).toBe(0);
  });
});
