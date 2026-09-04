/**
 * Where a daemon-injected preview script may be spliced into a served HTML
 * document.
 *
 * The invariant: an injection lands at the last body close the HTML parser
 * will actually reach — never inside a comment, a `<script>` body, a `<style>`
 * block, a `<textarea>` or any other raw-text/RCDATA element, where the bytes
 * are text rather than markup. A script spliced into one of those never runs,
 * and a preview whose paint producer never runs is reported to the user as
 * "Preview did not render" however well it rendered.
 *
 * It is a small state-aware scan, not a parser and not a regex over the whole
 * text. Only two tokenizer states can hide a `</body>` from the parser —
 * comments and raw-text/RCDATA element contents — so those are the only two
 * this tracks, and everything else is ordinary markup.
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

/** Comment opener, a body close, or a raw-text element opener. */
const SCANNER = new RegExp(`<!--|</body(?=[\\s>])|<(${RAW_TEXT_ELEMENTS})(?=[\\s/>])`, 'gi');

/** Index just past the close tag of a raw-text element, or -1 if it never closes. */
function rawTextElementEnd(html: string, name: string, from: number): number {
  const close = new RegExp(`</${name}(?=[\\s/>])`, 'gi');
  close.lastIndex = from;
  const match = close.exec(html);
  if (!match) return -1;
  const gt = html.indexOf('>', match.index);
  return gt < 0 ? -1 : gt + 1;
}

/**
 * Index of the last `</body>` the parser will treat as a body close, or -1
 * when the document has none the parser can reach.
 */
export function lastGenuineBodyCloseIndex(html: string): number {
  const scanner = new RegExp(SCANNER.source, SCANNER.flags);
  let last = -1;
  let match: RegExpExecArray | null = scanner.exec(html);
  while (match !== null) {
    if (match[0] === '<!--') {
      const end = html.indexOf('-->', match.index + 4);
      // An unterminated comment swallows everything after it.
      if (end < 0) return last;
      scanner.lastIndex = end + 3;
    } else if (match[1]) {
      const end = rawTextElementEnd(html, match[1], scanner.lastIndex);
      // An unterminated raw-text element swallows everything after it.
      if (end < 0) return last;
      scanner.lastIndex = end;
    } else {
      last = match.index;
    }
    match = scanner.exec(html);
  }
  return last;
}

/**
 * Splice `injection` immediately before the document's last genuine body
 * close, or append it at EOF when there is none.
 */
export function injectBeforeGenuineBodyClose(html: string, injection: string): string {
  const index = lastGenuineBodyCloseIndex(html);
  if (index < 0) return `${html}${injection}`;
  return `${html.slice(0, index)}${injection}${html.slice(index)}`;
}
