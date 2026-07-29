import type { AgentInfo, AgentModelChoice } from '../types';

type AgentModelSource =
  | {
      id: AgentInfo['id'];
      models?: Array<{ id: string; enabled?: boolean; default?: boolean }>;
    }
  | null
  | undefined;

export function defaultAgentModelId(agent: AgentModelSource): string | null {
  const models = agent?.models ?? [];
  return (
    models.find((model) => model.default === true && model.enabled !== false)?.id ??
    models.find((model) => model.enabled !== false)?.id ??
    null
  );
}

export function normalizeAgentModelChoice(
  agent: AgentModelSource,
  choice: AgentModelChoice | undefined,
): AgentModelChoice | null {
  const configuredModel =
    typeof choice?.model === 'string' && choice.model ? choice.model : null;
  if (!configuredModel || configuredModel === 'default') return null;

  const models = agent?.models ?? [];
  const matchingModel = models.find((model) => model.id === configuredModel) ?? null;

  // A model id the catalog has never listed might be a legitimately typed
  // custom model -- most agents accept a free-form id via the "Custom (fill
  // below)" input, so an unknown id must never be silently rewritten. AMR is
  // the one lane whose CLI rejects free-form ids outright (ACP
  // session/set_model), so for AMR specifically an id absent from its own
  // live catalog is presumed stale and still gets corrected.
  const isUnknownAmrModel = !matchingModel && agent?.id === 'amr' && models.length > 0;
  // A model id the catalog DOES know about but has explicitly disabled
  // applies to every agent, not just AMR -- a disabled/locked model must
  // never sit selected in the UI, whichever agent it belongs to (C1-2).
  const isKnownButDisabled = matchingModel?.enabled === false;
  if (!isUnknownAmrModel && !isKnownButDisabled) return null;

  const fallbackModel = defaultAgentModelId(agent);
  if (!fallbackModel || fallbackModel === configuredModel) return null;

  return {
    ...choice,
    model: fallbackModel,
  };
}

export function effectiveAgentModelChoice(
  agent: AgentModelSource,
  choice: AgentModelChoice | undefined,
): AgentModelChoice | undefined {
  return normalizeAgentModelChoice(agent, choice) ?? choice;
}
