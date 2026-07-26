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
// Usage:
//   node scripts/rewrite-mirror.mjs --out <mirror-dir> [--origin <URL>] [--dry-run]
//   node scripts/rewrite-mirror.mjs --site <site-dir> --origin <URL>
//
// Discipline: a reference is only rewritten when the mirrored file it would point
// at actually exists on disk. Rewriting a URL whose asset was never downloaded
// would trade a working remote link for a guaranteed 404, so those are left alone
// and reported instead -- an honest gap beats a silent break.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const includeExt = new Set([".html", ".htm", ".css", ".svg"]);
const skipDirs = new Set([".git", "node_modules", "dist", "build", "RECON"]);

// `mirror-site.mjs` imports these so the "which local file does this URL mean?"
// rule has exactly one definition. A second copy would drift, and a drifted copy
// means the downloader and the rewriter disagree about what is missing.
export { originHosts, localPathForUrl, walk, collectSameOriginRefs };

function usage() {
  console.log(`rewrite-mirror.mjs -- rewrite absolute same-origin URLs in a mirror to local relative paths

  node scripts/rewrite-mirror.mjs --out <mirror-dir> [--origin <URL>] [--dry-run]
  node scripts/rewrite-mirror.mjs --site <site-dir> --origin <URL> [--dry-run]

--out     directory produced by mirror-site.mjs (contains site/ and mirror-manifest.json;
          --origin is inferred from the manifest when omitted)
--site    mirrored web root directly, when there is no manifest alongside it
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
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(path.join(dir, entry.name), files);
      continue;
    }
    if (includeExt.has(path.extname(entry.name).toLowerCase())) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
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

/** Local path a same-origin URL was mirrored to, mirroring urlToLocalPath in mirror-site.mjs. */
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
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/**
 * Every same-origin path the mirrored files reference, whether written absolutely
 * or root-relative.
 *
 * `mirror-site.mjs` only downloads what the capture run actually requested, so
 * anything behind a lazy-load, a hover state, or an unused `@font-face` format
 * (`.eot`/`.woff` alternates) is referenced by the markup but absent from disk.
 * Reading the references back off the mirror is what turns those into a
 * fetchable list.
 */
function collectSameOriginRefs(siteDir, hosts) {
  const refs = new Set();
  // Mirrors the generic attribute matching in rewriteText: the downloader must
  // look for exactly the references the rewriter will later try to localise, or
  // it fetches assets nothing points at and misses ones that do.
  const patterns = [
    /\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*['"]([^'"]+)['"]/g,
    /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
    /@import\s+['"]([^'"]+)['"]/gi,
  ];
  for (const file of walk(siteDir)) {
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of patterns) {
      const isAttr = pattern.source.startsWith("\\s(");
      for (const match of text.matchAll(pattern)) {
        const raw = (isAttr ? match[2] : match[1]) ?? "";
        const candidates = isAttr && /srcset$/i.test(match[1] ?? "")
          ? raw.split(",").map((part) => part.trim().split(/\s+/)[0] ?? "")
          : [raw];
        for (const candidate of candidates) {
          const value = candidate.trim();
          if (!value || value.startsWith("data:") || value.startsWith("#")) continue;
          let local = null;
          if (/^(https?:)?\/\//i.test(value)) {
            local = localPathForUrl(value, hosts);
          } else if (value.startsWith("/")) {
            local = localPathForUrl(`https://${[...hosts][0]}${value}`, hosts);
          }
          if (local) refs.add(local);
        }
      }
    }
  }
  return refs;
}

const stats = { rewritten: 0, notMirrored: 0, filesChanged: 0 };
const missing = new Map();

function makeRewriter(siteDir, ownerFile, hosts) {
  return function rewriteRef(raw) {
    const value = raw.trim();
    // Protocol-relative (`//host/path`) resolves against the page's scheme, so it
    // is just as remote as an explicit https:// reference.
    if (!/^(https?:)?\/\//i.test(value)) return raw;
    const local = localPathForUrl(value, hosts);
    if (!local) return raw;
    const target = path.join(siteDir, local);
    if (!fs.existsSync(target)) {
      stats.notMirrored += 1;
      missing.set(local, (missing.get(local) ?? 0) + 1);
      return raw;
    }
    const suffix = value.match(/^[^?#]*([?#][\s\S]*)$/)?.[1] ?? "";
    let rel = path.relative(path.dirname(ownerFile), target).split(path.sep).join("/");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    stats.rewritten += 1;
    return `${rel}${suffix}`;
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

function rewriteText(text, file, rewriteRef) {
  const isCss = path.extname(file).toLowerCase() === ".css";
  let next = text;

  if (!isCss) {
    // Any attribute, not an allowlist. Themes invent their own lazy-load
    // attributes (`data-nectar-img-srcset`, `data-lazy-src`, `data-bg`, …) and an
    // allowlist silently leaves whichever ones it has not met yet pointing at the
    // origin. Matching every attribute is safe because `rewriteRef` only touches
    // same-origin URLs whose mirrored file exists.
    next = next.replace(
      /(\s)([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(['"])([\s\S]*?)\3/g,
      (match, space, name, quote, value) => {
        if (!/(?:https?:)?\/\//i.test(value)) return match;
        const rewritten = /srcset$/i.test(name)
          ? rewriteSrcset(value, rewriteRef)
          : // A value that is not exactly one URL is prose, a CSP list, or inline
            // CSS. Leave it to the url() pass below rather than corrupting it.
            /^\s*(?:https?:)?\/\/\S+\s*$/i.test(value)
            ? rewriteRef(value)
            : value;
        return rewritten === value ? match : `${space}${name}=${quote}${rewritten}${quote}`;
      },
    );
  }

  next = next.replace(/url\(\s*(['"]?)((?:https?:)?\/\/[^'")]+)\1\s*\)/gi, (match, quote, value) => {
    const rewritten = rewriteRef(value);
    if (rewritten === value) return match;
    const q = quote || "";
    return `url(${q}${rewritten}${q})`;
  });

  next = next.replace(/@import\s+(['"])((?:https?:)?\/\/[^'"]+)\1/gi, (match, quote, value) => {
    const rewritten = rewriteRef(value);
    return rewritten === value ? match : `@import ${quote}${rewritten}${quote}`;
  });

  return next;
}

/** Rewrites every mirrored file in place. Returns the tally for the caller to report. */
export function rewriteMirror({ siteDir, origin, dryRun = false }) {
  const hosts = originHosts(origin);
  for (const file of walk(siteDir)) {
    const text = fs.readFileSync(file, "utf8");
    const next = rewriteText(text, file, makeRewriter(siteDir, file, hosts));
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

  console.log(`▸ Rewriting absolute ${origin} references to local paths in ${siteDir}`);
  reportRewrite(rewriteMirror({ siteDir, origin, dryRun: args.dryRun }), origin, args.dryRun);
}

// Importable as a library (mirror-site.mjs reuses the URL->path rule and the
// rewrite pass); the CLI only runs when this file is the entrypoint.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
