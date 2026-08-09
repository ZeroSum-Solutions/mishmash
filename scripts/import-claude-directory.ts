#!/usr/bin/env node
// Import claude-directory items as Open Design design templates.
//
// Upstream `pulkitxm/claude-directory` (MIT) ships one folder per item: a
// README describing the design, a `prompt.md` build spec, and either a static
// page (`index.html` + `styles.css` + `script.js`), a multi-page theme, or a
// Vite/React project. A Vite item has to be built before it can be imported —
// with `--base ./`, so its emitted URLs resolve from the template's own
// directory instead of a server root.
//
// Each import produces one `design-templates/<id>/` entry in the shape the
// vendored html-ppt family already uses: an `example.html`, a `template.json`
// provenance snapshot, the upstream `LICENSE`, and a `SKILL.md` whose body
// carries the upstream build spec.
//
// Two bake strategies, chosen by what the item's references depend on:
//
// - Hand-written pages (static and multi-page) inline their stylesheets and
//   classic scripts, and flatten every asset into one `assets/` directory.
// - Vite items mirror their build output verbatim. A bundle resolves lazy
//   chunks and imported media against `import.meta.url`, so inlining or
//   flattening it would silently rebase URLs no rewrite can see.
//
// Weight policy: upstream vendors its own webfonts, print-resolution imagery,
// and multi-megabyte hero footage (~700MB across the three families). Local
// `@font-face` rules are rewritten to the Google Fonts CDN — the same thing 61
// existing templates already do — and media is re-encoded through ImageMagick
// and ffmpeg. Anything still over `OPAQUE_ASSET_BYTE_CEILING` is dropped along
// with its reference, so a skipped asset leaves a gap rather than a 404.
//
// Requires `magick` and `ffmpeg` on PATH. Without them the import still runs,
// but every asset ships at its original size.
//
// Usage: node --experimental-strip-types scripts/import-claude-directory.ts \
//          <path-to-claude-directory-checkout> [idFilter]

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN_TEMPLATES = path.join(REPO_ROOT, 'design-templates');
const UPSTREAM_REPO = 'https://github.com/pulkitxm/claude-directory';
/** Scratch space for re-encoded media; lives outside the repository. */
const OPTIMISED_CACHE_DIR = path.join(os.tmpdir(), 'claude-directory-import-cache');

/** Longest edge, in px, for a re-encoded image. Preview fidelity, not print. */
const DOWNSCALE_LONGEST_EDGE = 1100;
/** WebP quality for re-encoded images. */
const WEBP_QUALITY = 62;
/** JPEG quality for re-encoded images, which keep their extension. */
const JPEG_QUALITY = 72;
/** A PNG over this size is photographic; below it, flat-colour UI art. */
const PNG_BYTES_BEFORE_QUANTISE = 250_000;
/** Palette size for a quantised photographic PNG. */
const PNG_PALETTE_COLOURS = 256;
/** Longest edge and colour budget for animated sources, which cost the most. */
const ANIMATION_LONGEST_EDGE = 720;
const ANIMATION_COLOURS = 96;
/** Longest edge, in px, for re-encoded hero footage. */
const VIDEO_LONGEST_EDGE = 1280;
/** x264 constant rate factor for re-encoded hero footage. */
const VIDEO_CRF = 32;
/**
 * Ceiling for assets no re-encode could shrink below it. A reference over the
 * ceiling is dropped rather than left dangling, so nothing 404s at preview
 * time.
 */
const OPAQUE_ASSET_BYTE_CEILING = 2_500_000;
/** Webfonts above this size are dropped in favour of the Google Fonts CDN. */
const FONT_BYTES_BEFORE_CDN_SWAP = 60_000;

export type ItemKind = 'static' | 'vite' | 'multipage';

/**
 * Upstream items whose build emits only a server bundle (TanStack Start SSR)
 * and never a static entry document. Each one has to be served once and
 * captured into a `dist/index.html` before it can be imported.
 *
 * That capture is markup, not an app: its hydration entry re-runs against a
 * DOM the router never created and throws, so the bake strips every script and
 * ships the page inert.
 */
const SERVER_RENDERED_SNAPSHOTS = new Set([
  'groundai-landing',
  'kubric-hero-landing',
  'pelmatech-health-companion',
]);

export interface SourceItem {
  /** design-template id, unique across the catalogue. */
  id: string;
  /** Folder name upstream. */
  slug: string;
  /** Path of the item relative to the upstream repo root. */
  relPath: string;
  dir: string;
  kind: ItemKind;
  /** Catalogue family, used for tags and the gallery scenario. */
  family: 'hero-sections' | 'landing-pages' | 'lexingtonthemes';
}

const FAMILY_META: Record<
  SourceItem['family'],
  { label: string; scenario: string; tag: string; idPrefix: string }
> = {
  'hero-sections': {
    label: 'Hero section',
    scenario: 'marketing',
    tag: 'hero-section',
    idPrefix: '',
  },
  'landing-pages': {
    label: 'Landing page',
    scenario: 'marketing',
    tag: 'landing-page',
    idPrefix: '',
  },
  lexingtonthemes: {
    label: 'Multi-page site theme',
    scenario: 'marketing',
    tag: 'site-theme',
    // Lexington slugs are single generic words (`navy`, `carbon`, `author`);
    // they need a namespace to stay unambiguous in a flat catalogue.
    idPrefix: 'lexington-',
  },
};

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function directoriesIn(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

export function discoverItems(sourceRoot: string): SourceItem[] {
  const items: SourceItem[] = [];

  const families: Array<{ family: SourceItem['family']; rel: string }> = [
    { family: 'hero-sections', rel: 'hero-sections' },
    { family: 'landing-pages', rel: 'landing-pages' },
    { family: 'lexingtonthemes', rel: 'templates/premium/lexingtonthemes' },
  ];

  for (const { family, rel } of families) {
    const root = path.join(sourceRoot, rel);
    for (const slug of directoriesIn(root)) {
      const dir = path.join(root, slug);
      const isBuilt = existsSync(path.join(dir, 'package.json'));
      // A built item's entry only appears under `dist/` after the build step.
      if (!isBuilt && !existsSync(path.join(dir, 'index.html'))) continue;
      const kind: ItemKind = isBuilt
        ? 'vite'
        : family === 'lexingtonthemes'
          ? 'multipage'
          : 'static';
      items.push({
        id: `${FAMILY_META[family].idPrefix}${slug}`,
        slug,
        relPath: `${rel}/${slug}`,
        dir,
        kind,
        family,
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Upstream text
// ---------------------------------------------------------------------------

function readIfPresent(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** Upstream READMEs open with `# <Title>`, a demo badge, then one description paragraph. */
export function parseReadme(readme: string): { title: string; description: string } {
  const lines = readme.split('\n');
  const heading = lines.find((line) => line.startsWith('# '));
  const title = (heading ?? '# Untitled')
    .slice(2)
    // Upstream titles append the stack as a parenthetical
    // ("… (Vanilla HTML + CSS + JS)"); that is packaging, not a name.
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();

  const body = readme
    .split('\n\n')
    .map((block) => block.trim())
    .find(
      (block) =>
        block.length > 80 &&
        !block.startsWith('#') &&
        !block.startsWith('[!') &&
        !block.startsWith('|') &&
        !block.startsWith('```'),
    );

  const description = (body ?? title)
    // Upstream stamps every README with the model that produced it; that is
    // provenance for their gallery, not a description of the design.
    .replace(/\s*Generated with Claude [^.]*\.\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { title, description };
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'clone', 'css', 'for', 'html', 'js', 'page', 'plain',
  'reproduction', 'template', 'the', 'vanilla', 'with',
]);

export function deriveTriggers(title: string, family: SourceItem['family']): string[] {
  const cleanTitle = title.split(/[—–|(]/)[0]!.trim();
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

  return [...new Set([cleanTitle.toLowerCase(), ...words, FAMILY_META[family].tag])].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Baking
// ---------------------------------------------------------------------------

interface BakeResult {
  html: string;
  /** Absolute source path -> destination path inside the design template. */
  assets: Map<string, string>;
  /** Destination path -> replacement text, for assets the bake edits. */
  rewritten: Map<string, string>;
  /** Upstream files too large to vendor, named for the provenance record. */
  dropped: string[];
  fontFamilies: string[];
}

const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.css']);

/**
 * Whether one upstream file is small enough to vendor.
 *
 * Code and stylesheets are never optional — a dropped chunk takes the whole
 * page down, where a dropped image only leaves a gap — so only media is
 * measured, and measured after its re-encode.
 */
/** Assets left behind by the current bake, for the provenance record. */
let droppedAssets: string[] = [];

function isShippable(file: string): boolean {
  if (CODE_EXTENSIONS.has(path.extname(file).toLowerCase())) return true;
  if (statSync(optimisedSource(file)).size <= OPAQUE_ASSET_BYTE_CEILING) return true;
  droppedAssets.push(path.basename(file));
  return false;
}

/**
 * Every file a build emitted except its entry document, paired with the path
 * it takes inside the design template.
 *
 * Everything lands under `assets/`, because that is the only subtree the
 * daemon serves (`GET /api/skills/:id/assets/*`). `dist/assets/` collapses
 * into it directly so a chunk's siblings stay beside it, and any other
 * build-output directory keeps its own name one level down.
 */
function mirrorBuildOutput(distDir: string, inert: boolean): Array<[string, string]> {
  const files: Array<[string, string]> = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        // `dist/server` is the SSR half of a snapshot build; it never ships.
        if (entry.name === 'server') continue;
        walk(full, prefix === '' && entry.name === 'assets' ? '' : relative);
      } else if (entry.isFile() && entry.name !== 'index.html') {
        // An inert snapshot has had its scripts stripped, so its client
        // bundle is several megabytes of code nothing will ever load.
        if (inert && /\.m?js$/.test(entry.name)) continue;
        if (isShippable(full)) files.push([full, `assets/${relative}`]);
      }
    }
  };
  walk(distDir, '');
  return files;
}

/** Local (non-absolute, non-remote, non-anchor) URL references in HTML or CSS. */
function isLocalRef(ref: string): boolean {
  if (!ref) return false;
  if (/^(https?:|data:|mailto:|tel:|#|\/\/)/i.test(ref)) return false;
  return true;
}

const FONT_EXTENSIONS = new Set(['.woff2', '.woff', '.ttf', '.otf', '.eot']);
const RASTER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov']);
/** Every extension a reference has to end in before we try to resolve it. */
const ASSET_EXTENSIONS = new Set([
  ...RASTER_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...FONT_EXTENSIONS,
  '.svg', '.avif', '.ico', '.css', '.js', '.mjs', '.json',
]);

/**
 * Upstream ships print-resolution imagery and multi-megabyte hero footage
 * (~700MB across the three families). Re-encode each one once into a cache and
 * remember the result, so `collectAssets` can name the reference and
 * `copyAsset` can place the bytes. Falls back to the original file when the
 * encoder is absent or the re-encode does not shrink the file.
 */
const optimisedCache = new Map<string, string>();

function optimisedSource(original: string): string {
  const cached = optimisedCache.get(original);
  if (cached) return cached;

  const extension = path.extname(original).toLowerCase();
  const digest = createHash('sha1').update(original).digest('hex');
  let chosen = original;

  try {
    mkdirSync(OPTIMISED_CACHE_DIR, { recursive: true });
    if (RASTER_EXTENSIONS.has(extension)) {
      // Rasters keep their extension. Upstream pages assemble asset paths at
      // runtime (`assets/img/product-${n}.jpg`), so a re-encode that renamed
      // the file would 404 exactly the references no rewrite can see.
      //
      // Animated sources get a colour budget and a smaller frame as well,
      // because that is where upstream keeps its heaviest files.
      const animated = extension === '.gif';
      const quality = extension === '.webp' ? WEBP_QUALITY : JPEG_QUALITY;
      const edge = animated ? ANIMATION_LONGEST_EDGE : DOWNSCALE_LONGEST_EDGE;
      // PNG has no lossy quality dial, so a heavy photographic PNG only comes
      // down through its palette. Small PNGs are flat-colour logos and icons
      // that a palette would not shrink anyway, so they are left alone.
      const quantise =
        animated || (extension === '.png' && statSync(original).size > PNG_BYTES_BEFORE_QUANTISE);
      const colours = animated ? ANIMATION_COLOURS : PNG_PALETTE_COLOURS;
      const candidate = path.join(OPTIMISED_CACHE_DIR, `${digest}${extension}`);
      if (!existsSync(candidate)) {
        // `>` only shrinks; portrait and landscape both cap at the same edge.
        // `-coalesce` first so every frame is whole before it is resized.
        execFileSync(
          'magick',
          [
            original, '-coalesce',
            '-resize', `${edge}x${edge}>`,
            ...(quantise ? ['-colors', String(colours)] : []),
            ...(animated ? ['-layers', 'optimize'] : []),
            '-quality', String(quality), '-strip',
            candidate,
          ],
          { stdio: 'ignore' },
        );
      }
      if (statSync(candidate).size < statSync(original).size) chosen = candidate;
    } else if (VIDEO_EXTENSIONS.has(extension)) {
      const candidate = path.join(OPTIMISED_CACHE_DIR, `${digest}.mp4`);
      if (!existsSync(candidate)) {
        // Hero footage is decorative and muted in every upstream item, so the
        // audio track is dropped along with the resolution.
        execFileSync(
          'ffmpeg',
          [
            '-y', '-i', original,
            '-vf', `scale='min(${VIDEO_LONGEST_EDGE},iw)':-2`,
            '-c:v', 'libx264', '-crf', String(VIDEO_CRF), '-preset', 'veryfast',
            '-movflags', '+faststart', '-an',
            candidate,
          ],
          { stdio: 'ignore' },
        );
      }
      if (statSync(candidate).size < statSync(original).size) chosen = candidate;
    }
  } catch {
    // ImageMagick and ffmpeg are not guaranteed to be installed; the original
    // ships unchanged when they are missing, which only costs repository
    // weight — and the size ceiling in `collectAssets` still applies.
  }

  optimisedCache.set(original, chosen);
  return chosen;
}

/**
 * Flat, collision-free filename for an asset, reflecting any re-encode.
 * Upstream nests assets (`assets/img/g1.jpg`, `assets/thumbs/g1.jpg`) that
 * would collide once flattened, so a second source claiming a taken name gets
 * a short digest suffix.
 */
const assetNames = new Map<string, string>();
const claimedNames = new Map<string, string>();

function assetFileName(original: string): string {
  const cached = assetNames.get(original);
  if (cached) return cached;

  const optimised = optimisedSource(original);
  const base = path.basename(original, path.extname(original));
  const extension = path.extname(optimised);
  let name = `${base}${extension}`;
  if (claimedNames.has(name) && claimedNames.get(name) !== original) {
    name = `${base}-${createHash('sha1').update(original).digest('hex').slice(0, 8)}${extension}`;
  }

  claimedNames.set(name, original);
  assetNames.set(original, name);
  return name;
}

/**
 * Strip `@font-face` blocks that point at vendored font files and report the
 * families they declared, so the caller can request them from the Google Fonts
 * CDN instead. Families the CDN does not carry simply fall through to the
 * stylesheet's own fallback stack.
 */
export function swapLocalFontsForCdn(css: string): { css: string; families: string[] } {
  const families: string[] = [];
  const out = css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
    const url = /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(block);
    if (!url || !isLocalRef(url[1]!)) return block;
    const family = /font-family\s*:\s*['"]?([^;'"]+)['"]?\s*;/.exec(block);
    if (family) families.push(family[1]!.trim());
    return '';
  });
  return { css: out, families: [...new Set(families)] };
}

function googleFontsLink(families: string[]): string {
  if (families.length === 0) return '';
  const query = families
    .map((family) => `family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@300;400;500;600;700;800`)
    .join('&');
  return `\n\t\t<link rel="preconnect" href="https://fonts.googleapis.com">\n\t\t<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n\t\t<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${query}&display=swap">`;
}

const SKIPPED_SCAN_DIRECTORIES = new Set(['node_modules', '.git', '.audit', '.reference', 'server']);

/**
 * Every file an upstream item owns, indexed by bare filename.
 *
 * Upstream code routinely names an asset without its directory
 * (`{ img: "product-1.jpg" }`, joined to a base path elsewhere), so directory
 * resolution alone misses them. A basename is only trusted when the item
 * holds exactly one file with that name.
 */
let basenameIndex = new Map<string, string[]>();

function indexItemFiles(root: string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_SCAN_DIRECTORIES.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.isFile() && ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const found = index.get(entry.name) ?? [];
        found.push(path.join(dir, entry.name));
        index.set(entry.name, found);
      }
    }
  };
  walk(root);
  return index;
}

/**
 * Decide where one upstream reference ends up: a flat `assets/<name>` path
 * this import ships, or `null` when the asset is deliberately left behind.
 *
 * Dropping returns `null` rather than the original reference on purpose. An
 * un-rewritten local path resolves to nothing once the page is baked, and a
 * dangling reference is a 404 in every preview — worse than a missing image.
 */
function planReference(
  ref: string,
  itemDir: string,
  baseDir: string,
  assets: Map<string, string>,
): string | null {
  if (!isLocalRef(ref)) return null;
  const cleaned = ref.replace(/^\.?\//, '').split(/[?#]/)[0]!;
  if (!cleaned || !ASSET_EXTENSIONS.has(path.extname(cleaned).toLowerCase())) return null;

  const candidates = [
    path.join(baseDir, cleaned),
    // Bundler chunks import their siblings by bare relative name, so a
    // reference from inside `dist/assets/x.js` has no `assets/` prefix.
    path.join(baseDir, 'assets', cleaned),
    path.join(itemDir, cleaned),
    path.join(itemDir, 'public', cleaned),
    path.join(itemDir, 'dist', cleaned),
    path.join(itemDir, 'dist', 'assets', cleaned),
  ];
  const byName = basenameIndex.get(path.basename(cleaned)) ?? [];
  const resolved =
    candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ??
    (byName.length === 1 ? byName[0]! : undefined);
  if (!resolved) return null;

  const extension = path.extname(resolved).toLowerCase();
  // Webfonts come from the CDN link instead; only small ones ride along.
  if (FONT_EXTENSIONS.has(extension) && statSync(resolved).size > FONT_BYTES_BEFORE_CDN_SWAP) return null;
  if (!isShippable(resolved)) return null;

  const flatName = assetFileName(resolved);
  assets.set(resolved, `assets/${flatName}`);

  // A reference with no directory part is a fragment the page joins to a base
  // path elsewhere (`{ img: "product-1.jpg" }`). Ship the file under that
  // exact name and leave the fragment alone; rewriting it would corrupt the
  // path the page builds. The prefix pass repoints the base instead.
  if (!ref.includes('/')) return ref;

  // `./` is required for module specifiers — an inlined ES module resolves a
  // bare `assets/x.mjs` as a package name and throws before the page runs. It
  // is wrong everywhere else: upstream builds interpolate their own base
  // (`${base}assets/hero.mp4`), and a second `./` in the middle breaks it.
  const isModuleSpecifier = extension === '.js' || extension === '.mjs';
  return `${isModuleSpecifier ? './' : ''}assets/${flatName}`;
}

/**
 * Rewrite every local asset reference in `source` to its planned path.
 *
 * Two reference shapes have to be covered. Markup and stylesheets use
 * `src=`/`href=`/`url()`; upstream scripts also name assets in plain string
 * literals (`{ src: "assets/img/g1.jpg" }`), and a gallery whose images are
 * declared in JS is common enough that missing them breaks real pages.
 * Matching bare string literals is safe because a reference is only rewritten
 * when it resolves to a real file with a known asset extension.
 */
function collectAssets(
  source: string,
  itemDir: string,
  baseDir: string,
  assets: Map<string, string>,
): string {
  const withAttributes = source.replace(
    /(src=|href=|srcset=|poster=|content=|url\()\s*(["']?)([^"')\s>]+)\2/g,
    (match, lead: string, quote: string, ref: string) => {
      const planned = planReference(ref, itemDir, baseDir, assets);
      if (planned === null) return match;
      return lead === 'url(' ? `url("${planned}"` : `${lead}${quote || '"'}${planned}${quote || '"'}`;
    },
  );

  // Path-shaped tokens anywhere in the document, delimited by what a path
  // cannot contain rather than by quotes. Two upstream habits rule quote
  // pairing out: minified bundles hold far too many quote characters for
  // left-to-right pairing to stay aligned, and template literals split a path
  // across an interpolation (`${base}assets/procure.svg`), leaving the tail
  // with no opening quote at all.
  const withLiterals = withAttributes.replace(
    /(?<![A-Za-z0-9_@\-./])(?:\.\/)?[A-Za-z0-9_@\-./]+\.(?:jpe?g|png|webp|gif|svg|avif|ico|mp4|webm|mov|css|js|mjs|woff2?)(?![A-Za-z0-9_-])/g,
    (ref) => planReference(ref, itemDir, baseDir, assets) ?? ref,
  );

  return withInterpolatedPrefixes(withLiterals, itemDir, baseDir, assets);
}

/**
 * Ship assets a page only names at runtime.
 *
 * Upstream galleries build their sources by interpolation — after minification
 * that leaves a bare prefix in the source (`"assets/img/product-"+n+".jpg"`).
 * No reference rewrite can see those files, so match the prefix instead: point
 * it at the flattened asset directory and ship every upstream file it covers.
 */
function withInterpolatedPrefixes(
  source: string,
  itemDir: string,
  baseDir: string,
  assets: Map<string, string>,
): string {
  return source.replace(
    // `}` opens and `$` closes the match so a template literal's own
    // interpolation boundaries count as delimiters, not just quotes.
    /(?<=["'`}])(?:\.\/)?(?:[A-Za-z0-9_@\-.]+\/)+[A-Za-z0-9_@\-.]*(?=["'`$])/g,
    (prefix) => {
      const cleaned = prefix.replace(/^\.?\//, '');
      const directory = path.dirname(cleaned);
      const stem = cleaned.endsWith('/') ? '' : path.basename(cleaned);
      const directoryPart = stem === '' ? cleaned : directory;

      const roots = [baseDir, itemDir, path.join(itemDir, 'public'), path.join(itemDir, 'dist')];
      const sourceDirectory = roots
        .map((root) => path.join(root, directoryPart))
        .find((candidate) => existsSync(candidate) && statSync(candidate).isDirectory());
      if (sourceDirectory === undefined) return prefix;

      const matched = readdirSync(sourceDirectory, { withFileTypes: true }).filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith(stem) &&
          ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
      );
      // A prefix that covers a whole media library is a false positive, not a
      // gallery; leave it alone rather than vendor an unbounded set.
      if (matched.length === 0 || matched.length > 40) return prefix;

      for (const entry of matched) {
        planReference(path.join(directoryPart, entry.name), itemDir, baseDir, assets);
      }
      // Flattened output, so only the base path moves; the interpolated tail
      // the page appends still resolves. Keep any leading `./` — dropping it
      // turns a module specifier into a bare package name.
      return `${prefix.startsWith('./') ? './' : ''}assets/${stem}`;
    },
  );
}

/**
 * Strip markup that still points at an asset this import did not ship. After
 * `collectAssets`, every reference the bake carries begins with `assets/`;
 * anything else with an asset extension can only 404 from the baked page.
 */
function dropDanglingReferences(html: string): string {
  const stillLocal = (ref: string): boolean =>
    isLocalRef(ref) &&
    !ref.replace(/^\.\//, '').startsWith('assets/') &&
    ASSET_EXTENSIONS.has(path.extname(ref.split(/[?#]/)[0] ?? '').toLowerCase());

  return html
    .replace(/<source\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*/g, (match, ref: string) =>
      stillLocal(ref) ? '' : match,
    )
    .replace(/(<(?:img|video)\b[^>]*?)\ssrc=["']([^"']+)["']/g, (match, lead: string, ref: string) =>
      stillLocal(ref) ? lead : match,
    )
    .replace(/\s*<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/g, (match, ref: string) =>
      stillLocal(ref) ? '' : match,
    )
    .replace(/\s*<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/g, (match, ref: string) =>
      stillLocal(ref) ? '' : match,
    )
    // A CSS rule pointing at an asset we did not ship falls back to whatever
    // the cascade already set, which beats a 404 on every page load.
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (match, _quote: string, ref: string) =>
      stillLocal(ref) ? 'none' : match,
    );
}

function inlineTag(html: string, pattern: RegExp, render: (file: string) => string | null): string {
  return html.replace(pattern, (match, ref: string) => render(ref) ?? match);
}

/** An inlined bundle can carry the literal `</script>` inside a string. */
function escapeForInlineScript(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script');
}

export function bakeItem(item: SourceItem): BakeResult {
  const assets = new Map<string, string>();
  const rewritten = new Map<string, string>();
  droppedAssets = [];
  assetNames.clear();
  claimedNames.clear();
  basenameIndex = indexItemFiles(item.dir);

  const isVite = item.kind === 'vite';
  const baseDir = isVite ? path.join(item.dir, 'dist') : item.dir;
  const entry = path.join(baseDir, 'index.html');
  if (!existsSync(entry)) throw new Error(`no built entry for ${item.id} (expected ${entry})`);

  let html = readFileSync(entry, 'utf8');
  const fontFamilies: string[] = [];

  // Font preloads point at vendored files this import does not carry; the
  // Google Fonts link added below replaces them.
  html = html.replace(/<link\b[^>]*\bas=["']font["'][^>]*>\s*/g, '');

  if (SERVER_RENDERED_SNAPSHOTS.has(item.id)) {
    html = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>\s*/g, '')
      .replace(/<link\b[^>]*\brel=["']modulepreload["'][^>]*>\s*/g, '');
  }

  const resolveRef = (ref: string, from: string): string | null => {
    if (!isLocalRef(ref)) return null;
    const cleaned = ref.replace(/^\.?\//, '').split(/[?#]/)[0]!;
    const file = path.join(from, cleaned);
    return existsSync(file) ? file : null;
  };

  /**
   * Inline one stylesheet, following `@import` chains. Upstream commonly keeps
   * its `@font-face` declarations in a nested `assets/fonts/fonts.css`; without
   * following the import, that file would be copied as an asset and its
   * relative font URLs would resolve against the wrong directory.
   */
  const inlineCss = (css: string, cssDir: string, seen: Set<string>): string => {
    const swapped = swapLocalFontsForCdn(css);
    fontFamilies.push(...swapped.families);

    const expanded = swapped.css.replace(
      /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?\s*;/g,
      (match, ref: string) => {
        const file = resolveRef(ref, cssDir);
        if (file === null || seen.has(file)) return match;
        seen.add(file);
        return inlineCss(readFileSync(file, 'utf8'), path.dirname(file), seen);
      },
    );

    return collectAssets(expanded, item.dir, cssDir, assets);
  };

  // Bundler output stays in files. A Vite chunk resolves its own assets and
  // lazy chunks against `import.meta.url`; inlining it into the document
  // silently rebases every one of those URLs onto the page instead.
  // Hand-written pages have no such dependency, so those still inline.
  if (!isVite) {
    // `rel` and `href` appear in either order upstream, so match the tag first
    // and read its attributes rather than pinning them to one sequence.
    html = html.replace(/<link\b([^>]*)>/g, (match, attributes: string) => {
      if (!/\brel=["']stylesheet["']/.test(attributes)) return match;
      const ref = /\bhref=["']([^"']+)["']/.exec(attributes)?.[1];
      const file = ref === undefined ? null : resolveRef(ref, baseDir);
      if (file === null) return match;
      return `<style>\n${inlineCss(readFileSync(file, 'utf8'), path.dirname(file), new Set([file]))}\n\t\t</style>`;
    });

    // `type` has to survive the move: upstream ships both classic scripts and
    // ES modules, and an inlined module without `type="module"` is a syntax
    // error.
    html = html.replace(
      /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/g,
      (match, before: string, ref: string, after: string) => {
        const file = resolveRef(ref, baseDir);
        if (file === null) return match;
        const attributes = `${before} ${after}`;
        const declaredType = /\btype=["']([^"']+)["']/.exec(attributes)?.[1];
        const source = readFileSync(file, 'utf8');
        const isModule = declaredType === 'module' || /\.mjs$/.test(ref);
        // Some scripts keep their file. A module resolves relative imports
        // against its own URL, and a self-locating library reads
        // `document.currentScript.src` to find sibling resources — an inline
        // script has neither, so `new URL("../../", script.src)` throws before
        // the page runs.
        if (isModule || /currentScript|import\.meta\.url/.test(source)) return match;
        return `<script${declaredType ? ` type="${declaredType}"` : ''}>\n${escapeForInlineScript(source)}\n\t\t</script>`;
      },
    );
  }

  // Styles already inline in the source document (the Lexington themes and a
  // few hand-written pages) still carry vendored font faces and image paths.
  html = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (_match, attributes: string, css: string) =>
    `<style${attributes}>${inlineCss(css, baseDir, new Set())}</style>`,
  );

  if (isVite) {
    // Mirror the build output instead of rewriting it. Every path a bundle
    // emits is already relative to `dist/`, and a chunk resolves its lazy
    // siblings, its imported media, and its public-directory files against
    // paths only it knows. Reproducing the directory verbatim keeps all of
    // them valid; flattening would break the ones no rewrite can see.
    // `dist/assets/` collapses into `assets/`, but any other build-output
    // directory moves one level down to get inside the servable subtree.
    // Code that referenced such a directory against the document
    // (`new URL('./spline/scene.splinecode', document.baseURI)`) has to follow
    // it. Vite's own `./assets/…` references already point at the right place
    // and must not be touched.
    const rootEntries = readdirSync(baseDir, { withFileTypes: true }).filter(
      (entry) => entry.name !== 'assets' && entry.name !== 'server' && entry.name !== 'index.html',
    );
    // A directory reference always carries its trailing slash. A
    // public-directory file appears either with an explicit `./` or, when the
    // page joins it to a base itself, as a bare quoted filename.
    const relocated = rootEntries.flatMap((entry) =>
      entry.isDirectory()
        ? [[`./${entry.name}/`, `./assets/${entry.name}/`] as const]
        : [
            [`./${entry.name}`, `./assets/${entry.name}`] as const,
            ...['"', "'", '`'].map(
              (quote) => [`${quote}${entry.name}${quote}`, `${quote}assets/${entry.name}${quote}`] as const,
            ),
          ],
    );

    const followRelocations = (text: string): string =>
      relocated.reduce((carry, [from, to]) => carry.replaceAll(from, to), text);

    html = followRelocations(html);

    for (const [source, relative] of mirrorBuildOutput(baseDir, SERVER_RENDERED_SNAPSHOTS.has(item.id))) {
      assets.set(source, relative);
      if (relative.endsWith('.css')) {
        const swapped = swapLocalFontsForCdn(readFileSync(source, 'utf8'));
        fontFamilies.push(...swapped.families);
        rewritten.set(relative, followRelocations(swapped.css));
      } else if (relative.endsWith('.js') || relative.endsWith('.mjs')) {
        if (relocated.length > 0) rewritten.set(relative, followRelocations(readFileSync(source, 'utf8')));
      }
    }
  } else {
    html = collectAssets(html, item.dir, baseDir, assets);

    // A shipped module imports its siblings by relative path from inside its
    // own file. Flattening puts those siblings in the same directory, so the
    // paths stay valid — but only once the siblings are shipped too.
    const pending = [...assets.keys()].filter((file) => CODE_EXTENSIONS.has(path.extname(file).toLowerCase()));
    const visited = new Set<string>();
    while (pending.length > 0) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      const before = new Set(assets.keys());
      collectAssets(readFileSync(file, 'utf8'), item.dir, path.dirname(file), assets);
      for (const added of assets.keys()) {
        if (!before.has(added) && CODE_EXTENSIONS.has(path.extname(added).toLowerCase())) pending.push(added);
      }
    }
  }

  html = dropDanglingReferences(html);

  const families = [...new Set(fontFamilies)];
  if (families.length > 0 && !html.includes('fonts.googleapis.com')) {
    html = html.replace(/<\/head>/, `${googleFontsLink(families)}\n\t</head>`);
  }

  return { html, assets, rewritten, fontFamilies: families, dropped: [...new Set(droppedAssets)].sort() };
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

function copyAsset(from: string, to: string): void {
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(optimisedSource(from), to);
}

function frontMatter(item: SourceItem, title: string, description: string): string {
  const meta = FAMILY_META[item.family];
  const triggers = deriveTriggers(title, item.family);
  const examplePrompt =
    `Build ${title} as a self-contained responsive page in this template's own visual system. ` +
    `Follow the build spec in this skill exactly — palette, typography, section order, and motion are part of the identity. ` +
    `Ask only for the missing essentials first: brand name, real copy, and any imagery to swap in.`;

  return [
    '---',
    `name: ${item.id}`,
    'description: |',
    `  ${description}`,
    'tags:',
    `  - "${meta.tag}"`,
    `  - "${item.family}"`,
    '  - "claude-directory"',
    'triggers:',
    ...triggers.map((trigger) => `  - ${JSON.stringify(trigger)}`),
    'od:',
    '  mode: prototype',
    '  platform: desktop',
    `  upstream: "${UPSTREAM_REPO}/tree/main/${item.relPath}"`,
    '  upstream_license: MIT',
    '  preview:',
    '    type: html',
    '    entry: example.html',
    '  design_system:',
    '    requires: false',
    `  category: "${meta.tag}"`,
    `  scenario: "${meta.scenario}"`,
    `  example_prompt: ${JSON.stringify(examplePrompt)}`,
    '---',
  ].join('\n');
}

function body(item: SourceItem, title: string, description: string, prompt: string | null): string {
  const meta = FAMILY_META[item.family];
  const multipageNote =
    item.kind === 'multipage'
      ? '\nThe upstream theme ships a full multi-page site. `example.html` is its home page; ' +
        'the remaining routes (about, blog, pricing, help centre, auth, and design-system pages) ' +
        'stay upstream — rebuild them from the build spec when a project needs them.\n'
      : '';

  return `
# ${title}

> ${meta.label} vendored from the MIT-licensed \`pulkitxm/claude-directory\` gallery.

${description}
${multipageNote}
## Workflow

1. **Clone \`example.html\`** into the user's workspace as the working file.
2. **Replace placeholder content** with the user's real brand name, headlines,
   body copy, numbers, and imagery. Match existing image dimensions when
   swapping assets.
3. **Preserve the design system.** The palette, type scale, spacing rhythm, and
   motion in the build spec below are the identity — do not substitute fonts,
   recolour the palette, or strip decorative elements.
4. **Extend by duplicating sections**, never by importing a layout from another
   template. If a section is missing, design it from scratch in this template's
   own vocabulary.
5. **Keep motion accessible.** Every animation must stay behind
   \`prefers-reduced-motion\`, as the build spec requires.

## Output contract

Emit between \`<artifact>\` tags:

\`\`\`
<artifact identifier="${item.id}" type="text/html" title="${title.replace(/"/g, "'")}">
<!doctype html>
<html>...</html>
</artifact>
\`\`\`

${prompt ? `## Build spec\n\nThe upstream prompt that produced this design, verbatim.\n\n${prompt.trim()}\n` : ''}
## Source & license

Vendored from MIT-licensed
[\`pulkitxm/claude-directory\`](${UPSTREAM_REPO}/tree/main/${item.relPath}).
The upstream MIT licence text ships in this template at [\`LICENSE\`](./LICENSE) and
must be redistributed alongside any copy of \`example.html\` or \`assets/\`.

Webfonts and full-resolution imagery are **not** vendored: local \`@font-face\`
rules are served from the Google Fonts CDN and referenced images are
downscaled. Fetch the upstream folder for the original assets.
`;
}

export function emitTemplate(item: SourceItem, sourceRoot: string, licenseText: string): { bytes: number } {
  const readme = readIfPresent(path.join(item.dir, 'README.md')) ?? `# ${item.slug}`;
  const { title, description } = parseReadme(readme);
  const prompt = readIfPresent(path.join(item.dir, 'prompt.md'));
  const baked = bakeItem(item);

  const target = path.join(DESIGN_TEMPLATES, item.id);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });

  writeFileSync(path.join(target, 'example.html'), baked.html);
  writeFileSync(path.join(target, 'LICENSE'), licenseText);
  writeFileSync(
    path.join(target, 'SKILL.md'),
    `${frontMatter(item, title, description)}\n${body(item, title, description, prompt)}`,
  );
  writeFileSync(
    path.join(target, 'template.json'),
    `${JSON.stringify(
      {
        slug: item.slug,
        name: title,
        family: item.family,
        kind: item.kind,
        cdn_fonts: baked.fontFamilies,
        // Upstream media no re-encode could bring under the size ceiling. The
        // page still renders; these specific assets do not load.
        dropped_assets: baked.dropped,
        // `pnpm guard` reads this field to decide whether bundler output under
        // this template's `assets/` is vendored rather than project-owned.
        vendored_from: 'pulkitxm/claude-directory',
        source: `${UPSTREAM_REPO}/tree/main/${item.relPath}`,
        source_license: 'MIT',
      },
      null,
      2,
    )}\n`,
  );

  for (const [from, rel] of baked.assets) {
    const replacement = baked.rewritten.get(rel);
    if (replacement === undefined) {
      copyAsset(from, path.join(target, rel));
    } else {
      mkdirSync(path.dirname(path.join(target, rel)), { recursive: true });
      writeFileSync(path.join(target, rel), replacement);
    }
  }

  let bytes = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else bytes += statSync(full).size;
    }
  };
  walk(target);
  void sourceRoot;
  return { bytes };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  const sourceRoot = process.argv[2];
  if (!sourceRoot) {
    console.error('usage: import-claude-directory.ts <path-to-claude-directory-checkout> [idFilter]');
    process.exit(1);
  }
  const filter = process.argv[3];
  const licenseText = readFileSync(path.join(sourceRoot, 'LICENSE'), 'utf8');

  const items = discoverItems(sourceRoot).filter((item) => !filter || item.id.includes(filter));
  const existing = new Set(directoriesIn(DESIGN_TEMPLATES));

  let imported = 0;
  let skipped = 0;
  let totalBytes = 0;

  for (const item of items) {
    if (existing.has(item.id) && !readFileSync(path.join(DESIGN_TEMPLATES, item.id, 'template.json'), 'utf8').includes('claude-directory')) {
      console.log(`collide ${item.id} — an unrelated template already owns this id`);
      skipped += 1;
      continue;
    }
    try {
      const { bytes } = emitTemplate(item, sourceRoot, licenseText);
      totalBytes += bytes;
      imported += 1;
      console.log(`ok      ${item.id} (${item.kind}, ${(bytes / 1024).toFixed(0)}KB)`);
    } catch (error) {
      skipped += 1;
      console.log(`skip    ${item.id}: ${(error as Error).message}`);
    }
  }

  console.log(`\n${imported} imported, ${skipped} skipped, ${(totalBytes / 1024 / 1024).toFixed(1)}MB total`);
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  main();
}
