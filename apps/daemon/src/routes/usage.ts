// NM-20 cost & usage meter -- HTTP surface (C1-8: route + UI + `od` CLI over
// the same contract). The daemon-side computation and durable persistence
// live in runtimes/usage-tracking.ts; this file only wires HTTP.
import type { Express, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { getProject } from '../db.js';
import {
  getRunUsage,
  listProjectRunUsage,
  projectUsageSummary,
  type StoredRunUsageRecord,
} from '../runtimes/usage-tracking.js';

export interface RegisterUsageRoutesDeps {
  db: Database.Database;
}

function runUsageResponseShape(record: StoredRunUsageRecord) {
  return {
    runId: record.runId,
    agentId: record.agentId,
    model: record.model,
    requested: record.requested,
    resolved: record.resolved,
    reported: record.reported,
    displayState: record.displayState,
    inputTokensEffective: record.inputTokensEffective,
    outputTokens: record.outputTokens,
    cacheReadInputTokens: record.cacheReadInputTokens,
    costUsd: record.costUsd,
    pricingVersion: record.pricingVersion,
    recordedAt: record.recordedAt,
  };
}

function routeParamId(req: Request): string | null {
  const raw = req.params.id;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

export function registerUsageRoutes(app: Express, deps: RegisterUsageRoutesDeps): void {
  const { db } = deps;

  // Project-scoped: total cost + per-run breakdown for one project. This is
  // the route both the web Usage panel and `od usage` hit -- same contract,
  // per AGENTS.md's UI/CLI dual-track rule.
  app.get('/api/projects/:id/usage', (req: Request, res: Response) => {
    const projectId = routeParamId(req);
    if (!projectId) {
      res.status(400).json({ error: 'missing project id' });
      return;
    }
    const project = getProject(db, projectId);
    if (!project) {
      res.status(404).json({ error: 'project not found' });
      return;
    }
    const summary = projectUsageSummary(db, projectId);
    const runs = listProjectRunUsage(db, projectId).map(runUsageResponseShape);
    res.json({
      projectId,
      currency: summary.currency,
      totalCostUsd: summary.totalCostUsd,
      pricingVersion: summary.pricingVersion,
      runCount: summary.runCount,
      pricedRunCount: summary.pricedRunCount,
      runs,
    });
  });

  // Run-scoped: a single run's own usage/pricing record. Used by
  // AssistantMessage.tsx to render a per-message "pricing unavailable"
  // indicator (C1-9) without threading a new field through the SSE event
  // union -- see useRunUsageForRun's doc comment there for why. Not a CLI
  // capability in its own right (no cli.ts fetch() call reaches it, so it is
  // not the "usage" capability-manifest.json row's own httpPath), but it is
  // still listed in that row's knownNamespaceRoutes -- scripts/guard.ts's
  // checkCapabilityManifestParityCore flags any route a NEW, untracked
  // apps/daemon/src/routes/*.ts file registers, regardless of whether
  // cli.ts calls it.
  app.get('/api/runs/:id/usage', (req: Request, res: Response) => {
    const runId = routeParamId(req);
    if (!runId) {
      res.status(400).json({ error: 'missing run id' });
      return;
    }
    const record = getRunUsage(db, runId);
    if (!record) {
      res.status(404).json({ error: 'no usage recorded for this run yet' });
      return;
    }
    res.json(runUsageResponseShape(record));
  });
}
