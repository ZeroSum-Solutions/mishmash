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
   * What `isCritiqueEnabled` resolves to for this project's currently bound
   * skill. It does not account for ad-hoc skills a single prompt adds by
   * @-mention, which only exist once a generation request is composed — see
   * `resolution.approximate`.
   */
  enabled: boolean;
  resolution: {
    phase: RolloutPhase;
    skillPolicy: SkillCritiquePolicy;
    projectOverride: boolean | null;
    envOverride: boolean | null;
    /**
     * True while the skill policy is resolved from `project.skillId` alone.
     * Always true today; it exists so a caller can tell an approximation from
     * an exact answer if the endpoint is ever taught the full resolution.
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
