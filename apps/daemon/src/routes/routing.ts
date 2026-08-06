// /api/routing/* -- routing capability HTTP surface (WR wave, P0 skeleton,
// plan docs/plans/2026-08-05-model-routing-system.md §3.4 capability
// closure). Contracts: packages/contracts/src/api/routing-{policy,decision,
// telemetry}.ts. Every response here is a documented stub: real policy
// content, admission control, and dispatch-time routing land in later WR
// tranches (P1/P2) -- see docs/plans/waves/WR-routing.md's Tranche register.
import type { Express, Request, Response } from 'express';
import type {
  LaneMeter,
  RoutingDecision,
  RoutingDecisionPreviewResponse,
  RoutingKey,
  RoutingMetersResponse,
  RoutingPolicyResponse,
} from '@open-design/contracts';
import { currentRoutingPolicyVersion, loadRoutingPolicy } from '../routing/index.js';

function queryStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function registerRoutingRoutes(app: Express): void {
  // GET /api/routing/policy -- the loaded policy document + its version.
  app.get('/api/routing/policy', (_req: Request, res: Response) => {
    const policy = loadRoutingPolicy();
    const response: RoutingPolicyResponse = { policy, policyVersion: policy.policyVersion };
    res.json(response);
  });

  // GET /api/routing/decision/preview -- a stub RoutingDecision for a given
  // routing key. Query params mirror RoutingKey's discriminated fallback
  // shape (docs/plans/waves/WR-routing.md's "Routing-key fallback
  // (normative)"): buildClass may only be supplied alongside templateId --
  // WR-routing.md's fallback table never defines a build-class-only key, so
  // that combination is rejected here rather than silently coerced. The
  // decision itself is always a fixed stub until P2 lands real dispatch
  // logic; only the echoed `key` reflects the caller's input.
  app.get('/api/routing/decision/preview', (req: Request, res: Response) => {
    const templateId = queryStringOrNull(req.query.templateId);
    const buildClass = queryStringOrNull(req.query.buildClass);
    const stage = queryStringOrNull(req.query.stage) ?? 'chat';

    if (buildClass !== null && templateId === null) {
      res.status(400).json({
        error: {
          code: 'invalid-routing-key',
          message:
            'buildClass may only be supplied together with templateId -- WR-routing.md\'s fallback table has no build-class-only shape.',
        },
      });
      return;
    }

    const key: RoutingKey =
      templateId !== null && buildClass !== null
        ? { templateId, buildClass, stage, contextEstimateTokens: 0, laneMeters: {} }
        : { templateId, buildClass: null, stage, contextEstimateTokens: 0, laneMeters: {} };

    const decision: RoutingDecision = {
      runtimeId: 'stub-runtime',
      modelFlag: 'default',
      effort: 'medium',
      lane: 'stub-lane',
      rationale: 'policy-stub-v0',
      admissionVerdict: 'admitted',
      policyVersion: currentRoutingPolicyVersion(),
      promptComposition: [],
      // Fail-closed placeholder (plan §3.2 L2): an unresolved sensitivity
      // class defaults to the MOST restrictive value rather than the least,
      // until a later tranche wires this from the real request/brief
      // context.
      sensitivityClass: 'client-confidential',
    };
    const response: RoutingDecisionPreviewResponse = { key, decision };
    res.json(response);
  });

  // GET /api/routing/meters -- per-lane routing meters. Empty until P1/P2
  // land telemetry persistence and real dispatch (CWR-P1-2/CWR-P2-4).
  app.get('/api/routing/meters', (_req: Request, res: Response) => {
    const laneMeters: LaneMeter[] = [];
    const response: RoutingMetersResponse = { laneMeters };
    res.json(response);
  });
}
