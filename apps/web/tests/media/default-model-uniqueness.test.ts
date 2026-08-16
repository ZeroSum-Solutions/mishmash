import { describe, expect, it } from 'vitest';

import {
  AUDIO_MODELS_BY_KIND,
  IMAGE_MODELS,
  VIDEO_MODELS,
  type MediaModel,
} from '../../src/media/models';

// `DEFAULT_*_MODEL` is derived as `LIST.find((m) => m.default)?.id ?? LIST[0]!.id`.
// `find` returns the FIRST match, so a catalog carrying two `default: true`
// entries silently resolves to whichever one sorts earlier — the same
// order-decides-the-default defect the Video surface had at the skill layer,
// one level down. VIDEO_MODELS carried two, on different providers
// (`doubao-seedance-2-0-260128` via Volcengine and
// `openrouter/bytedance/seedance-2.0:1080p` via OpenRouter), so reordering the
// list would have moved a user's first video render onto a different account.
//
// The zero case matters too: with no declared default the fallback is `[0]`,
// which makes the default an accident of list position rather than a choice.
const CATALOGS: Array<[string, MediaModel[]]> = [
  ['IMAGE_MODELS', IMAGE_MODELS],
  ['VIDEO_MODELS', VIDEO_MODELS],
  ...Object.entries(AUDIO_MODELS_BY_KIND).map(
    ([kind, models]) => [`AUDIO_MODELS_BY_KIND.${kind}`, models] as [string, MediaModel[]],
  ),
];

describe('media model catalogs', () => {
  it.each(CATALOGS)('%s declares exactly one default model', (_name, models) => {
    const defaults = models.filter((m) => m.default).map((m) => m.id);
    expect(defaults).toHaveLength(1);
  });

  it.each(CATALOGS)('%s has no duplicate model ids', (_name, models) => {
    const ids = models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
