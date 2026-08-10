// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignLibraryCatalog } from '@open-design/contracts';

const fetchDesignLibraryCatalog = vi.fn();
const openDesignLibraryPath = vi.fn(async () => true);
const startDesignLibraryProject = vi.fn();
const openDesignLibraryLivePreview =
  vi.fn<() => Promise<{ ok: true } | { ok: false; message: string }>>(async () => ({ ok: true }));
const fetchDesignLibraryPromotions = vi.fn(async () => ({ ok: true, response: { promotions: [] } }));
const createDesignLibraryPromotion = vi.fn();
const uploadLibraryFile = vi.fn();
vi.mock('../../src/providers/registry', () => ({
  fetchDesignLibraryCatalog: (...args: unknown[]) => fetchDesignLibraryCatalog(...(args as [])),
  designLibraryThumbUrl: (thumb: string) => `/api/design-library/thumb/${thumb.split('/').pop()}`,
  designLibraryPreviewAssetUrl: (rel: string, file: string) =>
    `/api/design-library/preview-asset/${encodeURIComponent(rel)}/${file}`,
  openDesignLibraryPath: (...args: unknown[]) => openDesignLibraryPath(...(args as [])),
  startDesignLibraryProject: (...args: unknown[]) => startDesignLibraryProject(...(args as [])),
  openDesignLibraryLivePreview: (...args: unknown[]) => openDesignLibraryLivePreview(...(args as [])),
  fetchDesignLibraryPromotions: (...args: unknown[]) => fetchDesignLibraryPromotions(...(args as [])),
  createDesignLibraryPromotion: (...args: unknown[]) => createDesignLibraryPromotion(...args),
  uploadLibraryFile: (...args: unknown[]) => uploadLibraryFile(...args),
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
          gallery: ['.catalog/thumbs/ui-kit-1.jpg', '.catalog/thumbs/ui-kit-1-fig.png'],
          kind: 'Figma file',
          files: 12,
          size: '40 MB',
          category: 'ui-kit',
          domains: ['ui-kit', 'dashboard'],
          allowed_use: 'licensed-source-review',
          entry_html: 'index.html',
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
          category: 'capture',
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
          category: 'design-system',
          domains: ['neuform', 'webgl-motion'],
          allowed_use: 'human-local-only',
          entry_html: 'reference.html',
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
  openDesignLibraryLivePreview.mockReset().mockResolvedValue({ ok: true });
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

  it('uses the singular file unit for a one-file collection', async () => {
    fetchDesignLibraryCatalog.mockResolvedValue({
      ok: true,
      catalog: {
        ...CATALOG,
        groups: [
          {
            ...CATALOG.groups[0]!,
            items: [{ ...CATALOG.groups[0]!.items[0]!, files: 1, size: '11 MB', kind: 'Figma file' }],
          },
        ],
      },
    });

    render(<DesignLibrarySection active />);
    await screen.findByText('Neon Dashboard Kit');
    expect(screen.getByText('Figma file · 1 file · 11 MB')).toBeTruthy();
    expect(screen.queryByText('Figma file · 1 files · 11 MB')).toBeNull();
  });

  it('condenses domain facets into a counted select and narrows the grid', async () => {
    render(<DesignLibrarySection active />);
    await screen.findByText('Neon Dashboard Kit');
    expect(screen.getByText('Fintune (iOS)')).toBeTruthy();

    const domainSelect = screen.getByRole('combobox', { name: 'All domains' });
    expect(within(domainSelect).getByRole('option', { name: 'fintech (1)' })).toBeTruthy();
    expect(within(domainSelect).getByRole('option', { name: 'ui-kit (1)' })).toBeTruthy();

    fireEvent.change(domainSelect, { target: { value: 'fintech' } });

    expect(screen.queryByText('Neon Dashboard Kit')).toBeNull();
    expect(screen.getByText('Fintune (iOS)')).toBeTruthy();

    fireEvent.change(domainSelect, { target: { value: '' } });
    expect(screen.getByText('Neon Dashboard Kit')).toBeTruthy();
  });

  it('exposes no copy action beyond Open folder on a human-local-only card', async () => {
    render(<DesignLibrarySection active />);
    const label = await screen.findByText('Fintune (iOS)');
    const card = label.closest('article') as HTMLElement;
    expect(card.getAttribute('data-allowed-use')).toBe('human-local-only');

    // The cover opens catalog details even without a visual; the only other
    // action is Open folder. This tier never offers Use as template.
    const buttons = within(card).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(within(card).getByRole('button', { name: 'Preview Fintune (iOS)' })).toBeTruthy();
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
    // Thumb preview, Open folder, Open live preview (this item has an
    // entry_html), Use as template.
    const licensedButtons = within(licensedCard).getAllByRole('button');
    expect(licensedButtons).toHaveLength(4);
    expect(within(licensedCard).getByText('Use as template')).toBeTruthy();

    const restrictedLabel = screen.getByText('Fintune (iOS)');
    const restrictedCard = restrictedLabel.closest('article') as HTMLElement;
    expect(restrictedCard.getAttribute('data-allowed-use')).toBe('human-local-only');
    const restrictedButtons = within(restrictedCard).getAllByRole('button');
    expect(restrictedButtons).toHaveLength(2);
    expect(within(restrictedCard).queryByText('Use as template')).toBeNull();
  });

  it('removes the Use as template affordance when a catalog item is rights-blocked', async () => {
    fetchDesignLibraryCatalog.mockResolvedValue({
      ok: true,
      catalog: {
        ...CATALOG,
        total_collections: 1,
        groups: [{
          ...CATALOG.groups[0]!,
          items: [{ ...CATALOG.groups[0]!.items[0]!, allowed_use: 'blocked-pending-license' }],
        }],
      },
    });

    render(<DesignLibrarySection active onOpenProject={vi.fn()} />);
    const card = (await screen.findByText('Neon Dashboard Kit')).closest('article') as HTMLElement;
    expect(card.getAttribute('data-allowed-use')).toBe('blocked-pending-license');
    expect(within(card).queryByText('Use as template')).toBeNull();
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

  it('opens useful catalog details with an explicit fallback when no visual is available', async () => {
    render(<DesignLibrarySection active />);
    await screen.findByText('Fintune (iOS)');

    fireEvent.click(screen.getByRole('button', { name: 'Preview Fintune (iOS)' }));

    const dialog = await screen.findByRole('dialog', { name: 'Fintune (iOS)' });
    expect(within(dialog).getByText('Visual preview unavailable')).toBeTruthy();
    expect(within(dialog).getByText('No preview · 40 files · 12 MB')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /open folder/i })).toBeTruthy();
    expect(within(dialog).queryByRole('img')).toBeNull();
  });

  it('keeps every Human Local Only item in a stable bottom partition', async () => {
    fetchDesignLibraryCatalog.mockResolvedValue({
      ok: true,
      catalog: {
        ...CATALOG,
        total_collections: 4,
        groups: [
          CATALOG.groups[1]!,
          {
            title: 'Mixed',
            folder: '02 Mixed',
            blurb: 'Mixed rights.',
            items: [
              {
                ...CATALOG.groups[1]!.items[0]!,
                id: 'human-2',
                label: 'Second Human Reference',
                rel: '02 Mixed/human',
              },
              {
                ...CATALOG.groups[0]!.items[0]!,
                id: 'own-code-1',
                label: 'Own Code Project',
                rel: '02 Mixed/own-code',
                allowed_use: 'own-code',
              },
            ],
          },
          CATALOG.groups[0]!,
        ],
      },
    });

    render(<DesignLibrarySection active />);
    await screen.findByText('Own Code Project');

    const cards = screen.getAllByTestId('design-library-card');
    expect(cards.map((card) => card.getAttribute('data-allowed-use'))).toEqual([
      'own-code',
      'licensed-source-review',
      'human-local-only',
      'human-local-only',
      'human-local-only',
    ]);
    expect(cards.map((card) => within(card).getByRole('heading').textContent)).toEqual([
      'Own Code Project',
      'Neon Dashboard Kit',
      'Fintune (iOS)',
      'NeuForm Particle Field',
      'Second Human Reference',
    ]);
    expect(screen.getByRole('heading', { name: 'Human Local Only' })).toBeTruthy();
  });

  it('opens the guided create dialog from Use as template, then starts a project and navigates via onOpenProject on Skip all', async () => {
    startDesignLibraryProject.mockResolvedValue({
      ok: true,
      response: { ok: true, projectId: 'proj-1', conversationId: 'conv-1', entryFile: 'index.html', copiedFiles: 12, skippedFiles: 0, warnings: [] },
    });
    const onOpenProject = vi.fn();
    render(<DesignLibrarySection active onOpenProject={onOpenProject} />);

    const label = await screen.findByText('Neon Dashboard Kit');
    const card = label.closest('article') as HTMLElement;
    fireEvent.click(within(card).getByText('Use as template'));

    const dialog = await screen.findByTestId('guided-create-dialog');
    // Skip all reproduces today's single-click behavior exactly: no options
    // (in particular no brief) sent to startDesignLibraryProject at all.
    fireEvent.click(within(dialog).getByTestId('guided-create-skip'));

    await waitFor(() => expect(startDesignLibraryProject).toHaveBeenCalledWith('01 UI Kits/neon-dashboard', undefined, undefined));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith('proj-1', 'conv-1', 'index.html'));
  });

  it('collects guided create answers into the brief sent to startDesignLibraryProject', async () => {
    startDesignLibraryProject.mockResolvedValue({
      ok: true,
      response: { ok: true, projectId: 'proj-brief', conversationId: 'conv-brief', copiedFiles: 12, skippedFiles: 0, warnings: [] },
    });
    const onOpenProject = vi.fn();
    render(<DesignLibrarySection active onOpenProject={onOpenProject} />);

    const label = await screen.findByText('Neon Dashboard Kit');
    const card = label.closest('article') as HTMLElement;
    fireEvent.click(within(card).getByText('Use as template'));

    const dialog = await screen.findByTestId('guided-create-dialog');
    const screensPresets = within(dialog).getAllByTestId('guided-create-screens-preset');
    fireEvent.click(screensPresets.find((el) => el.getAttribute('data-value') === '5')!);
    fireEvent.click(within(dialog).getByTestId('guided-create-start'));

    await waitFor(() =>
      expect(startDesignLibraryProject).toHaveBeenCalledWith(
        '01 UI Kits/neon-dashboard',
        undefined,
        { mode: 'copy', brief: { screens: 5 } },
      ),
    );
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith('proj-brief', 'conv-brief', undefined));
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
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith('proj-ref', 'conv-ref', undefined));
  });

  it('shows an inline error and does not navigate when Use as template fails', async () => {
    startDesignLibraryProject.mockResolvedValue({ ok: false, message: 'items with allowed_use cannot start a project' });
    const onOpenProject = vi.fn();
    render(<DesignLibrarySection active onOpenProject={onOpenProject} />);

    const label = await screen.findByText('Neon Dashboard Kit');
    const card = label.closest('article') as HTMLElement;
    fireEvent.click(within(card).getByText('Use as template'));
    const dialog = await screen.findByTestId('guided-create-dialog');
    fireEvent.click(within(dialog).getByTestId('guided-create-skip'));

    await screen.findByText('items with allowed_use cannot start a project');
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it('shows a friendly empty state when the daemon reports the library missing', async () => {
    fetchDesignLibraryCatalog.mockResolvedValue({ ok: false, notFound: true, message: 'design library not found' });
    render(<DesignLibrarySection active />);

    await screen.findByTestId('design-library-empty');
    expect(screen.getByText('Design Assets library not found on this machine.')).toBeTruthy();
  });

  it('opens a live preview only for collections the catalog found an entry page for', async () => {
    render(<DesignLibrarySection active />);

    const withEntry = (await screen.findByText('Neon Dashboard Kit')).closest('article') as HTMLElement;
    fireEvent.click(within(withEntry).getByTestId('design-library-live-preview'));
    await waitFor(() =>
      expect(openDesignLibraryLivePreview).toHaveBeenCalledWith('01 UI Kits/neon-dashboard'),
    );

    // A collection with no entry_html ships no renderable page, so the action
    // is absent rather than present-and-failing.
    const withoutEntry = screen.getByText('Fintune (iOS)').closest('article') as HTMLElement;
    expect(within(withoutEntry).queryByTestId('design-library-live-preview')).toBeNull();

    // And a reference-only item is withheld even though it HAS an entry page:
    // rendering runs the author's scripts, so the tier gate decides, not the
    // mere presence of an HTML file.
    const referenceOnly = screen
      .getByText('NeuForm Particle Field')
      .closest('article') as HTMLElement;
    expect(referenceOnly.getAttribute('data-allowed-use')).toBe('human-local-only');
    expect(within(referenceOnly).queryByTestId('design-library-live-preview')).toBeNull();
  });

  it('surfaces the daemon reason when a live preview cannot be opened', async () => {
    openDesignLibraryLivePreview.mockResolvedValue({
      ok: false,
      message: 'this collection has no previewable HTML file',
    });
    render(<DesignLibrarySection active />);

    const card = (await screen.findByText('Neon Dashboard Kit')).closest('article') as HTMLElement;
    fireEvent.click(within(card).getByTestId('design-library-live-preview'));

    await screen.findByText('this collection has no previewable HTML file');
  });

  // --- card contract (t4/t11): cover, clamped title/description, metadata
  // row, actions, and image-load fallbacks ----------------------------------

  it('renders the full card shape: cover image, single-line title, clamped description, metadata row, and actions', async () => {
    render(<DesignLibrarySection active onOpenProject={vi.fn()} />);
    const label = await screen.findByText('Neon Dashboard Kit');
    const card = label.closest('article') as HTMLElement;

    const cover = within(card).getByTestId('design-library-cover');
    expect(within(cover).getByRole('img', { name: 'Neon Dashboard Kit' })).toBeTruthy();
    expect(within(card).getByRole('heading', { name: 'Neon Dashboard Kit' })).toBeTruthy();
    expect(within(card).getByTestId('design-library-description').textContent).toBe(
      'Dark glassmorphic analytics dashboard. Best for SaaS admin panels.',
    );
    const meta = within(card).getByTestId('design-library-meta');
    expect(meta.contains(within(card).getByRole('heading'))).toBe(true);
    const actions = within(card).getByTestId('design-library-actions');
    expect(within(actions).getByRole('button', { name: /open folder/i })).toBeTruthy();
  });

  it('swaps the cover to the shared fallback state when the thumbnail image fails to load', async () => {
    render(<DesignLibrarySection active />);
    const label = await screen.findByText('Neon Dashboard Kit');
    const card = label.closest('article') as HTMLElement;
    const cover = within(card).getByTestId('design-library-cover');

    const img = within(cover).getByRole('img', { name: 'Neon Dashboard Kit' });
    fireEvent.error(img);

    expect(within(cover).queryByRole('img')).toBeNull();
    // The fallback still fills the cover slot — never an empty collapse.
    expect(within(cover).getByText('Visual preview unavailable')).toBeTruthy();
  });

  it('keeps the cover image hidden until it decodes, so a failed load never flashes a broken-image glyph', async () => {
    render(<DesignLibrarySection active />);
    const label = await screen.findByText('Neon Dashboard Kit');
    const card = label.closest('article') as HTMLElement;
    const cover = within(card).getByTestId('design-library-cover');
    const img = within(cover).getByRole('img', { name: 'Neon Dashboard Kit' }) as HTMLImageElement;

    const classNameBeforeLoad = img.className;
    fireEvent.load(img);
    expect(img.className).not.toBe(classNameBeforeLoad);
  });

  it('renders the fallback immediately for a catalog item with a null thumb, without ever mounting an img', async () => {
    render(<DesignLibrarySection active />);
    const label = await screen.findByText('Fintune (iOS)');
    const card = label.closest('article') as HTMLElement;
    const cover = within(card).getByTestId('design-library-cover');

    expect(within(cover).queryByRole('img')).toBeNull();
    expect(within(cover).getByText('Visual preview unavailable')).toBeTruthy();
  });

  // --- detail view (t6/PRD C6): hero, identity, preview strip -------------

  it('renders the detail dialog\'s hero, title, category chip, description, and preview strip', async () => {
    render(<DesignLibrarySection active onOpenProject={vi.fn()} />);
    await screen.findByText('Neon Dashboard Kit');

    fireEvent.click(screen.getByRole('button', { name: 'Preview Neon Dashboard Kit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neon Dashboard Kit' });

    expect(within(dialog).getByTestId('design-library-hero-image')).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Neon Dashboard Kit' })).toBeTruthy();
    expect(within(dialog).getByText('Ui Kit')).toBeTruthy();
    expect(
      within(dialog).getByText('Dark glassmorphic analytics dashboard. Best for SaaS admin panels.'),
    ).toBeTruthy();
    expect(within(dialog).getAllByTestId('design-library-strip-item')).toHaveLength(2);
  });

  it('does not render a preview strip at all when the item has no thumb', async () => {
    render(<DesignLibrarySection active />);
    await screen.findByText('Fintune (iOS)');

    fireEvent.click(screen.getByRole('button', { name: 'Preview Fintune (iOS)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fintune (iOS)' });
    expect(dialog.querySelector('[data-testid="design-library-strip-item"]')).toBeNull();
  });

  it('omits the strip for an item with only a single cover image, no catalog gallery', async () => {
    render(<DesignLibrarySection active />);
    await screen.findByText('NeuForm Particle Field');

    fireEvent.click(screen.getByRole('button', { name: 'Preview NeuForm Particle Field' }));
    const dialog = await screen.findByRole('dialog', { name: 'NeuForm Particle Field' });
    expect(within(dialog).queryByTestId('design-library-strip-item')).toBeNull();
  });

  it('swaps the hero image when a strip thumbnail is clicked, without closing the dialog', async () => {
    render(<DesignLibrarySection active onOpenProject={vi.fn()} />);
    await screen.findByText('Neon Dashboard Kit');
    fireEvent.click(screen.getByRole('button', { name: 'Preview Neon Dashboard Kit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neon Dashboard Kit' });

    const hero = within(dialog).getByTestId('design-library-hero-image') as HTMLImageElement;
    expect(hero.getAttribute('src')).toBe('/api/design-library/thumb/ui-kit-1.jpg');

    const stripItems = within(dialog).getAllByTestId('design-library-strip-item');
    fireEvent.click(stripItems[1]!);

    const heroAfter = within(dialog).getByTestId('design-library-hero-image') as HTMLImageElement;
    expect(heroAfter.getAttribute('src')).toBe('/api/design-library/thumb/ui-kit-1-fig.png');
    // Still the same dialog — the strip never reloads it.
    expect(screen.getByRole('dialog', { name: 'Neon Dashboard Kit' })).toBeTruthy();
  });

  it('swaps the hero image with the left/right arrow keys', async () => {
    render(<DesignLibrarySection active onOpenProject={vi.fn()} />);
    await screen.findByText('Neon Dashboard Kit');
    fireEvent.click(screen.getByRole('button', { name: 'Preview Neon Dashboard Kit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neon Dashboard Kit' });

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(
      (within(dialog).getByTestId('design-library-hero-image') as HTMLImageElement).getAttribute('src'),
    ).toBe('/api/design-library/thumb/ui-kit-1-fig.png');

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(
      (within(dialog).getByTestId('design-library-hero-image') as HTMLImageElement).getAttribute('src'),
    ).toBe('/api/design-library/thumb/ui-kit-1.jpg');
  });

  // --- duplicate suppression (t9) ------------------------------------------

  it('hides duplicate_of items from the grid and notes how many were hidden', async () => {
    fetchDesignLibraryCatalog.mockResolvedValue({
      ok: true,
      catalog: {
        ...CATALOG,
        total_collections: 2,
        groups: [{
          title: 'UI Kits',
          folder: '01 UI Kits',
          blurb: 'Purchased kits.',
          items: [
            CATALOG.groups[0]!.items[0]!,
            {
              ...CATALOG.groups[0]!.items[0]!,
              id: 'ui-kit-1-dup',
              label: 'Neon Dashboard Kit (copy)',
              rel: '01 UI Kits/neon-dashboard-copy',
              duplicate_of: '01 UI Kits/neon-dashboard',
            },
          ],
        }],
      },
    });

    render(<DesignLibrarySection active />);
    await screen.findByText('Neon Dashboard Kit');

    expect(screen.queryByText('Neon Dashboard Kit (copy)')).toBeNull();
    expect(screen.getAllByTestId('design-library-card')).toHaveLength(1);
    expect(screen.getByText('1 duplicates hidden')).toBeTruthy();
  });

  // --- interactive kit canvas (t7/PRD C7) -----------------------------------

  it('offers Explore kit for a permitted ui-kit item with entry_html, and opens the canvas', async () => {
    render(<DesignLibrarySection active onOpenProject={vi.fn()} />);
    await screen.findByText('Neon Dashboard Kit');
    fireEvent.click(screen.getByRole('button', { name: 'Preview Neon Dashboard Kit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neon Dashboard Kit' });

    const exploreBtn = within(dialog).getByTestId('design-library-explore-kit');
    fireEvent.click(exploreBtn);

    // Explore kit replaces the detail dialog with the canvas.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Neon Dashboard Kit' })).toBeNull());
    const frame = (await screen.findByTestId('design-library-kit-canvas-frame')) as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe(
      '/api/design-library/preview-asset/01%20UI%20Kits%2Fneon-dashboard/index.html',
    );
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-popups');
    expect(frame.style.width).toBe('1280px');

    fireEvent.click(screen.getByTestId('design-library-canvas-mobile'));
    expect((screen.getByTestId('design-library-kit-canvas-frame') as HTMLIFrameElement).style.width).toBe(
      '390px',
    );
  });

  it('omits Explore kit for a human-local-only item even with a matching category and entry_html', async () => {
    render(<DesignLibrarySection active />);
    await screen.findByText('NeuForm Particle Field');
    fireEvent.click(screen.getByRole('button', { name: 'Preview NeuForm Particle Field' }));
    const dialog = await screen.findByRole('dialog', { name: 'NeuForm Particle Field' });

    expect(within(dialog).queryByTestId('design-library-explore-kit')).toBeNull();
  });

  it('omits Explore kit for an otherwise-permitted item with no renderable entry', async () => {
    fetchDesignLibraryCatalog.mockResolvedValue({
      ok: true,
      catalog: {
        ...CATALOG,
        groups: [
          {
            ...CATALOG.groups[0]!,
            items: [{ ...CATALOG.groups[0]!.items[0]!, entry_html: null }],
          },
          CATALOG.groups[1]!,
        ],
      },
    });

    render(<DesignLibrarySection active onOpenProject={vi.fn()} />);
    await screen.findByText('Neon Dashboard Kit');
    fireEvent.click(screen.getByRole('button', { name: 'Preview Neon Dashboard Kit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neon Dashboard Kit' });

    expect(within(dialog).queryByTestId('design-library-explore-kit')).toBeNull();
  });
});
