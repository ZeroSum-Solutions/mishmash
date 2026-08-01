// Regression tests for two i2i bugs found by code recon (Storyboard spec
// Phase B): both renderers declared an `i2i`-capable model in the catalog
// but silently ignored `ctx.imageRef`, so passing --image produced an
// unrelated fresh text-to-image instead of an edit.
//
//   - renderOpenAIImage (real `openai` provider, e.g. gpt-image-2) now
//     routes to /v1/images/edits when an image is supplied, mirroring the
//     existing renderCustomOpenAIImage edit branch.
//   - renderVolcengineImage (doubao-seededit-3.0) now passes `image` on the
//     same /images/generations endpoint — Ark's image API unifies
//     generate/edit behind one endpoint, keyed off the presence of `image`.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateMedia } from '../../src/media/index.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2uoAAAAASUVORK5CYII=';

const ENV_KEYS_TO_ISOLATE = [
  'OD_OPENAI_API_KEY',
  'OPENAI_API_KEY',
  'AZURE_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'OD_VOLCENGINE_API_KEY',
  'ARK_API_KEY',
  'VOLCENGINE_API_KEY',
  'OD_MEDIA_CONFIG_DIR',
  'OD_DATA_DIR',
  'CODEX_BIN',
  'CODEX_HOME',
];

describe('i2i fixes — renderOpenAIImage + renderVolcengineImage', () => {
  let root: string;
  let projectRoot: string;
  let projectsRoot: string;
  const realFetch = globalThis.fetch;
  const originalEnv = Object.fromEntries(ENV_KEYS_TO_ISOLATE.map((key) => [key, process.env[key]]));

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'od-image-edit-fixes-'));
    projectRoot = path.join(root, 'project-root');
    projectsRoot = path.join(projectRoot, '.od', 'projects');
    await mkdir(projectsRoot, { recursive: true });
    // Isolate from this machine's real media-config/provider-key env so the
    // test's own writeConfig() (below) is the only credential source —
    // otherwise a real OD_DATA_DIR / OD_MEDIA_CONFIG_DIR redirects reads
    // away from the temp project dir entirely.
    for (const key of ENV_KEYS_TO_ISOLATE) delete process.env[key];
    // gpt-image-2 has a codex-gpt-image-2 subscription equivalent
    // (codexSubscriptionEquivalent in media/index.ts); resolveCodexSubscriptionStatus
    // falls back to the REAL `~/.codex/auth.json` when CODEX_HOME is unset,
    // and on this machine that auth file is a real, live ChatGPT Codex
    // subscription — which would route these tests through a real `codex`
    // CLI subprocess instead of renderOpenAIImage. Point CODEX_HOME at an
    // empty temp dir so resolveCodexSubscriptionStatus sees no auth.json
    // and the real openai code path (renderOpenAIImage) runs instead.
    process.env.CODEX_HOME = path.join(root, 'codex-home-empty');
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

  async function writeConfig(data: unknown) {
    const file = path.join(projectRoot, '.od', 'media-config.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data), 'utf8');
  }

  async function writeRefImage(name = 'reference.png') {
    const projectDir = path.join(projectsRoot, 'project-1');
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, name), Buffer.from(PNG_BASE64, 'base64'));
  }

  it('renderOpenAIImage: text-only gpt-image-2 request still hits /v1/images/generations (no regression)', async () => {
    await writeConfig({ providers: { openai: { apiKey: 'sk-test' } } });

    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.openai.com/v1/images/generations');
      const body = JSON.parse(String(init?.body));
      expect(body.images).toBeUndefined();
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), {
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
      model: 'gpt-image-2',
      prompt: 'A clean product render',
      output: 'text-only.png',
    });

    expect(result.providerId).toBe('openai');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renderOpenAIImage: --image on gpt-image-2 routes to /v1/images/edits as multipart with the image attached', async () => {
    await writeConfig({ providers: { openai: { apiKey: 'sk-test' } } });
    await writeRefImage();

    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.openai.com/v1/images/edits');
      expect(init?.method).toBe('POST');
      // The real OpenAI /v1/images/edits endpoint requires multipart/form-data
      // with the image as an uploaded file — the old JSON
      // {images:[{image_url}]} shape 400s against the real API.
      expect(init?.body).toBeInstanceOf(FormData);
      // fetch derives the multipart boundary itself; content-type must not be
      // set by hand (an explicit value here would omit/mismatch the boundary).
      expect((init?.headers as Record<string, string>)?.['content-type']).toBeUndefined();
      const form = init!.body as FormData;
      expect(form.get('model')).toBe('gpt-image-2');
      expect(form.get('prompt')).toBe('Edit the start image so the subject and lighting stay identical');
      const imagePart = form.get('image');
      expect(imagePart).toBeInstanceOf(Blob);
      expect((imagePart as File).name).toBe('image.png');
      expect((imagePart as Blob).type).toBe('image/png');
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), {
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
      model: 'gpt-image-2',
      prompt: 'Edit the start image so the subject and lighting stay identical',
      image: 'reference.png',
      output: 'edited.png',
    });

    expect(result.providerId).toBe('openai');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'edited.png'));
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('renderVolcengineImage: text-only seededit-3.0 request omits `image` (no regression)', async () => {
    await writeConfig({ providers: { volcengine: { apiKey: 'ark-test' } } });

    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations');
      const body = JSON.parse(String(init?.body));
      expect(body.image).toBeUndefined();
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), {
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
      model: 'doubao-seededit-3-0-i2i-250628',
      prompt: 'A clean product render',
      output: 'text-only.png',
    });

    expect(result.providerId).toBe('volcengine');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('renderVolcengineImage: --image on seededit-3.0 passes `image` on the same generations endpoint', async () => {
    await writeConfig({ providers: { volcengine: { apiKey: 'ark-test' } } });
    await writeRefImage();

    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      expect(String(input)).toBe('https://ark.cn-beijing.volces.com/api/v3/images/generations');
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('doubao-seededit-3-0-i2i-250628');
      expect(body.image).toMatch(/^data:image\/png;base64,/);
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_BASE64 }] }), {
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
      model: 'doubao-seededit-3-0-i2i-250628',
      prompt: 'Edit the start image so the subject and lighting stay identical',
      image: 'reference.png',
      output: 'edited.png',
    });

    expect(result.providerId).toBe('volcengine');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const bytes = await readFile(path.join(projectsRoot, 'project-1', 'edited.png'));
    expect(bytes.length).toBeGreaterThan(0);
  });
});
