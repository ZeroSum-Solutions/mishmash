// @vitest-environment jsdom
//
// Specs for the storyboard style-reference control (see
// apps/daemon/tests/storyboard/style-reference.test.ts for the server half):
// pasting DESIGN.md applies a style reference through the daemon route,
// an active reference shows its brand name and can be removed, and API
// failures surface inline without losing the dialog.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Storyboard } from '@open-design/contracts';

const mockSetStoryboardStyleReference = vi.fn();
const mockClearStoryboardStyleReference = vi.fn();

vi.mock('../../src/providers/registry', () => ({
  setStoryboardStyleReference: (...args: unknown[]) => mockSetStoryboardStyleReference(...args),
  clearStoryboardStyleReference: (...args: unknown[]) => mockClearStoryboardStyleReference(...args),
}));

import { StyleReferenceControl } from '../../src/components/storyboard/StyleReferenceControl';

const DESIGN_MD = '---\nname: Heritage\ncolors:\n  accent: "#8a5a2b"\n---\n# Heritage\n';

function baseDoc(overrides: Partial<Storyboard> = {}): Storyboard {
  return {
    id: 'sb-1',
    title: 'Test storyboard',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ratio: '16:9',
    moodDrafts: [],
    shots: [],
    ...overrides,
  };
}

function styledDoc(): Storyboard {
  return baseDoc({
    styleReference: {
      source: 'design-md',
      updatedAt: '2026-01-02T00:00:00.000Z',
      brand: {
        name: 'Heritage',
        tagline: '',
        description: '',
        sourceUrl: 'designmd://heritage',
        logo: { primary: null, alternates: [], notes: '' },
        colors: [
          { role: 'accent', hex: '#8a5a2b', oklch: '', name: 'Accent', usage: 'primary actions' },
        ],
        typography: {
          display: { family: 'Fraunces', fallbacks: [], weights: [400, 700] },
          body: { family: 'Source Serif Pro', fallbacks: [], weights: [400, 700] },
        },
        voice: {
          adjectives: [],
          tone: 'Calm, tactile, confident.',
          messagingPillars: [],
          vocabulary: { use: [], avoid: [] },
        },
        imagery: { style: '', subjects: [], treatment: '', avoid: [] },
        layout: { radius: '8px', borderWeight: '1px', spacing: '8px', postureRules: [] },
      },
    },
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StyleReferenceControl', () => {
  it('applies pasted DESIGN.md through the daemon and reports the updated doc', async () => {
    const applied = styledDoc();
    mockSetStoryboardStyleReference.mockResolvedValue({ ok: true, value: applied });
    const onApplied = vi.fn();
    render(<StyleReferenceControl storyboard={baseDoc()} onApplied={onApplied} />);

    fireEvent.click(screen.getByTestId('style-reference-trigger'));
    fireEvent.change(screen.getByTestId('style-reference-input'), {
      target: { value: DESIGN_MD },
    });
    fireEvent.click(screen.getByTestId('style-reference-apply'));

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(applied));
    expect(mockSetStoryboardStyleReference).toHaveBeenCalledWith('sb-1', DESIGN_MD);
    // Dialog closed after a successful apply.
    expect(screen.queryByTestId('style-reference-input')).toBeNull();
  });

  it('does not call the daemon for an empty paste', async () => {
    render(<StyleReferenceControl storyboard={baseDoc()} onApplied={vi.fn()} />);
    fireEvent.click(screen.getByTestId('style-reference-trigger'));
    fireEvent.click(screen.getByTestId('style-reference-apply'));
    expect(mockSetStoryboardStyleReference).not.toHaveBeenCalled();
  });

  it('shows the active brand name and removes the reference on request', async () => {
    const cleared = baseDoc();
    mockClearStoryboardStyleReference.mockResolvedValue({ ok: true, value: cleared });
    const onApplied = vi.fn();
    render(<StyleReferenceControl storyboard={styledDoc()} onApplied={onApplied} />);

    const trigger = screen.getByTestId('style-reference-trigger');
    expect(trigger.textContent).toContain('Heritage');

    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('style-reference-remove'));

    await waitFor(() => expect(onApplied).toHaveBeenCalledWith(cleared));
    expect(mockClearStoryboardStyleReference).toHaveBeenCalledWith('sb-1');
  });

  it('surfaces an apply failure inline and keeps the dialog open', async () => {
    mockSetStoryboardStyleReference.mockResolvedValue({
      ok: false,
      message: 'designMd did not yield a style profile',
    });
    const onApplied = vi.fn();
    render(<StyleReferenceControl storyboard={baseDoc()} onApplied={onApplied} />);

    fireEvent.click(screen.getByTestId('style-reference-trigger'));
    fireEvent.change(screen.getByTestId('style-reference-input'), {
      target: { value: 'not really a design contract' },
    });
    fireEvent.click(screen.getByTestId('style-reference-apply'));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'designMd did not yield a style profile',
      ),
    );
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.getByTestId('style-reference-input')).toBeTruthy();
  });
});
