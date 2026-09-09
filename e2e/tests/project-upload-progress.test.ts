// @vitest-environment node

// W7A — F-01: a real tools-dev daemon, staged uploads, and the F-01
// acceptance line: upload progress is a contract-typed byte stream, a panel
// entry appears only after bytes are on disk, and an over-limit file is
// rejected naming the limit. Consumes `e2e/resources/w7-upload-manifest.ts`
// (owned by 7A); bytes are generated at test time, never committed as
// binaries.
//
// RED on base (8487362f0): `POST /api/projects/:id/uploads` does not exist
// (404) — there is no staged route to subscribe or PUT against at all. The
// legacy `POST /api/projects/:id/upload` route (still present on base) lists
// a visible partial file under the project root while multer is mid-write,
// because it writes straight into the watched project directory with no
// staging boundary — that symptom is exactly what staging outside the
// project root (INV-7.1) fixes here.

import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import { isProjectUploadSseEvent } from '@open-design/contracts';
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  CreateProjectUploadResponse,
  ProjectUploadSseEvent,
  UploadLimitsResponse,
} from '@open-design/contracts';

import { requestJson } from '@/vitest/http';
import { createSmokeSuite } from '@/vitest/suite';

import { generateUploadFixtureBytes } from '../resources/w7-upload-fixture-bytes.js';
import { w7UploadManifest, type W7UploadManifestRow } from '../resources/w7-upload-manifest.js';

function rowOf(id: string): W7UploadManifestRow {
  const row = w7UploadManifest.rows.find((r) => r.id === id);
  if (!row) throw new Error(`manifest row not found: ${id}`);
  return row;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function createProject(daemonUrl: string): Promise<string> {
  const request: CreateProjectRequest = {
    designSystemId: null,
    id: randomUUID(),
    metadata: { kind: 'prototype' },
    name: 'W7A upload progress project',
    pendingPrompt: '',
    skillId: null,
  };
  const created = await requestJson<CreateProjectResponse>(daemonUrl, '/api/projects', { body: request });
  return created.project.id;
}

/** Reads an SSE body stream frame-by-frame, invoking `onEvent` with each
 *  frame's parsed `data:` payload. Resolves once the stream ends. */
async function pumpSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (data: unknown) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      try {
        onEvent(JSON.parse(dataLine.slice('data: '.length)));
      } catch {
        /* ignore a keepalive or malformed frame */
      }
    }
  }
}

/** A `ReadableStream` body that trickles `bytes` out over `chunkCount`
 *  chunks with a short delay between each, so a test can observe genuine
 *  mid-transfer state instead of a single-tick multipart POST. */
function slowBody(bytes: Buffer, chunkCount: number, delayMs: number): ReadableStream<Uint8Array> {
  let offset = 0;
  const chunkSize = Math.ceil(bytes.length / chunkCount);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
      if (offset < bytes.length) await new Promise((resolve) => setTimeout(resolve, delayMs));
    },
  });
}

describe('W7A staged upload progress', () => {
  test('[P0] an over-limit file is rejected naming the limit; an at-limit file is accepted', async () => {
    const suite = await createSmokeSuite('w7a-upload-limits');

    await suite.with.toolsDev(
      async ({ runtime }) => {
        const daemonUrl = `http://127.0.0.1:${runtime.daemonPort}/`;
        const projectId = await createProject(daemonUrl);

        const limits = await requestJson<UploadLimitsResponse>(daemonUrl, `/api/projects/${projectId}/uploads/limits`);
        expect(limits.maxFileBytes).toBe(w7UploadManifest.testLimitOverrideBytes);

        // --- over-limit row: rejected up front, naming the limit ---
        const overLimit = rowOf('over-limit');
        const overLimitCreate = await fetch(new URL(`/api/projects/${projectId}/uploads`, daemonUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ files: [{ name: 'too-big.txt', size: overLimit.sizeBytes, mime: 'text/plain' }] }),
        });
        expect(overLimitCreate.status).toBe(413);
        const overLimitBody = (await overLimitCreate.json()) as {
          error: { code: string; message: string; details?: { limitBytes?: number } };
        };
        expect(overLimitBody.error.code).toBe('PAYLOAD_TOO_LARGE');
        expect(overLimitBody.error.message).toContain(String(w7UploadManifest.testLimitOverrideBytes));
        expect(overLimitBody.error.details?.limitBytes).toBe(w7UploadManifest.testLimitOverrideBytes);

        // --- at-limit row: accepted exactly at the boundary ---
        const atLimit = rowOf('at-limit');
        const atLimitBytes = generateUploadFixtureBytes(atLimit.sizeBytes);
        expect(sha256(atLimitBytes)).toBe(atLimit.sha256);
        const atLimitSession = await requestJson<CreateProjectUploadResponse>(daemonUrl, `/api/projects/${projectId}/uploads`, {
          body: { files: [{ name: 'at-limit.txt', size: atLimit.sizeBytes, mime: 'text/plain' }] },
        });
        const atLimitPut = await fetch(
          new URL(`/api/projects/${projectId}/uploads/${atLimitSession.uploadId}/files/0`, daemonUrl),
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${atLimitSession.token}`, 'content-type': 'application/octet-stream' },
            body: Uint8Array.from(atLimitBytes),
          },
        );
        expect(atLimitPut.status).toBe(200);

        await suite.report.json('w7/upload-limits.json', {
          atLimitBytes: atLimit.sizeBytes,
          overLimitBytes: overLimit.sizeBytes,
        });
      },
      { env: { [w7UploadManifest.testLimitOverrideEnvVar]: String(w7UploadManifest.testLimitOverrideBytes) } },
    );
  }, 600_000);

  test('[P0] typed byte progress streams to one terminal event; nothing is listed before bytes are on disk', async () => {
    const suite = await createSmokeSuite('w7a-upload-progress');

    // No `OD_UPLOAD_MAX_FILE_BYTES` override here — the daemon's real
    // default (200 MiB) comfortably covers the 64 MiB visibility fixture,
    // so this scenario is exercised against production-shaped limits while
    // the size-limit boundary itself is covered by the sibling test above.
    await suite.with.toolsDev(async ({ runtime }) => {
      const daemonUrl = `http://127.0.0.1:${runtime.daemonPort}/`;
      const projectId = await createProject(daemonUrl);

      // --- the F-01 visibility scenario: a throttled mid-size transfer ---
      const midsize = rowOf('midsize-64mib');
      const midsizeBytes = generateUploadFixtureBytes(midsize.sizeBytes);
      expect(sha256(midsizeBytes)).toBe(midsize.sha256);
      const midsizeName = 'midsize-progress.txt';

      const session = await requestJson<CreateProjectUploadResponse>(daemonUrl, `/api/projects/${projectId}/uploads`, {
        body: { files: [{ name: midsizeName, size: midsize.sizeBytes, mime: 'text/plain' }] },
      });

      // Subscribe to the upload's own progress events BEFORE any PUT — no
      // progress byte is ever missed (r2 W7-R2-08).
      const uploadEventsResp = await fetch(
        new URL(`/api/projects/${projectId}/uploads/${session.uploadId}/events`, daemonUrl),
        { headers: { Authorization: `Bearer ${session.token}` } },
      );
      expect(uploadEventsResp.status).toBe(200);
      const progressEvents: { bytesReceived: number }[] = [];
      // An object wrapper, not a reassigned `let`, so its declared type
      // (`ProjectUploadSseEvent | null`) stays intact when read back outside
      // the pumpSse callback that sets it.
      const outcome: { terminal: ProjectUploadSseEvent | null } = { terminal: null };
      let resolveTerminal: () => void = () => {};
      const terminalPromise = new Promise<void>((resolve) => {
        resolveTerminal = resolve;
      });
      void pumpSse(uploadEventsResp.body!.getReader(), (data) => {
        if (!isProjectUploadSseEvent(data)) return;
        if (data.type === 'upload-progress') progressEvents.push({ bytesReceived: data.bytesReceived });
        if (data.type === 'upload-completed' || data.type === 'upload-failed') {
          outcome.terminal = data;
          resolveTerminal();
        }
      }).then(resolveTerminal);

      // Watch the PROJECT's own event stream for a `file-changed` naming
      // the in-flight file — it must never arrive before the terminal
      // upload event: staging lives outside the project root and the
      // promotion temp name is excluded from the watcher (INV-7.1).
      const projectEventsAbort = new AbortController();
      const projectFileChanged: string[] = [];
      const projectEventsResp = await fetch(new URL(`/api/projects/${projectId}/events`, daemonUrl), {
        signal: projectEventsAbort.signal,
      });
      void pumpSse(projectEventsResp.body!.getReader(), (data) => {
        const evt = data as { type?: string; path?: string };
        if (evt?.type === 'file-changed' && evt.path === midsizeName) projectFileChanged.push(evt.path);
      }).catch(() => {});

      const putPromise = fetch(
        new URL(`/api/projects/${projectId}/uploads/${session.uploadId}/files/0`, daemonUrl),
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${session.token}`, 'content-type': 'application/octet-stream' },
          body: slowBody(midsizeBytes, 40, 25),
          duplex: 'half',
        } as RequestInit,
      );

      // Mid-transfer window: wait until at least one progress event has
      // arrived short of the total, then assert the file is invisible to
      // the project's own listing and no `file-changed` named it yet.
      await new Promise<void>((resolve) => {
        const check = () => {
          const last = progressEvents[progressEvents.length - 1];
          if (last && last.bytesReceived < midsize.sizeBytes) resolve();
          else setTimeout(check, 20);
        };
        check();
      });
      const midTransferFiles = await requestJson<{ files: { name: string }[] }>(daemonUrl, `/api/projects/${projectId}/files`);
      expect(midTransferFiles.files.some((f) => f.name === midsizeName)).toBe(false);
      expect(projectFileChanged).toEqual([]);

      await putPromise;
      await terminalPromise;
      expect(outcome.terminal?.type).toBe('upload-completed');
      if (outcome.terminal?.type === 'upload-completed') {
        expect(outcome.terminal.files[0]).toMatchObject({ name: midsizeName, size: midsize.sizeBytes });
      }
      expect(progressEvents.length).toBeGreaterThan(1);
      // Monotonic: byte progress never decreases across events for the
      // same (single) file in this session.
      for (let i = 1; i < progressEvents.length; i += 1) {
        expect(progressEvents[i]!.bytesReceived).toBeGreaterThanOrEqual(progressEvents[i - 1]!.bytesReceived);
      }

      const afterFiles = await requestJson<{ files: { name: string; size: number }[] }>(
        daemonUrl,
        `/api/projects/${projectId}/files`,
      );
      const committed = afterFiles.files.find((f) => f.name === midsizeName);
      expect(committed?.size).toBe(midsize.sizeBytes);

      // Give the project's SSE stream a brief window to deliver the
      // single `file-changed` broadcast the promotion fires for the
      // final bytes.
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(projectFileChanged).toEqual([midsizeName]);

      projectEventsAbort.abort();

      await suite.report.json('w7/upload-progress.json', {
        midsizeBytes: midsize.sizeBytes,
        progressEventCount: progressEvents.length,
      });
    });
  }, 600_000);
});
