// W2H.1b red spec — D-17 landing condition 4. Where the paint producer is
// spliced into a preview document.
//
// The producer is what lets a preview prove it rendered; a document that never
// runs it ends in the watchdog's named failure. So the splice point decides
// whether a healthy artifact is reported as broken. Both daemon injectors —
// the live-artifact one in `live-artifacts/http-helpers.ts` and the URL-preview
// one in `routes/project/index.ts` — pick that point by searching the response
// text for `</body>`, and a raw text search cannot tell a genuine body close
// from one written inside a comment, a `<script>` string, a `<style>` block, or
// a `<textarea>`.
//
// GPT-5.6 round 1: "searching source text for the first `</body>` can insert
// inside comments, raw-text elements, or script text ... Malformed/adversarial
// HTML can therefore suppress the producer". Round 2 fixed the rule: find the
// LAST lexically genuine `</body>` — outside comments and raw-text/RCDATA
// elements — with a state-aware scan, and append at EOF only when no genuine
// close exists.
//
// A producer that lands inside a comment or a string literal never runs, and
// the healthy artifact that carried the decoy gets "Preview did not render".
import { describe, expect, it } from 'vitest';

import { injectLiveArtifactPaintReporter } from '../src/live-artifacts/http-helpers.js';

const NONCE = 'test-nonce';

/** Where the injected producer landed in the served document. */
function producerIndex(html: string): number {
  const index = html.indexOf('data-od-live-artifact-paint-bridge');
  expect(index, 'the response must carry the producer').toBeGreaterThan(-1);
  return index;
}

describe('the paint producer is spliced at a genuine body close', () => {
  it('ignores a decoy </body> written inside an HTML comment', () => {
    const html = '<!doctype html><html><body><!-- </body> --><h1>Artifact</h1></body></html>';
    const out = injectLiveArtifactPaintReporter(html, NONCE);

    expect(
      producerIndex(out),
      'a producer spliced inside the comment is commented out, and the artifact reports as never rendered',
    ).toBeGreaterThan(out.indexOf('-->'));
    expect(out.indexOf('<h1>Artifact</h1>')).toBeLessThan(producerIndex(out));
  });

  it('ignores a decoy </body> written inside a raw-text element', () => {
    const html =
      '<!doctype html><html><head><style>/* </body> */</style></head><body><h1>Artifact</h1></body></html>';
    const out = injectLiveArtifactPaintReporter(html, NONCE);

    expect(
      producerIndex(out),
      'a producer spliced inside <style> is stylesheet text, not script',
    ).toBeGreaterThan(out.indexOf('</style>'));
  });

  it('ignores a decoy </body> written inside a trailing script literal', () => {
    const html =
      '<!doctype html><html><body><h1>Artifact</h1></body><script>var s = "</body>";</script></html>';
    const out = injectLiveArtifactPaintReporter(html, NONCE);

    const genuineClose = out.indexOf('</body>');
    expect(genuineClose).toBeGreaterThan(-1);
    expect(
      producerIndex(out),
      'the last body close in this document is a string literal; the genuine one comes earlier',
    ).toBeLessThan(genuineClose);
  });

  it('appends at EOF when the document has no body close at all', () => {
    const html = '<!doctype html><html><p>Artifact</p></html>';
    const out = injectLiveArtifactPaintReporter(html, NONCE);

    expect(out.startsWith(html), 'nothing was spliced into the original bytes').toBe(true);
    expect(producerIndex(out)).toBeGreaterThan(html.length - 1);
  });

  it('appends at EOF when the only body close is inside an unclosed raw-text element', () => {
    // The producer cannot run in this document — the parser never leaves the
    // <style> state, so everything after it is stylesheet text. Appending at
    // EOF is the honest placement: it does not pretend the producer executes,
    // and the preview correctly reaches the watchdog's named failure.
    const html = '<!doctype html><html><body><h1>Artifact</h1><style>a{} /* </body>';
    const out = injectLiveArtifactPaintReporter(html, NONCE);

    expect(
      out.startsWith(html),
      'a producer spliced into the middle of an unterminated <style> block corrupts the response as well as failing to run',
    ).toBe(true);
  });
});

describe('the splice reads a tag as a tag', () => {
  it('ignores a decoy </body> written inside a quoted attribute value', () => {
    // Raised by the round-1 track audit: a body close written inside an
    // attribute is character data to the parser, and a producer spliced there
    // is an attribute value rather than a script.
    const html =
      '<!doctype html><html><body><h1>Artifact</h1></body><div title="</body>">tail</div></html>';
    const out = injectLiveArtifactPaintReporter(html, NONCE);

    const genuineClose = out.indexOf('</body>');
    expect(
      producerIndex(out),
      'the only body close the parser reaches is the real one, before the decoy attribute',
    ).toBeLessThan(genuineClose);
  });
});

describe('the splice leaves template content alone', () => {
  it('ignores a decoy </body> written inside a template', () => {
    // Template content is parsed into a fragment of its own, so a producer
    // spliced there is inert markup rather than a script — and the artifact
    // that carried the template reports as never rendered.
    const html =
      '<!doctype html><html><body><h1>Artifact</h1><template><section></body></section></template></body></html>';
    const out = injectLiveArtifactPaintReporter(html, NONCE);

    expect(
      producerIndex(out),
      'the only body close the parser reaches is the document one, after the template',
    ).toBeGreaterThan(out.indexOf('</template>'));
  });

  it('ignores a decoy </body> inside a nested template', () => {
    const html =
      '<!doctype html><html><body><h1>Artifact</h1>' +
      '<template><template></body></template></template></body></html>';
    const out = injectLiveArtifactPaintReporter(html, NONCE);

    expect(producerIndex(out)).toBeGreaterThan(out.lastIndexOf('</template>'));
  });
});

// W2H.1c red spec — D-17 dialogue round 3, blocking finding 3. The tokenizer
// states the scan did not model.
//
// GPT-5.6 round 3: "for `</body><?bogus </body> ?>` the scanner selects the
// decoy inside `<?…>`, and the injected producer becomes text (no script
// element, no execution)." The HTML tokenizer sends `<?` and a `<!` that is not
// a comment, a DOCTYPE or a CDATA section into the bogus comment state, which
// runs to the next `>`; a `</body>` written in there is comment text, and a
// producer spliced there never runs.
describe('the splice steps over bogus comments and markup declarations', () => {
  it('ignores a decoy </body> inside a `<?` bogus comment', () => {
    const html =
      '<!doctype html><html><body><h1>Artifact</h1></body><?bogus </body> ?></html>';
    const out = injectLiveArtifactPaintReporter(html, NONCE);

    expect(
      producerIndex(out),
      'a producer spliced inside `<?…>` is bogus-comment text, not a script',
    ).toBeLessThan(out.indexOf('<?bogus'));
  });

  it('ignores a decoy </body> inside a `<!` markup declaration', () => {
    const html =
      '<!doctype html><html><body><h1>Artifact</h1></body><!bogus </body> ></html>';
    const out = injectLiveArtifactPaintReporter(html, NONCE);

    expect(
      producerIndex(out),
      'a `<!` that opens neither a comment nor a DOCTYPE is a bogus comment too',
    ).toBeLessThan(out.indexOf('<!bogus'));
  });

  it('ignores a decoy </body> inside a CDATA section in inline SVG', () => {
    const html =
      '<!doctype html><html><body><h1>Artifact</h1></body>' +
      '<svg><![CDATA[ </body> ]]></svg></html>';
    const out = injectLiveArtifactPaintReporter(html, NONCE);

    expect(
      producerIndex(out),
      'CDATA content in foreign markup is character data, not a body close for this document',
    ).toBeLessThan(out.indexOf('<svg>'));
  });

  it('reads a CDATA section to `]]>`, not to the first `>` inside it', () => {
    // The half that separates a CDATA section from a bogus comment: in foreign
    // content the section ends at `]]>`, so a `>` written before the decoy does
    // not hand the rest of the section back to the markup scan.
    const html =
      '<!doctype html><html><body><h1>Artifact</h1></body>' +
      '<svg><![CDATA[ a > b </body> ]]></svg></html>';
    const out = injectLiveArtifactPaintReporter(html, NONCE);

    expect(producerIndex(out)).toBeLessThan(out.indexOf('<svg>'));
  });

  it('still finds a genuine body close written after a bogus comment', () => {
    // The other side of the rule: stepping over a bogus comment must not step
    // over the document, or a healthy artifact loses its producer to an EOF
    // append it did not need.
    const html =
      '<!doctype html><html><body><?bogus x ?><h1>Artifact</h1></body></html>';
    const out = injectLiveArtifactPaintReporter(html, NONCE);

    expect(producerIndex(out)).toBeGreaterThan(out.indexOf('<h1>Artifact</h1>'));
    expect(producerIndex(out)).toBeLessThan(out.indexOf('</body>'));
  });
});

// W2H.1d red spec — D-17 dialogue round 4, blocking finding "producer
// duplication through adjacent G", body-close half. The scan ended a comment
// at `-->` alone, so a comment the tokenizer had already closed kept running
// in the scan and swallowed the document's genuine body close with it.
//
// The three closes the tokenizer accepts and the scan did not:
//   - `--!>` — comment-end-bang state
//     (https://html.spec.whatwg.org/multipage/parsing.html#comment-end-bang-state);
//   - `<!-->` and `<!--->` — abrupt-closing-of-empty-comment, complete comments
//     of their own (#comment-start-state, #comment-start-dash-state).
//
// Every case below writes the genuine close after one of those, and a decoy
// `</body>` inside a later real comment. Reading only `-->` runs the first
// comment to the END of the later one, loses the genuine close, and appends
// the producer at EOF — a document that never gets to report itself.
describe('a comment ends where the tokenizer ends it', () => {
  const CLOSES: ReadonlyArray<{ close: string; state: string }> = [
    { close: '<!-- note --!>', state: 'comment-end-bang' },
    { close: '<!-->', state: 'abrupt-closing-of-empty-comment' },
    { close: '<!--->', state: 'abrupt-closing-of-empty-comment, one dash in' },
  ];

  for (const { close, state } of CLOSES) {
    it(`finds the body close after a \`${close}\` comment (${state})`, () => {
      const html =
        `<!doctype html><html><body>${close}<h1>Artifact</h1></body>` +
        '<!-- </body> --></html>';
      const out = injectLiveArtifactPaintReporter(html, NONCE);

      expect(
        producerIndex(out),
        'the comment ended before the artifact, so the body close after it is the genuine one',
      ).toBeGreaterThan(out.indexOf('<h1>Artifact</h1>'));
      expect(
        producerIndex(out),
        'a comment read as running past its close swallows the genuine body close',
      ).toBeLessThan(out.indexOf('</body>'));
    });
  }

  it('reads `--!` followed by dashes the way the tokenizer does', () => {
    // Round-1 and round-2 track audits both claimed `--!->` closes a comment,
    // round 2 on the basis that comment-end-DASH state has the same abrupt `>`
    // close that comment-START-dash has. It does not: comment-end-dash takes
    // `-` to comment-end state and sends EVERY OTHER character, `>` included,
    // back into the comment state with a `-` appended
    // (https://html.spec.whatwg.org/multipage/parsing.html#comment-end-bang-state,
    // #comment-end-dash-state — and contrast #comment-start-dash-state, which
    // is where the abrupt close lives). The two states look alike and behave
    // differently, which is why the browser's answer is measured rather than
    // argued: `e2e/ui/preview-comment-close.test.ts` parses all ten spellings
    // in Chromium and is the other half of this case.
    //
    // Ending a comment early is not the safe direction here. It hands the
    // splice point to a `</body>` written inside comment text, where the
    // producer is a comment and never runs — the failure this whole file
    // exists to prevent.
    //
    // What DOES close after a `--!` is another `--` or another `--!`, and both
    // spellings are pinned here beside the one that does not.
    const closing =
      '<!doctype html><html><body><!-- note --!--><h1>Artifact</h1></body><!-- </body> --></html>';
    const closingOut = injectLiveArtifactPaintReporter(closing, NONCE);
    expect(
      producerIndex(closingOut),
      '`--!-->` reaches comment-end through comment-end-dash and closes there',
    ).toBeGreaterThan(closingOut.indexOf('<h1>Artifact</h1>'));
    expect(producerIndex(closingOut)).toBeLessThan(closingOut.indexOf('</body>'));

    const bangAgain =
      '<!doctype html><html><body><!-- note --!--!><h1>Artifact</h1></body><!-- </body> --></html>';
    const bangAgainOut = injectLiveArtifactPaintReporter(bangAgain, NONCE);
    expect(producerIndex(bangAgainOut)).toBeGreaterThan(bangAgainOut.indexOf('<h1>Artifact</h1>'));
    expect(producerIndex(bangAgainOut)).toBeLessThan(bangAgainOut.indexOf('</body>'));

    // And the two that do not close. The comment swallows the rest of the
    // document for the parser too — measured, not assumed — so no body close is
    // reachable and the EOF append is the honest placement: the response is not
    // corrupted, and the preview reaches the watchdog's named failure.
    const unclosed = '<!doctype html><html><body><!-- note --!-><h1>Artifact</h1></body></html>';
    const unclosedOut = injectLiveArtifactPaintReporter(unclosed, NONCE);
    expect(
      unclosedOut.startsWith(unclosed),
      'nothing was spliced into a comment the parser never leaves',
    ).toBe(true);
    expect(producerIndex(unclosedOut)).toBeGreaterThan(unclosed.length - 1);

    const oneDash = '<!doctype html><html><body><!-- note -><h1>Artifact</h1></body></html>';
    const oneDashOut = injectLiveArtifactPaintReporter(oneDash, NONCE);
    expect(
      oneDashOut.startsWith(oneDash),
      'a single `-` before the bracket is comment data, not a close; ending the comment there ' +
        'would select the body close inside it',
    ).toBe(true);
  });

  it('still runs an ordinary comment to its `-->`', () => {
    // The other side of the same rule: ending a comment early would select a
    // decoy, which is the failure this whole file exists to prevent.
    const html =
      '<!doctype html><html><body><!-- a - b -- c </body> --><h1>Artifact</h1></body></html>';
    const out = injectLiveArtifactPaintReporter(html, NONCE);

    expect(producerIndex(out)).toBeGreaterThan(out.indexOf('<h1>Artifact</h1>'));
    expect(producerIndex(out)).toBeLessThan(out.lastIndexOf('</body>'));
  });
});

// W2H.1d red spec — D-17 dialogue round 4, adjacent B. The raw-text opener was
// not quote-aware, so a `</script>` written inside the START tag's attribute
// value ended the raw-text region there.
//
// GPT-5.6 round 4: "`<script src=\"a</script>b\">const x=\"</body>\"</script>`
// makes `rawTextElementEnd` stop inside the quoted start tag; with this after
// the genuine body close, the scanner selects the script-data decoy."
//
// The marker attribute parser already steps over quoted values; the raw-text
// opener has to read the same tag the same way.
describe('the raw-text region starts after the start tag, quotes included', () => {
  it('ignores a decoy </body> in script text under a start tag whose attribute holds `</script>`', () => {
    const html =
      '<!doctype html><html><body><h1>Artifact</h1></body>' +
      '<script src="a</script>b">const x="</body>"</script></html>';
    const out = injectLiveArtifactPaintReporter(html, NONCE);

    expect(
      producerIndex(out),
      'the `</script>` inside the attribute value is character data; the script text after it is still script text',
    ).toBeLessThan(out.indexOf('<script src='));
  });
});
