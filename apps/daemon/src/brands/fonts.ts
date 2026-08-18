// @ts-nocheck
import fs from "node:fs";
import path from "node:path";

import type { Brand } from "./schema.js";
import {
  fetchWebfontFile,
  fetchWebfontStylesheet,
  fontFaceCss,
  parseWebfontFaces,
  webfontFormatExtension,
  type FontFaceRef,
} from "./webfonts.js";

export { fontFaceCss } from "./webfonts.js";
export type { FontFaceRef } from "./webfonts.js";

/**
 * Webfont self-hosting for a brand workspace.
 *
 * `harvestFonts` parses `@font-face` rules out of harvested CSS, downloads the
 * best source per face (woff2 preferred) into `<brandDir>/fonts/`, and keeps a
 * `fonts/manifest.json` + portable `fonts/fonts.css` in sync. The engine then
 * inlines matching `@font-face` rules into every system document (kit,
 * artifacts, index) so previews — and the exported .brandpack — render in the
 * brand's real typefaces instead of fallbacks.
 *
 * Two ingestion moments feed the same manifest:
 *  - prefetch time: faces declared by the site's own CSS (incl. Google Fonts
 *    stylesheets the page links);
 *  - enrichment time: `selfHostGoogleFonts` fetches the Google Fonts CSS the
 *    synthesis agent picked (real face or visual stand-in) so even brands
 *    behind bot walls ship with loadable font files.
 */

export type FontFile = {
  family: string;
  /** Raw CSS font-weight value — "400", "700", or a variable range "100 900". */
  weight: string;
  style: string;
  /** Filename inside the brand dir's fonts/ folder. */
  file: string;
  format: string;
  sourceUrl: string;
  bytes: number;
  unicodeRange?: string;
};

export type FontManifest = { format: "brand-fonts/1"; files: FontFile[] };

const MAX_FONT_FILES = 16;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;

/** Icon/symbol faces are UI chrome, not brand typography. */
const ICON_FAMILY_RE = /icon|awesome|glyph|symbols|emoji|icomoon|fontello|pictogram/i;

/** Parse every usable @font-face rule out of a CSS blob. Pure. */
export function parseFontFaces(css: string, baseUrl: string): FontFaceRef[] {
  return parseWebfontFaces(css, baseUrl).filter((face) => !ICON_FAMILY_RE.test(face.family));
}

/** True when a unicode-range covers basic latin (or none is declared). */
function coversLatin(range?: string): boolean {
  if (!range) return true;
  return /u\+0(?:0|1)?[0-9a-f]{2}\b|u\+0000/i.test(range);
}

function fontsDir(brandDir: string): string {
  return path.join(brandDir, "fonts");
}

export function readFontManifest(brandDir: string): FontFile[] {
  try {
    const m = JSON.parse(
      fs.readFileSync(path.join(fontsDir(brandDir), "manifest.json"), "utf8"),
    ) as FontManifest;
    return Array.isArray(m.files) ? m.files : [];
  } catch {
    return [];
  }
}

function faceKey(f: { family: string; weight: string; style: string }): string {
  return `${f.family.toLowerCase()}|${f.weight}|${f.style}`;
}

function fileSlug(family: string, weight: string, style: string): string {
  const fam = family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "font";
  const w = weight.replace(/\s+/g, "-");
  return `${fam}-${w}${style !== "normal" ? `-${style.replace(/[^a-z]/gi, "")}` : ""}`;
}

/** Inline self-hosted @font-face rules into a rendered HTML document. */
export function injectFontFaces(html: string, files: FontFile[], urlPrefix: string): string {
  if (files.length === 0) return html;
  const css = fontFaceCss(files, urlPrefix);
  const tag = `<style data-brand-fonts>\n${css}\n</style>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}\n${tag}`);
  return tag + html;
}

function writeManifest(brandDir: string, files: FontFile[]): void {
  const dir = fontsDir(brandDir);
  fs.mkdirSync(dir, { recursive: true });
  const manifest: FontManifest = { format: "brand-fonts/1", files };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  // Portable stylesheet for external consumers (and the in-app aha page):
  // urls are relative to fonts/ itself.
  fs.writeFileSync(path.join(dir, "fonts.css"), fontFaceCss(files, "./") + "\n");
}

/**
 * Download the webfonts declared by `css` into `<brandDir>/fonts/` and merge
 * them into the manifest. Faces whose (family, weight, style) is already
 * self-hosted are skipped; icon fonts are dropped; for subsetted faces only
 * the latin slice is taken. Families in `preferFamilies` (the site's actually
 * *used* stacks) download first so caps cut the long tail, not the brand face.
 */
export async function harvestFonts(
  css: string,
  baseUrl: string,
  brandDir: string,
  opts?: { preferFamilies?: string[]; referer?: string },
): Promise<FontFile[]> {
  const existing = readFontManifest(brandDir);
  const seen = new Set(existing.map(faceKey));

  // One face per (family, weight, style): prefer the latin subset.
  const byKey = new Map<string, FontFaceRef>();
  for (const ref of parseFontFaces(css, baseUrl)) {
    const key = faceKey(ref);
    if (seen.has(key)) continue;
    const cur = byKey.get(key);
    if (!cur || (!coversLatin(cur.unicodeRange) && coversLatin(ref.unicodeRange))) {
      byKey.set(key, ref);
    }
  }

  const prefer = (opts?.preferFamilies ?? []).map((f) => f.toLowerCase());
  const rank = (ref: FontFaceRef) => {
    const i = prefer.indexOf(ref.family.toLowerCase());
    return i === -1 ? prefer.length : i;
  };
  const queue = [...byKey.values()].sort((a, b) => rank(a) - rank(b));

  let total = existing.reduce((n, f) => n + f.bytes, 0);
  const added: FontFile[] = [];
  for (const ref of queue) {
    if (existing.length + added.length >= MAX_FONT_FILES || total >= MAX_TOTAL_BYTES) break;
    let buf: Buffer;
    try {
      buf = await fetchWebfontFile(ref, { referer: opts?.referer ?? baseUrl });
    } catch {
      continue;
    }
    if (total + buf.length > MAX_TOTAL_BYTES) continue;
    const ext = webfontFormatExtension(ref.format);
    let file = `${fileSlug(ref.family, ref.weight, ref.style)}${ext}`;
    // Same key can't collide (deduped above), but a slugged name still can.
    if (fs.existsSync(path.join(fontsDir(brandDir), file))) {
      file = `${fileSlug(ref.family, ref.weight, ref.style)}-${existing.length + added.length}${ext}`;
    }
    fs.mkdirSync(fontsDir(brandDir), { recursive: true });
    fs.writeFileSync(path.join(fontsDir(brandDir), file), buf);
    total += buf.length;
    added.push({
      family: ref.family,
      weight: ref.weight,
      style: ref.style,
      file,
      format: ref.format,
      sourceUrl: ref.url.startsWith("data:") ? "data:(inlined in site CSS)" : ref.url,
      bytes: buf.length,
      ...(ref.unicodeRange ? { unicodeRange: ref.unicodeRange } : {}),
    });
  }

  if (added.length === 0) return existing;
  const all = [...existing, ...added];
  writeManifest(brandDir, all);
  return all;
}

const GF_CSS_RE = /^https:\/\/fonts\.googleapis\.com\//i;

/**
 * Self-host the Google Fonts faces the synthesized brand declares
 * (`typography.*.googleFontsUrl`) — fetches each stylesheet with a modern-
 * browser UA (so Google serves woff2) and harvests the files into fonts/.
 * Families already in the manifest are skipped by the harvest's dedupe.
 */
export async function selfHostGoogleFonts(brand: Brand, brandDir: string): Promise<FontFile[]> {
  const specs = [brand.typography?.display, brand.typography?.body, brand.typography?.mono];
  const urls = [...new Set(specs.map((s) => s?.googleFontsUrl).filter((u): u is string => Boolean(u && GF_CSS_RE.test(u))))];
  if (urls.length === 0) return readFontManifest(brandDir);

  const families = specs.flatMap((s) => (s ? [s.family, ...(s.fallbacks ?? [])] : []));
  const chunks: string[] = [];
  for (const url of urls) {
    try {
      chunks.push(await fetchWebfontStylesheet(url));
    } catch {
      /* unreachable stylesheet — skip */
    }
  }
  if (chunks.length === 0) return readFontManifest(brandDir);
  return harvestFonts(chunks.join("\n"), "https://fonts.gstatic.com/", brandDir, {
    preferFamilies: families,
  });
}
