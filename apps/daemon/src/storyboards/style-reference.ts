// Storyboard style reference — extraction + prompt steering.
//
// The extraction seam deliberately reuses the brand engine's deterministic
// design-md leg (brands/design-md-input.ts) WITHOUT the surrounding brand
// lifecycle: no backing project, no conversation, no design-system
// registration. A storyboard's style reference is a value on the storyboard
// doc (see StoryboardStyleReference in packages/contracts), not a registered
// design system.

import type { BrandColorRole, StoryboardStyleReference } from '@open-design/contracts';

import { brandFromDesignMd, sourceUrlForDesignMd } from '../brands/design-md-input.js';

/**
 * Largest DESIGN.md input considered, in characters — the same truncation
 * cap the brand flow applies (brands/index.ts's normalizeDesignMdInput).
 * Without it a multi-megabyte valid paste would flow into the extracted
 * profile's prose fields (description/tone/messagingPillars retain the
 * Overview section) and bloat every subsequent storyboard read/write,
 * breaking the contract's "stored doc stays bounded" promise.
 */
const MAX_DESIGN_MD_INPUT_CHARS = 240_000;

/**
 * Extract a storyboard style reference from pasted DESIGN.md content.
 * Returns null when the paste is empty or the brand engine cannot derive a
 * profile from it — the caller decides how to report that (the HTTP route
 * answers 400).
 */
export function styleReferenceFromDesignMd(designMd: string): StoryboardStyleReference | null {
  const markdown = designMd.trim().slice(0, MAX_DESIGN_MD_INPUT_CHARS);
  if (!markdown) return null;
  const brand = brandFromDesignMd({ markdown, sourceUrl: sourceUrlForDesignMd(markdown) });
  if (!brand) return null;
  return { source: 'design-md', brand, updatedAt: new Date().toISOString() };
}

/** The brand color roles that meaningfully describe a rendered frame's look. */
const PROMPT_COLOR_ROLES: readonly BrandColorRole[] = [
  'background',
  'foreground',
  'accent',
  'accent-secondary',
];

/**
 * Largest prose segment (mood/imagery) the style clause will carry. The
 * extraction keeps free prose from the paste (e.g. tone is the Overview's
 * first "sentence" — which, for unpunctuated text, is the whole run), and a
 * media prompt must never balloon by hundreds of KB because of it.
 */
const MAX_PROSE_SEGMENT_CHARS = 300;

function clampProse(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > MAX_PROSE_SEGMENT_CHARS
    ? `${trimmed.slice(0, MAX_PROSE_SEGMENT_CHARS)}…`
    : trimmed;
}

/**
 * Prompt-steering invariant for every storyboard media dispatch (frame
 * stills, mood drafts, shot renders): the user's raw prompt always leads,
 * verbatim; when the storyboard carries a style reference, ONE deterministic
 * style clause built from the extracted brand is appended so the generated
 * media inherits the referenced visual identity. Empty brand fields are
 * skipped rather than emitted as empty segments. No reference → the raw
 * prompt passes through unchanged.
 */
export function composeStyledMediaPrompt(
  rawPrompt: string,
  ref: StoryboardStyleReference | null | undefined,
): string {
  if (!ref) return rawPrompt;
  const { brand } = ref;

  const parts: string[] = [];
  const palette = brand.colors
    .filter((color) => PROMPT_COLOR_ROLES.includes(color.role))
    .map((color) => `${color.name} ${color.hex}`.trim())
    .filter(Boolean)
    .join(', ');
  if (palette) parts.push(`palette ${palette}`);

  const families = [brand.typography.display.family, brand.typography.body.family]
    .map((family) => family.trim())
    .filter((family, index, all) => Boolean(family) && all.indexOf(family) === index);
  if (families.length) parts.push(`typography ${families.join(' / ')}`);

  const tone = clampProse(brand.voice.tone);
  if (tone) parts.push(`mood ${tone}`);

  const imagery = [brand.imagery.style, brand.imagery.treatment]
    .map((value) => clampProse(value))
    .filter(Boolean)
    .join('; ');
  if (imagery) parts.push(`imagery ${imagery}`);

  if (!parts.length) return rawPrompt;
  return `${rawPrompt}\n\nStyle reference — match the "${brand.name}" visual identity: ${parts.join('; ')}.`;
}
