// Typeface catalogue HTTP routes — the UI and CLI surfaces both call these
// (per AGENTS.md "Capability exposure"), so this file is the single source
// of truth for what "install a typeface" means. See
// apps/daemon/src/typefaces/catalogue.ts for the index/install logic and
// apps/daemon/src/typefaces/allowlist.ts for the licence gate.
import type { Express } from 'express';
import type {
  GetTypefaceResponse,
  InstallTypefaceRequest,
  InstallTypefaceResponse,
  ListTypefacesResponse,
} from '@open-design/contracts';

import {
  describeExcludedTypeface,
  getTypeface,
  installTypeface,
  listTypefaces,
  TypefaceInstallPathError,
  TypefaceNotFoundError,
} from '../typefaces/catalogue.js';
import type { RouteDeps } from '../server-context.js';

export interface RegisterTypefaceRoutesDeps
  extends RouteDeps<'http' | 'paths' | 'db' | 'projectStore' | 'projectFiles'> {}

function errorMessage(err: unknown): string {
  return String((err as { message?: unknown } | null)?.message ?? err);
}

export function registerTypefaceRoutes(app: Express, ctx: RegisterTypefaceRoutesDeps): void {
  const { db } = ctx;
  const { DESIGN_TEMPLATES_DIR, PROJECTS_DIR } = ctx.paths;
  const { getProject } = ctx.projectStore;
  const { resolveProjectDir } = ctx.projectFiles;
  const { sendApiError } = ctx.http;

  app.get('/api/typefaces', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const monospace = req.query.monospace === 'true' ? true : req.query.monospace === 'false' ? false : undefined;
      const condensed = req.query.condensed === 'true';
      const { typefaces, scannedFamilies } = await listTypefaces(DESIGN_TEMPLATES_DIR, {
        ...(q ? { q } : {}),
        ...(monospace != null ? { monospace } : {}),
        condensed,
      });
      const body: ListTypefacesResponse = { typefaces, scannedFamilies };
      res.json(body);
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', errorMessage(err));
    }
  });

  app.get('/api/typefaces/:id', async (req, res) => {
    try {
      const typeface = await getTypeface(DESIGN_TEMPLATES_DIR, req.params.id);
      if (!typeface) {
        const excludedReason = await describeExcludedTypeface(DESIGN_TEMPLATES_DIR, req.params.id);
        return sendApiError(
          res,
          404,
          'NOT_FOUND',
          excludedReason
            ? `typeface "${req.params.id}" is present in the template catalogue but excluded from the installable pool: ${excludedReason}`
            : `typeface not found: ${req.params.id}`,
        );
      }
      const body: GetTypefaceResponse = { typeface };
      res.json(body);
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', errorMessage(err));
    }
  });

  app.post('/api/typefaces/:id/install', async (req, res) => {
    const request = (req.body ?? {}) as InstallTypefaceRequest;
    const projectId = typeof request.projectId === 'string' ? request.projectId : '';
    if (!projectId) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'projectId is required');
    }
    const project = getProject(db, projectId);
    if (!project) {
      return sendApiError(res, 404, 'PROJECT_NOT_FOUND', `project ${projectId} not found`);
    }

    let projectRoot: string;
    try {
      projectRoot = resolveProjectDir(PROJECTS_DIR, projectId, project.metadata);
    } catch (err) {
      return sendApiError(res, 400, 'BAD_REQUEST', errorMessage(err));
    }

    try {
      const result = await installTypeface(DESIGN_TEMPLATES_DIR, req.params.id, {
        projectRoot,
        ...(typeof request.dir === 'string' && request.dir ? { dir: request.dir } : {}),
      });
      const body: InstallTypefaceResponse = result;
      res.status(201).json(body);
    } catch (err) {
      if (err instanceof TypefaceNotFoundError) {
        const excludedReason = await describeExcludedTypeface(DESIGN_TEMPLATES_DIR, req.params.id);
        return sendApiError(
          res,
          404,
          'NOT_FOUND',
          excludedReason
            ? `typeface "${req.params.id}" is present in the template catalogue but excluded from the installable pool: ${excludedReason}`
            : `typeface not found: ${req.params.id}`,
        );
      }
      if (err instanceof TypefaceInstallPathError) {
        return sendApiError(res, 400, 'BAD_REQUEST', errorMessage(err));
      }
      sendApiError(res, 500, 'INTERNAL_ERROR', errorMessage(err));
    }
  });
}
