import type { Express, Request, Response } from 'express';
import { emptyMessageCenterPage } from '@open-design/contracts';
import dns from 'node:dns';
import https from 'node:https';

import {
  applyAgentLaunchEnv,
  getAgentDef,
  resolveAgentLaunch,
  spawnEnvForAgent,
} from '../agents.js';
import { readAnalyticsContext } from '../analytics.js';
import { agentCliEnvForAgent, type AppConfigPrefs, writeAppConfig } from '../app-config.js';
import {
  cancelVelaLogin,
  forgetVelaLogin,
  mergeVelaEnv,
  mirrorAmrEntryAnalytics,
  mirrorAmrOnboardingProfileAnalytics,
  parseAmrEntryAnalyticsPayload,
  parseAmrOnboardingProfileAnalyticsPayload,
  applyVelaLiveAccount,
  clearAllVelaLiveAccounts,
  parseVelaLoginAttribution,
  peekVelaLiveAccount,
  readVelaCredentialRevision,
  readVelaLoginStatus,
  setVelaLiveAccount,
  shouldRefreshVelaLiveAccount,
  velaLiveAccountCacheKey,
  spawnVelaLogin,
  type VelaLiveAccount,
} from '../integrations/vela.js';
import {
  clearVelaWalletSnapshotCache,
  velaWalletSnapshotReader,
} from '../integrations/vela-wallet.js';
import { amrModelLoadingCache } from '../runtimes/amr-model-cache.js';
import { AmrVelaUnresolvedError, buildAmrModelCacheKey } from '../runtimes/amr-model-probe.js';
import {
  fetchVelaBillingSummary,
  fetchVelaPresetModels,
  fetchVelaRemoteModelsWithRetry,
} from '../runtimes/defs/amr.js';

const AMR_API_PROXY_PREFIX = '/api/integrations/vela/api-proxy';
const VELA_MESSAGE_CENTER_PREFIX = '/api/integrations/vela/message-center';
const AMR_API_UPSTREAM_ORIGIN = 'https://amr-api.open-design.ai';

type ReadAppConfig = (dataDir: string) => Promise<AppConfigPrefs>;
type PublicBaseUrlResolver = (req: Request) => string;

export interface RegisterVelaRoutesDeps {
  paths: {
    RUNTIME_DATA_DIR: string;
  };
  appConfig: {
    readAppConfig: ReadAppConfig;
  };
  http: {
    getPublicBaseUrl?: PublicBaseUrlResolver;
  };
  env?: NodeJS.ProcessEnv;
}

interface AmrModelProbe {
  launchPath: string;
  env: NodeJS.ProcessEnv;
  configuredEnv: Record<string, string>;
  cacheKey: string;
}

function velaApiProxyBaseUrl(req: Request, getPublicBaseUrl: PublicBaseUrlResolver): string {
  return `${getPublicBaseUrl(req)}${AMR_API_PROXY_PREFIX}`;
}

function velaProxyRequestBody(req: Request): Buffer | null {
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body == null) return null;
  return Buffer.from(JSON.stringify(req.body));
}

function shouldStreamVelaProxyRequest(req: Request, body: Buffer | null): boolean {
  return req.method !== 'GET' && req.method !== 'HEAD' && body == null;
}

/**
 * Pipe one leg of the AMR proxy with an explicit source-error guard.
 *
 * `.pipe()` does NOT forward a source `'error'` to the destination, and a
 * stream that emits `'error'` with no listener throws — crashing the privileged
 * daemon. Both legs of this proxy have real-world error paths: the upstream
 * response body can `ECONNRESET` mid-stream (a network drop, routine), and the
 * inbound request body errors when a client aborts an upload. Routing the
 * source error to `onSourceError` (which tears the proxy down) instead of
 * leaving it unhandled is the invariant that keeps the daemon alive. Exported
 * for test.
 */
export function pipeProxyStreamWithGuard(
  source: NodeJS.ReadableStream,
  dest: NodeJS.WritableStream,
  onSourceError: (err: Error) => void,
): void {
  source.on('error', onSourceError);
  source.pipe(dest);
}

// The Message Center is first-party and answers locally; this generic proxy
// must not offer a second way to reach the vendor's copy of it.
//
// Closing the client call alone was not enough. This route forwards any
// `/api/v1/...` suffix straight upstream, so the vendor's feed stayed
// reachable through a MishMash URL for anything that asked directly — a stale
// bundle mid-deploy, an extension, a curl. The rest of the AMR surface (login,
// wallet, model catalogue) is untouched and still proxies normally.
const AMR_PROXY_DENIED_PREFIX = '/api/v1/message-center';
const AMR_PROXY_ALLOWED_PREFIX = '/api/v1/';

// Compare what the *upstream* will route on, not the bytes we were handed.
// `URL.pathname` neither percent-decodes nor case-folds, and mainstream HTTP
// stacks do both — so `message%2Dcenter` and `Message-Center` would sail past
// a raw compare and still resolve to the vendor's real endpoint.
//
// Every decode stage is classified, not just the last one, because the two
// failure modes pull in opposite directions. Refusing anything that will not
// decode cleanly broke `%25` (an escaped literal percent), which decodes once
// to a bare `%` and then legitimately cannot decode again — a real path on a
// real resource id. Classifying only the fully decoded form would miss a
// vendor endpoint that only appears at an intermediate stage. Looking at all
// of them costs nothing and is wrong in neither direction.
function removeDotSegments(pathname: string): string {
  const out: string[] = [];
  for (const segment of pathname.split('/')) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (out.length > 1) out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join('/') || '/';
}

function settlePathname(pathname: string): string {
  // A decoded `?` or `#` is a delimiter to the upstream, so nothing after it
  // is part of the path it routes on. A backslash is a separator to plenty of
  // stacks.
  const delimiter = pathname.search(/[?#]/);
  const cut = delimiter === -1 ? pathname : pathname.slice(0, delimiter);
  return removeDotSegments(cut.replace(/\\/g, '/'))
    .replace(/\/{2,}/g, '/')
    .toLowerCase();
}

/**
 * Every form of the path an upstream might route on, most-encoded first.
 * Returns null only when the suffix cannot be parsed at all, or when it is
 * still decoding after the pass budget — a shape no real path has, and the one
 * case where refusing is safer than guessing.
 */
function amrProxyPathStages(suffix: string): string[] | null {
  let pathname: string;
  try {
    pathname = new URL(suffix, 'http://amr-proxy.local').pathname;
  } catch {
    return null;
  }
  const stages = [settlePathname(pathname)];
  for (let pass = 0; pass < 4; pass += 1) {
    if (!pathname.includes('%')) return stages;
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      // Nothing further to decode; what we have is what the upstream sees.
      return stages;
    }
    if (decoded === pathname) return stages;
    pathname = decoded;
    stages.push(settlePathname(pathname));
  }
  return pathname.includes('%') ? null : stages;
}

function isAmrProxyDeniedPath(pathname: string): boolean {
  return pathname === AMR_PROXY_DENIED_PREFIX || pathname.startsWith(`${AMR_PROXY_DENIED_PREFIX}/`);
}

function proxyAmrApiRequest(req: Request, res: Response): void {
  const suffix = req.originalUrl.slice(AMR_API_PROXY_PREFIX.length);
  if (!suffix.startsWith('/api/v1/')) {
    res.status(404).json({ error: 'unknown_amr_api_proxy_path' });
    return;
  }
  const stages = amrProxyPathStages(suffix);
  if (stages === null || !stages[stages.length - 1]!.startsWith(AMR_PROXY_ALLOWED_PREFIX)) {
    res.status(404).json({ error: 'unknown_amr_api_proxy_path' });
    return;
  }
  if (stages.some(isAmrProxyDeniedPath)) {
    res.status(404).json({ error: 'message_center_is_local' });
    return;
  }
  const target = new URL(suffix, AMR_API_UPSTREAM_ORIGIN);
  const body = velaProxyRequestBody(req);
  const streamBody = shouldStreamVelaProxyRequest(req, body);
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (
      lower === 'host' ||
      lower === 'connection' ||
      lower === 'transfer-encoding'
    ) {
      continue;
    }
    if (lower === 'content-length' && body) continue;
    if (value !== undefined) headers[key] = value;
  }
  if (body) headers['content-length'] = String(body.length);

  const upstream = https.request(
    target,
    {
      method: req.method,
      headers,
      // Pin the upstream connection to IPv4 (broken v6 edge paths, #3726)
      // but preserve the caller's `all` flag: Node's autoSelectFamily calls
      // this with `all: true` and needs the address array back — overriding
      // it to false fails every request with "Invalid IP address: undefined".
      lookup: (hostname, options, callback) => {
        dns.lookup(hostname, { ...options, family: 4 }, callback);
      },
    },
    (upstreamRes) => {
      res.status(upstreamRes.statusCode ?? 502);
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value !== undefined) res.setHeader(key, value);
      }
      pipeProxyStreamWithGuard(upstreamRes, res, (err) => {
        if (!res.headersSent) {
          res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
        } else {
          res.destroy();
        }
      });
    },
  );
  upstream.setTimeout(30_000, () => upstream.destroy(new Error('AMR API proxy timed out')));
  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    } else {
      res.end();
    }
  });
  if (body) upstream.write(body);
  if (streamBody) {
    pipeProxyStreamWithGuard(req, upstream, () => upstream.destroy());
  } else {
    upstream.end();
  }
}

/**
 * Paths the local Message Center answers as a read acknowledgement.
 *
 * Kept as an explicit allowlist rather than a catch-all so an unknown path
 * still 404s. `GET /messages` is handled separately because it returns a page
 * rather than an acknowledgement.
 */
function isLocalMessageCenterReadPath(method: string, pathname: string): boolean {
  if (method !== 'POST') return false;
  return pathname === '/read-all' || /^\/messages\/[^/]+\/read$/.test(pathname);
}

export function registerVelaRoutes(app: Express, deps: RegisterVelaRoutesDeps): void {
  const env = deps.env ?? process.env;
  const { RUNTIME_DATA_DIR } = deps.paths;
  const { readAppConfig } = deps.appConfig;
  const getPublicBaseUrl = deps.http.getPublicBaseUrl ?? ((req: Request) => {
    const proto = req.protocol || 'http';
    const host = req.get('host');
    return host ? `${proto}://${host}` : 'http://localhost:7456';
  });

  function resolveAmrModelProbeForEnv(configuredEnv: Record<string, string>): AmrModelProbe {
    const def = getAgentDef('amr');
    if (!def) throw new Error('AMR runtime definition is missing');
    const agentLaunch = resolveAgentLaunch(def, configuredEnv);
    const launchPath = agentLaunch.launchPath ?? agentLaunch.selectedPath;
    if (!launchPath) throw new AmrVelaUnresolvedError();
    const spawnEnv = applyAgentLaunchEnv(
      spawnEnvForAgent(
        def.id,
        {
          ...env,
          ...(def.env || {}),
        },
        configuredEnv,
        undefined,
      ),
      agentLaunch,
    );
    const credentialRevision = readVelaCredentialRevision(env, configuredEnv);
    const cacheKey = buildAmrModelCacheKey({
      launchPath,
      env: spawnEnv,
      credentialRevision,
    });
    return { launchPath, env: spawnEnv, configuredEnv, cacheKey };
  }

  async function resolveAmrModelProbe(): Promise<AmrModelProbe> {
    const appConfig = await readAppConfig(RUNTIME_DATA_DIR);
    const configuredEnv = agentCliEnvForAgent(appConfig.agentCliEnv, 'amr');
    return resolveAmrModelProbeForEnv(configuredEnv);
  }

  // Single-flight the live billing fetch per credential revision. Treating
  // `peekVelaLiveAccount(key) === null` as the cold signal (rather than the
  // refresh throttle) means a concurrent second /status that arrives during the
  // first fetch awaits the SAME promise instead of slipping past the throttle
  // and returning config-only — which the read-once surfaces can't recover from.
  const inFlightVelaAccountFetches = new Map<
    string,
    Promise<VelaLiveAccount | null>
  >();
  const inFlightVelaAccountInvalidations = new Set<string>();
  function fetchVelaLiveAccountSingleFlight(
    accountCacheKey: string,
    probe: AmrModelProbe,
    options: { invalidateModelsOnPlanChange?: boolean } = {},
  ): Promise<VelaLiveAccount | null> {
    if (options.invalidateModelsOnPlanChange === true) {
      inFlightVelaAccountInvalidations.add(accountCacheKey);
    }
    const existing = inFlightVelaAccountFetches.get(accountCacheKey);
    if (existing) return existing;
    const pending = (async () => {
      const previousAccount = peekVelaLiveAccount(accountCacheKey);
      amrModelLoadingCache.warm(probe.cacheKey, () =>
        fetchVelaRemoteModelsWithRetry(probe.launchPath, probe.env),
      );
      const account = await fetchVelaBillingSummary(probe.launchPath, probe.env);
      if (
        inFlightVelaAccountInvalidations.has(accountCacheKey) &&
        (!previousAccount || previousAccount.plan !== account.plan)
      ) {
        amrModelLoadingCache.invalidate(probe.cacheKey);
      }
      setVelaLiveAccount(accountCacheKey, account);
      return account;
    })()
      .catch((err) => {
        // Keep the refresh throttle as a short negative cache/backoff. /status
        // is read by focus/menu/login surfaces, so a persistent optional
        // billing failure must not make every poll await the same slow probe.
        console.warn('[amr] live account fetch failed', err);
        return null;
      })
      .finally(() => {
        inFlightVelaAccountFetches.delete(accountCacheKey);
        inFlightVelaAccountInvalidations.delete(accountCacheKey);
      });
    inFlightVelaAccountFetches.set(accountCacheKey, pending);
    return pending;
  }

  app.get('/api/amr/models', async (_req, res) => {
    try {
      const probe = await resolveAmrModelProbe();
      const response = await amrModelLoadingCache.get(probe.cacheKey, {
        fetchPreset: () => fetchVelaPresetModels(probe.launchPath, probe.env),
        fetchRemote: () => fetchVelaRemoteModelsWithRetry(probe.launchPath, probe.env),
      });
      res.json(response);
    } catch (err) {
      if (err instanceof AmrVelaUnresolvedError) {
        // AMR is an optional runtime; a host without the vela CLI gets an
        // empty catalog, not a server error (Home polls this on every load).
        res.json({ source: 'preset', models: [], refreshing: false });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/integrations/vela/status', async (_req, res) => {
    try {
      const appConfig = await readAppConfig(RUNTIME_DATA_DIR);
      const configuredEnv = agentCliEnvForAgent(appConfig.agentCliEnv, 'amr');
      const refresh = _req.query.refresh === '1' || _req.query.refresh === 'true';
      const status = readVelaLoginStatus(mergeVelaEnv(env, configuredEnv));
      if (status.loggedIn) {
        // Key the live-account cache by the full credential revision (not just
        // profile) so a logout / account switch can never surface the previous
        // account's plan or balance. Merge the cached projection synchronously
        // (works for env-backed sessions where status.user is null too); the
        // background refresh below updates the cache for the next poll.
        const accountCacheKey = velaLiveAccountCacheKey(
          readVelaCredentialRevision(env, configuredEnv),
        );
        const probe = resolveAmrModelProbeForEnv(configuredEnv);
        const cachedAccount = peekVelaLiveAccount(accountCacheKey);
        if (refresh) {
          const liveAccount = await fetchVelaLiveAccountSingleFlight(accountCacheKey, probe, {
            invalidateModelsOnPlanChange: true,
          });
          applyVelaLiveAccount(status, liveAccount);
        } else if (!cachedAccount) {
          // Cold cache (or a fetch already in flight): BLOCK on the single-flight
          // billing fetch so the first open already carries plan/balance. The
          // consumers (settings card, inline switcher, avatar) read /status once
          // and do not re-poll, so returning config-only here would hide the
          // fields until the user refocuses. On failure the helper resolves null
          // and the refresh throttle becomes a short negative cache/backoff, so
          // repeated menu/focus polls degrade to config-only instead of each
          // awaiting the same optional billing probe.
          const liveAccount =
            inFlightVelaAccountFetches.has(accountCacheKey) ||
            shouldRefreshVelaLiveAccount(accountCacheKey)
              ? await fetchVelaLiveAccountSingleFlight(accountCacheKey, probe)
              : null;
          applyVelaLiveAccount(status, liveAccount);
        } else {
          // Warm cache: serve it immediately; refresh in the background for the
          // next poll once the TTL has lapsed.
          applyVelaLiveAccount(status, cachedAccount);
          if (shouldRefreshVelaLiveAccount(accountCacheKey)) {
            void fetchVelaLiveAccountSingleFlight(accountCacheKey, probe, {
              invalidateModelsOnPlanChange: true,
            }).catch(() => {});
          }
        }
      }
      res.json(status);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/integrations/vela/wallet', async (req, res) => {
    try {
      const appConfig = await readAppConfig(RUNTIME_DATA_DIR);
      const configuredEnv = agentCliEnvForAgent(appConfig.agentCliEnv, 'amr');
      const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const snapshot = await velaWalletSnapshotReader.read({
        env,
        configuredEnv,
        refresh,
      });
      if (refresh) {
        try {
          const modelProbe = resolveAmrModelProbeForEnv(configuredEnv);
          amrModelLoadingCache.invalidate(modelProbe.cacheKey);
        } catch (err) {
          console.warn('[amr] model cache invalidation after wallet refresh failed', err);
        }
      }
      res.json(snapshot);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.all('/api/integrations/vela/api-proxy/*splat', proxyAmrApiRequest);

  // The Message Center is a first-party surface and answers locally.
  //
  // This route used to proxy to the AMR vendor's own message feed, so the
  // panel presented someone else's announcements as if they were MishMash's,
  // and polled that vendor every 60 seconds whether or not anyone had opened
  // the panel. The route, its shape, the web panel and `od message-center` all
  // stay exactly as they were — only what answers them changed, which is what
  // keeps the UI/CLI pair and the capability manifest intact.
  //
  // Empty is the honest answer until there is a first-party source of
  // messages. Deliberately not a 404 or a 501: the capability exists, it just
  // has nothing to report.
  //
  // No control-key gate any more. That gate authorized the vendor call, and
  // there is no vendor call left to authorize; keeping it would only mean a
  // 401 on a route that reads local, empty data.
  app.all('/api/integrations/vela/message-center/*splat', (req, res) => {
    const suffix = req.originalUrl.slice(VELA_MESSAGE_CENTER_PREFIX.length);
    const pathname = new URL(suffix, 'http://message-center.local').pathname;
    if (req.method === 'GET' && pathname === '/messages') {
      res.json(emptyMessageCenterPage());
      return;
    }
    if (isLocalMessageCenterReadPath(req.method, pathname)) {
      // Nothing to mark: there are no messages. Acknowledged rather than
      // errored, so a client that optimistically marks read still succeeds.
      res.json({ ok: true });
      return;
    }
    res.status(404).json({ error: 'unknown_message_center_path' });
  });

  app.post('/api/integrations/vela/login', async (req, res) => {
    try {
      const appConfig = await readAppConfig(RUNTIME_DATA_DIR);
      const configuredEnv = agentCliEnvForAgent(appConfig.agentCliEnv, 'amr');
      const analyticsContext = readAnalyticsContext(req);
      const attribution = parseVelaLoginAttribution(req.body);
      let loginAttribution = attribution;
      if (attribution) {
        if (analyticsContext && appConfig.telemetry?.metrics === true) {
          loginAttribution = { ...attribution, odDeviceId: analyticsContext.deviceId };
        } else {
          const withoutDeviceId = { ...attribution };
          delete withoutDeviceId.odDeviceId;
          loginAttribution = withoutDeviceId;
        }
      }
      // Start device authorization over a direct connection first. The
      // daemon-local IPv4 proxy (added in #4210 for hosts whose direct
      // amr-api.open-design.ai edge path is broken, #3726) re-originates the
      // request through the daemon. Behind a corporate transparent proxy that
      // hijacks amr-api.open-design.ai onto an internal gateway (e.g.
      // 飞连/CorpLink → 30.x), that extra hop makes the upstream lose the
      // client IP and reject device authorization with
      // "502: Invalid IP address: undefined", even though the direct path
      // resolves fine. So only fall back to the proxy when the direct attempt
      // fails to start — never when a login is already in flight.
      let spawned;
      try {
        spawned = await spawnVelaLogin({
          configuredEnv,
          attribution: loginAttribution,
          // Block until the direct attempt reaches device-auth steady state or
          // exits/errors before it, so a direct failure that arrives AFTER the
          // 250ms startup grace (the common shape on a broken edge path) still
          // falls through to the proxy retry below instead of returning 202.
          waitForActivation: true,
        });
      } catch (directErr) {
        const directMessage =
          directErr instanceof Error ? directErr.message : String(directErr);
        if (/already running/i.test(directMessage)) throw directErr;
        spawned = await spawnVelaLogin({
          configuredEnv,
          attribution: loginAttribution,
          defaultApiUrl: velaApiProxyBaseUrl(req, getPublicBaseUrl),
          waitForActivation: true,
        });
      }
      res.status(202).json(spawned);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /already running/i.test(message) ? 409 : 500;
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/integrations/vela/login/cancel', (_req, res) => {
    try {
      res.json(cancelVelaLogin());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post('/api/integrations/vela/analytics-entry', async (req, res) => {
    const payload = parseAmrEntryAnalyticsPayload(req.body);
    if (!payload) {
      res.status(400).json({ error: 'invalid_amr_entry_analytics' });
      return;
    }
    const analyticsContext = readAnalyticsContext(req);
    if (!analyticsContext) {
      res.status(202).json({ mirrored: false });
      return;
    }
    const appConfig = await readAppConfig(RUNTIME_DATA_DIR);
    if (appConfig.telemetry?.metrics !== true) {
      res.status(202).json({ mirrored: false });
      return;
    }
    const result = await mirrorAmrEntryAnalytics(payload, {
      analyticsContext,
      env,
    });
    res.status(202).json(result);
  });

  app.post('/api/integrations/vela/analytics-profile', async (req, res) => {
    const payload = parseAmrOnboardingProfileAnalyticsPayload(req.body);
    if (!payload) {
      res.status(400).json({ error: 'invalid_amr_profile_analytics' });
      return;
    }
    const analyticsContext = readAnalyticsContext(req);
    if (!analyticsContext) {
      res.status(202).json({ mirrored: false });
      return;
    }
    const appConfig = await readAppConfig(RUNTIME_DATA_DIR);
    if (appConfig.telemetry?.metrics !== true) {
      res.status(202).json({ mirrored: false });
      return;
    }
    const canonicalPayload = { ...payload, odDeviceId: analyticsContext.deviceId };
    const result = await mirrorAmrOnboardingProfileAnalytics(canonicalPayload, {
      analyticsContext,
      env,
    });
    res.status(202).json(result);
  });

  app.post('/api/integrations/vela/logout', async (_req, res) => {
    try {
      const appConfig = await readAppConfig(RUNTIME_DATA_DIR);
      const configuredEnv = agentCliEnvForAgent(appConfig.agentCliEnv, 'amr');
      forgetVelaLogin(mergeVelaEnv(env, configuredEnv));
      // Drop any cached plan/balance so the next login can't surface this
      // (now signed-out) account's billing data.
      clearAllVelaLiveAccounts();
      clearVelaWalletSnapshotCache();
      delete env.VELA_RUNTIME_KEY;
      delete env.VELA_LINK_URL;
      const agentCliEnv = { ...(appConfig.agentCliEnv ?? {}) };
      const amrEnv = { ...(agentCliEnv.amr ?? {}) };
      delete amrEnv.VELA_RUNTIME_KEY;
      delete amrEnv.VELA_LINK_URL;
      if (Object.keys(amrEnv).length > 0) {
        agentCliEnv.amr = amrEnv;
      } else {
        delete agentCliEnv.amr;
      }
      await writeAppConfig(RUNTIME_DATA_DIR, { agentCliEnv });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}
