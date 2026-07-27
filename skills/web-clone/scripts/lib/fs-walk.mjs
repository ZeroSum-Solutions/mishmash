#!/usr/bin/env node
// fs-walk.mjs -- recursively lists files under a directory, filtered by
// extension and skipping known non-content directories.
//
// Extracted from rewrite-mirror.mjs so lib/mirror-manifest.mjs can walk a
// mirrored site without importing rewrite-mirror.mjs (which itself needs to
// import lib/mirror-manifest.mjs for its standalone-CLI manifest loading --
// two-way imports between those files would create an import cycle).

import fs from "node:fs";
import path from "node:path";

export const MIRROR_TEXT_EXTENSIONS = new Set([".html", ".htm", ".css", ".svg"]);
export const MIRROR_SKIP_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", "RECON"]);

/**
 * @param {string} dir
 * @param {Set<string>} [includeExt]
 * @param {Set<string>} [skipDirs]
 * @param {string[]} [files]
 */
export function walk(
  dir,
  includeExt = MIRROR_TEXT_EXTENSIONS,
  skipDirs = MIRROR_SKIP_DIRECTORIES,
  files = [],
) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(path.join(dir, entry.name), includeExt, skipDirs, files);
      continue;
    }
    if (includeExt.has(path.extname(entry.name).toLowerCase())) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}
