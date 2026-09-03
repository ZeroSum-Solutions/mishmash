// @vitest-environment jsdom

// Red spec for W1F.3: the rendered consumer of the shared health response.
//
// Track 1.3 shipped `GET /api/mcp/health` and this panel with no test between
// them, so nothing held the panel to the DTO in
// `packages/contracts/src/api/mcp.ts`. These cases drive the panel with one
// response carrying every state the union defines, plus the repair the
// npx-cache signature now offers.
//
// The repair is confirmation-gated by mechanism, not by wording: pressing the
// action must not remove anything until the user confirms the exact path.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { McpHealthPanel } from '../../src/components/McpHealthPanel';

const CACHE_ENTRY = '/home/u/.npm/_npx/adab5b373aa91713';

const HEALTH_RESPONSE = {
  checkedAt: '2026-08-28T05:00:00.000Z',
  servers: [
    {
      id: 'antv-chart',
      label: 'AntV chart',
      transport: 'stdio',
      enabled: true,
      state: 'ok',
      connectMs: 2900,
      budgetMs: 15000,
      stderrExcerpt: '',
      checkedAt: '2026-08-28T05:00:00.000Z',
    },
    {
      id: 'mermaid',
      label: 'Mermaid',
      transport: 'stdio',
      enabled: true,
      state: 'failed',
      connectMs: 412,
      budgetMs: 15000,
      stderrExcerpt: `npm error enoent ENOENT: no such file or directory, open '${CACHE_ENTRY}/package.json'`,
      reason: 'server exited with code 1 before replying',
      remedy: `The npx cache entry for this server is incomplete. Repairing it removes ${CACHE_ENTRY}; npx re-downloads the server on the next run.`,
      repair: { kind: 'npx-cache', target: CACHE_ENTRY },
      checkedAt: '2026-08-28T05:00:00.000Z',
    },
    {
      id: 'shadcn-ui',
      label: 'shadcn-ui',
      transport: 'http',
      enabled: true,
      state: 'timeout',
      connectMs: 15000,
      budgetMs: 15000,
      stderrExcerpt: '',
      reason: 'no reply within 15000ms (a first run may still be downloading the server)',
      checkedAt: '2026-08-28T05:00:00.000Z',
    },
    {
      id: 'fal-ai',
      label: 'fal-ai',
      transport: 'sse',
      enabled: false,
      state: 'disabled',
      connectMs: 0,
      budgetMs: 15000,
      stderrExcerpt: '',
      checkedAt: '2026-08-28T05:00:00.000Z',
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.endsWith('/api/mcp/health')) return jsonResponse(HEALTH_RESPONSE);
    if (url.endsWith('/api/mcp/repair')) {
      return jsonResponse({
        serverId: 'mermaid',
        removed: true,
        repair: { kind: 'npx-cache', target: CACHE_ENTRY },
      });
    }
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderChecked() {
  const rendered = render(<McpHealthPanel />);
  fireEvent.click(screen.getByRole('button', { name: /Check health/i }));
  await screen.findByText('Mermaid');
  return rendered;
}

function repairRequests(): unknown[] {
  return fetchMock.mock.calls.filter(([input]) =>
    String(input).endsWith('/api/mcp/repair'),
  );
}

describe('the health panel renders every state the shared response can carry', () => {
  it('names each server and its measured state', async () => {
    const { container } = await renderChecked();

    const states = [...container.querySelectorAll('[data-state]')].map((row) =>
      row.getAttribute('data-state'),
    );
    expect(states).toEqual(['ok', 'failed', 'timeout', 'disabled']);
    expect(screen.getByText('AntV chart')).toBeTruthy();
    expect(screen.getByText('shadcn-ui')).toBeTruthy();
    expect(screen.getByText('fal-ai')).toBeTruthy();
  });

  it('shows the connect time for a connected server and the budget for a timeout', async () => {
    await renderChecked();

    expect(screen.getByText('Connected in 2900 ms')).toBeTruthy();
    expect(screen.getByText('No reply within 15000 ms')).toBeTruthy();
  });

  it('shows the reason and the server output for a server that did not start', async () => {
    await renderChecked();

    expect(screen.getByText('server exited with code 1 before replying')).toBeTruthy();
    expect(screen.getByText(new RegExp('npm error enoent'))).toBeTruthy();
  });
});

describe('the panel offers the recognized repair as an action', () => {
  it('offers it only for the row that carries a repair', async () => {
    await renderChecked();

    expect(screen.getAllByRole('button', { name: /Repair/i })).toHaveLength(1);
  });

  it('asks the user to confirm the exact path before anything is removed', async () => {
    const { container } = await renderChecked();

    fireEvent.click(screen.getByRole('button', { name: /^Repair$/i }));

    const prompt = container.querySelector('[data-mcp-repair-prompt]');
    expect(prompt?.getAttribute('data-mcp-repair-prompt')).toBe(CACHE_ENTRY);
    expect(prompt?.textContent ?? '').toContain(CACHE_ENTRY);
    expect(repairRequests()).toHaveLength(0);
  });

  it('removes nothing when the user cancels', async () => {
    await renderChecked();

    fireEvent.click(screen.getByRole('button', { name: /^Repair$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    expect(repairRequests()).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /^Repair$/i })).toHaveLength(1);
  });

  it('confirms explicitly on the wire and reports the removal', async () => {
    await renderChecked();

    fireEvent.click(screen.getByRole('button', { name: /^Repair$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Remove/i }));

    await waitFor(() => {
      expect(repairRequests()).toHaveLength(1);
    });
    const [, init] = repairRequests()[0] as [unknown, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      serverId: 'mermaid',
      confirm: true,
    });
    await screen.findByText(new RegExp('Removed'));
  });
});
