#!/usr/bin/env node
// bot-wall.mjs -- detects an anti-bot interstitial (SiteGround sg-captcha,
// Cloudflare challenge, Incapsula, a generic "Just a moment" holding page) so
// a stalled capture reports itself as blocked instead of a successful mirror
// of the challenge page itself.
//
// Verified against a live designbybrandin.com incident: a headless-Chrome
// capture that had worked earlier in the day started getting 403/202
// challenge responses from the origin's SiteGround bot protection, and a
// plain-HTTP finishing pass (re-fetching what the capture missed) got
// wholesale 403'd. The rescue that worked used a real, visible Chrome window
// (`channel:"chrome"`, `--disable-blink-features=AutomationControlled`,
// `navigator.webdriver` masked) and genuine in-page `fetch()` calls -- real
// cookies/fingerprint/Referer clear a challenge a bot-detection stack a
// standalone HTTP client never can. This module's `looksLikeBotWallResponse`
// generalizes the HTML-body-only check mirror-site.mjs already had (the
// "captured page is an anti-bot challenge, not <origin>" hard-fail) to also
// recognize a specific known bot-mitigation response header NAME (see
// `looksLikeBotWallResponse`'s own docblock below for why a bare status code
// is deliberately not sufficient on its own), and `headfulEscalationGuidance`
// is the operator-facing instruction to re-run with `--headful` -- never
// fall back to a plain HTTP re-fetch for same-origin assets, which is what
// got 403'd in the first place.
//
// Pure header/body classification -- no fs/network/browser -- so it is
// unit-testable without Playwright, which this repo does not install as a
// workspace dependency (see SKILL.md's "Open Design environment prep").

const CHALLENGE_BODY_PATTERN =
  /sgcaptcha|cf-browser-verification|challenge-platform|__cf_chl|_incapsula_|<title>\s*Just a moment/i;
// Exact known header *names* only -- a legitimate origin can set an
// unrelated header whose *value* happens to contain the word "challenge" or
// "captcha" (e.g. a custom `x-note: challenge accepted`), so matching on
// value content is a false-positive magnet. These specific header names are
// ones SiteGround/Cloudflare's bot-mitigation stacks set themselves; a
// normal origin has no reason to emit them.
const CHALLENGE_HEADER_NAME_PATTERNS = [/^sg-?captcha$/i, /^cf-mitigated$/i, /^cf-chl-/i];

/** True when `body` carries a known anti-bot interstitial signature. */
export function looksLikeBotWallBody(body) {
  return typeof body === "string" && CHALLENGE_BODY_PATTERN.test(body);
}

function hasBotWallHeader(headers) {
  if (!headers || typeof headers !== "object") return false;
  return Object.keys(headers).some((name) => CHALLENGE_HEADER_NAME_PATTERNS.some((pattern) => pattern.test(name)));
}

/**
 * True when a response looks like an anti-bot interstitial rather than the
 * real asset/document: a known challenge-page body signature, or a specific
 * known bot-mitigation response header name (SiteGround `sg-captcha`,
 * Cloudflare `cf-mitigated`/`cf-chl-*`).
 *
 * A bare 403 or 202 status is deliberately NOT sufficient on its own --
 * ordinary authorization failures return 403, and legitimate async-accepted
 * endpoints return 202 (`{"accepted":true}`), neither of which is a bot
 * wall. Status alone produced false positives on both in practice; a real
 * challenge is identified by its body or its header, not by a status code
 * that plenty of ordinary responses also use.
 */
export function looksLikeBotWallResponse({ headers, body } = {}) {
  if (looksLikeBotWallBody(body)) return true;
  if (hasBotWallHeader(headers)) return true;
  return false;
}

/** Operator-facing escalation instruction: re-run the capture with --headful. */
export function headfulEscalationGuidance({ url, status } = {}) {
  return [
    `Bot-wall signature detected${url ? ` for ${url}` : ""}${status ? ` (HTTP ${status})` : ""}.`,
    "Headless Chrome's fingerprint is being challenged by this origin's bot protection.",
    'Re-run the capture with --headful: it launches a real, visible Chrome window',
    '(channel:"chrome", --disable-blink-features=AutomationControlled, navigator.webdriver',
    "masked) and retrieves missed assets via genuine in-page fetch() -- real cookies,",
    "fingerprint, and Referer are what clears these challenges. Never fall back to a",
    "plain HTTP re-fetch for same-origin assets; that is what gets 403'd wholesale.",
  ].join("\n");
}
