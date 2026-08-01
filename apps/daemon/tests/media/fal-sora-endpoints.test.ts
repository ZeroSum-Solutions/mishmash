// Regression test: FAL_ENDPOINTS (apps/daemon/src/media/index.ts) used to map
// both 'sora-2' and 'sora-2-pro' to the identical 'fal-ai/sora' path, so
// picking the Pro tier silently produced the exact same request as the base
// model. Assert the two catalog ids now resolve to distinct, real fal.ai
// endpoints (verified against fal.ai's current Sora 2 API docs:
// fal-ai/sora-2/text-to-video and fal-ai/sora-2/text-to-video/pro).

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateMedia } from '../../src/media/index.js';

describe('fal sora-2 / sora-2-pro endpoint distinction', () => {
  let root: string;
  let projectRoot: string;
  let projectsRoot: string;
  const realFetch = globalThis.fetch;
  const originalFalKey = process.env.OD_FAL_KEY;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-fal-sora-'));
    projectRoot = path.join(root, 'project-root');
    projectsRoot = path.join(projectRoot, '.od', 'projects');
    await mkdir(projectsRoot, { recursive: true });
    process.env.OD_FAL_KEY = 'fal-test-key';
  });

  afterEach(async () => {
    globalThis.fetch = realFetch;
    vi.unstubAllGlobals();
    if (originalFalKey == null) delete process.env.OD_FAL_KEY;
    else process.env.OD_FAL_KEY = originalFalKey;
    await rm(root, { recursive: true, force: true });
  });

  async function submitUrlFor(model: string): Promise<string> {
    let submittedUrl = '';
    const fetchMock = vi.fn(async (input: unknown) => {
      submittedUrl = String(input);
      // Fail fast — this test only needs the submit URL, not a full
      // submit/poll/download cycle.
      return new Response('boom', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateMedia({
      projectRoot,
      projectsRoot,
      projectId: 'project-1',
      surface: 'video',
      model,
      prompt: 'a slow dolly through a neon alley',
      output: `${model}.mp4`,
    })).rejects.toThrow();

    return submittedUrl;
  }

  it('routes sora-2 and sora-2-pro to distinct fal.ai endpoints', async () => {
    const soraUrl = await submitUrlFor('sora-2');
    const soraProUrl = await submitUrlFor('sora-2-pro');

    expect(soraUrl).toBe('https://queue.fal.run/fal-ai/sora-2/text-to-video');
    expect(soraProUrl).toBe('https://queue.fal.run/fal-ai/sora-2/text-to-video/pro');
    expect(soraUrl).not.toBe(soraProUrl);
  });
});
