// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignLibraryCatalog } from '@open-design/contracts';

const fetchDesignLibraryCatalog = vi.fn();
const openDesignLibraryPath = vi.fn(async () => true);
const startDesignLibraryProject = vi.fn();
vi.mock('../../src/providers/registry', () => ({
  fetchDesignLibraryCatalog: (...args: unknown[]) => fetchDesignLibraryCatalog(...(args as [])),
  designLibraryThumbUrl: (thumb: string) => `/api/design-library/thumb/${thumb.split('/').pop()}`,
  openDesignLibraryPath: (...args: unknown[]) => openDesignLibraryPath(...(args as [])),
  startDesignLibraryProject: (...args: unknown[]) => startDesignLibraryProject(...(args as [])),
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
  startDesignLibraryProject.mockReset();
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

  it('offers Use as template only on copyable tiers when onOpenProject is provided', async () => {
    const onOpenProject = vi.fn();
    render(<DesignLibrarySection active onOpenProject={onOpenProject} />);

    const licensedLabel = await screen.findByText('Neon Dashboard Kit');
    const licensedCard = licensedLabel.closest('article') as HTMLElement;
    expect(licensedCard.getAttribute('data-allowed-use')).toBe('licensed-source-review');
    const licensedButtons = within(licensedCard).getAllByRole('button');
    expect(licensedButtons).toHaveLength(2);
    expect(within(licensedCard).getByText('Use as template')).toBeTruthy();

    const restrictedLabel = screen.getByText('Fintune (iOS)');
    const restrictedCard = restrictedLabel.closest('article') as HTMLElement;
    expect(restrictedCard.getAttribute('data-allowed-use')).toBe('human-local-only');
    const restrictedButtons = within(restrictedCard).getAllByRole('button');
    expect(restrictedButtons).toHaveLength(1);
    expect(within(restrictedCard).queryByText('Use as template')).toBeNull();
  });

  it('starts a project and navigates via onOpenProject when Use as template succeeds', async () => {
    startDesignLibraryProject.mockResolvedValue({
      ok: true,
      response: { ok: true, projectId: 'proj-1', conversationId: 'conv-1', copiedFiles: 12, skippedFiles: 0, warnings: [] },
    });
    const onOpenProject = vi.fn();
    render(<DesignLibrarySection active onOpenProject={onOpenProject} />);

    const label = await screen.findByText('Neon Dashboard Kit');
    const card = label.closest('article') as HTMLElement;
    fireEvent.click(within(card).getByText('Use as template'));

    await waitFor(() => expect(startDesignLibraryProject).toHaveBeenCalledWith('01 UI Kits/neon-dashboard'));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith('proj-1', 'conv-1'));
  });

  it('shows an inline error and does not navigate when Use as template fails', async () => {
    startDesignLibraryProject.mockResolvedValue({ ok: false, message: 'items with allowed_use cannot start a project' });
    const onOpenProject = vi.fn();
    render(<DesignLibrarySection active onOpenProject={onOpenProject} />);

    const label = await screen.findByText('Neon Dashboard Kit');
    const card = label.closest('article') as HTMLElement;
    fireEvent.click(within(card).getByText('Use as template'));

    await screen.findByText('items with allowed_use cannot start a project');
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it('shows a friendly empty state when the daemon reports the library missing', async () => {
    fetchDesignLibraryCatalog.mockResolvedValue({ ok: false, notFound: true, message: 'design library not found' });
    render(<DesignLibrarySection active />);

    await screen.findByTestId('design-library-empty');
    expect(screen.getByText('Design Assets library not found on this machine.')).toBeTruthy();
  });
});
