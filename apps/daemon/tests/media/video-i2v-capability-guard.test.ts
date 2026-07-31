// Regression tests for the dispatcher-level i2v capability guard in
// generateMedia() (apps/daemon/src/media/index.ts).
//
// renderVolcengineVideo / renderGrokVideo / renderFalVideo all splice a
// supplied reference image into their wire request gated only on
// `ctx.imageRef` truthiness — none of them checked the selected model's
// declared caps. So a t2v-only catalog model (e.g.
// doubao-seedance-1-0-lite-t2v-250428, wan-2.1-t2v) would silently get an
// image attached to a request the model never declared support for. These
// tests assert generateMedia() now rejects that combination up front, before
// any network call, and that i2v-capable models are unaffected (the image
// still goes out on the wire exactly as before).

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateMedia } from '../../src/media/index.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2uoAAAAASUVORK5CYII=';

describe('video i2v capability guard', () => {
  let root: string;
  let projectRoot: string;
  let projectsRoot: string;
  const realFetch = globalThis.fetch;
  const originalVolcengineKey = process.env.OD_VOLCENGINE_API_KEY;
  const originalFalKey = process.env.OD_FAL_KEY;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-video-i2v-guard-'));
    projectRoot = path.join(root, 'project-root');
    projectsRoot = path.join(projectRoot, '.od', 'projects');
    await mkdir(projectsRoot, { recursive: true });
    delete process.env.OD_VOLCENGINE_API_KEY;
    delete process.env.OD_FAL_KEY;
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    vi.unstubAllGlobals();
    if (originalVolcengineKey == null) delete process.env.OD_VOLCENGINE_API_KEY;
    else process.env.OD_VOLCENGINE_API_KEY = originalVolcengineKey;
    if (originalFalKey == null) delete process.env.OD_FAL_KEY;
    else process.env.OD_FAL_KEY = originalFalKey;
    await rm(root, { recursive: true, force: true });
  });

  async function writeRefImage(name = 'ref.png') {
    const projectDir = path.join(projectsRoot, 'project-1');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, name), Buffer.from(PNG_BASE64, 'base64'));
  }

  it('rejects --image for a t2v-only Volcengine model before any network call', async () => {
    await writeRefImage();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia({
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
      surface: 'video',
      model: 'doubao-seedance-1-0-lite-t2v-250428', // caps: ['t2v'] only
      prompt: 'a cat blinking slowly',
      image: 'ref.png',
      output: 'out.mp4',
    })).rejects.toThrow(
      /doubao-seedance-1-0-lite-t2v-250428 is a text-to-video model \(caps: t2v\) and can't take a reference image/,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects --image for a t2v-only Fal model before any network call', async () => {
    await writeRefImage();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia({
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
      surface: 'video',
      model: 'wan-2.1-t2v', // Fal · caps: ['t2v'] only
      prompt: 'a cat blinking slowly',
      image: 'ref.png',
      output: 'out.mp4',
    })).rejects.toThrow(
      /wan-2\.1-t2v is a text-to-video model \(caps: t2v\) and can't take a reference image/,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still splices the reference image for an i2v-capable Volcengine model (no regression)', async () => {
    process.env.OD_VOLCENGINE_API_KEY = 'ark-test-key';
    await writeRefImage();

    let capturedBody: any;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      // Fail fast so the test doesn't have to sit through the real poll
      // loop — we only need to prove the guard let the request through with
      // the image attached exactly as before.
      return new Response('boom', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia({
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
      surface: 'video',
      model: 'doubao-seedance-2-0-260128', // caps: ['t2v', 'i2v', 'audio']
      prompt: 'a cat blinking slowly',
      image: 'ref.png',
      output: 'out.mp4',
    })).rejects.toThrow(/volcengine task create 500/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedBody.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'image_url',
          image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
        }),
      ]),
    );
  });
});
