import { timingSafeEqual } from 'node:crypto';

export function isTruthyEnvFlag(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isApiAuthDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isTruthyEnvFlag(env.OD_DISABLE_API_AUTH);
}

export function apiTokenFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return (env.OD_API_TOKEN ?? '').trim();
}

export function isApiTokenMiddlewareEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return apiTokenFromEnv(env).length > 0 && !isApiAuthDisabled(env);
}

/**
 * Compares a presented bearer against the configured token in constant time,
 * so a caller cannot recover the token byte by byte from response latency.
 * Mirrors desktop-auth.ts's timingSafeStringEquals; the length check is not
 * constant time, but token length is not the secret. timingSafeEqual throws
 * on differing lengths, so that check is also required for correctness.
 */
export function isMatchingApiToken(presented: string, expected: string): boolean {
  const presentedBytes = Buffer.from(presented, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (presentedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(presentedBytes, expectedBytes);
}
