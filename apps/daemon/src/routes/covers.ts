// Project cover HTTP routes (S4-1..S4-4). FROZEN contract -- see the header
// comment in scripts/waves/verify-w4.ts and packages/contracts/src/api/covers.ts:
//
//   POST /api/projects/:id/cover/generate -- SYNCHRONOUS, blocks until the
//     render job finishes (success, failure, or internal timeout).
//   GET  /api/projects/:id/cover           -- raw image bytes 200, or 404.

import type { Express } from 'express';
import { generateProjectCover } from '../covers/service.js';
import { isTypedCoverError } from '../covers/errors.js';
import { readCoverImageBytes } from '../covers/store.js';
import { isSafeId } from '../projects.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterCoversRoutesDeps extends RouteDeps<'db' | 'paths' | 'projectStore' | 'projectFiles'> {}

function errorMessage(err: unknown): string {
  return String((err as { message?: unknown } | null)?.message ?? err);
}

export function registerCoverRoutes(app: Express, ctx: RegisterCoversRoutesDeps): void {
  const { db } = ctx;
  const { PROJECTS_DIR, RUNTIME_DATA_DIR } = ctx.paths;
  const { getProject } = ctx.projectStore;
  const { resolveProjectDir } = ctx.projectFiles;

  app.post('/api/projects/:id/cover/generate', async (req, res) => {
    const projectId = String(req.params.id ?? '');
    const project = getProject(db, projectId);
    if (!project) {
      return res.status(404).json({ ok: false, error: { code: 'PROJECT_NOT_FOUND', message: `project ${projectId} not found` } });
    }

    let projectRoot: string;
    try {
      projectRoot = resolveProjectDir(PROJECTS_DIR, projectId, project.metadata);
    } catch (err) {
      return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: errorMessage(err) } });
    }

    try {
      const cover = await generateProjectCover({
        runtimeDataDir: RUNTIME_DATA_DIR,
        projectRoot,
        projectId,
      });
      return res.status(200).json({ ok: true, cover });
    } catch (err) {
      if (isTypedCoverError(err)) {
        const status = err.code === 'NO_RENDERABLE_ENTRY' ? 422 : 500;
        return res.status(status).json({ ok: false, error: { code: err.code, message: err.message } });
      }
      return res.status(500).json({ ok: false, error: { code: 'RENDER_FAILED', message: errorMessage(err) } });
    }
  });

  app.get('/api/projects/:id/cover', async (req, res) => {
    const projectId = String(req.params.id ?? '');
    // A path-traversal-shaped id (e.g. "..") must never reach the covers
    // store: readCoverImageBytes joins projectId straight onto the covers
    // root, so an unvalidated ".." here could read cover.png from ANY
    // sibling directory under RUNTIME_DATA_DIR. isSafeId() is the same
    // guard resolveProjectDir() applies for the POST generate route above.
    if (!isSafeId(projectId) || !getProject(db, projectId)) {
      return res.status(404).end();
    }
    const bytes = await readCoverImageBytes(RUNTIME_DATA_DIR, projectId);
    if (!bytes) return res.status(404).end();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).end(bytes);
  });
}
