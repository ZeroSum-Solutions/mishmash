import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, lstat, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  APP_KEYS,
  OPEN_DESIGN_SIDECAR_CONTRACT,
  SIDECAR_MESSAGES,
  SIDECAR_SOURCES,
  type DesktopStatusSnapshot,
} from "@open-design/sidecar-proto";
import { createSidecarLaunchEnv, requestJsonIpc, resolveAppIpcPath } from "@open-design/sidecar";
import { createProcessStampArgs } from "@open-design/platform";

// ---------------------------------------------------------------------------
// Review finding 7/8: every other spec in this directory exercises
// startDesktopRendererSidecar() IN-PROCESS with a hand-built runtime
// context, which never touches readProcessStamp/bootstrapSidecarRuntime --
// the exact wiring `pnpm tools-dev` depends on (tools/dev/src/index.ts's
// createAppStamp -> createProcessStampArgs/createSidecarLaunchEnv ->
// spawnBackgroundProcess). This spec closes that gap the cheap way: spawn
// the REAL entry file as a REAL child process with the REAL `--od-stamp-*`
// CLI args and the REAL sidecar launch env, exactly as tools-dev's
// spawnSidecarRuntime() constructs them -- not the full tools-dev CLI
// control plane (build-freshness checks, port allocation, log-tail
// diagnostics), which would duplicate machinery this spec has no need to
// re-verify.
//
// Being a real separate OS process also lets this spec safely exercise the
// REAL SHUTDOWN IPC message end-to-end (review finding 10) -- unsafe in the
// other in-process specs, since SHUTDOWN's handler calls `process.exit(0)`
// on whatever process received it.
// ---------------------------------------------------------------------------

const repoRoot = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const entryPath = resolve(repoRoot, "apps/daemon/src/sidecar/desktop-renderer/index.ts");
const tsxCliPath = createRequire(import.meta.url).resolve("tsx/cli");

describe("desktop renderer sidecar (real spawned process, real stamp)", () => {
  let root: string;
  let namespace: string;
  let desktopIpc: string;
  let child: ChildProcess;

  beforeAll(async () => {
    namespace = `mm005-spawn-${randomUUID().slice(0, 8)}`;
    root = await mkdtemp(join("/tmp", "od-desktop-renderer-spawn-"));
    desktopIpc = resolveAppIpcPath({ app: APP_KEYS.DESKTOP, contract: OPEN_DESIGN_SIDECAR_CONTRACT, namespace });

    const stamp = {
      app: APP_KEYS.DESKTOP,
      ipc: desktopIpc,
      mode: "dev" as const,
      namespace,
      source: SIDECAR_SOURCES.TOOLS_DEV,
    };
    // The exact primitives tools/dev/src/index.ts#createAppStamp uses --
    // never hand-built `--od-stamp-*` args (AGENTS.md: "orchestration
    // layers must call package primitives").
    const stampArgs = createProcessStampArgs(stamp, OPEN_DESIGN_SIDECAR_CONTRACT);
    const env = createSidecarLaunchEnv({ base: root, contract: OPEN_DESIGN_SIDECAR_CONTRACT, stamp });

    child = spawn(process.execPath, [tsxCliPath, entryPath, ...stampArgs], {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }, 30_000);

  afterAll(async () => {
    child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  });

  it("binds the canonical resolveAppIpcPath socket and answers STATUS through readProcessStamp -> bootstrapSidecarRuntime", async () => {
    const status = await waitForStatus(desktopIpc, 15_000);
    expect(status.state).toBe("running");
    expect(typeof status.pid).toBe("number");
    // The child process really did bind this exact path -- not a
    // coincidence of the test's own namespace string.
    await expect(lstat(desktopIpc)).resolves.toMatchObject({});
  });

  it("SHUTDOWN (the real IPC message, not a direct stop() call) terminates the real process and unlinks the socket", async () => {
    const exitPromise = new Promise<number | null>((resolveExit) => {
      child.once("exit", (code) => resolveExit(code));
    });
    await requestJsonIpc(desktopIpc, { type: SIDECAR_MESSAGES.SHUTDOWN }, { timeoutMs: 5000 });
    await exitPromise;
    await new Promise((r) => setTimeout(r, 200));
    await expect(lstat(desktopIpc)).rejects.toMatchObject({ code: "ENOENT" });
  }, 10_000);
});

async function waitForStatus(socketPath: string, timeoutMs: number): Promise<DesktopStatusSnapshot> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await requestJsonIpc<DesktopStatusSnapshot>(socketPath, { type: SIDECAR_MESSAGES.STATUS }, { timeoutMs: 800 });
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error(`desktop renderer did not answer STATUS in time: ${String(lastError)}`);
}
