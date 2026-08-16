// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { DECK_SLIDE_SELECTOR } from '@open-design/contracts/runtime/deck-stage-fallback';
import { buildSrcdoc } from '../../src/runtime/srcdoc';

// CANVAS-14. Three places in this repository decide "what counts as a slide",
// and one of them disagreed with the other two.
//
//   - the runtime <deck-stage> fallback  → DECK_SLIDE_SELECTOR
//   - the off-screen renderer            → DECK_SLIDE_SELECTOR
//   - this srcDoc host bridge            → `.slide` only
//
// DECK_SLIDE_SELECTOR is `.slide, [data-screen-label], .deck-slide, .ppt-slide`.
// A deck built from `<deck-stage>` / `data-screen-label` with no literal `.slide`
// therefore reported `count: 0` to the host, the viewer never learned an active
// index, and `planDeckImageCapture` refused the off-screen renderer for it —
// rendering with no index stitches EVERY slide, which is a wrong answer to
// "capture the current slide" rather than a degraded one. Copy screenshot of any
// slide but the first simply failed.
//
// The renderer could always have served these decks: its own selector matches
// them and it can screenshot slide N. Only the host's half of the agreement was
// missing.

function extractDeckBridgeScript(srcdoc: string): string {
  const match = srcdoc.match(/<script data-od-deck-bridge>([\s\S]*?)<\/script>/);
  if (!match || !match[1]) {
    throw new Error('deck bridge script not found in srcdoc');
  }
  return match[1];
}

function setupDeckBridge(bodyHtml: string) {
  const srcdoc = buildSrcdoc(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    deck: true,
  });
  const script = extractDeckBridgeScript(srcdoc);
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  const parentPostMessage = vi.fn();
  Object.defineProperty(win, 'parent', {
    configurable: true,
    value: { postMessage: parentPostMessage },
  });
  const evaluate = new win.Function(script);
  evaluate.call(win);
  // jsdom fires `load` during construction, before the bridge installs its
  // listener; replay it so the first-paint report() runs as it would in a real
  // preview iframe.
  win.dispatchEvent(new win.Event('load'));
  return { dom, win, parentPostMessage };
}

function lastSlideState(parentPostMessage: ReturnType<typeof vi.fn>) {
  const messages = parentPostMessage.mock.calls
    .map((call) => call[0])
    .filter((m) => m?.type === 'od:slide-state');
  return messages.at(-1);
}

const settle = (win: { setTimeout: (fn: () => void, ms: number) => unknown }) =>
  new Promise<void>((resolve) => win.setTimeout(resolve, 350));

describe('deck bridge — runtime-managed decks (CANVAS-14)', () => {
  it('counts data-screen-label screens in a deck that ships no .slide markup', async () => {
    const screens = ['Cover', 'Problem', 'Solution']
      .map((label) => `<section data-screen-label="${label}">${label}</section>`)
      .join('');
    const { win, parentPostMessage } = setupDeckBridge(`<deck-stage>${screens}</deck-stage>`);
    await settle(win);

    const state = lastSlideState(parentPostMessage);
    expect(state).toBeDefined();
    expect(state.count).toBe(3);
  });

  it('reports which screen is active, so a current-slide capture has an index to use', async () => {
    // `active` is the whole point: without it the viewer has no index to hand
    // the renderer, which is what made this capture fail rather than degrade.
    const screens = ['Cover', 'Problem', 'Solution']
      .map((label, i) =>
        `<section data-screen-label="${label}" class="${i === 1 ? 'active' : ''}">${label}</section>`,
      )
      .join('');
    const { win, parentPostMessage } = setupDeckBridge(`<deck-stage>${screens}</deck-stage>`);
    await settle(win);

    expect(lastSlideState(parentPostMessage)).toMatchObject({ active: 1, count: 3 });
  });

  it('indexes screens the same way the off-screen renderer does', async () => {
    // The host's index is only meaningful if the renderer resolves the same
    // element for it. Both sides walk document order over the same selector
    // family, so this asserts the two orderings agree rather than trusting that
    // they do.
    const screens = ['Cover', 'Problem', 'Solution', 'Ask']
      .map((label) => `<section data-screen-label="${label}">${label}</section>`)
      .join('');
    const { win, parentPostMessage } = setupDeckBridge(`<deck-stage>${screens}</deck-stage>`);
    await settle(win);

    const rendererOrder = Array.from(win.document.querySelectorAll(DECK_SLIDE_SELECTOR)).map(
      (el) => el.getAttribute('data-screen-label'),
    );
    expect(rendererOrder).toEqual(['Cover', 'Problem', 'Solution', 'Ask']);
    expect(lastSlideState(parentPostMessage).count).toBe(rendererOrder.length);
  });

  it('still prefers .slide markup when a deck has it, and ignores decorative screens', async () => {
    // The broadened selector must stay a FALLBACK. A `.slide` deck that also
    // happens to carry a `data-screen-label` on a wrapper would otherwise start
    // counting that wrapper as an extra slide.
    const slides = Array.from({ length: 3 }, (_, i) => `<section class="slide">${i}</section>`).join('');
    const { win, parentPostMessage } = setupDeckBridge(
      `<div class="deck" data-screen-label="wrapper">${slides}</div>`,
    );
    await settle(win);

    expect(lastSlideState(parentPostMessage)).toMatchObject({ count: 3 });
  });
});
