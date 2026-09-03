// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildSrcdoc } from '../../src/runtime/srcdoc';

// Coverage for the tweaks bridge (`injectTweaksBridge` in srcdoc.ts), which
// design-templates/tweaks/assets/wrap.html's `.tw-panel` / `.tw-hidden`
// contract relies on. The bridge is always injected into every srcDoc build
// (see the comment above `injectTweaksBridge`'s call site: "tying it to a
// per-call option would force iframe srcdoc regeneration ... every time the
// host toggle flips"), so unlike the deck/comment bridges it has no
// `options.*Bridge` flag to gate on.
//
// NOTE ON SCOPE: this file proves the bridge's own postMessage contract
// (availability detection, panel visibility sync, host round-trip) using the
// same "extract the injected <script>, eval it in a JSDOM window with a
// mocked parent" technique the deck-bridge suite uses. It does NOT exercise
// FileViewer.tsx's receive side, because grepping the host for a handler
// (`grep -rn "od:tweaks-available" apps/web/src` outside this file and
// srcdoc.ts) turns up none — see the defect reported alongside this task.

function extractTweaksBridgeScript(srcdoc: string): string {
  const match = srcdoc.match(/<script data-od-tweaks-bridge>([\s\S]*?)<\/script>/);
  if (!match || !match[1]) {
    throw new Error('tweaks bridge script not found in srcdoc');
  }
  return match[1];
}

// Mirrors the real template's default-visible panel markup (design-templates/
// tweaks/assets/wrap.html): `.tw-panel` with no `.tw-hidden` class authored.
const TWEAKS_PANEL_BODY = `
  <aside class="tw-panel" id="tw-panel" aria-label="Tweak panel">
    <header class="tw-head">
      <span class="ttl">Tweaks</span>
      <button class="toggle" id="tw-close">×</button>
    </header>
  </aside>
  <button class="tw-restore" id="tw-restore">T</button>
`;

async function setupBridge(bodyHtml: string) {
  const srcdoc = buildSrcdoc(`<!doctype html><html><body>${bodyHtml}</body></html>`, {});
  const script = extractTweaksBridgeScript(srcdoc);
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    runScripts: 'outside-only',
  });
  const win = dom.window;
  const parentPostMessage = vi.fn();
  Object.defineProperty(win, 'parent', {
    configurable: true,
    value: { postMessage: parentPostMessage },
  });
  new win.Function(script).call(win);
  // The bridge's onReady runs on DOMContentLoaded when the document is still
  // loading, which it is here (JSDOM's `runScripts: 'outside-only'` document
  // only reaches readyState 'complete' asynchronously). Wait it out so
  // postAvailability()/postState() have actually fired before we assert.
  if (win.document.readyState === 'loading') {
    await new Promise<void>((resolve) => {
      win.document.addEventListener('DOMContentLoaded', () => resolve());
    });
  }
  return { win, parentPostMessage, srcdoc };
}

function messagesOfType(parentPostMessage: ReturnType<typeof vi.fn>, type: string) {
  return parentPostMessage.mock.calls.map((call) => call[0]).filter((m) => m?.type === type);
}

describe('tweaks bridge — availability detection (od:tweaks-available)', () => {
  it('is injected unconditionally into every srcDoc build', () => {
    // No `options.tweaksBridge` flag exists — the bridge always ships.
    const srcdoc = buildSrcdoc('<!doctype html><html><body>plain</body></html>', {});
    expect(srcdoc).toContain('data-od-tweaks-bridge');
    expect(srcdoc).toContain("type: 'od:tweaks-available'");
  });

  it('reports available: true when the artifact ships a `.tw-panel`', async () => {
    const { parentPostMessage } = await setupBridge(TWEAKS_PANEL_BODY);
    const availability = messagesOfType(parentPostMessage, 'od:tweaks-available');
    expect(availability.length).toBeGreaterThan(0);
    expect(availability.at(-1)).toMatchObject({ available: true });
  });

  it('reports available: false for a plain artifact with no `.tw-panel`', async () => {
    const { parentPostMessage } = await setupBridge('<main>Hello</main>');
    const availability = messagesOfType(parentPostMessage, 'od:tweaks-available');
    expect(availability.length).toBeGreaterThan(0);
    expect(availability.at(-1)).toMatchObject({ available: false });
  });
});

describe('tweaks bridge — initial visibility (od:tweaks-panel-state on mount)', () => {
  it('reports visible: true for a default-visible authored panel (no `.tw-hidden`)', async () => {
    const { win, parentPostMessage } = await setupBridge(TWEAKS_PANEL_BODY);
    const states = messagesOfType(parentPostMessage, 'od:tweaks-panel-state');
    expect(states.at(-1)).toMatchObject({ visible: true });
    // The host-hidden attribute is cleared to match the captured author intent.
    expect(win.document.documentElement.hasAttribute('data-od-tweaks-hidden')).toBe(false);
  });

  it('reports visible: false for a panel authored with `.tw-hidden`', async () => {
    const hiddenBody = TWEAKS_PANEL_BODY.replace('class="tw-panel"', 'class="tw-panel tw-hidden"');
    const { parentPostMessage } = await setupBridge(hiddenBody);
    const states = messagesOfType(parentPostMessage, 'od:tweaks-panel-state');
    expect(states.at(-1)).toMatchObject({ visible: false });
  });
});

describe('tweaks bridge — host-driven visibility (od:tweaks-panel-visible)', () => {
  it('hides the panel and adds the host-hidden attribute on od:tweaks-panel-visible: false', async () => {
    const { win } = await setupBridge(TWEAKS_PANEL_BODY);
    const panel = win.document.querySelector('.tw-panel')!;
    expect(panel.classList.contains('tw-hidden')).toBe(false);

    win.dispatchEvent(new win.MessageEvent('message', {
      data: { type: 'od:tweaks-panel-visible', visible: false },
    }));

    expect(panel.classList.contains('tw-hidden')).toBe(true);
    expect(win.document.documentElement.hasAttribute('data-od-tweaks-hidden')).toBe(true);
  });

  it('shows the panel again on od:tweaks-panel-visible: true', async () => {
    const hiddenBody = TWEAKS_PANEL_BODY.replace('class="tw-panel"', 'class="tw-panel tw-hidden"');
    const { win } = await setupBridge(hiddenBody);
    const panel = win.document.querySelector('.tw-panel')!;
    expect(panel.classList.contains('tw-hidden')).toBe(true);

    win.dispatchEvent(new win.MessageEvent('message', {
      data: { type: 'od:tweaks-panel-visible', visible: true },
    }));

    expect(panel.classList.contains('tw-hidden')).toBe(false);
    expect(win.document.documentElement.hasAttribute('data-od-tweaks-hidden')).toBe(false);
  });

  it('ignores unrelated message types', async () => {
    const { win } = await setupBridge(TWEAKS_PANEL_BODY);
    const panel = win.document.querySelector('.tw-panel')!;
    win.dispatchEvent(new win.MessageEvent('message', {
      data: { type: 'od:something-else', visible: false },
    }));
    expect(panel.classList.contains('tw-hidden')).toBe(false);
  });
});

describe('tweaks bridge — echo suppression on host-driven changes', () => {
  // The bridge's MutationObserver posts od:tweaks-panel-state whenever the
  // panel's `class` attribute changes, so the host toolbar stays in sync when
  // the ARTIFACT's own × button or `T` shortcut flips `.tw-hidden`. But a
  // HOST-driven `od:tweaks-panel-visible` message also flips that same class
  // via `setPanelVisible`, which sets a `suppressEcho` flag first — without
  // it, every host toggle would immediately echo back as if the user had
  // clicked the artifact's own close button, and a host-vs-bridge feedback
  // loop (or at minimum a spurious redundant round trip) would result.
  it('does not echo a host-driven visibility change back as od:tweaks-panel-state', async () => {
    const { win, parentPostMessage } = await setupBridge(TWEAKS_PANEL_BODY);
    parentPostMessage.mockClear();

    win.dispatchEvent(new win.MessageEvent('message', {
      data: { type: 'od:tweaks-panel-visible', visible: false },
    }));
    // suppressEcho clears on a resolved microtask; flush it.
    await Promise.resolve();
    await Promise.resolve();

    expect(messagesOfType(parentPostMessage, 'od:tweaks-panel-state')).toHaveLength(0);
  });

  it('DOES report state when the ARTIFACT itself mutates the panel class (its own × button)', async () => {
    const { win, parentPostMessage } = await setupBridge(TWEAKS_PANEL_BODY);
    parentPostMessage.mockClear();
    const panel = win.document.querySelector('.tw-panel')!;

    // Simulate the artifact's own `tw-close` handler: `panel.classList.toggle('tw-hidden', true)`.
    panel.classList.add('tw-hidden');
    // MutationObserver callbacks fire as a microtask, not synchronously.
    await Promise.resolve();
    await Promise.resolve();

    const states = messagesOfType(parentPostMessage, 'od:tweaks-panel-state');
    expect(states.at(-1)).toMatchObject({ visible: false });
  });
});
