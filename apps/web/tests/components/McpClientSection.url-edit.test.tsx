// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpClientSection } from '../../src/components/McpClientSection';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

describe('McpClientSection URL edits preserve authMode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/api/mcp/servers')) {
        return jsonResponse({
          servers: [
            {
              id: 'local-mcp',
              label: 'local-mcp',
              transport: 'http',
              enabled: true,
              url: 'http://localhost:38451/mcp',
              authMode: 'none',
            },
          ],
          templates: [],
        });
      }
      if (url.startsWith('/api/mcp/oauth/status')) {
        return jsonResponse({ connected: false });
      }
      return jsonResponse({});
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps the saved authMode when the URL is edited to a non-loopback host', async () => {
    render(<McpClientSection />);

    const expand = await screen.findByRole('button', {
      name: /Expand this MCP server/i,
    });
    fireEvent.click(expand);

    await waitFor(() => {
      expect((screen.getByLabelText('OAuth mode') as HTMLSelectElement).value).toBe(
        'none',
      );
    });

    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://mcp.example.com/mcp' },
    });

    // Editing the URL must not silently override an authMode the user (or a
    // prior save) already set explicitly.
    expect((screen.getByLabelText('OAuth mode') as HTMLSelectElement).value).toBe(
      'none',
    );
  });
});
