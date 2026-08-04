// Transitive content-hash computation for cover invalidation (S4-4 / C4-3 /
// C4-4). A cover must regenerate when the rendered entry HTML *or any of its
// linked local CSS, image, or font files* changes -- hashing index.html
// alone serves a stale cover forever after a styles.css edit. The hash is
// content-driven (sha256 of file bytes), never mtime-driven: touching a file
// without changing its bytes must never change the hash, and changing bytes
// while an mtime is pinned to its old value must always change it.
//
// Local-only by design (S4-5 hard constraint): a reference is only followed
// when it resolves to a file inside the project directory. Remote URLs,
// data: URIs, and protocol-relative references are never fetched -- this
// module never performs network I/O.

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';

/** Safety bound on how many files a single transitive walk will hash. */
const MAX_TRANSITIVE_FILES = 300;

export interface TransitiveHashResult {
  /** Full sha256 hex digest (64 chars, always well over the >=8 char contract minimum). */
  sourceHash: string;
  /** Project-root-relative paths that contributed to the hash, sorted. */
  files: string[];
}

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

function stripQueryHash(ref: string): string {
  const idx = ref.search(/[?#]/);
  return idx === -1 ? ref : ref.slice(0, idx);
}

/** True when `ref` is a same-project-local reference this module should
 * follow: not a remote/absolute URL, not a data: URI, not an in-page anchor. */
function isLocalRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return false;
  if (trimmed.startsWith('//')) return false; // protocol-relative -- remote
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false; // has a URI scheme (http:, https:, data:, mailto:, ...)
  return true;
}

/** Resolves a reference found inside `referrerRelPath` to a project-root-relative path. */
function resolveRef(referrerRelPath: string, ref: string): string {
  const clean = stripQueryHash(ref);
  if (clean.startsWith('/')) return clean.replace(/^\/+/, '');
  return path.normalize(path.join(path.dirname(referrerRelPath), clean));
}

function extractCssUrls(css: string): string[] {
  const out: string[] = [];
  const re = new RegExp(CSS_URL_RE.source, CSS_URL_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    const ref = match[2];
    if (ref) out.push(ref);
  }
  return out;
}

function extractHtmlLocalRefs(html: string): string[] {
  const $ = load(html);
  const refs: string[] = [];
  const pushAttr = (selector: string, attr: string) => {
    $(selector).each((_, el) => {
      const value = $(el).attr(attr);
      if (value) refs.push(value);
    });
  };
  pushAttr('link[rel="stylesheet"]', 'href');
  pushAttr('link[rel="icon"]', 'href');
  pushAttr('link[rel="shortcut icon"]', 'href');
  pushAttr('link[rel="apple-touch-icon"]', 'href');
  pushAttr('script[src]', 'src');
  pushAttr('img[src]', 'src');
  pushAttr('source[src]', 'src');
  pushAttr('video[src]', 'src');
  pushAttr('audio[src]', 'src');
  $('[style]').each((_, el) => {
    const style = $(el).attr('style');
    if (style) refs.push(...extractCssUrls(style));
  });
  $('style').each((_, el) => {
    refs.push(...extractCssUrls($(el).text()));
  });
  return refs;
}

async function safeReadFile(absPath: string, projectRootAbs: string): Promise<Buffer | null> {
  try {
    const resolved = path.resolve(absPath);
    // Containment guard: never follow a reference outside the project root
    // (defense in depth on top of the local-only scheme filter above).
    if (resolved !== projectRootAbs && !resolved.startsWith(projectRootAbs + path.sep)) return null;
    const stat = await fs.lstat(resolved);
    if (!stat.isFile()) return null;
    return await fs.readFile(resolved);
  } catch {
    return null;
  }
}

/**
 * Walks the transitive local render graph starting at `entryRelPath` (the
 * project's own HTML entry) and returns a sha256 digest over every visited
 * file's relative path + content hash, sorted deterministically so the
 * result never depends on traversal/discovery order.
 */
export async function computeTransitiveSourceHash(
  projectRoot: string,
  entryRelPath: string,
): Promise<TransitiveHashResult> {
  const projectRootAbs = path.resolve(projectRoot);
  const visited = new Set<string>();
  const parts: string[] = [];
  const queue: string[] = [entryRelPath];

  while (queue.length > 0 && visited.size < MAX_TRANSITIVE_FILES) {
    const nextRaw = queue.shift();
    if (nextRaw === undefined) break;
    const relPath = path.normalize(nextRaw);
    if (visited.has(relPath)) continue;
    visited.add(relPath);

    const absPath = path.join(projectRootAbs, relPath);
    const bytes = await safeReadFile(absPath, projectRootAbs);
    if (!bytes) continue;

    parts.push(`${relPath.split(path.sep).join('/')}:${createHash('sha256').update(bytes).digest('hex')}`);

    const ext = path.extname(relPath).toLowerCase();
    let refs: string[] = [];
    if (ext === '.html' || ext === '.htm') {
      refs = extractHtmlLocalRefs(bytes.toString('utf8'));
    } else if (ext === '.css') {
      refs = extractCssUrls(bytes.toString('utf8'));
    }
    for (const ref of refs) {
      if (!isLocalRef(ref)) continue;
      queue.push(resolveRef(relPath, ref));
    }
  }

  parts.sort();
  const sourceHash = createHash('sha256').update(parts.join('\n')).digest('hex');
  return { sourceHash, files: [...visited].sort() };
}
