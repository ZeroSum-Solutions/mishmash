import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createJsonIpcServer, type JsonIpcServerHandle } from "@open-design/sidecar";
import { SIDECAR_ENV, SIDECAR_MESSAGES } from "@open-design/sidecar-proto";
import { resolveDaemonUrl, DEFAULT_DAEMON_URL } from "../src/daemon-url.js";

// Verifies the resolution chain: --daemon-url > OD_DAEMON_URL > sidecar
// IPC status discovery > legacy default. Each layer must short-circuit the next
// so `od` clients follow the live daemon across ephemeral-port restarts.

describe("resolveDaemonUrl", () => {
  let ipcBaseDir: string;
  let fakeBinDir: string;
  let emptyBinDir: string;

  beforeAll(() => {
    // Anchor to /tmp directly rather than os.tmpdir(): ipcBaseDir hosts a
    // unix-domain IPC socket, and AF_UNIX socket paths are capped at ~104
    // bytes on macOS (~108 on Linux) at the kernel level. A long/nested
    // $TMPDIR (e.g. an orchestrator-scoped gate run) pushes
    // `<tmpdir>/od-mcp-resolve-XXXXXX/daemon.sock` past that cap and
    // `server.listen()` throws EINVAL. /tmp stays short regardless of
    // $TMPDIR.
    ipcBaseDir = fs.mkdtempSync(path.join("/tmp", "od-mcp-resolve-"));
    fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "od-tools-dev-resolve-"));
    emptyBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "od-tools-dev-empty-"));
  });

  afterAll(() => {
    fs.rmSync(ipcBaseDir, { recursive: true, force: true });
    fs.rmSync(fakeBinDir, { recursive: true, force: true });
    fs.rmSync(emptyBinDir, { recursive: true, force: true });
  });

  it("prefers the explicit --daemon-url flag", async () => {
    const url = await resolveDaemonUrl({
      flagUrl: "http://flag.example:1111",
      env: {
        OD_DAEMON_URL: "http://env.example:2222",
        [SIDECAR_ENV.IPC_PATH]: path.join(ipcBaseDir, "daemon.sock"),
      },
    });
    expect(url).toBe("http://flag.example:1111");
  });

  it("falls back to OD_DAEMON_URL when no flag given", async () => {
    const url = await resolveDaemonUrl({
      env: {
        OD_DAEMON_URL: "http://env.example:2222",
        [SIDECAR_ENV.IPC_PATH]: path.join(ipcBaseDir, "daemon.sock"),
      },
    });
    expect(url).toBe("http://env.example:2222");
  });

  it("returns the legacy default when no flag/env/socket is available", async () => {
    const url = await resolveDaemonUrl({
      env: {
        PATH: emptyBinDir,
        [SIDECAR_ENV.IPC_PATH]: path.join(ipcBaseDir, "missing.sock"),
      },
      timeoutMs: 200,
    });
    expect(url).toBe(DEFAULT_DAEMON_URL);
  });

  it("discovers the default tools-dev daemon URL when no sidecar IPC path is available", async () => {
    const pnpmBin = path.join(fakeBinDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm");
    const statusJson = JSON.stringify({
      apps: {
        daemon: {
          url: "http://127.0.0.1:60123",
        },
      },
    });
    if (process.platform === "win32") {
      fs.writeFileSync(pnpmBin, `@echo off\r\necho ${statusJson.replace(/"/g, '\\"')}\r\n`);
    } else {
      fs.writeFileSync(pnpmBin, `#!/bin/sh\nprintf '%s\\n' 'pnpm warning before json'\nprintf '%s\\n' '${statusJson}'\n`);
      fs.chmodSync(pnpmBin, 0o755);
    }

    // This case asserts that discovery *works*, not that it is fast. The budget
    // has to cover a real process spawn; a budget too tight for a loaded
    // machine now surfaces as a DaemonUrlDiscoveryError (see
    // daemon-url-fail-closed.test.ts) rather than as a silent default port. At
    // 1000ms this file passed alone and failed inside the full 619-file suite
    // for exactly that reason. Kept well under the 20s per-test ceiling in
    // vitest.config.ts.
    const url = await resolveDaemonUrl({
      env: {
        PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      timeoutMs: 10_000,
    });
    expect(url).toBe("http://127.0.0.1:60123");
  });

  it("discovers the live daemon URL via the concrete sidecar IPC status endpoint", async () => {
    const socketPath = process.platform === "win32"
      ? `\\\\.\\pipe\\open-design-daemon-url-${process.pid}-${Date.now()}`
      : path.join(ipcBaseDir, "daemon.sock");
    let ipc: JsonIpcServerHandle | null = null;
    try {
      ipc = await createJsonIpcServer({
        socketPath,
        handler: (message) => {
          if (
            message != null &&
            typeof message === "object" &&
            (message as { type?: unknown }).type === SIDECAR_MESSAGES.STATUS
          ) {
            return {
              pid: 4242,
              state: "running",
              updatedAt: new Date().toISOString(),
              url: "http://127.0.0.1:54321",
            };
          }
          throw new Error("unexpected message");
        },
      });

      const url = await resolveDaemonUrl({
        env: {
          [SIDECAR_ENV.IPC_PATH]: socketPath,
        },
        timeoutMs: 1000,
      });
      expect(url).toBe("http://127.0.0.1:54321");
    } finally {
      await ipc?.close();
    }
  });
});
