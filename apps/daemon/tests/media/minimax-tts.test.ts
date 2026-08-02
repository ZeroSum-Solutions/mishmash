// Unit tests for the MiniMax Speech-02 TTS media provider (renderMinimaxTTS in
// media/index.ts) — the legacy synchronous text-to-speech endpoint that
// predates the hardened MiniMax Music 3.0 renderer.
//
// Docs: https://platform.minimaxi.com — POST /t2a_v2
//        Authorization: Bearer <api key>
//        { model, text, stream: false, language_boost?, voice_setting, audio_setting }
//     -> { data: { audio: "<hex>" }, extra_info: { audio_length, ... },
//          base_resp: { status_code, status_msg } }
//
// This mirrors minimax-music.test.ts's setup, mocking seam, and naming style
// (same provider, same env isolation list, same base_resp envelope shape) —
// see that file for the sibling music renderer's tests.
//
// Three specs below are RED-FIRST regression coverage for defects an audit
// found in this renderer that the music renderer already guards against:
//   1. no response-size bound on the hex -> Buffer decode
//   2. no odd-length/malformed hex rejection (Buffer.from silently truncates)
//   3. unbounded provider text interpolated into the base_resp logical-
//      failure error (persisted into the task's error field)
// Everything else in this file is ordinary failure-branch coverage for
// existing (already-correct) behavior, mirroring grok-tts.test.ts /
// senseaudio.test.ts / elevenlabs.test.ts for their own providers.
//
// These tests mock the global `fetch` end-to-end through generateMedia() —
// no real network calls, no real API keys (fake key strings only).

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateMedia } from '../../src/media/index.js';

const TTS_URL = 'https://api.minimaxi.chat/v1/t2a_v2';

// Mirrors MINIMAX_TTS_MAX_AUDIO_BYTES in src/media/index.ts (not exported;
// kept as a literal here, same as the production constant's own derivation).
const AUDIO_BYTE_CEILING = 64 * 1024 * 1024;

const FAKE_MP3_HEX = Buffer.from([
  0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x74, 0x74, 0x73,
]).toString('hex');

const ENV_KEYS_TO_ISOLATE = [
  'OD_MINIMAX_API_KEY',
  'MINIMAX_API_KEY',
  'OD_MEDIA_CONFIG_DIR',
  'OD_DATA_DIR',
  'OD_MEDIA_MODEL_ALIASES',
];

describe('minimax tts media provider', () => {
  let root: string;
  let projectRoot: string;
  let projectsRoot: string;
  const realFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries(ENV_KEYS_TO_ISOLATE.map((key) => [key, process.env[key]]));

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-minimax-tts-'));
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

  function ttsSuccessResp(extra: Record<string, unknown> = {}) {
    return jsonResp({
      data: { audio: FAKE_MP3_HEX },
      extra_info: { audio_length: 2500, ...extra },
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

  it('renderMinimaxTTS: POSTs Bearer auth + speech-02-turbo body to /t2a_v2, decodes hex audio, writes real bytes to disk', async () => {
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
    expect(result.providerNote).toContain('minimax/speech-02-turbo');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(TTS_URL);
    expect(opts.method).toBe('POST');
    expect((opts.headers as Record<string, string>).authorization).toBe('Bearer minimax-test-fake-key-1234');
    expect((opts.headers as Record<string, string>)['content-type']).toBe('application/json');

    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      model: 'speech-02-turbo',
      text: 'Hello from MiniMax TTS.',
      stream: false,
      voice_setting: {
        voice_id: 'male-qn-qingse',
        speed: 1.0,
        vol: 1.0,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        format: 'mp3',
      },
    });

    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'speech.mp3'));
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.toString('hex')).toBe(FAKE_MP3_HEX);
  });

  it('passes a custom voice id and language_boost through to the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ttsSuccessResp());
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-tts',
      audioKind: 'speech',
      voice: 'female-shaonv',
      language: 'zh',
      prompt: '你好。',
      output: 'speech-zh.mp3',
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(opts.body);
    expect(body.voice_setting.voice_id).toBe('female-shaonv');
    expect(body.language_boost).toBe('zh');
    expect(result.providerNote).toContain('female-shaonv');
  });

  // ─── credential guardrail ─────────────────────────────────────────────

  it('no configured MiniMax API key throws a clear, actionable error (no network call)', async () => {
    delete process.env.MINIMAX_API_KEY;
    delete process.env.OD_MINIMAX_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-tts',
      audioKind: 'speech',
      prompt: 'anything',
      output: 'nokey.mp3',
    }))).rejects.toThrow(/MiniMax API key|OD_MINIMAX_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ─── HTTP-level failure ──────────────────────────────────────────────

  it('HTTP error (non-ok) surfaces the status and truncated body', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('service unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-tts',
      audioKind: 'speech',
      prompt: 'anything',
      output: 'http-503.mp3',
    }))).rejects.toThrow(/minimax tts 503/);
  });

  // ─── base_resp logical-failure envelope ─────────────────────────────

  it('base_resp.status_code !== 0 throws with the upstream status_msg (logical failure despite HTTP 200)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResp({
      base_resp: { status_code: 1004, status_msg: 'authentication failed' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-tts',
      audioKind: 'speech',
      prompt: 'anything',
      output: 'fail.mp3',
    }))).rejects.toThrow(/authentication failed/);
  });

  // ─── missing/empty audio in response ────────────────────────────────

  it('success envelope with missing data.audio throws a clear error', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResp({
      data: {},
      base_resp: { status_code: 0, status_msg: 'success' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-tts',
      audioKind: 'speech',
      prompt: 'anything',
      output: 'noaudio.mp3',
    }))).rejects.toThrow(/data\.audio/);
  });

  // ─── DEFECT 1: no response-size bound on the hex -> Buffer decode ────

  it('DEFECT 1 (response-size bound): rejects a hex payload that decodes past the audio byte ceiling', async () => {
    // One extra byte past the ceiling is enough to prove the bound exists;
    // it still requires building a ~128 MiB hex string (2 hex chars/byte).
    const oversizedHex = 'ab'.repeat(AUDIO_BYTE_CEILING + 1);
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResp({
      data: { audio: oversizedHex },
      base_resp: { status_code: 0, status_msg: 'success' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-tts',
      audioKind: 'speech',
      prompt: 'oversized',
      output: 'oversized.mp3',
    }))).rejects.toThrow(/exceeds the 64 MiB ceiling/);
  }, 30_000);

  // ─── DEFECT 2: no odd-length/malformed hex rejection ─────────────────

  it('DEFECT 2 (malformed hex rejection): rejects an odd-length hex payload instead of silently truncating it', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResp({
      // Odd-length hex: Buffer.from('abc', 'hex') silently decodes just the
      // 'ab' byte and drops the trailing nibble instead of throwing.
      data: { audio: 'abc' },
      base_resp: { status_code: 0, status_msg: 'success' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-tts',
      audioKind: 'speech',
      prompt: 'malformed',
      output: 'malformed.mp3',
    }))).rejects.toThrow(/malformed hex/);
  });

  // ─── DEFECT 2b: non-hex characters bypass the odd-length check ───────

  it('DEFECT 2b (non-hex character rejection): rejects a hex payload with non-hex characters despite passing the even-length check', async () => {
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
      model: 'minimax-tts',
      audioKind: 'speech',
      prompt: 'malformed-nonhex',
      output: 'malformed-nonhex.mp3',
    }))).rejects.toThrow(/malformed hex/);
  });

  // ─── DEFECT 3: unbounded provider text in the logical-failure error ──

  it('DEFECT 3 (bounded logical-failure message): truncates an overlong base_resp.status_msg instead of persisting it raw', async () => {
    const longMsg = 'x'.repeat(1000);
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResp({
      base_resp: { status_code: 1004, status_msg: longMsg },
    }));
    vi.stubGlobal('fetch', fetchMock);

    // truncate(s, 240) keeps 239 chars + an ellipsis (see truncate() in
    // src/media/index.ts) — this substring can only appear in the thrown
    // message once the raw status_msg has actually been cut down to size.
    const truncated = `${'x'.repeat(239)}…`;

    await expect(generateMedia(baseArgs({
      surface: 'audio',
      model: 'minimax-tts',
      audioKind: 'speech',
      prompt: 'anything',
      output: 'longmsg.mp3',
    }))).rejects.toThrow(truncated);
  });
});
