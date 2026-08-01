// Unit tests for the Higgsfield media provider (renderHiggsfieldImage /
// renderHiggsfieldVideo in media/index.ts) — a streamable-HTTP MCP JSON-RPC
// bridge over the daemon-stored OAuth token for the `higgsfield-openclaw`
// server (see mcp-config.ts / mcp-tokens.ts). Unlike every other provider,
// there is no pasted API key: credentials come from the enabled
// mcp.higgsfield.ai server's stored token (media/config.ts
// resolveHiggsfieldMcpCredential).
//
//   Sequence: POST https://mcp.higgsfield.ai/mcp
//     initialize (protocolVersion '2025-03-26') -> notifications/initialized
//     -> tools/call generate_image | generate_video (args: {params:{...}})
//     -> tools/call job_status (args: {jobId, sync:true}, flat) looped until
//        terminal -> download results.rawUrl.
//   i2i / i2v source frames: tools/call media_upload (flat args) -> PUT the
//   presigned upload_url -> tools/call media_confirm (flat args) -> pass
//   medias:[{value: media_id, role}] on the generate_* call.
//   Responses may be SSE-framed (`data: ...` lines) — parse the LAST one.
//   A 401 anywhere triggers exactly one refresh-then-retry using the
//   stored refresh_token/tokenEndpoint/clientId.
//
// These tests mock the global `fetch` end-to-end through generateMedia() —
// no real network calls to mcp.higgsfield.ai, no real tokens (fake strings
// only), and no token values are ever printed.

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

const HIGGSFIELD_SERVER_ID = 'higgsfield-openclaw';
const MCP_URL = 'https://mcp.higgsfield.ai/mcp';

const ENV_KEYS_TO_ISOLATE = ['OD_MEDIA_CONFIG_DIR', 'OD_DATA_DIR', 'OD_HIGGSFIELD_MAX_POLL_MS'];

describe('higgsfield media provider', () => {
  let root: string;
  let projectRoot: string;
  let projectsRoot: string;
  const realFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries(ENV_KEYS_TO_ISOLATE.map((key) => [key, process.env[key]]));

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-higgsfield-'));
    projectRoot = path.join(root, 'project-root');
    projectsRoot = path.join(projectRoot, '.od', 'projects');
    await mkdir(projectsRoot, { recursive: true });
    for (const key of ENV_KEYS_TO_ISOLATE) delete process.env[key];
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

  async function writeMcpFixture(token: Record<string, unknown>, opts: { enabled?: boolean } = {}) {
    const configFile = path.join(projectRoot, '.od', 'mcp-config.json');
    await mkdir(path.dirname(configFile), { recursive: true });
    await writeFile(configFile, JSON.stringify({
      servers: [{
        id: HIGGSFIELD_SERVER_ID,
        label: 'Higgsfield (OpenClaw)',
        transport: 'http',
        enabled: opts.enabled ?? true,
        url: MCP_URL,
      }],
    }), 'utf8');
    const tokensFile = path.join(projectRoot, '.od', 'mcp-tokens.json');
    await writeFile(tokensFile, JSON.stringify({ servers: { [HIGGSFIELD_SERVER_ID]: token } }), 'utf8');
  }

  async function writeRefImages() {
    const projectDir = path.join(projectsRoot, 'project-1');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'start.png'), Buffer.from(PNG_BASE64, 'base64'));
    await writeFile(path.join(projectDir, 'end.png'), Buffer.from(PNG_BASE64, 'base64'));
  }

  function mcpResp(id: number, result: unknown, opts: { sessionId?: string; status?: number } = {}) {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
      status: opts.status ?? 200,
      headers: {
        'content-type': 'application/json',
        ...(opts.sessionId ? { 'mcp-session-id': opts.sessionId } : {}),
      },
    });
  }

  /** SSE-framed variant of mcpResp — exercises the "parse the LAST data:
   * line" branch of the response parser. */
  function mcpSseResp(id: number, result: unknown, opts: { sessionId?: string } = {}) {
    const payload = JSON.stringify({ jsonrpc: '2.0', id, result });
    return new Response(`event: message\ndata: ${payload}\n\n`, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        ...(opts.sessionId ? { 'mcp-session-id': opts.sessionId } : {}),
      },
    });
  }

  function toolResult(structuredContent: unknown) {
    return { structuredContent, content: [] };
  }

  function okResp() {
    return new Response(null, { status: 200 });
  }

  function unauthorizedResp() {
    return new Response('unauthorized', { status: 401 });
  }

  function bytesResp(bytes: Buffer, contentType: string) {
    return new Response(bytes, { status: 200, headers: { 'content-type': contentType } });
  }

  function tokenEndpointResp(accessToken: string, refreshToken = 'hf-refresh-2') {
    return new Response(JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: 3600,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
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

  // ─── (a) image happy path: SSE-framed initialize, Bearer + session-id
  //     echo, model/prompt in params, pending -> completed poll ──────────

  it('renderHiggsfieldImage: initialize (SSE-framed) -> notify -> generate_image -> job_status pending->completed -> downloads rawUrl', async () => {
    await writeMcpFixture({ accessToken: 'hf-test-token-1', tokenType: 'Bearer', savedAt: Date.now() });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mcpSseResp(1, { protocolVersion: '2025-03-26', serverInfo: { name: 'higgsfield-openclaw' } }, { sessionId: 'sess-abc' }))
      .mockResolvedValueOnce(okResp())
      .mockResolvedValueOnce(mcpResp(2, toolResult({ results: [{ id: 'job-1', type: 'image', status: 'pending', model: 'nano_banana_pro', params: {} }] })))
      .mockResolvedValueOnce(mcpResp(3, toolResult({ generation: { id: 'job-1', status: 'pending' } })))
      .mockResolvedValueOnce(mcpResp(4, toolResult({
        generation: {
          id: 'job-1',
          status: 'completed',
          results: { rawUrl: 'https://cdn.higgsfield.ai/out/hero.png', minUrl: 'https://cdn.higgsfield.ai/out/hero_min.webp' },
        },
      })))
      .mockResolvedValueOnce(bytesResp(Buffer.from(PNG_BASE64, 'base64'), 'image/png'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'image',
      model: 'higgsfield/nano_banana_pro',
      prompt: 'a single red cube on a white background',
      aspect: '1:1',
      output: 'hero.png',
    }));

    expect(result.providerId).toBe('higgsfield');
    expect(result.providerNote).toContain('higgsfield/nano_banana_pro');

    const [initUrl, initOpts] = fetchMock.mock.calls[0]!;
    expect(String(initUrl)).toBe(MCP_URL);
    expect((initOpts.headers as Record<string, string>).authorization).toBe('Bearer hf-test-token-1');
    const initBody = JSON.parse(initOpts.body as string);
    expect(initBody.method).toBe('initialize');
    expect(initBody.params.protocolVersion).toBe('2025-03-26');

    const [, genOpts] = fetchMock.mock.calls[2]!;
    expect((genOpts.headers as Record<string, string>).authorization).toBe('Bearer hf-test-token-1');
    expect((genOpts.headers as Record<string, string>)['mcp-session-id']).toBe('sess-abc');
    const genBody = JSON.parse(genOpts.body as string);
    expect(genBody.method).toBe('tools/call');
    expect(genBody.params.name).toBe('generate_image');
    expect(genBody.params.arguments.params.model).toBe('nano_banana_pro');
    expect(genBody.params.arguments.params.prompt).toBe('a single red cube on a white background');
    expect(genBody.params.arguments.params.count).toBe(1);

    const [, pollOpts] = fetchMock.mock.calls[3]!;
    const pollBody = JSON.parse(pollOpts.body as string);
    expect(pollBody.params.name).toBe('job_status');
    expect(pollBody.params.arguments).toEqual({ jobId: 'job-1', sync: true });
    expect((pollOpts.headers as Record<string, string>)['mcp-session-id']).toBe('sess-abc');

    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'hero.png'));
    expect(bytes.length).toBeGreaterThan(0);
  });

  // ─── (b) video with start+end keyframes: media_upload PUT + media_confirm
  //     + medias roles start_image/end_image ─────────────────────────────

  it('renderHiggsfieldVideo: seedance_2_0 with start+end keyframes uploads both frames and sends medias roles start_image/end_image', async () => {
    await writeMcpFixture({ accessToken: 'hf-test-token-2', tokenType: 'Bearer', savedAt: Date.now() });
    await writeRefImages();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mcpResp(1, { protocolVersion: '2025-03-26' }, { sessionId: 'sess-vid' }))
      .mockResolvedValueOnce(okResp())
      // media_upload (start)
      .mockResolvedValueOnce(mcpResp(2, toolResult({
        uploads: [{ upload_url: 'https://upload.higgsfield.ai/start', media_id: 'media-start', url: 'https://cdn.higgsfield.ai/start.png', expires_in_seconds: 900, method: 'PUT', content_type: 'image/png' }],
      })))
      .mockResolvedValueOnce(okResp()) // PUT start
      .mockResolvedValueOnce(mcpResp(3, toolResult({}))) // media_confirm start
      // media_upload (end)
      .mockResolvedValueOnce(mcpResp(4, toolResult({
        uploads: [{ upload_url: 'https://upload.higgsfield.ai/end', media_id: 'media-end', url: 'https://cdn.higgsfield.ai/end.png', expires_in_seconds: 900, method: 'PUT', content_type: 'image/png' }],
      })))
      .mockResolvedValueOnce(okResp()) // PUT end
      .mockResolvedValueOnce(mcpResp(5, toolResult({}))) // media_confirm end
      .mockResolvedValueOnce(mcpResp(6, toolResult({ results: [{ id: 'job-vid-1', type: 'video', status: 'pending', model: 'seedance_2_0', params: {} }] })))
      .mockResolvedValueOnce(mcpResp(7, toolResult({
        generation: { id: 'job-vid-1', status: 'completed', results: { rawUrl: 'https://cdn.higgsfield.ai/out/clip.mp4' } },
      })))
      .mockResolvedValueOnce(bytesResp(FAKE_MP4, 'video/mp4'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'video',
      model: 'higgsfield/seedance_2_0',
      prompt: 'the components separate smoothly and float apart',
      image: 'start.png',
      endImage: 'end.png',
      output: 'clip.mp4',
    }));

    expect(result.providerId).toBe('higgsfield');

    const [uploadStartUrl, uploadStartOpts] = fetchMock.mock.calls[2]!;
    expect(String(uploadStartUrl)).toBe(MCP_URL);
    const uploadStartBody = JSON.parse(uploadStartOpts.body as string);
    expect(uploadStartBody.params.name).toBe('media_upload');
    expect(uploadStartBody.params.arguments.content_type).toBe('image/png');

    const [putStartUrl, putStartOpts] = fetchMock.mock.calls[3]!;
    expect(String(putStartUrl)).toBe('https://upload.higgsfield.ai/start');
    expect(putStartOpts.method).toBe('PUT');
    expect((putStartOpts.headers as Record<string, string>)['content-type']).toBe('image/png');

    const [, confirmStartOpts] = fetchMock.mock.calls[4]!;
    const confirmStartBody = JSON.parse(confirmStartOpts.body as string);
    expect(confirmStartBody.params.name).toBe('media_confirm');
    expect(confirmStartBody.params.arguments).toEqual({ type: 'image', media_id: 'media-start' });

    const [, confirmEndOpts] = fetchMock.mock.calls[7]!;
    const confirmEndBody = JSON.parse(confirmEndOpts.body as string);
    expect(confirmEndBody.params.arguments).toEqual({ type: 'image', media_id: 'media-end' });

    const [, genOpts] = fetchMock.mock.calls[8]!;
    const genBody = JSON.parse(genOpts.body as string);
    expect(genBody.params.name).toBe('generate_video');
    expect(genBody.params.arguments.params.model).toBe('seedance_2_0');
    expect(genBody.params.arguments.params.medias).toEqual([
      { value: 'media-start', role: 'start_image' },
      { value: 'media-end', role: 'end_image' },
    ]);
    expect(genBody.params.arguments.params.duration).toBe(5);

    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'clip.mp4'));
    expect(bytes.length).toBeGreaterThan(0);
  });

  // ─── (c) failed job → throws with detail ───────────────────────────────

  it('renderHiggsfieldImage: a non-completed/non-pending job_status throws including the failure detail', async () => {
    await writeMcpFixture({ accessToken: 'hf-test-token-3', tokenType: 'Bearer', savedAt: Date.now() });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mcpResp(1, { protocolVersion: '2025-03-26' }, { sessionId: 'sess-fail' }))
      .mockResolvedValueOnce(okResp())
      .mockResolvedValueOnce(mcpResp(2, toolResult({ results: [{ id: 'job-fail-1', type: 'image', status: 'pending', model: 'soul_2', params: {} }] })))
      .mockResolvedValueOnce(mcpResp(3, toolResult({
        generation: { id: 'job-fail-1', status: 'failed', error: 'NSFW content detected' },
      })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'higgsfield/soul_2',
      prompt: 'anything',
      output: 'fail.png',
    }))).rejects.toThrow(/NSFW content detected/);
  });

  // ─── (d) 401 once → refresh-then-retry succeeds ────────────────────────

  it('renderHiggsfieldImage: a 401 triggers exactly one refresh-then-retry, and the retry uses the fresh bearer', async () => {
    await writeMcpFixture({
      accessToken: 'hf-stale-token',
      refreshToken: 'hf-refresh-1',
      tokenType: 'Bearer',
      savedAt: Date.now(),
      tokenEndpoint: 'https://mcp.higgsfield.ai/oauth2/token',
      clientId: 'client-abc',
    });

    const fetchMock = vi.fn()
      // First attempt: initialize -> 401
      .mockResolvedValueOnce(unauthorizedResp())
      // Token refresh (hits the token endpoint, NOT the MCP endpoint)
      .mockResolvedValueOnce(tokenEndpointResp('hf-fresh-token'))
      // Retry: initialize -> notify -> generate_image -> job_status(completed) -> download
      .mockResolvedValueOnce(mcpResp(1, { protocolVersion: '2025-03-26' }, { sessionId: 'sess-retry' }))
      .mockResolvedValueOnce(okResp())
      .mockResolvedValueOnce(mcpResp(2, toolResult({ results: [{ id: 'job-retry-1', type: 'image', status: 'pending', model: 'soul_2', params: {} }] })))
      .mockResolvedValueOnce(mcpResp(3, toolResult({
        generation: { id: 'job-retry-1', status: 'completed', results: { rawUrl: 'https://cdn.higgsfield.ai/out/retry.png' } },
      })))
      .mockResolvedValueOnce(bytesResp(Buffer.from(PNG_BASE64, 'base64'), 'image/png'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'image',
      model: 'higgsfield/soul_2',
      prompt: 'anything',
      output: 'retry.png',
    }));

    expect(result.providerId).toBe('higgsfield');

    const [firstUrl, firstOpts] = fetchMock.mock.calls[0]!;
    expect(String(firstUrl)).toBe(MCP_URL);
    expect((firstOpts.headers as Record<string, string>).authorization).toBe('Bearer hf-stale-token');

    const [tokenUrl, tokenOpts] = fetchMock.mock.calls[1]!;
    expect(String(tokenUrl)).toBe('https://mcp.higgsfield.ai/oauth2/token');
    expect(tokenOpts.method).toBe('POST');
    expect(String(tokenOpts.body)).toContain('grant_type=refresh_token');
    expect(String(tokenOpts.body)).toContain('refresh_token=hf-refresh-1');

    const [, retryInitOpts] = fetchMock.mock.calls[2]!;
    expect((retryInitOpts.headers as Record<string, string>).authorization).toBe('Bearer hf-fresh-token');

    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'retry.png'));
    expect(bytes.length).toBeGreaterThan(0);

    // The refreshed token must be persisted so the next render doesn't 401 again.
    const tokensRaw = await readFile(path.join(projectRoot, '.od', 'mcp-tokens.json'), 'utf8');
    const tokens = JSON.parse(tokensRaw);
    expect(tokens.servers[HIGGSFIELD_SERVER_ID].accessToken).toBe('hf-fresh-token');
  });

  it('renderHiggsfieldImage: a 401 with no refresh_token on file surfaces an actionable reconnect message (no infinite retry)', async () => {
    await writeMcpFixture({ accessToken: 'hf-stale-token-2', tokenType: 'Bearer', savedAt: Date.now() });

    const fetchMock = vi.fn().mockResolvedValueOnce(unauthorizedResp());
    vi.stubGlobal('fetch', fetchMock);

    // withHiggsfieldAuth treats "nothing to refresh with" the same as a
    // rejected refresh (review finding #17) — both surface one actionable
    // message pointing at Settings, not the raw 401.
    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'higgsfield/soul_2',
      prompt: 'anything',
      output: 'noauth.png',
    }))).rejects.toThrow(/Settings.*MCP servers/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ─── (e) 401 -> refresh rejected by the token endpoint -> actionable
  //     message, not the raw upstream error (review finding #17) ─────────

  it('renderHiggsfieldImage: a 401 whose refresh token is rejected by the token endpoint surfaces an actionable reconnect message, not the raw token-endpoint error', async () => {
    await writeMcpFixture({
      accessToken: 'hf-stale-token-3',
      refreshToken: 'hf-refresh-revoked',
      tokenType: 'Bearer',
      savedAt: Date.now(),
      tokenEndpoint: 'https://mcp.higgsfield.ai/oauth2/token',
      clientId: 'client-revoked',
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unauthorizedResp())
      .mockResolvedValueOnce(new Response('invalid_grant', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'higgsfield/soul_2',
      prompt: 'anything',
      output: 'revoked.png',
    }))).rejects.toThrow(/Settings.*MCP servers/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // ─── concurrent 401s share one refresh (review finding #18) ────────────

  it('two concurrent renders that both 401 share exactly ONE token-endpoint refresh call, and both renders succeed', async () => {
    await writeMcpFixture({
      accessToken: 'hf-stale-token-concurrent',
      refreshToken: 'hf-refresh-concurrent',
      tokenType: 'Bearer',
      savedAt: Date.now(),
      tokenEndpoint: 'https://mcp.higgsfield.ai/oauth2/token',
      clientId: 'client-concurrent',
    });

    let tokenEndpointCalls = 0;
    const fetchMock = vi.fn(async (url: unknown, init: RequestInit = {}) => {
      const urlStr = String(url);
      if (urlStr === 'https://mcp.higgsfield.ai/oauth2/token') {
        tokenEndpointCalls += 1;
        return tokenEndpointResp('hf-fresh-token-concurrent');
      }
      if (urlStr === MCP_URL) {
        const authHeader = (init.headers as Record<string, string> | undefined)?.authorization;
        if (authHeader === 'Bearer hf-stale-token-concurrent') {
          return unauthorizedResp();
        }
        const body = JSON.parse(String(init.body));
        if (body.method === 'initialize') {
          return mcpResp(body.id, { protocolVersion: '2025-03-26' }, { sessionId: 'sess-concurrent' });
        }
        if (body.method === 'notifications/initialized') {
          return okResp();
        }
        if (body.params?.name === 'generate_image') {
          return mcpResp(body.id, toolResult({ results: [{ id: 'job-concurrent', type: 'image', status: 'pending', model: 'soul_2', params: {} }] }));
        }
        if (body.params?.name === 'job_status') {
          return mcpResp(body.id, toolResult({
            generation: { id: 'job-concurrent', status: 'completed', results: { rawUrl: 'https://cdn.higgsfield.ai/out/concurrent.png' } },
          }));
        }
      }
      if (urlStr === 'https://cdn.higgsfield.ai/out/concurrent.png') {
        return bytesResp(Buffer.from(PNG_BASE64, 'base64'), 'image/png');
      }
      throw new Error(`unexpected fetch in concurrent-refresh test: ${urlStr}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([
      generateMedia(baseArgs({ surface: 'image', model: 'higgsfield/soul_2', prompt: 'a', output: 'concurrent-a.png' })),
      generateMedia(baseArgs({ surface: 'image', model: 'higgsfield/soul_2', prompt: 'b', output: 'concurrent-b.png' })),
    ]);

    expect(a.providerId).toBe('higgsfield');
    expect(b.providerId).toBe('higgsfield');
    // The single-use refresh token would fail invalid_grant on a second
    // concurrent use — exactly one token-endpoint call proves the two 401s
    // shared the in-memory refresh instead of each firing their own.
    expect(tokenEndpointCalls).toBe(1);
  });

  // ─── MCP handshake error (review finding #19) ──────────────────────────

  it('renderHiggsfieldImage: an HTTP-200 JSON-RPC error on initialize throws "MCP handshake failed" instead of proceeding with a broken session', async () => {
    await writeMcpFixture({ accessToken: 'hf-handshake-token', tokenType: 'Bearer', savedAt: Date.now() });

    // A JSON-RPC error response (not a `result`) — mcpResp always builds a
    // `result` body, so this one is constructed by hand.
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32602, message: 'unsupported protocol version' },
    }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-handshake' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'higgsfield/soul_2',
      prompt: 'anything',
      output: 'handshake-fail.png',
    }))).rejects.toThrow(/MCP handshake failed.*unsupported protocol version/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ─── hand-edited server.url is honored (review finding #20) ────────────

  it('renderHiggsfieldImage: a hand-edited server.url (non-default path, same host) routes every MCP call through that URL instead of the hardcoded default', async () => {
    const customUrl = 'https://mcp.higgsfield.ai/custom-path/mcp';
    const configFile = path.join(projectRoot, '.od', 'mcp-config.json');
    await mkdir(path.dirname(configFile), { recursive: true });
    await writeFile(configFile, JSON.stringify({
      servers: [{
        id: HIGGSFIELD_SERVER_ID,
        label: 'Higgsfield (OpenClaw)',
        transport: 'http',
        enabled: true,
        url: customUrl,
      }],
    }), 'utf8');
    const tokensFile = path.join(projectRoot, '.od', 'mcp-tokens.json');
    await writeFile(tokensFile, JSON.stringify({
      servers: { [HIGGSFIELD_SERVER_ID]: { accessToken: 'hf-custom-url-token', tokenType: 'Bearer', savedAt: Date.now() } },
    }), 'utf8');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mcpResp(1, { protocolVersion: '2025-03-26' }, { sessionId: 'sess-custom' }))
      .mockResolvedValueOnce(okResp())
      .mockResolvedValueOnce(mcpResp(2, toolResult({ results: [{ id: 'job-custom', type: 'image', status: 'pending', model: 'soul_2', params: {} }] })))
      .mockResolvedValueOnce(mcpResp(3, toolResult({
        generation: { id: 'job-custom', status: 'completed', results: { rawUrl: 'https://cdn.higgsfield.ai/out/custom.png' } },
      })))
      .mockResolvedValueOnce(bytesResp(Buffer.from(PNG_BASE64, 'base64'), 'image/png'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'image',
      model: 'higgsfield/soul_2',
      prompt: 'anything',
      output: 'custom-url.png',
    }));

    expect(result.providerId).toBe('higgsfield');
    for (const call of fetchMock.mock.calls.slice(0, 3)) {
      expect(String(call[0])).toBe(customUrl);
    }
  });

  it('renderHiggsfieldImage: a stored http:// baseUrl override is refused before any network call (bearer must never travel cleartext)', async () => {
    await writeMcpFixture({ accessToken: 'hf-cleartext-token', tokenType: 'Bearer', savedAt: Date.now() });
    // Stored provider config wins over the MCP-derived URL in
    // resolveProviderConfig — an http:// entry here must not receive the token.
    await writeFile(path.join(projectRoot, '.od', 'media-config.json'), JSON.stringify({
      providers: { higgsfield: { baseUrl: 'http://mcp.higgsfield.ai/mcp' } },
    }), 'utf8');

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'higgsfield/soul_2',
      prompt: 'anything',
      output: 'cleartext.png',
    }))).rejects.toThrow(/https/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ─── multi-event SSE parsing (review finding #21) ──────────────────────

  it('parses a multi-event SSE response body, taking the LAST data: line rather than the first', async () => {
    await writeMcpFixture({ accessToken: 'hf-sse-multi-token', tokenType: 'Bearer', savedAt: Date.now() });

    const firstEvent = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 'stale-should-be-ignored' } });
    const lastEvent = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } });
    const multiEventBody = `event: message\ndata: ${firstEvent}\n\nevent: message\ndata: ${lastEvent}\n\n`;

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(multiEventBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-multi' },
      }))
      .mockResolvedValueOnce(okResp())
      .mockResolvedValueOnce(mcpResp(2, toolResult({ results: [{ id: 'job-multi', type: 'image', status: 'pending', model: 'soul_2', params: {} }] })))
      .mockResolvedValueOnce(mcpResp(3, toolResult({
        generation: { id: 'job-multi', status: 'completed', results: { rawUrl: 'https://cdn.higgsfield.ai/out/multi.png' } },
      })))
      .mockResolvedValueOnce(bytesResp(Buffer.from(PNG_BASE64, 'base64'), 'image/png'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'image',
      model: 'higgsfield/soul_2',
      prompt: 'anything',
      output: 'multi.png',
    }));

    expect(result.providerId).toBe('higgsfield');
  });

  // ─── non-terminal status drift insurance (review finding #23) ──────────

  it('renderHiggsfieldVideo: a "generating" job_status keeps polling instead of failing (upstream status-name drift insurance)', async () => {
    await writeMcpFixture({ accessToken: 'hf-generating-token', tokenType: 'Bearer', savedAt: Date.now() });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mcpResp(1, { protocolVersion: '2025-03-26' }, { sessionId: 'sess-generating' }))
      .mockResolvedValueOnce(okResp())
      .mockResolvedValueOnce(mcpResp(2, toolResult({ results: [{ id: 'job-generating', type: 'video', status: 'pending', model: 'seedance_2_0_mini', params: {} }] })))
      .mockResolvedValueOnce(mcpResp(3, toolResult({ generation: { id: 'job-generating', status: 'generating' } })))
      .mockResolvedValueOnce(mcpResp(4, toolResult({
        generation: { id: 'job-generating', status: 'completed', results: { rawUrl: 'https://cdn.higgsfield.ai/out/generating.mp4' } },
      })))
      .mockResolvedValueOnce(bytesResp(FAKE_MP4, 'video/mp4'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateMedia(baseArgs({
      surface: 'video',
      model: 'higgsfield/seedance_2_0_mini',
      prompt: 'anything',
      output: 'generating.mp4',
    }));

    expect(result.providerId).toBe('higgsfield');
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  // ─── guardrails ─────────────────────────────────────────────────────────

  it('no configured Higgsfield MCP connection throws a clear, actionable error (no network call)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'higgsfield/soul_2',
      prompt: 'anything',
      output: 'nocreds.png',
    }))).rejects.toThrow(/Higgsfield MCP connection|Settings/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a disabled higgsfield MCP server is treated as unconfigured', async () => {
    await writeMcpFixture({ accessToken: 'hf-disabled-token', tokenType: 'Bearer', savedAt: Date.now() }, { enabled: false });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia(baseArgs({
      surface: 'image',
      model: 'higgsfield/soul_2',
      prompt: 'anything',
      output: 'disabled.png',
    }))).rejects.toThrow(/Higgsfield MCP connection|Settings/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
