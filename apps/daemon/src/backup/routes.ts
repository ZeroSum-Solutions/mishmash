// HTTP surface for the backup engine: POST /api/backup, POST /api/restore.
// Both call the exact same create.ts / restore.ts core the `od backup` /
// `od restore` CLI uses (see cli.ts) -- UI/CLI parity per AGENTS.md
// "Capability exposure": one engine, two callers.
//
// NOTE ON REGISTRATION SITE: these routes are registered from
// registerLibraryRoutes() (apps/daemon/src/routes/library.ts), not from
// server.ts. apps/daemon/src/server.ts is outside this wave's write lease
// (docs/plans/waves/leases.json, W0), and route registration only happens
// inside startServer() there, so there is no lease-compliant way to add a
// new top-level `registerBackupRoutes(app, ...)` call at its normal call
// site. library.ts IS in the lease, so this module is registered from
// inside it instead. See the wave's completion report for the full
// rationale -- this is a deliberate, documented consequence of the lease
// shape, not an architectural preference.

import type { Express, RequestHandler } from 'express';
import { createBackupArchive } from './create.js';
import { restoreBackupArchive, RestoreError } from './restore.js';

export interface RegisterBackupRoutesDeps {
  getRuntimeDataDir: () => string;
  requireLocalDaemonRequest: RequestHandler;
  sendApiError: (res: unknown, status: number, code: string, message: string, extra?: Record<string, unknown>) => unknown;
}

export function registerBackupRoutes(app: Express, deps: RegisterBackupRoutesDeps): void {
  const { getRuntimeDataDir, requireLocalDaemonRequest, sendApiError } = deps;

  // Loopback-only, like every other data-mutating daemon route
  // (requireLocalDaemonRequest rejects a cross-origin browser page; see
  // apps/daemon/src/http/local-daemon-request.ts). Backup/restore touch the
  // entire data directory, so this is the highest-privilege pair of routes
  // in the daemon.
  app.post('/api/backup', requireLocalDaemonRequest, async (req, res) => {
    const body = (req.body ?? {}) as { outPath?: unknown };
    const outPath = typeof body.outPath === 'string' ? body.outPath : undefined;
    if (!outPath) return sendApiError(res, 400, 'BAD_REQUEST', 'outPath is required');
    try {
      const result = await createBackupArchive({ dataDir: getRuntimeDataDir(), outPath });
      res.json({ ok: true, archivePath: result.archivePath, classes: result.manifest.map((e) => e.class) });
    } catch (err) {
      return sendApiError(res, 500, 'BACKUP_FAILED', err instanceof Error ? err.message : String(err));
    }
  });

  app.post('/api/restore', requireLocalDaemonRequest, async (req, res) => {
    const body = (req.body ?? {}) as { archivePath?: unknown };
    const archivePath = typeof body.archivePath === 'string' ? body.archivePath : undefined;
    if (!archivePath) return sendApiError(res, 400, 'BAD_REQUEST', 'archivePath is required');
    try {
      const result = await restoreBackupArchive({ archivePath, dataDir: getRuntimeDataDir() });
      res.json({ ok: true, restoredClasses: result.restoredClasses, destination: result.destination });
    } catch (err) {
      if (err instanceof RestoreError) {
        return sendApiError(res, 422, 'RESTORE_FAILED', err.message, { corruptedClass: err.corruptedClass });
      }
      return sendApiError(res, 500, 'RESTORE_FAILED', err instanceof Error ? err.message : String(err));
    }
  });
}
