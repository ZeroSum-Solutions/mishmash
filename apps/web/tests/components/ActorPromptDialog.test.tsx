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
  setStoredActorName,
} from '../../src/runtime/actor-identity';

function renderPrompt() {
  return render(
    <I18nProvider>
      <ActorPromptDialog />
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

  it('refuses to store an empty name', () => {
    renderPrompt();
    fireEvent.click(screen.getByTestId('actor-prompt-submit'));
    expect(getStoredActorName()).toBeNull();
    // An empty submit is not an answer: the dialog stays up.
    expect(screen.getByTestId('actor-prompt-dialog')).toBeTruthy();
  });
});
