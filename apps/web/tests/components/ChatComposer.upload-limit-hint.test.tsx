// @vitest-environment jsdom
//
// F-01 (W7A) — the composer names the real, daemon-published per-file limit
// BEFORE any file is dropped (INV-7.3), never a hardcoded figure. RED on
// base: no fetch to `.../uploads/limits` exists and no hint is rendered.

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer } from '../../src/components/ChatComposer';
import { flushMounts } from '../helpers/lexical-composer';

function renderComposer(overrides: Partial<ComponentProps<typeof ChatComposer>> = {}) {
  return render(
    <ChatComposer
      projectId="project-1"
      projectFiles={[]}
      streaming={false}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('ChatComposer upload limit hint', () => {
  it('shows the published limit only while a file is being dragged over the composer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/projects/project-1/uploads/limits') {
          return new Response(
            JSON.stringify({
              maxFileBytes: 200 * 1024 * 1024,
              maxFilesPerRequest: 12,
              maxTotalBytes: 200 * 1024 * 1024 * 12,
              acceptedKinds: [],
            }),
            { status: 200 },
          );
        }
        return new Response('not found', { status: 404 });
      }),
    );

    const { container } = renderComposer();
    await flushMounts();

    expect(container.querySelector('[data-testid="upload-limit-hint"]')).toBeNull();

    const composer = container.querySelector('[data-testid="chat-composer"]')!;
    fireEvent.dragOver(composer);

    const hint = await waitFor(() => container.querySelector('[data-testid="upload-limit-hint"]'));
    expect(hint?.textContent).toBe('Up to 200.0 MB per file');

    fireEvent.dragLeave(composer);
    expect(container.querySelector('[data-testid="upload-limit-hint"]')).toBeNull();
  });
});
