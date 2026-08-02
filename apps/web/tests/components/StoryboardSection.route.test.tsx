// @vitest-environment jsdom

/**
 * OBS-2: the storyboard editor now rides the URL. Opening a card pushes
 * /storyboard/:id, a cold deep link lands straight in the editor, and a dead
 * id falls back to the list with a clean URL — where before every one of
 * those paths silently reset to the list.
 */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoryboardSection } from '../../src/components/storyboard/StoryboardSection';
import { I18nProvider } from '../../src/i18n';

const registryMocks = vi.hoisted(() => ({
  fetchStoryboardList: vi.fn(),
  fetchStoryboard: vi.fn(),
  createStoryboard: vi.fn(),
}));

vi.mock('../../src/providers/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/providers/registry')>();
  return {
    ...actual,
    fetchStoryboardList: registryMocks.fetchStoryboardList,
    fetchStoryboard: registryMocks.fetchStoryboard,
    createStoryboard: registryMocks.createStoryboard,
  };
});

vi.mock('../../src/state/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state/config')>();
  return {
    ...actual,
    fetchMediaProvidersFromDaemon: vi.fn(async () => ({ status: 'ok', providers: {} })),
  };
});

const SB = {
  id: 'sb-1',
  title: 'Routed board',
  ratio: '16:9',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  moodDrafts: [],
  shots: [],
};

function renderSection() {
  return render(
    <I18nProvider initial="en">
      <StoryboardSection active />
    </I18nProvider>,
  );
}

describe('StoryboardSection routing (OBS-2)', () => {
  beforeEach(() => {
    registryMocks.fetchStoryboardList.mockResolvedValue({
      ok: true,
      value: [{ id: 'sb-1', title: 'Routed board', createdAt: SB.createdAt, updatedAt: SB.updatedAt, shotCount: 0 }],
    });
    registryMocks.fetchStoryboard.mockResolvedValue({ ok: true, value: SB });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('opens the editor for a cold /storyboard/:id deep link', async () => {
    window.history.replaceState(null, '', '/storyboard/sb-1');
    renderSection();
    await waitFor(() => {
      expect(screen.getByDisplayValue('Routed board')).toBeTruthy();
    });
    expect(registryMocks.fetchStoryboard).toHaveBeenCalledWith('sb-1');
  });

  it('pushes /storyboard/:id onto the URL when a card is opened', async () => {
    window.history.replaceState(null, '', '/storyboard');
    renderSection();
    const card = await waitFor(() => screen.getByTestId('storyboard-card'));
    await act(async () => {
      card.click();
    });
    await waitFor(() => {
      expect(window.location.pathname).toBe('/storyboard/sb-1');
    });
    expect(screen.getByDisplayValue('Routed board')).toBeTruthy();
  });

  it('falls back to the list with a clean URL when the deep-linked id is gone', async () => {
    registryMocks.fetchStoryboard.mockResolvedValue({ ok: false, message: 'not found' });
    window.history.replaceState(null, '', '/storyboard/deleted-id');
    renderSection();
    await waitFor(() => {
      expect(window.location.pathname).toBe('/storyboard');
    });
    expect(await screen.findByTestId('storyboard-card')).toBeTruthy();
  });
});
