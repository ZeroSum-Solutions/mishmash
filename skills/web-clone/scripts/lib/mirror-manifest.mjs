#!/usr/bin/env node
// mirror-manifest.mjs -- the single source of truth for sourceUrl<->localPath
// mapping during a mirror run.
//
// Structural fix (round-3 adversarial review, N1/N2/N3/F10/F11): capture,
// recursive fetch, and rewrite used to each independently RECOMPUTE a URL's
// local path (or worse, reconstruct a URL back out of a local path to
// refetch it) via a shared-but-lossy pure function. Percent-decoding
// collapsed distinct encoded paths onto the same file
// (`/models/a%2Fb.buf` and `/models/a/b.buf` both decoded to
// "models/a/b.buf", so the second write silently overwrote/reused the
// first's file), and reconstructing a fetch URL from a local path lost query
// strings entirely (a missing `theme.css?mode=dark` was refetched as
// `theme.<hash>.css` -- a URL that was never real, so either the wrong body
// got saved or the real asset stayed remote undetected).
//
// This module tracks the mapping explicitly as it is decided -- once, at the
// moment a body is actually about to be written -- so nothing downstream
// (recursive fetch, rewrite, the static server, the gate) ever needs to
// reverse it. `claim()` is the ONLY way a local path is assigned, and it is
// injective: if the "natural" computed path is already claimed by a
// DIFFERENT url, it disambiguates with a hash of the raw url rather than
// silently letting the second write collide with the first.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { collectReferenceCandidates } from "./asset-discovery.mjs";
import { walk } from "./fs-walk.mjs";

/**
 * @param {{ computeLocalPath: (url: string, hosts: Set<string>) => string | null }} deps
 *   `computeLocalPath` is injected (not imported) so this module never
 *   depends on rewrite-mirror.mjs -- rewrite-mirror.mjs's own standalone CLI
 *   needs to load a persisted manifest via this module, and a two-way
 *   import between the two files would be a cycle.
 */
export function createMirrorManifest({ computeLocalPath }) {
  const forward = new Map(); // sourceUrl -> localPath
  const reverse = new Map(); // localPath -> sourceUrl

  function disambiguate(candidate, url) {
    const hash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 8);
    const ext = path.posix.extname(candidate);
    const base = ext ? candidate.slice(0, -ext.length) : candidate;
    let next = `${base}.${hash}${ext}`;
    if (reverse.has(next) && reverse.get(next) !== url) {
      // A second collision on an 8-hex-char hash is astronomically unlikely
      // (would require two different URLs colliding on both the natural
      // path AND the same short hash); widen the hash rather than loop.
      const longHash = crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
      next = `${base}.${longHash}${ext}`;
    }
    return next;
  }

  /**
   * Assigns (or returns the already-assigned) local path for `url`. Pass the
   * SAME `hosts` set used elsewhere in the run; this does not itself check
   * same-origin membership beyond what `computeLocalPath` already does.
   */
  function claim(url, hosts) {
    const existing = forward.get(url);
    if (existing) return existing;
    const natural = computeLocalPath(url, hosts);
    if (!natural) return null;
    const candidate = reverse.has(natural) && reverse.get(natural) !== url ? disambiguate(natural, url) : natural;
    forward.set(url, candidate);
    reverse.set(candidate, url);
    return candidate;
  }

  function get(url) {
    return forward.get(url);
  }
  function has(url) {
    return forward.has(url);
  }
  function reverseGet(localPath) {
    return reverse.get(localPath);
  }
  function entries() {
    return [...forward.entries()];
  }
  function toJSON() {
    return entries().map(([sourceUrl, localPath]) => ({ sourceUrl, localPath }));
  }
  /** Merges externally-sourced entries (e.g. loaded from disk) without overwriting live claims. */
  function restore(entriesArray) {
    for (const entry of Array.isArray(entriesArray) ? entriesArray : []) {
      const sourceUrl = entry?.sourceUrl;
      const localPath = entry?.localPath;
      if (typeof sourceUrl === "string" && typeof localPath === "string" && !forward.has(sourceUrl)) {
        forward.set(sourceUrl, localPath);
        if (!reverse.has(localPath)) reverse.set(localPath, sourceUrl);
      }
    }
  }

  return { claim, get, has, reverseGet, entries, toJSON, restore };
}

/** Reconstructs a manifest from a persisted `url-manifest.json` array. */
export function loadMirrorManifest(json, deps) {
  const manifest = createMirrorManifest(deps);
  manifest.restore(json);
  return manifest;
}

/**
 * Finds every same-origin reference in the already-mirrored files that does
 * not yet have real bytes on disk -- i.e. genuinely missing, not merely
 * un-reversed. Returns absolute SOURCE URLs (never local paths): each is
 * resolved directly from the reference text against the OWNING file's own
 * captured source URL (`manifest.reverseGet`), so there is nothing for a
 * caller to reconstruct or guess -- fetch exactly the URL this returns.
 *
 * A URL already `claim()`-ed (assigned a local path) but whose file a prior
 * fetch attempt failed to write still counts as missing here -- `claim()`
 * only reserves a path, it is not proof of a successful capture. Checking
 * `manifest.has()` alone would let one failed attempt permanently exclude
 * that URL from every later round.
 *
 * A file with no manifest entry (nothing this run itself wrote -- a hand-
 * added file, say) has no known owner URL to resolve relative references
 * against, so its references are skipped: an honest gap, not a guess.
 */
export function findMissingSourceUrls({ siteDir, hosts, manifest }) {
  const missing = new Set();
  for (const file of walk(siteDir)) {
    const rel = path.relative(siteDir, file).split(path.sep).join("/");
    const ownerUrl = manifest.reverseGet(rel);
    if (!ownerUrl) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const raw of collectReferenceCandidates(text)) {
      const value = raw.trim();
      if (!value) continue;
      let resolved;
      try {
        resolved = new URL(value, ownerUrl).href;
      } catch {
        continue;
      }
      let host;
      try {
        host = new URL(resolved).host.toLowerCase();
      } catch {
        continue;
      }
      if (!hosts.has(host)) continue;
      if (isCaptured({ siteDir, manifest, url: resolved })) continue;
      missing.add(resolved);
    }
  }
  return missing;
}

/** True when `url` has a manifest entry AND that entry's file has real (non-empty) bytes on disk. */
export function isCaptured({ siteDir, manifest, url }) {
  const local = manifest.get(url);
  if (!local) return false;
  try {
    const dest = path.join(siteDir, local);
    return fs.existsSync(dest) && fs.statSync(dest).size > 0;
  } catch {
    return false;
  }
}
