// Shared provider-error classification boundary (BUG-10). Every provider
// call the daemon makes eventually hits the same shape of failure — an
// HTTP status plus a raw response body — and today most call sites turn
// that straight into "upstream <Provider> returned <status>". That reads
// fine for a real outage, but Google's Generative Language API answers an
// invalid API key with a generic-looking 400 (`API_KEY_INVALID` / "API key
// not valid") instead of 401/403, so a status-only mapping tells the user
// only "upstream Google Gemini returned 400" and they read a stale
// credential as a broken feature.
//
// This module is the one place that turns (status, rawBody) into a
// `ProviderErrorKind` (packages/contracts/src/errors.ts) so every call
// site — apps/daemon/src/design/finalize-design.ts's text-provider
// boundary (storyboard draft-from-brief, finalize, handoff) and
// apps/daemon/src/media/index.ts's Nano Banana (Google Gemini image)
// media-generation lane — classifies identically instead of each
// reimplementing the Google body-sniff regex. Per AGENTS.md's bug
// follow-up workflow, this deliberately does NOT refactor every provider
// adapter; only the call sites that already produce the literal
// "upstream X returned N" message for a Google-backed provider are wired
// to it.
import type { ProviderErrorKind } from '@open-design/contracts';

const GOOGLE_INVALID_KEY_BODY_PATTERN = /API_KEY_INVALID|API key not valid/i;

/**
 * Classify a provider HTTP failure by what the caller should DO about it.
 * 401/403 always mean the credential itself was rejected; Google's API
 * additionally answers an invalid key with HTTP 400 carrying
 * `API_KEY_INVALID` / "API key not valid" in the body — recognized here so
 * that quirk doesn't leak into every call site as its own ad hoc check.
 */
export function classifyProviderError(status: number, rawBody: string): ProviderErrorKind {
  if (status === 401 || status === 403) return 'invalid-credential';
  if (status === 400 && GOOGLE_INVALID_KEY_BODY_PATTERN.test(rawBody)) return 'invalid-credential';
  if (status === 429) return 'rate-limited';
  return 'upstream-error';
}

/**
 * The message for an `invalid-credential` classification. Composed here —
 * never derived from the upstream response body, which can echo request
 * content back — and always names the provider so the user's next action
 * is obvious instead of reading as a generic failure.
 */
export function providerCredentialRejectionMessage(providerLabel: string): string {
  return `${providerLabel} rejected the API key — update the stored credential and retry.`;
}

/**
 * Thrown by a provider render/call boundary on a classified HTTP failure.
 * `.code` mirrors `.kind` so it slots directly into the existing loose
 * `{message, status, code}` task-error shape
 * (apps/daemon/src/media/tasks.ts's `MediaTaskError`) without introducing a
 * parallel error shape — the daemon already forwards `err.status`/`err.code`
 * from a thrown error onto a failed media task and, from there, verbatim
 * into both the web UI's `snap.error` and the CLI's `--json`/stderr
 * envelope.
 */
export class ProviderCallError extends Error {
  status: number;
  kind: ProviderErrorKind;
  code: ProviderErrorKind;

  constructor(status: number, kind: ProviderErrorKind, message: string) {
    super(message);
    this.name = 'ProviderCallError';
    this.status = status;
    this.kind = kind;
    this.code = kind;
  }
}
