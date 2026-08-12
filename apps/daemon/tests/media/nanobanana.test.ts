import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateMedia } from '../../src/media/index.js';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2uoAAAAASUVORK5CYII=';
const TEST_NANOBANANA_BASE_URL = 'https://nano-banana-gateway.example.test';

describe('nano-banana media generation', () => {
  let root: string;
  let projectRoot: string;
  let projectsRoot: string;
  const realFetch = globalThis.fetch;
  const originalMediaConfigDir = process.env.OD_MEDIA_CONFIG_DIR;
  const originalDataDir = process.env.OD_DATA_DIR;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-nanobanana-'));
    projectRoot = path.join(root, 'project-root');
    projectsRoot = path.join(projectRoot, '.od', 'projects');
    await mkdir(projectsRoot, { recursive: true });
    delete process.env.OD_MEDIA_CONFIG_DIR;
    delete process.env.OD_DATA_DIR;
    process.env.OD_NANOBANANA_API_KEY = 'nano-test-key';
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    delete process.env.OD_NANOBANANA_API_KEY;
    if (originalMediaConfigDir == null) {
      delete process.env.OD_MEDIA_CONFIG_DIR;
    } else {
      process.env.OD_MEDIA_CONFIG_DIR = originalMediaConfigDir;
    }
    if (originalDataDir == null) {
      delete process.env.OD_DATA_DIR;
    } else {
      process.env.OD_DATA_DIR = originalDataDir;
    }
    await rm(root, { recursive: true, force: true });
  });

  async function writeConfig(data: unknown) {
    const file = path.join(projectRoot, '.od', 'media-config.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data), 'utf8');
  }

  it('renders Nano Banana images through generateContent', async () => {
    await writeConfig({
      providers: {
        nanobanana: {
          baseUrl: TEST_NANOBANANA_BASE_URL,
          model: 'custom-nano-model',
        },
      },
    });

    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe(`${TEST_NANOBANANA_BASE_URL}/v1beta/models/custom-nano-model:generateContent`);
      expect(init?.method).toBe('POST');
      expect(init?.headers).toMatchObject({
        authorization: 'Bearer nano-test-key',
        'content-type': 'application/json',
      });
      expect(init?.headers).not.toHaveProperty('x-goog-api-key');
      expect(JSON.parse(String(init?.body))).toEqual({
        contents: [{ parts: [{ text: 'A watercolor shiba inu under cherry blossoms' }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: '16:9',
            imageSize: '1K',
          },
        },
      });
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: 'image/png',
                data: PNG_BASE64,
              },
            }],
          },
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateMedia({
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
      surface: 'image',
      model: 'gemini-3.1-flash-image-preview',
      prompt: 'A watercolor shiba inu under cherry blossoms',
      aspect: '16:9',
      output: 'nano.png',
    });

    expect(result.name).toBe('nano.png');
    expect(result.providerId).toBe('nanobanana');
    expect(result.providerNote).toContain('nano-banana/custom-nano-model');
    expect(result.providerNote).toContain('16:9');
    expect(result.providerNote).toContain('1K');

    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'nano.png'));
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('uses x-goog-api-key for the official Gemini endpoint', async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent');
      expect(init?.headers).toMatchObject({
        'content-type': 'application/json',
        'x-goog-api-key': 'nano-test-key',
      });
      expect(init?.headers).not.toHaveProperty('authorization');
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: 'image/png',
                data: PNG_BASE64,
              },
            }],
          },
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia({
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
      surface: 'image',
      model: 'gemini-3.1-flash-image-preview',
      prompt: 'A studio photo of a yellow banana on white seamless paper',
      aspect: '1:1',
      output: 'official.png',
    });

    expect(result.providerId).toBe('nanobanana');
    expect(result.name).toBe('official.png');
  });

  it('retries a rate-limited Nano Banana request with the same provider', async () => {
    await writeConfig({
      providers: {
        nanobanana: {
          baseUrl: TEST_NANOBANANA_BASE_URL,
          model: 'custom-nano-model',
        },
      },
    });
    const onProviderRequestSettled = vi.fn();

    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return new Response(JSON.stringify({
          error: { message: 'rate limited' },
        }), {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': '0',
          },
        });
      }
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: 'image/png',
                data: PNG_BASE64,
              },
            }],
          },
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia({
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
      surface: 'image',
      model: 'gemini-3.1-flash-image-preview',
      prompt: 'A neon city skyline',
      aspect: '1:1',
      output: 'retried.png',
      onProviderRequestSettled,
    });

    expect(result.providerId).toBe('nanobanana');
    expect(result.name).toBe('retried.png');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onProviderRequestSettled).toHaveBeenCalledOnce();
    expect(onProviderRequestSettled).toHaveBeenCalledWith({
      providerId: 'nanobanana',
      attemptCount: 2,
      retryCount: 1,
      initialResponseStatus: 429,
      responseStatus: 200,
      retryReason: 'rate_limit_429',
      retryAfterMs: 0,
      retryDelayMs: 0,
      retryFinalResult: 'success',
    });
  });

  it('surfaces upstream Nano Banana errors', async () => {
    await writeConfig({
      providers: {
        nanobanana: {
          baseUrl: TEST_NANOBANANA_BASE_URL,
        },
      },
    });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'quota exceeded' },
    }), {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': '0',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    let caught: unknown;
    try {
      await generateMedia({
        projectRoot,
        projectsRoot,
        projectId: 'project-1',
        surface: 'image',
        model: 'gemini-3.1-flash-image-preview',
        prompt: 'A neon city skyline',
        aspect: '1:1',
      });
    } catch (err) {
      caught = err;
    }
    const err = caught as Error & { status?: number; code?: string };
    expect(err.code).toBe('rate-limited');
    expect(err.status).toBe(429);
    expect(err.message).toMatch(/google gemini/i);
    expect(err.message).toMatch(/rate limit/i);
    expect(err.message).not.toContain('quota exceeded');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // BUG-10. Google answers an invalid API key with HTTP 400 (body: "API key
  // not valid. Please pass a valid API key."), not 401/403 — before the
  // provider-error taxonomy classified this call site, an invalid Nano
  // Banana credential surfaced as a bare "nano-banana image 400: {...}",
  // echoing the raw upstream body and giving no hint the fix is the stored
  // credential. A rejected credential must say it's the credential, and
  // must name the provider, whatever status carried it.
  it('names the credential when Google rejects the Nano Banana API key with its 400 quirk', async () => {
    await writeConfig({
      providers: {
        nanobanana: { baseUrl: TEST_NANOBANANA_BASE_URL },
      },
    });

    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
          details: [{ reason: 'API_KEY_INVALID' }],
        },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    let caught: unknown;
    try {
      await generateMedia({
        projectRoot,
        projectsRoot,
        projectId: 'project-1',
        surface: 'image',
        model: 'gemini-3.1-flash-image-preview',
        prompt: 'A neon city skyline',
        aspect: '1:1',
      });
      throw new Error('expected generateMedia to reject');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    const err = caught as Error & { status?: number; code?: string };
    expect(err.code).toBe('invalid-credential');
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/google gemini/i);
    expect(err.message).toMatch(/credential/i);
    // Never echo the raw upstream body back to the user.
    expect(err.message).not.toMatch(/API key not valid/i);
  });

  it('does not expose a malformed success response body in the user-facing parse error', async () => {
    await writeConfig({ providers: { nanobanana: { baseUrl: TEST_NANOBANANA_BASE_URL } } });
    const leakedKey = `AIza${'B'.repeat(35)}`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      `upstream debug x-goog-api-key: ${leakedKey}`,
      { status: 200, headers: { 'content-type': 'text/plain' } },
    )));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    let caught: unknown;
    try {
      await generateMedia({
        projectRoot,
        projectsRoot,
        projectId: 'project-1',
        surface: 'image',
        model: 'gemini-3.1-flash-image-preview',
        prompt: 'A neon city skyline',
        aspect: '1:1',
      });
    } catch (err) {
      caught = err;
    }

    const err = caught as Error;
    expect(err.message).toMatch(/google gemini/i);
    expect(err.message).toMatch(/non-json/i);
    expect(err.message).not.toContain('upstream debug');
    expect(err.message).not.toContain(leakedKey);
    const logged = warn.mock.calls
      .flat()
      .map((value) => typeof value === 'string' ? value : JSON.stringify(value))
      .join(' ');
    expect(logged).toContain('[REDACTED:api_key_header]');
    expect(logged).not.toContain(leakedKey);
    warn.mockRestore();
  });

  it('still reports a plain 400 that is NOT a credential rejection as an upstream failure', async () => {
    await writeConfig({
      providers: {
        nanobanana: { baseUrl: TEST_NANOBANANA_BASE_URL },
      },
    });

    const leakedKey = `AIza${'A'.repeat(35)}`;
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ error: { code: 400, message: `Unknown field: shot_count; x-goog-api-key: ${leakedKey}` } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    let caught: unknown;
    try {
      await generateMedia({
        projectRoot,
        projectsRoot,
        projectId: 'project-1',
        surface: 'image',
        model: 'gemini-3.1-flash-image-preview',
        prompt: 'A neon city skyline',
        aspect: '1:1',
      });
      throw new Error('expected generateMedia to reject');
    } catch (err) {
      caught = err;
    }

    const err = caught as Error & { status?: number; code?: string };
    expect(err.code).toBe('upstream-error');
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/google gemini/i);
    expect(err.message).toMatch(/status 400/i);
    expect(err.message).not.toContain('Unknown field');
    expect(err.message).not.toContain(leakedKey);
    const logged = warn.mock.calls
      .flat()
      .map((value) => typeof value === 'string' ? value : JSON.stringify(value))
      .join(' ');
    expect(logged).toContain('[REDACTED:api_key_header]');
    expect(logged).not.toContain(leakedKey);
    warn.mockRestore();
  });
});
