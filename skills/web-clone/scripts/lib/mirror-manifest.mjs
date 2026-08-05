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
// reverse it. `claim()` is the ONLY way a local path is assigned. Collision
// handling: when the "natural" computed path is already claimed by a
// DIFFERENT url -- including a path that only a FILESYSTEM would consider
// equal (case-insensitive APFS/NTFS, Unicode-normalizing APFS; A5) -- the
// second claim is disambiguated with a hash of the url instead of silently
// sharing the first claim's file. This makes accidental collisions safe; it
// is NOT a guarantee against a deliberately crafted adversarial URL set --
// see SKILL.md's "Known limitations".
//
// URL identity (A4): a `#fragment` is client-side only -- the server never
// sees it, so `/sprite.svg` and `/sprite.svg#icon` are the same resource.
// Every entry point strips the fragment before touching the maps, so a
// fragment variant can never duplicate a captured asset. Rewrite re-attaches
// fragments when emitting localized references (see rewrite-mirror.mjs).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { collectReferenceCandidates } from "./asset-discovery.mjs";
import { walk } from "./fs-walk.mjs";
import { hasCapturedBytes } from "./path-collision.mjs";

/** Fragment-free manifest identity for a URL (A4). */
function manifestUrlKey(url) {
  const hashIndex = url.indexOf("#");
  return hashIndex === -1 ? url : url.slice(0, hashIndex);
}

/**
 * Collision key under which two local paths count as "the same file" on the
 * filesystems mirrors actually land on (A5): APFS and NTFS are
 * case-insensitive, and APFS normalizes Unicode -- `Images/Logo.png` vs
 * `images/logo.png`, or NFC vs NFD `café.png`, are distinct strings but one
 * single file on disk.
 *
 * Case-INSENSITIVITY here means Unicode case folding, not `toLowerCase()`
 * alone: a filesystem's caseless comparison folds Greek final sigma `ς` and
 * `σ` together (both fold from `Σ`), while `"ς".toLowerCase()` stays `ς` --
 * so lowercasing alone would treat `/ΟΣ.png` and `/Ος.png` as distinct keys
 * for what APFS stores as one file. Upper-then-lower approximates full case
 * folding for exactly these divergent cases (it also folds `ß` -> `ss`,
 * matching full folding).
 */
function fsCollisionKey(localPath) {
  return localPath.normalize("NFC").toUpperCase().toLowerCase();
}

/**
 * @param {{ computeLocalPath: (url: string, hosts: Set<string>) => string | null }} deps
 *   `computeLocalPath` is injected (not imported) so this module never
 *   depends on rewrite-mirror.mjs -- rewrite-mirror.mjs's own standalone CLI
 *   needs to load a persisted manifest via this module, and a two-way
 *   import between the two files would be a cycle.
 */
export function createMirrorManifest({ computeLocalPath }) {
  const forward = new Map(); // fragment-free sourceUrl -> localPath (exact string)
  const reverse = new Map(); // localPath (exact string) -> fragment-free sourceUrl
  // fsCollisionKey(localPath) -> fragment-free sourceUrl. Collision checks
  // run against THIS map (A5): `reverse` alone treats `Images/Logo.png` and
  // `images/logo.png` as distinct even though a case-insensitive filesystem
  // stores them as one file, silently letting the second write reuse the
  // first's bytes. `reverse` keeps the exact strings because
  // `reverseGet()` is queried with real on-disk relative paths.
  const reverseCanonical = new Map();

  function taken(candidate, urlKey) {
    const owner = reverseCanonical.get(fsCollisionKey(candidate));
    return owner !== undefined && owner !== urlKey;
  }

  function disambiguate(candidate, urlKey) {
    const hash = crypto.createHash("sha256").update(urlKey).digest("hex").slice(0, 8);
    const ext = path.posix.extname(candidate);
    const base = ext ? candidate.slice(0, -ext.length) : candidate;
    let next = `${base}.${hash}${ext}`;
    if (taken(next, urlKey)) {
      // A second collision on an 8-hex-char hash is astronomically unlikely
      // for real-world URL sets (it would need two different URLs colliding
      // on both the natural path AND the same short hash); widen the hash
      // rather than loop. A DELIBERATELY crafted set can still defeat this
      // -- documented as a known limitation in SKILL.md, not defended here.
      const longHash = crypto.createHash("sha256").update(urlKey).digest("hex").slice(0, 16);
      next = `${base}.${longHash}${ext}`;
    }
    return next;
  }

  function record(urlKey, localPath) {
    forward.set(urlKey, localPath);
    reverse.set(localPath, urlKey);
    reverseCanonical.set(fsCollisionKey(localPath), urlKey);
  }

  /**
   * Assigns (or returns the already-assigned) local path for `url` --
   * fragment variants of one URL share one entry (A4). Pass the SAME
   * `hosts` set used elsewhere in the run; this does not itself check
   * same-origin membership beyond what `computeLocalPath` already does.
   */
  function claim(url, hosts) {
    const urlKey = manifestUrlKey(url);
    const existing = forward.get(urlKey);
    if (existing) return existing;
    const natural = computeLocalPath(urlKey, hosts);
    if (!natural) return null;
    const candidate = taken(natural, urlKey) ? disambiguate(natural, urlKey) : natural;
    record(urlKey, candidate);
    return candidate;
  }

  function get(url) {
    return forward.get(manifestUrlKey(url));
  }
  function has(url) {
    return forward.has(manifestUrlKey(url));
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
      if (typeof sourceUrl !== "string" || typeof localPath !== "string") continue;
      const urlKey = manifestUrlKey(sourceUrl);
      if (forward.has(urlKey)) continue;
      forward.set(urlKey, localPath);
      // A persisted manifest is trusted as-authored (see SKILL.md's known
      // limitations): record reverse mappings only where they do not
      // contradict a live claim.
      if (!reverse.has(localPath)) reverse.set(localPath, urlKey);
      if (!reverseCanonical.has(fsCollisionKey(localPath))) reverseCanonical.set(fsCollisionKey(localPath), urlKey);
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
      // Fragment-free (A4): `/sprite.svg#a` and `/sprite.svg#b` are one
      // missing resource, and the fetch that resolves them is the same
      // request either way (the server never sees a fragment).
      missing.add(manifestUrlKey(resolved));
    }
  }
  return missing;
}

/** True when `url` has a manifest entry AND that entry's file has real (non-empty) bytes on disk. */
export function isCaptured({ siteDir, manifest, url }) {
  const local = manifest.get(url);
  if (!local) return false;
  try {
    // Directory-index aware: a page whose path collides with a directory
    // prefix lands at `<dest>/index.html` (see lib/path-collision.mjs).
    return hasCapturedBytes(path.join(siteDir, local));
  } catch {
    return false;
  }
}
