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
