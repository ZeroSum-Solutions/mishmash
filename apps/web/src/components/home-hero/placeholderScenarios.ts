// Home composer placeholder carousel — data + pure dissolve state machine.
//
// The empty Home composer rotates a set of scenario placeholders, cross-fading
// between them (fade in → dwell → fade out → next). Each scenario is bound to
// one of the create-rail templates (see `home-hero/chips.ts`): when the user
// presses Send on an empty composer while a scenario is showing, HomeView
// seeds the prompt with that scenario's text AND binds its template, so a
// single click creates a fully-routed project — the low-cost "just start"
// path mirrored from Claude Design's rotating placeholder.
//
// Copy is localised: each scenario carries a `textKey` into the i18n Dict
// (`homeHero.carousel.*`), resolved with `t()` at render time in HomeHero so
// the typed placeholder AND the submitted query follow the user's locale. The
// resolved `{ id, text, chipId }` shape (PlaceholderScenario) is what flows to
// the carousel and the submit path.
//
// `chipId` must match an `apply-scenario` create chip id in `HOME_HERO_CHIPS`;
// `home-hero-placeholder-scenarios.test.ts` asserts every binding resolves and
// every `textKey` is present in the English Dict, so a renamed chip or a
// missing translation can't silently break the one-click create.

import type { Dict } from '../../i18n/types';
import type { ChatSessionMode } from '@open-design/contracts';

// A scenario after its copy has been resolved through `t()`. Carousel display
// and the submit path consume this shape.
export interface PlaceholderScenario {
  // Stable key (React list key + test selector).
  id: string;
  // The localized text typed into the placeholder AND sent as the project query.
  text: string;
  // Create-rail chip id the scenario binds on submit (the "template").
  chipId: string;
  // Optional per-turn mode for in-project follow-up scenarios.
  sessionMode?: ChatSessionMode;
}

// The data table: stable id + i18n key + bound template. HomeHero maps each
// def's `textKey` through `t()` to build the resolved PlaceholderScenario list.
export interface PlaceholderScenarioDef {
  id: string;
  textKey: keyof Dict;
  chipId: string;
}

// i18n key for the idle hint shown as the editor's accessible placeholder while
// the visual carousel animates on top. Not part of the rotation — it is
// instructional copy ("here is what you can do"), not a submittable query, so
// it never binds a template.
export const PLACEHOLDER_BASE_HINT_KEY: keyof Dict = 'homeHero.carousel.hint';

export const PLACEHOLDER_SCENARIO_DEFS: ReadonlyArray<PlaceholderScenarioDef> = [
  { id: 'one-page-brief', textKey: 'homeHero.carousel.onePageBrief', chipId: 'document' },
  { id: 'notes-to-deck', textKey: 'homeHero.carousel.notesToDeck', chipId: 'deck' },
  { id: 'signup-flow', textKey: 'homeHero.carousel.signupFlow', chipId: 'prototype' },
  { id: 'improve-brief', textKey: 'homeHero.carousel.improveBrief', chipId: 'document' },
  { id: 'loading-animation', textKey: 'homeHero.carousel.loadingAnimation', chipId: 'hyperframes' },
  { id: 'team-update-slides', textKey: 'homeHero.carousel.teamUpdateSlides', chipId: 'deck' },
  { id: 'orders-dashboard', textKey: 'homeHero.carousel.ordersDashboard', chipId: 'prototype' },
  { id: 'product-detail', textKey: 'homeHero.carousel.productDetail', chipId: 'wireframe' },
  { id: 'case-study', textKey: 'homeHero.carousel.caseStudy', chipId: 'document' },
  { id: 'landing-intro', textKey: 'homeHero.carousel.landingIntro', chipId: 'prototype' },
  { id: 'pitch-deck', textKey: 'homeHero.carousel.pitchDeck', chipId: 'deck' },
  { id: 'app-idea', textKey: 'homeHero.carousel.appIdea', chipId: 'mobile' },
  { id: 'landing-layout', textKey: 'homeHero.carousel.landingLayout', chipId: 'wireframe' },
];

export interface BuildPlaceholderScenariosInput {
  activeChipId: string | null;
  resolveTextKey: (key: keyof Dict) => string;
  examplesForChip?: (chipId: string) => ReadonlyArray<string>;
  fallbackForChip?: (chipId: string) => string | null;
  scenarioDefs?: ReadonlyArray<PlaceholderScenarioDef>;
}

export function buildPlaceholderScenarios({
  activeChipId,
  resolveTextKey,
  examplesForChip = () => [],
  fallbackForChip = () => null,
  scenarioDefs = PLACEHOLDER_SCENARIO_DEFS,
}: BuildPlaceholderScenariosInput): PlaceholderScenario[] {
  if (activeChipId) {
    const chipScenarioDefs = scenarioDefs.filter((def) => def.chipId === activeChipId);
    if (chipScenarioDefs.length > 0) {
      return chipScenarioDefs.map((def) => ({
        id: def.id,
        chipId: def.chipId,
        text: resolveTextKey(def.textKey),
      }));
    }
    const examples = examplesForChip(activeChipId);
    if (examples.length > 0) {
      return examples.map((text, index) => ({
        id: `${activeChipId}-prompt-example-${index + 1}`,
        chipId: activeChipId,
        text,
      }));
    }
    const fallback = fallbackForChip(activeChipId);
    return fallback
      ? [{ id: `${activeChipId}-fallback`, chipId: activeChipId, text: fallback }]
      : [];
  }

  return scenarioDefs.map((def) => ({
    id: def.id,
    chipId: def.chipId,
    text: resolveTextKey(def.textKey),
  }));
}

// ---- Dissolve state machine (pure, so it is unit-testable) ----------------

// Each line fades in, sits, then fades out before the next one takes its place.
// `visible` covers the fade-in AND the dwell; `hidden` is the fade-out, at the
// end of which the index advances. The index therefore changes exactly when the
// NEXT line starts appearing, which is what the Send-on-empty binding needs
// (see HomeHero's `carouselScenario`).
export type DissolvePhase = 'visible' | 'hidden';

export interface DissolveState {
  // Index into the scenario list.
  index: number;
  phase: DissolvePhase;
}

export interface DissolveTiming {
  // How long a line stays on screen, fade-in included.
  visibleMs: number;
  // Cross-fade length. Must match the CSS opacity transition on
  // `.home-hero__carousel-text` or the swap will visibly clip.
  fadeMs: number;
}

export const DEFAULT_DISSOLVE_TIMING: DissolveTiming = {
  visibleMs: 6000,
  fadeMs: 700,
};

export function initialDissolveState(): DissolveState {
  return { index: 0, phase: 'visible' };
}

// Advance the machine one step and report how long to wait before applying it.
// `count` is the scenario count (for wraparound). With `reducedMotion` the
// cross-fade collapses to a hard swap on the same dwell.
export function advanceDissolve(
  state: DissolveState,
  count: number,
  timing: DissolveTiming,
  reducedMotion: boolean,
): { state: DissolveState; delayMs: number } {
  if (count <= 0) return { state, delayMs: timing.visibleMs };
  if (reducedMotion) {
    return {
      state: { index: (state.index + 1) % count, phase: 'visible' },
      delayMs: timing.visibleMs,
    };
  }
  if (state.phase === 'visible') {
    return { state: { ...state, phase: 'hidden' }, delayMs: timing.visibleMs };
  }
  return {
    state: { index: (state.index + 1) % count, phase: 'visible' },
    delayMs: timing.fadeMs,
  };
}
