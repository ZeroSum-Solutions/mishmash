// AUTO-GENERATED — DO NOT EDIT BY HAND.
//
// Blended template popularity, used to order the plugin/example grid and the
// Home rail so the templates users actually reach for lead each category and
// sub-category (OPEND-449). Higher score = more popular; range [0, 1].
//
// How it is built (deterministic, creds-free transform):
//   score = 0.6 * norm(log1p(distinctUsers)) + 0.4 * norm(log1p(runs))
//   • window: trailing 28 days of `run_finished` events (by plugin_id)
//   • distinct users are the anti-gaming signal; runs add engagement depth
//   • log1p tames the head-template scale gap; min-max normalized over the
//     live-catalog template set so both metrics land in [0, 1]
//   • RETIRED plugins (absent from the live catalog) are dropped
//   • templates with no renderable preview are EXCLUDED — mode-seed entries
//     (e.g. the generic Live Artifact / HyperFrames options) live in the
//     composer mode picker, not the gallery, so usage must not float them up
//   • templates below 20 distinct users are OMITTED so thin-sample
//     tail templates keep their curated/visual fallback order
//
// Regenerate with: pnpm exec tsx scripts/refresh-plugin-popularity.ts --write
// (needs a PostHog personal API key in the environment). The upstream
// weekly refresh workflow is not part of this fork — refresh manually
// after catalog changes.
// See pluginPopularity.RUNBOOK.md here.
//
// 2026-08-08 catalog prune: 13 entries for pruned templates were DELETED in
// place, applying only the "RETIRED plugins are dropped" rule above (31 -> 16).
// This is the deletion half of the transform and is deterministic — it needs no
// PostHog credentials, so it does not go through the regenerate path, and it
// does not refresh the frozen upstream snapshot that docs/FORK-PIN.md pins.
// Surviving scores are NOT re-normalized and so still carry their pre-prune
// min-max range. That is deliberate: min-max is monotonic, this table is only
// ever read for ORDERING, and re-normalizing would silently fabricate values
// that no longer trace to the 2026-07-20 snapshot. A future credentialed
// refresh will restore exact normalization.

export interface PluginPopularityMeta {
  readonly generatedAt: string;
  readonly windowDays: number;
  readonly weights: { readonly users: number; readonly runs: number };
  readonly minUsers: number;
  readonly count: number;
}

export const PLUGIN_POPULARITY_META: PluginPopularityMeta = {
  generatedAt: '2026-07-20',
  windowDays: 28,
  weights: { users: 0.6, runs: 0.4 },
  minUsers: 20,
  count: 16,
};

// Plugin id -> blended popularity score in [0, 1], most-popular first.
export const PLUGIN_POPULARITY: Readonly<Record<string, number>> = {
  'example-web-prototype': 1.0,
  'example-simple-deck': 0.876,
  'example-mobile-app': 0.6979,
  'example-web-clone': 0.6679,
  'example-gamified-app': 0.6248,
  'example-kanban-board': 0.5899,
  'example-mobile-onboarding': 0.5456,
  'example-video-hyperframes': 0.5249,
  'example-motion-frames': 0.5065,
  'example-webgl-experience': 0.5031,
  'example-velar-luxury-real-estate': 0.4877,
  'image-template-notion-team-dashboard-live-artifact': 0.3997,
  'example-trading-analysis-dashboard-template': 0.394,
  'example-web-prototype-taste-soft': 0.391,
  'example-webgl-caustic-pool': 0.3768,
  'example-web-prototype-taste-brutalist': 0.3705,
};

// Templates with no renderable preview — suppressed from the visual gallery
// grid so they never show as an empty letter card. They still reach users
// through the composer's mode picker. Repo-derived (baked manifest + on-disk
// `od.preview` entry existence), refreshed alongside the scores above.
export const PLUGIN_NO_PREVIEW: readonly string[] = [
  'example-hyperframes',
  'example-live-artifact',
];
