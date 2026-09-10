// @vitest-environment jsdom

// W8D / F-03 — the one-time "who are you" prompt.
//
// D-2 makes this attribution, not authentication, so the prompt is skippable
// and never gates anything. The behaviour under test is the one-time gate: it
// asks once per browser profile, and once it has asked it never comes back on
// its own.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ActorPromptDialog } from '../../src/components/ActorPromptDialog';
import { I18nProvider } from '../../src/i18n';
import {
  getStoredActorName,
  hasSeenActorPrompt,
  setStoredActorName,
} from '../../src/runtime/actor-identity';

function renderPrompt(
  homeVisible = true,
  onOpenActorNameSettings = vi.fn(),
) {
  const result = render(
    <I18nProvider>
      <ActorPromptDialog
        homeVisible={homeVisible}
        onOpenActorNameSettings={onOpenActorNameSettings}
      />
    </I18nProvider>,
  );
  return { ...result, onOpenActorNameSettings };
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
    expect(screen.getByText('What should we call you?')).toBeTruthy();
  });

  // W8D fix r3 — the mechanism behind the third placement failure.
  //
  // As an in-flow `<aside>` in the Home column the prompt added ~250px of
  // height ABOVE the create rail (measured: the "More" shortcuts trigger sat
  // at document y=829 with the prompt mounted, y=580 without). `ShortcutsMenu`
  // portals its dropdown to <body> with
  // `position: fixed; top = trigger.getBoundingClientRect().bottom + 6`
  // (apps/web/src/components/HomeHero.tsx), so pushing the trigger down pushed
  // the panel's lower items below the fold — `home-hero-rail-create-brand-kit`
  // at viewport y 1115-1151 in a 1000px viewport, versus 916-952 without the
  // prompt. A `position: fixed` element cannot be scrolled into view, so
  // Playwright retried the click 110 times and timed out
  // (e2e/ui/home-hero-rail.test.ts:1330, :1594, :1844).
  //
  // The fix is to stop taking a row at all: the prompt is raised through the
  // app's own transient toast (`Toast`, `.od-toast`), which is fixed to the
  // bottom of the viewport, contributes no layout to the surface it appears
  // on, and clears itself after its normal TTL.
  it('takes no row in the surface it appears on', () => {
    renderPrompt();
    const prompt = screen.getByTestId('actor-prompt-dialog');
    // The app's transient toast surface — `position: fixed` in
    // apps/web/src/styles/viewer/routines.css, so it displaces nothing.
    expect(prompt.classList.contains('od-toast')).toBe(true);
    // And it is no longer an in-flow landmark competing for the column.
    expect(prompt.tagName).not.toBe('ASIDE');
  });

  // The toast carries no text field: a 4-second surface is the wrong place to
  // type a name into. Its one action hands the user to the Settings row that
  // already owns the name (`settings-actor-name`, SettingsDialog's Appearance
  // section), which is also the only way to change it later.
  it('offers one action that opens the Settings display-name row', () => {
    const { onOpenActorNameSettings } = renderPrompt();
    expect(screen.queryByTestId('actor-prompt-input')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add your name' }));
    expect(onOpenActorNameSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('actor-prompt-dialog')).toBeNull();
  });

  // A toast auto-dismisses. If the gate were only spent on an answer, the
  // prompt would come back on the next Home visit — for ever, for anyone who
  // simply let it fade. Showing it IS the question; asking once is the promise.
  it('spends the once-per-profile gate as soon as it is shown', () => {
    renderPrompt();
    expect(hasSeenActorPrompt()).toBe(true);
    // Asking is not answering: nothing is attributed until the user types a
    // name in Settings.
    expect(getStoredActorName()).toBeNull();

    cleanup();
    renderPrompt();
    expect(screen.queryByTestId('actor-prompt-dialog')).toBeNull();
  });

  it('does not render at all when a name is already stored', () => {
    setStoredActorName('Devin');
    renderPrompt();
    expect(screen.queryByTestId('actor-prompt-dialog')).toBeNull();
  });

  it('can be dismissed, and does not come back', () => {
    renderPrompt();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('actor-prompt-dialog')).toBeNull();
    // Dismissing means unattributed, not a fake name.
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
  // test — had the whole page sealed behind it.
  it('never blocks the page behind it', () => {
    const clickedBehind = vi.fn();
    render(
      <I18nProvider>
        <>
          <button type="button" data-testid="page-behind" onClick={clickedBehind}>
            behind
          </button>
          <ActorPromptDialog homeVisible onOpenActorNameSettings={vi.fn()} />
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
          <ActorPromptDialog homeVisible onOpenActorNameSettings={vi.fn()} />
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

  // W8D fix r1 — the other eleven failures were "subtree intercepts pointer
  // events" over controls the fixed corner card sat on. Scoping it to Home was
  // the first half of that fix and still holds: it must not appear on any other
  // surface, and being held back must not spend its one question.
  it('stays off every surface except Home, without spending the one-time gate', () => {
    const onOpenActorNameSettings = vi.fn();
    const { rerender } = render(
      <I18nProvider>
        <ActorPromptDialog
          homeVisible={false}
          onOpenActorNameSettings={onOpenActorNameSettings}
        />
      </I18nProvider>,
    );

    expect(screen.queryByTestId('actor-prompt-dialog')).toBeNull();
    // Not asked is not answered: the once-per-profile gate is still unspent.
    expect(hasSeenActorPrompt()).toBe(false);
    expect(getStoredActorName()).toBeNull();

    rerender(
      <I18nProvider>
        <ActorPromptDialog
          homeVisible
          onOpenActorNameSettings={onOpenActorNameSettings}
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId('actor-prompt-dialog')).toBeTruthy();
  });
});
