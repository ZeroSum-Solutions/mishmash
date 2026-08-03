// Unit specs for drafting storyboard shots from a free-text brief.
//
// No network: the provider call is exercised through the same injected
// `fetchImpl` seam apps/daemon/tests/finalize-design.test.ts uses, so these
// specs never reach a real text provider.
import { describe, it, expect, vi } from 'vitest';
import {
  buildDraftShotsPrompt,
  parseDraftedShots,
  draftShotsFromBrief,
  resolveDraftTextProvider,
  DRAFT_SHOT_COUNT_DEFAULT,
} from '../../src/storyboards/draft-from-brief.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** OpenAI-wire chat completion carrying `text` as the assistant message. */
function openAiCompletion(text: string): unknown {
  return { choices: [{ message: { content: text } }] };
}

describe('parseDraftedShots', () => {
  it('parses a fenced JSON payload into ordered shot specs', () => {
    const raw = ['```json', '{"shots":[', '{"title":"Opening","motionPrompt":"camera pushes in slowly"},', '{"title":"Reveal","motionPrompt":"tilt up to the logo"}', ']}', '```'].join('\n');

    const shots = parseDraftedShots(raw, 4);

    expect(shots).toEqual([
      { title: 'Opening', motionPrompt: 'camera pushes in slowly' },
      { title: 'Reveal', motionPrompt: 'tilt up to the logo' },
    ]);
  });

  it('accepts a bare array as well as a shots-wrapped object', () => {
    const shots = parseDraftedShots('[{"motionPrompt":"slow orbit around the product"}]', 4);

    expect(shots).toHaveLength(1);
    expect(shots[0]?.motionPrompt).toBe('slow orbit around the product');
  });

  it('caps the result at the requested shot count', () => {
    const raw = JSON.stringify({
      shots: [
        { motionPrompt: 'one' },
        { motionPrompt: 'two' },
        { motionPrompt: 'three' },
      ],
    });

    expect(parseDraftedShots(raw, 2)).toHaveLength(2);
  });

  it('drops entries with no usable motion prompt', () => {
    const raw = JSON.stringify({
      shots: [{ motionPrompt: '   ' }, { motionPrompt: 'dolly left past the shelf' }],
    });

    const shots = parseDraftedShots(raw, 4);

    expect(shots).toEqual([{ title: 'Shot 1', motionPrompt: 'dolly left past the shelf' }]);
  });

  it('throws when no shot survives validation', () => {
    expect(() => parseDraftedShots('{"shots":[]}', 4)).toThrow(/no usable shots/i);
  });

  it('throws when the payload is not JSON at all', () => {
    expect(() => parseDraftedShots('I cannot help with that.', 4)).toThrow(/could not be parsed/i);
  });
});

describe('buildDraftShotsPrompt', () => {
  it('asks for exactly the requested number of motion-only shots and embeds the brief', () => {
    const { systemPrompt, userPrompt } = buildDraftShotsPrompt('a calm ad for a ceramic mug', 3);

    expect(systemPrompt).toMatch(/motion/i);
    expect(systemPrompt).toMatch(/json/i);
    expect(userPrompt).toContain('a calm ad for a ceramic mug');
    expect(userPrompt).toContain('3');
  });
});

describe('draftShotsFromBrief', () => {
  const provider = {
    protocol: 'openai' as const,
    apiKey: 'test-key',
    baseUrl: 'https://provider.test',
    model: 'test-model',
  };

  it('returns the shots parsed out of the provider response', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(openAiCompletion(JSON.stringify({ shots: [{ title: 'Hero', motionPrompt: 'slow push in' }] }))),
    ) as unknown as typeof globalThis.fetch;

    const shots = await draftShotsFromBrief({
      brief: 'a calm ad for a ceramic mug',
      shotCount: 1,
      provider,
      fetchImpl,
    });

    expect(shots).toEqual([{ title: 'Hero', motionPrompt: 'slow push in' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up on a provider that never responds, instead of holding the request open', async () => {
    // A provider that accepts the request and then goes silent forever.
    const fetchImpl = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    ) as unknown as typeof globalThis.fetch;

    await expect(
      draftShotsFromBrief({ brief: 'brief', shotCount: 2, provider, fetchImpl, timeoutMs: 30 }),
    ).rejects.toThrow(/deadline/i);
  });

  it('stops the provider call when the caller aborts, e.g. the client disconnected', async () => {
    const caller = new AbortController();
    const fetchImpl = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    ) as unknown as typeof globalThis.fetch;

    const pending = draftShotsFromBrief({
      brief: 'brief',
      shotCount: 2,
      provider,
      fetchImpl,
      signal: caller.signal,
    });
    caller.abort();

    await expect(pending).rejects.toThrow();
  });

  it('propagates an upstream auth failure instead of returning empty shots', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'nope' }, 401)) as unknown as typeof globalThis.fetch;

    // BUG-10: a 401 is a credential rejection, so the propagated error
    // names the provider and points at the credential rather than just
    // restating the HTTP status (still asserted separately via `.status`).
    const pending = draftShotsFromBrief({ brief: 'brief', shotCount: 2, provider, fetchImpl });
    await expect(pending).rejects.toThrow(/credential/i);
    await expect(pending).rejects.toMatchObject({ status: 401, kind: 'invalid-credential' });
  });

  // Reviewer finding on BUG-10: `provider` here is protocol 'openai', which
  // is also what draft-from-brief's openrouter/minimax candidates use
  // (resolveDraftTextProvider's TEXT_PROVIDER_CANDIDATES table). OpenRouter
  // proxies heterogeneous backends and can pass an upstream error's body
  // text through verbatim — a 400 whose body happens to contain Google's
  // exact "API key not valid" phrase from a NON-Google provider must NOT be
  // misclassified as a credential rejection: that would override the
  // caller's real error with a generic "rejected the API key" message and
  // force a 401 the actual failure doesn't warrant.
  it('does not misclassify a non-Google 400 whose body contains Google\'s phrase as invalid-credential', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { error: { message: 'API key not valid. Please pass a valid API key.' } },
        400,
      ),
    ) as unknown as typeof globalThis.fetch;

    const pending = draftShotsFromBrief({ brief: 'brief', shotCount: 2, provider, fetchImpl });
    await expect(pending).rejects.toMatchObject({ status: 400, kind: 'upstream-error' });
    // Must NOT get the credential-rejection treatment.
    await expect(pending).rejects.not.toThrow(/rejected the API key/i);
  });
});

describe('resolveDraftTextProvider', () => {
  const noneConfigured = async () => ({ apiKey: '', baseUrl: '' });

  it('prefers an explicit caller-supplied provider over configured credentials', async () => {
    const lookup = vi.fn(noneConfigured);

    const resolved = await resolveDraftTextProvider(lookup, {
      protocol: 'anthropic',
      apiKey: 'caller-key',
      model: 'caller-model',
    });

    expect(resolved).toMatchObject({ protocol: 'anthropic', apiKey: 'caller-key', model: 'caller-model' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('returns the first configured provider in precedence order', async () => {
    const lookup = vi.fn(async (id: string) =>
      id === 'google' ? { apiKey: 'google-key', baseUrl: '' } : { apiKey: '', baseUrl: '' },
    );

    const resolved = await resolveDraftTextProvider(lookup);

    expect(resolved?.protocol).toBe('google');
    expect(resolved?.apiKey).toBe('google-key');
    expect(resolved?.model).toBeTruthy();
  });

  it('skips a configured provider whose model cannot be known without guessing', async () => {
    // openrouter has no repo-sanctioned default model slug, so a key alone is
    // not enough — it is only usable once a model is configured for it.
    const lookup = vi.fn(async (id: string) =>
      id === 'openrouter'
        ? { apiKey: 'openrouter-key', baseUrl: '' }
        : id === 'openai'
          ? { apiKey: 'openai-key', baseUrl: '' }
          : { apiKey: '', baseUrl: '' },
    );

    const resolved = await resolveDraftTextProvider(lookup);

    expect(resolved?.apiKey).toBe('openai-key');
  });

  it('uses a configured openrouter model when one is present', async () => {
    const lookup = vi.fn(async (id: string) =>
      id === 'openrouter'
        ? { apiKey: 'openrouter-key', baseUrl: '', model: 'vendor/some-model' }
        : { apiKey: '', baseUrl: '' },
    );

    const resolved = await resolveDraftTextProvider(lookup);

    expect(resolved).toMatchObject({ apiKey: 'openrouter-key', model: 'vendor/some-model' });
  });

  it('returns null when nothing is configured', async () => {
    expect(await resolveDraftTextProvider(noneConfigured)).toBeNull();
  });
});

describe('DRAFT_SHOT_COUNT_DEFAULT', () => {
  it('sits inside the storyboard-friendly range', () => {
    expect(DRAFT_SHOT_COUNT_DEFAULT).toBeGreaterThanOrEqual(2);
    expect(DRAFT_SHOT_COUNT_DEFAULT).toBeLessThanOrEqual(6);
  });
});
