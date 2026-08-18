// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogueMatchSuggestions } from '../../src/components/CatalogueMatchSuggestions';

const MATCHES = [
  {
    id: 'slate-stone-architectural-h73',
    kind: 'design-template' as const,
    name: 'slate-stone-architectural-h73',
    description: 'Gallery Minimalism architectural real-estate landing page.',
    score: 8,
    matchedTerms: ['architectural', 'real estate'],
  },
  {
    id: 'valmax-photography-landing',
    kind: 'design-template' as const,
    name: 'valmax-photography-landing',
    description: 'Cinematic photography studio landing page.',
    score: 9,
    matchedTerms: ['cinematic', 'photography', 'studio'],
  },
];

const LONG_ARCHITECTURAL_PROMPT =
  'An architectural photography studio landing page, cinematic and editorial.';

function mockFetchOnce(matches: unknown[]) {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ matches }),
  } as Response);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CatalogueMatchSuggestions', () => {
  it('renders nothing until the debounced fetch resolves with matches', async () => {
    const fetchSpy = mockFetchOnce(MATCHES);
    const onAccept = vi.fn();
    render(<CatalogueMatchSuggestions prompt={LONG_ARCHITECTURAL_PROMPT} onAccept={onAccept} />);

    expect(screen.queryByTestId('catalogue-match-suggestions')).toBeNull();

    await waitFor(() => expect(screen.getByTestId('catalogue-match-suggestions')).toBeTruthy());
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/catalogue/match',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.getAllByTestId('catalogue-match-chip')).toHaveLength(2);
    expect(screen.getByText('slate-stone-architectural-h73')).toBeTruthy();
    expect(screen.getByText('valmax-photography-landing')).toBeTruthy();
  });

  it('calls onAccept with the full match when a suggestion chip is clicked', async () => {
    mockFetchOnce(MATCHES);
    const onAccept = vi.fn();
    render(<CatalogueMatchSuggestions prompt={LONG_ARCHITECTURAL_PROMPT} onAccept={onAccept} />);

    await waitFor(() => expect(screen.getAllByTestId('catalogue-match-chip')).toHaveLength(2));
    fireEvent.click(screen.getByText('slate-stone-architectural-h73'));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(MATCHES[0]);
  });

  it('never fires a request, and never renders, for a short prompt below the signal floor', async () => {
    const fetchSpy = mockFetchOnce(MATCHES);
    render(<CatalogueMatchSuggestions prompt="landing" onAccept={vi.fn()} />);

    // Give the debounce window a chance to fire if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('catalogue-match-suggestions')).toBeNull();
  });

  it('stays hidden while disabled — an explicit skill/template pick is never second-guessed', async () => {
    const fetchSpy = mockFetchOnce(MATCHES);
    render(<CatalogueMatchSuggestions prompt={LONG_ARCHITECTURAL_PROMPT} disabled onAccept={vi.fn()} />);

    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('catalogue-match-suggestions')).toBeNull();
  });

  it('hides after dismiss for the same prompt, and reappears once the prompt changes', async () => {
    mockFetchOnce(MATCHES);
    const { rerender } = render(
      <CatalogueMatchSuggestions prompt={LONG_ARCHITECTURAL_PROMPT} onAccept={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByTestId('catalogue-match-suggestions')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Dismiss catalogue suggestions'));
    expect(screen.queryByTestId('catalogue-match-suggestions')).toBeNull();

    rerender(
      <CatalogueMatchSuggestions
        prompt={`${LONG_ARCHITECTURAL_PROMPT} Extra detail.`}
        onAccept={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('catalogue-match-suggestions')).toBeTruthy());
  });

  it('renders nothing when the daemon returns an empty shortlist', async () => {
    mockFetchOnce([]);
    render(<CatalogueMatchSuggestions prompt={LONG_ARCHITECTURAL_PROMPT} onAccept={vi.fn()} />);

    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(screen.queryByTestId('catalogue-match-suggestions')).toBeNull();
  });
});
