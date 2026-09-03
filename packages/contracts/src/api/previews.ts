/**
 * Daemon-managed preview servers (issue #38): `/api/projects/:id/previews`.
 * The daemon owns preview processes so they outlive the agent tool call that
 * started them; `start` responds only after the port verifiably answers HTTP.
 */

export type PreviewInfo = {
  id: string;
  projectId: string;
  pid: number;
  port: number;
  /**
   * Where to fetch the preview: its path on the Open Design front the request
   * arrived on, which the daemon serves by proxying to the loopback child
   * (issue #158, decision D-14). It is reachable wherever the daemon is,
   * under the same scheme and the same authentication, so a collaborator gets
   * a working link and `port` below stays a detail of the daemon's own
   * machine. A request no header can place is answered with the path alone,
   * to be resolved against the origin the caller used.
   *
   * Two shapes a proxied preview cannot serve, both inherent to hosting a dev
   * server under a path: a root-absolute request whose initiator sends no
   * `Referer` (a `no-referrer` policy, a WebSocket handshake), and a request
   * body over the daemon's 4mb API limit.
   */
  url: string;
  command: string[];
  cwd: string;
  startedAt: number;
  status: 'ready';
};

export type PreviewStartRequest = {
  command: string[];
  port: number;
  /** Working directory relative to the project dir; must stay inside it. */
  cwd?: string;
};

export type PreviewListResponse = {
  previews: PreviewInfo[];
};

/**
 * Result of `POST /api/projects/:id/previews/:previewId/open` — the daemon
 * launched the preview in Google Chrome on ITS OWN machine, because the
 * host's default browser may refuse loopback connections (issue #158
 * comment: EGO Lite task spaces do). The URL is the loopback one, since that
 * is the address the daemon's machine reaches the preview on.
 *
 * `opened` reports that the launcher process started, not that Chrome came
 * up: a detached opener cannot see further. A launcher that never started
 * answers 502 `PREVIEW_OPEN_FAILED` instead — which on Linux does mean no
 * Chrome, while on macOS and Windows the launcher (`open`, `cmd.exe`) starts
 * whether Chrome is installed or not.
 */
export type PreviewOpenResponse = {
  opened: true;
  url: string;
  browser: 'chrome';
};
