// Vimeo video import: URL -> video id, metadata lookup, and the contained
// download itself (INV-7.7 / INV-7.8 / W7-R2-25).
//
// The download URL Vimeo hands back is upstream-controlled (an
// attacker-influenced value if the account or the upstream API is ever
// compromised), so it goes through the same SSRF containment
// `assertExternalAssetUrl` (connectionTest.ts) gives every other
// upstream-supplied asset URL in this codebase, with the one addition the
// brief requires over that single-shot precedent: `redirect: 'manual'`
// with EACH hop re-validated, up to a small fixed limit, mirroring
// `brands/safe-fetch.ts`'s `fetchExternalBrandAsset` redirect loop (that
// module's own guard is public-only, so it cannot be reused for a private
// loopback double in tests — this one calls `assertExternalAssetUrl`
// instead, which permits loopback for exactly that reason).

import fs from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

import { assertExternalAssetUrl } from '../../connectionTest.js';

export interface VimeoVideoMetadata {
  name: string;
  /** The video's own declared total size, in bytes (Vimeo's `size` field). */
  size: number;
  downloadUrl: string;
  downloadSize: number;
}

export class VideoImportLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoImportLimitExceededError';
  }
}

export class VideoImportContainmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoImportContainmentError';
  }
}

/**
 * A stalled connect or stalled read past `OD_VIDEO_IMPORT_TIMEOUT_MS` (Grok
 * r1 MEDIUM finding: this used to surface as a generic `UPSTREAM_ERROR`,
 * which does not name the limit that was actually hit, unlike
 * `VideoImportLimitExceededError` for the byte limit). Thrown from
 * `downloadVimeoVideoToStaging`'s catch whenever the timeout
 * `AbortController` is the reason the download stopped, so
 * `VideoImportService.runVimeoDownload` can map it to its own named error
 * code the same way it already does for the byte limit.
 */
export class VideoImportTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoImportTimeoutError';
  }
}

/**
 * Parse a video id out of the URL shapes Vimeo's own share/player/API links
 * use: `vimeo.com/<id>`, `vimeo.com/channels/x/<id>`, `player.vimeo.com/video/<id>`,
 * `api.vimeo.com/videos/<id>`, and a bare id typed directly. Real Vimeo video
 * ids are always numeric; this prefers a numeric path segment when one is
 * present but falls back to the last non-empty segment otherwise, so a
 * hermetic test double (`e2e/lib/vitest/mock-vimeo.ts`) can use descriptive
 * fixture ids (`vid_normal_fixture`) without a second id scheme.
 */
export function parseVimeoVideoId(rawUrl: string): string | null {
  const trimmed = (rawUrl ?? '').trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Not a URL at all -- treat it as an id typed directly (numeric in
    // production, or a fixture id in tests).
    return /^[\w-]+$/.test(trimmed) ? trimmed : null;
  }
  if (!/(^|\.)vimeo\.com$/i.test(parsed.hostname)) return null;
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (segment && /^\d+$/.test(segment)) return segment;
  }
  return segments[segments.length - 1] ?? null;
}

interface VimeoDownloadOption {
  size?: number;
  link?: string;
  quality?: string;
}

/**
 * `GET /videos/{id}?fields=name,size,download,files` — picks the largest
 * progressive `download[]` link that does not exceed `maxBytes`. Vimeo's
 * `download` field is only present for videos the authenticated user owns
 * and has download rights on; an empty/missing list means nothing eligible
 * to import.
 */
export async function fetchVimeoVideoMetadata(input: {
  apiBaseUrl: string;
  accessToken: string;
  videoId: string;
  maxBytes: number;
}): Promise<{ ok: true; metadata: VimeoVideoMetadata } | { ok: false; code: 'NOT_FOUND' | 'NO_DOWNLOAD' | 'UPSTREAM_ERROR'; message: string }> {
  const url = new URL(`/videos/${encodeURIComponent(input.videoId)}`, input.apiBaseUrl);
  url.searchParams.set('fields', 'name,size,download,files');
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        Accept: 'application/vnd.vimeo.*+json;version=3.4',
      },
    });
  } catch (err) {
    return { ok: false, code: 'UPSTREAM_ERROR', message: `vimeo metadata request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (response.status === 404) {
    return { ok: false, code: 'NOT_FOUND', message: 'vimeo video not found (or not owned by the connected account)' };
  }
  if (!response.ok) {
    return { ok: false, code: 'UPSTREAM_ERROR', message: `vimeo metadata request failed with status ${response.status}` };
  }
  const body = (await response.json().catch(() => null)) as {
    name?: unknown;
    size?: unknown;
    download?: unknown;
  } | null;
  const name = typeof body?.name === 'string' && body.name.length > 0 ? body.name : input.videoId;
  const size = typeof body?.size === 'number' ? body.size : 0;
  const downloads: VimeoDownloadOption[] = Array.isArray(body?.download)
    ? (body.download as VimeoDownloadOption[]).filter(
        (entry) => entry && typeof entry.link === 'string' && typeof entry.size === 'number' && entry.size > 0,
      )
    : [];
  if (downloads.length === 0) {
    return { ok: false, code: 'NO_DOWNLOAD', message: 'vimeo reported no downloadable progressive file for this video' };
  }
  // Pick the largest option that fits the limit -- the best available
  // quality that will not need trimming. When NONE fit (this account only
  // has one, oversize, rendition), fall through to the smallest option
  // rather than rejecting synchronously here: the actual download still
  // streams the declared/streamed byte counts against `maxBytes`
  // (`downloadVimeoVideoToStaging`), so an oversize video still produces a
  // named `LIMIT_EXCEEDED` task failure instead of a silent pre-flight 409
  // that never surfaces which limit was hit.
  const byDescendingSize = [...downloads].sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  const eligible = byDescendingSize.filter((entry) => (entry.size ?? 0) <= input.maxBytes);
  const chosen = eligible[0] ?? byDescendingSize[byDescendingSize.length - 1];
  if (!chosen || !chosen.link) {
    return { ok: false, code: 'NO_DOWNLOAD', message: 'vimeo reported no downloadable progressive file for this video' };
  }
  return {
    ok: true,
    metadata: { name, size, downloadUrl: chosen.link, downloadSize: chosen.size ?? size },
  };
}

/**
 * Fetch `url` with the redirect target re-validated at every hop (up to
 * `maxRedirects`), so a validated download URL that 302s into loopback /
 * RFC1918 / metadata space is refused before any bytes are read — the
 * `assertAndFetchExternalAsset` precedent (connectionTest.ts) validates only
 * the literal URL and forces `redirect:'error'`, which cannot follow the
 * legitimate CDN redirect hop Vimeo's own download links use, so this
 * re-validates manually instead (`brands/safe-fetch.ts` precedent). `signal`
 * is the caller's timeout `AbortController.signal` (`downloadVimeoVideoToStaging`)
 * threaded into every hop's `fetch()`, so a stalled upstream connection is
 * cancelled at the timeout instead of hanging past it.
 */
async function fetchContainedFollowingRedirects(
  initialUrl: string,
  maxRedirects: number,
  signal: AbortSignal,
): Promise<Response> {
  let target = initialUrl;
  for (let hop = 0; ; hop += 1) {
    const check = await assertExternalAssetUrl(target);
    if (!check.ok) throw new VideoImportContainmentError(check.error);
    const response = await fetch(target, { redirect: 'manual', signal });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!location) return response;
    if (response.body) {
      try {
        await response.body.cancel();
      } catch {
        // best-effort drain
      }
    }
    if (hop >= maxRedirects) {
      throw new VideoImportContainmentError(`too many video import redirects (> ${maxRedirects})`);
    }
    target = new URL(location, target).toString();
  }
}

const MAX_DOWNLOAD_REDIRECTS = 3;

/**
 * Stream the (already-validated) Vimeo download URL to a staging temp file
 * under `stagingDir`, checking both the declared `Content-Length` and the
 * streamed byte count against `maxBytes` as bytes arrive (never trusting
 * only the declared header), and aborting past `timeoutMs`. The staging
 * temp is always removed on any failure path (limit breach, timeout,
 * network error) — only the caller, after this resolves successfully, is
 * responsible for moving the bytes into the project.
 */
export async function downloadVimeoVideoToStaging(input: {
  downloadUrl: string;
  maxBytes: number;
  timeoutMs: number;
  stagingDir: string;
  onProgress?: (bytesRead: number, declaredTotal: number | null) => void;
}): Promise<{ stagingPath: string; bytes: number }> {
  await fs.promises.mkdir(input.stagingDir, { recursive: true });
  const stagingPath = path.join(input.stagingDir, `video-import-${process.pid}-${Date.now()}.tmp`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  let bytesRead = 0;
  let declaredTotal: number | null = null;
  let handle: FileHandle | null = null;

  const cleanupStaging = async () => {
    try {
      await handle?.close();
    } catch {
      // best-effort
    }
    try {
      await fs.promises.unlink(stagingPath);
    } catch {
      // never existed, or already removed
    }
  };

  try {
    const response = await fetchContainedFollowingRedirects(input.downloadUrl, MAX_DOWNLOAD_REDIRECTS, controller.signal);
    if (!response.ok || !response.body) {
      throw new Error(`vimeo download request failed with status ${response.status}`);
    }
    const declaredHeader = response.headers.get('content-length');
    declaredTotal = declaredHeader ? Number(declaredHeader) : null;
    if (declaredTotal != null && Number.isFinite(declaredTotal) && declaredTotal > input.maxBytes) {
      await response.body.cancel().catch(() => {});
      throw new VideoImportLimitExceededError(
        `declared download size ${declaredTotal} exceeds OD_VIDEO_IMPORT_MAX_BYTES (${input.maxBytes})`,
      );
    }

    handle = await fs.promises.open(stagingPath, 'w', 0o600);
    const reader = response.body.getReader();
    for (;;) {
      if (controller.signal.aborted) {
        throw new Error(`video import download exceeded OD_VIDEO_IMPORT_TIMEOUT_MS (${input.timeoutMs}ms)`);
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        bytesRead += value.byteLength;
        if (bytesRead > input.maxBytes) {
          throw new VideoImportLimitExceededError(
            `download exceeded OD_VIDEO_IMPORT_MAX_BYTES (${input.maxBytes}) after ${bytesRead} bytes`,
          );
        }
        await handle.write(value);
        input.onProgress?.(bytesRead, declaredTotal);
      }
    }
    await handle.close();
    handle = null;
    return { stagingPath, bytes: bytesRead };
  } catch (err) {
    await cleanupStaging();
    if (err instanceof VideoImportLimitExceededError || err instanceof VideoImportContainmentError) {
      throw err;
    }
    // A stalled connect or stalled read surfaces here either as the manual
    // `controller.signal.aborted` check above (thrown as a plain `Error`)
    // or as `fetch`'s own `AbortError` when the timeout fires while `fetch`
    // or `reader.read()` is still waiting -- both are the SAME timeout,
    // never a real upstream failure, so both get the same named error.
    if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
      throw new VideoImportTimeoutError(
        `video import download exceeded OD_VIDEO_IMPORT_TIMEOUT_MS (${input.timeoutMs}ms)`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
