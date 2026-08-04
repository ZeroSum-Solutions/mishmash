// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignLibraryCatalog } from '@open-design/contracts';

const fetchDesignLibraryCatalog = vi.fn();
const startDesignLibraryProject = vi.fn();
vi.mock('../../src/providers/registry', () => ({
  fetchDesignLibraryCatalog: (...args: unknown[]) => fetchDesignLibraryCatalog(...(args as [])),
  designLibraryThumbUrl: (thumb: string) => `/api/design-library/thumb/${thumb.split('/').pop()}`,
  startDesignLibraryProject: (...args: unknown[]) => startDesignLibraryProject(...(args as [])),
}));

import { FeaturedTemplatesRow } from '../../src/components/FeaturedTemplatesRow';

const CATALOG: DesignLibraryCatalog = {
  library: 'Test Design Assets',
  rights_ledger: 'test ledger',
  note: 'test note',
  total_collections: 4,
  root: '/tmp/test-design-assets',
  groups: [
    {
      title: 'UI8 Kits',
      folder: '01 UI8 Kits',
      blurb: 'Purchased kits.',
      items: [
        {
          id: 'dwell',
          label: 'Dwell',
          rel: '01 UI8 Kits/dwell',
          thumb: '.catalog/thumbs/dwell.jpg',
          kind: 'Next.js template',
          files: 40,
          size: '20 MB',
          category: '01 UI8 Kits',
          domains: ['real-estate'],
          allowed_use: 'licensed-source-review',
        },
        {
          id: 'morrow',
          label: 'Morrow',
          rel: '01 UI8 Kits/morrow-architecture-website-template',
          thumb: null,
          kind: 'Next.js template',
          files: 30,
          size: '15 MB',
          category: '01 UI8 Kits',
          domains: ['architecture'],
          allowed_use: 'licensed-source-review',
        },
        {
          id: 'azurio',
          label: 'Azurio',
          rel: '01 UI8 Kits/azurio-digital-agency-and-personal-portfolio-html-template',
          thumb: null,
          kind: 'HTML template',
          files: 25,
          size: '10 MB',
          category: '01 UI8 Kits',
          domains: ['agency'],
          allowed_use: 'licensed-source-review',
        },
        {
          id: 'core2',
          label: 'Core 2',
          rel: '01 UI8 Kits/core-2-dashboard-builder-react',
          thumb: null,
          kind: 'React template',
          files: 60,
          size: '30 MB',
          category: '01 UI8 Kits',
          domains: ['dashboard'],
          allowed_use: 'licensed-source-review',
        },
      ],
    },
  ],
};

beforeEach(() => {
  fetchDesignLibraryCatalog.mockReset().mockResolvedValue({ ok: true, catalog: CATALOG });
  startDesignLibraryProject.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('FeaturedTemplatesRow', () => {
  it('renders 4 template cards, 3 tool cards, and the library tail card, with the UI8 badge only on template cards', async () => {
    render(<FeaturedTemplatesRow onOpenProject={vi.fn()} onToolAction={vi.fn()} onBrowseLibrary={vi.fn()} />);

    const templateCards = await screen.findAllByTestId('featured-template-card');
    expect(templateCards).toHaveLength(4);
    const toolCards = screen.getAllByTestId('featured-tool-card');
    expect(toolCards).toHaveLength(3);
    expect(screen.getByTestId('featured-library-card')).toBeTruthy();

    for (const card of templateCards) {
      expect(card.textContent).toContain('UI8 licensed');
    }
    for (const card of toolCards) {
      expect(card.textContent).not.toContain('UI8 licensed');
    }

    expect(screen.getByText('Dwell')).toBeTruthy();
    expect(screen.getByText('Morrow')).toBeTruthy();
    expect(screen.getByText('Azurio')).toBeTruthy();
    expect(screen.getByText('Core 2')).toBeTruthy();
    expect(screen.getByText('Scroll film')).toBeTruthy();
    expect(screen.getByText('Hero creation')).toBeTruthy();
    expect(screen.getByText('Clone + rebrand')).toBeTruthy();
    expect(screen.getByText('Browse the kit library')).toBeTruthy();
  });

  it('hides the template cards but keeps the tools row when the catalog is absent', async () => {
    fetchDesignLibraryCatalog.mockResolvedValue({ ok: false, notFound: true, message: 'not found' });
    render(<FeaturedTemplatesRow onOpenProject={vi.fn()} onToolAction={vi.fn()} onBrowseLibrary={vi.fn()} />);

    await waitFor(() => expect(fetchDesignLibraryCatalog).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('featured-template-card')).toBeNull();
    expect(screen.getAllByTestId('featured-tool-card')).toHaveLength(3);
    expect(screen.getByTestId('featured-library-card')).toBeTruthy();
  });

  it('starts a project from a template card and opens it on success', async () => {
    startDesignLibraryProject.mockResolvedValue({
      ok: true,
      response: { ok: true, projectId: 'proj-123', conversationId: 'conv-1' },
    });
    const onOpenProject = vi.fn();
    render(<FeaturedTemplatesRow onOpenProject={onOpenProject} onToolAction={vi.fn()} onBrowseLibrary={vi.fn()} />);

    const dwellCard = await screen.findByText('Dwell');
    fireEvent.click(dwellCard.closest('button')!);

    await waitFor(() => expect(startDesignLibraryProject).toHaveBeenCalledWith('01 UI8 Kits/dwell'));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith('proj-123'));
  });

  it('shows an error toast and does not navigate when starting a template project fails', async () => {
    startDesignLibraryProject.mockResolvedValue({ ok: false, message: 'boom' });
    const onOpenProject = vi.fn();
    render(<FeaturedTemplatesRow onOpenProject={onOpenProject} onToolAction={vi.fn()} onBrowseLibrary={vi.fn()} />);

    const dwellCard = await screen.findByText('Dwell');
    fireEvent.click(dwellCard.closest('button')!);

    await screen.findByRole('alert');
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  // Red spec: the daemon's failure reason must reach the user. This row used
  // to swallow `result.message` in favor of a generic toast while
  // DesignLibrarySection surfaced it — the two surfaces call the same
  // endpoint and must fail the same way.
  it('surfaces the backend failure reason in the error toast', async () => {
    startDesignLibraryProject.mockResolvedValue({
      ok: false,
      message:
        'This kit cannot be copied completely: size limit would skip a required file (.next/cache/webpack/client-development/29.pack).',
    });
    render(<FeaturedTemplatesRow onOpenProject={vi.fn()} onToolAction={vi.fn()} onBrowseLibrary={vi.fn()} />);

    const dwellCard = await screen.findByText('Dwell');
    fireEvent.click(dwellCard.closest('button')!);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('size limit would skip a required file');
  });

  it('excludes a featured card whose catalog item is not copyable, even when present', async () => {
    const [baseGroup] = CATALOG.groups;
    if (!baseGroup) throw new Error('CATALOG must have at least one group');
    const restrictedCatalog: DesignLibraryCatalog = {
      ...CATALOG,
      groups: [
        {
          ...baseGroup,
          items: baseGroup.items.map((item) =>
            item.rel === '01 UI8 Kits/dwell' ? { ...item, allowed_use: 'human-local-only' } : item,
          ),
        },
      ],
    };
    fetchDesignLibraryCatalog.mockResolvedValue({ ok: true, catalog: restrictedCatalog });
    render(<FeaturedTemplatesRow onOpenProject={vi.fn()} onToolAction={vi.fn()} onBrowseLibrary={vi.fn()} />);

    const templateCards = await screen.findAllByTestId('featured-template-card');
    expect(templateCards).toHaveLength(3);
    expect(screen.queryByText('Dwell')).toBeNull();
    expect(screen.getByText('Morrow')).toBeTruthy();
    expect(screen.getByText('Azurio')).toBeTruthy();
    expect(screen.getByText('Core 2')).toBeTruthy();
  });

  it('degrades to the tools-only row when the catalog result is malformed, without an unhandled rejection', async () => {
    // Reproduces the HomeView test-suite failure wave: a blind-cast catalog
    // (`{ ok: true, catalog: {} }`) used to throw inside the fetch .then and
    // surface as 14 unhandled rejections across suites.
    fetchDesignLibraryCatalog.mockResolvedValue({ ok: true, catalog: {} as DesignLibraryCatalog });
    render(<FeaturedTemplatesRow onOpenProject={vi.fn()} onToolAction={vi.fn()} onBrowseLibrary={vi.fn()} />);

    await waitFor(() => expect(fetchDesignLibraryCatalog).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('featured-template-card')).toBeNull();
    expect(screen.getAllByTestId('featured-tool-card')).toHaveLength(3);
    expect(screen.getByTestId('featured-library-card')).toBeTruthy();
  });

  it('fires onToolAction with the right tool id for each tool card', async () => {
    const onToolAction = vi.fn();
    render(<FeaturedTemplatesRow onOpenProject={vi.fn()} onToolAction={onToolAction} onBrowseLibrary={vi.fn()} />);

    fireEvent.click(screen.getByText('Scroll film').closest('button')!);
    expect(onToolAction).toHaveBeenCalledWith('scroll-film');

    fireEvent.click(screen.getByText('Hero creation').closest('button')!);
    expect(onToolAction).toHaveBeenCalledWith('hero-creation');

    fireEvent.click(screen.getByText('Clone + rebrand').closest('button')!);
    expect(onToolAction).toHaveBeenCalledWith('clone-rebrand');

    expect(onToolAction).toHaveBeenCalledTimes(3);
  });

  it('fires onBrowseLibrary (not onToolAction) from the library tail card', async () => {
    const onToolAction = vi.fn();
    const onBrowseLibrary = vi.fn();
    render(
      <FeaturedTemplatesRow
        onOpenProject={vi.fn()}
        onToolAction={onToolAction}
        onBrowseLibrary={onBrowseLibrary}
      />,
    );

    fireEvent.click(screen.getByTestId('featured-library-card'));
    expect(onBrowseLibrary).toHaveBeenCalledTimes(1);
    expect(onToolAction).not.toHaveBeenCalled();
  });
});
