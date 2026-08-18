// Rendered layout-risk measurement HTTP surface.
//
// See `CompositionMetrics` in `@open-design/contracts` and
// `injectCompositionMetricsBridge` in `apps/web/src/runtime/srcdoc.ts` for
// what is measured and why the daemon cannot take this measurement itself
// (no browser in its runtime dependencies). This module is purely a report
// sink + reader: `POST` files a measurement the web host received from the
// preview iframe's bridge, `GET` reads the last one back — the same
// endpoint the web UI's readout and `od composition-metrics` both call, per
// AGENTS.md's "Capability exposure (UI/CLI dual-track)".

import path from 'node:path';

import express, { type Express, type Request, type Response } from 'express';
import type { CompositionMetrics, GetCompositionMetricsQuery } from '@open-design/contracts';

import type { CompositionMetricsStore } from '../composition-metrics-store.js';
import { isSafeId } from '../projects.js';

export interface CompositionMetricsRouteDeps {
  store: CompositionMetricsStore;
  /** Absolute path of the daemon's managed project root (`PROJECTS_DIR`). */
  projectsDir: string;
  /**
   * Resolves whether a project is a web-clone run, from the project's own
   * stored `metadata.intent` — never trusted from the client. Matches the
   * exact check `apps/daemon/src/server.ts` already uses for `lintArtifact`
   * and `craft.ts`'s own web-clone exemptions.
   */
  isWebCloneRun: (projectId: string) => boolean;
}

const REQUIRED_NUMBER_FIELDS: readonly (keyof CompositionMetrics)[] = [
  'sectionCount',
  'outOfFlowElementCount',
  'transformedElementCount',
  'distinctSectionBackgroundCount',
  'distinctSectionWidthCount',
  'bodyFontSizePx',
  'maxDisplayFontSizePx',
  'displayToBodyFontRatio',
];

function isValidCompositionMetrics(value: unknown): value is CompositionMetrics {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  for (const field of REQUIRED_NUMBER_FIELDS) {
    if (typeof v[field] !== 'number' || !Number.isFinite(v[field])) return false;
  }
  if (typeof v.fullBleedAgainstContained !== 'boolean') return false;
  if (typeof v.measuredAt !== 'string' || v.measuredAt.length === 0) return false;
  return true;
}

/**
 * Resolves an absolute filesystem path into the `(projectId, file)` pair it
 * names, when it sits under the daemon's managed project root. Returns
 * `null` for anything outside `projectsDir`, a path with too few segments to
 * name a file inside a project, or an unsafe-looking project id — this is
 * the CLI's "take an artifact path" entry point, so it has to reject exactly
 * the same shapes the rest of the daemon already refuses to trust.
 */
function resolveArtifactPath(
  projectsDir: string,
  artifactPath: string,
): { projectId: string; file: string } | null {
  const normalized = path.resolve(artifactPath);
  const rel = path.relative(path.resolve(projectsDir), normalized);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const segments = rel.split(path.sep).filter(Boolean);
  if (segments.length < 2) return null;
  const [projectId, ...fileParts] = segments;
  if (!projectId || !isSafeId(projectId)) return null;
  return { projectId, file: fileParts.join('/') };
}

export function registerCompositionMetricsRoutes(app: Express, deps: CompositionMetricsRouteDeps): void {
  const { store, projectsDir, isWebCloneRun } = deps;

  app.post('/api/composition-metrics', express.json({ limit: '64kb' }), async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { projectId?: unknown; file?: unknown; metrics?: unknown };
    if (typeof body.projectId !== 'string' || !isSafeId(body.projectId)) {
      res.status(400).json({ ok: false, error: 'missing or invalid `projectId`' });
      return;
    }
    if (typeof body.file !== 'string' || body.file.trim() === '') {
      res.status(400).json({ ok: false, error: 'missing `file`' });
      return;
    }
    if (!isValidCompositionMetrics(body.metrics)) {
      res.status(400).json({ ok: false, error: 'missing or malformed `metrics`' });
      return;
    }
    try {
      const record = await store.set(body.projectId, body.file, body.metrics, isWebCloneRun(body.projectId));
      res.json({ ok: true, record });
    } catch (err) {
      res.status(500).json({ ok: false, error: String((err as Error)?.message ?? err) });
    }
  });

  app.get('/api/composition-metrics', async (req: Request, res: Response) => {
    const query = req.query as GetCompositionMetricsQuery;
    let projectId: string | undefined;
    let file: string | undefined;

    if (typeof query.artifactPath === 'string' && query.artifactPath.trim() !== '') {
      const resolved = resolveArtifactPath(projectsDir, query.artifactPath);
      if (!resolved) {
        res.status(400).json({
          ok: false,
          error: 'artifactPath is not a file inside a managed project — pass `projectId`+`file` instead',
        });
        return;
      }
      projectId = resolved.projectId;
      file = resolved.file;
    } else {
      projectId = typeof query.projectId === 'string' ? query.projectId : undefined;
      file = typeof query.file === 'string' ? query.file : undefined;
    }

    if (!projectId || !isSafeId(projectId) || !file) {
      res.status(400).json({
        ok: false,
        error: 'pass either `artifactPath`, or both `projectId` and `file`',
      });
      return;
    }

    const record = await store.get(projectId, file);
    res.json({ ok: true, record });
  });
}
