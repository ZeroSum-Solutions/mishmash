// Red spec: an over-limit file is rejected with a 413 that NAMES the limit
// in bytes, on both the legacy multipart route and the new staged route,
// nothing is listed or left on disk, and the two routes' limit agrees with
// what `GET /api/projects/:id/uploads/limits` publishes.
//
// RED on base (8487362f0): `POST .../uploads` (the staged route) does not
// exist -> 404, and the legacy route's 413 message ("file too large") names
// no number at all — this test's own assertions on `message` failed for
// exactly that behavioral reason, not an import or compile error.
//
// The limit is overridden to a tiny value (1024 bytes) via
// OD_UPLOAD_MAX_FILE_BYTES, set BEFORE the server module is imported (a
// dynamic import, so the module-level multer `limits.fileSize` picks it up)
// so the fixture bytes stay small instead of needing a real 200 MiB file.
import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.OD_UPLOAD_MAX_FILE_BYTES = '1024';
process.env.OD_UPLOAD_MAX_FILES = '12';

const { startServer } = await import('../src/server.js');

describe('project upload oversize', () => {
  let server: http.Server;
  let baseUrl: string;
  const LIMIT = 1024;

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
    const id = `upload-oversize-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: id }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { project: { id: string } };
    return body.project.id;
  }

  it('publishes the same limit the routes enforce', async () => {
    const projectId = await createProject();
    const resp = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/limits`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { maxFileBytes: number };
    expect(body.maxFileBytes).toBe(LIMIT);
  });

  it('legacy route: 413 names the limit in bytes and leaves nothing on disk', async () => {
    const projectId = await createProject();
    const oversized = 'x'.repeat(LIMIT + 1);

    const form = new FormData();
    form.append('files', new Blob([oversized], { type: 'text/plain' }), 'big.txt');
    const resp = await fetch(`${baseUrl}/api/projects/${projectId}/upload`, {
      method: 'POST',
      body: form,
    });
    expect(resp.status).toBe(413);
    const body = (await resp.json()) as { error: { code: string; message: string; details?: { limitBytes?: number } } };
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.message).toContain(String(LIMIT));
    expect(body.error.details?.limitBytes).toBe(LIMIT);

    const listed = await fetch(`${baseUrl}/api/projects/${projectId}/files`);
    const listedBody = (await listed.json()) as { files: { name: string }[] };
    expect(listedBody.files.find((f) => f.name === 'big.txt')).toBeUndefined();
  });

  it('staged route: create rejects an over-limit file up front, naming the limit', async () => {
    const projectId = await createProject();
    const createResp = await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ name: 'big.bin', size: LIMIT + 1, mime: 'application/octet-stream' }] }),
    });
    expect(createResp.status).toBe(413);
    const body = (await createResp.json()) as { error: { code: string; message: string; details?: { limitBytes?: number } } };
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.message).toContain(String(LIMIT));
    expect(body.error.details?.limitBytes).toBe(LIMIT);
  });

  it('staged route: a stream that exceeds the limit is rejected mid-transfer and nothing lands', async () => {
    const projectId = await createProject();
    // Declared size is under the limit so the session is created; the
    // ACTUAL bytes streamed exceed it — the daemon must enforce the byte
    // ceiling as bytes arrive, not just trust the declared size.
    const createResp = await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ name: 'sneaky.txt', size: 10, mime: 'text/plain' }] }),
    });
    expect(createResp.status).toBe(200);
    const session = (await createResp.json()) as { uploadId: string; token: string };

    const oversized = 'y'.repeat(LIMIT + 1);
    const putResp = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${session.uploadId}/files/0`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'text/plain' },
      body: oversized,
    });
    expect(putResp.status).toBe(413);

    const listed = await fetch(`${baseUrl}/api/projects/${projectId}/files`);
    const listedBody = (await listed.json()) as { files: { name: string }[] };
    expect(listedBody.files.find((f) => f.name === 'sneaky.txt')).toBeUndefined();
  });
});
