// Unit tests for the stable-diffusion.cpp media provider (renderSdcppImage
// in media/index.ts) — the native async /sdcpp/v1 job API exposed by the
// upstream project's examples/server (docs: examples/server/api.md).
//
//   Submit: POST {baseUrl}/sdcpp/v1/img_gen
//           { prompt, width, height, sample_params, init_image?, strength? }
//           -> 202 { id, kind: "img_gen", status: "queued", created, poll_url }
//   Poll:   GET {baseUrl}{poll_url}
//           -> { id, kind, status, created, started, completed,
//                queue_position, result, error }
//           status ∈ queued | generating | completed | failed | cancelled
//           a non-null `error` is ALWAYS the failure signal
//           result.images[0].b64_json is the completed PNG, base64-encoded
//
// There is no bearer token (loopback-only local server, credentialsRequired:
// false) and no `model` field on the wire (one baked-in checkpoint per
// running process, chosen at server-launch time). These tests mock the
// global `fetch` end-to-end through generateMedia() — no real network
// calls, no real sd-server process.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateMedia } from '../../src/media/index.js';
import { writeConfig } from '../../src/media/config.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2uoAAAAASUVORK5CYII=';

const ENV_KEYS_TO_ISOLATE = [
  'OD_SDCPP_MAX_POLL_MS',
  'OD_MEDIA_CONFIG_DIR',
  'OD_DATA_DIR',
  'OD_MEDIA_MODEL_ALIASES',
];

describe('stable-diffusion.cpp (sdcpp) media provider', () => {
  let root: string;
  let projectRoot: string;
  let projectsRoot: string;
  const realFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries(ENV_KEYS_TO_ISOLATE.map((key) => [key, process.env[key]]));

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-sdcpp-'));
    projectRoot = path.join(root, 'project-root');
    projectsRoot = path.join(projectRoot, '.od', 'projects');
    await mkdir(projectsRoot, { recursive: true });
    for (const key of ENV_KEYS_TO_ISOLATE) delete process.env[key];
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    vi.unstubAllGlobals();
    vi.useRealTimers();
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

  function submitResp(id: string) {
    return new Response(JSON.stringify({
      id,
      kind: 'img_gen',
      status: 'queued',
      created: 1785553109,
      poll_url: `/sdcpp/v1/jobs/${id}`,
    }), { status: 202, headers: { 'content-type': 'application/json' } });
  }

  function pollResp(id: string, overrides: Record<string, unknown> = {}) {
    return new Response(JSON.stringify({
      id,
      kind: 'img_gen',
      status: 'generating',
      created: 1785553109,
      started: 1785553109,
      completed: null,
      queue_position: 0,
      result: null,
      error: null,
      ...overrides,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }

  function completedResp(id: string, b64: string) {
    return pollResp(id, {
      status: 'completed',
      completed: 1785553267,
      result: { output_format: 'png', images: [{ index: 0, b64_json: b64 }] },
    });
  }

  function failedResp(id: string, code: string, message: string) {
    return pollResp(id, {
      status: 'failed',
      completed: 1785553110,
      error: { code, message },
    });
  }

  // A narrow, surgical time-warp instead of vi.useFakeTimers(): the full
  // fake-timer subsystem also patches Date/setImmediate/etc. globally,
  // which fights with generateMedia's REAL fs setup (mkdir + reading
  // media-config.json) that runs before the poll loop is ever reached — in
  // this sandbox that combination made the whole call hang for the entire
  // test timeout without ever reaching the mocked fetch. Spying on just
  // `setTimeout` (so the poll loop's `sleep(2000)` resolves on the next
  // microtask instead of waiting 2 real seconds) and `Date.now` (advanced in
  // lockstep with each simulated sleep) fast-forwards only the polling
  // wait, leaving every other timer/fs code path untouched. Every test that
  // drives generateMedia through at least one poll iteration wraps its body
  // in this so the suite doesn't pay 2 real seconds per iteration.
  function withTimeWarp<T>(fn: () => Promise<T>): Promise<T> {
    let simulatedNow = Date.now();
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => simulatedNow);
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      cb: (...args: unknown[]) => void,
      ms?: number,
    ) => {
      simulatedNow += typeof ms === 'number' ? ms : 0;
      cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
    return fn().finally(() => {
      dateNowSpy.mockRestore();
      setTimeoutSpy.mockRestore();
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

  // ─── happy path: t2i ────────────────────────────────────────────────

  it('submits to the default loopback baseUrl with no auth header, polls through generating -> completed, decodes b64_json', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(submitResp('job_6a6d60d5_00000000'))
      .mockResolvedValueOnce(pollResp('job_6a6d60d5_00000000', { queue_position: 1 }))
      .mockResolvedValueOnce(completedResp('job_6a6d60d5_00000000', PNG_BASE64));
    vi.stubGlobal('fetch', fetchMock);

    const onProgress = vi.fn();
    await withTimeWarp(async () => {
      const result = await generateMedia(baseArgs({
        surface: 'image',
        model: 'sdcpp/z-image-turbo',
        prompt: 'a steaming bowl of ramen on a wooden table',
        aspect: '1:1',
        output: 'ramen.png',
        onProgress,
      }));

      expect(result.providerId).toBe('sdcpp');
      expect(result.providerNote).toContain('sdcpp/z-image-turbo');
      expect(result.providerNote).not.toContain('sdcpp/sdcpp/');
      expect(result.providerNote).toContain('1024x1024');

      const [submitUrl, submitOpts] = fetchMock.mock.calls[0]!;
      expect(String(submitUrl)).toBe('http://127.0.0.1:1234/sdcpp/v1/img_gen');
      expect(submitOpts.method).toBe('POST');
      expect((submitOpts.headers as Record<string, string>).authorization).toBeUndefined();
      const submitBody = JSON.parse(submitOpts.body);
      expect(submitBody.prompt).toBe('a steaming bowl of ramen on a wooden table');
      expect(submitBody.width).toBe(1024);
      expect(submitBody.height).toBe(1024);
      expect(submitBody.sample_params.sample_steps).toBe(8);
      expect(submitBody.output_format).toBe('png');
      expect(submitBody.init_image).toBeUndefined();
      expect(submitBody.strength).toBeUndefined();

      const [pollUrl, pollOpts] = fetchMock.mock.calls[1]!;
      expect(String(pollUrl)).toBe('http://127.0.0.1:1234/sdcpp/v1/jobs/job_6a6d60d5_00000000');
      expect((pollOpts?.headers as Record<string, string> | undefined)?.authorization).toBeUndefined();

      // Progress hook surfaces queue_position when the poll response carries it.
      expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('queue_position=1'));

      const bytes = await readFile(path.join(projectsRoot, 'project-1', 'ramen.png'));
      expect(bytes.length).toBeGreaterThan(0);
    });
  });

  it('maps --aspect to explicit width/height (no aspect-ratio enum on the wire)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(submitResp('job-16x9'))
      .mockResolvedValueOnce(completedResp('job-16x9', PNG_BASE64));
    vi.stubGlobal('fetch', fetchMock);

    await withTimeWarp(async () => {
      await generateMedia(baseArgs({
        surface: 'image',
        model: 'sdcpp/z-image-turbo',
        prompt: 'a wide cinematic landscape',
        aspect: '16:9',
        output: 'wide.png',
      }));

      const [, submitOpts] = fetchMock.mock.calls[0]!;
      const submitBody = JSON.parse(submitOpts.body);
      expect(submitBody.width).toBe(1024);
      expect(submitBody.height).toBe(576);
    });
  });

  // sdcppSizeFor's full branch table — 16:9/default(1:1) are already
  // exercised above via real generateMedia calls; the remaining three
  // aspects are pinned here directly against the wire body so every branch
  // has an assertion, not just the two most-used ones.
  it.each([
    ['9:16', 576, 1024],
    ['4:3', 1024, 768],
    ['3:4', 768, 1024],
  ] as const)('maps aspect %s to width=%d height=%d', async (aspect, width, height) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(submitResp(`job-${aspect}`))
      .mockResolvedValueOnce(completedResp(`job-${aspect}`, PNG_BASE64));
    vi.stubGlobal('fetch', fetchMock);

    await withTimeWarp(async () => {
      await generateMedia(baseArgs({
        surface: 'image',
        model: 'sdcpp/z-image-turbo',
        prompt: 'aspect coverage',
        aspect,
        output: `aspect-${aspect.replace(':', 'x')}.png`,
      }));

      const [, submitOpts] = fetchMock.mock.calls[0]!;
      const submitBody = JSON.parse(submitOpts.body);
      expect(submitBody.width).toBe(width);
      expect(submitBody.height).toBe(height);
    });
  });

  // ─── i2i: init_image + strength ─────────────────────────────────────

  it('a local --image resolves to a data URL and is sent as init_image + strength (no upload round-trip needed)', async () => {
    await writeRefImage();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(submitResp('job-i2i'))
      .mockResolvedValueOnce(completedResp('job-i2i', PNG_BASE64));
    vi.stubGlobal('fetch', fetchMock);

    await withTimeWarp(async () => {
      const result = await generateMedia(baseArgs({
        surface: 'image',
        model: 'sdcpp/z-image-turbo',
        prompt: 'restyle this as a watercolor painting',
        image: 'reference.png',
        output: 'restyled.png',
      }));

      expect(result.providerId).toBe('sdcpp');
      const [, submitOpts] = fetchMock.mock.calls[0]!;
      const submitBody = JSON.parse(submitOpts.body);
      expect(submitBody.init_image).toMatch(/^data:image\/png;base64,/);
      expect(typeof submitBody.strength).toBe('number');
      expect(submitBody.strength).toBeGreaterThan(0);
      expect(submitBody.strength).toBeLessThanOrEqual(1);

      const bytes = await readFile(path.join(projectsRoot, 'project-1', 'restyled.png'));
      expect(bytes.length).toBeGreaterThan(0);
    });
  });

  // ─── poll error: non-null `error` is the failure signal ────────────

  it('a `failed` status with a non-null error throws with the upstream message', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(submitResp('job-fail'))
      .mockResolvedValueOnce(failedResp('job-fail', 'generation_failed', 'generate_image returned empty results'));
    vi.stubGlobal('fetch', fetchMock);

    await withTimeWarp(() => expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'sdcpp/z-image-turbo',
      prompt: 'anything',
      output: 'fail.png',
    }))).rejects.toThrow(/generate_image returned empty results/));
  });

  it('a `cancelled` status also carries a non-null error and is treated as failure, not a silent stall', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(submitResp('job-cancelled'))
      .mockResolvedValueOnce(pollResp('job-cancelled', {
        status: 'cancelled',
        completed: 1785553110,
        error: { code: 'cancelled', message: 'job cancelled by client' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await withTimeWarp(() => expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'sdcpp/z-image-turbo',
      prompt: 'anything',
      output: 'cancelled.png',
    }))).rejects.toThrow(/job cancelled by client/));
  });

  it('polls through intermediate `queued` / `generating` states before completing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(submitResp('job-multi-poll'))
      .mockResolvedValueOnce(pollResp('job-multi-poll', { status: 'queued', queue_position: 3 }))
      .mockResolvedValueOnce(pollResp('job-multi-poll', { status: 'generating', queue_position: 0 }))
      .mockResolvedValueOnce(completedResp('job-multi-poll', PNG_BASE64));
    vi.stubGlobal('fetch', fetchMock);

    await withTimeWarp(async () => {
      const result = await generateMedia(baseArgs({
        surface: 'image',
        model: 'sdcpp/z-image-turbo',
        prompt: 'a drone shot over a mountain range',
        output: 'mountain.png',
      }));

      expect(result.providerId).toBe('sdcpp');
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  // ─── HTTP-level failures ────────────────────────────────────────────

  it('img_gen submission returning a non-202 status surfaces the status and body', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid generation parameters' }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    // No poll loop is ever entered (fails at submit) — no sleep, no need
    // for the time-warp helper.
    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'sdcpp/z-image-turbo',
      prompt: 'anything',
      output: 'badreq.png',
    }))).rejects.toThrow(/sdcpp img_gen 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a poll HTTP error (non-ok) surfaces the status and body', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(submitResp('job-poll-500'))
      .mockResolvedValueOnce(new Response('internal error', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await withTimeWarp(() => expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'sdcpp/z-image-turbo',
      prompt: 'anything',
      output: 'poll-500.png',
    }))).rejects.toThrow(/sdcpp poll 500/));
  });

  it('a submission response missing poll_url throws a clear error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'job-x', kind: 'img_gen', status: 'queued', created: 1 }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    // Fails while parsing the submit response — no poll loop, no sleep.
    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'sdcpp/z-image-turbo',
      prompt: 'anything',
      output: 'nopoll.png',
    }))).rejects.toThrow(/poll_url/);
  });

  it('a submission response with a poll_url that is not a same-origin path (e.g. absolute/malformed) throws a labeled error instead of an opaque fetch TypeError', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'job-badpoll',
        kind: 'img_gen',
        status: 'queued',
        created: 1,
        poll_url: 'https://evil.example.com/sdcpp/v1/jobs/job-badpoll',
      }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    // Fails while validating the submit response's poll_url shape — no
    // poll loop is ever entered, so no sleep / time-warp needed.
    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'sdcpp/z-image-turbo',
      prompt: 'anything',
      output: 'badpoll.png',
    }))).rejects.toThrow(/malformed poll_url/);
    // Only the submit call happened — the renderer never tried to fetch
    // the malformed poll_url.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a completed job whose result has no images[0].b64_json throws a clear error (not a raw crash)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(submitResp('job-noimg'))
      .mockResolvedValueOnce(pollResp('job-noimg', { status: 'completed', completed: 1785553110, result: { output_format: 'png', images: [] } }));
    vi.stubGlobal('fetch', fetchMock);

    await withTimeWarp(() => expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'sdcpp/z-image-turbo',
      prompt: 'anything',
      output: 'noimg.png',
    }))).rejects.toThrow(/b64_json/));
  });

  // ─── timeout ─────────────────────────────────────────────────────────

  it('a job that never leaves `generating` times out after OD_SDCPP_MAX_POLL_MS with a clear, actionable message naming the env override', async () => {
    process.env.OD_SDCPP_MAX_POLL_MS = '30000';

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(submitResp('job-stuck'))
      // A fresh Response per call (not a shared mockResolvedValue instance)
      // — Response bodies are single-read, and this poll loop keeps calling
      // fetch until the OD_SDCPP_MAX_POLL_MS ceiling trips.
      .mockImplementation(async () => pollResp('job-stuck', { status: 'generating' }));
    vi.stubGlobal('fetch', fetchMock);

    await withTimeWarp(async () => {
      const promise = generateMedia(baseArgs({
        surface: 'image',
        model: 'sdcpp/z-image-turbo',
        prompt: 'anything',
        output: 'stuck.png',
      }));
      await expect(promise).rejects.toThrow(/sdcpp job job-stuck timed out after/);
      await expect(promise).rejects.toThrow(/OD_SDCPP_MAX_POLL_MS/);
    });
  });

  // ─── T1: per-request timeout (a HANGING fetch, not just a completed-jobs
  // ceiling) ───────────────────────────────────────────────────────────
  //
  // Red-spec for the finding: before this fix, a poll fetch() call that
  // never resolves (the server accepts the TCP connection but never sends
  // headers/body) would hang forever — the while-loop's own
  // `Date.now() - startedAt < maxMs` ceiling only re-evaluates BETWEEN
  // iterations, so it never gets a chance to fire while a single fetch is
  // stuck in flight. The mock below faithfully models that: it only
  // settles when the AbortSignal passed to it fires (mirroring real
  // fetch()'s own abort contract), so without a per-request signal this
  // test would hang for the real 20s file-level test timeout and fail as
  // a timeout, not a clean assertion.

  it('a poll fetch that never resolves on its own (server accepts the connection but never responds) aborts within its per-request budget with a labeled timeout error, not a hang', async () => {
    process.env.OD_SDCPP_MAX_POLL_MS = '30000';

    const fetchMock = vi.fn().mockResolvedValueOnce(submitResp('job-hang'));
    // 13 quick "generating" polls first. Each iteration's sleep(2000) runs
    // BEFORE its fetch, so by the time the 14th (hanging) poll's own sleep
    // has run, the time-warped simulated clock has advanced 14 * 2000 =
    // 28000ms — leaving ~2000ms of the 30000ms ceiling remaining. That
    // next poll is the hanging one: its per-request AbortSignal.timeout
    // budget is min(SDCPP_PER_REQUEST_TIMEOUT_MS, remaining) ≈ 2000ms —
    // the actual wall-clock timer AbortSignal.timeout() schedules is real
    // (untouched by the Date.now/setTimeout time-warp), so this test
    // genuinely waits ~2 real seconds for it to fire, not the full 30s
    // ceiling (measured: ~2004ms).
    for (let i = 0; i < 13; i++) {
      fetchMock.mockResolvedValueOnce(pollResp('job-hang', { status: 'generating' }));
    }
    fetchMock.mockImplementation((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // no signal threaded through — never resolves.
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);

    await withTimeWarp(() => expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'sdcpp/z-image-turbo',
      prompt: 'anything',
      output: 'hang.png',
    }))).rejects.toThrow(/sdcpp poll request for job job-hang timed out/));
  }, 15_000);

  // The happy path is unaffected by adding a signal to every fetch call —
  // pinned again here (in addition to the dedicated happy-path test above)
  // right next to the hang red-spec so a regression in the signal wiring
  // that broke normal completion would show up in this same neighborhood.
  it('the happy path still completes normally now that every fetch carries a per-request AbortSignal', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(submitResp('job-still-fine'))
      .mockResolvedValueOnce(completedResp('job-still-fine', PNG_BASE64));
    vi.stubGlobal('fetch', fetchMock);

    await withTimeWarp(() => expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'sdcpp/z-image-turbo',
      prompt: 'anything',
      output: 'still-fine.png',
    }))).resolves.toMatchObject({ providerId: 'sdcpp' }));
  });

  // ─── config detection ───────────────────────────────────────────────

  it('a stored baseUrl override (different port) is honored, still with no auth header required', async () => {
    await writeConfig(projectRoot, {
      providers: { sdcpp: { baseUrl: 'http://127.0.0.1:9234' } },
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(submitResp('job-customport'))
      .mockResolvedValueOnce(completedResp('job-customport', PNG_BASE64));
    vi.stubGlobal('fetch', fetchMock);

    await withTimeWarp(async () => {
      const result = await generateMedia(baseArgs({
        surface: 'image',
        model: 'sdcpp/z-image-turbo',
        prompt: 'anything',
        output: 'customport.png',
      }));

      expect(result.providerId).toBe('sdcpp');
      const [submitUrl, submitOpts] = fetchMock.mock.calls[0]!;
      expect(String(submitUrl)).toBe('http://127.0.0.1:9234/sdcpp/v1/img_gen');
      expect((submitOpts.headers as Record<string, string>).authorization).toBeUndefined();

      const [pollUrl] = fetchMock.mock.calls[1]!;
      expect(String(pollUrl)).toBe('http://127.0.0.1:9234/sdcpp/v1/jobs/job-customport');
    });
  });

  it('no API key is ever required — generation succeeds with zero stored/env credentials (credentialsRequired: false)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(submitResp('job-nokey'))
      .mockResolvedValueOnce(completedResp('job-nokey', PNG_BASE64));
    vi.stubGlobal('fetch', fetchMock);

    await withTimeWarp(() => expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'sdcpp/z-image-turbo',
      prompt: 'anything',
      output: 'nokey.png',
    }))).resolves.toMatchObject({ providerId: 'sdcpp' }));
  });
});
