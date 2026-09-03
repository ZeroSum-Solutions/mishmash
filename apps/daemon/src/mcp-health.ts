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

/** A well-formed `initialize` reply is far smaller than this. */
const STDOUT_BUFFER_LIMIT = 256_000;

/**
 * How long a probed server gets to honour SIGTERM before SIGKILL.
 *
 * Both signals reach the direct child only. A server launched through an
 * `npx` or `uvx` wrapper runs as that wrapper's own child, and a wrapper that
 * does not forward the signal can leave the real server behind. Killing the
 * process group instead is the fix, and it is a follow-up rather than a line
 * here: it needs `detached` spawning and platform-specific handling, which is
 * more than this probe should grow inside a bug fix.
 */
const KILL_GRACE_MS = 2_000;

/**
 * Why a server is reported `timeout`.
 *
 * The cold-start clause is not padding: a server launched through `npx -y` or
 * `uvx` downloads its package on first use, which can outlast the budget on a
 * cold cache. Saying so is the difference between this surface and the report
 * that made #157 -- a budget that expired is a fact about the probe, not a
 * verdict on the server.
 */
function timeoutReason(budgetMs: number): string {
  return `no reply within ${budgetMs}ms (a first run may still be downloading the server)`;
}

/**
 * The connect time to report when the budget ran out.
 *
 * A timeout consumed the whole budget by definition of the branch, but the
 * wall clock can read a millisecond short of it: the elapsed clock starts at
 * the `spawn()` call and the timer is armed just after, so timer granularity
 * can land under. Reporting "no reply within 15000ms" beside "14999ms" would
 * contradict itself, so take whichever is larger -- a probe held up past its
 * own budget still reports the real number.
 */
function timedOutConnectMs(elapsedMs: number, budgetMs: number): number {
  return Math.max(elapsedMs, budgetMs);
}

/**
 * Text describing an external MCP server's connection state.
 *
 * A line qualifies when it pairs an MCP subject -- the words "MCP server(s)",
 * or "deferred tools" (the agent CLI's name for MCP-provided tools) -- with a
 * connection-state word. Requiring both halves is what leaves an ordinary
 * agent failure that merely mentions a tool alone.
 *
 * The parenthesized status codes are the one alternative that does not require
 * a subject, because it does not need one: `(CONNECT_TIMEOUT)` and
 * `(CONNECTION_CLOSED)` are the agent CLI's MCP status vocabulary and appear
 * nowhere else in its output. That makes the alternative broader than the
 * subject-plus-state rule above, so it is written out rather than left for a
 * reader to notice.
 */
const MCP_SERVER_HEALTH_LINE_RE =
  /\b(?:MCP servers?|deferred tools?)\b[^\n]*\b(?:failed to connect|connection timed out|connection closed|no longer available|available again|disconnected|reconnected|unavailable)\b|\bMCP server (?:disconnected|reconnected)\b|\((?:CONNECT_TIMEOUT|CONNECTION_CLOSED)\)/i;

/**
 * INVARIANT: a run's failure indicator derives from the run's own outcome.
 *
 * An external MCP server that failed to connect is not the run's outcome, so
 * its connect-state text must never reach a run failure classifier. Feed
 * every classifier input through this helper and the two stay separate by
 * construction rather than by each classifier remembering to be careful.
 *
 * Filtering is line-scoped, which is what makes it safe rather than complete:
 * agent output is line-delimited transport, so a frame about MCP servers and a
 * frame about the model provider never share a line, and dropping the former
 * cannot hide the latter. It recognizes the vocabulary the agent CLI actually
 * uses; a future CLI could word a disconnect notice this never sees, which
 * would leave that line in the classifier's input exactly as before this
 * helper existed -- never worse.
 */
export function withoutMcpServerHealthNoise(text: string): string {
  if (!text) return text;
  if (!MCP_SERVER_HEALTH_LINE_RE.test(text)) return text;
  return text
    .split('\n')
    .filter((line) => !MCP_SERVER_HEALTH_LINE_RE.test(line))
    .join('\n');
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
  // Bounded: a server that streams without ever completing a JSON-RPC line
  // would otherwise grow this buffer for the whole budget.
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
      () =>
        settle({
          state: 'timeout',
          connectMs: timedOutConnectMs(elapsed(), budgetMs),
          reason: timeoutReason(budgetMs),
        }),
      budgetMs,
    );

    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > STDOUT_BUFFER_LIMIT && !stdout.includes('\n')) {
        settle({
          state: 'failed',
          connectMs: elapsed(),
          reason: `server sent ${STDOUT_BUFFER_LIMIT} bytes without a complete JSON-RPC frame`,
        });
        return;
      }
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

  // SIGTERM first, then SIGKILL after a grace period: a server that ignores
  // SIGTERM must not outlive the probe that spawned it. `unref` keeps the
  // grace timer from holding the event loop open.
  child.kill();
  if (child.exitCode === null && child.signalCode === null) {
    setTimeout(() => {
      if (!child.killed || child.exitCode === null) child.kill('SIGKILL');
    }, KILL_GRACE_MS).unref();
  }
  return outcome;
}

type ConclusiveReply = { ok: true } | { ok: false; reason: string };

/**
 * Look for a conclusive `initialize` outcome in the bytes that have arrived so
 * far, or `null` when nothing conclusive is there yet.
 *
 * `null` is the load-bearing case. A streamable-HTTP server may answer
 * `initialize` and then hold its SSE stream open, so waiting for the body to
 * complete before deciding would report a server that answered in 200 ms as a
 * 15-second timeout -- the exact shape of #157, rebuilt on the surface meant
 * to correct it. The caller reads incrementally and stops at the first frame
 * that settles the question.
 *
 * Only complete lines are parsed until the stream ends, because a half-arrived
 * frame is not a frame. Both wire shapes are accepted: plain JSON, and one SSE
 * `data:` frame.
 */
function scanInitializeReply(buffered: string, atEnd: boolean): ConclusiveReply | null {
  const lines = buffered.split('\n');
  const complete = atEnd ? lines : lines.slice(0, -1);
  for (const raw of complete) {
    const line = raw.trim();
    if (!line) continue;
    const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
    if (!payload) continue;
    try {
      const message = JSON.parse(payload) as { result?: unknown; error?: { message?: string } };
      if (message.error) {
        return { ok: false, reason: message.error.message ?? 'server rejected initialize' };
      }
      if (message.result) return { ok: true };
    } catch {
      // Not a JSON-RPC frame (a comment, a keep-alive, a banner). Keep reading.
    }
  }
  return null;
}

/**
 * Read an HTTP response until it settles the `initialize` question, then stop.
 *
 * Stopping early is the point: this returns as soon as a frame answers, and
 * cancels the rest of the body rather than waiting for a stream the server may
 * never close.
 */
async function readInitializeFromStream(
  res: Response,
): Promise<{ reply: ConclusiveReply; body: string }> {
  const stream = res.body;
  if (!stream) {
    const body = await res.text();
    return {
      reply: scanInitializeReply(body, true)
        ?? { ok: false, reason: 'server answered without a JSON-RPC initialize result' },
      body,
    };
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffered += decoder.decode(value, { stream: true });
      const reply = scanInitializeReply(buffered, done);
      if (reply) return { reply, body: buffered };
      if (done) break;
      if (buffered.length > STDOUT_BUFFER_LIMIT) {
        return {
          reply: {
            ok: false,
            reason: `server sent ${STDOUT_BUFFER_LIMIT} bytes without a JSON-RPC initialize result`,
          },
          body: buffered,
        };
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return {
    reply: { ok: false, reason: 'server answered without a JSON-RPC initialize result' },
    body: buffered,
  };
}

/**
 * Connect to an http or sse server and time the reply.
 *
 * The two transports differ in their handshake and are probed differently:
 * streamable HTTP takes a POSTed `initialize` and answers it, while the older
 * SSE transport answers a GET by opening an event stream and only then accepts
 * posts on a session endpoint it names. For `sse` the probe therefore measures
 * what it can honestly measure -- that an event stream opens -- rather than
 * POSTing at a URL that shape does not serve and reporting the 405 as a dead
 * server. The `sse` meaning of `ok` and `connectMs` is narrower than the http
 * one, and `packages/contracts/src/api/mcp.ts` says so where a reader of the
 * DTO will see it.
 */
async function connectRemote(
  server: McpServerConfig,
  budgetMs: number,
  extraHeaders: Record<string, string>,
): Promise<ConnectOutcome> {
  if (!server.url) {
    return { state: 'failed', connectMs: 0, stderr: '', reason: 'no url configured' };
  }
  const isSse = server.transport === 'sse';
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const res = await fetch(server.url, {
      method: isSse ? 'GET' : 'POST',
      headers: {
        accept: isSse ? 'text/event-stream' : 'application/json, text/event-stream',
        ...(isSse ? {} : { 'content-type': 'application/json' }),
        ...(server.headers ?? {}),
        ...extraHeaders,
      },
      ...(isSse ? {} : { body: JSON.stringify(INITIALIZE_REQUEST) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        state: 'failed',
        connectMs: Date.now() - startedAt,
        stderr: excerpt(await res.text().catch(() => '')),
        reason: `HTTP ${res.status}`,
      };
    }
    if (isSse) {
      // An event stream opening IS the SSE handshake's first step; anything
      // past it needs the session endpoint the stream itself names, which is
      // more than a health probe should hold open. A 200 that is not an event
      // stream is not that handshake, though -- a stray web page at the
      // configured URL must not read as a working server.
      const contentType = res.headers.get('content-type') ?? '';
      void res.body?.cancel().catch(() => {});
      if (!contentType.toLowerCase().includes('text/event-stream')) {
        return {
          state: 'failed',
          connectMs: Date.now() - startedAt,
          stderr: '',
          reason: `expected an event stream, got content-type "${contentType || 'none'}"`,
        };
      }
      return { state: 'ok', connectMs: Date.now() - startedAt, stderr: '' };
    }
    const { reply, body } = await readInitializeFromStream(res);
    const connectMs = Date.now() - startedAt;
    if (!reply.ok) {
      return { state: 'failed', connectMs, stderr: excerpt(body), reason: reply.reason };
    }
    return { state: 'ok', connectMs, stderr: '' };
  } catch (err) {
    const connectMs = Date.now() - startedAt;
    const aborted = (err as Error).name === 'AbortError';
    return {
      state: aborted ? 'timeout' : 'failed',
      connectMs: aborted ? timedOutConnectMs(connectMs, budgetMs) : connectMs,
      stderr: '',
      reason: aborted ? timeoutReason(budgetMs) : String((err as Error).message),
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
  };
  if (!server.enabled) {
    // Reported, never spawned: a switched-off server is a fact about the
    // config, and probing it would start a process the user opted out of.
    return {
      ...base,
      state: 'disabled',
      connectMs: 0,
      stderrExcerpt: '',
      checkedAt: new Date().toISOString(),
    };
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
