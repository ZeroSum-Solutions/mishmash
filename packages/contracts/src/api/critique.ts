/**
 * DTOs for the two read-only Critique Theater status routes.
 *
 * `RolloutPhase`, the skill policy and the ratchet shapes are redefined here
 * rather than imported: contracts is shared by the daemon and the web app, and
 * `apps/daemon/src` is not importable from this package. The daemon's own
 * `critique/rollout.ts` and `critique/ratchet.ts` remain the source of truth
 * for the behaviour; these are the wire shapes.
 */

export type RolloutPhase = 'M0' | 'M1' | 'M2' | 'M3';

export type SkillCritiquePolicy = 'required' | 'opt-in' | 'opt-out' | null;

/** `GET /api/projects/:projectId/critique/status` */
export interface CritiqueStatusResponse {
  projectId: string;
  /**
   * The ROLLOUT POLICY answer — what `isCritiqueEnabled` resolves to from
   * phase, skill policy, project override and env — and nothing else.
   *
   * A real generation has to clear more gates than this: it needs a resolved
   * design system, a non-media surface, a plain-stream adapter, and a daemon
   * below `OD_CRITIQUE_MAX_CONCURRENT_RUNS`. Those depend on the request, not
   * on the project, so they cannot be answered here. `enabled: true` means
   * "policy permits it", not "the next run will critique". Read it with
   * `resolution` and `approximate`, both of which say where the answer stops.
   */
  enabled: boolean;
  resolution: {
    phase: RolloutPhase;
    skillPolicy: SkillCritiquePolicy;
    projectOverride: boolean | null;
    envOverride: boolean | null;
    /**
     * True while this is a policy-layer answer rather than a full
     * spawn-time one. Two things are outside it: the skill policy is
     * resolved from `project.skillId` alone, so ad-hoc skills a single
     * prompt adds by @-mention are invisible; and the request-dependent
     * gates named on `enabled` are not evaluated. Always true today; it
     * exists so a caller can tell an approximation from an exact answer if
     * the endpoint is ever taught the rest.
     */
    approximate: boolean;
  };
}

/** One day of fleet conformance. */
export interface ConformanceDayDto {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  adapter: string;
  /** Fraction of runs that reached the `shipped` terminal status, 0..1. */
  shippedRate: number;
  /** Fraction of runs with no parser warning, 0..1. */
  cleanParseRate: number;
  totalRuns: number;
}

export type RatchetDecisionDto =
  | {
      kind: 'hold';
      current: RolloutPhase;
      reason: string;
      passingDays: number;
      observedDays: number;
    }
  | { kind: 'promote'; from: RolloutPhase; to: RolloutPhase; evidenceDays: number }
  | { kind: 'demote'; from: RolloutPhase; to: RolloutPhase; reason: string };

/** `GET /api/critique/conformance` */
export interface CritiqueConformanceResponse {
  window: { days: number; history: ConformanceDayDto[] };
  decision: RatchetDecisionDto;
}
