import type { Express, Request, Response } from 'express';

import type { PreviewOpenResponse } from '@open-design/contracts';

import { openInChrome } from '../browser/browser-open.js';
import { announcePreviewOnRequestHost, loopbackPreviewUrl } from '../preview-origin.js';
import { PREVIEW_PROXY_MOUNT, createPreviewProxyHandler } from '../preview-proxy.js';
import { PreviewLifecycleError, type createPreviewService } from '../previews.js';

export type PreviewRoutesDeps = {
  previews: ReturnType<typeof createPreviewService>;
  projectStore: { getProject: (id: string) => unknown };
  /**
   * Resolve the working directory a preview may run in. The server wiring
   * confines the requested cwd to the project's own directory; tests inject a
   * fixture resolver. Returning null rejects the request.
   */
  resolvePreviewCwd: (projectId: string, requestedCwd?: string) => string | null;
  /**
   * Launch a URL in Google Chrome on the daemon's own machine. Returns false
   * when the launcher process never started — which means "no Chrome" only on
   * Linux, where the launcher IS the browser. Injectable so tests can assert
   * the hand-off without opening a browser.
   */
  openPreviewInChrome?: (url: string) => boolean;
};

/**
 * Daemon-managed preview servers under `/api/projects/:id/previews`
 * (issue #38): start resolves only after the port verifiably answers HTTP,
 * previews outlive the agent tool call that asked for them, and stop reports
 * success only when the whole process group is confirmed gone.
 *
 * The preview itself is served under `.../previews/:previewId/proxy/`
 * (decision D-14): inside `/api`, so it sits behind the daemon's origin gate
 * and bearer policy, and reachable wherever the daemon is.
 */
export function registerPreviewRoutes(app: Express, deps: PreviewRoutesDeps): void {
  const { previews, projectStore, resolvePreviewCwd } = deps;
  const openPreviewInChrome = deps.openPreviewInChrome ?? ((url: string) => openInChrome(url) !== null);

  const assertProject = (req: Request, res: Response): boolean => {
    if (projectStore.getProject(String(req.params.id))) return true;
    res.status(404).json({ error: 'PROJECT_NOT_FOUND' });
    return false;
  };

  app.post('/api/projects/:id/previews', async (req, res) => {
    if (!assertProject(req, res)) return;
    const body = (req.body ?? {}) as { command?: unknown; port?: unknown; cwd?: unknown };
    const command = Array.isArray(body.command) && body.command.every((c) => typeof c === 'string')
      ? (body.command as string[])
      : null;
    const port = Number(body.port);
    if (!command || command.length === 0) {
      res.status(400).json({ error: 'command must be a non-empty string array' });
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      res.status(400).json({ error: 'port must be an integer in 1-65535' });
      return;
    }
    const cwd = resolvePreviewCwd(
      String(req.params.id),
      typeof body.cwd === 'string' ? body.cwd : undefined,
    );
    if (!cwd) {
      res.status(400).json({ error: 'cwd is outside the project directory' });
      return;
    }
    try {
      const session = await previews.start({
        projectId: String(req.params.id),
        cwd,
        command,
        port,
      });
      res.json(announcePreviewOnRequestHost(session, req.headers));
    } catch (error) {
      if (error instanceof PreviewLifecycleError) {
        const status = error.code === 'PREVIEW_PORT_IN_USE' ? 409 : 502;
        res.status(status).json({ error: error.code, message: error.message, logs: error.logs });
        return;
      }
      res.status(500).json({ error: 'PREVIEW_START_FAILED', message: String(error) });
    }
  });

  // Registered before the list route only for readability; the mount path is
  // distinct so order does not matter.
  app.use(PREVIEW_PROXY_MOUNT, createPreviewProxyHandler({ getPreview: (id) => previews.get(id) }));

  app.get('/api/projects/:id/previews', (req, res) => {
    if (!assertProject(req, res)) return;
    res.json({
      previews: previews
        .list(String(req.params.id))
        .map((session) => announcePreviewOnRequestHost(session, req.headers)),
    });
  });

  // "Open in Chrome": the daemon's default browser may refuse loopback
  // connections, which makes an otherwise healthy preview server look dead
  // (issue #158). The URL is derived from the registered session rather than
  // taken from the request, so this route cannot be talked into launching an
  // arbitrary address, and it is always the loopback one because Chrome runs
  // on the daemon's machine.
  //
  // `opened: true` means the launcher process started — no more than that.
  // A launcher that never started at all answers 502; that is the whole of
  // what a detached opener can observe, and it is not the same as "Chrome
  // opened". On Linux the launcher IS the browser, so a missing Chrome does
  // reach the caller as 502; on macOS and Windows the launcher is
  // `/usr/bin/open` / `cmd.exe`, which start whether or not Chrome is
  // installed, so a missing Chrome there is invisible to this route.
  app.post('/api/projects/:id/previews/:previewId/open', (req, res) => {
    if (!assertProject(req, res)) return;
    const session = previews.get(String(req.params.previewId));
    if (!session || session.projectId !== String(req.params.id)) {
      res.status(404).json({ error: 'PREVIEW_NOT_FOUND' });
      return;
    }
    const url = loopbackPreviewUrl(session.port);
    if (!openPreviewInChrome(url)) {
      res.status(502).json({ error: 'PREVIEW_OPEN_FAILED', url });
      return;
    }
    const body: PreviewOpenResponse = { opened: true, url, browser: 'chrome' };
    res.json(body);
  });

  app.delete('/api/projects/:id/previews/:previewId', async (req, res) => {
    if (!assertProject(req, res)) return;
    const session = previews.get(String(req.params.previewId));
    if (!session || session.projectId !== String(req.params.id)) {
      res.status(404).json({ error: 'PREVIEW_NOT_FOUND' });
      return;
    }
    try {
      const result = await previews.stop(String(req.params.previewId));
      if (!result.confirmed) {
        // Per the teardown discipline: an unconfirmed group teardown is not a
        // success. The session stays registered so the caller can retry, and
        // the pid lets an operator intervene out-of-band.
        res.status(500).json({ error: 'PREVIEW_STOP_UNCONFIRMED', pid: result.pid });
        return;
      }
      res.json({ stopped: true });
    } catch (error) {
      res.status(500).json({ error: 'PREVIEW_STOP_FAILED', message: String(error) });
    }
  });
}
