// @vitest-environment jsdom

// W8D / F-03 — the one-time "who are you" prompt.
//
// D-2 makes this attribution, not authentication, so the prompt is skippable
// and never gates anything. The behaviour under test is the one-time gate: it
// shows once per browser profile, and once the user answers (or skips) it never
// comes back on its own.
//
// Disclosed red shape: red on base only because the component does not exist.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActorPromptDialog } from '../../src/components/ActorPromptDialog';
import { I18nProvider } from '../../src/i18n';
import {
  getStoredActorName,
  hasSeenActorPrompt,
  setStoredActorName,
} from '../../src/runtime/actor-identity';

function renderPrompt(homeVisible = true) {
  return render(
    <I18nProvider>
      <ActorPromptDialog homeVisible={homeVisible} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('ActorPromptDialog', () => {
  it('asks for a name when no name is stored yet', () => {
    renderPrompt();
    expect(screen.getByTestId('actor-prompt-dialog')).toBeTruthy();
    expect(screen.getByTestId('actor-prompt-input')).toBeTruthy();
  });

  it('stores the submitted name and closes', () => {
    renderPrompt();
    fireEvent.change(screen.getByTestId('actor-prompt-input'), {
      target: { value: 'Devin' },
    });
    fireEvent.click(screen.getByTestId('actor-prompt-submit'));

    expect(getStoredActorName()).toBe('Devin');
    expect(screen.queryByTestId('actor-prompt-dialog')).toBeNull();
  });

  it('does not render at all when a name is already stored', () => {
    setStoredActorName('Devin');
    renderPrompt();
    expect(screen.queryByTestId('actor-prompt-dialog')).toBeNull();
  });

  it('lets the user skip, and does not ask again', () => {
    renderPrompt();
    fireEvent.click(screen.getByTestId('actor-prompt-skip'));
    expect(screen.queryByTestId('actor-prompt-dialog')).toBeNull();
    // Skipping means unattributed, not a fake name.
    expect(getStoredActorName()).toBeNull();

    cleanup();
    renderPrompt();
    expect(screen.queryByTestId('actor-prompt-dialog')).toBeNull();
  });

  // W8D fix r0 — the integration wave-8 P0 Playwright run failed 14 times in
  // e2e/ui/app-design-files.test.ts with
  //   <div role="presentation" class="dialog_backdrop__… modal-backdrop"> intercepts
  //   pointer events
  // because the prompt rendered through the shared modal Dialog, which always
  // wraps its panel in a full-viewport backdrop (packages/components/src/dialog.tsx).
  // Every browser profile that has not answered yet — which is every Playwright
  // test — had the whole page sealed behind it. The prompt's own docblock says it
  // "never blocks anything"; this pins that invariant.
  it('never blocks the page behind it', () => {
    const clickedBehind = vi.fn();
    render(
      <I18nProvider>
        <>
          <button type="button" data-testid="page-behind" onClick={clickedBehind}>
            behind
          </button>
          <ActorPromptDialog homeVisible />
        </>
      </I18nProvider>,
    );

    const prompt = screen.getByTestId('actor-prompt-dialog');
    // No modal chrome anywhere in the document: no backdrop layer to intercept
    // pointer events, and no aria-modal telling assistive tech the rest of the
    // page is inert.
    expect(document.querySelector('.modal-backdrop')).toBeNull();
    expect(document.querySelector('[role="presentation"]')).toBeNull();
    expect(prompt.getAttribute('aria-modal')).toBeNull();

    // And the page behind it stays operable.
    fireEvent.click(screen.getByTestId('page-behind'));
    expect(clickedBehind).toHaveBeenCalledTimes(1);
  });

  // W8D fix r1 — the wave-8 integration P0 Playwright run failed 15 cases on
  // this card. Four of them (e2e/ui/entry-chrome-flows.test.ts:129, :567, :686,
  // :879) died the moment a real dialog opened:
  //   locator('page.getByRole('dialog')') resolved to 2 elements
  // because the corner card carried role="dialog" too. A non-blocking nudge is
  // not a dialog: it takes no focus, traps nothing, and must never be counted
  // among the page's dialogs.
  it('is not a dialog, so a real dialog stays the only one on the page', () => {
    render(
      <I18nProvider>
        <>
          <div role="dialog" aria-label="Settings" data-testid="real-dialog" />
          <ActorPromptDialog homeVisible />
        </>
      </I18nProvider>,
    );

    const prompt = screen.getByTestId('actor-prompt-dialog');
    expect(prompt.getAttribute('role')).not.toBe('dialog');
    // Playwright's page.getByRole('dialog') is strict-mode: a second dialog on
    // the page fails every test that opens a real one.
    const dialogs = screen.getAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]?.getAttribute('data-testid')).toBe('real-dialog');
  });

  // The other eleven failures were "subtree intercepts pointer events" over
  // controls the card sat on top of — a deck's Next slide button, the HTML
  // preview toolbar, a plugin details modal's Use button. A fixed corner card
  // cannot promise it will miss every control on every surface, so it is
  // scoped to the one surface it belongs on: the Home view, with no project
  // open and no sub-view (Plugins, Projects, Tasks…) in front of it.
  it('stays off every surface except Home, without spending the one-time gate', () => {
    const { rerender } = render(
      <I18nProvider>
        <ActorPromptDialog homeVisible={false} />
      </I18nProvider>,
    );

    expect(screen.queryByTestId('actor-prompt-dialog')).toBeNull();
    // Not asked is not answered: the once-per-profile gate is still unspent.
    expect(hasSeenActorPrompt()).toBe(false);
    expect(getStoredActorName()).toBeNull();

    rerender(
      <I18nProvider>
        <ActorPromptDialog homeVisible />
      </I18nProvider>,
    );
    expect(screen.getByTestId('actor-prompt-dialog')).toBeTruthy();
  });

  it('refuses to store an empty name', () => {
    renderPrompt();
    fireEvent.click(screen.getByTestId('actor-prompt-submit'));
    expect(getStoredActorName()).toBeNull();
    // An empty submit is not an answer: the dialog stays up.
    expect(screen.getByTestId('actor-prompt-dialog')).toBeTruthy();
  });
});
