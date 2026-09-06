// Shared DTO for `GET /api/health`, the daemon's liveness probe. Keep this file
// pure TypeScript -- no Node, DOM, or runtime deps -- per the contracts boundary.

/** Response from `GET /api/health`. */
export interface DaemonHealthResponse {
  ok: boolean;
  /** The daemon's app version, e.g. `0.15.1`. */
  version: string;
  /**
   * Identity of the daemon PROCESS answering, minted once when it starts.
   *
   * A browser session outlives a daemon restart, so a client that caches a
   * boot-time answer -- which renderers are wired, for instance -- needs a cheap
   * way to notice that the process it asked is gone. Comparing this value is
   * that way. Opaque: a client may only test it for equality, never parse it.
   */
  bootId: string;
}
