// Unit tests for the Kie.ai media provider (renderKieImage / renderKieVideo
// in media/index.ts) — a single unified createTask/recordInfo async-jobs
// API fronting Kling, Seedance 2.0, Flux-2, Qwen, and Grok Imagine on one
// prepaid credit pool.
//
//   Create: POST https://api.kie.ai/api/v1/jobs/createTask
//           { model, input } -> { code: 200, msg, data: { taskId } }
//   Poll:   GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=<id>
//           -> { code, msg, data: { taskId, model, state, resultJson, failMsg } }
//           state ∈ waiting | queuing | generating | success | fail
//           resultJson is a JSON-encoded STRING; parse -> { resultUrls: [...] }
//   Upload (i2i/i2v reference images): POST https://api.kie.ai/api/file-base64-upload
//           { base64Data, uploadPath, fileName? } -> { data: { downloadUrl } }
//
// These tests mock the global `fetch` end-to-end through generateMedia() —
// no real network calls, no real API keys (fake key strings only).

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateMedia } from '../../src/media/index.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2uoAAAAASUVORK5CYII=';

const FAKE_MP4 = Buffer.from([
  0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
]);

const ENV_KEYS_TO_ISOLATE = [
  'OD_KIE_API_KEY',
  'KIE_AI_API_KEY',
  'OD_MEDIA_CONFIG_DIR',
  'OD_DATA_DIR',
  'OD_MEDIA_MODEL_ALIASES',
];

describe('kie.ai media provider', () => {
  let root: string;
  let projectRoot: string;
  let projectsRoot: string;
  const realFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries(ENV_KEYS_TO_ISOLATE.map((key) => [key, process.env[key]]));

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-kie-'));
    projectRoot = path.join(root, 'project-root');
    projectsRoot = path.join(projectRoot, '.od', 'projects');
    await mkdir(projectsRoot, { recursive: true });
    for (const key of ENV_KEYS_TO_ISOLATE) delete process.env[key];
    process.env.KIE_AI_API_KEY = 'kie-test-fake-key-1234';
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

  async function writeRefImage(name = 'reference.png') {
    const projectDir = path.join(projectsRoot, 'project-1');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, name), Buffer.from(PNG_BASE64, 'base64'));
  }

  function jsonResp(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  function bytesResp(bytes: Buffer, contentType: string) {
    return new Response(bytes, { status: 200, headers: { 'content-type': contentType } });
  }

  function createTaskResp(taskId: string) {
    return jsonResp({ code: 200, msg: 'success', data: { taskId } });
  }

  function pollResp(state: string, extra: Record<string, unknown> = {}) {
    return jsonResp({ code: 200, msg: 'success', data: { taskId: 'task-1', state, ...extra } });
  }

  function successPoll(resultUrls: string[]) {
    return pollResp('success', { resultJson: JSON.stringify({ resultUrls }) });
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

  // ─── t2i: flux-2/pro-text-to-image ─────────────────────────────────

  it('renderKieImage: creates a task with Bearer auth + model slug + input shape, polls to success, downloads resultUrls[0]', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createTaskResp('task-flux2-t2i'))
      .mockResolvedValueOnce(successPoll(['https://static.kie.ai/out/flux2.png']))
      .mockResolvedValueOnce(bytesResp(Buffer.from(PNG_BASE64, 'base64'), 'image/png'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'image',
      model: 'flux-2/pro-text-to-image',
      prompt: 'A minimalist product hero shot',
      aspect: '16:9',
      output: 'hero.png',
    }));

    expect(result.providerId).toBe('kie');
    expect(result.providerNote).toContain('flux-2/pro-text-to-image');

    const [createUrl, createOpts] = fetchMock.mock.calls[0]!;
    expect(String(createUrl)).toBe('https://api.kie.ai/api/v1/jobs/createTask');
    expect(createOpts.method).toBe('POST');
    expect((createOpts.headers as Record<string, string>).authorization).toBe('Bearer kie-test-fake-key-1234');
    const createBody = JSON.parse(createOpts.body);
    expect(createBody.model).toBe('flux-2/pro-text-to-image');
    expect(createBody.input.prompt).toBe('A minimalist product hero shot');
    expect(createBody.input.aspect_ratio).toBe('16:9');

    const [pollUrl, pollOpts] = fetchMock.mock.calls[1]!;
    expect(String(pollUrl)).toBe('https://api.kie.ai/api/v1/jobs/recordInfo?taskId=task-flux2-t2i');
    expect((pollOpts.headers as Record<string, string>).authorization).toBe('Bearer kie-test-fake-key-1234');

    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'hero.png'));
    expect(bytes.length).toBeGreaterThan(0);
  });

  // ─── t2v: kling-2.6/text-to-video (duration snapping) ──────────────

  it('renderKieVideo: kling-2.6 text-to-video snaps duration to the nearest allowed enum ("5"/"10") and stringifies it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createTaskResp('task-kling-t2v'))
      .mockResolvedValueOnce(successPoll(['https://static.kie.ai/out/kling.mp4']))
      .mockResolvedValueOnce(bytesResp(FAKE_MP4, 'video/mp4'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'video',
      model: 'kling-2.6/text-to-video',
      prompt: 'A golden retriever running on the beach at sunset',
      aspect: '16:9',
      length: 8,
      output: 'beach-dog.mp4',
    }));

    expect(result.providerId).toBe('kie');
    const [, createOpts] = fetchMock.mock.calls[0]!;
    const createBody = JSON.parse(createOpts.body);
    expect(createBody.model).toBe('kling-2.6/text-to-video');
    // 8s is not a valid Kling enum value (5|10); nearest is 10, and the API
    // expects it as a STRING, not a number.
    expect(createBody.input.duration).toBe('10');
    expect(typeof createBody.input.duration).toBe('string');
    // Kling has no 4:3/3:4 in its enum; 16:9 passes through unchanged.
    expect(createBody.input.aspect_ratio).toBe('16:9');

    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'beach-dog.mp4'));
    expect(bytes.length).toBeGreaterThan(0);
  });

  // ─── poll loop: waiting -> generating -> success ───────────────────

  it('renderKieVideo: polls through intermediate states (queuing) before success', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createTaskResp('task-seedance'))
      .mockResolvedValueOnce(pollResp('queuing'))
      .mockResolvedValueOnce(successPoll(['https://static.kie.ai/out/seedance.mp4']))
      .mockResolvedValueOnce(bytesResp(FAKE_MP4, 'video/mp4'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'video',
      model: 'bytedance/seedance-2',
      prompt: 'A drone shot over a mountain range',
      aspect: '16:9',
      output: 'mountain.mp4',
    }));

    expect(result.providerId).toBe('kie');
    expect(result.providerNote).toContain('bytedance/seedance-2');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  }, 20_000);

  // ─── fail state → throws failMsg ───────────────────────────────────

  it('renderKieImage: fail state throws with the upstream failMsg', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createTaskResp('task-fail'))
      .mockResolvedValueOnce(pollResp('fail', { failCode: 'CONTENT_POLICY', failMsg: 'Content policy violation' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'flux-2/pro-text-to-image',
      prompt: 'anything',
      output: 'fail.png',
    }))).rejects.toThrow(/Content policy violation/);
  });

  // ─── malformed resultJson → clear error ────────────────────────────

  it('renderKieImage: success state with non-JSON resultJson throws a clear parse error (not a raw crash)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createTaskResp('task-badjson'))
      .mockResolvedValueOnce(pollResp('success', { resultJson: 'not-valid-json{' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'flux-2/pro-text-to-image',
      prompt: 'anything',
      output: 'badjson.png',
    }))).rejects.toThrow(/resultJson/);
  });

  it('renderKieImage: success state with resultJson missing resultUrls throws a clear error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createTaskResp('task-nourls'))
      .mockResolvedValueOnce(pollResp('success', { resultJson: JSON.stringify({ resultObject: {} }) }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'flux-2/pro-text-to-image',
      prompt: 'anything',
      output: 'nourls.png',
    }))).rejects.toThrow(/resultUrls/);
  });

  // ─── i2i upload flow: qwen/image-to-image ──────────────────────────

  it('renderKieImage: qwen image-to-image uploads the local --image via file-base64-upload, then passes the returned URL as image_url', async () => {
    await writeRefImage();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResp({
        code: 200,
        msg: 'success',
        data: { downloadUrl: 'https://tempfile.redpandaai.co/uploads/reference.png' },
      }))
      .mockResolvedValueOnce(createTaskResp('task-qwen'))
      .mockResolvedValueOnce(successPoll(['https://static.kie.ai/out/qwen.png']))
      .mockResolvedValueOnce(bytesResp(Buffer.from(PNG_BASE64, 'base64'), 'image/png'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'image',
      model: 'qwen/image-to-image',
      prompt: 'Change the background to a studio backdrop',
      image: 'reference.png',
      output: 'edited.png',
    }));

    expect(result.providerId).toBe('kie');

    const [uploadUrl, uploadOpts] = fetchMock.mock.calls[0]!;
    expect(String(uploadUrl)).toBe('https://api.kie.ai/api/file-base64-upload');
    expect((uploadOpts.headers as Record<string, string>).authorization).toBe('Bearer kie-test-fake-key-1234');
    const uploadBody = JSON.parse(uploadOpts.body);
    expect(uploadBody.base64Data).toMatch(/^data:image\/png;base64,/);
    expect(typeof uploadBody.uploadPath).toBe('string');
    expect(uploadBody.uploadPath.length).toBeGreaterThan(0);

    const [, createOpts] = fetchMock.mock.calls[1]!;
    const createBody = JSON.parse(createOpts.body);
    expect(createBody.model).toBe('qwen/image-to-image');
    expect(createBody.input.image_url).toBe('https://tempfile.redpandaai.co/uploads/reference.png');
    expect(createBody.input.prompt).toBe('Change the background to a studio backdrop');

    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'edited.png'));
    expect(bytes.length).toBeGreaterThan(0);
  });

  // ─── i2v upload flow: kling-2.6/image-to-video ─────────────────────

  it('renderKieVideo: kling image-to-video uploads the local --image, then sends image_urls: [url]', async () => {
    await writeRefImage();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResp({
        code: 200,
        msg: 'success',
        data: { downloadUrl: 'https://tempfile.redpandaai.co/uploads/frame.png' },
      }))
      .mockResolvedValueOnce(createTaskResp('task-kling-i2v'))
      .mockResolvedValueOnce(successPoll(['https://static.kie.ai/out/kling-i2v.mp4']))
      .mockResolvedValueOnce(bytesResp(FAKE_MP4, 'video/mp4'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'video',
      model: 'kling-2.6/image-to-video',
      prompt: 'Animate this still into a slow pan',
      image: 'reference.png',
      output: 'animated.mp4',
    }));

    expect(result.providerId).toBe('kie');
    const [, createOpts] = fetchMock.mock.calls[1]!;
    const createBody = JSON.parse(createOpts.body);
    expect(createBody.model).toBe('kling-2.6/image-to-video');
    expect(createBody.input.image_urls).toEqual(['https://tempfile.redpandaai.co/uploads/frame.png']);

    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'animated.mp4'));
    expect(bytes.length).toBeGreaterThan(0);
  });

  // ─── guardrails ─────────────────────────────────────────────────────

  it('renderKieImage: an i2i model without --image throws a clear "requires --image" error (no network call)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'qwen/image-to-image',
      prompt: 'anything',
      output: 'noimg.png',
    }))).rejects.toThrow(/--image/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renderKieImage: no configured API key throws a clear, actionable error', async () => {
    delete process.env.KIE_AI_API_KEY;
    delete process.env.OD_KIE_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'flux-2/pro-text-to-image',
      prompt: 'anything',
      output: 'nokey.png',
    }))).rejects.toThrow(/Kie\.ai|KIE_AI_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ─── model-alias contract (review finding #1) ──────────────────────

  it('renderKieImage: the input-mapping branch keys off ctx.model (the catalog id), not the aliased wireModel — body.model still carries the resolved wire model', async () => {
    process.env.OD_MEDIA_MODEL_ALIASES = JSON.stringify({
      'flux-2/pro-text-to-image': 'flux-2/pro-text-to-image-custom-tier',
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createTaskResp('task-alias'))
      .mockResolvedValueOnce(successPoll(['https://static.kie.ai/out/alias.png']))
      .mockResolvedValueOnce(bytesResp(Buffer.from(PNG_BASE64, 'base64'), 'image/png'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'image',
      model: 'flux-2/pro-text-to-image',
      prompt: 'aliased request',
      aspect: '16:9',
      output: 'alias.png',
    }));

    expect(result.providerId).toBe('kie');
    const [, createOpts] = fetchMock.mock.calls[0]!;
    const createBody = JSON.parse(createOpts.body);
    // body.model carries the alias (the resolved wire model)...
    expect(createBody.model).toBe('flux-2/pro-text-to-image-custom-tier');
    // ...but the flux-2/pro-text-to-image input shape (aspect_ratio +
    // resolution) still applied, proving the branch matched on ctx.model —
    // if it matched on the (aliased) wireModel instead, this would hit the
    // "no input mapping registered" guard clause and never reach createTask.
    expect(createBody.input.aspect_ratio).toBe('16:9');
    expect(createBody.input.resolution).toBe('1K');
  });

  // ─── poll-loop code check (review finding #3) ──────────────────────

  it('renderKieImage: a poll response with code !== 200 throws with the upstream msg immediately (no timeout-loop)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createTaskResp('task-pollcode'))
      .mockResolvedValueOnce(jsonResp({ code: 500, msg: 'rate limited, try again later' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'flux-2/pro-text-to-image',
      prompt: 'anything',
      output: 'pollcode.png',
    }))).rejects.toThrow(/rate limited, try again later/);
    // Exactly createTask + the one failing poll — the code!==200 check
    // surfaces the error immediately rather than looping until maxMs.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ─── test gaps (review finding #4) ──────────────────────────────────

  it('renderKieImage: createTask HTTP error (non-ok) surfaces the status and body', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('service unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'flux-2/pro-text-to-image',
      prompt: 'anything',
      output: 'createtask-503.png',
    }))).rejects.toThrow(/kie createTask 503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renderKieImage: recordInfo (poll) HTTP error (non-ok) surfaces the status and body', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createTaskResp('task-poll-502'))
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'flux-2/pro-text-to-image',
      prompt: 'anything',
      output: 'poll-502.png',
    }))).rejects.toThrow(/kie poll 502/);
  });

  it('renderKieImage: file-base64-upload HTTP error (non-ok) surfaces the status and body', async () => {
    await writeRefImage();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'qwen/image-to-image',
      prompt: 'anything',
      image: 'reference.png',
      output: 'upload-401.png',
    }))).rejects.toThrow(/kie upload 401/);
  });

  it('renderKieImage: createTask response with code !== 200 throws with the upstream msg', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResp({ code: 401, msg: 'invalid api key' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'flux-2/pro-text-to-image',
      prompt: 'anything',
      output: 'createtask-code401.png',
    }))).rejects.toThrow(/invalid api key/);
  });

  it('renderKieImage: the final CDN download carries no Authorization header', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createTaskResp('task-noauth-dl'))
      .mockResolvedValueOnce(successPoll(['https://static.kie.ai/out/noauth.png']))
      .mockResolvedValueOnce(bytesResp(Buffer.from(PNG_BASE64, 'base64'), 'image/png'));
    vi.stubGlobal('fetch', fetchMock);

    await generateMedia(baseArgs({
      surface: 'image',
      model: 'flux-2/pro-text-to-image',
      prompt: 'anything',
      output: 'noauth-dl.png',
    }));

    const [dlUrl, dlOpts] = fetchMock.mock.calls[2]!;
    expect(String(dlUrl)).toBe('https://static.kie.ai/out/noauth.png');
    expect((dlOpts?.headers as Record<string, string> | undefined)?.authorization).toBeUndefined();
  });

  it('renderKieImage: flux-2/pro-image-to-image uploads multiple --images refs and passes them as input_urls in order', async () => {
    const projectDir = path.join(projectsRoot, 'project-1');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'ref-a.png'), Buffer.from(PNG_BASE64, 'base64'));
    await writeFile(path.join(projectDir, 'ref-b.png'), Buffer.from(PNG_BASE64, 'base64'));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResp({ code: 200, msg: 'success', data: { downloadUrl: 'https://tempfile.redpandaai.co/uploads/ref-a.png' } }))
      .mockResolvedValueOnce(jsonResp({ code: 200, msg: 'success', data: { downloadUrl: 'https://tempfile.redpandaai.co/uploads/ref-b.png' } }))
      .mockResolvedValueOnce(createTaskResp('task-flux2-i2i'))
      .mockResolvedValueOnce(successPoll(['https://static.kie.ai/out/flux2-i2i.png']))
      .mockResolvedValueOnce(bytesResp(Buffer.from(PNG_BASE64, 'base64'), 'image/png'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'image',
      model: 'flux-2/pro-image-to-image',
      prompt: 'combine these two references',
      image: 'ref-a.png',
      images: ['ref-a.png', 'ref-b.png'],
      output: 'flux2-i2i.png',
    }));

    expect(result.providerId).toBe('kie');
    // Both refs upload (sequentially or in parallel — kieUploadRefs is
    // Promise.all now) before createTask.
    const [, createOpts] = fetchMock.mock.calls[2]!;
    const createBody = JSON.parse(createOpts.body);
    expect(createBody.model).toBe('flux-2/pro-image-to-image');
    expect(createBody.input.input_urls).toEqual([
      'https://tempfile.redpandaai.co/uploads/ref-a.png',
      'https://tempfile.redpandaai.co/uploads/ref-b.png',
    ]);

    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'flux2-i2i.png'));
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('renderKieVideo: seedance-2 with --image sets first_frame_url and clamps duration to the continuous 4-15s range (not a nearest-enum snap)', async () => {
    await writeRefImage();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResp({
        code: 200,
        msg: 'success',
        data: { downloadUrl: 'https://tempfile.redpandaai.co/uploads/frame.png' },
      }))
      .mockResolvedValueOnce(createTaskResp('task-seedance-i2v'))
      .mockResolvedValueOnce(successPoll(['https://static.kie.ai/out/seedance-i2v.mp4']))
      .mockResolvedValueOnce(bytesResp(FAKE_MP4, 'video/mp4'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'video',
      model: 'bytedance/seedance-2',
      prompt: 'the still frame comes to life',
      image: 'reference.png',
      length: 20, // above the 4-15s clamp ceiling
      output: 'seedance-i2v.mp4',
    }));

    expect(result.providerId).toBe('kie');
    const [, createOpts] = fetchMock.mock.calls[1]!;
    const createBody = JSON.parse(createOpts.body);
    expect(createBody.model).toBe('bytedance/seedance-2');
    expect(createBody.input.first_frame_url).toBe('https://tempfile.redpandaai.co/uploads/frame.png');
    // Continuous clamp (kieDurationIntClamped), not a nearest-enum snap:
    // 20s clamps down to the 15s ceiling and stays a number, not a string.
    expect(createBody.input.duration).toBe(15);
    expect(typeof createBody.input.duration).toBe('number');

    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'seedance-i2v.mp4'));
    expect(bytes.length).toBeGreaterThan(0);
  });
});
