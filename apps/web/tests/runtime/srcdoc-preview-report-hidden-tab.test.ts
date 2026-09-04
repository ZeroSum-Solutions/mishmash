// @vitest-environment jsdom
// W2G.1 / F12 — a healthy backgrounded preview files a false `preview-error`.
//
// The host watchdog asks the frame to report itself and starts a 15 s
// `setTimeout` (`observability/iframe-error.ts`). The srcDoc bridge answers
// that ask through `requestAnimationFrame`. Animation frames are PAUSED in a
// hidden tab while `setTimeout` is only throttled, so a user who opens a
// preview and switches tabs for twenty seconds gets `client_iframe_timeout` on
// a preview that is fine.
//
// The bridge cannot see the host's timer, so the fix is in the answer: an
// explicit report request is answered with an immediate `post()`, never a
// scheduled one. This spec runs the REAL injected bridge with a
// `requestAnimationFrame` that never fires — the hidden-tab condition — and
// asks for a report.

import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { buildSrcdoc } from '../../src/runtime/srcdoc';

const REPORT = 'od:preview-content-size';
const REPORT_REQUEST = 'od:preview-content-size-request';

function extractContentSizeBridge(doc: string): string {
  const match = doc.match(
    /<script\s+data-od-preview-content-size-bridge>([\s\S]*?)<\/script>/,
  );
  if (!match || match[1] == null) {
    throw new Error('preview content-size bridge script not found in srcdoc');
  }
  return match[1];
}

interface HiddenTabBridge {
  parentMessages: Array<{ type?: string; width?: number | null }>;
  send: (data: unknown) => void;
  queuedFrames: number;
}

/**
 * Runs the injected bridge in a document whose animation frames never run —
 * the browser's behaviour for a hidden tab. Timers are inert too, so the only
 * path that can still answer is a synchronous one.
 */
function runBridgeInHiddenTab(doc: string): HiddenTabBridge {
  const parentMessages: Array<{ type?: string; width?: number | null }> = [];
  const listeners: Record<string, Array<(ev: unknown) => void>> = {};
  const frameCallbacks: Array<() => void> = [];
  const win: Record<string, unknown> = {
    parent: { postMessage: (data: unknown) => parentMessages.push(data as never) },
    addEventListener(type: string, listener: (ev: unknown) => void) {
      (listeners[type] ??= []).push(listener);
    },
    requestAnimationFrame(callback: () => void) {
      // Queued and never invoked: the tab is hidden.
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    },
  };
  const sandbox: Record<string, unknown> = {
    window: win,
    document: {
      readyState: 'complete',
      visibilityState: 'hidden',
      hidden: true,
      documentElement: { scrollWidth: 1280, offsetWidth: 1280, clientWidth: 1280 },
      body: { scrollWidth: 1280, offsetWidth: 1280, clientWidth: 1280 },
      addEventListener: () => {},
    },
    setTimeout: () => 0,
  };
  vm.createContext(sandbox);
  vm.runInContext(extractContentSizeBridge(doc), sandbox);
  return {
    parentMessages,
    send: (data: unknown) => {
      for (const listener of listeners.message ?? []) listener({ data });
    },
    get queuedFrames() {
      return frameCallbacks.length;
    },
  };
}

describe('the srcdoc preview bridge answers a report request in a hidden tab', () => {
  it('posts the report synchronously instead of waiting for an animation frame', () => {
    const doc = buildSrcdoc('<html><body><h1>Artifact</h1></body></html>', {
      selectionBridge: true,
      editBridge: true,
      previewFocusGuard: true,
    });

    const bridge = runBridgeInHiddenTab(doc);
    bridge.send({ type: REPORT_REQUEST });

    const report = bridge.parentMessages.find((message) => message?.type === REPORT);
    expect(report).toBeDefined();
    expect(report?.width).toBe(1280);
  });
});
