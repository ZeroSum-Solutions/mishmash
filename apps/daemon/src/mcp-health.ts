// MCP health — the surface that owns per-server connection state.
//
// External MCP servers are optional accessories to a run: an agent whose
// `mermaid` server never started can still answer the user perfectly, and
// issue #157 is what happens when the product forgets that. Two rules live
// here, and they are the same rule seen from both ends.
//
//   1. `withoutMcpServerHealthNoise` keeps MCP connection state out of the
//      run failure classifiers, so a run's indicator can only ever describe
//      the run's own outcome.
//   2. `probeMcpServersHealth` gives that state somewhere better to live: a
//      measurement MishMash takes itself, per server, with the stderr the
//      server actually wrote.
//
// The measurement is first-hand on purpose. In #157 the agent CLI reported
// three servers as 30 s connect timeouts that a stopwatch showed answering
// in under three; repeating the agent's claim would reproduce the bug in a
// new place.

import { spawn } from 'node:child_process';

import type {
  McpHealthResponse,
  McpServerHealth,
  McpServerHealthState,
} from '@open-design/contracts';

import type { McpServerConfig } from './mcp-config.js';
import { redactSecrets } from './redact.js';

/** How long a server gets to answer `initialize`, measured from spawn. */
export const MCP_CONNECT_BUDGET_MS = 15_000;

/** Longest stderr excerpt kept per server. Enough for a stack tail. */
const STDERR_EXCERPT_LIMIT = 2_000;

/**
 * Text describing an external MCP server's connection state.
 *
 * A line qualifies only when it names MCP *and* a connection-state word, or
 * carries one of the agent CLI's MCP status codes. Both halves are required
 * so that an ordinary agent failure that merely mentions a tool is left
 * alone.
 */
const MCP_SERVER_HEALTH_LINE_RE =
  /\bMCP servers?\b[^\n]*\b(?:failed to connect|connection timed out|connection closed|disconnected|reconnected|unavailable)\b|\bMCP server (?:disconnected|reconnected)\b|\((?:CONNECT_TIMEOUT|CONNECTION_CLOSED)\)/i;

/**
 * INVARIANT: a run's failure indicator derives from the run's own outcome.
 *
 * An external MCP server that failed to connect is not the run's outcome, so
 * its connect-state text must never reach a run failure classifier. Feed
 * every classifier input through this helper and the two stay separate by
 * construction rather than by each classifier remembering to be careful.
 *
 * Filtering is line-scoped: agent output is line-delimited transport, so a
 * frame about MCP servers and a frame about the model provider never share
 * a line, and dropping the former cannot hide the latter.
 */
export function withoutMcpServerHealthNoise(text: string): string {
  if (!text) return text;
  if (!MCP_SERVER_HEALTH_LINE_RE.test(text)) return text;
  return text
    .split('\n')
    .filter((line) => !MCP_SERVER_HEALTH_LINE_RE.test(line))
    .join('\n');
}

/** True when `text` is entirely MCP server connection state. */
export function isMcpServerHealthNoise(text: string): boolean {
  return Boolean(text.trim()) && !withoutMcpServerHealthNoise(text).trim();
}

/**
 * A concrete repair for a failure signature MishMash recognizes, or
 * undefined. Both entries come from the servers measured in issue #157;
 * neither is applied automatically, because both mutate state the daemon
 * does not own (an npm cache, a Python environment resolution).
 */
export function mcpFailureRemedy(
  server: Pick<McpServerConfig, 'command' | 'args'>,
  stderr: string,
): string | undefined {
  const npxCache = /_npx\/([0-9a-f]+)\/package\.json/.exec(stderr);
  if (npxCache && /ENOENT/i.test(stderr)) {
    return (
      `The npx cache entry for this server is incomplete. Remove ` +
      `~/.npm/_npx/${npxCache[1]} and it will be re-downloaded on the next run.`
    );
  }
  if (
    /AttributeError: 'Server' object has no attribute/i.test(stderr) &&
    (server.command === 'uvx' || (server.args ?? []).includes('--from'))
  ) {
    return (
      'This server needs an older Python `mcp` SDK than uvx resolves by ' +
      "default. Add `--with 'mcp<1.10'` to its arguments."
    );
  }
  return undefined;
}

interface ProbeOptions {
  budgetMs?: number;
  /** Extra request headers for an http/sse server (e.g. a Bearer token the
   * daemon holds). Keyed by server id. */
  headersByServerId?: Record<string, Record<string, string>>;
}

function excerpt(text: string): string {
  return redactSecrets(text).slice(-STDERR_EXCERPT_LIMIT);
}

const INITIALIZE_REQUEST = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mishmash-health-probe', version: '1' },
  },
};

interface ConnectOutcome {
  state: Exclude<McpServerHealthState, 'disabled'>;
  connectMs: number;
  stderr: string;
  reason?: string;
}

/**
 * Spawn a stdio server, send `initialize`, and time the reply.
 *
 * The clock starts at the `spawn()` call, not after the process is up, so
 * everything the server spends resolving itself (npx download, uvx
 * environment build, interpreter start) is inside the number the user sees.
 * That is the measurement #157 was missing.
 */
async function connectStdio(
  server: McpServerConfig,
  budgetMs: number,
): Promise<ConnectOutcome> {
  if (!server.command) {
    return { state: 'failed', connectMs: 0, stderr: '', reason: 'no command configured' };
  }
  const spawnedAt = Date.now();
  const child = spawn(server.command, server.args ?? [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...(server.env ?? {}) },
  });

  let stderr = '';
  let stdout = '';
  child.stderr?.setEncoding('utf8');
  child.stdout?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-STDERR_EXCERPT_LIMIT);
  });

  const outcome = await new Promise<ConnectOutcome>((resolve) => {
    let settled = false;
    const elapsed = () => Date.now() - spawnedAt;
    const settle = (result: Omit<ConnectOutcome, 'stderr'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stderr });
    };
    const timer = setTimeout(
      () => settle({ state: 'timeout', connectMs: elapsed(), reason: `no reply within ${budgetMs}ms` }),
      budgetMs,
    );

    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      // The reply is one JSON-RPC frame per line; the first complete line
      // that parses as a response settles the probe.
      let index = stdout.indexOf('\n');
      while (index !== -1) {
        const line = stdout.slice(0, index).trim();
        stdout = stdout.slice(index + 1);
        if (line) {
          try {
            const message = JSON.parse(line) as { result?: unknown; error?: { message?: string } };
            if (message.error) {
              settle({
                state: 'failed',
                connectMs: elapsed(),
                reason: message.error.message ?? 'server rejected initialize',
              });
              return;
            }
            if (message.result) {
              settle({ state: 'ok', connectMs: elapsed() });
              return;
            }
          } catch {
            // Not a JSON-RPC frame (a banner line, a warning). Keep reading.
          }
        }
        index = stdout.indexOf('\n');
      }
    });
    child.on('error', (err: Error) =>
      settle({ state: 'failed', connectMs: elapsed(), reason: err.message }),
    );
    child.on('close', (code) =>
      settle({
        state: 'failed',
        connectMs: elapsed(),
        reason: `server exited with code ${code ?? 'null'} before replying`,
      }),
    );

    try {
      child.stdin?.write(`${JSON.stringify(INITIALIZE_REQUEST)}\n`);
    } catch (err) {
      settle({ state: 'failed', connectMs: elapsed(), reason: String((err as Error).message) });
    }
  });

  child.kill();
  return outcome;
}

/** POST one `initialize` at an http/sse server and time the reply. */
async function connectRemote(
  server: McpServerConfig,
  budgetMs: number,
  extraHeaders: Record<string, string>,
): Promise<ConnectOutcome> {
  if (!server.url) {
    return { state: 'failed', connectMs: 0, stderr: '', reason: 'no url configured' };
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(server.headers ?? {}),
        ...extraHeaders,
      },
      body: JSON.stringify(INITIALIZE_REQUEST),
      signal: controller.signal,
    });
    const connectMs = Date.now() - startedAt;
    if (!res.ok) {
      return {
        state: 'failed',
        connectMs,
        stderr: excerpt(await res.text().catch(() => '')),
        reason: `HTTP ${res.status}`,
      };
    }
    return { state: 'ok', connectMs, stderr: '' };
  } catch (err) {
    const connectMs = Date.now() - startedAt;
    const aborted = (err as Error).name === 'AbortError';
    return {
      state: aborted ? 'timeout' : 'failed',
      connectMs,
      stderr: '',
      reason: aborted ? `no reply within ${budgetMs}ms` : String((err as Error).message),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Measure one configured server. Disabled entries are reported, not probed. */
export async function probeMcpServerHealth(
  server: McpServerConfig,
  options: ProbeOptions = {},
): Promise<McpServerHealth> {
  const budgetMs = options.budgetMs ?? MCP_CONNECT_BUDGET_MS;
  const base = {
    id: server.id,
    ...(server.label ? { label: server.label } : {}),
    transport: server.transport,
    enabled: server.enabled,
    budgetMs,
    checkedAt: new Date().toISOString(),
  };
  if (!server.enabled) {
    return { ...base, state: 'disabled', connectMs: 0, stderrExcerpt: '' };
  }
  const outcome =
    server.transport === 'stdio'
      ? await connectStdio(server, budgetMs)
      : await connectRemote(server, budgetMs, options.headersByServerId?.[server.id] ?? {});
  const stderrExcerpt = excerpt(outcome.stderr);
  const remedy = outcome.state === 'ok' ? undefined : mcpFailureRemedy(server, outcome.stderr);
  return {
    ...base,
    state: outcome.state,
    connectMs: outcome.connectMs,
    stderrExcerpt,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
    ...(remedy ? { remedy } : {}),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Measure every configured server, concurrently.
 *
 * Concurrent on purpose: the agent connects to them all at once, so a serial
 * sweep would report connect times no run ever experiences.
 */
export async function probeMcpServersHealth(
  servers: McpServerConfig[],
  options: ProbeOptions = {},
): Promise<McpHealthResponse> {
  const results = await Promise.all(
    servers.map((server) => probeMcpServerHealth(server, options)),
  );
  return { servers: results, checkedAt: new Date().toISOString() };
}
