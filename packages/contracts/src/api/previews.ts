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
