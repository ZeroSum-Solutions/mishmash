import { describe, expect, it } from 'vitest';
import {
  defaultAgentModelId,
  effectiveAgentModelChoice,
  normalizeAgentModelChoice,
} from '../../src/components/agentModelSelection';
import type { AgentInfo } from '../../src/types';

const amrAgent: AgentInfo = {
  id: 'amr',
  name: 'AMR',
  bin: 'amr',
  available: true,
  version: '1.0.0',
  models: [
    { id: 'glm-5', label: 'GLM 5' },
    { id: 'glm-5.1', label: 'GLM 5.1' },
  ],
};

const codexAgent: AgentInfo = {
  id: 'codex',
  name: 'Codex',
  bin: 'codex',
  available: true,
  version: '1.0.0',
  models: [{ id: 'default', label: 'Default' }],
};

describe('agent model selection', () => {
  it('normalizes stale saved AMR models to the first live model', () => {
    expect(
      normalizeAgentModelChoice(amrAgent, {
        model: 'gpt-5.4-mini',
        reasoning: 'medium',
      }),
    ).toEqual({
      model: 'glm-5',
      reasoning: 'medium',
    });
  });

  it('submits the same normalized AMR model that the switcher displays', () => {
    expect(
      effectiveAgentModelChoice(amrAgent, {
        model: 'gpt-5.4-mini',
        reasoning: 'medium',
      }),
    ).toEqual({
      model: 'glm-5',
      reasoning: 'medium',
    });
  });

  it('preserves explicit AMR default choices instead of normalizing them to a concrete fallback', () => {
    const choice = {
      model: 'default',
      reasoning: 'default',
    };

    expect(normalizeAgentModelChoice(amrAgent, choice)).toBeNull();
    expect(effectiveAgentModelChoice(amrAgent, choice)).toEqual(choice);
  });

  it('does not select a disabled model as the AMR default when every catalog row is locked', () => {
    const lockedAmrAgent: AgentInfo = {
      ...amrAgent,
      models: [
        { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', enabled: false },
        { id: 'kimi-k2.6', label: 'Kimi K2.6', enabled: false, default: true },
      ],
    };

    expect(defaultAgentModelId(lockedAmrAgent)).toBeNull();
    expect(effectiveAgentModelChoice(lockedAmrAgent, undefined)).toBeUndefined();
  });

  it('keeps non-AMR custom model choices unchanged', () => {
    expect(
      effectiveAgentModelChoice(codexAgent, {
        model: 'custom-codex-model',
        reasoning: 'high',
      }),
    ).toEqual({
      model: 'custom-codex-model',
      reasoning: 'high',
    });
  });

  // C1-2: the correction must not be hardcoded to `agent.id === 'amr'` --
  // every agent whose catalog explicitly disables a model must correct a
  // saved choice pointing at it, so a disabled model id can never sit
  // selected in the UI. Deliberately exercises a THIRD agent id (not 'amr',
  // not the pre-existing 'codex' fixture above) to prove this isn't a
  // second hardcoded special case.
  it('corrects a disabled model id on a non-AMR agent to the catalog default', () => {
    const grokAgent: AgentInfo = {
      id: 'grok-build',
      name: 'Grok Build',
      bin: 'grok',
      available: true,
      version: '1.0.0',
      models: [
        { id: 'grok-5-fast', label: 'Grok 5 Fast', enabled: true, default: true },
        { id: 'grok-4-legacy', label: 'Grok 4 (legacy)', enabled: false, default: false },
      ],
    };

    expect(
      normalizeAgentModelChoice(grokAgent, { model: 'grok-4-legacy', reasoning: 'high' }),
    ).toEqual({ model: 'grok-5-fast', reasoning: 'high' });
    expect(
      effectiveAgentModelChoice(grokAgent, { model: 'grok-4-legacy', reasoning: 'high' }),
    ).toEqual({ model: 'grok-5-fast', reasoning: 'high' });
  });

  it('does not correct a non-AMR model id the catalog has simply never listed (a legitimate custom id)', () => {
    // Distinguishes "the catalog knows this id and disabled it" (correctable)
    // from "the catalog doesn't mention this id at all" (a free-form custom
    // model most agents accept -- must never be silently rewritten). Mirrors
    // the pre-existing codexAgent test above but with a non-empty, partially
    // populated models array so the two code paths can't be conflated.
    const grokAgent: AgentInfo = {
      id: 'grok-build',
      name: 'Grok Build',
      bin: 'grok',
      available: true,
      version: '1.0.0',
      models: [{ id: 'grok-5-fast', label: 'Grok 5 Fast', enabled: true, default: true }],
    };

    expect(
      effectiveAgentModelChoice(grokAgent, { model: 'grok-9-preview-custom', reasoning: 'high' }),
    ).toEqual({ model: 'grok-9-preview-custom', reasoning: 'high' });
  });
});
