import { createHash } from 'node:crypto';

import { fetchExternalBrandAsset } from './safe-fetch.js';

export type FontFaceRef = {
  family: string;
  weight: string;
  style: string;
  url: string;
  format: string;
  unicodeRange?: string;
  subset?: string;
};

export type FontFaceCssFile = {
  family: string;
  weight: string;
  style: string;
  file: string;
  format: string;
  unicodeRange?: string;
};

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;

export const WEBFONT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const FORMAT_RANK: Record<string, number> = {
  woff2: 0,
  woff: 1,
  opentype: 2,
  truetype: 3,
};

const FORMAT_EXT: Record<string, string> = {
  woff2: '.woff2',
  woff: '.woff',
  opentype: '.otf',
  truetype: '.ttf',
};

function normalizeFormat(value: string): string | null {
  const format = value.trim().toLowerCase();
  if (format.startsWith('woff2')) return 'woff2';
  if (format === 'woff') return 'woff';
  if (format === 'opentype' || format === 'otf') return 'opentype';
  if (format === 'truetype' || format === 'ttf') return 'truetype';
  return null;
}

function formatFromUrl(url: string): string | null {
  const match = /\.(woff2|woff|otf|ttf)(?:[?#]|$)/i.exec(url);
  return match?.[1] ? normalizeFormat(match[1]) : null;
}

function immediateSubsetComment(css: string, fontFaceIndex: number): string | undefined {
  const prefix = css.slice(0, fontFaceIndex);
  const match = /\/\*\s*([^*]+?)\s*\*\/\s*$/.exec(prefix);
  if (!match) return undefined;
  const value = match[1]?.trim();
  return value && /^[a-z0-9][a-z0-9_-]*$/i.test(value) ? value.toLowerCase() : undefined;
}

/** Parse every usable @font-face rule and retain provider subset comments. Pure. */
export function parseWebfontFaces(css: string, baseUrl: string): FontFaceRef[] {
  const out: FontFaceRef[] = [];
  for (const block of css.matchAll(/@font-face\s*\{([^}]+)\}/gi)) {
    const body = block[1];
    if (body == null) continue;
    const family = /font-family\s*:\s*["']?([^;"'}]+?)["']?\s*(?:;|$)/i.exec(body)?.[1]?.trim();
    if (!family || !/src\s*:/i.test(body)) continue;
    const weight = /font-weight\s*:\s*([^;}]+)/i.exec(body)?.[1]?.trim() ?? '400';
    const style = /font-style\s*:\s*([^;}]+)/i.exec(body)?.[1]?.trim() ?? 'normal';
    const unicodeRange = /unicode-range\s*:\s*([^;}]+)/i.exec(body)?.[1]?.trim();

    let best: { url: string; format: string; rank: number } | null = null;
    for (const match of body.matchAll(
      /url\(\s*["']?([^"')]+)["']?\s*\)(?:\s*format\(\s*["']?([^"')]+)["']?\s*\))?/gi,
    )) {
      const rawUrl = match[1]?.trim();
      if (!rawUrl) continue;
      const format = normalizeFormat(match[2] ?? '') ?? formatFromUrl(rawUrl);
      if (!format) continue;
      const rank = FORMAT_RANK[format];
      if (rank == null || (best && best.rank <= rank)) continue;
      if (rawUrl.startsWith('data:')) {
        best = { url: rawUrl, format, rank };
        continue;
      }
      try {
        best = { url: new URL(rawUrl, baseUrl).href, format, rank };
      } catch {
        // Ignore only this unresolvable source; another src candidate may work.
      }
    }
    if (!best) continue;
    const subsetComment = immediateSubsetComment(css, block.index);
    const subset = subsetComment?.replace(/[^a-z0-9]+/gi, '').toLowerCase()
      === family.replace(/[^a-z0-9]+/gi, '').toLowerCase()
      ? undefined
      : subsetComment;
    out.push({
      family,
      weight,
      style,
      url: best.url,
      format: best.format,
      ...(unicodeRange ? { unicodeRange } : {}),
      ...(subset ? { subset } : {}),
    });
  }
  return out;
}

function fontMagicOk(buffer: Buffer, format: string): boolean {
  if (buffer.length < 8) return false;
  const tag = buffer.toString('latin1', 0, 4);
  if (format === 'woff2') return tag === 'wOF2';
  if (format === 'woff') return tag === 'wOFF';
  if (format === 'opentype') return tag === 'OTTO';
  if (format === 'truetype') return buffer.readUInt32BE(0) === 0x00010000 || tag === 'true';
  return false;
}

function decodeDataFont(url: string): Buffer {
  const match = /^data:[^,;]*(;base64)?,([\s\S]*)$/.exec(url);
  if (!match || match[2] == null) throw new Error('invalid data font URL');
  try {
    return match[1]
      ? Buffer.from(match[2], 'base64')
      : Buffer.from(decodeURIComponent(match[2]), 'utf8');
  } catch (error) {
    throw new Error(`could not decode data font: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function fetchWebfontStylesheet(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const response = await fetchExternalBrandAsset(url, {
    headers: { 'User-Agent': WEBFONT_USER_AGENT, Accept: 'text/css,*/*;q=0.1' },
    signal: AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`font stylesheet returned HTTP ${response.status}: ${url}`);
  return response.text();
}

export async function fetchWebfontFile(
  ref: FontFaceRef,
  opts: { referer?: string; timeoutMs?: number; maxBytes?: number } = {},
): Promise<Buffer> {
  const maxBytes = opts.maxBytes ?? MAX_FILE_BYTES;
  let buffer: Buffer;
  if (ref.url.startsWith('data:')) {
    buffer = decodeDataFont(ref.url);
  } else {
    const response = await fetchExternalBrandAsset(ref.url, {
      headers: {
        'User-Agent': WEBFONT_USER_AGENT,
        Accept: '*/*',
        'Sec-Fetch-Dest': 'font',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
        ...(opts.referer ? { Referer: opts.referer } : {}),
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`font file returned HTTP ${response.status}: ${ref.url}`);
    buffer = Buffer.from(await response.arrayBuffer());
  }
  if (buffer.length === 0) throw new Error(`font file was empty: ${ref.url}`);
  if (buffer.length > maxBytes) {
    throw new Error(`font file exceeded ${maxBytes} bytes (${buffer.length}): ${ref.url}`);
  }
  if (!fontMagicOk(buffer, ref.format)) {
    throw new Error(`font file did not match declared ${ref.format} format: ${ref.url}`);
  }
  return buffer;
}

export function webfontFormatExtension(format: string): string {
  return FORMAT_EXT[format] ?? '.woff2';
}

export function webfontFileSlug(ref: FontFaceRef): string {
  const family = ref.family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'font';
  const weight = ref.weight.replace(/\s+/g, '-').replace(/[^a-z0-9.-]+/gi, '');
  const style = ref.style === 'normal' ? '' : `-${ref.style.replace(/[^a-z]/gi, '')}`;
  const subset = ref.subset ? `-${ref.subset.replace(/[^a-z0-9-]/gi, '')}` : '';
  const identity = createHash('sha256').update(`${ref.url}|${ref.unicodeRange ?? ''}`).digest('hex').slice(0, 10);
  return `${family}-${weight}${style}${subset}-${identity}`;
}

function isSafeFontWeight(value: string): boolean {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 1 || parts.length > 2) return false;
  const weights = parts.map((part) => (/^\d{1,4}$/.test(part) ? Number(part) : Number.NaN));
  if (weights.some((weight) => !Number.isInteger(weight) || weight < 1 || weight > 1000)) {
    return false;
  }
  return weights.length === 1 || weights[0]! <= weights[1]!;
}

function isSafeFontStyle(value: string): boolean {
  return /^(?:normal|italic|oblique(?:\s+[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|grad|rad|turn))?)$/i.test(
    value.trim(),
  );
}

function isSafeUnicodeRange(value: string): boolean {
  const tokens = value.split(',').map((token) => token.trim());
  if (tokens.length === 0 || tokens.some((token) => token.length === 0)) return false;
  return tokens.every((token) => {
    const match = /^U\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(token);
    if (!match?.[1]) return false;
    const start = match[1];
    const end = match[2];
    if (end) {
      if (start.includes('?')) return false;
      const first = Number.parseInt(start, 16);
      const last = Number.parseInt(end, 16);
      return first <= last && last <= 0x10ffff;
    }
    if (start.includes('?')) {
      if (!/^[0-9a-f]*\?+$/i.test(start)) return false;
      return Number.parseInt(start.replace(/\?/g, 'f'), 16) <= 0x10ffff;
    }
    return Number.parseInt(start, 16) <= 0x10ffff;
  });
}

function hasSafeFontFaceDescriptors(file: FontFaceCssFile): boolean {
  return (
    isSafeFontWeight(file.weight) &&
    isSafeFontStyle(file.style) &&
    (file.unicodeRange == null || isSafeUnicodeRange(file.unicodeRange))
  );
}

/** Re-emit @font-face rules with URLs rooted at `urlPrefix`. */
export function fontFaceCss(files: readonly FontFaceCssFile[], urlPrefix: string): string {
  return files
    .filter(hasSafeFontFaceDescriptors)
    .map((file) =>
      [
        '@font-face {',
        `  font-family: "${file.family.replace(/"/g, '')}";`,
        `  src: url("${urlPrefix}${file.file}") format("${file.format}");`,
        `  font-weight: ${file.weight};`,
        `  font-style: ${file.style};`,
        ...(file.unicodeRange ? [`  unicode-range: ${file.unicodeRange};`] : []),
        '  font-display: swap;',
        '}',
      ].join('\n'),
    )
    .join('\n');
}
