// Unit tests for the MiniMax Music 3.0 media provider (renderMinimaxMusic in
// media/index.ts) — a synchronous text-to-music endpoint on the same host as
// MiniMax's image generation API.
//
// Docs verified 2026-08-01 against official MiniMax API docs:
//   Guide: https://platform.minimax.io/docs/guides/music-generation
//   Reference: https://platform.minimax.io/docs/api-reference/music-generation
//
//   POST https://api.minimax.io/v1/music_generation
//        Authorization: Bearer <api key>
//        { model, prompt, lyrics?, is_instrumental?, lyrics_optimizer?,
//          output_format: 'hex'|'url', audio_setting: { sample_rate, bitrate, format } }
//     -> { data: { audio: "<hex>", status }, trace_id, extra_info: { music_duration, ... },
//          base_resp: { status_code, status_msg } }
//
// This mirrors the existing renderMinimaxTTS envelope exactly (hex-encoded
// audio under data.audio, wrapped in the same base_resp status envelope) —
// same provider, same failure-shape conventions.
//
// THE TRAP this file specifically guards against: the pre-existing minimax +
// audio dispatch branch in media/index.ts had no ctx.audioKind check, so a
// music request could silently fall through to renderMinimaxTTS (speech)
// instead of the new music renderer. The regression tests below assert on
// the exact outbound URL to prove music and speech route to their own
// distinct MiniMax endpoints.
//
// These tests mock the global `fetch` end-to-end through generateMedia() —
// no real network calls, no real API keys (fake key strings only).

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateMedia } from '../../src/media/index.js';

const MUSIC_URL = 'https://api.minimax.io/v1/music_generation';
const TTS_URL = 'https://api.minimaxi.chat/v1/t2a_v2';

const FAKE_MP3_HEX = Buffer.from([
  0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x6d, 0x75, 0x73, 0x69, 0x63,
]).toString('hex');

const ENV_KEYS_TO_ISOLATE = [
  'OD_MINIMAX_API_KEY',
  'MINIMAX_API_KEY',
  'OD_MINIMAX_MUSIC_BASE_URL',
  'OD_MEDIA_CONFIG_DIR',
  'OD_DATA_DIR',
  'OD_MEDIA_MODEL_ALIASES',
];

describe('minimax music media provider', () => {
  let root: string;
  let projectRoot: string;
  let projectsRoot: string;
  const realFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries(ENV_KEYS_TO_ISOLATE.map((key) => [key, process.env[key]]));

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-minimax-music-'));
    projectRoot = path.join(root, 'project-root');
    projectsRoot = path.join(projectRoot, '.od', 'projects');
    await mkdir(projectsRoot, { recursive: true });
    for (const key of ENV_KEYS_TO_ISOLATE) delete process.env[key];
    process.env.MINIMAX_API_KEY = 'minimax-test-fake-key-1234';
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS_TO_ISOLATE) {
      if (originalEnv[key] == null) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    await rm(root, { recursive: true, force: true });
  });

  function jsonResp(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  function musicSuccessResp(extra: Record<string, unknown> = {}) {
    return jsonResp({
      data: { audio: FAKE_MP3_HEX, status: 2 },
      trace_id: 'trace-music-1',
      extra_info: { music_duration: 25364, music_sample_rate: 44100, music_channel: 2, bitrate: 256000, music_size: 813651, ...extra },
      analysis_info: null,
      base_resp: { status_code: 0, status_msg: 'success' },
    });
  }

  function ttsSuccessResp() {
    return jsonResp({
      data: { audio: FAKE_MP3_HEX },
      extra_info: { audio_length: 2500 },
      base_resp: { status_code: 0, status_msg: 'success' },
    });
  }

  type GenerateMediaArgs = Parameters<typeof generateMedia>[0];

  function baseArgs(
    overrides: Omit<GenerateMediaArgs, 'projectRoot' | 'projectsRoot' | 'projectId'>,
  ): GenerateMediaArgs {
    return {
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
      ...overrides,
    };
  }

  // ─── happy path: outbound request shape + bytes on disk ────────────

  it('renderMinimaxMusic: POSTs Bearer auth + music-3.0 body to /v1/music_generation, decodes hex audio, writes real bytes to disk', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(musicSuccessResp());
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-music',
      audioKind: 'music',
      prompt: 'Indie folk, melancholic, introspective, longing, solitary walk, coffee shop',
      output: 'theme.mp3',
    }));

    expect(result.providerId).toBe('minimax');
    expect(result.providerNote).toContain('minimax/music-3.0');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(MUSIC_URL);
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>).authorization).toBe('Bearer minimax-test-fake-key-1234');
    expect((opts.headers as Record<string, string>)['content-type']).toBe('application/json');

    const body = JSON.parse(opts.body);
    expect(body.model).toBe('music-3.0');
    expect(body.prompt).toBe('Indie folk, melancholic, introspective, longing, solitary walk, coffee shop');
    // url links expire after 24h per docs; hex persists at write time.
    expect(body.output_format).toBe('hex');
    expect(body.audio_setting).toMatchObject({ format: 'mp3' });

    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'theme.mp3'));
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.toString('hex')).toBe(FAKE_MP3_HEX);
  });

  // ─── base_resp logical-failure envelope ─────────────────────────────

  it('renderMinimaxMusic: base_resp.status_code !== 0 throws with the upstream status_msg (logical failure despite HTTP 200)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResp({
      base_resp: { status_code: 1004, status_msg: 'authentication failed' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-music',
      audioKind: 'music',
      prompt: 'anything',
      output: 'fail.mp3',
    }))).rejects.toThrow(/authentication failed/);
  });

  // ─── missing/empty audio in response ────────────────────────────────

  it('renderMinimaxMusic: success envelope with missing data.audio throws a clear error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResp({
      data: { status: 2 },
      base_resp: { status_code: 0, status_msg: 'success' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-music',
      audioKind: 'music',
      prompt: 'anything',
      output: 'noaudio.mp3',
    }))).rejects.toThrow(/data\.audio/);
  });

  // ─── malformed hex: non-hex characters bypass the odd-length check ───

  it('renderMinimaxMusic: rejects a hex payload with non-hex characters despite passing the even-length check', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResp({
      // '00zz' has even length (4 chars) so it sails past the odd-length
      // guard, but 'zz' is not valid hex. Buffer.from('00zz', 'hex') stops
      // decoding at the first invalid character and silently returns a
      // single 0x00 byte instead of throwing — one non-zero-length byte, so
      // the zero-byte guard doesn't catch it either. Without an explicit
      // charset check this writes corrupted audio while reporting success.
      data: { audio: '00zz' },
      base_resp: { status_code: 0, status_msg: 'success' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-music',
      audioKind: 'music',
      prompt: 'malformed-nonhex',
      output: 'malformed-nonhex.mp3',
    }))).rejects.toThrow(/malformed hex/);
  });

  // ─── HTTP-level failure ──────────────────────────────────────────────

  it('renderMinimaxMusic: HTTP error (non-ok) surfaces the status and body', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('service unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-music',
      audioKind: 'music',
      prompt: 'anything',
      output: 'http-503.mp3',
    }))).rejects.toThrow(/minimax music 503/);
  });

  // ─── credential guardrail ─────────────────────────────────────────────

  it('renderMinimaxMusic: no configured MiniMax API key throws a clear, actionable error (no network call)', async () => {
    delete process.env.MINIMAX_API_KEY;
    delete process.env.OD_MINIMAX_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-music',
      audioKind: 'music',
      prompt: 'anything',
      output: 'nokey.mp3',
    }))).rejects.toThrow(/MiniMax API key|OD_MINIMAX_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ─── THE TRAP: anti-regression — music must never reach the TTS renderer ──

  it('REGRESSION: minimax-music (audio · music) hits /v1/music_generation, never the TTS /t2a_v2 endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(musicSuccessResp());
    vi.stubGlobal('fetch', fetchMock);

    await generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-music',
      audioKind: 'music',
      prompt: 'A modern melodic trap track',
      output: 'trap.mp3',
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(MUSIC_URL);
    expect(String(url)).not.toBe(TTS_URL);
    expect(String(url)).not.toContain('t2a_v2');
  });

  // ─── companion regression: narrowing the dispatch branch must not break speech ──

  it('a TTS model requested as music is rejected by the catalog before dispatch, never silently rendered as music', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // audioKind is omitted, which generateMedia resolves to 'music'. The
    // catalog gate must reject the speech-only model outright rather than let
    // it reach either MiniMax renderer.
    await expect(generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-tts',
      prompt: 'Hello from MiniMax TTS.',
      output: 'speech-default-kind.mp3',
    }))).rejects.toThrow(/not registered for surface "audio · music"/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('REGRESSION: minimax-tts (audio · speech) still hits /t2a_v2 — narrowing the minimax audio branch to speech did not break the existing TTS lane', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ttsSuccessResp());
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-tts',
      audioKind: 'speech',
      prompt: 'Hello from MiniMax TTS.',
      output: 'speech.mp3',
    }));

    expect(result.providerId).toBe('minimax');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(TTS_URL);
    expect(String(url)).not.toBe(MUSIC_URL);

    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'speech.mp3'));
    expect(bytes.length).toBeGreaterThan(0);
  });
});
