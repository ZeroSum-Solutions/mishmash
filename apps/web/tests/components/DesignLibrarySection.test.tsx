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
  total_collections: 3,
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
          description: 'Dark glassmorphic analytics dashboard. Best for SaaS admin panels.',
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
        {
          id: 'neuform-reference-1',
          label: 'NeuForm Particle Field',
          rel: '05 NeuForm Favorites/Tools/particle-field',
          thumb: '.catalog/thumbs/neuform-particle-field.jpg',
          kind: 'NeuForm motion/WebGL tool',
          files: 2,
          size: '42 KB',
          category: '05 NeuForm Favorites/Tools',
          domains: ['neuform', 'webgl-motion'],
          allowed_use: 'human-local-only',
          description: 'Particle hero with restrained orbital motion.',
          aspects: ['WebGL', 'Hero', 'GSAP motion'],
          stacks: ['React', 'Three.js', 'GSAP'],
          reference: {
            source: 'NeuForm Pro favorite export',
            design: 'DESIGN.md',
            html: 'reference.html',
          },
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

  it('exposes no copy action beyond Open folder on a human-local-only card', async () => {
    render(<DesignLibrarySection active />);
    const label = await screen.findByText('Fintune (iOS)');
    const card = label.closest('article') as HTMLElement;
    expect(card.getAttribute('data-allowed-use')).toBe('human-local-only');

    // One button: Open folder. This card has no thumbnail so no preview
    // button either — and never Use as template on this tier.
    const buttons = within(card).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    const openFolderBtn = within(card).getByRole('button', { name: /open folder/i });
    expect(within(card).queryByText('Use as template')).toBeNull();

    fireEvent.click(openFolderBtn);
    await waitFor(() => expect(openDesignLibraryPath).toHaveBeenCalledWith('02 App Captures/fintune'));
  });

  it('offers Use as template only on copyable tiers when onOpenProject is provided', async () => {
    const onOpenProject = vi.fn();
    render(<DesignLibrarySection active onOpenProject={onOpenProject} />);

    const licensedLabel = await screen.findByText('Neon Dashboard Kit');
    const licensedCard = licensedLabel.closest('article') as HTMLElement;
    expect(licensedCard.getAttribute('data-allowed-use')).toBe('licensed-source-review');
    const licensedButtons = within(licensedCard).getAllByRole('button');
    expect(licensedButtons).toHaveLength(3);
    expect(within(licensedCard).getByText('Use as template')).toBeTruthy();

    const restrictedLabel = screen.getByText('Fintune (iOS)');
    const restrictedCard = restrictedLabel.closest('article') as HTMLElement;
    expect(restrictedCard.getAttribute('data-allowed-use')).toBe('human-local-only');
    const restrictedButtons = within(restrictedCard).getAllByRole('button');
    expect(restrictedButtons).toHaveLength(1);
    expect(within(restrictedCard).queryByText('Use as template')).toBeNull();
  });

  it('renders the description on the card when present and omits it when absent', async () => {
    render(<DesignLibrarySection active />);
    const label = await screen.findByText('Neon Dashboard Kit');
    const card = label.closest('article') as HTMLElement;
    expect(
      within(card).getByText('Dark glassmorphic analytics dashboard. Best for SaaS admin panels.'),
    ).toBeTruthy();

    const bareCard = screen.getByText('Fintune (iOS)').closest('article') as HTMLElement;
    expect(bareCard.querySelector('[data-testid="design-library-description"]')).toBeNull();
  });

  it('matches descriptions in search, not just labels', async () => {
    render(<DesignLibrarySection active />);
    await screen.findByText('Neon Dashboard Kit');

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'glassmorphic' } });
    expect(screen.getByText('Neon Dashboard Kit')).toBeTruthy();
    expect(screen.queryByText('Fintune (iOS)')).toBeNull();
  });

  it('opens a full-size preview dialog from the thumbnail and closes on Escape', async () => {
    render(<DesignLibrarySection active onOpenProject={vi.fn()} />);
    await screen.findByText('Neon Dashboard Kit');

    fireEvent.click(screen.getByRole('button', { name: 'Preview Neon Dashboard Kit' }));

    const dialog = await screen.findByRole('dialog', { name: 'Neon Dashboard Kit' });
    // Full uncropped composite (the "whole kit UI, laid out") plus the
    // kit's metadata and description.
    expect(within(dialog).getByRole('img', { name: 'Neon Dashboard Kit' })).toBeTruthy();
    expect(
      within(dialog).getByText('Dark glassmorphic analytics dashboard. Best for SaaS admin panels.'),
    ).toBeTruthy();
    // The same actions the card offers stay reachable from the dialog.
    expect(within(dialog).getByRole('button', { name: /open folder/i })).toBeTruthy();
    expect(within(dialog).getByText('Use as template')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Neon Dashboard Kit' })).toBeNull());
  });

  it('does not offer a preview on cards with no thumbnail', async () => {
    render(<DesignLibrarySection active />);
    await screen.findByText('Fintune (iOS)');
    expect(screen.queryByRole('button', { name: 'Preview Fintune (iOS)' })).toBeNull();
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

  it('selects an aspect and starts a prompt-only project from a private reference', async () => {
    startDesignLibraryProject.mockResolvedValue({
      ok: true,
      response: { ok: true, projectId: 'proj-ref', conversationId: 'conv-ref', copiedFiles: 0, skippedFiles: 0, warnings: [] },
    });
    const onOpenProject = vi.fn();
    render(<DesignLibrarySection active onOpenProject={onOpenProject} />);

    const label = await screen.findByText('NeuForm Particle Field');
    const card = label.closest('article') as HTMLElement;
    expect(within(card).getByText(/React · Three.js · GSAP/)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'WebGL' }));
    fireEvent.click(within(card).getByRole('button', { name: /Use design/ }));

    await waitFor(() =>
      expect(startDesignLibraryProject).toHaveBeenCalledWith(
        '05 NeuForm Favorites/Tools/particle-field',
        undefined,
        { mode: 'reference', aspects: ['WebGL'] },
      ),
    );
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith('proj-ref', 'conv-ref'));
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
