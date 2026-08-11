import { mkdtemp, lstat, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";

import {
  APP_KEYS,
  OPEN_DESIGN_SIDECAR_CONTRACT,
  SIDECAR_MESSAGES,
  SIDECAR_MODES,
  SIDECAR_SOURCES,
  type DesktopRenderSlidesInput,
  type DesktopRenderSlidesResult,
  type DesktopStatusSnapshot,
} from "@open-design/sidecar-proto";
import { requestJsonIpc, resolveAppIpcPath } from "@open-design/sidecar";

import { startDesktopRendererSidecar, type DesktopRendererSidecarHandle } from "../../src/sidecar/desktop-renderer/server.js";

// ---------------------------------------------------------------------------
// MM-005 red spec #1 (IPC boundary). Proves the literal ask: spawn the
// renderer, connect to its socket, send the REAL render-slides fixture the
// daemon's sidecar/server.ts closures actually send (SIDECAR_MESSAGES.RENDER_SLIDES
// + a DesktopRenderSlidesInput), and get back a valid, actually-rendered
// screenshot -- not a canned/blank PNG.
//
// The socket path is computed with the SAME resolveAppIpcPath() call the
// daemon's desktopSlideRenderer closure uses (sidecar/server.ts:136-141),
// under a dedicated test namespace so this suite never collides with a real
// running dev stack -- not an arbitrary tmp path. The full lifecycle-at-app-
// start (the literal `default` namespace, bound by `pnpm tools-dev`) is
// verified separately by a real `pnpm tools-dev` smoke run (see PR
// description / MM-005 report), which a vitest process can't drive without
// duplicating the tools-dev control plane it is here to prove is wired
// correctly, not to re-implement.
// ---------------------------------------------------------------------------

describe("desktop renderer sidecar (IPC boundary)", () => {
  let root: string;
  let namespace: string;
  let desktopIpc: string;
  let handle: DesktopRendererSidecarHandle;

  beforeAll(async () => {
    namespace = `mm005-test-${randomUUID().slice(0, 8)}`;
    root = await mkdtemp(join("/tmp", "od-desktop-renderer-"));
    desktopIpc = resolveAppIpcPath({
      app: APP_KEYS.DESKTOP,
      contract: OPEN_DESIGN_SIDECAR_CONTRACT,
      namespace,
    });
    // The canonical structure the daemon's own resolveAppIpcPath call
    // produces -- NOT an arbitrary temp path (review finding 1).
    expect(desktopIpc).toBe(`/tmp/open-design/ipc/${namespace}/desktop.sock`);

    handle = await startDesktopRendererSidecar({
      app: APP_KEYS.DESKTOP,
      base: root,
      ipc: desktopIpc,
      mode: SIDECAR_MODES.DEV,
      namespace,
      source: SIDECAR_SOURCES.TOOLS_DEV,
    });
  }, 30_000);

  afterAll(async () => {
    await handle.stop();
    await handle.waitUntilStopped();
    await rm(root, { recursive: true, force: true });
  });

  it("answers STATUS in the shape tools-dev's wait loop depends on", async () => {
    const status = await requestJsonIpc<DesktopStatusSnapshot>(desktopIpc, { type: SIDECAR_MESSAGES.STATUS }, { timeoutMs: 5000 });
    expect(status.state).toBe("running");
    expect(typeof status.pid).toBe("number");
  });

  it("renders a real multi-slide deck to actually-rendered, decodable PNGs", async () => {
    // Two slides with distinct, saturated background colors and an explicit
    // pixel size -- strong enough to prove content was really painted, not
    // just that Playwright can screenshot *something* (review finding 3).
    const html = [
      "<html><body>",
      '<section class="slide" style="width:400px;height:300px;margin:0;background:#ff0055;"></section>',
      '<section class="slide" style="width:400px;height:300px;margin:0;background:#0055ff;"></section>',
      "</body></html>",
    ].join("");
    const input: DesktopRenderSlidesInput = { html, deck: true, width: 400, height: 300 };

    // The EXACT wire shape apps/daemon/src/sidecar/server.ts's
    // desktopSlideRenderer closure sends over requestJsonIpc -- not an
    // invented test-only shape (review finding 2).
    const result = await requestJsonIpc<DesktopRenderSlidesResult>(
      desktopIpc,
      { input, type: SIDECAR_MESSAGES.RENDER_SLIDES },
      { timeoutMs: 30_000 },
    );

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("deck");
    expect(result.slides).toHaveLength(2);

    const expectedColors: Array<[number, number, number]> = [
      [0xff, 0x00, 0x55],
      [0x00, 0x55, 0xff],
    ];
    for (const [index, dataUrl] of (result.slides ?? []).entries()) {
      const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
      expect(match, `slide ${index} must be a base64 PNG data URL`).not.toBeNull();
      const buffer = Buffer.from(match![1]!, "base64");
      // Decodable PNG with the requested, non-trivial dimensions.
      const { data, info } = await sharp(buffer).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
      expect(info.width).toBe(400);
      expect(info.height).toBe(300);
      // Content actually rendered: sample the center pixel and assert it
      // matches this slide's own background color, not a uniform blank.
      const centerOffset = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
      const [r, g, b] = expectedColors[index]!;
      expect(data[centerOffset]).toBeCloseTo(r, -1);
      expect(data[centerOffset + 1]).toBeCloseTo(g, -1);
      expect(data[centerOffset + 2]).toBeCloseTo(b, -1);
    }
  }, 30_000);

  it("renders an ordinary (non-deck) page as a single full-page capture", async () => {
    const html = '<html><body style="margin:0"><main style="width:320px;height:200px;background:#00aa33;"></main></body></html>';
    const input: DesktopRenderSlidesInput = { html, deck: false, width: 320, height: 200 };
    const result = await requestJsonIpc<DesktopRenderSlidesResult>(
      desktopIpc,
      { input, type: SIDECAR_MESSAGES.RENDER_SLIDES },
      { timeoutMs: 30_000 },
    );
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("page");
    expect(result.slides).toHaveLength(1);
    const match = /^data:image\/png;base64,(.+)$/.exec(result.slides![0]!);
    const buffer = Buffer.from(match![1]!, "base64");
    const { data, info } = await sharp(buffer).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const centerOffset = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    expect(data[centerOffset]).toBeCloseTo(0x00, -1);
    expect(data[centerOffset + 1]).toBeCloseTo(0xaa, -1);
    expect(data[centerOffset + 2]).toBeCloseTo(0x33, -1);
  }, 30_000);

  it("returns a well-formed explicit error for messages it does not support (never a silent success)", async () => {
    await expect(
      requestJsonIpc(desktopIpc, { type: SIDECAR_MESSAGES.SCREENSHOT, input: { path: "/tmp/x.png" } }, { timeoutMs: 5000 }),
    ).rejects.toThrow();
  });

  // The real SHUTDOWN IPC handler wraps `stop()` with `process.exit(0)` (it
  // is designed to run in the renderer's OWN spawned process, exactly like
  // apps/daemon/src/sidecar/server.ts's SHUTDOWN handler). This suite runs
  // `startDesktopRendererSidecar` IN-PROCESS (the same pattern
  // sidecar-startup.test.ts already uses for the daemon sidecar), so
  // exercising the real SHUTDOWN message here would call `process.exit(0)`
  // on the vitest worker itself. `stop()` — the function SHUTDOWN calls —
  // is exercised directly instead; `createJsonIpcServer`'s `close()` is what
  // actually unlinks the socket, and that is common to both call paths.
  it("stop() unlinks the socket file", async () => {
    await handle.stop();
    await handle.waitUntilStopped();
    await expect(lstat(desktopIpc)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
