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
 * The skill policy is resolved from the project's currently bound skill only.
 * The spawn path additionally merges ad-hoc skills a single prompt adds by
 * @-mention, which do not exist until a request is composed, so the answer is
 * reported as approximate rather than quietly presented as exact.
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
