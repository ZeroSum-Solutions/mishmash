import { describe, expect, it } from 'vitest';

import {
  classifyProviderError,
  ProviderCallError,
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
  // `API_KEY_INVALID` / "API key not valid"), not 401/403.
  it('classifies a 400 with Google\'s API_KEY_INVALID body as invalid-credential', () => {
    const body = JSON.stringify({
      error: {
        code: 400,
        message: 'API key not valid. Please pass a valid API key.',
        status: 'INVALID_ARGUMENT',
        details: [{ reason: 'API_KEY_INVALID' }],
      },
    });
    expect(classifyProviderError(400, body)).toBe('invalid-credential');
  });

  it('classifies a 400 with the plain "API key not valid" phrase as invalid-credential', () => {
    expect(classifyProviderError(400, 'API key not valid.')).toBe('invalid-credential');
  });

  it('does not classify an unrelated 400 as invalid-credential', () => {
    expect(classifyProviderError(400, 'Unknown field: shot_count')).toBe('upstream-error');
  });

  it('classifies 429 as rate-limited', () => {
    expect(classifyProviderError(429, 'quota exceeded')).toBe('rate-limited');
  });

  it('classifies 5xx as upstream-error', () => {
    expect(classifyProviderError(503, 'service unavailable')).toBe('upstream-error');
    expect(classifyProviderError(500, '')).toBe('upstream-error');
  });
});

describe('providerCredentialRejectionMessage', () => {
  it('names the provider and points at the credential, never the raw body', () => {
    const message = providerCredentialRejectionMessage('Google Gemini');
    expect(message).toMatch(/google gemini/i);
    expect(message).toMatch(/credential/i);
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
