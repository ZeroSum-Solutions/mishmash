/**
 * Where a previewed project HTML page resolves its relative asset refs.
 *
 * The invariant, and the only rule either creation path may use: a relative
 * `src` / `href` on a project HTML page resolves against that page's own
 * directory inside its project's raw-file route, whichever way the page
 * arrived — an agent wrote it to disk, or the daemon rendered it from a live
 * artifact.
 *
 * A disk-written page satisfies the invariant through its serving URL: it is
 * fetched from `/api/projects/:projectId/raw/<file>`, so the browser already
 * resolves `assets/pic.png` against that file's directory. A page whose
 * serving URL cannot express the rule — the live-artifact preview is served
 * from `/api/live-artifacts/:artifactId/preview`, a path that names no project
 * file — has to carry the base in the document instead, which is what
 * `withProjectAssetBaseHref` is for.
 *
 * Pure string functions: no fetch, no DOM, no filesystem, so both apps can
 * hold the same rule without either importing the other.
 */

/**
 * The raw-file URL a relative asset ref resolves against for `ownerFilePath`.
 *
 * `'zh/index.html'` → `/api/projects/:id/raw/zh/`; a project-root file →
 * `/api/projects/:id/raw/`. Pass `''` for a document that is rooted at the
 * project itself rather than at a file inside it.
 *
 * Every path segment is encoded on its own so a slash stays a separator, and
 * the result always ends in `/` — a base href without the trailing slash would
 * drop its last segment when the browser resolves against it.
 *
 * Empty segments are dropped, so `a//page.html` and `/a/page.html` both give
 * `/api/projects/:id/raw/a/` rather than a base with a doubled or leading
 * slash. A project file path never carries one: `collectFiles`
 * (apps/daemon/src/projects.ts) builds every name by joining real directory
 * entries, so `/api/projects/:id/files` cannot report a name with an empty
 * segment.
 */
export function projectRawAssetBaseHref(projectId: string, ownerFilePath: string): string {
  const ownerDir = ownerFilePath.replace(/\\/g, '/').replace(/[^/]*$/, '');
  const encodedDir = ownerDir
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/api/projects/${encodeURIComponent(projectId)}/raw/${encodedDir ? `${encodedDir}/` : ''}`;
}

/**
 * Blank out comment spans so a `<head>` written inside one is not mistaken for
 * the document's real head. Same length as the input, so an index found in the
 * masked copy addresses the identical position in the original.
 */
function maskComments(html: string): string {
  return html.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => ' '.repeat(comment.length));
}

/**
 * Insert `tag` at `at`, dropping any `<base>` the document wrote ahead of it.
 *
 * A base written before the insertion point does not stay where the author put
 * it: the parser hoists a `<base>` that precedes `<head>` — that precedes
 * `<html>`, even — into the head it creates, ahead of everything inside it.
 * Since the document resolves against the first base in TREE order, leaving
 * such a tag in place would hand the page back the rebasing this function
 * exists to take over. Dropping it is what makes the injected base decisive for
 * every document shape rather than only for a base written inside the head.
 *
 * Matching runs on the comment-masked copy, so a `<base>` inside a comment —
 * inert already — is left where the author wrote it.
 */
function insertBaseTag(html: string, searchable: string, at: number, tag: string): string {
  const prefix = searchable.slice(0, at);
  const hoistable = /<base\b[^>]*>/gi;
  let kept = '';
  let cursor = 0;
  for (let found = hoistable.exec(prefix); found !== null; found = hoistable.exec(prefix)) {
    kept += html.slice(cursor, found.index);
    cursor = found.index + found[0].length;
  }
  return `${kept}${html.slice(cursor, at)}${tag}${html.slice(at)}`;
}

/**
 * State the base inside the document, for a preview whose serving URL cannot.
 *
 * The tag goes first in the real `<head>` and any base the page declared ahead
 * of that point is dropped, so the injected base is the one the document
 * resolves against whatever shape the page has (see `insertBaseTag`).
 * Overriding is the intended behaviour here — a page served off its project's
 * raw route cannot know a base that resolves to project files, so its own would
 * name nothing either. The insertion point is found on a comment-masked copy so
 * a commented-out `<head>` cannot capture the tag and leave the page's own base
 * in charge.
 *
 * A stray `<!--` inside script text can mask past the real head; insertion then
 * falls back to just after `<html>`, which is still ahead of every base the
 * page declares later and drops every one it declared earlier.
 *
 * The response carrying this document must allow the base under its `base-uri`
 * directive, or the browser drops the tag and the refs stay broken.
 */
export function withProjectAssetBaseHref(html: string, baseHref: string): string {
  const tag = `<base href="${baseHref.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`;
  const searchable = maskComments(html);
  const head = /<head[^>]*>/i.exec(searchable);
  if (head) {
    return insertBaseTag(html, searchable, head.index + head[0].length, tag);
  }
  const root = /<html[^>]*>/i.exec(searchable);
  if (root) {
    return insertBaseTag(html, searchable, root.index + root[0].length, `<head>${tag}</head>`);
  }
  // Nothing precedes the tag here, so a base the fragment declares is already
  // behind it in tree order and inert.
  return `${tag}${html}`;
}
