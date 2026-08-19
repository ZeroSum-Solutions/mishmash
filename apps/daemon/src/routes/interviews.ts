// F002 R1 — HTTP surface for the client discovery interview engine
// (apps/daemon/src/interview/engine.ts). Both the web chat-pane surface and
// `od interview` (apps/daemon/src/cli.ts) call these same endpoints, per
// AGENTS.md "Capability exposure": one HTTP layer, shared DTOs from
// packages/contracts.
import type { Express } from 'express';
import {
  INTERVIEW_ARCHETYPES,
  INTERVIEW_TIERS,
  isInterviewArchetype,
  isInterviewTier,
} from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import {
  getInterviewSessionState,
  startInterview,
  submitInterviewTurn,
} from '../interview/engine.js';

export interface RegisterInterviewRoutesDeps extends RouteDeps<'http'> {}

export function registerInterviewRoutes(app: Express, ctx: RegisterInterviewRoutesDeps): void {
  const { sendApiError } = ctx.http;

  app.post('/api/interviews', (req, res) => {
    const body = (req.body ?? {}) as { tier?: unknown; archetype?: unknown };
    if (!isInterviewTier(body.tier)) {
      return sendApiError(res, 400, 'BAD_REQUEST', `tier must be one of ${INTERVIEW_TIERS.join(', ')}`);
    }
    if (body.archetype !== undefined && !isInterviewArchetype(body.archetype)) {
      return sendApiError(
        res, 400, 'BAD_REQUEST',
        `archetype must be one of ${INTERVIEW_ARCHETYPES.join(', ')}`,
      );
    }
    const { session, turn } = startInterview(body.tier, body.archetype);
    res.json({ session, turn });
  });

  // Returns the same shape a turn submission does — `{ session, turn? }`
  // while in-progress, or `{ session, result? }` once terminal — so a
  // reloaded browser tab (or any client) can resume a session by
  // reconstructing its current turn instead of replaying answers.
  app.get('/api/interviews/:id', (req, res) => {
    const state = getInterviewSessionState(req.params.id);
    if (!state) return sendApiError(res, 404, 'NOT_FOUND', 'interview session not found');
    res.json(state);
  });

  app.post('/api/interviews/:id/turns', (req, res) => {
    const body = (req.body ?? {}) as { answers?: unknown };
    const answers =
      body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)
        ? (body.answers as Record<string, unknown>)
        : {};
    const outcome = submitInterviewTurn(req.params.id, answers);
    if (!outcome.ok) {
      return sendApiError(res, outcome.status, outcome.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', outcome.error);
    }
    res.json(outcome.data);
  });
}
