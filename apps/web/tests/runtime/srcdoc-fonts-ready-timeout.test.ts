// A stuck web-font load must never hang preview readiness or export capture
// forever (nexu-io/open-design#B1: "waiting for fonts to load" never
// resolved, surviving retries and a full app reopen, right after a finished
// build rendered).
//
// `document.fonts.ready` has no timeout of its own — verified against a real
// browser: an `@font-face` whose src points at an unroutable host leaves the
// font in `status: 'loading'` and `document.fonts.ready` pending forever,
// which is exactly what Playwright's own `page.screenshot()` awaits before
// it will ever capture a frame. `injectExportCaptureBridge`'s `settle()` gate
// (used by the deck/export capture pipeline behind the Download button) and
// `injectPreviewContentSizeBridge`'s font-triggered remeasure both awaited
// `document.fonts.ready` directly, with no fallback — the same unbounded
// shape.
//
// This file proves the REAL injected bridge script — not a re-implementation
// — still reaches a result within `PREVIEW_FONTS_READY_TIMEOUT_MS` even when
// `document.fonts.ready` never settles.

import * as vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

import { buildSrcdoc, PREVIEW_FONTS_READY_TIMEOUT_MS } from '../../src/runtime/srcdoc';

const EXPORT_CAPTURE_MARKER = 'data-od-export-capture-bridge';
const CONTENT_SIZE_MARKER = 'data-od-preview-content-size-bridge';

function extractScript(doc: string, marker: string): string {
  const match = doc.match(new RegExp(`<script ${marker}>([\\s\\S]*?)<\\/script>`));
  if (!match) throw new Error(`${marker} script not found in srcDoc`);
  return match[1] ?? '';
}

describe('injected bridges never await document.fonts.ready unbounded', () => {
  const doc = buildSrcdoc('<h1>hi</h1>');

  it.each([
    ['export-capture settle()', EXPORT_CAPTURE_MARKER],
    ['preview content-size remeasure', CONTENT_SIZE_MARKER],
  ])('%s races document.fonts.ready against PREVIEW_FONTS_READY_TIMEOUT_MS', (_label, marker) => {
    const script = extractScript(doc, marker);
    expect(script).toContain('document.fonts.ready');
    // A bare `document.fonts.ready.then(...)` / `.catch(...)` with no race is
    // exactly the unbounded-hang shape this test guards against — the wait
    // must always be the losing half of a Promise.race against the timeout.
    expect(script).toMatch(
      new RegExp(`Promise\\.race\\(\\[document\\.fonts\\.ready,[^\\]]*${PREVIEW_FONTS_READY_TIMEOUT_MS}`),
    );
  });

  it('export capture still reports back when document.fonts.ready never settles', async () => {
    vi.useFakeTimers();
    try {
      const script = extractScript(doc, EXPORT_CAPTURE_MARKER);
      const posted: Array<{ type?: string; error?: string }> = [];

      const ctx = vm.createContext({});
      vm.runInContext('this.window = this; this.globalThis = this;', ctx);
      const context = ctx as unknown as {
        window: {
          parent: { postMessage: (msg: { type?: string; error?: string }) => void };
          addEventListener: (type: string, cb: (ev: { data: unknown }) => void) => void;
          postMessage: (msg: unknown) => void;
        };
        document: {
          fonts: { ready: Promise<void> };
          images: unknown[];
          getElementById: () => null;
          querySelectorAll: () => unknown[];
        };
        Promise: typeof Promise;
        setTimeout: typeof setTimeout;
        requestAnimationFrame: (cb: () => void) => number;
        Array: typeof Array;
      };

      let messageHandler: ((ev: { data: unknown }) => void) | null = null;
      context.window.addEventListener = (type, cb) => {
        if (type === 'message') messageHandler = cb;
      };
      context.window.postMessage = () => {};
      context.window.parent = { postMessage: (msg) => posted.push(msg) };
      // The font never finishes loading — this is the exact condition the
      // real bug hit (a stalled @font-face network fetch never resolves).
      context.document = {
        fonts: { ready: new Promise<void>(() => {}) },
        images: [],
        getElementById: () => null,
        querySelectorAll: () => [],
      };
      context.Promise = Promise;
      context.setTimeout = setTimeout;
      context.requestAnimationFrame = (cb) => setTimeout(cb, 0) as unknown as number;
      context.Array = Array;

      vm.runInContext(script, ctx);
      expect(messageHandler).toBeTypeOf('function');
      messageHandler!({ data: { type: 'od:export-capture', id: 'x', deck: false, single: true, delay: 0 } });

      await vi.advanceTimersByTimeAsync(PREVIEW_FONTS_READY_TIMEOUT_MS + 500);

      // No __odCaptureSnapshot is wired up in this minimal harness, so once
      // settle() resolves the capture itself fails - the point of this test
      // is that settle() resolves AT ALL within the timeout window instead of
      // leaving the whole export flow hanging forever with zero response.
      expect(posted.length).toBeGreaterThan(0);
      expect(posted[0]?.type).toBe('od:export-capture:error');
    } finally {
      vi.useRealTimers();
    }
  });
});
