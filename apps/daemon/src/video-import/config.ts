// Video import provider configuration — env-first, never stored. Mirrors
// media/config.ts's ENV_KEYS precedence (media/config.ts:77-115) and its
// "never echo the secret" masked-status convention
// (media/config.ts:598-632), scoped to the one provider this wave ships:
// Vimeo. App credentials (client id/secret) come ONLY from the environment
// (ZS Vault-managed in production); there is no stored/config-file
// fallback, so `resolveVimeoConfig` never touches disk.

export const VIMEO_CLIENT_ID_ENV_KEYS = ['OD_VIMEO_CLIENT_ID', 'VIMEO_CLIENT_ID'] as const;
export const VIMEO_CLIENT_SECRET_ENV_KEYS = ['OD_VIMEO_CLIENT_SECRET', 'VIMEO_CLIENT_SECRET'] as const;

const DEFAULT_VIMEO_API_BASE_URL = 'https://api.vimeo.com';
const DEFAULT_VIMEO_OAUTH_BASE_URL = 'https://api.vimeo.com';

export interface VimeoEnvConfig {
  clientId: string;
  clientSecret: string;
  /** Whether both `clientId` and `clientSecret` are present. */
  configured: boolean;
  /** Masked status field for the providers route — never the values. */
  credentialSource: 'env' | 'unset';
  apiBaseUrl: string;
  oauthBaseUrl: string;
}

function firstNonEmptyEnv(names: readonly string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

/** Read the Vimeo app credentials from the environment, `OD_VIMEO_*` first. */
export function resolveVimeoConfig(): VimeoEnvConfig {
  const clientId = firstNonEmptyEnv(VIMEO_CLIENT_ID_ENV_KEYS);
  const clientSecret = firstNonEmptyEnv(VIMEO_CLIENT_SECRET_ENV_KEYS);
  const configured = clientId.length > 0 && clientSecret.length > 0;
  return {
    clientId,
    clientSecret,
    configured,
    credentialSource: configured ? 'env' : 'unset',
    apiBaseUrl: (process.env.OD_VIMEO_API_BASE_URL || '').trim() || DEFAULT_VIMEO_API_BASE_URL,
    oauthBaseUrl: (process.env.OD_VIMEO_OAUTH_BASE_URL || '').trim() || DEFAULT_VIMEO_OAUTH_BASE_URL,
  };
}

/**
 * An operator-configured public origin the OAuth redirect URI is built
 * from (cloud/tailnet deployments). Optional — most local/dev daemons
 * derive the redirect URI from the connecting request's own loopback
 * authority instead (see `oauth.ts#deriveVideoImportRedirectUri`).
 */
export function resolveVideoImportPublicBaseUrl(): string {
  return (process.env.OD_VIDEO_IMPORT_PUBLIC_BASE_URL || '').trim();
}
