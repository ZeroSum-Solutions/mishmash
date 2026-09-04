import { describe, expect, it } from 'vitest';

import {
  projectRawAssetBaseHref,
  withProjectAssetBaseHref,
} from '../src/runtime/project-asset-base';

describe('projectRawAssetBaseHref', () => {
  it('points at the owner file directory under the project raw route', () => {
    expect(projectRawAssetBaseHref('p1', 'zh/index.html')).toBe('/api/projects/p1/raw/zh/');
  });

  it('points at the project root for a top-level file', () => {
    expect(projectRawAssetBaseHref('p1', 'index.html')).toBe('/api/projects/p1/raw/');
  });

  it('points at the project root for a document that is not a project file', () => {
    expect(projectRawAssetBaseHref('p1', '')).toBe('/api/projects/p1/raw/');
  });

  it('encodes each path segment on its own so slashes stay separators', () => {
    expect(projectRawAssetBaseHref('a b/c', 'my dir/sub #1/page.html')).toBe(
      '/api/projects/a%20b%2Fc/raw/my%20dir/sub%20%231/',
    );
  });

  it('drops empty segments rather than emitting a doubled or leading slash', () => {
    expect(projectRawAssetBaseHref('p1', 'a//page.html')).toBe('/api/projects/p1/raw/a/');
    expect(projectRawAssetBaseHref('p1', '/a/page.html')).toBe('/api/projects/p1/raw/a/');
  });

  it('resolves a relative ref to the project file it names', () => {
    const base = new URL(projectRawAssetBaseHref('p1', 'zh/index.html'), 'http://d');
    expect(new URL('../assets/pic.png', base).pathname).toBe('/api/projects/p1/raw/assets/pic.png');
  });
});

describe('withProjectAssetBaseHref', () => {
  it('injects the base first inside an existing head', () => {
    expect(withProjectAssetBaseHref('<html><head><title>t</title></head></html>', '/api/projects/p1/raw/')).toBe(
      '<html><head><base href="/api/projects/p1/raw/"><title>t</title></head></html>',
    );
  });

  it('wins over a base the document already declares', () => {
    const out = withProjectAssetBaseHref('<html><head><base href="/elsewhere/"></head></html>', '/api/projects/p1/raw/');
    expect(out.indexOf('/api/projects/p1/raw/')).toBeLessThan(out.indexOf('/elsewhere/'));
  });

  it('drops a base the document declares ahead of the insertion point', () => {
    // The parser hoists this one into the head it creates, ahead of the
    // injected tag, so leaving it in place would let the page rebase itself.
    expect(
      withProjectAssetBaseHref('<base href="/evil/"><html><head><title>t</title></head></html>', '/api/projects/p1/raw/'),
    ).toBe('<html><head><base href="/api/projects/p1/raw/"><title>t</title></head></html>');
  });

  it('drops a hoisted base when the document has no head of its own', () => {
    expect(
      withProjectAssetBaseHref('<!doctype html><base href="/evil/"><html><body>hi</body></html>', '/api/projects/p1/raw/'),
    ).toBe('<!doctype html><html><head><base href="/api/projects/p1/raw/"></head><body>hi</body></html>');
  });

  it('leaves a commented-out base ahead of the head alone', () => {
    expect(
      withProjectAssetBaseHref('<!-- <base href="/evil/"> --><html><head></head></html>', '/api/projects/p1/raw/'),
    ).toBe('<!-- <base href="/evil/"> --><html><head><base href="/api/projects/p1/raw/"></head></html>');
  });

  it('adds a head when the document has none', () => {
    expect(withProjectAssetBaseHref('<html><body>hi</body></html>', '/api/projects/p1/raw/')).toBe(
      '<html><head><base href="/api/projects/p1/raw/"></head><body>hi</body></html>',
    );
  });

  it('prefixes a fragment that has no html element', () => {
    expect(withProjectAssetBaseHref('<p>hi</p>', '/api/projects/p1/raw/')).toBe(
      '<base href="/api/projects/p1/raw/"><p>hi</p>',
    );
  });

  it('skips a head written inside a comment', () => {
    const out = withProjectAssetBaseHref(
      '<html><!-- <head><base href="/decoy/"></head> --><head><title>t</title></head></html>',
      '/api/projects/p1/raw/',
    );
    expect(out).toContain('<head><base href="/api/projects/p1/raw/"><title>t</title></head>');
    expect(out).toContain('<!-- <head><base href="/decoy/"></head> -->');
  });

  it('escapes the href so it cannot break out of the attribute', () => {
    expect(withProjectAssetBaseHref('<html><head></head></html>', '/raw/"><script>x</script>')).toContain(
      '<base href="/raw/&quot;><script>x</script>">',
    );
  });
});

// F13 in proof/w2/codex-wave-r1.json: the drop that keeps the injected base
// first in tree order must remove only tags an HTML parser would read as
// `<base>` elements, and must never join the bytes around a removal into markup
// the input did not contain. Every input below is verbatim from the 2.4 fresh
// review (proof/w2/2.4-review-r2.json), which produced the failing outputs
// against the shipped build; the parsed-shape half of the same claim lives in
// apps/web/tests/components/project-asset-base-equivalence.test.ts, where a DOM
// is available.
describe('withProjectAssetBaseHref edits only real base elements', () => {
  const BASE = '/api/projects/p1/raw/';

  it('leaves text that only looks like a base alone rather than forging one', () => {
    // `<ba<base` is a single tag name to the tokenizer, so this document has no
    // base element at all. Splicing one out of the middle of it would mint one.
    expect(
      withProjectAssetBaseHref('<ba<base href="x">se href="/evil/"><html><head><title>t</title></head></html>', BASE),
    ).toBe(
      '<ba<base href="x">se href="/evil/"><html><head><base href="/api/projects/p1/raw/"><title>t</title></head></html>',
    );
  });

  it('forges no script element out of the bytes around a base-looking token', () => {
    expect(
      withProjectAssetBaseHref('<scr<base href="x">ipt>window.PWNED=1;</script><html><head></head></html>', BASE),
    ).toBe(
      '<scr<base href="x">ipt>window.PWNED=1;</script><html><head><base href="/api/projects/p1/raw/"></head></html>',
    );
  });

  it('leaves a base written inside script text alone', () => {
    // Raw-text content is not markup: this base is a JavaScript string, so the
    // parser never hoists it and the transform must not touch the script body.
    expect(
      withProjectAssetBaseHref('<script>var s="<base href=\\"/evil/\\">";</script><html><head></head></html>', BASE),
    ).toBe(
      '<script>var s="<base href=\\"/evil/\\">";</script><html><head><base href="/api/projects/p1/raw/"></head></html>',
    );
  });

  it('leaves a base inside a template alone', () => {
    // Template content parses into a separate fragment, so this base is not in
    // the document's tree order and cannot outrank the injected one.
    expect(
      withProjectAssetBaseHref('<template><base href="/evil/"></template><html><head></head></html>', BASE),
    ).toBe(
      '<template><base href="/evil/"></template><html><head><base href="/api/projects/p1/raw/"></head></html>',
    );
  });

  it('drops the whole base tag when a quoted attribute value contains a >', () => {
    // `a>b` is an attribute value, not the end of the tag, so removing up to the
    // quoted `>` would leave `b">` behind as stray text.
    expect(withProjectAssetBaseHref('<base href="a>b"><html><head><title>t</title></head></html>', BASE)).toBe(
      '<html><head><base href="/api/projects/p1/raw/"><title>t</title></head></html>',
    );
  });
});

// Round-1 track audit (proof/w2fix/2G.4-glm-r1.json), findings 1 and 2. Removing
// a real base is only safe if the bytes it sat between cannot join into markup,
// and a start tag the input never closes is a tag no parser emits.
describe('withProjectAssetBaseHref keeps a removal from opening a tag', () => {
  const BASE = '/api/projects/p1/raw/';

  it('escapes a stray < left touching the gap where a base was', () => {
    // `<` before `<base` is text: the tokenizer only opens a tag on a letter.
    // Cutting the base out would push that `<` against `base href="/evil/">`
    // and mint the base this function exists to outrank.
    expect(
      withProjectAssetBaseHref('<<base href="x">base href="/evil/"><html><head><title>t</title></head></html>', BASE),
    ).toBe(
      '&lt;base href="/evil/"><html><head><base href="/api/projects/p1/raw/"><title>t</title></head></html>',
    );
  });

  it('escapes a stray < rather than letting a removal mint a script', () => {
    expect(
      withProjectAssetBaseHref('<<base href="x">script>window.PWNED=1;</script><html><head></head></html>', BASE),
    ).toBe(
      '&lt;script>window.PWNED=1;</script><html><head><base href="/api/projects/p1/raw/"></head></html>',
    );
  });

  it('ignores a head start tag the document never closes', () => {
    // A tag still open at the end of the input is never emitted, so `<head` is
    // not this document's head; appending to it would make `head<base` one tag
    // and the preview would carry no base at all.
    expect(withProjectAssetBaseHref('<html><head', BASE)).toBe(
      '<html><head><base href="/api/projects/p1/raw/"></head><head',
    );
  });

  it('ignores an html start tag the document never closes', () => {
    expect(withProjectAssetBaseHref('<html', BASE)).toBe('<base href="/api/projects/p1/raw/"><html');
  });

  it('reads <!--> as the empty comment it is', () => {
    expect(
      withProjectAssetBaseHref('<!--><base href="/evil/"><html><head><title>t</title></head></html>', BASE),
    ).toBe('<!--><html><head><base href="/api/projects/p1/raw/"><title>t</title></head></html>');
  });
});

// Round-3 track audit (proof/w2fix/2G.4-glm-r3.json). Script content is not
// plain raw text: `<!--` opens an escaped region and a `<script` inside that
// opens a double-escaped one, where a `</script>` closes only the nesting. Ending
// the element at the first `</script>` reads the rest of the script body as
// markup, which put a base written in script text back in reach of the drop --
// the case pinned above, one nesting deeper.
describe('withProjectAssetBaseHref reads a script to the end the parser gives it', () => {
  const BASE = '/api/projects/p1/raw/';

  it('leaves a base written after a nested </script> inside script text alone', () => {
    expect(
      withProjectAssetBaseHref(
        '<script><!--<script></script><base href="/evil/">--></script><head><title>t</title></head>',
        BASE,
      ),
    ).toBe(
      '<script><!--<script></script><base href="/evil/">--></script><head><base href="/api/projects/p1/raw/"><title>t</title></head>',
    );
  });

  it('finds the real head after a script whose text holds one', () => {
    expect(
      withProjectAssetBaseHref(
        '<script><!--<script><head></script>--></script><head><title>t</title></head>',
        BASE,
      ),
    ).toBe(
      '<script><!--<script><head></script>--></script><head><base href="/api/projects/p1/raw/"><title>t</title></head>',
    );
  });
});

// Round-4 track audit (proof/w2fix/2G.4-glm-r4.json), finding 3. A comment does
// not only close on `-->`: the tokenizer's comment-end-bang state closes it on
// `--!>` too. Reading only `-->` runs the comment on past a `<base>` the parser
// treats as a real element, so the tag stays and outranks the injected one --
// the re-rooting this module exists to close.
describe('withProjectAssetBaseHref closes a comment where the parser closes it', () => {
  const BASE = '/api/projects/p1/raw/';

  it('drops a base the document writes after a --!> comment close', () => {
    expect(
      withProjectAssetBaseHref(
        '<!-- --!><base href="/evil/"> --><html><head><title>t</title></head></html>',
        BASE,
      ),
    ).toBe('<!-- --!> --><html><head><base href="/api/projects/p1/raw/"><title>t</title></head></html>');
  });

  it('finds the head after a --!> comment close', () => {
    expect(
      withProjectAssetBaseHref(
        '<!-- a --!><base href="/evil/"><html><head><title>t</title></head></html>',
        BASE,
      ),
    ).toBe('<!-- a --!><html><head><base href="/api/projects/p1/raw/"><title>t</title></head></html>');
  });
});

// Round-4 track audit findings 1 and 2, both refuted against jsdom (see
// proof/w2fix/2G.4-glm-r4-response.md) and kept as cases so the two properties
// stay pinned: `-->` ends a script's double-escaped region the way it ends its
// escaped one, and a second `=` before a quoted value is read as the start of an
// unquoted value, so the tag really does end at the quoted `>`.
describe('withProjectAssetBaseHref agrees with the tokenizer on two shapes the audit queried', () => {
  const BASE = '/api/projects/p1/raw/';

  it('ends a script at the first </script> after a --> leaves its double-escaped region', () => {
    expect(
      withProjectAssetBaseHref(
        '<script><!--<script>-->y</script><head></head>--></script><html><head><title>t</title></head>',
        BASE,
      ),
    ).toBe(
      '<script><!--<script>-->y</script><head><base href="/api/projects/p1/raw/"></head>--></script><html><head><title>t</title></head>',
    );
  });

  it('drops the base tag a doubled = ends at the quoted >', () => {
    expect(
      withProjectAssetBaseHref('<base href=="a>b"><html><head><title>t</title></head></html>', BASE),
    ).toBe('b"><html><head><base href="/api/projects/p1/raw/"><title>t</title></head></html>');
  });
});

// Round-5 track audit (proof/w2fix/2G.4-glm-r5.json), finding 1, refuted against
// jsdom (see proof/w2fix/2G.4-glm-r5-response.md) and kept as cases so the
// property stays pinned. The auditor reads comment-end-DASH as closing on `>`;
// only comment-START-dash does (13.2.5.44), which is what makes `<!--->` close.
// After `--!` the tokenizer sits in comment-end-dash, so the `>` of `--!->` is
// comment content and a `<base>` written past it is inside the comment -- the
// one place such a tag must be left alone rather than dropped.
describe('withProjectAssetBaseHref treats a --!-> as comment content, not a close', () => {
  const BASE = '/api/projects/p1/raw/';

  it('keeps a base written after a --!-> inside the comment that holds it', () => {
    expect(
      withProjectAssetBaseHref(
        '<!-- x --!-><base href="/evil/"> --><html><head><title>t</title></head></html>',
        BASE,
      ),
    ).toBe(
      '<!-- x --!-><base href="/evil/"> --><html><head><base href="/api/projects/p1/raw/"><title>t</title></head></html>',
    );
  });

  it('reads a comment a --!-> never closes to the end of the input', () => {
    expect(
      withProjectAssetBaseHref(
        '<!-- x --!-><base href="/evil/"><html><head><title>t</title></head></html>',
        BASE,
      ),
    ).toBe(
      '<base href="/api/projects/p1/raw/"><!-- x --!-><base href="/evil/"><html><head><title>t</title></head></html>',
    );
  });

  it('drops a base written after a --!--> , which does close the comment', () => {
    expect(
      withProjectAssetBaseHref(
        '<!-- x --!--><base href="/evil/"> --><html><head><title>t</title></head></html>',
        BASE,
      ),
    ).toBe(
      '<!-- x --!--> --><html><head><base href="/api/projects/p1/raw/"><title>t</title></head></html>',
    );
  });
});
