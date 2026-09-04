// @vitest-environment jsdom
//
// W1J.4 red spec — the composer half of the disclosure.
//
// `ProjectView` disables Send for three different reasons
// (ProjectView.tsx:1909-1912) and hands ChatPane a bare boolean, so the
// composer cannot tell them apart. One of the three — the conversation's own
// run being unresolved — can hold the composer for about five minutes under the
// 100 x 3 s probe allowance, and at 29a2a7703 it did so with nothing on screen
// to explain it: the Send button carries only its "Send" label, and the
// composer's one inline-copy affordance (`composer-hint`, ChatComposer.tsx:3169)
// served `uploadError` alone.
//
// So the composer takes the reason as copy and shows it. The two cases below
// are the whole contract: the reason is on screen and reachable from the button
// when it applies, and there is no stray hint when it does not — a composer
// disabled for a passing fetch must not grow a permanent sentence.
//
// The notice half is in `ChatPane.failure-alert.test.tsx`; the end-to-end chain
// is the W1J.4 assertion in `e2e/ui/inferred-failure-retraction.test.ts`.

import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatComposer } from '../../src/components/ChatComposer';
import { en } from '../../src/i18n/locales/en';
import { flushMounts } from '../helpers/lexical-composer';

// The shipped sentence, read from the locale so this spec cannot drift from it.
const UNRESOLVED_RUN_REASON = en['chat.sendPaused.unresolvedRun'];

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

describe('a disabled composer states the reason it was given', () => {
  it('shows the reason and points the Send button at it', async () => {
    const { container } = renderComposer({
      sendDisabled: true,
      sendDisabledReason: UNRESOLVED_RUN_REASON,
    });
    await flushMounts();

    const reason = container.querySelector('[data-send-disabled-reason]');
    expect(reason, 'a disabled Send with no reason on screen is the silent lock').toBeTruthy();
    expect(reason?.textContent).toBe(UNRESOLVED_RUN_REASON);

    const sendButton = screen.getByTestId('chat-send');
    const describedBy = sendButton.getAttribute('aria-describedby');
    expect(describedBy, 'the reason must be reachable from the control it explains').toBeTruthy();
    expect(describedBy).toBe(reason?.id);
  });

  it('leaves no hint when the composer is disabled for another reason', async () => {
    const { container } = renderComposer({ sendDisabled: true });
    await flushMounts();

    expect(
      container.querySelector('[data-send-disabled-reason]'),
      'a composer disabled for a passing fetch must not grow a permanent sentence',
    ).toBeNull();
    expect(screen.getByTestId('chat-send').getAttribute('aria-describedby')).toBeNull();
  });
});
