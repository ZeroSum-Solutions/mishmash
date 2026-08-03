import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { registerDesignBrowserRoutes } from '../src/routes/design-browser.js';

type FetchStub = (url: string, init?: RequestInit) => Promise<Response>;

function responseWithHeaders(headers: Record<string, string>): Response {
  return new Response(null, { status: 200, headers });
}

async function bootApp(fetchExternal: FetchStub) {
  const app = express();
  app.use(express.json());
  registerDesignBrowserRoutes(app, { fetchExternal });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    check: async (url: unknown) => {
      const resp = await fetch(`http://127.0.0.1:${port}/api/design-browser/frame-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      return { status: resp.status, json: await resp.json().catch(() => null) };
    },
  };
}

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ),
  );
});

async function boot(fetchExternal: FetchStub) {
  const booted = await bootApp(fetchExternal);
  servers.push(booted.server);
  return booted;
}

describe('POST /api/design-browser/frame-check', () => {
  it('reports X-Frame-Options: DENY as blocked', async () => {
    const { check } = await boot(async () => responseWithHeaders({ 'x-frame-options': 'DENY' }));
    const { status, json } = await check('https://blocked.example');
    expect(status).toBe(200);
    expect(json).toMatchObject({ verdict: 'blocked', blockedBy: 'x-frame-options' });
  });

  it('reports X-Frame-Options: SAMEORIGIN as blocked (the studio is never same-origin with the target)', async () => {
    const { check } = await boot(async () => responseWithHeaders({ 'x-frame-options': 'sameorigin' }));
    const { json } = await check('https://gsap.example');
    expect(json).toMatchObject({ verdict: 'blocked', blockedBy: 'x-frame-options' });
  });

  it('reports a response without framing headers as embeddable', async () => {
    const { check } = await boot(async () => responseWithHeaders({}));
    const { json } = await check('https://open.example');
    expect(json).toMatchObject({ verdict: 'embeddable' });
  });

  it('reports CSP frame-ancestors none as blocked', async () => {
    const { check } = await boot(async () =>
      responseWithHeaders({ 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" }));
    const { json } = await check('https://csp.example');
    expect(json).toMatchObject({ verdict: 'blocked', blockedBy: 'csp-frame-ancestors' });
  });

  it('lets CSP frame-ancestors * override an X-Frame-Options block (browser precedence)', async () => {
    const { check } = await boot(async () =>
      responseWithHeaders({
        'x-frame-options': 'DENY',
        'content-security-policy': 'frame-ancestors *',
      }));
    const { json } = await check('https://permissive.example');
    expect(json).toMatchObject({ verdict: 'embeddable' });
  });

  it('skips loopback targets without fetching (local dev servers embed as-is)', async () => {
    const fetchExternal = vi.fn<FetchStub>(async () => responseWithHeaders({}));
    const { check } = await boot(fetchExternal);
    const { json } = await check('http://127.0.0.1:3000/');
    expect(json).toMatchObject({ verdict: 'skipped-local' });
    expect(fetchExternal).not.toHaveBeenCalled();
  });

  it('rejects an invalid URL with 400', async () => {
    const { check } = await boot(async () => responseWithHeaders({}));
    const { status } = await check('not a url');
    expect(status).toBe(400);
  });

  it('rejects a missing url body with 400', async () => {
    const { check } = await boot(async () => responseWithHeaders({}));
    const { status } = await check(undefined);
    expect(status).toBe(400);
  });

  it('reports fetch failures as unknown so the panel can fall back to embedding', async () => {
    const { check } = await boot(async () => {
      throw new Error('boom');
    });
    const { json } = await check('https://down.example');
    expect(json).toMatchObject({ verdict: 'unknown', reason: 'fetch-failed' });
  });
});
