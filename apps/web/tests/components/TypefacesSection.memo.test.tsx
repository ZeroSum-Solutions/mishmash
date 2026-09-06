// @vitest-environment jsdom

import { useState } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListTypefacesResponse } from '@open-design/contracts';

import { TypefacesSection } from '../../src/components/TypefacesSection';
import * as i18n from '../../src/i18n';

vi.mock('../../src/i18n', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/i18n')>();
  return { ...original, useT: vi.fn(original.useT) };
});

const originalFetch = globalThis.fetch;

function typeface(id: string) {
  return {
    id,
    family: id,
    classification: { weights: [400], styles: ['normal'], monospace: false, nameHints: [] },
    license: { spdx: 'OFL-1.1', sourceLabel: 'Google Fonts' },
    faceCount: 1,
  };
}

// EntryShell keeps this view mounted behind `display: none` and renders it
// inline, so every route switch on the home shell re-renders the shell and,
// with it, this section and its 90-odd rows: 8-22 ms of reconciliation that
// produces no DOM change. The section takes no props; a parent re-render must
// not reach into it.
function Shell() {
  const [tick, setTick] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setTick(tick + 1)}>
        tick {tick}
      </button>
      <TypefacesSection />
    </>
  );
}

describe('TypefacesSection render isolation', () => {
  beforeEach(() => {
    class FakeIntersectionObserver {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
    (globalThis as any).IntersectionObserver = FakeIntersectionObserver;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.startsWith('/api/typefaces')) {
        const body: ListTypefacesResponse = {
          typefaces: Array.from({ length: 40 }, (_, i) => typeface(`family-${i}`)) as any,
          scannedFamilies: 40,
        };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.startsWith('/api/projects')) {
        return new Response(JSON.stringify({ projects: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('does not re-render its rows when the parent shell re-renders with no new props', async () => {
    render(<Shell />);
    await waitFor(() => expect(screen.getByTestId('typeface-row-family-39')).toBeTruthy());
    const useT = vi.mocked(i18n.useT);
    useT.mockClear();

    act(() => {
      screen.getByRole('button', { name: /tick/ }).click();
    });

    expect(screen.getByRole('button', { name: /tick 1/ })).toBeTruthy();
    expect(useT).not.toHaveBeenCalled();
  });
});
