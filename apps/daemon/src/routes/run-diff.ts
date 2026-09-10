import type { Express, Request, Response } from 'express';
import type Database from 'better-sqlite3';

import type { RunDiffResponse } from '@open-design/contracts';

import {
  listProjectFileVersionsForRun,
  type ProjectFileVersionsForRunEntry,
} from '../project-file-versions.js';

type SqliteDb = Database.Database;

interface RunDiffRun {
  id: string;
  projectId?: string | null;
  projectMetadata?: unknown;
}

export interface RegisterRunDiffRoutesDeps {
  db: SqliteDb;
  design: { runs: { get(id: string): RunDiffRun | null | undefined } };
  projects: {
    /** Managed-project root; the same `PROJECTS_DIR` the run routes already hold. */
    PROJECTS_DIR: string;
    getProject: (db: SqliteDb, id: string) => { metadata?: unknown } | undefined | null;
  };
  http: {
    sendApiError: (
      res: Response,
      status: number,
      code: string,
      message: string,
    ) => Response<unknown> | void;
  };
}

/**
 * Resolves the project a run belonged to, from disk when memory has forgotten it.
 *
 * INVARIANT: this must answer for a run that finished before the current daemon
 * process started. The in-memory run map is a cache, not the record — after a
 * restart it is empty, and `GET /api/runs/:id/diff` still has to work. The two
 * durable records are the assistant message row a run pins
 * (`messages.run_id` -> `conversations.project_id`) and, for a
 * routine-triggered run that never went through `POST /api/runs`,
 * `routine_runs.agent_run_id` -> `routine_runs.project_id`.
 *
 * Returns `null` only when no record anywhere knows the run, which is a real
 * 404 rather than a restart artefact.
 */
function resolveRunProject(
  deps: RegisterRunDiffRoutesDeps,
  runId: string,
): { projectId: string; metadata: unknown } | null {
  const live = deps.design.runs.get(runId);
  if (live && typeof live.projectId === 'string' && live.projectId) {
    return { projectId: live.projectId, metadata: live.projectMetadata ?? projectMetadata(deps, live.projectId) };
  }
  const fromMessages = deps.db
    .prepare(
      `SELECT c.project_id AS projectId
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
        WHERE m.run_id = ?
        LIMIT 1`,
    )
    .get(runId) as { projectId?: string } | undefined;
  if (typeof fromMessages?.projectId === 'string' && fromMessages.projectId) {
    return { projectId: fromMessages.projectId, metadata: projectMetadata(deps, fromMessages.projectId) };
  }
  const fromRoutine = deps.db
    .prepare(`SELECT project_id AS projectId FROM routine_runs WHERE agent_run_id = ? LIMIT 1`)
    .get(runId) as { projectId?: string } | undefined;
  if (typeof fromRoutine?.projectId === 'string' && fromRoutine.projectId) {
    return { projectId: fromRoutine.projectId, metadata: projectMetadata(deps, fromRoutine.projectId) };
  }
  return null;
}

function projectMetadata(deps: RegisterRunDiffRoutesDeps, projectId: string): unknown {
  try {
    return deps.projects.getProject(deps.db, projectId)?.metadata;
  } catch {
    return undefined;
  }
}

/**
 * `GET /api/runs/:id/diff` — what one run changed, before and after.
 *
 * Lives beside `routes/runs.ts` rather than inside it (that file is already
 * over 1600 lines) and is registered from it, so `server.ts` needs no route
 * wiring for this addition.
 */
export function registerRunDiffRoutes(app: Express, deps: RegisterRunDiffRoutesDeps): void {
  const { sendApiError } = deps.http;

  app.get('/api/runs/:id/diff', async (req: Request, res: Response) => {
    const runId = String(req.params.id ?? '').trim();
    if (!runId) return sendApiError(res, 400, 'BAD_REQUEST', 'run id missing');

    const project = resolveRunProject(deps, runId);
    if (!project) return sendApiError(res, 404, 'NOT_FOUND', 'run not found');

    let entries: ProjectFileVersionsForRunEntry[];
    try {
      entries = await listProjectFileVersionsForRun(
        deps.projects.PROJECTS_DIR,
        project.projectId,
        runId,
        project.metadata,
      );
    } catch (err) {
      // A project whose directory is gone (deleted, or an unavailable imported
      // folder) has no history to diff. That is an empty answer for a known
      // run, not a server error.
      console.warn('[run-diff] version scan failed', err);
      entries = [];
    }

    const body: RunDiffResponse = {
      runId,
      files: entries.map((entry) => ({
        fileName: entry.fileName,
        kind: entry.kind,
        before: entry.before,
        after: entry.after,
        actorName: entry.actorName,
        at: entry.at,
      })),
    };
    res.json(body);
  });
}
