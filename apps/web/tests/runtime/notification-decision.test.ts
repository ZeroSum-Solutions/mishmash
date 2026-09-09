import { describe, expect, it } from 'vitest';

import {
  decideCompletionNotifications,
  type NotificationDecisionInput,
} from '../../src/runtime/notification-decision';

// Refactor guard, not the red proof (per the brief's red-spec item 4 and
// W7-R2-17): `src/runtime/notification-decision.ts` is a brand-new module
// on this branch, so this file's first run fails only because the module
// does not exist yet — an import-only failure, not a behavioural one. The
// track's actual behavioural reds are the CLI stderr-notice test
// (`apps/daemon/tests/run-cli.test.ts`) and the config-default test
// (`apps/web/tests/state/config.test.ts`). This file pins the helper's
// INV-7.4 contract so a future refactor of `notifyCompletedRun` cannot
// silently change sound/desktop cardinality.
function baseInput(overrides: Partial<NotificationDecisionInput> = {}): NotificationDecisionInput {
  return {
    status: 'succeeded',
    soundEnabled: true,
    desktopEnabled: true,
    desktopPermission: 'granted',
    documentHidden: true,
    documentFocused: false,
    wasPreviouslyActive: true,
    alreadyNotified: false,
    ...overrides,
  };
}

describe('decideCompletionNotifications (INV-7.4)', () => {
  it('plays sound and shows desktop for a background success with permission granted', () => {
    expect(decideCompletionNotifications(baseInput())).toEqual({
      playSound: true,
      showDesktop: true,
    });
  });

  it('plays sound independently of desktop permission', () => {
    const decision = decideCompletionNotifications(
      baseInput({ desktopPermission: 'denied' }),
    );
    expect(decision.playSound).toBe(true);
    expect(decision.showDesktop).toBe(false);
  });

  it('plays sound independently of focus, even when the tab is focused', () => {
    const decision = decideCompletionNotifications(
      baseInput({ documentHidden: false, documentFocused: true, status: 'succeeded' }),
    );
    expect(decision.playSound).toBe(true);
    expect(decision.showDesktop).toBe(false);
  });

  it('shows desktop for a foreground failure (the deliberate clause)', () => {
    const decision = decideCompletionNotifications(
      baseInput({ status: 'failed', documentHidden: false, documentFocused: true }),
    );
    expect(decision.showDesktop).toBe(true);
  });

  it('shows no desktop notification for a focused success', () => {
    const decision = decideCompletionNotifications(
      baseInput({ status: 'succeeded', documentHidden: false, documentFocused: true }),
    );
    expect(decision.showDesktop).toBe(false);
  });

  it('shows no desktop notification when permission is denied or unsupported', () => {
    expect(
      decideCompletionNotifications(baseInput({ desktopPermission: 'denied' })).showDesktop,
    ).toBe(false);
    expect(
      decideCompletionNotifications(baseInput({ desktopPermission: 'unsupported' })).showDesktop,
    ).toBe(false);
  });

  it('shows no desktop notification when the desktop setting is disabled', () => {
    const decision = decideCompletionNotifications(baseInput({ desktopEnabled: false }));
    expect(decision.showDesktop).toBe(false);
  });

  it('shows no notification of either kind on replay (already notified)', () => {
    const decision = decideCompletionNotifications(baseInput({ alreadyNotified: true }));
    expect(decision).toEqual({ playSound: false, showDesktop: false });
  });

  it('shows no notification of either kind for a run never previously observed active', () => {
    const decision = decideCompletionNotifications(baseInput({ wasPreviouslyActive: false }));
    expect(decision).toEqual({ playSound: false, showDesktop: false });
  });

  it('shows no sound when the sound setting is disabled, independent of desktop', () => {
    const decision = decideCompletionNotifications(baseInput({ soundEnabled: false }));
    expect(decision.playSound).toBe(false);
    expect(decision.showDesktop).toBe(true);
  });
});
