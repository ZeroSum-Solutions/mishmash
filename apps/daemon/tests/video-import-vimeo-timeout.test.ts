// downloadVimeoVideoToStaging timeout handling (Grok r1 MEDIUM finding):
// a stalled connect or stalled read past OD_VIDEO_IMPORT_TIMEOUT_MS used to
// surface as a generic `UPSTREAM_ERROR`, which does not name the limit that
// was actually hit -- unlike VideoImportLimitExceededError for the byte
// limit. No test exercised this path before this file. Not one of the
// branch's six gate files (same precedent as video-import-job-scope.test.ts
// from the earlier pre-review pass); run directly.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { VideoImportTimeoutError, downloadVimeoVideoToStaging } from '../src/video-import/providers/vimeo.js';

describe('downloadVimeoVideoToStaging timeout handling', () => {
  let server: http.Server | null = null;
  let stagingDir: string | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
      server = null;
    }
    if (stagingDir) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      stagingDir = null;
    }
  });

  it('throws a named VideoImportTimeoutError naming OD_VIDEO_IMPORT_TIMEOUT_MS when the download stalls, and leaves no staging temp file behind', async () => {
    // Sends headers, then never writes or ends the body -- a stalled
    // upstream read, not a network error.
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'video/mp4' });
    });
    await new Promise<void>((resolveListen) => server!.listen(0, '127.0.0.1', resolveListen));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('stub server has no address');
    const downloadUrl = `http://127.0.0.1:${addr.port}/video.mp4`;

    stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-import-timeout-'));

    let caught: unknown;
    try {
      await downloadVimeoVideoToStaging({
        downloadUrl,
        maxBytes: 10_000_000,
        timeoutMs: 80,
        stagingDir,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(VideoImportTimeoutError);
    expect((caught as Error).message).toContain('OD_VIDEO_IMPORT_TIMEOUT_MS');
    expect(fs.readdirSync(stagingDir)).toHaveLength(0);
  });
});
