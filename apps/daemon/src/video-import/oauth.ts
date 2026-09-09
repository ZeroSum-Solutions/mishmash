// Vimeo OAuth: pending-state cache, redirect-URI derivation, and the
// authorization-code exchange. State handling copies `PendingAuthCache`
// (mcp-oauth.ts:445-507) — an in-memory Map with a TTL sweeper and
// delete-before-age-check one-shot consume, so a daemon restart drops every
// pending authorization and a replayed callback can never reuse a state.
//
// Redirect-URI derivation copies the loopback-validation shape of
// `connectorCallbackUrl` (connectors/routes.ts:261-272), NOT
// `getPublicBaseUrl` (mcp-routes.ts:500-512 / server.ts:1009): that helper
// trusts `req.protocol` / `req.get('host')` with no allowlist, which is
// exactly the unchecked-Host pattern INV-7.8's deeper OAuth matrix
// (W7-R2-25) tests against. This module never imports it. The one thing
// added over the `connectorCallbackUrl` precedent is a bound-port check —
// a loopback hostname with a port that isn't the daemon's own resolved
// port is rejected too, not just non-loopback hosts.

import { normalizeLocalAuthority, isLoopbackHostname } from '../http/local-daemon-request.js';

import type { VideoImportProvider } from '@open-design/contracts';

export interface VideoImportPendingAuthState {
  provider: VideoImportProvider;
  redirectUri: string;
  createdAt: number;
}

/**
 * In-memory pending-state cache for the Vimeo OAuth dance. Deliberately not
 * persisted: the user completes authorization in the same daemon process
 * that minted the state, so a restart correctly drops every unfinished
 * connect attempt rather than leaving a redeemable state on disk.
 */
export class VideoImportPendingAuthCache {
  private readonly store = new Map<string, VideoImportPendingAuthState>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ttlMs: number = 10 * 60 * 1000) {}

  put(state: string, value: VideoImportPendingAuthState): void {
    this.store.set(state, value);
    this.startSweeper();
  }

  /** One-shot consume: delete first, then check age, so an expired entry
   * and a replayed (already-consumed) entry both come back `null`. */
  consume(state: string): VideoImportPendingAuthState | null {
    const value = this.store.get(state);
    if (!value) return null;
    this.store.delete(state);
    if (Date.now() - value.createdAt > this.ttlMs) return null;
    return value;
  }

  size(): number {
    return this.store.size;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startSweeper(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), Math.min(this.ttlMs, 60_000));
    if (typeof this.timer === 'object' && this.timer && typeof (this.timer as { unref?: () => void }).unref === 'function') {
      (this.timer as { unref: () => void }).unref();
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, value] of this.store) {
      if (now - value.createdAt > this.ttlMs) this.store.delete(key);
    }
    if (this.store.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export type RedirectUriDerivationFailure = {
  ok: false;
  status: 400 | 403;
  code: 'FORBIDDEN' | 'VALIDATION_FAILED';
  message: string;
};

export type RedirectUriDerivationResult = { ok: true; redirectUri: string } | RedirectUriDerivationFailure;

export interface DeriveRedirectUriInput {
  provider: VideoImportProvider;
  /** The raw `Host` header value (`req.get('host')`). Never read
   * `X-Forwarded-Host` here — this daemon does not run behind a trusted
   * proxy (`trust proxy` is unset), so Express does not honor it either;
   * reading it directly would reopen the hole this function exists to
   * close. */
  hostHeader: string | undefined;
  /** `req.protocol` — reflects the actual connection, not
   * `X-Forwarded-Proto`, for the same reason. */
  protocol: string;
  /** The daemon's actual bound port (`resolvedPortRef.current`). */
  resolvedPort: number | string | null | undefined;
  /** `OD_VIDEO_IMPORT_PUBLIC_BASE_URL`, when an operator has configured one. */
  publicBaseUrl: string;
}

/**
 * Derive the OAuth callback URI once, at connect time. An operator-declared
 * `publicBaseUrl` always wins (cloud/tailnet deployments); otherwise the
 * request's own Host header must name a loopback address at the daemon's
 * actual bound port. Anything else — a hostile Host, a tailnet/public
 * hostname, a loopback host on the wrong port — fails closed rather than
 * producing a redirect URI a real client could never complete the flow at.
 */
export function deriveVideoImportRedirectUri(input: DeriveRedirectUriInput): RedirectUriDerivationResult {
  const callbackPath = `/api/video-import/oauth/callback/${input.provider}`;

  const configured = input.publicBaseUrl.trim();
  if (configured) {
    if (!/^https?:\/\//i.test(configured)) {
      return {
        ok: false,
        status: 400,
        code: 'VALIDATION_FAILED',
        message: 'OD_VIDEO_IMPORT_PUBLIC_BASE_URL must be an http(s) URL',
      };
    }
    return { ok: true, redirectUri: `${configured.replace(/\/+$/u, '')}${callbackPath}` };
  }

  const authority = normalizeLocalAuthority(input.hostHeader);
  if (!authority) {
    return { ok: false, status: 403, code: 'FORBIDDEN', message: 'video import callback host is invalid' };
  }
  if (!isLoopbackHostname(authority.hostname)) {
    return {
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'video import callback host must be loopback, or configure OD_VIDEO_IMPORT_PUBLIC_BASE_URL',
    };
  }
  if (input.resolvedPort != null && authority.port && authority.port !== String(input.resolvedPort)) {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_FAILED',
      message: "redirect port does not match the daemon's bound port",
    };
  }
  if (input.protocol !== 'http' && input.protocol !== 'https') {
    return { ok: false, status: 400, code: 'VALIDATION_FAILED', message: 'unsupported video import callback protocol' };
  }

  return { ok: true, redirectUri: `${input.protocol}://${input.hostHeader}${callbackPath}` };
}

export interface ExchangeVimeoCodeInput {
  oauthBaseUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

export interface ExchangeVimeoCodeResult {
  accessToken: string;
  refreshToken?: string;
  accountName?: string;
}

/**
 * Exchange an authorization code for a Vimeo access token. Basic-auths the
 * app credentials (Vimeo's own convention) rather than putting them in the
 * body, so they never round-trip through form-encoded logging middleware.
 * Never logs `code`, the response body, or either credential — a caller
 * that needs to record the outcome logs only the provider name and whether
 * this threw (INV-7.8 / the brief's "structural avoidance, not redaction").
 */
export async function exchangeVimeoAuthorizationCode(input: ExchangeVimeoCodeInput): Promise<ExchangeVimeoCodeResult> {
  const basicAuth = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  const response = await fetch(`${input.oauthBaseUrl.replace(/\/+$/u, '')}/oauth/access_token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/vnd.vimeo.*+json;version=3.4',
    },
    body: body.toString(),
  });
  if (!response.ok) {
    throw new Error(`vimeo token exchange failed with status ${response.status}`);
  }
  const parsed = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    user?: { name?: unknown };
  };
  if (typeof parsed.access_token !== 'string' || parsed.access_token.length === 0) {
    throw new Error('vimeo token exchange response missing access_token');
  }
  return {
    accessToken: parsed.access_token,
    ...(typeof parsed.refresh_token === 'string' && parsed.refresh_token.length > 0
      ? { refreshToken: parsed.refresh_token }
      : {}),
    ...(typeof parsed.user?.name === 'string' && parsed.user.name.length > 0
      ? { accountName: parsed.user.name }
      : {}),
  };
}
