// F002 — client discovery interview. `ClientBrief` is the structured
// output of a completed interview (packages/contracts/src/api/interviews.ts
// builds one from an answer set), typed from the source questionnaire's 12
// summary headers (docs/plans/2026-08-18-demo-findings/assets/
// F002-questionnaire-v1-full.txt:113-126). Runtime-validated with a
// colocated Zod schema per the repo's validate-at-boundaries convention —
// a TypeScript interface alone does not validate anything at the API
// boundary.
import { z } from 'zod';

// The five REQUIRED items the source interview calls out by name
// ("Check that you have all five REQUIRED items", questionnaire line 109):
// headquarters city+state, full service-area list, certifications named
// individually, exact phone, exact email. A brief cannot reach
// `status: 'complete'` while any of these five is missing or vague — see
// `isVagueAnswer` below for the executable definition of "vague" (PRD R2).
export const REQUIRED_CLIENT_BRIEF_FIELDS = [
  'hqLocation',
  'serviceArea',
  'certifications',
  'phone',
  'email',
] as const;
export type RequiredClientBriefField = (typeof REQUIRED_CLIENT_BRIEF_FIELDS)[number];

export function isRequiredClientBriefField(value: string): value is RequiredClientBriefField {
  return (REQUIRED_CLIENT_BRIEF_FIELDS as readonly string[]).includes(value);
}

export const ClientBriefFieldSchema = z.object({
  value: z.string(),
  /**
   * The client's own words, preserved verbatim. The source rule requires
   * this only for material that might become website copy — not every
   * field (questionnaire line 130) — so this is opt-in per question, not a
   * blanket requirement.
   */
  verbatim: z.boolean().optional(),
  confidence: z.enum(['high', 'low']),
});
export type ClientBriefField = z.infer<typeof ClientBriefFieldSchema>;

export const OPEN_ITEM_REASONS = ['skipped', 'unknown', 'vague', 'still-to-send'] as const;
export type OpenItemReason = (typeof OPEN_ITEM_REASONS)[number];

export const OpenItemSchema = z.object({
  fieldId: z.string(),
  label: z.string(),
  reason: z.enum(OPEN_ITEM_REASONS),
});
export type OpenItem = z.infer<typeof OpenItemSchema>;

export const CLIENT_BRIEF_STATUSES = ['complete', 'needs-info'] as const;
export type ClientBriefStatus = (typeof CLIENT_BRIEF_STATUSES)[number];

const ClientBriefFieldMapSchema = z.record(z.string(), ClientBriefFieldSchema);

// One property per source summary header, in the source's own order
// (questionnaire lines 115-126). `openItems`/`status` are not headers —
// they are the brief's own bookkeeping.
export const ClientBriefSchema = z.object({
  businessOverview: ClientBriefFieldMapSchema,
  serviceArea: ClientBriefFieldMapSchema,
  certificationsAndCredentials: ClientBriefFieldMapSchema,
  services: ClientBriefFieldMapSchema,
  targetCustomer: ClientBriefFieldMapSchema,
  visualDirection: ClientBriefFieldMapSchema,
  existingAssets: ClientBriefFieldMapSchema,
  contactAndCallToAction: ClientBriefFieldMapSchema,
  faqContent: ClientBriefFieldMapSchema,
  siteStructureAndLogistics: ClientBriefFieldMapSchema,
  additionalNotes: ClientBriefFieldMapSchema,
  /**
   * Everything skipped, answered "I don't know" to, answered vaguely, or
   * still needs to be sent as a file (logo, photos, brand guidelines) —
   * "OPEN ITEMS AND MISSING INFO" in the source summary.
   */
  openItems: z.array(OpenItemSchema),
  status: z.enum(CLIENT_BRIEF_STATUSES),
});
export type ClientBrief = z.infer<typeof ClientBriefSchema>;

export type ClientBriefHeader = Exclude<keyof ClientBrief, 'openItems' | 'status'>;

function normalizeAnswer(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

// Non-answers a REQUIRED field must never accept, regardless of which
// field it is. "none" is deliberately NOT here — it is a valid, confirmed
// answer for `certifications` ("If I say none, confirm and move on",
// questionnaire line 47) and is handled as a field-specific exception
// below.
const GENERIC_VAGUE_ANSWERS = new Set([
  'n/a',
  'na',
  'unknown',
  '-',
  '.',
  'my main line',
  'the number on my card',
]);

const I_DONT_KNOW_PHRASES = new Set([
  "i don't know",
  'i dont know',
  'idk',
  'not sure',
  'unsure',
  'no idea',
]);

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.!\s]+$/u, '');
}

/**
 * True when `rawAnswer` is an explicit "I don't know" to a REQUIRED
 * question. R1's executable definition: the client may say this and the
 * conversation still ends — the engine accepts it immediately instead of
 * pushing back — but it always leaves the field short of `'complete'`
 * (see `isVagueAnswer`'s caller in `buildClientBrief`, interviews.ts).
 */
export function isExplicitIDontKnow(rawAnswer: string): boolean {
  const normalized = stripTrailingPunctuation(normalizeAnswer(rawAnswer).toLowerCase());
  return I_DONT_KNOW_PHRASES.has(normalized);
}

/**
 * Executable definition of "vague" for a REQUIRED field (PRD R2). Applies
 * after normalization (trim + collapse whitespace): a small deny-list of
 * non-answers, plus a field-specific format check for phone (>= 10 digits
 * after stripping formatting) and email (contains "@" and a "." after it).
 * This is the stricter, server-side check R1/R4 require — NOT
 * `QuestionForm.tsx`'s `questionAnswerIsPresent`, which only checks for a
 * non-empty trimmed string and is left untouched (it serves every form in
 * the product, not just this interview).
 */
export function isVagueAnswer(fieldId: RequiredClientBriefField, rawAnswer: string): boolean {
  const normalized = normalizeAnswer(rawAnswer).toLowerCase();
  if (normalized.length === 0) return true;
  if (normalized.length === 1) return true;
  if (isExplicitIDontKnow(rawAnswer)) return true;

  if (fieldId === 'certifications') {
    const confirmedNone = new Set(['none', 'no certifications', 'n/a', 'na']);
    if (confirmedNone.has(normalized)) return false;
  }

  if (GENERIC_VAGUE_ANSWERS.has(normalized)) return true;

  if (fieldId === 'phone') {
    const digits = normalized.replace(/\D/g, '');
    return digits.length < 10;
  }

  if (fieldId === 'email') {
    const at = normalized.indexOf('@');
    if (at <= 0) return true;
    const dot = normalized.indexOf('.', at);
    return dot === -1 || dot === normalized.length - 1;
  }

  return false;
}
