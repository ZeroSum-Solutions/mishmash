// Unit coverage for the wrapper shape rule.
//
// The rule decides whether a file is a disposable gallery-preview frame or a
// page someone authored. Getting that wrong in the permissive direction is the
// expensive mistake: a false positive redirects the canvas away from real
// content and, at project-creation time, drops the file from the copy entirely.
// So most of what follows is about what must NOT be classified as a wrapper.

import { describe, expect, it } from 'vitest';

import { parseWrapperIframeSrc, resolveWrapperTarget } from '../src/entry-file-wrapper.js';

const wrap = (body: string, head = '') =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

const alwaysExists = () => true;

describe('parseWrapperIframeSrc', () => {
  it('recognises the shape every user-installed template ships', () => {
    expect(
      parseWrapperIframeSrc(wrap('<iframe src="./assets/index.html" title="x"></iframe>')),
    ).toBe('./assets/index.html');
  });

  it('accepts an unclosed and a self-closing iframe', () => {
    expect(parseWrapperIframeSrc(wrap('<iframe src="a.html">'))).toBe('a.html');
    expect(parseWrapperIframeSrc(wrap('<iframe src="a.html"/>'))).toBe('a.html');
  });

  it('is case-insensitive', () => {
    expect(parseWrapperIframeSrc('<HTML><BODY><IFRAME SRC="a.html"></IFRAME></BODY></HTML>')).toBe(
      'a.html',
    );
  });

  it('tolerates a > inside a quoted attribute', () => {
    expect(parseWrapperIframeSrc(wrap('<iframe title="a > b" src="a.html"></iframe>'))).toBe(
      'a.html',
    );
  });

  it('ignores comments, scripts and styles that sit beside the iframe', () => {
    expect(
      parseWrapperIframeSrc(
        wrap('<!-- note --><style>body{margin:0}</style><iframe src="a.html"></iframe><script>void 0;</script>'),
      ),
    ).toBe('a.html');
  });

  // The regression that matters most: a commented-out block shaped like a
  // wrapper must not be mistaken for the document's real body.
  it('does not treat a commented-out wrapper in the head as the body', () => {
    const html = `<html><head><!-- old: <body><iframe src="./evil.html"></iframe></body> --></head><body><div>Real authored content</div></body></html>`;
    expect(parseWrapperIframeSrc(html)).toBeNull();
  });

  it('refuses a document that declares more than one body', () => {
    const html = `<html><head><meta content="<body><iframe src='x.html'></iframe></body>"></head><body><iframe src="a.html"></iframe></body></html>`;
    expect(parseWrapperIframeSrc(html)).toBeNull();
  });

  it('refuses a body with anything else in it', () => {
    expect(parseWrapperIframeSrc(wrap('<div class="top">Title</div><iframe src="a.html"></iframe>'))).toBeNull();
    expect(parseWrapperIframeSrc(wrap('<iframe src="a.html"></iframe><p>caption</p>'))).toBeNull();
    expect(parseWrapperIframeSrc(wrap('<iframe src="a.html"></iframe><iframe src="b.html"></iframe>'))).toBeNull();
    expect(parseWrapperIframeSrc(wrap('text<iframe src="a.html"></iframe>'))).toBeNull();
  });

  it('refuses an iframe with no src', () => {
    expect(parseWrapperIframeSrc(wrap('<iframe srcdoc="<p>hi</p>"></iframe>'))).toBeNull();
  });

  it('refuses a document with no body at all', () => {
    expect(parseWrapperIframeSrc('<iframe src="a.html"></iframe>')).toBeNull();
  });

  it('refuses anything over the byte cap', () => {
    const padding = '<!--' + 'x'.repeat(9000) + '-->';
    expect(parseWrapperIframeSrc(wrap('<iframe src="a.html"></iframe>', padding))).toBeNull();
  });
});

describe('resolveWrapperTarget', () => {
  it('resolves relative to the wrapper own directory', () => {
    expect(
      resolveWrapperTarget(wrap('<iframe src="./index.html"></iframe>'), 'preview/example.html', alwaysExists),
    ).toBe('preview/index.html');
  });

  it('strips a query and a fragment', () => {
    expect(
      resolveWrapperTarget(wrap('<iframe src="./a.html?v=2#top"></iframe>'), 'example.html', alwaysExists),
    ).toBe('a.html');
  });

  it('decodes percent-encoding', () => {
    expect(
      resolveWrapperTarget(wrap('<iframe src="./my%20site.html"></iframe>'), 'example.html', alwaysExists),
    ).toBe('my site.html');
  });

  it('refuses to leave the project root', () => {
    for (const src of ['../outside.html', './../../etc/passwd.html', '/abs.html', '//cdn.example/a.html']) {
      expect(
        resolveWrapperTarget(wrap(`<iframe src="${src}"></iframe>`), 'example.html', alwaysExists),
      ).toBeNull();
    }
  });

  it('refuses remote and non-file schemes, encoded or not', () => {
    for (const src of ['https://example.com/a.html', 'data:text/html,x.html', 'data%3Atext/html,x.html']) {
      expect(
        resolveWrapperTarget(wrap(`<iframe src="${src}"></iframe>`), 'example.html', alwaysExists),
      ).toBeNull();
    }
  });

  it('refuses a target that is not HTML', () => {
    expect(
      resolveWrapperTarget(wrap('<iframe src="./demo.mp4"></iframe>'), 'example.html', alwaysExists),
    ).toBeNull();
  });

  it('refuses a target that does not exist', () => {
    expect(
      resolveWrapperTarget(wrap('<iframe src="./missing.html"></iframe>'), 'example.html', () => false),
    ).toBeNull();
  });

  it('refuses a wrapper that points at itself', () => {
    expect(
      resolveWrapperTarget(wrap('<iframe src="./example.html"></iframe>'), 'example.html', alwaysExists),
    ).toBeNull();
  });
});
