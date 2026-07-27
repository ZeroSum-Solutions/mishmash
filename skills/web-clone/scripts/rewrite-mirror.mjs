#!/usr/bin/env node
// rewrite-mirror.mjs -- points a mirrored site at its own downloaded assets.
//
// `mirror-site.mjs` downloads every same-origin asset into `<out>/site/` with its
// path preserved, but it leaves the markup untouched. Any reference that was
// written as an absolute URL (`https://example.com/wp-content/app.css`) therefore
// still resolves to the ORIGINAL host. The mirror looks correct while you are
// online -- it is silently proxying the live site -- and collapses the moment the
// origin is unreachable, rate-limits, or serves hotlink-protected media.
//
// That rewrite used to be a "Next:" line printed for a human to action by hand.
// It is a pipeline stage, not advice, so it lives here and runs automatically.
//
// Manifest-driven (round-3 structural fix, N1/N2/N3/F10/F11): when a
// lib/mirror-manifest.mjs manifest is available (mirror-site.mjs always has
// one in-memory; the standalone CLI loads `<out>/url-manifest.json` when
// present), every reference -- absolute, protocol-relative, root-relative,
// OR document-relative -- is resolved against the OWNING file's own captured
// source URL and looked up in the manifest directly. Nothing is reversed or
// reconstructed: the manifest already knows exactly which local file (if
// any) a given source URL was saved to, including query-hash-disambiguated
// variants. Without a manifest (an older mirror, or a bare `--site`
// invocation), only absolute/protocol-relative references are rewritten --
// an honest reduction in coverage, not a guess.
//
// Usage:
//   node scripts/rewrite-mirror.mjs --out <mirror-dir> [--origin <URL>] [--dry-run]
//   node scripts/rewrite-mirror.mjs --site <site-dir> --origin <URL>
//
// Discipline: a reference is only rewritten when the mirrored file it would point
// at actually exists on disk. Rewriting a URL whose asset was never downloaded
// would trade a working remote link for a guaranteed 404, so those are left alone
// and reported instead -- an honest gap beats a silent break.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { collectReferenceCandidates, URL_BEARING_ATTRIBUTE_PATTERN } from "./lib/asset-discovery.mjs";
import { walk as walkFiles } from "./lib/fs-walk.mjs";
import { loadMirrorManifest } from "./lib/mirror-manifest.mjs";

// `mirror-site.mjs` imports these so the "which local file does this URL mean?"
// rule has exactly one definition. A second copy would drift, and a drifted copy
// means the downloader and the rewriter disagree about what is missing.
export { originHosts, localPathForUrl, walk, collectSameOriginRefs };

function usage() {
  console.log(`rewrite-mirror.mjs -- rewrite absolute same-origin URLs in a mirror to local relative paths

  node scripts/rewrite-mirror.mjs --out <mirror-dir> [--origin <URL>] [--dry-run]
  node scripts/rewrite-mirror.mjs --site <site-dir> --origin <URL> [--dry-run]

--out     directory produced by mirror-site.mjs (contains site/, mirror-manifest.json,
          and url-manifest.json; --origin is inferred and the manifest is loaded
          automatically when present)
--site    mirrored web root directly, when there is no manifest alongside it
          (root-/document-relative references are not rewritten in this mode)
--origin  origin whose absolute URLs become local, e.g. https://example.com
--dry-run report what would change without writing`);
}

function parseArgs(argv) {
  const o = { out: "", site: "", origin: "", dryRun: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--out") o.out = argv[++i] || "";
    else if (a === "--site") o.site = argv[++i] || "";
    else if (a === "--origin") o.origin = argv[++i] || "";
    else if (a === "--dry-run") o.dryRun = true;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  return o;
}

/** Infers the mirrored origin from the manifest's most frequent host. */
function originFromManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return "";
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return "";
  }
  if (!Array.isArray(entries)) return "";
  const counts = new Map();
  for (const entry of entries) {
    if (typeof entry?.url !== "string") continue;
    try {
      const { origin } = new URL(entry.url);
      counts.set(origin, (counts.get(origin) ?? 0) + 1);
    } catch {
      // Not a URL we can attribute; skip it.
    }
  }
  let best = "";
  let bestCount = 0;
  for (const [origin, count] of counts) {
    if (count > bestCount) {
      best = origin;
      bestCount = count;
    }
  }
  return best;
}

function walk(dir, files = []) {
  return walkFiles(dir, undefined, undefined, files);
}

/**
 * Hosts that count as the mirrored origin. A site routinely emits both the
 * apex and the `www.` host for its own assets, and matching only the exact
 * string leaves half the references pointing at the live site.
 */
function originHosts(origin) {
  const { host } = new URL(origin);
  const bare = host.replace(/^www\./i, "");
  return new Set([bare.toLowerCase(), `www.${bare}`.toLowerCase()]);
}

/**
 * A query string changes which body a request returns (`/theme.css?mode=light`
 * vs. `?mode=dark`), but the path alone does not encode that -- so distinct
 * query variants of the same path must not collide on the same local file.
 * Suffixing a short stable hash of the query onto the filename (before the
 * extension) keeps every variant addressable, and doing it unconditionally
 * (not just when a collision is detected) means the same URL always maps to
 * the same local path everywhere it's computed, with no retroactive rename.
 */
function withQuerySuffix(pathname, search) {
  if (!search) return pathname;
  const hash = crypto.createHash("sha256").update(search).digest("hex").slice(0, 8);
  const ext = path.posix.extname(pathname);
  const base = ext ? pathname.slice(0, -ext.length) : pathname;
  return `${base}.${hash}${ext}`;
}

/**
 * Local path a same-origin URL "naturally" maps to. This is the seed
 * `lib/mirror-manifest.mjs`'s `claim()` starts from -- claim() is what
 * actually assigns and remembers the (possibly disambiguated) path, so this
 * function alone is NOT the source of truth for "what local file does this
 * URL mean" once a manifest is in play. It remains directly useful for: (a)
 * the very first computation a `claim()` call makes, and (b) the no-manifest
 * fallback path (an older mirror, or a bare `--site` invocation), where
 * there is nothing better to go on.
 */
function localPathForUrl(url, hosts) {
  let parsed;
  try {
    parsed = new URL(url, "https://placeholder.invalid");
  } catch {
    return null;
  }
  if (!hosts.has(parsed.host.toLowerCase())) return null;
  let p = parsed.pathname;
  if (p === "" || p.endsWith("/")) p += "index.html";
  p = p.replace(/^\/+/, "");
  p = withQuerySuffix(p, parsed.search);
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/**
 * Every same-origin path the mirrored files reference: absolute, root-relative,
 * *and* document-relative (`../fonts/Foo.woff2`).
 *
 * General-purpose analysis helper (kept for standalone/reporting use); the
 * live capture path in mirror-site.mjs uses
 * `lib/mirror-manifest.mjs`'s `findMissingSourceUrls` instead, which returns
 * fetchable absolute source URLs rather than local paths -- see that
 * module's docblock for why the two must not be conflated.
 *
 * A document-relative reference has no host to check against directly -- it
 * has to be resolved against the URL the *owning* mirrored file was captured
 * from first. `mirror-site.mjs` preserves the origin's path structure 1:1
 * (that is the whole mirroring contract), so a file's own path relative to
 * `siteDir` doubles as its original URL path relative to `origin`. Passing
 * `origin` enables this resolution; omitting it (no known origin, e.g. a
 * `--site`-only rewrite-mirror.mjs invocation) skips document-relative
 * references rather than guessing.
 */
function collectSameOriginRefs(siteDir, hosts, origin) {
  const refs = new Set();
  // The reference-candidate extraction (attribute values incl. every srcset
  // candidate, CSS url(), @import; HTML values only from URL-bearing
  // attribute names) is the same primitive mirror-site.mjs's manifest-driven
  // discovery uses directly on in-memory text -- see lib/asset-discovery.mjs.
  // Sharing it means this analysis looks for exactly the references the
  // rewriter will later try to localise.
  for (const file of walk(siteDir)) {
    const text = fs.readFileSync(file, "utf8");
    const ownerRel = path.relative(siteDir, file).split(path.sep).join("/");
    for (const value of collectReferenceCandidates(text)) {
      let local = null;
      if (/^(https?:)?\/\//i.test(value)) {
        local = localPathForUrl(value, hosts);
      } else if (value.startsWith("/")) {
        local = localPathForUrl(`https://${[...hosts][0]}${value}`, hosts);
      } else if (origin) {
        try {
          const resolved = new URL(value, `${origin}/${ownerRel}`).href;
          local = localPathForUrl(resolved, hosts);
        } catch {
          local = null;
        }
      }
      if (local) refs.add(local);
    }
  }
  return refs;
}

const stats = { rewritten: 0, notMirrored: 0, filesChanged: 0 };
const missing = new Map();

/**
 * @param {string} siteDir
 * @param {string} ownerFile - absolute path of the file being rewritten.
 * @param {Set<string>} hosts
 * @param {import('./lib/mirror-manifest.mjs').ReturnType<typeof import('./lib/mirror-manifest.mjs').createMirrorManifest>|null} manifest
 * @param {string|null} ownerSourceUrl - the URL `ownerFile` was itself captured
 *   from (from `manifest.reverseGet`), or null if unknown/no manifest.
 */
function makeRewriter(siteDir, ownerFile, hosts, manifest, ownerSourceUrl) {
  const manifestActive = Boolean(manifest && ownerSourceUrl);

  return function rewriteRef(raw) {
    const value = raw.trim();
    if (!value || value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("#")) return raw;

    let local = null;
    let key = value;
    if (manifestActive) {
      // Resolves absolute, protocol-relative, root-relative, AND document-
      // relative references identically -- `new URL()` already handles all
      // four shapes correctly, so there is no shape-specific branching left
      // to get wrong (or to reverse) here.
      let resolved;
      try {
        resolved = new URL(value, ownerSourceUrl).href;
      } catch {
        return raw;
      }
      key = resolved;
      local = manifest.get(resolved);
    } else if (/^(https?:)?\/\//i.test(value)) {
      // No manifest available -- fall back to direct computation for
      // absolute/protocol-relative references only; a root-/document-
      // relative one has no owner URL to resolve against here, so it is
      // left alone (honest gap) rather than guessed.
      local = localPathForUrl(value, hosts);
    } else {
      return raw;
    }

    if (!local) {
      stats.notMirrored += 1;
      missing.set(key, (missing.get(key) ?? 0) + 1);
      return raw;
    }
    const target = path.join(siteDir, local);
    if (!fs.existsSync(target)) {
      stats.notMirrored += 1;
      missing.set(local, (missing.get(local) ?? 0) + 1);
      return raw;
    }
    // The query string (if any) is already baked into `local`'s filename via
    // `withQuerySuffix`, so it must NOT also be appended here -- that would
    // send the browser back to the original (now-absent) query on a file
    // whose name already disambiguates it. A `#fragment` is unrelated to what
    // the server sees and is still meaningful (anchors, SPA routing), so it
    // is preserved.
    const hashSuffix = value.match(/^[^#]*(#[\s\S]*)$/)?.[1] ?? "";
    let rel = path.relative(path.dirname(ownerFile), target).split(path.sep).join("/");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    stats.rewritten += 1;
    return `${rel}${hashSuffix}`;
  };
}

function rewriteSrcset(srcset, rewriteRef) {
  return srcset
    .split(",")
    .map((candidate) => {
      const leading = candidate.match(/^\s*/)?.[0] ?? "";
      const trailing = candidate.match(/\s*$/)?.[0] ?? "";
      const body = candidate.trim();
      if (!body) return candidate;
      const [url, ...descriptors] = body.split(/\s+/);
      return `${leading}${[rewriteRef(url ?? ""), ...descriptors].join(" ")}${trailing}`;
    })
    .join(",");
}

function rewriteText(text, file, rewriteRef, { manifestActive = false } = {}) {
  const isCss = path.extname(file).toLowerCase() === ".css";
  let next = text;

  if (!isCss) {
    // Only URL-bearing attribute names are touched (see
    // lib/asset-discovery.mjs's URL_BEARING_ATTRIBUTE_PATTERN) -- an
    // allowlist-by-suffix rather than a fixed enum, so theme-invented
    // lazy-load attributes (`data-nectar-img-src`, `data-lazy-srcset`, ...)
    // are still covered, while ordinary non-URL attributes
    // (`data-aspect="16/9"`, `charset="utf-8"`) are left untouched.
    next = next.replace(
      /(\s)([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(['"])([\s\S]*?)\3/g,
      (match, space, name, quote, value) => {
        if (!URL_BEARING_ATTRIBUTE_PATTERN.test(name)) return match;
        if (/srcset$/i.test(name)) {
          const rewritten = rewriteSrcset(value, rewriteRef);
          return rewritten === value ? match : `${space}${name}=${quote}${rewritten}${quote}`;
        }
        // A value that is not exactly one reference token is prose, a CSP
        // list, or inline CSS. Leave it to the url() pass below rather than
        // corrupting it.
        if (/\s/.test(value.trim())) return match;
        // Without a manifest for this file, only absolute/protocol-relative
        // values can be resolved (no owner URL to resolve a relative one
        // against) -- leave root-/document-relative values alone rather
        // than guess.
        if (!manifestActive && !/^(?:https?:)?\/\/\S+$/i.test(value.trim())) return match;
        const rewritten = rewriteRef(value);
        return rewritten === value ? match : `${space}${name}=${quote}${rewritten}${quote}`;
      },
    );
  }

  // CSS url(): eligible regardless of shape (absolute, root-relative,
  // document-relative, or a bare same-directory filename like `icon.svg`) --
  // a value inside `url(...)` is unambiguously a resource reference, not
  // prose, so there is no attribute-name-style discriminator needed here.
  next = next.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, value) => {
    if (!manifestActive && !/^(?:https?:)?\/\//i.test(value)) return match;
    const rewritten = rewriteRef(value);
    if (rewritten === value) return match;
    const q = quote || "";
    return `url(${q}${rewritten}${q})`;
  });

  next = next.replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote, value) => {
    if (!manifestActive && !/^(?:https?:)?\/\//i.test(value)) return match;
    const rewritten = rewriteRef(value);
    return rewritten === value ? match : `@import ${quote}${rewritten}${quote}`;
  });

  return next;
}

/**
 * Rewrites every mirrored file in place. Returns the tally for the caller to
 * report.
 *
 * @param {{ siteDir: string, origin: string, manifest?: object|null, dryRun?: boolean }} args
 *   `manifest` (a `lib/mirror-manifest.mjs` manifest) enables root-/document-
 *   relative rewriting; without one, only absolute/protocol-relative
 *   references are rewritten.
 */
export function rewriteMirror({ siteDir, origin, manifest = null, dryRun = false }) {
  const hosts = originHosts(origin);
  for (const file of walk(siteDir)) {
    const text = fs.readFileSync(file, "utf8");
    const ownerRel = path.relative(siteDir, file).split(path.sep).join("/");
    const ownerSourceUrl = manifest ? manifest.reverseGet(ownerRel) : null;
    const rewriteRef = makeRewriter(siteDir, file, hosts, manifest, ownerSourceUrl);
    const next = rewriteText(text, file, rewriteRef, { manifestActive: Boolean(manifest && ownerSourceUrl) });
    if (next === text) continue;
    stats.filesChanged += 1;
    if (!dryRun) fs.writeFileSync(file, next);
  }
  return { ...stats, missing: new Map(missing) };
}

export function reportRewrite(result, origin, dryRun) {
  const verb = dryRun ? "would rewrite" : "rewrote";
  console.log(`✅ ${verb} ${result.rewritten} reference(s) across ${result.filesChanged} file(s)`);
  if (!result.notMirrored) return;
  const top = [...result.missing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log(
    `  ⚠️ ${result.notMirrored} reference(s) point at ${origin} paths that were never mirrored; left remote:`,
  );
  for (const [rel, count] of top) console.log(`   ${String(count).padStart(3)}x ${rel}`);
  if (result.missing.size > top.length) {
    console.log(`   … and ${result.missing.size - top.length} more`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.out && !args.site)) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const outRoot = args.out ? path.resolve(args.out) : "";
  const siteDir = args.site ? path.resolve(args.site) : path.join(outRoot, "site");
  if (!fs.existsSync(siteDir)) {
    console.error(`✗ No mirrored site at ${siteDir}`);
    process.exit(1);
  }

  const origin =
    args.origin || (outRoot ? originFromManifest(path.join(outRoot, "mirror-manifest.json")) : "");
  if (!origin) {
    console.error("✗ Could not determine the mirrored origin. Pass --origin <URL>.");
    process.exit(1);
  }

  let manifest = null;
  if (outRoot) {
    const manifestPath = path.join(outRoot, "url-manifest.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const json = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        manifest = loadMirrorManifest(json, { computeLocalPath: localPathForUrl });
        console.log(`▸ Loaded ${json.length ?? 0} entr(y/ies) from url-manifest.json`);
      } catch (e) {
        console.warn(`⚠️ Could not load url-manifest.json (${e.message}); falling back to absolute-URL-only rewriting`);
      }
    }
  }

  console.log(`▸ Rewriting absolute ${origin} references to local paths in ${siteDir}`);
  reportRewrite(rewriteMirror({ siteDir, origin, manifest, dryRun: args.dryRun }), origin, args.dryRun);
}

// Importable as a library (mirror-site.mjs reuses the URL->path rule and the
// rewrite pass); the CLI only runs when this file is the entrypoint.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
