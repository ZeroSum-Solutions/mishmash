import { describe, expect, it } from 'vitest';

import {
  isPromptTemplateResponse,
  isPromptTemplateSummary,
  isPromptTemplatesResponse,
  isPublicMediaProviderConfigEntry,
  isPublicMediaProviderConfigResponse,
  promptTemplateMediaAspect,
} from '../src/index';

// These guards are what makes "packages/contracts owns this envelope" a claim a
// test at the HTTP boundary can falsify (DEF-3.3). `e2e/tests/w3-read-endpoints.test.ts`
// runs them against real daemon bodies, which only ever exercises the accepting
// path. The cases below are the rejecting half: a guard that has never said no
// cannot catch a future loosening of itself.

/** A body `readMaskedConfig` really produces (apps/daemon/src/media/config.ts). */
function mediaConfigBody() {
  return {
    aliases: {
      effective: { fast: 'gpt-image-1' },
      env: {},
      stored: { fast: 'gpt-image-1' },
    },
    providers: {
      openai: { apiKeyTail: '', baseUrl: '', configured: true, source: 'env' },
      replicate: {
        apiKeyTail: 'cd12',
        baseUrl: 'https://api.replicate.com',
        configured: true,
        model: 'black-forest-labs/flux-dev',
        source: 'stored',
      },
    },
  };
}

/** An entry the prompt-template listing really produces. */
function promptTemplateSummary() {
  return {
    aspect: '2:3',
    category: 'portrait',
    id: 'studio-portrait',
    source: { license: 'CC-BY-4.0', repo: 'example/prompts' },
    summary: 'A softly lit studio portrait.',
    surface: 'image' as const,
    title: 'Studio portrait',
  };
}

describe('public media provider config guard', () => {
  it('accepts the body the daemon sends', () => {
    expect(isPublicMediaProviderConfigResponse(mediaConfigBody())).toBe(true);
  });

  it('rejects a body with no aliases, which is what the web-private copy allowed', () => {
    const { providers } = mediaConfigBody();
    expect(isPublicMediaProviderConfigResponse({ providers })).toBe(false);
  });

  it('rejects providers that is not a record of entries', () => {
    const body = mediaConfigBody();
    expect(isPublicMediaProviderConfigResponse({ ...body, providers: [] })).toBe(false);
    expect(
      isPublicMediaProviderConfigResponse({ ...body, providers: { openai: 'configured' } }),
    ).toBe(false);
  });

  it('rejects an alias map whose values are not model ids', () => {
    const body = mediaConfigBody();
    expect(
      isPublicMediaProviderConfigResponse({
        ...body,
        aliases: { ...body.aliases, env: { fast: 7 } },
      }),
    ).toBe(false);
  });

  it('rejects an entry missing a field the daemon always writes', () => {
    const entry = { apiKeyTail: '', baseUrl: '', configured: true, source: 'env' };
    expect(isPublicMediaProviderConfigEntry(entry)).toBe(true);
    for (const key of ['configured', 'source', 'apiKeyTail', 'baseUrl'] as const) {
      const { [key]: _dropped, ...withoutKey } = entry;
      expect(isPublicMediaProviderConfigEntry(withoutKey), `dropping ${key}`).toBe(false);
    }
  });

  it('rejects a non-object', () => {
    for (const value of [null, undefined, 'providers', 42, []]) {
      expect(isPublicMediaProviderConfigResponse(value)).toBe(false);
    }
  });
});

describe('prompt template guards', () => {
  it('accepts the listing and detail bodies the daemon sends', () => {
    const summary = promptTemplateSummary();
    expect(isPromptTemplatesResponse({ promptTemplates: [summary] })).toBe(true);
    expect(isPromptTemplatesResponse({ promptTemplates: [] })).toBe(true);
    expect(
      isPromptTemplateResponse({ promptTemplate: { ...summary, prompt: 'A studio portrait of…' } }),
    ).toBe(true);
  });

  it('rejects a summary whose surface is outside the union', () => {
    expect(isPromptTemplateSummary({ ...promptTemplateSummary(), surface: 'audio' })).toBe(false);
  });

  it('rejects a summary with no source attribution', () => {
    const { source: _source, ...withoutSource } = promptTemplateSummary();
    expect(isPromptTemplateSummary(withoutSource)).toBe(false);
    expect(
      isPromptTemplateSummary({ ...promptTemplateSummary(), source: { repo: 'example/prompts' } }),
    ).toBe(false);
  });

  it('rejects a tag list that is not all strings', () => {
    expect(isPromptTemplateSummary({ ...promptTemplateSummary(), tags: ['soft', 3] })).toBe(false);
  });

  it('rejects the listing when it is not an array of summaries', () => {
    expect(isPromptTemplatesResponse({ promptTemplates: promptTemplateSummary() })).toBe(false);
    expect(isPromptTemplatesResponse({})).toBe(false);
  });

  it('rejects a detail body with no prompt, which is what the listing strips', () => {
    expect(isPromptTemplateResponse({ promptTemplate: promptTemplateSummary() })).toBe(false);
  });
});

// `promptTemplateMediaAspect` is the narrowing the two types exist to make
// safe: `PromptTemplateSummary.aspect` describes the wire, which carries
// ratios the media surfaces do not offer, and `PromptTemplateMetadata.aspect`
// describes what the product can act on and is persisted on the project. The
// cases below are the behaviour that difference is for. Without them the
// helper's INVARIANT docblock is the only statement of a rule that changes
// what the agent reads every turn.
describe('promptTemplateMediaAspect', () => {
  it('drops a catalogue ratio the media surfaces do not offer', () => {
    // `2:3` is shipped today by the prompt-template catalogue.
    expect(promptTemplateMediaAspect('2:3')).toBeUndefined();
  });

  it('passes through every ratio MediaAspect admits', () => {
    for (const aspect of ['1:1', '16:9', '9:16', '4:3', '3:4'] as const) {
      expect(promptTemplateMediaAspect(aspect)).toBe(aspect);
    }
  });

  it('leaves an unset aspect unset rather than inventing a default', () => {
    expect(promptTemplateMediaAspect(undefined)).toBeUndefined();
    expect(promptTemplateMediaAspect('')).toBeUndefined();
  });
});
