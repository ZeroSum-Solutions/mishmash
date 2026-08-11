/**
 * MM-005: pins the desktop renderer's lifecycle ordering in tools-dev's pure
 * config helpers (no process spawning -- that is proven for real by the
 * `pnpm tools-dev run` smoke evidence in the MM-005 report). Daemon must
 * start before desktop (the renderer's baseHref-scoped asset fetches target
 * the daemon's own HTTP origin at render time) and stop after it (so no
 * in-flight render is caught mid-fetch when daemon goes down) -- review
 * finding 5 flagged this ordering as easy to implement inverted.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APP_KEYS } from "@open-design/sidecar-proto";

import {
  ALL_APPS,
  DEFAULT_START_APPS,
  DEFAULT_STOP_APPS,
  resolveStartApps,
  resolveStopApps,
  resolveToolDevConfig,
} from "../src/config.js";

describe("desktop renderer lifecycle ordering", () => {
  it("includes desktop in the app roster", () => {
    assert.deepEqual([...ALL_APPS], [APP_KEYS.DAEMON, APP_KEYS.DESKTOP, APP_KEYS.WEB]);
  });

  it("starts daemon, then desktop, then web -- daemon must be reachable before the renderer's first render", () => {
    assert.deepEqual([...DEFAULT_START_APPS], [APP_KEYS.DAEMON, APP_KEYS.DESKTOP, APP_KEYS.WEB]);
    assert.deepEqual(resolveStartApps(undefined), [APP_KEYS.DAEMON, APP_KEYS.DESKTOP, APP_KEYS.WEB]);
    assert.deepEqual(resolveStartApps("web"), [APP_KEYS.DAEMON, APP_KEYS.DESKTOP, APP_KEYS.WEB]);
    assert.deepEqual(resolveStartApps("desktop"), [APP_KEYS.DAEMON, APP_KEYS.DESKTOP]);
    assert.deepEqual(resolveStartApps("daemon"), [APP_KEYS.DAEMON]);
  });

  it("stops web, then desktop, then daemon -- the exact reverse of start order", () => {
    assert.deepEqual([...DEFAULT_STOP_APPS], [APP_KEYS.WEB, APP_KEYS.DESKTOP, APP_KEYS.DAEMON]);
    assert.deepEqual(resolveStopApps(undefined), [APP_KEYS.WEB, APP_KEYS.DESKTOP, APP_KEYS.DAEMON]);
    assert.deepEqual(resolveStopApps("web"), [APP_KEYS.WEB, APP_KEYS.DESKTOP, APP_KEYS.DAEMON]);
    assert.deepEqual(resolveStopApps("desktop"), [APP_KEYS.DESKTOP]);
    assert.deepEqual(resolveStopApps("daemon"), [APP_KEYS.DAEMON]);
  });

  it("resolves a desktop sidecar entry under apps/daemon (playwright is a daemon-package dependency, not a new workspace)", () => {
    const config = resolveToolDevConfig({ namespace: "mm005-config-test" });
    assert.match(config.apps.desktop.sidecarEntryPath, /apps[\\/]daemon[\\/]src[\\/]sidecar[\\/]desktop-renderer[\\/]index\.ts$/);
    assert.match(config.apps.desktop.ipcPath, /[\\/]mm005-config-test[\\/]desktop\.sock$/);
  });
});
