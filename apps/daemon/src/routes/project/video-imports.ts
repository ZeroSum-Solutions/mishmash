// Video import provider surface: list/status, connect, OAuth callback,
// disconnect, and the create-import job route. Lives in its own module tree
// (apps/daemon/src/video-import/), not inside connectors/service.ts,
// because that store is Composio-bound (brief §Work item 2) — Vimeo never
// goes through Composio.
//
// Cross-origin mutation protection: the daemon's global `/api`
// origin-validation middleware (server.ts, `app.use('/api', ...)`) already
// rejects a `Sec-Fetch-Site: cross-site` request against every route under
// this prefix, registered or not — the same middleware `video-import-routes
// .test.ts` observes answering 403 on base. These handlers add no second
// same-origin gate on top of it: `isLocalSameOrigin` (routes/media.ts's
// precedent) would additionally reject a same-process test client's plain
// `fetch()` calls that lack an Origin header (no browser, no Sec-Fetch-*),
// which the global middleware's `allowsMissingOriginRequest` correctly
// treats as a non-browser caller (CLI, e2e) rather than a forgery.

import { randomBytes } from 'node:crypto';

import type { Express, Request, Response } from 'express';
import type Database from 'better-sqlite3';

import {
  VIDEO_IMPORT_PROVIDERS,
  isVideoImportProvider,
  type CreateVideoImportRequest,
  type VideoImportProvider,
  type VideoImportProviderStatus,
  type VideoImportProvidersResponse,
  type VideoImportResponse,
} from '@open-design/contracts';

import { FileVideoImportCredentialStore } from '../../video-import/credentials.js';
import { resolveVideoImportPublicBaseUrl, resolveVimeoConfig } from '../../video-import/config.js';
import {
  VideoImportPendingAuthCache,
  deriveVideoImportRedirectUri,
  exchangeVimeoAuthorizationCode,
} from '../../video-import/oauth.js';
import { YOUTUBE_DISABLED_REASON } from '../../video-import/providers/youtube.js';
import { VideoImportService } from '../../video-import/service.js';

interface SendApiError {
  (res: Response, status: number, code: string, message: string, init?: Record<string, unknown>): Response;
}

export interface RegisterVideoImportRoutesDeps {
  http: { sendApiError: SendApiError };
  paths: { RUNTIME_DATA_DIR: string; PROJECTS_DIR: string };
  resolvedPortRef: { readonly current: number | string | null };
  db: Database.Database;
  projectStore: { getProject: (db: Database.Database, id: string) => { id: string } | undefined | null };
}

const VIMEO_SCOPE = 'public private video_files';

function randomState(): string {
  // 24 bytes of entropy, hex-encoded: unguessable, URL-safe, and long
  // enough that a brute-force replay across the 10-minute TTL is not
  // practical.
  return randomBytes(24).toString('hex');
}

function renderVideoImportConnectedHtml(provider: VideoImportProvider): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Connected</title></head>` +
    `<body><p>Your ${provider} account is now connected. You can close this tab and return to MishMash.</p>` +
    `<script>window.close && window.close();</script></body></html>`;
}

export function registerVideoImportRoutes(app: Express, ctx: RegisterVideoImportRoutesDeps): void {
  const { sendApiError } = ctx.http;
  const credentialStore = new FileVideoImportCredentialStore(ctx.paths.RUNTIME_DATA_DIR);
  const pendingAuth = new VideoImportPendingAuthCache();
  const videoImportService = new VideoImportService(ctx.db, {
    projectsRoot: ctx.paths.PROJECTS_DIR,
    runtimeDataDir: ctx.paths.RUNTIME_DATA_DIR,
  });

  function providerStatus(provider: VideoImportProvider): VideoImportProviderStatus {
    if (provider === 'youtube') {
      return { provider: 'youtube', enabled: false, configured: false, connected: false, credentialSource: 'unset' };
    }
    const cfg = resolveVimeoConfig();
    const record = credentialStore.get('vimeo');
    return {
      provider: 'vimeo',
      enabled: true,
      configured: cfg.configured,
      connected: Boolean(record),
      credentialSource: cfg.credentialSource,
      ...(record?.account ? { account: record.account } : {}),
    };
  }

  app.get('/api/video-import/providers', (_req: Request, res: Response) => {
    const body: VideoImportProvidersResponse = {
      providers: VIDEO_IMPORT_PROVIDERS.map((provider) => providerStatus(provider)),
    };
    res.json(body);
  });

  app.post('/api/video-import/:provider/connect', (req: Request<{ provider: string }>, res: Response) => {
    const { provider } = req.params;
    if (!isVideoImportProvider(provider)) {
      return sendApiError(res, 404, 'NOT_FOUND', `unknown video import provider: ${provider}`);
    }
    if (provider === 'youtube') {
      console.log('[video-import] connect rejected: youtube not enabled');
      return sendApiError(res, 409, 'CONFLICT', YOUTUBE_DISABLED_REASON);
    }

    const cfg = resolveVimeoConfig();
    if (!cfg.configured) {
      console.log('[video-import] connect rejected: vimeo not configured');
      return sendApiError(res, 409, 'CONFLICT', 'Vimeo is not configured: set VIMEO_CLIENT_ID and VIMEO_CLIENT_SECRET');
    }

    const derived = deriveVideoImportRedirectUri({
      provider,
      hostHeader: req.get('host'),
      protocol: req.protocol,
      resolvedPort: ctx.resolvedPortRef.current,
      publicBaseUrl: resolveVideoImportPublicBaseUrl(),
    });
    if (!derived.ok) {
      console.log(`[video-import] connect failed: ${derived.message}`);
      return sendApiError(res, derived.status, derived.code, derived.message);
    }

    const state = randomState();
    pendingAuth.put(state, { provider, redirectUri: derived.redirectUri, createdAt: Date.now() });

    const authorizeUrl = new URL('/oauth/authorize', cfg.oauthBaseUrl);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', cfg.clientId);
    authorizeUrl.searchParams.set('redirect_uri', derived.redirectUri);
    authorizeUrl.searchParams.set('scope', VIMEO_SCOPE);
    authorizeUrl.searchParams.set('state', state);

    console.log('[video-import] connect ok: vimeo authorize url issued');
    res.json({ authorizeUrl: authorizeUrl.toString() });
  });

  app.get('/api/video-import/oauth/callback/:provider', async (req: Request<{ provider: string }>, res: Response) => {
    const { provider } = req.params;
    // Only Vimeo has a working OAuth callback this wave; everything else
    // (an unknown provider, or the declared-but-disabled youtube) 404s
    // rather than consuming or reasoning about pending state at all.
    if (provider !== 'vimeo') {
      return sendApiError(res, 404, 'NOT_FOUND', `no OAuth callback for provider: ${provider}`);
    }

    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    if (!state || !code) {
      return sendApiError(res, 400, 'VALIDATION_FAILED', 'state and code are required');
    }

    const pending = pendingAuth.consume(state);
    if (!pending || pending.provider !== provider) {
      console.log('[video-import] connect failed: unknown or expired state');
      return sendApiError(res, 400, 'VALIDATION_FAILED', 'unknown or expired video import authorization state');
    }

    const cfg = resolveVimeoConfig();
    try {
      const exchanged = await exchangeVimeoAuthorizationCode({
        oauthBaseUrl: cfg.oauthBaseUrl,
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        code,
        redirectUri: pending.redirectUri,
      });
      credentialStore.set({
        schemaVersion: 1,
        provider: 'vimeo',
        accessToken: exchanged.accessToken,
        ...(exchanged.refreshToken ? { refreshToken: exchanged.refreshToken } : {}),
        ...(exchanged.accountName ? { account: { name: exchanged.accountName } } : {}),
        updatedAt: new Date().toISOString(),
      });
      console.log('[video-import] connect ok: vimeo token stored');
      res.type('html').send(renderVideoImportConnectedHtml('vimeo'));
    } catch {
      console.log('[video-import] connect failed: token exchange error');
      sendApiError(res, 400, 'VALIDATION_FAILED', 'vimeo authorization failed');
    }
  });

  app.post('/api/video-import/:provider/disconnect', (req: Request<{ provider: string }>, res: Response) => {
    const { provider } = req.params;
    if (!isVideoImportProvider(provider)) {
      return sendApiError(res, 404, 'NOT_FOUND', `unknown video import provider: ${provider}`);
    }
    credentialStore.delete(provider);
    console.log(`[video-import] disconnect ok: ${provider}`);
    res.json({ ok: true });
  });

  app.post('/api/projects/:id/video-imports', async (req: Request<{ id: string }>, res: Response) => {
    const projectId = req.params.id;
    const project = ctx.projectStore.getProject(ctx.db, projectId);
    if (!project) {
      return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    }

    const body = (req.body ?? {}) as Partial<CreateVideoImportRequest>;
    const provider = body.provider;
    if (!isVideoImportProvider(provider)) {
      return sendApiError(res, 400, 'VALIDATION_FAILED', 'provider must be vimeo or youtube');
    }
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (provider !== 'youtube' && !url) {
      return sendApiError(res, 400, 'VALIDATION_FAILED', 'url is required');
    }
    const as = typeof body.as === 'string' && body.as.trim() ? body.as.trim() : undefined;

    const result = await videoImportService.createImport({ projectId, provider, url, ...(as ? { as } : {}) });
    if (!result.ok) {
      console.log(`[video-import] create failed: ${result.code} ${result.message}`);
      return sendApiError(res, result.status, result.code, result.message);
    }
    console.log(`[video-import] create ok: job ${result.job.jobId} (${provider})`);
    const responseBody: VideoImportResponse = { job: result.job };
    res.status(202).json(responseBody);
  });

  app.get('/api/projects/:id/video-imports/:jobId', (req: Request<{ id: string; jobId: string }>, res: Response) => {
    const projectId = req.params.id;
    const project = ctx.projectStore.getProject(ctx.db, projectId);
    if (!project) {
      return sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    }
    const job = videoImportService.getJob(projectId, req.params.jobId);
    if (!job) {
      return sendApiError(res, 404, 'NOT_FOUND', 'video import job not found');
    }
    const responseBody: VideoImportResponse = { job };
    res.json(responseBody);
  });
}
