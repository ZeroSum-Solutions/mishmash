// Staged-upload session engine (Part 2 item 2.17, re-derived for MishMash;
// nothing copied from ONE BOX). Uploaded bytes are staged OUTSIDE the
// project's visible tree until size, extension/MIME/magic-byte agreement,
// and (for zips) central-directory checks pass, then committed atomically
// into the project. Progress and the terminal outcome are typed contracts
// events (`ProjectUploadSseEvent`) — INV-7.1, INV-7.2, INV-7.16.
//
// A session is addressed by an unguessable `uploadId` and guarded by a
// distinct, per-session bearer `token` that is never placed in a URL. A
// lock file (`O_EXCL`) makes cross-process contention for the same session
// fail closed (409 CONFLICT) instead of racing two writers onto one stage.

import { randomBytes, randomUUID, createHash, type Hash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type {
  ProjectFile,
  ProjectUploadCommittedFile,
  ProjectUploadSseEvent,
  UploadAcceptedKind,
  UploadLimitsResponse,
} from '@open-design/contracts';

import { inspectZipCentralDirectory } from './zip-inspector.js';

export const DEFAULT_MAX_FILE_BYTES = 200 * 1024 * 1024;
export const DEFAULT_MAX_FILES = 12;
export const UPLOAD_SESSION_TTL_MS = 30 * 60 * 1000;

export function resolveUploadLimits(env: NodeJS.ProcessEnv = process.env): UploadLimitsResponse {
  const maxFileBytes = positiveIntEnv(env.OD_UPLOAD_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES);
  const maxFilesPerRequest = positiveIntEnv(env.OD_UPLOAD_MAX_FILES, DEFAULT_MAX_FILES);
  return {
    maxFileBytes,
    maxFilesPerRequest,
    maxTotalBytes: maxFileBytes * maxFilesPerRequest,
    acceptedKinds: ACCEPTED_KINDS,
  };
}

function positiveIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const ACCEPTED_KINDS: UploadAcceptedKind[] = [
  { extensions: ['png'], mime: 'image/png', sniff: 'magic' },
  { extensions: ['jpg', 'jpeg'], mime: 'image/jpeg', sniff: 'magic' },
  { extensions: ['gif'], mime: 'image/gif', sniff: 'magic' },
  { extensions: ['webp'], mime: 'image/webp', sniff: 'magic' },
  { extensions: ['svg'], mime: 'image/svg+xml', sniff: 'text' },
  { extensions: ['mp4'], mime: 'video/mp4', sniff: 'magic' },
  { extensions: ['webm'], mime: 'video/webm', sniff: 'magic' },
  { extensions: ['mov'], mime: 'video/quicktime', sniff: 'magic' },
  { extensions: ['mp3'], mime: 'audio/mpeg', sniff: 'magic' },
  { extensions: ['wav'], mime: 'audio/wav', sniff: 'magic' },
  { extensions: ['pdf'], mime: 'application/pdf', sniff: 'magic' },
  { extensions: ['html', 'htm'], mime: 'text/html', sniff: 'text' },
  { extensions: ['css'], mime: 'text/css', sniff: 'text' },
  { extensions: ['js'], mime: 'text/javascript', sniff: 'text' },
  { extensions: ['ts'], mime: 'text/typescript', sniff: 'text' },
  { extensions: ['json'], mime: 'application/json', sniff: 'text' },
  { extensions: ['md'], mime: 'text/markdown', sniff: 'text' },
  { extensions: ['txt'], mime: 'text/plain', sniff: 'text' },
  { extensions: ['zip'], mime: 'application/zip', sniff: 'zip' },
];

function extOf(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx + 1).toLowerCase();
}

export function findAcceptedKind(name: string): UploadAcceptedKind | null {
  const ext = extOf(name);
  return ACCEPTED_KINDS.find((k) => k.extensions.includes(ext)) ?? null;
}

/** Checks the first bytes of a staged file against the kind its filename
 *  extension declared. Returns null when it agrees, or a human reason
 *  naming the mismatch. Never trusts the client-declared MIME alone. */
export function sniffMismatchReason(kind: UploadAcceptedKind, head: Buffer): string | null {
  switch (kind.sniff) {
    case 'magic':
      return magicMatches(kind, head) ? null : `file contents do not match a ${kind.mime} file`;
    case 'text':
      return looksLikeText(head) ? null : 'file contents are not valid UTF-8 text';
    case 'zip':
      return head.length >= 4 && head.readUInt32LE(0) === 0x04034b50 ? null : 'file contents do not match a zip archive';
    default:
      return 'unknown sniff kind';
  }
}

function magicMatches(kind: UploadAcceptedKind, head: Buffer): boolean {
  if (kind.mime === 'image/png') return head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (kind.mime === 'image/jpeg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (kind.mime === 'image/gif') return head.length >= 6 && (head.subarray(0, 6).toString('ascii') === 'GIF87a' || head.subarray(0, 6).toString('ascii') === 'GIF89a');
  if (kind.mime === 'image/webp') return head.length >= 12 && head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP';
  if (kind.mime === 'video/mp4' || kind.mime === 'video/quicktime') return head.length >= 12 && head.subarray(4, 8).toString('ascii') === 'ftyp';
  if (kind.mime === 'video/webm') return head.length >= 4 && head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (kind.mime === 'audio/mpeg') return head.length >= 3 && (head.subarray(0, 3).toString('ascii') === 'ID3' || ((head[0] ?? 0) === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0));
  if (kind.mime === 'audio/wav') return head.length >= 12 && head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WAVE';
  if (kind.mime === 'application/pdf') return head.length >= 5 && head.subarray(0, 5).toString('ascii') === '%PDF-';
  return false;
}

function looksLikeText(head: Buffer): boolean {
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

export type UploadFileStatus = 'pending' | 'streaming' | 'validated' | 'committed' | 'failed';

interface UploadFileState {
  index: number;
  name: string;
  declaredSize: number;
  declaredMime: string;
  bytesReceived: number;
  status: UploadFileStatus;
  streamingHash: Hash | null;
  streamingSha256: string | null;
  tempPath: string;
}

export interface UploadSession {
  uploadId: string;
  token: string;
  projectId: string;
  dir: string;
  files: UploadFileState[];
  createdAt: number;
  expiresAt: number;
  idempotencyKey: string | null;
  requestHash: string;
  terminal: boolean;
  subscribers: Set<(evt: ProjectUploadSseEvent) => void>;
  lastEvent: ProjectUploadSseEvent | null;
  lockPath: string;
}

export class UploadSessionError extends Error {
  constructor(
    readonly status: number,
    readonly code: 'CONFLICT' | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'UNAUTHORIZED' | 'PAYLOAD_TOO_LARGE',
    message: string,
    readonly limitBytes?: number,
  ) {
    super(message);
  }
}

export interface StagingStoreDeps {
  stagingRoot: string;
  now?: () => number;
}

/** Owns every in-flight upload session for the process. One instance is
 *  created per daemon boot (composition root passes `stagingRoot`, derived
 *  from `RUNTIME_DATA_DIR`, never the project root). */
export class UploadStagingStore {
  private readonly sessions = new Map<string, UploadSession>();
  private readonly stagingRoot: string;
  private readonly now: () => number;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(deps: StagingStoreDeps) {
    this.stagingRoot = deps.stagingRoot;
    this.now = deps.now ?? Date.now;
  }

  startSweeper(intervalMs = 60_000): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweepExpired(), intervalMs);
    this.sweepTimer.unref?.();
  }

  stopSweeper(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  sweepExpired(): void {
    const nowMs = this.now();
    for (const session of [...this.sessions.values()]) {
      if (!session.terminal && session.expiresAt <= nowMs) {
        this.failSession(session, 'VALIDATION_FAILED' as never, 'upload session expired');
      }
    }
  }

  get(uploadId: string): UploadSession | undefined {
    return this.sessions.get(uploadId);
  }

  /** Creates (or, under an idempotency key + matching request hash, reuses)
   *  a staging session for `projectId`. Rejects a re-used idempotency key
   *  bound to a DIFFERENT request body with 409 CONFLICT. */
  async createSession(
    projectId: string,
    files: { name: string; size: number; mime: string }[],
    opts: { idempotencyKey?: string | null; requestHash: string },
  ): Promise<UploadSession> {
    if (opts.idempotencyKey) {
      for (const session of this.sessions.values()) {
        if (session.projectId === projectId && session.idempotencyKey === opts.idempotencyKey) {
          if (session.requestHash !== opts.requestHash) {
            throw new UploadSessionError(409, 'CONFLICT', 'idempotency key was already used for a different request');
          }
          return session;
        }
      }
    }

    const uploadId = randomUUID();
    const token = randomBytes(32).toString('hex');
    const dir = path.join(this.stagingRoot, projectId, uploadId);
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
    const lockPath = path.join(dir, '.lock');
    try {
      const fd = await fsp.open(lockPath, 'wx');
      await fd.close();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new UploadSessionError(409, 'CONFLICT', 'an upload session already holds this stage');
      }
      throw err;
    }

    const createdAt = this.now();
    const session: UploadSession = {
      uploadId,
      token,
      projectId,
      dir,
      createdAt,
      expiresAt: createdAt + UPLOAD_SESSION_TTL_MS,
      idempotencyKey: opts.idempotencyKey ?? null,
      requestHash: opts.requestHash,
      terminal: false,
      subscribers: new Set(),
      lastEvent: null,
      lockPath,
      files: files.map((f, index) => ({
        index,
        name: f.name,
        declaredSize: f.size,
        declaredMime: f.mime,
        bytesReceived: 0,
        status: 'pending',
        streamingHash: null,
        streamingSha256: null,
        tempPath: path.join(dir, `part-${index}.tmp`),
      })),
    };
    this.sessions.set(uploadId, session);
    this.emit(session, {
      type: 'upload-started',
      uploadId,
      files: session.files.map((f) => ({ index: f.index, name: f.name, size: f.declaredSize })),
    });
    return session;
  }

  requireAuthorized(uploadId: string, token: string | null): UploadSession {
    const session = this.sessions.get(uploadId);
    if (!session) throw new UploadSessionError(404, 'NOT_FOUND', 'upload session not found or expired');
    if (session.expiresAt <= this.now()) {
      this.failSession(session, 'VALIDATION_FAILED' as never, 'upload session expired');
      throw new UploadSessionError(410, 'NOT_FOUND', 'upload session expired');
    }
    if (!token || token !== session.token) {
      throw new UploadSessionError(401, 'UNAUTHORIZED', 'missing or invalid upload session token');
    }
    return session;
  }

  subscribe(session: UploadSession, cb: (evt: ProjectUploadSseEvent) => void): () => void {
    session.subscribers.add(cb);
    if (session.lastEvent && session.terminal) cb(session.lastEvent);
    return () => session.subscribers.delete(cb);
  }

  private emit(session: UploadSession, evt: ProjectUploadSseEvent): void {
    session.lastEvent = evt;
    for (const cb of session.subscribers) cb(evt);
  }

  /** Streams one file's bytes onto the stage, enforcing per-file and
   *  per-session byte ceilings as bytes arrive (so an over-limit stream is
   *  aborted before it fully lands) and the extension/MIME/magic agreement
   *  once enough bytes have buffered. Emits monotonic progress. */
  async writeFileStream(
    session: UploadSession,
    index: number,
    body: NodeJS.ReadableStream,
    limits: UploadLimitsResponse,
  ): Promise<void> {
    const file = session.files[index];
    if (!file) throw new UploadSessionError(400, 'VALIDATION_FAILED', `no file at index ${index}`);
    if (file.status !== 'pending') throw new UploadSessionError(409, 'CONFLICT', `file ${index} already streamed`);

    const kind = findAcceptedKind(file.name);
    if (!kind) {
      await this.failFile(session, file, 'UNSUPPORTED_MEDIA_TYPE', `"${file.name}" has an unsupported file extension`);
      throw new UploadSessionError(415, 'VALIDATION_FAILED', `unsupported extension: ${file.name}`);
    }

    file.status = 'streaming';
    file.streamingHash = createHash('sha256');
    const sessionTotalBefore = session.files.reduce((sum, f) => sum + f.bytesReceived, 0);
    let sniffed = false;
    const headChunks: Buffer[] = [];
    let headBytes = 0;
    const writeStream = fs.createWriteStream(file.tempPath, { mode: 0o600 });

    try {
      await new Promise<void>((resolve, reject) => {
        let aborted = false;
        const onData = (chunk: Buffer) => {
          if (aborted) return;
          file.bytesReceived += chunk.length;
          file.streamingHash!.update(chunk);
          if (!sniffed && headBytes < 64) {
            headChunks.push(chunk);
            headBytes += chunk.length;
          }
          if (file.bytesReceived > limits.maxFileBytes) {
            aborted = true;
            (body as NodeJS.ReadableStream & { unpipe?: (dest: unknown) => void; resume?: () => void }).unpipe?.(writeStream);
            writeStream.destroy();
            (body as NodeJS.ReadableStream & { resume?: () => void }).resume?.();
            reject(new UploadSessionError(413, 'PAYLOAD_TOO_LARGE', `"${file.name}" exceeds the ${limits.maxFileBytes} byte limit`, limits.maxFileBytes));
            return;
          }
          if (sessionTotalBefore + file.bytesReceived > limits.maxTotalBytes) {
            aborted = true;
            (body as NodeJS.ReadableStream & { unpipe?: (dest: unknown) => void; resume?: () => void }).unpipe?.(writeStream);
            writeStream.destroy();
            (body as NodeJS.ReadableStream & { resume?: () => void }).resume?.();
            reject(new UploadSessionError(413, 'PAYLOAD_TOO_LARGE', `upload session exceeds the ${limits.maxTotalBytes} byte total limit`, limits.maxTotalBytes));
            return;
          }
          if (!sniffed && headBytes >= 64) {
            sniffed = true;
            const head = Buffer.concat(headChunks, headBytes);
            const mismatch = sniffMismatchReason(kind, head);
            if (mismatch) {
              aborted = true;
              (body as NodeJS.ReadableStream & { unpipe?: (dest: unknown) => void; resume?: () => void }).unpipe?.(writeStream);
              writeStream.destroy();
              (body as NodeJS.ReadableStream & { resume?: () => void }).resume?.();
              reject(new UploadSessionError(415, 'VALIDATION_FAILED', mismatch));
              return;
            }
          }
          this.emit(session, {
            type: 'upload-progress',
            uploadId: session.uploadId,
            index: file.index,
            name: file.name,
            bytesReceived: file.bytesReceived,
            totalBytes: file.declaredSize || file.bytesReceived,
          });
        };
        (body as NodeJS.ReadableStream).on('data', onData);
        (body as NodeJS.ReadableStream).on('error', (err) => { if (!aborted) reject(err); });
        (body as NodeJS.ReadableStream).on('end', () => { /* wait for writeStream finish */ });
        writeStream.on('error', (err) => { if (!aborted) reject(err); });
        writeStream.on('finish', () => resolve());
        (body as NodeJS.ReadableStream).pipe(writeStream);
      });
    } catch (err) {
      await fsp.rm(file.tempPath, { force: true });
      file.status = 'failed';
      if (err instanceof UploadSessionError) {
        await this.failFile(session, file, err.code as 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE' | 'VALIDATION_FAILED', err.message, err.limitBytes);
        throw new UploadSessionError(err.status, err.code, err.message, err.limitBytes);
      }
      await this.failFile(session, file, 'VALIDATION_FAILED', String((err as Error)?.message ?? err));
      throw err;
    }

    // Files whose total size never reaches the 64-byte sniff window (a
    // short PNG/WebP/MP4/MOV/WAV needs up to 12 bytes of magic, so the
    // inline check above waits for a full window rather than firing on a
    // short first chunk) never hit the inline sniff above; check once the
    // stream is fully staged.
    if (!sniffed) {
      const head = await readHead(file.tempPath, 64);
      const mismatch = sniffMismatchReason(kind, head);
      if (mismatch) {
        await fsp.rm(file.tempPath, { force: true });
        file.status = 'failed';
        await this.failFile(session, file, 'UNSUPPORTED_MEDIA_TYPE', mismatch);
        throw new UploadSessionError(415, 'VALIDATION_FAILED', mismatch);
      }
    }

    if (kind.sniff === 'zip') {
      const zipBuf = await fsp.readFile(file.tempPath);
      const inspected = inspectZipCentralDirectory(zipBuf, { maxEntryCompressedBytes: limits.maxFileBytes });
      if (!inspected.ok) {
        await fsp.rm(file.tempPath, { force: true });
        file.status = 'failed';
        await this.failFile(session, file, 'UNSUPPORTED_MEDIA_TYPE', inspected.reason);
        throw new UploadSessionError(415, 'VALIDATION_FAILED', inspected.reason);
      }
    }

    file.streamingSha256 = file.streamingHash!.digest('hex');
    file.status = 'validated';
  }

  private async failFile(
    session: UploadSession,
    file: UploadFileState,
    code: 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE' | 'VALIDATION_FAILED',
    message: string,
    limitBytes?: number,
  ): Promise<void> {
    this.failSession(session, code, message, limitBytes, file.name);
  }

  failSession(
    session: UploadSession,
    code: 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE' | 'VALIDATION_FAILED' | 'CANCELLED' | 'INVALID_REQUEST' | 'CONFLICT',
    message: string,
    limitBytes?: number,
    file?: string,
  ): void {
    if (session.terminal) return;
    session.terminal = true;
    this.emit(session, {
      type: 'upload-failed',
      uploadId: session.uploadId,
      code,
      message,
      ...(limitBytes !== undefined ? { limitBytes } : {}),
      ...(file !== undefined ? { file } : {}),
    });
    void this.cleanupStage(session);
  }

  async cancelSession(session: UploadSession): Promise<void> {
    this.failSession(session, 'CANCELLED', 'upload cancelled');
  }

  private async cleanupStage(session: UploadSession): Promise<void> {
    this.sessions.delete(session.uploadId);
    await fsp.rm(session.dir, { recursive: true, force: true }).catch(() => {});
  }

  /** Promotes every validated file in the session into `destAbsDir` (the
   *  real project directory, resolved by the caller through the existing
   *  sanitize/containment helpers). Re-hashes each staged file from disk
   *  and compares it to the hash computed while streaming — a mismatch
   *  fails the whole session rather than committing a corrupted file.
   *  Copies (never renames) across the staging/destination boundary since
   *  a folder-imported project's `metadata.baseDir` may sit on a different
   *  filesystem (EXDEV) — mirrors `promoteIntoPlace`,
   *  `apps/daemon/src/backup/fs-helpers.ts:68-78` (verified on base). */
  async promote(
    session: UploadSession,
    destAbsDir: string,
    resolveDestName: (name: string, reserved: Set<string>) => string,
  ): Promise<ProjectUploadCommittedFile[]> {
    if (session.files.some((f) => f.status !== 'validated')) {
      throw new UploadSessionError(409, 'CONFLICT', 'not every file in the session has been validated');
    }
    const reserved = new Set<string>();
    const committed: ProjectUploadCommittedFile[] = [];
    await fsp.mkdir(destAbsDir, { recursive: true });
    const destReal = await fsp.realpath(destAbsDir);

    for (const file of session.files) {
      const rehash = await sha256OfFile(file.tempPath);
      if (rehash !== file.streamingSha256) {
        this.failSession(session, 'INVALID_REQUEST', `staged bytes for "${file.name}" changed before promotion`);
        throw new UploadSessionError(409, 'CONFLICT', 'staged file hash mismatch at promotion');
      }
      const finalName = resolveDestName(file.name, reserved);
      const finalPath = path.join(destAbsDir, finalName);
      // Resolve against destReal (realpath'd), not destAbsDir directly:
      // destAbsDir can itself sit under a symlinked ancestor (e.g. macOS
      // /tmp -> /private/tmp) with no hostile intent at all, so comparing
      // an un-resolved finalPath against a resolved destReal would reject
      // every ordinary write. What must actually be rejected is a NAME that
      // resolves outside destReal once ITS OWN segments are realpath'd.
      const finalResolved = path.resolve(destReal, finalName);
      if (!finalResolved.startsWith(destReal + path.sep) && finalResolved !== destReal) {
        this.failSession(session, 'INVALID_REQUEST', `destination path escapes the project directory: ${finalName}`);
        throw new UploadSessionError(409, 'CONFLICT', 'destination symlink escape rejected');
      }
      const tempFinal = path.join(destAbsDir, `.od-upload-${session.uploadId}-${file.index}.part`);
      const handle = await fsp.open(file.tempPath, 'r');
      const data = await handle.readFile();
      await handle.close();
      const outHandle = await fsp.open(tempFinal, 'w', 0o600);
      await outHandle.writeFile(data);
      await outHandle.sync();
      await outHandle.close();
      await fsp.rename(tempFinal, finalPath);
      const stat = await fsp.stat(finalPath);
      committed.push({
        name: finalName,
        path: finalName,
        size: stat.size,
        mtime: stat.mtimeMs,
        originalName: file.name,
      });
      file.status = 'committed';
    }

    session.terminal = true;
    const completedEvent: ProjectUploadSseEvent = {
      type: 'upload-completed',
      uploadId: session.uploadId,
      files: committed,
    };
    session.lastEvent = completedEvent;
    for (const cb of session.subscribers) cb(completedEvent);
    await this.cleanupStage(session);
    return committed;
  }
}

async function readHead(filePath: string, n: number): Promise<Buffer> {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await handle.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(filePath);
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk as Buffer));
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
  return hash.digest('hex');
}
