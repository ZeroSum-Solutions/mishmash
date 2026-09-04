// @vitest-environment jsdom
// W2I.2 red spec (F5) — the srcDoc transport splices the paint producer by the
// same rule the daemon uses.
//
// A preview proves it rendered by running the producer the transport carries.
// The daemon-served transports place it with a state-aware scan for the last
// body close the HTML parser will actually reach, so a `</body>` written inside
// a comment, a raw-text element, a `<template>` or a quoted attribute cannot
// capture the injection
// (`apps/daemon/tests/preview-producer-body-splice.test.ts`).
//
// `buildSrcdoc` places it with a plain `lastIndexOf('</body>')`. A tail as
// ordinary as `</body><!-- </body> --></html>` — a commented-out close left
// behind by an editor — makes it splice the producer INSIDE the comment. The
// document renders exactly as its author wrote it, the producer never runs,
// and the watchdog reports the healthy preview as "Preview did not render".
//
// These cases are the daemon's, restated for the srcDoc transport: one splice
// rule, or a document is watched differently depending on which frame it
// happens to land in.

import { describe, expect, it } from 'vitest';

import { buildSrcdoc } from '../../src/runtime/srcdoc';

/** Where the paint producer landed in the built document. */
function producerIndex(doc: string): number {
  const index = doc.indexOf('data-od-preview-content-size-bridge');
  expect(index, 'every srcDoc preview must carry the paint producer').toBeGreaterThan(-1);
  return index;
}

describe('the srcDoc paint producer is spliced at a genuine body close', () => {
  it('ignores a decoy </body> written inside a trailing HTML comment', () => {
    const doc = buildSrcdoc(
      '<!doctype html><html><body><h1>Artifact</h1></body><!-- </body> --></html>',
    );

    expect(
      producerIndex(doc),
      'a producer spliced inside the comment is comment text; it never runs, and the artifact reports as never rendered',
    ).toBeLessThan(doc.indexOf('<!-- '));
  });

  it('ignores a decoy </body> written inside a trailing script literal', () => {
    const doc = buildSrcdoc(
      '<!doctype html><html><body><h1>Artifact</h1></body><script>var s = "</body>";</script></html>',
    );

    expect(
      producerIndex(doc),
      'a producer spliced inside a script string literal is part of that string',
    ).toBeLessThan(doc.indexOf('var s = '));
  });

  it('ignores a decoy </body> written inside a trailing template', () => {
    const doc = buildSrcdoc(
      '<!doctype html><html><body><h1>Artifact</h1></body><template></body></template></html>',
    );

    expect(
      producerIndex(doc),
      "template content is a separate fragment; a producer parked in there never runs in this document",
    ).toBeLessThan(doc.indexOf('<template>'));
  });

  it('ignores a decoy </body> written inside a quoted attribute value', () => {
    const doc = buildSrcdoc(
      '<!doctype html><html><body><h1>Artifact</h1></body><p title="</body>"></p></html>',
    );

    expect(
      producerIndex(doc),
      'a body close inside an attribute value is the value it is, not markup',
    ).toBeLessThan(doc.indexOf('<p title='));
  });
});
