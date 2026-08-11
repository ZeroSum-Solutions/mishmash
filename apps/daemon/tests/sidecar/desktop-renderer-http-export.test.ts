import type http from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
} from "@open-design/sidecar-proto";
import { requestJsonIpc, resolveAppIpcPath } from "@open-design/sidecar";

import { startDesktopRendererSidecar, type DesktopRendererSidecarHandle } from "../../src/sidecar/desktop-renderer/server.js";
import { startServer } from "../../src/server.js";

// ---------------------------------------------------------------------------
// MM-005 red spec #2 (HTTP boundary). Proves the daemon's real export route
// stops 502ing UPSTREAM_UNAVAILABLE once a real renderer answers the desktop
// socket -- not just that the renderer works in isolation (red spec #1
// covers that). `desktopSlideRenderer` below is a REAL requestJsonIpc call
// against a REAL spawned-in-process renderer, not the stub callback the
// existing screenshot-export-file-handoff.test.ts suite uses.
// ---------------------------------------------------------------------------

const PROJECT_ID = "mm005-http-export";

describe("desktop renderer sidecar (HTTP export boundary)", () => {
  let rendererHandle: DesktopRendererSidecarHandle;
  let rendererRoot: string;
  let desktopIpc: string;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const namespace = `mm005-http-${randomUUID().slice(0, 8)}`;
    rendererRoot = await mkdtemp(join("/tmp", "od-desktop-renderer-http-"));
    desktopIpc = resolveAppIpcPath({ app: APP_KEYS.DESKTOP, contract: OPEN_DESIGN_SIDECAR_CONTRACT, namespace });
    rendererHandle = await startDesktopRendererSidecar({
      app: APP_KEYS.DESKTOP,
      base: rendererRoot,
      ipc: desktopIpc,
      mode: SIDECAR_MODES.DEV,
      namespace,
      source: SIDECAR_SOURCES.TOOLS_DEV,
    });

    const started = (await startServer({
      port: 0,
      returnServer: true,
      // The real call-site shape (sidecar/server.ts's desktopSlideRenderer
      // closure): requestJsonIpc against the desktop socket, 600s timeout in
      // production. A real renderer, not a stub.
      desktopSlideRenderer: async (input: DesktopRenderSlidesInput): Promise<DesktopRenderSlidesResult> =>
        requestJsonIpc<DesktopRenderSlidesResult>(desktopIpc, { input, type: SIDECAR_MESSAGES.RENDER_SLIDES }, { timeoutMs: 60_000 }),
    })) as { url: string; server: http.Server };
    baseUrl = started.url;
    server = started.server;

    const dataDir = process.env.OD_DATA_DIR!;
    const dir = join(dataDir, "projects", PROJECT_ID);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "index.html"),
      '<html><body style="margin:0"><main style="width:300px;height:200px;background:#12ab34;"></main></body></html>',
    );
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rendererHandle.stop();
    await rendererHandle.waitUntilStopped();
    await rm(rendererRoot, { recursive: true, force: true });
  });

  it("exports a real, non-blank PNG through the full HTTP -> IPC -> Playwright pipeline", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PROJECT_ID}/export/image`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: "index.html", deck: false, width: 300, height: 200 }),
    });

    // Before MM-005: 502 UPSTREAM_UNAVAILABLE (nothing bound at desktop.sock).
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 4).toString("hex")).toBe("89504e47"); // PNG magic

    const { data, info } = await sharp(bytes).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const centerOffset = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    // Content actually rendered from the project's own file, not a blank
    // placeholder -- matches the #12ab34 background painted above.
    expect(data[centerOffset]).toBeCloseTo(0x12, -1);
    expect(data[centerOffset + 1]).toBeCloseTo(0xab, -1);
    expect(data[centerOffset + 2]).toBeCloseTo(0x34, -1);
  }, 30_000);
});
