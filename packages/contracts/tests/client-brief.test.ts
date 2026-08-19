import { describe, expect, it } from 'vitest';
import {
  ClientBriefSchema,
  isExplicitIDontKnow,
  isVagueAnswer,
} from '../src/api/client-brief';

describe('isVagueAnswer', () => {
  it('rejects "my main line" for phone — the source questionnaire\'s own example of an unacceptable answer', () => {
    expect(isVagueAnswer('phone', 'my main line')).toBe(true);
  });

  it('accepts a real 10-digit phone number', () => {
    expect(isVagueAnswer('phone', '(555) 123-4567')).toBe(false);
  });

  it('rejects a phone number with fewer than 10 digits', () => {
    expect(isVagueAnswer('phone', '555-1234')).toBe(true);
  });

  it('rejects an email with no "@"', () => {
    expect(isVagueAnswer('email', 'not-an-email')).toBe(true);
  });

  it('rejects an email with no "." after "@"', () => {
    expect(isVagueAnswer('email', 'someone@nodot')).toBe(true);
  });

  it('accepts a real email address', () => {
    expect(isVagueAnswer('email', 'owner@example.com')).toBe(false);
  });

  it('accepts an explicit "none" for certifications — the source\'s own confirmed-none rule', () => {
    expect(isVagueAnswer('certifications', 'none')).toBe(false);
  });

  it('rejects "n/a" for hqLocation as a generic non-answer', () => {
    expect(isVagueAnswer('hqLocation', 'n/a')).toBe(true);
  });

  it('accepts a real city/state answer', () => {
    expect(isVagueAnswer('hqLocation', 'Tampa, FL')).toBe(false);
  });

  it('rejects an empty or whitespace-only answer', () => {
    expect(isVagueAnswer('serviceArea', '   ')).toBe(true);
  });
});

describe('isExplicitIDontKnow', () => {
  it('recognizes common phrasings', () => {
    expect(isExplicitIDontKnow("I don't know")).toBe(true);
    expect(isExplicitIDontKnow('idk')).toBe(true);
    expect(isExplicitIDontKnow('Not sure.')).toBe(true);
  });

  it('does not flag a real answer as "I don\'t know"', () => {
    expect(isExplicitIDontKnow('Tampa, FL')).toBe(false);
  });
});

describe('ClientBriefSchema', () => {
  it('validates a well-formed complete brief', () => {
    const brief = {
      businessOverview: {},
      serviceArea: { hqLocation: { value: 'Tampa, FL', confidence: 'high' } },
      certificationsAndCredentials: {},
      services: {},
      targetCustomer: {},
      visualDirection: {},
      existingAssets: {},
      contactAndCallToAction: {},
      faqContent: {},
      siteStructureAndLogistics: {},
      additionalNotes: {},
      openItems: [],
      status: 'complete',
    };
    expect(ClientBriefSchema.safeParse(brief).success).toBe(true);
  });

  it('rejects an unknown status value', () => {
    const brief = {
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
      openItems: [],
      status: 'done',
    };
    expect(ClientBriefSchema.safeParse(brief).success).toBe(false);
  });

  it('rejects an openItems entry with an invalid reason', () => {
    const brief = {
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
      openItems: [{ fieldId: 'phone', label: 'Phone', reason: 'forgot' }],
      status: 'needs-info',
    };
    expect(ClientBriefSchema.safeParse(brief).success).toBe(false);
  });
});
