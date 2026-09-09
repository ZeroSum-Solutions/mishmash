// Red spec: extension/MIME/magic-byte agreement and the ZIP central-
// directory inspector. Every hostile shape is rejected with a typed reason,
// nothing is extracted, and nothing lands under the project root; every
// accepted kind in the closed set uploads and commits cleanly.
//
// RED on base (8487362f0): no inspector and no staged route exist — every
// assertion in this file 404s against `POST .../uploads` on base, which is
// the behavioral symptom (no such capability), not a compile error.
import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';
import * as fx from './fixtures/w7-uploads/generate.js';

describe('project upload mime mismatch', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function createProject(): Promise<string> {
    const id = `upload-mime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: id }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { project: { id: string } };
    return body.project.id;
  }

  async function attemptUpload(projectId: string, name: string, mime: string, bytes: Buffer) {
    const createResp = await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ name, size: bytes.length, mime }] }),
    });
    if (createResp.status !== 200) {
      return { createResp, putResp: null as Response | null };
    }
    const session = (await createResp.json()) as { uploadId: string; token: string };
    const putResp = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${session.uploadId}/files/0`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    return { createResp, putResp };
  }

  async function listedNames(projectId: string): Promise<string[]> {
    const resp = await fetch(`${baseUrl}/api/projects/${projectId}/files`);
    const body = (await resp.json()) as { files: { name: string }[] };
    return body.files.map((f) => f.name);
  }

  it('rejects a .png whose bytes are actually a JPEG', async () => {
    const projectId = await createProject();
    const { putResp } = await attemptUpload(projectId, 'fake.png', 'image/png', fx.validJpeg());
    expect(putResp?.status).toBe(415);
    const body = (await putResp!.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.message.toLowerCase()).toContain('png');
    expect(await listedNames(projectId)).not.toContain('fake.png');
  });

  it('rejects a ZIP with a path-traversal entry', async () => {
    const projectId = await createProject();
    const zip = fx.zipWithTraversalEntry();
    const { putResp } = await attemptUpload(projectId, 'evil.zip', 'application/zip', zip);
    expect(putResp?.status).toBe(415);
    const body = (await putResp!.json()) as { error: { message: string } };
    expect(body.error.message.toLowerCase()).toContain('traversal');
    expect(await listedNames(projectId)).not.toContain('evil.zip');
  });

  it('rejects a ZIP with a symlink entry', async () => {
    const projectId = await createProject();
    const { putResp } = await attemptUpload(projectId, 'evil.zip', 'application/zip', fx.zipWithSymlinkEntry());
    expect(putResp?.status).toBe(415);
    const body = (await putResp!.json()) as { error: { message: string } };
    expect(body.error.message.toLowerCase()).toContain('symlink');
  });

  it('rejects a ZIP with an extreme compression ratio (zip-bomb signature)', async () => {
    const projectId = await createProject();
    const { putResp } = await attemptUpload(projectId, 'bomb.zip', 'application/zip', fx.zipWithExtremeRatioEntry());
    expect(putResp?.status).toBe(415);
    const body = (await putResp!.json()) as { error: { message: string } };
    expect(body.error.message.toLowerCase()).toContain('ratio');
  });

  it('rejects an encrypted ZIP entry', async () => {
    const projectId = await createProject();
    const { putResp } = await attemptUpload(projectId, 'secret.zip', 'application/zip', fx.encryptedZip());
    expect(putResp?.status).toBe(415);
    const body = (await putResp!.json()) as { error: { message: string } };
    expect(body.error.message.toLowerCase()).toContain('encrypted');
  });

  it('rejects a ZIP with an absolute path entry', async () => {
    const projectId = await createProject();
    const { putResp } = await attemptUpload(projectId, 'evil.zip', 'application/zip', fx.zipWithAbsolutePathEntry());
    expect(putResp?.status).toBe(415);
    const body = (await putResp!.json()) as { error: { message: string } };
    expect(body.error.message.toLowerCase()).toContain('absolute');
  });

  it('rejects a ZIP with a truncated/malformed central directory', async () => {
    const projectId = await createProject();
    const { putResp } = await attemptUpload(projectId, 'evil.zip', 'application/zip', fx.zipWithTruncatedCentralDirectory());
    expect(putResp?.status).toBe(415);
    const body = (await putResp!.json()) as { error: { message: string } };
    expect(body.error.message.toLowerCase()).toMatch(/malformed|truncated/);
  });

  it('rejects a ZIP64 archive', async () => {
    const projectId = await createProject();
    const { putResp } = await attemptUpload(projectId, 'huge.zip', 'application/zip', fx.zip64Zip());
    expect(putResp?.status).toBe(415);
    const body = (await putResp!.json()) as { error: { message: string } };
    expect(body.error.message.toLowerCase()).toContain('zip64');
  });

  const acceptedCases: [string, string, () => Buffer][] = [
    ['ok.png', 'image/png', fx.validPng],
    ['ok.jpg', 'image/jpeg', fx.validJpeg],
    ['ok.gif', 'image/gif', fx.validGif],
    ['ok.webp', 'image/webp', fx.validWebp],
    ['ok.svg', 'image/svg+xml', fx.validSvg],
    ['ok.mp4', 'video/mp4', fx.validMp4],
    ['ok.webm', 'video/webm', fx.validWebm],
    ['ok.mov', 'video/quicktime', fx.validMov],
    ['ok.mp3', 'audio/mpeg', fx.validMp3],
    ['ok.wav', 'audio/wav', fx.validWav],
    ['ok.pdf', 'application/pdf', fx.validPdf],
    ['ok.html', 'text/html', fx.validText],
    ['ok.css', 'text/css', fx.validText],
    ['ok.js', 'text/javascript', fx.validText],
    ['ok.ts', 'text/typescript', fx.validText],
    ['ok.json', 'application/json', fx.validText],
    ['ok.md', 'text/markdown', fx.validText],
    ['ok.txt', 'text/plain', fx.validText],
    ['ok.zip', 'application/zip', fx.validZip],
  ];

  for (const [name, mime, make] of acceptedCases) {
    it(`accepts and commits a well-formed .${name.split('.').pop()}`, async () => {
      const projectId = await createProject();
      const bytes = make();
      const { createResp, putResp } = await attemptUpload(projectId, name, mime, bytes);
      expect(createResp.status).toBe(200);
      expect(putResp?.status).toBe(200);
      // Promotion happens synchronously once every file validates; poll
      // briefly for the rename to land (fsync + rename is fast, but async).
      let names: string[] = [];
      for (let i = 0; i < 20; i += 1) {
        names = await listedNames(projectId);
        if (names.includes(name)) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(names).toContain(name);
    });
  }
});
