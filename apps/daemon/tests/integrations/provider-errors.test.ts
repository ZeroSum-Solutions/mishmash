import { describe, expect, it } from 'vitest';

import {
  classifyProviderError,
  ProviderCallError,
  providerCallFailureMessage,
  providerCredentialRejectionMessage,
} from '../../src/integrations/provider-errors.js';

describe('classifyProviderError', () => {
  it('classifies 401 as invalid-credential', () => {
    expect(classifyProviderError(401, '')).toBe('invalid-credential');
  });

  it('classifies 403 as invalid-credential', () => {
    expect(classifyProviderError(403, '')).toBe('invalid-credential');
  });

  // BUG-10: Google answers an invalid API key with HTTP 400 (body carries
  // `API_KEY_INVALID` / "API key not valid"), not 401/403. Only classifies
  // as invalid-credential when the caller marks the call as Google-backed —
  // see the isGoogleProvider gate tests below.
  it('classifies a 400 with Google\'s API_KEY_INVALID body as invalid-credential when isGoogleProvider is true', () => {
    const body = JSON.stringify({
      error: {
        code: 400,
        message: 'API key not valid. Please pass a valid API key.',
        status: 'INVALID_ARGUMENT',
        details: [{ reason: 'API_KEY_INVALID' }],
      },
    });
    expect(classifyProviderError(400, body, true)).toBe('invalid-credential');
  });

  it('classifies a 400 with the plain "API key not valid" phrase as invalid-credential when isGoogleProvider is true', () => {
    expect(classifyProviderError(400, 'API key not valid.', true)).toBe('invalid-credential');
  });

  it('does not classify an unrelated 400 as invalid-credential', () => {
    expect(classifyProviderError(400, 'Unknown field: shot_count', true)).toBe('upstream-error');
  });

  it('classifies 429 as rate-limited', () => {
    expect(classifyProviderError(429, 'quota exceeded')).toBe('rate-limited');
  });

  it('classifies 5xx as upstream-error', () => {
    expect(classifyProviderError(503, 'service unavailable')).toBe('upstream-error');
    expect(classifyProviderError(500, '')).toBe('upstream-error');
  });

  // Reviewer finding: the Google body-sniff must not run for every provider.
  // OpenRouter and other aggregators proxy heterogeneous backends and can
  // pass an unrelated backend's error text through verbatim — a 400 that
  // happens to contain Google's phrase from a NON-Google provider is not
  // evidence of a rejected credential and must not override the caller's
  // real error with a generic "rejected the API key" / forced 401.
  it('does NOT classify a non-Google 400 with Google\'s exact phrase as invalid-credential when isGoogleProvider is omitted (defaults false)', () => {
    expect(classifyProviderError(400, 'API key not valid. Please pass a valid API key.')).toBe('upstream-error');
  });

  it('does NOT classify a non-Google 400 with Google\'s exact phrase as invalid-credential when isGoogleProvider is explicitly false', () => {
    const body = JSON.stringify({
      error: {
        code: 400,
        message: 'API key not valid. Please pass a valid API key.',
        status: 'INVALID_ARGUMENT',
        details: [{ reason: 'API_KEY_INVALID' }],
      },
    });
    expect(classifyProviderError(400, body, false)).toBe('upstream-error');
  });

  it('still classifies a non-Google 401/403 as invalid-credential — that part is provider-agnostic', () => {
    expect(classifyProviderError(401, 'unauthorized', false)).toBe('invalid-credential');
    expect(classifyProviderError(403, 'forbidden', false)).toBe('invalid-credential');
  });
});

describe('providerCredentialRejectionMessage', () => {
  it('names the provider and points at the credential, never the raw body', () => {
    const message = providerCredentialRejectionMessage('Google Gemini');
    expect(message).toMatch(/google gemini/i);
    expect(message).toMatch(/credential/i);
  });
});

describe('providerCallFailureMessage', () => {
  it('composes actionable messages without accepting an upstream response body', () => {
    expect(providerCallFailureMessage('Google Gemini', 429, 'rate-limited')).toMatch(/rate limit/i);
    expect(providerCallFailureMessage('Google Gemini', 400, 'upstream-error')).toMatch(/status 400/i);
    expect(providerCallFailureMessage('Google Gemini', 400, 'invalid-credential')).toMatch(/credential/i);
  });
});

describe('ProviderCallError', () => {
  it('carries status and mirrors kind onto code', () => {
    const err = new ProviderCallError(400, 'invalid-credential', 'Google Gemini rejected the API key.');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ProviderCallError');
    expect(err.status).toBe(400);
    expect(err.kind).toBe('invalid-credential');
    expect(err.code).toBe('invalid-credential');
    expect(err.message).toBe('Google Gemini rejected the API key.');
  });
});
