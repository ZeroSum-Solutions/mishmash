#!/usr/bin/env node
// asset-discovery.mjs -- pure, browser-independent asset-reference discovery.
//
// A scroll-through capture only downloads what a browser session actually
// requests. Lazy-loaded media, hover-state sprites, `srcset` variants the
// viewport never selected, and unused `@font-face` format alternates
// (`.eot`/`.woff` fallbacks) are referenced by the markup/CSS but never fired
// as a request, so a mirror's second pass has to find them by reading the
// references back off already-downloaded text instead. This module is that
// "what does this text reference" primitive: given raw HTML or CSS text, it
// enumerates every attribute value (including each candidate inside a
// `srcset`), every `url(...)` (covers CSS `background`/`@font-face src`
// alike, inline or in a stylesheet), and every `@import` target.
//
// Pure string/regex parsing over already-loaded text -- no fs, no network, no
// browser -- so it is unit-testable without Playwright, which this repo does
// not install as a workspace dependency (skill scripts are staged into a
// user's project instead; see SKILL.md's "Open Design environment prep").
//
// rewrite-mirror.mjs's `collectSameOriginRefs` (per-file, same-origin
// filtered) and mirror-site.mjs's recursive fetch rounds both call this same
// primitive, so the two mirror stages can never disagree about what counts as
// a reference.

const QUOTED_ATTRIBUTE_PATTERN = /\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(['"])([^'"]*)\2/g;
// Valid HTML5: an unquoted attribute value cannot contain space, quotes, `=`,
// `<`, `>`, or a backtick. The negative lookahead keeps this pattern from
// re-matching a value the quoted pattern above already consumed.
const UNQUOTED_ATTRIBUTE_PATTERN = /\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?!['"])([^\s"'=<>`]+)/g;
const CSS_URL_PATTERN = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
const CSS_IMPORT_PATTERN = /@import\s+['"]([^'"]+)['"]/gi;

// Only attribute NAMES that plausibly carry a URL are treated as references.
// `collectReferenceCandidates` used to match every attribute unconditionally
// (an allowlist "silently leaves whichever lazy-load attribute it hasn't met
// yet pointing at the origin" was the original reasoning) -- but for
// DISCOVERY (as opposed to the rewrite pass, which is safe because it only
// touches values that already look like a mirrored URL) that let ordinary,
// non-URL attribute values (`charset="utf-8"`, `rel="stylesheet"`,
// `data-aspect="16/9"`) get resolved as if they were document-relative
// references, turning them into phantom "missing assets". Real lazy-load
// attributes invented by themes (`data-nectar-img-src`, `data-lazy-srcset`,
// `data-bg`, ...) all end in one of these tokens, so matching by suffix
// (optionally after a `-`/`_`) still covers them without an enumerable list.
export const URL_BEARING_ATTRIBUTE_PATTERN = /(?:^|[-_])(?:src|href|poster|srcset|bg|background)$/i;

/** Non-fetchable/inline schemes: nothing a mirror pass could retrieve or usefully localise. */
function isIgnorableReference(value) {
  return !value || value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("#");
}

/**
 * Splits a `srcset` value into its candidate URLs, dropping the
 * density/width descriptor.
 *
 * Per the HTML srcset grammar, a candidate's URL is delimited by
 * WHITESPACE, not by commas -- commas only separate candidates once a
 * descriptor (or the end of a URL-only candidate) has been read. Splitting
 * on every comma is wrong for a `data:` URI candidate: the comma separating
 * a data URI's mime type from its payload (`data:image/svg+xml,...`) is not
 * a candidate separator. Splitting only on "comma followed by whitespace"
 * (an earlier version of this function) is ALSO wrong: `"a.png 1x,b.png 2x"`
 * is valid srcset with no space after the separating comma, and that
 * version dropped the second candidate entirely. Reading the URL as
 * "everything up to the next whitespace" sidesteps both failure modes: a
 * data URI's internal comma has no whitespace after it (so it stays part of
 * the same URL token), while a real separating comma is found afterward,
 * while scanning past the descriptor, regardless of whether it has a
 * trailing space.
 */
function srcsetCandidates(value) {
  const candidates = [];
  let rest = value;
  while (rest.length > 0) {
    rest = rest.replace(/^[\s,]+/, "");
    if (!rest) break;
    const wsIndex = rest.search(/\s/);
    if (wsIndex === -1) {
      // No whitespace left at all: the remainder is one or more URL-only
      // candidates (no descriptor), comma-separated.
      const commaIndex = rest.indexOf(",");
      if (commaIndex === -1) {
        candidates.push(rest);
        rest = "";
      } else {
        candidates.push(rest.slice(0, commaIndex));
        rest = rest.slice(commaIndex + 1);
      }
      continue;
    }
    candidates.push(rest.slice(0, wsIndex));
    rest = rest.slice(wsIndex).trimStart();
    // `rest` now starts with this candidate's descriptor (e.g. "1x, ..." or
    // "400w,..."); consume up to (and past) the next comma, which separates
    // it from the next candidate.
    const commaIndex = rest.indexOf(",");
    rest = commaIndex === -1 ? "" : rest.slice(commaIndex + 1);
  }
  return candidates.map((candidate) => candidate.trim()).filter((candidate) => candidate.length > 0);
}

/**
 * Enumerates every raw reference string in one blob of HTML or CSS text.
 * Returns raw, unresolved strings in the order encountered (duplicates are
 * not deduplicated here -- callers that need a set can wrap the result) --
 * relative-vs-absolute resolution and same-origin filtering are the caller's
 * job (see `collectSameOriginRefs` in rewrite-mirror.mjs).
 *
 * CSS `url()`/`@import` values are always eligible (unambiguously resource
 * references in that position); HTML attribute values are eligible only
 * from a URL-bearing attribute name (see `URL_BEARING_ATTRIBUTE_PATTERN`).
 */
export function collectReferenceCandidates(text) {
  const refs = [];

  for (const match of text.matchAll(QUOTED_ATTRIBUTE_PATTERN)) {
    const [, name, , raw] = match;
    if (!URL_BEARING_ATTRIBUTE_PATTERN.test(name)) continue;
    const candidates = /srcset$/i.test(name) ? srcsetCandidates(raw) : [raw];
    for (const candidate of candidates) {
      const value = candidate.trim();
      if (!isIgnorableReference(value)) refs.push(value);
    }
  }

  // Unquoted values are always a single token (no whitespace is possible
  // without ending the attribute), so a multi-candidate unquoted `srcset`
  // cannot occur validly -- treat the token as one reference, not a list.
  for (const match of text.matchAll(UNQUOTED_ATTRIBUTE_PATTERN)) {
    const [, name, raw] = match;
    if (!URL_BEARING_ATTRIBUTE_PATTERN.test(name)) continue;
    const value = (raw ?? "").trim();
    if (!isIgnorableReference(value)) refs.push(value);
  }

  for (const match of text.matchAll(CSS_URL_PATTERN)) {
    const value = (match[1] ?? "").trim();
    if (!isIgnorableReference(value)) refs.push(value);
  }

  for (const match of text.matchAll(CSS_IMPORT_PATTERN)) {
    const value = (match[1] ?? "").trim();
    if (!isIgnorableReference(value)) refs.push(value);
  }

  return refs;
}
