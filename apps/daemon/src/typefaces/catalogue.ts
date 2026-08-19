// Typeface catalogue index — turns the woff2 files already vendored under
// `design-templates/*/fonts/fonts.css` into a queryable, license-gated pool
// a run with no template can reach. See allowlist.ts for the licence
// reasoning and packages/contracts/src/api/typefaces.ts for the DTO shapes
// this module backs.
//
// Filenames on disk are content-addressed hashes (e.g.
// "clash-display-316d87868f.woff2") and are never trusted as a source of
// family identity. The only source of truth is the `font-family` declared
// inside each template's `fonts/fonts.css` — the same parser
// (`parseWebfontFaces`) `scripts/vendor-fonts.ts` itself uses to write those
// files, so this index reads the exact same shape it was built from.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type {
  TypefaceClassification,
  TypefaceDetail,
  TypefaceFace,
  TypefaceFontStyle,
  TypefaceSummary,
} from '@open-design/contracts';

import { ICON_FAMILY_RE } from '../brands/fonts.js';
import { fontFaceCss, parseWebfontFaces, type FontFaceCssFile } from '../brands/webfonts.js';
import { classifyTypefaceLicense } from './allowlist.js';

/** Internal-only: a face plus where its physical file lives, for install to copy from. */
export interface IndexedTypefaceFace extends TypefaceFace {
  sourcePath: string;
}

export interface IndexedTypeface extends TypefaceDetail {
  faces: IndexedTypefaceFace[];
}

export interface TypefaceIndex {
  /** Slug id -> full entry, license-gate already applied. */
  families: Map<string, IndexedTypeface>;
  /** Distinct family names found on disk before any filtering, for transparency. */
  scannedFamilies: number;
}

const WEIGHT_RANGE_RE = /^(\d{1,4})\s+(\d{1,4})$/;
const NAME_HINT_WORDS: readonly string[] = [
  'Condensed', 'Narrow', 'Expanded', 'Black', 'Display', 'Slab', 'Stencil', 'Script', 'Mono',
];

export function slugifyTypefaceFamily(family: string): string {
  return family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'font';
}

function nameHintsFor(canonicalName: string): string[] {
  return NAME_HINT_WORDS.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(canonicalName));
}

function classificationFor(canonicalName: string, faces: readonly TypefaceFace[]): TypefaceClassification {
  const weights = new Set<number>();
  let variableWeightRange: [number, number] | undefined;
  const styles = new Set<TypefaceFontStyle>();
  for (const face of faces) {
    styles.add(face.style);
    const range = WEIGHT_RANGE_RE.exec(face.weight.trim());
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      variableWeightRange = variableWeightRange
        ? [Math.min(variableWeightRange[0], lo), Math.max(variableWeightRange[1], hi)]
        : [lo, hi];
      continue;
    }
    const value = Number(face.weight.trim());
    if (Number.isFinite(value)) weights.add(value);
  }
  return {
    weights: [...weights].sort((a, b) => a - b),
    ...(variableWeightRange ? { variableWeightRange } : {}),
    styles: [...styles].sort(),
    monospace: /\bmono\b/i.test(canonicalName),
    nameHints: nameHintsFor(canonicalName),
  };
}

function faceDedupeKey(weight: string, style: string, unicodeRange?: string): string {
  return `${weight.trim()}|${style}|${unicodeRange ?? 'none'}`;
}

async function readTemplateDirs(designTemplatesDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = (await fs.readdir(designTemplatesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return entries.sort();
}

/** Builds the full index by scanning every `<template>/fonts/fonts.css` under `designTemplatesDir`. Pure I/O, no caching — callers own memoization. */
export async function buildTypefaceIndex(designTemplatesDir: string): Promise<TypefaceIndex> {
  const templates = await readTemplateDirs(designTemplatesDir);
  const scannedFamilyKeys = new Set<string>();
  // family key (lowercase) -> dedupe key -> face
  const facesByFamily = new Map<string, Map<string, IndexedTypefaceFace>>();

  for (const template of templates) {
    const templateDir = path.join(designTemplatesDir, template);
    const fontsDir = path.join(templateDir, 'fonts');
    const cssPath = path.join(fontsDir, 'fonts.css');
    let css: string;
    try {
      css = await fs.readFile(cssPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }

    let parsedFaces;
    try {
      parsedFaces = parseWebfontFaces(css, pathToFileURL(cssPath).href);
    } catch {
      continue; // malformed fonts.css in one template must not break the whole index
    }

    for (const face of parsedFaces) {
      if (ICON_FAMILY_RE.test(face.family)) continue;
      const familyKey = face.family.trim().toLowerCase();
      scannedFamilyKeys.add(familyKey);

      const decision = classifyTypefaceLicense(face.family);
      if (!decision.allowed || !decision.entry) continue;

      let url: URL;
      try {
        url = new URL(face.url);
      } catch {
        continue;
      }
      if (url.protocol !== 'file:') continue; // every catalogue face is local by construction
      const sourcePath = fileURLToPath(url);
      if (path.dirname(sourcePath) !== fontsDir) continue; // defensive: stylesheet must not point outside its own template

      const dedupeKey = faceDedupeKey(face.weight, face.style, face.unicodeRange);
      let faceMap = facesByFamily.get(familyKey);
      if (!faceMap) {
        faceMap = new Map();
        facesByFamily.set(familyKey, faceMap);
      }
      if (faceMap.has(dedupeKey)) continue; // first template found wins — same descriptor, keep one source

      faceMap.set(dedupeKey, {
        weight: face.weight,
        style: face.style as TypefaceFontStyle,
        file: path.basename(sourcePath),
        format: face.format,
        ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
        sourcePath,
      });
    }
  }

  const families = new Map<string, IndexedTypeface>();
  for (const [familyKey, faceMap] of facesByFamily) {
    if (faceMap.size === 0) continue;
    const decision = classifyTypefaceLicense(familyKey);
    if (!decision.allowed || !decision.entry) continue; // already filtered above; re-check keeps this loop self-contained
    const canonicalName = decision.entry.canonicalName;
    const faces = [...faceMap.values()].sort((a, b) => a.file.localeCompare(b.file));
    const id = slugifyTypefaceFamily(canonicalName);
    families.set(id, {
      id,
      family: canonicalName,
      classification: classificationFor(canonicalName, faces),
      license: { spdx: decision.entry.spdx, sourceLabel: decision.entry.sourceLabel },
      faceCount: faces.length,
      faces,
    });
  }

  return { families, scannedFamilies: scannedFamilyKeys.size };
}

// One cached index per distinct design-templates root. The catalogue is
// static, bundled repository content — no file watcher is warranted — so a
// process-lifetime cache keyed by directory avoids re-reading ~300 small CSS
// files on every request while staying correct across tests that each point
// at their own temp directory.
const indexCache = new Map<string, Promise<TypefaceIndex>>();

export function getTypefaceIndex(designTemplatesDir: string): Promise<TypefaceIndex> {
  let cached = indexCache.get(designTemplatesDir);
  if (!cached) {
    cached = buildTypefaceIndex(designTemplatesDir);
    indexCache.set(designTemplatesDir, cached);
  }
  return cached;
}

/** Test-only: drop the memoized index for a directory (or every directory) so a re-scan picks up fixture changes. */
export function resetTypefaceIndexCache(designTemplatesDir?: string): void {
  if (designTemplatesDir) indexCache.delete(designTemplatesDir);
  else indexCache.clear();
}

function toSummary(entry: IndexedTypeface): TypefaceSummary {
  return {
    id: entry.id,
    family: entry.family,
    classification: entry.classification,
    license: entry.license,
    faceCount: entry.faceCount,
  };
}

function toDetail(entry: IndexedTypeface): TypefaceDetail {
  return {
    ...toSummary(entry),
    faces: entry.faces.map(({ sourcePath: _sourcePath, ...face }) => face),
  };
}

export interface ListTypefacesFilter {
  q?: string;
  monospace?: boolean;
  condensed?: boolean;
}

export async function listTypefaces(
  designTemplatesDir: string,
  filter: ListTypefacesFilter = {},
): Promise<{ typefaces: TypefaceSummary[]; scannedFamilies: number }> {
  const index = await getTypefaceIndex(designTemplatesDir);
  const query = filter.q?.trim().toLowerCase();
  const typefaces = [...index.families.values()]
    .filter((entry) => !query || entry.family.toLowerCase().includes(query))
    .filter((entry) => filter.monospace == null || entry.classification.monospace === filter.monospace)
    .filter((entry) => !filter.condensed || entry.classification.nameHints.some((hint) => hint === 'Condensed' || hint === 'Narrow'))
    .sort((a, b) => a.family.localeCompare(b.family))
    .map(toSummary);
  return { typefaces, scannedFamilies: index.scannedFamilies };
}

export async function getTypeface(designTemplatesDir: string, id: string): Promise<TypefaceDetail | undefined> {
  const index = await getTypefaceIndex(designTemplatesDir);
  const entry = index.families.get(id.trim().toLowerCase());
  return entry ? toDetail(entry) : undefined;
}

/**
 * Internal-only: looks up one indexed face by family id + exact filename, for
 * the face-serving route (routes/typefaces.ts). The match is against the
 * pre-built index's own `face.file` values -- never a filesystem path built
 * from request input -- so there is no traversal surface: a value that does
 * not exactly equal an indexed filename simply misses. Unlike `getTypeface`,
 * this returns the internal `IndexedTypefaceFace` (with `sourcePath`), since
 * `getTypeface` -> `toDetail()` strips `sourcePath` before its DTO reaches
 * callers outside this module (F008 audit correction: `getTypeface()` cannot
 * be reused for this).
 */
export async function findIndexedTypefaceFace(
  designTemplatesDir: string,
  id: string,
  file: string,
): Promise<IndexedTypefaceFace | undefined> {
  const index = await getTypefaceIndex(designTemplatesDir);
  const entry = index.families.get(id.trim().toLowerCase());
  return entry?.faces.find((face) => face.file === file);
}

/**
 * True when `id` names a family visible somewhere in the raw catalogue scan
 * but excluded by the licence gate — lets the HTTP layer return a specific
 * "excluded, here's why" 404 instead of a bare "not found" for names the
 * task explicitly calls out (e.g. "clash-display").
 */
export async function describeExcludedTypeface(designTemplatesDir: string, id: string): Promise<string | undefined> {
  const templates = await readTemplateDirs(designTemplatesDir);
  const wantedSlug = id.trim().toLowerCase();
  for (const template of templates) {
    const cssPath = path.join(designTemplatesDir, template, 'fonts', 'fonts.css');
    let css: string;
    try {
      css = await fs.readFile(cssPath, 'utf8');
    } catch {
      continue;
    }
    let parsedFaces;
    try {
      parsedFaces = parseWebfontFaces(css, pathToFileURL(cssPath).href);
    } catch {
      continue;
    }
    for (const face of parsedFaces) {
      if (slugifyTypefaceFamily(face.family) !== wantedSlug) continue;
      const decision = classifyTypefaceLicense(face.family);
      if (!decision.allowed) return decision.reason ?? 'excluded from the installable pool';
    }
  }
  return undefined;
}

// ---- Install ---------------------------------------------------------------

export class TypefaceNotFoundError extends Error {
  constructor(id: string) {
    super(`typeface not found: ${id}`);
    this.name = 'TypefaceNotFoundError';
  }
}

export class TypefaceInstallPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TypefaceInstallPathError';
  }
}

export interface InstallTypefaceOptions {
  projectRoot: string;
  /** Relative to projectRoot. Defaults to `assets/fonts/<id>/`. */
  dir?: string;
}

export interface InstallTypefaceResult {
  family: string;
  dir: string;
  cssFile: string;
  files: string[];
  css: string;
}

function assertSafeRelativeDir(dir: string): void {
  const normalized = dir.replace(/\\/g, '/');
  if (normalized.length === 0 || path.isAbsolute(normalized)) {
    throw new TypefaceInstallPathError(`install dir must be a relative path: "${dir}"`);
  }
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new TypefaceInstallPathError(`install dir may not contain "." or ".." segments: "${dir}"`);
  }
}

/**
 * Copies every face's woff2 file into `<projectRoot>/<dir>/` and writes an
 * `@font-face` `fonts.css` there via the same `fontFaceCss()` emitter the
 * catalogue vendoring pipeline uses, so the output is byte-for-byte the same
 * shape as every other self-hosted `fonts.css` in this repository.
 */
export async function installTypeface(
  designTemplatesDir: string,
  id: string,
  opts: InstallTypefaceOptions,
): Promise<InstallTypefaceResult> {
  const index = await getTypefaceIndex(designTemplatesDir);
  const entry = index.families.get(id.trim().toLowerCase());
  if (!entry) throw new TypefaceNotFoundError(id);

  const relDir = (opts.dir ?? `assets/fonts/${entry.id}`).replace(/\\/g, '/');
  assertSafeRelativeDir(relDir);
  const projectRoot = path.resolve(opts.projectRoot);
  const destDir = path.resolve(projectRoot, relDir);
  if (destDir !== projectRoot && !destDir.startsWith(projectRoot + path.sep)) {
    throw new TypefaceInstallPathError(`install dir escapes the project root: "${opts.dir}"`);
  }

  await fs.mkdir(destDir, { recursive: true });
  const files: string[] = [];
  for (const face of entry.faces) {
    await fs.copyFile(face.sourcePath, path.join(destDir, face.file));
    files.push(face.file);
  }

  const cssFiles: FontFaceCssFile[] = entry.faces.map((face) => ({
    family: entry.family,
    weight: face.weight,
    style: face.style,
    file: face.file,
    format: face.format,
    ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
  }));
  const css = `${fontFaceCss(cssFiles, './').trimEnd()}\n`;
  const cssPath = path.join(destDir, 'fonts.css');
  await fs.writeFile(cssPath, css, 'utf8');

  return {
    family: entry.family,
    dir: path.relative(projectRoot, destDir).split(path.sep).join('/'),
    cssFile: path.relative(projectRoot, cssPath).split(path.sep).join('/'),
    files,
    css,
  };
}
