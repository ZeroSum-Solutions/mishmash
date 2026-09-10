import { ACTOR_HEADER_NAME, normalizeActorName } from '@open-design/contracts';

/** The one shape this module needs off an Express request. */
interface HeaderCarrier {
  get(name: string): string | undefined;
}

/**
 * Resolves the human name behind a request (F-03 / D-2).
 *
 * INVARIANT: this never throws and never rejects. A missing, empty, over-long,
 * or control-character-laden `x-od-actor` header resolves to `null`
 * ("unattributed") and the request proceeds exactly as it would have. That is
 * D-2's stated ceiling — attribution, not authentication — not a validation
 * gap: the daemon is shared on a trusted tailnet, anyone on it can claim any
 * name, and refusing a request over a bad name would gate a capability on a
 * value that was never trustworthy in the first place.
 *
 * Normalization itself lives in `packages/contracts` so the daemon, the web
 * fetch wrapper, and the `od` CLI cannot disagree about what a name is.
 */
export function resolveActorName(req: HeaderCarrier): string | null {
  try {
    return normalizeActorName(req.get(ACTOR_HEADER_NAME));
  } catch {
    // A hostile request object is still just an unattributed request.
    return null;
  }
}
