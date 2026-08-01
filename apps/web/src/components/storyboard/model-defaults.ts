// Model-default resolution for the Storyboard pickers. Spec requirement:
// "Model default must respect configured providers, preferring subscription
// lanes" — read GET /api/media/config (providers.<id>) and default to the
// best-available catalog model. Readiness/selectability reuses the same
// isMediaProviderPickerReady/isMediaModelPickerReady gates the rest of the
// app uses (apps/web/src/media/provider-readiness.ts), so an integrated:false
// catalog provider (bfl, replicate, google, kling, midjourney, ...) can never
// be picked as a default or counted "ready" here either. Unready models stay
// listed but the caller marks them "needs API key" (see isModelConfigured
// below) rather than hiding them.

import type { StoryboardResolution } from '@open-design/contracts';
import {
  isStoryboardUploadMimeAllowed,
  STORYBOARD_UPLOAD_MAX_BYTES,
  storyboardUploadAcceptAttr,
} from '@open-design/contracts';
import { isStoredMediaProviderEntryPresent } from '../../state/config';
import type { MediaProviderCredentials } from '../../types';
import { findProvider, type MediaModel } from '../../media/models';
import { isMediaModelPickerReady } from '../../media/provider-readiness';

/** `accept` attribute for the upload file-pickers (ShotCard slots + the multi-image "Add shots from images" input). */
export const STORYBOARD_UPLOAD_ACCEPT = storyboardUploadAcceptAttr();

export type StoryboardUploadValidationError = 'bad-type' | 'too-large';

/**
 * Client-side pre-flight mirroring the daemon's own POST
 * /api/storyboards/:id/uploads checks (shared constants from
 * @open-design/contracts) — rejects an obviously-bad file before spending a
 * FileReader pass + network round trip on it. The daemon remains the source
 * of truth; this is a UX shortcut, not the only enforcement.
 */
export function validateStoryboardUploadFile(file: File): StoryboardUploadValidationError | null {
  if (!isStoryboardUploadMimeAllowed(file.type)) return 'bad-type';
  if (file.size > STORYBOARD_UPLOAD_MAX_BYTES) return 'too-large';
  return null;
}

export type ConfiguredProviderMap = Record<string, MediaProviderCredentials>;

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

/** Whether `model` is currently selectable — reuses the same readiness gate
 * every other media picker uses. */
export function isModelConfigured(model: MediaModel, configured: ConfiguredProviderMap): boolean {
  return isMediaModelPickerReady(model.id, configured);
}

/**
 * 3-tier sort priority, copied from NewProjectPanel.tsx's MediaModelCards
 * precedent (~:2790-2824):
 *   0 = the provider has real credentials configured — a stored/env API key,
 *       OR a subscription-derived credential for a provider that otherwise
 *       requires one (e.g. grok's borrowed Hermes xAI OAuth token).
 *   1 = a `credentialsRequired: false` lane (codex's local CLI subscription,
 *       hyperframes, stub) — never asks for a key, so it's always usable, but
 *       shouldn't outrank a provider the user has actually configured.
 *   2 = everything else (integrated, but not yet configured).
 * integrated:false catalog providers never reach here in practice — callers
 * pre-filter the model list with isMediaProviderPickerReady, and
 * isModelConfigured/isMediaModelPickerReady always returns false for them.
 */
export function modelSortPriority(model: MediaModel, configured: ConfiguredProviderMap): 0 | 1 | 2 {
  const provider = findProvider(model.provider);
  // Never let an integrated:false placeholder provider outrank a real one,
  // no matter how "configured" its stored entry looks — it has no real
  // dispatcher regardless.
  if (!provider?.integrated) return 2;
  const entry = configured[model.provider];
  const hasRealCredentials = provider.credentialsRequired !== false && isStoredMediaProviderEntryPresent(entry);
  if (hasRealCredentials) return 0;
  if (provider.credentialsRequired === false) return 1;
  return 2;
}

/**
 * Tier-ascending pick: prefer a ready model (tier 0 or 1) over an unready
 * one, and within the ready subset prefer the highest tier's own `default`
 * flag. Falls back to the catalog's overall default (or first entry) when
 * NOTHING in `models` is ready yet, so a fresh machine still gets a sane,
 * clearly-labelled starting pick.
 */
export function defaultConfiguredModel(
  models: MediaModel[],
  configured: ConfiguredProviderMap,
): MediaModel | undefined {
  const ready = models.filter((m) => isMediaModelPickerReady(m.id, configured));
  const pool = ready.length > 0 ? ready : models;
  const sorted = [...pool].sort(
    (a, b) => modelSortPriority(a, configured) - modelSortPriority(b, configured),
  );
  return sorted.find((m) => m.default) ?? sorted[0];
}

/** The mood lane's preferred cheap-sketch model once Higgsfield is
 * connected — it bills against the user's existing Higgsfield subscription
 * credits rather than a per-generation metered key. */
export const HIGGSFIELD_MOOD_MODEL_ID = 'higgsfield/seedance_2_0_mini';

/**
 * Mood-lane default (issue #25 — "the mood exploration board should be set
 * to default take higgsfield"): when `HIGGSFIELD_MOOD_MODEL_ID` is present
 * in `models` and configured/ready, it wins outright over the cheap-first
 * heuristic StoryboardEditor.tsx sorts `models` with. Otherwise falls back
 * to the existing defaultConfiguredModel cheap-first behavior unchanged.
 * Isolated as its own helper (rather than an inline special case in
 * StoryboardEditor's JSX/useMemo) so this one rule has a single,
 * unit-testable home.
 */
export function defaultMoodLaneModel(
  models: MediaModel[],
  configured: ConfiguredProviderMap,
): MediaModel | undefined {
  const higgsfieldMood = models.find((m) => m.id === HIGGSFIELD_MOOD_MODEL_ID);
  if (higgsfieldMood && isMediaModelPickerReady(higgsfieldMood.id, configured)) {
    return higgsfieldMood;
  }
  return defaultConfiguredModel(models, configured);
}

/** Image models capable of i2i (iterate on current frame / derive end frame). */
export function i2iCapableImageModels(models: MediaModel[]): MediaModel[] {
  return models.filter((m) => m.caps?.includes('i2i'));
}
