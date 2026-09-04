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

/** The characters an HTML tokenizer treats as whitespace inside a tag. */
function isTagWhitespace(char: string): boolean {
  return char === '\t' || char === '\n' || char === '\f' || char === '\r' || char === ' ';
}

function isAsciiAlpha(char: string): boolean {
  return (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z');
}

/**
 * Elements whose content the tokenizer reads as text rather than as markup, so
 * a `<base>` written inside one is a string and never becomes an element.
 *
 * `noscript` is deliberately absent, and the choice is not free: its content is
 * text when scripting is enabled and markup when it is not, and this module
 * cannot know which its caller will get. Reading it as markup means a `<base>`
 * inside it is dropped — right for a preview frame that executes no script,
 * and, where scripting is on, it deletes a few bytes from content the browser
 * does not render. Reading it as text would mean leaving a real hoisted base in
 * place and letting the page rebase itself, which is the defect this module
 * exists to close. The harmless failure is the one taken.
 */
const RAW_TEXT_ELEMENTS = new Set([
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
]);

/**
 * Where the start tag whose name ends at `from` ends: the offset just past its
 * `>`, or `-1` for a tag the document never closes.
 *
 * `-1` is not an error. A tag still open when the input runs out is a tag the
 * parser never emits — it reaches end-of-file inside the tag and drops the
 * token — so a caller must treat `<html><head` as holding no head element.
 *
 * A `>` inside a quoted attribute value belongs to the value, so `<base
 * href="a>b">` is one tag and not a tag plus the stray text `b">`. Only the
 * tokenizer states needed to find the closing `>` are modelled here; what an
 * attribute is called and what it holds never matters to this module.
 */
function endOfTag(html: string, from: number): number {
  type TagState =
    | 'before-name'
    | 'name'
    | 'before-value'
    | 'double-quoted'
    | 'single-quoted'
    | 'unquoted'
    | 'after-value';
  let state: TagState = 'before-name';
  for (let at = from; at < html.length; at += 1) {
    const char = html[at] as string;
    if (state === 'double-quoted' || state === 'single-quoted') {
      if (char === (state === 'double-quoted' ? '"' : "'")) state = 'after-value';
      continue;
    }
    if (state === 'before-value') {
      if (isTagWhitespace(char)) continue;
      if (char === '"') state = 'double-quoted';
      else if (char === "'") state = 'single-quoted';
      else if (char === '>') return at + 1;
      else state = 'unquoted';
      continue;
    }
    if (char === '>') return at + 1;
    if (state === 'unquoted') {
      if (isTagWhitespace(char)) state = 'before-name';
      continue;
    }
    if (isTagWhitespace(char)) {
      // Whitespace after an attribute name keeps the `=` that may follow it
      // reading as this attribute's value separator, so `foo = "a>b"` is one
      // attribute and the quoted `>` still belongs to its value.
      if (state !== 'name') state = 'before-name';
      continue;
    }
    if (char === '/') state = 'before-name';
    else if (char === '=' && state === 'name') state = 'before-value';
    else state = 'name';
  }
  return -1;
}

/**
 * Whether `html` writes the start or end tag named `name` at `at`.
 *
 * The name is matched case-insensitively and the byte after it must be one the
 * tokenizer accepts as ending a tag name, so `</scriptx>` does not close a
 * `<script>` and `</script` at the very end of the input closes nothing.
 */
function isTagAt(html: string, at: number, name: string, closing: boolean): boolean {
  const opener = closing ? '</' : '<';
  const head = `${opener}${name}`;
  if (html.slice(at, at + head.length).toLowerCase() !== head) return false;
  const after = html[at + head.length];
  return after !== undefined && (isTagWhitespace(after) || after === '/' || after === '>');
}

/**
 * Where a `<script>`'s content ends.
 *
 * Script content is not plain raw text. `<!--` inside it opens an escaped
 * region, a `<script` start tag inside that region opens a double-escaped one,
 * and inside THAT a `</script>` closes only the nesting rather than the element
 * — so `<script><!--<script></script><base href="/evil/">--></script>` is one
 * script whose text holds a base, not a script followed by a base element. `-->`
 * leaves the escaped region again.
 *
 * Getting this wrong is not cosmetic: the first `</script>` looks like the end
 * of the element, and everything the author wrote as script text after it would
 * be read as markup — which is how a `<base>` inside a script body would end up
 * cut out of it.
 */
function endOfScriptData(html: string, from: number): number {
  let state: 'data' | 'escaped' | 'double' = 'data';
  let at = from;
  while (at < html.length) {
    if (state !== 'data' && html.startsWith('-->', at)) {
      state = 'data';
      at += 3;
      continue;
    }
    if (state === 'data' && html.startsWith('<!--', at)) {
      state = 'escaped';
      at += 4;
      continue;
    }
    if (html[at] === '<') {
      if (isTagAt(html, at, 'script', true)) {
        if (state !== 'double') return at;
        state = 'escaped';
      } else if (state === 'escaped' && isTagAt(html, at, 'script', false)) {
        state = 'double';
      }
    }
    at += 1;
  }
  return html.length;
}

/**
 * Where the raw-text content opened by `name` ends: the offset of the end tag
 * that closes it, or the length of `html` when the document never writes one.
 * `<plaintext>` has no end tag at all — every byte after it is text — and
 * `<script>` has escape states of its own, so it gets its own walk.
 */
function endOfRawText(html: string, name: string, from: number): number {
  if (name === 'plaintext') return html.length;
  if (name === 'script') return endOfScriptData(html, from);
  for (let at = html.indexOf('<', from); at >= 0; at = html.indexOf('<', at + 1)) {
    if (isTagAt(html, at, name, true)) return at;
  }
  return html.length;
}

/**
 * Where the comment opened just before `from` ends: the offset just past its
 * closing `>`, or the length of `html` for a comment the document never closes.
 *
 * `-->` is not the only close. The tokenizer reaches its comment-end state on
 * `--` and leaves it on `>`, and a `!` there moves to comment-end-bang, which
 * closes on `>` as well — so `--!>` ends a comment, and extra dashes before
 * either form are comment content, which makes `--->` and `---!>` closes too.
 * Reading only `-->` runs the comment on past its end, and a `<base>` written
 * after it — a real element the parser hoists into the head — is then taken for
 * comment content and left in place, ahead of the injected tag.
 */
function endOfComment(html: string, from: number): number {
  for (let at = from; at < html.length; ) {
    const dashes = html.indexOf('--', at);
    if (dashes < 0) break;
    let close = dashes + 2;
    while (html[close] === '-') close += 1;
    if (html[close] === '>') return close + 1;
    if (html[close] === '!' && html[close + 1] === '>') return close + 2;
    at = dashes + 2;
  }
  return html.length;
}

/** The source span of one start tag, as `[start, end)` offsets into the input. */
interface TagSpan {
  readonly start: number;
  readonly end: number;
  /**
   * Whether the byte just before `start` is a `<` the parser reads as text.
   * Removing this tag would push that `<` against whatever follows the tag, and
   * a `<` in front of a letter opens one — so the byte has to be spelled out as
   * `&lt;` when the tag goes.
   */
  readonly afterTextLessThan: boolean;
}

interface BasePlacement {
  /** Just past the document's real `<head>` start tag, or `null` if it has none. */
  readonly headEnd: number | null;
  /** Just past the document's real `<html>` start tag, or `null` if it has none. */
  readonly htmlEnd: number | null;
  /**
   * Every `<base>` start tag the parser would hoist, in source order — plus one
   * written inside an `<svg>` or `<math>` subtree, which this scan reads as HTML
   * and the parser does not. See `scanForBasePlacement`.
   */
  readonly hoistedBases: readonly TagSpan[];
}

/**
 * Read `html` the way an HTML tokenizer does, far enough to place the base tag.
 *
 * What this holds, outside the foreign-content corner below: `headEnd` and
 * `htmlEnd` sit just past a start tag a parser would emit for that element in
 * the document itself — never one written inside a comment, inside raw-text
 * content, inside an attribute value, or inside a `<template>` — and
 * `hoistedBases` spans every `<base>` start tag the parser would lift into the
 * head, in source order.
 *
 * Text that only looks like a tag stays out of both. `<ba<base href="x">` is a
 * single start tag named `ba<base`, because `<` is an ordinary character in a
 * tag name, and the scan reads it as one; a regex over source text sees a
 * `<base>` there that no parser does.
 *
 * A `<base>` inside a `<template>` is skipped for the same reason a commented
 * one is: template content parses into its own fragment, so it is not in the
 * document's tree order and cannot outrank the injected tag.
 *
 * A tag the input never closes ends the scan and is reported by neither field:
 * the parser reaches end-of-file inside it and emits no token for it, so
 * `<html><head` holds no head element and nothing follows it to find.
 *
 * Foreign content — an `<svg>` or `<math>` subtree — is read as HTML rather
 * than tracked, and both consequences fail towards putting the injected tag
 * first, which is what makes them corners rather than defects. A `<base>` there
 * is collected and removed, although the parser gives it the SVG or MathML
 * namespace and never hoists it: the transform drops an element it did not have
 * to. A `<head>` there is taken for `headEnd`, although the breakout rule
 * (13.2.6.5) pops the subtree and reprocesses that token in HTML mode, where
 * in-head ignores it: the injected tag lands inside the subtree, and the
 * reprocessing still leaves it ahead of any base the page declares later.
 * Neither shape lets a page re-root itself, and both are pinned by cases.
 *
 * Two more corners are read conservatively rather than exactly, and both fail
 * the same way: a `<!` construct is read to its first `>`, which under-skips a
 * CDATA section in foreign content, and an unterminated comment is read to the
 * end of the input. `noscript` is the one deliberate divergence and is argued at
 * `RAW_TEXT_ELEMENTS`.
 */
function scanForBasePlacement(html: string): BasePlacement {
  const hoistedBases: TagSpan[] = [];
  let htmlEnd: number | null = null;
  let templateDepth = 0;
  let textLessThanAt = -1;
  let at = 0;
  while (at < html.length) {
    const start = html.indexOf('<', at);
    if (start < 0) break;
    if (html.startsWith('<!--', start)) {
      // `<!-->` and `<!--->` close the comment where they stand.
      if (html.startsWith('<!-->', start)) {
        at = start + 5;
        continue;
      }
      if (html.startsWith('<!--->', start)) {
        at = start + 6;
        continue;
      }
      at = endOfComment(html, start + 4);
      continue;
    }
    const marker = html[start + 1] ?? '';
    if (marker === '!' || marker === '?') {
      // A doctype, a markup declaration, or a processing instruction: the
      // tokenizer reads all three to the next `>`.
      const close = html.indexOf('>', start + 2);
      at = close < 0 ? html.length : close + 1;
      continue;
    }
    const closing = marker === '/';
    const nameStart = start + (closing ? 2 : 1);
    if (!isAsciiAlpha(html[nameStart] ?? '')) {
      // `</` that names nothing is a bogus comment, read to the next `>`; a
      // lone `<` opens no tag at all and is ordinary text.
      if (!closing) {
        textLessThanAt = start;
        at = start + 1;
        continue;
      }
      const close = html.indexOf('>', nameStart);
      at = close < 0 ? html.length : close + 1;
      continue;
    }
    let nameEnd = nameStart;
    while (
      nameEnd < html.length &&
      !isTagWhitespace(html[nameEnd] as string) &&
      html[nameEnd] !== '/' &&
      html[nameEnd] !== '>'
    ) {
      nameEnd += 1;
    }
    const name = html.slice(nameStart, nameEnd).toLowerCase();
    const tagEnd = endOfTag(html, nameEnd);
    // A tag the input never closes is never emitted, and nothing follows it.
    if (tagEnd < 0) break;
    at = tagEnd;
    if (closing) {
      if (name === 'template' && templateDepth > 0) templateDepth -= 1;
      continue;
    }
    if (name === 'template') {
      templateDepth += 1;
      continue;
    }
    if (RAW_TEXT_ELEMENTS.has(name)) {
      at = endOfRawText(html, name, at);
      continue;
    }
    if (templateDepth > 0) continue;
    if (name === 'base') {
      hoistedBases.push({ start, end: at, afterTextLessThan: start > 0 && textLessThanAt === start - 1 });
    }
    else if (name === 'head') return { headEnd: at, htmlEnd, hoistedBases };
    else if (name === 'html' && htmlEnd === null) htmlEnd = at;
  }
  return { headEnd: null, htmlEnd, hoistedBases };
}

/**
 * Insert `tag` at `at`, dropping every `<base>` the document wrote ahead of it.
 *
 * A base written before the insertion point does not stay where the author put
 * it: the parser hoists a `<base>` that precedes `<head>` — that precedes
 * `<html>`, even — into the head it creates, ahead of everything inside it.
 * Since the document resolves against the first base in TREE order, leaving
 * such a tag in place would hand the page back the rebasing this function
 * exists to take over.
 *
 * The spans come from `scanForBasePlacement`, so each one is a whole `<base>`
 * start tag and nothing else. The result is therefore the input with those tags
 * cut out and `tag` inserted, and the bytes a cut brings together cannot open a
 * tag: the only byte that could is a `<` the parser already reads as text
 * sitting right in front of the removed tag, and that one is written out as
 * `&lt;` — the same character, spelled so a letter behind it cannot turn it
 * into a tag opener. Every other byte is carried through untouched.
 */
function insertBaseTag(html: string, hoistedBases: readonly TagSpan[], at: number, tag: string): string {
  let kept = '';
  let cursor = 0;
  for (const base of hoistedBases) {
    if (base.end > at) break;
    kept += base.afterTextLessThan
      ? `${html.slice(cursor, base.start - 1)}&lt;`
      : html.slice(cursor, base.start);
    cursor = base.end;
  }
  return `${kept}${html.slice(cursor, at)}${tag}${html.slice(at)}`;
}

/**
 * State the base inside the document, for a preview whose serving URL cannot.
 *
 * The tag goes first in the document's real `<head>` — the one a parser would
 * build the document around, not a `<head>` written inside a comment, inside
 * script text, or inside a `<template>` — and every `<base>` the parser would
 * hoist ahead of that point is dropped, so the injected tag is the first base
 * in tree order and the one the document resolves against. Overriding is the
 * intended behaviour here: a page served off its project's raw route cannot
 * know a base that resolves to project files, so its own would name nothing
 * either.
 *
 * A document with no head of its own gets one just after `<html>`; a fragment
 * with neither gets the tag in front, where it already outranks every base the
 * fragment declares.
 *
 * The document is read with an HTML start-tag scan rather than matched with a
 * regex over source text, so what comes back is the input with whole `<base>`
 * elements removed and one tag inserted. No removal forges an element the input
 * did not contain, and the only byte outside a `<base>` start tag that can
 * change is a `<` the parser reads as text immediately in front of a removed
 * tag, rewritten as `&lt;` so the gap cannot open a tag (see `insertBaseTag`).
 * No element is lost either, with one exception the scan states rather than
 * hides: a `<base>` inside an `<svg>` or `<math>` subtree is read as HTML and
 * removed, though the parser would namespace it and never hoist it. That
 * direction of error keeps the injected tag first; `scanForBasePlacement`
 * carries the argument.
 *
 * The response carrying this document must allow the base under its `base-uri`
 * directive, or the browser drops the tag and the refs stay broken.
 */
export function withProjectAssetBaseHref(html: string, baseHref: string): string {
  const tag = `<base href="${baseHref.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`;
  const { headEnd, htmlEnd, hoistedBases } = scanForBasePlacement(html);
  if (headEnd !== null) {
    return insertBaseTag(html, hoistedBases, headEnd, tag);
  }
  if (htmlEnd !== null) {
    return insertBaseTag(html, hoistedBases, htmlEnd, `<head>${tag}</head>`);
  }
  // Nothing precedes the tag here, so a base the fragment declares is already
  // behind it in tree order and inert.
  return `${tag}${html}`;
}
