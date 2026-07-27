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

const ATTRIBUTE_PATTERN = /\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*['"]([^'"]+)['"]/g;
const CSS_URL_PATTERN = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
const CSS_IMPORT_PATTERN = /@import\s+['"]([^'"]+)['"]/gi;

function isIgnorableReference(value) {
  return !value || value.startsWith("data:") || value.startsWith("#");
}

/** Splits a `srcset` value into its candidate URLs, dropping the density/width descriptor. */
function srcsetCandidates(value) {
  return value
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0] ?? "")
    .filter((candidate) => candidate.length > 0);
}

/**
 * Enumerates every raw reference string in one blob of HTML or CSS text.
 * Returns raw, unresolved strings in the order encountered (duplicates are
 * not deduplicated here -- callers that need a set can wrap the result) --
 * relative-vs-absolute resolution and same-origin filtering are the caller's
 * job (see `collectSameOriginRefs` in rewrite-mirror.mjs).
 */
export function collectReferenceCandidates(text) {
  const refs = [];

  for (const match of text.matchAll(ATTRIBUTE_PATTERN)) {
    const [, name, raw] = match;
    const candidates = /srcset$/i.test(name) ? srcsetCandidates(raw) : [raw];
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
