// @vitest-environment jsdom
//
// Covers `design-system-publish-unpublish-delete` (canvas-feature-inventory.json),
// which had no existing test: the row action menu's publish/unpublish toggle and
// delete-with-confirm flow on a 'Mine' design system entry.
//
// DesignSystemsTab.test.tsx already covers the generic busy/toast chrome for a
// publish click (mocking a resolved update), but never asserts *which* status
// transition is requested, never exercises unpublish, the delete confirm/cancel
// branch, the default-system delete fallback reselection, or the failed-update
// path. Those state-transition contracts are what this file proves.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesignSystemSummary } from '@open-design/contracts';

import { DesignSystemsTab } from '../../src/components/DesignSystemsTab';
import { deleteDesignSystemDraft, updateDesignSystemDraft } from '../../src/providers/registry';

vi.mock('../../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../../src/providers/registry')>(
    '../../src/providers/registry',
  );
  return {
    ...actual,
    fetchDesignSystem: vi.fn(async (id: string) => ({
      id,
      title: id === 'user:acme' ? 'Acme Design System' : 'Beta Design System',
      summary: 'Internal product system.',
      category: 'Custom',
      body: `# ${id}\n\n## Colors\n- Primary #111111`,
    })),
    updateDesignSystemDraft: vi.fn(async () => null),
    deleteDesignSystemDraft: vi.fn(async () => true),
  };
});

afterEach(() => {
  cleanup();
  vi.mocked(updateDesignSystemDraft).mockReset();
  vi.mocked(updateDesignSystemDraft).mockResolvedValue(null);
  vi.mocked(deleteDesignSystemDraft).mockReset();
  vi.mocked(deleteDesignSystemDraft).mockResolvedValue(true);
  vi.restoreAllMocks();
});

function draftSystem(overrides: Partial<DesignSystemSummary> = {}): DesignSystemSummary {
  return {
    id: 'user:acme',
    title: 'Acme Design System',
    category: 'Custom',
    summary: 'Internal product system.',
    surface: 'web',
    source: 'user',
    status: 'draft',
    isEditable: true,
    ...overrides,
  };
}

function list() {
  return within(screen.getByTestId('design-systems-list'));
}

async function openOverflowMenu() {
  fireEvent.click(await screen.findByTestId('design-kit-more-actions'));
}

describe('DesignSystemsTab publish/unpublish/delete state transitions', () => {
  it('requests a publish transition (draft -> published) when toggling a draft system', async () => {
    const onSystemsRefresh = vi.fn(async () => {});
    vi.mocked(updateDesignSystemDraft).mockResolvedValueOnce({
      id: 'user:acme',
      title: 'Acme Design System',
      summary: 'Internal product system.',
      category: 'Custom',
      status: 'published',
      body: '# Acme',
    });

    render(
      <DesignSystemsTab
        systems={[draftSystem()]}
        selectedId={null}
        onSelect={() => {}}
        onSystemsRefresh={onSystemsRefresh}
      />,
    );

    const toggle = await screen.findByRole('button', { name: 'Draft' });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(updateDesignSystemDraft).toHaveBeenCalledWith('user:acme', { status: 'published' }),
    );
    await waitFor(() => expect(onSystemsRefresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Done')).toBeTruthy());
  });

  it('requests an unpublish transition (published -> draft) when toggling a published system', async () => {
    const onSystemsRefresh = vi.fn(async () => {});
    vi.mocked(updateDesignSystemDraft).mockResolvedValueOnce({
      id: 'user:acme',
      title: 'Acme Design System',
      summary: 'Internal product system.',
      category: 'Custom',
      status: 'draft',
      body: '# Acme',
    });

    render(
      <DesignSystemsTab
        systems={[draftSystem({ status: 'published' })]}
        selectedId={null}
        onSelect={() => {}}
        onSystemsRefresh={onSystemsRefresh}
      />,
    );

    const toggle = await screen.findByRole('button', { name: 'Published' });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(updateDesignSystemDraft).toHaveBeenCalledWith('user:acme', { status: 'draft' }),
    );
    await waitFor(() => expect(onSystemsRefresh).toHaveBeenCalled());
  });

  it('surfaces a failure toast and skips refresh when the publish update returns null', async () => {
    const onSystemsRefresh = vi.fn(async () => {});
    // Module-level mock already resolves null by default (see mock factory above).

    render(
      <DesignSystemsTab
        systems={[draftSystem()]}
        selectedId={null}
        onSelect={() => {}}
        onSystemsRefresh={onSystemsRefresh}
      />,
    );

    const toggle = await screen.findByRole('button', { name: 'Draft' });
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(screen.getByText('Something went wrong. Please try again.')).toBeTruthy(),
    );
    expect(onSystemsRefresh).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-busy')).toBeNull();
  });

  it('does not delete when the confirm dialog is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <DesignSystemsTab
        systems={[draftSystem()]}
        selectedId={null}
        onSelect={() => {}}
      />,
    );

    await openOverflowMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Acme Design System' }));

    expect(window.confirm).toHaveBeenCalledWith(
      'Delete "Acme Design System"? This removes the draft design system from this device.',
    );
    expect(deleteDesignSystemDraft).not.toHaveBeenCalled();
    // The row must still be present — nothing was removed from the list.
    expect(list().getByTestId('design-system-card-user:acme')).toBeTruthy();
  });

  it('deletes the system and refreshes the list when the confirm dialog is accepted', async () => {
    const onSystemsRefresh = vi.fn(async () => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <DesignSystemsTab
        systems={[draftSystem()]}
        selectedId={null}
        onSelect={() => {}}
        onSystemsRefresh={onSystemsRefresh}
      />,
    );

    await openOverflowMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Acme Design System' }));

    await waitFor(() => expect(deleteDesignSystemDraft).toHaveBeenCalledWith('user:acme'));
    await waitFor(() => expect(onSystemsRefresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Done')).toBeTruthy());
  });

  it('reselects a different remaining system when the deleted entry was the default', async () => {
    const onSelect = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <DesignSystemsTab
        systems={[draftSystem(), draftSystem({ id: 'user:beta', title: 'Beta Design System' })]}
        selectedId="user:acme"
        onSelect={onSelect}
      />,
    );

    await openOverflowMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Acme Design System' }));

    await waitFor(() => expect(deleteDesignSystemDraft).toHaveBeenCalledWith('user:acme'));
    // Must fall back to the OTHER surviving user system, never the one just deleted.
    expect(onSelect).toHaveBeenCalledWith('user:beta');
  });

  it('leaves the stale default pointer in place (never calls onSelect) when deleting the only remaining Mine system that was the default', async () => {
    // Pins the actual behavior of DesignSystemsTab.tsx's delete handler when
    // `systems.find(candidate => candidate.id !== system.id && isUserSystem(candidate))`
    // has no match: the `if (fallback) onSelect(fallback.id)` guard has no
    // `else` branch, so onSelect is simply never invoked. selectedId (and
    // whatever it feeds downstream, e.g. defaultDesignSystemId) keeps
    // pointing at an id that no longer exists after this delete succeeds.
    // See defects_found: onSelect's `(id: string) => void` signature has no
    // way to signal "no selection" without a wider prop-contract change
    // across every caller, which is out of scope for this unit — this test
    // only locks down what the component does today so a future change to
    // this behavior is a deliberate, visible diff instead of a silent one.
    const onSelect = vi.fn();
    const onSystemsRefresh = vi.fn(async () => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <DesignSystemsTab
        systems={[draftSystem()]}
        selectedId="user:acme"
        onSelect={onSelect}
        onSystemsRefresh={onSystemsRefresh}
      />,
    );

    await openOverflowMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Acme Design System' }));

    await waitFor(() => expect(deleteDesignSystemDraft).toHaveBeenCalledWith('user:acme'));
    await waitFor(() => expect(onSystemsRefresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Done')).toBeTruthy());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('surfaces a failure toast and does not reselect when delete returns false', async () => {
    const onSelect = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(deleteDesignSystemDraft).mockResolvedValueOnce(false);

    render(
      <DesignSystemsTab
        systems={[draftSystem()]}
        selectedId="user:acme"
        onSelect={onSelect}
      />,
    );

    await openOverflowMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete Acme Design System' }));

    await waitFor(() =>
      expect(screen.getByText('Something went wrong. Please try again.')).toBeTruthy(),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });
});
