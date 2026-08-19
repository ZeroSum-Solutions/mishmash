// Gallery-preview wrapper detection.
//
// Some catalogue entries ship a root `example.html` that is not the artifact at
// all — it is a gallery preview wrapper whose entire body is one `<iframe>`
// pointing at the real site one directory down:
//
//   <body><iframe src="./assets/index.html" title="..."></iframe></body>
//
// Handing that wrapper to a new project as its entry file opens a blank canvas:
// the preview surface renders srcDoc with an opaque origin, so the nested frame
// loads un-injected (if at all) and every asset it references is blocked.
//
// The guard this replaces was keyed to a *filename* (`assets/template.html`) and
// therefore missed every wrapper that names its target anything else. This module
// keys on *shape* instead, so a wrapper is recognised whatever its target is
// called.
//
// The shape rule is deliberately strict — exactly one element inside <body>, and
// that element is an <iframe> with a resolvable local src. A wrapper that also
// carries a title bar (two body elements) is NOT matched, because at that point
// the file has content of its own and the call is no longer unambiguous. Being
// narrow here is the point: a false positive would redirect, and under
// `shouldSkipCopiedWrapper`, discard a page the user legitimately authored.

import { realpathSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Files larger than this are never treated as wrappers and are never read.
 *
 * Every real wrapper observed in either catalogue is under 1 KB (the 199
 * user-installed ones are ~280 bytes; the one shipped wrapper is 954 bytes).
 * The cap is what keeps wrapper detection off the unbounded-I/O path — it runs
 * on project-detail and export requests, so an arbitrarily large declared entry
 * file must be rejected by `stat` before it is ever read into memory.
 */
export const WRAPPER_HTML_MAX_BYTES = 8192;

const BODY_RE = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
// The whole body, once comments/script/style are gone, must be exactly one
// iframe tag (with or without a closing tag). Anything else — text, a sibling
// div, a second iframe — disqualifies the file.
// Quote-aware attribute matching: a `>` inside title="a>b" must not end the tag.
const LONE_IFRAME_RE = /^<iframe\b((?:[^>"']|"[^"]*"|'[^']*')*)>(?:\s*<\/iframe\s*>)?$/i;
const BODY_OPEN_COUNT_RE = /<body\b/gi;
const SRC_ATTR_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;
const HAS_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/**
 * The `src` an HTML document declares, when that document is a lone-iframe
 * wrapper. Returns null for anything that is not one.
 *
 * Pure: no filesystem access, no path resolution. `parseWrapperIframeSrc` is the
 * half that decides "is this file a wrapper at all", which is the half worth
 * unit-testing on its own.
 */
export function parseWrapperIframeSrc(html: string): string | null {
  if (typeof html !== 'string' || html.length === 0 || html.length > WRAPPER_HTML_MAX_BYTES) {
    return null;
  }
  // Strip comments, scripts and styles from the WHOLE document before looking
  // for <body>, not just from inside it. A commented-out block that happens to
  // contain `<body><iframe src=...></iframe></body>` — an old version left in
  // the head, say — would otherwise be found first and treated as the real
  // body, misclassifying an authored page as a disposable wrapper.
  const sanitized = html.replace(COMMENT_RE, '').replace(SCRIPT_RE, '').replace(STYLE_RE, '');
  // And having stripped those, insist the document declares exactly one body.
  // A second `<body` means something else is going on — markup inside an
  // attribute, a template fragment, malformed HTML — and none of those are
  // cases where guessing is better than leaving the file alone.
  if ((sanitized.match(BODY_OPEN_COUNT_RE) ?? []).length !== 1) return null;
  const body = BODY_RE.exec(sanitized);
  if (!body) return null;
  const inner = (body[1] ?? '').trim();
  const lone = LONE_IFRAME_RE.exec(inner);
  if (!lone) return null;
  const src = SRC_ATTR_RE.exec(lone[1] ?? '');
  if (!src) return null;
  const value = (src[1] ?? src[2] ?? src[3] ?? '').trim();
  return value.length > 0 ? value : null;
}

/**
 * Resolve a wrapper's iframe target to a project-relative POSIX path.
 *
 * `htmlRelPath` is the wrapper's own path relative to the project root, so the
 * target resolves against the wrapper's directory the same way a browser would.
 * A target that leaves the project root, names an absolute or remote URL, or is
 * not itself an HTML file is rejected — following one would either escape the
 * sandbox or hand the canvas something it cannot render.
 *
 * Returns null when `html` is not a wrapper, or when its target is not usable.
 * Existence is NOT checked here; callers supply that through `exists` because
 * some of them hold a file map rather than a directory.
 */
export function resolveWrapperTarget(
  html: string,
  htmlRelPath: string,
  exists: (relPath: string) => boolean,
): string | null {
  const rawSrc = parseWrapperIframeSrc(html);
  if (!rawSrc) return null;

  // Strip the query and fragment a browser would not send to the filesystem.
  const bare = (rawSrc.split('#')[0] ?? '').split('?')[0]?.trim() ?? '';
  if (bare.length === 0) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    // A malformed escape is not a path we should guess at.
    return null;
  }
  // Remote or protocol-relative targets are somebody else's document; a
  // root-absolute path is not resolvable inside a copied project tree. Checked
  // on both the raw and decoded forms, so a percent-encoded scheme
  // (`data%3Atext/html,...`) cannot slip past on its way to the decoded value.
  for (const candidate of [bare, decoded]) {
    if (HAS_SCHEME_RE.test(candidate) || candidate.startsWith('//') || candidate.startsWith('/')) {
      return null;
    }
  }
  if (decoded.includes('\0')) return null;
  if (!/\.html?$/i.test(decoded)) return null;

  const htmlDir = path.posix.dirname(toPosix(htmlRelPath));
  const joined = path.posix.normalize(path.posix.join(htmlDir === '.' ? '' : htmlDir, toPosix(decoded)));
  // `normalize` leaves a leading `..` in place, which is exactly the escape we
  // must refuse rather than silently clamp.
  if (joined.startsWith('..') || joined.startsWith('/') || joined.length === 0) return null;
  if (joined === toPosix(htmlRelPath)) return null;

  return exists(joined) ? joined : null;
}

/**
 * Disk-backed form of `resolveWrapperTarget`, for callers that hold a directory
 * rather than a file listing.
 *
 * Reads nothing until `stat` confirms the candidate is a regular file within
 * `WRAPPER_HTML_MAX_BYTES`, so a large or missing entry costs one stat.
 */
export async function resolveWrapperTargetOnDisk(
  projectRoot: string,
  htmlRelPath: string,
): Promise<string | null> {
  const rel = toPosix(htmlRelPath);
  if (!rel || rel.startsWith('/') || rel.startsWith('..')) return null;
  const absolute = path.join(projectRoot, ...rel.split('/'));
  return resolveWrapperTargetFromFile(absolute, rel, (candidate) =>
    candidateIsFile(projectRoot, candidate),
  );
}

/**
 * Same decision as `resolveWrapperTargetOnDisk`, for callers that already hold
 * the file's absolute path and their own notion of which sibling files exist —
 * the export manifest builder works from a file map, not a directory.
 */
export async function resolveWrapperTargetFromFile(
  absoluteHtmlPath: string,
  htmlRelPath: string,
  exists: (relPath: string) => boolean,
): Promise<string | null> {
  const rel = toPosix(htmlRelPath);
  if (!rel || !/\.html?$/i.test(rel)) return null;

  let html: string;
  try {
    const info = await stat(absoluteHtmlPath);
    if (!info.isFile() || info.size > WRAPPER_HTML_MAX_BYTES) return null;
    html = await readFile(absoluteHtmlPath, 'utf8');
  } catch {
    return null;
  }

  return resolveWrapperTarget(html, rel, exists);
}

/**
 * Is `relPath` a regular file that really lives inside `projectRoot`?
 *
 * `realpathSync` before the containment check, not after: a lexical prefix test
 * is fooled by a symlink *inside* the project pointing out of it — the literal
 * path stays under the root while the OS follows the link at open() time. Same
 * reasoning as `resolveSafeReal` in `projects.ts`, which guards the byte-serving
 * path; without it here, a wrapper could name a target that passes selection and
 * then hard-fails at serve time.
 */
function candidateIsFile(projectRoot: string, relPath: string): boolean {
  try {
    const rootReal = realpathSync(projectRoot);
    const candidateReal = realpathSync(path.join(projectRoot, ...relPath.split('/')));
    const rel = path.relative(rootReal, candidateReal);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
    return statSync(candidateReal).isFile();
  } catch {
    return false;
  }
}

function toPosix(value: string): string {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
}
