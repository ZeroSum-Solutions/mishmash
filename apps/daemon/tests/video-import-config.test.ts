// Video import provider config: env precedence and the masked status the
// GET /api/video-import/providers route publishes. Mirrors media/config.ts's
// ENV_KEYS precedence and readMaskedConfig's "never echo the secret" rule.
//
// RED on base 8487362f0: GET /api/video-import/providers answers 404
// (behavioural -- no route registered), not an import failure.

import type { Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

type StartedServer = { url: string; server: Server };
type JsonObject = Record<string, any>;

const ENV_KEYS = [
  'OD_VIMEO_CLIENT_ID',
  'VIMEO_CLIENT_ID',
  'OD_VIMEO_CLIENT_SECRET',
  'VIMEO_CLIENT_SECRET',
] as const;

let server: Server | undefined;
let baseUrl = '';
let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(async () => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
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

async function jsonFetch(url: string, init?: RequestInit): Promise<{ status: number; body: JsonObject; raw: string }> {
  const response = await fetch(url, init);
  const raw = await response.text();
  return { status: response.status, body: raw ? JSON.parse(raw) : {}, raw };
}

describe('GET /api/video-import/providers', () => {
  it('reports vimeo unconfigured and youtube declared-disabled with no env vars', async () => {
    const res = await jsonFetch(`${baseUrl}/api/video-import/providers`);
    expect(res.status).toBe(200);
    const vimeo = res.body.providers.find((p: JsonObject) => p.provider === 'vimeo');
    expect(vimeo).toEqual({
      provider: 'vimeo',
      enabled: true,
      configured: false,
      connected: false,
      credentialSource: 'unset',
    });
    const youtube = res.body.providers.find((p: JsonObject) => p.provider === 'youtube');
    expect(youtube).toEqual({
      provider: 'youtube',
      enabled: false,
      configured: false,
      connected: false,
      credentialSource: 'unset',
    });
  });

  it('is not configured when only the client id is present', async () => {
    process.env.VIMEO_CLIENT_ID = 'client-id-only';
    const res = await jsonFetch(`${baseUrl}/api/video-import/providers`);
    const vimeo = res.body.providers.find((p: JsonObject) => p.provider === 'vimeo');
    expect(vimeo).toMatchObject({ configured: false, credentialSource: 'unset' });
  });

  it('is not configured when only the client secret is present', async () => {
    process.env.VIMEO_CLIENT_SECRET = 'secret-only';
    const res = await jsonFetch(`${baseUrl}/api/video-import/providers`);
    const vimeo = res.body.providers.find((p: JsonObject) => p.provider === 'vimeo');
    expect(vimeo).toMatchObject({ configured: false, credentialSource: 'unset' });
  });

  it('prefers OD_VIMEO_* over the bare VIMEO_* env names and never echoes either value', async () => {
    process.env.VIMEO_CLIENT_ID = 'bare-id-canary';
    process.env.VIMEO_CLIENT_SECRET = 'bare-secret-canary';
    process.env.OD_VIMEO_CLIENT_ID = 'prefixed-id-canary';
    process.env.OD_VIMEO_CLIENT_SECRET = 'prefixed-secret-canary';

    const res = await jsonFetch(`${baseUrl}/api/video-import/providers`);
    const vimeo = res.body.providers.find((p: JsonObject) => p.provider === 'vimeo');
    expect(vimeo).toEqual({
      provider: 'vimeo',
      enabled: true,
      configured: true,
      connected: false,
      credentialSource: 'env',
    });
    expect(res.raw).not.toContain('bare-id-canary');
    expect(res.raw).not.toContain('bare-secret-canary');
    expect(res.raw).not.toContain('prefixed-id-canary');
    expect(res.raw).not.toContain('prefixed-secret-canary');
  });
});
