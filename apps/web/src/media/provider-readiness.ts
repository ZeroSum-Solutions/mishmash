import { isStoredMediaProviderEntryPresent } from '../state/config';
import type { MediaProviderCredentials } from '../types';
import {
  findMediaModel,
  findProvider,
  type MediaProviderId,
} from './models';

export function isMediaProviderPickerReady(
  providerId: MediaProviderId,
  mediaProviders?: Record<string, MediaProviderCredentials>,
): boolean {
  const provider = findProvider(providerId);
  if (!provider?.integrated) return false;
  if (mediaProviders === undefined) return true;
  // codex (local Codex CLI subscription) and hyperframes/stub are
  // credentialsRequired: false — never gated on a stored/env key. This is
  // what makes provider 'codex' with source 'codex-subscription' (or any
  // other codex entry shape) always count as ready.
  if (provider.credentialsRequired === false) return true;
  const entry = mediaProviders?.[provider.id];
  if (provider.id === 'openai' && isOpenAIOAuthOnlyEntry(entry)) return false;
  return isStoredMediaProviderEntryPresent(entry);
}

export function isMediaModelPickerReady(
  modelId: string,
  mediaProviders?: Record<string, MediaProviderCredentials>,
): boolean {
  const model = findMediaModel(modelId);
  if (!model) return false;
  return isMediaProviderPickerReady(model.provider, mediaProviders);
}

function isOpenAIOAuthOnlyEntry(entry: MediaProviderCredentials | null | undefined): boolean {
  // These are the source strings the daemon actually emits for a borrowed,
  // non-Images-API-proof token (see resolveOpenAIAuthFileCredential /
  // resolveXAIOAuthCredential in apps/daemon/src/media/config.ts) — NOT
  // 'oauth-codex'/'oauth-hermes', which the daemon never produces, so this
  // check previously never fired.
  const source = entry?.source?.trim();
  return (source === 'codex-auth' || source === 'oauth-hermes-xai')
    && !entry?.apiKey?.trim()
    && !entry?.baseUrl?.trim()
    && !entry?.model?.trim()
    && !entry?.apiKeyTail?.trim();
}
