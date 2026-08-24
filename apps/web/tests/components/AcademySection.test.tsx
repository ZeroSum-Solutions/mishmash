// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AcademySection } from '../../src/components/AcademySection';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AcademySection', () => {
  it('inlines project media so it renders inside the opaque-origin sandbox', async () => {
    const academyHtml = '<!doctype html><html><body><h1>Academy</h1><img src="./images/logo.svg"></body></html>';
    const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/projects/mishmash-academy/files') {
        return new Response(JSON.stringify({
          files: [
            { name: 'index.html', size: academyHtml.length, mtime: 1, kind: 'html', mime: 'text/html' },
            { name: 'images/logo.svg', size: logoSvg.length, mtime: 1, kind: 'image', mime: 'image/svg+xml' },
          ],
        }), { headers: { 'content-type': 'application/json' } });
      }
      if (url === '/api/projects/mishmash-academy/raw/index.html') {
        return new Response(academyHtml, { headers: { 'content-type': 'text/html' } });
      }
      if (url === '/api/projects/mishmash-academy/raw/images/logo.svg') {
        return new Response(logoSvg, { headers: { 'content-type': 'image/svg+xml' } });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AcademySection
        title="Academy"
        loadingLabel="Loading Academy"
        unavailableLabel="Academy unavailable"
      />,
    );

    const frame = await screen.findByTestId('academy-frame');
    await waitFor(() => {
      expect(frame.getAttribute('srcdoc')).toContain('data:image/svg+xml;base64,');
    });
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/mishmash-academy/files');
  });
});
