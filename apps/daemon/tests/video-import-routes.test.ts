// Video import connect/callback/disconnect routes: same-origin enforcement,
// an unknown OAuth state, disconnect removing the credential file, and the
// routing check the scouting round asked for -- a Vimeo callback never
// reaches the Composio-bound connector callback.
//
// RED on base 8487362f0: POST /api/video-import/vimeo/connect answers 403
// from the daemon's existing global /api origin-validation middleware
// (server.ts) even though the route itself does not exist yet -- the same
// middleware rejects a cross-site request against ANY unregistered /api
// path. Behavioural, not import-only: the fix commit adds the route and the
// same 403 holds for the same reason.

import http from 'node:http';
import type { Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

// This file is committed as the red-spec commit, before
// apps/daemon/src/video-import/** exists, so it deliberately reads/writes
// the credential file at the raw filesystem level (its documented path and
// shape: <dataDir>/video-import/credentials.json, keyed by provider) rather
// than importing the not-yet-built FileVideoImportCredentialStore class --
// every assertion below stays behavioural on base instead of failing at
// module-resolution time.
type StartedServer = { url: string; server: Server };
type JsonObject = Record<string, any>;

let server: Server | undefined;
let baseUrl = '';
let dataDir = '';
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ['OD_VIMEO_CLIENT_ID', 'OD_VIMEO_CLIENT_SECRET', 'VIMEO_CLIENT_ID', 'VIMEO_CLIENT_SECRET'] as const;

beforeEach(async () => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  dataDir = process.env.OD_DATA_DIR ?? '';
  const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
  server = started.server;
  baseUrl = started.url;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await new Promise<void>((resolve, reject) => {
    if (!server) return resolve();
    server.close((error?: Error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
});

async function jsonFetch(url: string, init?: RequestInit): Promise<{ status: number; body: JsonObject }> {
  const response = await fetch(url, init);
  const raw = await response.text();
  return { status: response.status, body: raw ? JSON.parse(raw) : {} };
}

/** A cross-site fetch as the wire actually looks: Sec-Fetch-Site is a
 *  forbidden header name for `fetch()`, so this goes over raw node:http,
 *  matching apps/daemon/tests/api-origin-fetch-metadata.test.ts. */
function crossSiteRequest(method: string, url: string): Promise<{ status: number; body: string }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method,
        headers: { 'sec-fetch-site': 'cross-site' },
      },
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

function credentialsFilePath(): string {
  return path.join(dataDir, 'video-import', 'credentials.json');
}

function readStoredVimeoCredential(): JsonObject | undefined {
  try {
    const raw = fs.readFileSync(credentialsFilePath(), 'utf8');
    return (JSON.parse(raw) as JsonObject).vimeo;
  } catch {
    return undefined;
  }
}

function seedStoredVimeoCredential(): void {
  const dir = path.dirname(credentialsFilePath());
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    credentialsFilePath(),
    JSON.stringify({
      vimeo: { schemaVersion: 1, provider: 'vimeo', accessToken: 'pretend-access-token', updatedAt: new Date().toISOString() },
    }),
    { encoding: 'utf8', mode: 0o600 },
  );
}

describe('video import routes: same-origin enforcement', () => {
  it('rejects a cross-site connect', async () => {
    const res = await crossSiteRequest('POST', `${baseUrl}/api/video-import/vimeo/connect`);
    expect(res.status).toBe(403);
  });

  it('rejects a cross-site disconnect', async () => {
    const res = await crossSiteRequest('POST', `${baseUrl}/api/video-import/vimeo/disconnect`);
    expect(res.status).toBe(403);
  });
});

describe('video import routes: connect', () => {
  it('refuses to connect an unconfigured provider', async () => {
    const res = await jsonFetch(`${baseUrl}/api/video-import/vimeo/connect`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('refuses to connect the disabled youtube provider', async () => {
    const res = await jsonFetch(`${baseUrl}/api/video-import/youtube/connect`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('404s an unknown provider', async () => {
    const res = await jsonFetch(`${baseUrl}/api/video-import/dailymotion/connect`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('returns an authorize URL once the provider is configured', async () => {
    process.env.OD_VIMEO_CLIENT_ID = 'id-canary';
    process.env.OD_VIMEO_CLIENT_SECRET = 'secret-canary';
    const res = await jsonFetch(`${baseUrl}/api/video-import/vimeo/connect`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(typeof res.body.authorizeUrl).toBe('string');
    const parsed = new URL(res.body.authorizeUrl);
    expect(parsed.pathname).toBe('/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('id-canary');
    expect(parsed.searchParams.get('state')).toBeTruthy();
    expect(res.body.authorizeUrl).not.toContain('secret-canary');
  });
});

describe('video import routes: OAuth callback', () => {
  it('rejects an unknown state and stores no credential', async () => {
    const res = await jsonFetch(`${baseUrl}/api/video-import/oauth/callback/vimeo?state=unknown-state&code=whatever`);
    expect(res.status).toBe(400);
    expect(fs.existsSync(credentialsFilePath())).toBe(false);
    expect(readStoredVimeoCredential()).toBeUndefined();
  });

  it('404s the youtube callback path', async () => {
    const res = await jsonFetch(`${baseUrl}/api/video-import/oauth/callback/youtube?state=x&code=y`);
    expect(res.status).toBe(404);
  });
});

describe('video import routes: disconnect', () => {
  it('deletes the credentials file entirely, not just the record', async () => {
    seedStoredVimeoCredential();
    expect(fs.existsSync(credentialsFilePath())).toBe(true);

    const res = await jsonFetch(`${baseUrl}/api/video-import/vimeo/disconnect`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(fs.existsSync(credentialsFilePath())).toBe(false);
  });

  it('never has a connected vimeo credential to remove, so disconnecting it leaves a stored vimeo token alone', async () => {
    seedStoredVimeoCredential();
    expect(readStoredVimeoCredential()).toBeDefined();

    const res = await jsonFetch(`${baseUrl}/api/video-import/youtube/disconnect`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(fs.existsSync(credentialsFilePath())).toBe(true);
    expect(readStoredVimeoCredential()).toMatchObject({ provider: 'vimeo', accessToken: 'pretend-access-token' });

    // Clean up the seeded vimeo credential (the shared data dir survives
    // across tests in this file) via the real vimeo disconnect, so a later
    // test's "no credential file exists yet" assumption still holds.
    await jsonFetch(`${baseUrl}/api/video-import/vimeo/disconnect`, { method: 'POST' });
    expect(fs.existsSync(credentialsFilePath())).toBe(false);
  });
});

describe('video import routing does not collide with the Composio connector callback', () => {
  it('leaves GET /api/connectors/oauth/callback/vimeo answering its existing Composio-bound error', async () => {
    const res = await jsonFetch(`${baseUrl}/api/connectors/oauth/callback/vimeo?state=x`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CONNECTOR_NOT_FOUND');
    expect(fs.existsSync(credentialsFilePath())).toBe(false);
  });
});
