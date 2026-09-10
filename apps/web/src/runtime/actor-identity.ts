import { normalizeActorName } from '@open-design/contracts';

/**
 * Where this browser remembers who is using it (F-03 / D-2).
 *
 * Deliberately NOT `CONFIG_STORAGE_KEY` (`state/config.ts`): app config is
 * synced to the daemon, and the daemon is shared by the whole team. D-2 says
 * the name is "stored per-browser", so two teammates pointing at one daemon
 * keep two different names — which only works if this value never leaves the
 * browser that set it.
 */
export const ACTOR_NAME_STORAGE_KEY = 'open-design.actor-name';

/**
 * Set once the user has answered the one-time prompt, including by skipping it.
 * Separate from the name because "skipped" and "not asked yet" are different
 * states and only one of them should re-open the prompt.
 */
export const ACTOR_PROMPT_SEEN_KEY = 'open-design.actor-prompt-seen';

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode, blocked site data, a sandboxed frame: unattributed.
    return null;
  }
}

function writeKey(key: string, value: string | null): void {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage is a convenience here; losing it costs attribution, not function.
  }
}

/** The name this browser sends as `x-od-actor`, or `null` when unattributed. */
export function getStoredActorName(): string | null {
  if (typeof window === 'undefined') return null;
  return normalizeActorName(readKey(ACTOR_NAME_STORAGE_KEY));
}

/**
 * Stores the name for this browser. A blank or whitespace-only name clears it —
 * "unattributed" is a legitimate answer under D-2, never a validation error.
 */
export function setStoredActorName(name: string | null): void {
  if (typeof window === 'undefined') return;
  writeKey(ACTOR_NAME_STORAGE_KEY, normalizeActorName(name));
}

/** True once the user has answered the one-time prompt, name or skip. */
export function hasSeenActorPrompt(): boolean {
  if (typeof window === 'undefined') return true;
  return readKey(ACTOR_PROMPT_SEEN_KEY) === '1';
}

export function markActorPromptSeen(): void {
  if (typeof window === 'undefined') return;
  writeKey(ACTOR_PROMPT_SEEN_KEY, '1');
}
