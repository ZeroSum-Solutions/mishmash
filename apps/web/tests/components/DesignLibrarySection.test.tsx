// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignLibraryCatalog } from '@open-design/contracts';

const fetchDesignLibraryCatalog = vi.fn();
const openDesignLibraryPath = vi.fn(async () => true);
vi.mock('../../src/providers/registry', () => ({
  fetchDesignLibraryCatalog: (...args: unknown[]) => fetchDesignLibraryCatalog(...(args as [])),
  designLibraryThumbUrl: (thumb: string) => `/api/design-library/thumb/${thumb.split('/').pop()}`,
  openDesignLibraryPath: (...args: unknown[]) => openDesignLibraryPath(...(args as [])),
}));

import { DesignLibrarySection } from '../../src/components/DesignLibrarySection';

const CATALOG: DesignLibraryCatalog = {
  library: 'Test Design Assets',
  rights_ledger: 'test ledger',
  note: 'test note',
  total_collections: 2,
  root: '/tmp/test-design-assets',
  groups: [
    {
      title: 'UI Kits',
      folder: '01 UI Kits',
      blurb: 'Purchased kits.',
      items: [
        {
          id: 'ui-kit-1',
          label: 'Neon Dashboard Kit',
          rel: '01 UI Kits/neon-dashboard',
          thumb: '.catalog/thumbs/ui-kit-1.jpg',
          kind: 'Figma file',
          files: 12,
          size: '40 MB',
          category: '01 UI Kits',
          domains: ['ui-kit', 'dashboard'],
          allowed_use: 'licensed-source-review',
        },
      ],
    },
    {
      title: 'App Captures',
      folder: '02 App Captures',
      blurb: 'Screenshots of other apps.',
      items: [
        {
          id: 'app-capture-1',
          label: 'Fintune (iOS)',
          rel: '02 App Captures/fintune',
          thumb: null,
          kind: 'No preview',
          files: 40,
          size: '12 MB',
          category: '02 App Captures',
          domains: ['app-ui', 'fintech'],
          allowed_use: 'human-local-only',
        },
      ],
    },
  ],
};

beforeEach(() => {
  fetchDesignLibraryCatalog.mockReset().mockResolvedValue({ ok: true, catalog: CATALOG });
  openDesignLibraryPath.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

describe('DesignLibrarySection', () => {
  it('fetches lazily and renders every group and item once the tab is active', async () => {
    render(<DesignLibrarySection active={false} />);
    expect(fetchDesignLibraryCatalog).not.toHaveBeenCalled();
    cleanup();

    render(<DesignLibrarySection active />);
    await screen.findByText('Neon Dashboard Kit');
    expect(screen.getByRole('heading', { name: 'UI Kits' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'App Captures' })).toBeTruthy();
    expect(screen.getByText('Fintune (iOS)')).toBeTruthy();
    expect(fetchDesignLibraryCatalog).toHaveBeenCalledTimes(1);
  });

  it('narrows the grid with the domain facet chip filter', async () => {
    render(<DesignLibrarySection active />);
    await screen.findByText('Neon Dashboard Kit');
    expect(screen.getByText('Fintune (iOS)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /fintech/ }));

    expect(screen.queryByText('Neon Dashboard Kit')).toBeNull();
    expect(screen.getByText('Fintune (iOS)')).toBeTruthy();

    // Clicking the same chip again clears the filter.
    fireEvent.click(screen.getByRole('button', { name: /fintech/ }));
    expect(screen.getByText('Neon Dashboard Kit')).toBeTruthy();
  });

  it('exposes no action beyond Open folder on a human-local-only card', async () => {
    render(<DesignLibrarySection active />);
    const label = await screen.findByText('Fintune (iOS)');
    const card = label.closest('article') as HTMLElement;
    expect(card.getAttribute('data-allowed-use')).toBe('human-local-only');

    const buttons = within(card).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    const [openFolderBtn] = buttons;
    expect(openFolderBtn).toBeTruthy();
    expect(openFolderBtn!.textContent).toContain('Open folder');

    fireEvent.click(openFolderBtn!);
    await waitFor(() => expect(openDesignLibraryPath).toHaveBeenCalledWith('02 App Captures/fintune'));
  });

  it('shows a friendly empty state when the daemon reports the library missing', async () => {
    fetchDesignLibraryCatalog.mockResolvedValue({ ok: false, notFound: true, message: 'design library not found' });
    render(<DesignLibrarySection active />);

    await screen.findByTestId('design-library-empty');
    expect(screen.getByText('Design Assets library not found on this machine.')).toBeTruthy();
  });
});
