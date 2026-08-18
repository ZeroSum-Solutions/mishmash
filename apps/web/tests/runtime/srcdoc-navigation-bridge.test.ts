// Preview navigation bridge — reproduces and verifies the fix for the
// tester-reported bug: clicking a MULTI-PAGE artifact's OWN in-page nav link
// (e.g. "Meeting Times") inside the srcDoc preview strips all styling and
// shows broken/overlapping unstyled text, every time, even though the
// underlying file renders perfectly when opened directly.
//
// Root cause: the sandboxed preview iframe (`sandbox="allow-scripts
// allow-downloads"`, no `allow-same-origin`) navigates itself straight to the
// raw-file API URL on click — a real browser navigation that escapes
// buildSrcdoc/inlineRelativeAssets entirely. The destination document's own
// relative CSS/JS/image refs are then fetched by that opaque-origin iframe
// directly, and Chromium's Opaque Response Blocking (ORB) refuses every one
// of them even though they are correctly typed and same-host — confirmed
// live against the daemon (`net::ERR_BLOCKED_BY_ORB` on site.css, site.js,
// fonts.css, and the meeting photo).
//
// injectPreviewNavigationBridge intercepts the click and asks the host to
// open the target file through the srcDoc pipeline instead of letting the
// iframe navigate itself. This file:
//
//   1. asserts buildSrcdoc emits the bridge exactly when it can act (a
//      baseHref is set, and the artifact is not a deck), and
//   2. runs the REAL injected script (not a re-implementation) against a
//      harness modeling the previewed document, and checks it forwards only
//      genuine in-project nav clicks to the host.

import { describe, expect, it } from 'vitest';
import * as vm from 'node:vm';
import { buildSrcdoc, PREVIEW_NAVIGATE_MESSAGE } from '../../src/runtime/srcdoc';

const BRIDGE_MARKER = 'data-od-preview-navigation-bridge';

function extractBridgeBody(doc: string): string {
  const match = doc.match(new RegExp(`<script ${BRIDGE_MARKER}>([\\s\\S]*?)<\\/script>`));
  if (!match) throw new Error('navigation bridge script not found in srcDoc');
  return match[1] ?? '';
}

type FakeAnchor = {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
};

function makeAnchor(opts: { href?: string; target?: string; download?: boolean }): FakeAnchor {
  return {
    getAttribute(name) {
      if (name === 'href') return opts.href ?? null;
      if (name === 'target') return opts.target ?? null;
      return null;
    },
    hasAttribute(name) {
      return name === 'download' ? Boolean(opts.download) : false;
    },
  };
}

// A VM context modeling the previewed document at click time: `document`
// exposes the `<base href>`-resolved `baseURI` and captures the bridge's
// `addEventListener('click', ...)` registration; `window.parent.postMessage`
// is captured so tests can assert what (if anything) the bridge forwarded.
function createBridgeHarness(baseURI: string) {
  const posted: Array<{ type?: string; path?: string }> = [];
  let clickHandler: ((ev: unknown) => void) | null = null;
  const ctx = vm.createContext({});
  vm.runInContext('this.window = this; this.globalThis = this;', ctx);
  const context = ctx as unknown as {
    window: { parent: unknown };
    document: { baseURI: string; addEventListener: (type: string, handler: (ev: unknown) => void, capture?: boolean) => void };
    URL: typeof URL;
  };
  context.document = {
    baseURI,
    addEventListener(type, handler) {
      if (type === 'click') clickHandler = handler;
    },
  };
  context.URL = URL;
  context.window.parent = { postMessage: (msg: { type?: string; path?: string }) => posted.push(msg) };
  return {
    install(scriptBody: string) {
      vm.runInContext(scriptBody, ctx);
    },
    posted,
    click(opts: {
      anchor?: FakeAnchor | null;
      button?: number;
      metaKey?: boolean;
      ctrlKey?: boolean;
      shiftKey?: boolean;
      altKey?: boolean;
    }) {
      if (!clickHandler) throw new Error('click handler not registered');
      let prevented = false;
      const ev = {
        defaultPrevented: false,
        button: opts.button ?? 0,
        metaKey: opts.metaKey ?? false,
        ctrlKey: opts.ctrlKey ?? false,
        shiftKey: opts.shiftKey ?? false,
        altKey: opts.altKey ?? false,
        target: { closest: (sel: string) => (sel === 'a[href]' ? opts.anchor ?? null : null) },
        preventDefault() {
          prevented = true;
        },
      };
      clickHandler(ev);
      return prevented;
    },
  };
}

describe('buildSrcdoc injects the preview navigation bridge', () => {
  it('emits the bridge when a baseHref is set (multi-page artifacts)', () => {
    const doc = buildSrcdoc('<a href="meetings.html">Meeting Times</a>', {
      baseHref: '/api/projects/p1/raw/',
    });
    expect(doc).toContain(BRIDGE_MARKER);
  });

  it('does not emit the bridge without a baseHref — nothing to resolve against', () => {
    const doc = buildSrcdoc('<a href="meetings.html">Meeting Times</a>');
    expect(doc).not.toContain(BRIDGE_MARKER);
  });

  it('does not emit the bridge for decks — they own click-driven slide navigation', () => {
    const doc = buildSrcdoc('<a href="meetings.html">Meeting Times</a>', {
      baseHref: '/api/projects/p1/raw/',
      deck: true,
    });
    expect(doc).not.toContain(BRIDGE_MARKER);
  });
});

describe('injected navigation bridge routes in-project nav clicks to the host', () => {
  const bridgeBody = extractBridgeBody(
    buildSrcdoc('<a href="meetings.html">Meeting Times</a>', {
      baseHref: '/api/projects/p1/raw/',
    }),
  );

  it('forwards a click on a sibling project page and prevents the default navigation', () => {
    const h = createBridgeHarness('https://preview.local/api/projects/p1/raw/');
    h.install(bridgeBody);
    const prevented = h.click({ anchor: makeAnchor({ href: 'meetings.html' }) });
    expect(prevented).toBe(true);
    expect(h.posted).toEqual([{ type: PREVIEW_NAVIGATE_MESSAGE, path: 'meetings.html' }]);
  });

  it('resolves a sibling page correctly when the artifact lives in a project subdirectory', () => {
    const h = createBridgeHarness('https://preview.local/api/projects/p1/raw/zh/');
    h.install(bridgeBody);
    const prevented = h.click({ anchor: makeAnchor({ href: 'join.html' }) });
    expect(prevented).toBe(true);
    expect(h.posted).toEqual([{ type: PREVIEW_NAVIGATE_MESSAGE, path: 'join.html' }]);
  });

  it('leaves an external link alone', () => {
    const h = createBridgeHarness('https://preview.local/api/projects/p1/raw/');
    h.install(bridgeBody);
    const prevented = h.click({ anchor: makeAnchor({ href: 'https://example.com/' }) });
    expect(prevented).toBe(false);
    expect(h.posted).toEqual([]);
  });

  it('leaves a same-page hash link alone', () => {
    const h = createBridgeHarness('https://preview.local/api/projects/p1/raw/');
    h.install(bridgeBody);
    const prevented = h.click({ anchor: makeAnchor({ href: '#pricing' }) });
    expect(prevented).toBe(false);
    expect(h.posted).toEqual([]);
  });

  it('leaves a target="_blank" link alone', () => {
    const h = createBridgeHarness('https://preview.local/api/projects/p1/raw/');
    h.install(bridgeBody);
    const prevented = h.click({ anchor: makeAnchor({ href: 'meetings.html', target: '_blank' }) });
    expect(prevented).toBe(false);
    expect(h.posted).toEqual([]);
  });

  it('leaves a download link alone', () => {
    const h = createBridgeHarness('https://preview.local/api/projects/p1/raw/');
    h.install(bridgeBody);
    const prevented = h.click({ anchor: makeAnchor({ href: 'meetings.html', download: true }) });
    expect(prevented).toBe(false);
    expect(h.posted).toEqual([]);
  });

  it('leaves a modified click (ctrl/cmd/shift/alt — open in new tab) alone', () => {
    const h = createBridgeHarness('https://preview.local/api/projects/p1/raw/');
    h.install(bridgeBody);
    const prevented = h.click({ anchor: makeAnchor({ href: 'meetings.html' }), ctrlKey: true });
    expect(prevented).toBe(false);
    expect(h.posted).toEqual([]);
  });

  it('does nothing when the click did not target a link', () => {
    const h = createBridgeHarness('https://preview.local/api/projects/p1/raw/');
    h.install(bridgeBody);
    const prevented = h.click({ anchor: null });
    expect(prevented).toBe(false);
    expect(h.posted).toEqual([]);
  });
});
