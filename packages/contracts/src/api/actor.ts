/**
 * Named local attribution (F-03 / D-2).
 *
 * INVARIANT: this file is the ONLY place the actor wire shape is spelled. The
 * web fetch wrapper, the `od` CLI fetch wrapper, and the daemon's request-side
 * validation all read these constants, so "what counts as an actor name"
 * cannot drift between the three of them.
 *
 * D-2's ceiling is deliberate and is NOT a defect: attribution here is
 * client-asserted, not authenticated. Anyone on the tailnet can send any name.
 * Every consumer therefore treats a missing, empty, or malformed value as
 * "unattributed", and caps an over-long value at MAX_ACTOR_NAME_LENGTH, and
 * continues — it never rejects a request and never gates a capability.
 */

/**
 * Request header carrying the human name behind a request.
 * Lower-case because Node lower-cases incoming header names.
 */
export const ACTOR_HEADER_NAME = 'x-od-actor';

/**
 * Longest actor name any surface stores or displays. A longer value is trimmed
 * to this length, never rejected.
 */
export const MAX_ACTOR_NAME_LENGTH = 60;

/** Matches C0 and C1 control characters, which a display name may never contain. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/gu;

/**
 * Normalizes a client-asserted actor name.
 *
 * Returns `null` for anything that is not a usable display name — absent,
 * blank, or nothing but control characters. Control characters are stripped
 * rather than rejected so a mangled header degrades to "unattributed" instead
 * of failing the request.
 */
export function normalizeActorName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.replace(CONTROL_CHARACTERS, '').trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_ACTOR_NAME_LENGTH).trim() || null;
}
