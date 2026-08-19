import type Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import type { CritiqueStatusResponse } from '@open-design/contracts';

import { getProject } from '../db.js';
import { listSkills } from '../skills.js';
import { isCritiqueEnabled, parseEnvEnabled, parseRolloutPhase } from './rollout.js';
import { narrowProjectCritiqueOverride } from './spawn-inputs.js';

/**
 * GET /api/projects/:projectId/critique/status
 *
 * Answers "would Critique Theater run for this project, and why" without
 * starting a generation. Until this existed, the only way to find out was to
 * run one and read the daemon's stdout — which is how the feature came to be
 * believed unwired while it was in fact live.
 *
 * This answers the ROLLOUT POLICY layer only. A real generation also needs a
 * resolved design system, a non-media surface, a plain-stream adapter and a
 * daemon below its concurrency cap — all request-dependent, none knowable
 * from a project id. The skill policy is also resolved from the project's
 * bound skill alone, so ad-hoc skills a prompt adds by @-mention are
 * invisible. Both limits are why the response is marked `approximate`
 * rather than quietly presented as exact.
 */
export function handleCritiqueStatus(
  db: Database.Database,
  deps: { skillsRoots: readonly string[] },
): (req: Request, res: Response) => Promise<void> {
  return async function critiqueStatusHandler(req: Request, res: Response): Promise<void> {
    const projectId =
      typeof req.params['projectId'] === 'string' ? req.params['projectId'].trim() : '';
    if (!projectId) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'projectId is required' } });
      return;
    }
    const project = getProject(db, projectId);
    if (!project) {
      res
        .status(404)
        .json({ error: { code: 'PROJECT_NOT_FOUND', message: `unknown project: ${projectId}` } });
      return;
    }

    const skills = await listSkills(deps.skillsRoots);
    const boundSkill = project.skillId
      ? skills.find((skill) => skill.id === project.skillId)
      : undefined;
    const skillPolicy = boundSkill?.critiquePolicy ?? null;
    const projectOverride = narrowProjectCritiqueOverride(project.metadata);
    const envOverride = parseEnvEnabled(process.env['OD_CRITIQUE_ENABLED']);
    const phase = parseRolloutPhase(process.env['OD_CRITIQUE_ROLLOUT_PHASE']);

    const body: CritiqueStatusResponse = {
      projectId,
      enabled: isCritiqueEnabled({ phase, skillPolicy, projectOverride, envOverride }),
      resolution: { phase, skillPolicy, projectOverride, envOverride, approximate: true },
    };
    res.json(body);
  };
}
