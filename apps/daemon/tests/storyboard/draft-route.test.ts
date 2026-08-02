// Real-server route tests for POST /api/storyboards/:id/draft-shots.
//
// No live provider call happens here. Every case is a validation or
// concurrency path that the route must reject BEFORE it resolves a text
// provider, plus one case asserting the "nothing configured" failure. The
// operator's real API keys are removed from process.env for the duration of
// this suite (same ENV isolation idiom as tests/media/kie.test.ts) so a
// machine that happens to export OPENROUTER_API_KEY cannot turn these specs
// into billable network calls.
import type http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STORYBOARD_DRAFT_BRIEF_MAX_CHARS,
  STORYBOARD_DRAFT_SHOT_COUNT_MAX,
} from '@open-design/contracts';
import { startServer } from '../../src/server.js';

/** Every env var that could hand the route a usable text credential. */
const TEXT_PROVIDER_ENV_KEYS = [
  'OD_OPENROUTER_API_KEY',
  'OPENROUTER_API_KEY',
  'OD_GOOGLE_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'OD_OPENAI_API_KEY',
  'OPENAI_API_KEY',
  'AZURE_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'OD_MINIMAX_API_KEY',
  'MINIMAX_API_KEY',
];

describe('POST /api/storyboards/:id/draft-shots', () => {
  let server: http.Server | null = null;
  let base: string;
  let savedEnv: Record<string, string | undefined> = {};

  /**
   * Set by a test that intends an outbound provider call, and used to answer
   * it with a canned response. Left null, ANY outbound request throws.
   */
  let outboundResponder: ((url: string, init?: RequestInit) => Promise<Response>) | null = null;
  let outboundCalls = 0;

  beforeEach(() => {
    savedEnv = {};
    for (const key of TEXT_PROVIDER_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    outboundResponder = null;
    outboundCalls = 0;

    // Deleting env vars alone does NOT guarantee no live provider call:
    // resolveProviderConfig also consults stored config and, for the openai
    // candidate, an OAuth auth file under the real home directory — neither
    // of which the test data-dir isolation covers. So the guarantee is
    // enforced at the network boundary instead: requests to the in-process
    // test server pass through, and every other destination throws unless a
    // test explicitly opted in. A credential that resolves anyway therefore
    // fails the test loudly rather than billing the operator.
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : String((input as { url?: unknown })?.url ?? input);
      // Only the in-process test server itself is allowed through — not
      // loopback in general, since a loopback destination is exactly what an
      // SSRF case needs to be prevented from reaching.
      if (base && url.startsWith(base)) {
        return realFetch(input as Parameters<typeof globalThis.fetch>[0], init);
      }
      outboundCalls += 1;
      if (outboundResponder) return outboundResponder(url, init);
      throw new Error(`blocked unexpected outbound request in test: ${url}`);
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

  async function createStoryboard(title = 'Draft test storyboard') {
    const resp = await fetch(`${base}/api/storyboards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    expect(resp.status).toBe(201);
    const data = (await resp.json()) as { storyboard: { id: string; updatedAt: string } };
    return data.storyboard;
  }

  async function draft(id: string, body: unknown) {
    return fetch(`${base}/api/storyboards/${id}/draft-shots`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('404s for a storyboard that does not exist', async () => {
    await boot();
    const resp = await draft('does-not-exist', { brief: 'a calm ad for a ceramic mug' });
    expect(resp.status).toBe(404);
  });

  it('400s when the brief is missing', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await draft(created.id, {});
    expect(resp.status).toBe(400);
  });

  it('400s when the brief is only whitespace', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await draft(created.id, { brief: '   \n  ' });
    expect(resp.status).toBe(400);
  });

  it('400s when the brief exceeds the shared maximum length', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await draft(created.id, { brief: 'x'.repeat(STORYBOARD_DRAFT_BRIEF_MAX_CHARS + 1) });
    expect(resp.status).toBe(400);
  });

  it('400s when the shot count is above the shared maximum', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await draft(created.id, {
      brief: 'a calm ad for a ceramic mug',
      shotCount: STORYBOARD_DRAFT_SHOT_COUNT_MAX + 1,
    });
    expect(resp.status).toBe(400);
  });

  it('400s when the shot count is below the shared minimum', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await draft(created.id, { brief: 'a calm ad for a ceramic mug', shotCount: 0 });
    expect(resp.status).toBe(400);
  });

  it('409s when expectedUpdatedAt is stale, without calling a provider', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await draft(created.id, {
      brief: 'a calm ad for a ceramic mug',
      expectedUpdatedAt: '1999-01-01T00:00:00.000Z',
    });
    expect(resp.status).toBe(409);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe('storyboard changed');
  });

  it('fails with an actionable NO_TEXT_PROVIDER error when no text provider is configured', async () => {
    await boot();
    const created = await createStoryboard();
    const resp = await draft(created.id, { brief: 'a calm ad for a ceramic mug' });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(JSON.stringify(body)).toContain('NO_TEXT_PROVIDER');
    expect(outboundCalls).toBe(0);
  });

  // --- caller-supplied provider (BYOK) -------------------------------------

  /** A text provider the fetch guard will answer, with no baseUrl to validate. */
  const BYOK = { protocol: 'openai', apiKey: 'test-key', model: 'test-model' };

  function completionOf(shots: Array<{ title?: string; motionPrompt: string }>): Response {
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify({ shots }) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  it('refuses a caller-supplied baseUrl pointing into private address space, before any request leaves', async () => {
    await boot();
    const created = await createStoryboard();

    // Loopback is deliberately permitted by this repo's guard — local model
    // servers are legitimate provider endpoints — so the case that must be
    // blocked is private (RFC1918) address space.
    const resp = await draft(created.id, {
      brief: 'a calm ad for a ceramic mug',
      textProvider: { ...BYOK, baseUrl: 'http://10.0.0.1/v1' },
    });

    expect([400, 403]).toContain(resp.status);
    expect(outboundCalls).toBe(0);
  });

  it('appends the drafted shots to the storyboard and persists them', async () => {
    await boot();
    const created = await createStoryboard();
    outboundResponder = async () =>
      completionOf([
        { title: 'Opening', motionPrompt: 'camera pushes in slowly' },
        { title: 'Reveal', motionPrompt: 'tilt up to the logo' },
      ]);

    const resp = await draft(created.id, {
      brief: 'a calm ad for a ceramic mug',
      shotCount: 2,
      textProvider: BYOK,
    });

    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      drafted: number;
      storyboard: { shots: Array<{ order: number; status: string; motionPrompt: string; title?: string; model: string }> };
    };
    expect(body.drafted).toBe(2);
    expect(body.storyboard.shots).toHaveLength(2);
    expect(body.storyboard.shots[0]?.order).toBe(0);
    expect(body.storyboard.shots[1]?.order).toBe(1);
    expect(body.storyboard.shots[0]?.status).toBe('draft');
    expect(body.storyboard.shots[0]?.motionPrompt).toBe('camera pushes in slowly');
    expect(body.storyboard.shots[0]?.title).toBe('Opening');
    expect(body.storyboard.shots[0]?.model).toBeTruthy();

    // The response is not enough — the shots must be on disk.
    const stored = await fetch(`${base}/api/storyboards/${created.id}`);
    const storedBody = (await stored.json()) as { storyboard: { shots: unknown[] } };
    expect(storedBody.storyboard.shots).toHaveLength(2);
  });

  it('does not discard a write that lands while the provider call is in flight', async () => {
    await boot();
    const created = await createStoryboard();

    let releaseProvider: () => void = () => {};
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    let providerCallStarted = false;
    outboundResponder = async () => {
      providerCallStarted = true;
      await providerGate;
      return completionOf([{ title: 'Opening', motionPrompt: 'camera pushes in slowly' }]);
    };

    // No expectedUpdatedAt — this is the CLI's shape, which has no
    // optimistic-concurrency token at all.
    const draftPromise = draft(created.id, { brief: 'a calm ad', shotCount: 1, textProvider: BYOK });

    while (!providerCallStarted) await new Promise((r) => setTimeout(r, 5));

    // A concurrent edit lands and commits while the draft is still waiting.
    const patched = await fetch(`${base}/api/storyboards/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'renamed mid-draft' }),
    });
    expect(patched.status).toBe(200);

    releaseProvider();
    const resp = await draftPromise;
    expect(resp.status).toBe(200);

    const body = (await resp.json()) as { storyboard: { title: string; shots: unknown[] } };
    // Both survive: the concurrent rename is preserved AND the draft applied.
    expect(body.storyboard.title).toBe('renamed mid-draft');
    expect(body.storyboard.shots).toHaveLength(1);
  });
});
