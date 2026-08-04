// @vitest-environment jsdom

// Red spec for production-note F: the Help popover's GitHub links pointed at
// the upstream nexu-io/open-design repo, so bug reports filed "through the
// app" landed in another project's tracker. Every GitHub link must target
// this fork's repository (docs/FORK-PIN.md), and the desktop-download item
// must be gone — the desktop shell was removed from this fork.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EntryHelpMenu } from '../../src/components/EntryHelpMenu';
import { I18nProvider } from '../../src/i18n';

const analyticsTrack = vi.hoisted(() => vi.fn());

vi.mock('../../src/analytics/provider', () => ({
  useAnalytics: () => ({
    track: analyticsTrack,
  }),
}));

const FORK_REPO = 'https://github.com/wiggdevin/mishmash';

function openMenu() {
  render(
    <I18nProvider initial="en">
      <EntryHelpMenu />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByTestId('entry-help-trigger'));
}

describe('EntryHelpMenu', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('points every GitHub link at the fork repository', () => {
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Get help on GitHub' }).getAttribute('href')).toBe(
      `${FORK_REPO}/issues/new`,
    );
    expect(screen.getByRole('menuitem', { name: 'Submit a feature request' }).getAttribute('href')).toBe(
      `${FORK_REPO}/issues/new?template=feature-request.yml`,
    );
    expect(screen.getByRole('menuitem', { name: 'What’s new' }).getAttribute('href')).toBe(
      `${FORK_REPO}/releases`,
    );
  });

  it('does not offer the removed desktop download', () => {
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /download desktop/i })).toBeNull();
  });

  it('keeps the Discord community link', () => {
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Join Discord' }).getAttribute('href')).toBe(
      'https://discord.gg/mHAjSMV6gz',
    );
  });
});
