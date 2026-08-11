// Headless desktop-renderer sidecar IPC server (MM-005).
//
// Binds `APP_KEYS.DESKTOP`'s socket via the SAME createJsonIpcServer /
// resolveAppIpcPath primitives apps/daemon/src/sidecar/server.ts and
// apps/web/sidecar/server.ts already use -- nothing here invents a new
// transport or path convention. Handles the messages the real daemon call
// sites (apps/daemon/src/sidecar/server.ts:122-159) actually send --
// STATUS, SHUTDOWN, RENDER_SLIDES, EXPORT_ARTIFACT -- plus an explicit,
// typed "unsupported" error for every other message the desktop contract
// still names (EXPORT_PDF, EVAL, SCREENSHOT, CLICK, CONSOLE, SHOW, UPDATE):
// this renderer never falls through to executing an unrecognized message
// as a silent no-op or a wrong success.

import {
  SIDECAR_ENV,
  SIDECAR_MESSAGES,
  normalizeDesktopSidecarMessage,
  type DesktopStatusSnapshot,
  type SidecarStamp,
} from "@open-design/sidecar-proto";
import { createJsonIpcServer, type JsonIpcServerHandle, type SidecarRuntimeContext } from "@open-design/sidecar";

import { exportArtifact, renderSlides } from "./render.js";

const TOOLS_DEV_PARENT_PID_ENV = SIDECAR_ENV.TOOLS_DEV_PARENT_PID;

export type DesktopRendererSidecarHandle = {
  status(): Promise<DesktopStatusSnapshot>;
  stop(): Promise<void>;
  waitUntilStopped(): Promise<void>;
};

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function attachParentMonitor(stop: () => Promise<void>): void {
  const parentPid = Number(process.env[TOOLS_DEV_PARENT_PID_ENV]);
  if (!Number.isInteger(parentPid) || parentPid <= 0) return;

  const timer = setInterval(() => {
    if (isProcessAlive(parentPid)) return;
    clearInterval(timer);
    void stop().finally(() => process.exit(0));
  }, 1000);
  timer.unref();
}

/** Every desktop message this headless renderer deliberately does not
 * implement gets a well-formed, explicit error -- never a silent wrong
 * success. This throws (surfacing as the json-ipc envelope's
 * `{ok:false,error}` and a REJECTED `requestJsonIpc` promise) rather than
 * returning an `{ok:false}`-shaped value, because none of these messages
 * has a daemon call site or a caller-checked typed Result contract to
 * honor (unlike RENDER_SLIDES/EXPORT_ARTIFACT/EXPORT_PDF below) -- a
 * thrown transport-level error is the correct "this was never a
 * request/response exchange" signal for a message this renderer has no
 * business accepting at all (review finding 4: default-deny on unknown/
 * automation messages, not a request-shaped non-answer). */
function throwUnsupportedMessage(type: string): never {
  throw new Error(`'${type}' is not implemented in the headless renderer`);
}

export async function startDesktopRendererSidecar(
  runtime: SidecarRuntimeContext<SidecarStamp>,
): Promise<DesktopRendererSidecarHandle> {
  const state: DesktopStatusSnapshot = {
    pid: process.pid,
    state: "running",
    updatedAt: new Date().toISOString(),
  };

  let ipcServer: JsonIpcServerHandle | null = null;
  let stopped = false;
  let resolveStopped!: () => void;
  const stoppedPromise = new Promise<void>((resolveStop) => {
    resolveStopped = resolveStop;
  });

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    state.state = "idle";
    state.updatedAt = new Date().toISOString();
    await ipcServer?.close().catch(() => undefined);
    resolveStopped();
  }

  attachParentMonitor(stop);

  ipcServer = await createJsonIpcServer({
    socketPath: runtime.ipc,
    handler: async (message: unknown) => {
      const request = normalizeDesktopSidecarMessage(message);
      switch (request.type) {
        case SIDECAR_MESSAGES.STATUS:
          state.updatedAt = new Date().toISOString();
          return state;
        case SIDECAR_MESSAGES.SHUTDOWN:
          setImmediate(() => {
            void stop().finally(() => process.exit(0));
          });
          return { accepted: true };
        case SIDECAR_MESSAGES.RENDER_SLIDES:
          return await renderSlides(runtime.base, request.input);
        case SIDECAR_MESSAGES.EXPORT_ARTIFACT:
          return await exportArtifact(runtime.base, request.input);
        case SIDECAR_MESSAGES.EXPORT_PDF:
          // Has a real (if secondary) call site and a typed Result contract
          // (import-export-routes.ts's /export/pdf route forwards the result
          // body as-is) -- honor that contract with an explicit ok:false
          // rather than a transport-level throw. Vector printToPDF parity is
          // out of scope per the spec's own risk note: the CLI already
          // avoids this path for CJK glyph loss and prefers RENDER_SLIDES.
          return {
            ok: false,
            error: "EXPORT_PDF (vector printToPDF parity) is not implemented in the headless renderer -- use render-slides instead",
          };
        case SIDECAR_MESSAGES.EVAL:
        case SIDECAR_MESSAGES.SCREENSHOT:
        case SIDECAR_MESSAGES.CLICK:
        case SIDECAR_MESSAGES.CONSOLE:
        case SIDECAR_MESSAGES.SHOW:
        case SIDECAR_MESSAGES.UPDATE:
          return throwUnsupportedMessage(request.type);
        default:
          // Runtime default-deny (review finding 6): if
          // normalizeDesktopSidecarMessage ever becomes lenient, or a new
          // SIDECAR_MESSAGES member lands upstream before this switch is
          // updated, fall through to an explicit throw rather than
          // returning `undefined` inside a successful `{ok:true}` IPC
          // envelope (a silent wrong success).
          return throwUnsupportedMessage((request as { type: string }).type);
      }
    },
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void stop().finally(() => process.exit(0));
    });
  }

  return {
    async status() {
      return state;
    },
    stop,
    waitUntilStopped() {
      return stoppedPromise;
    },
  };
}
