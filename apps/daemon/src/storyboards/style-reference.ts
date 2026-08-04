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
 * Extract a storyboard style reference from pasted DESIGN.md content.
 * Returns null when the paste is empty or the brand engine cannot derive a
 * profile from it — the caller decides how to report that (the HTTP route
 * answers 400).
 */
export function styleReferenceFromDesignMd(designMd: string): StoryboardStyleReference | null {
  const markdown = designMd.trim();
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

  const tone = brand.voice.tone.trim();
  if (tone) parts.push(`mood ${tone}`);

  const imagery = [brand.imagery.style, brand.imagery.treatment]
    .map((value) => value.trim())
    .filter(Boolean)
    .join('; ');
  if (imagery) parts.push(`imagery ${imagery}`);

  if (!parts.length) return rawPrompt;
  return `${rawPrompt}\n\nStyle reference — match the "${brand.name}" visual identity: ${parts.join('; ')}.`;
}
