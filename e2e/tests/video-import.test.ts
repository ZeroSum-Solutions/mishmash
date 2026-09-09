// @vitest-environment node
//
// Video import red spec (Part 8 F-05, INV-7.7 / INV-7.8). Real daemon
// (via tools-dev), a hermetic Vimeo API double (e2e/lib/vitest/mock-vimeo.ts)
// pointed at through the `OD_VIMEO_*_BASE_URL` env, and no route mocking.
//
// RED on base 8487362f0: item (1)'s first behavioural assertion is
// `GET /api/video-import/providers` answering 404 (no route registered) --
// everything else in this file depends on that route existing.

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { requestJson } from '@/vitest/http';
import {
  MOCK_VIMEO_ACCESS_TOKEN,
  MOCK_VIMEO_AUTHORIZATION_CODE,
  MOCK_VIMEO_CLIENT_ID,
  MOCK_VIMEO_CLIENT_SECRET,
  MOCK_VIMEO_NORMAL_VIDEO_BYTES,
  MOCK_VIMEO_NORMAL_VIDEO_SHA256,
  MOCK_VIMEO_OVERSIZE_VIDEO_ID,
  MOCK_VIMEO_REDIRECT_VIDEO_ID,
  MOCK_VIMEO_REFRESH_TOKEN,
  MOCK_VIMEO_VIDEO_ID,
  createMockVimeoServer,
} from '@/vitest/mock-vimeo';
import { createSmokeSuite } from '@/vitest/suite';

type VideoImportProvidersResponse = {
  providers: Array<{
    provider: string;
    enabled: boolean;
    configured: boolean;
    connected: boolean;
    credentialSource: string;
    account?: { name: string };
  }>;
};

type VideoImportConnectResponse = { authorizeUrl: string };

type VideoImportJob = {
  jobId: string;
  taskId: string;
  provider: string;
  status: string;
  progress: string[];
  fraction?: number;
  file?: { name: string; path?: string; size: number };
  error?: { code: string; message: string };
};

type VideoImportResponse = { job: VideoImportJob };

async function pollJob(webUrl: string, projectId: string, jobId: string, budgetMs = 20_000): Promise<VideoImportJob> {
  const startedAt = Date.now();
  for (;;) {
    const { job } = await requestJson<VideoImportResponse>(
      webUrl,
      `/api/projects/${encodeURIComponent(projectId)}/video-imports/${encodeURIComponent(jobId)}`,
    );
    if (job.status === 'done' || job.status === 'failed' || job.status === 'interrupted') return job;
    if (Date.now() - startedAt > budgetMs) throw new Error(`video import job ${jobId} did not finish within ${budgetMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** Recursively collect every regular file under `root`, as `{path, bytes}`. */
async function collectFiles(root: string): Promise<Array<{ filePath: string; bytes: Buffer }>> {
  const out: Array<{ filePath: string; bytes: Buffer }> = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          const st = await stat(full);
          if (st.size > 200 * 1024 * 1024) continue; // never buffer something absurd into memory
          out.push({ filePath: full, bytes: await readFile(full) });
        } catch {
          // file vanished mid-walk (a task's staging temp) -- not a scan failure
        }
      }
    }
  }
  await walk(root);
  return out;
}

function assertCanaryAbsent(haystacks: Array<{ label: string; bytes: Buffer | string }>, canary: string, allowedLabel: string): void {
  const needle = Buffer.from(canary);
  for (const { label, bytes } of haystacks) {
    const buf = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
    const found = buf.includes(needle);
    if (label === allowedLabel) {
      expect(found, `expected the canary "${canary}" to be present in ${label}`).toBe(true);
    } else {
      expect(found, `credential boundary breach: canary "${canary}" leaked into ${label}`).toBe(false);
    }
  }
}

describe('video import (Part 8 F-05)', () => {
  test('Vimeo imports through OAuth into a contained project file; YouTube stays disabled; the token never leaves the credential file', async () => {
    const suite = await createSmokeSuite('video-import');
    const mock = await createMockVimeoServer();

    try {
      await suite.with.toolsDev(
        async ({ logs, webUrl }) => {
          // (1) providers list: vimeo enabled+configured (env from the suite), youtube disabled.
          const providers = await requestJson<VideoImportProvidersResponse>(webUrl, '/api/video-import/providers');
          const vimeo = providers.providers.find((p) => p.provider === 'vimeo');
          const youtube = providers.providers.find((p) => p.provider === 'youtube');
          expect(vimeo).toMatchObject({ enabled: true, configured: true, connected: false, credentialSource: 'env' });
          expect(youtube).toMatchObject({ enabled: false, configured: false, connected: false });

          const project = await requestJson<{ project: { id: string } }>(webUrl, '/api/projects', {
            body: { id: `video-import-${Date.now()}`, name: 'Video import smoke' },
          });
          const projectId = project.project.id;

          // (5) not-connected create -> typed not-connected error, BEFORE connecting.
          const notConnected = await fetch(new URL(`/api/projects/${projectId}/video-imports`, `${webUrl}/`), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'vimeo', url: `https://vimeo.com/${MOCK_VIMEO_VIDEO_ID}` }),
          });
          expect(notConnected.status).toBe(401);
          const notConnectedBody = (await notConnected.json()) as { error: { code: string } };
          expect(notConnectedBody.error.code).toBe('UNAUTHORIZED');

          // (4) youtube create -> typed disabled error, no job started.
          const youtubeCreate = await fetch(new URL(`/api/projects/${projectId}/video-imports`, `${webUrl}/`), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'youtube', url: 'https://youtube.com/watch?v=whatever' }),
          });
          expect(youtubeCreate.status).toBe(409);
          const youtubeCreateBody = (await youtubeCreate.json()) as { error: { code: string; message: string } };
          expect(youtubeCreateBody.error.code).toBe('CONFLICT');
          expect(youtubeCreateBody.error.message).toMatch(/youtube/i);

          // (2) connect -> callback with the mock's fixed code -> status connected.
          const connect = await requestJson<VideoImportConnectResponse>(webUrl, '/api/video-import/vimeo/connect', { method: 'POST' });
          const state = new URL(connect.authorizeUrl).searchParams.get('state');
          expect(state).toBeTruthy();
          // The success path answers an HTML "connected" landing page (the
          // browser redirect target), not JSON -- requestJson would throw
          // trying to parse it, so this uses a raw fetch.
          const callbackResp = await fetch(
            new URL(`/api/video-import/oauth/callback/vimeo?state=${state}&code=${MOCK_VIMEO_AUTHORIZATION_CODE}`, `${webUrl}/`),
          );
          expect(callbackResp.ok).toBe(true);

          const afterConnect = await requestJson<VideoImportProvidersResponse>(webUrl, '/api/video-import/providers');
          const vimeoConnected = afterConnect.providers.find((p) => p.provider === 'vimeo');
          expect(vimeoConnected?.connected).toBe(true);

          // (3) create -> job -> terminal done, file inside the project, bytes equal the mock's.
          const create = await requestJson<VideoImportResponse>(webUrl, `/api/projects/${projectId}/video-imports`, {
            body: { provider: 'vimeo', url: `https://vimeo.com/${MOCK_VIMEO_VIDEO_ID}`, as: 'imported/fixture-clip.mp4' },
          });
          const done = await pollJob(webUrl, projectId, create.job.jobId);
          expect(done.status).toBe('done');
          expect(done.file?.path ?? done.file?.name).toBe('imported/fixture-clip.mp4');

          const rawResp = await fetch(new URL(`/api/projects/${projectId}/raw/imported/fixture-clip.mp4`, `${webUrl}/`));
          expect(rawResp.ok).toBe(true);
          const rawBytes = Buffer.from(await rawResp.arrayBuffer());
          expect(rawBytes.length).toBe(MOCK_VIMEO_NORMAL_VIDEO_BYTES.length);
          expect(createHash('sha256').update(rawBytes).digest('hex')).toBe(MOCK_VIMEO_NORMAL_VIDEO_SHA256);

          const filesAfter = await requestJson<{ files: Array<{ name: string }> }>(webUrl, `/api/projects/${projectId}/files`);
          const matches = filesAfter.files.filter((f) => f.name === 'imported/fixture-clip.mp4');
          expect(matches).toHaveLength(1);

          // Redirect-revalidation: the same flow against the one-hop-redirecting
          // fixture video must still land the same bytes.
          const redirectCreate = await requestJson<VideoImportResponse>(webUrl, `/api/projects/${projectId}/video-imports`, {
            body: { provider: 'vimeo', url: `https://vimeo.com/${MOCK_VIMEO_REDIRECT_VIDEO_ID}`, as: 'imported/redirected-clip.mp4' },
          });
          const redirectDone = await pollJob(webUrl, projectId, redirectCreate.job.jobId);
          expect(redirectDone.status).toBe('done');

          // (7) secret-negative scan -- only after (2)-(3) succeeded above, so
          // there is an actual credential to prove stays contained.
          //
          // `connect`'s own response is EXCLUDED from the "state must not
          // appear" scan below: `authorizeUrl` carries `state` by design
          // (the OAuth contract), so its presence there is the feature, not
          // a leak. Every OTHER captured body -- and every persisted byte
          // under the data root (project root + app.sqlite included) and
          // the daemon log -- must never carry it, the authorization code,
          // or the client secret.
          const otherCapturedBodies = JSON.stringify({
            providers,
            notConnectedBody,
            youtubeCreateBody,
            afterConnect,
            create,
            done,
            filesAfter,
            redirectCreate,
            redirectDone,
          });

          const dataRootFiles = await collectFiles(suite.dataDir);
          const credentialsFile = dataRootFiles.find((f) => f.filePath.endsWith(path.join('video-import', 'credentials.json')));
          expect(credentialsFile, 'expected video-import/credentials.json to exist under the data root').toBeTruthy();
          if (credentialsFile) {
            const mode = (await stat(credentialsFile.filePath)).mode & 0o777;
            expect(mode).toBe(0o600);
          }

          const daemonLogs = await logs();
          const daemonLogText = Object.values(daemonLogs)
            .map((entry) => entry.lines.join('\n'))
            .join('\n');

          const persistedAndLogged: Array<{ label: string; bytes: Buffer | string }> = [
            { label: 'daemon log', bytes: daemonLogText },
            ...dataRootFiles.map((f) => ({ label: f.filePath, bytes: f.bytes })),
          ];
          const everyHaystack: Array<{ label: string; bytes: Buffer | string }> = [
            { label: 'other captured API response bodies', bytes: otherCapturedBodies },
            ...persistedAndLogged,
          ];

          assertCanaryAbsent(everyHaystack, MOCK_VIMEO_ACCESS_TOKEN, credentialsFile?.filePath ?? '');
          assertCanaryAbsent(everyHaystack, MOCK_VIMEO_REFRESH_TOKEN, credentialsFile?.filePath ?? '');
          // The client secret, the authorization code, and the OAuth state
          // must appear NOWHERE persisted, logged, or echoed back in any
          // OTHER response -- not even in the credential file, which stores
          // only the access/refresh token and the account name.
          assertCanaryAbsent(everyHaystack, MOCK_VIMEO_CLIENT_SECRET, '__never__');
          assertCanaryAbsent(everyHaystack, MOCK_VIMEO_AUTHORIZATION_CODE, '__never__');
          assertCanaryAbsent(everyHaystack, String(state), '__never__');

          // (6) a mock video larger than OD_VIDEO_IMPORT_MAX_BYTES -> failed
          // naming the limit, nothing under the project root. Runs in this
          // SAME tools-dev process (not a second `with.toolsDev` call): the
          // suite's env sets a 1 MiB ceiling for this whole run -- above the
          // 256 KiB normal fixture used everywhere above (so those creates
          // still succeed) and below the 6 MiB oversize fixture.
          const oversizeCreate = await requestJson<VideoImportResponse>(webUrl, `/api/projects/${projectId}/video-imports`, {
            body: { provider: 'vimeo', url: `https://vimeo.com/${MOCK_VIMEO_OVERSIZE_VIDEO_ID}`, as: 'imported/oversize.mp4' },
          });
          const oversizeFailed = await pollJob(webUrl, projectId, oversizeCreate.job.jobId);
          expect(oversizeFailed.status).toBe('failed');
          expect(oversizeFailed.error?.code).toBe('LIMIT_EXCEEDED');
          expect(oversizeFailed.error?.message).toMatch(/OD_VIDEO_IMPORT_MAX_BYTES/);
          const filesAfterOversize = await requestJson<{ files: Array<{ name: string }> }>(webUrl, `/api/projects/${projectId}/files`);
          expect(filesAfterOversize.files.some((f) => f.name === 'imported/oversize.mp4')).toBe(false);

          await suite.report.json('summary.json', {
            done,
            oversizeFailed,
            projectId,
            redirectDone,
            vimeoConnected,
          });
        },
        {
          env: {
            OD_VIMEO_CLIENT_ID: MOCK_VIMEO_CLIENT_ID,
            OD_VIMEO_CLIENT_SECRET: MOCK_VIMEO_CLIENT_SECRET,
            OD_VIMEO_API_BASE_URL: mock.baseUrl,
            OD_VIMEO_OAUTH_BASE_URL: mock.baseUrl,
            OD_VIDEO_IMPORT_MAX_BYTES: String(1024 * 1024),
          },
          onFailure: async () => {
            await suite.writeScratchJson('failure/mock-requests.json', mock.requests());
          },
        },
      );
    } finally {
      await mock.close();
    }
  }, 180_000);
});
