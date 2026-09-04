// Project cover HTTP routes (S4-1..S4-4). FROZEN contract -- see the header
// comment in scripts/waves/verify-w4.ts and packages/contracts/src/api/covers.ts:
//
//   POST /api/projects/:id/cover/generate -- SYNCHRONOUS, blocks until the
//     render job finishes (success, failure, or internal timeout).
//   GET  /api/projects/:id/cover           -- raw image bytes 200 if a cover
//     has been generated, 404 otherwise. "Has been generated" is the frozen
//     condition, not "is readable this instant" -- see servedCoverImage below.

import type { Express } from 'express';
import { PROJECT_COVER_PLACEHOLDER_HEADER } from '@open-design/contracts';
import { generateProjectCover } from '../covers/service.js';
import { isTypedCoverError } from '../covers/errors.js';
import { COVER_PLACEHOLDER_PNG } from '../covers/placeholder.js';
import { isIntactPng } from '../covers/png.js';
import { hasAdvertisedCover, readCoverImageBytes } from '../covers/store.js';
import { isSafeId } from '../projects.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterCoversRoutesDeps extends RouteDeps<'db' | 'paths' | 'projectStore' | 'projectFiles'> {}

function errorMessage(err: unknown): string {
  return String((err as { message?: unknown } | null)?.message ?? err);
}

interface ServedCoverImage {
  bytes: Buffer;
  placeholder: boolean;
}

/**
 * Projects whose stored cover has already been reported as unusable.
 *
 * The route answers `no-store`, so a card left on screen re-asks for a damaged
 * cover on every render. One line per project per damage episode is the
 * difference between a signal an operator can act on and a log flood; the id
 * is dropped again as soon as the project serves an intact cover, so a
 * re-damaged cover is reported afresh.
 */
const reportedUnusableCovers = new Set<string>();

function reportUnusableCoverOnce(projectId: string): void {
  if (reportedUnusableCovers.has(projectId)) return;
  reportedUnusableCovers.add(projectId);
  console.warn(
    `[covers] stored cover for project ${projectId} is not an intact PNG; serving the placeholder instead`,
  );
}

/**
 * The image bytes `GET /api/projects/:id/cover` must answer for a project the
 * caller is allowed to address, or `null` when the project has advertised no
 * cover and the route answers 404.
 *
 * INVARIANT: a cover the daemon advertises never answers 404.
 *
 * `Project.hasCover` is published from an existence check (`hasCoverImage`) at
 * the moment the projects list is built, and these bytes are read in a later,
 * separate request. Between the two the file can be deleted from another tab,
 * truncated mid-replace, or become unreadable. The client has already put the
 * URL in an `<img>` on the strength of that advertisement, so failing it now
 * breaks the image and files a `resource-failed` anomaly against a resource
 * the daemon itself advertised.
 *
 * So an advertised cover whose stored bytes cannot be served serves the
 * neutral placeholder instead, flagged with
 * `PROJECT_COVER_PLACEHOLDER_HEADER` so a caller that wants the real answer
 * can still tell. "Cannot be served" is `isIntactPng`, not merely a failed
 * read: `readCoverImageBytes` returns a zero-length Buffer for a truncated
 * file, which is truthy, and damaged bytes break the `<img>` exactly as a 404
 * does. Damage that leaves the file's outer frame in place — a byte flipped
 * inside a chunk, a chunk header rewritten — breaks it just the same, which is
 * why the check walks the whole container rather than inspecting its edges.
 *
 * This says nothing about the two guards at the call site. An unsafe id and an
 * unknown project are a path-traversal defence, not an answer about cover
 * availability, and they still answer 404.
 */
async function servedCoverImage(runtimeDataDir: string, projectId: string): Promise<ServedCoverImage | null> {
  const bytes = await readCoverImageBytes(runtimeDataDir, projectId);
  if (bytes && isIntactPng(bytes)) {
    reportedUnusableCovers.delete(projectId);
    return { bytes, placeholder: false };
  }
  if (bytes) reportUnusableCoverOnce(projectId);
  if (await hasAdvertisedCover(runtimeDataDir, projectId)) {
    return { bytes: COVER_PLACEHOLDER_PNG, placeholder: true };
  }
  return null;
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
    const served = await servedCoverImage(RUNTIME_DATA_DIR, projectId);
    if (!served) return res.status(404).end();
    res.setHeader('Content-Type', 'image/png');
    // `no-store` on both answers: a placeholder that outlived the moment its
    // bytes were unreadable would keep a recovered cover off the screen.
    res.setHeader('Cache-Control', 'no-store');
    if (served.placeholder) res.setHeader(PROJECT_COVER_PLACEHOLDER_HEADER, '1');
    return res.status(200).end(served.bytes);
  });
}
