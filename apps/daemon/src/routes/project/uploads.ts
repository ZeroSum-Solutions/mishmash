// Staged project-upload routes (Part 2 item 2.17 / F-01, re-derived for
// MishMash — nothing copied from ONE BOX). Session creation is split from
// the byte stream: a client creates a session, subscribes to
// `GET .../events` BEFORE issuing any `PUT`, then streams each file's raw
// bytes with `Authorization: Bearer <token>` — never in a URL or query
// string. Uploaded bytes are staged outside the project's visible tree
// (`apps/daemon/src/uploads/staging.ts`) until validated, then promoted
// atomically into the project. INV-7.1, INV-7.2, INV-7.3, INV-7.16.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import type Database from 'better-sqlite3';

import type { CreateProjectUploadRequest } from '@open-design/contracts';

import { sendApiError } from '../../http/api-errors.js';
import { getProject } from '../../db.js';
import { applyProjectFileWatchEvent, ensureProjectSubdir, isSafeId, sanitizeName } from '../../projects.js';
import {
  UploadSessionError,
  UploadStagingStore,
  resolveUploadLimits,
} from '../../uploads/staging.js';

type SqliteDb = Database.Database;

export interface RegisterProjectStagedUploadRoutesDeps {
  db: SqliteDb;
  PROJECTS_DIR: string;
  stagingRoot: string;
}

function bearerToken(req: { headers: Record<string, unknown> }): string | null {
  const raw = req.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] ?? null : null;
}

function canonicalRequestHash(body: CreateProjectUploadRequest): string {
  const canonical = JSON.stringify({
    files: (body.files ?? []).map((f) => ({ name: f.name, size: f.size, mime: f.mime })),
    dir: typeof body.dir === 'string' ? body.dir.trim() : '',
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** INV-7.2 for a `dir`-targeted session: the destination folder is
 *  resolved, confined to the project sandbox, and sanitized exactly ONCE —
 *  at session creation, before any byte is accepted — through the same
 *  `ensureProjectSubdir` the legacy multipart route uses. A hostile or
 *  traversal-escaping `dir` therefore fails the session create with
 *  VALIDATION_FAILED and never reaches promotion; promotion re-derives the
 *  absolute folder from the stored, already-sanitized `session.destSubdir`
 *  through the same helper, so the two can never disagree. */
async function resolveUploadDestination(
  projectsDir: string,
  projectId: string,
  dir: string | undefined,
  metadata: unknown,
): Promise<{ absDir: string; relDir: string }> {
  try {
    return await ensureProjectSubdir(projectsDir, projectId, dir ?? '', metadata);
  } catch (err) {
    throw new UploadSessionError(400, 'VALIDATION_FAILED', `invalid dir: ${String((err as Error)?.message ?? err)}`);
  }
}

function sendSseEvent(res: import('express').Response, eventType: string, data: unknown): void {
  res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Registers the staged upload session routes onto `app`. `stagingRoot`
 *  must live outside every project root (the composition root in
 *  `server.ts` passes `<RUNTIME_DATA_DIR>/uploads/staging`) — never under
 *  `PROJECTS_DIR`, so a partial upload is never visible to a project's
 *  chokidar watcher or file listing. */
export function registerProjectStagedUploadRoutes(app: Express, deps: RegisterProjectStagedUploadRoutesDeps): UploadStagingStore {
  const { db, PROJECTS_DIR, stagingRoot } = deps;
  const store = new UploadStagingStore({ stagingRoot });
  store.startSweeper();

  app.get('/api/projects/:id/uploads/limits', (_req, res) => {
    res.json(resolveUploadLimits(process.env));
  });

  app.post('/api/projects/:id/uploads', async (req, res) => {
    const projectId = req.params.id;
    // `createSession` joins `projectId` straight onto `stagingRoot`
    // (staging.ts); reject a hostile/unknown id at this boundary, the same
    // way every other project-scoped route in this codebase guards
    // `req.params.id` before it reaches a path.join (see e.g.
    // routes/covers.ts's `isSafeId(projectId) || !getProject(...)` check).
    if (!isSafeId(projectId) || !getProject(db, projectId)) {
      return sendApiError(res, 404, 'NOT_FOUND', 'project not found');
    }
    const body = req.body as CreateProjectUploadRequest | undefined;
    if (!body || !Array.isArray(body.files) || body.files.length === 0) {
      return sendApiError(res, 400, 'VALIDATION_FAILED', 'files is required and must be non-empty');
    }
    const limits = resolveUploadLimits(process.env);
    if (body.files.length > limits.maxFilesPerRequest) {
      return sendApiError(res, 400, 'VALIDATION_FAILED', `too many files: the limit is ${limits.maxFilesPerRequest} per request`);
    }
    for (const f of body.files) {
      if (typeof f.name !== 'string' || !f.name.trim() || typeof f.size !== 'number' || typeof f.mime !== 'string') {
        return sendApiError(res, 400, 'VALIDATION_FAILED', 'each file needs name, size, and mime');
      }
      if (f.size > limits.maxFileBytes) {
        return sendApiError(
          res,
          413,
          'PAYLOAD_TOO_LARGE',
          `"${f.name}" (${f.size} bytes) exceeds the ${limits.maxFileBytes} byte limit`,
          { details: { limitBytes: limits.maxFileBytes } },
        );
      }
    }

    if (body.dir !== undefined && typeof body.dir !== 'string') {
      return sendApiError(res, 400, 'VALIDATION_FAILED', 'dir must be a string');
    }

    const idempotencyKeyRaw = req.headers['idempotency-key'];
    const idempotencyKey = typeof idempotencyKeyRaw === 'string' && idempotencyKeyRaw.trim() ? idempotencyKeyRaw.trim() : null;
    const requestHash = canonicalRequestHash(body);

    try {
      const project = getProject(db, projectId);
      const { relDir } = await resolveUploadDestination(PROJECTS_DIR, projectId, body.dir, project?.metadata);
      const session = await store.createSession(projectId, body.files, { idempotencyKey, requestHash, destSubdir: relDir });
      const limitsForSession = resolveUploadLimits(process.env);
      res.json({
        uploadId: session.uploadId,
        token: session.token,
        expiresAt: session.expiresAt,
        limits: limitsForSession,
      });
    } catch (err) {
      if (err instanceof UploadSessionError) {
        return sendApiError(res, err.status, err.code, err.message);
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', 'failed to create upload session');
    }
  });

  app.put('/api/projects/:id/uploads/:uploadId/files/:index', async (req, res) => {
    const token = bearerToken(req);
    let session;
    try {
      session = store.requireAuthorized(req.params.uploadId, token);
    } catch (err) {
      if (err instanceof UploadSessionError) return sendApiError(res, err.status, err.code === 'NOT_FOUND' ? 'NOT_FOUND' : err.code, err.message);
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'upload session lookup failed');
    }
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) {
      return sendApiError(res, 400, 'VALIDATION_FAILED', 'invalid file index');
    }
    const limits = resolveUploadLimits(process.env);
    try {
      await store.writeFileStream(session, index, req, limits);
      res.json({ ok: true, index });

      // Once every file has passed validation, promote the session
      // atomically into the project (folder-imported projects resolve
      // through metadata.baseDir, same as every other project write).
      if (session.files.every((f) => f.status === 'validated')) {
        const project = getProject(db, session.projectId);
        let destAbsDir: string;
        try {
          ({ absDir: destAbsDir } = await resolveUploadDestination(PROJECTS_DIR, session.projectId, session.destSubdir, project?.metadata));
        } catch (err) {
          // Validated at creation; if the folder can no longer be resolved
          // the session still ends with its one terminal event.
          store.failSession(session, 'VALIDATION_FAILED', String((err as Error)?.message ?? err));
          return;
        }
        try {
          const committed = await store.promote(session, destAbsDir, (name, reserved) => uniqueName(destAbsDir, sanitizeName(name), reserved));
          // promote() writes straight to disk, bypassing the chokidar-fed
          // project file index (`services/project-file-index.ts`) the same
          // way every other direct-write helper in `projects.ts` does
          // (e.g. `writeProjectFile`, line ~1129) — so `GET
          // /api/projects/:id/files` would otherwise keep serving a stale
          // cached listing that never learned the promoted file exists.
          for (const file of committed) {
            await applyProjectFileWatchEvent(
              PROJECTS_DIR,
              session.projectId,
              { type: 'file-changed', path: file.path, kind: 'add' },
              project?.metadata,
            );
          }
        } catch {
          // promote() already emitted the terminal failed event on error.
        }
      }
    } catch (err) {
      if (err instanceof UploadSessionError) {
        if (!res.headersSent) {
          return sendApiError(res, err.status, err.code === 'NOT_FOUND' ? 'NOT_FOUND' : err.code, err.message, err.limitBytes !== undefined ? { details: { limitBytes: err.limitBytes } } : {});
        }
        return;
      }
      if (!res.headersSent) sendApiError(res, 500, 'INTERNAL_ERROR', 'upload stream failed');
    }
  });

  app.get('/api/projects/:id/uploads/:uploadId/events', (req, res) => {
    const token = bearerToken(req);
    let session;
    try {
      session = store.requireAuthorized(req.params.uploadId, token);
    } catch (err) {
      if (err instanceof UploadSessionError) return sendApiError(res, err.status, err.code === 'NOT_FOUND' ? 'NOT_FOUND' : err.code, err.message);
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'upload session lookup failed');
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.flushHeaders?.();

    const unsubscribe = store.subscribe(session, (evt) => {
      sendSseEvent(res, evt.type, evt);
      if (evt.type === 'upload-completed' || evt.type === 'upload-failed') {
        res.end();
      }
    });
    // subscribe() already replayed the terminal event above (and ended the
    // response) when the session was already terminal — only send a
    // non-terminal catch-up frame here, or a late subscriber would see the
    // terminal event twice (INV-7.1: exactly one terminal event).
    if (session.lastEvent && !session.terminal) sendSseEvent(res, session.lastEvent.type, session.lastEvent);

    req.on('close', unsubscribe);
  });

  app.post('/api/projects/:id/uploads/:uploadId/cancel', async (req, res) => {
    const token = bearerToken(req);
    let session;
    try {
      session = store.requireAuthorized(req.params.uploadId, token);
    } catch (err) {
      if (err instanceof UploadSessionError) return sendApiError(res, err.status, err.code === 'NOT_FOUND' ? 'NOT_FOUND' : err.code, err.message);
      return sendApiError(res, 500, 'INTERNAL_ERROR', 'upload session lookup failed');
    }
    await store.cancelSession(session);
    res.json({ ok: true });
  });

  return store;
}

function uniqueName(destDir: string, safeName: string, reserved: Set<string>): string {
  const parsed = path.parse(safeName);
  const base = parsed.name || parsed.base || 'file';
  const ext = parsed.ext || '';
  for (let index = 0; index < 10_000; index += 1) {
    const candidate = index === 0 ? safeName : `${base}-${index}${ext}`;
    if (reserved.has(candidate)) continue;
    if (existsSync(path.join(destDir, candidate))) continue;
    reserved.add(candidate);
    return candidate;
  }
  const fallback = `${base}-${Date.now().toString(36)}${ext}`;
  reserved.add(fallback);
  return fallback;
}
