#!/usr/bin/env node
// clamp-scroll-animation-overflow.mjs -- contains Salient/WPBakery scroll-linked
// parallax rows so they cannot inflate the mirrored document's width.
//
// Root cause (verified against a live mirror of designbybrandin.com, a
// Salient-themed WordPress site): elements marked `data-scroll-animation="true"
// data-scroll-animation-movement="transform_x"` get a JS-computed inline
// `transform: translateX(...)` applied every animation frame, driven by an
// IntersectionObserver `inView` flag. That flag can go stale before the page's
// true layout (images, fonts) settles -- the observer's first synchronous
// check can fire while the element is still transiently near the top of an
// unsettled layout, latching `inView=true` with an offset that is only correct
// once the surrounding page has reached its final height. The next animation
// frame then computes `transform: translateX()` using that now-correct (large)
// offset while still treating the element as "in view", producing a transform
// of several thousand pixels on a page that never actually scrolled. Nothing
// upstream clips it, so it inflates `document.documentElement.scrollWidth` for
// the entire document (measured 6025px vs 1440px viewport on both the live
// original and a faithful mirror of it -- this is the site's own runtime
// behavior, not something the mirror introduced, but a faithful clone should
// not present it as a wider document on first paint).
//
// The bug is specific to the `transform_x` movement axis: Salient's other
// `data-scroll-animation-movement` values (`transform_y`, `fade_in`,
// `bottom_top`, `zoom_in`, ...) drive vertical/opacity/scale effects that do
// not translate the element horizontally, so they cannot cause this class of
// overflow -- and some rows intentionally bleed horizontally on purpose (a
// wide decorative child inside a `transform_y` row, for instance). Matching
// on `data-scroll-animation="true"` alone would clamp those too, silently
// altering their layout for no reason. This module therefore requires BOTH
// attributes before touching anything.
//
// Fix: give every element carrying both attributes its own horizontal
// clipping box (`overflow-x: clip`, scoped to that element only). This is
// not a page-level `overflow-x: hidden` -- it targets only the elements whose
// JS-driven transform can run away, so any other horizontal scroller (a
// deliberate `overflow-x: auto` carousel, for example) is untouched. The
// element keeps receiving its normal transform updates and keeps animating
// exactly as before; only the portion that would have escaped the row's own
// box no longer reaches into the document's reported scroll width.
//
// `overflow-x: clip` rather than `overflow-x: hidden`: CSS Overflow Module
// Level 3 computes an `overflow-x`/`overflow-y` pair that mixes `visible`
// with anything other than `visible` or `clip` by forcing the `visible` side
// to `auto` -- i.e. `overflow-x: hidden` alone silently turns a row's
// (unspecified, therefore `visible`) `overflow-y` into `auto`, which can grow
// an unwanted vertical scrollbar on a row with incidental vertical bleed.
// `clip` is exempt from that coercion, so pairing it with an unspecified
// `overflow-y` leaves the vertical axis genuinely untouched. Verified in a
// real headless Chrome check (see the phase's proof artifacts): with
// `overflow-x: hidden` alone, computed `overflow-y` reads `auto`; with
// `overflow-x: clip` alone, computed `overflow-y` reads `visible`; explicitly
// pairing `overflow-x: hidden; overflow-y: visible;` does NOT avoid the
// coercion (computed `overflow-y` still reads `auto`), so explicit pairing is
// not a viable fallback here. `clip` was also verified to clamp
// `document.documentElement.scrollWidth` identically to `hidden` on the real
// mirror, and to leave the element's own scroll-linked animation running
// (transform keeps updating once the row is scrolled into view).
//
// Usage:
//   node scripts/clamp-scroll-animation-overflow.mjs --site <mirrored-site-dir> [--dry-run]
//
// Discipline: touches only elements carrying both attributes this bug is
// keyed on; every other element's markup is left byte-for-byte unchanged.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { walk } from "./rewrite-mirror.mjs";

// Both attributes are required (see the module docblock): the bug is keyed to
// the `transform_x` movement axis specifically, not to `data-scroll-animation`
// generally. Each matches a quoted value in either quote style, or a bare
// unquoted value (valid HTML5 as long as it isn't followed immediately by
// another token) -- tolerant of the attribute-order/spacing variation real
// mirrored markup exhibits.
const SCROLL_ANIMATION_TRUE = /data-scroll-animation\s*=\s*(?:"true"|'true'|true(?=[\s/>]))/i;
const SCROLL_ANIMATION_MOVEMENT_TRANSFORM_X =
  /data-scroll-animation-movement\s*=\s*(?:"transform_x"|'transform_x'|transform_x(?=[\s/>]))/i;
const OPEN_TAG_WITH_ATTR = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)>/g;
// Matches a `style` attribute in either quote style; group 1 holds a
// double-quoted value, group 2 a single-quoted one (never both).
const STYLE_ATTR = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const CLAMP_DECLARATION = "overflow-x:clip;";

/** True when `styleValue` already declares `overflow` or `overflow-x` (any value). Ignores unrelated properties like `text-overflow` -- a substring check would wrongly match those. */
function hasOverflowDeclaration(styleValue) {
  return styleValue.split(";").some((decl) => {
    const prop = decl.split(":")[0]?.trim().toLowerCase();
    return prop === "overflow" || prop === "overflow-x";
  });
}

function usage() {
  console.log(`clamp-scroll-animation-overflow.mjs -- scope a horizontal overflow clip to
Salient/WPBakery scroll-linked parallax rows on the transform_x movement axis
(data-scroll-animation="true" data-scroll-animation-movement="transform_x"), so a
stale in-view flag cannot inflate the mirrored document's scrollWidth.

  node scripts/clamp-scroll-animation-overflow.mjs --site <mirrored-site-dir> [--dry-run]

--site     mirrored web root produced by mirror-site.mjs (the directory containing index.html)
--dry-run  report what would change without writing`);
}

function parseArgs(argv) {
  const o = { site: "", dryRun: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--site") o.site = argv[++i] || "";
    else if (a === "--dry-run") o.dryRun = true;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  return o;
}

/** Adds the clamp to an existing `style` attribute, or a new one if absent. */
function clampTagStyle(tag) {
  const existing = tag.match(STYLE_ATTR);
  if (existing) {
    // Preserve whichever quote character the origin used -- rewriting a
    // single-quoted `style='...'` as a *second*, double-quoted `style="..."`
    // attribute would leave two `style` attributes on the same element, and
    // the browser drops everything the real one carried (including the
    // element's own initial transform).
    const isDoubleQuoted = existing[1] !== undefined;
    const value = isDoubleQuoted ? existing[1] : existing[2];
    const quote = isDoubleQuoted ? '"' : "'";
    // Already constrained (by us on a prior run, or by the page itself) --
    // leave whatever overflow rule is already there rather than layering a
    // second, possibly conflicting one.
    if (hasOverflowDeclaration(value)) return tag;
    const replaced = `${CLAMP_DECLARATION}${value}`;
    return (
      tag.slice(0, existing.index) + ` style=${quote}${replaced}${quote}` + tag.slice(existing.index + existing[0].length)
    );
  }
  // No style attribute at all -- insert one right after the tag name.
  const nameMatch = tag.match(/^<[a-zA-Z][a-zA-Z0-9-]*/);
  const insertAt = nameMatch[0].length;
  return `${tag.slice(0, insertAt)} style="${CLAMP_DECLARATION}"${tag.slice(insertAt)}`;
}

/** True when `tag` is a scroll-linked row on the buggy `transform_x` axis (see module docblock). */
function isTransformXScrollAnimationRow(tag) {
  return SCROLL_ANIMATION_TRUE.test(tag) && SCROLL_ANIMATION_MOVEMENT_TRANSFORM_X.test(tag);
}

/** Clamps every matching element's opening tag in one file's text. */
function clampText(text) {
  let changed = 0;
  const next = text.replace(OPEN_TAG_WITH_ATTR, (tag) => {
    if (!isTransformXScrollAnimationRow(tag)) return tag;
    const clamped = clampTagStyle(tag);
    if (clamped !== tag) changed += 1;
    return clamped;
  });
  return { next, changed };
}

/** Clamps every mirrored HTML file in place. Returns the tally for the caller to report. */
export function clampScrollAnimationOverflow({ siteDir, dryRun = false }) {
  const stats = { clamped: 0, filesChanged: 0 };
  for (const file of walk(siteDir)) {
    if (![".html", ".htm"].includes(path.extname(file).toLowerCase())) continue;
    const text = fs.readFileSync(file, "utf8");
    const { next, changed } = clampText(text);
    if (changed === 0) continue;
    stats.clamped += changed;
    stats.filesChanged += 1;
    if (!dryRun) fs.writeFileSync(file, next);
  }
  return stats;
}

export function reportClamp(result, dryRun) {
  const verb = dryRun ? "would clamp" : "clamped";
  console.log(
    `✅ ${verb} ${result.clamped} scroll-animation row(s) across ${result.filesChanged} file(s) with a scoped overflow-x: clip`,
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.site) {
    usage();
    process.exit(args.help ? 0 : 1);
  }
  const siteDir = path.resolve(args.site);
  if (!fs.existsSync(siteDir)) {
    console.error(`✗ No mirrored site at ${siteDir}`);
    process.exit(1);
  }
  console.log(`▸ Clamping scroll-linked overflow in ${siteDir}`);
  reportClamp(clampScrollAnimationOverflow({ siteDir, dryRun: args.dryRun }), args.dryRun);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
