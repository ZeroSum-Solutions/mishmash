// Model-default resolution for the Storyboard pickers. Spec requirement:
// "Model default must respect configured providers" — read GET
// /api/media/config (providers.<id>.configured) and default to the first
// catalog model whose provider is configured. Unconfigured-provider models
// stay listed but the caller marks them "needs API key" (see
// isModelConfigured below) rather than hiding them.

import type { StoryboardResolution } from '@open-design/contracts';
import type { MediaModel } from '../../media/models';

export type ConfiguredProviderMap = Record<string, boolean>;

/** Durations (seconds) within Ark's Seedance 4-15s range that are ALSO valid
 * VIDEO_LENGTHS_SEC buckets — generateMedia snaps any other value to its
 * nearest bucket server-side, so offering only these avoids a picker that
 * silently doesn't get what it asked for. */
export const STORYBOARD_DURATION_OPTIONS = [5, 8, 10, 15] as const;
export const STORYBOARD_DEFAULT_DURATION_SEC = 5;

/**
 * The video model catalog encodes resolution directly in the OpenRouter
 * Seedance 2.0 model id (`...:1080p` / `...:480p`, bare id = 720p);
 * Volcengine's Seedance renderer hardcodes 720p regardless of the id. So the
 * model picker IS the resolution picker for the models that support more
 * than one — this derives the Shot.resolution field to store alongside it
 * rather than exposing a second, partially-fictional control.
 */
export function resolutionForModelId(modelId: string): StoryboardResolution {
  if (modelId.endsWith(':1080p')) return '1080p';
  if (modelId.endsWith(':480p')) return '480p';
  return '720p';
}

export function isModelConfigured(model: MediaModel, configured: ConfiguredProviderMap): boolean {
  return Boolean(configured[model.provider]);
}

/**
 * First model (in catalog order) whose provider is configured, preferring
 * that subset's own `default` flag; falls back to the catalog's overall
 * default (or first entry) when nothing in `models` is configured yet, so a
 * fresh machine still gets a sane, clearly-labelled starting pick.
 */
export function defaultConfiguredModel(
  models: MediaModel[],
  configured: ConfiguredProviderMap,
): MediaModel | undefined {
  const configuredModels = models.filter((m) => isModelConfigured(m, configured));
  if (configuredModels.length > 0) {
    return configuredModels.find((m) => m.default) ?? configuredModels[0];
  }
  return models.find((m) => m.default) ?? models[0];
}

/** Video models that support Seedance-style start/end keyframe pairs. */
export function keyframeCapableVideoModels(models: MediaModel[]): MediaModel[] {
  return models.filter((m) => m.caps?.includes('kf'));
}

/** Image models capable of i2i (iterate on current frame / derive end frame). */
export function i2iCapableImageModels(models: MediaModel[]): MediaModel[] {
  return models.filter((m) => m.caps?.includes('i2i'));
}
