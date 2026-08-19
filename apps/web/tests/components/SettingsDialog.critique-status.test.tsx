// @vitest-environment jsdom
//
// Coverage for the Design Jury (Critique Theater) Settings "Resolved
// status" block. The checkbox in this section only ever reflects the
// browser's stored preference; the daemon's `/api/projects/:id/critique
// /status` resolver can override it (a required or opt-out skill policy
// always wins server-side — see `apps/daemon/src/critique/rollout.ts`).
// Before this block existed, a user staring at an unchecked box had no
// way to tell "I turned this off" apart from "a bound skill turned this
// off for me". These tests guard: the resolved-state render, the
// disagreement case, a real loading state, and a visible (non-swallowed)
// fetch error.

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CritiqueConformanceResponse, CritiqueStatusResponse } from '@open-design/contracts';

import { SettingsDialog } from '../../src/components/SettingsDialog';
import { CONFIG_STORAGE_KEY, DEFAULT_CONFIG } from '../../src/state/config';

const originalFetch = globalThis.fetch;

const EMPTY_CONFORMANCE: CritiqueConformanceResponse = {
  window: { days: 14, history: [] },
  decision: { kind: 'hold', current: 'M1', reason: 'not enough evidence', passingDays: 0, observedDays: 0 },
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderCritiqueSettings() {
  render(
    <SettingsDialog
      initial={DEFAULT_CONFIG}
      agents={[]}
      daemonLive
      appVersionInfo={null}
      initialSection="critiqueTheater"
      onPersist={vi.fn()}
      onPersistComposioKey={vi.fn()}
      onClose={vi.fn()}
      onRefreshAgents={vi.fn()}
    />,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  window.localStorage.clear();
  window.history.pushState({}, '', '/');
});

describe('SettingsDialog Design Jury resolved status', () => {
  it('renders the resolved status and the deciding factor when it agrees with the checkbox', async () => {
    window.history.pushState({}, '', '/projects/proj-1');
    window.localStorage.setItem(
      CONFIG_STORAGE_KEY,
      JSON.stringify({ critiqueTheaterEnabled: true }),
    );
    const statusBody: CritiqueStatusResponse = {
      projectId: 'proj-1',
      enabled: true,
      resolution: {
        phase: 'M1',
        skillPolicy: null,
        projectOverride: true,
        envOverride: null,
        approximate: true,
      },
    };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/projects/proj-1/critique/status') return jsonResponse(statusBody);
      if (url.startsWith('/api/critique/conformance')) return jsonResponse(EMPTY_CONFORMANCE);
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    renderCritiqueSettings();

    await waitFor(() => {
      expect(
        screen.getByText('Design Jury will run for new generations in this project.'),
      ).toBeTruthy();
    });
    expect(screen.getByText('A project override is set to on.')).toBeTruthy();
    expect(
      screen.getByText(
        'This is the rollout-policy answer. A run also needs a matching skill, a resolved design system, and a free adapter slot to actually critique.',
      ),
    ).toBeTruthy();
    // Resolved and checkbox agree: no disagreement warning.
    expect(
      screen.queryByText('This differs from the checkbox above — the resolved status wins for new runs.'),
    ).toBeNull();
  });

  it('warns when a required skill policy overrides an unchecked checkbox', async () => {
    window.history.pushState({}, '', '/projects/proj-2');
    // No localStorage entry: useCritiqueTheaterEnabled() reads false.
    const statusBody: CritiqueStatusResponse = {
      projectId: 'proj-2',
      enabled: true,
      resolution: {
        phase: 'M1',
        skillPolicy: 'required',
        projectOverride: null,
        envOverride: null,
        approximate: true,
      },
    };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/projects/proj-2/critique/status') return jsonResponse(statusBody);
      if (url.startsWith('/api/critique/conformance')) return jsonResponse(EMPTY_CONFORMANCE);
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    renderCritiqueSettings();

    await waitFor(() => {
      expect(
        screen.getByText('Design Jury will run for new generations in this project.'),
      ).toBeTruthy();
    });
    expect(
      screen.getByText(
        "The project's bound skill requires Design Jury, overriding the checkbox above.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('This differs from the checkbox above — the resolved status wins for new runs.'),
    ).toBeTruthy();
    // The checkbox itself must still show the user's own (unchecked) preference.
    expect((screen.getByLabelText(/Show Design Jury during agent runs/i) as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it('shows a real loading state before the status fetch resolves', async () => {
    window.history.pushState({}, '', '/projects/proj-3');
    const statusDeferred = deferred<Response>();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/projects/proj-3/critique/status') return statusDeferred.promise;
      if (url.startsWith('/api/critique/conformance')) return jsonResponse(EMPTY_CONFORMANCE);
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    renderCritiqueSettings();

    await waitFor(() => {
      expect(screen.getByText('Checking resolved status…')).toBeTruthy();
    });

    await act(async () => {
      statusDeferred.resolve(
        jsonResponse({
          projectId: 'proj-3',
          enabled: false,
          resolution: {
            phase: 'M0',
            skillPolicy: null,
            projectOverride: null,
            envOverride: null,
            approximate: true,
          },
        } satisfies CritiqueStatusResponse),
      );
    });

    await waitFor(() => {
      expect(screen.queryByText('Checking resolved status…')).toBeNull();
      expect(
        screen.getByText('Design Jury will not run for new generations in this project.'),
      ).toBeTruthy();
    });
  });

  it('shows a visible error instead of a fabricated status when the fetch fails', async () => {
    window.history.pushState({}, '', '/projects/proj-4');
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/projects/proj-4/critique/status') {
        return new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'boom' } }), {
          status: 500,
        });
      }
      if (url.startsWith('/api/critique/conformance')) return jsonResponse(EMPTY_CONFORMANCE);
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    renderCritiqueSettings();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent ?? '').toContain('Could not check resolved status');
    // No resolved summary must appear alongside the error — a failed fetch
    // must never silently present a stale or fabricated enabled/disabled answer.
    expect(
      screen.queryByText('Design Jury will run for new generations in this project.'),
    ).toBeNull();
    expect(
      screen.queryByText('Design Jury will not run for new generations in this project.'),
    ).toBeNull();
  });
});
