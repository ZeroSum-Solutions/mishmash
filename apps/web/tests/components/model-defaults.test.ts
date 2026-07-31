import { describe, expect, it } from 'vitest';
import type { MediaModel } from '../../src/media/models';
import {
  defaultConfiguredModel,
  isModelConfigured,
  modelSortPriority,
  type ConfiguredProviderMap,
} from '../../src/components/storyboard/model-defaults';

// Real provider ids from apps/web/src/media/models.ts — modelSortPriority /
// isModelConfigured look these up against the actual MEDIA_PROVIDERS
// catalog, so fixtures must use real ids rather than made-up ones:
//   - 'codex'      integrated: true,  credentialsRequired: false (subscription lane)
//   - 'openrouter'  integrated: true,  credentialsRequired: true  (needs a real key)
//   - 'openai'      integrated: true,  credentialsRequired: undefined (needs a real key)
//   - 'bfl'         integrated: false (no real dispatcher — placeholder only)

function model(overrides: Partial<MediaModel> & Pick<MediaModel, 'id' | 'provider'>): MediaModel {
  return { label: overrides.id, hint: '', caps: ['t2i'], ...overrides };
}

const CODEX_MODEL = model({ id: 'codex-gpt-image-2', provider: 'codex' });
const OPENROUTER_MODEL = model({ id: 'openrouter/black-forest-labs/flux-1.1-pro', provider: 'openrouter' });
const OPENAI_MODEL = model({ id: 'gpt-image-2', provider: 'openai' });
const BFL_MODEL = model({ id: 'flux-1.1-pro', provider: 'bfl' });

describe('model-defaults tier ordering', () => {
  it('a subscription-configured codex lane (tier 1) beats an unconfigured API provider (tier 2)', () => {
    const configured: ConfiguredProviderMap = {};

    expect(modelSortPriority(CODEX_MODEL, configured)).toBe(1);
    expect(modelSortPriority(OPENROUTER_MODEL, configured)).toBe(2);

    const picked = defaultConfiguredModel([OPENROUTER_MODEL, CODEX_MODEL], configured);
    expect(picked?.id).toBe(CODEX_MODEL.id);
  });

  it('a real configured provider (tier 0) still beats codex (tier 1)', () => {
    const configured: ConfiguredProviderMap = {
      openai: { apiKey: '', baseUrl: '', apiKeyConfigured: true, apiKeyTail: '-key' },
    };

    expect(modelSortPriority(OPENAI_MODEL, configured)).toBe(0);
    expect(modelSortPriority(CODEX_MODEL, configured)).toBe(1);

    const picked = defaultConfiguredModel([CODEX_MODEL, OPENAI_MODEL], configured);
    expect(picked?.id).toBe(OPENAI_MODEL.id);
  });

  it('an integrated:false provider (bfl) is never treated as configured, even with a credentials-shaped entry', () => {
    const configured: ConfiguredProviderMap = {
      bfl: { apiKey: 'looks-real', baseUrl: '', apiKeyConfigured: true, apiKeyTail: '1234' },
    };

    expect(isModelConfigured(BFL_MODEL, configured)).toBe(false);
    expect(modelSortPriority(BFL_MODEL, configured)).toBe(2);
  });

  it('an integrated:false provider is never picked as the default over a ready integrated provider', () => {
    const configured: ConfiguredProviderMap = {
      bfl: { apiKey: 'looks-real', baseUrl: '', apiKeyConfigured: true, apiKeyTail: '1234' },
      openrouter: { apiKey: '', baseUrl: '', apiKeyConfigured: true, apiKeyTail: 'abcd' },
    };

    // bfl listed FIRST, with credentials that look configured — should still
    // lose to openrouter, the only genuinely ready provider in the list.
    const picked = defaultConfiguredModel([BFL_MODEL, OPENROUTER_MODEL], configured);
    expect(picked?.id).toBe(OPENROUTER_MODEL.id);
  });

  it('picks tier 0 default over tier 1 default when both are flagged default:true', () => {
    const configured: ConfiguredProviderMap = {
      openai: { apiKey: '', baseUrl: '', apiKeyConfigured: true, apiKeyTail: '-key' },
    };
    const codexDefault = { ...CODEX_MODEL, default: true };
    const openaiDefault = { ...OPENAI_MODEL, default: true };

    const picked = defaultConfiguredModel([codexDefault, openaiDefault], configured);
    expect(picked?.id).toBe(openaiDefault.id);
  });

  it('falls back to the catalog default when nothing in the list is ready', () => {
    // Neither provider is integrated, so `ready` is empty and the function
    // falls back to the plain catalog default rather than returning
    // undefined — a fresh machine still gets a sane starting pick.
    const unsupported = model({ id: 'kling-2.0', provider: 'kling', default: true });
    const picked = defaultConfiguredModel([BFL_MODEL, unsupported], {});
    expect(picked?.id).toBe(unsupported.id);
  });
});
