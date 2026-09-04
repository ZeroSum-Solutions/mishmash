/**
 * Where a daemon-injected preview script may be spliced into a served HTML
 * document, and when the document already carries one.
 *
 * The invariant: an injection lands at the last body close the HTML parser
 * will actually reach — never inside a comment, a `<script>` body, a `<style>`
 * block, a `<textarea>`, a `<template>`, a bogus comment or a CDATA section,
 * where the bytes are text rather than markup. A script spliced into one of
 * those never runs, and a preview whose paint producer never runs is reported
 * to the user as "Preview did not render" however well it rendered.
 *
 * It is a small state-aware scan, not a parser and not a regex over the whole
 * text. What can hide a `</body>` from the parser is what this tracks, with the
 * one deliberate imprecision named after the list:
 *
 *  - comment text, ended at every spelling the tokenizer accepts;
 *  - raw-text / RCDATA element contents (the tokenizer's RAWTEXT, RCDATA and
 *    script-data switches);
 *  - a quoted attribute value inside a tag;
 *  - `<template>` content, which the parser puts in a separate fragment and
 *    never treats as markup for this document;
 *  - bogus comments and markup declarations — `<?`, a `<!` that opens neither a
 *    comment nor a DOCTYPE nor a CDATA section, and a `</` not followed by a
 *    letter — all of which run to the next `>`
 *    (https://html.spec.whatwg.org/multipage/parsing.html#tag-open-state,
 *    #markup-declaration-open-state, #bogus-comment-state);
 *  - CDATA sections, which exist only in foreign content and run to `]]>`
 *    (https://html.spec.whatwg.org/multipage/parsing.html#cdata-section-state).
 *
 * Everything else is ordinary markup.
 *
 * Foreign content is tracked as a plain `<svg>` / `<math>` depth, without HTML
 * integration points (`foreignObject`, `desc`, `annotation-xml` and friends).
 * Inside one of those the parser would read `<![CDATA[` as a bogus comment
 * while this scan reads it as a section; the effect is to skip more text than
 * the parser would, which can only cost a genuine body close and fall back to
 * the EOF append below. It cannot select a decoy.
 *
 * When no genuine close exists the injection is appended at EOF. That is the
 * honest placement, not a guarantee of execution: a document that left the
 * tokenizer inside an unclosed comment or raw-text element never returns to
 * markup, so its producer does not run and the preview correctly reaches the
 * watchdog's named failure. Appending at least avoids corrupting the response
 * on the way.
 */

/**
 * Elements whose content the HTML tokenizer reads as raw text or RCDATA, so a
 * `</body>` inside one is character data. Per the WHATWG tokenizer's
 * RAWTEXT / RCDATA / script-data switches.
 */
const RAW_TEXT_ELEMENTS = 'script|style|textarea|title|xmp|iframe|noembed|noframes|noscript';

/**
 * Elements that open a foreign-content subtree. `<![CDATA[` opens a CDATA
 * section only in there; in HTML content the same bytes are a bogus comment.
 */
const FOREIGN_CONTENT_ELEMENTS = 'svg|math';

/**
 * Comment opener, CDATA opener, bogus-comment opener, a body close, a raw-text
 * element opener, a template opener, a foreign-content boundary, or any other
 * tag. Order matters: the narrower `<!--` and `<![CDATA[` openers are tried
 * before the bare `<!`.
 */
const SCANNER = new RegExp(
  [
    '<!--',
    '<!\\[CDATA\\[',
    '<[!?]',
    '</(?![a-z])',
    '</body(?=[\\s>])',
    `<(${RAW_TEXT_ELEMENTS})(?=[\\s/>])`,
    '<(template)(?=[\\s/>])',
    `</?(${FOREIGN_CONTENT_ELEMENTS})(?=[\\s/>])`,
    '</?[a-z][^\\s/>]*',
  ].join('|'),
  'gi',
);

/**
 * Index just past a `<template>`'s close tag, counting nested templates, or -1
 * when it never closes. Its content is a separate fragment: a `</body>` in
 * there is not this document's body close, and a script in there never runs.
 */
function templateEnd(html: string, from: number): number {
  const tags = /<(\/?)template(?=[\s/>])/gi;
  tags.lastIndex = from;
  let depth = 1;
  let match: RegExpExecArray | null = tags.exec(html);
  while (match !== null) {
    depth += match[1] === '/' ? -1 : 1;
    if (depth === 0) {
      const gt = html.indexOf('>', match.index);
      return gt < 0 ? -1 : gt + 1;
    }
    match = tags.exec(html);
  }
  return -1;
}

/**
 * Index just past a tag's `>`, skipping quoted attribute values so a `</body>`
 * written inside one is not mistaken for markup. -1 when the tag never closes.
 */
function tagEnd(html: string, from: number): number {
  let index = from;
  while (index < html.length) {
    const char = html[index];
    if (char === '>') return index + 1;
    if (char === '"' || char === "'") {
      const close = html.indexOf(char, index + 1);
      if (close < 0) return -1;
      index = close + 1;
      continue;
    }
    index += 1;
  }
  return -1;
}

/**
 * Index just past the end of the comment whose `<!--` opener ends at `from`,
 * or -1 when the comment never closes.
 *
 * Every spelling the tokenizer accepts, because a comment that is read as
 * running past its close swallows real markup:
 *
 *  - `<!-->` and `<!--->` are complete, EMPTY comments — a `>` (or a `-` then
 *    a `>`) straight after the opener closes them abruptly
 *    (https://html.spec.whatwg.org/multipage/parsing.html#comment-start-state,
 *    #comment-start-dash-state);
 *  - otherwise the comment ends at `-->` (#comment-end-state) or at `--!>`
 *    (#comment-end-bang-state).
 *
 * Recognising `-->` alone reads everything up to a LATER `-->` as comment
 * text. That loses the document's genuine body close, and — worse — hides a
 * marked producer the document already carries, after which a second one is
 * injected and the exactly-one-producer invariant is broken.
 */
function commentEnd(html: string, from: number): number {
  if (html.charAt(from) === '>') return from + 1;
  if (html.charAt(from) === '-' && html.charAt(from + 1) === '>') return from + 2;
  const close = /--!?>/g;
  close.lastIndex = from;
  const match = close.exec(html);
  return match === null ? -1 : match.index + match[0].length;
}

/**
 * Index just past the close tag of a raw-text element, or -1 if it never
 * closes. `from` must be past the element's START TAG: the raw-text region
 * begins where the tag ends, so a `</script>` written inside an attribute
 * value belongs to the value, not to the region.
 */
function rawTextElementEnd(html: string, name: string, from: number): number {
  const close = new RegExp(`</${name}(?=[\\s/>])`, 'gi');
  close.lastIndex = from;
  const match = close.exec(html);
  if (!match) return -1;
  const gt = html.indexOf('>', match.index);
  return gt < 0 ? -1 : gt + 1;
}

/**
 * Index just past the `>` that ends a bogus comment, a markup declaration or a
 * DOCTYPE. All three run to the next `>` — a DOCTYPE's quoted identifiers do
 * not protect one, since `>` inside them ends the token too.
 */
function bogusCommentEnd(html: string, from: number): number {
  const gt = html.indexOf('>', from);
  return gt < 0 ? -1 : gt + 1;
}

/** Index just past a CDATA section's `]]>`, or -1 when it never closes. */
function cdataSectionEnd(html: string, from: number): number {
  const end = html.indexOf(']]>', from);
  return end < 0 ? -1 : end + 3;
}

/**
 * True when the start-tag attribute text in `html[from, to)` DECLARES the
 * attribute `name` — not merely contains those characters. Attribute values are
 * stepped over, quoted or not, so a name written inside a value is read as the
 * value it is.
 */
function declaresAttribute(html: string, from: number, to: number, name: string): boolean {
  /** The tokenizer's ASCII whitespace set. */
  const isSpace = (char: string): boolean =>
    char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';
  const wanted = name.toLowerCase();
  let index = from;
  while (index < to) {
    const char = html.charAt(index);
    if (isSpace(char) || char === '/') {
      index += 1;
      continue;
    }
    let nameEnd = index;
    while (nameEnd < to && !isSpace(html.charAt(nameEnd)) && html.charAt(nameEnd) !== '/' && html.charAt(nameEnd) !== '=') {
      nameEnd += 1;
    }
    // A malformed tag can put `=` where a name belongs; step past it rather
    // than stall on a zero-length name.
    if (nameEnd === index) {
      index += 1;
      continue;
    }
    const attribute = html.slice(index, nameEnd).toLowerCase();
    index = nameEnd;
    while (index < to && isSpace(html.charAt(index))) index += 1;
    if (html.charAt(index) === '=') {
      index += 1;
      while (index < to && isSpace(html.charAt(index))) index += 1;
      const quote = html.charAt(index);
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, index + 1);
        index = close < 0 || close >= to ? to : close + 1;
      } else {
        while (index < to && !isSpace(html.charAt(index))) index += 1;
      }
    }
    if (attribute === wanted) return true;
  }
  return false;
}

/** What one pass over a document found. */
interface BodyCloseScan {
  /** Index of the last body close the parser will reach, or -1 when there is none. */
  lastBodyClose: number;
  /** True when a `<script>` start tag declaring the scanned marker was reached as markup. */
  markerDeclared: boolean;
}

/**
 * One state-aware pass over `html`. `marker`, when given, is an attribute name
 * looked for on `<script>` start tags the parser actually reaches.
 */
function scanBodyClose(html: string, marker: string | null): BodyCloseScan {
  const scanner = new RegExp(SCANNER.source, SCANNER.flags);
  let last = -1;
  let markerDeclared = false;
  let foreignDepth = 0;
  const stopHere = (): BodyCloseScan => ({ lastBodyClose: last, markerDeclared });
  let match: RegExpExecArray | null = scanner.exec(html);
  while (match !== null) {
    const token = match[0].toLowerCase();
    if (token === '<!--') {
      const end = commentEnd(html, match.index + 4);
      // An unterminated comment swallows everything after it.
      if (end < 0) return stopHere();
      scanner.lastIndex = end;
    } else if (token === '<![cdata[') {
      // A CDATA section only in foreign content; a bogus comment anywhere else.
      const end = foreignDepth > 0
        ? cdataSectionEnd(html, scanner.lastIndex)
        : bogusCommentEnd(html, scanner.lastIndex);
      if (end < 0) return stopHere();
      scanner.lastIndex = end;
    } else if (token === '<!' || token === '<?' || token === '</') {
      const end = bogusCommentEnd(html, scanner.lastIndex);
      if (end < 0) return stopHere();
      scanner.lastIndex = end;
    } else if (match[1]) {
      // The start tag is read first, quoted values and all: the raw-text
      // region begins where the tag ends, and one attribute value holding
      // `</script>` must not end it inside the tag.
      const tagClose = tagEnd(html, scanner.lastIndex);
      // An unterminated start tag swallows everything after it.
      if (tagClose < 0) return stopHere();
      if (
        marker !== null &&
        !markerDeclared &&
        match[1].toLowerCase() === 'script' &&
        declaresAttribute(html, scanner.lastIndex, tagClose - 1, marker)
      ) {
        markerDeclared = true;
      }
      const end = rawTextElementEnd(html, match[1], tagClose);
      // An unterminated raw-text element swallows everything after it.
      if (end < 0) return stopHere();
      scanner.lastIndex = end;
    } else if (match[2]) {
      // Template content is inert markup in a fragment of its own. An
      // unterminated one swallows the rest of the document with it.
      const end = templateEnd(html, scanner.lastIndex);
      if (end < 0) return stopHere();
      scanner.lastIndex = end;
    } else if (match[3]) {
      const end = tagEnd(html, scanner.lastIndex);
      if (end < 0) return stopHere();
      if (token[1] === '/') {
        if (foreignDepth > 0) foreignDepth -= 1;
      } else if (html[end - 2] !== '/') {
        foreignDepth += 1;
      }
      scanner.lastIndex = end;
    } else if (token === '</body') {
      last = match.index;
      const end = tagEnd(html, scanner.lastIndex);
      scanner.lastIndex = end < 0 ? html.length : end;
    } else {
      // Any other tag: step over it, attribute values included, so a body
      // close written inside `title="</body>"` is read as the text it is.
      const end = tagEnd(html, scanner.lastIndex);
      if (end < 0) return stopHere();
      scanner.lastIndex = end;
    }
    match = scanner.exec(html);
  }
  return stopHere();
}

/**
 * Index of the last `</body>` the parser will treat as a body close, or -1
 * when the document has none the parser can reach.
 */
export function lastGenuineBodyCloseIndex(html: string): number {
  return scanBodyClose(html, null).lastBodyClose;
}

function spliceAt(html: string, index: number, injection: string): string {
  if (index < 0) return `${html}${injection}`;
  return `${html.slice(0, index)}${injection}${html.slice(index)}`;
}

/**
 * Splice `injection` immediately before the document's last genuine body
 * close, or append it at EOF when there is none.
 */
export function injectBeforeGenuineBodyClose(html: string, injection: string): string {
  return spliceAt(html, lastGenuineBodyCloseIndex(html), injection);
}

/**
 * Splice `injection` before the document's last genuine body close, unless the
 * document already carries a `<script>` element declaring the `marker`
 * attribute.
 *
 * The invariant: a document carries the injected script when the SCRIPT ELEMENT
 * is there — not when the marker's characters appear somewhere in the bytes. A
 * document that mentions the attribute name in a comment, in a script string
 * literal, in prose or inside another element's attribute value carries no
 * script, and skipping the injection for it hands the user a false "Preview did
 * not render".
 *
 * One pass answers both questions, so a large response is scanned once.
 */
export function injectMarkedScriptBeforeBodyClose(
  html: string,
  marker: string,
  injection: string,
): string {
  const scan = scanBodyClose(html, marker);
  if (scan.markerDeclared) return html;
  return spliceAt(html, scan.lastBodyClose, injection);
}
