// Real-server route tests for the storyboard style-reference capability:
// POST/DELETE /api/storyboards/:id/style-reference (extract a style profile
// from pasted DESIGN.md via the brand engine's design-md leg) and the
// prompt-steering invariant — once a style reference is set, every frame and
// shot-render dispatch carries it to the media provider, while the raw user
// prompt always leads.
//
// Same boot pattern as routes.test.ts (startServer, port:0). No live provider
// call can happen: the operator's provider env keys are stripped and
// `globalThis.fetch` is stubbed so only the in-process test server passes
// through — provider-bound requests are captured for assertion and answered
// with a canned failure (the dispatch is async fire-and-forget; the capture is
// the observable, not the task outcome). Same network-boundary idiom as
// draft-route.test.ts.

import type http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startServer } from '../../src/server.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2uoAAAAASUVORK5CYII=';

/** Env vars that could hand the media layer a usable credential. */
const MEDIA_PROVIDER_ENV_KEYS = [
  'OD_OPENROUTER_API_KEY',
  'OPENROUTER_API_KEY',
  'OD_OPENAI_API_KEY',
  'OPENAI_API_KEY',
  'OD_GOOGLE_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'ARK_API_KEY',
  'OD_ARK_API_KEY',
  'XAI_API_KEY',
  'OD_XAI_API_KEY',
  'OD_MINIMAX_API_KEY',
  'MINIMAX_API_KEY',
];

const DESIGN_MD = `---
name: Heritage
colors:
  background: "#f6f1e7"
  foreground: "#1c1a17"
  accent: "#8a5a2b"
typography:
  display: "Fraunces"
  body: "Source Serif Pro"
---

# Heritage

## Overview
A warm editorial identity for a heritage furniture maker. Calm, tactile, confident.
`;

describe('storyboard style reference', () => {
  let server: http.Server | null = null;
  let base: string;
  let savedEnv: Record<string, string | undefined> = {};
  /** JSON bodies of every captured provider-bound (non-test-server) request. */
  let providerBodies: unknown[] = [];

  beforeEach(() => {
    savedEnv = {};
    for (const key of MEDIA_PROVIDER_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    providerBodies = [];

    // Network boundary: the in-process test server passes through; anything
    // else is captured and answered with a canned 500 so the async media task
    // fails fast without a real provider round-trip. A credential that
    // resolves unexpectedly therefore surfaces as a captured request, never a
    // billable call.
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : String((input as { url?: unknown })?.url ?? input);
      if (base && url.startsWith(base)) {
        return realFetch(input as Parameters<typeof globalThis.fetch>[0], init);
      }
      if (typeof init?.body === 'string') {
        try {
          providerBodies.push(JSON.parse(init.body));
        } catch {
          providerBodies.push(init.body);
        }
      }
      return new Response(JSON.stringify({ error: 'canned test failure' }), { status: 500 });
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
  });

  async function boot() {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;
    base = started.url;
  }

  async function createStoryboard(title = 'Styled storyboard') {
    const resp = await fetch(`${base}/api/storyboards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    expect(resp.status).toBe(201);
    return ((await resp.json()) as { storyboard: any }).storyboard;
  }

  async function setStyleReference(id: string, designMd: string) {
    return fetch(`${base}/api/storyboards/${id}/style-reference`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ designMd }),
    });
  }

  it('POST extracts a style profile from pasted DESIGN.md and persists it', async () => {
    await boot();
    const created = await createStoryboard();

    const resp = await setStyleReference(created.id, DESIGN_MD);
    expect(resp.status).toBe(200);
    const { storyboard } = (await resp.json()) as { storyboard: any };
    expect(storyboard.styleReference).toBeTruthy();
    expect(storyboard.styleReference.source).toBe('design-md');
    expect(storyboard.styleReference.brand.name).toBe('Heritage');
    const hexes = storyboard.styleReference.brand.colors.map((c: any) => c.hex);
    expect(hexes).toContain('#8a5a2b');
    expect(storyboard.styleReference.brand.typography.display.family).toBe('Fraunces');

    // Survives a read: the stored doc carries it back on GET.
    const getResp = await fetch(`${base}/api/storyboards/${created.id}`);
    expect(getResp.status).toBe(200);
    const fetched = ((await getResp.json()) as any).storyboard;
    expect(fetched.styleReference?.brand?.name).toBe('Heritage');
  });

  it('POST rejects an empty or non-string designMd with 400', async () => {
    await boot();
    const created = await createStoryboard();

    for (const designMd of ['', '   \n  ', 42 as unknown as string]) {
      const resp = await fetch(`${base}/api/storyboards/${created.id}/style-reference`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ designMd }),
      });
      expect(resp.status).toBe(400);
    }

    const getResp = await fetch(`${base}/api/storyboards/${created.id}`);
    expect(((await getResp.json()) as any).storyboard.styleReference).toBeUndefined();
  });

  it('POST rejects a stale expectedUpdatedAt with 409 and the current doc', async () => {
    await boot();
    const created = await createStoryboard();

    const resp = await fetch(`${base}/api/storyboards/${created.id}/style-reference`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ designMd: DESIGN_MD, expectedUpdatedAt: 'not-the-current-stamp' }),
    });
    expect(resp.status).toBe(409);
    const body = (await resp.json()) as any;
    expect(body.error).toBe('storyboard changed');
    expect(body.storyboard.id).toBe(created.id);
    expect(body.storyboard.styleReference).toBeUndefined();
  });

  it('DELETE clears the style reference', async () => {
    await boot();
    const created = await createStoryboard();
    expect((await setStyleReference(created.id, DESIGN_MD)).status).toBe(200);

    const delResp = await fetch(`${base}/api/storyboards/${created.id}/style-reference`, {
      method: 'DELETE',
    });
    expect(delResp.status).toBe(200);
    const { storyboard } = (await delResp.json()) as { storyboard: any };
    expect(storyboard.styleReference).toBeUndefined();

    const getResp = await fetch(`${base}/api/storyboards/${created.id}`);
    expect(((await getResp.json()) as any).storyboard.styleReference).toBeUndefined();
  });

  it('DELETE rejects a stale expectedUpdatedAt with 409 and keeps the reference', async () => {
    await boot();
    const created = await createStoryboard();
    expect((await setStyleReference(created.id, DESIGN_MD)).status).toBe(200);

    const delResp = await fetch(`${base}/api/storyboards/${created.id}/style-reference`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedUpdatedAt: 'not-the-current-stamp' }),
    });
    expect(delResp.status).toBe(409);
    const body = (await delResp.json()) as any;
    expect(body.error).toBe('storyboard changed');
    expect(body.storyboard.styleReference?.brand?.name).toBe('Heritage');

    const getResp = await fetch(`${base}/api/storyboards/${created.id}`);
    expect(((await getResp.json()) as any).storyboard.styleReference?.brand?.name).toBe('Heritage');
  });

  it('frame generation carries the style reference to the provider, raw prompt leading', async () => {
    await boot();
    process.env.OD_OPENROUTER_API_KEY = 'sk-or-test-key-1234';
    const created = await createStoryboard();
    expect((await setStyleReference(created.id, DESIGN_MD)).status).toBe(200);

    const resp = await fetch(`${base}/api/storyboards/${created.id}/frames`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'A lighthouse at dusk',
        model: 'openrouter/black-forest-labs/flux-1.1-pro',
      }),
    });
    expect(resp.status).toBe(202);

    await vi.waitFor(() => expect(providerBodies.length).toBeGreaterThan(0), { timeout: 5000 });
    const submit = providerBodies[0] as { messages?: Array<{ content?: string }> };
    const content = submit.messages?.[0]?.content ?? '';
    expect(content.startsWith('A lighthouse at dusk')).toBe(true);
    expect(content).toContain('#8a5a2b');
    expect(content).toContain('Fraunces');
    expect(content).toContain('Heritage');
  });

  it('frame generation without a style reference passes the prompt through unchanged', async () => {
    await boot();
    process.env.OD_OPENROUTER_API_KEY = 'sk-or-test-key-1234';
    const created = await createStoryboard();

    const resp = await fetch(`${base}/api/storyboards/${created.id}/frames`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'A lighthouse at dusk',
        model: 'openrouter/black-forest-labs/flux-1.1-pro',
      }),
    });
    expect(resp.status).toBe(202);

    await vi.waitFor(() => expect(providerBodies.length).toBeGreaterThan(0), { timeout: 5000 });
    const submit = providerBodies[0] as { messages?: Array<{ content?: string }> };
    expect(submit.messages?.[0]?.content).toBe('A lighthouse at dusk');
  });

  it('shot render carries the style reference to the provider alongside the motion prompt', async () => {
    await boot();
    process.env.OD_OPENROUTER_API_KEY = 'sk-or-test-key-1234';
    const created = await createStoryboard();
    expect((await setStyleReference(created.id, DESIGN_MD)).status).toBe(200);

    const uploadResp = await fetch(`${base}/api/storyboards/${created.id}/uploads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataUrl: `data:image/png;base64,${PNG_BASE64}` }),
    });
    expect(uploadResp.status).toBe(201);
    const { path: framePath } = (await uploadResp.json()) as { path: string };

    const patchResp = await fetch(`${base}/api/storyboards/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shots: [
          {
            id: 'shot-1',
            order: 0,
            motionPrompt: 'the camera pans slowly to the right',
            model: 'openrouter/bytedance/seedance-2.0:1080p',
            resolution: '1080p',
            durationSec: 5,
            status: 'draft',
            startFrame: { path: framePath, origin: 'uploaded' },
          },
        ],
      }),
    });
    expect(patchResp.status).toBe(200);

    const renderResp = await fetch(
      `${base}/api/storyboards/${created.id}/shots/shot-1/render`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    );
    expect(renderResp.status).toBe(202);

    await vi.waitFor(() => expect(providerBodies.length).toBeGreaterThan(0), { timeout: 5000 });
    const submit = providerBodies.find(
      (body): body is { prompt: string } =>
        typeof (body as { prompt?: unknown })?.prompt === 'string',
    );
    expect(submit).toBeTruthy();
    expect(submit!.prompt.startsWith('the camera pans slowly to the right')).toBe(true);
    expect(submit!.prompt).toContain('#8a5a2b');
    expect(submit!.prompt).toContain('Heritage');
  });
});
