// Red spec for W1F.3, finding 3: the remote half of the per-server health
// probe.
//
// `mcp-health-surface.test.ts` configures stdio children only, so every
// `http` / `sse` path in `apps/daemon/src/mcp-health.ts` -- `connectRemote`
// and `readInitializeFromStream` -- was covered by hand-run scratch fixtures
// and nothing else. Both material defects found while track 1.3 was being
// audited were in exactly those two functions.
//
// One deterministic HTTP server serves every shape a real MCP server can
// answer with: an `initialize` result, a JSON-RPC error, a stream held open
// after the reply, an empty body, the wrong content type, a non-2xx status,
// and silence. The probe is measured against each, on both remote transports.

import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { probeMcpServerHealth } from '../src/mcp-health.js';
import type { McpServerConfig } from '../src/mcp-config.js';

/** Short enough that the silent routes finish the suite, long enough that a
 *  loopback round-trip is never mistaken for a timeout. */
const BUDGET_MS = 700;

const INITIALIZE_RESULT = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  result: {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: { name: 'remote-probe', version: '1.0.0' },
  },
});

const INITIALIZE_ERROR = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  error: { code: -32600, message: 'initialize rejected: unsupported protocol version' },
});

let server: http.Server;
let baseUrl = '';
/** Requests the probe made, so the handshake itself can be asserted. */
const seen: Array<{ method: string; url: string; accept: string }> = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({
      method: req.method ?? '',
      url: req.url ?? '',
      accept: String(req.headers.accept ?? ''),
    });
    const path = (req.url ?? '').split('?')[0];
    switch (path) {
      case '/json-result':
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(`${INITIALIZE_RESULT}\n`);
        return;
      case '/json-error':
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(`${INITIALIZE_ERROR}\n`);
        return;
      case '/held-open':
        // Streamable HTTP: answer `initialize` as one SSE frame, then keep the
        // stream open forever. A probe that waits for the body to complete
        // reports this fast server as a timeout.
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${INITIALIZE_RESULT}\n\n`);
        return;
      case '/empty':
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end();
        return;
      case '/html':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><title>not an MCP server</title>');
        return;
      case '/boom':
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('upstream exploded');
        return;
      case '/event-stream':
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(': open\n\n');
        return;
      case '/silent':
        // Headers never sent: the probe's own budget is the only thing that
        // can end this request.
        return;
      default:
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('no such route');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function remoteServer(
  transport: 'http' | 'sse',
  path: string,
  id = `${transport}-probe`,
): McpServerConfig {
  return { id, transport, enabled: true, url: `${baseUrl}${path}` };
}

function probe(server: McpServerConfig) {
  return probeMcpServerHealth(server, { budgetMs: BUDGET_MS });
}

describe('streamable HTTP MCP servers are probed at their own handshake', () => {
  it('reports ok when the server answers initialize', async () => {
    const health = await probe(remoteServer('http', '/json-result'));

    expect(health.state).toBe('ok');
    expect(health.transport).toBe('http');
    expect(health.connectMs).toBeLessThan(BUDGET_MS);
    expect(health.reason).toBeUndefined();
    const request = seen.find((entry) => entry.url === '/json-result');
    expect(request?.method).toBe('POST');
  });

  it('reports the server-supplied reason when initialize is rejected', async () => {
    const health = await probe(remoteServer('http', '/json-error'));

    expect(health.state).toBe('failed');
    expect(health.reason).toBe('initialize rejected: unsupported protocol version');
  });

  it('settles on the first frame of a stream the server never closes', async () => {
    const health = await probe(remoteServer('http', '/held-open'));

    expect(health.state).toBe('ok');
    expect(health.connectMs).toBeLessThan(BUDGET_MS);
  });

  it('reports a failure when the body carries no initialize result', async () => {
    const health = await probe(remoteServer('http', '/empty'));

    expect(health.state).toBe('failed');
    expect(health.reason).toContain('without a JSON-RPC initialize result');
  });

  it('reports a failure for a page that is not an MCP endpoint', async () => {
    const health = await probe(remoteServer('http', '/html'));

    expect(health.state).toBe('failed');
    expect(health.reason).toContain('without a JSON-RPC initialize result');
  });

  it('reports the status code when the server refuses the request', async () => {
    const health = await probe(remoteServer('http', '/boom'));

    expect(health.state).toBe('failed');
    expect(health.reason).toBe('HTTP 500');
    expect(health.stderrExcerpt).toContain('upstream exploded');
  });

  it('reports a timeout, never an ok, when the server stays silent', async () => {
    const health = await probe(remoteServer('http', '/silent'));

    expect(health.state).toBe('timeout');
    expect(health.connectMs).toBeGreaterThanOrEqual(BUDGET_MS);
    expect(health.reason).toContain(`no reply within ${BUDGET_MS}ms`);
  });
});

describe('SSE MCP servers are probed at their own handshake', () => {
  it('reports ok when the event stream opens', async () => {
    const health = await probe(remoteServer('sse', '/event-stream'));

    expect(health.state).toBe('ok');
    expect(health.transport).toBe('sse');
    expect(health.connectMs).toBeLessThan(BUDGET_MS);
    const request = seen.find((entry) => entry.url === '/event-stream');
    expect(request?.method).toBe('GET');
    expect(request?.accept).toContain('text/event-stream');
  });

  it('refuses to call a page an event stream', async () => {
    const health = await probe(remoteServer('sse', '/html'));

    expect(health.state).toBe('failed');
    expect(health.reason).toContain('expected an event stream');
  });

  it('reports the status code when the stream endpoint is absent', async () => {
    const health = await probe(remoteServer('sse', '/missing'));

    expect(health.state).toBe('failed');
    expect(health.reason).toBe('HTTP 404');
  });

  it('reports a timeout when the stream never opens', async () => {
    const health = await probe(remoteServer('sse', '/silent'));

    expect(health.state).toBe('timeout');
    expect(health.connectMs).toBeGreaterThanOrEqual(BUDGET_MS);
  });
});

describe('a remote server with no URL is reported, not contacted', () => {
  it('fails with the configuration reason', async () => {
    const health = await probeMcpServerHealth(
      { id: 'no-url', transport: 'http', enabled: true },
      { budgetMs: BUDGET_MS },
    );

    expect(health.state).toBe('failed');
    expect(health.reason).toBe('no url configured');
    expect(health.connectMs).toBe(0);
  });
});
