// @vitest-environment jsdom
//
// RoutingPanel mount / discoverability regression (WR wave, Amendment 1).
//
// The panel shipped in t2 fully built and fully unreachable: SettingsDialog.tsx
// was outside the wave's lease, so there was no legal mount point anywhere in
// the app (recorded as the t7 Sol HIGH-2 disposition). Amendment 1 granted the
// single file, and this test exists so that reachability cannot silently
// regress back to "built but unreachable" -- the failure mode the whole
// amendment was raised to fix.
//
// It therefore asserts DISCOVERABILITY, not panel internals (RoutingPanel's own
// rendering is covered by its component tests):
//   1. the section renders when Settings is opened directly on it, and
//   2. a user can actually get there by clicking the sidebar, from a cold open
//      on a different section.
//
// The lease pins this exact path (`apps/web/tests/settings-dialog-routing.test.tsx`),
// deliberately not a broad web-test glob.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsDialog } from '../src/components/SettingsDialog';
import { fetchConnectors, fetchDesignTemplates, fetchSkills } from '../src/providers/registry';
import type { AppConfig } from '../src/types';

vi.mock('../src/providers/registry', async () => {
  const actual = await vi.importActual<typeof import('../src/providers/registry')>(
    '../src/providers/registry',
  );
  return {
    ...actual,
    fetchConnectors: vi.fn(),
    fetchDesignTemplates: vi.fn(),
    fetchSkills: vi.fn(),
  };
});

const originalFetch = globalThis.fetch;

const baseConfig: AppConfig = {
  mode: 'api',
  apiKey: 'sk-test',
  apiProtocol: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  apiProviderBaseUrl: 'https://api.anthropic.com',
  agentId: null,
  skillId: null,
  designSystemId: null,
  composio: { apiKeyConfigured: true },
};

function renderSettings(initialSection: 'routing' | 'execution') {
  render(
    <SettingsDialog
      initial={baseConfig}
      agents={[]}
      daemonLive
      appVersionInfo={null}
      initialSection={initialSection}
      onPersist={vi.fn()}
      onPersistComposioKey={vi.fn()}
      onClose={vi.fn()}
      onRefreshAgents={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.mocked(fetchConnectors).mockResolvedValue([]);
  vi.mocked(fetchDesignTemplates).mockResolvedValue([]);
  vi.mocked(fetchSkills).mockResolvedValue([]);
  // Every /api/routing/* read answers 404 so the panel takes its own
  // "no data yet" path. The mount is what is under test, not the payloads --
  // an unreachable daemon must still render the section rather than blanking
  // it, otherwise this regression guard could pass on an empty screen.
  globalThis.fetch = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('SettingsDialog mounts the RoutingPanel', () => {
  it('renders the routing section when Settings opens directly on it', async () => {
    renderSettings('routing');

    await waitFor(() => {
      expect(screen.getByTestId('routing-panel')).toBeTruthy();
    });
  });

  it('is reachable from the settings sidebar without prior knowledge of the section id', async () => {
    // The discoverability half: open somewhere else, then navigate the way a
    // real user would. A mount that only works via `initialSection` would be
    // reachable by deep link but still invisible in the product.
    renderSettings('execution');
    expect(screen.queryByTestId('routing-panel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Model routing/i }));

    await waitFor(() => {
      expect(screen.getByTestId('routing-panel')).toBeTruthy();
    });
  });
});
