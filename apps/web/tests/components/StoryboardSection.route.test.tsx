// @vitest-environment jsdom

/**
 * OBS-2: the storyboard editor now rides the URL. Opening a card pushes
 * /storyboard/:id, a cold deep link lands straight in the editor, and a dead
 * id falls back to the list with a clean URL — where before every one of
 * those paths silently reset to the list.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('restores the open editor when the user rail-switches away and back', async () => {
    // EntryShell's changeView navigates to the bare view path — it cannot
    // know about sub-routes — so returning to the Storyboard tab arrives as
    // routedId: null while the editor state is still cached. The section
    // must re-assert the open storyboard (and its URL) instead of dumping
    // the user back on the list; keep-mounted tabs preserve state.
    window.history.replaceState(null, '', '/storyboard');
    const view = renderSection();
    const card = await waitFor(() => screen.getByTestId('storyboard-card'));
    await act(async () => {
      card.click();
    });
    await waitFor(() => expect(window.location.pathname).toBe('/storyboard/sb-1'));

    // Rail switch to another tab. In the real app EntryShell and this
    // section subscribe to the same route store, so the URL change and the
    // active-prop flip land in ONE commit — batch them here the same way.
    await act(async () => {
      window.history.pushState(null, '', '/projects');
      window.dispatchEvent(new PopStateEvent('popstate'));
      view.rerender(
        <I18nProvider initial="en">
          <StoryboardSection active={false} />
        </I18nProvider>,
      );
    });

    // Rail switch back: generic navigate to /storyboard, no id.
    await act(async () => {
      window.history.pushState(null, '', '/storyboard');
      window.dispatchEvent(new PopStateEvent('popstate'));
      view.rerender(
        <I18nProvider initial="en">
          <StoryboardSection active />
        </I18nProvider>,
      );
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe('/storyboard/sb-1');
    });
    expect(screen.getByDisplayValue('Routed board')).toBeTruthy();
  });

  it('browser back from the editor still lands on the list, not a redirect trap', async () => {
    window.history.replaceState(null, '', '/storyboard');
    renderSection();
    const card = await waitFor(() => screen.getByTestId('storyboard-card'));
    await act(async () => {
      card.click();
    });
    await waitFor(() => expect(window.location.pathname).toBe('/storyboard/sb-1'));

    // Browser back: the tab stays active the whole time — this must CLEAR
    // the editor, never bounce the URL back to the detail entry.
    await act(async () => {
      window.history.pushState(null, '', '/storyboard');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('storyboard-card')).toBeTruthy();
    });
    expect(window.location.pathname).toBe('/storyboard');
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

describe('StoryboardSection list copy', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('pluralizes the card shot count (1 shot, 2 shots)', async () => {
    registryMocks.fetchStoryboardList.mockResolvedValue({
      ok: true,
      value: [
        { id: 'sb-one', title: 'One-shot board', createdAt: SB.createdAt, updatedAt: SB.updatedAt, shotCount: 1 },
        { id: 'sb-two', title: 'Two-shot board', createdAt: SB.createdAt, updatedAt: SB.updatedAt, shotCount: 2 },
      ],
    });
    window.history.replaceState(null, '', '/storyboard');
    renderSection();

    await waitFor(() => expect(screen.getAllByTestId('storyboard-card')).toHaveLength(2));
    expect(screen.getByText(/^1 shot ·/)).toBeTruthy();
    expect(screen.getByText(/^2 shots ·/)).toBeTruthy();
    expect(screen.queryByText(/^1 shots ·/)).toBeNull();
  });
});

describe('StoryboardSection guided commercial start', () => {
  beforeEach(() => {
    registryMocks.fetchStoryboardList.mockResolvedValue({ ok: true, value: [] });
    registryMocks.createStoryboard.mockResolvedValue({
      ok: true,
      value: { ...SB, id: 'commercial-1', title: 'Luma Bottle — Hero product commercial' },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('guides a nontechnical user through the five decisions needed to seed a commercial', async () => {
    window.history.replaceState(null, '', '/storyboard');
    renderSection();
    fireEvent.click(await screen.findByTestId('storyboard-new'));

    const dialog = screen.getByRole('dialog', { name: 'Start a storyboard' });
    expect(screen.getByText('Hero product commercial')).toBeTruthy();
    expect(screen.getByText('Recommended')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Product or service name'), { target: { value: 'Luma Bottle' } });
    fireEvent.change(screen.getByLabelText('Who is it for?'), { target: { value: 'Busy commuters' } });
    fireEvent.change(screen.getByLabelText('One promise to make'), { target: { value: 'Cold water all day' } });
    fireEvent.change(screen.getByLabelText('How should it feel?'), {
      target: { value: 'Clean daylight with tactile close-ups' },
    });
    fireEvent.change(screen.getByLabelText('What should viewers do next?'), {
      target: { value: 'Take cold water anywhere' },
    });
    fireEvent.change(screen.getByLabelText('Video shape'), { target: { value: '9:16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create commercial' }));

    await waitFor(() => {
      expect(registryMocks.createStoryboard).toHaveBeenCalledWith({
        recipe: 'hero-product-commercial',
        ratio: '9:16',
        commercialBrief: {
          productName: 'Luma Bottle',
          audience: 'Busy commuters',
          promise: 'Cold water all day',
          visualDirection: 'Clean daylight with tactile close-ups',
          callToAction: 'Take cold water anywhere',
        },
      });
    });
    expect(dialog).toBeTruthy();
    expect(window.location.pathname).toBe('/storyboard/commercial-1');
  });

  it('keeps a one-click blank storyboard path for experienced users', async () => {
    window.history.replaceState(null, '', '/storyboard');
    renderSection();
    fireEvent.click(await screen.findByTestId('storyboard-new'));
    fireEvent.click(screen.getByRole('button', { name: 'Start blank instead' }));

    await waitFor(() => expect(registryMocks.createStoryboard).toHaveBeenCalledWith({}));
  });

  it('closes with Escape and returns keyboard focus to New storyboard', async () => {
    window.history.replaceState(null, '', '/storyboard');
    renderSection();
    const trigger = await screen.findByTestId('storyboard-new');
    fireEvent.click(trigger);

    const productName = screen.getByLabelText('Product or service name');
    productName.focus();
    fireEvent.keyDown(productName, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Start a storyboard' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
