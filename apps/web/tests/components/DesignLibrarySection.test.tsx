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
    const openFolderBtn = within(card).getByRole('button', { name: /open file/i });
    expect(within(card).queryByText('Start project')).toBeNull();

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
    expect(within(licensedCard).getByText('Start project')).toBeTruthy();

    const restrictedLabel = screen.getByText('Fintune (iOS)');
    const restrictedCard = restrictedLabel.closest('article') as HTMLElement;
    expect(restrictedCard.getAttribute('data-allowed-use')).toBe('human-local-only');
    const restrictedButtons = within(restrictedCard).getAllByRole('button');
    expect(restrictedButtons).toHaveLength(2);
    expect(within(restrictedCard).queryByText('Start project')).toBeNull();
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
    expect(within(card).queryByText('Start project')).toBeNull();
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
    // MM-012#1: the live entry page, not a static composite, plus the kit's
    // metadata and description.
    expect(within(dialog).getByTestId('design-library-preview-frame')).toBeTruthy();
    expect(
      within(dialog).getByText('Dark glassmorphic analytics dashboard. Best for SaaS admin panels.'),
    ).toBeTruthy();
    // The same actions the card offers stay reachable from the dialog.
    expect(within(dialog).getByRole('button', { name: /open file/i })).toBeTruthy();
    expect(within(dialog).getByText('Start project')).toBeTruthy();

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
    expect(within(dialog).getByRole('button', { name: /open file/i })).toBeTruthy();
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
    // MM-008: startDesignLibraryProject's response already carries the full
    // daemon-built `project` record (including any pendingPrompt folded from
    // a brief) — onOpenProject must receive it as a 4th argument so the host
    // can register it in its client cache instead of navigating to a project
    // it has never seen.
    const project = {
      id: 'proj-1',
      name: 'Neon Dashboard Kit',
      skillId: null,
      designSystemId: null,
      createdAt: 0,
      updatedAt: 0,
      metadata: { kind: 'prototype' },
      pendingPrompt: null,
    };
    startDesignLibraryProject.mockResolvedValue({
      ok: true,
      response: { ok: true, projectId: 'proj-1', conversationId: 'conv-1', entryFile: 'index.html', project, copiedFiles: 12, skippedFiles: 0, warnings: [] },
    });
    const onOpenProject = vi.fn();
    render(<DesignLibrarySection active onOpenProject={onOpenProject} />);

    const label = await screen.findByText('Neon Dashboard Kit');
    const card = label.closest('article') as HTMLElement;
    fireEvent.click(within(card).getByText('Start project'));

    const dialog = await screen.findByTestId('guided-create-dialog');
    // Skip all reproduces today's single-click behavior exactly: no options
    // (in particular no brief) sent to startDesignLibraryProject at all.
    fireEvent.click(within(dialog).getByTestId('guided-create-skip'));

    await waitFor(() => expect(startDesignLibraryProject).toHaveBeenCalledWith('01 UI Kits/neon-dashboard', undefined, undefined));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith('proj-1', 'conv-1', 'index.html', project));
  });

  it('collects guided create answers into the brief sent to startDesignLibraryProject', async () => {
    const project = {
      id: 'proj-brief',
      name: 'Neon Dashboard Kit',
      skillId: null,
      designSystemId: null,
      createdAt: 0,
      updatedAt: 0,
      metadata: { kind: 'prototype' },
      // The guided brief is folded into pendingPrompt server-side — the
      // client never composes this text itself.
      pendingPrompt: 'Design brief:\n- Build 5 screens.',
    };
    startDesignLibraryProject.mockResolvedValue({
      ok: true,
      response: { ok: true, projectId: 'proj-brief', conversationId: 'conv-brief', project, copiedFiles: 12, skippedFiles: 0, warnings: [] },
    });
    const onOpenProject = vi.fn();
    render(<DesignLibrarySection active onOpenProject={onOpenProject} />);

    const label = await screen.findByText('Neon Dashboard Kit');
    const card = label.closest('article') as HTMLElement;
    fireEvent.click(within(card).getByText('Start project'));

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
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith('proj-brief', 'conv-brief', undefined, project));
  });

  it('selects an aspect and starts a prompt-only project from a private reference', async () => {
    const project = {
      id: 'proj-ref',
      name: 'NeuForm Particle Field',
      skillId: null,
      designSystemId: null,
      createdAt: 0,
      updatedAt: 0,
      metadata: { kind: 'prototype' },
      pendingPrompt: 'Reference the selected aspects.',
    };
    startDesignLibraryProject.mockResolvedValue({
      ok: true,
      response: { ok: true, projectId: 'proj-ref', conversationId: 'conv-ref', project, copiedFiles: 0, skippedFiles: 0, warnings: [] },
    });
    const onOpenProject = vi.fn();
    render(<DesignLibrarySection active onOpenProject={onOpenProject} />);

    const label = await screen.findByText('NeuForm Particle Field');
    const card = label.closest('article') as HTMLElement;
    // The suggested stack now lives in the hover panel, not permanently on
    // the card body (MM-011 standardized card height) — the AspectSelector
    // picker itself is unchanged and stays directly clickable.
    fireEvent.mouseEnter(within(card).getByTestId('design-library-title-area'));
    expect(within(card).getByText(/React · Three.js · GSAP/)).toBeTruthy();
    fireEvent.mouseLeave(within(card).getByTestId('design-library-title-area'));
    fireEvent.click(within(card).getByRole('button', { name: 'WebGL' }));
    fireEvent.click(within(card).getByRole('button', { name: /Start project/ }));

    await waitFor(() =>
      expect(startDesignLibraryProject).toHaveBeenCalledWith(
        '05 NeuForm Favorites/Tools/particle-field',
        undefined,
        { mode: 'reference', aspects: ['WebGL'] },
      ),
    );
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith('proj-ref', 'conv-ref', undefined, project));
  });

  it('shows an inline error and does not navigate when Use as template fails', async () => {
    startDesignLibraryProject.mockResolvedValue({ ok: false, message: 'items with allowed_use cannot start a project' });
    const onOpenProject = vi.fn();
    render(<DesignLibrarySection active onOpenProject={onOpenProject} />);

    const label = await screen.findByText('Neon Dashboard Kit');
    const card = label.closest('article') as HTMLElement;
    fireEvent.click(within(card).getByText('Start project'));
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
    expect(within(actions).getByRole('button', { name: /open file/i })).toBeTruthy();
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

  // --- detail view (t6/PRD C6): identity + preview pane --------------------
  // MM-012#1 replaced the old strip-of-tiny-thumbnails hero swap with a
  // single filled preview pane (live page first, then the catalog's other
  // gallery images) and explicit Next/Previous cycling — see the dedicated
  // MM-012#1 block below for the pane's own contract.

  it('renders the detail dialog\'s title, category chip, and description alongside the preview pane', async () => {
    render(<DesignLibrarySection active onOpenProject={vi.fn()} />);
    await screen.findByText('Neon Dashboard Kit');

    fireEvent.click(screen.getByRole('button', { name: 'Preview Neon Dashboard Kit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neon Dashboard Kit' });

    expect(within(dialog).getByTestId('design-library-preview-pane')).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Neon Dashboard Kit' })).toBeTruthy();
    expect(within(dialog).getByText('Ui Kit')).toBeTruthy();
    expect(
      within(dialog).getByText('Dark glassmorphic analytics dashboard. Best for SaaS admin panels.'),
    ).toBeTruthy();
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

  // --- MM-011: Templates-pattern grid + standardized card + hover panel ----

  it('lays every card out inside a group grid container, Templates-style', async () => {
    render(<DesignLibrarySection active />);
    await screen.findByText('Neon Dashboard Kit');

    const grids = screen.getAllByTestId('design-library-grid');
    expect(grids.length).toBeGreaterThan(0);
    const cards = screen.getAllByTestId('design-library-card');
    for (const card of cards) {
      expect(grids.some((grid) => grid.contains(card))).toBe(true);
    }
  });

  it('keeps domains and the suggested-stack line off the card body by default', async () => {
    render(<DesignLibrarySection active />);
    const label = await screen.findByText('NeuForm Particle Field');
    const card = label.closest('article') as HTMLElement;

    // These are catalog metadata (domains, suggested stack) that used to sit
    // permanently on the card and push its height around — MM-011 moves them
    // into the hover panel / detail dialog so every card shares one height.
    expect(within(card).queryByText(/React · Three\.js · GSAP/)).toBeNull();
    expect(within(card).queryByText('webgl-motion')).toBeNull();
  });

  it('shows a read-only hover panel over the title/description area with no click, and hides it again on mouseleave', async () => {
    render(<DesignLibrarySection active />);
    const label = await screen.findByText('NeuForm Particle Field');
    const card = label.closest('article') as HTMLElement;
    const titleArea = within(card).getByTestId('design-library-title-area');

    expect(within(card).queryByTestId('design-library-hover-panel')).toBeNull();

    fireEvent.mouseEnter(titleArea);
    const panel = within(card).getByTestId('design-library-hover-panel');
    expect(within(panel).getByText('NeuForm Particle Field')).toBeTruthy();
    expect(within(panel).getByText('Particle hero with restrained orbital motion.')).toBeTruthy();
    expect(within(panel).getByText(/React · Three\.js · GSAP/)).toBeTruthy();
    expect(within(panel).getByText(/WebGL · Hero · GSAP motion/)).toBeTruthy();
    // Orientation only — this is not the carry-forward picker, so nothing in
    // the panel itself is clickable.
    expect(within(panel).queryAllByRole('button')).toHaveLength(0);

    fireEvent.mouseLeave(titleArea);
    expect(within(card).queryByTestId('design-library-hover-panel')).toBeNull();
  });

  it('omits the suggested-stack and carry-forward hover sections when the catalog has neither, without hiding the panel itself', async () => {
    render(<DesignLibrarySection active />);
    const label = await screen.findByText('Neon Dashboard Kit');
    const card = label.closest('article') as HTMLElement;
    const titleArea = within(card).getByTestId('design-library-title-area');

    fireEvent.mouseEnter(titleArea);
    const panel = within(card).getByTestId('design-library-hover-panel');
    expect(within(panel).getByText('Neon Dashboard Kit')).toBeTruthy();
    expect(
      within(panel).getByText('Dark glassmorphic analytics dashboard. Best for SaaS admin panels.'),
    ).toBeTruthy();
    // Substring match — the rendered label carries a trailing ":" (see
    // hoverPanelLabel in the component), so an exact match here would be a
    // false-negative-proof no-op regardless of whether the section leaked in.
    expect(within(panel).queryByText(/Suggested stack/)).toBeNull();
    expect(within(panel).queryByText(/Could carry forward/)).toBeNull();
  });

  it('keeps a long description fully in the DOM even though the panel visually line-clamps it — truncation is CSS-only, not a data cut', async () => {
    const longDescription =
      'A very long description that repeats itself many times over so that it would overflow any fixed-height box. '.repeat(
        6,
      );
    fetchDesignLibraryCatalog.mockResolvedValue({
      ok: true,
      catalog: {
        ...CATALOG,
        groups: [
          {
            ...CATALOG.groups[0]!,
            items: [{ ...CATALOG.groups[0]!.items[0]!, description: longDescription }],
          },
        ],
      },
    });

    render(<DesignLibrarySection active />);
    const label = await screen.findByText('Neon Dashboard Kit');
    const card = label.closest('article') as HTMLElement;
    fireEvent.mouseEnter(within(card).getByTestId('design-library-title-area'));

    const panel = within(card).getByTestId('design-library-hover-panel');
    // No JS-level slicing anywhere in the render path — the full string is
    // in the DOM; only CSS (-webkit-line-clamp) governs what paints.
    expect(panel.textContent).toContain(longDescription.trim());
  });

  it('opens the hover panel on real keyboard focus, with a visible-focus tab stop', async () => {
    render(<DesignLibrarySection active />);
    const label = await screen.findByText('NeuForm Particle Field');
    const card = label.closest('article') as HTMLElement;
    const titleArea = within(card).getByTestId('design-library-title-area');

    expect(within(card).queryByTestId('design-library-hover-panel')).toBeNull();

    // Real DOM .focus() (not fireEvent.focus, which dispatches a focus event
    // regardless of focusability) — jsdom only moves activeElement here if
    // the element is genuinely focusable, i.e. carries a tabIndex. This is
    // the exact defect being fixed: a plain, tabIndex-less div is not a real
    // tab stop, so this assertion alone would fail against the old markup.
    titleArea.focus();
    expect(document.activeElement).toBe(titleArea);

    // jsdom's native .focus() does not dispatch the bubbling `focusin` event
    // React's synthetic onFocus delegates through, so drive the handler with
    // the same bubbling event a real Tab keypress produces.
    fireEvent.focusIn(titleArea);
    expect(within(card).getByTestId('design-library-hover-panel')).toBeTruthy();

    fireEvent.focusOut(titleArea);
    expect(within(card).queryByTestId('design-library-hover-panel')).toBeNull();
  });

  it('dismisses the hover panel on Escape without closing anything else', async () => {
    render(<DesignLibrarySection active />);
    const label = await screen.findByText('NeuForm Particle Field');
    const card = label.closest('article') as HTMLElement;
    const titleArea = within(card).getByTestId('design-library-title-area');

    titleArea.focus();
    fireEvent.focusIn(titleArea);
    expect(within(card).getByTestId('design-library-hover-panel')).toBeTruthy();

    fireEvent.keyDown(titleArea, { key: 'Escape' });
    expect(within(card).queryByTestId('design-library-hover-panel')).toBeNull();
    // Focus itself is untouched — Escape dismisses the panel, not the page.
    expect(document.activeElement).toBe(titleArea);
  });

  it('associates the open hover panel to its trigger via aria-describedby/aria-expanded, and the panel is a non-interactive group (not a tooltip — it carries multiple labeled sections, not short plain text)', async () => {
    render(<DesignLibrarySection active />);
    const label = await screen.findByText('NeuForm Particle Field');
    const card = label.closest('article') as HTMLElement;
    const titleArea = within(card).getByTestId('design-library-title-area');

    expect(titleArea.getAttribute('aria-describedby')).toBeNull();
    expect(titleArea.getAttribute('aria-expanded')).toBe('false');

    fireEvent.mouseEnter(titleArea);
    const panel = within(card).getByTestId('design-library-hover-panel');
    expect(panel.getAttribute('role')).toBe('group');
    expect(titleArea.getAttribute('aria-describedby')).toBe(panel.id);
    expect(titleArea.getAttribute('aria-expanded')).toBe('true');

    fireEvent.mouseLeave(titleArea);
    expect(titleArea.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the card actions in the accessibility tree and clickable while the hover panel is open', async () => {
    render(<DesignLibrarySection active onOpenProject={vi.fn()} />);
    const label = await screen.findByText('Neon Dashboard Kit');
    const card = label.closest('article') as HTMLElement;
    const titleArea = within(card).getByTestId('design-library-title-area');

    fireEvent.mouseEnter(titleArea);
    expect(within(card).getByTestId('design-library-hover-panel')).toBeTruthy();

    // The occlusion fix is that the panel never captures the pointer — the
    // action row stays reachable (present, findable by role, and clickable)
    // the entire time the panel is open, not just after it closes.
    const openFileBtn = within(card).getByRole('button', { name: /open file/i });
    expect(openFileBtn).toBeTruthy();
    fireEvent.click(openFileBtn);
    expect(openDesignLibraryPath).toHaveBeenCalledWith('01 UI Kits/neon-dashboard');
  });

  // --- MM-012#1: preview pane shows the live page first, cyclable ---------

  it('opens the detail dialog straight to the live first example, filling the pane, with a 1-of-N counter', async () => {
    render(<DesignLibrarySection active onOpenProject={vi.fn()} />);
    await screen.findByText('Neon Dashboard Kit');
    fireEvent.click(screen.getByRole('button', { name: 'Preview Neon Dashboard Kit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neon Dashboard Kit' });

    const frame = within(dialog).getByTestId('design-library-preview-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe(
      '/api/design-library/preview-asset/01%20UI%20Kits%2Fneon-dashboard/index.html',
    );
    expect(within(dialog).queryByTestId('design-library-hero-image')).toBeNull();
    expect(within(dialog).getByText('1 of 3')).toBeTruthy();
  });

  it('cycles forward through the other examples with Next, and wraps back to the live example', async () => {
    render(<DesignLibrarySection active onOpenProject={vi.fn()} />);
    await screen.findByText('Neon Dashboard Kit');
    fireEvent.click(screen.getByRole('button', { name: 'Preview Neon Dashboard Kit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neon Dashboard Kit' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Next example' }));
    expect(within(dialog).queryByTestId('design-library-preview-frame')).toBeNull();
    expect(
      (within(dialog).getByTestId('design-library-hero-image') as HTMLImageElement).getAttribute('src'),
    ).toBe('/api/design-library/thumb/ui-kit-1.jpg');
    expect(within(dialog).getByText('2 of 3')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Next example' }));
    expect(
      (within(dialog).getByTestId('design-library-hero-image') as HTMLImageElement).getAttribute('src'),
    ).toBe('/api/design-library/thumb/ui-kit-1-fig.png');
    expect(within(dialog).getByText('3 of 3')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Next example' }));
    expect(within(dialog).getByTestId('design-library-preview-frame')).toBeTruthy();
    expect(within(dialog).getByText('1 of 3')).toBeTruthy();
  });

  it('cycles backward through the examples with the left/right arrow keys', async () => {
    render(<DesignLibrarySection active onOpenProject={vi.fn()} />);
    await screen.findByText('Neon Dashboard Kit');
    fireEvent.click(screen.getByRole('button', { name: 'Preview Neon Dashboard Kit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neon Dashboard Kit' });

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(within(dialog).getByText('3 of 3')).toBeTruthy();
    expect(
      (within(dialog).getByTestId('design-library-hero-image') as HTMLImageElement).getAttribute('src'),
    ).toBe('/api/design-library/thumb/ui-kit-1-fig.png');

    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(within(dialog).getByText('1 of 3')).toBeTruthy();
    expect(within(dialog).getByTestId('design-library-preview-frame')).toBeTruthy();
  });

  it('omits the cycle controls entirely when the item has only one example', async () => {
    render(<DesignLibrarySection active />);
    await screen.findByText('NeuForm Particle Field');
    fireEvent.click(screen.getByRole('button', { name: 'Preview NeuForm Particle Field' }));
    const dialog = await screen.findByRole('dialog', { name: 'NeuForm Particle Field' });

    expect(within(dialog).queryByRole('button', { name: 'Next example' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Previous example' })).toBeNull();
    expect(within(dialog).queryByText(/of 1/)).toBeNull();
  });

  it('omits cycle controls when the item has no visual and no live preview at all', async () => {
    render(<DesignLibrarySection active />);
    await screen.findByText('Fintune (iOS)');
    fireEvent.click(screen.getByRole('button', { name: 'Preview Fintune (iOS)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Fintune (iOS)' });

    expect(within(dialog).queryByTestId('design-library-preview-frame')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Next example' })).toBeNull();
  });

  it('falls back to the unavailable state when a gallery example image fails to load', async () => {
    render(<DesignLibrarySection active onOpenProject={vi.fn()} />);
    await screen.findByText('Neon Dashboard Kit');
    fireEvent.click(screen.getByRole('button', { name: 'Preview Neon Dashboard Kit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neon Dashboard Kit' });

    // Move off the live first example onto a plain gallery image example.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next example' }));
    const img = within(dialog).getByTestId('design-library-hero-image');
    fireEvent.error(img);

    expect(within(dialog).queryByTestId('design-library-hero-image')).toBeNull();
    expect(within(dialog).getByText('Visual preview unavailable')).toBeTruthy();
  });
});
