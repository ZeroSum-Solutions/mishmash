export const MEDIA_EXECUTION_MODES = [
  'enabled',
  'disabled',
] as const;

export type MediaExecutionMode = (typeof MEDIA_EXECUTION_MODES)[number];

export const MEDIA_SURFACES = [
  'image',
  'video',
  'audio',
] as const;

export type MediaSurface = (typeof MEDIA_SURFACES)[number];

export const MEDIA_POLICY_DENIAL_CODES = [
  'MEDIA_EXECUTION_DISABLED',
  'MEDIA_SURFACE_DENIED',
  'MEDIA_MODEL_DENIED',
] as const;

export type MediaPolicyDenialCode = (typeof MEDIA_POLICY_DENIAL_CODES)[number];

/**
 * Run-scoped policy controlling Open Design-owned media generation only.
 *
 * `allowedSurfaces` and `allowedModels` apply solely to `/api/tools/media/generate`
 * and in-run `od media generate`. External MCP media tools are intentionally
 * unaffected: provider policy for those belongs to the MCP server / orchestrator.
 */
export interface MediaExecutionPolicy {
  mode: MediaExecutionMode;
  allowedSurfaces?: MediaSurface[];
  allowedModels?: string[];
}

export const DEFAULT_MEDIA_EXECUTION_POLICY: MediaExecutionPolicy = {
  mode: 'enabled',
};

export interface MediaPolicyTarget {
  surface: MediaSurface;
  model?: string;
}

export interface MediaPolicyDenial {
  code: MediaPolicyDenialCode;
  message: string;
}

export function mediaExecutionPolicyDenial(
  policy: MediaExecutionPolicy,
  target: MediaPolicyTarget,
): MediaPolicyDenial | null {
  if (policy.mode === 'disabled') {
    return {
      code: 'MEDIA_EXECUTION_DISABLED',
      message: 'media generation is disabled for this run',
    };
  }
  if (
    Array.isArray(policy.allowedSurfaces) &&
    policy.allowedSurfaces.length > 0 &&
    !policy.allowedSurfaces.includes(target.surface)
  ) {
    return {
      code: 'MEDIA_SURFACE_DENIED',
      message: `media surface "${target.surface}" is not allowed for this run`,
    };
  }
  if (
    target.model &&
    Array.isArray(policy.allowedModels) &&
    policy.allowedModels.length > 0 &&
    !policy.allowedModels.includes(target.model)
  ) {
    return {
      code: 'MEDIA_MODEL_DENIED',
      message: `media model "${target.model}" is not allowed for this run`,
    };
  }
  return null;
}

// Public (masked) media provider configuration served by GET /api/media/config
// and returned by PUT /api/media/config
// (`apps/daemon/src/routes/media.ts`, built by `readMaskedConfig` in
// `apps/daemon/src/media/config.ts`). API keys never leave the daemon: the
// entry carries only whether a key is configured, where it came from, and the
// last four characters when the key is stored locally.
//
// These lived as private interfaces in `apps/web/src/state/config.ts` until
// DEF-3.3, and that copy also predated `aliases`, so the web app could not see
// the alias attribution the daemon has emitted since #1277.

/** Model alias map: alias name to the concrete model id it resolves to. */
export type MediaModelAliasMap = Record<string, string>;

/**
 * One provider row of the masked config.
 *
 * Every field except `model` is unconditional on the wire: `readMaskedConfig`
 * builds the row for each id in `PROVIDER_IDS` and always writes `configured`,
 * `source`, `apiKeyTail` and `baseUrl`. The web-private copy this replaced
 * declared them all optional, which is why every read site there still guards
 * with `?.` -- the optionality was defensive coding, not the wire.
 */
export interface PublicMediaProviderConfigEntry {
  configured: boolean;
  /** `'env'`, `'stored'`, an external-credential source, or `'unset'`. */
  source: string;
  /** Last four characters, and only for a locally stored key; else `''`. */
  apiKeyTail: string;
  baseUrl: string;
  model?: string;
}

/**
 * Alias attribution, so Settings can badge each entry "from env" or "from
 * media-config.json" without a second request. `effective` is `stored`
 * overlaid by `env`.
 */
export interface PublicMediaProviderAliases {
  effective: MediaModelAliasMap;
  env: MediaModelAliasMap;
  stored: MediaModelAliasMap;
}

export interface PublicMediaProviderConfigResponse {
  providers: Record<string, PublicMediaProviderConfigEntry>;
  aliases: PublicMediaProviderAliases;
}

function isMediaConfigRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMediaModelAliasMap(value: unknown): value is MediaModelAliasMap {
  return (
    isMediaConfigRecord(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

export function isPublicMediaProviderConfigEntry(
  value: unknown,
): value is PublicMediaProviderConfigEntry {
  if (!isMediaConfigRecord(value)) return false;
  if (typeof value.configured !== 'boolean') return false;
  for (const key of ['source', 'apiKeyTail', 'baseUrl'] as const) {
    if (typeof value[key] !== 'string') return false;
  }
  if (value.model !== undefined && typeof value.model !== 'string') return false;
  return true;
}

export function isPublicMediaProviderAliases(
  value: unknown,
): value is PublicMediaProviderAliases {
  if (!isMediaConfigRecord(value)) return false;
  return (
    isMediaModelAliasMap(value.effective) &&
    isMediaModelAliasMap(value.env) &&
    isMediaModelAliasMap(value.stored)
  );
}

export function isPublicMediaProviderConfigResponse(
  value: unknown,
): value is PublicMediaProviderConfigResponse {
  if (!isMediaConfigRecord(value)) return false;
  const { providers, aliases } = value;
  if (!isMediaConfigRecord(providers)) return false;
  if (!Object.values(providers).every(isPublicMediaProviderConfigEntry)) return false;
  return isPublicMediaProviderAliases(aliases);
}
