// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  shouldUrlLoadHtmlPreview,
  type UrlLoadDecision,
} from '../../src/components/file-viewer-render-mode';
import { buildSrcdoc, type SrcdocOptions } from '../../src/runtime/srcdoc';

// The HTML preview pipeline must expose no capability the app never supplies.
// The palette hooks were exactly that: `UrlLoadDecision` declared
// `paletteActive` and `shouldUrlLoadHtmlPreview` disqualified URL-load on it,
// `buildSrcdoc` accepted `paletteBridge` / `initialPalette` and injected a
// colour-shift bridge listening for `od:palette`, and no production caller
// ever set any of them — `FileViewer.tsx` omitted `paletteActive` from its
// decision object and passed `paletteBridge: false`. A hook with no producer
// reads as a shipped capability in review and in the docs while doing nothing.
// CANVAS-3's palette half was descoped by the owner on 2026-09-03 (decision
// D-13), so the hooks are gone.
//
// Both cases pass an option the app never has to give and assert the module
// ignores it, so the hooks cannot return unnoticed.

describe('render-mode decision — no palette hook', () => {
  const base: UrlLoadDecision = {
    mode: 'preview',
    isDeck: false,
    commentMode: false,
    forceInline: false,
  };

  it('URL-loads a plain HTML preview even when a caller sets a palette flag', () => {
    const withPaletteFlag = { ...base, paletteActive: true } as unknown as UrlLoadDecision;

    expect(shouldUrlLoadHtmlPreview(base)).toBe(true);
    expect(shouldUrlLoadHtmlPreview(withPaletteFlag)).toBe(true);
  });
});

describe('buildSrcdoc — no palette bridge', () => {
  const doc =
    '<!doctype html><html><head><style>:root { --bg: #ff5a3c; }</style></head>' +
    '<body><main>Hero</main></body></html>';

  it('injects no palette bridge and no od:palette listener when a caller asks for one', () => {
    const srcdoc = buildSrcdoc(doc, {
      selectionBridge: true,
      editBridge: true,
      paletteBridge: true,
      initialPalette: 'electric',
    } as unknown as SrcdocOptions);

    // Report the markers themselves rather than diffing the whole srcdoc:
    // a failure should name the hook that came back, not print the document.
    const paletteMarkers = ['data-od-palette-bridge', 'od:palette'].filter((marker) =>
      srcdoc.includes(marker),
    );

    expect(paletteMarkers).toEqual([]);
  });

  it('keeps the neighbouring bridges the palette injection sat between', () => {
    // injectPaletteBridge was the middle step of
    // `withSelection -> withPalette -> withEdit`; removing it must re-thread
    // that chain rather than drop a neighbour.
    const srcdoc = buildSrcdoc(doc, { selectionBridge: true, editBridge: true });

    const neighbours = ['data-od-selection-bridge', 'data-od-edit-bridge', 'data-od-tweaks-bridge'];

    expect(neighbours.filter((marker) => srcdoc.includes(marker))).toEqual(neighbours);
  });
});
