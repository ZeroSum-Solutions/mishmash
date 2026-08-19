// F002 — client discovery interview. Question vocabulary, tier derivation,
// the session/turn DTOs the daemon route and `od interview` share, and the
// two pure mapping functions (`buildClientBrief`, `mapClientBriefToGuidedBrief`)
// that turn answers into a structured brief and a brief into the existing
// project-seeding contract. Pure TypeScript — no daemon/browser dependencies
// — so both `apps/web` and `apps/daemon` import the SAME question set and
// gate logic instead of drifting.
import type { GuidedCreateBrief } from './projects.js';
import {
  type ClientBrief,
  type ClientBriefField,
  type ClientBriefHeader,
  type OpenItem,
  type RequiredClientBriefField,
  REQUIRED_CLIENT_BRIEF_FIELDS,
  isExplicitIDontKnow,
  isRequiredClientBriefField,
  isVagueAnswer,
} from './client-brief.js';

export const INTERVIEW_TIERS = ['quick', 'standard', 'full'] as const;
export type InterviewTier = (typeof INTERVIEW_TIERS)[number];

export function isInterviewTier(value: unknown): value is InterviewTier {
  return typeof value === 'string' && (INTERVIEW_TIERS as readonly string[]).includes(value);
}

// Only `local-trade` ships in this build. R5's archetype expansion has an
// explicit ordering dependency on F001 R3's shared vocabulary
// (apps/daemon/src/design/site-archetypes.ts), which does not exist yet —
// per the PRD, ship `local-trade` only until that dependency clears rather
// than blocking P0 on it.
export const INTERVIEW_ARCHETYPES = ['local-trade'] as const;
export type InterviewArchetype = (typeof INTERVIEW_ARCHETYPES)[number];

export function isInterviewArchetype(value: unknown): value is InterviewArchetype {
  return typeof value === 'string' && (INTERVIEW_ARCHETYPES as readonly string[]).includes(value);
}

export interface InterviewQuestionDef {
  id: string;
  header: ClientBriefHeader;
  label: string;
  type: 'text' | 'textarea';
  required: boolean;
  /** The client's own words are preserved for this field (see ClientBriefField.verbatim). */
  verbatim?: boolean;
  placeholder?: string;
}

// The full `local-trade` question set, in the source questionnaire's own
// order (assets/F002-questionnaire-v1-full.txt). Every REQUIRED question
// mirrors the source's REQUIRED marking exactly (lines 45-47, 77-78).
export const LOCAL_TRADE_QUESTIONS: readonly InterviewQuestionDef[] = [
  { id: 'businessName', header: 'businessOverview', type: 'text', required: false,
    label: 'Legal business name, plus any DBA or trade name customers know you by' },
  { id: 'businessDescription', header: 'businessOverview', type: 'textarea', required: false, verbatim: true,
    label: 'In one sentence, what does the business do?' },
  { id: 'yearsInBusiness', header: 'businessOverview', type: 'text', required: false,
    label: 'How many years have you been in business?' },
  { id: 'differentiation', header: 'businessOverview', type: 'textarea', required: false, verbatim: true,
    label: 'What makes you different from your competitors, even if it feels obvious to you?' },
  { id: 'licensedBondedInsured', header: 'businessOverview', type: 'text', required: false,
    label: 'Are you licensed, bonded, and insured? Anything worth stating on the site?' },

  { id: 'hqLocation', header: 'serviceArea', type: 'text', required: true,
    label: 'What CITY and STATE is your main office or headquarters in?' },
  { id: 'serviceArea', header: 'serviceArea', type: 'textarea', required: true,
    label: 'Every additional city, state, or region you service — the actual list, not "the surrounding area"' },

  { id: 'certifications', header: 'certificationsAndCredentials', type: 'textarea', required: true,
    label: 'Any industry or manufacturer certifications, licenses, or accreditations you hold, named individually (or "none")' },

  { id: 'services', header: 'services', type: 'textarea', required: false,
    label: 'Full list of services or products you want on the site' },
  { id: 'topServices', header: 'services', type: 'text', required: false,
    label: 'Which two or three are the most profitable, or the ones you most want more of?' },
  { id: 'residentialOrCommercial', header: 'services', type: 'text', required: false,
    label: 'Do you serve residential, commercial, or both? If both, which matters more?' },

  { id: 'idealCustomer', header: 'targetCustomer', type: 'textarea', required: false,
    label: 'Who is your ideal customer?' },
  { id: 'topProblemSolved', header: 'targetCustomer', type: 'textarea', required: false,
    label: 'What is the number one problem they come to you to solve?' },
  { id: 'competitorChoiceReason', header: 'targetCustomer', type: 'textarea', required: false,
    label: 'What typically makes someone choose a competitor over you?' },

  { id: 'brandAssets', header: 'visualDirection', type: 'text', required: false,
    label: 'Do you have a logo, brand colors, or brand guidelines?' },
  { id: 'backgroundPreference', header: 'visualDirection', type: 'text', required: false,
    label: 'Do you lean toward a light background, a dark background, or are you unsure?' },
  { id: 'inspirationSites', header: 'visualDirection', type: 'textarea', required: false,
    label: 'Any websites whose look you like? Actual links and what you like about each' },
  { id: 'threeWordsFeel', header: 'visualDirection', type: 'text', required: false, verbatim: true,
    label: 'Three words describing the feel you want (e.g. "clean and professional")' },

  { id: 'ownPhotosVideo', header: 'existingAssets', type: 'text', required: false,
    label: 'Do you have your own photos or video of your work, team, trucks, or facility?' },
  { id: 'testimonialsAndBios', header: 'existingAssets', type: 'textarea', required: false,
    label: 'Any written bios, testimonials, reviews, or past project write-ups ready to use?' },
  { id: 'googleBusinessProfile', header: 'existingAssets', type: 'text', required: false,
    label: 'Do you have a Google Business Profile with reviews we can pull from?' },
  { id: 'existingWebsiteUrl', header: 'existingAssets', type: 'text', required: false,
    label: 'Any existing website we should pull content from? The URL' },
  { id: 'socialHandles', header: 'existingAssets', type: 'text', required: false,
    label: 'Which social media accounts should be linked? Actual handles or URLs' },

  { id: 'phone', header: 'contactAndCallToAction', type: 'text', required: true,
    label: 'The exact phone number, with area code, to feature prominently' },
  { id: 'email', header: 'contactAndCallToAction', type: 'text', required: true,
    label: 'The exact email address to feature, written out in full' },
  { id: 'primaryCta', header: 'contactAndCallToAction', type: 'text', required: false,
    label: 'The single most important thing you want a visitor to do — call, email, fill out a form, or book online' },
  { id: 'ctaButtonText', header: 'contactAndCallToAction', type: 'text', required: false,
    label: 'What should the button say? (e.g. "Call For An Estimate")' },
  { id: 'businessHours', header: 'contactAndCallToAction', type: 'text', required: false,
    label: 'Business hours, and whether you offer emergency or after-hours service' },
  { id: 'physicalAddress', header: 'contactAndCallToAction', type: 'text', required: false,
    label: 'Is there a physical address customers can visit, or is it service-only with no walk-ins?' },

  { id: 'faqQuestions', header: 'faqContent', type: 'textarea', required: false, verbatim: true,
    label: 'What are the five to eight questions people ask most often when they call for the first time?' },
  { id: 'estimatesAndProcess', header: 'faqContent', type: 'textarea', required: false,
    label: 'Do you give free estimates, and how does a typical job go from first call to finished?' },
  { id: 'paymentAndWarranty', header: 'faqContent', type: 'textarea', required: false,
    label: 'Payment methods, financing, warranties/guarantees, and any policies worth stating up front (minimum job size, service radius limits, cancellation, lead times)' },

  { id: 'domainAndHosting', header: 'siteStructureAndLogistics', type: 'text', required: false,
    label: 'Do you own a domain already? Who currently hosts your site or email, if anyone?' },
  { id: 'desiredPages', header: 'siteStructureAndLogistics', type: 'textarea', required: false,
    label: 'What pages do you think you need beyond the homepage?' },
  { id: 'searchTerms', header: 'siteStructureAndLogistics', type: 'textarea', required: false,
    label: 'What terms would someone type into Google to find a business like yours?' },
  { id: 'deadlineAndDecisionMaker', header: 'siteStructureAndLogistics', type: 'text', required: false,
    label: "Any hard deadline or launch date? Who's the decision maker for approving the site?" },

  { id: 'additionalNotes', header: 'additionalNotes', type: 'textarea', required: false,
    label: "Anything about the business or goals for this site we haven't covered, or anything on your current site you want gone?" },
];

// R2 derives `standard` by dropping FAQ depth and Practical Details —
// i.e. the `faqContent` and `siteStructureAndLogistics` headers — while
// keeping all five REQUIRED items.
const STANDARD_DROPPED_HEADERS = new Set<ClientBriefHeader>(['faqContent', 'siteStructureAndLogistics']);

// R2: "REQUIRED items + services + ideal customer + look/feel + primary CTA".
const QUICK_QUESTION_IDS = new Set<string>([
  ...REQUIRED_CLIENT_BRIEF_FIELDS,
  'services',
  'idealCustomer',
  'backgroundPreference',
  'threeWordsFeel',
  'primaryCta',
]);

function questionsForArchetype(archetype: InterviewArchetype): readonly InterviewQuestionDef[] {
  if (archetype === 'local-trade') return LOCAL_TRADE_QUESTIONS;
  // Exhaustiveness guard: a new archetype must be added to
  // INTERVIEW_ARCHETYPES *and* given a question set here, not silently
  // fall through to an empty interview.
  const exhaustive: never = archetype;
  throw new Error(`unknown interview archetype: ${String(exhaustive)}`);
}

/** The question set for one tier, derived from the archetype's full set per R2. */
export function questionsForTier(
  tier: InterviewTier,
  archetype: InterviewArchetype,
): readonly InterviewQuestionDef[] {
  const all = questionsForArchetype(archetype);
  if (tier === 'full') return all;
  if (tier === 'standard') return all.filter((q) => !STANDARD_DROPPED_HEADERS.has(q.header));
  return all.filter((q) => QUICK_QUESTION_IDS.has(q.id));
}

export interface InterviewStep {
  index: number;
  /** 1 or 2 questions — "ASK ONE OR TWO QUESTIONS PER MESSAGE... the most important rule." */
  questions: readonly InterviewQuestionDef[];
}

/** Groups a tier's questions into turns of one or two — the engine's structural
 * enforcement of the source's "most important rule" (never assert it via prose alone). */
export function buildInterviewSteps(
  tier: InterviewTier,
  archetype: InterviewArchetype,
): readonly InterviewStep[] {
  const questions = questionsForTier(tier, archetype);
  const steps: InterviewStep[] = [];
  for (let i = 0; i < questions.length; i += 2) {
    steps.push({ index: steps.length, questions: questions.slice(i, i + 2) });
  }
  return steps;
}

// Assets the source flags as needing a separate send (logo/photos/brand
// guidelines) — questionnaire line 63: "tell me the files need to be sent
// to the designer separately, and note in the summary that they exist."
const STILL_TO_SEND_FIELDS = new Set(['brandAssets', 'ownPhotosVideo', 'testimonialsAndBios']);
const AFFIRMATIVE_RE = /\byes\b/i;

function emptyHeaderMap(): Record<ClientBriefHeader, Record<string, ClientBriefField>> {
  return {
    businessOverview: {},
    serviceArea: {},
    certificationsAndCredentials: {},
    services: {},
    targetCustomer: {},
    visualDirection: {},
    existingAssets: {},
    contactAndCallToAction: {},
    faqContent: {},
    siteStructureAndLogistics: {},
    additionalNotes: {},
  };
}

/**
 * Pure mapping from a flat answer set to a `ClientBrief` (R3), applying the
 * REQUIRED gate (R4) and the executable "vague"/"I don't know" definitions
 * (R1/R2). Deterministic and side-effect-free so it is directly unit-
 * testable without driving the turn-by-turn engine — e.g. success
 * criterion 4 (a "my main line" phone answer yields `needs-info`) calls
 * this function with a fixed answer set.
 */
export function buildClientBrief(
  tier: InterviewTier,
  archetype: InterviewArchetype,
  answers: Readonly<Record<string, string>>,
): ClientBrief {
  const questions = questionsForTier(tier, archetype);
  const headers = emptyHeaderMap();
  const openItems: OpenItem[] = [];
  let allRequiredComplete = true;

  for (const question of questions) {
    const raw = answers[question.id];
    const trimmed = typeof raw === 'string' ? raw.trim() : '';

    if (question.required && isRequiredClientBriefField(question.id)) {
      const fieldId: RequiredClientBriefField = question.id;
      if (trimmed.length === 0) {
        allRequiredComplete = false;
        openItems.push({ fieldId: question.id, label: question.label, reason: 'skipped' });
        continue;
      }
      if (isExplicitIDontKnow(trimmed)) {
        allRequiredComplete = false;
        headers[question.header][question.id] = {
          value: trimmed,
          confidence: 'low',
          ...(question.verbatim ? { verbatim: true } : {}),
        };
        openItems.push({ fieldId: question.id, label: question.label, reason: 'unknown' });
        continue;
      }
      if (isVagueAnswer(fieldId, trimmed)) {
        allRequiredComplete = false;
        headers[question.header][question.id] = {
          value: trimmed,
          confidence: 'low',
          ...(question.verbatim ? { verbatim: true } : {}),
        };
        openItems.push({ fieldId: question.id, label: question.label, reason: 'vague' });
        continue;
      }
      headers[question.header][question.id] = {
        value: trimmed,
        confidence: 'high',
        ...(question.verbatim ? { verbatim: true } : {}),
      };
      continue;
    }

    // Optional field — accepted as given; a blank answer is simply skipped.
    if (trimmed.length === 0) {
      openItems.push({ fieldId: question.id, label: question.label, reason: 'skipped' });
      continue;
    }
    headers[question.header][question.id] = {
      value: trimmed,
      confidence: 'high',
      ...(question.verbatim ? { verbatim: true } : {}),
    };
    if (STILL_TO_SEND_FIELDS.has(question.id) && AFFIRMATIVE_RE.test(trimmed)) {
      openItems.push({
        fieldId: question.id,
        label: `${question.label} (file still needs to be sent)`,
        reason: 'still-to-send',
      });
    }
  }

  return {
    ...headers,
    openItems,
    status: allRequiredComplete ? 'complete' : 'needs-info',
  };
}

const MAPPED_FIELD_MAX_LENGTH = 400;

function truncate(value: string, max = MAPPED_FIELD_MAX_LENGTH): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

function joinFieldValues(fields: Record<string, ClientBriefField>, ids: readonly string[]): string {
  return ids
    .map((id) => fields[id]?.value)
    .filter((value): value is string => Boolean(value && value.trim().length > 0))
    .join('; ');
}

/**
 * R6 — maps a completed interview brief onto the EXISTING
 * `CreateProjectRequest.brief: GuidedCreateBrief` contract
 * (packages/contracts/src/api/projects.ts:307-361) instead of forking a
 * parallel answers→project path. Populates `product`/`audience`/`useCase`
 * from SERVICES and TARGET CUSTOMER, and `direction` from VISUAL
 * DIRECTION, per R6.
 *
 * Deliberately excludes `contactAndCallToAction` (phone/email) — R6 scopes
 * the mapping to SERVICES / TARGET CUSTOMER / VISUAL DIRECTION only, which
 * also keeps client PII out of the generation prompt (R10's privacy
 * concern: anonymous client text is untrusted input folded into a prompt).
 * The caller is responsible for sending the result through
 * `POST /api/projects` with `skipDiscoveryBrief: true`, which reuses
 * `normalizeGuidedBrief`'s existing sanitization
 * (apps/daemon/src/prompts/guided-brief.ts) — this function stays a pure,
 * daemon-free mapping and does not duplicate that sanitization, only a
 * defensive length cap so a very long answer never trips
 * `normalizeGuidedBrief`'s 500-character rejection.
 */
export function mapClientBriefToGuidedBrief(brief: ClientBrief): GuidedCreateBrief {
  const result: GuidedCreateBrief = {};

  const product = joinFieldValues(brief.services, ['services', 'topServices']);
  if (product) result.product = truncate(product);

  const audience = joinFieldValues(brief.targetCustomer, ['idealCustomer']);
  if (audience) result.audience = truncate(audience);

  const useCase = joinFieldValues(brief.targetCustomer, ['topProblemSolved', 'competitorChoiceReason']);
  if (useCase) result.useCase = truncate(useCase);

  const direction = joinFieldValues(brief.visualDirection, [
    'threeWordsFeel',
    'backgroundPreference',
    'inspirationSites',
  ]);
  if (direction) result.direction = truncate(direction);

  return result;
}

export interface InterviewSessionSummary {
  id: string;
  tier: InterviewTier;
  archetype: InterviewArchetype;
  status: 'in-progress' | 'complete' | 'needs-info';
  stepIndex: number;
  totalSteps: number;
}

export interface InterviewTurnPrompt {
  /** Acknowledgment/greeting text. Never a "Section N of M" announcement (source rule). */
  message: string;
  questions: InterviewQuestionDef[];
}

export interface StartInterviewRequest {
  tier: InterviewTier;
  /** Defaults to `local-trade` when omitted. */
  archetype?: InterviewArchetype;
}

export interface StartInterviewResponse {
  session: InterviewSessionSummary;
  turn: InterviewTurnPrompt;
}

export interface InterviewTurnRequest {
  /** Answers keyed by question id, for every question in the CURRENT step. */
  answers: Record<string, string>;
}

export interface InterviewTurnResponse {
  session: InterviewSessionSummary;
  /** Present while the interview is still in-progress (including a push-back retry). */
  turn?: InterviewTurnPrompt;
  /** Present once the interview reaches a terminal state (`complete` or `needs-info`). */
  result?: {
    clientBrief: ClientBrief;
    guidedBrief: GuidedCreateBrief;
  };
  /**
   * Present when the submitted step was rejected for a REQUIRED push-back.
   * `turn` still carries the SAME step (not advanced) so the client can
   * re-prompt in place.
   */
  pushBack?: { fieldId: string; message: string };
}
