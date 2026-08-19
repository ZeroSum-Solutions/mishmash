/**
 * Critique Theater rollout-flag plumbing (Phase 15).
 *
 * The plan's rollout track is M0 dark-launch -> M1 settings toggle ->
 * M2 default-on per skill -> M3 global default. This module is the
 * intended single decision point every backend caller will consult
 * to answer "should the orchestrator wire the critique pipeline for
 * this run?"
 *
 * What ships in Phase 15:
 *
 *   - `isCritiqueEnabled` as a pure resolver function plus its
 *     supporting parsers (`parseRolloutPhase`, `parseEnvEnabled`).
 *     Full unit coverage of the priority matrix.
 *
 * Wired consumers:
 *
 *   - The orchestrator entry in `apps/daemon/src/server.ts` calls
 *     `isCritiqueEnabled({...})` ahead of every candidate generation;
 *     its result gates the panel-prompt threading and the
 *     orchestrator spawn together.
 *   - The M1 Settings toggle (`CritiqueTheaterSection`) persists the
 *     per-project override through `setCritiqueTheaterEnabled` in
 *     `apps/web/src/components/Theater/hooks/useCritiqueTheaterEnabled.ts`,
 *     which round-trips `metadata.critiqueTheaterEnabled` through the
 *     existing project PATCH. The daemon reads it back through
 *     `narrowProjectCritiqueOverride`.
 *   - `GET /api/projects/:projectId/critique/status` and `od critique
 *     status` echo the resolved value, so an operator can ask what a
 *     project would do without starting a generation.
 *   - The conformance harness runs synthetic adapters independently of
 *     this resolver, by design.
 *
 * Two ways to turn it on for local testing: per project, via the
 * Settings toggle, which needs no restart because the override is read
 * per request; or daemon-wide, with `OD_CRITIQUE_ENABLED=1` on the
 * daemon's launch command. `parseEnvEnabled` is also read per request,
 * but the rest of `CritiqueConfig` is cached at boot, so a changed
 * `OD_CRITIQUE_MAX_ROUNDS` or timeout does need a restart.
 *
 * Resolution order (highest priority first):
 *
 *   1. Per-skill override declared in `SKILL.md` frontmatter
 *      (`od.critique.policy: required | opt-in | opt-out`).
 *   2. Per-project override stored in the project settings table
 *      (the M1 Settings toggle will write here once the Settings UI
 *      follow-up adds the daemon-side write path).
 *   3. Environment override (`OD_CRITIQUE_ENABLED=1`). Useful for
 *      power users and CI fixtures.
 *   4. Global default. M0 / M1 = false. M2 = true for skills tagged
 *      `od.critique.policy: required`. M3 = true globally.
 */

export type SkillCritiquePolicy = 'required' | 'opt-in' | 'opt-out' | null;

export type RolloutPhase = 'M0' | 'M1' | 'M2' | 'M3';

export interface RolloutInputs {
  /** Effective rollout phase. Reads from `OD_CRITIQUE_ROLLOUT_PHASE`
   *  in production; tests pass it directly. */
  phase: RolloutPhase;
  /** Skill's `od.critique.policy` value, or `null` if the skill
   *  did not declare one. */
  skillPolicy: SkillCritiquePolicy;
  /** Per-project setting written by the M1 Settings toggle, or
   *  `null` if the project has not overridden the default. */
  projectOverride: boolean | null;
  /** Environment override (`OD_CRITIQUE_ENABLED=1`). */
  envOverride: boolean | null;
}

/**
 * Returns `true` when the orchestrator should run the critique
 * pipeline for this generation. Returns `false` when it should skip.
 *
 * Decision matrix (first row that matches wins):
 *
 *   skillPolicy === 'opt-out'         -> false
 *   skillPolicy === 'required'        -> true
 *   projectOverride !== null          -> projectOverride
 *   envOverride !== null              -> envOverride
 *   phase === 'M0'                    -> false
 *   phase === 'M1'                    -> false
 *   phase === 'M2'                    -> skillPolicy === 'opt-in'
 *   phase === 'M3'                    -> true
 */
export function isCritiqueEnabled(input: RolloutInputs): boolean {
  // Skill-level vetoes win unconditionally. A skill that explicitly
  // opts out cannot have critique forced on it by an env var or a
  // global rollout; a skill that opts in cannot be vetoed.
  if (input.skillPolicy === 'opt-out') return false;
  if (input.skillPolicy === 'required') return true;

  // Project-level override is the M1 Settings toggle. A user who
  // explicitly enables or disables critique for a project beats the
  // env default and the global rollout phase.
  if (input.projectOverride !== null) return input.projectOverride;

  // Env override is the power-user lane (CI fixtures, beta access).
  if (input.envOverride !== null) return input.envOverride;

  // Otherwise fall through to the rollout phase default.
  switch (input.phase) {
    case 'M0':
    case 'M1':
      return false;
    case 'M2':
      return input.skillPolicy === 'opt-in';
    case 'M3':
      return true;
  }
}

/**
 * Parse the `OD_CRITIQUE_ROLLOUT_PHASE` env var into a `RolloutPhase`.
 * Defaults to `M0` (dark-launch) when the value is missing or unknown
 * so a fresh install never surprises users with the feature on.
 */
export function parseRolloutPhase(raw: string | undefined): RolloutPhase {
  switch ((raw ?? '').trim().toUpperCase()) {
    case 'M1':
      return 'M1';
    case 'M2':
      return 'M2';
    case 'M3':
      return 'M3';
    default:
      return 'M0';
  }
}

/**
 * Parse `OD_CRITIQUE_ENABLED`. Recognises the canonical truthy /
 * falsy strings; returns `null` when the env var is unset so the
 * resolver knows to fall through to the rollout phase default
 * rather than treating "missing" as an explicit `false`.
 */
export function parseEnvEnabled(raw: string | undefined): boolean | null {
  if (raw === undefined || raw === '') return null;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return null;
}
