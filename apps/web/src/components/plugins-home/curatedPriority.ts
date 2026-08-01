// Shared curator ordering for Home examples and the Community shelf.
//
// These are the template styles we deliberately want in the first
// viewport. The ids are daemon plugin ids, so the ordering remains
// stable across locales and title-copy tweaks.

import type { InstalledPluginRecord } from '@open-design/contracts';

const CURATED_PROTOTYPE_PLUGIN_IDS = [
  'example-kanban-board',
  'example-social-carousel',
  'example-blog-post',
  'example-doc-kami-parchment',
] as const;

// Wireframe scenario: lo-fi / sketch explorations across distinct styles —
// hand-drawn sketch, crisp greybox/blueprint, a multi-screen mobile flow, and
// an annotated/redline landing wireframe. The chip's tag-matching surfaces any
// other lo-fi templates behind these.
const CURATED_WIREFRAME_PLUGIN_IDS = [
  'example-wireframe-sketch',
  'example-wireframe-greybox',
  'example-wireframe-mobile-flow',
  'example-wireframe-annotated',
] as const;

// Mobile scenario: real native-app prototype mockups (iOS / Android phone
// screens), so the carousel reads as "this is what a mobile result looks
// like" rather than generic web prototypes.
const CURATED_MOBILE_PLUGIN_IDS = [
  'example-mobile-app',
  'example-mobile-onboarding',
  'example-gamified-app',
  'example-mockup-device-3d',
] as const;

// Document scenario: polished, print-ready documents chosen for visual
// quality. The 2026-07-30 gallery curation retired most of the original
// document picks; only the keep-list members remain.
const CURATED_DOCUMENT_PLUGIN_IDS = [
  'example-doc-kami-parchment',
  'example-finance-report',
] as const;

export const CURATED_LIVE_ARTIFACT_PLUGIN_IDS = [
  'example-live-dashboard',
  'image-template-notion-team-dashboard-live-artifact',
  'example-social-media-matrix-tracker-template',
  'example-trading-analysis-dashboard-template',
  'example-live-artifact',
] as const;

// The 2026-07-30 gallery curation retired every previous deck, video, and
// hyperframes curated pick (including the pinned community slides batch)
// and all but one image pick. Empty arrays fall back to popularity +
// visual-appeal ordering for those chips; re-populate only from curator
// picks that are on the keep list (the hyperframes picks below were
// re-populated by the 2026-07-31 reference-integration pass).
const CURATED_DECK_PLUGIN_IDS = [] as const;

const CURATED_IMAGE_PLUGIN_IDS = [
  'image-template-profile-avatar-anime-girl-to-cinematic-photo',
] as const;

const CURATED_VIDEO_PLUGIN_IDS = [] as const;

// The 2026-07-31 reference-integration pass replaced the three retired
// frame picks with adversarially-judged winners. They ship HTML previews
// (their predecessors had baked video/poster clips scoring ~1450 in
// pluginVisualScore), so without curation they would sink to the bottom
// of the gallery; pin them in judge-score order.
const CURATED_HYPERFRAMES_PLUGIN_IDS = [
  'video-template-frame-chroma-glitch',
  'video-template-frame-arc-voltage',
  'video-template-frame-shuffle-kinetic-type',
] as const;

export const CURATED_PLUGIN_IDS_BY_CHIP = {
  prototype: CURATED_PROTOTYPE_PLUGIN_IDS,
  wireframe: CURATED_WIREFRAME_PLUGIN_IDS,
  mobile: CURATED_MOBILE_PLUGIN_IDS,
  document: CURATED_DOCUMENT_PLUGIN_IDS,
  'live-artifact': CURATED_LIVE_ARTIFACT_PLUGIN_IDS,
  deck: CURATED_DECK_PLUGIN_IDS,
  image: CURATED_IMAGE_PLUGIN_IDS,
  video: CURATED_VIDEO_PLUGIN_IDS,
  hyperframes: CURATED_HYPERFRAMES_PLUGIN_IDS,
};

const CURATED_GLOBAL_IDS = [
  ...CURATED_PROTOTYPE_PLUGIN_IDS,
  ...CURATED_WIREFRAME_PLUGIN_IDS,
  ...CURATED_MOBILE_PLUGIN_IDS,
  ...CURATED_DOCUMENT_PLUGIN_IDS,
  ...CURATED_LIVE_ARTIFACT_PLUGIN_IDS,
  ...CURATED_DECK_PLUGIN_IDS,
  ...CURATED_IMAGE_PLUGIN_IDS,
  ...CURATED_VIDEO_PLUGIN_IDS,
  ...CURATED_HYPERFRAMES_PLUGIN_IDS,
];

const CURATED_GLOBAL_RANK = new Map<string, number>(
  CURATED_GLOBAL_IDS.map((id, index) => [id, index]),
);

export function curatedPluginPriority(record: InstalledPluginRecord): number | null {
  return CURATED_GLOBAL_RANK.get(record.id) ?? null;
}

export function curatedPluginPriorityForChip(
  record: InstalledPluginRecord,
  chipId: string,
): number | null {
  const ids = (CURATED_PLUGIN_IDS_BY_CHIP as Record<string, readonly string[] | undefined>)[chipId];
  if (!ids) return null;
  const index = ids.indexOf(record.id);
  return index >= 0 ? index : null;
}
