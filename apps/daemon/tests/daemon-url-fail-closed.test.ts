import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SIDECAR_ENV } from "@open-design/sidecar-proto";
import { resolveDaemonUrl, DEFAULT_DAEMON_URL } from "../src/daemon-url.js";

// CANVAS-8 (docs/KNOWN-ISSUES-CANVAS.md). `resolveDaemonUrl` returns
// DEFAULT_DAEMON_URL whenever discovery produces no URL, and both discovery
// probes discard the reason they failed. A probe that outran its budget proves
// nothing about whether the user's daemon exists: on a loaded machine the `od`
// client then addresses whatever daemon happens to hold port 7456 and mutates
// that daemon's project data.
//
// The invariant these specs pin: the legacy default port is only reachable
// after discovery ran to a CONCLUSION ("nothing is listening"). Discovery that
// could not finish must fail closed, so a caller can tell "no daemon found"
// from "discovery timed out".

describe("resolveDaemonUrl fail-closed discovery", () => {
  let hangingBinDir: string;
  let emptyBinDir: string;
  let ipcBaseDir: string;

  beforeAll(() => {
    hangingBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "od-daemon-url-hang-"));
    emptyBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "od-daemon-url-empty-"));
    // AF_UNIX socket paths are capped at ~104 bytes on macOS; anchor to /tmp so
    // a long $TMPDIR cannot push the socket past the kernel limit (same reason
    // as daemon-url.test.ts).
    ipcBaseDir = fs.mkdtempSync(path.join("/tmp", "od-daemon-url-ipc-"));

    const pnpmShim = path.join(hangingBinDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm");
    if (process.platform === "win32") {
      fs.writeFileSync(pnpmShim, "@echo off\r\ntimeout /t 5 /nobreak > nul\r\n");
    } else {
      fs.writeFileSync(pnpmShim, "#!/bin/sh\nexec /bin/sleep 5\n");
      fs.chmodSync(pnpmShim, 0o755);
    }
  });

  afterAll(() => {
    fs.rmSync(hangingBinDir, { recursive: true, force: true });
    fs.rmSync(emptyBinDir, { recursive: true, force: true });
    fs.rmSync(ipcBaseDir, { recursive: true, force: true });
  });

  it("refuses the default port when the tools-dev status probe outruns its budget", async () => {
    // `pnpm` resolves to a shim that never answers, so the probe is killed by
    // its own timer. Today that timeout is indistinguishable from "no runtime
    // is up" and the caller silently receives DEFAULT_DAEMON_URL.
    await expect(
      resolveDaemonUrl({
        env: { PATH: hangingBinDir },
        timeoutMs: 300,
      }),
    ).rejects.toThrow(/discovery/i);
  });

  it("refuses the default port when the sidecar IPC status probe times out", async () => {
    const socketPath = process.platform === "win32"
      ? `\\\\.\\pipe\\od-daemon-url-silent-${process.pid}-${Date.now()}`
      : path.join(ipcBaseDir, "silent.sock");
    // A server that accepts the connection and never replies: the socket is
    // live (so this is NOT "nothing is listening"), the STATUS roundtrip just
    // never completes.
    const connections: net.Socket[] = [];
    const server = net.createServer((socket) => {
      connections.push(socket);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => resolve());
    });
    try {
      await expect(
        resolveDaemonUrl({
          env: { PATH: emptyBinDir, [SIDECAR_ENV.IPC_PATH]: socketPath },
          timeoutMs: 300,
        }),
      ).rejects.toThrow(/discovery/i);
    } finally {
      // `server.close()` waits for live connections, and the probe's socket is
      // still half-open after its own timeout destroyed the client end.
      for (const socket of connections) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("refuses the default port when the sidecar socket exists but cannot be reached", async () => {
    // Permission denied is NOT absence: the socket is there, very likely the
    // user's own daemon, and this client simply cannot reach it. Windows named
    // pipes do not model this, so the case is POSIX-only.
    if (process.platform === "win32") return;
    const socketPath = path.join(ipcBaseDir, "denied.sock");
    const server = net.createServer(() => {});
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => resolve());
    });
    fs.chmodSync(socketPath, 0o000);
    try {
      await expect(
        resolveDaemonUrl({
          env: { PATH: emptyBinDir, [SIDECAR_ENV.IPC_PATH]: socketPath },
          timeoutMs: 2000,
        }),
      ).rejects.toThrow(/discovery/i);
    } finally {
      fs.chmodSync(socketPath, 0o600);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("still returns the documented default when discovery conclusively finds no daemon", async () => {
    // No flag, no env URL, no sidecar socket, and `pnpm` is not on PATH — every
    // probe reached a conclusion, so the legacy default stays the documented
    // fallback for a direct `od` launch.
    const url = await resolveDaemonUrl({
      env: { PATH: emptyBinDir },
      timeoutMs: 2000,
    });
    expect(url).toBe(DEFAULT_DAEMON_URL);
  });
});
