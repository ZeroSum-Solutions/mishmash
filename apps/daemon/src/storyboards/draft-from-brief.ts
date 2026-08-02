// Draft storyboard shots from a free-text creative brief.
//
// The storyboard's own vocabulary is MOTION ONLY (see StoryboardShot's
// motionPrompt docblock): the start/end frames carry subject, framing and
// lighting, so a drafted shot must describe how the camera and subject MOVE,
// not what the scene looks like. That constraint lives in the prompt below.
//
// The provider call reuses apps/daemon/src/design/finalize-design.ts rather
// than growing a second text-provider client: that module already owns
// protocol-shaped request building, one-retry-on-429/5xx, timeout/abort
// plumbing, typed upstream errors, and per-protocol response-text extraction.
// `extractDesignMd` is named for its first caller but is in fact the generic
// "pull the assistant text out of a provider response for protocol X" helper.
import {
  callFinalizeProviderWithRetry,
  defaultBaseUrlForFinalizeProtocol,
  extractDesignMd,
} from '../design/finalize-design.js';
import {
  STORYBOARD_DRAFT_SHOT_COUNT_DEFAULT,
  STORYBOARD_DRAFT_SHOT_COUNT_MAX,
  STORYBOARD_DRAFT_SHOT_COUNT_MIN,
  type FinalizeProviderProtocol,
} from '@open-design/contracts';

export const DRAFT_SHOT_COUNT_DEFAULT = STORYBOARD_DRAFT_SHOT_COUNT_DEFAULT;
export const DRAFT_SHOT_COUNT_MIN = STORYBOARD_DRAFT_SHOT_COUNT_MIN;
export const DRAFT_SHOT_COUNT_MAX = STORYBOARD_DRAFT_SHOT_COUNT_MAX;

/**
 * Token ceiling for one draft. A shot is a sentence; twelve of them plus JSON
 * scaffolding fits comfortably, and a low ceiling keeps a runaway model from
 * billing a wall of prose.
 */
const DRAFT_MAX_TOKENS = 2000;

/**
 * Hard caps on what a drafted shot may carry into the stored storyboard.
 * `max_tokens` is a request-side hint a provider is free to ignore, so these
 * are the actual bound: without them a misbehaving (or attacker-controlled)
 * endpoint could write an unbounded string into the storyboard file and have
 * it echoed back in the response. A motion prompt is one sentence; a title is
 * a label.
 */
const DRAFT_MOTION_PROMPT_MAX_CHARS = 600;
const DRAFT_TITLE_MAX_CHARS = 120;

/**
 * Wall-clock ceiling for one draft call. Without it a provider that accepts
 * the request and then never answers holds the daemon's request open forever
 * — and keeps billing — long after the browser or CLI has gone away. Drafting
 * a handful of shots is a short completion; a minute is already generous.
 */
export const DRAFT_TIMEOUT_MS = 60_000;

/** One drafted shot, before it is given an id/order and stored. */
export interface DraftedShotSpec {
  title: string;
  motionPrompt: string;
}

/** Resolved text-provider credentials for one draft call. */
export interface DraftTextProvider {
  protocol: FinalizeProviderProtocol;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface DraftShotsParams {
  brief: string;
  shotCount: number;
  provider: DraftTextProvider;
  /** Injected in tests so specs never reach a real provider. */
  fetchImpl?: typeof globalThis.fetch;
  /** Caller-owned cancellation — the route aborts this on client disconnect. */
  signal?: AbortSignal;
  /** Overrides DRAFT_TIMEOUT_MS; tests use a short one. */
  timeoutMs?: number;
}

export function buildDraftShotsPrompt(
  brief: string,
  shotCount: number,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    'You break a creative brief into a short sequence of video shots.',
    '',
    'Each shot is rendered from a start still and an end still, so the still',
    'images already carry the subject, framing, wardrobe and lighting. Your',
    'motionPrompt therefore describes MOTION ONLY — how the camera moves and',
    'how the subject moves across the shot. Do not describe appearance, style,',
    'colour grading, or what the scene contains.',
    '',
    'Reply with JSON only — no prose, no code fence, no explanation. Shape:',
    '{"shots":[{"title":"short label","motionPrompt":"the motion, one sentence"}]}',
  ].join('\n');

  const userPrompt = [
    `Brief: ${brief}`,
    '',
    `Draft exactly ${shotCount} shots in narrative order.`,
  ].join('\n');

  return { systemPrompt, userPrompt };
}

/** Strip a ```json fence if the model wrapped its reply in one. */
function unfence(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  return (fenced?.[1] ?? text).trim();
}

/**
 * Parse a provider reply into shot specs. Deliberately strict about the
 * result and forgiving about the wrapper: models reliably return the right
 * content inside a fence or as a bare array, but a reply with no usable shot
 * must fail loudly rather than silently appending nothing to the storyboard.
 */
export function parseDraftedShots(text: string, shotCount: number): DraftedShotSpec[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfence(text));
  } catch {
    throw new Error('draft response could not be parsed as JSON');
  }

  const raw = Array.isArray(parsed)
    ? parsed
    : (parsed as { shots?: unknown } | null)?.shots;
  if (!Array.isArray(raw)) {
    throw new Error('draft response could not be parsed as a list of shots');
  }

  const shots: DraftedShotSpec[] = [];
  for (const entry of raw) {
    if (shots.length >= shotCount) break;
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as { title?: unknown; motionPrompt?: unknown };
    const motionPrompt =
      typeof candidate.motionPrompt === 'string'
        ? candidate.motionPrompt.trim().slice(0, DRAFT_MOTION_PROMPT_MAX_CHARS)
        : '';
    if (!motionPrompt) continue;
    const title =
      typeof candidate.title === 'string' && candidate.title.trim()
        ? candidate.title.trim().slice(0, DRAFT_TITLE_MAX_CHARS)
        : `Shot ${shots.length + 1}`;
    shots.push({ title, motionPrompt });
  }

  if (shots.length === 0) {
    throw new Error('draft response contained no usable shots');
  }
  return shots;
}

export async function draftShotsFromBrief(params: DraftShotsParams): Promise<DraftedShotSpec[]> {
  const { systemPrompt, userPrompt } = buildDraftShotsPrompt(params.brief, params.shotCount);

  // Always bound the call, and fold in the caller's signal (the route aborts
  // it when the client disconnects) so whichever fires first wins.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), params.timeoutMs ?? DRAFT_TIMEOUT_MS);
  const onCallerAbort = () => deadline.abort();
  params.signal?.addEventListener('abort', onCallerAbort, { once: true });
  if (params.signal?.aborted) deadline.abort();

  try {
    return await runDraft();
  } catch (err) {
    if (deadline.signal.aborted && !params.signal?.aborted) {
      throw new Error('text provider did not respond before the draft deadline');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', onCallerAbort);
  }

  async function runDraft(): Promise<DraftedShotSpec[]> {
  const response = await callFinalizeProviderWithRetry({
    protocol: params.provider.protocol,
    apiKey: params.provider.apiKey,
    baseUrl: params.provider.baseUrl,
    model: params.provider.model,
    maxTokens: DRAFT_MAX_TOKENS,
    systemPrompt,
    userPrompt,
    ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
    signal: deadline.signal,
  });
  // Parse defensively: a non-JSON reply (an HTML error page, a plaintext
  // banner) makes JSON.parse throw a SyntaxError whose message embeds the
  // start of that body. The route returns this error's message to the
  // caller, so letting it through would echo whatever the endpoint served
  // straight back out.
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('text provider returned a response that was not JSON');
  }
  return parseDraftedShots(extractDesignMd(payload, params.provider.protocol), params.shotCount);
  }
}

// --- Provider resolution ----------------------------------------------------

/**
 * Media-provider credentials that are also usable for a text call, in
 * precedence order. This mirrors the existing MEDIA_MEMORY_PROVIDER_FALLBACKS
 * table in apps/daemon/src/memory-llm.ts — the daemon already treats a saved
 * Settings → Media providers key as valid for text extraction, and a second,
 * contradictory answer to "which provider can we talk to" would be worse than
 * one duplicated list.
 *
 * `defaultModel: null` means the provider is a model aggregator whose model
 * ids are not knowable without looking them up — it is only usable once the
 * operator has configured a model for it, and is skipped otherwise rather
 * than guessed at.
 */
const TEXT_PROVIDER_CANDIDATES: ReadonlyArray<{
  mediaProviderId: string;
  protocol: FinalizeProviderProtocol;
  baseUrl: string;
  defaultModel: string | null;
}> = [
  { mediaProviderId: 'openrouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: null },
  { mediaProviderId: 'google', protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com', defaultModel: 'gemini-3.5-flash' },
  { mediaProviderId: 'openai', protocol: 'openai', baseUrl: 'https://api.openai.com', defaultModel: 'gpt-4o-mini' },
  { mediaProviderId: 'minimax', protocol: 'openai', baseUrl: 'https://api.minimax.io/v1', defaultModel: 'MiniMax-M2.7-highspeed' },
];

/** The provider ids a draft can fall back to, for error copy. */
export const DRAFT_TEXT_PROVIDER_IDS = TEXT_PROVIDER_CANDIDATES.map((c) => c.mediaProviderId);

/**
 * Reads one provider's stored credentials. Every field is optional because
 * that is exactly what media/config.ts's ProviderEntry guarantees — an
 * unconfigured provider yields an entry with nothing in it.
 */
export interface DraftTextProviderLookup {
  (providerId: string): Promise<{ apiKey?: string; baseUrl?: string; model?: string }>;
}

export interface DraftTextProviderOverride {
  protocol: FinalizeProviderProtocol;
  apiKey: string;
  baseUrl?: string;
  model: string;
}

/**
 * Pick the text provider for a draft: an explicit caller-supplied one (BYOK,
 * same shape the finalize route accepts) wins; otherwise the first configured
 * candidate above. Returns null when nothing is usable, so the route can fail
 * with an actionable message instead of a generic upstream error.
 */
export async function resolveDraftTextProvider(
  lookup: DraftTextProviderLookup,
  override?: DraftTextProviderOverride,
): Promise<DraftTextProvider | null> {
  if (override) {
    return {
      protocol: override.protocol,
      apiKey: override.apiKey,
      baseUrl: override.baseUrl || defaultBaseUrlForFinalizeProtocol(override.protocol),
      model: override.model,
    };
  }

  for (const candidate of TEXT_PROVIDER_CANDIDATES) {
    const entry = await lookup(candidate.mediaProviderId);
    if (!entry.apiKey) continue;
    const model =
      typeof entry.model === 'string' && entry.model.trim()
        ? entry.model.trim()
        : candidate.defaultModel;
    if (!model) continue;
    return {
      protocol: candidate.protocol,
      apiKey: entry.apiKey,
      baseUrl: entry.baseUrl || candidate.baseUrl,
      model,
    };
  }
  return null;
}
