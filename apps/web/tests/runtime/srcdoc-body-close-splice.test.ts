// @vitest-environment jsdom
// W2I.2 red spec (F5) — the srcDoc transport splices the paint producer by the
// same rule the daemon uses.
//
// A preview proves it rendered by running the producer the transport carries.
// The daemon-served transports place it with a state-aware scan for the last
// body close the HTML parser will actually reach, so a `</body>` written inside
// a comment, a raw-text element, a `<template>` or a quoted attribute cannot
// capture the injection
// (`apps/daemon/tests/preview-producer-body-splice.test.ts`, and the shared
// scanner's own cases in `packages/contracts/tests/body-close-splice.test.ts`).
//
// `buildSrcdoc` placed it with a plain `lastIndexOf('</body>')`. A tail as
// ordinary as `</body><!-- </body> --></html>` — a commented-out close left
// behind by an editor — made it splice EVERY preview bridge, the producer
// included, inside the comment. The document renders exactly as its author
// wrote it, the producer never runs, and the watchdog reports the healthy
// preview as "Preview did not render".
//
// A trailing comment is the shape that reaches this splice intact: the HTML
// parser's "after body" insertion mode appends a comment to the `html` element
// and folds everything else back into the body, so an earlier normalisation
// pass in `buildSrcdoc` has already resolved a trailing script, template or
// attribute decoy. The scanner handles those too — that is what makes it the
// same rule as the daemon's, rather than a rule tuned to one transport — and
// they are exercised against the shared module directly.

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
      '<!doctype html><html><head></head><body><h1>Artifact</h1></body><!-- </body> --></html>',
    );

    expect(
      producerIndex(doc),
      'a producer spliced inside the comment is comment text; it never runs, and the artifact reports as never rendered',
    ).toBeLessThan(doc.indexOf('<!-- '));
  });

  it('ignores a decoy </body> in a trailing comment closed with --!>', () => {
    // `--!>` closes a comment as surely as `-->` does
    // (https://html.spec.whatwg.org/multipage/parsing.html#comment-end-bang-state),
    // so the bytes between are text either way.
    const doc = buildSrcdoc(
      '<!doctype html><html><head></head><body><h1>Artifact</h1></body><!-- </body> --!></html>',
    );

    expect(
      producerIndex(doc),
      'the spelling of the comment close does not change what is inside it',
    ).toBeLessThan(doc.indexOf('<!-- '));
  });
});
