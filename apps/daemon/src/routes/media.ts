import fs from 'node:fs';
import type { Express } from 'express';
import type {
  CreateMediaJobRequest,
  MediaExecutionPolicy,
  MediaGenerationResultProps,
  MediaTaskCancelRefusedResponse,
  PublicMediaProviderConfigResponse,
  RecentLinkedDirsResponse,
} from '@open-design/contracts';
import { MEDIA_ENCODE_PRESETS } from '@open-design/contracts';
import type { AnalyticsContext } from '../analytics.js';
import { defaultMediaExecutionPolicy, mediaPolicyDenial } from '../media/policy.js';
import type { ImageGenerationRequestSummary } from '../media/image-generation-retry.js';
import type { RouteDeps } from '../server-context.js';
import { proxyDispatcherRequestInit } from '../connectionTest.js';
import {
  activeMediaJobCount,
  cancelMediaJob,
  mediaJobOutputExists,
  registerActiveMediaJob,
  resolveMediaJobLimits,
  resolveMediaJobPath,
  runMediaDownloadJob,
  runMediaEncodeJob,
  unregisterActiveMediaJob,
} from '../media/jobs.js';
import { resolveProjectDir } from '../projects.js';
import {
  aihubmixCatalogUrl,
  parseAIHubMixCatalog,
  AIHUBMIX_DEFAULT_BASE_URL,
  type AIHubMixCatalogType,
} from '../integrations/aihubmix.js';
import { isSandboxModeEnabled } from '../sandbox-mode.js';
import type { ToolTokenGrant } from '../tool-tokens.js';

/**
 * Validates a `POST /api/projects/:id/media/jobs` request body against
 * {@link CreateMediaJobRequest}'s discriminated shape (INV-7.6). A failure
 * here is always synchronous and pre-child — the caller never gets a task
 * row for a request this rejects.
 */
function validateMediaJobRequest(
  body: unknown,
): { ok: true; value: CreateMediaJobRequest } | { ok: false; message: string } {
  if (!body || typeof body !== 'object') return { ok: false, message: 'request body is required' };
  const b = body as Record<string, unknown>;
  if (b.kind === 'encode') {
    if (typeof b.output !== 'string' || !b.output) return { ok: false, message: 'output is required' };
    if (typeof b.preset !== 'string' || !(MEDIA_ENCODE_PRESETS as readonly string[]).includes(b.preset)) {
      return { ok: false, message: `preset must be one of ${MEDIA_ENCODE_PRESETS.join(', ')}` };
    }
    if (b.preset === 'h264-web' && (typeof b.input !== 'string' || !b.input)) {
      return { ok: false, message: 'h264-web requires input' };
    }
    if (b.preset === 'concat-copy' && (!Array.isArray(b.inputs) || b.inputs.length === 0)) {
      return { ok: false, message: 'concat-copy requires a non-empty inputs list' };
    }
    if (b.preset === 'frames-to-mp4' && (!Array.isArray(b.frames) || b.frames.length === 0)) {
      return { ok: false, message: 'frames-to-mp4 requires a non-empty frames list' };
    }
    return { ok: true, value: b as unknown as CreateMediaJobRequest };
  }
  if (b.kind === 'download') {
    if (typeof b.url !== 'string' || !b.url) return { ok: false, message: 'url is required' };
    if (typeof b.output !== 'string' || !b.output) return { ok: false, message: 'output is required' };
    let parsed: URL;
    try {
      parsed = new URL(b.url);
    } catch {
      return { ok: false, message: 'url must be a valid URL' };
    }
    if (parsed.protocol !== 'https:') return { ok: false, message: 'url must be https' };
    return { ok: true, value: b as unknown as CreateMediaJobRequest };
  }
  return { ok: false, message: 'kind must be "encode" or "download"' };
}

const LONG_MEDIA_PROXY_TIMEOUT_MS = 10 * 60 * 1000;

// Short in-memory cache for the AIHubMix media catalogue so the picker can
// refresh without hammering the upstream public endpoint. Keyed by
// `${baseUrl}|${type}`. Values expire after AIHUBMIX_CATALOG_TTL_MS.
const AIHUBMIX_CATALOG_TTL_MS = 5 * 60 * 1000;
const aihubmixCatalogCache = new Map<string, { at: number; models: Array<{ id: string; label: string }> }>();

export interface RegisterMediaRoutesDeps extends RouteDeps<'db' | 'design' | 'http' | 'paths' | 'ids' | 'auth' | 'media' | 'appConfig' | 'orbit' | 'nativeDialogs' | 'projectStore' | 'projectFiles' | 'conversations' | 'research'> {}

export type LegacyMediaRouteGrantDecision =
  | { ok: true; grant: ToolTokenGrant | null }
  | {
      ok: false;
      code: string;
      details?: Record<string, unknown>;
      message: string;
      status: number;
    };

export function resolveLegacyMediaRouteGrant(input: {
  grant: ToolTokenGrant | null;
  projectId: string;
  requestProjectOverride: (projectId: string, tokenProjectId: string) => boolean;
  sandboxMode: boolean;
}): LegacyMediaRouteGrantDecision {
  if (
    input.sandboxMode &&
    input.grant &&
    input.requestProjectOverride(input.projectId, input.grant.projectId)
  ) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      details: { suppliedProjectId: input.projectId },
      message: 'projectId is derived from the tool token',
      status: 403,
    };
  }

  if (!input.grant && input.sandboxMode) {
    return {
      ok: false,
      code: 'TOOL_TOKEN_MISSING',
      message: 'tool token is required for media generation in sandbox mode',
      status: 401,
    };
  }

  return { ok: true, grant: input.grant };
}

export function registerMediaRoutes(app: Express, ctx: RegisterMediaRoutesDeps) {
  const { db, design } = ctx;
  const { sendApiError, requireLocalDaemonRequest, isLocalSameOrigin, resolvedPortRef } = ctx.http;
  const { PROJECT_ROOT, PROJECTS_DIR, RUNTIME_DATA_DIR } = ctx.paths;
  const { authorizeToolRequest, optionalToolGrantFromRequest, requestProjectOverride } = ctx.auth;
  const { randomUUID } = ctx.ids;
  const { MEDIA_PROVIDERS, IMAGE_MODELS, VIDEO_MODELS, AUDIO_MODELS_BY_KIND, MEDIA_ASPECTS, VIDEO_LENGTHS_SEC, AUDIO_DURATIONS_SEC, readMaskedConfig, writeConfig, generateMedia, createMediaTask, persistMediaTask, appendTaskProgress, notifyTaskWaiters, getLiveMediaTask, mediaTaskSnapshot, listMediaTasksByProject, listElevenLabsVoiceOptions } = ctx.media;
  const { readAppConfig, writeAppConfig } = ctx.appConfig;
  const onAppConfigWritten =
    typeof ctx.appConfig.onAppConfigWritten === 'function'
      ? ctx.appConfig.onAppConfigWritten
      : null;
  const { orbitService } = ctx.orbit;
  const { openBrowser, openNativeFolderDialog } = ctx.nativeDialogs;
  const { getProject } = ctx.projectStore;
  const { insertConversation, upsertMessage } = ctx.conversations;
  const { searchResearch, ResearchError } = ctx.research;
  const getResolvedPort = () => resolvedPortRef.current;

  const mediaPolicyForGrant = (grant: ToolTokenGrant | null):
    | { ok: true; policy: MediaExecutionPolicy }
    | { ok: false; code: string; message: string } => {
    if (!grant?.runId) return { ok: true, policy: defaultMediaExecutionPolicy() };
    const run = design.runs.get(grant.runId);
    if (!run) {
      return {
        ok: false,
        code: 'MEDIA_POLICY_UNAVAILABLE',
        message: 'media generation policy is unavailable for this run',
      };
    }
    return { ok: true, policy: run.mediaExecution ?? defaultMediaExecutionPolicy() };
  };

  const mediaAnalyticsContext = async (
    req: any,
    grant: ToolTokenGrant | null,
  ): Promise<AnalyticsContext | null> => {
    const requestContext = design.readAnalyticsContext(req);
    if (requestContext) return requestContext;

    const runContext = grant?.runId
      ? design.runs.get(grant.runId)?.analyticsContext ?? null
      : null;
    if (runContext) return runContext;

    // Standalone `od media generate` requests do not carry browser analytics
    // headers or a parent run. Match the updater's daemon-internal identity
    // fallback, but only after explicit metrics consent; capture() re-checks
    // the same consent before sending.
    const appConfig = await readAppConfig(RUNTIME_DATA_DIR).catch(() => null);
    const installationId =
      appConfig?.telemetry?.metrics === true
      && typeof appConfig.installationId === 'string'
      && appConfig.installationId
        ? appConfig.installationId
        : null;
    if (!installationId) return null;
    return {
      deviceId: installationId,
      sessionId: installationId,
      clientType: 'desktop',
      locale: 'en',
      requestId: null,
    };
  };

  const handleGenerate = async (
    req: any,
    res: any,
    options: { projectId: string; grant: ToolTokenGrant | null },
  ) => {
    const projectId = options.projectId;
    const project = getProject(db, projectId);
    if (!project) return res.status(404).json({ error: 'project not found' });

    const surface = req.body?.surface;
    if (surface !== 'image' && surface !== 'video' && surface !== 'audio') {
      return sendApiError(res, 400, 'BAD_REQUEST', 'surface must be image, video, or audio');
    }
    const model = typeof req.body?.model === 'string' ? req.body.model : '';
    if (!model) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'model is required');
    }
    // Seedance start/end keyframe pairs: Ark requires first_frame whenever
    // last_frame is present, so an end frame with no start frame is
    // rejected up front here rather than surfacing as an async task
    // failure. generateMedia (media/index.ts) re-checks this as defense in
    // depth for any other caller.
    if (typeof req.body?.endImage === 'string' && req.body.endImage && !req.body?.image) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'end frame requires start frame — pass image alongside endImage');
    }

    const policy = mediaPolicyForGrant(options.grant);
    if (!policy.ok) {
      return sendApiError(res, 403, policy.code, policy.message);
    }
    const denial = mediaPolicyDenial(policy.policy, { surface, model });
    if (denial) {
      return sendApiError(res, 403, denial.code, denial.message);
    }

    let task: ReturnType<typeof createMediaTask> | null = null;
    try {
      const taskId = randomUUID();
      const analyticsContext = await mediaAnalyticsContext(req, options.grant);
      let providerRequestSummary:
        | (ImageGenerationRequestSummary & { providerId: string })
        | null = null;
      task = createMediaTask(taskId, projectId, {
        surface: req.body?.surface,
        model: req.body?.model,
      });
      console.error(
        `[task ${taskId.slice(0, 8)}] queued model=${req.body?.model} ` +
          `surface=${req.body?.surface} ` +
          `image=${req.body?.image ? 'yes' : 'no'} ` +
          `compositionDir=${req.body?.compositionDir ? 'yes' : 'no'}`,
      );

      const proxyDispatcher = proxyDispatcherRequestInit(process.env, {
        headersTimeout: LONG_MEDIA_PROXY_TIMEOUT_MS,
        bodyTimeout: LONG_MEDIA_PROXY_TIMEOUT_MS,
      });
      task.status = 'running';
      persistMediaTask(task);
      generateMedia({
        projectRoot: PROJECT_ROOT,
        projectsRoot: PROJECTS_DIR,
        projectId,
        surface: req.body?.surface,
        model: req.body?.model,
        prompt: req.body?.prompt,
        output: req.body?.output,
        aspect: req.body?.aspect,
        length:
          typeof req.body?.length === 'number' ? req.body.length : undefined,
        duration:
          typeof req.body?.duration === 'number'
            ? req.body.duration
            : undefined,
        voice: req.body?.voice,
        audioKind: req.body?.audioKind,
        language: typeof req.body?.language === 'string' ? req.body.language : undefined,
        loop: typeof req.body?.loop === 'boolean' ? req.body.loop : undefined,
        promptInfluence: typeof req.body?.promptInfluence === 'number'
          ? req.body.promptInfluence
          : undefined,
        compositionDir: req.body?.compositionDir,
        image: req.body?.image,
        endImage: typeof req.body?.endImage === 'string' ? req.body.endImage : undefined,
        images: Array.isArray(req.body?.images) ? req.body.images : undefined,
        onProgress: (line: any) => appendTaskProgress(task, line),
        requestInit: proxyDispatcher.requestInit,
        onProviderRequestSettled: (summary: ImageGenerationRequestSummary & { providerId: string }) => {
          providerRequestSummary = summary;
        },
      })
        .then((meta: any) => {
          task.status = 'done';
          task.file = meta;
          task.endedAt = Date.now();
          persistMediaTask(task);
          if (analyticsContext && providerRequestSummary) {
            captureMediaGenerationResult({
              analyticsContext,
              durationMs: task.endedAt - task.startedAt,
              meta,
              model,
              projectId,
              providerRequestSummary,
              ...(options.grant?.runId ? { runId: options.grant.runId } : {}),
              surface,
              taskId,
            });
          }
          notifyTaskWaiters(task);
          console.error(
            `[task ${taskId.slice(0, 8)}] done size=${meta?.size} mime=${meta?.mime} ` +
              `elapsed=${Math.round((task.endedAt - task.startedAt) / 1000)}s`,
          );
        })
        .catch((err: any) => {
          task.status = 'failed';
          task.error = {
            message: String(err && err.message ? err.message : err),
            status: typeof err?.status === 'number' ? err.status : 400,
            code: err?.code,
          };
          task.endedAt = Date.now();
          persistMediaTask(task);
          if (analyticsContext && providerRequestSummary) {
            captureMediaGenerationResult({
              analyticsContext,
              durationMs: task.endedAt - task.startedAt,
              model,
              projectId,
              providerRequestSummary,
              ...(options.grant?.runId ? { runId: options.grant.runId } : {}),
              surface,
              taskId,
            });
          }
          notifyTaskWaiters(task);
          console.error(
            `[task ${taskId.slice(0, 8)}] failed status=${task.error.status} ` +
              `message=${(task.error.message || '').slice(0, 240)}`,
          );
        })
        .finally(() => proxyDispatcher.close());

      return res.status(202).json({
        taskId,
        status: task.status,
        startedAt: task.startedAt,
      });
    } catch (err: any) {
      if (task) {
        task.status = 'failed';
        task.error = {
          message: String(err && err.message ? err.message : err),
          status: typeof err?.status === 'number' ? err.status : 400,
          code: err?.code,
        };
        task.endedAt = Date.now();
        persistMediaTask(task);
        notifyTaskWaiters(task);
      }
      throw err;
    }
  };

  const captureMediaGenerationResult = (input: {
    analyticsContext: AnalyticsContext;
    durationMs: number;
    meta?: { providerError?: string | null; usedStubFallback?: boolean };
    model: string;
    projectId: string;
    providerRequestSummary: ImageGenerationRequestSummary & { providerId: string };
    runId?: string;
    surface: 'image' | 'video' | 'audio';
    taskId: string;
  }) => {
    const summary = input.providerRequestSummary;
    const props = {
      page_name: 'studio',
      area: 'media_generation',
      project_id: input.projectId,
      task_id: input.taskId,
      ...(input.runId ? { run_id: input.runId } : {}),
      surface: input.surface,
      provider_id: summary.providerId,
      model_id: input.model,
      result: input.meta && !input.meta.providerError && !input.meta.usedStubFallback
        ? 'success'
        : 'failed',
      ...(summary.initialResponseStatus !== undefined
        ? { initial_response_status: summary.initialResponseStatus }
        : {}),
      ...(summary.responseStatus !== undefined
        ? { response_status: summary.responseStatus }
        : {}),
      attempt_count: summary.attemptCount,
      retry_count: summary.retryCount,
      ...(summary.retryReason ? { retry_reason: summary.retryReason } : {}),
      ...(summary.retryAfterMs !== undefined
        ? { retry_after_ms: summary.retryAfterMs }
        : {}),
      ...(summary.retryDelayMs !== undefined
        ? { retry_delay_ms: summary.retryDelayMs }
        : {}),
      retry_final_result: summary.retryFinalResult,
      duration_ms: Math.max(0, input.durationMs),
      used_stub_fallback: input.meta?.usedStubFallback === true,
    } satisfies MediaGenerationResultProps;

    try {
      design.analytics.capture({
        eventName: 'media_generation_result',
        context: input.analyticsContext,
        appVersion: design.getAppVersion(),
        properties: props,
        insertId: `media_generation_result:${input.taskId}`,
      });
    } catch {
      // Analytics is best-effort and must not change the media task outcome.
    }
  };
  app.get('/api/media/models', (_req, res) => {
    res.json({
      providers: MEDIA_PROVIDERS,
      image: IMAGE_MODELS,
      video: VIDEO_MODELS,
      audio: AUDIO_MODELS_BY_KIND,
      aspects: MEDIA_ASPECTS,
      videoLengthsSec: VIDEO_LENGTHS_SEC,
      audioDurationsSec: AUDIO_DURATIONS_SEC,
    });
  });

  // Live AIHubMix media catalogue. The static IMAGE_MODELS registry only
  // seeds a couple of AIHubMix entries; the picker calls this to list the full
  // image-generation catalogue straight from AIHubMix
  // (GET /api/v1/models?type=image_generation, public). Ids are prefixed
  // `aihubmix-` so they stay unique and route through the AIHubMix renderer
  // (which strips the prefix to the wire name). Falls back to the cached copy
  // on upstream failure so a transient blip doesn't empty the picker.
  app.get('/api/media/providers/aihubmix/models', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const raw = req.query.type;
    const type: AIHubMixCatalogType =
      raw === 'llm' || raw === 'video' || raw === 'tts'
        ? raw
        : 'image_generation';
    // This is an unauthenticated, public GET. The AIHubMix catalogue lives at a
    // single fixed origin, so we deliberately do NOT honour a caller-supplied
    // `baseUrl` here — letting the caller pick the fetch target would open an
    // SSRF hole (e.g. pointing the daemon at http://169.254.169.254/ cloud
    // metadata). Hard-code the official origin instead; a custom BYOK base URL
    // only ever needs to differ for authenticated chat/media calls, not for
    // browsing the public model catalogue.
    const baseUrl = AIHUBMIX_DEFAULT_BASE_URL;
    const cacheKey = `${baseUrl}|${type}`;
    const cached = aihubmixCatalogCache.get(cacheKey);
    if (cached && Date.now() - cached.at < AIHUBMIX_CATALOG_TTL_MS) {
      return res.json({ ok: true, cached: true, models: cached.models });
    }
    const dispatcher = proxyDispatcherRequestInit();
    try {
      const resp = await fetch(aihubmixCatalogUrl(baseUrl, type), {
        ...dispatcher.requestInit,
        method: 'GET',
        // The catalogue endpoint is public — no auth header (sending an empty
        // Bearer would be rejected by some gateways).
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        if (cached) return res.json({ ok: true, stale: true, models: cached.models });
        return res.status(502).json({ ok: false, detail: `aihubmix catalog ${resp.status}` });
      }
      const data = await resp.json();
      const models = parseAIHubMixCatalog(data).map((m) => ({
        id: `aihubmix-${m.id}`,
        label: m.label,
      }));
      aihubmixCatalogCache.set(cacheKey, { at: Date.now(), models });
      return res.json({ ok: true, models });
    } catch (err: any) {
      if (cached) return res.json({ ok: true, stale: true, models: cached.models });
      return res
        .status(502)
        .json({ ok: false, detail: String(err && err.message ? err.message : err) });
    } finally {
      await dispatcher.close();
    }
  });

  app.get('/api/media/config', async (_req, res) => {
    try {
      const cfg: PublicMediaProviderConfigResponse = await readMaskedConfig(PROJECT_ROOT);
      res.json(cfg);
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.put('/api/media/config', async (req, res) => {
    try {
      const cfg: PublicMediaProviderConfigResponse = await writeConfig(PROJECT_ROOT, req.body);
      res.json(cfg);
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      res
        .status(status)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.get('/api/media/providers/elevenlabs/voices', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const rawLimit = Number(req.query.limit);
      const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
      const proxyDispatcher = proxyDispatcherRequestInit(process.env);
      try {
        const voices = await listElevenLabsVoiceOptions(PROJECT_ROOT, {
          limit,
          requestInit: proxyDispatcher.requestInit,
        });
        res.json({ voices });
      } finally {
        await proxyDispatcher.close();
      }
    } catch (err: any) {
      const message = String(err && err.message ? err.message : err);
      const status = message.includes('no ElevenLabs API key') ? 400 : 502;
      res.status(status).json({ error: message });
    }
  });

  app.get('/api/app-config', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const config = await readAppConfig(RUNTIME_DATA_DIR);
      res.json({ config });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.put('/api/app-config', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const config = await writeAppConfig(RUNTIME_DATA_DIR, req.body);
      orbitService.configure(config.orbit);
      onAppConfigWritten?.(config);
      res.json({ config });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  // Lightweight existence probe for a single directory, used by the composer
  // to flag a working directory in red the moment its folder is gone (the
  // composer re-checks on focus / picker-open, so deletions reflect live).
  app.post('/api/dir-exists', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const dir = typeof req.body?.path === 'string' ? req.body.path : '';
    let exists = false;
    if (dir) {
      try {
        exists = fs.statSync(dir).isDirectory();
      } catch {
        exists = false;
      }
    }
    res.json({ exists });
  });

  // Recent working directories, pruned to those that still exist on disk. A
  // folder the user deleted (or an external drive that's gone) drops out of
  // the list here and the pruned list is persisted back, so the picker's
  // "recent folders" never offers a path that no longer resolves.
  app.get('/api/recent-dirs', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const config = await readAppConfig(RUNTIME_DATA_DIR);
      const recents = Array.isArray(config.recentLinkedDirs)
        ? config.recentLinkedDirs
        : [];
      const existing = recents.filter((dir: string) => {
        try {
          return fs.statSync(dir).isDirectory();
        } catch {
          return false;
        }
      });
      if (existing.length !== recents.length) {
        await writeAppConfig(RUNTIME_DATA_DIR, { recentLinkedDirs: existing });
      }
      const body: RecentLinkedDirsResponse = { dirs: existing };
      res.json(body);
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.get('/api/orbit/status', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      res.json(await orbitService.status());
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.post('/api/orbit/run', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const locale = typeof req.body?.locale === 'string' ? req.body.locale : null;
      res.json(await orbitService.start('manual', { locale }));
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.post('/api/system/open-external', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return res.status(400).json({ ok: false, error: 'url must be a valid URL' });
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return res.status(400).json({ ok: false, error: 'url must be http or https' });
      }
      const child = openBrowser(parsed.toString());
      res.json({ ok: Boolean(child) });
    } catch (err: any) {
      res
        .status(500)
        .json({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  });

  // Native OS folder picker dialog. Returns { path: string | null }.
  app.post('/api/dialog/open-folder', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const selected = await openNativeFolderDialog();
      res.json({ path: selected });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.post('/api/projects/:id/media/generate', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({
        error:
          'cross-origin request rejected: media generation is restricted to the local UI / CLI',
      });
    }

    try {
      const grant = optionalToolGrantFromRequest(req, { operation: 'media:generate' });
      const grantDecision = resolveLegacyMediaRouteGrant({
        grant,
        projectId: req.params.id,
        requestProjectOverride,
        sandboxMode: isSandboxModeEnabled(process.env),
      });
      if (!grantDecision.ok) {
        return sendApiError(
          res,
          grantDecision.status,
          grantDecision.code,
          grantDecision.message,
          grantDecision.details ? { details: grantDecision.details } : {},
        );
      }
      await handleGenerate(req, res, { projectId: req.params.id, grant: grantDecision.grant });
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      const code = err?.code;
      const body: any = { error: String(err && err.message ? err.message : err) };
      if (code) body.code = code;
      res.status(status).json(body);
    }
  });

  app.post('/api/tools/media/generate', async (req, res) => {
    const grant = authorizeToolRequest(req, res, 'media:generate');
    if (!grant) return;
    try {
      await handleGenerate(req, res, { projectId: grant.projectId, grant });
    } catch (err: any) {
      const status = typeof err?.status === 'number' ? err.status : 400;
      const code = err?.code;
      const body: any = { error: String(err && err.message ? err.message : err) };
      if (code) body.code = code;
      res.status(status).json(body);
    }
  });

  app.post('/api/research/search', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({
        error:
          'cross-origin request rejected: research search is restricted to the local UI / CLI',
      });
    }

    try {
      const proxyDispatcher = proxyDispatcherRequestInit(process.env);
      try {
        const result = await searchResearch({
          projectRoot: PROJECT_ROOT,
          query: req.body?.query,
          maxSources:
            typeof req.body?.maxSources === 'number'
              ? req.body.maxSources
              : undefined,
          providers: Array.isArray(req.body?.providers)
            ? req.body.providers
            : undefined,
          requestInit: proxyDispatcher.requestInit,
        });
        res.json(result);
      } finally {
        await proxyDispatcher.close();
      }
    } catch (err: any) {
      if (err instanceof ResearchError) {
        return res.status(err.status).json({
          error: { code: err.code, message: err.message },
        });
      }
      res.status(500).json({
        error: {
          code: 'RESEARCH_FAILED',
          message: String(err && err.message ? err.message : err),
        },
      });
    }
  });

  app.post('/api/media/tasks/:id/wait', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const taskId = req.params.id;
    const task = getLiveMediaTask(taskId);
    if (!task) return res.status(404).json({ error: 'task not found' });

    const since = Number.isFinite(req.body?.since) ? Number(req.body.since) : 0;
    const requestedTimeout = Number.isFinite(req.body?.timeoutMs)
      ? Number(req.body.timeoutMs)
      : 25_000;
    const timeoutMs = Math.min(Math.max(requestedTimeout, 0), 25_000);

    const respond = () => {
      if (res.writableEnded) return;
      res.json(mediaTaskSnapshot(task, since));
    };

    if (
      task.status === 'done' ||
      task.status === 'failed' ||
      task.status === 'interrupted' ||
      task.progress.length > since
    ) {
      return respond();
    }

    let resolved = false;
    const wake = () => {
      if (resolved) return;
      resolved = true;
      task.waiters.delete(wake);
      clearTimeout(timer);
      respond();
    };
    task.waiters.add(wake);
    const timer = setTimeout(wake, timeoutMs);
    res.on('close', wake);
  });

  // Same MediaTaskSnapshot shape /wait returns (DEF-7.3, INV-7.6) — every
  // row is hydrated into a LiveMediaTask (the same path getLiveMediaTask
  // takes on a cache miss) and run through the SAME mediaTaskSnapshot()
  // builder, so this can never drift into its own ad-hoc projection again.
  app.get('/api/projects/:id/media/tasks', (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const projectId = req.params.id;
    const includeDone =
      req.query.includeDone === '1' || req.query.includeDone === 'true';
    const rows = listMediaTasksByProject(db, projectId, {
      includeTerminal: includeDone,
    });
    const tasks = rows
      .map((row: any) => {
        const live = getLiveMediaTask(row.id);
        return live ? mediaTaskSnapshot(live, 0) : null;
      })
      .filter((snap: any): snap is NonNullable<typeof snap> => snap !== null);
    tasks.sort((a: any, b: any) => b.startedAt - a.startedAt);
    res.json({ tasks });
  });

  app.post('/api/media/tasks/:id/cancel', (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const task = getLiveMediaTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'task not found' });
    // Only an encode/download job (task.kind set by the POST …/media/jobs
    // route above) is ever registered in jobs.ts's activeJobs kill map.
    // A media-generation task (`kind` unset) or a task another surface
    // persisted to this same media_tasks table without registering a
    // killable child (e.g. a video-import download) is NOT tracked there:
    // cancelMediaJob would silently no-op and this route would still
    // answer 200 with the current, unchanged, still-running snapshot —
    // read by a caller as "canceled" while nothing was stopped
    // (integration-grok-r1 round 1, finding 1). Refuse instead of lying
    // about the outcome; the underlying job keeps running until its own
    // owner tracks its abort on this or an equivalent kill map.
    if (task.kind !== 'encode' && task.kind !== 'download') {
      const refusal: MediaTaskCancelRefusedResponse = {
        error: {
          code: 'NOT_CANCELABLE',
          message: `task ${req.params.id} is not a background encode/download job tracked by this route (kind: ${task.kind ?? 'generate'}); it cannot be canceled here`,
        },
        task: mediaTaskSnapshot(task, 0),
      };
      return res.status(409).json(refusal);
    }
    // cancelMediaJob is a no-op (returns false) for a task this route
    // doesn't track an active child for — already terminal. Either way this
    // answers with the current snapshot rather than 404 (work item 2).
    cancelMediaJob(req.params.id);
    res.json(mediaTaskSnapshot(task, 0));
  });

  app.get('/api/media/jobs/limits', (_req, res) => {
    res.json(resolveMediaJobLimits());
  });

  app.post('/api/projects/:id/media/jobs', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({
        error: 'cross-origin request rejected: media jobs are restricted to the local UI / CLI',
      });
    }
    const projectId = req.params.id;
    const project = getProject(db, projectId);
    if (!project) return res.status(404).json({ error: 'project not found' });

    const parsed = validateMediaJobRequest(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: parsed.message } });
    }
    const request = parsed.value;

    const limits = resolveMediaJobLimits();
    if (activeMediaJobCount() >= limits.maxConcurrent) {
      return res.status(429).json({
        error: {
          code: 'LIMIT_EXCEEDED',
          message: `maxConcurrent limit reached: ${limits.maxConcurrent} (OD_MEDIA_JOB_MAX_CONCURRENT)`,
        },
      });
    }

    const projectDir = resolveProjectDir(PROJECTS_DIR, projectId, project.metadata);
    const outputAbs = resolveMediaJobPath(projectDir, request.output);
    if (!outputAbs) {
      return res
        .status(400)
        .json({ error: { code: 'INVALID_REQUEST', message: `invalid output path: ${request.output}` } });
    }
    if (!request.overwrite && (await mediaJobOutputExists(outputAbs))) {
      return res
        .status(409)
        .json({ error: { code: 'CONFLICT', message: `output already exists: ${request.output}` } });
    }

    // Re-check immediately before reserving the slot, with no `await`
    // between this check and `registerActiveMediaJob` below: the earlier
    // check (above, before `mediaJobOutputExists`) is only a fast-fail —
    // that `await` yields the event loop, so a second near-simultaneous
    // request for a DIFFERENT output could pass the earlier check too and
    // race this one to registration. This second, synchronous-to-register
    // check closes that window.
    if (activeMediaJobCount() >= limits.maxConcurrent) {
      return res.status(429).json({
        error: {
          code: 'LIMIT_EXCEEDED',
          message: `maxConcurrent limit reached: ${limits.maxConcurrent} (OD_MEDIA_JOB_MAX_CONCURRENT)`,
        },
      });
    }

    const taskId = randomUUID();
    const task = createMediaTask(taskId, projectId);
    task.kind = request.kind;
    task.limits = limits;
    task.status = 'running';
    persistMediaTask(task);
    // Reserve the concurrency slot synchronously, before the child is
    // actually spawned — a placeholder kill() is replaced once the real
    // child exists (encode's onSpawned / download's onAbort below), but the
    // slot itself must count from the moment the task is created so a
    // third near-simultaneous create sees an accurate count (INV-7.14 (f)).
    registerActiveMediaJob(taskId, () => {});

    const onProgress = (line: string, fraction?: number) => {
      if (typeof fraction === 'number') task.fraction = fraction;
      appendTaskProgress(task, line);
    };

    const runPromise =
      request.kind === 'encode'
        ? runMediaEncodeJob({
            projectDir,
            request,
            overwrite: request.overwrite === true,
            maxDurationMs: limits.maxDurationMs,
            onProgress,
            onSpawned: (kill) => registerActiveMediaJob(taskId, kill),
          })
        : runMediaDownloadJob({
            projectDir,
            url: request.url,
            outputRel: request.output,
            maxOutputBytes: limits.maxOutputBytes,
            maxDurationMs: limits.maxDurationMs,
            onProgress,
            onAbort: (abort) => registerActiveMediaJob(taskId, abort),
          });

    runPromise
      .then((outcome) => {
        unregisterActiveMediaJob(taskId);
        if (outcome.ok) {
          task.status = 'done';
          task.file = outcome.file ?? null;
        } else {
          task.status = 'failed';
          task.error = outcome.error
            ? { message: outcome.error.message, code: outcome.error.code }
            : { message: 'media job failed' };
        }
        task.endedAt = Date.now();
        persistMediaTask(task);
        notifyTaskWaiters(task);
      })
      .catch((err: unknown) => {
        unregisterActiveMediaJob(taskId);
        task.status = 'failed';
        task.error = { message: String(err instanceof Error ? err.message : err), code: 'INVALID_REQUEST' };
        task.endedAt = Date.now();
        persistMediaTask(task);
        notifyTaskWaiters(task);
      });

    res.status(202).json({ taskId, status: task.status, startedAt: task.startedAt });
  });

  // Multi-file upload that the chat composer uses for paste/drop/picker.
  // Files land flat in the project folder; the response carries the same
  // metadata as listFiles so the client can stage them as ChatAttachments
  // without a separate refetch.

}
