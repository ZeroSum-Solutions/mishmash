// @vitest-environment jsdom

// Red spec for W7C work item 4: LibraryComposer currently tracks a boolean
// `busy` state only (LibraryComposer.tsx:36, 113, 183-184, 194) and has no
// way to show progress, a fraction, or a Cancel affordance while a media
// task is in flight. This test renders the component with a `taskSnapshot`
// prop and an `onCancelTask` callback the CURRENT component ignores — the
// queries below find nothing on base, which is a behavioural (missing
// element) failure, not an import error: the component itself still exists
// and renders fine, it just doesn't do anything with the new props yet.

import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LibraryComposer, type LibraryComposerProps } from '../../../src/components/library/LibraryComposer';

// Deliberately not imported from @open-design/contracts: that export
// (MediaTaskSnapshot) is added in the first FIX commit, after this red
// commit. Same shape, defined locally so this test compiles regardless of
// commit order.
interface TestMediaTaskSnapshot {
  taskId: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'interrupted';
  progress: string[];
  fraction?: number;
}

function renderComposer(extra: Partial<LibraryComposerProps> & Record<string, unknown> = {}) {
  const onGenerate = vi.fn(() => new Promise<{ ok: boolean }>(() => {})); // never resolves — simulates "in flight"
  const utils = render(
    <LibraryComposer onGenerate={extra.onGenerate as LibraryComposerProps['onGenerate'] ?? onGenerate} {...extra} />,
  );
  return { onGenerate, ...utils };
}

describe('LibraryComposer — in-flight media task progress (work item 4)', () => {
  afterEach(() => {
    cleanup();
  });

  it('shows the latest progress line and the fraction while a task snapshot is running', async () => {
    const { rerender } = renderComposer();

    const promptInput = screen.getByPlaceholderText(/describe/i) as HTMLInputElement;
    fireEvent.change(promptInput, { target: { value: 'a poster of a fox' } });
    const form = promptInput.closest('form');
    if (!form) throw new Error('composer form not found');
    await act(async () => {
      fireEvent.submit(form);
    });

    const runningSnapshot: TestMediaTaskSnapshot = {
      taskId: 'task_1',
      status: 'running',
      progress: ['probing input duration', 'encoding: 40%'],
      fraction: 0.4,
    };
    const onCancelTask = vi.fn();
    // `taskSnapshot` / `onCancelTask` are the props this red spec targets —
    // LibraryComposerProps does not declare them yet on base, so this is
    // spread from an untyped object rather than a literal JSX attribute
    // list, which would otherwise fail an excess-property check under a
    // strict tsc pass even though the runtime (esbuild, no type-check)
    // happily renders it either way.
    const nextProps: Record<string, unknown> = {
      onGenerate: () => new Promise(() => {}),
      taskSnapshot: runningSnapshot,
      onCancelTask,
    };
    rerender(<LibraryComposer {...(nextProps as unknown as LibraryComposerProps)} />);

    // RED on base: LibraryComposer has no `taskSnapshot` prop wiring, so
    // none of this renders.
    expect(screen.queryByText(/encoding: 40%/i), 'the latest progress line must render').not.toBeNull();
    expect(screen.queryByText(/40%/), 'the fraction must render as a percentage').not.toBeNull();

    const cancelButton = screen.queryByRole('button', { name: /cancel/i });
    expect(cancelButton, 'a Cancel button must render while a task snapshot is running').not.toBeNull();
    if (cancelButton) fireEvent.click(cancelButton);
    expect(onCancelTask).toHaveBeenCalledTimes(1);
  });
});
