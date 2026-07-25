import { describe, expect, it } from 'vitest';
import { findChip } from '../src/components/home-hero/chips';
import {
  advanceDissolve,
  buildPlaceholderScenarios,
  DEFAULT_DISSOLVE_TIMING,
  initialDissolveState,
  PLACEHOLDER_BASE_HINT_KEY,
  PLACEHOLDER_SCENARIO_DEFS,
  type DissolveState,
} from '../src/components/home-hero/placeholderScenarios';
import { en } from '../src/i18n/locales/en';

const TIMING = DEFAULT_DISSOLVE_TIMING;

describe('PLACEHOLDER_SCENARIO_DEFS bindings', () => {
  it('binds every scenario to an apply-scenario create chip that exists', () => {
    for (const def of PLACEHOLDER_SCENARIO_DEFS) {
      const chip = findChip(def.chipId);
      expect(chip, `chip "${def.chipId}" for scenario "${def.id}"`).toBeDefined();
      // One-click create reuses the rail's apply-scenario path; a chip that
      // navigates away (create-plugin / template / brand-kit) would dead-end.
      expect(chip?.action.kind, `scenario "${def.id}"`).toBe('apply-scenario');
      expect(chip?.group).toBe('create');
    }
  });

  it('only binds create templates that actually render a carousel', () => {
    // These are the templates with hand-curated carousel lines. Other templates
    // can still render a carousel through prompt-example or label fallbacks.
    const SUPPORTED = new Set(['document', 'deck', 'prototype', 'wireframe', 'mobile', 'hyperframes']);
    const used = new Set(PLACEHOLDER_SCENARIO_DEFS.map((d) => d.chipId));
    for (const chipId of used) {
      expect(SUPPORTED.has(chipId), `chipId "${chipId}" is not a carousel template`).toBe(true);
    }
    // Every supported template must keep at least one scenario so picking it
    // never strands the user on an empty (non-cycling) carousel.
    for (const chipId of SUPPORTED) {
      expect(
        PLACEHOLDER_SCENARIO_DEFS.some((d) => d.chipId === chipId),
        `template "${chipId}" has no scenario`,
      ).toBe(true);
    }
  });

  it('has unique scenario ids and a resolvable, non-empty English string per key', () => {
    const ids = PLACEHOLDER_SCENARIO_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Every textKey (and the base hint) must resolve in the English Dict — the
    // typecheck enforces all 19 locales carry the key; this catches an empty
    // English value, which would render a blank placeholder.
    for (const def of PLACEHOLDER_SCENARIO_DEFS) {
      expect(en[def.textKey]?.trim().length, `en[${def.textKey}]`).toBeGreaterThan(0);
    }
    expect(en[PLACEHOLDER_BASE_HINT_KEY]?.trim().length, 'en[base hint]').toBeGreaterThan(0);
  });
});

describe('buildPlaceholderScenarios', () => {
  it('uses prompt examples as selected-chip carousel scenarios when no curated scenario exists', () => {
    const scenarios = buildPlaceholderScenarios({
      activeChipId: 'audio',
      resolveTextKey: (key) => en[key],
      examplesForChip: (chipId) => (
        chipId === 'audio'
          ? ['Generate a product startup sound']
          : []
      ),
    });

    expect(scenarios).toEqual([
      {
        id: 'audio-prompt-example-1',
        chipId: 'audio',
        text: 'Generate a product startup sound',
      },
    ]);
  });

  it('creates a submittable selected-chip fallback when neither curated scenarios nor prompt examples exist', () => {
    const scenarios = buildPlaceholderScenarios({
      activeChipId: 'live-artifact',
      resolveTextKey: (key) => en[key],
      fallbackForChip: (chipId) => (
        chipId === 'live-artifact'
          ? 'Create a Live artifact: Data-backed live dashboards'
          : null
      ),
    });

    expect(scenarios).toEqual([
      {
        id: 'live-artifact-fallback',
        chipId: 'live-artifact',
        text: 'Create a Live artifact: Data-backed live dashboards',
      },
    ]);
  });
});

describe('advanceDissolve', () => {
  it('holds a line on screen for the full visible dwell before fading out', () => {
    const { state, delayMs } = advanceDissolve({ index: 0, phase: 'visible' }, 3, TIMING, false);
    expect(state).toEqual({ index: 0, phase: 'hidden' });
    expect(delayMs).toBe(TIMING.visibleMs);
  });

  it('each line is on screen for about six seconds', () => {
    // The founder-facing requirement: a slow dissolve, ~6s per line.
    expect(TIMING.visibleMs).toBe(6000);
    expect(TIMING.fadeMs).toBeLessThan(TIMING.visibleMs);
  });

  it('advances the index only after the fade-out completes', () => {
    // The index must NOT move while the outgoing line is still fading, or the
    // text would swap mid-dissolve (and Send-on-empty would bind the wrong
    // scenario). It moves exactly when the next line starts fading in.
    const { state, delayMs } = advanceDissolve({ index: 0, phase: 'hidden' }, 3, TIMING, false);
    expect(state).toEqual({ index: 1, phase: 'visible' });
    expect(delayMs).toBe(TIMING.fadeMs);
  });

  it('wraps to the first scenario after the last', () => {
    const { state } = advanceDissolve({ index: 2, phase: 'hidden' }, 3, TIMING, false);
    expect(state.index).toBe(0);
  });

  it('reduced motion hard-swaps lines on the same dwell, never fading', () => {
    const { state, delayMs } = advanceDissolve({ index: 0, phase: 'visible' }, 3, TIMING, true);
    expect(state).toEqual({ index: 1, phase: 'visible' });
    expect(delayMs).toBe(TIMING.visibleMs);
  });

  it('holds without advancing when there are no scenarios', () => {
    const start: DissolveState = { index: 0, phase: 'visible' };
    const { state, delayMs } = advanceDissolve(start, 0, TIMING, false);
    expect(state).toBe(start);
    expect(delayMs).toBe(TIMING.visibleMs);
  });

  it('starts fully visible on the first scenario', () => {
    expect(initialDissolveState()).toEqual({ index: 0, phase: 'visible' });
  });
});
