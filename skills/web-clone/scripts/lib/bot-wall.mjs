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
// recognize a 403/202 status code paired with a captcha/challenge response
// header, and `headfulEscalationGuidance` is the operator-facing instruction
// to re-run with `--headful` -- never fall back to a plain HTTP re-fetch for
// same-origin assets, which is what got 403'd in the first place.
//
// Pure status/header/body classification -- no fs/network/browser -- so it
// is unit-testable without Playwright, which this repo does not install as a
// workspace dependency (see SKILL.md's "Open Design environment prep").

const CHALLENGE_BODY_PATTERN =
  /sgcaptcha|cf-browser-verification|challenge-platform|__cf_chl|_incapsula_|<title>\s*Just a moment/i;
const CHALLENGE_HEADER_NAME_PATTERN = /sg-?captcha|cf-mitigated|cf-chl/i;
const CHALLENGE_HEADER_VALUE_PATTERN = /captcha|challenge/i;
const CHALLENGE_STATUS_CODES = new Set([403, 202]);

/** True when `body` carries a known anti-bot interstitial signature. */
export function looksLikeBotWallBody(body) {
  return typeof body === "string" && CHALLENGE_BODY_PATTERN.test(body);
}

function hasBotWallHeader(headers) {
  if (!headers || typeof headers !== "object") return false;
  return Object.entries(headers).some(
    ([name, value]) =>
      CHALLENGE_HEADER_NAME_PATTERN.test(name) || CHALLENGE_HEADER_VALUE_PATTERN.test(String(value ?? "")),
  );
}

/**
 * True when a response looks like an anti-bot interstitial rather than the
 * real asset/document: a known challenge-page body signature, a
 * captcha/challenge response header (SiteGround `sg-captcha`, Cloudflare
 * `cf-mitigated`/`cf-chl-*`), or a 403/202 status code -- the pair of status
 * codes these bot walls answer a blocked request with instead of the real
 * asset or a plain 4xx.
 */
export function looksLikeBotWallResponse({ status, headers, body } = {}) {
  if (looksLikeBotWallBody(body)) return true;
  if (hasBotWallHeader(headers)) return true;
  return CHALLENGE_STATUS_CODES.has(status);
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
