import { describe, expect, it } from 'vitest';
import {
  INTERVIEW_TIERS,
  LOCAL_TRADE_QUESTIONS,
  buildClientBrief,
  buildInterviewSteps,
  mapClientBriefToGuidedBrief,
  questionsForTier,
} from '../src/api/interviews';
import { ClientBriefSchema, REQUIRED_CLIENT_BRIEF_FIELDS } from '../src/api/client-brief';

const COMPLETE_REQUIRED_ANSWERS = {
  hqLocation: 'Tampa, FL',
  serviceArea: 'Tampa, Clearwater, St. Petersburg',
  certifications: 'BICSI, EPA',
  phone: '(813) 555-0100',
  email: 'owner@example.com',
};

describe('questionsForTier — structural tier shape (success criterion 2)', () => {
  it('full retains every section standard/quick drop items from', () => {
    const full = questionsForTier('full', 'local-trade');
    const standard = questionsForTier('standard', 'local-trade');
    const quick = questionsForTier('quick', 'local-trade');

    const fullHeaders = new Set(full.map((q) => q.header));
    expect(fullHeaders.has('faqContent')).toBe(true);
    expect(fullHeaders.has('siteStructureAndLogistics')).toBe(true);

    const standardHeaders = new Set(standard.map((q) => q.header));
    expect(standardHeaders.has('faqContent')).toBe(false);
    expect(standardHeaders.has('siteStructureAndLogistics')).toBe(false);

    const quickHeaders = new Set(quick.map((q) => q.header));
    expect(quickHeaders.has('faqContent')).toBe(false);
    expect(quickHeaders.has('siteStructureAndLogistics')).toBe(false);
  });

  it('every tier keeps all five REQUIRED fields — a shorter interview collects less, never less reliably', () => {
    for (const tier of INTERVIEW_TIERS) {
      const ids = new Set(questionsForTier(tier, 'local-trade').map((q) => q.id));
      for (const requiredId of REQUIRED_CLIENT_BRIEF_FIELDS) {
        expect(ids.has(requiredId), `${tier} is missing REQUIRED field ${requiredId}`).toBe(true);
      }
    }
  });

  it('quick is meaningfully shorter than standard, which is shorter than full', () => {
    const quickLen = questionsForTier('quick', 'local-trade').length;
    const standardLen = questionsForTier('standard', 'local-trade').length;
    const fullLen = questionsForTier('full', 'local-trade').length;
    expect(quickLen).toBeLessThan(standardLen);
    expect(standardLen).toBeLessThan(fullLen);
    // quick's question count stays small enough to plausibly run in 5-10 minutes.
    expect(quickLen).toBeLessThanOrEqual(12);
  });

  it('the full local-trade set has no duplicate question ids', () => {
    const ids = LOCAL_TRADE_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildInterviewSteps — one-or-two-questions-per-turn ("the most important rule")', () => {
  it('every step for every tier has 1 or 2 questions, never more', () => {
    for (const tier of INTERVIEW_TIERS) {
      const steps = buildInterviewSteps(tier, 'local-trade');
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) {
        expect(step.questions.length).toBeGreaterThanOrEqual(1);
        expect(step.questions.length).toBeLessThanOrEqual(2);
      }
    }
  });

  it('steps cover every question exactly once, in order', () => {
    const questions = questionsForTier('quick', 'local-trade');
    const steps = buildInterviewSteps('quick', 'local-trade');
    const flattened = steps.flatMap((s) => s.questions.map((q) => q.id));
    expect(flattened).toEqual(questions.map((q) => q.id));
  });
});

describe('buildClientBrief output passes RUNTIME schema validation (success criterion 3)', () => {
  it('a complete brief validates against ClientBriefSchema, not just TypeScript compilation', () => {
    const brief = buildClientBrief('full', 'local-trade', {
      ...COMPLETE_REQUIRED_ANSWERS,
      businessDescription: 'We fix what other guys break.',
      services: 'Structured cabling, fiber splicing',
    });
    const parsed = ClientBriefSchema.safeParse(brief);
    expect(parsed.success, parsed.success ? '' : JSON.stringify((parsed as any).error?.issues)).toBe(true);
  });

  it('a needs-info brief (skipped/vague/unknown fields, openItems populated) also validates', () => {
    const brief = buildClientBrief('quick', 'local-trade', {
      hqLocation: 'Tampa, FL',
      serviceArea: 'Tampa, Clearwater',
      certifications: "I don't know",
      phone: 'my main line',
      // email omitted entirely — exercises the "skipped" openItems path too.
    });
    expect(brief.status).toBe('needs-info');
    expect(brief.openItems.length).toBeGreaterThan(0);
    const parsed = ClientBriefSchema.safeParse(brief);
    expect(parsed.success, parsed.success ? '' : JSON.stringify((parsed as any).error?.issues)).toBe(true);
  });
});

describe('buildClientBrief — REQUIRED gate (R4, success criterion 4)', () => {
  it('a vague phone answer ("my main line") yields status "needs-info", not "complete"', () => {
    const brief = buildClientBrief('quick', 'local-trade', {
      ...COMPLETE_REQUIRED_ANSWERS,
      phone: 'my main line',
    });
    expect(brief.status).toBe('needs-info');
    expect(brief.openItems.some((item) => item.fieldId === 'phone' && item.reason === 'vague')).toBe(true);
  });

  it('every REQUIRED item answered well yields status "complete"', () => {
    const brief = buildClientBrief('quick', 'local-trade', COMPLETE_REQUIRED_ANSWERS);
    expect(brief.status).toBe('complete');
    expect(brief.openItems.filter((item) => REQUIRED_CLIENT_BRIEF_FIELDS.includes(item.fieldId as any))).toHaveLength(0);
  });

  it('an explicit "I don\'t know" on a REQUIRED field is recorded verbatim in openItems and still blocks "complete"', () => {
    const brief = buildClientBrief('quick', 'local-trade', {
      ...COMPLETE_REQUIRED_ANSWERS,
      certifications: "I don't know",
    });
    expect(brief.status).toBe('needs-info');
    const item = brief.openItems.find((i) => i.fieldId === 'certifications');
    expect(item?.reason).toBe('unknown');
    expect(brief.certificationsAndCredentials.certifications?.value).toBe("I don't know");
  });

  it('an unanswered REQUIRED field is recorded as skipped and blocks "complete"', () => {
    const { hqLocation: _omit, ...rest } = COMPLETE_REQUIRED_ANSWERS;
    const brief = buildClientBrief('quick', 'local-trade', rest);
    expect(brief.status).toBe('needs-info');
    expect(brief.openItems.some((item) => item.fieldId === 'hqLocation' && item.reason === 'skipped')).toBe(true);
  });

  it('a confirmed "none" for certifications does not block completion', () => {
    const brief = buildClientBrief('quick', 'local-trade', {
      ...COMPLETE_REQUIRED_ANSWERS,
      certifications: 'none',
    });
    expect(brief.status).toBe('complete');
  });

  it('an optional field left blank is recorded as skipped, not vague, and never blocks completion', () => {
    const brief = buildClientBrief('quick', 'local-trade', COMPLETE_REQUIRED_ANSWERS);
    expect(brief.status).toBe('complete');
    expect(brief.openItems.some((item) => item.fieldId === 'services' && item.reason === 'skipped')).toBe(true);
  });

  it('verbatim fields preserve the client\'s exact words', () => {
    const brief = buildClientBrief('standard', 'local-trade', {
      ...COMPLETE_REQUIRED_ANSWERS,
      businessDescription: 'We fix what other guys break.',
    });
    expect(brief.businessOverview.businessDescription?.value).toBe('We fix what other guys break.');
    expect(brief.businessOverview.businessDescription?.verbatim).toBe(true);
  });

  it('flags a "yes" answer to brandAssets as still-to-send', () => {
    const brief = buildClientBrief('standard', 'local-trade', {
      ...COMPLETE_REQUIRED_ANSWERS,
      brandAssets: 'Yes, we have a logo and brand colors.',
    });
    expect(brief.openItems.some((item) => item.fieldId === 'brandAssets' && item.reason === 'still-to-send')).toBe(true);
  });
});

describe('mapClientBriefToGuidedBrief — R6 mapping, round-trips every mapped field', () => {
  it('maps services/target-customer/visual-direction fields into product/audience/useCase/direction', () => {
    const brief = buildClientBrief('full', 'local-trade', {
      ...COMPLETE_REQUIRED_ANSWERS,
      services: 'Structured cabling, fiber splicing',
      topServices: 'Fiber splicing',
      idealCustomer: 'Commercial property managers',
      topProblemSolved: 'Unreliable network wiring',
      threeWordsFeel: 'clean and professional',
      backgroundPreference: 'light background',
    });
    const guided = mapClientBriefToGuidedBrief(brief);
    expect(guided.product).toContain('Structured cabling, fiber splicing');
    expect(guided.product).toContain('Fiber splicing');
    expect(guided.audience).toContain('Commercial property managers');
    expect(guided.useCase).toContain('Unreliable network wiring');
    expect(guided.direction).toContain('clean and professional');
    expect(guided.direction).toContain('light background');
  });

  it('never includes phone/email — keeps client PII out of the generation prompt', () => {
    const brief = buildClientBrief('full', 'local-trade', COMPLETE_REQUIRED_ANSWERS);
    const guided = mapClientBriefToGuidedBrief(brief);
    const serialized = JSON.stringify(guided);
    expect(serialized).not.toContain('813');
    expect(serialized).not.toContain('owner@example.com');
  });

  it('omits a mapped field entirely when its source answers are all absent', () => {
    const brief = buildClientBrief('quick', 'local-trade', COMPLETE_REQUIRED_ANSWERS);
    const guided = mapClientBriefToGuidedBrief(brief);
    expect(guided.product).toBeUndefined();
  });

  it('does not set iterations/screens/fidelity/pages — R12 (variants) is out of scope', () => {
    const brief = buildClientBrief('full', 'local-trade', COMPLETE_REQUIRED_ANSWERS);
    const guided = mapClientBriefToGuidedBrief(brief);
    expect(guided.iterations).toBeUndefined();
    expect(guided.screens).toBeUndefined();
    expect(guided.fidelity).toBeUndefined();
    expect(guided.pages).toBeUndefined();
  });
});
