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

import crypto from "node:crypto";
import path from "node:path";

/**
 * Resolves `rel` under `root`, returning the resolved absolute path only if
 * it stays LEXICALLY contained within `root`. Returns `null` for anything
 * that would escape by path resolution, is empty, or isn't a string.
 *
 * Containment here is lexical (`path.resolve`), not physical: it defeats
 * `..` traversal (including percent-decoded `%2e%2e%2f` sequences), but a
 * pre-existing symlink INSIDE the root can still redirect a contained write
 * elsewhere on disk. See SKILL.md's "Known limitations" for that
 * precondition and why it is out of scope for a tool writing into a mirror
 * directory it created itself.
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

// Comfortably under every real filesystem's 255-BYTE component limit (APFS,
// ext4, NTFS all cap the component, not the full path), with headroom left
// for a disambiguation suffix (`.<8-16 hex>`) that lib/mirror-manifest.mjs
// may still append after this cap has been applied.
export const MAX_PATH_COMPONENT_BYTES = 180;

/**
 * Caps every `/`-separated component of `rel` to `maxBytes` UTF-8 bytes
 * (A6: a ~300-char URL segment produced a >255-byte filename component and
 * the write failed with ENAMETOOLONG). An oversized component keeps a
 * readable prefix and replaces the excess with a short, stable hash of the
 * FULL original component -- deterministic (same input, same output,
 * everywhere it is computed) and collision-preserving (two long names that
 * differ only in their truncated tails still map to distinct results).
 * The extension is preserved when it is itself reasonably sized, so content
 * sniffing by suffix (static servers, editors) keeps working.
 *
 * @param {string} rel - `/`-separated relative path.
 * @param {number} [maxBytes]
 * @returns {string}
 */
export function capPathComponents(rel, maxBytes = MAX_PATH_COMPONENT_BYTES) {
  return rel
    .split("/")
    .map((component) => {
      if (Buffer.byteLength(component, "utf8") <= maxBytes) return component;
      const hash = crypto.createHash("sha256").update(component).digest("hex").slice(0, 12);
      const ext = path.posix.extname(component);
      const keptExt = ext && Buffer.byteLength(ext, "utf8") <= 16 ? ext : "";
      const base = keptExt ? component.slice(0, -keptExt.length) : component;
      const budget = maxBytes - Buffer.byteLength(`.${hash}${keptExt}`, "utf8");
      // Trim whole CODE POINTS (never raw bytes or UTF-16 units) until the
      // prefix fits -- `slice(0, -1)` on a string can split a surrogate
      // pair, leaving invalid UTF-8; popping code points cannot.
      const chars = Array.from(base);
      while (chars.length > 0 && Buffer.byteLength(chars.join(""), "utf8") > budget) {
        chars.pop();
      }
      return `${chars.join("")}.${hash}${keptExt}`;
    })
    .join("/");
}
