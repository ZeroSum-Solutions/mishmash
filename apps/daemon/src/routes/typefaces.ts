// Typeface catalogue HTTP routes — the UI and CLI surfaces both call these
// (per AGENTS.md "Capability exposure"), so this file is the single source
// of truth for what "install a typeface" means. See
// apps/daemon/src/typefaces/catalogue.ts for the index/install logic and
// apps/daemon/src/typefaces/allowlist.ts for the licence gate.
import type { Express } from 'express';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type {
  GetTypefaceResponse,
  InstallTypefaceRequest,
  InstallTypefaceResponse,
  ListTypefacesResponse,
} from '@open-design/contracts';

import {
  describeExcludedTypeface,
  findIndexedTypefaceFace,
  getTypeface,
  installTypeface,
  listTypefaces,
  TypefaceInstallPathError,
  TypefaceNotFoundError,
} from '../typefaces/catalogue.js';
import { mimeFor } from '../projects.js';
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

  // R1 (F008): serve one indexed face's raw bytes. The :file match is
  // against IndexedTypeface.faces -- never a filesystem path derived from
  // request input -- so an unknown/cross-family/traversal-shaped filename
  // simply fails the lookup (404), with no path-join step to defend at all.
  // sendFile still follows symlinks, so the resolved byte path is
  // realpath-checked against its own template's fonts/ directory before
  // being served -- mirrors static-resource.ts's sendSkillSubresource
  // containment check (audit correction: the index's own build-time check,
  // catalogue.ts:147, is lexical only and does not defend against this).
  app.get('/api/typefaces/:id/faces/:file', async (req, res) => {
    try {
      const face = await findIndexedTypefaceFace(DESIGN_TEMPLATES_DIR, req.params.id, req.params.file);
      if (!face || face.format !== 'woff2') {
        return sendApiError(res, 404, 'NOT_FOUND', `typeface face not found: ${req.params.id}/${req.params.file}`);
      }
      const fontsDir = path.dirname(face.sourcePath);
      let fontsDirReal: string;
      let sourcePathReal: string;
      try {
        fontsDirReal = await fsp.realpath(fontsDir);
        sourcePathReal = await fsp.realpath(face.sourcePath);
      } catch {
        return sendApiError(res, 404, 'NOT_FOUND', `typeface face not found: ${req.params.id}/${req.params.file}`);
      }
      if (sourcePathReal !== fontsDirReal && !sourcePathReal.startsWith(fontsDirReal + path.sep)) {
        return sendApiError(res, 400, 'BAD_REQUEST', 'invalid face path');
      }
      // Content-hashed filenames (R8): safe to cache forever.
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      await res.type(mimeFor(sourcePathReal)).sendFile(path.basename(sourcePathReal), { root: fontsDirReal });
    } catch (err) {
      sendApiError(res, 500, 'INTERNAL_ERROR', errorMessage(err));
    }
  });
}
