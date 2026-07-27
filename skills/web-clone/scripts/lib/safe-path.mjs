#!/usr/bin/env node
// safe-path.mjs -- containment guard for every write derived from a URL.
//
// An encoded path segment (e.g. a source URL containing
// `%2e%2e%2f%2e%2e%2f`) can decode into literal ".." segments, and
// `path.join`/`path.resolve` will happily walk them outside the intended
// root. The static server already guards its READ side (lib/static-server.mjs
// checks realpath containment before serving); this is the WRITE-side
// counterpart, and arguably the more dangerous direction -- an unguarded
// write can plant a file anywhere the process has permission to write, not
// just fail to find one. Every write mirror-site.mjs derives from a
// (potentially adversarial) captured URL must go through this first.

import path from "node:path";

/**
 * Resolves `rel` under `root`, returning the resolved absolute path only if
 * it stays contained within `root`. Returns `null` for anything that would
 * escape, is empty, or isn't a string.
 *
 * @param {string} root
 * @param {string} rel
 * @returns {string | null}
 */
export function containedPath(root, rel) {
  if (typeof rel !== "string" || rel.length === 0) return null;
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, rel);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) return null;
  return resolved;
}
