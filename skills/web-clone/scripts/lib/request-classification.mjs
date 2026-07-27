#!/usr/bin/env node
// request-classification.mjs -- classifies one observed request URL during a
// verify-mirror.mjs run against the local server it just loaded and,
// optionally, the mirror's original live origin.
//
// Two defects this exists to close:
//
// 1. String-prefix matching (`url.startsWith(base)`) is wrong: a verifier
//    base of `http://127.0.0.1:1234` treats a request to
//    `http://127.0.0.1:12345/api` as "local" because the string happens to
//    start with the base, even though it is a different port entirely.
//    Comparing `new URL(url).origin === new URL(base).origin` is exact.
// 2. A same-origin asset the capture never downloaded stays an absolute
//    reference after mirror-site.mjs's rewrite pass (nothing to rewrite it
//    to). During verification that reference loads fine from the still-live
//    original origin, so no request ever fails and the gate would otherwise
//    report a clean pass on a mirror that is silently still proxying the
//    live site. Recognizing "this request went to the original origin, not
//    the local mirror" is what makes that failure visible regardless of its
//    HTTP status.
//
// Pure URL parsing -- no fs/network/browser -- unit-testable without
// Playwright.

/**
 * @param {string} requestUrl
 * @param {{ localBase: string, originalOrigin?: string | null }} context
 * @returns {"local" | "origin-leak" | "cross-origin" | "invalid"}
 */
export function classifyRequestOrigin(requestUrl, { localBase, originalOrigin = null }) {
  let requestOrigin;
  try {
    requestOrigin = new URL(requestUrl).origin;
  } catch {
    return "invalid";
  }

  let localOrigin;
  try {
    localOrigin = new URL(localBase).origin;
  } catch {
    return "invalid";
  }

  if (requestOrigin === localOrigin) return "local";

  if (originalOrigin) {
    let original;
    try {
      original = new URL(originalOrigin).origin;
    } catch {
      original = null;
    }
    if (original && requestOrigin === original) return "origin-leak";
  }

  return "cross-origin";
}
