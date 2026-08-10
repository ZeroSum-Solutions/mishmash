// Guided create flow (PRD C8) — shared prompt assembly for the two entry
// points that collect a `GuidedCreateBrief` before starting a project: the
// Design Library "Use as template" flow (routes/design-library.ts) and the
// generic project-create endpoint's template-start path
// (routes/project/index.ts). Kept here, outside both routes, so the two
// callers fold the SAME brief prose instead of drifting.
//
// Every field is optional and every answered field renders as one
// imperative line; an unanswered field never appears — no placeholder text,
// no "(not specified)".

import type { GuidedCreateBrief, GuidedCreateFidelity } from '@open-design/contracts';

const MAX_SCREENS = 200;
const MAX_ITERATIONS = 3;
const MAX_PAGES = 20;
const MAX_PAGE_LENGTH = 80;
// Free-text brief fields are user input folded directly into the generation
// prompt (buildGuidedBriefSection). A short cap plus single-line collapsing
// (sanitizeSingleLine below) keeps pasted input from fabricating its own
// "Design brief:" section or otherwise restructuring the assembled prompt.
const MAX_TEXT_FIELD_LENGTH = 500;

const FIDELITY_VALUES: readonly GuidedCreateFidelity[] = ['wireframe', 'clean-prototype', 'high-fidelity'];
const FIDELITY_LABEL: Record<GuidedCreateFidelity, string> = {
  wireframe: 'wireframe',
  'clean-prototype': 'clean prototype',
  'high-fidelity': 'high-fidelity, polished',
};

export type NormalizeGuidedBriefResult =
  | { ok: true; brief: GuidedCreateBrief | undefined }
  | { ok: false; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const CONTROL_CHAR_CODEPOINT_MAX = 0x1f;
const DEL_CODEPOINT = 0x7f;

// Prompt-injection hygiene: every free-text brief value is folded verbatim
// into the generation prompt (buildGuidedBriefSection), so a pasted value
// carrying newlines/control bytes could otherwise fabricate its own
// "Design brief:" heading or "- " bullet lines, or open a blank-line
// paragraph the model would read as a fresh instruction block. Collapsing
// every C0 control byte (carriage return, line feed, tab, and friends) and
// DEL to plain whitespace, then collapsing whitespace runs and trimming,
// keeps every answered field a single display line no matter what was
// pasted in.
function sanitizeSingleLine(value: string): string {
  const codepoints = Array.from(value);
  const withoutControls = codepoints
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code <= CONTROL_CHAR_CODEPOINT_MAX || code === DEL_CODEPOINT ? ' ' : ch;
    })
    .join('');
  return withoutControls.split(/\s+/u).filter((part) => part.length > 0).join(' ');
}

function normalizeBoundedText(value: unknown, field: string): string | null | { error: string } {
  if (value === undefined) return null;
  if (typeof value !== 'string') return { error: `brief.${field} must be a string` };
  const sanitized = sanitizeSingleLine(value);
  if (!sanitized) return null;
  if (sanitized.length > MAX_TEXT_FIELD_LENGTH) {
    return { error: `brief.${field} exceeds ${MAX_TEXT_FIELD_LENGTH} characters` };
  }
  return sanitized;
}

/**
 * Validates and normalizes a request body's `brief` field into a
 * `GuidedCreateBrief`, or a discriminated failure the caller can turn into
 * its own 400. Returns `{ ok: true, brief: undefined }` for an absent/empty
 * brief so callers can treat "no brief" and "empty brief" identically.
 */
export function normalizeGuidedBrief(value: unknown): NormalizeGuidedBriefResult {
  if (value === undefined || value === null) return { ok: true, brief: undefined };
  if (!isPlainObject(value)) return { ok: false, message: 'brief must be an object' };

  const brief: GuidedCreateBrief = {};

  if (value.screens !== undefined) {
    const screens = Number(value.screens);
    if (!Number.isFinite(screens) || !Number.isInteger(screens) || screens < 1 || screens > MAX_SCREENS) {
      return { ok: false, message: `brief.screens must be an integer between 1 and ${MAX_SCREENS}` };
    }
    brief.screens = screens;
  }

  if (value.fidelity !== undefined) {
    if (typeof value.fidelity !== 'string' || !FIDELITY_VALUES.includes(value.fidelity as GuidedCreateFidelity)) {
      return { ok: false, message: `brief.fidelity must be one of ${FIDELITY_VALUES.join(', ')}` };
    }
    brief.fidelity = value.fidelity as GuidedCreateFidelity;
  }

  if (value.iterations !== undefined) {
    const iterations = Number(value.iterations);
    if (!Number.isFinite(iterations) || !Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) {
      return { ok: false, message: `brief.iterations must be an integer between 1 and ${MAX_ITERATIONS}` };
    }
    brief.iterations = iterations;
  }

  if (value.pages !== undefined) {
    if (!Array.isArray(value.pages) || value.pages.some((page) => typeof page !== 'string')) {
      return { ok: false, message: 'brief.pages must be an array of strings' };
    }
    // Same single-line sanitization as the free-text fields — a "page" name
    // is still user input folded verbatim into the prompt.
    const pages = [...new Set(value.pages.map((page) => sanitizeSingleLine(page)).filter(Boolean))];
    if (pages.length > MAX_PAGES) {
      return { ok: false, message: `brief.pages must have at most ${MAX_PAGES} entries` };
    }
    if (pages.some((page) => page.length > MAX_PAGE_LENGTH)) {
      return { ok: false, message: `each brief.pages entry must be at most ${MAX_PAGE_LENGTH} characters` };
    }
    if (pages.length > 0) brief.pages = pages;
  }

  for (const field of ['product', 'audience', 'useCase', 'direction'] as const) {
    const normalized = normalizeBoundedText(value[field], field);
    if (normalized && typeof normalized === 'object') return { ok: false, message: normalized.error };
    if (normalized) brief[field] = normalized;
  }

  if (value.matchKitLook !== undefined) {
    if (typeof value.matchKitLook !== 'boolean') {
      return { ok: false, message: 'brief.matchKitLook must be a boolean' };
    }
    if (value.matchKitLook) brief.matchKitLook = true;
  }

  return { ok: true, brief: Object.keys(brief).length > 0 ? brief : undefined };
}

export interface GuidedBriefPromptOptions {
  /** Label of the kit/template the brief is scoped to, for the "match its own look" line. */
  subjectLabel?: string;
}

/**
 * Renders the answered fields of a guided-create brief as a short imperative
 * "Design brief" section. Returns `''` for an absent/empty brief so callers
 * can `[a, b, briefSection].filter(Boolean).join(...)` without a placeholder
 * paragraph ever appearing.
 */
export function buildGuidedBriefSection(
  brief: GuidedCreateBrief | undefined,
  options: GuidedBriefPromptOptions = {},
): string {
  if (!brief) return '';
  const lines: string[] = [];
  if (brief.screens !== undefined) {
    lines.push(`Build ${brief.screens} screen${brief.screens === 1 ? '' : 's'}.`);
  }
  if (brief.fidelity) {
    lines.push(`Target ${FIDELITY_LABEL[brief.fidelity]} fidelity.`);
  }
  if (brief.iterations !== undefined && brief.iterations > 1) {
    lines.push(`Produce ${brief.iterations} distinct variations to choose from.`);
  }
  if (brief.pages?.length) {
    lines.push(`Cover these pages/flows: ${brief.pages.join(', ')}.`);
  }
  if (brief.product) lines.push(`Product: ${brief.product}.`);
  if (brief.audience) lines.push(`Audience: ${brief.audience}.`);
  if (brief.useCase) lines.push(`Core use case: ${brief.useCase}.`);
  if (brief.direction) lines.push(`Brand/content/visual direction: ${brief.direction}.`);
  if (brief.matchKitLook) {
    lines.push(
      options.subjectLabel
        ? `Match "${options.subjectLabel}"'s own visual direction as closely as practical.`
        : "Match the source kit's own visual direction as closely as practical.",
    );
  }
  if (lines.length === 0) return '';
  return ['Design brief:', ...lines.map((line) => `- ${line}`)].join('\n');
}

/**
 * Folds a rendered brief section into an existing (optional) prompt string.
 * `null` when there is neither an existing prompt nor a brief section, so
 * callers can assign the result straight to `pendingPrompt` without an extra
 * `|| null`.
 */
export function foldGuidedBriefIntoPrompt(
  existingPrompt: string | null | undefined,
  briefSection: string,
): string | null {
  const trimmedExisting = typeof existingPrompt === 'string' ? existingPrompt.trim() : '';
  if (!briefSection) return trimmedExisting || null;
  if (!trimmedExisting) return briefSection;
  return `${trimmedExisting}\n\n${briefSection}`;
}
