// Per-provider credentials for the media dispatcher.
//
// The frontend Settings dialog pushes API keys here via PUT
// /api/media/config; the daemon persists them to .od/media-config.json
// and reads them at generation time. Environment variables override the
// stored values so power users can keep keys out of the workspace
// folder altogether (`OD_OPENAI_API_KEY=… node daemon/cli.js`).
//
// Storage location (precedence high → low):
//   1. OD_MEDIA_CONFIG_DIR=DIR   → <DIR>/media-config.json
//   2. OD_DATA_DIR=DIR           → <DIR>/media-config.json
//   3. (default)                 → <projectRoot>/.od/media-config.json
// The default is unchanged for workspace-local installs. (1) lets a
// supervisor relocate just the credentials file. (2) means installs
// that already set OD_DATA_DIR for the rest of the daemon's runtime
// state (Nix-store / immutable-image installs, the packaged daemon at
// apps/packaged/src/sidecars.ts:createPackagedDaemonManagedPathEnv,
// the Home Manager / NixOS modules) get media-config there too without
// any extra plumbing. Both env values are resolved with the same
// semantics as OD_DATA_DIR in server.ts:resolveDataDir(): the shared
// expandHomePrefix() helper handles `~`, `$HOME`, and `${HOME}` (with
// either `/` or `\` separator), then relative paths anchor to
// <projectRoot> (NOT process.cwd, which is unrelated to the workspace
// when systemd or launchd starts the daemon).
//
// Migration note: a workspace install that sets a custom OD_DATA_DIR
// AND has a pre-existing `<projectRoot>/.od/media-config.json` will
// start reading from `<OD_DATA_DIR>/media-config.json` instead. Move
// the file once or set OD_MEDIA_CONFIG_DIR=<projectRoot>/.od to keep
// the old location.
//
// The file is intentionally simple JSON — no encryption, no schema
// versioning yet. The daemon listens on 127.0.0.1 only and the workspace
// is already trusted, so adding a vault here would mostly be theatre.
// We DO mask keys when reading via the GET endpoint so the UI doesn't
// echo secrets back into the DOM.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MEDIA_PROVIDERS } from './models.js';
import { agentCliEnvForAgent, appConfigDir, readAppConfig } from '../app-config.js';
import { expandHomePrefix } from '../home-expansion.js';
import { spawnEnvForAgent } from '../runtimes/env.js';
import { resolveXAIBearer } from '../integrations/xai-credentials.js';
import { isSandboxModeEnabled } from '../sandbox-mode.js';
import { readMcpConfig, type McpServerConfig } from '../mcp-config.js';
import { getToken, isTokenExpired, setToken, type StoredMcpToken } from '../mcp-tokens.js';
import { refreshAccessToken } from '../mcp-oauth.js';

const PROVIDER_IDS = MEDIA_PROVIDERS.map((p) => p.id);
type ProviderEntry = { apiKey?: string; baseUrl?: string; model?: string };
type ProviderMap = Record<string, ProviderEntry>;
type ModelAliasMap = Record<string, string>;
type JsonRecord = Record<string, unknown>;
type OAuthCredential = { apiKey: string; source: string; baseUrl?: string };
export type CodexSubscriptionStatus = { available: boolean };

// Single env var carries the full alias map as JSON so we don't have
// to dynamically lift `OD_MEDIA_MODEL_ALIAS_<id>=value` into a record
// with all the env-var-name escaping that entails (Windows cmd.exe in
// particular rejects hyphens). The shape mirrors the on-disk
// `aliases` map so users can switch storage layers without rewriting
// their workflow:
//
//   OD_MEDIA_MODEL_ALIASES='{"doubao-seedream-3-0-t2i-250415":"doubao-seedream-5-0"}'
const ENV_MODEL_ALIASES = 'OD_MEDIA_MODEL_ALIASES';

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object';
}

function errorCode(err: unknown): string | undefined {
  return isRecord(err) && typeof err.code === 'string' ? err.code : undefined;
}

const ENV_KEYS: Record<string, string[]> = {
  // OPENAI_API_KEY is the canonical env for the standard OpenAI API.
  // AZURE_API_KEY / AZURE_OPENAI_API_KEY are the canonical envs Azure
  // OpenAI examples use — we share the openai provider slot so a user
  // who pastes an Azure deployment URL into the OpenAI Base URL field
  // gets the credential picked up automatically.
  openai: [
    'OD_OPENAI_API_KEY',
    'OPENAI_API_KEY',
    'AZURE_API_KEY',
    'AZURE_OPENAI_API_KEY',
  ],
  volcengine: ['OD_VOLCENGINE_API_KEY', 'ARK_API_KEY', 'VOLCENGINE_API_KEY'],
  // OD_GROK_API_KEY first (the project-reserved override, same shape as
  // every other provider above), then XAI_API_KEY as the canonical
  // upstream env per docs.x.ai quickstart — so users who already export
  // it for the official SDK don't have to re-paste into Settings.
  grok: ['OD_GROK_API_KEY', 'XAI_API_KEY'],
  nanobanana: ['OD_NANOBANANA_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  imagerouter: ['OD_IMAGEROUTER_API_KEY', 'IMAGEROUTER_API_KEY'],
  openrouter: ['OD_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY'],
  'custom-image': ['OD_CUSTOM_IMAGE_API_KEY', 'CUSTOM_IMAGE_API_KEY'],
  bfl: ['OD_BFL_API_KEY', 'BFL_API_KEY'],
  fal: ['OD_FAL_KEY', 'FAL_KEY'],
  kie: ['OD_KIE_API_KEY', 'KIE_AI_API_KEY'],
  replicate: ['OD_REPLICATE_API_TOKEN', 'REPLICATE_API_TOKEN'],
  google: ['OD_GOOGLE_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  kling: ['OD_KLING_API_KEY', 'KLING_API_KEY'],
  midjourney: ['OD_MIDJOURNEY_API_KEY'],
  minimax: ['OD_MINIMAX_API_KEY', 'MINIMAX_API_KEY'],
  suno: ['OD_SUNO_API_KEY'],
  udio: ['OD_UDIO_API_KEY'],
  elevenlabs: ['OD_ELEVENLABS_API_KEY', 'ELEVENLABS_API_KEY'],
  fishaudio: ['OD_FISHAUDIO_API_KEY', 'FISH_AUDIO_API_KEY'],
  senseaudio: ['OD_SENSEAUDIO_API_KEY', 'SENSEAUDIO_API_KEY'],
  aihubmix: ['OD_AIHUBMIX_API_KEY', 'AIHUBMIX_API_KEY'],
  tavily: ['OD_TAVILY_API_KEY', 'TAVILY_API_KEY'],
  leonardo: ['OD_LEONARDO_API_KEY', 'LEONARDO_API_KEY'],
};

// Resolve an `OD_*_DIR` env override using the same semantics as
// `resolveDataDir()` in server.ts: expandHomePrefix() handles the `~`,
// `$HOME`, and `${HOME}` shorthands (with either `/` or `\` separator),
// then relative paths anchor to <projectRoot>, not process.cwd, since
// the daemon is often launched from a directory that has nothing to do
// with the workspace, e.g. systemd's `/`. The writability check that
// resolveDataDir does on startup is intentionally NOT replicated here:
// configFile() is on the read path and a missing/unwritable directory
// is a normal "no config yet" condition handled by readStored(); the
// write path's mkdir(recursive) creates the directory on first use.
function resolveOverrideDir(raw: string, projectRoot: string): string {
  // Share expandHomePrefix with resolveDataDir (server.ts) so OD_DATA_DIR
  // and OD_MEDIA_CONFIG_DIR cannot split state under a $HOME-style value.
  // A launcher passing OD_DATA_DIR=$HOME/.open-design without a shell to
  // expand it would otherwise route SQLite/projects/artifacts to the
  // expanded path while media-config.json stayed under
  // <projectRoot>/$HOME/.open-design, leaving stored credentials
  // unreachable on the next read.
  const expanded = expandHomePrefix(raw);
  return path.isAbsolute(expanded)
    ? expanded
    : path.resolve(projectRoot, expanded);
}

function envOverrideDir(envName: string, projectRoot: string): string | null {
  const raw = process.env[envName];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? resolveOverrideDir(trimmed, projectRoot) : null;
}

/**
 * Resolve the directory media-config.json (and credentials living next to
 * it, like xai-tokens.json) actually live in. Precedence: explicit
 * media-config override > general data dir > default.
 */
export function mediaConfigDir(projectRoot: string): string {
  return (
    envOverrideDir('OD_MEDIA_CONFIG_DIR', projectRoot)
    ?? envOverrideDir('OD_DATA_DIR', projectRoot)
    ?? path.join(projectRoot, '.od')
  );
}

function configFile(projectRoot: string): string {
  return path.join(mediaConfigDir(projectRoot), 'media-config.json');
}

/**
 * Normalise an arbitrary unknown into a string-to-string map, dropping
 * keys that have empty / non-string values. Shared by the env-var
 * parser and the on-disk reader so both layers reject malformed
 * entries the same way.
 */
function coerceAliasMap(raw: unknown): ModelAliasMap {
  if (!isRecord(raw)) return {};
  const out: ModelAliasMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== 'string' || !k.trim()) continue;
    if (typeof v !== 'string' || !v.trim()) continue;
    out[k.trim()] = v.trim();
  }
  return out;
}

async function readStoredFile(projectRoot: string): Promise<JsonRecord> {
  try {
    const raw = await readFile(configFile(projectRoot), 'utf8');
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return {};
    throw err;
  }
}

async function readStored(projectRoot: string): Promise<ProviderMap> {
  const parsed = await readStoredFile(projectRoot);
  return isRecord(parsed.providers) ? (parsed.providers as ProviderMap) : {};
}

async function readStoredAliases(projectRoot: string): Promise<ModelAliasMap> {
  const parsed = await readStoredFile(projectRoot);
  return coerceAliasMap(parsed.aliases);
}

async function writeStored(
  projectRoot: string,
  providers: ProviderMap,
  aliases?: ModelAliasMap,
): Promise<void> {
  const file = configFile(projectRoot);
  await mkdir(path.dirname(file), { recursive: true });
  // Preserve any existing aliases when the caller doesn't pass them.
  // The Settings UI writes providers only; without this, every
  // provider edit would silently wipe the user's model aliases (issue
  // #1277 introduces aliases but the Settings UI surface for editing
  // them lands in a follow-up PR).
  const resolvedAliases = aliases ?? (await readStoredAliases(projectRoot));
  const body: JsonRecord = { providers };
  if (Object.keys(resolvedAliases).length > 0) {
    body.aliases = resolvedAliases;
  }
  await writeFile(file, JSON.stringify(body, null, 2), 'utf8');
}

function readEnvAliases(): ModelAliasMap {
  const raw = process.env[ENV_MODEL_ALIASES];
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    return coerceAliasMap(JSON.parse(raw));
  } catch {
    // Malformed JSON is non-fatal — the user can fix the env var
    // without restarting the daemon mid-generation, and silent fall-
    // through to the on-disk map matches the precedent of the rest
    // of the env / stored config resolution in this module.
    return {};
  }
}

/**
 * Resolve a registered model id to the wire-name the provider should
 * actually receive on the network. Env wins over stored, mirroring
 * the precedence the rest of media-config uses for `apiKey` (issue
 * #1277). Pass-through when no alias is configured.
 */
export async function resolveModelAlias(
  projectRoot: string,
  modelId: string,
): Promise<string> {
  const envAliases = readEnvAliases();
  if (envAliases[modelId]) return envAliases[modelId]!;
  const stored = await readStoredAliases(projectRoot);
  return stored[modelId] ?? modelId;
}

/**
 * Read the merged alias map (env + stored). Exposed for the
 * `/api/media/config` GET endpoint so the Settings UI can display
 * which aliases are active and where they came from.
 */
export async function readAliasMap(
  projectRoot: string,
): Promise<{ effective: ModelAliasMap; env: ModelAliasMap; stored: ModelAliasMap }> {
  const env = readEnvAliases();
  const stored = await readStoredAliases(projectRoot);
  const effective: ModelAliasMap = { ...stored, ...env };
  return { effective, env, stored };
}

function readEnvKey(providerId: string): string | null {
  const keys = ENV_KEYS[providerId];
  if (!keys) return null;
  for (const k of keys) {
    const v = process.env[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function readNestedString(obj: unknown, keys: string[]): string {
  let cur: unknown = obj;
  for (const key of keys) {
    if (!isRecord(cur)) return '';
    cur = cur[key];
  }
  return typeof cur === 'string' && cur.trim() ? cur.trim() : '';
}

async function readJsonIfPresent(file: string): Promise<JsonRecord | null> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch (err) {
    if (errorCode(err) === 'ENOENT') return null;
    // Auth files are best-effort fallbacks. A malformed local auth cache
    // should not break the Settings page or hide stored provider config.
    return null;
  }
}

export async function resolveCodexImagegenEnv(projectRoot?: string): Promise<NodeJS.ProcessEnv> {
  if (projectRoot) {
    const dataDir = appConfigDir(projectRoot);
    try {
      const appConfig = await readAppConfig(dataDir);
      const configuredEnv = agentCliEnvForAgent(appConfig.agentCliEnv, 'codex');
      return spawnEnvForAgent('codex', process.env, configuredEnv);
    } catch {
      return spawnEnvForAgent('codex', process.env);
    }
  }
  return spawnEnvForAgent('codex', process.env);
}

function codexHomeFromEnv(env: NodeJS.ProcessEnv): string {
  const home = env.CODEX_HOME?.trim() || path.join(os.homedir(), '.codex');
  const resolvedHome = home.startsWith('~/')
    ? path.join(os.homedir(), home.slice(2))
    : home;
  return path.resolve(resolvedHome);
}

export async function resolveCodexSubscriptionStatus(
  projectRoot?: string,
): Promise<CodexSubscriptionStatus> {
  if (isSandboxModeEnabled(process.env)) return { available: false };
  const env = await resolveCodexImagegenEnv(projectRoot);
  const codexAuth = await readJsonIfPresent(
    path.join(codexHomeFromEnv(env), 'auth.json'),
  );
  const authMode = readNestedString(codexAuth, ['auth_mode']);
  const accessToken = readNestedString(codexAuth, ['tokens', 'access_token']);
  return { available: authMode === 'chatgpt' || Boolean(accessToken) };
}

function apiKeyFromCodexAuth(data: unknown): string {
  return readNestedString(data, ['OPENAI_API_KEY']);
}

async function resolveOpenAIAuthFileCredential(): Promise<OAuthCredential | null> {
  if (isSandboxModeEnabled(process.env)) return null;
  const home = os.homedir();
  const codexAuth = await readJsonIfPresent(
    path.join(home, '.codex', 'auth.json'),
  );
  const apiKey = apiKeyFromCodexAuth(codexAuth);
  if (apiKey) {
    return { apiKey, source: 'codex-auth' };
  }

  return null;
}

/**
 * Codex's provider entry is `credentialsRequired: false` — it's a local CLI
 * subscription, not a pasted API key — so there is no bearer token to
 * return. The sentinel apiKey below only makes `Boolean(apiKey)` true for
 * any generic caller; the actual codex dispatch (renderCodexImage) ignores
 * `resolveProviderConfig`'s return value entirely and resolves its own CLI
 * env via resolveCodexImagegenEnv. `source: 'codex-subscription'` is what
 * readMaskedConfig actually surfaces to the Settings/Storyboard UI.
 */
async function resolveCodexOAuthCredential(
  projectRoot: string,
): Promise<OAuthCredential | null> {
  const status = await resolveCodexSubscriptionStatus(projectRoot);
  return status.available
    ? { apiKey: 'codex-subscription-active', source: 'codex-subscription' }
    : null;
}

async function resolveXAIOAuthCredential(
  projectRoot: string,
): Promise<OAuthCredential | null> {
  // 1. OD-native xAI OAuth tokens (written by the daemon's own
  //    xai-oauth.ts client when the user authorizes inside OD).
  const odBearer = await resolveXAIBearer(mediaConfigDir(projectRoot)).catch(
    () => null,
  );
  if (odBearer) {
    return {
      apiKey: odBearer.accessToken,
      source: `oauth-xai-${odBearer.source}`,
    };
  }

  if (isSandboxModeEnabled(process.env)) return null;

  // 2. Borrow the xAI OAuth token Hermes wrote to ~/.hermes/auth.json
  //    when the user ran `hermes auth add xai-oauth`. A user who has already authorized
  //    Hermes doesn't have to run a second OAuth dance inside OD.
  //    (No proactive refresh here — Hermes itself maintains the token,
  //    and we only borrow what is currently fresh.)
  const home = os.homedir();
  const hermesAuth = await readJsonIfPresent(
    path.join(home, '.hermes', 'auth.json'),
  );
  const hermesXaiToken = readNestedString(hermesAuth, [
    'providers',
    'xai-oauth',
    'tokens',
    'access_token',
  ]);
  if (hermesXaiToken) {
    return { apiKey: hermesXaiToken, source: 'oauth-hermes-xai' };
  }

  return null;
}

const HIGGSFIELD_MCP_HOST = 'mcp.higgsfield.ai';

/**
 * Find the enabled http/sse external-MCP server pointing at Higgsfield's
 * hosted MCP endpoint (registered via the built-in `higgsfield-openclaw`
 * template — see mcp-config.ts). Matches on url host rather than a
 * hardcoded server id since a user could in principle register a second,
 * custom server against the same host.
 */
async function findHiggsfieldMcpServer(dataDir: string): Promise<McpServerConfig | null> {
  const config = await readMcpConfig(dataDir);
  for (const server of config.servers) {
    if (!server.enabled) continue;
    if (server.transport !== 'http' && server.transport !== 'sse') continue;
    if (!server.url) continue;
    try {
      const parsed = new URL(server.url);
      // Require https: — matching on hostname alone would let a
      // hand-edited (or malicious) http://mcp.higgsfield.ai server pass
      // this check, and the renderer would then send the OAuth Bearer
      // token to a cleartext endpoint.
      if (parsed.protocol === 'https:' && parsed.hostname === HIGGSFIELD_MCP_HOST) return server;
    } catch {
      // Malformed URLs are already filtered out by sanitizeMcpServer at
      // write time; be defensive on read anyway.
    }
  }
  return null;
}

/**
 * Higgsfield's provider entry has no pasted API key at all — the daemon
 * already holds an OAuth Bearer for it via the external-MCP flow (the same
 * token mcp-config.ts's buildClaudeMcpJson injects into agent spawns; see
 * mcp-tokens.ts). This mirrors resolveCodexOAuthCredential /
 * resolveXAIOAuthCredential's shape so resolveProviderConfig and
 * readMaskedConfig's external-credential branches below can treat it the
 * same way. `mediaConfigDir(projectRoot)` is reused as the dataDir — it
 * already resolves to the SAME directory mcp-config.json / mcp-tokens.json
 * live in by default (both fall back to `<projectRoot>/.od` unless
 * OD_DATA_DIR/OD_MEDIA_CONFIG_DIR override it) — config.ts had no separate
 * dataDir plumbing before this, so this reuses the existing resolution
 * instead of inventing a second one.
 *
 * An expired access token still counts as "configured" as long as a
 * refresh_token is on file — the actual refresh happens lazily at render
 * time (see refreshHiggsfieldMcpToken), not here; this only answers
 * "is there something worth trying."
 */
async function resolveHiggsfieldMcpCredential(
  projectRoot: string,
): Promise<OAuthCredential | null> {
  const dataDir = mediaConfigDir(projectRoot);
  const server = await findHiggsfieldMcpServer(dataDir);
  if (!server) return null;
  const token = await getToken(dataDir, server.id);
  if (!token?.accessToken) return null;
  if (isTokenExpired(token) && !token.refreshToken) return null;
  // server.url is the endpoint actually registered under Settings -> MCP
  // servers — a user could hand-edit it to a non-default path on the same
  // host. Surfacing it here (rather than the hardcoded HIGGSFIELD_MCP_URL
  // default) is what lets the renderer's RPCs hit the real configured
  // endpoint instead of silently ignoring it.
  return { apiKey: token.accessToken, source: 'higgsfield-mcp-oauth', baseUrl: (server.url ?? '').trim() };
}

/**
 * In-memory dedupe for concurrent Higgsfield token refreshes, keyed by
 * dataDir. The stored refresh token is single-use (rotation), so two
 * callers racing a 401 for the same connection must await the SAME
 * in-flight refresh rather than each firing their own — a second
 * concurrent refresh against an already-rotated token fails invalid_grant.
 * Mirrors mcp-tokens.ts's writeLocks map. Keyed on dataDir alone (not also
 * serverId): resolving the matching server is itself async (reads
 * mcp-config.json), and gating the cache lookup on that async resolution
 * first would reopen the exact race this cache exists to close, since two
 * concurrent callers would both miss the cache before either had a chance
 * to populate it. A dataDir can only ever match one enabled Higgsfield MCP
 * server (findHiggsfieldMcpServer takes the first hit), so this is
 * equivalent to keying on (dataDir, serverId) in practice.
 */
const higgsfieldRefreshInFlight = new Map<string, Promise<string | null>>();

async function performHiggsfieldTokenRefresh(dataDir: string): Promise<string | null> {
  const server = await findHiggsfieldMcpServer(dataDir);
  if (!server) return null;
  const token = await getToken(dataDir, server.id);
  if (!token?.refreshToken || !token.tokenEndpoint || !token.clientId) return null;
  const refreshed = await refreshAccessToken({
    tokenEndpoint: token.tokenEndpoint,
    clientId: token.clientId,
    ...(token.clientSecret !== undefined ? { clientSecret: token.clientSecret } : {}),
    refreshToken: token.refreshToken,
    ...(token.scope !== undefined ? { scope: token.scope } : {}),
    ...(token.resourceUrl !== undefined ? { resource: token.resourceUrl } : {}),
  });
  const refreshedScope = refreshed.scope ?? token.scope;
  const next: StoredMcpToken = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? token.refreshToken,
    tokenType: refreshed.token_type ?? 'Bearer',
    savedAt: Date.now(),
    tokenEndpoint: token.tokenEndpoint,
    clientId: token.clientId,
    ...(token.clientSecret !== undefined ? { clientSecret: token.clientSecret } : {}),
    ...(token.authServerIssuer !== undefined ? { authServerIssuer: token.authServerIssuer } : {}),
    ...(token.redirectUri !== undefined ? { redirectUri: token.redirectUri } : {}),
    ...(token.resourceUrl !== undefined ? { resourceUrl: token.resourceUrl } : {}),
    ...(refreshedScope !== undefined ? { scope: refreshedScope } : {}),
    ...(typeof refreshed.expires_in === 'number'
      ? { expiresAt: Date.now() + refreshed.expires_in * 1000 }
      : {}),
  };
  await setToken(dataDir, server.id, next);
  return next.accessToken;
}

/**
 * Refresh the stored Higgsfield MCP token in place and persist the result.
 * Mirrors server.ts's private refreshAndPersistToken (unreachable from here
 * without a circular import — server.ts imports generateMedia from this
 * module's sibling index.ts). Returns the new access token, or null when
 * there's nothing usable to refresh with (no matching server/token, or a
 * token persisted before tokenEndpoint/clientId were recorded) — the
 * renderer treats null (and a thrown refresh failure) as "surface an
 * actionable reconnect message."
 */
export async function refreshHiggsfieldMcpToken(projectRoot: string): Promise<string | null> {
  const dataDir = mediaConfigDir(projectRoot);
  const inFlight = higgsfieldRefreshInFlight.get(dataDir);
  if (inFlight) return inFlight;
  const task = performHiggsfieldTokenRefresh(dataDir).finally(() => {
    if (higgsfieldRefreshInFlight.get(dataDir) === task) higgsfieldRefreshInFlight.delete(dataDir);
  });
  higgsfieldRefreshInFlight.set(dataDir, task);
  return task;
}

/**
 * Resolve credentials for a provider. Env vars win, then stored config,
 * then provider-specific external credential stores. OpenAI only trusts
 * explicit API keys from Codex auth files; Codex/Hermes OAuth tokens are
 * not valid proof that the Images API can be called.
 * Returns { apiKey, baseUrl } where either may be empty string.
 */
export async function resolveProviderConfig(projectRoot: string, providerId: string): Promise<ProviderEntry> {
  const stored = await readStored(projectRoot);
  const entry = stored[providerId] || {};
  const envKey = readEnvKey(providerId);
  const needsExternalCredential = !envKey && !entry.apiKey;
  const externalCredential = needsExternalCredential
    ? providerId === 'openai'
      ? await resolveOpenAIAuthFileCredential()
      : providerId === 'grok'
        ? await resolveXAIOAuthCredential(projectRoot)
        : providerId === 'codex'
          ? await resolveCodexOAuthCredential(projectRoot)
          : providerId === 'higgsfield'
            ? await resolveHiggsfieldMcpCredential(projectRoot)
            : null
    : null;
  return {
    apiKey: envKey || entry.apiKey || externalCredential?.apiKey || '',
    // externalCredential.baseUrl only ever comes from
    // resolveHiggsfieldMcpCredential today (the registered MCP server's own
    // url) — an explicit stored entry.baseUrl still wins over it.
    baseUrl: entry.baseUrl || externalCredential?.baseUrl || '',
    ...(typeof entry.model === 'string' && entry.model.trim()
      ? { model: entry.model.trim() }
      : {}),
  };
}

/**
 * Read the full config for the GET endpoint. API keys are masked so the
 * frontend can show "••••" + a "configured" indicator without leaking
 * the secret back into the DOM.
 */
export interface MaskedConfigResponse {
  providers: Record<string, { configured: boolean; source: string; apiKeyTail: string; baseUrl: string; model?: string }>;
  /**
   * Effective alias map plus source attribution. The Settings UI can
   * show "from env" vs "from media-config.json" badges next to each
   * entry without needing a second endpoint. Empty maps mean no
   * aliases are configured (issue #1277).
   */
  aliases: { effective: ModelAliasMap; env: ModelAliasMap; stored: ModelAliasMap };
}

export async function readMaskedConfig(projectRoot: string): Promise<MaskedConfigResponse> {
  const stored = await readStored(projectRoot);
  const providers: MaskedConfigResponse['providers'] = {};
  for (const id of PROVIDER_IDS) {
    const entry = stored[id] || {};
    const envKey = readEnvKey(id);
    const hasStoredKey = typeof entry.apiKey === 'string' && entry.apiKey.length > 0;
    const needsExternalCredential = !envKey && !hasStoredKey;
    const externalCredential = needsExternalCredential
      ? id === 'openai'
        ? await resolveOpenAIAuthFileCredential()
        : id === 'grok'
          ? await resolveXAIOAuthCredential(projectRoot)
          : id === 'codex'
            ? await resolveCodexOAuthCredential(projectRoot)
            : id === 'higgsfield'
              ? await resolveHiggsfieldMcpCredential(projectRoot)
              : null
      : null;
    providers[id] = {
      configured: Boolean(envKey || hasStoredKey || externalCredential?.apiKey),
      source: envKey ? 'env' : hasStoredKey ? 'stored' : externalCredential?.source || 'unset',
      // Show last 4 chars only when stored locally; never echo env-var
      // or borrowed auth-file/OAuth secrets so power users don't
      // accidentally see them in the DOM.
      apiKeyTail: hasStoredKey && entry.apiKey ? entry.apiKey.slice(-4) : '',
      baseUrl: entry.baseUrl || '',
      ...(typeof entry.model === 'string' && entry.model.trim()
        ? { model: entry.model.trim() }
        : {}),
    };
  }
  const aliases = await readAliasMap(projectRoot);
  return { providers, aliases };
}

/**
 * Write the supplied {providerId: {apiKey, baseUrl}} map. Empty
 * apiKey deletes the entry. Unknown provider IDs are ignored. We
 * deliberately replace the whole map rather than merging so the
 * UI's "clear key" affordance just sends an empty string.
 *
 * Safety: if the incoming payload is empty but the on-disk config
 * currently has providers, we log a WARN to stderr. This catches
 * accidental wipes (e.g. a fresh-localStorage browser bootstrap
 * pushing `{providers: {}}` onto a daemon that had keys from a
 * previous session) without silently destroying the user's data.
 */
export async function writeConfig(projectRoot: string, body: unknown) {
  const incoming = isRecord(body) && isRecord(body.providers) ? body.providers : {};
  const force = Boolean(isRecord(body) && body.force === true);
  const prior = await readStored(projectRoot);
  const next: ProviderMap = {};
  for (const id of PROVIDER_IDS) {
    const entry = incoming[id];
    if (!isRecord(entry)) continue;
    const incomingApiKey =
      typeof entry.apiKey === 'string' && entry.apiKey.trim()
        ? entry.apiKey.trim()
        : '';
    const preserveApiKey = entry.preserveApiKey === true;
    const priorApiKey =
      typeof prior[id]?.apiKey === 'string' && prior[id].apiKey.trim()
        ? prior[id].apiKey.trim()
        : '';
    const apiKey = incomingApiKey || (preserveApiKey ? priorApiKey : '');
    const baseUrl =
      typeof entry.baseUrl === 'string' && entry.baseUrl.trim()
        ? entry.baseUrl.trim()
        : '';
    const model =
      typeof entry.model === 'string' && entry.model.trim()
        ? entry.model.trim()
        : '';
    if (!apiKey && !baseUrl && !model) continue;
    next[id] = {
      apiKey,
      baseUrl,
      ...(model ? { model } : {}),
    };
  }
  if (Object.keys(next).length === 0) {
    const priorIds = Object.keys(prior).filter(
      (id) => prior[id] && (prior[id].apiKey || prior[id].baseUrl),
    );
    if (priorIds.length > 0) {
      if (!force) {
        const err = new Error(
          `refusing to wipe ${priorIds.length} configured provider(s) without force=true: ${priorIds.join(', ')}`,
        ) as Error & { status: number };
        err.status = 409;
        throw err;
      }
      try {
        console.error(
          `[media-config] WARN: incoming PUT empty, would wipe ${priorIds.length} configured provider(s): ${priorIds.join(', ')}`,
        );
      } catch {
        // best-effort logging only
      }
    }
  }
  await writeStored(projectRoot, next);
  return readMaskedConfig(projectRoot);
}

/**
 * Idempotent "seed if empty" write for a single provider slot. The chat
 * proxy uses this to mirror a BYOK key into media-config so the agent's
 * image / TTS path picks up the same credential without the user having
 * to paste it twice. Strict rules:
 *   * No-op when an apiKey is ALREADY stored for `providerId` (the user
 *     may have configured Media independently and we never overwrite).
 *   * No-op when an env-var key resolves for `providerId` (env wins
 *     regardless of disk state — seeding would be invisible).
 *   * No-op when the incoming `apiKey` is empty (we only seed values
 *     the chat layer has just verified upstream).
 *   * Otherwise merge `{ [providerId]: entry }` into the existing
 *     provider map and persist. All other provider slots and aliases
 *     are preserved byte-for-byte.
 *
 * Returns `true` when a write happened (caller can log), `false` when
 * the call was a no-op. Errors are surfaced — the caller decides
 * whether to swallow them (fire-and-forget) or propagate.
 */
export async function seedProviderIfMissing(
  projectRoot: string,
  providerId: string,
  entry: { apiKey?: string; baseUrl?: string; model?: string },
): Promise<boolean> {
  if (!PROVIDER_IDS.includes(providerId)) return false;
  const apiKey = entry.apiKey?.trim() ?? '';
  if (!apiKey) return false;
  // Env var wins at resolution time, so seeding when env is set would
  // be invisible to the user. Skip to avoid confusing on-disk state.
  if (readEnvKey(providerId)) return false;

  const prior = await readStored(projectRoot);
  const priorApiKey =
    typeof prior[providerId]?.apiKey === 'string' && prior[providerId].apiKey.trim()
      ? prior[providerId].apiKey.trim()
      : '';
  if (priorApiKey) return false;

  const baseUrl = entry.baseUrl?.trim() ?? '';
  const model = entry.model?.trim() ?? '';
  const next: ProviderMap = { ...prior };
  next[providerId] = {
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
  };
  await writeStored(projectRoot, next);
  return true;
}
