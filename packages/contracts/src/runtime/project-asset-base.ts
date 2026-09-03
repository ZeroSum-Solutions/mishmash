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
 * State the base inside the document, for a preview whose serving URL cannot.
 *
 * The tag goes first in the real `<head>`, so it is the document's effective
 * base even when the page carries one of its own: only the first `<base href>`
 * in a document takes effect. Overriding is the intended behaviour here — a
 * page served off its project's raw route cannot know a base that resolves to
 * project files, so its own would name nothing either. The insertion point is
 * found on a comment-masked copy so a commented-out `<head>` cannot capture the
 * tag and leave the page's own base in charge.
 *
 * A stray `<!--` inside script text can mask past the real head; insertion then
 * falls back to just after `<html>`, which is still the first base in parse
 * order and so still the one that wins.
 *
 * The response carrying this document must allow the base under its `base-uri`
 * directive, or the browser drops the tag and the refs stay broken.
 */
export function withProjectAssetBaseHref(html: string, baseHref: string): string {
  const tag = `<base href="${baseHref.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`;
  const searchable = maskComments(html);
  const head = /<head[^>]*>/i.exec(searchable);
  if (head) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}${tag}${html.slice(at)}`;
  }
  const root = /<html[^>]*>/i.exec(searchable);
  if (root) {
    const at = root.index + root[0].length;
    return `${html.slice(0, at)}<head>${tag}</head>${html.slice(at)}`;
  }
  return `${tag}${html}`;
}
