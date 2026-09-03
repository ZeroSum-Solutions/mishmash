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
   * The preview's address on the host the request arrived on, with the
   * preview's own port (issue #158). A caller on the daemon's machine gets
   * `http://127.0.0.1:<port>/`; a collaborator reaching the daemon over a
   * tailnet gets that tailnet host, because the loopback address would
   * resolve to their own machine. Always plain `http:` — the preview process
   * speaks HTTP on its port whatever scheme fronted the daemon.
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
 * `opened` reports that the launcher was started. A machine with no Chrome
 * fails the spawn and answers 502 `PREVIEW_OPEN_FAILED` instead.
 */
export type PreviewOpenResponse = {
  opened: true;
  url: string;
  browser: 'chrome';
};
