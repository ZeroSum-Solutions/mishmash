import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  fetchWebfontFile,
  fetchWebfontStylesheet,
  fontFaceCss,
  parseWebfontFaces,
  webfontFileSlug,
  webfontFormatExtension,
  type FontFaceRef,
} from '../apps/daemon/src/brands/webfonts.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const catalogueRoot = path.join(repoRoot, 'design-templates');
const reportPath = path.join(repoRoot, '.tmp', 'vendor-fonts-report.json');
const previewFontMaxBytes = 8 * 1024 * 1024;
const textExtensions = new Set(['.css', '.html', '.htm']);
const fontStylesheetHosts = new Set(['fonts.googleapis.com', 'rsms.me', 'api.fontshare.com']);
const fontResourceHosts = new Set([
  ...fontStylesheetHosts,
  'fonts.gstatic.com',
  'cdn.fontshare.com',
]);

type TemplateSource = { file: string; content: string; stylesheetUrls: string[] };
type Failure = { template: string; family: string; url: string; reason: string };
type DroppedSubset = {
  template: string;
  family: string;
  weight: string;
  style: string;
  subset: string;
  unicodeRange?: string;
  url: string;
  reason: string;
};
type LocalFont = {
  family: string;
  weight: string;
  style: string;
  file: string;
  format: string;
  sourceUrl: string;
  bytes: number;
  unicodeRange?: string;
};
type RequestedFamily = { alias: string; spec: string };
type FamilyFallback = { provider: 'fontshare' | 'google' | 'rsms'; canonicalFamily: string; slug?: string };
type LoadedFace = { face: FontFaceRef; stylesheetUrl: string };

const familyFallbacks = new Map<string, FamilyFallback>([
  ['clashgrotesk', { provider: 'fontshare', canonicalFamily: 'Clash Grotesk', slug: 'clash-grotesk' }],
  ['satoshi', { provider: 'fontshare', canonicalFamily: 'Satoshi', slug: 'satoshi' }],
  ['clashdisplay', { provider: 'fontshare', canonicalFamily: 'Clash Display', slug: 'clash-display' }],
  ['generalsans', { provider: 'fontshare', canonicalFamily: 'General Sans', slug: 'general-sans' }],
  ['switzer', { provider: 'fontshare', canonicalFamily: 'Switzer', slug: 'switzer' }],
  ['gambarino', { provider: 'fontshare', canonicalFamily: 'Gambarino', slug: 'gambarino' }],
  ['intervariable', { provider: 'rsms', canonicalFamily: 'InterVariable' }],
  ['bricolage', { provider: 'google', canonicalFamily: 'Bricolage Grotesque' }],
  ['intertight', { provider: 'google', canonicalFamily: 'Inter Tight' }],
  ['jetmono', { provider: 'google', canonicalFamily: 'JetBrains Mono' }],
  ['geistsans', { provider: 'google', canonicalFamily: 'Geist' }],
]);

const stylesheetCache = new Map<string, Promise<string>>();
const fontCache = new Map<string, Promise<Buffer>>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function decodeHtmlUrl(value: string): string {
  return value.replace(/&amp;/gi, '&').replace(/&#38;/g, '&');
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function remoteUrl(value: string): URL | null {
  try {
    const decoded = decodeHtmlUrl(value);
    const url = new URL(decoded.startsWith('//') ? `https:${decoded}` : decoded);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function isFontStylesheetUrl(value: string): boolean {
  const url = remoteUrl(value);
  return url != null && fontStylesheetHosts.has(url.hostname.toLowerCase());
}

function isFontResourceUrl(value: string): boolean {
  const url = remoteUrl(value);
  return url != null && fontResourceHosts.has(url.hostname.toLowerCase());
}

function cssImportMatches(source: string): Array<{ raw: string; url: string }> {
  const matches: Array<{ raw: string; url: string }> = [];
  const pattern = /@import\s*(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^'"\s;)]+))\s*\)?\s*;?/gi;
  for (const match of source.matchAll(pattern)) {
    const url = match[1] ?? match[2] ?? match[3];
    if (url && isFontStylesheetUrl(url)) matches.push({ raw: match[0], url: decodeHtmlUrl(url) });
  }
  return matches;
}

function stylesheetUrls(source: string): string[] {
  const urls = cssImportMatches(source).map((match) => match.url);
  for (const match of source.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const href = attribute(tag, 'href');
    const rel = attribute(tag, 'rel')?.toLowerCase().split(/\s+/) ?? [];
    if (href && rel.includes('stylesheet') && isFontStylesheetUrl(href)) {
      urls.push(decodeHtmlUrl(href));
    }
  }
  return [...new Set(urls)];
}

async function listTextFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'fonts') continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listTextFiles(file)));
    else if (entry.isFile() && textExtensions.has(path.extname(entry.name).toLowerCase())) files.push(file);
  }
  return files;
}

async function readTemplateSources(templateDir: string): Promise<TemplateSource[]> {
  const sources: TemplateSource[] = [];
  for (const file of await listTextFiles(templateDir)) {
    const content = await fs.readFile(file, 'utf8');
    sources.push({ file, content, stylesheetUrls: stylesheetUrls(content) });
  }
  return sources;
}

function normalizedFamily(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function requestedFamilySpecs(urlValue: string): RequestedFamily[] {
  const url = new URL(urlValue);
  if (url.hostname === 'fonts.googleapis.com') {
    return url.searchParams.getAll('family').flatMap((spec) => {
      const alias = spec.split(':')[0]?.trim();
      return alias ? [{ alias, spec }] : [];
    });
  }
  if (url.hostname === 'api.fontshare.com') {
    return url.searchParams.getAll('f[]').flatMap((value) => value.split(',')).map((value) => {
      const alias = value.split('@')[0] ?? value;
      return { alias, spec: alias };
    });
  }
  if (url.hostname === 'rsms.me') return [{ alias: 'Inter', spec: 'Inter' }];
  return [{ alias: url.hostname, spec: url.hostname }];
}

function fallbackRequest(requested: RequestedFamily): { url: string; canonicalFamily: string } {
  const fallback = familyFallbacks.get(normalizedFamily(requested.alias));
  const canonicalFamily = fallback?.canonicalFamily ?? requested.alias;
  if (fallback?.provider === 'fontshare') {
    return {
      url: `https://api.fontshare.com/v2/css?f[]=${encodeURIComponent(fallback.slug!)}&display=swap`,
      canonicalFamily,
    };
  }
  if (fallback?.provider === 'rsms') {
    return { url: 'https://rsms.me/inter/inter.css', canonicalFamily };
  }
  const suffixIndex = requested.spec.indexOf(':');
  const suffix = suffixIndex === -1 ? '' : requested.spec.slice(suffixIndex);
  const url = new URL('https://fonts.googleapis.com/css2');
  url.searchParams.append('family', `${canonicalFamily}${suffix}`);
  url.searchParams.set('display', 'swap');
  return { url: url.href, canonicalFamily };
}

function facesForRequestedAlias(
  parsed: FontFaceRef[],
  requested: RequestedFamily,
  canonicalFamily: string,
): FontFaceRef[] {
  const matches = parsed.filter((face) => normalizedFamily(face.family) === normalizedFamily(canonicalFamily));
  if (matches.length === 0) return [];
  return matches.map((face) => ({ ...face, family: requested.alias }));
}

function subsetIdentity(face: FontFaceRef): string {
  return face.subset ?? face.unicodeRange ?? 'unbounded';
}

function selectFaces(template: string, faces: FontFaceRef[], dropped: DroppedSubset[]): FontFaceRef[] {
  const subsetCounts = new Map<string, Set<string>>();
  for (const face of faces) {
    const key = face.family.toLowerCase();
    const values = subsetCounts.get(key) ?? new Set<string>();
    values.add(subsetIdentity(face));
    subsetCounts.set(key, values);
  }

  return faces.filter((face) => {
    const isManySubsetFamily = (subsetCounts.get(face.family.toLowerCase())?.size ?? 0) > 20;
    const keep =
      isManySubsetFamily
      || face.subset == null
      || face.subset === 'fallback'
      || face.subset === 'latin'
      || face.subset === 'latin-ext';
    if (!keep) {
      const item: DroppedSubset = {
        template,
        family: face.family,
        weight: face.weight,
        style: face.style,
        subset: face.subset ?? subsetIdentity(face),
        ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
        url: face.url,
        reason: 'non-CJK policy keeps latin and latin-ext only',
      };
      dropped.push(item);
      process.stdout.write(
        `DROP ${template}: ${face.family} ${face.weight} ${face.style} subset=${item.subset} reason=${item.reason}\n`,
      );
    }
    return keep;
  });
}

function uniqueFaces(faces: FontFaceRef[]): FontFaceRef[] {
  const seen = new Set<string>();
  return faces.filter((face) => {
    const key = [face.family, face.weight, face.style, face.url, face.unicodeRange ?? ''].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function mapLimit<T, U>(items: T[], limit: number, fn: (item: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function cachedStylesheet(url: string): Promise<string> {
  const cached = stylesheetCache.get(url);
  if (cached) return cached;
  const request = fetchWebfontStylesheet(url);
  stylesheetCache.set(url, request);
  return request;
}

async function loadStylesheetFaces(
  template: string,
  url: string,
  failures: Failure[],
): Promise<LoadedFace[]> {
  try {
    const css = await cachedStylesheet(url);
    const parsed = parseWebfontFaces(css, url);
    if (parsed.length === 0) throw new Error(`stylesheet contained no usable @font-face rules: ${url}`);
    return parsed.map((face) => ({ face, stylesheetUrl: url }));
  } catch (directError) {
    const parsedUrl = new URL(url);
    const requested = requestedFamilySpecs(url);
    if (parsedUrl.hostname !== 'fonts.googleapis.com') {
      for (const family of requested) {
        const item = { template, family: family.alias, url, reason: errorMessage(directError) };
        failures.push(item);
        process.stderr.write(`FAIL ${template}: ${family.alias}: ${item.reason}\n`);
      }
      return [];
    }

    const loaded: LoadedFace[] = [];
    for (const family of requested) {
      const fallback = fallbackRequest(family);
      try {
        const css = await cachedStylesheet(fallback.url);
        const parsed = parseWebfontFaces(css, fallback.url);
        const aliased = facesForRequestedAlias(parsed, family, fallback.canonicalFamily);
        if (aliased.length === 0) {
          throw new Error(`fallback contained no ${fallback.canonicalFamily} @font-face rules`);
        }
        process.stdout.write(
          `RETRY ${template}: ${family.alias} -> ${fallback.canonicalFamily} via ${new URL(fallback.url).hostname}\n`,
        );
        loaded.push(...aliased.map((face) => ({ face, stylesheetUrl: fallback.url })));
      } catch (fallbackError) {
        const item = {
          template,
          family: family.alias,
          url: fallback.url,
          reason: `direct request failed: ${errorMessage(directError)}; fallback failed: ${errorMessage(fallbackError)}`,
        };
        failures.push(item);
        process.stderr.write(`FAIL ${template}: ${family.alias}: ${item.reason}\n`);
      }
    }
    return loaded;
  }
}

function cachedFont(face: FontFaceRef, referer: string): Promise<Buffer> {
  const cached = fontCache.get(face.url);
  if (cached) return cached;
  const request = fetchWebfontFile(face, { referer, maxBytes: previewFontMaxBytes });
  fontCache.set(face.url, request);
  return request;
}

function localStylesheetHref(templateDir: string, sourceFile: string): string {
  return path.relative(path.dirname(sourceFile), path.join(templateDir, 'fonts', 'fonts.css')).split(path.sep).join('/');
}

function rewriteSource(source: TemplateSource, templateDir: string): string {
  const href = localStylesheetHref(templateDir, source.file);
  let insertedLink = false;
  let content = source.content.replace(/<link\b[^>]*>/gi, (tag) => {
    const tagHref = attribute(tag, 'href');
    const rel = attribute(tag, 'rel')?.toLowerCase().split(/\s+/) ?? [];
    if (!tagHref || !isFontResourceUrl(tagHref)) return tag;
    if (rel.includes('preconnect') || rel.includes('dns-prefetch')) return '';
    if (rel.includes('stylesheet') && isFontStylesheetUrl(tagHref)) {
      if (insertedLink) return '';
      insertedLink = true;
      return `<link rel="stylesheet" href="${href}">`;
    }
    return tag;
  });

  let insertedImport = false;
  content = content.replace(
    /@import\s*(?:url\(\s*)?(?:"([^"]+)"|'([^']+)'|([^'"\s;)]+))\s*\)?\s*;?/gi,
    (raw, doubleQuoted: string | undefined, singleQuoted: string | undefined, bare: string | undefined) => {
      const url = doubleQuoted ?? singleQuoted ?? bare;
      if (!url || !isFontStylesheetUrl(url)) return raw;
      if (insertedImport || insertedLink) return '';
      insertedImport = true;
      return `@import url("${href}");`;
    },
  );
  return content.replace(/^[\t ]+$/gm, '');
}

async function vendorTemplate(
  template: string,
  failures: Failure[],
  dropped: DroppedSubset[],
): Promise<{ families: string[]; files: number; bytes: number } | null> {
  const templateDir = path.join(catalogueRoot, template);
  const sources = await readTemplateSources(templateDir);
  const urls = [...new Set(sources.flatMap((source) => source.stylesheetUrls))];
  if (urls.length === 0) {
    let cleaned = 0;
    for (const source of sources) {
      const rewritten = rewriteSource(source, templateDir);
      if (rewritten === source.content) continue;
      await fs.writeFile(source.file, rewritten, 'utf8');
      cleaned += 1;
    }
    if (cleaned > 0) process.stdout.write(`CLEANED ${template}: orphan font-host preconnects in ${cleaned} files\n`);
    return null;
  }

  const faces: FontFaceRef[] = [];
  const stylesheetByFaceUrl = new Map<string, string>();
  let failed = false;
  for (const url of urls) {
    const failureCount = failures.length;
    const loaded = await loadStylesheetFaces(template, url, failures);
    if (failures.length > failureCount) failed = true;
    for (const item of loaded) {
      faces.push(item.face);
      stylesheetByFaceUrl.set(item.face.url, item.stylesheetUrl);
    }
  }

  const selected = uniqueFaces(selectFaces(template, faces, dropped));
  const selectedFamilies = new Set(selected.map((face) => face.family.toLowerCase()));
  for (const family of new Set(faces.map((face) => face.family))) {
    if (selectedFamilies.has(family.toLowerCase())) continue;
    failed = true;
    const item = {
      template,
      family,
      url: urls.join(', '),
      reason: 'family had no latin or latin-ext face after subset filtering',
    };
    failures.push(item);
    process.stderr.write(`FAIL ${template}: ${family}: ${item.reason}\n`);
  }
  const downloaded = await mapLimit(selected, 8, async (face) => {
    try {
      const buffer = await cachedFont(face, stylesheetByFaceUrl.get(face.url) ?? face.url);
      return { face, buffer };
    } catch (error) {
      failed = true;
      const item = { template, family: face.family, url: face.url, reason: errorMessage(error) };
      failures.push(item);
      process.stderr.write(`FAIL ${template}: ${face.family}: ${item.reason}\n`);
      return null;
    }
  });
  if (failed || downloaded.some((item) => item == null)) {
    process.stderr.write(`SKIP ${template}: remote sources left unchanged because at least one required font failed\n`);
    return { families: [], files: 0, bytes: 0 };
  }

  const localFonts: LocalFont[] = downloaded.flatMap((item) => {
    if (!item) return [];
    const { face, buffer } = item;
    return [{
      family: face.family,
      weight: face.weight,
      style: face.style,
      file: `${webfontFileSlug(face)}${webfontFormatExtension(face.format)}`,
      format: face.format,
      sourceUrl: face.url,
      bytes: buffer.length,
      ...(face.unicodeRange ? { unicodeRange: face.unicodeRange } : {}),
    }];
  });
  const fontsDir = path.join(templateDir, 'fonts');
  await fs.mkdir(fontsDir, { recursive: true });
  for (const [index, item] of downloaded.entries()) {
    if (item) await fs.writeFile(path.join(fontsDir, localFonts[index]!.file), item.buffer);
  }
  await fs.writeFile(
    path.join(fontsDir, 'fonts.css'),
    `${fontFaceCss(localFonts, './').trimEnd()}\n`,
    'utf8',
  );
  for (const source of sources) {
    const rewritten = rewriteSource(source, templateDir);
    if (rewritten !== source.content) await fs.writeFile(source.file, rewritten, 'utf8');
  }
  const families = [...new Set(localFonts.map((font) => font.family))].sort();
  const bytes = localFonts.reduce((total, font) => total + font.bytes, 0);
  process.stdout.write(`VENDORED ${template}: ${families.join(', ')} (${localFonts.length} files, ${bytes} bytes)\n`);
  return { families, files: localFonts.length, bytes };
}

async function main(): Promise<void> {
  const entries = (await fs.readdir(catalogueRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort();
  const failures: Failure[] = [];
  const droppedSubsets: DroppedSubset[] = [];
  const families = new Set<string>();
  let templatesWithRemoteFonts = 0;
  let templatesVendored = 0;
  let fontFiles = 0;
  let fontBytes = 0;
  for (const template of entries) {
    const result = await vendorTemplate(template, failures, droppedSubsets);
    if (result == null) continue;
    templatesWithRemoteFonts += 1;
    if (result.files > 0) templatesVendored += 1;
    for (const family of result.families) families.add(family);
    fontFiles += result.files;
    fontBytes += result.bytes;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    catalogueRoot,
    templatesScanned: entries.length,
    templatesWithRemoteFonts,
    templatesVendored,
    fontFiles,
    fontBytes,
    familiesVendored: [...families].sort(),
    failures,
    droppedSubsets,
  };
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`REPORT ${reportPath}\n`);
  process.stdout.write(
    `SUMMARY templates=${templatesVendored}/${templatesWithRemoteFonts} families=${families.size} files=${fontFiles} bytes=${fontBytes} failures=${failures.length} dropped=${droppedSubsets.length}\n`,
  );
  if (failures.length > 0) process.exitCode = 1;
}

await main();
