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
// enumerates the values of URL-BEARING attributes (allowlisted by name --
// see `isUrlBearingAttributeName`; including each candidate inside a
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
// (after `-`/`_`/`:` or at the start) still covers them without an
// enumerable list. The `:` separator covers XML-namespaced names
// (`xlink:href` on SVG 1.x `<image>`/`<use>`), and `imagesrcset` is its own
// token because `<link imagesrcset>` has no separator before the suffix.
const URL_BEARING_SUFFIX_PATTERN = /(?:^|[-_:])(?:src|href|poster|srcset|imagesrcset|bg|background)$/i;
// A7: standard URL-carrying attributes whose names do not END in a URL-ish
// token and so need exact matching. Exact -- NOT suffix -- because `data-*`/
// `data-action` style names routinely carry non-URL values (JS hooks,
// config), and a suffix match would resolve those into phantom missing
// assets, the precise failure the allowlist above exists to prevent.
//
// Two tiers, because "carries a URL" and "is a fetchable resource" are
// different questions: `<object data>` names bytes a GET can retrieve, but
// `<form action>`/`<button formaction>` name SUBMISSION endpoints -- a bare
// GET (no form data) against one commonly 405s/404s, so treating them as
// missing assets would fail otherwise-complete static mirrors. They are
// still URL-bearing for the REWRITE pass (localized when the target file
// exists), just never recursively fetched.
const RESOURCE_EXACT_PATTERN = /^data$/i;
const NAVIGATION_EXACT_PATTERN = /^(?:action|formaction)$/i;

/** True when an HTML attribute name plausibly carries a URL reference (resource OR navigation target). */
export function isUrlBearingAttributeName(name) {
  return URL_BEARING_SUFFIX_PATTERN.test(name) || RESOURCE_EXACT_PATTERN.test(name) || NAVIGATION_EXACT_PATTERN.test(name);
}

/** True when the attribute's URL names fetchable RESOURCE bytes (excludes form-submission targets). */
function isFetchableResourceAttributeName(name) {
  return URL_BEARING_SUFFIX_PATTERN.test(name) || RESOURCE_EXACT_PATTERN.test(name);
}

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
 * from a URL-bearing attribute name (see `isUrlBearingAttributeName`).
 *
 * By default only FETCHABLE RESOURCE references are returned -- callers use
 * this to decide what a mirror is missing, and a form-submission target
 * (`action`/`formaction`) is not retrievable by the bare GET a recursive
 * fetch would issue. Pass `includeNavigation: true` to also get navigation
 * targets (the rewrite-analysis path wants everything it may localize).
 */
export function collectReferenceCandidates(text, { includeNavigation = false } = {}) {
  const refs = [];
  const eligible = includeNavigation ? isUrlBearingAttributeName : isFetchableResourceAttributeName;

  for (const match of text.matchAll(QUOTED_ATTRIBUTE_PATTERN)) {
    const [, name, , raw] = match;
    if (!eligible(name)) continue;
    const candidates = /srcset$/i.test(name) ? srcsetCandidates(raw) : [raw];
    for (const candidate of candidates) {
      const value = candidate.trim();
      if (!isIgnorableReference(value)) refs.push(value);
    }
  }

  // An unquoted value cannot contain whitespace (that ends the attribute),
  // but it CAN contain commas -- `srcset=a.png,b.png` is valid srcset with
  // two descriptor-less candidates (A7: this used to be pushed as the single
  // reference "a.png,b.png"). Run srcset-named values through the same
  // tokenizer as the quoted form; every other unquoted value is one token.
  for (const match of text.matchAll(UNQUOTED_ATTRIBUTE_PATTERN)) {
    const [, name, raw] = match;
    if (!eligible(name)) continue;
    const candidates = /srcset$/i.test(name) ? srcsetCandidates(raw ?? "") : [raw ?? ""];
    for (const candidate of candidates) {
      const value = candidate.trim();
      if (!isIgnorableReference(value)) refs.push(value);
    }
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
