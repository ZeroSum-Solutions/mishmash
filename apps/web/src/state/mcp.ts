// Web client for the daemon's external-MCP endpoints.
//
// `GET /api/mcp/servers` returns both the user's saved entries AND the
// built-in template list, so the Settings panel hydrates with one round-trip.
// `PUT /api/mcp/servers` replaces the whole list — same pattern the media
// providers PUT uses (the daemon takes the full set rather than merging).

import type {
  McpHealthResponse,
  McpOAuthStatusResponse,
  McpServerConfig,
  McpServerHealth,
  McpServerRepair,
  McpServersResponse,
  McpTemplate,
  RepairMcpServerResponse,
  StartMcpOAuthResponse,
} from '@open-design/contracts';

export type {
  McpHealthResponse,
  McpOAuthStatusResponse,
  McpServerConfig,
  McpServerHealth,
  McpServerRepair,
  McpTemplate,
  RepairMcpServerResponse,
  StartMcpOAuthResponse,
};

export async function fetchMcpServers(): Promise<McpServersResponse | null> {
  try {
    const res = await fetch('/api/mcp/servers');
    if (!res.ok) return null;
    const data = (await res.json()) as McpServersResponse;
    return {
      servers: Array.isArray(data?.servers) ? data.servers : [],
      templates: Array.isArray(data?.templates) ? data.templates : [],
    };
  } catch {
    return null;
  }
}

export async function saveMcpServers(
  servers: McpServerConfig[],
): Promise<McpServersResponse | null> {
  try {
    const res = await fetch('/api/mcp/servers', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ servers }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as McpServersResponse;
    return {
      servers: Array.isArray(data?.servers) ? data.servers : [],
      templates: Array.isArray(data?.templates) ? data.templates : [],
    };
  } catch {
    return null;
  }
}

/**
 * Result of `startMcpOAuth`. Either a usable response, or a structured
 * error containing the real HTTP status / body we got back so the UI can
 * surface a useful message instead of a generic "could not connect".
 */
export type StartMcpOAuthResult =
  | { ok: true; response: StartMcpOAuthResponse }
  | { ok: false; status: number | null; message: string };

/**
 * Kick off the daemon-owned OAuth dance for a saved HTTP/SSE server.
 *
 * Returns a structured result so the UI can show why the daemon refused
 * (most useful when the daemon is older than the web client and the
 * `/api/mcp/oauth/start` route 404s, or when the upstream provider's
 * discovery / DCR endpoint failed).
 */
export async function startMcpOAuth(
  serverId: string,
): Promise<StartMcpOAuthResult> {
  let res: Response;
  try {
    res = await fetch('/api/mcp/oauth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serverId }),
    });
  } catch (err) {
    return {
      ok: false,
      status: null,
      message:
        err instanceof Error
          ? `Network error: ${err.message}`
          : 'Network error reaching the daemon.',
    };
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.text();
      // Try to pull a typed error message out of `{ error: '...' }` payloads.
      try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed.error === 'string') detail = parsed.error;
      } catch {
        detail = body.slice(0, 240);
      }
    } catch {
      // ignore
    }
    if (res.status === 404) {
      return {
        ok: false,
        status: 404,
        message:
          'Daemon does not know about /api/mcp/oauth/start (it may be running an older build). Restart the daemon (`pnpm tools-dev restart` or equivalent) and try again.',
      };
    }
    return {
      ok: false,
      status: res.status,
      message:
        detail ||
        `Daemon returned HTTP ${res.status} ${res.statusText}. Check the daemon log for details.`,
    };
  }
  try {
    const response = (await res.json()) as StartMcpOAuthResponse;
    return { ok: true, response };
  } catch (err) {
    return {
      ok: false,
      status: res.status,
      message: 'Daemon returned a 200 with an unparseable body.',
    };
  }
}

export async function fetchMcpOAuthStatus(
  serverId: string,
): Promise<McpOAuthStatusResponse | null> {
  try {
    const url = `/api/mcp/oauth/status?serverId=${encodeURIComponent(serverId)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as McpOAuthStatusResponse;
  } catch {
    return null;
  }
}

export async function disconnectMcpOAuth(serverId: string): Promise<boolean> {
  try {
    const res = await fetch('/api/mcp/oauth/disconnect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serverId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Generate a unique stable id from a label (lowercase, slug). Falls back to
 * a short random suffix so duplicates of the same template still land at
 * distinct ids. */
export function suggestMcpServerId(
  label: string,
  taken: ReadonlySet<string>,
): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'mcp-server';
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const next = `${base}-${i}`;
    if (!taken.has(next)) return next;
  }
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Per-server MCP connect state, measured by the daemon (`GET /api/mcp/health`).
 *
 * Its own surface on purpose: an MCP server that failed to start is not a run
 * failure, and before this existed the only place that state ever showed up
 * was a run's error card (issue #157).
 */
export async function fetchMcpHealth(): Promise<McpHealthResponse | null> {
  try {
    const res = await fetch('/api/mcp/health');
    if (!res.ok) return null;
    const data = (await res.json()) as McpHealthResponse;
    return {
      servers: Array.isArray(data?.servers) ? data.servers : [],
      checkedAt: typeof data?.checkedAt === 'string' ? data.checkedAt : '',
    };
  } catch {
    return null;
  }
}

/** Either the repair the daemon performed, or the reason it did not. The
 *  error code is carried through because "the server healed since you looked"
 *  (`MCP_REPAIR_UNAVAILABLE`) and "the daemon is unreachable" need different
 *  words in front of the user. */
export type RepairMcpServerResult =
  | { ok: true; response: RepairMcpServerResponse }
  | { ok: false; code: string | null };

/**
 * Perform the repair the health record offered for one server.
 *
 * `confirm` is sent because the endpoint refuses the request without it; the
 * caller is expected to have asked the user first. The daemon re-derives the
 * path it removes from a fresh probe, so this body never carries one.
 */
export async function repairMcpServer(
  serverId: string,
): Promise<RepairMcpServerResult> {
  try {
    const res = await fetch('/api/mcp/repair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serverId, confirm: true }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: { code?: string } }
        | null;
      return { ok: false, code: body?.error?.code ?? null };
    }
    return { ok: true, response: (await res.json()) as RepairMcpServerResponse };
  } catch {
    return { ok: false, code: null };
  }
}
