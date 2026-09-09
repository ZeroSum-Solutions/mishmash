// Deeper OAuth/token security matrix (W7-R2-25): state TTL, one-shot
// consume, replay, provider mismatch, a daemon-restart case; redirect-URI
// derivation against a hostile Host header, X-Forwarded-* headers, a wrong
// scheme, a tailnet/public hostname, and a wrong port; and the credential
// file's mode/atomicity guarantees.
//
// RED on base 8487362f0: POST /api/video-import/vimeo/connect answers 404
// (behavioural, no route registered).

import http from 'node:http';
import type { Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startServer } from '../src/server.js';

// This file is committed as the red-spec commit, before
// apps/daemon/src/video-import/** exists. Every assertion below either hits
// the real HTTP surface or reads the documented credential-file path/shape
// at the raw filesystem level, rather than statically importing the
// not-yet-built video-import module tree -- a static import of a missing
// module would fail the whole file at load time (a compile-time failure),
// not the behavioural failure the red spec needs. The one state-cache unit
// test that cannot be expressed over HTTP (a 10-minute TTL) imports the
// class dynamically, inside the test body, for the same reason: it is the
// one assertion in this file allowed to report "module not found" on base,
// and it never gates any other test's ability to run and fail
// behaviourally.
type StartedServer = { url: string; server: Server };
type JsonObject = Record<string, any>;

const MOCK_OAUTH_BASE_URL = 'https://mock-vimeo.internal.test';
const MOCK_CLIENT_ID = 'mock-client-id-canary';
const MOCK_CLIENT_SECRET = 'mock-client-secret-canary';
const MOCK_AUTH_CODE = 'mock-authorization-code-canary';
const MOCK_ACCESS_TOKEN = 'mock-access-token-canary';
const MOCK_REFRESH_TOKEN = 'mock-refresh-token-canary';
const MOCK_ACCOUNT_NAME = 'Mock Fixture Account';

const originalFetch = globalThis.fetch;

function stubVimeoTokenEndpoint(): void {
  vi.stubGlobal('fetch', async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith(MOCK_OAUTH_BASE_URL)) return originalFetch(input, init);
    if (!url.endsWith('/oauth/access_token')) {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }
    const expectedAuth = `Basic ${Buffer.from(`${MOCK_CLIENT_ID}:${MOCK_CLIENT_SECRET}`).toString('base64')}`;
    const headers = init?.headers as Record<string, string> | undefined;
    if (headers?.Authorization !== expectedAuth) {
      return new Response(JSON.stringify({ error: 'invalid client' }), { status: 401 });
    }
    const body = new URLSearchParams(String(init?.body ?? ''));
    if (body.get('grant_type') !== 'authorization_code' || body.get('code') !== MOCK_AUTH_CODE) {
      return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    }
    return new Response(
      JSON.stringify({
        access_token: MOCK_ACCESS_TOKEN,
        refresh_token: MOCK_REFRESH_TOKEN,
        user: { name: MOCK_ACCOUNT_NAME },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
}

let server: Server | undefined;
let baseUrl = '';
let daemonPort = '';
let dataDir = '';
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['OD_VIMEO_CLIENT_ID', 'OD_VIMEO_CLIENT_SECRET', 'OD_VIMEO_OAUTH_BASE_URL', 'OD_VIDEO_IMPORT_PUBLIC_BASE_URL'] as const;

async function bootServer(): Promise<void> {
  const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
  server = started.server;
  baseUrl = started.url;
  daemonPort = new URL(baseUrl).port;
}

async function stopServer(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    server.close((error?: Error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
}

beforeEach(async () => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
  process.env.OD_VIMEO_CLIENT_ID = MOCK_CLIENT_ID;
  process.env.OD_VIMEO_CLIENT_SECRET = MOCK_CLIENT_SECRET;
  process.env.OD_VIMEO_OAUTH_BASE_URL = MOCK_OAUTH_BASE_URL;
  delete process.env.OD_VIDEO_IMPORT_PUBLIC_BASE_URL;
  dataDir = process.env.OD_DATA_DIR ?? '';
  // Each test gets a clean credential store: OD_DATA_DIR is one shared temp
  // dir for the whole vitest worker (tests/setup.ts), so a prior test's
  // stored token must not leak into this one's "nothing persisted" checks.
  fs.rmSync(path.join(dataDir, 'video-import'), { recursive: true, force: true });
  stubVimeoTokenEndpoint();
  await bootServer();
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await stopServer();
  vi.unstubAllGlobals();
});

async function jsonFetch(url: string, init?: RequestInit): Promise<{ status: number; body: JsonObject }> {
  const response = await originalFetch(url, init);
  const raw = await response.text();
  let body: JsonObject = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    // The successful OAuth callback returns an HTML landing page, not JSON;
    // callers that care about its body only do so on the error path.
    body = {};
  }
  return { status: response.status, body };
}

function rawRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { protocol: target.protocol, hostname: target.hostname, port: target.port, path: target.pathname + target.search, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function stateFromConnect(): Promise<string> {
  const res = await jsonFetch(`${baseUrl}/api/video-import/vimeo/connect`, { method: 'POST' });
  expect(res.status).toBe(200);
  const parsed = new URL(res.body.authorizeUrl);
  const state = parsed.searchParams.get('state');
  if (!state) throw new Error('connect did not return a state');
  return state;
}

function credentialsDir(): string {
  return path.join(dataDir, 'video-import');
}

function credentialsFilePath(): string {
  return path.join(credentialsDir(), 'credentials.json');
}

function readStoredVimeoCredential(): JsonObject | undefined {
  try {
    const raw = fs.readFileSync(credentialsFilePath(), 'utf8');
    return (JSON.parse(raw) as JsonObject).vimeo;
  } catch {
    return undefined;
  }
}

describe('video import OAuth state cache', () => {
  it('drops a state past its 10-minute TTL (delete-before-age-check, mirroring PendingAuthCache)', async () => {
    const { VideoImportPendingAuthCache } = await import('../src/video-import/oauth.js');
    const cache = new VideoImportPendingAuthCache(10);
    cache.put('s', { provider: 'vimeo', redirectUri: 'http://127.0.0.1:1/api/video-import/oauth/callback/vimeo', createdAt: Date.now() - 1000 });
    expect(cache.consume('s')).toBeNull();
  });

  it('rejects an unknown state end to end', async () => {
    const res = await jsonFetch(`${baseUrl}/api/video-import/oauth/callback/vimeo?state=never-issued&code=${MOCK_AUTH_CODE}`);
    expect(res.status).toBe(400);
  });
});

describe('video import OAuth: connect -> callback -> replay -> provider mismatch', () => {
  it('completes a real handshake, rejects a replay, and never lets a mismatched provider consume the state', async () => {
    const state = await stateFromConnect();

    // A callback for the WRONG provider path with a state minted for vimeo
    // must fail without disturbing the pending state.
    const mismatched = await jsonFetch(`${baseUrl}/api/video-import/oauth/callback/youtube?state=${state}&code=${MOCK_AUTH_CODE}`);
    expect(mismatched.status).not.toBe(200);
    expect(readStoredVimeoCredential()).toBeUndefined();

    // The real callback succeeds and stores exactly the fixture token/account.
    const ok = await jsonFetch(`${baseUrl}/api/video-import/oauth/callback/vimeo?state=${state}&code=${MOCK_AUTH_CODE}`);
    expect(ok.status).toBe(200);
    const stored = readStoredVimeoCredential();
    expect(stored).toMatchObject({
      provider: 'vimeo',
      accessToken: MOCK_ACCESS_TOKEN,
      refreshToken: MOCK_REFRESH_TOKEN,
      account: { name: MOCK_ACCOUNT_NAME },
    });

    // Replay: the state was already consumed by the successful callback.
    const replay = await jsonFetch(`${baseUrl}/api/video-import/oauth/callback/vimeo?state=${state}&code=${MOCK_AUTH_CODE}`);
    expect(replay.status).toBe(400);
  });
});

describe('video import OAuth: daemon restart drops pending state', () => {
  it('a callback for a pre-restart state finds nothing and persists nothing', async () => {
    const state = await stateFromConnect();
    await stopServer();
    await bootServer(); // fresh process-equivalent: a brand-new in-memory cache

    const res = await jsonFetch(`${baseUrl}/api/video-import/oauth/callback/vimeo?state=${state}&code=${MOCK_AUTH_CODE}`);
    expect(res.status).toBe(400);
    expect(readStoredVimeoCredential()).toBeUndefined();
  });
});

describe('video import OAuth: redirect-URI derivation', () => {
  it('rejects a hostile (non-loopback) Host header before deriving a redirect URI', async () => {
    const res = await rawRequest('POST', `${baseUrl}/api/video-import/vimeo/connect`, { host: 'evil.example.com' });
    expect(res.status).toBe(403);
  });

  it('rejects a tailnet-style public hostname even though it resolves for the operator', async () => {
    const res = await rawRequest('POST', `${baseUrl}/api/video-import/vimeo/connect`, {
      host: `devins-macbook-pro.tail908c18.ts.net:${daemonPort}`,
    });
    expect(res.status).toBe(403);
  });

  it('ignores X-Forwarded-Host / X-Forwarded-Proto and derives from the real Host header', async () => {
    const res = await rawRequest('POST', `${baseUrl}/api/video-import/vimeo/connect`, {
      host: `127.0.0.1:${daemonPort}`,
      'x-forwarded-host': 'evil.example.com',
      'x-forwarded-proto': 'https',
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as { authorizeUrl: string };
    const redirectUri = new URL(parsed.authorizeUrl).searchParams.get('redirect_uri') ?? '';
    expect(redirectUri).toBe(`http://127.0.0.1:${daemonPort}/api/video-import/oauth/callback/vimeo`);
    expect(redirectUri).not.toContain('evil.example.com');
    expect(redirectUri.startsWith('https://')).toBe(false);
  });

  it('rejects a loopback Host header carrying the wrong port', async () => {
    const wrongPort = String(Number(daemonPort) + 1);
    const res = await rawRequest('POST', `${baseUrl}/api/video-import/vimeo/connect`, {
      host: `127.0.0.1:${wrongPort}`,
    });
    expect(res.status).toBe(400);
    expect(res.body).toContain('redirect port does not match');
  });

  // Express always hands `deriveVideoImportRedirectUri` a real 'http' or
  // 'https' `req.protocol` (there is no HTTP header that forges it without
  // `trust proxy`, which this daemon does not set), so the
  // protocol!=='http'&&protocol!=='https' branch has no reachable path over
  // HTTP. Call the function directly, dynamically imported per this file's
  // header note (a static import of the not-yet-built module tree would
  // fail load-time on base).
  it('rejects a bogus (non-http/https) scheme even with an otherwise-valid loopback host', async () => {
    const { deriveVideoImportRedirectUri } = await import('../src/video-import/oauth.js');
    const result = deriveVideoImportRedirectUri({
      provider: 'vimeo',
      hostHeader: `127.0.0.1:${daemonPort}`,
      protocol: 'ftp',
      resolvedPort: daemonPort,
      publicBaseUrl: '',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.code).toBe('VALIDATION_FAILED');
      expect(result.message).toContain('unsupported video import callback protocol');
    }
  });
});

describe('video import OAuth: credential file mode and atomicity', () => {
  it('keeps directory 0700 and file 0600 across an overwrite, with no .tmp remnant', async () => {
    const firstState = await stateFromConnect();
    await jsonFetch(`${baseUrl}/api/video-import/oauth/callback/vimeo?state=${firstState}&code=${MOCK_AUTH_CODE}`);

    const secondState = await stateFromConnect();
    await jsonFetch(`${baseUrl}/api/video-import/oauth/callback/vimeo?state=${secondState}&code=${MOCK_AUTH_CODE}`);

    const dirMode = fs.statSync(credentialsDir()).mode & 0o777;
    const fileMode = fs.statSync(credentialsFilePath()).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
    const remnants = fs.readdirSync(credentialsDir()).filter((name) => name.endsWith('.tmp'));
    expect(remnants).toEqual([]);
  });

  it('disconnect removes the file entirely', async () => {
    const state = await stateFromConnect();
    await jsonFetch(`${baseUrl}/api/video-import/oauth/callback/vimeo?state=${state}&code=${MOCK_AUTH_CODE}`);
    expect(fs.existsSync(credentialsFilePath())).toBe(true);

    const disconnect = await jsonFetch(`${baseUrl}/api/video-import/vimeo/disconnect`, { method: 'POST' });
    expect(disconnect.status).toBe(200);
    expect(fs.existsSync(credentialsFilePath())).toBe(false);
  });
});
