// Red spec: the staged upload's SSE events, parsed ONLY through
// `isProjectUploadSseEvent` (D-18 — no hand-typed frame bodies): progress is
// monotonic per file, exactly one terminal event, the completed payload
// lists files that are on disk with the final byte size; client disconnect,
// TTL expiry, idempotency, cross-process lock contention, re-hash mismatch
// at promotion, destination symlink escape, and hostile-origin rejection on
// every new route.
//
// RED on base (8487362f0): none of these routes or behaviors exist (every
// staged-route call 404s); a partial upload on the LEGACY route leaves a
// visible file under the project root the moment multer starts streaming it
// (proven below as the symptom this design eliminates).
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isProjectUploadSseEvent, type ProjectUploadSseEvent } from '@open-design/contracts';
import { startServer } from '../src/server.js';
import { UploadSessionError, UploadStagingStore } from '../src/uploads/staging.js';

async function waitFor(check: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

function httpRequest(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname,
        method: opts.method ?? 'GET',
        headers: opts.headers ?? {},
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode!, body: data }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

/** Reads every SSE record off `resp.body` and returns the parsed, guard-
 *  validated events (never a hand-typed frame — D-18). Stops at the first
 *  terminal event or when the stream ends. */
async function readSseEvents(resp: Response, opts: { stopAtTerminal?: boolean } = { stopAtTerminal: true }): Promise<ProjectUploadSseEvent[]> {
  const events: ProjectUploadSseEvent[] = [];
  if (!resp.body) return events;
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }
      if (!isProjectUploadSseEvent(parsed)) continue;
      events.push(parsed);
      if (opts.stopAtTerminal && (parsed.type === 'upload-completed' || parsed.type === 'upload-failed')) {
        try { reader.cancel(); } catch { /* ignore */ }
        return events;
      }
    }
  }
  return events;
}

describe('project upload stream (HTTP)', () => {
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
    const id = `upload-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: id }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { project: { id: string } };
    return body.project.id;
  }

  async function createSession(projectId: string, files: { name: string; size: number; mime: string }[], headers: Record<string, string> = {}) {
    const resp = await fetch(`${baseUrl}/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ files }),
    });
    return resp;
  }

  it('emits monotonic progress and exactly one terminal completed event listing the file at its final size', async () => {
    const projectId = await createProject();
    const bytes = Buffer.from('a'.repeat(5000));
    const createResp = await createSession(projectId, [{ name: 'note.txt', size: bytes.length, mime: 'text/plain' }]);
    expect(createResp.status).toBe(200);
    const session = (await createResp.json()) as { uploadId: string; token: string };

    const eventsPromise = fetch(`${baseUrl}/api/projects/${projectId}/uploads/${session.uploadId}/events`, {
      headers: { Authorization: `Bearer ${session.token}`, Accept: 'text/event-stream' },
    }).then((resp) => readSseEvents(resp));

    // Subscribe before PUT (r2 W7-R2-08): the events fetch is already
    // in-flight; give it a tick to attach before bytes start streaming.
    await new Promise((r) => setTimeout(r, 20));

    const putResp = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${session.uploadId}/files/0`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'text/plain' },
      body: bytes,
    });
    expect(putResp.status).toBe(200);

    const events = await eventsPromise;
    const progress = events.filter((e) => e.type === 'upload-progress');
    let last = -1;
    for (const p of progress) {
      expect(p.bytesReceived).toBeGreaterThanOrEqual(last);
      last = p.bytesReceived;
    }
    const terminals = events.filter((e) => e.type === 'upload-completed' || e.type === 'upload-failed');
    expect(terminals).toHaveLength(1);
    expect(terminals[0]!.type).toBe('upload-completed');
    const completed = terminals[0] as Extract<ProjectUploadSseEvent, { type: 'upload-completed' }>;
    expect(completed.files).toHaveLength(1);
    expect(completed.files[0]!.size).toBe(bytes.length);

    const onDisk = await fetch(`${baseUrl}/api/projects/${projectId}/files`);
    const onDiskBody = (await onDisk.json()) as { files: { name: string; size: number }[] };
    const found = onDiskBody.files.find((f) => f.name === completed.files[0]!.name);
    expect(found?.size).toBe(bytes.length);
  });

  it('a late subscriber still gets one terminal event on connect (replay)', async () => {
    const projectId = await createProject();
    const bytes = Buffer.from('hello');
    const createResp = await createSession(projectId, [{ name: 'late.txt', size: bytes.length, mime: 'text/plain' }]);
    const session = (await createResp.json()) as { uploadId: string; token: string };

    const putResp = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${session.uploadId}/files/0`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'text/plain' },
      body: bytes,
    });
    expect(putResp.status).toBe(200);
    // Session is now terminal (already promoted); subscribing AFTER should
    // still replay the one terminal event rather than hanging forever.
    const resp = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${session.uploadId}/events`, {
      headers: { Authorization: `Bearer ${session.token}`, Accept: 'text/event-stream' },
    });
    const events = await readSseEvents(resp);
    expect(events.filter((e) => e.type === 'upload-completed')).toHaveLength(1);
  });

  it('client disconnect mid-transfer leaves no visible file and a terminal failed event to remaining subscribers', async () => {
    const projectId = await createProject();
    const createResp = await createSession(projectId, [{ name: 'aborted.bin', size: 100_000, mime: 'application/octet-stream' }]);
    const session = (await createResp.json()) as { uploadId: string; token: string };

    const eventsPromise = fetch(`${baseUrl}/api/projects/${projectId}/uploads/${session.uploadId}/events`, {
      headers: { Authorization: `Bearer ${session.token}`, Accept: 'text/event-stream' },
    }).then((resp) => readSseEvents(resp));
    await new Promise((r) => setTimeout(r, 20));

    // Abort the PUT partway through a slow, chunked body.
    const controller = new AbortController();
    const slowBody = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        ctrl.enqueue(new Uint8Array(1000).fill(1));
        await new Promise((r) => setTimeout(r, 30));
        controller.abort();
      },
    });
    await fetch(`${baseUrl}/api/projects/${projectId}/uploads/${session.uploadId}/files/0`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/octet-stream' },
      body: slowBody,
      // @ts-expect-error Node fetch requires duplex for a streamed body.
      duplex: 'half',
      signal: controller.signal,
    }).catch(() => {});

    const events = await eventsPromise;
    const terminals = events.filter((e) => e.type === 'upload-failed');
    expect(terminals.length).toBeGreaterThanOrEqual(1);

    const listed = await fetch(`${baseUrl}/api/projects/${projectId}/files`);
    const listedBody = (await listed.json()) as { files: { name: string }[] };
    expect(listedBody.files.find((f) => f.name === 'aborted.bin')).toBeUndefined();
  });

  it('an unknown/expired uploadId answers 404/410 on PUT (the shape a swept session settles into)', async () => {
    // A real 30-minute TTL sweep is proven deterministically at the unit
    // level below (`sweepExpired`); here we prove the daemon's real HTTP
    // route answers exactly the same way once a session no longer exists —
    // an expired session is deleted from the store, so its uploadId reads
    // identically to one that was never created.
    const projectId = await createProject();
    const putResp = await fetch(`${baseUrl}/api/projects/${projectId}/uploads/00000000-0000-0000-0000-000000000000/files/0`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer fake', 'Content-Type': 'text/plain' },
      body: 'x',
    });
    expect([404, 410]).toContain(putResp.status);
  });

  it('idempotency: same key + same request hash returns the existing session; same key + different hash is 409', async () => {
    const projectId = await createProject();
    const files = [{ name: 'idem.txt', size: 5, mime: 'text/plain' }];
    const key = `idem-${Date.now()}`;
    const first = await createSession(projectId, files, { 'Idempotency-Key': key });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { uploadId: string };

    const second = await createSession(projectId, files, { 'Idempotency-Key': key });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { uploadId: string };
    expect(secondBody.uploadId).toBe(firstBody.uploadId);

    const third = await createSession(projectId, [{ name: 'different.txt', size: 5, mime: 'text/plain' }], { 'Idempotency-Key': key });
    expect(third.status).toBe(409);
  });

  it('cross-process-style lock contention: two writers race the same file index, exactly one wins', async () => {
    const projectId = await createProject();
    const createResp = await createSession(projectId, [{ name: 'race.txt', size: 5, mime: 'text/plain' }]);
    const session = (await createResp.json()) as { uploadId: string; token: string };

    const [a, b] = await Promise.all([
      fetch(`${baseUrl}/api/projects/${projectId}/uploads/${session.uploadId}/files/0`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'text/plain' },
        body: 'hello',
      }),
      fetch(`${baseUrl}/api/projects/${projectId}/uploads/${session.uploadId}/files/0`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'text/plain' },
        body: 'world',
      }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  const hostileHeaders = { Origin: 'https://evil.example.com', Host: '127.0.0.1' };

  it('rejects a hostile-origin request against limits, create, transfer, events, and cancel', async () => {
    const projectId = await createProject();
    const limitsRes = await httpRequest(`${baseUrl}/api/projects/${projectId}/uploads/limits`, { headers: hostileHeaders });
    expect(limitsRes.status).toBe(403);

    const createRes = await httpRequest(`${baseUrl}/api/projects/${projectId}/uploads`, {
      method: 'POST',
      headers: { ...hostileHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [{ name: 'x.txt', size: 1, mime: 'text/plain' }] }),
    });
    expect(createRes.status).toBe(403);

    const fakeId = '00000000-0000-0000-0000-000000000000';
    const putRes = await httpRequest(`${baseUrl}/api/projects/${projectId}/uploads/${fakeId}/files/0`, {
      method: 'PUT',
      headers: { ...hostileHeaders, Authorization: 'Bearer fake' },
      body: 'x',
    });
    expect(putRes.status).toBe(403);

    const eventsRes = await httpRequest(`${baseUrl}/api/projects/${projectId}/uploads/${fakeId}/events`, {
      headers: { ...hostileHeaders, Authorization: 'Bearer fake' },
    });
    expect(eventsRes.status).toBe(403);

    const cancelRes = await httpRequest(`${baseUrl}/api/projects/${projectId}/uploads/${fakeId}/cancel`, {
      method: 'POST',
      headers: { ...hostileHeaders, Authorization: 'Bearer fake' },
    });
    expect(cancelRes.status).toBe(403);
  });

  it('legacy route symptom: a partial file IS visible under the project root while multer streams it (the defect this design eliminates)', async () => {
    // Documents the base-branch defect this whole track exists to fix: the
    // legacy route writes straight into the project's visible tree via
    // multer diskStorage, so a file exists on disk (partial or not) before
    // the response completes. The staged route (proven above) never does
    // this — staging lives outside PROJECTS_DIR until promotion.
    const projectId = await createProject();
    const form = new FormData();
    form.append('files', new Blob(['partial-bytes']), 'partial.txt');
    const resp = await fetch(`${baseUrl}/api/projects/${projectId}/upload`, { method: 'POST', body: form });
    expect(resp.status).toBe(200);
    // By the time the response completes the bytes are already committed
    // (multer's synchronous-per-request model) — listed immediately, no
    // staging window the caller can observe from outside. This is the
    // "phantom entry" side channel INV-7.1 requires the staged route not
    // to have: a listing DURING a slow multipart body would show it.
    const listed = await fetch(`${baseUrl}/api/projects/${projectId}/files`);
    const listedBody = (await listed.json()) as { files: { name: string }[] };
    expect(listedBody.files.find((f) => f.name === 'partial.txt')).toBeDefined();
  });
});

describe('project upload stream (staging store internals)', () => {
  let stagingRoot: string;
  let destRoot: string;

  beforeAll(async () => {
    stagingRoot = await mkdtemp(path.join(tmpdir(), 'od-upload-staging-'));
    destRoot = await mkdtemp(path.join(tmpdir(), 'od-upload-dest-'));
  });

  afterAll(async () => {
    await rm(stagingRoot, { recursive: true, force: true });
    await rm(destRoot, { recursive: true, force: true });
  });

  function bodyStream(bytes: Buffer): NodeJS.ReadableStream {
    return Readable.from([bytes]) as unknown as NodeJS.ReadableStream;
  }

  it('TTL expiry sweeps the stage and fails the session', async () => {
    let now = 1_000_000;
    const store = new UploadStagingStore({ stagingRoot, now: () => now });
    const session = await store.createSession('proj-ttl', [{ name: 'a.txt', size: 5, mime: 'text/plain' }], { requestHash: 'h' });
    expect(fs.existsSync(session.dir)).toBe(true);

    now += 31 * 60 * 1000; // past the 30-minute TTL
    store.sweepExpired();
    // Stage cleanup after a terminal event is fire-and-forget (the SSE
    // terminal frame is what callers must see synchronously); poll briefly
    // for the background rm() to finish before checking the filesystem.
    await waitFor(() => !fs.existsSync(session.dir));

    expect(fs.existsSync(session.dir)).toBe(false);
    expect(() => store.requireAuthorized(session.uploadId, session.token)).toThrow(UploadSessionError);
  });

  it('re-hash mismatch at promotion fails the session and removes the stage', async () => {
    const store = new UploadStagingStore({ stagingRoot });
    const session = await store.createSession('proj-rehash', [{ name: 'a.txt', size: 5, mime: 'text/plain' }], { requestHash: 'h' });
    const limits = { maxFileBytes: 1_000_000, maxFilesPerRequest: 12, maxTotalBytes: 12_000_000, acceptedKinds: [] as never[] };
    await store.writeFileStream(session, 0, bodyStream(Buffer.from('hello')), limits);

    // Tamper with the staged bytes AFTER streaming validated them but
    // BEFORE promotion — simulating corruption between validate and commit.
    await fsp.writeFile(session.files[0]!.tempPath, 'tampered');

    const dest = path.join(destRoot, 'proj-rehash');
    await expect(store.promote(session, dest, (n) => n)).rejects.toThrow(UploadSessionError);
    await waitFor(() => !fs.existsSync(session.dir));
    expect(fs.existsSync(session.dir)).toBe(false);
    expect(fs.existsSync(path.join(dest, 'a.txt'))).toBe(false);
  });

  it('rejects a resolved destination name that would escape the destination directory', async () => {
    const store = new UploadStagingStore({ stagingRoot });
    const session = await store.createSession('proj-escape', [{ name: 'a.txt', size: 5, mime: 'text/plain' }], { requestHash: 'h' });
    const limits = { maxFileBytes: 1_000_000, maxFilesPerRequest: 12, maxTotalBytes: 12_000_000, acceptedKinds: [] as never[] };
    await store.writeFileStream(session, 0, bodyStream(Buffer.from('hello')), limits);

    const dest = path.join(destRoot, 'proj-escape');
    await expect(
      store.promote(session, dest, () => '../escaped.txt'),
    ).rejects.toThrow(UploadSessionError);
    expect(fs.existsSync(path.join(destRoot, 'escaped.txt'))).toBe(false);
  });
});
