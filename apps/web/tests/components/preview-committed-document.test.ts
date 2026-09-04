// @vitest-environment jsdom
// The host's half of the two-phase preview epoch: which document it is willing
// to swear is already in the frame.
//
// The watchdog discloses its navigation token only to a document it saw commit,
// and a warm transport — a srcDoc frame materialised while hidden — has no
// `load` left to give it. `useCommittedDocument` is how the host says "the
// document you want is already here", so it has exactly one thing to get right:
// it must never say that about a document the frame is no longer holding.

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCommittedDocument } from '../../src/components/preview-committed-document';

describe('the host only vouches for a document it saw the frame load', () => {
  it('says nothing about a frame that has not loaded yet', () => {
    const { result } = renderHook(({ target }) => useCommittedDocument(target), {
      initialProps: { target: '/preview/a' },
    });
    expect(result.current.committed).toBe(false);
  });

  it('vouches for the document the frame loaded, so a warm transport is watched', () => {
    const { result, rerender } = renderHook(({ target }) => useCommittedDocument(target), {
      initialProps: { target: '/preview/a' },
    });

    act(() => result.current.noteLoaded());
    rerender({ target: '/preview/a' });

    expect(
      result.current.committed,
      'the frame still holds the document the host is asking about',
    ).toBe(true);
  });

  it('stops vouching the moment the host points the frame somewhere else', () => {
    const { result, rerender } = renderHook(({ target }) => useCommittedDocument(target), {
      initialProps: { target: '/preview/a' },
    });
    act(() => result.current.noteLoaded());

    rerender({ target: '/preview/b' });

    expect(
      result.current.committed,
      'a navigation is pending; the document in the frame is the one being replaced',
    ).toBe(false);
  });

  it('does not vouch again when the host returns to a document the frame loaded before', () => {
    // A, then B, then A again, with B hanging before it commits. The frame
    // still holds the FIRST A document, and it paints, so if the host vouched
    // for it the watchdog armed for the second A would settle on it and the
    // hung navigation would go unwatched. This is the stuck-navigation bug the
    // epoch exists to catch, re-entered through the back door.
    const { result, rerender } = renderHook(({ target }) => useCommittedDocument(target), {
      initialProps: { target: '/preview/a' },
    });
    act(() => result.current.noteLoaded());

    rerender({ target: '/preview/b' });
    rerender({ target: '/preview/a' });

    expect(result.current.committed).toBe(false);

    // And it starts vouching again once the frame really does load it.
    act(() => result.current.noteLoaded());
    rerender({ target: '/preview/a' });
    expect(result.current.committed).toBe(true);
  });
});
