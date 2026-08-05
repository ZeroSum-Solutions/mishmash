#!/usr/bin/env node
// path-collision.mjs -- reconciles a URL path that is BOTH a page and a
// directory prefix.
//
// A site can serve `/account` as a page and `/account/login` as another page.
// Mirrored to disk one of those has to give: the first wants a FILE at
// `site/account`, the second wants a DIRECTORY there. Whichever is captured
// second used to lose, in both directions:
//
//   - `writeFileSync` onto an existing directory throws EISDIR -- the crash
//     this module was written for (Shopify serves `/account` alongside
//     `/account/login`, `/products` alongside `/products/<handle>`, etc).
//   - `mkdirSync` beneath an existing file throws ENOTDIR -- the same
//     collision reached in the opposite capture order.
//
// In mirror-site.mjs's capture path both were swallowed by a bare `catch`, so
// the asset silently never landed and only the recursive-fetch round (which
// has no try/catch) surfaced it as a hard crash.
//
// The resolution is the directory-index convention every real static host
// already uses: the PAGE at `/account` lives at `site/account/index.html`, and
// a request for `/account` falls back to it. lib/static-server.mjs implements
// the matching read side, so the served mirror answers both URLs.

import fs from "node:fs";
import path from "node:path";

function statOrNull(target) {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

/**
 * Returns the real file path to write for `dest`, reconciling either direction
 * of a page/directory collision. May MUTATE the mirror: when an ancestor of
 * `dest` was already captured as a file, that file is promoted into its own
 * directory index so the directory can exist.
 *
 * @param {string} dest - absolute, already containment-checked (see safe-path.mjs).
 * @returns {string} the path to write to; `<dest>/index.html` when `dest` is a directory.
 */
export function writableTarget(dest) {
  // Case 1: `dest` is already a directory -- the page form of this URL becomes
  // that directory's index.
  if (statOrNull(dest)?.isDirectory()) return path.join(dest, "index.html");

  // Case 2: an ancestor of `dest` is an existing FILE -- it was captured as a
  // page before we learned the same URL is also a directory prefix. Walk up to
  // the first ancestor that exists: if it is a file, promote it to
  // `<ancestor>/index.html`; if it is a directory, every ancestor above it is
  // one too and there is nothing to reconcile. At most one ancestor can be a
  // file, since a file cannot itself contain a path.
  const { root } = path.parse(dest);
  let dir = path.dirname(dest);
  while (dir !== root && dir !== path.dirname(dir)) {
    const stat = statOrNull(dir);
    if (stat?.isDirectory()) break;
    if (stat?.isFile()) {
      // Rename out and back rather than reading the bytes into memory: the
      // promoted file can be a multi-MB captured asset.
      const staged = `${dir}.__od_promote__`;
      fs.renameSync(dir, staged);
      fs.mkdirSync(dir, { recursive: true });
      fs.renameSync(staged, path.join(dir, "index.html"));
      break;
    }
    dir = path.dirname(dir);
  }
  return dest;
}

/**
 * True when `dest` holds real captured bytes, following the same
 * directory-index convention as `writableTarget`.
 *
 * A bare `existsSync(dest) && statSync(dest).size > 0` reports TRUE for a
 * directory (a dir's `size` is its non-zero block size), which made every
 * "already captured?" gate treat a colliding directory as a finished capture
 * and silently skip the page that belonged there.
 *
 * @param {string} dest
 * @returns {boolean}
 */
export function hasCapturedBytes(dest) {
  const stat = statOrNull(dest);
  if (stat?.isFile()) return stat.size > 0;
  if (stat?.isDirectory()) {
    const index = statOrNull(path.join(dest, "index.html"));
    return Boolean(index?.isFile() && index.size > 0);
  }
  return false;
}
