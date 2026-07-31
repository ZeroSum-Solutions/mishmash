// Regression tests for the Seedance start/end keyframe-pair workflow added
// to generateMedia() (apps/daemon/src/media/index.ts): `endImage` resolves
// the same way as `image` (resolveProjectImage) into `ctx.endImageRef`, and
// only the Volcengine + OpenRouter Seedance 2.0 catalog models (the ones
// carrying the `kf` capability, apps/daemon/src/media/models.ts) accept it.
//
// Companion to tests/media/video-i2v-capability-guard.test.ts, which covers
// the pre-existing i2v-only guard this feature composes with.

import type http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateMedia } from '../../src/media/index.js';
import { closeDatabase, insertProject, openDatabase } from '../../src/db.js';
import { startServer } from '../../src/server.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2uoAAAAASUVORK5CYII=';

describe('Seedance start/end keyframe pairs — generateMedia', () => {
  let root: string;
  let projectRoot: string;
  let projectsRoot: string;
  const realFetch = globalThis.fetch;
  const originalVolcengineKey = process.env.OD_VOLCENGINE_API_KEY;
  const originalOpenRouterKey = process.env.OD_OPENROUTER_API_KEY;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-keyframe-pairs-'));
    projectRoot = path.join(root, 'project-root');
    projectsRoot = path.join(projectRoot, '.od', 'projects');
    await mkdir(projectsRoot, { recursive: true });
    delete process.env.OD_VOLCENGINE_API_KEY;
    delete process.env.OD_OPENROUTER_API_KEY;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    vi.unstubAllGlobals();
    if (originalVolcengineKey == null) delete process.env.OD_VOLCENGINE_API_KEY;
    else process.env.OD_VOLCENGINE_API_KEY = originalVolcengineKey;
    if (originalOpenRouterKey == null) delete process.env.OD_OPENROUTER_API_KEY;
    else process.env.OD_OPENROUTER_API_KEY = originalOpenRouterKey;
    await rm(root, { recursive: true, force: true });
  });

  async function writeRefImages() {
    const projectDir = path.join(projectsRoot, 'project-1');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, 'start.png'), Buffer.from(PNG_BASE64, 'base64'));
    await writeFile(path.join(projectDir, 'end.png'), Buffer.from(PNG_BASE64, 'base64'));
  }

  it('Volcengine: image-only stays role-less (byte-identical to the pre-existing behavior)', async () => {
    process.env.OD_VOLCENGINE_API_KEY = 'ark-test-key';
    await writeRefImages();

    let capturedBody: any;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response('boom', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia({
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
      surface: 'video',
      model: 'doubao-seedance-2-0-260128',
      prompt: 'a cat blinking slowly',
      image: 'start.png',
      output: 'out.mp4',
    })).rejects.toThrow(/volcengine task create 500/);

    expect(capturedBody.content).toHaveLength(2);
    expect(capturedBody.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
    });
    expect(capturedBody.content[1].role).toBeUndefined();
  });

  it('Volcengine: image + endImage adds first_frame/last_frame roles', async () => {
    process.env.OD_VOLCENGINE_API_KEY = 'ark-test-key';
    await writeRefImages();

    let capturedBody: any;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response('boom', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia({
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
      surface: 'video',
      model: 'doubao-seedance-2-0-260128',
      prompt: 'the components separate smoothly and float apart',
      image: 'start.png',
      endImage: 'end.png',
      output: 'out.mp4',
    })).rejects.toThrow(/volcengine task create 500/);

    expect(capturedBody.content).toHaveLength(3);
    expect(capturedBody.content[1]).toEqual({
      type: 'image_url',
      image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
      role: 'first_frame',
    });
    expect(capturedBody.content[2]).toEqual({
      type: 'image_url',
      image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
      role: 'last_frame',
    });
  });

  it('OpenRouter: image + endImage appends a last_frame frame_images entry', async () => {
    process.env.OD_OPENROUTER_API_KEY = 'or-test-key';
    await writeRefImages();

    let capturedBody: any;
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe('https://openrouter.ai/api/v1/videos');
      capturedBody = JSON.parse(String(init?.body));
      return new Response('boom', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia({
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
      surface: 'video',
      model: 'openrouter/bytedance/seedance-2.0:1080p',
      prompt: 'the components separate smoothly and float apart',
      image: 'start.png',
      endImage: 'end.png',
      output: 'out.mp4',
    })).rejects.toThrow(/openrouter video submit 500/);

    expect(capturedBody.frame_images).toEqual([
      {
        type: 'image_url',
        image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
        frame_type: 'first_frame',
      },
      {
        type: 'image_url',
        image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
        frame_type: 'last_frame',
      },
    ]);
  });

  it('rejects endImage without image before any network call', async () => {
    await writeRefImages();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia({
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
      surface: 'video',
      model: 'doubao-seedance-2-0-260128',
      prompt: 'a cat blinking slowly',
      endImage: 'end.png',
      output: 'out.mp4',
    })).rejects.toThrow(/endImage requires image/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects endImage for a model without the kf capability before any network call', async () => {
    process.env.OD_VOLCENGINE_API_KEY = 'ark-test-key';
    await writeRefImages();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia({
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
      surface: 'video',
      // caps: ['i2v'] — i2v-capable but not a Seedance 2.0 kf model.
      model: 'doubao-seedance-1-0-lite-i2v-250428',
      prompt: 'a cat blinking slowly',
      image: 'start.png',
      endImage: 'end.png',
      output: 'out.mp4',
    })).rejects.toThrow(/does not support an end \(last\) keyframe/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects endImage for a t2v/i2v Fal model (no kf support at all) before any network call', async () => {
    await writeRefImages();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia({
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
      surface: 'video',
      model: 'wan-2.1-i2v',
      prompt: 'a cat blinking slowly',
      image: 'start.png',
      endImage: 'end.png',
      output: 'out.mp4',
    })).rejects.toThrow(/does not support an end \(last\) keyframe/);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Seedance start/end keyframe pairs — route validation', () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
    closeDatabase();
  });

  it('POST /api/projects/:id/media/generate 400s when endImage is set without image', async () => {
    const dataDir = process.env.OD_DATA_DIR;
    const db = openDatabase(process.cwd(), dataDir === undefined ? {} : { dataDir });
    const projectId = `project_${randomUUID()}`;
    const now = Date.now();
    insertProject(db, {
      id: projectId,
      name: 'Keyframe pair route test project',
      createdAt: now,
      updatedAt: now,
    });

    const started = await startServer({ port: 0, returnServer: true }) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const response = await fetch(`${started.url}/api/projects/${encodeURIComponent(projectId)}/media/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        surface: 'video',
        model: 'doubao-seedance-2-0-260128',
        prompt: 'a cat blinking slowly',
        endImage: 'end.png',
      }),
    });
    const body = await response.json() as { error?: { message?: string } | string };

    expect(response.status).toBe(400);
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toMatch(/end frame requires start frame/);
  });
});
