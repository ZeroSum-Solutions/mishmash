import type { CritiqueStatusResponse } from '@open-design/contracts';

export type CritiqueStatusReason =
  | { kind: 'skill-opt-out' }
  | { kind: 'skill-required' }
  | { kind: 'project-override'; value: boolean }
  | { kind: 'env-override'; value: boolean }
  | { kind: 'phase-default'; phase: CritiqueStatusResponse['resolution']['phase'] };

/**
 * Names WHICH factor decided `CritiqueStatusResponse.enabled`, so the UI
 * can tell a user "the checkbox above isn't wrong, a required skill
 * overrides it" instead of just showing a bare on/off value.
 *
 * Mirrors the resolution order documented on
 * `apps/daemon/src/critique/rollout.ts`'s `isCritiqueEnabled` (first row
 * that matches wins: skill opt-out/required, then project override, then
 * env override, then the rollout phase default). `apps/web` cannot
 * import daemon source (see AGENTS.md boundary constraints), so this
 * reimplements only the branch-selection logic — never the boolean
 * itself, which the response already supplies via `enabled`.
 */
export function explainCritiqueStatusReason(
  resolution: CritiqueStatusResponse['resolution'],
): CritiqueStatusReason {
  const { skillPolicy, projectOverride, envOverride, phase } = resolution;
  if (skillPolicy === 'opt-out') return { kind: 'skill-opt-out' };
  if (skillPolicy === 'required') return { kind: 'skill-required' };
  if (projectOverride !== null) return { kind: 'project-override', value: projectOverride };
  if (envOverride !== null) return { kind: 'env-override', value: envOverride };
  return { kind: 'phase-default', phase };
}
