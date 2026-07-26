// Design-toolbox action catalogue + pure helpers shared between the composer
// (which owns the apply/staging engine) and the assistant "next step" card
// (which surfaces a curated couple of these actions as primary follow-up rows).
// Keep this module free of React and composer-internal state so both surfaces
// can import the same source of truth.
import type { Dict } from '../i18n/types';
import type { IconName } from '../components/Icon';
import type { SkillSummary } from '../types';

type TranslateFn = (key: keyof Dict, vars?: Record<string, string | number>) => string;

export type DesignToolboxActionId =
  | 'auto-match'
  | 'asset-search'
  | 'icon-workflow'
  | 'image-replace'
  | 'reference-extract'
  | 'motion'
  | 'motion-polish'
  | 'transition-motion'
  | 'plan-outline'
  | 'threejs-scene'
  | 'anti-ai-polish'
  | 'visual-polish'
  | 'image-gen'
  | 'chart-gen'
  | 'logo-gen'
  | 'video-gen';

export interface DesignToolboxAction {
  id: DesignToolboxActionId;
  icon: IconName;
  preferredSkillIds: string[];
  categoryHints: string[];
  searchTerms: string[];
}

export const DESIGN_TOOLBOX_ACTIONS: DesignToolboxAction[] = [
  {
    id: 'auto-match',
    icon: 'sparkles',
    preferredSkillIds: ['creative-director', 'frontend-design', 'agent-browser'],
    categoryHints: ['creative-direction', 'web-artifacts', 'image-generation', 'animation-motion'],
    searchTerms: ['match', 'recommend', 'next step', 'workflow', 'skills', 'mcp', 'plugins', 'connector', 'files', 'Magic UI', 'GSAP', 'Motion', 'Spline', 'Three.js', 'ECharts', 'React Flow', 'Rive', 'Lottie', 'Vanta.js', 'Mapbox', 'deck.gl', 'aesthetics', 'design toolbox'],
  },
  {
    id: 'asset-search',
    icon: 'search',
    preferredSkillIds: ['agent-browser', 'imagegen-frontend-web', 'creative-director', 'fal-generate', 'image-enhancer'],
    categoryHints: ['image-generation', 'web-artifacts', 'creative-direction'],
    searchTerms: ['find image', 'image search', 'asset search', 'stock photo', 'reference image', 'moodboard', 'unsplash', 'pexels', 'screenshot', 'illustration'],
  },
  {
    id: 'icon-workflow',
    icon: 'star',
    preferredSkillIds: ['imagegen', 'imagegen-frontend-web', 'creative-director', 'frontend-design'],
    categoryHints: ['image-generation', 'creative-direction', 'web-artifacts'],
    searchTerms: ['icon', 'lucide', 'svg', 'symbol', 'icon set', 'replace icon', 'find icon'],
  },
  {
    id: 'image-replace',
    icon: 'image',
    preferredSkillIds: ['imagegen-frontend-web', 'image-enhancer', 'agent-browser', 'fal-generate', 'imagen'],
    categoryHints: ['image-generation', 'web-artifacts'],
    searchTerms: ['replace image', 'swap image', 'asset replacement', 'hero image', 'section image', 'background image'],
  },
  {
    id: 'reference-extract',
    icon: 'eye',
    preferredSkillIds: ['agent-browser', 'creative-director', 'frontend-design'],
    categoryHints: ['creative-direction', 'web-artifacts'],
    searchTerms: ['reference', 'extract reference', 'style reference', 'screenshot analysis', 'visual analysis', 'palette', 'typography'],
  },
  {
    id: 'motion',
    icon: 'play',
    preferredSkillIds: ['emilkowalski-motion', 'gsap-react', 'gsap-scrolltrigger', 'gsap-timeline', 'gsap-core', 'motion', 'rive', 'lottie'],
    categoryHints: ['animation-motion'],
    searchTerms: ['animation', 'motion', 'gsap', 'motion.dev', 'rive', 'lottie', 'micro interaction', 'scrolltrigger', 'motion design'],
  },
  {
    id: 'motion-polish',
    icon: 'sliders',
    preferredSkillIds: ['gsap-performance', 'emilkowalski-motion', 'gsap-timeline', 'gsap-core'],
    categoryHints: ['animation-motion'],
    searchTerms: ['motion polish', 'easing', 'performance', 'reduced motion', 'timeline'],
  },
  {
    id: 'transition-motion',
    icon: 'reload',
    preferredSkillIds: ['emilkowalski-motion', 'gsap-timeline', 'gsap-core', 'remotion', 'video-hyperframes'],
    categoryHints: ['animation-motion', 'video-generation'],
    searchTerms: ['transition', 'page transition', 'scene transition', 'loading transition', 'route transition', 'interstitial'],
  },
  {
    id: 'plan-outline',
    icon: 'file',
    preferredSkillIds: ['creative-director', 'pptx', 'frontend-design'],
    categoryHints: ['creative-direction', 'web-artifacts'],
    searchTerms: ['plan', 'outline', 'ppt outline', 'deck outline', 'slide outline', 'storyboard', 'prd', 'brief', 'document'],
  },
  {
    id: 'threejs-scene',
    icon: 'orbit',
    preferredSkillIds: ['threejs', 'react-three-fiber'],
    categoryHints: ['web-artifacts', 'animation-motion'],
    searchTerms: ['three.js', 'threejs', 'spline', '3d', 'webgl', 'particle', 'space', 'portal', 'vanta', 'mapbox', 'deck.gl', '3D', 'depth', 'sci-fi'],
  },
  {
    id: 'anti-ai-polish',
    icon: 'paint-bucket',
    preferredSkillIds: ['frontend-design', 'impeccable-design-polish'],
    categoryHints: ['creative-direction', 'web-artifacts'],
    searchTerms: ['anti ai', 'anti slop', 'taste', 'generic', 'beautify', 'polish'],
  },
  {
    id: 'visual-polish',
    icon: 'palette',
    preferredSkillIds: ['impeccable-design-polish', 'frontend-design', 'creative-director'],
    categoryHints: ['creative-direction', 'web-artifacts'],
    searchTerms: ['polish', 'critique', 'audit', 'harden', 'responsive', 'accessibility', 'deliver'],
  },
  {
    id: 'image-gen',
    icon: 'image',
    preferredSkillIds: ['imagegen-frontend-web', 'fal-generate', 'imagen', 'venice-image-generate', 'image-enhancer'],
    categoryHints: ['image-generation'],
    searchTerms: ['image', 'generate image', 'visual reference', 'moodboard', 'section image', 'illustration'],
  },
  {
    id: 'chart-gen',
    icon: 'grid',
    preferredSkillIds: ['d3-visualization', 'data-report', 'hand-drawn-diagrams'],
    categoryHints: ['web-artifacts', 'image-generation'],
    searchTerms: ['chart', 'data visualization', 'echarts', 'react flow', 'diagram', 'flowchart', 'relationship graph', 'dashboard', 'radar chart'],
  },
  {
    id: 'logo-gen',
    icon: 'palette',
    preferredSkillIds: ['imagegen', 'imagegen-frontend-web', 'creative-director'],
    categoryHints: ['image-generation', 'creative-direction'],
    searchTerms: ['logo', 'wordmark', 'mark', 'brand identity', 'lockup', 'logo generation', 'logo design'],
  },
  {
    id: 'video-gen',
    icon: 'play',
    preferredSkillIds: ['video-hyperframes', 'sora', 'fal-video-edit', 'venice-video', 'replicate'],
    categoryHints: ['video-generation'],
    searchTerms: ['video', 'sora', 'remotion', 'hyperframes', 'storyboard', 'video generation'],
  },
];

// The actions surfaced as primary next-step rows on the assistant card (the
// rest live behind "More"). Curated for the two most common iteration paths:
// auto-match (let the agent pick the workflow / skills) and visual-polish
// (harden the current design into something deliverable).
export const FEATURED_DESIGN_TOOLBOX_ACTION_IDS: DesignToolboxActionId[] = [
  'auto-match',
  'visual-polish',
];

export function getDesignToolboxAction(id: DesignToolboxActionId): DesignToolboxAction | null {
  return DESIGN_TOOLBOX_ACTIONS.find((action) => action.id === id) ?? null;
}

export function designToolboxActionTitle(action: DesignToolboxAction, t: TranslateFn): string {
  return t(`chat.designToolbox.action.${action.id}.title` as keyof Dict);
}

export function designToolboxActionBadge(action: DesignToolboxAction, t: TranslateFn): string {
  return t(`chat.designToolbox.action.${action.id}.badge` as keyof Dict);
}

export function designToolboxActionDescription(action: DesignToolboxAction, t: TranslateFn): string {
  return t(`chat.designToolbox.action.${action.id}.description` as keyof Dict);
}

// Shared matcher for the Design toolbox action rows, used by both the composer
// panel and the next-step card so the two surfaces filter identically. `skill`
// is the action's matched skill (see findDesignToolboxSkill); threading it in
// means searching by a preferred skill's id/name/description/category keeps the
// action row visible alongside its resource row, instead of the two disagreeing.
export function designToolboxActionMatchesQuery(
  action: DesignToolboxAction,
  query: string,
  skill: SkillSummary | null,
  t: TranslateFn,
  extra: string[] = [],
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    designToolboxActionTitle(action, t),
    designToolboxActionBadge(action, t),
    designToolboxActionDescription(action, t),
    ...action.searchTerms,
    skill?.id ?? '',
    skill?.name ?? '',
    skill?.description ?? '',
    skill?.category ?? '',
    ...extra,
  ]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

// `extra` carries any locale-resolved text (localized name / description) the
// caller wants indexed alongside the raw skill fields, so a localized query
// matches the same way the composer's localized resource index does. design-
// toolbox stays free of i18n/content — the caller resolves the strings.
export function skillMatchesQuery(
  skill: SkillSummary,
  query: string,
  extra: string[] = [],
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [skill.id, skill.name, skill.description, skill.mode, skill.surface ?? '', ...skill.triggers, ...extra]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

export function findDesignToolboxSkill(
  action: DesignToolboxAction,
  skills: SkillSummary[],
): SkillSummary | null {
  for (const id of action.preferredSkillIds) {
    const exact = skills.find((skill) => skill.id === id || skill.name === id);
    if (exact) return exact;
  }
  const categoryHintSet = new Set(action.categoryHints);
  const categoryMatch = skills.find((skill) =>
    skill.category ? categoryHintSet.has(skill.category) : false,
  );
  if (categoryMatch) return categoryMatch;
  return (
    skills.find((skill) =>
      action.searchTerms.some((term) => skillMatchesQuery(skill, term)),
    ) ?? null
  );
}
