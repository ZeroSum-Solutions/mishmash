#!/usr/bin/env node
// request-classification.mjs -- classifies one observed request URL during a
// verify-mirror.mjs run against the local server it just loaded and,
// optionally, the mirror's original live origin.
//
// Three defects this exists to close:
//
// 1. String-prefix matching (`url.startsWith(base)`) is wrong: a verifier
//    base of `http://127.0.0.1:1234` treats a request to
//    `http://127.0.0.1:12345/api` as "local" because the string happens to
//    start with the base, even though it is a different port entirely.
//    Comparing `new URL(url).origin === new URL(base).origin` is exact.
// 2. A same-origin asset the capture never downloaded stays an absolute
//    reference after mirror-site.mjs's rewrite pass (nothing to rewrite it
//    to). During verification that reference loads fine from the still-live
//    original origin -- caller responsibility: this classifier must be
//    consulted for EVERY response verify-mirror.mjs observes, not only ones
//    with a failing HTTP status, since a leak that resolves with 200 (the
//    common case) is the exact scenario this exists to catch.
// 3. The mirrored site may itself have redirected between its apex and
//    `www.` host (or vice versa) during capture, and a live origin serves
//    both host forms too -- comparing hosts after stripping a leading `www.`
//    (the same aliasing `originHosts()` in rewrite-mirror.mjs already
//    applies for capture/rewrite) keeps `www.example.com` and
//    `example.com` recognized as the same origin-leak target instead of
//    one of them being misclassified as an unrelated cross-origin host.
//
// Pure URL parsing -- no fs/network/browser -- unit-testable without
// Playwright.

function normalizedHost(host) {
  return host.replace(/^www\./i, "").toLowerCase();
}

/**
 * @param {string} requestUrl
 * @param {{ localBase: string, originalOrigin?: string | null }} context
 * @returns {"local" | "origin-leak" | "cross-origin" | "invalid"}
 */
export function classifyRequestOrigin(requestUrl, { localBase, originalOrigin = null }) {
  let requestUrlObj;
  try {
    requestUrlObj = new URL(requestUrl);
  } catch {
    return "invalid";
  }

  let localUrlObj;
  try {
    localUrlObj = new URL(localBase);
  } catch {
    return "invalid";
  }

  if (requestUrlObj.origin === localUrlObj.origin) return "local";

  if (originalOrigin) {
    let originalUrlObj;
    try {
      originalUrlObj = new URL(originalOrigin);
    } catch {
      originalUrlObj = null;
    }
    if (originalUrlObj && normalizedHost(requestUrlObj.host) === normalizedHost(originalUrlObj.host)) {
      return "origin-leak";
    }
  }

  return "cross-origin";
}
