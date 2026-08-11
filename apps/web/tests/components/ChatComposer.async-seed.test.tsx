// @vitest-environment jsdom
//
// MM-001 #2 / MM-008 mechanism map item 4: a project opened before its
// starting prompt is known client-side (Design Library's cache-insert flow,
// or any other project whose `pendingPrompt` only resolves on a later
// render) mounts the composer with `initialDraft === undefined`. The old
// seededRef effect latched "seeded" on that first undefined render, so the
// prompt permanently never reached the composer once it did arrive. The
// fix gates seeding on `composerEngaged` (the same latch that already
// protects user-typed content) instead of "have we seen a value yet".

import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer } from '../../src/components/ChatComposer';
import { composerText, flushMounts, typeInComposer } from '../helpers/lexical-composer';

function renderComposer(overrides: Partial<ComponentProps<typeof ChatComposer>> = {}) {
  return render(
    <ChatComposer
      projectId="project-1"
      projectFiles={[]}
      streaming={false}
      onEnsureProject={async () => 'project-1'}
      onSend={vi.fn()}
      onStop={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChatComposer async initialDraft seeding', () => {
  it('seeds the composer when initialDraft arrives on a later render, not just at mount', async () => {
    const { rerender } = renderComposer({ initialDraft: undefined });
    await flushMounts();

    expect(composerText().trim()).toBe('');

    rerender(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
        initialDraft="Design brief: build 3 screens."
      />,
    );
    await flushMounts();

    expect(composerText()).toBe('Design brief: build 3 screens.');
  });

  it('does not clobber a user-typed draft when initialDraft arrives after the user starts typing', async () => {
    const { rerender } = renderComposer({ initialDraft: undefined });
    await flushMounts();

    typeInComposer('user typed this');
    await flushMounts();
    expect(composerText()).toBe('user typed this');

    rerender(
      <ChatComposer
        projectId="project-1"
        projectFiles={[]}
        streaming={false}
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
        initialDraft="server prompt arriving late"
      />,
    );
    await flushMounts();

    expect(composerText()).toBe('user typed this');
  });
});
