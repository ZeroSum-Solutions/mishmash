// The one splice rule, stated against the module that owns it.
//
// `apps/daemon` and `apps/web` both inject a paint producer into a preview
// document, and a document watched by the same watchdog must be spliced by the
// same rule whichever frame it lands in. The scanner lives here so both can
// import it; these cases pin what it promises, at the index level, without
// going through either injector.
//
// The injector-level cases stay where they are —
// `apps/daemon/tests/preview-producer-body-splice.test.ts` for the served
// responses, `apps/web/tests/runtime/srcdoc-body-close-splice.test.ts` for the
// srcDoc transport — and now exercise this module through their own callers.

import { describe, expect, it } from 'vitest';

import {
  injectBeforeGenuineBodyClose,
  injectMarkedScriptBeforeBodyClose,
  lastGenuineBodyCloseIndex,
} from '../src/runtime/body-close-splice.js';

const OPEN = '<!doctype html><html><body><h1>Artifact</h1>';

/**
 * Asserts that the body close the scanner picks is the one written between
 * `before` and `after`, and nothing the parser would read as text.
 */
function expectGenuineClose(before: string, after: string): void {
  const html = `${before}</body>${after}`;
  expect(lastGenuineBodyCloseIndex(html)).toBe(before.length);
}

describe('a body close hidden from the parser is not a body close', () => {
  it('reads comment text as text', () => {
    expectGenuineClose(OPEN, '<!-- </body> --></html>');
  });

  it('reads raw-text and RCDATA element content as text', () => {
    expectGenuineClose(`${OPEN}<style>a{} /* </body> */</style>`, '</html>');
    expectGenuineClose(`${OPEN}<textarea></body></textarea>`, '</html>');
    expectGenuineClose(OPEN, '<script>var s = "</body>";</script></html>');
  });

  it('reads a quoted attribute value as the value it is', () => {
    expectGenuineClose(OPEN, '<div title="</body>">tail</div></html>');
    expectGenuineClose(OPEN, "<div title='</body>'>tail</div></html>");
  });

  it('reads template content as a fragment of its own', () => {
    expectGenuineClose(`${OPEN}<template><section></body></section></template>`, '</html>');
    expectGenuineClose(`${OPEN}<template><template></body></template></template>`, '</html>');
  });

  it('reads a bogus comment or markup declaration as text', () => {
    expectGenuineClose(OPEN, '<?bogus </body> ?></html>');
    expectGenuineClose(OPEN, '<!bogus </body> ></html>');
  });

  it('reads a CDATA section in foreign content to its `]]>`', () => {
    expectGenuineClose(OPEN, '<svg><![CDATA[ </body> ]]></svg></html>');
    expectGenuineClose(OPEN, '<svg><![CDATA[ a > b </body> ]]></svg></html>');
  });
});

describe('a comment ends at every spelling the tokenizer accepts', () => {
  // A comment read as running past its close swallows the real markup after
  // it, which loses the document's genuine body close.
  // https://html.spec.whatwg.org/multipage/parsing.html#comment-start-state
  it.each([
    ['-->', 'comment-end'],
    ['--!>', 'comment-end-bang'],
  ])('reaches a body close written after a `%s` comment (%s)', (close) => {
    expectGenuineClose(`${OPEN}<!-- note ${close}`, '</html>');
  });

  it.each([
    ['<!-->', 'comment-start'],
    ['<!--->', 'comment-start-dash'],
  ])('reaches a body close written after an empty `%s` comment (%s)', (empty) => {
    expectGenuineClose(`${OPEN}${empty}`, '</html>');
  });

  it('still runs an ordinary comment to its close', () => {
    expectGenuineClose(`${OPEN}<!-- </body> -->`, '</html>');
  });
});

describe('the honest placement when no body close is reachable', () => {
  it('reports none for a document that has no body close at all', () => {
    expect(lastGenuineBodyCloseIndex('<!doctype html><html><p>Artifact</p></html>')).toBe(-1);
  });

  it('reports none when the only body close is inside an unclosed comment', () => {
    // The parser never leaves the comment, so the bytes after it are text and
    // no script written there runs. Saying "none" is what sends the injection
    // to EOF instead of corrupting the document on the way.
    expect(lastGenuineBodyCloseIndex(`${OPEN}<!-- </body>`)).toBe(-1);
  });

  it('appends at EOF rather than splicing into text', () => {
    const html = `${OPEN}<style>a{} /* </body>`;
    expect(injectBeforeGenuineBodyClose(html, '<script></script>')).toBe(
      `${html}<script></script>`,
    );
  });
});

describe('a document is only credited with a producer it actually carries', () => {
  const MARKER = 'data-od-paint';
  const INJECTION = `<script ${MARKER}></script>`;

  it('injects into a document that merely mentions the marker in text', () => {
    const html = `${OPEN}<!-- ${MARKER} --></body></html>`;
    expect(injectMarkedScriptBeforeBodyClose(html, MARKER, INJECTION)).toContain(INJECTION);
  });

  it('injects into a document whose marker sits in another element attribute', () => {
    const html = `${OPEN}<div ${MARKER}></div></body></html>`;
    expect(injectMarkedScriptBeforeBodyClose(html, MARKER, INJECTION)).toContain(INJECTION);
  });

  it('leaves a document that already carries the marked script alone', () => {
    const html = `${OPEN}<script ${MARKER}></script></body></html>`;
    expect(injectMarkedScriptBeforeBodyClose(html, MARKER, INJECTION)).toBe(html);
  });
});
