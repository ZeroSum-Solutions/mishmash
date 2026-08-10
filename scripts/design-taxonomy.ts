#!/usr/bin/env node
// Canonical category taxonomy for the design library: design-templates/
// (`od.category` in each SKILL.md frontmatter) and the mishmash-assets
// catalog (`item.category` in catalog.json).
//
// Settled by inspecting the actual data (2026-08-09):
//   - `grep -h '^  category:' design-templates/*/SKILL.md | sort | uniq -c`
//     found 19 distinct od.category values. `landing-page` (96 templates) is
//     already the largest cluster and becomes canon as-is.
//   - `site-theme` (45, e.g. the `lexington-*` multi-page marketing sites)
//     is a mechanical synonym for `landing-page` — same domain, no separate
//     home needed.
//   - `hero-section` (40) is page-fragment content, not a full page — it
//     folds into `component`.
//   - The remaining 15 small topical values (`design-craft`, `life`,
//     `professional-training`, `government-policy`, `ai-literacy`,
//     `student-coursework`, `fundraising-pitch`, `data-finance`,
//     `corporate-strategy`, `career`, `academic-research`,
//     `product-management`, `marketing-gtm`, `consulting`, `b2b-sales`) are
//     all audience/topic tags on `html-ppt-*` or other deck templates
//     (`ib-pitch-book`, `weekly-update`, `simple-deck`, `kami-deck`) — every
//     file carrying one of them is a deck, so they collapse into `deck`.
//   - `brand-page` (1 item, `kami-landing`) is deliberately left OUT of the
//     legacy map: whether a print-grade one-pager is a `landing-page` or a
//     `document-guide` is a judgment call, not a mechanical rename.
//   - `mishmash-assets/catalog.json` items currently hold their group
//     folder name as `category` (e.g. "01 UI8 Kits") for all 277 items —
//     none of those are mechanical renames onto this enum, so they are left
//     as validator violations for a later task to assign deliberately.
//
// No cluster in the existing data lacked a home in the enum below, so the
// enum was not extended beyond what this task specified.

export const CATEGORIES: string[] = [
  'deck',
  'landing-page',
  'dashboard',
  'mobile-app',
  'web-app',
  'docs',
  'document-guide',
  'email',
  'prototype',
  'audio',
  'video-motion',
  'webgl',
  'icons',
  'effect',
  'component',
  'ui-kit',
  'design-system',
  'capture',
  'inspiration',
  'tool',
];

export const CATEGORY_LABELS: Record<string, string> = {
  deck: 'Deck',
  'landing-page': 'Landing Page',
  dashboard: 'Dashboard',
  'mobile-app': 'Mobile App',
  'web-app': 'Web App',
  docs: 'Docs',
  'document-guide': 'Document Guide',
  email: 'Email',
  prototype: 'Prototype',
  audio: 'Audio',
  'video-motion': 'Video / Motion',
  webgl: 'WebGL',
  icons: 'Icons',
  effect: 'Effect',
  component: 'Component',
  'ui-kit': 'UI Kit',
  'design-system': 'Design System',
  capture: 'Capture',
  inspiration: 'Inspiration',
  tool: 'Tool',
};

// Old value -> canonical value. Mechanical renames/synonyms only — see the
// rationale above for what was deliberately left out (ambiguous single
// items, and the mishmash-assets folder-name categories).
export const LEGACY_CATEGORY_MAP: Record<string, string> = {
  'site-theme': 'landing-page',
  'hero-section': 'component',
  'design-craft': 'deck',
  life: 'deck',
  'professional-training': 'deck',
  'government-policy': 'deck',
  'ai-literacy': 'deck',
  'student-coursework': 'deck',
  'fundraising-pitch': 'deck',
  'data-finance': 'deck',
  'corporate-strategy': 'deck',
  career: 'deck',
  'academic-research': 'deck',
  'product-management': 'deck',
  'marketing-gtm': 'deck',
  consulting: 'deck',
  'b2b-sales': 'deck',
};
